const defaultBaseUrl = 'https://api.openai.com/v1';

export type ModelConfig = { base_url: string; model: string; ak: string };

export function parseModelConfig(value: unknown, previous?: ModelConfig): ModelConfig {
  if (
    !value ||
    typeof value !== 'object' ||
    !('base_url' in value) ||
    typeof value.base_url !== 'string' ||
    !('model' in value) ||
    typeof value.model !== 'string' ||
    !('ak' in value) ||
    typeof value.ak !== 'string'
  ) {
    throw new Error('模型配置无效');
  }

  const model = value.model.trim();
  const ak = value.ak.trim();
  if (!model || model.length > 200 || ak.length > 4096 || value.base_url.length > 2048) {
    throw new Error('请填写有效的模型名称、地址和 AK');
  }

  let url: URL;
  try {
    url = new URL(value.base_url.trim() || defaultBaseUrl);
  } catch {
    throw new Error('模型 API 地址无效');
  }
  // HTTP is allowed so local model servers (Ollama, LM Studio, vLLM) can be used.
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('模型 API 地址必须为 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('模型 API 地址不能包含凭证、查询参数或片段');
  }
  const base_url = url.href.replace(/\/+$/, '');
  const credential = ak || (previous?.base_url === base_url ? previous.ak : '');
  if (!credential) throw new Error('请填写此模型地址的 AK');

  return { base_url, model, ak: credential };
}

export function publicModelConfig(config?: ModelConfig) {
  return {
    base_url: config?.base_url ?? defaultBaseUrl,
    model: config?.model ?? '',
    hasAk: Boolean(config?.ak),
  };
}
