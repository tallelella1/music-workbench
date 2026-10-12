# Task 6 — 非破坏性裁剪与音效导出

状态：DONE_WITH_CONCERNS。产品功能与自动验收完成；人工听感仍为 pending，未声称实际听过。需求来源为 task-6-brief.md / task-6-context.md / constraints.md；产品 BASE 为 7b666f8a3f98cdbce78b3383b6a84868101e255f，控制端中途仅提交其进度文档 bbbb570。

## 实现

- `AudioEdit`、编码选项、编码器能力、导出结果、派生 `sourceTimeMap`、IPC 请求与导出 job 结果均有运行时 strict schema。MP3 只允许 128/320 kbps + null 位深；FLAC 16/24 bit；WAV 16/24/32 bit，后两者码率为 null。未知字段、效果、版本、参数、重复效果、非法区间和超出成品区间的淡入淡出拒绝；允许合法淡入与淡出重叠。
- `AssetRegistry.checkedSnapshot` 在主进程将实际读取的同一批字节写入受控文件，同时计算 SHA-256 和 byteLength；不匹配请求 hash 就拒绝。FFmpeg 后续只打开该快照。测试在快照创建后修改原路径，快照字节仍等于原始内容；下次导出拒绝已变更文件。原文件 realpath 独立保留，用于目的路径保护；同路径和硬链接均拒绝。
- 链路顺序为源时间裁剪 → 时间映射 → EQ / 同源 IR 混响 → 成品时间淡入淡出 → 编码。保持音高使用 `atempo`，否则 `asetrate` / `aresample`。1× 绕过 atempo，避免其尾部裁切。前后使用 apad / end_sample 实现实际帧数，不仅返回数学时长。单声道转立体声使用 unity upmix，匹配 Web Audio。
- EQ 使用同一 10 频点、Q=1、参数版本与 Nyquist 限制。混响逐项使用 `createImpulseResponse`，`afir` 显式关闭自动增益和 IR 归一化，干湿路径分别乘 `1-wet` 和 `wet`，amix 不做归一化。
- `sourceTimeMap` 随派生素材落盘，并随保存 job 结果返回；输出秒 t 对应 `startSeconds + t * rate`。实际成品时长为 `round((end-start)/rate * sampleRate)/sampleRate`。预览固定 WAV 32 bit 编码一次，原生 audio 以 1× 播放已处理成品，不经过主播放器实时音效。
- 只有 AssetRegistry 中的本地/派生音频可进入导出。在线完整播放资源仍在 MediaResourceRegistry，`assetId=null`，没有登记为可编辑素材；伪装的播放 resource ID 不能导出。未更改 `offlineEditable=false` 声明。
- FFmpeg / ffprobe 使用 resources/bin 的固定 exe 与既有 DLL；没有 PATH 查找。启动探测实际编码器/滤镜，UI 位深列表来自能力结果。参数由内置编码器映射生成，参数数组冻结且由 WeakSet 验证来源；shell=false。伪造 FfmpegJob 被拒绝。进度来自 `-progress pipe:1`。
- 成品先写目标目录 `.audio-<uuid>.tmp`，成功 probe 并验证时长后 rename。取消 FFmpeg 时先 kill，并等待 close，随后清理本次输出/IR/快照；不删除用户 source。失败结果不暴露 FFmpeg stderr 或缺失运行时的绝对路径，快照/预览目录分配错误也转换为安全消息。
- Electron 宿主保存对话框由主进程持有路径；renderer 只见 opaque IDs 与 DTO。具名 export.capabilities/start/preview/cancelPreview/get 沿用 sender/frame/URL 校验和自包含沙箱 preload。
- 编辑器提供源区间、速度/保持音高、成品秒淡入淡出、格式/位深/码率、精确预览、保存、任务进度与取消。打开时暂停原曲，编辑期间也暂停迟到的 play；开始预览再次暂停原曲，预览变更/关闭时显式 pause/remove src/load。

## RED / GREEN 证据

1. 初始 RED（17:54）：

   `npm run test:unit -- tests/unit/filter-builder.test.ts`

   输出 `2 failed (2)`，分别为 `export filter builder is missing: expected null not to be null`、`export schemas are missing: expected null not to be null`。

   `npm exec vitest -- run tests/integration/audio-export.test.ts`

   输出 `1 failed (1)`，`audio exporter is missing: expected null not to be null`。这是至少 60 秒、44.1 kHz WAV 的 10..30 秒 / 2× / 原字节不变 case。

   默认沙箱首次执行上述 unit 与计划原样 `npm run test:integration -- tests/integration/audio-export.test.ts` 时，Vite realpath 被 EPERM 阻止，0 tests；不计入有效 RED。后续使用 require_escalated。原 integration 脚本自带 `tests/integration` 会扩大到旧全部 integration，因此迭代用 npm exec vitest 精确选文件。

