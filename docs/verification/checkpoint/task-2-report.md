# Task 2 — 素材、曲库、收藏和歌单持久化

Status: DONE_WITH_CONCERNS
Commit: b59262706abc34d07e15c58af28b8b69e5a1fbb1
Base: 58d8b6ce313f31291bcab4fae4b51a41dd78e9af

## 实现

- `src/main/storage/repository.ts`：只在 ENOENT 返回初始值；损坏 JSON、未知/未来结构拒读拒写，保留原字节；同模块串行写，先在同目录创建唯一临时文件、写入并 fsync，再 rename 原子替换；清理临时文件。
- `src/main/storage/migrations.ts`：迁移前保存逐字节备份；逐版本校验转换结果；失败保留备份与原文件；未来版本拒绝迁移。
- `src/main/assets/media-probe.ts`：固定 resources/bin 运行时，不依赖 PATH；ffprobe 检测真实流、时长、编码参数；ffmpeg 实际解码音频。
- `src/main/assets/asset-registry.ts`：SHA-256 内容去重，主进程持有绝对路径；原始音频只读，封面保存 userData/artwork；重启后不透明 ID 支持直接流读取和范围读取。宿主资产索引位于 settings.json，公共 DTO 不含路径。
- `src/main/library/library-service.ts`：串行完整曲库变更；递归目录导入和逐文件错误；music-metadata 真实标签与封面；同标题不同内容/版本保留；收藏、歌单创建/增删/排序和曲目移除持久化；移除同步清理引用、不删除原文件。
- `src/shared/library.ts`、`src/shared/schemas.ts`、`src/shared/contracts.ts`：严格运行时 schema、命名 IPC 请求/响应校验和具体 preload 操作。拖入通过 webUtils.getPathForFile 获取原生 File 路径，主进程签发短效一次性 token；renderer 仅获得 token/素材 ID。music-asset 协议流式输出且支持 Range，不暴露宿主路径。
- `src/main/index.ts`、`src/main/ipc.ts`、`src/preload/index.ts`：沿用可信主 frame 来源检查、sandbox、contextIsolation、禁止 Node 集成；原生文件/目录对话框、拖入 token 和资源运行时路径。
- `src/renderer/App.tsx`、`src/renderer/features/library/LibraryView.tsx`、`PlaylistView.tsx`、`styles.css`、`index.html`：中文曲库、收藏、歌单对话框、加入/移除/上移/下移/删除和按专辑聚合；真实封面；保留空曲库插画、固定播放条和禁用尚未实现的播放控制；变更期间禁用相关控件避免旧快照覆盖。
- `package.json`、`package-lock.json`：npm registry 查询 music-metadata 当前稳定版 12.0.0，engines Node >=22，锁定 exact 12.0.0；builder extraResources 复制 resources。
- `resources/bin/`、`media-runtime.json`、`notices/`：ffmpeg/ffprobe 与全部相邻共享 DLL，固定发布日期和版本、原始归档 SHA-256、每个部署文件 SHA-256、完整 GPLv3 license。
- `tests/unit/storage.test.ts`、`tests/integration/library.test.ts`、`tests/e2e/library.spec.ts`：实际文件/媒体/桌面流程。

## RED 与 GREEN 证据

