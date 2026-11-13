# Shopee 竞品月销量流程

导入 `examples/shopee-monthly-sales.flow`，在工作流凭证中为萌啦填写完整的 Authorization 值。流程读取用户指定的汇率和监控视图，只处理「监控中」的记录，拆分同一单元格的多个商品 ID。默认抓取 2026-08，可在动态参数中修改月份、产品范围和请求间隔。

明细按月份、平台、商品 ID 匹配，平台使用 `shopee-站点代码`。销量取日销量之和，单价取原币 GMV 除以销量，销额取原币 GMV 乘人民币汇率。汇总按月份、产品名、产品线和公司匹配，客单价取人民币销额除以销量。销量为零时客单价记零。汇总沿用目标表现有的「国内线上」字段名。写入匹配到的旧记录使用飞书返回的 record_id。接口缺数、分页不完整或汇率缺失时记录告警，跳过相关汇总组。

当前流程包需要支持按视图读取和分页 exchange 的客户端。只读预览最多抽取两个商品，每个商品读完全部分页。重新打包时指定一个新输出文件：

```sh
node scripts/pack-flow.mjs examples/shopee-monthly-sales.json shopee-monthly-sales.flow
```