2. 初始 GREEN（17:56）：上述 unit 为 `2 passed (2)`；focused integration 为 `1 passed (1)`，实际 10 秒 WAV 预览与原字节验证通过。

3. 实际媒体细化：扩展 WAV/编码器/取消/快照矩阵后，发现 1× atempo 会裁掉末尾并补静音，淡出断言出现 `expected 0 to be less than 0`（18:00）。保留此断言，修复为 1× 不经过 atempo 后 GREEN；其他 rate 则继续明确 trim/pad 目标帧数。

4. UI RED（18:00）：

   `npm run test:e2e -- tests/e2e/audio-editor.spec.ts`

   `1 failed`，等待 `编辑当前歌曲` 按钮超时；生产 UI 当时尚无入口。实现并构建后同命令 `1 passed`，真实生成预览/播放/保存完成。

5. 运行时边界 RED（18:11）：新增 missing-runtime case，同 unit 命令 `1 failed | 2 passed`；实际收到 `spawn ...missing-private-runtime...ffmpeg.exe ENOENT`，而非安全消息。capabilities catch 统一处理后最终 unit GREEN（见下一节）。

6. 控制端指出双重发声，真实 UI 补充 RED（18:13）：

   `npm run test:e2e -- tests/e2e/audio-editor.spec.ts --grep "real Electron editor"`

   `1 failed`，精确预览播放时底层找不到 `播放` 按钮，仍显示暂停。根因为打开编辑器时首次 load 尚未结束，controller 稍后自动 play。App 订阅状态并在编辑期间暂停迟到 play；预览卸载显式停止。之后同流程 GREEN，并验证原曲进度 200 ms 不动、关闭后捕获的 audio.paused=true。

7. 自审目录错误 RED（18:15）：

   `npm exec vitest -- run tests/integration/audio-export.test.ts --testNamePattern "real WAV frames" --reporter=verbose`

   `1 failed | 1 skipped`，快照目录被普通文件占用时收到含主机路径的 `EEXIST ... mkdir`。修复受控快照与派生目录错误消息后完整 focused export GREEN（18:17）：`2 passed (2)`，34.37 s。

## 最终验证

- `npm run typecheck`：exit 0，最后在全部测试辅助代码变更后再次执行。
- `npm run build`：exit 0，最后产物含全部产品修复。Rollup 对已有 Zod 依赖注释发出 annotation warning；构建成功，不是无 warning 输出。
- `npm run test:unit -- tests/unit/filter-builder.test.ts tests/unit/contracts.test.ts tests/unit/storage.test.ts`：3 files / 23 tests passed（18:13，371 ms），包含效果/参数校验、IPC sender 与结果契约、存储回归。
- `npm exec vitest -- run tests/integration/audio-export.test.ts tests/integration/library.test.ts tests/integration/media-protocol.test.ts tests/integration/effect-chain.test.ts --reporter=verbose`：4 files / 14 tests passed（18:09，43.51 s），覆盖实际素材导入/重启、Range/原文件变化、实时效果。
- 自审错误消息修改后 `npm exec vitest -- run tests/integration/audio-export.test.ts --reporter=verbose`：1 file / 2 tests passed（18:17，34.37 s），包含完整真实导出矩阵、安全目录错误、源文件丢失与未注册 worker 拒绝。
- `npm run test:e2e -- tests/e2e/audio-editor.spec.ts tests/e2e/playback.spec.ts tests/e2e/boot.spec.ts tests/e2e/dev.spec.ts`：6 tests passed（18:13，31.5 s），覆盖修复后的预览互斥、关闭停止、真实保存、生产 bridge/contextIsolation/sandbox、安全 CSP 与 dev nonce、播放器原队列/音效/速度。
- 后续只增加测试辅助的 10 频点 Hann 频谱测量；`npm run test:e2e -- tests/e2e/audio-editor.spec.ts`：2 tests passed，最终生产编辑流程/频谱/脉冲实际验证。
- 按任务授权仅跑 focused 与受影响回归，没有重复整个搜索/LX 旧基线。

## 实际媒体与容差

