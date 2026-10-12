# Task 7 Fix 2 暂停检查点（2026-10-11）

状态：PAUSED，按用户「在最近最合适的节点暂停并留下记录，来提供下次的构建」要求停在真实 RED 和清理完成后。当前 HEAD/FIX_BASE：`63d1b3153f5b6615208f4b287dd028f37883b912`。Fix 2 尚无生产实现、GREEN、构建、安装或最终 artifact；没有启动下一轮重验证、复审或发布。未 commit/stage/push 本轮改动，主 Agent 的 README/CI/controller docs/ledgers 保持原样。

## 已完成调查与真实 RED

Fix 1 原两项 finding 已被独立复审判为 ADDRESSED；新增 Important：acceptedRequests 包含所有 IPC，正常退出等待 playback.resolve/search.run 等非持久化网络工作，而退出设置 quitting 又拒绝其 cancel IPC。主进程因此可能等待播放解析的 90 秒预算。`src/main/ipc.ts` 现有 playbackRequests（也覆盖 extensions.test）、searchRequests、previewRequests 均有 AbortController，但没有正常退出接口。exporter.shutdown 已主动 abort 非 committed 处理并等待清理；StorageRepository.close 已 drain 已接收事务，应继续保留。

调查还发现 PlaybackResolver 的 bounded 包装会在 signal abort 时先拒绝外层，底层 checkCompleteness 可能尚在 finally 清临时文件；decodedDuration 的 child error 拒绝可能早于 child close。后续实现不能只 abort/丢弃 promise，应检查真实网络、媒体子进程与临时文件清理边界。provider.resolve 的不合作来源总预算测试需保留，不应通过无界等待破坏该契约。

本轮仅添加测试草稿：

- `tests/helpers/network-shutdown.ts`：合法 LX source 返回本机实际 HTTP media URL；服务器发送真实 WAV 响应开头并保持 body pending，Electron 使用实际 fetch/reader。记录 signal abort 与 will-quit、收集测试拥有的 PID；预期正常主窗口 close 后 3 秒内 abort/退出、无拥有的进程/临时媒体残留。另有 source-test、search、decode 草稿路径；decode 用实际 FFmpeg `-re` 和受控临时清理延迟检查 close/cleanup 在 will-quit 之前。
- `tests/e2e/app-regression.spec.ts`：新增上述四种 mode 的调用。只运行了 playback mode；另三种尚未运行，helper 尚未执行本轮 typecheck，不能声称其正确或 GREEN。

命令（scoped escalation，顺序执行）：

```powershell
npm run test:e2e -- tests/e2e/app-regression.spec.ts --grep 'normal close aborts pending playback'
```

完整日志：`.superpowers/sdd/2026-10-03-music-player-implementation/task-7-fix-2-red.log`。Exit 1，1 failed，test 25.3s。失败位置 `tests/helpers/network-shutdown.ts:71`：真实 media HTTP 已进入 pending 后正常关闭主窗口，3 秒内等待 fetch-aborted：Expected true / Received false / Timeout 3000ms exceeded。没有先手工 cancel。该断言是有意义 RED；总用时含测试设置、拥有进程枚举与 RED 清理，并非成功退出用时。此轮无产品修复，也没有本轮 GREEN 结果。

## 运行资源清理与暂停状态

RED helper finally 对本轮拥有的 HTTP response 结束并 closeAllConnections，await app.close 与 server.close；外层 finally 删除其 mkdtemp network-shutdown 目录。测试命令 session `53040` 已完成 exit 1，无后台构建/安装命令。

暂停时先尝试默认 sandbox CIM 查询，因「无法从客户端中访问 CIM 资源」失败；随后用 scoped escalation 只读核验 `Get-CimInstance Win32_Process` 中 electron.exe/MusicWorkbench.exe 列表为 `[]`，`Get-ChildItem <system temp> -Directory -Filter network-shutdown-*` 为 `[]`，exit 0。没有停止或删除别人的进程/目录。Playwright 的 failed trace/error-context 保留在忽略的 test-results 内供下次诊断；测试源码与 RED 日志保留。

