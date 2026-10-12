# Task 7 Fix 1：正常退出的存储边界与初始化状态（2026-10-11）

基础播放器 v0.1.0，继续 `625035c` 的已交付实现，仅修独立审查的一项 Important 和一项 Minor。控制端 docs/ledgers、README、CI、源码 bootstrap 和远端分发归主 Agent；本轮未修改它们。旧安装记录仍在 `task-7-installation.json` 与 `task-7-report.md`，旧 installer SHA256 为 `21d292947632a95096a597af7f73289571a59b3cab5a8314ceffca8110c54724`；它不再是 Fix 1 最终安装包。

## 根因与 RED

原 requestQuit 只等待 exporter/tasks，不等待已接收的 settings 或素材索引写入。真实 Electron 中先提交 volume=.2，将真实 settings.json atomic rename 延迟 1 秒；发送 .9 后等待 rename-pending，再正常关闭主窗口。有效 RED（`task-7-fix-1-red-shutdown.log`）显示进程退出后文件仍 .2，期待 .9。页面在启动立即打开时只取得一次 extensions.list，来源后来成功或 5 秒初始化超时均不会刷新；两项真实 Electron 聚焦断言 RED。

原首版关闭测试使用 isVisible 找窗口，在尚未显示时没有正常关闭，产生退出等待超限；更正为主 renderer URL 选择并先操作可见设置页后得到上述有效 .2/.9 RED。原首版 unit RED 在缺失 close 方法时清理过早导致 ENOENT 噪声；已将 close 调用置于 try，finally 释放和 await 所有已启动事务，`task-7-fix-1-red-unit-clean.log` 仅剩 `repository.close is not a function`。这些探针错误不是产品失败证据，原日志保留。

## 最小修复与关闭顺序

主进程 requestQuit 同步设置 quitting，拒绝新的 music:request/drop 请求；等待已接收 IPC routes 与原有 exporter/tasks shutdown。之所以等待 route，是已接收的导入可能仍在 stat/hash 等 IO，尚未进入共享 settings 写入队列。随后 StorageRepository.close 同步封锁 write/update，等待各 module 最后一个排队事务，最后 app.quit。没有固定退出延迟或增大 timeout。close 可重复调用，失败写入汇总报错；各 module 原有串行/原子写入与 corrupt/newer 拒绝覆盖保留。

设置页仅在保存偏好要求启用、实际尚未运行且无兼容错误的来源仍初始化时，用不重叠的递归 250 ms 刷新实际状态；成功或失败后停止。刷新总窗口受来源数量与每源 5 秒 watchdog 限制，unmount 清 timer 并屏蔽晚响应；不刷新用户正在编辑的偏好，不保存设置来触发状态更新。

## GREEN 与必要回归

- `npm run test:unit -- tests/unit/storage.test.ts tests/unit/settings.test.ts`：19/19 GREEN（随后补关闭失败保护测试）。最终 `npm run test:unit`：11 files，77/77 GREEN；包括封锁新写入、两个 module 和同一共享队列已接收事务 drain、失败事务/损坏原数据保护、既有 settings/index 并发与迁移测试。日志 `task-7-fix-1-unit-final.log`。
- `npm run typecheck`、`npm run build` exit 0。
- `npm run test:e2e -- tests/e2e/app-regression.spec.ts tests/e2e/audio-export-lifecycle.spec.ts tests/e2e/lx-lifecycle.spec.ts --grep 'normal main-window|already open|settings persist|remembered|closing actual|closing the actual'`：9/9 GREEN（58.2s），保留原 exporter/preview/LX 退出流程。慢 IO 时间线 rename-pending → rename-committed（约 1 秒）→ will-quit，磁盘 .9 且真实重启读到 .9；设置页不导航/不保存即显示来源成功与初始化超时。日志 `task-7-fix-1-e2e.log`。
- 额外 `app-regression.spec.ts --grep 'close completes'`：1/1 GREEN。用可释放 gate 持有真实导入 stat，确认已接收导入尚未入存储队列时关闭仍不退出；关闭后 volume=.8 请求被明确拒绝，释放 IO 后 settings/assets=1、library/tracks=1、关联 asset ID 一致、volume=.2 保留、原 WAV bytes 不变。日志 `task-7-fix-1-import-close.log`。测试钩子只在 tests/helpers 与 Electron 测试求值中，无生产测试代码。
- `npm exec -- vitest run tests/integration/library.test.ts tests/integration/audio-export.test.ts tests/integration/audio-export-lifecycle.test.ts`：3 files、29/29 GREEN（31.68s），覆盖相关共享存储和导出事务。未重复不相关完整 66 集成/28 常规 E2E。所有测试、构建、安装顺序执行。

