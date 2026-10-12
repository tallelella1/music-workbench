# Windows 音乐播放器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可安装的 Windows 音乐播放器，完成本地播放与编辑、多平台搜索、完整音源检查和可扩展音源接入。

**Architecture:** 主进程持有素材、存储、网络和导出服务，preload 暴露经校验的具体操作，React 界面消费统一契约。PlayerEngine 使用 HTMLMediaElement 与 Web Audio；平台适配、LX 宿主和播放资源检查独立于播放器。文件资源使用不透明 ID 和自定义协议，离线处理由受控 FFmpeg 工作进程执行。

**Tech Stack:** Electron、React、TypeScript、electron-vite、Zod、music-metadata、Web Audio、FFmpeg/ffprobe、Vitest、Playwright、electron-builder。安装前查询维护中的稳定版本并确认 Node `v24.11.1` 兼容，提交 `package-lock.json`；不使用未经确认的版本号。

**Spec:** [Windows 音乐播放器设计](../specs/2026-10-03-music-player-design.md)。本文仅实施基础播放器交付单元；创作服务见另外两个计划。

## Global Constraints

- “用户明确要求完整曲目播放，不提供试听播放或用试听代替完整音源。”
- “Electron 渲染页面启用 contextIsolation 和进程沙箱，不启用 Node 集成。”
- “所有跨边界数据在运行时校验结构，编译期 TypeScript 类型不能替代运行时检查。”
- “首版提供 10 段均衡器、音色预设和混响。”
- “0.5–2 倍播放速度及保持音高由 PlayerEngine 管理。”
- “元数据时长比较首版采用不超过 5 秒的差异；未知时长不能仅靠此条件通过。”
- “移除曲库条目不删除原始音乐；编辑导出通过保存对话框生成新的输出文件。”
- 搜索重点为网易云 `wy`、酷狗 `kg`、QQ `tx`；`kw`、`mg` 预留注册位置。FLAC 或 Hi-Res 标签不能由转码获得。
- 音频输出 MP3（128/320 kbps）、FLAC、WAV（按实际编码器提供位深）；新功能模块使用内置注册表。

## Review Focus

- 中文、空格、emoji 文件名及 Windows 长路径：导入和导出可用，错误按文件返回；任务 2/6 测试。
- 同名但不同歌手/版本的歌曲：分别保留，不按标题去重或自动换源；任务 2/5 测试。
- 换搜索词或快速切歌时旧响应最后返回：当前结果与当前播放保持一致；任务 4/5 测试。
- 真正短曲、未知时长和标有试听的资源：短曲能通过可靠检查，后两类不被误判为完整；任务 5 测试。
- 存储损坏、更新版本结构或导出时取消：保留原始数据和音乐，清理本次临时输出；任务 2/6 测试。

---

## 文件与公共数据

`src/shared/` 保存契约、Zod schema 和事件；`src/main/` 保存宿主服务；`src/preload/` 保存具体桥接方法；`src/renderer/` 保存界面与音频节点；`tests/` 按单元/集成/Electron 流程分开。独立来源放在 `src/main/providers/<id>/`，不向 PlayerEngine 引入平台字段。

公共类型由任务 1 定义：

- `RequestContext = { requestId: string; signal: AbortSignal }`，仅进程内使用；IPC 使用 requestId，由宿主创建 AbortController。
- `TimeRange = { startSeconds: number; endSeconds: number }`，满足 `0 <= start < end <= duration`。
- `Track = { id: string; title: string; artists: string[]; album: string | null; version: string; durationSeconds: number | null; artworkAssetId: string | null; audioAssetId: string | null; sources: ProviderTrackRef[] }`。
- `ProviderTrackRef = { providerId: string; songId: string; identity: Record<string, string | number | null> }`；version 规范化为 studio/live/cover/instrumental/remix/unknown，保留展示原值。
- `AssetRecord = { id: string; kind: 'audio' | 'image'; hash: string; byteLength: number; media: MediaProbe; parentAssetId: string | null }`。绝对路径仅存在宿主 `AssetRegistry`，不进入 renderer DTO。
- `MediaProbe = { durationSeconds: number | null; durationReliable: boolean; codec: string; sampleRate: number | null; channels: number | null; bitDepth: number | null; bitrate: number | null; width: number | null; height: number | null }`。
- `AppError = { code: string; message: string; moduleId: string; requestId: string | null }`；事件统一为 `{ type; contractVersion: 1; resourceId; requestId; payload }`。
- `JobSnapshot<T> = { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: number | null; result: T | null; error: AppError | null }`。
- progress 为 0..1 的有限值，不能测量时为 null；所有 expiresAt 用 Unix epoch 毫秒，并由宿主与 Date.now() 比较。

