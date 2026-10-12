# Task 5 独立审查（2026-10-05）

审查 Agent：`/root/source_review_5_resume`。范围：`34df4d0..d7d7572`，使用原始 task brief、完整 review package 和实施报告。

Spec Compliance：不通过。Task quality：Needs fixes。无 Critical，三个 Important。

## Important

1. 在线 A→B 快切会终止 B 共用的音源。`src/main/extensions/lx-host.ts:144` 将普通取消与超时都交给 terminate/stop，移除 provider、禁用脚本并拒绝该脚本全部 pending 请求。切歌取消 A 后 B 也失败或找不到音源。应区分请求取消与永久禁用；必须销毁进程时保留启用意图，并协调重建和最新请求。补同一 LX 音源在线 A→B 的真实 Electron 回归。
2. 关闭主窗口后应用不会正常退出。`src/main/index.ts:132` 只在 before-quit 清理隐藏窗口，app.quit 仍依赖 window-all-closed；隐藏 LX BrowserWindow 使该条件不成立。主窗口 closed 只清空引用（`:113`）。Windows 主窗口关闭应主动退出或先关闭音源窗口，并验证真实进程退出。
3. 核验期间到期的链接不会刷新。`src/main/playback/resolver.ts:46` 仅在完整性检查前处理到期；`completeness.ts:56` 的核验期间到期被跳过。允许的一次刷新应覆盖明确到期结果，重新核验，继续受六组合/90 秒总预算；普通失败不重试。

## Minor / 后续

- `resolver.ts:53` 和 `completeness.ts:59` 将来源禁用、协议错误、超时、大小限制等具体原因合并。后续保留白名单错误码和安全消息，不能透传 URL/凭证。
- Zod PURE 与 NO_COLOR/FORCE_COLOR 噪声继续由 Task 7 处理。
- Task 7 验证安装包真实包含并启动 LX preload/runtime；Task 6 及创作模块遵守 offlineEditable=false。

## 审查证据与边界

完整 diff 分段读取；checkout/index/HEAD/branch 只读。普通取消风险的定向内存检查只替换 Electron/持久化边界：取消 A 后 A 取消、B 返回音源禁用，enabled=false、窗口销毁、provider 移除。此检查不冒充真实 Electron 验收。限定补读 createWindow 尾部和 PlayerEngine.load/prepareLoad，后者已具备代次隔离，未提出重复问题。未重跑已通过基线。

真实第三方脚本、三平台整曲、真实签名 URL 和人工听感仍未配置/待验收，符合用户已确定的范围，不阻塞软件及本地验证。
