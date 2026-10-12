# 当前 FFmpeg 的源码交付路线（2026-10-04，只读研究）

结论：保留当前 BtbN GPL-shared runtime；优先取得**同次官方构建的完整 download-cache artifact**，再与已有准确 FFmpeg 源码、固定 BtbN 配方及 patches 合并成实际源码交付目录。这比逐个克服 SVN/GitLab/Savannah 下载问题或更换 runtime 更直接。源码 artifact 已存在并未过期，但本研究没有下载或检查其内容，因此仍不能写“完整对应源码已交付”。本机生成并由当前用户自行运行 installer，可以继续打包验证；把它交给其他人，即使私下免费，也要另行满足对应源码交付要求，不能用“没有公开发布”代替。

## 已核验的精确上游证据

- [官方日期 release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-01-13-06)：所选 ZIP 为 `ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip`，86333540 bytes，SHA256 `64f7d1460ce986804386582eeec3bd95117a4e84f7567ad416dd33f434fe8286`。官方 [release API](https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/autobuild-2026-10-01-13-06) 本次再次返回相同 asset digest。release 没有完整 source/cache asset；GitHub 的自动 Source code ZIP 是配方仓库，不能冒充依赖源码。
- [同日成功 Build FFmpeg run 36860751422](https://github.com/BtbN/FFmpeg-Builds/actions/runs/36860751422)：schedule，2026-10-01T12:17:14Z，`head_sha=e88e49f624457c455700b058f0a84ca87d499cc2`。发布 workflow 从本 run 的 `ffmpeg-*` artifacts 创建日期 release；本 run 也有 `ffmpeg-win64-gpl-shared-9.0`。这补足了旧报告未找到的 Actions run 来源。
- [artifact 元数据](https://api.github.com/repos/BtbN/FFmpeg-Builds/actions/artifacts/11161508103)：`download-cache`，id **11161508103**，**2206711199 bytes**，`digest=sha256:d26fac3719fb2836834571a95bed0f967e5531f32985200472bf12eda7d3bef5`；本次查询 `expired=false`，2026-10-15T12:17:14Z 到期。准确下载 API 是 `https://api.github.com/repos/BtbN/FFmpeg-Builds/actions/artifacts/11161508103/zip`，网页入口是上述 run 的 Artifacts → download-cache。
- 固定 [build.yml](https://github.com/BtbN/FFmpeg-Builds/blob/e88e49f624457c455700b058f0a84ca87d499cc2/.github/workflows/build.yml) 的 build_base 先执行 download.sh/clean_cache.sh，再把 `.cache/downloads/*` 打进 `cache.tar.gz` 上传为 download-cache；因此缓存由本次构建生成，而非猜测的第三方镜像。
- 固定 [download.sh](https://raw.githubusercontent.com/BtbN/FFmpeg-Builds/e88e49f624457c455700b058f0a84ca87d499cc2/download.sh) 调用每个 recipe 的 `ffbuild_dockerdl`，按下载命令 SHA256 命名 tar.xz，同时保留短名 symlink。下载逻辑覆盖 SVN checkout、额外 gnulib 等 recipe 特有输入；**不只顶层 GitHub tarball**。
- 固定 [librsvg recipe](https://github.com/BtbN/FFmpeg-Builds/blob/e88e49f624457c455700b058f0a84ca87d499cc2/scripts.d/50-librsvg/99-librsvg.sh) 的 `ffbuild_dockerdl` 明确执行 `cargo vendor --versioned-dirs > .cargo/config.toml`；因此该缓存是解决旧清单缺 Rust vendored inputs 的正确候选。还须下载后确认 vendor、Cargo.lock、各 crate LICENSE 和 checksum 文件真实存在。

API 元数据本次经 PowerShell 对官方公开 API 只读查询取得；没有下载 artifact 文件。GitHub [下载说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts) 要求登录且有仓库读取权限；[REST 文档](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact) 说明下载需要认证并返回一分钟有效的跳转 URL。本机 `Get-Command` 未找到 gh/docker/svn；现成 Chrome 登录会话可作为下载入口。

主 Agent 已实测 GitHub connector 的 `github_download_workflow_artifact` 拒绝此 artifact：工具上限 **536870912 bytes**，目标 **2206711199 bytes**。因此 connector 不能承担主推荐的下载，也不能靠该接口拿到完整缓存后再筛选。实施顺序应直接检查已登录 Chrome 的官方 artifact 入口；若没有可用登录/认证，不要继续重复调用 connector。研究随后仅检查官方 download API 的未认证响应（禁止跟随跳转、没有落盘），返回 403 **API rate limit exceeded**，没有 Location；这只能证明本次匿名 API 路线失败，不能据此说 artifact 已消失。

没有找到该日期 release 的官方匿名完整 source-cache 链接或预分片版本。`cache.tar.gz` 是整个 `.cache/downloads` 的单个 gzip 文件，官方 artifact API 没有按内部 recipe 单独下载的参数；HTTP Range 也不能直接产生可验证的所需 tar.xz 子集。已有单库固定 codeload URL 可匿名取得各自源码，但不会覆盖 SVN/额外 gnulib/Rust vendor，回到逐个补齐路线并未消除旧缺口。不要把第三方匿名 artifact 代理当成已确认的官方源。

## 实施者的最小剩余任务

1. 在到期前下载上述 **download-cache**，保留原始 ZIP，计算 `Get-FileHash -Algorithm SHA256` 并与官方 digest 比较；保存 API JSON、run URL、下载时间、bytes/hash。浏览器有登录时直接点官方 artifact，无需安装构建环境；有现成已认证 gh 时可用 `gh run download 36860751422 --repo BtbN/FFmpeg-Builds --name download-cache --dir <new-directory>`，但它会解包，原始 ZIP 摘要应通过直接 API/browser 下载验证，不能把解包后 cache.tar.gz 的 hash 与外层 artifact digest 比较。
2. 解开 ZIP 与 cache.tar.gz。先 `tar -tf <cache.tar.gz>` 保存清单，再检查短名 symlink 目标与 hashed tar.xz 对应；Windows 解包工具可能不保留 symlink，不能由短名缺失就断言源码缺失。核对固定 recipe 的全部非空下载 hook 都有缓存；至少确认旧缺口 LAME r6835、Xvid r2204、x264、DVD 三库、soxr、libiconv+gnulib、libbluray、libssh、Cairo 和 librsvg/vendor。对 Git 输入用保存的 `.git` HEAD 核对 commit；SVN 输入核对 `.svn` revision；同时保存每个真实 tar.xz bytes/hash、LICENSE 路径和 recipe hook 映射。
3. 采用**缓存全量 superset**交付最省审核工作：准确 FFmpeg 源码 `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1` + BtbN `e88e49f...` 配方完整归档（含所有 patches）+ 本 run 下载缓存 + 实际 GPLv3 文本 + 实际 `-version/-buildconf` + binaries hashes。FFmpeg 本体和配方归档已在现有 source-cache，须重新计算 hash 与现有 manifest 对照。全量 recipe 缓存包含禁用 variant 的输入，这是明确声明的额外资料，不能把这些全部写成已编入所选 DLL。
4. 附 BUILDING.md：原始命令 `./makeimage.sh win64 gpl-shared 9.0`、`./build.sh win64 gpl-shared 9.0`，再解释 FFmpeg 本体的准确 commit。固定 build.sh clone 的是可移动 release/9.0，因此复建时必须在 clone 后 checkout 该完整 SHA（记录这一复建脚本修改）；不要承诺今天运行未改脚本就重现相同 binary。普通通用构建工具/System Libraries 有例外；任何实际额外静态输入仍须从 recipe/日志查明，不能用“系统依赖”笼统豁免。
5. 交付目录可把实际源码归档作为 installer 邻接 `sources/`，随 installer 一起给用户，notices 明确相对路径并确保离线可打开；无需把约2.2GB ZIP 强塞进 NSIS。若产品要求安装后仍可访问源码，按同样实际文件安装或复制。避免仅放将到期的 Actions 链接；仅放 FFmpeg 本体 tarball 也不够。许可证条文参考 [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html) §1/§2/§6 与 [FFmpeg legal](https://ffmpeg.org/legal.html)。本次没有建立三年书面 offer，也不应虚构它。

完整性判据是：交付目录里实有准确 FFmpeg 输入、准确构建/修改脚本与实际依赖源码（含额外 vendor 输入）、许可证、来源/哈希清单；所有下载 hook/已静态组合输入有对应文件或有具体可说明的例外。当前 artifact 仅凭存在和摘要尚不满足这个判据。

## 备选路线与真实阻塞

官方固定 `download.sh` 可在具备 Bash+Docker 的环境重新取得全部 recipe 下载缓存，librsvg vendor 由它自动完成：解开已有固定配方后执行 `./download.sh`，再逐项核对。它使用 `ghcr.io/btbn/ffmpeg-builds/base:latest` 作为下载工具镜像，重新获取依赖不代表取得原始构建 container digest，也不能据此宣称位级重现。此路线不要求重建产品，但当前本机未发现 docker，需要另一个已具备工具的环境或另行安装；本研究没有安装。第三方上游不可达、认证下载失败或 artifact 到期时，这才是实际输入/环境阻塞。

[Gyan essentials](https://www.gyan.dev/ffmpeg/builds/) 是较小的现成 Windows runtime，官方表明有全部 Windows internal components、libmp3lame、libx264，因此理论上可保留 WAV/FLAC/MP3/H264 与 afir/equalizer/acompressor/alimiter/ebur128/atempo；仍须实际 probe/导出回归。它仍含数十个外部库，页面的 source 链接只指 FFmpeg 本体，没有已核验完整依赖 source bundle，故**不是解决本次源码交付的更短路线，不推荐现在切换**。精简自建 FFmpeg+LAME+x264 可减少闭包，却需要可工作的 Windows 交叉构建环境和功能验证；当前未证实已具备，不能当成即刻可用替代。

本机打包功能验证无需因为尚未发布而被要求承诺外部 source hosting；对外交付完整源码尚未完成的真实原因是：2.2GB artifact 未下载/逐项验证。若无法利用既有 GitHub 登录或认证 CLI 下载，所需外部输入是**官方 artifact 的认证读取能力**，不是重新研究许可或更换所有 runtime。

## 本轮获取状态与暂停

主 Agent 检查了本机工具：没有 gh；C 盘可用空间约 111GB。GitHub connector 因 artifact 超出 512MiB 上限而立即拒绝，未下载缓存。CUA inventory 没有可用 Chrome，Edge inventory 报连接失败；已安装 Tabbit 的 diagnose 返回 BROWSER_RUNTIME_UNAVAILABLE，未建立浏览器任务或下载。用户随后要求保存暂停，本轮没有安装工具、登录新账号、下载这份缓存或开展后续打包实现。上述官方输入信息保留给恢复后的 Task 7；对应源码完整性仍未成立。