### Task 1: 可启动的桌面应用与应用契约

**Files:** Create `package.json`, `package-lock.json`, `.gitignore`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `src/shared/contracts.ts`, `src/shared/schemas.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/jobs/task-service.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`, `tests/e2e/boot.spec.ts`, `tests/unit/contracts.test.ts`, `tests/helpers/desktop.ts`, `tests/helpers/fixtures.ts`。

**Interfaces:**
- Produces: `TaskService.start<T>(work: (ctx: RequestContext, report: (progress: number) => void) => Promise<T>): string`, `get<T>(jobId: string): JobSnapshot<T>`, `cancel(jobId: string): void`。
- Produces: `window.musicApp` 的具名命名空间 `library/search/playback/effects/export/jobs/settings/extensions/assets`；每个方法在对应任务添加。只提供受限制的 `onEvent(listener): () => void`，不提供任意 channel、路径读取或命令执行。
- Produces: `TrackSchema`, `AssetRecordSchema`, `TimeRangeSchema`, `AppErrorSchema` 与 `JobSnapshotSchema`；契约默认拒绝未知操作字段。
- Produces: `launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }>`、`makeTrack(overrides?: Partial<Track>): Track`、`makeAudioFile(options: { directory: string; name: string; durationSeconds: number; toneHz: number }): Promise<string>` 测试工具。

- [x] **Step 1:** 为契约输入与桌面启动写测试：Track 的负时长失败，未知 IPC 方法与外部 sender 失败，任务取消后 late resolve 不改变 cancelled，窗口显示“音乐库”和固定播放条，`window.require`/`window.process` 不存在。