1. 先写存储和真实媒体测试。首次受沙箱 Vite realpath EPERM 阻碍，require_escalated 后能加载；模块缺失 RED 后加最小 throw 占位，获得行为级 RED：`npm run test:unit -- tests/unit/storage.test.ts` 3 failed / 1 passed（未实现 read/write、缺少迁移备份），`npm run test:integration -- tests/integration/library.test.ts` 4 failed / 0 passed（未实现导入和运行时）。未来版本用例在占位阶段也通过，未把它描述为独立行为 RED。
2. 服务实现后同命令分别 4/4、4/4 GREEN。追加真实长路径/封面覆盖、完全同名的 Studio/Live 标签和迁移成功断言，最终 storage 5/5、integration 6/6。
3. E2E 写在 UI 启用之前，`npm run test:e2e -- tests/e2e/library.spec.ts` 先因添加音乐仍 disabled 超时 RED。
4. 真 Electron 后续发现三处真实问题并逐项定位/修复：app.getAppPath() 在 fixture 启动为 out/main，开发资源目录应 __dirname/../../resources；异步加入歌单使用旧快照会覆盖，变更期间禁用操作；custom scheme fetch 被 CORS 拒绝，通过 console 证据确认，启用 corsEnabled 并只允许当前 renderer origin。
5. 新增注册表重启直接 openRead 用例先 RED「找不到素材」，实现同步惰性恢复索引后 GREEN；同用例验证 44 字节范围读取。
6. `npm run typecheck`：PASS。`npm run build`：PASS。最终 `npm test`：Vitest 26/26（包括 integration）、integration 独立 6/6、真实 Electron E2E 4/4 全部 PASS。
7. 按父 Agent 资源审核结果，将先前 LGPL-labelled bundle 替换为固定日期明确 GPLv3 shared bundle；二进制替换后只重跑 `npm run test:integration -- tests/integration/library.test.ts`：6/6 PASS。没有重新宣称已运行的完整桌面套件是在新二进制下完成。
8. `git diff --check`：PASS（Git 的 LF→CRLF 通知非内容错误）。npm build 仍有上游 Zod PURE 注释位置警告；Playwright 提示 NO_COLOR/FORCE_COLOR 冲突，不影响结果。

## 真实桌面和媒体范围

- E2E 使用 Playwright _electron 启动构建后的真正 Electron，另一个既有测试运行 npm dev 的真正 Electron；没有 browser mock。
- WAV 导入→收藏→新建「旅途」→连续加入两首→上移第二首→关闭应用并重启→收藏和歌单顺序核对；renderer DTO 不含宿主目录；原文件 SHA-256 前后一致。
- 原生文件夹对话框（测试仅替换 dialog 的用户选取结果）和 Electron 原生 File 经 setInputFiles + DataTransfer drop 触发真正 webUtils/IPC 导入均通过。
- ffmpeg 实际生成 MP3、FLAC、M4A 样本，真实 ffprobe + 全流解码，所有来源原字节不变；中文、空格、emoji 和 >260 字符 Windows 路径通过。
- 完全相同标题且不同 Studio/Live comment 标签的两个 FLAC 保留两个不同 ID；实际 MP3 内嵌 PNG 提取，尺寸 32×32、字节与来源图片相等。
- music-asset 真实 Range fetch 返回 206、44 字节及正确 Content-Range；源码已使用 Node readable stream，不把整首音乐读进内存。
- 截图 `.superpowers/sdd/2026-10-03-music-player-implementation/task-2-ui.png` 已视觉检查，显示真实两首歌的排序和收藏；诊断脚本已删除。

## 资源来源

- Version: n9.0.2-22-g46d8f462ee-20261001。
- Fixed source URL: https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-01-13-06/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip
- Archive size: 86333540 bytes；SHA-256: 64f7d1460ce986804386582eeec3bd95117a4e84f7567ad416dd33f434fe8286。
- License: GPL-3.0-or-later；实际配置 --enable-gpl --enable-version3。ffplay 未随应用复制。
- 每文件 hash 和长度在 resources/media-runtime.json；完整许可证在 resources/notices/FFmpeg-LICENSE.txt。

## 限制和后续关注

- 本任务完成曲库管理与宿主资源，不实现播放器引擎、在线搜索、导出或扩展；控制保持真实禁用，后续 Task 3 消费 assets.get/url 和曲库 Track DTO。
- FFmpeg 导入会完整解码，每文件 120 秒处理超时；超时/不支持的文件按 basename 返回失败，其原始媒体不变。全流校验偏重，后续大量导入可增加 job/progress；当前导入请求使用有效 AbortSignal，但尚无 renderer 取消导入入口。
- AssetRegistry 在 settings.json 存资产索引，未来 settings 服务必须保留/扩展这份严格版本 schema；不能直接用空 settings 覆盖。
- 原始文件被用户移动或外部修改后没有后台重定位/重新校验；重导入相同内容的新位置可恢复引用。asset.get 会等待当前资产导入队列，播放与大批导入同时进行时可再优化。
- 尚未制作/安装 NSIS 包；extraResources 和 packaged 路径已配置，安装验证及 FFmpeg 对应源码/构建配方归档由 Task 7 完成。父 Agent 已接手固定对应源码包装。
- npm install audit 提示 8 high severity 项，未在 Task 2 擅自升级其他既有依赖；该输出记录为关切，未把它说成通过的安全审计。

