# 模板封面与节奏动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将输入图片放入可复用音乐模板，支持局部编辑与固定图层，按音乐时间轴产生上下 Q 弹并导出静态图、循环 GIF 和带音乐 MP4。

**Architecture:** TemplateService 定义布局、主体遮罩、锁定区域和动画参数，Canvas 合成器保持背景与文字；可选 AIProvider 只修改允许的图像区域。本地 AnimationRenderer 消费 PlayerSnapshot/BeatMap/TimeMap，预览与导出复用同一相位与绘制函数。项目使用创作服务的不可变版本，图像文件与帧资源独立存储。

**Tech Stack:** Electron 沙箱 renderer、React、TypeScript、Canvas/OffscreenCanvas、Zod、FFmpeg、Vitest、Playwright；复用 AIProvider 与 AssetRegistry。

**Spec:** [模板与节奏动效设计](../specs/2026-10-03-template-music-visual-design.md)。依赖基础计划完成，及[AI 音频计划](2026-10-03-ai-audio-editing-implementation.md)的 CreativeProjectService、BeatMap、TimeMap、AIProvider 契约；服务未配置时本地视觉流程仍可完整使用。

## Global Constraints

- “默认仅上下 Q 弹，采用上下位移与轻微挤压拉伸，不沿用旋转或转身。”
- “主体的水平中心固定，角度固定，不自动翻转或转身。”
- “封面标题、歌曲信息及主体外的用户锁定区域保持静止。”
- “位移高度约为主体高度的 4%，纵向缩放约 0.96–1.04，横向缩放做轻微体积补偿。”这些是待视觉验收的初始候选。
- “动画以 PlayerEngine 的源音频播放位置为依据，而不是独立系统计时器。”
- “暂停冻结当前动画相位；恢复依据当前音频位置继续；拖动进度后重定位节拍与动画相位。”
- “静态第一阶段输出 PNG、JPEG”，“动态第一阶段提供 MP4 和 GIF：MP4 可附带关联音乐，GIF 无音轨”。
- 用户 GIF 是外观参考，240×240、10 fps、9.9 秒不是输出约束；预览候选 30 fps。

## Review Focus

- 无透明通道、EXIF 旋转及极端宽高比的图片：方向正确、允许手工裁剪/遮罩，不把完整背景当可自动弹跳的主体；任务 1 测试。
- 遮罩编辑越界或 AI 修改了锁定区：本地合成恢复原像素和独立文字，冲突不静默解锁；任务 1/3 测试。
- 静音、低置信节拍与音量突变：显示同步模式，动作减弱且不裁切主体；任务 2 测试。
- 暂停、拖动、变速、裁剪后换预览：相位由绑定音频时间与映射确定，旧 BeatMap 不继续驱动；任务 2/4 测试。
- 导出中取消、首尾能量不一致或奇数尺寸：输出不残留，循环连续，MP4 编码尺寸合法且音画同源；任务 4 测试。

---

### Task 1: 图片素材、可编辑模板与锁定图层

