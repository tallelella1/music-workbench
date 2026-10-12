# Task 5 implementation report

status: software-complete; independent-review-passed (2026-10-05, see task-5-rereview.md)

BASE: `34df4d0d8ea2f144a132978d26b1a61cc629ef1f`

commit: `d7d7572473ce984e3ec37691bea590e8e77ca054` — `feat: validate complete playback through isolated source scripts`

真实用户音源验收：未配置。用户没有真实 LX/Gemini 配置，本报告不将自建 fixture 记作第三方脚本兼容或外部整曲验收。人工试听仍 pending。

## 要求覆盖

- 交付 brief 中全部产品模块及测试：独立 LX host/network/preload/runtime、matcher/completeness/resolver/remote-resource、SourceSettings、远程 media proxy；消费已审查的 PlayerEngine、AssetRegistry、SearchService，不重新实现 Task 1–4。
- 每脚本独立隐藏 renderer，独立非持久 session，sandbox/contextIsolation 启用，Node 关闭。真实 Electron 核对主页面与两个脚本的三个 OSProcessId 不同，并核对脚本的 sandboxed 指标。脚本没有 require/process/musicApp。导航、弹窗、权限和页面直接网络封闭；源网络只经专用且校验 sender/frame/url 的 IPC。
- 官方 lx 事件、单 Promise handler、qualitys/info.type、URL 字符串结果、currentScriptInfo、浏览器定时器均接入。wy/kg/tx 的实际旧扁平身份映射有 focused 断言；不编造缺失 ID、质量 hash。plain LX URL 转成 preview=null，网络 headers 不继承给媒体 URL。
- 初始化外部 watchdog 5 秒、解析外部 watchdog 15 秒；无限循环不依赖被阻塞页面的 timer。真实测试同时核对时间下界、窗口销毁、另一个脚本继续调用、本地主界面继续播放/响应。
- 匹配要求规范化标题、艺术家集合、保留的版本证据、已知时长差 <=5 秒、专辑一致。未知、冲突、不同歌手/版本/专辑和缺失识别信息不自动接受。剥离版本标记后空标题也拒绝。
- 下载真实 HTTP 媒体，用实际 ffprobe 属性和 FFmpeg 全解码样本计数检查。真实 20 秒短曲通过；preview=true、180 秒曲目返回 30 秒资源、未知预期时长、伪造 20 秒 WAV 头但实际只剩 1 秒内容均拒绝。实际 MP3 不可凭 declaredQuality 冒充严格 FLAC/24-bit。
- 已验证 bytes/probe 绑定，media://remote 只复用同一份核验 bytes，支持 Range/末尾定位，不再次 GET 上游。URL/headers/绝对路径不进入页面 PlaybackResource，未检查的对象不能签发资源。
- resolver 最多六个不同组合、总预算默认 90 秒，失败切第二源；严格模式不降级，自动模式显示实际 codec/sampleRate/bitDepth/bitrate；过期链接最多刷新一次。暂停后租约过期可重解析、重新检查并恢复 sourceSeconds。
- 搜索结果有完整播放按钮，PlayerBar 有远程音质/严格模式。远程 Track 元数据独立保留；刷新曲库/移除本地条目不会停止在线曲目或丢掉在线队列。本地删除当前停止、删除下一曲跳过的原回归继续通过。
- UI 可导入、启用、测试、禁用，支持重新启用。失败新版本保留旧版本启用；自动更新关闭，上一版本源码保留。异步测试只显示验证结果，由用户显式点击“播放已验证歌曲”接管播放器；卸载取消未完成测试。
- 兼容差异和不支持项目逐项列于 `docs/lx-compatibility.md`，没有宣称全 LX 脚本兼容或远程离线编辑许可。

## RED / GREEN 与命令结果

首次普通 sandbox 运行 Vitest 时启动 esbuild 得到 spawn EPERM；依已授权 require_escalated 重跑相同命令。升级未被拒绝。