## Fix 1 最终安装交付

`ELECTRON_BUILDER_CACHE` 指向工作区绝对 `.superpowers/sdd/builder-cache`，`npm run dist:win` exit 0；内含最终 check:media、typecheck、build 和 NSIS packaging。日志 `task-7-fix-1-dist.log`。同一带空格测试目录经绝对路径边界与已有卸载身份检查后原位升级，installer exit 0，卸载 identity 保持 `f4428f25-3c04-5cb1-9206-67001552b59f`，未操作工作区外安装。

最终 `release/MusicWorkbench-0.1.0-Setup.exe` SHA256：`9cb17c0cddc23161fff1f54bf3888a2032792183b04c6f6aa521ffcbe8ed12fe`；安装后 `MusicWorkbench.exe` SHA256：`a8fb4a060ab18b0c5c30719ba9422367d248e9dc96ac914b13202ac552e91106`；签名状态 `NotSigned`。新旧 hash 和升级身份见 `task-7-fix-1-installation.json`。旧 `task-7-installation.json` 保留原交付历史，不代表当前最终 artifact。

`MUSIC_APP_INSTALLED_EXECUTABLE=<上述测试目录>/MusicWorkbench.exe npm run test:e2e -- tests/e2e/installed-app.spec.ts`：3/3 GREEN（19.8s），日志 `task-7-fix-1-installed.log`。包括原完整安装验收、真实 pending preference 正常关闭/重启、accepted pending import 正常关闭与 late request 拒绝。偏好证据 `task-7-fix-1-installed-shutdown.json`：rename-pending 1791729158679 → rename-committed 1791729159683 → will-quit 1791729159693，requested/persisted/restart volume 全为 .9。导入证据 `task-7-fix-1-installed-import.json`：assets=1、tracks=1，关闭后请求明确拒绝，原 WAV bytes 保留。

原安装验收 `task-7-installed-acceptance.json` 与三个 `task-7-installed-*.png` 更新为此次最终安装包结果：主窗口启动 270/287/274/294 ms；完整本地播放/seek/设置重启/FLAC 导出/LX fixture sandbox、初始化 throw/hang 下本地播放和编辑均 GREEN；启用偏好保持、实际失败状态准确；6 个拥有的进程退出后 remaining=0、renderer errors=[]。这仍是合法 fixture 的 shipped LX 验收，非真实用户脚本外部完整歌曲证据。

实际安装资源依次执行 `node scripts/check-package.ts <install>/resources` 与 `node scripts/check-media-runtime.ts <install>/resources/resources`，均 exit 0：1074 ASAR entries、5 app JS 及全部解包/extraResources 无被禁止的 builder/downloader 运行时代码；9 个媒体二进制校验通过，版本 `n9.0.2-22-g46d8f462ee-20261001`、GPL-3.0-or-later、必要编码器/filter 存在。日志 `task-7-fix-1-package.log`。

自审确认先封 IPC 接收边界、等待已接收异步生产者、再封 repository 队列并 drain，timer 清理与草稿独立；`git diff --check` 对本轮文件 exit 0。本轮未改变媒体资源、source 材料或 package-lock，不重复 2.2 GB 对应源码核验；此前 262 文件核验与 DELIVERY-STATUS 的 build-helper lock、实际链接闭包及非 bit-identical 重建限制继续成立。未签名、真实用户 LX 尚未配置，以及开发依赖 advisory 未随包的已披露边界不变。

结果：DONE_WITH_CONCERNS（仅沿用上述交付限制，两个独立审查 finding 已完成修复与实际回归）。本轮精确验证：unit 77/77，相关 integration 29/29，聚焦真实 Electron E2E 10/10（9+1），实际安装 E2E 3/3；最终 typecheck/build/dist 与实际 package/media 均 exit 0。产品/测试/证据提交：`35fe044ccb8469a5dcb593c22734f8558b52c5b2`（13 files，`fix: drain accepted storage writes before player exit`）；暂存 diff --check exit 0。主 Agent 的控制端未提交文件保留原样，本轮未 push/merge。
