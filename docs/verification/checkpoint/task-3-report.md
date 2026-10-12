# Task 3 实现检查点（用户要求保存暂停）

状态：实现已保存到可编译、已测试的 checkpoint；Task 3 尚未独立审查，不标记为完整验收。人工试听明确 pending。

## 已实现

- 宿主通过 MediaResourceRegistry.issueLocal 签发 opaque media://local/UUID，expiry 在宿主检查；只由已签发句柄读取素材。共用 assetResponse/parseByteRange，支持普通、开放结尾和 suffix Range；保留原 artwork CORS。
- AssetRegistry.verifyOriginal 对实际文件 bytes/length/hash 做重验；丢失或改变时返回“原音乐文件已更改或丢失，请重新导入”，不覆盖原文件或索引。
- 具名 playback.resolve/cancel 桥接，request/response schema 校验，宿主用 library 内真实 track 解析本地素材。取消请求用宿主 AbortController，renderer 用 request identity/generation 阻止旧结果 load/play。
- PlayerEngine 真实 HTMLAudioElement、MediaElementAudioSourceNode、AudioContext，play/pause/seek/sourceSeconds、0.5–2 playbackRate/preservesPitch、音量、订阅、队列前后/随机/循环。PlayerController 解析与播放分离。
- 10 个指定频率的 peaking EQ，低于实际 context Nyquist 才可用，preamp/滤波参数平滑更新。混响使用共享固定种子 stereo IR，normalize=false、dry/wet 通道，音效失败记录并恢复默认主链；旁路保留直接音频。
- 版本化 effect schema/registry/defaults/音色预设；PlayerBar、QueueView、EffectsPanel 接入现有音乐库。实现只涉及本地播放器，未开始后续任务。

## TDD 与验证证据

RED（实现前，2026-10-03 23:34 HKT）：

```
npm run test:unit -- tests/unit/player-queue.test.ts
4 tests failed: PlayerEngine must exist / PlayerController must exist: expected null not to be null
npm run test:integration -- tests/integration/effect-chain.test.ts tests/integration/media-protocol.test.ts
3 tests failed: EffectRegistry / shared impulse response / MediaResourceRegistry must exist
8 existing library integration tests passed
```

这些测试先描述队列边界/循环/随机不丢条目、晚到响应不 load、超限 EQ、确定性 IR、suffix/expiry/原文件改变；动态 import 的缺失被转为明确断言。没有把真实媒体行为换成模拟音频节点。队列测试不初始化音频；controller 竞态测试使用桥接边界 pending promises，与后面的真实媒体证据职责不同。

首次沙箱 test 运行没有执行测试，原因 EPERM realpath；require_escalated 重跑获得上述 RED，不把权限错误算行为失败。

GREEN（2026-10-03 23:40 HKT）：

```
npm run test:unit -- tests/unit/player-queue.test.ts tests/integration/effect-chain.test.ts tests/integration/media-protocol.test.ts
3 files passed, 7 tests passed
```

实际节点/媒体检查增加后：

```
npm run test:unit -- tests/integration/effect-chain.test.ts
3 tests passed
npm run test:e2e -- tests/e2e/playback.spec.ts
2 tests passed (20.4s)
```

离线测试使用 Electron 内真实 OfflineAudioContext，0.1 amplitude 的 1000 Hz buffer，经实际 EffectChain 渲染并读取节点采样：+12 dB EQ 的 body RMS 比例 >3.8；旁路与平直输出 RMS 差 <0.00001；boosted samples 与原始不同；reverb tail RMS >0.00001 而 flat tail <0.000001；13 dB 非法 EQ 退出后 RMS 恢复且 errors=1；22050 Hz context 不声明 16000 Hz 频段可用。测试没有 mock Web Audio。

真实 UI 检查不注入 test bundle，生产 CSP 保持：导入两个 3 秒 WAV，播放/暂停，暂停后 source seek=2.5 秒稳定，音色预设实际表单值、速度=2、保持音高、ended 自动下一首、队列/上一首，以及宿主对改变的原文件拒绝解析；pageerror=[]。

440 Hz、2 秒 WAV 的真实 HTMLMediaElement + AnalyserNode 测量（最终完整回归输出）：