```ts
test('negative duration fails runtime validation', () => {
  expect(TrackSchema.safeParse(makeTrack({ durationSeconds: -1 })).success).toBe(false)
})
```
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/contracts.test.ts` 与 `npm run test:e2e -- tests/e2e/boot.spec.ts`，记录缺少模块/启动入口导致的预期失败；脚手架安装不作为功能通过。
- [x] **Step 3:** 用 `npm view <package> version engines --json` 确定稳定版本，再建立精确依赖与锁文件；实现上述契约、任务与 sender/schema 校验。窗口显式设置 contextIsolation/sandbox=true、nodeIntegration=false；拒绝外部导航和新窗口。布局为左侧曲库导航、中部内容、底部播放条、可打开的右侧音效面板，用户界面使用简体中文。
- [x] **Step 4:** 运行 `npm run typecheck`、上述测试与 `npm run build`；确认打包后的应用可启动、窗口不是测试替身。创建 `npm run test:unit`、`test:integration`、`test:e2e`、`build`、`dist:win` 脚本，后续任务使用这些命令。
- [x] **Step 5:** 提交任务 1 文件，commit message：`feat: bootstrap sandboxed music desktop app`。

### Task 2: 素材、曲库、收藏和歌单持久化

**Files:** Create `src/main/assets/asset-registry.ts`, `src/main/assets/media-probe.ts`, `src/main/library/library-service.ts`, `src/main/storage/repository.ts`, `src/main/storage/migrations.ts`, `src/shared/library.ts`, `src/renderer/features/library/LibraryView.tsx`, `src/renderer/features/library/PlaylistView.tsx`, `resources/media-runtime.json`, `tests/unit/storage.test.ts`, `tests/integration/library.test.ts`, `tests/e2e/library.spec.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`。

**Interfaces:**
- Consumes: 任务 1 公共类型、事件与任务服务。
- Produces: `AssetRegistry.importFile(path: string, kind: AssetRecord['kind'], ctx: RequestContext): Promise<AssetRecord>`，`get(assetId: string): Promise<AssetRecord>`，`openRead(assetId: string): Readable`；路径只由本地对话框或经 preload 的 `webUtils.getPathForFile` 验证的拖拽产生。
- Produces: `probeMedia(path: string, ctx: RequestContext): Promise<MediaProbe>`；music-metadata 读取标签/封面，ffprobe 检查媒体；解码能力失败按文件返回。
- Produces: `LibraryService.importPaths(paths: string[], ctx: RequestContext): Promise<{ tracks: Track[]; errors: AppError[] }>`，`list(): Promise<LibrarySnapshot>`，`setFavorite(trackId: string, favorite: boolean): Promise<void>`，`createPlaylist(name: string): Promise<Playlist>`，`updatePlaylist(id: string, trackIds: string[]): Promise<void>`，`removeTrack(id: string): Promise<void>`。
- Produces: `Playlist = { id: string; name: string; trackIds: string[] }`；`LibrarySnapshot = { schemaVersion: 1; tracks: Track[]; favorites: string[]; playlists: Playlist[] }`；`StorageRepository.read<T>(moduleId: string, schema: ZodType<T>, initialValue: T): Promise<T>`、`write<T>(moduleId: string, value: T, schema: ZodType<T>): Promise<void>`。initialValue 只用于 ENOENT 首次创建，解析或版本错误不得回退为默认值。

- [x] **Step 1:** 写测试：重复导入相同内容不增加曲目；同标题不同版本保留；中文/emoji/空格路径可导入；移除条目后原文件仍存在；并发收藏/歌单写入重开后完整。损坏文件保留原字节，新于支持版本的数据拒绝写入，迁移失败备份与原数据均可读取。

```ts
test('repeat imports preserve identity and removal preserves source', async () => {
  const first = await library.importPaths([samplePath], ctx)
  const second = await library.importPaths([samplePath], ctx)
  expect(second.tracks[0].id).toBe(first.tracks[0].id)
  await library.removeTrack(first.tracks[0].id)
  expect(await readFile(samplePath)).toEqual(originalBytes)
})
```
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/storage.test.ts`、`npm run test:integration -- tests/integration/library.test.ts`，确认未实现失败。
- [x] **Step 3:** 从 FFmpeg 官方下载页所链接的 Windows 构建取得同版本 ffmpeg/ffprobe，记录版本、来源 URL、SHA-256 与许可证至 `resources/media-runtime.json`，放置于 `resources/bin/`；开发与打包均使用该路径，不依赖 PATH。实现注册表、哈希去重、目录导入与逐文件错误。数据存于 Electron userData 的 library/settings/extensions 三个模块文件；同模块串行写入、同目录临时文件后原子替换；迁移先备份、逐版本校验，未知版本不重建空数据。实现文件/文件夹/拖拽导入，收藏、歌单增删与排序、按专辑聚合。
- [x] **Step 4:** 运行上述测试及 `npm run test:e2e -- tests/e2e/library.spec.ts`；Electron 真实导入生成的 WAV、加入歌单、关窗重启，核对收藏与顺序。验证 MP3/FLAC/M4A 样本按实际能力导入。
- [x] **Step 5:** 提交该任务变更，commit message：`feat: persist local library and playlists without changing originals`。

### Task 3: 本地播放、队列与实时音效

**Files:** Create `src/main/assets/media-protocol.ts`, `src/shared/player.ts`, `src/shared/effects.ts`, `src/shared/effect-registry.ts`, `src/shared/impulse-response.ts`, `src/renderer/audio/player-engine.ts`, `src/renderer/audio/player-controller.ts`, `src/renderer/audio/effect-chain.ts`, `src/renderer/features/player/PlayerBar.tsx`, `src/renderer/features/player/QueueView.tsx`, `src/renderer/features/effects/EffectsPanel.tsx`, `tests/unit/player-queue.test.ts`, `tests/integration/effect-chain.test.ts`, `tests/e2e/playback.spec.ts`; Modify `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`。

