# Task 7 实施记录（2026-10-06，Asia/Hong_Kong）

BASE `bce69a429eebef83ef62f63c1d053e7885c5a627`；分支 `codex/music-player`。继续已审查 Task 1–6，不修改控制端 progress/ledger/review。

## RED / GREEN

- `npm run test:unit -- tests/unit/settings.test.ts`：沙箱初次 spawn EPERM；同命令 require_escalated 后有效 RED，Cannot find module settings-service。
- `npm run test:e2e -- tests/e2e/app-regression.spec.ts`：同类沙箱限制；require_escalated 后真实 Electron 因不存在“应用设置”入口超时，1 failed。
- 核心 GREEN：同 unit 命令，8/8 passed（迁移、损坏/新版本保护、偏好重启、模块能力门控、contract-major 拒绝）。迁移首次实现发现 EffectConfigSchema 的 positive 参数不接受 legacy version 0；迁移入口改为专用 nonnegative 校验后通过。
- `npm run typecheck` exit 0；`npm run build` exit 0；上述真实 Electron regression GREEN，1/1 passed（2.5 秒）；设置音量 .35 重启保留，导入/播放/本地编辑可用，源文件字节不变。

## 接口与必要集成

- SettingsService.read/update、shared AppSettingsSchema/SettingsPatchSchema；schemaVersion=1，旧 preferences v0 迁移明确的 EQ gains/preamp、reverb wetPercent/decay。无效/新版本内容拒绝覆盖。
- settings.json 仍有 AssetRegistry 索引，preferences 是新增字段；StorageRepository.update 在同一 module 队列内读/验证/改/原子写，AssetRegistry 全部修改改用该边界。不会缓存旧全量文件。
- modules.list 通过具体 sender 校验 IPC/preload；AppModuleRegistry.list/resolve 同时能力门控。当前本地音频编辑能力可用，预留视觉创作 route 等其实现能力就绪；不要求 Gemini 才启用本地编辑。
- 记忆音源偏好与 LX 实际初始化分别记录/展示；启动失败保留 enabledSources 偏好，LX manifest.enabled 仍 false 且 concrete compatibilityError 展示。

## 待完成

完整基础回归、实际 dist:win、安装版验收/资源检查、sources 复制核验、最终 audit、自审与提交。

## 完整基础回归与审计（进行中）

- `npm run typecheck`、`npm run build` exit 0；Zod explanatory PURE comment 已在特定上游源注释 transform 修正，实际 PURE 调用注释保留；Playwright worker 已设 FORCE_COLOR，移除继承 NO_COLOR 冲突。没有过滤应用日志。
- `npm run test:unit`：11 files、72/72 passed；`npm run test:integration`：7 files、66/66 passed，41.07 秒。分别运行，避免原脚本重复 integration。日志 task-7-unit.log/task-7-integration.log 保留于计划 workspace。
- 设置追加实际双文件并发导入测试：索引 2 条与 volume .21/rate 1.4 都保留；来源注册 mock 仅存在测试模块，经 registry 排序/禁用；诊断白名单 RED→GREEN，包含 disabled/timeout/size 与秘密拒绝。
- `npm audit --omit=dev --json` exit 0，0 vulnerabilities；`npm audit --json` exit 1，1 high=http-cache-semantics（原始 JSON 提示 fixAvailable:true，官方 GHSA 仍 Patched=None；未 blind override），raw JSON 已保存在 checkpoint。实际 ASAR 暴露待核验。
- 安装前 HKCU/HKLM uninstall 注册表筛选未发现音乐工作台/MusicWorkbench/music-workbench，工作区测试安装路径尚不存在；builder 工具三档案 SHA256 都与研究值一致。

## 回归纠正与自审

- 完整 `npm run test:e2e` 首轮 25 passed / 1 failed / 1 skipped（3.0m）：唯一失败 boot.spec 固定 API 清单没有新增 modules。确认实际桥接仅新增具名 modules.list 后更新清单；build 后 boot+app-regression 2/2 GREEN。最终完整绿色 e2e 待记录。
- 自动保存音量/速度/音效立即进入 IPC 原子事务；不会因关闭前 debounce 丢失，且仅 sourceOrder/enabledSources patch 才重新同步来源，普通音效操作不重启失败来源。追加实际 EQ 1000 Hz=3 与 rate=1.5 重启覆盖，已通过。
- 自审发现 settings.effects=[] 能持久化但 EffectsPanel 依赖基础两个具名配置，追加 invalid effect layout 测试先 RED（promise resolved），然后 schema 校验固定 eq-10/reverb 布局 GREEN。最终 unit 全量 73/73 passed。来源数组上限容纳 20 脚本加内置来源。
- dist 首次使用 Node 不支持的 experimental-default-type CLI 标志失败（bad option），检查脚本改成 CommonJS async main，保留原 .ts 路径，无 warning suppression；真实 dist 重试正在 NSIS 编译。

