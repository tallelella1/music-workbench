# 基础播放器最终独立审查

日期：2026-10-12，Asia/Hong_Kong。审查者：`/root/finish_review`，接续上一位 `/root/final_player_review` 已完成的审查。

**Task 7 规格：Approved。Task 7 质量：Approved。基础播放器首版发布门槛：Yes。没有未解决的 Critical / Important 产品阻塞。** 此结论适用于下述冻结产品和已验证的 Windows x64 安装包；远端推送、发行附件上传及远端 CI 的完成状态由控制端另行记录。

## 范围与审查方式

完整分支范围为 `62ca78ec8e826d066f80c292675deaf7274dd1b4..6d36f7ec7ca00df8d4fd9fe174c8053ab48a410d`。冻结产品提交为 `6d36f7e`。依据是基础播放器设计规格、实施计划 Tasks 1–7、当前用户已裁定的首版范围、完整分支 review package、各任务最终审查与 Fix 2 完整验收记录。

本次是续完最终门槛，不是从头重审：复用 Tasks 1–2 已记录的存储、导入、隔离与契约审查；Task 3 播放生命周期复审；Task 4 独立来源搜索审查；Task 5 LX/换源修复复审；Task 6 两轮导出生命周期复审；Task 7 Fix 1 对已接收事务和设置初始化状态的复审。上一位最终审查者已经静态核对正常退出、router cancellation、LX network drain、completeness FFmpeg close、search cleanup，并给出原 Important ADDRESSED、上述链路无新增阻塞的交接；本报告明确沿用这些已完成检查，不冒称本轮重新执行。

本轮补完 App、PlayerController、AudioEditor、SettingsService、SettingsView、AppModuleRegistry 与主进程装配之间的衔接；核对固定提交的 README、package scripts、NSIS 配置、固定媒体恢复脚本和 Windows CI；读取最终安装 JSON、测试尾部统计、package/media 日志和媒体来源材料的 DELIVERY-STATUS。没有运行任何新测试、构建、安装或探针，没有修改产品、index、HEAD 或 refs；唯一写入为本报告。

## 原 finding verdict

1. **正常退出等待未取消的非持久化网络工作：ADDRESSED。** 原 `task-7-rereview-1.md` Important 的触发是正常关窗时媒体 fetch 被持有，acceptedRequests 等待它，而取消 IPC 已被关闭边界拒绝。固定产品 `src/main/index.ts:66` 的 requestQuit 先置 quitting 并同步调用 route.shutdown；`src/main/ipc.ts:142` 起封闭 router 并 abort playback/source-test、search、preview controllers，再等待已接收请求与各服务清理，最后关闭 repository。复用前一审查者对 resolver、completeness、LX 与 host-owned search transport 的具体清理链检查。实际安装证据覆盖 playback/source-test/search/decode/LX network：取消或 worker close、清理均先于 will-quit，拥有进程和临时媒体剩余均为零，退出分别为 385/123/889/750/900 ms。没有用固定延迟或忽略 Promise 代替实际清理。
2. **已接收偏好或导入事务在退出时丢失：ADDRESSED，保持关闭。** 复用 Fix 1 裁决并核对 Fix 2 安装证据：慢设置 rename 提交先于 will-quit，requested/persisted/restart volume 都是 .9；尚未进入索引事务的已接收导入仍完成 assets=1、tracks=1，晚到写入明确被拒绝，原 WAV 字节保留。取消非持久化工作没有破坏存储 drain。
3. **已打开设置页不刷新音源初始化结果：ADDRESSED，保持关闭。** `src/renderer/features/settings/SettingsView.tsx:6` 仅对仍 pending 的已启用来源有界刷新，终态或 deadline 停止，unmount 清理 timer。沿用已有真实 Electron 成功/超时覆盖；本次未发现接口装配变化使该修复失效。

Task 3、5、6 已关闭的 Important 不重新打开：冻结产品与回归证据没有呈现新的具体破坏。

## 整体要求与交叉模块判断

