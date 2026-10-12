# Task 5 修复第 1 轮独立复审（2026-10-05）

审查 Agent：`/root/source_rereview_5_r1`；范围：`d7d7572..e73f497`。

- 同源在线 A→B 取消：ADDRESSED。`lx-host.ts:147,152,157` 将调用者取消与超时终止分开，迟到结算清理 pending/watchdog，超时绑定捕获窗口实例。真实 Electron 覆盖同源 B 成功、A 迟到、跨旧期限重新启用及取消无限循环后的原 watchdog。
- 主窗口退出：ADDRESSED。`index.ts:113,136` 在 Windows 主窗口关闭时主动退出并清理全部隐藏窗口。测试在 app.close 清理前验证真实 Electron ChildProcess exitCode=0，focused 1/1。
- 核验期间到期：ADDRESSED。`completeness.ts:37,57` 显式区分 expired；`resolver.ts:45` 前检与核验后到期共用一次刷新，fresh bytes 重新核验，仍受原信号、90 秒预算和六组合约束。新增真实 HTTP 测试覆盖新字节、连续到期、普通失败、预算及取消。

新破坏：None。范围外观察：None。Fix round：All findings addressed, no new Critical/Important breakage。三个 Important 均关闭。

复审核对报告内 resolver 10/10、真实 Electron 三条通过与主窗口关闭定向 1/1、typecheck/build 和 scoped/cached diff 检查的命令、输出及覆盖；没有重跑已通过测试，checkout/index/HEAD 只读。原诊断和构建噪声 Minor 已由 Task 7 承接；真实第三方源和人工试听保持未配置/待验收。
