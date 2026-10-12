# 音乐工作台 v0.1.0

Windows x64 本地音乐播放器：文件/文件夹/拖入导入、曲库与歌单、完整曲目播放、速度与保持音高、10 段均衡器/预设/混响、非破坏性裁剪与 MP3/FLAC/WAV 导出。网易云/酷狗/QQ 在线搜索可查看曲目；线上完整播放需要可用且通过检查的 LX 音源。

[下载 Windows x64 安装包](https://github.com/tallelella1/music-workbench/releases/tag/v0.1.0)，选择 `MusicWorkbench-0.1.0-Setup.exe`。安装完成后，运行所选安装目录中的 `MusicWorkbench.exe`。仓库与发行版均为私有，需使用有访问权限的 GitHub 账号。安装包包含媒体运行时，无需另装 FFmpeg。这是未签名构建，实际安装、播放、设置重启和导出已验证。

启动后在“音乐库”导入音乐，也可拖入文件；播放栏调节音量和速度，“音效”设置均衡器/混响，“裁剪与导出”保存新的音频。移除曲库记录不删除原音乐。线上完整播放需在“音源脚本”导入并启用可用的 LX 脚本；搜索结果本身不提供完整播放保证。

源码开发需 Windows x64、Git 和 Node >=24.11.1。Git 仓库保存应用源码与固定媒体 manifest，克隆后先恢复媒体文件：

```powershell
git clone https://github.com/tallelella1/music-workbench.git
cd music-workbench
powershell -NoProfile -File scripts/setup-media.ps1
npm ci
npm run dev
```

媒体恢复脚本从固定官方归档下载，验证归档及全部 9 个 exe/DLL 的 SHA256，已恢复时可重复执行。二进制与生成目录不提交到 Git；本地原始开发历史保留，交付细节见 [源码交付记录](docs/verification/github-source-delivery.md)。依赖版本由 `package-lock.json` 固定，FFmpeg/ffprobe 不依赖系统 PATH。

验证与生成安装包按顺序执行，避免构建替换正在测试的生成目录：

```powershell
npm run build
npm test
npm run dist:win
node scripts/check-package.ts
```

安装程序生成于 `release/MusicWorkbench-0.1.0-Setup.exe`。CI 在 Windows 执行恢复媒体、单元/集成/界面测试和打包资源检查。设置保存在 Electron userData/settings.json，素材索引与偏好共用原子事务。

“应用设置”保存音量、速度、保持音高、音源排序/启用与导出默认值；音效面板自动保存。音源偏好与实际运行状态分开显示，重启会初始化已启用音源，失败保留偏好并显示原因。模块通过能力注册表开放，本地编辑不依赖远程创作服务配置。

验收结果、截图和真实/fixture 证据见 [播放器验收记录](docs/verification/music-player.md)，许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。当前未配置真实用户 LX 音源，第三方整曲播放仍待真实配置验收。AI 音频编辑和模板动效保留为后续独立单元。

发行附件中的 `MusicWorkbench-0.1.0-media-sources.7z.001` 至 `.003` 为完整媒体源码材料；将三个分卷放在同一目录，用 7-Zip 解压 `.001`，再执行其中的 `verify-sources.ps1`。`SHA256SUMS.txt` 提供安装包和分卷校验值。源码材料 `DELIVERY-STATUS.md` 保留 `cargo update cc` 后 build-helper lock 与实际链接闭包限制，不承诺字节一致重建。本地对应材料在 `release/sources/`。
