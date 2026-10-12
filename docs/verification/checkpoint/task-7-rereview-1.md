# Task 7 Fix 1 独立复审

日期：2026-10-11，Asia/Hong_Kong。审查者 `/root/player_rereview_1`，只读。Fix BASE `625035c8b85fb0c0e0d974377789caa12f6316c8`，HEAD `63d1b3153f5b6615208f4b287dd028f37883b912`，产品提交 `35fe044`。

## 原 finding verdict

- Important：正常关闭丢失已接收的设置/素材事务 — **ADDRESSED**。`src/main/index.ts:66` 先封新请求，等待已接收请求和导出任务，再执行 `StorageRepository.close()`；`repository.ts:62` 同步封写入并排空模块队列。实际安装 pending rename 完成后才 will-quit，requested/persisted/restart volume 均为 .9；尚未入存储队列的导入也完成索引，晚设置请求被拒绝。
- Minor：已打开设置页不刷新来源初始化结果 — **ADDRESSED**。`SettingsView.tsx:6` 为仍初始化的已启用来源递归刷新，成功/失败或截止时间后停止；unmount 清 timer、屏蔽晚响应。真实 Electron 日志覆盖无需导航/保存即可显示成功与 5 秒超时。

## 修复引入的新问题

**Important — `src/main/index.ts:70`、`:115`：正常退出错误等待无存储网络请求。** `acceptedRequests` 包含 playback.resolve、search.run 等全部请求；关闭不取消这些请求，却拒绝取消 IPC。既有播放解析预算 90 秒，外部下载停滞会让窗口与进程等到请求结束/预算耗尽。

只读工作树的真实 Electron 聚焦探针使用合法 LX fixture，持有 playback.resolve 的媒体 fetch，正常关闭后 1210 ms：

```text
processStillAlive=true
mainWindowStillPresent=true
fetchAborted=false
playback.cancel=应用正在关闭，拒绝新请求
```

释放该无存储 fetch 后才退出。退出应主动取消非持久化请求，同时等待已接收写入、导入和需要完成的导出事务。没有发现其他 out-of-scope 问题。

## 证据与结论

已核对 77 unit、29 相关 integration、10 聚焦 Electron、3 实际安装测试、dist/media/typecheck/build/package 日志及安装/关闭 JSON。未重跑整套测试；仅运行上述探针，临时 userData 已清理，工作树/index/HEAD/分支未改。

**Fix round：Findings remain open。** 原两项已解决，新增 Important 进入原实施者 Fix round 2/5。Task 7 尚未完成，Fix 1 安装程序不是最终发行附件。