**Interfaces:**
- Produces: `MediaResourceRegistry.issueLocal(assetId: string): Promise<PlaybackResource>`；`PlaybackResource = { resourceId: string; url: string; assetId: string | null; probe: MediaProbe; actualQuality: string; expiresAt: number | null }`，url 是主进程签发的短期 `media://` 句柄。
- Produces: `PlayerEngine.load(resource: PlaybackResource, track: Track, requestId: string): Promise<void>`、`play(): Promise<void>`、`pause(): void`、`seek(sourceSeconds: number): void`、`setRate(rate: number, preservePitch: boolean): void`、`setQueue(trackIds: string[], currentIndex: number): void`、`setVolume(value: number): void`、`snapshot(): PlayerSnapshot`、`subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void`。
- Produces: `PlayerEngine.nextTrackId(): string | null`、`previousTrackId(): string | null`、`setRepeat(mode: 'off' | 'all' | 'one'): void`、`setShuffle(enabled: boolean): void`；队列只选择 ID，不执行平台解析。`PlayerController.playTrack(track: Track, options: { quality: string; strict: boolean }): Promise<void>` 调用具名桥接 `musicApp.playback.resolve(track, options, requestId)` 并加载结果；快速切歌先调用 `musicApp.playback.cancel(requestId)`，旧结果不执行 load。任务 3 只解析本地，任务 5 在相同宿主方法中加入在线 resolver。
- `PlayerSnapshot = { trackId: string | null; status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'; sourceSeconds: number; durationSeconds: number; rate: number; preservePitch: boolean; volume: number; repeat: 'off' | 'all' | 'one'; shuffle: boolean; actualQuality: string | null; revisionId: string | null }`。
- Produces: `EffectConfig = { effectId: string; paramVersion: number; enabled: boolean; params: Record<string, unknown> }`；`EffectRegistry.register(definition: EffectDefinition): void`、`validate(config: EffectConfig, purpose: 'realtime' | 'export'): EffectConfig`、`EffectChain.apply(configs: EffectConfig[]): void`、`bypass(value: boolean): void`。
- `EffectDefinition = { id: string; paramVersion: number; schema: ZodType; defaults: Record<string, unknown>; realtime: boolean; export: boolean }`；`createImpulseResponse(sampleRate: number, decaySeconds: number, seed: number): Float32Array[]` 为预览/导出共享实现。
- 注册 `eq-10` v1：`{ gainsDb: number[]; preampDb: number }`，gainsDb 恰 10 项、gain -12..12 dB、preamp -24..12 dB；注册 `reverb` v1：`{ wet: number; decaySeconds: number; seed: number }`，wet 0..1、decay 0.1..5 秒、seed uint32。默认 EQ 全 0、preamp=0，reverb wet=0、decay=1.5、seed=1；首版预设记录这两个 effectId 与参数版本。

- [x] **Step 1:** 写队列、句柄与音效测试：上一/下一、随机不丢条目、单曲循环正确；暂停/定位后 sourceSeconds 正确；过期句柄不能读资源，Range 请求支持末尾定位；10 段 EQ 增益越界被拒绝、旁路恢复原输出、失败效果退出后主链仍发声。

```ts
test('EQ gain above 12 dB is rejected', () => {
  const config = { effectId: 'eq-10', paramVersion: 1, enabled: true,
    params: { gainsDb: [13, 0, 0, 0, 0, 0, 0, 0, 0, 0], preampDb: 0 } }
  expect(() => registry.validate(config, 'realtime')).toThrow()
})
```
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/player-queue.test.ts`、`npm run test:integration -- tests/integration/effect-chain.test.ts`，确认核心行为失败。
- [x] **Step 3:** 实现 HTMLMediaElement + MediaElementAudioSourceNode，音效频率 `[31,62,125,250,500,1000,2000,4000,8000,16000]` Hz、增益 -12..12 dB；低于 Nyquist 的频段才声明可用。混响用共享固定种子脉冲和干湿通道；参数用 AudioParam 平滑变更。速度由 playbackRate/preservesPitch 控制。自定义协议使用 `protocol.handle` 和流权限，只解析已签发 ID，不解析用户输入路径。
- [x] **Step 4:** 运行上述检查及 `npm run test:e2e -- tests/e2e/playback.spec.ts`；使用 440 Hz WAV 检查 0.5/1/2 倍播放时长，保持音高开启/关闭的频谱结果；离线节点渲染证明 EQ 与混响实际改变采样，保留人工试听记录。
- [x] **Step 5:** 提交该任务变更，commit message：`feat: play local music with queue and realtime effects`。

### Task 4: 聚合搜索与来源独立状态

**Files:** Create `src/shared/providers.ts`, `src/main/search/search-service.ts`, `src/main/providers/registry.ts`, `src/main/providers/wy/search.ts`, `src/main/providers/kg/search.ts`, `src/main/providers/tx/search.ts`, `src/renderer/features/search/SearchView.tsx`, `tests/unit/search-service.test.ts`, `tests/integration/search-adapters.test.ts`, `tests/fixtures/providers/wy-search.json`, `tests/fixtures/providers/kg-search.json`, `tests/fixtures/providers/tx-search.json`, `scripts/probe-sources.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `package.json`。