- 0.5×，preservePitch=false：4.0193 秒，222.65625 Hz；true：3.9461 秒，439.453125 Hz。
- 1×，false：2.0048 秒，439.453125 Hz；true：2.006 秒，439.453125 Hz。
- 2×，false：1.0049 秒，878.90625 Hz；true：0.9839 秒，439.453125 Hz。
- 峰值约 -26.7..-25.8 dB，所有最终 sourceSeconds=2；pause/seek 1.5 秒另外检查稳定。

测试注入曾遇到两个明确 helper 问题，已修正：inline script 被生产 CSP 拒绝，因此 helper 改为 CDP Runtime.evaluate 测试 bundle；Zod 在 privileged DevTools module 初始化时错误记录 allowsEval=true，后续常规 parse 触发 CSP，测试 bundle 的首个依赖改为 jitless config。没有放宽应用 CSP、改变真实媒体输出或用 mock 替换测量。

编译和完整回归：

```
npm run typecheck        # passed before UI build and final regression
npm run build            # passed, main/preload/renderer bundles built
npm test                 # final pre-checkpoint run
Vitest: 7 files passed, 55 tests passed
Integration command: 3 files passed, 12 tests passed
Playwright: 7 tests passed (31.8s), includes real dev CSP regression
```

npm test 的现有 test:unit 命令也收集 integration，因此上面 12 项是脚本再次执行；55 Vitest + 7 E2E 共 62 个不同用例。不把重复数当额外覆盖。

已知构建依赖 Zod PURE annotation、Playwright NO_COLOR/FORCE_COLOR 警告仍存在；不称 output pristine。无应用异常或未解决测试失败。最终 npm test 在收到“不再开整套回归”消息前已经开始，等该轮结束后没有重复执行。

## 文件

新增：
- src/main/assets/media-protocol.ts
- src/shared/player.ts, effects.ts, effect-registry.ts, impulse-response.ts
- src/renderer/audio/player-engine.ts, player-controller.ts, effect-chain.ts
- src/renderer/features/player/PlayerBar.tsx, QueueView.tsx
- src/renderer/features/effects/EffectsPanel.tsx
- tests/unit/player-queue.test.ts
- tests/integration/effect-chain.test.ts, media-protocol.test.ts
- tests/e2e/playback.spec.ts
- tests/helpers/audio-browser.ts, audio-harness.ts, audio-zod.ts

修改：src/main/assets/asset-registry.ts、src/main/index.ts、src/main/ipc.ts、src/preload/index.ts、src/shared/contracts.ts、src/shared/schemas.ts、src/renderer/App.tsx、src/renderer/features/library/LibraryView.tsx、src/renderer/index.html、src/renderer/styles.css。

UI 截图：.superpowers/sdd/2026-10-03-music-player-implementation/task-3-ui.png，已视觉检查。其时音效面板滚动到 EQ/混响/速度位置，完整播放器停在 source 2.5 秒。

## 自审与暂停边界

阅读了 own diff 与新增协议、类型、schema、IR、engine/controller/chain；git diff --check 没有 whitespace errors。确认原文件未写入、settings asset index 未重构、preload 保留单 entry bundle、开发 nonce/生产 CSP 不放宽。

这只是 implementer 自审；尚未经过主 Agent 安排的独立 spec/code review。暂停前不派 reviewer。

剩余/限制：
- 人工试听 pending，不能以自动频谱/采样证明主观音质。
- 恢复后先独立审查，再按发现补覆盖；真实快速切歌的 load/ended 事件竞态主要依靠 request/generation 设计与 controller unit，用例可由审查要求补充。
- 本地句柄默认寿命当前为 24 小时；审查需确认是否符合 brief 的“短期”，或缩短并检查长曲后定位续租行为。
- hash 重验会在签发及每次 media request 重新读取原文件；尚未做大文件性能测量。检验与流式读取间没有锁定外部应用对文件的修改，需审查是否要求更强的 immutable snapshot。
- 没有未解决的当前 test failure；不代表 Task 3 已完整验收。在线/LX/导出/AI/后续视觉任务未开始。

恢复步骤：
1. 留在 codex/music-player；查看本 checkpoint commit 的完整 diff，不重新执行实现。
2. 主 Agent 安排独立 spec/code review，重点 lifecycle/race、media lease 与 hash verification。
3. 按审查结果补必要用例，运行对应 focused 检查；如改 production 再 npm run typecheck/build。
4. 用户从音乐库播放真实音乐，打开音效面板试听 EQ/混响/速度，记录人工试听；然后决定 Task 3 验收。