- `npm run test:unit -- tests/unit/matcher.test.ts`：初始 2/2 RED（实现缺失）；实现后 2/2 GREEN。自审发现 marker-only 标题被误接受，再证 1 RED，修复后 GREEN。
- `npm run test:integration -- tests/integration/resolver.test.ts`：初始新增 5/5 RED（实现缺失），该 npm script 本身还运行已存在的 integration 文件，旧项 35/35 通过。后续采用 `npx vitest run tests/integration/resolver.test.ts` 做 focused GREEN，避免重复全旧基线；最终 resolver 7/7。
- `npx vitest run tests/unit/playback-renewal.test.ts`：1 RED（resume 缺失）→1 GREEN（重新解析并按 load/seek:12/play 次序恢复位置）。
- 严格媒体属性新增 RED：请求 FLAC 的 PCM 资源曾被接受，增加 actualQualityMeets 后 GREEN；最终用真实 HTTP MP3 bytes 覆盖 FLAC/flac24bit 拒绝。
- `npm run test:e2e -- tests/e2e/lx-isolation.spec.ts`：初始 RED（无音源 UI）；基础沙箱及媒体流程 GREEN。自审真实 HTTP 阻塞源测试 A、导航播放本地 B、放行 A，证 RED（A 抢回播放器）；随后补仍在音源页点击下一首的 RED。改为结果展示 + 显式播放，卸载取消，最终两条路径均 GREEN。最终运行 1/1 通过，27.7 秒。
- 最终 focused：`npx vitest run tests/unit/matcher.test.ts tests/unit/playback-renewal.test.ts tests/unit/lx-contracts.test.ts tests/unit/contracts.test.ts tests/unit/player-queue.test.ts tests/unit/track-version.test.ts tests/integration/resolver.test.ts tests/integration/media-protocol.test.ts` →8 文件、53/53 通过。
- `npm run typecheck` →退出 0；`npm run build` →退出 0。普通非 TTY 构建真正产出自包含 `out/preload/index.js`、`out/preload/lx.js` 和隐藏 runtime，不使用 electron-vite isolatedEntries。最终 UI 修复后 typecheck/build 再次通过。
- 受影响 Electron 回归：`npm run test:e2e -- tests/e2e/lx-isolation.spec.ts tests/e2e/playback-lifecycle.spec.ts tests/e2e/playback.spec.ts tests/e2e/search.spec.ts tests/e2e/dev.spec.ts tests/e2e/boot.spec.ts` →14/14 通过，包括真实 npm dev、快切晚到事件、本地删除回归、真实播放时长/频谱。之后的 SourceSettings 修复只重跑覆盖它的 LX e2e，没有扩大或重复 full baseline。
- `git diff --check`（本任务 owned 文件）→退出 0；只暂存本任务 35 个文件，其他 Agent 的 docs 变更仍留在工作树，未 revert/stage。

Vite 报依赖 Zod 的 PURE 注释警告，Playwright 报 NO_COLOR/FORCE_COLOR 警告；没有隐藏失败。早期 e2e 的表单导航后重置和截图关闭队列条件问题已改正，最终覆盖测试通过。

## 真实与 fixture 边界

真实的软件执行：Electron 隐藏 sandbox 启动/IPC/watchdog/进程隔离、Node HTTP server、生成 WAV 文件、真实 FFprobe/FFmpeg 解码、实际 HTMLMediaElement 播放、末尾 19→20 秒结束、真实 npm dev 启动。

受控 fixture：`tests/fixtures/lx/basic-source.js`、无限循环脚本、127.0.0.1 服务和平台搜索响应。音频 URL、headers 和 bytes 的检查/播放经过真正宿主网络与 media:// 协议，没有 mock probe。搜索元数据响应被替换为受控数据，源网络和媒体继续走真实 HTTP。HTTP 下载次数证明 Range/末尾播放不二次请求上游，X-Fixture 网络 header 不进入媒体请求。