**Interfaces:**
- Produces: `SearchProvider = { id: string; search(query: SearchQuery, ctx: RequestContext): Promise<SearchPage> }`，`SearchQuery = { text: string; page: number; pageSize: number; authRevision: string }`，`SearchPage = { tracks: Track[]; total: number | null; nextPage: number | null }`。
- Produces: `SearchService.search(query: SearchQuery, ctx: RequestContext): Promise<SearchResult>`；`SearchResult = { requestId: string; tracks: Track[]; providers: { providerId: string; status: 'ok' | 'empty' | 'timeout' | 'rate-limited' | 'error'; error: AppError | null }[] }`。
- Produces: `ProviderRegistry.registerSearch(provider: SearchProvider): void`；renderer 不访问原始平台 JSON。匹配不足的相似曲目分别展示。

- [x] **Step 1:** 写固定样本测试：三个平台各自解析正常/空/缺字段/限流/超时；一源失败仍返回其他结果；旧 requestId 最后完成不覆盖新搜索。缓存键包含来源、查询、分页与 authRevision；中文查询正确编码；同名 live/studio 不合并。

```ts
test('one timed-out source does not erase another source results', async () => {
  const result = await service.search({ text: '周杰伦', page: 1, pageSize: 20, authRevision: '0' }, ctx)
  expect(result.tracks.map(track => track.id)).toContain('wy:fixture-track')
  expect(result.providers.find(source => source.providerId === 'kg')?.status).toBe('timeout')
})
```