- 60 秒、44100 Hz 单声道 PCM WAV；10..30 秒选区，0.5 / 1 / 2× 输出分别 40 / 20 / 10 秒。实际解码为立体声并核对 1764000 / 882000 / 441000 帧。WAV 按 1/44100 秒容差，实测整数区间时长完全相等。0.5/2× 保持音高开与关都验证实际帧数。
- 1000 Hz 源的输出零交叉计数容差 <3 Hz；保持音高仍为 1000 Hz，否则分别为 500 / 2000 Hz。首尾采样施加 1 秒淡入/淡出后低于未处理采样的 1/100。
- +6 dB、1000 Hz EQ 的实测 RMS 比值 `1.9952623158097127`，与理论 `10^(6/20)` 一致；混响改变实际采样。
- WAV 16/24/32、FLAC 16/24、MP3 128/320 共 7 个保存组合均成功并重新 probe/decode。位深按 actual bits 检查，MP3 actual bitrate 为请求值；时长容差 MP3 0.1 秒，其余 1 个采样。全部解码声音存在（采样峰值 >0.01），原始字节最终完全相同。
- 全部 7 组合也使用超过 260 字符的目录和中文/空格/emoji 文件名；真实 Windows/FFmpeg 成功，测试 finally 清理。
- 相同 4 个音色预设及 wet50：真实 Web Audio body/tail 与 FFmpeg 解码进行比对；允许 RMS 相对误差 1%、20 个代表采样最大误差 1e-4。实际 RMS 相对误差 <0.003%，最大采样误差 `1.516193151473999e-5`。源 PCM16 量化与实时 Float32 测试信号的差别包含在此容差内。
- 2048 点 Hann 窗，以 31/62/125/250/500/1000/2000/4000/8000/16000 Hz 做实际 DFT 幅值比较；允许最大幅值误差 1e-5。实测最大值：原声 9.7714e-7、温暖 1.5691e-6、人声 9.7905e-7、明亮 8.1116e-7、wet50 4.7772e-7。
- 另用真实 mono 0.5 impulse、wet=1 / decay=0.1 / seed=42，在 0.3 秒对齐后比对两声道 4410 个卷积采样。允许 1e-7；实测最大误差分别 `2.3283064365386963e-9` / `2.7939677238464355e-9`。证明 IR 干湿/归一化不仅参数名相同，实际输出也匹配。
- 人工听感：pending；自动播放、波形/采样、频谱、编码与时长测量不能冒充个人听感裁定。

## 文件、自审与清理

新增：src/shared/audio-export.ts；src/main/export/audio-export-service.ts、ffmpeg-worker.ts、filter-builder.ts；src/renderer/features/editor/AudioEditor.tsx；tests/unit/filter-builder.test.ts；tests/integration/audio-export.test.ts；tests/e2e/audio-editor.spec.ts。

修改：src/main/assets/asset-registry.ts（受控快照与派生登记）；src/shared/contracts.ts / schemas.ts / effect-registry.ts；src/main/index.ts / ipc.ts；src/preload/index.ts；src/renderer/App.tsx / styles.css；tests/helpers/audio-browser.ts（仅测试中的实际 Web Audio 参考、频谱和脉冲测量）。

证据：docs/verification/screenshots/audio-export.png，实际 UI 截图；本报告同步至 .superpowers/sdd/2026-10-03-music-player-implementation/task-6-report.md。其他控制端文档不暂存。

自审已通读新增模块与既有接口 diff，并核对需求逐项。发现并修复 1× atempo 尾部、单声道 upmix parity、运行时/目录错误路径、异步 load 迟到播放和关闭预览停止。派生登记同时写 parent/sourceTimeMap，避免中间未完整记录；原有普通素材不要求新增 optional metadata。`git diff --check` 无 whitespace 错误，只有 Git 自动 CRLF 提示。

所有测试媒体、长路径目录、mock 保存成品、快照与 IR 均在各测试 finally 删除；取消后还独立断言本次 `.audio-*` 和 snapshot-* 消失。失败 trace 在最终绿色 Playwright run 时被替换；仅清理本次 test-results/.last-run.json，保留最终截图/报告与构建产物。

限制：预览作为正式派生素材保留在用户资料中，以供后续精确/创作消费；该任务没有新增素材垃圾回收 UI。输出为 stereo；不为转码贴 Hi-Res 标签。当前没有 LX/Gemini 配置不阻塞这次本地媒体、真实 FFmpeg 或 Electron 验收。

