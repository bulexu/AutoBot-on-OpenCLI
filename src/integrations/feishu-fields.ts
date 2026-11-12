const api = 'https://open.feishu.cn/open-apis';

type FeishuApplication = { appId: string; appSecret: string };
type Field = {
  field_id: string;
  field_name: string;
  type: number;
  ui_type?: string;
  is_primary?: boolean;
  property?: unknown;
};
type FieldPage = { items: Field[]; has_more: boolean; page_token?: string };

async function request<T>(url: string | URL, options: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Feishu HTTP ${response.status}`);
  const payload = (await response.json()) as { code?: number };
  if (payload.code !== 0) throw new Error(`Feishu API error ${payload.code ?? 'unknown'}`);
  return payload as T;
}

async function tenantToken({ appId, appSecret }: FeishuApplication) {
  if (!appId || !appSecret) throw new Error('Feishu application credentials are required');

  const auth = await request<{ tenant_access_token: string }>(
    `${api}/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  if (!auth.tenant_access_token) throw new Error('Feishu tenant token is missing');

  return auth.tenant_access_token;
}

export async function createFeishuFieldReader(application: FeishuApplication) {
  const token = await tenantToken(application);
  return async (baseToken: string, tableId: string): Promise<Field[]> => {
    const url = new URL(
      `${api}/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    );
    url.searchParams.set('page_size', '100');
    const fields: Field[] = [];
    const seen = new Set<string>();
    for (;;) {
      const { data } = await request<{ data: FieldPage }>(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!Array.isArray(data?.items)) throw new Error('Feishu field list is missing');
      fields.push(...data.items);
      if (!data.has_more) return fields;
      if (!data.page_token || seen.has(data.page_token)) {
        throw new Error('Invalid Feishu field pagination token');
      }
      seen.add(data.page_token);
      url.searchParams.set('page_token', data.page_token);
    }
  };
}

export async function createFeishuRecords(application: FeishuApplication, baseToken: string) {
  const token = await tenantToken(application);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  function tableUrl(table: string) {
    return `${api}/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(table)}/records`;
  }

  return {
    async *records(table: string, view?: string) {
      const url = new URL(tableUrl(table));
      url.searchParams.set('page_size', '100');
      if (view) url.searchParams.set('view_id', view);
      const seen = new Set<string>();
      for (;;) {
        const { data } = await request<{
          data: {
            items?: { record_id: string; fields: Record<string, unknown> }[];
            has_more: boolean;
            page_token?: string;
          };
        }>(url, { headers });
        for (const record of data.items ?? [])
          yield { recordId: record.record_id, fields: record.fields };
        if (!data.has_more) return;
        if (!data.page_token || seen.has(data.page_token))
          throw new Error('Invalid Feishu record pagination token');
        seen.add(data.page_token);
        url.searchParams.set('page_token', data.page_token);
      }
    },
    async create(table: string, records: Record<string, unknown>[]) {
      await request(`${tableUrl(table)}/batch_create`, {
        headers,
        method: 'POST',
        body: JSON.stringify({ records: records.map((fields) => ({ fields })) }),
      });
    },
    async update(table: string, records: { recordId: string; fields: Record<string, unknown> }[]) {
      await request(`${tableUrl(table)}/batch_update`, {
        headers,
        method: 'POST',
        body: JSON.stringify({
          records: records.map(({ recordId, fields }) => ({ record_id: recordId, fields })),
        }),
      });
    },
  };
}