未覆盖：实际用户音源/真实第三方脚本；真实网易云/酷狗/QQ 整曲、第三方凭证、真实签名 URL 续期；人工听感。缺配置遵循用户当前决定，保持未验收，未伪造通过。

## 自审与 rulings

自审核对全部 owned diff、契约、真实与 fixture 区分和上述检查；没有派发 subagent/reviewer，主 Agent 后续独立审查。

- Ruling：LX 的 preview=null 不伪改为 false；只有已知可信预期时长与全下载/全解码样本一致才可通过。代价：缺时长源不能播放，URL 字符串本身仍无法证明第三方预览标签。
- Ruling：完整媒体必须先下载再播放同一份 bytes，以防上游第二次 GET 改成截断资源。代价：播放开始前有完整下载等待，媒体和缓存大小有明确上限。
- Ruling：同一组合只允许一次到期刷新，普通失败不重复；默认仍受六组合/90 秒上限。代价：连续两次过期的源会失败。
- Ruling：SourceSettings 的异步测试不自动播放，必须用户显式点击已验证结果；这是修复页面内外快切竞争的最小方案。代价：测试后多一次播放操作。
- 自审修复 1：marker-only 标题剥离后为空仍能匹配，matcher RED→GREEN，focused 53/53。
- 自审修复 2：源测试迟到绕过 Controller 代次抢回播放，真实 HTTP 页面内/外两条 RED→GREEN，最终 LX e2e 1/1。

剩余限制以兼容清单为准：同步 crypto/zlib/Buffer、local 动作、formData/needle 完整语义等未支持；POST/form 等已实现分支未声称真实第三方兼容验收。无已知阻塞 Task 5 软件完成的问题，独立审查仍待主 Agent。

## 截图与清理

- `.superpowers/sdd/2026-10-03-music-player-implementation/task-5-http-playback.png`：实际 HTTP 20 秒短曲末尾播放后，在线队列元数据保留。
- `.superpowers/sdd/2026-10-03-music-player-implementation/task-5-source-settings.png`：脚本表单、初始化错误与可控启用状态。

两张截图已人工查看。测试自身关闭 Electron/HTTP server 并删除其临时目录；完整性检查 finally 删除受控下载目录。保留截图和本报告供独立审查。`.superpowers` 受现有 Git exclude 忽略，本报告及截图作为本地交接材料，不 force-add。

## Fix round 1 — 2026-10-05

状态：三个 Important 已修复并完成定向软件验证；等待 Controller 独立审查。FIX_BASE 为 reviewer 检查的 `d7d7572473ce984e3ec37691bea590e8e77ca054`。实施开始 HEAD `10e863f`，期间 Controller 仅提交其独立文档，最新 `828540e`；没有 revert/stage Controller 的文件。

### 根因与最小修复

1. `LXHost.resolve` 把普通取消和解析超时都交给 terminate/stop，stop 会移除 provider、禁用脚本并拒绝全部 pending，Controller 快切取消 A 导致同源 B 失败。现在取消仅立即拒绝调用者，原 pending/watchdog 保留到真实结果/错误结算或原 15 秒期限。迟到结果只负责清理 watcher，不返回资源；stop 清理所有 pending 的 timer，watchdog 还捕获并比对同一 BrowserWindow 实例，不能停用重启后的实例。依据 Controller 明确 ruling：被取消但不结算的无限循环仍在原期限被终止，取消本身不能禁用源。
2. `window-all-closed` 被启用源的隐藏 BrowserWindow 阻止，而主窗口 closed 只清空引用。现在非 macOS 主窗口 closed 主动 app.quit，已有 before-quit 统一 shutdown 音源。Windows 验证关闭的是真实主窗口，成功断言使用启动时捕获的 Electron ChildProcess.exitCode，退出前未调用 app.close。
3. resolver 只处理核验前到期；完整下载/解码后的明确到期理由被直接跳过。完整性结果增加宿主内部 typed `failure: expired | incomplete | null`，resolver 对核验前或期间到期共用该组合的一次刷新额度，刷新后重新完整下载/解码。普通失败不重试，组合不重复计数，所有刷新仍用同一取消信号和总预算。