## Fix round 1 — 生命周期边界修复（2026-10-05）

代码修复与本轮自动验证完成；**independent re-review pending**，由控制端派发独立复审。本段补充初始报告，不替换原有 23 单元 / 14 集成 / 6 Electron、编码矩阵和 parity 证据。人工听感继续 **pending**。

修复输入为 `docs/verification/checkpoint/task-6-review.md` 的四项 Important。FIX_BASE：`d65e5c1a94dd9a2f5f4dc35550393f9671bb3b63`；开始本轮时 HEAD：`1fc803efbe1bcba4318f63f62997a18d7bdc3f0f`，期间 `6263d1d` / `1fc803e` 只含控制端文档。本轮没有派子 Agent、没有开始 Task 7、没有 push。

### 四项 finding 的处理

1. **退出 abort/drain**：`AudioExportService` 从源快照预校验、保存对话框、排队任务到预览登记均跟踪操作。shutdown 同步拒绝新 start/preview/capabilities，取消尚未进入提交的处理，等待实际 worker close 与全部清理；已提交操作继续完成登记/结果。主窗口 `close` 和 `before-quit` 均 preventDefault，通过同一退出过程等待 exporter 与 TaskService drain 后才允许 `app.quit()`。等待中的保存对话框不会阻塞 drain。运行时能力探测也立即 abort 并等待两项 probe close。原 LX shutdown 行为沿用。

   `media-probe.ts` 增加内部 `executeMediaRuntime`：Node execFile 的 AbortError 可能早于 child close，故 probe/decode/capability callers 显式等待 close 后才结束。这是退出顺序所需的窄改动；仍固定 resources/bin 的 ffmpeg.exe/ffprobe.exe、参数数组、无 PATH/renderer 通用命令。处理用 spawn 的既有 kill→close 顺序保留。

2. **不可取消提交边界**：最后一次源保护检查后，同步调用内部 `TaskContext.beginCommit()` 与 operation committed 标志，再开始 `rename`，中间没有 await。此后 jobs.cancel 经 IPC 拒绝并返回 `成品正在保存，已无法取消`；编辑器捕获并显示该消息。rename/cleanup 窗口内取消或 shutdown 均保留最终 completed、media 和 sourceTimeMap。不会事后删除用户 destination 来伪装取消；已存在成品只有用户批准的 rename 会替换。rename 本身失败则返回安全 failed，旧目标字节保持不变。预览提交后晚到的 cancel 同样不打断登记。

3. **目的互斥**：保存路径以实际父目录 realpath（含 Windows junction）、basename、已有文件 realpath 和 Windows 大小写归一化建立在途预留。冲突在任务启动前明确拒绝：`此目的文件正在处理中，请选择其他文件或等待当前导出结束`。锁一直持有到 work 和 cleanup 完成，排队取消即使没有调用 work 也通过 TaskService.wait 释放。成功、失败、取消、清理故障均验证后续可重新导出。关闭编辑器继续后台导出仍允许；实际 UI 重开并选择同一目标时显示冲突，第一任务仍 running，未被替换。

4. **独立清理与安全消息**：输出 temp、IR、快照 release 各自执行并用 Promise.allSettled 收集，失败不会跳过其余。实际保存成功而清理失败仍 completed；strict 导出结果允许可选 literal `cleanupWarning: '成品已保存，但临时资源清理失败'`，IPC 验证后由 UI 显示。预览清理失败返回安全消息；快照分配、创建失败后的清理与 release 同样安全。原 fs 错误及其路径只保留在 main 内部 console.error 诊断中，job/IPC 不含主机目录。

   注入 EBUSY 分别覆盖 temp、IR、snapshot；断言三项都尝试、未被故障命中的资源已删除。操作系统拒绝删除的资源会留在受控临时位置并报告清理失败，不能假称已删除；测试解除故障后 finally 删除其自有目录。这是故障处理结果，不会修改源文件或删除已经保存的成品。

### RED → GREEN：准确命令与输出摘录

本轮工具执行 vitest/build/playwright 时沿用 require_escalated（默认沙箱先前 realpath EPERM 约束已记录）。