当前最终可安装 artifact 仍为 Fix 1 `release/MusicWorkbench-0.1.0-Setup.exe`，SHA256 `9cb17c0cddc23161fff1f54bf3888a2032792183b04c6f6aa521ffcbe8ed12fe`，证据 `task-7-fix-1-installation.json`。未改变 out/媒体/source/package-lock；未重复 2.2 GB source hash。Fix 2 不改变此前 Fix 1 验证记录的历史含义，但当前 Important 尚未修复。

## 下次最先继续

1. 确认仍从上述 HEAD 和未提交测试检查点恢复，保留控制端改动；先 typecheck 测试草稿并读取 scoped re-review 原 finding，必要时重新运行同一短 playback RED。
2. 最小退出接口主动 abort router 内 playback/source-test/search/preview controllers，拒绝新操作；继续等待已接收持久化 settings/import/index 与 committed export/独立清理。检查 resolver/completeness 实际资源清理，不能仅忽略外层 promise 或使用固定退出等待。
3. 当前 RED 修复后运行四种聚焦取消/清理模式及 Fix 1 慢 IO settings/import/late request 边界、既有 export/preview/LX 退出回归和相称 unit/integration；记录实际 GREEN，完成必要 typecheck/build。
4. 再顺序 dist:win、同一 contained 测试目录原位升级、实际安装版本轮与 Fix 1 验收、package/media 核验；新增 Fix 2 installer hash，保留 Fix 1 历史。完成报告、自审、仅本人文件提交，主 Agent 再派独立复审。暂停解除前不执行这些后续步骤。

## 控制端本地归档

实施者停止后，主 Agent 将本报告、两份审查记录、测试草稿与 RED 日志一并纳入本地暂停提交 `chore: save paused music player delivery checkpoint`。上述“未提交”是实施者交接时状态；`63d1b31` 仍是产品/FIX_BASE，恢复从最新暂停 HEAD 接续，不重置旧 HEAD。保存的草稿尚未 typecheck，只有 playback 已运行且明确 RED，另外三个模式未运行。完整 RED 日志另存本目录 `task-7-fix-2-red.log`，与原计划目录副本相同。没有启动新的产品构建、测试或远端发布。


# Task 7 Fix 2 恢复与完成（2026-10-12，Asia/Hong_Kong）

状态：DONE_WITH_CONCERNS；新增 Important 的产品修复、真实资源清理和新安装版本验收完成，交由控制端独立复审。上方 PAUSED 与旧 RED 是保留的历史，不代表当前状态。恢复基线 c8f5ba8e37c33971024829704440728a0fe738ea，原产品 FIX_BASE 63d1b3153f5b6615208f4b287dd028f37883b912；产品/测试提交为 6d36f7ec7ca00df8d4fd9fe174c8053ab48a410d，16 个本人负责文件。控制端 docs、今日平台探针和远端交付由主 Agent 管理，本轮未 stage 它们，未 push、发布或消息其他 chat。

## 根因、有效 RED 与修复

恢复后先 typecheck 保存草稿，exit 0，再重现真实 playback RED（resume-red.log）：HTTP body 确已 pending，正常主窗口 close 后 3 秒没有 fetch-aborted，exit 1。source-test/search/decode 草稿也各得到相同的真实 RED，other-red.log 三项失败。先修草稿的 decode 识别条件：只捕获 music-completeness 临时媒体的 s16le 子进程，避免把启动编码器探测误当目标解码；所有退出事件断言同时检查事件存在，杜绝 -1 误过。

主因是 router 内 playback（含 source-test）、search、preview AbortController 从未在正常关闭触发。次因是 resolver 的 abort Promise race 早于 host-owned completeness finally，而 decodedDuration 的 error/timeout 早于 FFmpeg close。router 新增同步 shutdown，封新请求并 abort 三类非持久 controller；index 先设置 quitting 并调用该接口，仍等待 acceptedRequests、exporter/tasks、LX shutdown 和 settingsWork，再 close repository，最后 app.quit。已有 import/settings/library 已接收写入与 committed export 不被一刀取消，没有固定退出延迟。

