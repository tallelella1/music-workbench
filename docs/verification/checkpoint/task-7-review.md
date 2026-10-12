# Task 7 独立审查

日期：2026-10-11，Asia/Hong_Kong。审查者 `/root/player_review_7`；BASE `bce69a429eebef83ef62f63c1d053e7885c5a627`；产品 HEAD `fa139cc90c908fc0c81a9e54475bdf94f36bbfc1`，随后 `8bd7862` 仅归档报告。只读审查，没有改动 checkout/index/HEAD 或提交。

**Spec Compliance：Needs fixes。Task quality：Needs fixes。** 设置迁移、共享事务、模块门控和真实安装验收基本符合约束；正常关闭仍会丢失已进入存储队列的偏好更新，阻断设置重启保留要求。

## 已核验

- `src/main/storage/repository.ts:44` 的 update 将读取、校验、修改和原子替换放在同一 module 队列，SettingsService 和 AssetRegistry 均使用它。`tests/unit/settings.test.ts:21` 覆盖实际并发导入与偏好更新。
- `src/shared/settings.ts:15` 明确迁移旧 EQ/reverb 参数，严格拒绝损坏/新版，`tests/unit/settings.test.ts:28`、`:34` 覆盖保留原文件。模块 list/resolve 均按 capability 过滤，本地编辑按本地能力开放。
- 新 IPC 继续校验具体 sender、frame、URL 和运行时 schema；LX 的 sandbox/contextIsolation/no Node 与 sender 边界在 `src/main/extensions/lx-host.ts:63`、`:112` 聚焦核对。
- 安装证据确实来自安装 EXE 和 app.asar，包含播放/定位、设置重启、原字节保护、随包 LX、失败音源、本地编辑和零残留进程。
- 最终日志核对 unit 75/75、integration 66/66、普通 E2E 28 passed/1 installed-only skipped、安装 E2E 1/1；dist 包含 media/typecheck/build。媒体与实际包扫描通过，未签名、fixture、开发 advisory 和源码重建限制有准确披露。

## Critical

无。

## Important：正常关闭未等待设置事务

位置：`src/main/index.ts:69`；相关 `src/renderer/App.tsx:105`、`src/main/storage/repository.ts:44`。自动保存发出 settings.update 后，关闭只等待 exporter/tasks.shutdown，未等待存储队列。设置和素材索引共用队列，`src/main/assets/asset-registry.ts:29` 在事务内 probe/decode，存在实际延迟路径。

审查者用真实 Electron 和隔离 userData，将 settings.json 的原子 rename 延迟 1 秒模拟慢 IO：先保存 volume=.2，再发送 .9；确认进入写入阶段后正常关闭主窗口，进程退出后仍读取 .2。实际输出：

```text
settingsWritePendingAtNormalWindowClose=true
requestedVolume=0.9
persistedVolumeAfterQuit=0.2
```

关闭应停止接收新写入，并等待已接收的偏好和共享存储事务完成后再退出；回归要覆盖 pending-update 正常关闭/重启。原重启测试在保存完成后才关闭，不能回答该疑点。

## Minor：设置页初始化状态不会刷新

位置：`src/renderer/features/settings/SettingsView.tsx:6`。页面仅 mount/保存后读取 extensions.list；启动后马上打开设置页时显示未运行，后台随后成功或 5 秒超时不会更新，直到重进或保存。应使用已有状态事件或有界刷新；当前安装验收先等来源稳定才打开页面，未覆盖此时序。

## 审查范围与后续

审查读取一次预生成 diff，补读被工具截断的必要段；只针对 LX 边界和关闭队列做聚焦检查，没有重跑整套测试。关闭探针已等待进程退出并清理隔离目录。

控制端分派给原实施者集中修复 Important 与 Minor，补有意义 RED/GREEN、重新构建及实际安装验收，再进行独立 scoped re-review。当前 Task 7 不标记完成，修复前安装包不作为最终发行附件。