测试 setup 注册固定返回 `wy:fixture-track` 的 wy provider，以及不完成请求的 kg provider；其他来源用独立 case 验证。
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/search-service.test.ts`、`npm run test:integration -- tests/integration/search-adapters.test.ts`，确认失败。
- [x] **Step 3:** 实现平台适配器与来源注册；首轮并发三源、每源超时 8 秒，完成即更新该来源状态；分页按来源保存，取消由 requestId 映射。账号配置变化失效缓存；连续 3 次失败暂缓自动请求 60 秒，手动重试可以恢复。探针增加 `npm run probe:sources -- --query 周杰伦`，输出日期、来源、响应状态与结果数。
- [x] **Step 4:** 运行上述测试及探针；把实际请求样本脱敏后存为固定 fixture。探针失败按来源记录，不能用 fixture 代替当日实时验证；结果中的完整播放状态保持“尚未解析”。注册额外模拟来源，证明不改 PlayerEngine 即可搜索。
- [x] **Step 5:** 提交该任务变更，commit message：`feat: aggregate music search with independent source state`。

### Task 5: LX 沙箱、完整音源验证与换源

**Files:** Create `src/main/extensions/lx-host.ts`, `src/main/extensions/lx-network.ts`, `src/preload/lx.ts`, `src/lx-sandbox/index.html`, `src/lx-sandbox/runtime.ts`, `src/main/playback/matcher.ts`, `src/main/playback/completeness.ts`, `src/main/playback/resolver.ts`, `src/main/playback/remote-resource.ts`, `src/renderer/features/extensions/SourceSettings.tsx`, `tests/unit/matcher.test.ts`, `tests/integration/resolver.test.ts`, `tests/e2e/lx-isolation.spec.ts`, `tests/fixtures/lx/basic-source.js`, `tests/fixtures/lx/hanging-source.js`, `docs/lx-compatibility.md`; Modify `src/shared/providers.ts`, `src/main/providers/registry.ts`, `src/main/assets/media-protocol.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/features/player/PlayerBar.tsx`, `electron.vite.config.ts`。

**Interfaces:**
- Produces: `PlaybackProvider = { id: string; capabilities(): PlaybackCapabilities; resolve(ref: ProviderTrackRef, quality: string, ctx: RequestContext): Promise<ResolvedAudio> }`；`PlaybackCapabilities = { contractMajor: 1; platformIds: string[]; qualities: string[]; fullTrack: boolean; offlineEditable: boolean }`。
- `ResolvedAudio = { url: string; headers: Record<string, string>; expiresAt: number | null; declaredQuality: string; preview: boolean | null; expectedDurationSeconds: number | null }`，只在宿主使用；页面只得到任务 3 的 PlaybackResource。
- Produces: `matchTrack(expected: Track, candidate: Track): { matched: boolean; reasons: string[] }`、`checkCompleteness(track: Track, audio: ResolvedAudio, ctx: RequestContext): Promise<{ accepted: boolean; probe: MediaProbe; reasons: string[] }>`、`PlaybackResolver.resolve(track: Track, options: { quality: string; strict: boolean }, ctx: RequestContext): Promise<PlaybackResource>`。
- Produces: `MediaResourceRegistry.issueRemote(audio: ResolvedAudio, probe: MediaProbe): Promise<PlaybackResource>`；只有完整性通过的资源可调用，远程请求 headers 不进入 renderer。
- Produces: `LXHost.importScript(path: string, ctx: RequestContext): Promise<ExtensionManifest>`、`enable(id: string, enabled: boolean): Promise<void>`、`test(id: string, ref: ProviderTrackRef, quality: string, ctx: RequestContext): Promise<PlaybackResource>`、`dispose(id: string): Promise<void>`；`ExtensionManifest` 包含 id/name/version/contractMajor/platformIds/qualities/enabled/compatibilityError。

- [x] **Step 1:** 写测试：歌手、版本不符与时长差超过 5 秒不能换源；未知时长不能仅靠匹配通过；真实 20 秒完整短曲可通过，标记试听、180 秒曲目返回 30 秒媒体及不可靠时长拒绝。第一音源失败自动试第二源、严格音质不降级、所有尝试不重复且受总时间限制。快切 A→B 时 A 的旧链接不切回 A。

```ts
test('version changes and truncated audio are rejected, real short songs pass', async () => {
  expect(matchTrack(studioTrack, liveTrack).matched).toBe(false)
  expect((await checkCompleteness(short20SecondTrack, full20SecondResource, ctx)).accepted).toBe(true)
  expect((await checkCompleteness(full180SecondTrack, truncated30SecondResource, ctx)).accepted).toBe(false)
  expect((await checkCompleteness(full180SecondTrack, markedPreviewResource, ctx)).accepted).toBe(false)
})
```

媒体样本由 makeAudioFile 生成，经本地测试 HTTP server 返回；标记试听样本 `preview=true`，其余均 `preview=false`，时长来自真实媒体而非伪造 probe。
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/matcher.test.ts`、`npm run test:integration -- tests/integration/resolver.test.ts`，确认失败；再为无限循环脚本及 require/process 探测写 Electron 隔离测试。
- [x] **Step 3:** 实现每脚本独立隐藏沙箱 renderer；preload 仅桥接 lx 的初始化/请求/网络，不暴露 AI 配置、文件或任意 IPC。实现 `globalThis.lx`、`EVENT_NAMES`、`on`、`send`、`request`、定时器及必要脚本元信息，`musicUrl` 转换保持 `qualitys` 与 `info.type` 语义。初始化 5 秒、解析单次 15 秒，宿主超时后 destroy 对应 webContents；不依赖被阻塞进程自己的定时器。其他 API 在兼容清单逐项标记，不宣称全部脚本兼容；自动更新先关闭，替换保留上一版本。
- [x] **Step 4:** 实现完整性检查及主进程媒体代理。明确试听立即排除；按实际媒体核验预期时长差 <=5 秒，不可靠时长需完整解码计数，仍不能确认则拒绝。resolver 最多 6 个不同的来源/音质组合、总预算 90 秒；过期链接重新解析，失败记录具体原因，自动降级显示实际媒体属性。日志去除请求凭证；远程播放能力不推定离线编辑能力。

