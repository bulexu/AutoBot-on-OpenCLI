import { readFile, writeFile } from 'node:fs/promises';
import { exportFlowPackage, importFlowPackage } from '../src/flow/package.ts';

const numberExpression = String.raw`function($value) {
  ($type($value) = "number" or ($type($value) = "string" and
    $contains($trim($value), /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i)))
  ? $number($value)
}`;

const baseToken = 'ViXsbD4aLa3ja5ss0jtcyPedngh';
const asinExpression = String.raw`function($value) {
  (
    $raw := $type($value) = "object" ? $value.link : $value;
    $text := $type($raw) = "string" ? $trim($raw) : "";
    $match := $match($text, /\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[\/?#]|$)/i, 1);
    $uppercase($contains($text, /^[a-z0-9]{10}$/i) ? $text : $match.groups[0])
  )
}`;

export function declarativeCompetitorPackage(legacy: ReturnType<typeof importFlowPackage>) {
  return exportFlowPackage(
    {
      ...legacy.manifest,
      version: '1.3.1',
      inputs: [
        ...(legacy.manifest.inputs ?? []),
        { key: 'productFilter', label: '产品范围', type: 'string' },
      ],
    },
    {
      steps: [
        { id: 'rates', op: 'bitable.read', baseToken, table: 'tbl4IFfAMtykDmb2' },
        { id: 'competitors', op: 'bitable.read', baseToken, table: 'tbl1gGQJZpUsUPE8' },
        {
          id: 'candidates',
          op: 'records.transform',
          sources: ['rates', 'competitors'],
          expression: `(
          $asin := ${asinExpression};
          $numberValue := ${numberExpression};
          $sites := {
            "德国": "amazon.de", "英国": "amazon.co.uk", "法国": "amazon.fr",
            "意大利": "amazon.it", "西班牙": "amazon.es", "美国": "amazon.com", "日本": "amazon.co.jp"
          };
          $scope := inputs.productFilter;
          $rates := sources.rates;
          $rows := sources.competitors[监控状态 = "监控中" and ($not($exists($scope)) or 产品名 = $scope)];
          $expanded := $rows.(
            $row := $;
            $keys($sites).(
              $site := $;
              $link := $lookup($row, $site);
              $link ? (
                $id := $asin($link);
                $assert($exists($id) and $boolean($trim($row.产品名)) and
                  $boolean($trim($row.产品线)) and $boolean($trim($row.公司)), "Invalid competitor");
                $rate := $rates[$type(国家) = "string" and $trim(国家) = $site and
                  $type(代码) = "string" and $type(货币) = "string" and $numberValue(汇率) > 0][-1];
                {
                  "identity": $site & "/" & $id,
                  "site": $site,
                  "asin": $id,
                  "url": "https://www." & $lookup($sites, $site) & "/dp/" & $id,
                  "product": $row.产品名,
                  "line": $row.产品线,
                  "company": $row.公司,
                  "group": $string([$row.产品名, $row.产品线, $row.公司]),
                  "rate": $numberValue($rate.汇率),
                  "currency": $trim($rate.货币),
                  "params": {
                    "name": "asin_sales_trend",
                    "arguments": {"marketplace": $trim($rate.代码), "asin": $id}
                  }
                }
              )
            )
          );
          $unique := $map($distinct($expanded.identity), function($key) {(
            $matching := $expanded[identity = $key];
            $assert($count($distinct($matching.group)) = 1, "Conflicting competitor bindings");
            $matching[0]
          )});
          {"records": [mode = "preview" and $not($exists($scope)) ? $unique[[0..1]] : $unique]}
        )`,
        },
        {
          id: 'requests',
          op: 'records.transform',
          sources: ['candidates'],
          expression:
            '{"records": [sources.candidates[$exists(rate) and $exists(params.arguments.marketplace)]]}',
        },
        {
          id: 'sales',
          op: 'http.read',
          from: 'requests',
          url: 'https://mcp.sellersprite.com/mcp',
          method: 'POST',
          readOnly: true,
          headers: {
            accept: 'application/json, text/event-stream',
            'secret-key': '{{secret.sellersprite-secret-key}}',
          },
          body: { jsonrpc: '2.0', id: 1, method: 'tools/call' },
          bind: { body: { params: 'params' } },
          recordsPath: '$',
          responseMode: 'exchange',
          previewInputLimit: 'source',
          intervalParameter: 'requestIntervalMs',
          retry: {
            path: 'result.structuredContent.code',
            encodedPath: 'result.content.0.text',
            decodedPath: 'code',
            value: 'ERROR_MAXIMUM_ACCESS_PER_MINUTE',
            waitMs: 60_000,
          },
          stopOnRateLimit: true,
        },
        {
          id: 'monthly',
          op: 'records.transform',
          sources: ['sales', 'candidates'],
          expression: `(
          $month := inputs.month;
          $asin := ${asinExpression};
          $numberValue := ${numberExpression};
          $items := $map(sources.sales, function($exchange) {(
            $item := $exchange.input;
            $result := $exchange.response.result;
            $payload := $result.structuredContent ??
              ($type($result.content[0].text) = "string" ? $parseJSON($result.content[0].text) : $result);
            $points := $payload.salesTrendPoints ?? $payload.data.salesTrendPoints ?? $payload.data.data.salesTrendPoints;
            $row := $points[month = $month][0];
            $product := $payload.data.asin ?? $payload.asin;
            $parent := $asin($product.parent);
            $sales := $numberValue($row.parentUnitSales);
            $amount := $numberValue($row.parentSalesRevenue);
            $price := $numberValue($row.price);
            $rate := $numberValue($item.rate);
            $error := $exchange.error ?? ($exchange.response.error or $result.isError ? "接口拒绝请求" :
              ($type($points) != "array" ? "响应缺少销售趋势" :
                ($not($exists($row)) ? "缺少 " & $month & " 月度数据" :
                  ($not($exists($parent)) ? "响应缺少可识别的父 ASIN" :
                    ($not($exists($sales)) or $not($exists($amount)) or $not($exists($price)) or
                     $sales < 0 or $amount < 0 or $price < 0 ? $month & " 的父体销量、父体销额或单价缺失或无效")))));
            {
              "group": $item.group,
              "parentKey": $exists($parent) ? $item.site & "/" & $parent,
              "warning": $exists($error) ? $item.identity & "：" & $error,
              "fields": $not($exists($error)) ? {
                "月份": $month, "商品链接": $substringBefore($item.url, "/dp/") & "/dp/" & $parent, "平台": "amazon-" & $item.site,
                "产品名": $item.product, "销量": $sales, "币种": $item.currency, "单价": $price,
                "销额（原币）": $amount, "汇率": $rate, "销额（CNY）": $amount * $rate
              }
            }
          )});
          $missingRate := $map(sources.candidates[$not($exists(rate))], function($item) {
            {"group": $item.group, "warning": $item.identity & "：缺少站点汇率"}
          });
          $rows := [$items, $missingRate];
          $valid := $rows[$exists(fields)];
          $parents := $map($distinct($valid.parentKey), function($key) {(
            $matches := $valid[parentKey = $key];
            $count($distinct($matches.group)) = 1
              ? $matches[0]
              : $map($distinct($matches.group), function($group) {
                {"group": $group, "warning": $key & "：父 ASIN 对应多个汇总组，已跳过"}
              })
          )});
          $normalized := $reduce([$parents], function($all, $item) { $append($all, $item) }, []);
          $output := [$normalized, $rows[$exists(warning)]];
          $assert($exists($output.fields), "没有可写入的竞品月销量。请检查父 ASIN、销量字段和汇总组冲突");
          {"records": $output, "warnings": [$distinct($output.warning)]}
        )`,
        },
        {
          id: 'detail-rows',
          op: 'records.transform',
          sources: ['monthly'],
          expression: '{"records": [sources.monthly.fields]}',
        },
        {
          id: 'summary-rows',
          op: 'records.transform',
          sources: ['monthly'],
          expression: `(
          $rows := sources.monthly;
          $incomplete := $distinct($rows[$exists(warning)].group);
          $groups := $distinct($rows[$exists(fields)].group);
          {
            "records": [$map($groups[$not($ in $incomplete)], function($key) {(
              $matched := $rows[group = $key].fields;
              $group := $parseJSON($key);
              $sales := $sum($matched.销量);
              $amount := $sum($matched.\`销额（CNY）\`);
              {
                "月份": $matched[0].月份, "产品名": $group[0], "产品线": $group[1],
                "公司": $group[2], "销量": $sales, "客单价": $sales ? $amount / $sales : 0,
                "预估销额": $amount
              }
            )})],
            "warnings": [$count($incomplete) ? "跳过 " & $count($incomplete) & " 个数据不完整的汇总组"]
          }
        )`,
        },
        {
          id: 'detail',
          op: 'bitable.upsert',
          from: 'detail-rows',
          baseToken,
          target: 'tbl3CgYf4xmw1ZTb',
          keyExpression: `($asin := ${asinExpression}; $id := $asin(商品链接); 月份 and 平台 and $id ? $string([月份, 平台, $id]))`,
        },
        {
          id: 'summary',
          op: 'bitable.upsert',
          from: 'summary-rows',
          baseToken,
          target: 'tblP2rZ9sKG82cHr',
          keyExpression:
            '月份 and 产品名 and 产品线 and 公司 ? $string([月份, 产品名, 产品线, 公司])',
        },
      ],
    },
  );
}

if (process.argv[2] === 'pack') {
  const legacy = importFlowPackage(await readFile('examples/competitor-sales-2026-10.flow'));
  await writeFile(
    'examples/competitor-sales-declarative.flow',
    declarativeCompetitorPackage(legacy),
  );
}