责任文件：`src/main/extensions/lx-host.ts`、`src/main/index.ts`、`src/main/playback/resolver.ts`、`src/main/playback/completeness.ts`（仅 typed expiry outcome）、`docs/lx-compatibility.md`（同步取消/到期规则）、`tests/integration/resolver.test.ts`、新增 `tests/e2e/lx-lifecycle.spec.ts`、本报告。公共 preload/IPC/renderer 接口未改。

### RED — 修复前的完整相关结果

命令：`npx vitest run tests/integration/resolver.test.ts -t 'expiry'`，退出 1。真实 HTTP 延迟 600ms 返回真实媒体，首次链接寿命 300ms，实际 FFprobe/FFmpeg 检查完成时过期。三个失败均为期望根因，无 mock probe。

```text
 RUN  v5.0.3 C:/Users/DELL/OneDrive/Desktop/funwork

 ❯ tests/integration/resolver.test.ts (10 tests | 3 failed | 7 skipped) 4092ms
   × expiry during real media verification refreshes once and verifies the fresh bytes 971ms
   × expiry refresh is shared across before-check and during-check expiry; ordinary failures do not retry 758ms
   × expiry refresh remains within the total budget and responds to cancellation 751ms

 FAIL  tests/integration/resolver.test.ts > expiry during real media verification refreshes once and verifies the fresh bytes
Error: 没有可确认的完整音源。one/128k: 核验期间链接已过期
 ❯ PlaybackResolver.resolve src/main/playback/resolver.ts:67:13
 ❯ tests/integration/resolver.test.ts:111:18

 FAIL  tests/integration/resolver.test.ts > expiry refresh is shared across before-check and during-check expiry; ordinary failures do not retry
AssertionError: expected 1 to be 2 // Object.is equality
- Expected: 2
+ Received: 1
 ❯ tests/integration/resolver.test.ts:124:19

 FAIL  tests/integration/resolver.test.ts > expiry refresh remains within the total budget and responds to cancellation
AssertionError: expected [Function] to throw error matching /预算/ but got '没有可确认的完整音源。one/128k: 核验期间链接已过期'
- Expected: /预算/
+ Received: "没有可确认的完整音源。one/128k: 核验期间链接已过期"
 ❯ tests/integration/resolver.test.ts:142:185

 Test Files  1 failed (1)
      Tests  3 failed | 7 skipped (10)
   Start at  17:35:44
   Duration  8.10s (tests 56%, import 40%, transform 3%, worker 1%)
```

命令：`npm run test:e2e -- tests/e2e/lx-lifecycle.spec.ts`，退出 1。使用已构建、未修复的真实 Electron；搜索元数据为受控响应，LX 隐藏 renderer、IPC、HTTP、媒体核验与播放真实执行。

```text
> music-workbench@0.1.0 test:e2e
> playwright test tests/e2e/lx-lifecycle.spec.ts

Running 3 tests using 1 worker
(node:38448) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  x 1 same hidden LX source survives online A to B cancellation and late replies; old watchers cannot kill re-enabled runtime (11.1s)
(node:38720) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
  x 2 closing the actual main window exits Electron even while an LX hidden window is enabled (6.3s)
(node:39536) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
  x 3 cancelled infinite-loop source still reaches its external watchdog while local playback and another source survive (1.9s)

1) tests/e2e/lx-lifecycle.spec.ts:56:5
Error: expect(locator).toHaveAttribute(expected) failed
Locator: locator('.player-bar')
Expected: "playing"
Received: "error"
Timeout: 5000ms
Call log:
  - Expect "toHaveAttribute" locator('.player-bar') with timeout 5000ms
  - waiting for locator('.player-bar')
    14 × locator resolved to <section aria-label="播放控制" class="player-bar" data-status="error">…</section>
       - unexpected value "error"
  at tests/e2e/lx-lifecycle.spec.ts:63:64

2) tests/e2e/lx-lifecycle.spec.ts:80:5
Error: expect(received).toBe(expected) // Object.is equality
Expected: 0
Received: null
Call Log:
  - Timeout 5000ms exceeded while waiting on the predicate
  at tests/e2e/lx-lifecycle.spec.ts:85:80

3) tests/e2e/lx-lifecycle.spec.ts:89:5
Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
  at tests/e2e/lx-lifecycle.spec.ts:101:87

3 failed
  same hidden LX source survives online A to B cancellation and late replies; old watchers cannot kill re-enabled runtime
  closing the actual main window exits Electron even while an LX hidden window is enabled
  cancelled infinite-loop source still reaches its external watchdog while local playback and another source survive
```

