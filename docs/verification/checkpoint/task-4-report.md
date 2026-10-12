# Task 4 — 聚合搜索与来源独立状态

状态：DONE_WITH_CONCERNS（实现、当日公开搜索与本地回归完成；接口稳定性和真实完整播放边界见末尾）。

产品 baseline：`9fa678dc719680d823735dbf6734b9fdb07d910c`。执行期间主 Agent 的文档提交与未提交文档更改未纳入本任务。产品 commit：`2ed63cc0a02a2ab53c9c0f1d06fcd7fd0a251d95`，`feat: aggregate music search with independent source state`，25 files、1583 insertions、8 deletions。提交前 `git diff --cached --check` exit 0；提交后 owned 产品/测试/probe/package 文件无剩余改动，仅主 Agent 的 docs 仍未提交。报告与截图为 ignored 工作证据，未强制加入 Git。

## 已完成要求与边界

- `SearchQuery`、`SearchPage`、`SearchProvider`、`SearchResult` 和每源 `SearchSnapshot` 契约及 Zod 校验。保留约定的最终 `ok/empty/timeout/rate-limited/error` 状态；事件另外允许 `loading`，取消状态由界面立即呈现。
- wy/kg/tx 同时请求，各源 8000 ms 预算，完成即独立发送经过校验的 `search.updated`。失败不清空其他源结果；HTTP 429 为限流，其他 HTTP/业务拒绝或 malformed envelope 为 error。合法空数组为 empty。
- `ProviderRegistry.registerSearch` 可注册额外来源；测试使用 `extra` 搜索，不改 PlayerEngine。kw/mg 名字在 UI 映射中预留，注册表允许后续实现按 ID 注册，未注册的来源不会被请求。
- 缓存按 `[providerId,text,page,pageSize,authRevision]` 分隔，5 分钟 TTL、最多 128 页；账号 revision 变化清空，旧 revision 在途响应不写入新缓存。缓存与事件使用独立 DTO 副本。
- 连续 3 次来源失败，自动请求暂缓 60000 ms；手动重试绕过暂缓与缓存，成功恢复。取消不计为失败；并发失败按完成顺序累积。
- named IPC `search.run/search.cancel/search.providers`；requestId 映射 AbortController，校验输入、返回和事件。保留已有可信 sender/webContents/mainFrame/URL 校验、production CSP、dev style nonce 和单个自包含 sandbox preload。
- React 搜索视图提供各来源即时状态、顶部状态概览、独立重试与分页；取消/换词/离开界面后迟到响应忽略。一个来源翻页后，原聚合搜索的另一来源迟到完成不会把其页面回退。
- 保留平台 songId 与原始 title/suffix/album/hash/media identity。明确版本由既有 inferTrackVersion 判定，原始 versionDisplay 保留；无证据为 unknown，不推断 studio。同名 live/studio 不合并，信息不足的曲目分别显示。缺必须身份/标题/歌手单项跳过，缺 duration 为 null；renderer 不得到 raw JSON、cookie、token、URL 或网络能力。
- 远程曲目每条显示“完整播放：尚未解析”，没有播放按钮、audioAssetId 或质量声称。未实现 Task 5 resolver/LX、导出或 AI。
- 按主 Agent 补充指令集成本地标题/歌手/专辑过滤，搜索中的本地结果可沿既有本地播放接口播放；真实 Electron 覆盖导入、搜索、播放和同词重复侧栏提交。

