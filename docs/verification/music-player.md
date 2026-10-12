# 音乐工作台 v0.1.0 验收

日期：2026-10-12，Asia/Hong_Kong。本轮交付基础播放器并推送私有仓库；AI 音频编辑与模板动效保留为后续独立范围。用户最新要求尽快结束并减少非必要测试，已通过的完整测试不再重跑。

## 功能与实际安装

本版提供 Windows x64 桌面应用、文件/文件夹/拖入导入、曲库/收藏/歌单、播放队列、0.5–2 倍速度与保持音高、10 段均衡器/混响、非破坏性裁剪与 MP3/FLAC/WAV 导出、网易云/酷狗/QQ 搜索、可配置 LX 音源和设置持久化。

最终产品修复提交 `6d36f7e`。`release/MusicWorkbench-0.1.0-Setup.exe` 的 SHA256：

```text
d125c98f96dfd1eeca94728b5d72b45010697d3fa051e0a2022fff5dbad243f5
```

安装程序在工作区含空格的既有验收目录原位升级，exit 0、卸载身份一致、实际安装 ASAR 与新构建相同。实际安装 EXE SHA256 为 `9ab1d0a044907d989e9ad95dee3a41960f029d0d48c4c3a8b5acf0c9ee7f57de`，Authenticode 为 `NotSigned`。[安装记录](checkpoint/task-7-fix-2-installation.json) 保留新旧包、目录与身份。

## 已执行验证

- 完整 npm test 最终 exit 0：unit 79/79、integration 67/67、普通 Electron 37 passed；8 个实际安装专属测试在该运行中按条件跳过，随后以明确安装 EXE 单独执行，8/8 passed（42.4 秒）。首轮两项失败来自忽略 AbortSignal 的 native fetch 测试模拟；修正模拟并保留原超时/迟到断言后，搜索专项 4/4 与完整重跑均通过。失败记录未删除。
- 最终 typecheck、build 和 dist:win 均 exit 0。安装后一次实际 package/media 检查通过：1074 ASAR entries、5 app JS 无开发下载器；9 个固定媒体 exe/DLL 的 hash/version、编码器和滤镜匹配 manifest。
- 安装版通过中文/空格/emoji WAV 导入、播放/定位、设置重启、真实 FLAC 导出和原音乐字节保护；启动随包 LX preload/runtime，抛错及死循环音源保留偏好并报告失败，本地播放和编辑可用。
- 安装版 playback/source-test/search/decode/LX-network 五种关窗场景全部取消请求并完成实际资源清理，拥有的进程与临时媒体残留均为 0。playback 关闭 385 ms，decode 750 ms，FFmpeg close 和临时目录 cleanup 均先于 will-quit。
- 已接收设置的慢速原子写入在退出前提交，重启音量为 .9；已接收导入在退出前完成，新的关闭期写入被拒绝。完整命令、RED/GREEN、截图及清理记录见 [Fix 2 报告](checkpoint/task-7-fix-2-report.md)。

[实际播放与导出证据](checkpoint/task-7-fix-2-installed-acceptance.json)、[播放退出](checkpoint/task-7-fix-2-installed-playback.json)、[解码退出](checkpoint/task-7-fix-2-installed-decode.json)、[设置退出](checkpoint/task-7-fix-2-installed-shutdown.json)、[导入退出](checkpoint/task-7-fix-2-installed-import.json) 和 [安装资源](checkpoint/task-7-fix-2-package-content.json) 保留实际结果。Fix 1 与原 Task 7 报告保持历史，不代表本次最终安装包。

## 在线来源及已有边界

2026-10-12 实时搜索：网易云 wy、酷狗 kg、QQ tx 均 HTTP 200，各取得 5 条记录，总数观察分别 271/480/999。[当日探针数据](providers/2026-10-12/probe-latest.json) 与历史 fixture 分开保存。搜索成功不代表取得完整歌曲地址。

真实用户 LX 音源尚未配置，第三方整曲播放未验收；安装验收使用本机合法 HTTP 完整媒体验证宿主和沙箱。个人音质试听待用户完成。2026-10-11 production audit 0、development 9 条 advisory 的历史记录仍适用未变化的锁文件；本轮实际安装资源检查继续确认对应开发代码未随包。[审计记录](../research/2026-10-11-packaging-advisory.md) 保留具体范围。

## 源码与发布

[私有仓库](https://github.com/tallelella1/music-workbench) 已创建；[最终合并独立审查](checkpoint/base-final-review-2026-10-12.md)已通过，无阻断项；远端交付正在执行。普通 Git 源码快照排除超限媒体 DLL，保留本地全部开发历史；克隆后通过固定版本与 SHA256 核验的恢复脚本获得 9 个媒体文件。详见 [源码交付](github-source-delivery.md)。

媒体源码 262 文件已核验，三个发行分卷完整性检查通过。材料继续披露构建时 cargo update cc 后准确 build-helper lock 未留存及实际链接闭包未完全确认的限制，不承诺字节一致重建；见 [媒体源码材料记录](../research/2026-10-04-media-source-delivery.md)。
