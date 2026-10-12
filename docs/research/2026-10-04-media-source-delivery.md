# FFmpeg 对应源码交付跟进（2026-10-04）

状态：**DONE_WITH_CONCERNS**。交付目录为 `.superpowers/sdd/media-source-delivery/sources/`：262 个文件按 SOURCES.sha256 全部核验。所选 GPL-shared runtime 未改动，没有安装 Docker 或执行构建。当前没有已证实的媒体库源码缺包；明确保留局部限制：**cargo update cc 后 build-helper lock 未保留**。不额外声称完整实际链接源码闭包或字节一致重建，软件本地功能和安装验收可继续。

## 来源、字节与摘要

官方 [BtbN Actions run 36860751422](https://github.com/BtbN/FFmpeg-Builds/actions/runs/36860751422) 的 download-cache artifact=11161508103，head_sha=e88e49f624457c455700b058f0a84ca87d499cc2，metadata expired=false，expires=2026-10-15T12:17:14Z。完整 ZIP **2,206,711,199 bytes**，SHA256 **d26fac3719fb2836834571a95bed0f967e5531f32985200472bf12eda7d3bef5**，实测与 GitHub 官方 digest 相符。证据：sources/official-artifact-metadata.json、sources/download-verification.json。

匿名入口根据 [nightly.link 作者说明](https://github.com/oprypin/nightly.link)，实际 run 页面列出 download-cache。GET `https://nightly.link/BtbN/FFmpeg-Builds/actions/runs/36860751422/download-cache.zip` 返回 302 至 GitHub Actions productionresultssa19.blob.core.windows.net 临时 blob；HEAD 404 不代表 GET 不通。没有提供用户凭据，报告不保存临时签名 URL。第三方入口不称为官方来源，最终依据是 GitHub 官方 digest。download-cache.py 使用 curl GET Range、16 MiB 分块和有限重试，132 块已拼接核验；签名过期后只补缺块。

FFmpeg source commit=**46d8f462eeb87ee1f704d8c44a0ee24fca471ad1**，tar.gz **17,330,308 bytes**，SHA256 56999ad7cdcfbe520e989e38ac763341fab71b367ef8c20434117f8d1b7204a9。固定 BtbN tar.gz **107,871 bytes**，SHA256 afb0e526ee89ea9871b49b1a60bb5fdf9847f85816fb47b5bbd6528aa0643eda；279 个解压 regular file 与原配方逐字节一致，4 个 patches 和全部脚本内 sed/build 修改保留。旧素材 `.superpowers/sdd/packaging-research/source-cache/` 未动；本轮重新核验的 21 个归档和 9 个所选 exe/DLL 均匹配旧 manifest 与 resources/media-runtime.json。

220 个缺少的 crate 依据准确原始 rav1e Cargo.lock 从官方 `https://static.crates.io/crates/<name>/<name>-<version>.crate` 取得；8 并发、每包最多 3 次、每次 120 秒。**220/220 checksum 匹配，36,900,956 bytes**。逐包 URL、bytes/hash、许可表达式和归档内许可文件见 sources/rav1e-crate-supplement.json。另外 53 个准确 name/version/package-checksum 已在 librsvg vendor，未重复下载。

## 输入映射与准确边界

- ZIP -> cache.tar.gz -> `.cache/downloads/` 保留 127 个 tar.xz 与短名别名。132 hooks 中 125 个非空 download hook 都有对应 command-hash cache 和正确 alias，101 个对所选 variant enabled。command hash 是打印下载命令的 SHA256，与归档内容 hash 分别记录在 recipe-cache-map.json 和 cache-input-audit.json。enabled 不证明最终链接。
- 131 个 pin 检查通过 Git HEAD、官方 tag 解析、SVN revision 或重算源树。LAME SVN=6835、Xvid SVN=2204；OpenSSL/Vulkan-Headers/mbedtls tag 对应保留 HEAD。gnulib 按配方删 .git，实际 source tree=4246a0bc3c359aa27abb3ae57346702301d58e2b，与固定 commit 官方 tree 一致。AMF 全部保留 root entry 等于官方 tree；Thirdparty 原配方明确删除。故意删除 metadata 不列作源码缺口。
- librsvg vendor=357 crates，逐文件 checksum mismatch=0；原 vendor/lock/config/许可标头保留。13 包没有独立 LICENSE 文件，完整 source 和 Cargo.toml license 表达式仍在；license-index.json 列明具体项目。此情况不等于缺源，也不表示已逐条完成所有可选/测试/非 Windows 包的版权 notice 法律审阅。
- rav1e commit=31435de9d76fddd38f6dcc31d4014574cebb2092，原 lock 的 273 registry package 全覆盖（53 vendor + 220 补充）。这些 registry 包和 workspace 的 Cargo.toml 全部可读；按实际 normal/build/dev 边和 package rename 得到 normal 保守图=168 包，额外 build 图=71 包，含 optional/其它 target 和 proc-macro 宿主工具，不作实际链接清单。原图及边类型见 rav1e-dependency-role-evidence.json、rav1e-edge-kind-evidence.json。
- scripts.d/50-rav1e.sh 先 `cargo update cc`，后 `cargo cinstall -v "${myconf[@]}"`；myconf 有 --prefix、--destdir、--target、--library-type=staticlib、--crt-static、--release。同次 selected job 110365737515 的 rav1e step=CACHED，没有更新后 lock/version 输出。原 script/Cargo.toml/Cargo.lock/build.rs 单独留于 sources/rav1e-original/，完整源码在 ZIP。cc=1.2.26 不在 normal 图，只在 build 图；build.rs 用 cc 组织准确源码树内 NASM/ASM 编译和归档，cc 本身是宿主 helper。shlex=1.3.0、jobserver=0.1.33 只确认原版本；find-msvc-tools 原 lock 不存在，更新后是否引入和版本未知。
- [Cargo 官方 update 文档](https://doc.rust-lang.org/cargo/commands/cargo-update.html)规定指定 cc 时保守更新该包及必要传递依赖。原 cc 构建图与 normal 保守图共享 bitflags=2.9.1、cfg-if=1.0.1、libc=0.2.172，原版本源码已取得；CACHED 日志不能确认是否必须改变这些共享版本。没有证据显示程序代码版本因此不同，也不能排除局部必要更新；不能把 helper 版本未知泛化成全部媒体程序源码缺失。
- 实际 GCC16.2.0/crosstool-NG1.29.0.7_b1a94f6、-static-libgcc/-static-libstdc++、--extra-libs=-lgomp 的具体来源/许可见 GCC-RUNTIME-BOUNDARY.md。GCC16.2 libgcc/libstdc++/libgomp 源头显式包含 Runtime Library Exception3.1，全文和组件标头已附。普通固定 GCC 编译过程支持其适用推断；FFmpeg、媒体库、Rust crate、MinGW CRT 义务独立核查。不把未修改通用 GCC/binutils/Docker/Cargo/Ubuntu 全源码扩为新增交付要求。moving tags/日期仅限制字节复现。

## 实际命令与清理

项目根目录执行了以下自写读取/材料脚本；未执行 crate 或未知 build 脚本：

```powershell
python .superpowers/sdd/media-source-delivery/download-cache.py
python .superpowers/sdd/media-source-delivery/audit-source.py --resume
python .superpowers/sdd/media-source-delivery/check-rust-package-coverage.py
python .superpowers/sdd/media-source-delivery/fetch-rav1e-crates.py
python .superpowers/sdd/media-source-delivery/verify-removed-git-trees.py
python .superpowers/sdd/media-source-delivery/finalize-pins.py
python .superpowers/sdd/media-source-delivery/prepare-rust-evidence.py
python .superpowers/sdd/media-source-delivery/classify-rust-edges.py
python .superpowers/sdd/media-source-delivery/stage-final.py
& .superpowers/sdd/media-source-delivery/sources/verify-sources.ps1
```

最后验证输出 `Verified 262 source files`，exit=0。sources/SOURCES.files.json 记录逐文件 bytes/hash；SOURCES.sha256 不包含自身，准确总大小见根目录 final-delivery-verification.json。唯一原 ZIP 留于 sources/；根目录重复 ZIP、cache.tar.gz、已审完 cache-inputs 和两个无用临时文件已删除，释放 **6,618,962,321 bytes**。删除前逐项 Resolve-Path 并检查绝对路径在拥有目录内、无 reparse point，用同一 PowerShell 的 Remove-Item -LiteralPath。旧素材及其他 Agent 文件未动。

## Task 7 复制方案

在项目根目录，将 `$installerFile` 设置为实际生成的本地安装包完整路径，再复制到安装包邻接 sources；此报告不虚构产品产物名。无需把 2.2 GB ZIP 塞进 NSIS。

```powershell
$preparedSources = (Resolve-Path -LiteralPath '.superpowers/sdd/media-source-delivery/sources').Path
& (Join-Path $preparedSources 'verify-sources.ps1')
if (-not (Test-Path -LiteralPath $installerFile -PathType Leaf)) { throw 'Installer file missing' }
$installerParent = Split-Path -Parent (Resolve-Path -LiteralPath $installerFile).Path
$adjacentSources = Join-Path $installerParent 'sources'
New-Item -ItemType Directory -Path $adjacentSources -Force | Out-Null
Get-ChildItem -LiteralPath $preparedSources -Force | Copy-Item -Destination $adjacentSources -Recurse -Force
& (Join-Path $adjacentSources 'verify-sources.ps1')
```

整体复制，包含 ZIP 依赖、补充 crate、原始脚本/patches/lock 和边界说明。BUILDING.md 说明用保持 POSIX symlink 的工具解压缓存、原构建命令和 FFmpeg 固定 commit。pin-ffmpeg-source.patch 已 git apply --check，只作可审查复建补丁；没有改 runtime。保留原 update 命令和精确 helper 版本限制，不承诺离线原样构建或字节复现。

安装包 notices/文档可引用：`sources/COPYING.GPLv3`、`sources/NOTICES.md`、`sources/license-index.json`、`sources/GCC-COPYING.RUNTIME`、`sources/GCC-RUNTIME-BOUNDARY.md`、`sources/BUILDING.md`、`sources/DELIVERY-STATUS.md`、`sources/SOURCES.sha256`。具体依赖许可和版权源文件仍在原归档，内部路径由 license-index 给出。复制后使用同一核验脚本，并保留局部 helper lock 限制。
