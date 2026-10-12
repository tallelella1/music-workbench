# LX 基础兼容范围

本次实现以 [LX 自定义音源文档](https://lxmusic.toside.cn/desktop/custom-source) 和官方固定提交 `ad95d5091c9ed689fa72b5e5c849df65f5a679ce` 为依据，详细协议证据见 `.superpowers/sdd/lx-compat-research.md`。已验证的是本项目自建脚本和本地 HTTP 媒体；用户没有真实 LX 配置，第三方脚本与真实外部整曲播放仍未验收。API 版本字符串不表示全协议兼容。

## 已接入的基础 API

- 每个脚本使用独立隐藏 BrowserWindow、独立非持久 session、独立 renderer 进程，`sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`。Electron 行为测试核对 OSProcessId 和 sandboxed 指标；同时存在主页面、两个脚本时三个 PID 不同。
- `globalThis.lx`、`version='2.0.0'`、`env='desktop'`、`EVENT_NAMES.request/inited/updateAlert`，标准浏览器定时器。
- `lx.on('request', handler)` 返回 Promise；最后注册的单个 handler 覆盖前一个。`musicUrl` handler 必须返回 Promise，结果为 HTTP(S) URL 字符串，最长 2048 字符。对象结果、同步字符串和其他动作不能作为有效完整音源。
- `lx.send('inited', {sources})` 使用官方的 `qualitys` 字段。平台限制 wy/kg/tx/kw/mg，`type='music'`，动作仅 musicUrl，质量过滤到 128k/320k/flac/flac24bit；未知平台、动作和质量被过滤。重复初始化和不支持事件拒绝。
- 请求形状保持 `{source,action:'musicUrl',info:{type,musicInfo}}`，`info.type` 是选中的质量。wy 的 songmid 使用实际数字 ID；kg 保存 Audioid/songmid、FileHash/hash、MixSongID/albumAudioId；tx 分别保存 mid/songmid、数字 songId、strMediaMid 和 albumMid，缺失 ID 不生成 0。types/_types 只基于明确存在的 kg 质量 hash；当前 wy/tx 搜索不提供可信质量详情，传空数组和空对象。
- musicInfo 提供旧扁平 name/singer/interval/albumName/img/typeUrl。标题优先保留平台 originalTitle；缺少源 singer 时将已知艺术家用“、”连接，属于本项目格式化规则。未获取封面时 img 为空字符串。不会向脚本传本地文件路径。
- `currentScriptInfo` 包含 name/description/version/author/homepage/rawScript，源码实际保存于宿主音源记录，路径不进入页面。起始块注释解析允许 BOM/前导空白，元信息截断到 24/36/36/56/1024 字符；超长值直接截断，不附 LX 的省略号。这两点是显式差异。
- `lx.request(url, options, callback)` 立即返回可重复安全调用的 cancel 函数。GET、明确字符串 body 的 POST/PUT/PATCH/DELETE、HEAD、headers、URL 编码 form 已实现；callback 的 `resp.body` 与第三参一致，文本始终尝试 JSON.parse，raw 为 Uint8Array，bytes 为实际字节数。真实 fixture 覆盖 GET、headers、非 JSON Content-Type 下的 JSON 解析和 raw 字节。

## 显式差异与未支持项

初始化外部 watchdog 为 5 秒，解析为 15 秒，短于官方宿主的 20 秒。普通解析取消立即结束该调用、丢弃迟到结果，保留音源启用状态和其他并行调用。该调用原来的外部 watchdog 持续到脚本结算或单次期限；已取消但一直不结算的脚本仍会在原期限被销毁、终止网络请求并禁用。禁用、销毁和退出会清理全部 watchdog；旧实例的 watchdog 不作用于重新启用后的实例。真正超时只终止对应脚本，其他音源和主播放器继续工作。Windows 主窗口关闭时应用主动退出并清理隐藏音源窗口。

源网络请求只经专用 preload 通道到主进程，页面直接网络被 CSP 和 session 拦截。方法仅接受上述大/小写名单；body 只支持字符串；form 值只支持字符串、数字、布尔。formData、multipart、needle 的隐式对象编码、proxy 和重定向兼容未支持；重定向明确拒绝。网络响应最多 4 MiB，每脚本同时最多 20 个请求，正 timeout 限制到 60 秒，其他值用 60 秒。取消抑制 callback；网络失败统一以 Error 和 null/null 返回，原始异常不泄露 URL 或凭证。POST/form/超时/取消分支实现存在，但未声称经过真实第三方脚本兼容验收。

`lx.utils.buffer`、全部同步 crypto、zlib、Buffer 全局、local 的 musicUrl/歌词/封面、任意文件访问、通用 IPC 和 AI 配置均不提供；不把同步 helper 偷换为 Promise。updateAlert 接受一次但不打开 UI、不下载更新；openDevTools 忽略。没有公开 cancel/dispose 事件或 removeEvent。脚本生命周期由主界面的导入、启用、测试、禁用控制；重启后保留记录但需再次手动启用。替换以 name+author 识别，只有新版本初始化通过才禁用旧版本，旧源码和记录保留；失败替换保留旧版本运行。

## 完整播放与音质

音源设置中的测试只显示验证结果，用户点击“播放已验证歌曲”后才接管播放器。离开该页面会取消未完成测试；留在页面通过队列/下一首切歌时，迟到的验证结果也不会自动播放。

LX URL 字符串不携带标准 headers/expiresAt/preview/expectedDurationSeconds；转换后这些字段分别为 `{}`、null、null、null。脚本网络请求 headers 不继承到媒体 URL，fixture 已验证。preview=null 保持未知；明确 preview=true 立即拒绝。未知预期时长不能仅靠标题或下载成功通过。

主进程先受控完整下载原始媒体，再用真实 ffprobe 属性和 FFmpeg 完整解码样本计数核验。已知预期时长与实际解码时长差必须不超过 5 秒，容器宣称时长若与实际样本差超过 0.5 秒则拒绝；可靠完整短曲可以通过。每个媒体限制 128 MiB、解码限制 60 秒；总解析预算 90 秒，最多六个不同音源/平台曲目/质量组合。核验前或核验期间明确到期的链接共用同一组合的一次刷新机会，刷新后重新下载并完整核验，普通失败不重试；刷新仍受原总预算和取消约束。

核验通过的原始 bytes 与 probe 绑定，`media://remote/<opaque-id>` 只读取这份 bytes，不再次请求可能改变内容的上游 URL。headers、真实 URL、脚本源码和绝对路径不进入 PlaybackResource。远程资源缓存最多 20 个/256 MiB，租约最多 24 小时，若来源明确到期则取更早时间；暂停后恢复若租约过期，Controller 重新解析、重新完整核验并恢复原位置。不会将远程播放能力推定为离线编辑许可。

严格 FLAC 必须实测 codec=flac；flac24bit 必须实测 FLAC、位深至少 24 bit、采样率至少 48 kHz。128k/320k 以实际 bitrate 达到标称的 95% 为最低门槛，无损 FLAC 可满足这两个较低档位。自动模式允许低档媒体，但始终显示实际 codec、采样率、位深和 bitrate，不展示未经证实的原生/Hi-Res 标签，也不靠转码获得标签。

自动换平台要求 NFKC/大小写/空白规范化后标题、艺术家集合相同，保留证据证明版本相同，已知时长差不超过 5 秒，且专辑一致。遗留 version 枚举、缺失证据、版本冲突、专辑不一致或缺失不能自动接受；用户仍可直接选择搜索结果或在音源设置中指定曲目。
