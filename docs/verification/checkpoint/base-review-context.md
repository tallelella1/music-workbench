# 基础播放器全分支审查交接

本文件为控制端交接事实，不能替代规格、实际代码或验证结果。审查范围的固定提交和 diff 由独立 review package 指定。

## 范围与完成条件

- 用户已批准基础播放器、AI 音频和模板视觉三个实施计划；当前检查基础计划 Task 1–7 的整体集成，创作计划尚未实施。
- 2026-10-11 最新确认：本轮只交付基础播放器首版，推送到新建私有仓库 `tallelella1/music-workbench`，音频/视觉计划是后续范围。允许对应私有发行版提供已验证的安装程序与完整已收集媒体源码材料，不需要重新请求发布授权。
- 用户明确没有 LX 音源或 Gemini 服务配置，已授权完成软件、真实本地媒体和界面验收、Windows 安装交付。固定测试音源证明宿主协议与媒体流程；真实第三方整曲播放及模型请求仍为未配置。不能将它们判断为已验收，也不能要求凭空提供密钥才能完成已授权的本地范围。
- 人工试听由用户完成，自动检查不代替试听。未签名安装包不标记为已签名发布。
- 三平台实时搜索有日期明确的历史实际证据；搜索成功不等于已取得可用的整曲音源。

## 已有修复和受限证据

- Task 3 的旧播放事件与当前曲库移除生命周期问题已独立复审；Task 5 的 LX 退出、取消与到期问题已独立复审。
- Task 6 的退出 drain、提交与取消、并发目标、独立清理及稳定目录项预留已两轮修复并独立复审。Windows 原生 file symlink 创建返回 EPERM；替代只控制目标解析边界，其余 FFmpeg、rename、inode 和字节检查均为实际操作。不得将其描述成原生 file symlink 实机通过。
- AssetRegistry 的 checkedSnapshot 提供 hash 绑定的受控输入；原始外部文件可被第三方更改，保存的 hash 本身不构成当前字节验证。后续创作任务会复用此边界。
- 现有分支与可写 checkout 的选择已有裁决，不重新创建 worktree，也不覆盖历史用户数据。

## 打包与许可事实

- 随包媒体运行时是固定日期的 GPL-shared FFmpeg/ffprobe 及相邻 DLL。旧 LGPL 描述不代表当前构建；固定 Chromaprint/FFTW 依赖解释记录在研究文档中。
- installer 相邻 sources 交付材料有逐文件哈希。准确限制：构建时 cargo update cc 的实际锁文件没有留存，不能声明所有实际链接构建依赖闭合，也不能声明逐位相同重建。判断当前交付时同时读取 DELIVERY-STATUS 与 verification 记录。
- npm production audit 为零不是资源内容验证的替代品；Task 7 核对实际 ASAR、unpacked 与 extraResources 是否带入开发下载库。
- 开发侧 http-cache-semantics 高危项的官方 advisory 当前无已修补版本，npm fixAvailable=true 与之冲突。没有盲目 override，具体范围以最终包内容证据为准。
- 2026-10-11 最终 audit 为 production 0、development 1 high + 8 moderate；sprintf-js 链的官方 advisory 同样没有 patched version。实际安装包扫描 1074 ASAR entries、5 app JS 和全部 extra/unpacked resources 无对应开发依赖，具体报告/JSON 可读。
- 修复前基线 unit 75/75、integration 66/66、普通 E2E 28 通过、installed-only 1/1；首轮构建/测试混跑失败保留，最终顺序验证未提高超时。Task 7 独立审查发现关闭期间偏好事务丢失与初始化设置页状态不刷新，Fix 1 `35fe044` 已封新 IPC、等待已接收异步 routes，再关闭共享 repository 并 drain；仅初始化 pending 时有界刷新状态。最终 unit 77/77、相关 integration 29/29、聚焦 Electron 10/10、实际安装 3/3；报告、安装资源与媒体核验均更新，来源材料未变。
- Fix 1 安装程序基线 SHA256 `9cb17c0cddc23161fff1f54bf3888a2032792183b04c6f6aa521ffcbe8ed12fe`。实际安装版有 4 次启动、LX 抛错和 5 秒 watchdog 处理、完整 6 PID 子进程树退出、未完成设置写入与已接收导入正常关闭证据。凭据见 `task-7-fix-1-report.md` 与 `task-7-fix-1-installation.json`；该包存在后述未修复退出问题，不是最终发行附件。

## 私有源码交付

媒体 `avcodec-63.dll` 已存在于本地 Git 历史且超过 GitHub 100 MiB 限制；GitHub 发布采用无父提交的源码快照，保留整个原始本地分支。快照临时 index 排除 `resources/bin/` 与已跟踪的 `.superpowers/` scratch，不删除工作区二进制或原始 refs；与被审查 HEAD 的其他 tree entries 必须一致，推送前核验。普通 Git repo 保存 `resources/media-runtime.json`、`scripts/setup-media.ps1`、应用/测试/锁文件/许可/CI。恢复脚本的错误归档、全新目录和幂等验证已完成。

Windows CI 使用实施日官方 API 核对的 action commit SHA 与 Node 24.11.1，按顺序恢复媒体、测试、构建与包内容检查。尚未声称远端 CI 已通过；提交后保存远端结果。媒体源码分卷已由 7za 完整性测试，通过 263 文件/2,263,171,435 bytes；SHA256 清单与安装程序随私有发行版提供。

## 独立审查要求

按规格和最终实际行为审查基础全分支，包含模块之间的播放、存储、取消、退出、导出和安装流程。已通过任务的记录用于理解证据，不豁免真实跨任务缺陷。仅为具体未解决疑点运行相称检查，不重复已通过的全套测试。列出可复现的 Critical/Important 问题以及完成条件缺口；没有问题时给出有范围和限制的明确 verdict。

## 2026-10-12 恢复状态

用户已要求继续，2026-10-11 暂停状态保留为历史。Fix 1 scoped re-review 确认原两项解决，但新增 Important：退出等待未取消的无持久化网络解析。新实施者从 `c8f5ba8` 接续，测试草稿 typecheck 通过，并再次复现合法 LX/真实 HTTP playback 正常关闭 RED；正处理请求取消、媒体子进程及临时文件实际清理，同时保留已接收持久化写入。最终修复、安装验收和 scoped re-review 以 `task-7-fix-2-report.md` 的追加记录及最新 review package 为准。Task 7 与全分支审查尚未完成。

2026-10-12 最终验收：Fix2 产品 6d36f7e，完整79unit/67integration/37普通Electron，实际安装8/8、dist/package/media均通过。用户最新要求尽快结束并减少非必要测试，合并scoped finding核验与全分支最终独立审查，不重复已通过验证。今日三平台真实搜索均HTTP200，各5条，独立日期目录保存。