**四项有效 RED（19:38:32）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --reporter=verbose
Test Files  1 failed (1)
Tests  6 failed (6)
Duration  7.05s
cancel during rename: expected 'cancelled' to be 'running'
cancel during cleanup: expected 'cancelled' to be 'running'
canonical destination conflict: promise resolved jobId instead of rejecting
shutdown/drain is missing: expected 'undefined' to be 'function'
cleanup independent IR attempt: expected false to be true
snapshot release: forced EBUSY C:\...\assets\snapshot-... did not match /清理失败/
exit 1
```

同一测试文件用实际 1 秒 PCM、FFmpeg 编码/probe、真实 filesystem rename；仅对异步 rename/rm 时点加 gate 或注入指定错误。没有以 fake 媒体/进程替代编码。rename/cleanup gate 覆盖用户可见 TaskService 状态、目标旧/新字节、剩余临时资源；后续加强为真实具名 IPC start/cancel/get 的验证。

**真实 Electron 有效 RED（约 19:41）**：

```text
npm exec playwright -- test tests/e2e/audio-export-lifecycle.spec.ts --reporter=list
export shutdown timeline: [{"event":"spawn","pid":36840},{"event":"will-quit"}]
preview shutdown timeline: [{"event":"spawn","pid":41996},{"event":"will-quit"}]
Expected worker-close index > -1; Received -1
2 failed; exit 1
```

该命令使用未修改的旧生产 build。先前两次测试辅助错误（evaluate 中 require 不可用、退出后重新取得 app.process() 不可用）不计为有效 RED；改为 process.getBuiltinModule 与提前保存 child process 对象后，得到了上述实际退出失败。观察器包装真实 child_process.spawn，仅记录进程 PID/close，未替换或延缓 FFmpeg。最终退出断言由真实主窗口 `.close()` 触发、实际 Electron child.exitCode=0 验证；app.close 只作异常 teardown。

**初次 GREEN（19:44:41）**：原 6 个集成用例同命令 `6 passed (6)` / 3.60s / exit 0。随后扩展 rename failure、queued cancellation、三项独立清理故障、保存对话框 drain、preview 已提交后的取消和 IPC 结果检查。

**编译校验**：中途 `npm run typecheck` 找到 Promise.withResolvers 不在当前 ES lib 和测试捕获错误 union 的类型问题；改用普通 Promise resolver，不扩大 tsconfig，再次 exit 0。`npm run build` 一直 exit 0，已有 Zod/Rollup annotation warning 保留记录。

**受影响回归（19:49:05）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts tests/unit/contracts.test.ts tests/unit/filter-builder.test.ts tests/integration/library.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests  38 passed (38)
Duration  6.09s
exit 0
```

包含当时 12 个新增生命周期用例、15 个已有 job/IPC 合约、3 个 filter/schema/runtime 缺失校验、8 个真实本地素材导入/probe/decode/重启回归。普通任务取消继续 abort 并丢弃晚到结果，既有 job semantics 未改为强制提交。

**真实 UI scoped 回归（约 19:50）**：

```text
npm exec playwright -- test tests/e2e/audio-export-lifecycle.spec.ts tests/e2e/audio-editor.spec.ts tests/e2e/lx-lifecycle.spec.ts --grep "closing actual main window|reopened editor|real Electron editor|closing the actual main window" --reporter=list
export: spawn PID 10804 → worker-close PID 10804 code null → will-quit
preview: spawn PID 20908 → worker-close PID 20908 code null → will-quit
5 passed (43.3s); exit 0
```

覆盖真实编辑预览/保存和播放互斥、两个真实关闭处理、重开编辑器目标冲突、LX 隐藏窗口启用时主窗口正常退出。每个真实关闭用例用 300 秒 44100 Hz PCM、0.5× 和 5 秒 IR，在观察到实际 FFmpeg 启动且尚未 close 时关闭主窗口。独立断言 PID 已不存在、temp/IR/snapshot 消失、目的文件未提交、原 WAV 所有字节相同；不是仅以 app.close 的测试清理推断。

**精确预览轻量回归（19:50:59）**：

```text
npm exec vitest -- run tests/integration/audio-export.test.ts --testNamePattern "20 source seconds" --reporter=verbose
Tests  1 passed | 1 skipped (2); Duration 9.16s; exit 0
```

实际 60 秒源的 10..30 秒 / 2× 预览仍精确 10 秒，原字节不变。旧 7 编码/频谱/脉冲完整矩阵本轮保留原证据，未重复执行。