测试 finally 均关闭 Electron、清理本次临时 fixture directory；所有返回 session 已完成。没有为此任务启动持久服务。一次额外系统进程 inventory 的 Get-CimInstance 在沙箱被拒绝，未执行停止未知进程的操作。

## 保存结果

Checkpoint commit: 6fcaa0b8443ab4634b65790f466413aa158fb691 — feat: checkpoint local player and realtime effects。
提交了上述 28 个 source/tests 文件；保留主 Agent 的 docs 协调改动，未将其混入实现提交。报告和截图位于已有 ignored .superpowers/sdd 目录，供主 Agent 持久化到项目记录。

## Task 3 review round 1 fix checkpoint — 2026-10-04

状态：修复实现与必要 focused 验证已保存，按用户“在最近最合适的节点保存进度暂停”要求收口。尚未经过独立 scoped re-review，不代表 Task 3 完整验收。起点 f2f10a8（产品 checkpoint 6fcaa0b；随后仅 docs）。当前分支 codex/music-player。

### 根因与变更

Important 1：PlayerEngine 的永久事件回调绑定到同一个复用的 HTMLAudioElement。prepareLoad 只 pause，generation 仅保护 load Promise 的最终分支，未保护 play/pause/timeupdate/seeked/ended/error。切换选择时，已排队的旧 ended/error 能将新曲目的 loading 改为 paused/error；旧 ended 还能触发 App 的自动下一首。旧 metadata/load 在 load 已开始后切换时，也不能靠 request resolution 的晚返回守卫完整隔离。

修复在每次选择时 retireMedia：先递增 generation 和 abort pending load，清空引擎媒体引用、断开旧 MediaElementAudioSourceNode、pause 旧媒体、清除 src 并 load 释放资源。新 load 创建自己的真实 Audio 元素和 source node；每个媒体生命周期回调闭包检查 media identity + generation，metadata/error 等待也检查 generation。AudioContext、EffectChain、音量节点继续保留，因此已有音效与音量设置不因切歌丢失。

Important 2：App 的 refresh 只替换 library snapshot，queueIds 和引擎 ids/order/cursor 均没有跟着过滤。移除当前曲目使 UI 无法找到 track，但音频仍运行；移除下一曲 B 后 A ended 取到不存在的 B，step 不播放也不会到 C。

修复在 refresh 收到真实 library list 后、发布新 snapshot 前同步队列。reconcileQueue 只保留仍在 library 的既有队列条目，重映射原 order 的索引并保留幸存当前条目/随机历史顺序，不添加新导入条目，不重新洗牌。当前曲目已移除时 controller.stop 清空 currentRequest、取消宿主解析、engine.clear 停止并清空媒体和播放状态；存活队列仍可从 QueueView 选择播放。未修改 PlayerBar、QueueView 和素材协议。

### RED 证据

测试先于产品修改。默认 sandbox 下以下两个命令均因 spawn EPERM 无法启动（Vitest esbuild / Playwright worker），不计为 RED；以已授权的 require_escalated 运行后得到实际断言失败。

```
npm run test:unit -- tests/unit/player-queue.test.ts
# Test Files 1 failed; Tests 2 failed | 4 passed (6)
# library reconciliation removes missing entries without moving the surviving current track
# library reconciliation skips a removed successor and preserves repeat-one on the survivor
# 两条均 TypeError: player.reconcileQueue is not a function（旧实现缺少同步入口）

npm run test:e2e -- tests/e2e/playback-lifecycle.spec.ts
# 5 failed，均为真实行为断言失败；不是 startup/permission failure
# late native ended from A cannot change B while resolving:
# expected loading/sourceSeconds=0, received paused/sourceSeconds=0.3
# late native error from A cannot change B while resolving:
# expected loading, received error
# switch after load began ignores retired media events and completes the new selection:
# expected loading, received error
# removing queued B lets real A finish into C:
# expected now-playing C, received A (5000ms timeout)
# removing playing C stops its media and leaves surviving queue playable:
# expected idle, observed playing then paused (5000ms timeout)
```

