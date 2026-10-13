播放器首个可用版本，适用于 Windows x64。

下载并运行 **MusicWorkbench-0.1.0-Setup.exe**；安装完成后，运行所选安装目录中的 `MusicWorkbench.exe`。安装包包含媒体运行时，当前为未签名构建。私有发行版仅对有仓库权限的账号开放。

本版支持文件/文件夹/拖入导入、曲库/收藏/歌单、播放队列、0.5–2 倍速度与保持音高、10 段均衡器和混响、裁剪与 MP3/FLAC/WAV 导出、网易云/酷狗/QQ 搜索、LX 音源配置和重启偏好。移除曲库条目不删除原文件；裁剪导出保存新文件。

验证结果：完整单元 79/79、集成 67/67、普通 Electron 界面 37 项、实际安装专属流程 8/8 通过。安装版覆盖导入、播放/定位、设置重启、FLAC 导出、原文件保护及关窗取消/进程/临时媒体清理。

第三方完整播放需要用户提供可用 LX 音源。2026-10-12 三平台实时搜索均 HTTP 200、各返回 5 条记录；安装版测试音源证明应用流程，真实第三方整曲尚未验收。AI 音频编辑与模板动效留后续版本。

**媒体源码材料**：下载 `MusicWorkbench-0.1.0-media-sources.7z.001`、`.002`、`.003` 三个分卷，放在同一目录，用 7-Zip 打开并解压 `.001`。材料包含固定源码、构建配方、完整已收集依赖与 262 文件校验清单，三个分卷的完整性检查已通过。执行其中 `verify-sources.ps1` 校验文件；`DELIVERY-STATUS.md` 继续披露构建时 `cargo update cc` 后准确 build-helper lock 未保存及实际链接闭包未全部确认的限制，不承诺字节一致重建。

`SHA256SUMS.txt` 提供安装包和三个分卷的 SHA256。安装包校验值：

```text
d125c98f96dfd1eeca94728b5d72b45010697d3fa051e0a2022fff5dbad243f5
```

[使用与构建说明](https://github.com/tallelella1/music-workbench/blob/main/README.md) · [验收证据](https://github.com/tallelella1/music-workbench/blob/main/docs/verification/music-player.md) · [第三方许可](https://github.com/tallelella1/music-workbench/blob/main/THIRD_PARTY_NOTICES.md)