必要 integration 文件：`src/shared/contracts.ts`、`src/shared/schemas.ts`、`src/main/index.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`src/renderer/styles.css`、`package.json`、`package-lock.json`。探针直接声明并锁定已安装的 `esbuild@0.25.12`，仅修改 lock root 的 devDependency，未改其他依赖版本。

## TDD 与实际命令证据

使用 test-driven-development（含 writing-good-tests.md）与 verification-before-completion。未委派 subagent/reviewer。

1. 首次运行 `npm run test:unit -- tests/unit/search-service.test.ts` 和 `npm run test:integration -- tests/integration/search-adapters.test.ts` 被默认 sandbox `spawn EPERM` 阻止。经 exec_command require_escalated 审批重跑，最先确认模块缺失；这是环境/模块诊断，不记为业务 RED。
2. 加入仅抛 Not implemented 的入口 scaffold 后，上述命令分别出现 `5 failed (5)` 和 `14 failed | 12 passed (26)`。业务覆盖一源 timeout、逐源即时更新、取消迟到响应、缓存隔离、3 次失败暂停、额外来源/版本身份，以及三源解析正常/空/缺 envelope/限流/非 JSON/transport/abort 和中文请求参数。最初 service RED 中尚无事件，超时测试还产生一条未处理 scaffold rejection；测试随即补 catch，并按空数组断言缺失更新，GREEN 无该错误。
3. `npm run test:unit -- tests/unit/search-service.test.ts tests/integration/search-adapters.test.ts` 最初 GREEN：`19 passed (19)`，typed IPC 和 observed fixture 接入后 `23 passed (23)`。逐平台缺 identity/null duration/8 秒 transport timeout 与取消不熔断补齐后 `30 passed (30)`。
4. named IPC RED：`npm run test:unit -- tests/unit/search-service.test.ts -t 'named search IPC'`，期望 `search.providers=['wy']`，实际拒绝“曲库尚未初始化”；接线后该测试 GREEN，并覆盖 invalid params、untrusted frame、重复 requestId 与 cancellation。
5. 真实 Electron UI RED：`npm run build` 后 `npm run test:e2e -- tests/e2e/search.spec.ts`，三个新流程因缺在线搜索入口/侧栏输入仍 disabled 而失败。接入 UI 后，测试网络替身起初没有截获 factory 提前绑定的 global fetch，两个测试失败并返回真实在线结果；调整默认 transport 为实际请求时取 main global fetch 后，测试保持真实 Electron/preload/router/service/adapters，只替换网络，三项 GREEN：`3 passed (11.6s)`。这是测试 transport 接线诊断，不把该次结果当独立真实 probe。
6. 顶部来源概览 RED：`npm run test:e2e -- tests/e2e/search.spec.ts -g 'real Electron search renders'`，缺 `来源状态 / 酷狗 搜索中` 可见按钮；补概览后四项搜索 Electron GREEN：`4 passed (12.5s)`。
7. 自审回归 RED：重复侧栏相同关键词提交，`npm run test:e2e -- tests/e2e/search.spec.ts -g 'search includes imported'`，本地晴天未重新显示；每次侧栏提交增加搜索 revision、重新建立搜索生命周期后 GREEN。并发失败计数 RED：`npm run test:unit -- tests/unit/search-service.test.ts -t 'failures completed from overlapping'`，确定性结果 `Expected SOURCE_PAUSED / Received SEARCH_TIMEOUT`（最初测试自身等待超时已改用 fake timers，不记为业务 RED）；改为完成时读取来源当前计数后 focused `31 passed (31)`。
8. 最终 fresh commands（2026-10-04 香港 18:38–18:40）：

```text
npm run typecheck
> tsc --noEmit
exit 0

npm run build
out/main/index.js 55.40 kB
out/preload/index.js 199.80 kB
renderer built; exit 0

