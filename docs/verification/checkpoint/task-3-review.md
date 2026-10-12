# Task 3 独立审查（2026-10-04）

审查者：`/root/player_review_3`。审查范围为 `48916f3b402bdca3ead8db2143126843a624a71b..6fcaa0b8443ab4634b65790f466413aa158fb691`，使用完整 diff、Task 3 brief、实现报告和衔接说明。审查只读，没有重复执行已通过的测试。

结论：规格存在问题，代码质量为 Needs fixes。主要功能齐全，真实 OfflineAudioContext 采样、实际媒体播放时长/频谱和宿主素材解析已有证据；以下两个 Important 必须修复。人工试听按既有决定保留 pending。

## Important

1. **旧媒体事件覆盖新选择。** `src/renderer/audio/player-engine.ts:42,47` 的 `prepareLoad` 只暂停旧媒体。A 的 `ended` 已排队时选择 B，旧事件仍可在 B 解析期间改变 loading 状态，并经 `src/renderer/App.tsx:79` 自动下一首覆盖 B；永久 error 监听有相同隔离缺项。需要覆盖已进入 load 后切换及旧 ended/error 晚到。
2. **删除曲目后控制和队列失效。** `src/renderer/App.tsx:80`、`src/renderer/features/player/PlayerBar.tsx:9,15`：删除正在播放的 A 后音频继续，但 `currentTrack` 消失，暂停/前后切歌禁用。删除排队的 B 后队列仍包含它，A 结束时找不到 B，后续 C 不播放。需要同步队列，并停止被删除的当前播放或保留可控制快照。

行号对应原审查 head，修复后可能变化。

## Minor 与后续消费者

- `src/main/assets/media-protocol.ts:31,47`、`src/main/assets/asset-registry.ts:92` 在签发及每次 Range 完整 hash 原文件，定位成本随文件大小增长；校验后重新打开路径，实际读取并非不可变快照。普通本地播放列 Minor；后续 hash 绑定的导出和创作服务必须确认实际读取内容，不能沿用不可变内容的假设。
- `src/main/assets/media-protocol.ts:29,46`、`src/renderer/audio/player-engine.ts:82` 的本地租约过期后没有保留位置的重新解析路径；暂停超过 24 小时后定位可能得到 410。过期句柄被拒绝符合要求，“短期”没有确定阈值，因此不单独作为规格阻塞。

## 处理状态

修复轮 1 由 `/root/player_task_3_fix` 承接，原暂停前实现者不在当前会话中。用户随后要求在最近适当节点保存暂停，因此仅完成当前必要修复和覆盖验证；独立 scoped re-review 留到恢复，不把已保存实现标为完整验收。

修复代码保存于 `3ded616d3123217a78fa30741c4062431bdd0b60`。队列 6/6、真实 Electron 生命周期与播放 7/7、typecheck/build 通过，详细证据见[实现报告](task-3-report.md)的本轮追加部分。恢复复审使用 `6fcaa0b..3ded616`，不重做本次首次审查。