**自审追加的能力探测关闭顺序 RED（19:52:00）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --testNamePattern "pending runtime capability" --reporter=verbose
Tests  1 failed | 12 skipped (13)
shutdownRequested: expected false to be true
Duration 1.08s; exit 1
```

发现先等待 operation 再调用 worker.shutdown 会延迟中止尚在 await 的能力探测。修复为立即启动 worker shutdown，同时等待其 close 与 operation drain。此注入只控制能力结果的异步窗口；真实 FFmpeg 与 Electron 退出证据继续独立保留。

**最后集成/typecheck/build（19:52:16）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --reporter=verbose
Test Files  1 passed (1); Tests 13 passed (13); Duration 6.08s; exit 0
npm run typecheck
> tsc --noEmit
exit 0
npm run build
main 33 modules / out/main/index.js 121.70 kB
preload 102 modules / renderer 142 modules; exit 0
```

最后 build 保留已披露的 Zod/Rollup annotation warning。关闭顺序小改后只重跑受影响真实退出流程，结果记录如下。

```text
npm exec playwright -- test tests/e2e/audio-export-lifecycle.spec.ts tests/e2e/lx-lifecycle.spec.ts --grep "closing actual main window|closing the actual main window" --reporter=list
export: [{"event":"spawn","pid":39020},{"event":"worker-close","pid":39020,"code":null},{"event":"will-quit"}]
preview: [{"event":"spawn","pid":26820},{"event":"worker-close","pid":26820,"code":null},{"event":"will-quit"}]
3 passed (34.6s); exit 0
```

### 文件、自审、清理与公共交接

本轮修改：`src/main/export/audio-export-service.ts`、`ffmpeg-worker.ts`；`src/main/jobs/task-service.ts`；`src/main/index.ts`；`src/main/assets/asset-registry.ts` / `media-probe.ts`；`src/shared/audio-export.ts`；`src/renderer/features/editor/AudioEditor.tsx`。新增测试：`tests/integration/audio-export-lifecycle.test.ts`、`tests/e2e/audio-export-lifecycle.spec.ts`。没有改动 filter-builder、原播放器、搜索、LX 实现或 preload 接口；受影响 LX 真实主窗口关闭回归通过。

自审通读四个 finding、上述产品 diff 和新增 13 个集成 / 3 个 Electron 用例，逐条核对：提交前 signal 检查与 beginCommit 同步相邻、锁持有至 cleanup drain、queued work 被跳过仍释放、late preview cancel 保留登记、每项 cleanup 独立、安全 warning 由 strict schema/IPC 验证。额外发现并以 RED→GREEN 修正能力 probe 的 shutdown 顺序。`git diff --check` exit 0；只出现 Git 自动 CRLF 提示。没有自行宣告独立审查通过。

`checkedSnapshot(id, expectedHash, ctx)` 仍只向主进程消费者提供已验证且受控的同一字节副本、originalPath 与安全 release；下游分析/创作不能重新打开原路径替代副本。派生素材/result 保留既有 sourceTimeMap（输出 t → startSeconds + t*rate，目标时长以采样帧取整）及 parent/hash；在线资源仍 offlineEditable=false。新 TaskContext.beginCommit/wait/shutdown 是主进程内部任务生命周期接口，未向 renderer 提供路径或通用命令。新增导出 DTO 可选 cleanupWarning 是唯一必要的公共结果扩展。

截图仍为 `docs/verification/screenshots/audio-export.png`；本轮真实编辑流程再次产生并目视检查，10..30 秒、2×、预计 10.000 秒、FLAC 24 bit、预览和导出完成可见，底层主播放器暂停。文件与原已跟踪截图字节一致，无需额外提交截图变化。

测试媒体、目的成品、junction alias、快照、IR、timeline 都是各测试自己 mkdtemp 的资源，finally 清理。有效 RED 退出遗留的 worker 仅按观察到的测试 PID 终止后清理；最终 GREEN 在断言中确认进程已退出和工作资源已清理，而非 teardown 才清理。异常清理测试先解除注入故障，再删除其自有目录。失败 trace 在绿色 Playwright run 时被替换，清理本轮 test-results/.last-run.json；保留构建产物与报告。

报告与 `.superpowers/sdd/2026-10-03-music-player-implementation/task-6-report.md` 同步。暂存只包含本轮产品/测试和两份报告；控制端 player-progress、image-runtime 研究等文档不暂存。

当前结论：四项 Important 均已实现对应修复与有效回归；**independent re-review pending**。人工听感仍 **pending**。原实际媒体矩阵、runtime 安全、预览双重发声和 parity 证据保留；当前没有 LX/Gemini 配置仍不影响本地功能验收。