三个 RED 分别证明 B 实际播放器 error、关闭主窗口后进程仍存活、取消后源立即 disabled。后续增强 watchdog 测试用真实 HTTP `/started` 确认 handler 已进入；导入第二个隐藏真实源，证明另一源还能完整核验。正常迟到与重新启用场景各跨越原 15 秒 deadline，证明清理和 generation 隔离的实际行为。

### GREEN — 定向验证结果

命令：`npx vitest run tests/integration/resolver.test.ts`，退出 0。

```text
 RUN  v5.0.3 C:/Users/DELL/OneDrive/Desktop/funwork

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  17:38:42
   Duration  7.64s (tests 97%, transform 2%, import 1%)
```

新增到期三条覆盖：核验中到期后仅刷新一次、新资源实际 codec=mp3、代理 bytes 等于真实新 MP3 文件；核验前/中到期共用一次额度，连续到期不会第三次解析，普通截断媒体只解析一次；刷新下载期间总预算或显式取消都及时结束。原文件内六组合上限、严格质量与普通来源失败回归继续通过。

命令：`npm run build`，退出 0。普通非 TTY 构建，完整相关输出：

```text
> music-workbench@0.1.0 build
> electron-vite build

vite v7.3.6 building ssr environment for production...
transforming...
✓ 26 modules transformed.
rendering chunks...
out/main/index.js  92.53 kB
✓ built in 226ms
vite v7.3.6 building ssr environment for production...
transforming...
node_modules/zod/v4/core/util.js (400:0): A comment
"// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a top-level initializer that contains a member access on `Number`, so the bare object literal survived into every bundle."
in "node_modules/zod/v4/core/util.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
node_modules/zod/v4/core/regexes.js (74:0): A comment
"/** Anchors a pattern source. The interpolation lives here rather than at the call site because
 * esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
 * will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */"
in "node_modules/zod/v4/core/regexes.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
✓ 100 modules transformed.
rendering chunks...
out/preload/index.js  206.27 kB
✓ built in 469ms
vite v7.3.6 building client environment for production...
transforming...
node_modules/zod/v4/core/regexes.js (74:0): A comment
"/** Anchors a pattern source. The interpolation lives here rather than at the call site because
 * esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
 * will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */"
in "node_modules/zod/v4/core/regexes.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
node_modules/zod/v4/core/util.js (400:0): A comment
"// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a top-level initializer that contains a member access on `Number`, so the bare object literal survived into every bundle."
in "node_modules/zod/v4/core/util.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
✓ 140 modules transformed.
rendering chunks...
../../out/renderer/index.html                   0.69 kB
../../out/renderer/assets/index-Cmm_aK8e.css   21.77 kB
../../out/renderer/assets/index-1RuY2313.js   922.73 kB
✓ built in 1.46s
```

命令：`npm run test:e2e -- tests/e2e/lx-lifecycle.spec.ts tests/e2e/lx-isolation.spec.ts`。产品行为三项通过，关闭测试首次 GREEN 尝试暴露 Playwright 清理错误：app 退出后调用 app.process() 失效，导致测试失败；没有隐藏这次失败。

