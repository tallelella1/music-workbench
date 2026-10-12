# Gemini 协议复核（2026-10-05，Asia/Hong_Kong）

本轮只读取 Google 官方文档，未读取账号或密钥，未发送生成请求，所有真实模型能力仍未配置。原研究见 [2026-10-03 记录](2026-10-03-gemini-api.md)。

[generateContent reference](https://ai.google.dev/api/generate-content) 当前仍列 POST `/v1beta/{model=models/*}:generateContent`、`contents`、`generationConfig.responseFormat`。JSON 输出使用 `responseFormat.text.mimeType=APPLICATION_JSON` 和 `schema`；旧 responseSchema 系列继续标弃用。footer 为 2026-09-23。原研究的协议选择可继续消费，不混用另一协议的字段，不自动重发生成请求。

[音频指南](https://ai.google.dev/gemini-api/docs/audio) 目前示例使用 interactions；inline 请求总量仍为 20 MB，包含 prompt 与全部文件。generateContent 音频结构应以其 reference 为准。实现中按实际序列化字节计数，并仅提交已展示、从核验快照裁出的选择区间。

[结构化输出](https://ai.google.dev/gemini-api/docs/structured-output) 继续列出对象 properties、required、additionalProperties；本地严格 schema、注册效果、素材 hash、版本和锁检查仍是执行入口。远程生成结构本身不证明方案可执行。

[图像指南](https://ai.google.dev/gemini-api/docs/image-generation) 继续将局部编辑描述为语义遮罩，指南示例与 generateContent reference 的字段不可混用。锁定像素和遮罩外像素由本地合成恢复；模型配置和实际能力检查独立于音频配置。

结论仅为文档复核；没有真实文字规划、音频理解、图像编辑或多轮服务验收。实现 Agent 若遇到具体字段疑问，应限定读取对应官方段落。