- **基础边界及数据安全：通过。** 主窗口保留 sandbox、contextIsolation 和 nodeIntegration=false；IPC 校验发送窗口/frame/URL 与运行时结构。SettingsService 在共享 repository update 中合并偏好，保留 assets，曲库与设置不通过陈旧全量对象互相覆盖。导入、移除条目及导出仍遵守不删除原音乐的契约。
- **曲库、队列和播放：通过。** App 刷新曲库时协调队列并停止已删除当前曲，统一交由 PlayerController 管理选择。controller 请求身份与已审查的 engine generation 保留旧结果隔离。暂停资源到期后 resume 重新解析并恢复 sourceSeconds。普通本地播放、seek、重启与已接收导入有 built/installed 实际证据。
- **搜索及完整播放：通过软件实现门槛。** 本地搜索复用当前曲库和同一播放操作；远端搜索结果由 resolver 解析后才能播放，质量选择不直接绕过完整性检查。沿用三来源独立超时、分页、取消、失败恢复、版本匹配和完整媒体核验审查。完整性校验绑定实际保留媒体字节，远端 resource 不获得可编辑本地 asset 权限。来源测试只有显式“播放已验证歌曲”动作改变播放意图。
- **实时效果与本地编辑：通过。** 十段 EQ、预设、混响、0.5–2 倍速度与保持音高已有真实信号和播放验证。App 打开 editor 时暂停主播放，并在迟到 load 开始播放时继续暂停；预览播放再次暂停主引擎，AudioEditor 卸载/切换 preview 清理媒体元素。编辑输入使用素材 ID/hash，checkedSnapshot 给 FFmpeg 受控字节。既有导出提交、取消、稳定目标预留和独立清理裁决继续适用。MP3 128/320、FLAC、WAV 能力由实际编码器支持情况决定。
- **设置、来源初始化和能力入口：通过。** 偏好持久化与实际 source.enabled 分开；主窗口先创建，再后台初始化 LX，失败来源仍保留偏好和原因，本地播放/编辑继续可用。内置注册表按 capability 返回模块，本轮只提供 local-library/local-audio-editor，不错误开放未实现的视觉/AI 功能。默认导出值传入 editor，音效自动保存，测试专用 provider 的 registry 接入证据保留。
- **正常退出：通过。** 已接收持久化事务、committed export 与主进程拥有的资源清理共同完成后退出；未持久化请求在退出边界被主动取消。新增 shutdown 与原 storage/export 生命周期兼容，实际安装回归同时覆盖两者。

## Windows 打包与源码交付判断

NSIS 配置为 Windows x64、当前用户、可选择安装目录，保留 userData，使用 ASAR 并将固定 resources 放入 extraResources。主进程按 packaged resourcesPath 定位媒体运行时，不依赖系统 PATH。最终实际安装到带空格目录，安装返回 0，升级前后 uninstall identity 一致，安装 app.asar 与该次 win-unpacked 构建 hash 一致。

最终可交付安装程序为 `release/MusicWorkbench-0.1.0-Setup.exe`，SHA256：`d125c98f96dfd1eeca94728b5d72b45010697d3fa051e0a2022fff5dbad243f5`。安装 ASAR SHA256：`883ad3a8bf816632436322cd2ffeb1b4180b73bc10cf503ffe748e203284ab41`。它替代存在旧退出缺陷的 Fix 1 包；签名状态为 NotSigned，README 如实披露。

实际安装 package 检查核对 1074 ASAR entries、5 app JS 及全部 extra/unpacked resources，没有带入受跟踪的 builder/downloader 开发代码；9 个媒体二进制的 hash/version 和所需编码器/filter 已通过核验。历史 production audit=0 与 development=1 high+8 moderate 分开记录；开发 advisory 不被误写为已修复，也没有据此把未进入最终包的开发代码判作安装运行时阻塞。

`scripts/setup-media.ps1` 校验固定官方归档 SHA256、每个媒体文件的大小和 SHA256，全部验证后才复制，已有正确资源可重复运行；README 的克隆、恢复、npm ci、构建和顺序验证步骤与 package scripts 一致。沿用已完成的错误归档拒绝、全新目录恢复与幂等检查。Windows CI 固定 action commit 和 Node 24.11.1，顺序恢复、测试、构建、package 检查；本报告不宣称尚未运行的远端 CI 通过。

由于开发历史有超过 GitHub 限额的 DLL，私有交付使用排除 runtime/scratch 的无父源码快照、保留原本地历史，是已授权且明确披露的交付选择。固定 manifest/bootstrap、lockfile、测试、许可和构建文件足以支持应用源码交付；控制端仍须在发布记录中保存实际快照与冻结产品的 tree 对应关系、远端结果和附件 hash。此为交付操作的证据收尾，不是新的产品修复要求。