```text
> music-workbench@0.1.0 test:e2e
> playwright test tests/e2e/lx-lifecycle.spec.ts tests/e2e/lx-isolation.spec.ts

Running 4 tests using 1 worker
(node:31856) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok 1 tests/e2e/lx-isolation.spec.ts:9:5 › hidden LX sandbox resolves real HTTP media, keeps local playback alive after infinite loops and isolates bridges (26.6s)
  ok 2 tests/e2e/lx-lifecycle.spec.ts:63:5 › same hidden LX source survives online A to B cancellation and late replies; old watchers cannot kill re-enabled runtime (33.5s)
  x 3 tests/e2e/lx-lifecycle.spec.ts:90:5 › closing the actual main window exits Electron even while an LX hidden window is enabled (1.4s)
(node:35120) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
  ok 4 tests/e2e/lx-lifecycle.spec.ts:99:5 › cancelled infinite-loop source still reaches its external watchdog while local playback and another source survive (16.9s)

1) tests/e2e/lx-lifecycle.spec.ts:90:5 › closing the actual main window exits Electron even while an LX hidden window is enabled
TypeError: Cannot read properties of undefined (reading '_object')
  at Object.cleanup (tests/e2e/lx-lifecycle.spec.ts:60:31)
  at tests/e2e/lx-lifecycle.spec.ts:96:29

1 failed
  closing the actual main window exits Electron even while an LX hidden window is enabled
3 passed (1.3m)
```

只修正测试：启动后立即捕获真正的 ChildProcess；通过 100ms timer 执行真实主窗口 close，让 IPC evaluate 先返回；退出断言/清理使用已捕获 child。未改产品。定向重跑：`npm run test:e2e -- tests/e2e/lx-lifecycle.spec.ts -g 'closing the actual main window'`，退出 0。

```text
> music-workbench@0.1.0 test:e2e
> playwright test tests/e2e/lx-lifecycle.spec.ts -g closing the actual main window

Running 1 test using 1 worker
(node:40156) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok 1 tests/e2e/lx-lifecycle.spec.ts:91:5 › closing the actual main window exits Electron even while an LX hidden window is enabled (1.5s)

1 passed (2.0s)
```

最终 `npm run typecheck`，退出 0：

```text
> music-workbench@0.1.0 typecheck
> tsc --noEmit
```

最终覆盖结论：resolver 10/10；LX 相关四条行为均有通过证据，其中关闭窗口在测试生命周期修正后定向 1/1 通过。遵循本轮指令，只运行覆盖改动的 focused 检查和 typecheck/build，未重跑已通过的完整旧基线。

### 自审、限制与清理

自审核对 owned diff、普通取消/超时各自副作用、迟到消息清理、stop 迭代清理 pending、captured generation、总预算共用和刷新后 bytes 绑定。未派发任何子 Agent/reviewer。`git diff --check` 对 owned 文件退出 0，仅 Git LF→CRLF 提示；`git diff --cached --check` 退出 0、无输出，暂存清单准确为上述八个责任文件。

真实第三方源仍未配置，三平台整曲、真实签名 URL、人工试听保持 pending；本轮只将本地 HTTP、真实 Electron/FFmpeg 软件执行记为通过。review 的安全诊断 Minor 未在本轮扩展；既有 Zod PURE、NO_COLOR/FORCE_COLOR 噪声保留说明，交 Task 7。

测试成功路径关闭 Electron、HTTP server 并删除临时素材，核验服务 finally 清理下载目录。退出测试首次清理错误遗留唯一目录 `C:\Users\DELL\AppData\Local\Temp\lx-lifecycle-gTlB9N`，已用 Resolve-Path 核对其绝对路径位于 Temp 后以 Remove-Item -LiteralPath 删除，Test-Path=False。没有删除原音乐或用户数据。Playwright 失败 trace 在后续定向运行时由 runner 清理；报告保留完整相关失败说明，不保留无用临时文件。同步副本 `.superpowers/sdd/2026-10-03-music-player-implementation/task-5-report.md` 仍按既有忽略规则只作本地交接，不 force-add。