匹配先提取 live/cover/instrumental/remix 等版本标记，再对标题/歌手做 NFKC、大小写与空白规范化。自动换源要求规范化标题相同、艺术家集合相同、已知版本相同、已知时长差 <=5 秒；专辑不一致作为明确疑点，不自动接受，用户可手动选择该候选。缺失识别条件不凭标题推定同一录音。
- [x] **Step 5:** 运行上述检查及 `npm run test:e2e -- tests/e2e/lx-isolation.spec.ts`；脚本无限循环终止后本地歌曲仍播放、窗口仍响应、另一脚本可调用。用用户可用的实际音源执行完整播放和末尾定位，记录来源与覆盖样本；无此配置时该项保持未验收。
- [x] **Step 6:** 提交该任务变更，commit message：`feat: validate complete playback through isolated source scripts`。

### Task 6: 非破坏性裁剪与音效导出

**Files:** Create `src/shared/audio-export.ts`, `src/main/export/audio-export-service.ts`, `src/main/export/ffmpeg-worker.ts`, `src/main/export/filter-builder.ts`, `src/renderer/features/editor/AudioEditor.tsx`, `tests/unit/filter-builder.test.ts`, `tests/integration/audio-export.test.ts`, `tests/e2e/audio-editor.spec.ts`; Modify `src/shared/effect-registry.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`。

**Interfaces:**
- Produces: `AudioEdit = { assetId: string; assetHash: string; range: TimeRange; rate: number; preservePitch: boolean; fadeInSeconds: number; fadeOutSeconds: number; effects: EffectConfig[] }`。
- Produces: `AudioExportOptions = { format: 'mp3' | 'flac' | 'wav'; bitrateKbps: 128 | 320 | null; bitDepth: 16 | 24 | 32 | null }`；非法格式/参数组合必须拒绝。
- Produces: `AudioExportService.start(edit: AudioEdit, options: AudioExportOptions, ctx: RequestContext): Promise<string>`，返回 jobId，宿主打开保存对话框；`renderPreview(edit: AudioEdit, ctx: RequestContext): Promise<AssetRecord>` 生成宿主管理的派生素材，供后续 AI 精确预览复用。
- Produces: `buildFilterGraph(edit: AudioEdit, input: MediaProbe): { filters: string; impulseResponse: Float32Array[] | null; outputDurationSeconds: number }`；`FfmpegWorker.run(spec: FfmpegJob, ctx: RequestContext, report: (progress: number) => void): Promise<MediaProbe>`，`FfmpegJob` 只能由注册 exporter 生成参数数组，禁止 shell 字符串。

- [x] **Step 1:** 写测试：10..30 秒裁剪、0.5/2 倍速输出分别为 40/10 秒（编码延迟容差 WAV 1 个采样、MP3 0.1 秒）；淡入淡出改变首尾采样；不同 EQ/混响参数改变输出。目标等于源文件拒绝；取消后源哈希不变、临时输出消失；含空格/emoji 和长路径可导出；未支持效果报错。

```ts
test('20 source seconds at double speed render 10 seconds without changing input', async () => {
  const output = await exporter.renderPreview({ ...edit, range: { startSeconds: 10, endSeconds: 30 }, rate: 2 }, ctx)
  expect(Math.abs(output.media.durationSeconds! - 10)).toBeLessThanOrEqual(1 / 44100)
  expect(await readFile(samplePath)).toEqual(originalBytes)
})
```

该 case 使用至少 60 秒、44.1 kHz WAV 和 WAV 预览；其他编码器使用对应容差，不共用 WAV 精度断言。
- [x] **Step 2:** 运行 `npm run test:unit -- tests/unit/filter-builder.test.ts`、`npm run test:integration -- tests/integration/audio-export.test.ts`，确认失败。
- [x] **Step 3:** 实现裁剪→时间映射→EQ/混响→淡入淡出→编码的统一链路。保持音高用 `atempo`，不保持音高用采样率变换后重采样；混响使用任务 3 同一脉冲和 `afir`，显式匹配干湿与归一化。淡入淡出以导出时间定义，两者不超出成品区间。启动时探测 ffmpeg 编码器/滤镜；WAV 位深只提供可用选项。
- [x] **Step 4:** 保存路径与输入 realpath 比较；先写同目录临时输出，成功 probe 后原子替换目的文件，失败/取消先终止 worker 再清理。进度以 `-progress` 读取，不阻塞窗口。运行上述测试及 `npm run test:e2e -- tests/e2e/audio-editor.spec.ts`；MP3/FLAC/WAV 重开检查时长、码率/位深、实际声音与原文件哈希。对相同预设比较实时离线频谱及混响脉冲，记录容差与试听结果。
- [x] **Step 5:** 提交该任务变更，commit message：`feat: export trimmed audio with validated effects`。