resolver 继续给不合作 provider.resolve 保留总预算 race，默认 90 秒和已有六组合约束不变；本地校验、完整媒体校验和主进程持有的 fallback SearchService 等待自身完成与清理。decodedDuration 将 error/timeout 记录为 failure，只有 child close 才 settle，随后真实 finally 删除临时目录。LXHost 封新 network/start，停止初始化与沙箱，join 本机 network promises，防止关闭期间再次注册来源。

SearchService 除信号取消外，等待默认 hostSearchFetch 的真实 fetch/body 清理；各来源用 allSettled join，防止先结束的来源让另一个 cleanup 被丢下。requestJson 的 WeakMap 只记录默认宿主 transport，显式注入的第三方 transport 保留原预算责任。单源、多源 cleanup gate 测试和真实 SearchService fallback 测试分别先 RED（已提前 settle=true），再 GREEN。300 ms 清理延迟仅是测试钩子，产品没有增加退出等待常量。

## 失败记录与相称重验

首次相关 integration 执行暴露三个真实回归：wy、kg、tx 的 hanging transport becomes an independent eight-second timeout 均超时；原因是初稿错误 join 显式注入的不合作 fetcher。限定默认 host-owned transport 后，既有三项预算测试与新增清理测试一起通过，最终 integration 67/67。

首次完整 npm test exit 1：unit 79/79、integration 67/67，通过的桌面流程 35；search.spec.ts 的 real Electron search renders each source immediately, retries failures and paginates independently 与 search includes imported local tracks and plays the local result 两项超时，并出现两个 worker teardown timeout，8 installed 项按环境条件 skip。完整失败日志 full-test.log 和两份 error-context 归档；归档日志只清理终端尾随空白，raw 原件保留原计划目录，没有把该轮记为通过。调查发现旧 native-fetch 测试 seam 将 partial/kg 返回永不结束、也不监听 AbortSignal 的 Promise；新资源 drain 因而无法结束。仅在 search.spec.ts 修正该 native transport double 为 signal abort 时 reject，原 8 秒来源、30 秒测试、重试/分页/late-response 断言未扩大或删除。显式注入的不合作 provider/fetcher 测试仍保留并通过。

随后 search 四项 GREEN（12.7 秒），最终有依据的完整 npm test 重跑 exit 0：11 unit files、79/79；7 integration files、67/67；37 桌面 E2E passed（3.6 分钟），8 actual-installed 明确 skip。最终 typecheck、build exit 0；dist:win 内 check:media/typecheck/build/NSIS 全部 exit 0。源代码提交后没有再次改产品或重建。用户后续要求减少非必要测试时，8 installed 已在运行且刚完成，因此没有重启或追加测试。

聚焦正常关闭九项和独立 LX pending-fetch 检查均 GREEN；最终全套亦覆盖。真实 built Electron 的 playback/source-test/search/decode/LX 清理均在 will-quit 前完成，拥有 PID 与临时 completeness 目录 remaining=0。Fix1 慢 settings 的 .9 被持久化且重启仍 .9，accepted import 在未入索引事务时也完成 assets=1/tracks=1，late preference 明确拒绝。已有 exporter/preview 关闭、rename/cleanup 后 committed export 保留、preview commit registration、LX 取消与外部 watchdog 等 regression 全部保留并通过。

## 新安装包与真实安装验收

新 installer：C:\Users\DELL\OneDrive\Desktop\funwork\release\MusicWorkbench-0.1.0-Setup.exe；SHA256 d125c98f96dfd1eeca94728b5d72b45010697d3fa051e0a2022fff5dbad243f5。此前 Fix1 installer SHA256 9cb17c0cddc23161fff1f54bf3888a2032792183b04c6f6aa521ffcbe8ed12fe 保留在旧 JSON，本轮未覆盖其历史证据。