生命周期 harness 只延迟已注册回调的交付，底层是 Electron 内真实 HTMLMediaElement、实际 media:// WAV 与 Web Audio。ended/error/metadata 测试都断言捕获 Event.isTrusted=true：A 真正播完产生 ended；无效不透明句柄产生原生 error；B 真正 load 后产生 loadedmetadata。前两项验证 B resolving 阶段不受旧原生事件影响；第三项在 B load 已开始并捕获 metadata 后选择 C，释放旧 metadata，再对旧 B 元素交付 synthetic ended/error 补充检查已退休媒体。Controller 解析只对后续选择用受控 Promise 延迟，音频没有替换成 mock。移除两项通过真实 UI、真实库移除与原生 ended 完成，当前媒体 pause/src 清理来自真实元素观察；原文件仍存在。

### GREEN / 最终验证

```
npm run test:unit -- tests/unit/player-queue.test.ts
# 最终 run 17:39:35: Test Files 1 passed; Tests 6 passed (6), 266ms

npm run test:e2e -- tests/e2e/playback-lifecycle.spec.ts tests/e2e/playback.spec.ts
# 7 passed (27.6s)
# 5 个新增生命周期/移除回归 + 2 个既有真实 UI、速度/频谱用例

npm run typecheck
# final exit 0, tsc --noEmit

npm run build
# final exit 0; main/preload/renderer built
# renderer assets/index-D8HKHbEk.js（最终队列游标边界源码已包含）

git diff --check
# exit 0; 无 whitespace error
```

build 在队列游标 Math.max(0, cursor) 边界收口前后各执行一次；最终 unit 随这处实际源码改动重跑一次。E2E 的 test-only bundle 使用当时最新 engine；最终 build 之后没有继续改产品代码。类型检查初次报告新增测试 helper 参数隐式 any，补类型后曾报告 prototype 方法 listener 的 null 类型不匹配；改成实际非空 EventListenerOrEventListenerObject 后 final exit 0。没有未解决的类型或测试失败。

既有速度/频谱测量继续通过：0.5x false 4.0100s/222.65625Hz，true 3.9466s/439.453125Hz；1x false 2.0040s/439.453125Hz，true 2.0060s/439.453125Hz；2x false 1.0075s/878.90625Hz，true 0.9779s/439.453125Hz。峰值约 -26.7..-25.8dB，全部 sourceSeconds=2。既有 UI 检查覆盖暂停、定位、预设、速度、ended 接续、队列和上一首。未扩大到无关完整 npm test，遵守用户相称验证和暂停指令。

构建仍有已知 Zod PURE annotation 提示；Playwright 仍有 NO_COLOR/FORCE_COLOR 提示。未抑制应用错误，不把输出称为 pristine。

### 实际文件与自审

本轮仅修改/新增六个文件：
- src/renderer/audio/player-engine.ts
- src/renderer/audio/player-controller.ts
- src/renderer/App.tsx
- tests/helpers/audio-browser.ts
- tests/unit/player-queue.test.ts
- tests/e2e/playback-lifecycle.spec.ts（新增）

已阅读完整 own diff 与新 E2E 文件，自审跨代请求、load abort、媒体清理、source reconnect、snapshot 清空、库刷新与队列 current cursor。所有新增测试的期望来自用户行为要求而非复述源码。媒体事件 helper 位于 tests，未向产品类增加测试专用钩子；clear/stop 是 UI 当前曲目移除的生产调用。

默认沙箱测试 spawn 失败后使用 require_escalated，未遇到自动审核拒绝；未执行删除共享缓存、旧材料或未知进程。每个 Electron 测试 finally 关闭本次 app，并递归删除自身 mkdtemp fixture；已启动的所有测试会话均正常结束。既有 playback.spec 自动刷新原 task-3-ui.png 截图，该现有证据文件保留。

### 暂停与恢复边界

剩余：恢复后由主 Agent 安排本修复的独立 scoped re-review，再决定 Task 3 验收；人工试听仍 pending。此前 minor 全 Range 完整 hash 性能、validation/read race、24h lease 过期恢复继续 deferred，本轮完全未修改这些模块。未开始在线平台、LX、导出、AI 或下一任务。

报告为追加，原 Task 3 实现报告保留；.superpowers 为 ignored 目录，主 Agent 应将这段恢复材料持久化到项目 checkpoint docs。修复 commit hash 由主 Agent/最终返回记录，以避免报告写入待提交 hash 造成自引用。
