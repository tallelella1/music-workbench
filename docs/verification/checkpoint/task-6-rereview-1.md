# Task 6 fix round 1 独立复审

审查者：`/root/audio_export_rereview_6_r1`，2026-10-05。

范围：`d65e5c1a94dd9a2f5f4dc35550393f9671bb3b63..c7bebec33384ac7913c97c6ad114fe2f55352251`，只复核原四项 finding 与修复引入的破坏。读取原审查、完整 Fix round 1 报告和固定范围 review package；未改 checkout/index/HEAD、未跑测试、未派生子 Agent。

结论：**Needs another fix round**，三项 ADDRESSED，一项 PARTIALLY ADDRESSED。无其他新增 Critical/Important/Minor。

1. **退出没有取消和等待清理 — ADDRESSED。** `src/main/index.ts:50`、`:121`、`:156` 统一拦截关闭与退出，等待 exporter 和 TaskService drain 后再 `app.quit()`；`audio-export-service.ts:89` 同步拒绝新处理，取消未提交操作并等待 worker shutdown；`media-probe.ts:10` 等待实际 child close。最终三个真实 Electron 退出回归与实现相符。
2. **提交期间取消错误报告 — ADDRESSED。** `audio-export-service.ts:71`、`:125` 在 rename 前同步检查取消并进入提交边界；`task-service.ts:61` 拒绝提交后的取消，`:41` 保留 completed 与结果。失败清理只删除未登记的独占预览，不删除已保存的导出目标。集成测试覆盖 rename/cleanup 窗口、具名 IPC、结果/字节，以及 rename 失败保留旧目标。
3. **并发任务覆盖成品 — PARTIALLY ADDRESSED，Important 仍开放。** 已有父目录 junction、Windows 大小写和排队取消释放的实现/回归。但 `audio-export-service.ts:39` 将稳定的 `realpath(parent)+basename` 键替换为已有目标的 `realpath(destination)`。如果目标目录项 D 是指向 T 的 file symlink，首任务锁 T；`:126` 的 rename 替换该链接后，D 的 canonical key 变为 D。首任务仍在清理、持有 T 锁时，后续请求可以获得 D 锁。第二保存选择若已批准旧 symlink、异步路径解析在首提交后才完成，还可能覆盖首成品而没有批准覆盖它。应始终保留稳定目录项键，并按需同时预留已有目标解析键，终止时一并释放。原 junction/case 用例选择尚不存在目标，未覆盖此分支；由路径解析和 rename 行为直接判断。
4. **清理跳过及路径泄漏 — ADDRESSED。** export service 独立尝试 temp、IR、snapshot 清理，原错误只留主进程诊断，对外使用固定安全提示。AssetRegistry 的 release 和快照创建失败同样安全清理。回归覆盖三项删除故障、其他清理继续和 IPC 安全结果。

共享 TaskService 普通取消仍 abort 并丢弃晚到结果；media-probe 保留固定二进制、参数数组和 probe/decode 契约。既有报告的 38 项受影响回归、最终 13 项 lifecycle、typecheck/build 和三个实际退出回归已检查，未重复已通过 baseline。

Declined to judge / Out-of-scope observations：None。已裁决的 LX/Gemini 未配置、个人试听 pending、后续安装验收不阻塞本轮。

控制端裁决：接受剩余 Important，fix round 2/5 由原实现者继续。最小范围为稳定目录项与解析目标的共同预留及其释放回归；Task 6 仍未完成，后续 Task 7 不提前开始。
