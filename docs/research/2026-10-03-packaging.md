# Task 7 打包研究（2026-10-03，只读）

结论：目前没有 http-cache-semantics 已发布修补版，也没有比已用 electron-builder 26.15.3 更新的稳定版。开发下载链的 advisory 需要保留记录；本地代码没有开启受影响的 HTTP response cache。应用生产依赖审计本次为 0 vulnerabilities，但最终安装包还必须检查 ASAR 和资源内容。仅对 app-builder-lib 的 @electron/get 升到 5.1.0 可作为移除链条的候选，需要实际打包下载验证后才能采用。

## advisory 与实际调用

- [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 本次读取仍为 affected <=4.2.0、patched None。问题是 shared HTTP response cache 的 max-stale 可绕过禁止复用的缓存策略，涉及另一用户响应/Set-Cookie。不是一般 ZIP artifact 磁盘缓存漏洞。
- 官方 registry 实际命令 `npm view http-cache-semantics version` 返回 `4.2.0`；`npm view electron-builder version` 返回 `26.15.3`；`npm view @electron/get version` 返回 `5.1.0`。没有执行 audit fix、安装或产品改动。
- Task 1 audit 的 8 high 是一个 advisory 沿 `app-builder-lib → @electron/get 3.1.0 → got 11.8.6 → cacheable-request 7.0.4 → http-cache-semantics 4.2.0` 传播；macOS/squirrel 包也是传递受影响条目。不能把 npm 提示的 builder 26.5.0 降级描述为已修补库。
- 本地 `node_modules/got/dist/source/index.js:65` 的默认 `cache: undefined`；`core/index.js:556` 只有 truthy cache 才构造 CacheableRequest，`:1088` 才选择该请求实现。`app-builder-lib/node_modules/@electron/get/dist/cjs/GotDownloader.js:51` 调用 got.stream(url, gotOptions)，没有自动启用 cache。
- `app-builder-lib/out/util/electronGet.js:213` 设置 downloadOptions，仅代理 agent/进度与已有配置；本项目 package.json 没有提供 HTTP cache 下载选项。`@electron/get/dist/cjs/Cache.js:29` 的缓存按 URL SHA-256 形成 artifact 路径，是另一实现。推断：当前配置没有进入 advisory 所描述的 shared response cache 利用路径；这不等于依赖本身已修补，也不豁免后来引入的运行时问题。

## 可选 override 的边界

[稳定 @electron/get v5.1.0](https://github.com/electron/get/releases/tag/v5.1.0) 已存在；本地根 `node_modules/@electron/get/package.json:1` 为该版本，依赖表没有 got/cacheable-request/http-cache-semantics，engine >=22.12.0 与 Node 24.11.1 相容。`node -e "const g=require('@electron/get'); console.log(Object.keys(g))"` 成功列出 downloadArtifact/ElectronDownloadCacheMode 等 API。

候选配置是 `overrides: { "app-builder-lib": { "@electron/get": "5.1.0" } }`，不是 override http-cache-semantics 为不存在的修补版本。但 `node_modules/@electron/get/dist/FetchDownloader.js:24` 已使用 fetch RequestInit，而 builder `electronGet.js:216` 仍传 got agent，`:476` 仍有 got 的 https.rejectUnauthorized 配置。不能仅凭 API 名称一致宣称完全兼容。若实施候选，验证准确锁文件依赖树、官方 HTTPS 下载、错误哈希拒绝、缓存复用和实际 dist:win；若环境使用代理，还须证明新 fetch 下载走预期代理。当前研究未执行该依赖改动或网络下载测试。

## 生产与最终包证据

本次 `npm audit --omit=dev --json` exit 0，`vulnerabilities={}`，metadata prod=18、total=486；当时生产表是 music-metadata 12.0.0、React/React DOM 19.3.0、Zod 4.6.5。这是共享工作区当前快照，应在最终锁文件确定后保存新的原始 JSON。

`app-builder-lib/out/node-module-collector/nodeModulesCollector.js:169` 从 dependencies/optionalDependencies 形成生产图；目前 files 使用 out/** 和 package.json。不能仅以 devDependency 标记作为“没打进包”的证据。交付验证应使用现有 @electron/asar API `listPackage(<resources/app.asar>)` 保存清单；确认没有 electron-builder/app-builder-lib/@electron/get/got/cacheable-request/http-cache-semantics，并检查 app.asar.unpacked/extraResources 同样不含这些包。对实际 main/preload/renderer JS 做相应名称与 import/require 检查，避免被 bundler 内联绕过清单检查。读取 ASAR package.json 的 dependencies，再与清单及外置模块对照；残留 devDependencies 元数据本身不表示工具代码已分发。

## 当前默认 Windows 工具下载与缓存

所有以下 SHA-256 来自安装的 `node_modules/app-builder-lib/out/toolsets/windows.js`，应使用 `Get-FileHash -Algorithm SHA256` 在预置前复核，不关闭 checksum 验证。

- `https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z`，SHA-256 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`，本地 `windows.js:156`。
- `https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z`，SHA-256 `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`，`:159`。
- `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z`，SHA-256 `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`，`:19` 的下载函数。未签名打包仍可能为 rcedit 元数据而需它，`:136`。不能因无证书就假定不下载。

上游 [NSIS release](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-3.0.4.1)、[resources release](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-resources-3.4.1)、[winCodeSign release](https://github.com/electron-userland/electron-builder-binaries/releases/tag/winCodeSign-2.6.0) 已读取。不要将旧 SHA-512 release 文本误当上述 SHA-256。

默认 cache 根为 `%LOCALAPPDATA%/electron-builder/Cache`；可用绝对 `ELECTRON_BUILDER_CACHE` 指向工作区。`app-builder-lib/out/util/electronGet.js:428` 有明确 archive cache：`<cacheRoot>/<releaseName>/<filename>`，命中时 `:288` 先验证 SHA-256 后跳过网络。预置上述原始归档到这些位置比手工假造 extracted cache/.state 更可靠；解包与完整性 state 留给 builder。无需刷新已有 Electron ZIP：已有 media-cache/electron-v44.5.1-win32-x64.zip，157998329 bytes，SHA-256 `9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db`，Task 1 已双重核验；可通过配置 electronDist 指向已验证 ZIP 或 node_modules/electron/dist，`ElectronFramework.js:162` 支持这两类路径。

若 Task 7 改 toolsets，以上默认 URL 随之改变。安装源码还支持 nsis@1.2.1 的 nsis-bundle-3.12.tar.gz，以及 win-codesign@1.1.0 的 split ZIP；不要为了下载快无故改变工具版本。已有安装代码负责提取 ZIP/7z/tar，研究未安装新工具。

## Task 7 与媒体许可

brief 明确要求 FFmpeg/ffprobe 与许可证随包、asar 按真实二进制位置处理、不依赖 PATH；在带空格目录安装后验证导入/播放/设置重启/导出，保存截图并区分 fixture、实时搜索和完整播放；不能把未签名构建写为已签名发布。完整所需命令由 Task 7 执行，本研究没有重跑应用 suite。

已有 `runtime-prep.md` 和 BtbN 下载 JSON 记录 archive SHA-256 `d892076519d72a343355b32b5206aafab053d4b5377c48a96183315d1b087369`、76975392 bytes；真正版本 `n9.0.2-22-g46d8f462ee-20261001`。归档 LICENSE.txt 第一行为 LGPL v3，不能只写通用 LGPL 2.1。分发 ffmpeg.exe、ffprobe.exe 和邻接 DLL，原始命名保留；通过 extraResources 外置时它们已在 ASAR 外，无需把不存在的 ASAR 内路径再标作 unpack。

THIRD_PARTY_NOTICES 应记录实际版本、BtbN 原归档/精确 hash、完整 LGPL v3 与其引用 GPL v3 文本、FFmpeg 对应源代码/构建配置/修改来源，以及构建中第三方依赖许可。当前解压归档根仅见 LICENSE.txt，不应误写“已包含完整对应源码”。[FFmpeg 官方许可页面](https://ffmpeg.org/legal.html) 要求对应准确源码和构建说明；[BtbN 构建项目](https://github.com/BtbN/FFmpeg-Builds) 可提供脚本来源，但通用 latest 可变链接不能独自证明精确源码交付。实际 source archive/immutable commit 与 source offer 应由交付者核实并记录。libx264 在该 LGPL 构建禁用，H264 实际为 libopenh264；不替换成 GPL 构建来修正参数。

## 精确源码跟进：许可结论需要修正

**现有归档虽标记 LGPL shared，实际 avformat-63.dll 内含 FFTW 代码。不能继续把此二进制整体仅描述为 LGPL。** 固定配方 `scripts.d/50-chromaprint.sh:20` 用 `-DFFT_LIB=fftw3`，`:24` 加静态 `-lfftw3`；`scripts.d/25-fftw3.sh:4` 固定 FFTW `93ed4c786934aec9946f8dda4b4e3eb08f8be41c`，其 enabled 无 GPL variant 限制。实际 `ffmpeg -h muxer=chromaprint` 存在该 muxer，avformat DLL 有 `fftw-3.3.11 fftw_wisdom` 和 `fftw_dft_*_register` 等内嵌字符串，证据为 `source-cache/fftw-binary-evidence.json`。[FFTW 官方](https://www.fftw.org/doc/License-and-Copyright.html) 与[固定源码 COPYING](https://raw.githubusercontent.com/FFTW/fftw3/93ed4c786934aec9946f8dda4b4e3eb08f8be41c/COPYING) 确认 GPLv2-or-later。归档 LICENSE.txt 为 LGPLv3 与此实际内容不一致；仅添加 LGPL 文本不能解决该具体问题。此结论针对外置媒体工具，不自动断言 Electron 应用整体许可证。

### 已建立的来源证据

- [FFmpeg commit](https://github.com/FFmpeg/FFmpeg/commit/46d8f462eeb87ee1f704d8c44a0ee24fca471ad1) 的完整 SHA 是 `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`，GitHub API 显示提交时间 2026-09-30T18:29:59Z；与实际版本 g46d8f462ee 相符。
- [日期 release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-01-13-06) 明列该版本，tag 指向 BtbN 配方 `e88e49f624457c455700b058f0a84ca87d499cc2`。这是 release 对应配方修订；本次没有取得独立 Actions run 的 head_sha/container digest，不能再声称完整构建可重现。
- 固定日期 ZIP `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-01-13-06/ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip` 已下载，76983960 bytes，SHA-256 `2a41605c6c28455c7029e5057f77cda18838203fa09d40bed6e6cac14200e1f5`，与该 release checksums.sha256 匹配。它与 latest ZIP 的目录名不同，但两个 ZIP 内全部 10 个 exe/DLL 的 SHA-256 逐项一致，包括 ffmpeg/ffprobe 和全部邻接 DLL。保留 `binary-equivalence.json`。这把当前随包二进制绑定到该日期 release。
- 配方 `build.sh:40` clone release/9.0（`addins/9.0.sh:2`），没有在这一步修改 FFmpeg 源码；配置参数与实际 -version 一致。第三方库另有修改与静态链接，不能以 FFmpeg 本体无补丁推断整个工具无修改。

### 已缓存源码与 Task 7 最小交接清单

缓存目录为 `.superpowers/sdd/packaging-research/source-cache/`。所有归档从固定 commit HTTPS URL 下载，下载后计算 SHA-256；这些哈希用于本地完整性记录，未冒充上游签名。

1. FFmpeg 本体：`https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`，SHA-256 `56999ad7cdcfbe520e989e38ac763341fab71b367ef8c20434117f8d1b7204a9`。
2. 配方与所有配方内 patches：`https://codeload.github.com/BtbN/FFmpeg-Builds/tar.gz/e88e49f624457c455700b058f0a84ca87d499cc2`，SHA-256 `afb0e526ee89ea9871b49b1a60bb5fdf9847f85816fb47b5bbd6528aa0643eda`。这是构建脚本，不能把该归档单独称为 FFmpeg 对应源码。
3. 已下载实际配置使用的 gmp、FriBidi、OpenAL Soft、TwoLAME、zvbi、game-music-emu、GLib、Pango、librsvg 精确源码，URL/commit/bytes/hash 均在 `lgpl-source-downloads.json`；Chromaprint、aribb24、实际进入 DLL 的 FFTW 在 `additional-source-downloads.json`。没有下载禁用的 x264/x265 等其他 variant 输入。
4. `source-bundle-manifest.json` 只列这次 win64 LGPL-shared 配置需要关注的 18 个 copyleft/相关库配方，含 exact pins 和原有修改语句。`dependency-pins.json` 是整个固定配方的只读索引，125 条不表示全部编入该二进制。

还缺的直接源码输入及准确 retrieval 目标：LAME SVN `https://svn.code.sf.net/p/lame/svn/trunk/lame@6835`；soxr `https://git.code.sf.net/p/soxr/code` commit `945b592b70470e29f917f4de89b4281fbbd540c0`；libiconv `https://git.savannah.gnu.org/git/libiconv.git` commit `1df3087ba8110c7f3ed3eb5f8869b814dbbe00b0`，及配方嵌入 gnulib `eb72eb6f75f5621c5d648acd11467fd124584617`；libbluray `https://code.videolan.org/videolan/libbluray.git` commit `a24f4fad4d62893de647abc8671397747b2359dd`；libssh `https://gitlab.com/libssh/libssh-mirror.git` commit `76e0a8639e61436c28d877586f65a7707edc6ee5`；Cairo `https://gitlab.freedesktop.org/cairo/cairo.git` commit `74755964edef651691d5cd36ff140108298e4e6e`。本次未把这些未下载输入标为“源码已交付”。

必须随对应源码保留修改：soxr 两条 CMake sed；GLib giomodule.c 修改；Pango meson warning 修改；Cairo cairo.h 修改；librsvg meson 修改及配方 `99-librsvg.sh:20` 的 Cargo vendor 输入；libbluray 两条 meson 修改；aribb24 的 `patches/aribb24/*.patch` 和 configure.ac 修改；TwoLAME autogen 版本替换及静态 pkg-config 修改；FriBidi 静态 pkg-config 修改；实际 FFTW 的 genfft/configure.ac 修改。完整脚本归档已含这些语句/patch 文件。librsvg 对应的 vendored Rust crates 尚未下载，精确 Cargo.lock/recipe 还需用于取得其 sources/licenses；已缓存的 top-level tarball 不等于 Rust 依赖已齐全。非 copyleft 依赖也需保留实际版权/许可证通知，本清单不替代最终 binary/source 清单核对。

### 可执行的交付选择

Task 7 不能将现包作为“许可已核验 LGPL 构建”交付。可准备仅启用产品实际滤镜/编码器的 FFmpeg 构建，禁用 Chromaprint/FFTW 与无关库，并保留 FFmpeg、LAME/OpenH264 等实际采用输入、补丁、构建说明和源码；替换后复核真实能力及 DLL 内容。也可选择提供准确源码和许可证的现成构建，经实际配置/二进制检验确认不含上述 FFTW。若保留当前广泛依赖工具，则须补全实际包含的源码及 GPL 等适用许可记录，而非沿用 LGPL 标签；目前缓存尚不足以宣称完整对应源码已交付。对于本地 installer，直接附上实际完整对应源码归档和许可文本是可审查结果；本研究没有编造或承诺三年 source offer，也没有发布。

## 已选择 GPL-shared 变体后的补充交接

主 Agent 已选择同日明确 GPL-shared 媒体工具，保持外部进程调用，不改变应用许可证。归档为 `ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip`，86333540 bytes，SHA-256 `64f7d1460ce986804386582eeec3bd95117a4e84f7567ad416dd33f434fe8286`，主 Agent 已与 GitHub digest/日期 release checksum 核对。研究 Agent 对解压版执行 -version，结果保存 `source-cache/gpl-version.txt`：同一 FFmpeg commit/date，明确 `--enable-gpl --enable-version3 --enable-shared`。固定 recipe `variants/defaults-gpl.sh:1` 使用 COPYING.GPLv3；不能继续用旧 LGPL-only notices 描述所选媒体工具。

实际配置额外启用 avisynth、davs2、dvdread、dvdnav、frei0r、rubberband、vidstab、x264、x265、xavs2、xvid，Chromaprint/FFTW 仍在，DVD 还依赖 libdvdcss。`gpl-variant-additional-pins.json` 保存这些 12 个 recipe 的准确源码与修改语句；`gpl-source-downloads.json` 记录新缓存的 davs2、frei0r、rubberband、vid.stab、x265、xavs2、AviSynthPlus 7 个固定 commit archive URL/hash。至此已缓存 FFmpeg、BtbN recipe 和 19 个库源码归档，仍明确不是完整对应源码包。

新增尚缺输入：x264 `https://code.videolan.org/videolan/x264.git` commit `0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee`；libdvdcss `https://code.videolan.org/videolan/libdvdcss.git` commit `811ce97a1d4d1c9d936f4b2707f533a9ef768251`；libdvdread 同域项目 commit `0f30df53125b564ef45903714403ce0a1e6c5e9e`；libdvdnav 同域项目 commit `8147ccd35e5aae4afdd21171cf7b6b4d8f179d28`；Xvid `https://svn.xvid.org/trunk/xvidcore@2204`。原缺 LAME/soxr/libiconv/libbluray/libssh/Cairo 与 Rust vendored inputs 同样未补齐。新 recipe 的 patch/sed/install 配置也必须保留，例如 x265 的 json11 include 修改，完整 recipe archive 已包含。

`gpl-enabled-direct-recipes.json` 将实际 -version --enable 标志匹配到固定 recipe 的 ffbuild_configure hooks（69 个匹配记录，含某些同标志子 recipe）。它是取得相关源码的定位索引，不是已证明的静态依赖完整闭包。GPL 工具的对应源码不能仅覆盖 copyleft 库：实际组合进该工具的 permissive 库也属于核对范围，同时保留其许可证；需要再沿相关 ffbuild_depends/静态链接输入补齐，并确认 Rust Cargo.lock/vendor 源码。禁止把整个125条配方索引全部当成已编入，更不能把已下载21个归档当成全部齐全。

Task 7 可直接使用 `provenance.json`、两个 source-downloads manifest 和 additional-source-downloads manifest、GPL新增 pins、binary-equivalence/FFTW证据、实际 GPL version 与源码 tarballs 构建审查材料。声明应分别写“GPL媒体工具版本/准确来源已核验”与“对应源码包是否已补齐”；前者目前成立，后者目前不成立。若希望减少补齐工作，可用同 commit 构建较小媒体功能集，验证实际产品所需 MP3/FLAC/WAV/filter/H264 能力后，仅携带其准确完整源码闭包；不能靠改标签来替代源码交付。
