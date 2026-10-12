# GitHub 源码交付

日期：2026-10-11，Asia/Hong_Kong。

用户已选择本轮交付基础播放器首版，并新建私有仓库 `tallelella1/music-workbench`。AI 音频编辑和模板动效作为后续独立单元保留规格与计划。

## 源码与媒体资源

本地 `resources/bin/avcodec-63.dll` 为 119,112,704 bytes，超过 GitHub 普通 Git 的 100 MiB 限制。发布使用无父提交的源码快照，保留 `codex/music-player` 的全部本地开发历史；没有改写原历史或删除本地媒体文件。GitHub 快照包含应用、锁文件、测试、固定媒体 manifest、许可证、Windows 构建流程与媒体恢复脚本，媒体二进制通过 `scripts/setup-media.ps1` 恢复。

固定归档 URL、归档 SHA256、各二进制的字节数与 SHA256 均来自 `resources/media-runtime.json`。脚本先校验归档和全部 9 个文件，再复制文件；错误归档不安装。`resources/bin/`、`.cache/`、`.superpowers/` 与 `release/` 不进入源码快照。

GitHub 的[普通 Git 文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)和[发行附件限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)已在实施日核对。媒体源码材料以三个低于 2 GiB 的 `.7z` 分卷随私有发行版提供，安装程序单独提供；开发历史和原始源码材料仍保留在本地。

## 已执行检查

- 在全新测试目录中传入错误归档，脚本报告 SHA256 mismatch，`resources/bin/` 没有产生。
- 同一测试目录使用已有固定官方归档恢复成功，9 个文件均按 manifest 核验；现有完整运行时的幂等路径也成功。
- 官方媒体归档 HEAD 返回 HTTP 200，Content-Length 为 86,333,540 bytes。
- Windows CI YAML 解析成功；checkout、setup-node 和 upload-artifact 均使用实施日经官方 GitHub API 核验的 v7 commit SHA。
- `release/sources/verify-sources.ps1` 核验 262 个文件；完整材料打包为三个分卷，实际总归档大小 2,263,176,849 bytes。
- `7za t MusicWorkbench-0.1.0-media-sources.7z.001` 完整性检查通过，三个分卷还原 263 个文件、2,263,171,435 bytes。安装程序和分卷 SHA256 已计算，随发行版提供 `SHA256SUMS.txt`。
- GitHub 本机认证账号为 `tallelella1`；创建后的仓库 API 返回 `private=true`，Git 通道可读取该空仓库。

源码快照提交、远端核验、发行附件哈希与最终验收结果在发布完成后补入 `music-player.md`。受保护存储中的 GitHub 凭据只在内存用于对应官方 API，不写入项目或发布材料。