只对原 contained 验收目录原位升级：C:\Users\DELL\OneDrive\Desktop\funwork\.superpowers\sdd\2026-10-03-music-player-implementation\Installed application with spaces。执行前核对绝对路径位于 workspace，且 HKCU uninstall identity f4428f25-3c04-5cb1-9206-67001552b59f 的 UninstallString 指向该目录；Start-Process -WindowStyle Hidden -Wait -PassThru 使用 /S /currentuser /D=<该目录>，installer exit 0，identity 前后不变。完整可复现脚本 install.ps1 与 install.log 已归档。安装 EXE SHA256 9ab1d0a044907d989e9ad95dee3a41960f029d0d48c4c3a8b5acf0c9ee7f57de，安装 app.asar SHA256 883ad3a8bf816632436322cd2ffeb1b4180b73bc10cf503ffe748e203284ab41，与新 win-unpacked archive 字节 hash 一致。签名状态仍为 NotSigned。

MUSIC_APP_INSTALLED_EXECUTABLE=<上述 MusicWorkbench.exe>、MUSIC_APP_VERIFICATION_PREFIX=task-7-fix-2，运行 npm run test:e2e -- tests/e2e/installed-app.spec.ts：exit 0，8/8 GREEN（42.4 秒）。实际新安装版正常关闭 playback 385 ms、source-test 123 ms、search 889 ms、decode 750 ms、LX network 900 ms；网络/worker-close/实际清理均在 will-quit 之前，所有拥有 PID remaining=0、临时媒体=0、原 WAV bytes 保留。额外慢 settings/import 验收仍通过。最后一项从 packaged EXE 完成中文/空格/emoji 导入、本地播放/seek、设置重启、FLAC 导出、shipped LX 完整 fixture 播放及 source throw/hang 下本地编辑；四次启动 290/309/303/361 ms，renderer errors=[]，6 个最终拥有进程退出。八份 Fix2 JSON 与三份不同名称截图均保留，Fix1 JSON/截图未被重写；已快速查看新安装导出截图，界面显示导出完成。

一次 actual-installed package/media 检查：node scripts/check-package.ts <InstallPath>/resources 与 node scripts/check-media-runtime.ts <InstallPath>/resources/resources，均 exit 0。1074 ASAR entries、5 app JS 与全部 extra/unpacked resources 无禁止 builder/downloader 代码；9 个媒体二进制 hash/version 校验通过，n9.0.2-22-g46d8f462ee-20261001、GPL-3.0-or-later、所需编码器/filter 存在。历史 package-content.json 原 bytes 保留，Fix2 的实际安装内容单独存 package-content JSON。没有改 package-lock、media/source 材料，也没有重复扫描 2.2 GB 对应源码。

## 清理、自审与交接

测试 helper 关闭本轮 HTTP server、owned Electron/FFmpeg 并删除 network-shutdown 临时目录。首次 full-test worker 超时留下的 music-search-ui-iKX8V0 / music-search-ui-kZbpzv 两个 2026-10-12 临时目录在绝对 TEMP 边界和日期核对后删除；2026-10-04 的旧目录不属于本轮，保留。本轮重生成但冗余的 audio-export.png 精确恢复到 HEAD；新安装 fixture/output/userData 和日志作为可复现验收材料留在原 acceptance 目录。自审与产品 staged git diff --check exit 0；新增报告/证据随后单独提交，只包含 Fix2 本人文件。

本轮安装成功后曾因执行容量中断，恢复仅补尚未完成的 installed8/package/media 与报告，没有重跑已经通过的完整 suite 或重建。沿用的交付限制：未签名；完整外部歌曲播放仍只有合法本地/HTTP LX fixture 的真实媒体证据，用户实际 LX 来源尚未提供；媒体源码重建与开发依赖 advisory 的先前披露边界未改变。今日真实平台搜索由控制端独立记录，本轮不将其误写成完整远程播放证据。没有剩余产品/安装验收失败；最终独立审查和远端发布由控制端完成。
