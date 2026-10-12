# AI 音频分析与参数编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对可编辑音频进行本地分析，让 API 将用户目标转为可检查、可撤销的 EQ、混响、动态和速度方案，完成原始/处理对比与导出。

**Architecture:** 在基础播放器的 AssetRegistry、EffectRegistry、TaskService 与 AudioExportService 上增加创作版本、本地分析和 AIProvider。数值处理、锁定条件与版本检查由本地执行，远程服务只解释输入并返回结构化操作。需要准确与导出一致的处理预览先生成派生音频，再通过既有 PlayerEngine 播放。

**Tech Stack:** 基础播放器的 TypeScript、Zod、FFmpeg、Web Audio、Vitest、Playwright；远程初始适配器为 Gemini，音频与文字模型单独配置。正文不固定未经验证的模型能力，也不强制引入 TypeSafe。

**Spec:** [AI 音频设计](../specs/2026-10-03-ai-audio-editing-design.md)、[基础播放器设计](../specs/2026-10-03-music-player-design.md)。依赖[基础实施计划](2026-10-03-music-player-implementation.md)任务 1–7 完成。

## Global Constraints

- “第一阶段不包含人声身份替换、乐器重新演奏或音乐重作曲。”
- “均衡器各段增益 -12 至 +12 dB，混响比例 0 至 1，速度 0.5 至 2 倍。”
- “用户只要求音色变化时默认保持速度；用户指定速度或目标节奏时生成速度操作。”
- “AI 负责语义判断，不能改写用户已锁定的速度或时间区间。”
- “历史版本保留实际参数和已经生成的资源；恢复历史不重新调用模型。”
- “API 密钥由桌面宿主管理，通过系统提供的受保护存储保存，不写入歌单、模板或普通项目导出文件。”
- “取消或超时不会让迟到结果覆盖项目。”
- 基础播放与手动音效在 AI 服务失败或未配置时继续可用；只声明实际支持的处理器与服务能力。

## Review Focus

- 静音、极短音频与指标非有限值：测量结果允许缺失，不能把无可信节拍写成精确 BPM；任务 2 测试。
- 用户改了素材、区间或版本后旧 API 返回：保存为旧任务结果，不修改当前预览；任务 1/3 测试。
- 模型输出未知 effectId、越界数值、代码或改动锁定速度：本地拒绝方案并显示原因；任务 3 测试。
- 多次撤销/重做与恢复后再编辑：保存实际分支，旧预览与原文件可恢复，不再调用模型；任务 1/4 测试。
- API 限流、上传取消或仅支持文字规划：播放继续、远程请求不盲目重发，界面准确描述提交范围；任务 3/4 测试。

---

### Task 1: 创作素材与不可变版本

**Files:** Create `src/shared/creative.ts`, `src/main/creative/project-service.ts`, `src/main/creative/revision-store.ts`, `tests/unit/project-revisions.test.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`。

**Interfaces:**
- Consumes: 基础计划的 AssetRecord/AudioEdit/EffectConfig、StorageRepository 与 TaskService。
- Produces: `ProjectState = { kind: 'audio'; edit: AudioEdit; locks: { rate: boolean; range: boolean } } | { kind: 'visual'; scene: unknown }`；visual scene 由视觉单元注册运行时 schema 后才允许保存。
- `ProjectRevision = { id: string; projectId: string; parentRevisionId: string | null; assetId: string; assetHash: string; state: ProjectState; derivedAssetIds: string[]; createdAt: string }`。
- Produces: `CreativeProjectService.create(assetId: string, initialState: ProjectState): Promise<ProjectRevision>`、`current(projectId: string): Promise<ProjectRevision>`、`append(projectId: string, baseRevisionId: string, state: ProjectState, derivedAssetIds: string[]): Promise<ProjectRevision>`、`restore(projectId: string, revisionId: string): Promise<ProjectRevision>`、`undo(projectId: string): Promise<ProjectRevision>`、`redo(projectId: string): Promise<ProjectRevision>`、`registerStateSchema(kind: ProjectState['kind'], schema: ZodType): void`。
- `append` 检查基准与 hash，旧任务结果单独留存；恢复移动 current 指针，历史不变。恢复后新编辑建立分支、清空当前 redo 指针，旧分支仍能明确选择。

- [ ] **Step 1:** 写测试：原始资产不变、append 不修改父版本、撤销/重做完整恢复参数与资源、重启保留历史、旧基准 append 返回 `STALE_REVISION`、恢复后编辑保留分支但不误 redo 到另一分支。

