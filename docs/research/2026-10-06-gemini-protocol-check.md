# Gemini 实施日前协议核对

日期：2026-10-06，Asia/Hong_Kong。只读官方文档，没有读取密钥或发送生成请求；实际模型能力仍未配置。

[generateContent reference](https://ai.google.dev/api/generate-content) 保留 POST `/v1beta/{model=models/*}:generateContent`。输入使用 `contents[].parts[].text` 或 `inlineData: { mimeType, data }`，data 为 base64。结构化输出使用 `generationConfig.responseFormat.text: { mimeType: 'APPLICATION_JSON', schema }`。返回 `usageMetadata`、`modelVersion` 与 `responseId`；后者是响应标识，不推定它支持任务查询。

[音频指南](https://ai.google.dev/gemini-api/docs/audio) 的当前示例使用 interactions，而上段选择 generateContent；两种请求字段分别处理。inline 总请求上限 20 MB，包含 prompt 与全部文件。应用按实际 JSON 编码字节计数，提交范围仍须从核验快照裁出。

[结构化输出指南](https://ai.google.dev/gemini-api/docs/structured-output) 列出 properties、required、additionalProperties；远程 schema 不替代本地参数、版本、hash 和锁检查。

[图像指南](https://ai.google.dev/gemini-api/docs/image-generation) 的局部编辑描述为语义遮罩。应用最终保留选区外像素与锁定区域，文字由独立本地图层绘制；图像能力单独配置和 probe。

这些是协议输入，未验证真实文字规划、音频理解、图像编辑、多轮修改或计费用量。模型 ID 由用户配置；不得从文档示例推定当前账号可用。