- GPL runtime avcodec-63.dll 为 119112704 bytes，超过 GitHub 普通 Git 单文件 100MB 推送限制；本地已提交，若将来要求 GitHub 推送需 LFS 或运行时分发策略。

## Task 2 修复第 1 轮：版本身份与原始证据

Fix base: b59262706abc34d07e15c58af28b8b69e5a1fbb1
Fix commit: 48916f3b402bdca3ead8db2143126843a624a71b

Review finding: 原 substring 规则把 Oliver 判成 live，未标注曲目默认 studio，且原始 comment 版本证据被丢弃，UI 只显示 normalized enum，可能使后续 Task 5 接受错误版本。

按 Controller Ruling 增加 `Track.versionDisplay: string | null`。`TrackSchema` 对缺失 legacy 字段 default(null)，兼容 schemaVersion 1；只读解析补内存值、不落盘、不发明旧记录证据。原始已存 version enum 保留；它自身不能证明严格版本身份。

`src/shared/track-version.ts` 为共享纯 helper，返回声明的 TrackVersion：`inferTrackVersion(title, labels)` 只接受明确 title 标签/后缀或完整 metadata label，例如 `(Live at 上海 2026)`、` - Remix`、`Studio`、`Live at 上海 2026`。普通标题 Oliver/Live Forever/alive、generic 评论中的 live/remix 均 unknown；缺少证据默认 unknown。分类只对副本做 NFKC/大小写/空格规范化，versionDisplay 保留原 glyph、空格和 title 标签 delimiter。相互矛盾的明确标记保持 unknown，并保留双方显示文本。

`provenTrackVersion(track)` 是给后续严格匹配的入口：只在明确 title/versionDisplay 证据与 stored normalized version 一致时返回已知版本；legacy normalized enum 单独存在、或证据冲突时返回 unknown。Task 5 必须使用它或等价证据校验，不能直接信任 legacy track.version。

LibraryService 保存真实标签证据，保留原始 title 字符串。LibraryView 显示 versionDisplay，使用 pre-wrap 保留显示空格；不以 enum 发明展示版本。同步更新 Track fixture。

RED：

- `npm run test:integration -- tests/integration/library.test.ts`：2 failed / 6 passed；实际 WAV Oliver 收到 live，预期 unknown；legacy 读取缺少 versionDisplay:null。
- `npm run test:unit -- tests/unit/track-version.test.ts`：18/18 failed；helper 明确证据未实现、旧 schema 无 null 默认。
- `npm run test:e2e -- tests/e2e/library.spec.ts --grep "raw explicit version"`：真实 Electron 标签不可见，1 failed。

GREEN：

- `npm run test:unit -- tests/unit/track-version.test.ts tests/unit/contracts.test.ts`：34/34 PASS（19 版本 helper + 15 既有 runtime contract）。
- `npm run test:integration -- tests/integration/library.test.ts`：8/8 PASS；真实 FLAC fullwidth comment 原值重启保存；legacy 文件字节完全不变；既有真实媒体/素材/路径测试覆盖。
- `npm run typecheck`：PASS。
- `npm run build`：PASS（同已有 upstream Zod PURE 注释警告）。
- `npm run test:e2e -- tests/e2e/library.spec.ts`：真正 Electron 3/3 PASS；新增 fullwidth raw label 显示和重启持久化；已有导入/收藏/歌单/文件夹/native File drop 无回归。
- `git diff --check`：PASS。按修复任务指令未重复 whole npm test。

本修复只涉及上述版本身份和证据范围；playlist delete busy 与 suffix Range ledger 项保留给消费任务/最终审核。