已读取 `release/sources/DELIVERY-STATUS.md`：固定 FFmpeg 源、配方、patches、缓存和原 lock 输入均有材料；构建时 cargo update cc 后的 helper lock 没有保留，完整实际链接清单也不存在。因此交付判定只接受“已收集并核验的源码材料”，不认证完整对应源码闭包或逐位重建。README 保留该限制，不能因本软件门槛通过而删去它。已完成的三个分卷完整性与逐文件校验予以复用，不重复扫描大包。

## 已有证据与结果

实际读取并复用 `task-7-fix-2-report.md` 的恢复完成部分，以及对应 durable 日志/JSON。最终 full-test-green 日志记录 unit **79/79**、integration **67/67**、built Electron **37 passed**；其中 **8 installed-only skipped** 是运行环境分组，另一个 actual-installed 日志明确 **8/8 passed（42.4s）**，不是把 skip 计为通过。typecheck/build/dist 的成功记录与实际 package/media 结果一致。

安装综合验收记录显示中文/空格/emoji 导入、本地播放/seek、设置重启、FLAC 导出、shipped LX fixture、脚本 throw/hang 后本地编辑均完成；四次启动为 290/309/303/361 ms，renderer errors=[]，最后拥有进程剩余为 0，原始字节保留。历史 RED、首轮 full-test 失败和修正测试 transport 的原因仍被保留，最终通过未覆盖或冒充早先失败。此轮没有额外运行测试。

## 既有 Minor 与保留边界

Critical：无。Important：无。新增阻塞：无。既有 Minor 的处理如下：

- TrackVersion 静态类型、歌单删除 busy guard、suffix Range、源诊断及 Zod/颜色构建噪声已有对应修正或最终记录；没有发现需阻塞交付的残留。
- **保留 Minor：大文件每次 local Range 重新全量 hash。** `src/main/assets/media-protocol.ts:78` 调用 `asset-registry.ts:90` 的 verifyOriginal，较大文件连续 seek 可能增加 IO/延迟；这是既有性能限制，没有本轮已证实的普通播放失败。后续应先测量再优化。编辑的 hash 绑定已由 checkedSnapshot 独立保证；普通可变外部文件播放不被描述成 immutable snapshot。
- **保留 Minor：播放中资源到期后的直接 seek。** `media-protocol.ts:66` 到期返回 410，而 `player-controller.ts:37` 的位置恢复在 resume 路径。暂停后 resume 已修复；保持同一资源超过 24 小时后直接 seek 的平滑续期仍无覆盖，不升级为当前首版阻塞。后续可让 seek/error 复用位置保持的续期路径。

## 已考虑但未纳入本次通过声明的行为

- 真实第三方整曲覆盖：用户尚未提供可用 LX 音源；真实本地/HTTP fixture 证明软件链路，实时搜索成功不等于第三方整曲验收。
- 个人听感：真实波形/频谱/时间与导出重开证据不能代替用户试听；没有编造人工试听结果。
- AI 音频、Gemini 调用和模板视觉：当前用户裁定为后续独立交付单元，未实现不构成本次基础播放器漏项。
- 任意 LX 脚本/API、任意 UI 插件、歌词/WebDAV/云同步：规格明确只要求限定 LX 兼容和内置注册表扩展，不扩大首版支持承诺。
- 原生 Windows file symlink：机器 EPERM 限制保留；已审查受控解析边界与真实 FFmpeg/rename/inode/bytes 测试，不称原生 symlink 实机通过。
- 精确媒体重建、完整链接依赖闭包、签名认证、远端 CI：材料/环境/执行状态边界已披露，本报告不认证这些未完成事项。

## 最终门槛

**Ready to merge / release reviewed base product：Yes。Task 7：Spec compliant / Quality approved。完整基础播放器 Tasks 1–7：Approved，无需新增产品修复后才能交付。** 最终退出缺陷已解决，固定产品的安装证据同时证明网络取消、资源清理和持久化保留；交叉模块及打包/恢复流程没有发现新的 Critical/Important。按已授权私有交付继续保存源码对应关系和发行附件结果即可，不因本报告再重跑已通过测试或重建相同产品。