```ts
test('undo restores the saved revision and stale writes fail', async () => {
  const updated = await projects.append(base.projectId, base.id, newState, [previewAssetId])
  expect((await projects.undo(base.projectId)).id).toBe(base.id)
  expect((await projects.redo(base.projectId)).id).toBe(updated.id)
  await expect(projects.append(base.projectId, base.id, newState, [])).rejects.toMatchObject({ code: 'STALE_REVISION' })
})
```
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/project-revisions.test.ts`，确认失败。
- [ ] **Step 3:** 实现项目索引与独立 revision 文件，使用基础 StorageRepository 的版本化原子写入。派生资产登记真实文件引用，不把 PCM/图片/帧放进曲库 JSON；删除临时预览前核对无已保存版本引用。
- [ ] **Step 4:** 运行上述测试与 `npm run typecheck`；从上一版本 fixture 迁移失败时原文件、revision 和派生文件均保留。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: preserve immutable creative project revisions`。

### Task 2: 本地指标、节拍与时间映射

**Files:** Create `src/shared/audio-analysis.ts`, `src/shared/beat-map.ts`, `src/shared/time-map.ts`, `src/main/analysis/audio-analysis-service.ts`, `src/main/analysis/rhythm-analyzer.ts`, `src/main/analysis/spectral-metrics.ts`, `tests/integration/audio-analysis.test.ts`, `tests/unit/rhythm.test.ts`, `tests/unit/time-map.test.ts`。

**Interfaces:**
- Produces: `AnalysisRequest = { assetId: string; assetHash: string; range: TimeRange; configVersion: 1 }`；`AudioEvidence = { assetId: string; assetHash: string; range: TimeRange; analyzerVersion: string; sampleRate: number; channels: number; integratedLufs: number | null; peakDbfs: number | null; truePeakDbfs: number | null; bandEnergy: number[]; beatMap: BeatMap }`。
- `BeatMap = { assetHash: string; range: TimeRange; analyzerVersion: string; source: 'detected' | 'manual' | 'unavailable'; confidence: number | null; bpm: number | null; offsetSeconds: number; beatSeconds: number[]; energyEnvelope: { sourceSeconds: number; value: number }[] }`。
- Produces: `AudioAnalysisService.analyze(request: AnalysisRequest, ctx: RequestContext): Promise<AudioEvidence>`、`RhythmAnalyzer.correct(map: BeatMap, correction: { tempoFactor: 0.5 | 1 | 2; offsetSeconds: number; manualBpm: number | null }): BeatMap`。
- Produces: `TimeMap = { sourceAssetHash: string; sourceRange: TimeRange; rate: number; outputDurationSeconds: number }`、`toSourceSeconds(map: TimeMap, outputSeconds: number): number`、`toOutputSeconds(map: TimeMap, sourceSeconds: number): number`、`remapBeatMap(map: BeatMap, timeMap: TimeMap, outputAssetHash: string): BeatMap`。

- [ ] **Step 1:** 写测试：已知正弦/噪声/削波/静音的峰值和频段合理；静音 LUFS 与 BPM 用 null 表示，短到无法测量则注明范围不足。120 BPM 点击样本检测误差 <=20 ms，半拍/倍拍/偏移修正可追溯；10..30 秒裁剪、2 倍速后事件按 `(sourceSeconds-10)/2` 映射，范围外节拍移除。