清理补充：自审发现首次测试辅助 app.process() 错误令两个 teardown 未执行，精确残留目录 `audio-exit-ui-p6o4y3` / `audio-exit-ui-W8uta8` 的 timeline 记录了本次实际测试 PID 42724 / 26548；检查时二者已不存在。核对实际目录位于指定 Windows Temp 根目录，且有测试专属 timeline 和 shutdown.wav 后，仅删除这两个目录；未枚举或删除其他用户临时资源。本轮 test-results/.last-run.json 也已删除。

## Fix round 2 — 目的目录项与解析目标共同预留（2026-10-05）

本轮代码修复与 focused 验证完成；**independent re-review pending**，人工听感继续 **pending**。FIX_BASE 为 `c7bebec33384ac7913c97c6ad114fe2f55352251`；启动时 HEAD `fd6f8ee`，控制端随后保存复审/ledger 的 docs-only 提交 `2725c90`。完整读取 `docs/verification/checkpoint/task-6-rereview-1.md`、re-review-prompt.md 和原 brief/context/constraints。复审已判 #1/#2/#4 ADDRESSED，本轮仅处理 #3 剩余 Important，没有重新宣称独立审查通过。

### 问题、最小修复与时序证据

原 reserve 用已有文件的 realpath 覆盖 `realpath(parent)+basename`。目录项 D 指向 T 时首任务只锁 T；真实 rename 替换 D 后，D 的解析身份改为 D，首任务仍清理时第二请求可取得 D 锁。因此预留必须保留稳定目录项键，不能只保留会随提交变化的目标解析键。

`AudioExportService.Operation.destinationKeys` 现在记录本操作真正预留的整个键集合：稳定目录项键始终保留，已有文件再增加解析目标键，按 Windows 大小写归一化并去重。对全部键同步检查冲突，检查成功后同步加入全部键，没有中间 await；冲突请求不记入任何预留，因此其 catch/finish 不会误释放别人持有的键。finish 在工作与 cleanup drain 后一并释放本操作的全部键。父目录 junction、大小写归一化、commit/cancel、shutdown、独立安全 cleanup 均沿用已审查实现；没有新增 IPC/DTO 或 UI 行为。

新增两条时序回归由具名 IPC export.start/get/cancel 消费真实服务与任务：

- D→T 已建立，首任务真实 FFmpeg/probe 完成、尚未提交时，选择 T 明确冲突。释放 worker 后实际 rename 提交并进入受控 cleanup 窗口；断言 D 的真实 inode 改变、dev 不变、目录项为普通文件、成品 RIFF 字节，解析状态变 D→D。首任务仍 running 时，选择 D、T、D 连续冲突；这些失败请求不能解开首任务的预留，D 成品字节和 T 旧字节保持不变。cleanup 完成后分别再导出到 T 与 D，均 completed。
- 第二保存已选择旧 D→T，目标 realpath 尚未完成时设置 gate；首任务真实 rename 提交后才恢复第二 realpath，首任务仍在 cleanup。第二请求被拒绝而没有 jobId，已发布成品字节保持不变；cleanup 后目标可以重新使用。

另加四条共同预留释放回归：rename failure、queued cancellation、processing cancellation、cleanup warning。各自检查公开 job 结果与目标旧/新字节、snapshot 资源；清理 warning 仅留下被注入拒绝删除的实际 IR，断言其扩展名及数量，解除故障后移除测试自有 IR。每个终止路径随后分别导出到 T、D 并验证 completed，源音乐字节相同、最终 temp/IR 消失。

### Windows file symlink 限制与受控等价路径状态

本机原生 `fs.symlink(target, destination, 'file')` 实测返回 **EPERM**。没有将该权限错误当作通过，也没有 skip 相关用例。仅对旧目录项的 realpath 解析边界采用受控等价状态：将 T 的旧字节真实 copyFile 到 D，记录 D 的真实 dev/ino；只有 inode 仍为旧值时 realpath(D) 返回真实 realpath(T)。实际 rename(temp,D) 替换目录项后，D 的真实 inode 与旧值不同，后续解析恢复实际 realpath(D)。FFmpeg、probe、copy、rename、lstat、成品字节和 cleanup 都是实际操作。异步 realpath gate 只控制解析完成时点，不伪造 rename 或任务结果。

日志明确为 `File alias mode: controlled target resolution; native file symlink denied: EPERM`。因此本轮证据是受控的目标解析状态变化加真实目录项替换，**不是在本机成功创建 file symlink 的实际验收**。现有父目录 junction 用例继续使用实际 Windows junction；其他正常路径/不存在目标/大小写行为同批回归通过。

