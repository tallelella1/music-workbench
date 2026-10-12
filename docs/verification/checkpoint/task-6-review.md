# Task 6 独立审查

审查者：`/root/audio_export_review_6`，2026-10-05。

范围：`7b666f8a3f98cdbce78b3383b6a84868101e255f..d65e5c1a94dd9a2f5f4dc35550393f9671bb3b63`。完整读取任务需求、报告与 `task-6-review-20261005.md`；未修改 checkout/index/HEAD，未运行测试，未派生子 Agent。

Spec：**Spec issues found**。Quality：**Needs fixes**。Critical：None；Minor：None。以下四项 Important 必须修复后复审。

## 已证实的正常链路

`AssetRegistry.checkedSnapshot` 对实际写入受控副本的同一批字节验证 hash/length，FFmpeg 消费该副本；集成测试证明原路径随后变更不影响快照。采样帧约束、源裁剪/速度/EQ/共享 IR/成品秒淡入淡出与 parent/hash/probe/sourceTimeMap 登记有对应实现。worker 冻结参数、验证 provenance，shell=false，使用固定运行时；具名 IPC 与 strict DTO 保持路径不出主进程。

七种实际编码、长路径、真实 Web Audio 与 FFmpeg 的频谱/采样/双声道 IR 均有实际断言。编辑期间迟到播放被暂停，预览卸载显式停止，有真实 Electron 回归。报告没有将 fixture 或自动播放冒充个人试听或第三方验收。

## Important

1. **处理期间退出应用没有取消和等待清理。** `src/main/index.ts:119`、`:143`；关联 `src/main/export/ffmpeg-worker.ts:44`、`audio-export-service.ts:62`。触发：导出或预览运行时关闭主窗口。宿主直接退出，before-quit 只处理 extensions；exporter/preview/TaskService 没有统一 abort/drain，外部 FFmpeg 也没有退出管理。结果可能遗留 `.audio-*`、IR、快照及在途子进程，异步 finally 没有完成保证。最小修复：exporter 跟踪所有在途操作，退出时阻止新的处理，取消未提交操作并等待 worker close 与清理完成，再允许 app.quit。现有测试均在处理结束后关闭应用，没有覆盖此时序。

2. **取消可能报告成功，但目的文件已经保存或被覆盖。** `src/main/export/audio-export-service.ts:52`、`:62`；关联 `src/main/jobs/task-service.ts:33`、`:51`。触发：在 rename 的异步提交期间，或 rename 成功后的清理期间点击取消。TaskService 仍将任务置 cancelled，并丢弃最终成功结果；已提交目的文件不会恢复。用户看到“已取消导出”，实际成品已经产生，已有目的文件可能已被替换。最小修复：明确不可取消的提交边界；进入提交前检查取消，提交开始后拒绝/忽略取消并最终报告 completed，不能事后直接删除可能覆盖过旧文件的 destination。现有取消测试只覆盖 FFmpeg 编码期间。

3. **并发任务可以无提示覆盖彼此的成品。** `src/main/export/audio-export-service.ts:20`、`:52`；关联 `src/renderer/features/editor/AudioEditor.tsx:23`、`:59`。触发：启动较慢导出，关闭编辑器后重新打开并启动另一任务，两次保存对话框选择同一尚不存在的目的文件。导出关闭编辑器后继续运行，服务没有目的路径预留；两个任务都通过检查，后完成者会替换先完成者的结果。两次选择时文件均不存在，因此用户没有批准覆盖第一份成品。最小修复：按实际父目录/canonical destination 对在途目的路径建立互斥预留，冲突明确拒绝，在任务所有终止路径释放预留。

4. **清理失败会跳过其他清理并泄露主机路径。** `src/main/export/audio-export-service.ts:17`、`:62`；`src/main/assets/asset-registry.ts:120`。触发：Windows 文件占用、删除权限不足或目录异常，使 rm/release 返回 EACCES、EPERM、EBUSY。finally 中的原始错误绕过上方安全消息转换，第一个失败还阻止后续 IR/快照清理；TaskService 或 IPC 随后直接返回包含绝对路径的 error.message。最小修复：独立尝试全部清理，统一转换安全错误并保留内部诊断；快照创建失败后的清理也采用同样方式。报告的 blocked-directory 回归仅覆盖 mkdir，不能证明 cleanup 分支。

## 审查边界与控制端裁决

读取具名依赖 TaskService、StorageRepository、media-probe、main/index 退出段及 PlayerController/PlayerEngine 的播放状态位置，判断上述时序与登记一致性；没有展开其他模块。代码足以判断问题，无须重跑已经通过的验收。

- 实际第三方 LX 整曲、Gemini 和个人试听：用户已授权保留 unconfigured/pending，本轮不阻塞；接受。
- 最终 Windows 安装验收：后续 Task 7 和最终交付负责；接受。
- 正式派生素材垃圾回收 UI：本任务不要求新增管理 UI；后续创作仍须仅清理证明未被引用的临时资源；接受。
- 既有 Zod/Rollup annotation warning：报告如实披露，Task 7 负责已记录的噪声修复；接受。
- 控制端进度和后续文档提交：不属于被审查产品范围；接受。

结论：正常处理链路与媒体证明充分，但取消、退出、并发发布和异常清理的边界不一致。fix round 1/5 由原实现者继续，所有 Important 关闭后才完成 Task 6。