```ts
test('crop and speed use one reversible time mapping', () => {
  const map = { sourceAssetHash: 'fixture-hash', sourceRange: { startSeconds: 10, endSeconds: 30 }, rate: 2, outputDurationSeconds: 10 }
  expect(toOutputSeconds(map, 12)).toBe(1)
  expect(toSourceSeconds(map, 1)).toBe(12)
})
```
- [ ] **Step 2:** 运行 `npm run test:integration -- tests/integration/audio-analysis.test.ts`、`npm run test:unit -- tests/unit/rhythm.test.ts tests/unit/time-map.test.ts`，确认失败。
- [ ] **Step 3:** 通过受控 FFmpeg 流式解码所选区间，测量响度/峰值并以 FFT/谱通量检测候选节拍，保存置信信息与能量包络；不将最大自相关值直接当正确率。长文件分块计算，取消时终止进程；缓存键为 hash/range/configVersion/analyzerVersion，重新修改文件必须重新确认 hash。
- [ ] **Step 4:** 运行上述测试；分析记录明确测量区间。生成音频 hash 后重新映射 BeatMap；不能沿用已变更音频的旧 hash。用不同风格的代表样本记录人工节拍核对，检测误差与播放渲染误差分别保存。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: measure audio and map beats across edits`。

### Task 3: AIProvider、受保护配置与方案校验

**Files:** Create `src/shared/ai-provider.ts`, `src/shared/edit-plan.ts`, `src/main/ai/provider-registry.ts`, `src/main/ai/gemini-provider.ts`, `src/main/ai/credential-store.ts`, `src/main/ai/editing-planner.ts`, `src/main/ai/plan-validator.ts`, `src/renderer/features/settings/AISettings.tsx`, `tests/unit/edit-plan.test.ts`, `tests/integration/ai-provider.test.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/features/settings/SettingsView.tsx`。

**Interfaces:**
- Produces: `AICapabilities = { textPlanning: boolean; audioUnderstanding: boolean; imageUnderstanding: boolean; referenceImageEdit: boolean; regionEdit: boolean; multiTurnEdit: boolean; taskQuery: boolean }`，默认均 false；独立验证后启用。
- Produces: `AIProvider = { id: string; capabilities(): AICapabilities; planAudio(input: AudioPlanningInput, ctx: RequestContext): Promise<AIResult<unknown>>; editImage(input: unknown, ctx: RequestContext): Promise<AIResult<unknown>>; queryTask?(taskId: string, ctx: RequestContext): Promise<AIResult<unknown>> }`；视觉单元用 typed adapter 校验 editImage 输入与输出。
- `AIResult<T> = { value: T; remoteTaskId: string | null; providerId: string; modelId: string; usage: { inputTokens: number | null; outputTokens: number | null; billedAmount: number | null; currency: string | null } }`，未知用 null。
- `AudioPlanningInput = { goal: string; revision: ProjectRevision; evidence: AudioEvidence; supportedEffects: EffectDefinition[]; audioSample: { assetId: string; range: TimeRange; mimeType: string } | null }`；文本模式 audioSample=null。
- `EditPlan = { planVersion: 1; projectId: string; assetId: string; assetHash: string; baseRevisionId: string; range: TimeRange; operations: ({ type: 'effect'; config: EffectConfig; explanation: string } | { type: 'speed'; rate: number; preservePitch: boolean; explanation: string })[]; requiredCapabilities: string[] }`。
- Produces: `AIEditingPlanner.plan(input: AudioPlanningInput, ctx: RequestContext): Promise<EditPlan>`、`validateEditPlan(raw: unknown, current: ProjectRevision, registry: EffectRegistry): EditPlan`、`applyEditPlan(plan: EditPlan, current: ProjectRevision): AudioEdit`。
- `CredentialStore.set(providerId: string, secret: string): Promise<void>`、`get(providerId: string): Promise<string | null>`、`remove(providerId: string): Promise<void>`；仅 main 可用。

- [ ] **Step 1:** 写测试：拒绝 gain=13、wet=1.1、rate=0.49/2.01、NaN、未知 effectId、任意路径/代码操作；锁定区间/速度或素材/版本冲突拒绝。目标仅“温暖一点”不能无因变速；“混响减半”和“0.85 倍”用本地明确数值计算。取消/旧版本返回不 append；401/429/timeout 各有用户原因、没有无条件自动重发。

```ts
test('out-of-range speed and stale asset plans cannot be applied', () => {
  expect(() => validateEditPlan({ ...validPlan, operations: [{ type: 'speed', rate: 2.01, preservePitch: true, explanation: 'test' }] }, current, registry)).toThrow()
  expect(() => validateEditPlan({ ...validPlan, assetHash: 'old-hash' }, current, registry)).toThrow()
})
```
- [ ] **Step 2:** 运行 `npm run test:unit -- tests/unit/edit-plan.test.ts`、`npm run test:integration -- tests/integration/ai-provider.test.ts`，确认失败。
- [ ] **Step 3:** 实现 provider registry、Gemini HTTP 适配和结构化结果 schema；设置中分别指定 textModel/audioModel/imageModel。仅文本规划提交指标/目标，音频理解仅上传用户启动操作时展示的具体区间；实际上传格式、大小和接口按当日官方文档实现并 fixture 固化。safeStorage 保护密钥，无法受保护保存时只提供本次会话内存模式，不回退明文；LX 无法调用该配置入口。
- [ ] **Step 4:** 先做输入/hash/能力/锁检查，再规划、验证、生成预览；状态为 queued/analyzing/planning/validating/preview-ready/failed/cancelled。支持查询时保存远程 ID，超时按能力查询；不支持则交由用户明确重试。以实际返回 usage 为准。运行上述测试，并用真实配置验证一次文字规划和一次已展示范围的音频理解；分别记录未测能力，不据协议相似推断。
- [ ] **Step 5:** 提交该任务变更，commit message：`feat: plan audio edits through validated AI providers`。

### Task 4: 动态处理、预览对比、历史与导出

**Files:** Create `src/shared/dynamics.ts`, `src/main/creative/audio-preview-service.ts`, `src/renderer/features/creative/AudioStudio.tsx`, `src/renderer/features/creative/AudioComparison.tsx`, `src/renderer/features/creative/RevisionHistory.tsx`, `tests/integration/audio-preview.test.ts`, `tests/e2e/audio-studio.spec.ts`, `docs/verification/ai-audio.md`; Modify `src/shared/effect-registry.ts`, `src/renderer/audio/effect-chain.ts`, `src/main/export/filter-builder.ts`, `src/renderer/App.tsx`。

**Interfaces:**
- Produces: `AudioPreviewService.apply(plan: EditPlan, ctx: RequestContext): Promise<{ revision: ProjectRevision; previewAsset: AssetRecord; timeMap: TimeMap; evidence: AudioEvidence }>`；使用实际派生文件，绑定新 hash。
- Produces: effectId=`compressor`, paramVersion=1，参数 `thresholdDb: -60..0`、`ratio: 1..20`、`attackMs: 0.1..200`、`releaseMs: 10..2000`、`makeupDb: -12..12`；effectId=`limiter`，参数 `ceilingDb: -12..0`、`releaseMs: 10..2000`。必须注册实时与导出实现才能接受对应方案。
- Produces: `comparisonGains(originalLufs: number | null, processedLufs: number | null): { originalGain: number; processedGain: number } | null`，对较响版本衰减到较低者，未知指标禁用匹配；增益为线性倍率，对比不修改原始 preset 或导出参数。

- [ ] **Step 1:** 写测试：削波样本经 limiter 后峰值不超 ceiling 容差 0.2 dB；compressor 减小动态且预览/导出使用相同参数。基准改变时不应用旧结果；撤销恢复真实文件且 provider 调用数不增加；响度匹配将差值降至 0.5 LU 内，静音不产生无限增益。A/B 变速或裁剪后定位按 TimeMap 转换。

```ts
test('loudness comparison attenuates the louder version and handles silence', () => {
  const gains = comparisonGains(-20, -14)!
  expect(gains.originalGain).toBe(1)
  expect(gains.processedGain).toBeCloseTo(10 ** (-6 / 20), 6)
  expect(comparisonGains(null, -14)).toBeNull()
})
```
- [ ] **Step 2:** 运行 `npm run test:integration -- tests/integration/audio-preview.test.ts`、`npm run test:e2e -- tests/e2e/audio-studio.spec.ts`，确认失败。
- [ ] **Step 3:** 为动态效果建立共享参数、参数迁移和 FFmpeg 实现，首版 compressor/limiter 注册 export=true、realtime=false，准确预览使用同一导出链生成派生文件；界面明确这是处理后预览。修改动态强度时取消旧预览并重新渲染，不静默丢弃参数。播放已含 EQ/混响/动态/速度的派生预览时原实时 EffectChain 旁路、playbackRate 重置为 1，A/B 切换使用 TimeMap 保持原始源位置，不重复处理。输出峰值补偿作为实际参数记录。工作区显示本地测量、AI 推断与建议说明，支持强度调整、手动编辑、原始/处理、响度匹配状态、半拍/倍拍/偏移、撤销/重做与历史选择。
- [ ] **Step 4:** 运行完整 unit/integration/e2e、typecheck/build。模拟 API 断连后本地播放、手动参数和导出继续；真实代表音频完成目标→预览→A/B→撤销→导出→重开。检查源 hash 不变、处理文件与保存参数一致，试听记录具体差异。将服务/模型/分析区间/测试结论记录在 verification 文档。
- [ ] **Step 5:** 删除无版本引用的测试临时文件，提交该任务变更，commit message：`feat: preview and undo AI audio edits with export parity`。

## 依据与覆盖

本地响度和混响采用 [FFmpeg 滤镜文档](https://ffmpeg.org/ffmpeg-filters.html)；远程音频输入和 JSON 输出分别参考 [Gemini 音频理解](https://ai.google.dev/gemini-api/docs/audio)与[结构化输出](https://ai.google.dev/gemini-api/docs/structured-output)。接口文档只用于实现适配，不替代实际模型能力与听感验证。

规格第 1–4 节由任务 2/3/4 覆盖，第 5–6 节由任务 1/3/4 覆盖，第 7 节由任务 1/3 覆盖，第 8 节由四任务共同验收。音色参考匹配、人声/乐器替换和分轨生成不纳入本单元。