npm test
test:unit: 9 files passed; 88 tests passed
test:integration: 4 files passed; 35 tests passed
test:e2e: 16 passed (52.5s)
exit 0
```

现有 `test:unit` 的 include 同时包含 unit 和 integration，35 integration 中部分已在 88 个测试里运行，不把 88+35 声称为独立 123 个测试。Electron 全套包括既有 boot safe bridge、dev CSP、曲库和本地播放/音效/生命周期回归，以及新增四项搜索。最终无测试失败。build 的 Zod 上游 `@__PURE__` 注释警告和 Playwright `NO_COLOR/FORCE_COLOR` 警告仍存在，无编译或测试错误；未为此改第三方源码或环境配置。

已检查 production preload 输出只有 `out/preload/index.js`，运行时 `require` 只使用 `electron`；实际 boot 与 search 的 renderer require/process 均为 undefined。`git diff --check` 通过（Git CRLF 提示无内容错误）。

## 当日真实 probe 与 fixture 区分

核实固定 primary source SHA `ad95d5091c9ed689fa72b5e5c849df65f5a679ce` 的 LX 官方 wy/kg/tx search、wy eapi、tx zzcSign/request 文件。web raw 打开 cache miss 后，默认 PowerShell 网络连接被 sandbox 拒绝；经 require_escalated 实际读取 GitHub official raw，未猜测签名/请求体。实现使用支持的 HTTPS 地址。

- [wy official search](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/wy/musicSearch.js)
- [wy eapi](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/wy/utils/crypto.js)
- [kg official search](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/kg/musicSearch.js)
- [tx official search](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/tx/musicSearch.js)
- [tx signature](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/tx/utils/crypto.js)

实际执行 `npm run probe:sources -- --query 周杰伦`：page=1、pageSize=5、三源各一次、AbortSignal.timeout(8000)、无登录/cookie、无音频解析或下载。

首次 2026-10-04T10:19:06Z：wy/kg/tx 均 HTTP 200、count=5，total=272/480/999。最终命令 2026-10-04T10:38:23Z（香港 18:38:23），stdout：

```json
{"date":"2026-10-04T10:38:23.217Z","providerId":"kg","httpStatus":200,"status":"ok","count":5,"total":480,"fullPlayback":"尚未解析"}
{"date":"2026-10-04T10:38:23.198Z","providerId":"wy","httpStatus":200,"status":"ok","count":5,"total":273,"fullPlayback":"尚未解析"}
{"date":"2026-10-04T10:38:23.235Z","providerId":"tx","httpStatus":200,"status":"ok","count":5,"total":999,"fullPlayback":"尚未解析"}
```

最终 fixture 保存最新真实响应的必要字段与原始身份、query、HTTP/MIME、时间和 observed 标签，allowlist 脱敏；排除 cookies/accounts/tokens/URL/playable links：

- `tests/fixtures/providers/wy-search.json`：code=200、JSON、第一曲 id=509781655，“想你就写信 (Live)”、dt=238698。
- `tests/fixtures/providers/kg-search.json`：error_code=0、text/plain JSON、第一曲 Audioid=20505418、“晴天”、Duration=269。
- `tests/fixtures/providers/tx-search.json`：outer/req code=0、text/plain JSON、第一曲 mid=0039MnYb0qxYhV、“晴天”、interval=269。
- `tests/fixtures/providers/probe-latest.json`：completedAt=2026-10-04T10:38:23.547Z、三源结果与脱敏响应。

空、缺字段、HTTP429、非 JSON、transport、timeout 是 test 中明确标注的 synthetic 情形，不是当天平台行为。Electron 中迟到/超时/限流也是受控 main 网络 fixture，实际 IPC/UI 本地回归；真实联网证据以以上 dated probe 为准。wy total 从 272 变 273 是两次真实搜索之间的动态变化。

探针入口最初 ESM .ts 产生 typeless warning；一次消除警告的启动 flag 在当前 Node v24.11.1 不受支持，报 `node: bad option`，未发网络请求。最终改为 CommonJS .ts 包裹 async main，使用原 `node scripts/probe-sources.ts`，最终执行 exit 0 且无该 warning。esbuild offline lock-only install 因 npm metadata ENOTCACHED 失败，后经批准 lock-only online 方式成功，不执行依赖脚本。

## 截图与清理

- `C:/Users/DELL/OneDrive/Desktop/funwork/.superpowers/sdd/2026-10-03-music-player-implementation/task-4-independent-ui.png`：真实 Electron、顶部 wy 已完成/kg 搜索中/tx 请求受限；通过 view_image 检查，固定播放器、版式和来源概览无截断。
- `C:/Users/DELL/OneDrive/Desktop/funwork/.superpowers/sdd/2026-10-03-music-player-implementation/task-4-search-ui.png`：失败重试后 kg 第二页，wy 第一页独立保留，远程状态尚未解析。

以上是 fixture 驱动界面证据，不冒充完整音频或真实网络截图。`.superpowers` 是仓库忽略的本地工作证据，报告与截图保留供独立 reviewer 读取。probe 的临时 bundle 目录在 finally 清理，Electron tests 的临时 userData/audio 文件均在 finally 清理；未删除其他 Agent 的文件。

## 自审与 concerns

已逐项核对 brief、代码 diff、真实 probe、focused/full checks 和截图。只 stage 本任务 owned 文件；主 Agent docs 不 stage。不新增 resolver/LX/导出、不修改 PlayerEngine/CSP/FFmpeg。

公开搜索接口来自 LX 实际适配源码，平台没有向本项目保证稳定契约；当日两轮成功证明当前公开搜索，不证明长期可用。今日未真实观察 empty/timeout/rate-limit（对应 synthetic 测试明确区分）。用户暂未提供真实 LX 音源，远程完整播放尚未解析/验证，Task 5 后续负责。没有本任务未修复的已知 correctness failure。