## 2026-10-11 恢复：安装版启动失败根因与修复

恢复范围为基础播放器 v0.1.0；不实施音频/视觉后续创作计划，不接管控制端 ledgers、CI 或远端交付。原 Task 7 未提交实现保留，在其上完成安装验收。

原 `task-7-installed.log` 是失败验收：脚本抛错后重启没有主窗口，不能记为通过。实际测试安装 EXE 的生命周期诊断（`task-7-startup-diagnostic.json`）显示约 304 ms 发出 window-all-closed / before-quit / will-quit / quit，313 ms 才创建主窗口，323 ms 主窗口立即关闭，750 ms 进程 exit 0。根因是启动先 await applySettings，LX 初始化失败销毁唯一隐藏窗口，window-all-closed 触发应用退出，随后 continuation 创建主窗口已太迟。

新增两个真实 Electron 回归：已记忆音源分别立即抛错、无限循环，要求主窗口在 3 秒等待范围内就绪且本地播放/编辑可用，最终保存启用偏好、展示实际失败状态。旧构建 2/2 RED，均超时等不到主窗口。最小修复先建立主窗口，再后台 applySettings；关闭过程中不会继续启动后续来源。GREEN app-regression 3/3，包括原设置重启回归。无限循环仍由原 5 秒外部 watchdog 终止，不延长来源或窗口等待时间。

自审发现原 Task 7 的音源导航 className 条件错误插入 JSX 对象，已改为仅按 sources 视图设置 selected。安装验收等待来源实际状态独立于主窗口就绪，补充抛错/死循环安装版启动、本地播放/编辑、每次启动时间、完整子进程树退出证据，失败 launch 也能清理。

## 恢复时验证与失败记录

