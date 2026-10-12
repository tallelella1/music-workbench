# LX custom source 基础兼容研究

Status：官方文档与固定官方源码已核对；未加载任何第三方脚本，未执行产品测试，未修改产品文件。仅证明协议理解，完整脚本兼容和真实完整播放未证明。

时间：2026-10-03。文档：https://lxmusic.toside.cn/desktop/custom-source 。固定源码 SHA：`ad95d5091c9ed689fa72b5e5c849df65f5a679ce`。GitHub tree API 本次限流，随后仅下载一次此 SHA 的官方源码快照完成核对；临时快照已清理。

## 主来源与行号

以下缩写均指固定 SHA，不指浮动 master：

- P：[src/main/modules/userApi/renderer/preload.js](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/main/modules/userApi/renderer/preload.js)。事件 19–44；请求处理 68–110；初始化 128–167；网络 194–242；send/on 243–272；utils 273–315；脚本信息/API版本 317–326；初始化错误 181–186、349–366。
- T：[src/common/utils/tools.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/common/utils/tools.ts#L58)，58–99 是实际传给脚本的旧结构转换。
- C：[src/renderer/core/music/utils.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/core/music/utils.ts#L272)，173、272、309 调用 toOldMusicInfo。
- R：[src/renderer/core/useApp/useInitUserApi.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/core/useApp/useInitUserApi.ts#L40)，40–65 将 songInfo 放入 `{source, action:'musicUrl', info:{type,musicInfo}}`。
- H：[src/main/modules/userApi/rendererEvent/rendererEvent.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/main/modules/userApi/rendererEvent/rendererEvent.ts#L116)，116–143 的请求取消与 20 秒宿主预算。
- M：[src/main/modules/userApi/utils.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/main/modules/userApi/utils.ts#L53)，53–88 的脚本头解析。
- W：[src/main/modules/userApi/main.ts](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/main/modules/userApi/main.ts#L74)，74–100 的隐藏窗口设置。

## 实际事件与初始化

P：`EVENT_NAMES={request:'request',inited:'inited',updateAlert:'updateAlert'}`。无官方 cancel/dispose 事件。`lx.version='2.0.0'`，`lx.env='desktop'`。

`lx.on(eventName,handler)` 返回 Promise<void>；仅 request 可注册，最后一次覆盖之前 handler，不是监听器数组。未知/不支持事件返回 rejected Promise。handler 入参只有 `{source,action,info}`，必须返回 Promise；同步字符串在官方 `.then` 调用处会失败。没有公开 removeEvent（源码只有注释）。

`lx.send(eventName,data)` 返回 Promise<void>；可发送 inited 和 updateAlert，send(request) 拒绝。inited 仅一次，第二次拒绝；初始化前全局 error/unhandledrejection 使初始化失败。官方有细节：handleInit 验证失败通过内部状态上报，但 send(inited) 的 Promise 仍 resolve；应用需要以宿主初始化状态判断。

基础 fixture 可使用此最小形状（例子为研究者编写）：

```js
lx.on(lx.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (action !== 'musicUrl') throw new Error('unsupported action')
  // 校验 source、info.type、info.musicInfo.songmid，再返回测试服务 URL。
  return 'http://127.0.0.1:PORT/fixture.wav'
})
lx.send(lx.EVENT_NAMES.inited, {
  openDevTools: false,
  sources: { wy: { name: 'fixture', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } }
})
```

P 的有效 sources key 为 kw/kg/tx/wy/mg/local，type 必须 music；非 local 的 actions 仅 musicUrl，qualitys 只接受 128k/320k/flac/flac24bit；local 支持 musicUrl/lyric/pic，qualitys=[]。字段拼写是 `qualitys`，不是 qualities。name 文档允许省略，官方初始化只留下 type/actions/qualitys；过滤未知动作/音质。虽 supportActions 含 xm，allSources 不含 xm，因此不能宣称可初始化 xm。

updateAlert 的 `{log,updateUrl?}` 每运行一次，重复拒绝；文档 log 最长1024、URL可选 HTTP。P 的 URL 条件和文档不完全一致（逻辑 &&），别复制该缺陷；本项目禁自动更新可接受事件但不启用更新，并在 compatibility.md 说明忽略 UI。openDevTools 仅 true 时官方打开；本项目默认不打开，属于显式差异。

## musicUrl、musicInfo 与返回值

`info.type` 是选中的质量字符串，必须属于该 source 的 qualitys；不是动作、文件类型或整段 musicInfo。local 时为 null。handler 成功只返回 HTTP(S) URL 字符串；P 要求长度<=2048、`/^https?:/`。脚本没有标准字段返回 headers/expiresAt/preview/expectedDurationSeconds；这些是本项目宿主内部增强，不应要求 LX 脚本返回对象。

由 C→T→R 证明脚本收到**旧扁平音乐对象**，即使 R 的 TypeScript 注解写 MusicInfo。共同字段：name、singer（单字符串，多歌手由源格式化）、source、songmid、interval（格式化时间字符串或null）、albumName、img、typeUrl={}；在线额外 albumId、types（质量条目数组）、_types（按质量键的详情对象）。不要直接传本项目 Track，亦不要仅传新结构 `meta.songId`。

- wy：songmid=平台数值 id；基础识别用 songmid。传可用 albumId、types/_types，不把 missing ID 编造为0。
- kg：songmid=Audioid；hash=FileHash；albumAudioId=MixSongID（可选）；types 各项及 _types 对应质量含 hash，来自平台各质量 FileHash/HQFileHash/SQFileHash/ResFileHash。只有主 hash 不代表有所有质量 hash。
- tx：songmid=mid（字符串）；songId=数值 id；strMediaMid=file.media_mid；albumMid=album.mid。两种歌曲 ID 不可互换。
- mg（预留）：copyrightId、lrcUrl/mrcUrl/trcUrl；local 有 filePath/ext、albumId=''、types=[]、_types={}。本项目不应为兼容 local 向脚本泄露真实路径；首版明确不支持 local 自定义动作。

官方没有声明所有脚本都必需哪些 musicInfo 字段；以上是宿主提供的实际字段，不是每脚本通用最小必填清单。基础 fixture 至少断言 source/action/type/songmid；wy/kg/tx fixture 可额外断言其真实身份字段。质量标签仅声明解析能力，不是完整媒体或位深证据。

## 网络 request

签名 `lx.request(url,options,callback)`，立即返回 cancel 函数，**不是 Promise**。options 支持 method/headers/body/form/formData/timeout；默认 method='get'。P 按 truthy body > form > formData 取数据，form/formData 设置 needle options.json=false；没有明确启用 multipart，不能假定完整 multipart 支持。body 的默认编码取决于 needle，不可仅依据接口注释断言一律 JSON。

timeout 是毫秒，正数限制至60_000，缺失/不合法用60_000，绑定 needle response_timeout。完整连接/重定向语义需 needle 依赖进一步实测，此次未做。隐藏 renderer 的网页 fetch 受 CORS；桥接主进程请求才能保留官方不受跨域限制的 lx.request 语义。

callback(err,resp,body)：网络库 error 时 callback(err,null,null)；成功时 resp={statusCode,statusMessage,headers,bytes,raw,body}，第三参与 resp.body 相同。P 先把 raw 转字符串，再尝试 JSON.parse，无论 Content-Type；失败保留字符串。raw 是二进制 Buffer（跨 contextBridge 通常表现为可克隆字节数据，具体类型须兼容测试），不能假装不存在。headers 是 needle 响应头对象，不是浏览器 Headers。源码没主动把 HTTP 4xx/5xx 转 err，脚本应自行看 statusCode；DNS/连接/超时/取消属于 error 路径，具体 error.name/code/message 没有标准承诺。

cancel 函数调用 request.abort；官方第二次调用会接触已置 null 对象，不保证幂等。项目建议做幂等取消，并明确这是容错增强。无官方取消音乐解析事件；H 取消只拒绝宿主等待、删除 requestKey，迟到响应丢弃，脚本 Promise 与它发起的 HTTP 未因此自动 abort。

## 元信息、定时器、utils

M 要求源码首字符即起始块注释（正则从 ^ 匹配），缺块注释导入失败；@name/description/version/author/homepage 从该块解析，缺值为空字符串，name 缺值由官方生成默认名。截断阈值分别24/36/36/56/1024，超长附 ...。UTF-8；首版可容忍 BOM/前导空白，但须记作放宽差异。`currentScriptInfo` 含这五项及 rawScript；需实际保存导入源码，不能用脚本路径替代 rawScript。

P 通过执行网页 JavaScript 使用标准浏览器 setTimeout/clearTimeout/setInterval/clearInterval；没有 lx.setTimeout 或定时器元协议。Task 5 的初始化5秒/解析15秒/销毁 renderer 属于项目宿主约束，短于 LX 原实现20秒；必须在兼容文档写明，不依赖脚本线程内定时器终止无限循环。

基础 fixture 无须 utils；完整官方桌面 API 列表包括：buffer.from(...args)、buffer.bufToString(buf,format)；crypto.aesEncrypt(buffer,mode,key,iv)（同步字节结果）、rsaEncrypt(buffer,key)（固定128字节左侧填零、RSA_NO_PADDING）、randomBytes(size)（同步字节，不是文档文字说的字符串）、md5(str)（同步 hex 字符串）；zlib.inflate/deflate（Promise<字节>）。没有 sha1、aesDecrypt 或 Buffer 全局的官方保证。basic compatibility 可以将 crypto/zlib/formData/raw字节处理列未支持；不要暴露空 utils 并声称完整兼容，也不要把本应同步 crypto 偷换为 Promise。不能通过沙箱 preload 直接 require 任意 Node 模块补兼容。

## 对 Task 5 的最小建议与未知项

保持独立隐藏 renderer + sandbox:true + contextIsolation:true + nodeIntegration:false；W 官方虽然同样隐藏并隔离，但 sandbox:false，不能原样复制 preload 的 needle/crypto/zlib import 到受沙箱限制环境。runtime 提供事件分发、脚本元信息和浏览器定时器，preload 只桥接受校验的初始化、请求响应及有 requestId 的网络。

首版承诺范围应具体列为：官方事件字符串、单 handler/Promise 语义、inited sources/qualitys、wy/kg/tx 扁平 musicInfo、musicUrl Promise<string>、GET/可明确编码 POST、headers/超时/cancel、callback JSON/文本及第三参一致、元信息、浏览器定时器。request 相关 HTTP 权限与媒体 headers 留主进程；不能把网络请求 headers 自动继承给音乐URL，官方没有此契约。URL结果进入完整性检查时 preview=null 而非 false；若产品拒绝未知试听状态，应真实记录未验收，不为通过测试改字段。

待证实/明确不支持：真实第三方脚本兼容；所有 formData、needle body编码/重定向/proxy细节；二进制 raw/Buffer方法；全部同步crypto与zlib；local的lyrics/pic；更新UI；未知媒体试听/时长/到期信息。basic fixture 成功不等于全协议兼容。文档歌词字段有 lryic/tlryic 拼写错误及例子 action 调错API，P 实际验证 lyric/tlyric/rlyric/lxlyric，应以源码为准。

研究阶段未加载脚本，也未触碰 src/tests/package/资源/git；官方源码快照不留在产品工作区。