### RED / GREEN：准确命令与输出摘录

**有效 RED（20:07:10，生产修复尚未写入）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --testNamePattern "file symlink replacement" --reporter=verbose
Alias state: D resolves T before commit; actual rename replaced D; D resolves D while first job remains running in cleanup
promise resolved '63c4af93-69e0-4e82-9c4d-a6c89c66f665' instead of rejecting
Alias race: second save selected old D→T; target realpath resumed after first rename; first job still held in cleanup
expected 'f1d5cc54-9cc8-4b86-a100-b6a3dd5e4d6b' to be null
Test Files 1 failed (1)
Tests 2 failed | 13 skipped (15)
Duration 1.18s; exit 1
```

两个失败都是首任务尚未终止却接受第二个 jobId，直接覆盖复审的剩余分支。失败后的 teardown abort 错误接受的第二任务时产生 main 内部 AbortError 诊断；实际 drain 完成后 finally 清理，没有将该内部日志冒充 IPC 失败原因。13 skipped 来自命令的 testNamePattern 排除旧用例，不是跳过 file symlink 权限 case。

**最小修复后 GREEN（20:07:54）**：同一命令 `2 passed | 13 skipped (15)`，2.35s，exit 0。随后加强真实 inode/成品字节/冲突不释放别人预留，并补四类终止路径释放。

**完整受影响 lifecycle（20:09:11）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --reporter=verbose
Test Files 1 passed (1)
Tests 19 passed (19)
Duration 10.82s; exit 0
```

包含本轮 6 条新增回归与已通过的 13 条 commit/cleanup/取消/shutdown/保存对话框/junction/case 回归，**没有 skips**。

**最后加强断言与准确权限码后的 scoped GREEN（20:10:25）**：

```text
npm exec vitest -- run tests/integration/audio-export-lifecycle.test.ts --testNamePattern "file symlink replacement|file alias reservations" --reporter=verbose
File alias mode: controlled target resolution; native file symlink denied: EPERM
file symlink replacement ... through cleanup, then releases both: passed
file symlink replacement ... realpath finishes after first commit: passed
file alias reservations ... rename failure: passed
file alias reservations ... queued cancellation: passed
file alias reservations ... processing cancellation: passed
file alias reservations ... cleanup warning: passed
Test Files 1 passed (1)
Tests 6 passed | 13 skipped (19)
Duration 4.94s; exit 0
```

13 excluded 仍只是命令筛选，已在上一完整生命周期命令通过。

**最终编译/构建**：

```text
npm run typecheck
> tsc --noEmit
exit 0（最后测试断言修改后再次执行）
npm run build
main 33 modules / out/main/index.js 121.84 kB
preload 102 modules / renderer 142 modules
exit 0
```

既有 Zod/Rollup annotation warning 与此前一致，未将 build 写成无 warning。用户授权本轮只跑受影响 lifecycle/typecheck/build；未重复已通过的 Electron 关闭窗口、编码矩阵、频谱/IR parity 或其他旧基线，保留前文原证据。

### 自审、文件与清理

修改只有 `src/main/export/audio-export-service.ts`、`tests/integration/audio-export-lifecycle.test.ts` 和两份同步报告。自审核对稳定键不会被解析键覆盖、全部键先检查再同步预留、冲突操作未拥有任何键、finish 只释放本操作记载的键。测试变异检查：移除稳定键会重现提交后冲突失败；移除解析键会使提交前 T 请求被错误接受；漏释放任何键会使终止后的 D/T 再导出失败；错误冲突释放会使连续 D/T 请求被接受。`git diff --check` exit 0，只有 Git 自动 CRLF 提示。

所有本轮媒体、旧目标、快照、IR 与模拟解析状态由测试 fixture 自己创建；finally 先释放各 gate 并 await exporter.shutdown，再解除注入并删除本次 mkdtemp 目录。清理 warning case 显式验证遗留 IR 后只删除该测试目录中的已知文件。没有临时脚本、额外截图或新素材留在仓库；保留先前正式截图与构建产物。控制端进度、复审与研究文档均不暂存。

同步副本：`.superpowers/sdd/2026-10-03-music-player-implementation/task-6-report.md`。本轮结论为剩余 Important 的实现与回归完成，**independent re-review pending**；人工试听仍 **pending**，没有声称听过或审查通过。
