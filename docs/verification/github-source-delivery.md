# GitHub 源码交付

日期：2026-10-13，Asia/Hong_Kong。

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

## 已推送源码与对应关系

冻结产品为本地 `6d36f7e`，最终实际安装包 SHA256 为 `d125c98f96dfd1eeca94728b5d72b45010697d3fa051e0a2022fff5dbad243f5`。最初无父源码提交 `33f66a1a5f2c6b48da1f53f5720c856c5223fc7a` 包含 250 个文件；排除 9 个媒体二进制及一个历史 scratch 报告，其余 tree 与已审查本地提交一致。

私有 `main` 已普通快进至 `9492eaa091e77ae9940c1f07e42a5f50de6d2ded`，对应本地交付提交 `e172d31f7636625adfbc9166240eb96c0e2e21f5`。中间提交 `9cf9bc477a8d4100c727b82dc175f21cff0248b8` 只包含已审查 CI 顺序、fixture canonical path 与记录更新；最新提交只增加 CI 的 `--publish never` 及失败记录。更新脚本实际确认应用源码、锁文件和打包配置相对于冻结产品没有变化，并确认原分支未移动。原始本地开发历史与运行时文件继续保留。

首次与第二次远端失败及环境修正见 [CI 记录](checkpoint/ci-delivery-fix.md)。不把本地验收结果称为远端通过。受保护存储中的 GitHub 凭据只在内存用于对应官方 API，不写入项目或发布材料。

## 正式发行附件

[v0.1.0](https://github.com/tallelella1/music-workbench/releases/tag/v0.1.0) 已于 2026-10-13 正式发布，release ID `410666352`，`draft=false`，标签经 API 核实指向源码 `9492eaa091e77ae9940c1f07e42a5f50de6d2ded`。安装包、三份媒体源码分卷和校验清单全部上传成功，服务器状态、大小与 SHA256 已逐份核对，发布前再次检查全部摘要。该安装包就是通过 8/8 实际安装验收的最终包，没有重新构建或替换它。

原始元数据在 [发布记录](github/2026-10-13/release.json)、[仓库隐私记录](github/2026-10-13/repository.json)、[源码初始快照](github/2026-10-13/source-snapshot.json)、[最后一次 CI 源码快进](github/2026-10-13/source-ci-update.json)、[发行说明](github/2026-10-13/release-body.md)与[附件 SHA256](github/2026-10-13/SHA256SUMS.txt)。`main` 的最后交付文档更新保持标签和产品源码不变，不再触发重复 CI。