**Files:** Create `src/shared/visual.ts`, `src/shared/visual-schemas.ts`, `src/main/visual/template-service.ts`, `src/main/visual/image-preparation.ts`, `src/renderer/visual/compositor.ts`, `src/renderer/features/visual/VisualStudio.tsx`, `src/renderer/features/visual/LayerPanel.tsx`, `src/renderer/features/visual/MaskEditor.tsx`, `src/main/visual/templates/outdoor-bounce.json`, `src/main/visual/templates/music-cover.json`, `tests/unit/templates.test.ts`, `tests/integration/compositor.test.ts`, `tests/e2e/visual-import.spec.ts`；Modify `src/shared/creative.ts`, `src/main/assets/asset-registry.ts`, `src/main/assets/media-probe.ts`, `src/main/creative/project-service.ts`, `src/shared/app-modules.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `package.json`, `package-lock.json`。

**Interfaces:**
- Consumes: AssetRecord、ProjectRevision、CreativeProjectService、TaskService。导入素材种类仍为 image，不把图片混入 Track。
- `Layer = { id: string; type: 'image' | 'text' | 'background'; assetId: string | null; text: string | null; color: string; x: number; y: number; width: number; height: number; rotation: number; opacity: number; locked: boolean; maskAssetId: string | null; font: { family: string; size: number; weight: number; align: 'left' | 'center' | 'right' } | null }`。
- `TemplateDefinition = { id: string; version: 1; width: number; height: number; layers: Layer[]; subjectLayerId: string; lockedRegions: LockedRegion[]; allowedParameters: string[]; animation: BounceParams }`；`PixelRegion = { x: number; y: number; width: number; height: number }`，`LockedRegion = { region: PixelRegion; snapshotAssetId: string }`。
- `VisualScene = { schemaVersion: 1; templateId: string; templateVersion: number; width: number; height: number; layers: Layer[]; lockedRegions: LockedRegion[]; subjectLayerId: string; animation: BounceParams; audioBinding: AudioBinding | null }`；以它替换 shared creative 中尚未注册的 visual state payload，并验证完整 schema。锁定时保存无损区域像素快照，最后合成步骤按该快照覆盖；快照属于该项目版本。
- `BounceParams = { heightRatio: number; squashRatio: number; beatRate: 0.5 | 1 | 2; strength: number; enabled: boolean }`，初始 `{heightRatio:0.04,squashRatio:0.04,beatRate:1,strength:1,enabled:true}`，heightRatio 0..0.15、squashRatio 0..0.08、strength 0..1。
- `AudioBinding = { trackId: string | null; assetId: string; assetHash: string; revisionId: string | null; timeMap: TimeMap | null; beatMap: BeatMap | null }`。
- Produces: `TemplateService.list(): Promise<TemplateDefinition[]>`、`save(template: TemplateDefinition): Promise<void>`、`suggestFromImage(assetId: string, ctx: RequestContext): Promise<TemplateDefinition>`、`validateScene(raw: unknown): VisualScene`；建议只提取尺寸/透明主体边界/主色与可编辑布局，不宣称识别全部图层。
- Produces: `SubjectPreparationProvider.prepare(input: { assetId: string; crop: PixelRegion; maskAssetId: string | null }, ctx: RequestContext): Promise<AssetRecord>`；第一实现为本地裁剪/手工遮罩。
- Produces: `drawScene(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: VisualScene, assets: Map<string, CanvasImageSource>, transform: SubjectTransform): void`；SubjectTransform 由任务 2 定义，在本任务静态使用 identity。

- [ ] **Step 1:** 写测试：模板保存/重开保持版本与图层顺序；缺主体、重复 layerId、越界遮罩和非法参数拒绝；EXIF 方向与 alpha 正确；不透明图支持手工遮罩；替换主体后背景/文字及锁定区域的 RGBA 像素完全相同。正方形、横图和竖图在裁剪调整后主体完整可见。

```ts
test('unknown subject and excessive bounce amplitude fail scene validation', () => {
  expect(() => validateScene({ ...scene, subjectLayerId: 'missing' })).toThrow()
  expect(() => validateScene({ ...scene, animation: { ...scene.animation, heightRatio: 0.16 } })).toThrow()
})
```
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/templates.test.ts`、`npm run test:integration -- tests/integration/compositor.test.ts`，确认失败。
- [ ] **Step 3:** 在确认稳定版本与 Node 兼容后加入 sharp 并更新锁文件，宿主统一图片方向、裁剪与 alpha，派生结果注册为新 AssetRecord。实现 1080×1080 内置 outdoor-bounce 与 music-cover 模板，尺寸可改到 256..4096；前者蓝天/草地固定背景，后者固定专辑信息与可替换主体。导入后先裁剪、建立主体 mask 和底部中心锚点；无透明图不自动声称抠图完成。提供手工绘制/擦除遮罩、图层选择、位置/比例/文字/配色、锁定切换和模板保存。主体包围盒包含最大弹跳空间，布局不够时显示需缩小主体。
- [ ] **Step 4:** 运行上述测试和 `npm run test:e2e -- tests/e2e/visual-import.spec.ts`；真实导入图片、替换主体、修改标题、保存/重开项目。以用户 GIF 的外观和比例做人工参考，默认绘制不使用其中转身帧作为动画。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: compose reusable music templates with locked layers`。

### Task 2: 随播放时间同步的上下 Q 弹

**Files:** Create `src/shared/bounce.ts`, `src/shared/visual-timeline.ts`, `src/renderer/visual/render-service.ts`, `src/renderer/features/visual/AnimationControls.tsx`, `tests/unit/bounce.test.ts`, `tests/e2e/visual-sync.spec.ts`; Modify `src/renderer/visual/compositor.ts`, `src/renderer/features/visual/VisualStudio.tsx`, `src/renderer/audio/player-engine.ts`。

**Interfaces:**
- `SubjectTransform = { translateX: 0; translateY: number; rotation: 0; scaleX: number; scaleY: number; anchor: 'bottom-center' }`。
- `VisualTimelineInput = { sourceSeconds: number; audioBinding: AudioBinding | null; beatMap: BeatMap | null; manualBpm: number | null; energy: number; mode: 'beat' | 'energy' | 'manual' }`。
- Produces: `bounceTransform(input: VisualTimelineInput, params: BounceParams, subjectHeight: number): SubjectTransform`、`VisualRenderService.render(scene: VisualScene, player: PlayerSnapshot): void`、`selectSyncMode(binding: AudioBinding | null, manualBpm: number | null): 'beat' | 'energy' | 'manual'`。
- `sourceSeconds` 始终相对于当前绑定的实际音频文件；已变速派生文件使用重映射后的 BeatMap。TimeMap 只用于原始/派生坐标转换，不在当前文件的 bounce 相位中再次应用。无音频/能量且未指定 manualBpm 时保持静态 identity，不自行启动强烈弹跳。
- Produces: `AnimationRegistry.register(id: string, renderer: AnimationRenderer): void`；`AnimationRenderer = { id: string; paramVersion: 1; transform(input: VisualTimelineInput, params: BounceParams, subjectHeight: number): SubjectTransform }`，本单元注册 `bounce-v1`。

- [ ] **Step 1:** 写测试：所有帧 translateX/rotation 固定为 0；默认 scaleY 在 0.96..1.04，位移不超主体高度 4%；稳定 120 BPM 的重拍事件在一个 30 fps 预览帧（1/30 秒）内落地。暂停两次渲染相同 sourceSeconds 得同一姿态；seek 到新时间得目标相位；rate 变化仅改变源时间推进速度。静音动作减弱、音量突变不超界。

```ts
test('bounce has no horizontal motion, rotation or out-of-bounds default scale', () => {
  for (let frame = 0; frame < 120; frame++) {
    const transform = bounceTransform({ ...input, sourceSeconds: frame / 30, energy: 1 }, defaults, 400)
    expect(transform.translateX).toBe(0)
    expect(transform.rotation).toBe(0)
    expect(Math.abs(transform.translateY)).toBeLessThanOrEqual(16)
    expect(transform.scaleY).toBeGreaterThanOrEqual(0.96)
    expect(transform.scaleY).toBeLessThanOrEqual(1.04)
  }
})
```
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/bounce.test.ts`、`npm run test:e2e -- tests/e2e/visual-sync.spec.ts`，确认失败。
- [ ] **Step 3:** 实现以邻近 beatSeconds 插值的相位，固定 BPM 后备从 offsetSeconds 算相位，beatRate 控制每两拍/每拍/每半拍一跳。位移采用平滑周期函数，重拍落地压缩，scaleX 做体积补偿；能量包络先在源时间域平滑、限速与限幅，再乘 strength，导出也用同一包络。无可靠 BeatMap 使用 energy 或用户 manualBpm 并显示模式；静音强度衰减为 0，不用墙钟独立计时。
- [ ] **Step 4:** 运行上述测试；实际音乐检查暂停/恢复、拖动、0.5/2 倍速联动。新 assetHash 与 BeatMap 不符时禁用旧图，重新分析或按 TimeMap 映射；绑定派生音频时只使用一套映射，不能重复变速。用 4/8 拍检查首尾位置、尺度与导数连续性，并记录人工 Q 弹观感。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: synchronize vertical bounce to the audio timeline`。

### Task 3: 对话参数、AI 局部编辑与版本恢复

**Files:** Create `src/shared/visual-edit-plan.ts`, `src/main/visual/visual-edit-service.ts`, `src/main/visual/image-ai-adapter.ts`, `src/renderer/features/visual/VisualChat.tsx`, `tests/unit/visual-plans.test.ts`, `tests/integration/visual-ai.test.ts`, `tests/e2e/visual-history.spec.ts`; Modify `src/main/ai/gemini-provider.ts`, `src/renderer/features/visual/VisualStudio.tsx`, `src/renderer/features/creative/RevisionHistory.tsx`, `src/main/ipc.ts`, `src/preload/index.ts`。

**Interfaces:**
- `VisualEditPlan = { planVersion: 1; projectId: string; baseRevisionId: string; assetHash: string; layerId: string; region: PixelRegion | null; operation: 'set-color' | 'set-text' | 'move-layer' | 'set-bounce' | 'edit-image'; parameters: Record<string, unknown> }`，每种 operation 用 discriminated union schema 限制字段和范围，禁止路径/脚本。
- `ImageEditInput = { projectId: string; baseRevisionId: string; layerId: string; assetId: string; assetHash: string; referenceAssetIds: string[]; maskAssetId: string | null; region: PixelRegion; prompt: string }`；`ImageEditOutput = { assetId: string; inputAssetHash: string; baseRevisionId: string; modelId: string; providerId: string; remoteTaskId: string | null }`。
- Produces: `ImageAIAdapter.edit(input: ImageEditInput, ctx: RequestContext): Promise<ImageEditOutput>`；校验 AIProvider.editImage 的 unknown 输入/输出，只注册实际 probe 成功的 image 能力。
- Produces: `VisualEditService.plan(goal: string, revision: ProjectRevision, selection: { layerId: string; region: PixelRegion | null }, ctx: RequestContext): Promise<VisualEditPlan>`、`apply(plan: VisualEditPlan, ctx: RequestContext): Promise<ProjectRevision>`。

- [ ] **Step 1:** 写测试：“弹跳幅度减半”基于当前值确定计算、移动锁定图层报 `LOCK_CONFLICT`、设置文字不经图像生成。“衣服改成蓝色”仅编辑选区；伪造的 AI 全图修改经合成后锁定像素不变。换图/换歌/换模板/换版本后的旧结果不 append；撤销恢复已有真实图片且不增加远程调用。

```ts
test('half amplitude is computed from current parameters without image generation', async () => {
  const plan = await visualEdits.plan('弹跳幅度减半', revision, { layerId: scene.subjectLayerId, region: null }, ctx)
  expect(plan.operation).toBe('set-bounce')
  expect(plan.parameters.heightRatio).toBe(0.02)
  expect(imageProvider.editImage).not.toHaveBeenCalled()
})
```

该 case 的当前 heightRatio=0.04；imageProvider.editImage 是可计数的测试 spy。文字/位置/数值类命令必须在本地分支处理。
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/visual-plans.test.ts`、`npm run test:integration -- tests/integration/visual-ai.test.ts`，确认失败。
- [ ] **Step 3:** 实现参数命令本地执行、语义选择通过受限制 planner；重绘操作经 ImageAIAdapter。Gemini 图像模型单独配置，接入按官方图像 API 的实际协议；不因音频模型可用就启用图片编辑。提交仅所需原图/参考/选区；结果校验像素尺寸与格式，贴回主体的允许区域，遮罩外和 lockedRegions 取原像素，文字仍由本地文字层绘制。
- [ ] **Step 4:** 运行上述检查与 `npm run test:e2e -- tests/e2e/visual-history.spec.ts`；真实配置单次局部编辑、并排比较、保存、撤销、重开恢复。报告局部边界与主体外观的人工评估；旧结果可保存在任务历史但不自动覆盖。无 AI 配置时参数、模板、遮罩与动画功能继续可用；锁冲突只在用户明确解锁后执行。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: edit visual regions with versioned AI results`。

### Task 4: 静态图、循环动画与带音乐视频导出

**Files:** Create `src/shared/visual-export.ts`, `src/main/visual/visual-export-service.ts`, `src/main/visual/render-worker.ts`, `src/visual-export/index.html`, `src/visual-export/renderer.ts`, `src/renderer/features/visual/VisualExportPanel.tsx`, `tests/integration/visual-export.test.ts`, `tests/e2e/visual-export.spec.ts`, `docs/verification/music-visual.md`; Modify `src/main/jobs/task-service.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/features/visual/VisualStudio.tsx`, `electron.vite.config.ts`, `electron-builder.yml`。

**Interfaces:**
- `VisualExportOptions = { format: 'png' | 'jpeg' | 'mp4' | 'gif'; width: number; height: number; fps: 24 | 30; transparent: boolean; audio: boolean; range: TimeRange | null; loopBeats: 4 | 8 | null }`。
- Produces: `VisualExportService.start(projectId: string, revisionId: string, options: VisualExportOptions, ctx: RequestContext): Promise<string>`，返回 jobId，由宿主打开保存对话框。
- Produces: `RenderWorker.renderFrames(scene: VisualScene, options: VisualExportOptions, ctx: RequestContext, writeFrame: (frame: Uint8Array, index: number) => Promise<void>): Promise<{ frameCount: number; durationSeconds: number }>`；使用同一 compositor 与 bounceTransform，固定 sourceSeconds，不依赖执行耗时。
- Produces: `buildVisualTimeline(scene: VisualScene, options: VisualExportOptions): { sourceRange: TimeRange; outputDurationSeconds: number; frameSourceSeconds: number[] }`；音频绑定不可用/已过期时拒绝音轨导出。PNG 支持符合模板图层条件的 alpha；JPEG/GIF/首版 MP4 禁用透明，选择明确背景。

- [ ] **Step 1:** 写测试：PNG/JPEG 重开尺寸与图层正确；透明 PNG alpha 存在；PNG lockedRegions RGBA 不变。4/8 拍 GIF 首尾位置/尺度/速度连续且无音轨；MP4 有选定音轨、时长差 <=1 帧。10..30 秒裁剪、2 倍速输出 10 秒，声画同一映射；取消后临时帧/部分输出消失且已有导出不受影响；奇数 MP4 尺寸明确校正或拒绝，不能编码失败才静默改尺寸。

```ts
test('four beats at 120 BPM generate two seconds of loop frames', () => {
  const timeline = buildVisualTimeline(sceneAt120Bpm, { ...gifOptions, fps: 30, loopBeats: 4 })
  expect(timeline.outputDurationSeconds).toBe(2)
  expect(timeline.frameSourceSeconds).toHaveLength(60)
  expect(timeline.frameSourceSeconds[59] - timeline.frameSourceSeconds[0]).toBeCloseTo(59 / 30, 6)
})
```

循环采样为 `[start, end)`，不重复最后的首帧；连续性另用端点函数及导数验证，GIF 不以重复帧掩盖相位跳变。
- [ ] **Step 2:** 运行 `npm run test:integration -- tests/integration/visual-export.test.ts`、`npm run test:e2e -- tests/e2e/visual-export.spec.ts`，确认失败。
- [ ] **Step 3:** 实现独立隐藏沙箱 Canvas renderer，所有资源从受控 asset 协议获取；每次最多保留 2 个待写帧，回压到 worker，避免整曲帧全部占内存。PNG/JPEG 用真实画布编码；GIF 用 palettegen/paletteuse 并选 4/8 拍循环；循环能量包络在首尾做周期平滑。MP4 用实际可用 H.264/AAC 编码器，音轨直接引用已绑定完整/裁剪/变速资源，或依 AudioEdit 渲染，不再次重复应用 rate。
- [ ] **Step 4:** 运行完整 unit/integration/e2e/typecheck/build/dist:win；ffprobe 确认音轨、帧率、时长、尺寸，重新播放 MP4/GIF，人工核对音乐重拍与落地。实际导出首帧/末帧及相邻帧验证循环；UI 预览与导出比对。记录默认参数人工验收、自动节拍检测误差和渲染误差各自证据；保存路径采用基础 exporter 的临时写入/取消/原子完成规则。
- [ ] **Step 5:** 清理无保存引用的临时帧与失败输出，保留复现样本与验证记录；提交该任务变更，commit message：`feat: export beat-synced music visuals and cover images`。

## 依据与覆盖

参考[用户 GIF](../references/default-music-visual.gif)的外观，动作以用户最新上下 Q 弹要求为准。图像适配器协议参考 [Gemini 图像编辑文档](https://ai.google.dev/gemini-api/docs/image-generation)，保留区域由本地合成保证；动画/视频导出使用实际 [FFmpeg 滤镜与编码能力](https://ffmpeg.org/ffmpeg-filters.html)。

规格第 1–5 节由任务 1/2/3 覆盖，第 6 节由任务 3 覆盖，第 7 节由任务 2/4 覆盖，第 8–9 节由任务 1/3/4 覆盖，第 10 节由四任务共同验收。3D 绑定、旋转转身、生成视频工作流、WebM 和透明动画不纳入本单元。