- 接管时主 Agent 已完成 typecheck exit 0、unit 75/75、integration 66/66；默认沙箱 Vite realpath EPERM 是环境限制，同命令 scoped require_escalated 可执行。
- 本次修复后 unit 75/75 passed；日志 `task-7-unit-resumption.log`。
- 首轮错误地让 integration / E2E 与 dist:win、2.2 GB 源码 hash 同时运行，造成共享生成目录和本机 CPU/IO 争用。该轮 integration 60/66 passed，失败为 audio-export-lifecycle 的 file symlink replacement、file alias rename failure、effect-chain offline Web Audio、resolver 的 expiry refresh 两例与 declared FLAC/Hi-Res 一例；其中 5 项计时超限，一项总预算内只完成 1 次解析（期待 2 次）。保留 `task-7-integration-resumption.log`。该轮 E2E 27 passed / 1 failed / 1 skipped，唯一失败为 settings persist across actual Electron restart 的 30 秒超限；保留 `task-7-e2e-resumption.log`。重建会替换正在读的 out 目录；无法把这轮混跑作为可靠产品验收。后续停止重任务后按顺序验证，未提高测试超时。
- `dist:win` 使用绝对 `ELECTRON_BUILDER_CACHE=<workspace>/.superpowers/sdd/builder-cache`，包含媒体 hash/编码器/滤镜核验、typecheck、build。第一次恢复构建及工作区测试目录升级成功，最终自审小修正后再生成最终 installer。
- `release/sources/verify-sources.ps1` 本次确认 262 个 hash 文件均通过；sources 未修改，原 DELIVERY-STATUS 的 cargo update cc build-helper lock 与未确认实际链接源码闭包限制继续保留。263 个目录文件总 2,263,171,435 bytes 包含 checksum 清单自身，与 262 被核验源文件计数不同。
- 2026-10-11 npm production audit 0；development audit 9（1 high、8 moderate）。新增中危链为 sprintf-js → roarr → global-agent → @electron/get → builder；[官方 sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 及 [http-cache-semantics advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 均显示 Patched versions None。未采用未经真实下载/缓存/hash/打包验证的 builder 降级。原始 JSON 已更新，包检查禁用名称已扩展至三个新增依赖，以实际 ASAR/JS/extraResources 检查证明未随应用提供。

最终顺序验证与实际安装 hash/截图/启动数据记录如下。

## 最终安装与包证据（2026-10-11）

- `npm run dist:win` exit 0（`task-7-dist-final.log`），内含 `npm run check:media`、`npm run typecheck`、`npm run build` 均 exit 0，NSIS installer 与 blockmap 生成。默认 Electron icon 和 duplicate dependency references 是 builder 提示；没有隐藏应用日志。
- Installer：`release/MusicWorkbench-0.1.0-Setup.exe`；SHA256 `21d292947632a95096a597af7f73289571a59b3cab5a8314ceffca8110c54724`。实际 Authenticode 状态 `NotSigned`，builder 的 signing 字样不表示已签名。
- 只升级已有工作区测试目录 `.superpowers/sdd/2026-10-03-music-player-implementation/Installed application with spaces`，先校验绝对路径位于计划目录、已有 uninstall identity 对应该路径；`Start-Process -WindowStyle Hidden -Wait`，installer exit 0。未卸载或更改其他安装/用户数据。实际 installed executable SHA256 `f01a8751ace81cc2d1c7068966a9683efd4b11f6b0775747069f50613a793664`；身份/注册表证据 `task-7-installation.json`。
- `$env:MUSIC_APP_INSTALLED_EXECUTABLE=<test-install>/MusicWorkbench.exe; npm run test:e2e -- tests/e2e/installed-app.spec.ts`：1/1 passed（14.9s）。`process.execPath` 为实际安装 EXE、`app.isPackaged=true`、`appPath=resources/app.asar`。导入中文/空格/emoji WAV，实际播放并 seek 至 5s；保存 volume=.4/rate=1.25/FLAC，重启值保留；2..10s 区段以 1.25 倍保存真实 FLAC，原 WAV bytes 不变。完整结果 `task-7-installed-acceptance.json`。
- 安装版 LX 测试实际启动随包 `preload/lx.js` + sandbox runtime，通过本机 HTTP fixture 20s 完整媒体检查与播放；重启启用偏好恢复实际 runtime。没有把 fixture 当作真实用户歌曲/第三方完整音源验收。抛错与无限循环各重启一次，均保留启用偏好并显示 runtime=false + 具体初始化失败/5秒超时；本地播放和编辑可用。4 次主窗口就绪耗时 924/291/282/315 ms。
- 正常启用 LX 时关闭实际主窗口，关闭前记录整个进程树 6 个 PID；退出后 remainingProcessCount=0，主页面 errors=[]。证据不只检查已知 renderer PID。
- `node scripts/check-package.ts <test-install>/resources`：1074 ASAR entries / 5 app JS；实际 ASAR、JS 引用、全部 extra/unpacked resources 无 builder/download-cache/http-cache-semantics/sprintf-js/roarr/global-agent 等开发代码。`node scripts/check-media-runtime.ts <test-install>/resources/resources`：9 个固定媒体 exe/DLL hash 及版本、所需 equalizer/afir/atempo/afade/atrim 与 MP3/FLAC/24bit WAV 编码器全部匹配。日志 `task-7-package-final.log`、清单 `task-7-package-content.json`。
- 顺序 `npm run test:integration`：7 files、66/66 passed（32.83s），先前混跑 6 项失败均消失，无测试/超时改动；`task-7-integration-final.log`。
- 三张最终安装截图已目视检查：`../screenshots/task-7-installed-lx.png`、`../screenshots/task-7-installed-export.png`、`../screenshots/task-7-installed-source-failure.png`，显示完整播放 fixture、导出完成与偏好勾选但实际运行失败状态。设置页可读，无遮挡验收字段。

残留限制：未签名；未配置真实用户 LX 完整音源，实时搜索由主 Agent 另外记录；开发工具仍有上述 9 条 advisory 且已验证不随包；媒体对应源码交付有已披露 build-helper lock / 实际链接闭包限制，不承诺字节一致重建。AI/audio/visual 后续计划均不在本版交付。

## 完成结果与交接

状态 `DONE_WITH_CONCERNS`：上述交付限制已明确披露，基础 Task 7 必需工作完成。最后顺序 `npm run test:e2e` exit 0，28 passed / 1 skipped（3.0m）；跳过项是需要显式安装 EXE 环境变量的 installed-app，已另跑 1/1 GREEN。日志 `task-7-e2e-final.log`。最终统计：unit 75/75、integration 66/66、常规 E2E 28 passed / 1 installed-only skipped、实际安装 E2E 1/1；dist:win 包含 typecheck/build/media check 全部 exit 0。

自审覆盖设置与素材共享事务、跨边界 schema、模块 capability 门控、偏好/实际运行状态、startup/shutdown 顺序、安装路径和资源布局、许可文本与真实/fixture 证据边界；新发现的实际启动退出与导航 className 缺陷已修复。`git diff --cached --check` 只有生成的 APP-DEPENDENCIES.txt 末尾空行提示，无代码空白错误；许可文本保留原生成内容。诊断 scratch 脚本已删除，测试无未完成 tmp 输出；有用 fixtures、安装目录及验收证据保留。控制端 docs、progress/ledgers、GitHub/CI/source bootstrap 与已有媒体二进制均未纳入本任务提交。独立审查及最终私有仓库交付由主 Agent 接手。

实现、测试、许可及完整验收证据提交：`fa139cc90c908fc0c81a9e54475bdf94f36bbfc1`（`build: deliver validated Windows music player`，48 files）。本条提交编号记录属于随后单独的报告归档提交，避免报告内容自引用其自身 SHA；没有额外产品改动。报告完整副本位于 `.superpowers/sdd/2026-10-03-music-player-implementation/task-7-report.md`。