### Task 7: 扩展入口、设置迁移与 Windows 交付

**Files:** Create `src/shared/app-modules.ts`, `src/main/settings/settings-service.ts`, `src/renderer/features/settings/SettingsView.tsx`, `electron-builder.yml`, `scripts/check-media-runtime.ts`, `docs/verification/music-player.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, `tests/unit/settings.test.ts`, `tests/e2e/app-regression.spec.ts`; Modify `package.json`, `.gitignore`, `src/renderer/App.tsx`。

**Interfaces:**
- Produces: `AppModuleRegistry.register(module: { id: string; route: string; title: string; requiredCapabilities: string[] }): void`，`list(availableCapabilities: string[]): AppModule[]`；AppModule 是同一声明结构。
- Produces: `SettingsService.read(): Promise<AppSettings>`、`update(patch: Partial<AppSettings>): Promise<AppSettings>`；AppSettings schemaVersion=1，含 volume/rate/preservePitch/effects/sourceOrder/enabledSources/exportDefaults。

- [ ] **Step 1:** 写回归测试：设置重启保留、旧版效果参数迁移正确、契约主版本不符的来源拒绝加载、未具备 capability 的入口不可执行、音源失败不影响本地编辑。

```ts
test('modules are gated by available capabilities', () => {
  modules.register({ id: 'test-ai', route: '/test-ai', title: '测试', requiredCapabilities: ['text-planning'] })
  expect(modules.list([]).some(module => module.id === 'test-ai')).toBe(false)
  expect(modules.list(['text-planning']).some(module => module.id === 'test-ai')).toBe(true)
})
```
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/settings.test.ts`、`npm run test:e2e -- tests/e2e/app-regression.spec.ts`，确认缺失行为失败。
- [ ] **Step 3:** 实现来源排序/启停/单源测试、音效与导出默认值。注册内置模块并支持后续 creative routes；加入一个仅测试环境可用的简单 effect 或模拟 provider，证明只通过 registry 接入。Windows 包包含已核验的 FFmpeg/ffprobe 资源与许可记录；启用 asar、按二进制实际位置解包；不依赖用户机器上的 PATH。
- [ ] **Step 4:** 运行 `npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run test:e2e`、`npm run build`、`npm run dist:win`。安装到带空格的目录，从安装版完成导入、播放、设置重启和导出；将结果与截图写入 verification 文档，区分 fixture/实时搜索/真实完整播放。记录源码与二进制许可，不将未签名构建写为已签名发布。
- [ ] **Step 5:** 删除本轮不再需要的临时测试素材和未完成输出，保留复现 fixture 与验收证据；提交该任务变更，commit message：`build: deliver validated Windows music player`。

## 依据与交付检查

自定义协议采用当前 `protocol.handle` 并声明媒体流能力；IPC sender 校验和具体 preload 方法遵循 [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)、[protocol](https://www.electronjs.org/docs/latest/api/protocol) 与 [安全文档](https://www.electronjs.org/docs/latest/tutorial/security)。LX 兼容的字段与事件以[官方脚本协议](https://lxmusic.toside.cn/desktop/custom-source)为准，文档一致不代表任意脚本通过实测。滤镜选择依据 [FFmpeg 文档](https://ffmpeg.org/ffmpeg-filters.html)，实际随二进制探测。

主规格第 2–6 节由任务 1/3/4/5/6/7 覆盖，第 7–8 节由任务 5 覆盖，第 9–10 节由任务 1/2/4/5/6 覆盖，第 11–12 节由任务 2/3/6/7 验收。歌词、WebDAV、云同步、插件市场、任意 UI 插件与其他后续模块保留扩展位置，不纳入本单元。
