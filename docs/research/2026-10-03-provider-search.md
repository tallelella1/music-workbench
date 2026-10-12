# wy / kg / tx 搜索接口研究

核查时间：2026-10-03。LX Music 官方仓库 `lyswhut/lx-music-desktop` 当前 master SHA：`ad95d5091c9ed689fa72b5e5c849df65f5a679ce`。这是 LX 的实际适配器源码契约，不能视为平台承诺的稳定公开 API。

## 当日观察

2026-10-03T14:06:25.122Z–14:06:25.398Z（香港 22:06:25）。Node v24.11.1，每源只请求一次，搜索“周杰伦”，page=1，limit=5，并发、每请求 AbortSignal.timeout(8000)。无登录、无 cookie、无播放地址解析、无音频下载。默认沙箱禁止网络套接字；获准的网络工具调用完成查询，因此本次无网络失败。

- wy：HTTP 200，JSON code=200，5 条，totalCount=272。首条“想你就写信 (Live)”，歌手周杰伦/李硕/张鑫，dt=238698 ms，id=509781655；另有“屋顶”，dt=319039，id=5257138。
- kg：HTTP 200，error_code=0，5 条，total=480。首条“晴天”，周杰伦，Duration=269 秒，Audioid=20505418，FileHash=B3A52A7A958BF0AED0EBFBA2E9A818B7；“稻香”223 秒，Audioid=332453。
- tx：HTTP 200，顶层 code=0，5 条，meta.sum=999。首条“晴天”，周杰伦，interval=269 秒，id=97773，mid=0039MnYb0qxYhV；“稻香”223 秒，id=449205，mid=003aAYrm3GE0Ac。

kg 和 tx 的 Content-Type 是 text/plain，但内容是合法 JSON；不能仅按响应媒体类型拒绝解析。这里只证明单次公开元数据搜索成功，完整播放仍须显示“尚未解析”。未取得音频质量或完整曲目播放证据。

## wy

POST `http://interface.music.163.com/eapi/batch`，form-urlencoded `params`。逻辑路径 `/api/search/song/list/page`；数据 `{keyword,needCorrect:'1',channel:'typing',offset:limit*(page-1),scene:'normal',total:page===1,limit}`。封装使用 eapi：JSON、路径相关 MD5、AES-128-ECB，结果大写 hex；必须按源码编码，不能把明文查询直接发到 batch。请求带 origin=https://music.163.com 和源码浏览器 UA，不用注释里的 cookie。

成功条件 code=200；列表 `data.resources[]`，逐项取 `baseInfo.simpleSongData`。title=name；artists=ar[].name；album=al.name；durationSeconds=dt/1000；songId=String(id)；可保留 albumId=al.id。version 从标题明确标签提取，原始标题保留；首条 Live 有直接证据。无标签使用 unknown，不推断 studio。total=data.totalCount。

主来源：[搜索源码](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/wy/musicSearch.js)、[请求封装](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/wy/utils/index.js)、[eapi 编码](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/wy/utils/crypto.js)。

## kg

GET `http://songsearch.kugou.com/song_search_v2`。参数 platform=AndroidFilter、iscorrection=1、keyword=encodeURIComponent(query)、hifiquality=0、pagesize=limit、PrivilegeFilter=0、page。

成功条件 error_code=0；列表=data.lists；total=data.total。title=OriSongName，加非空 Suffix 作为版本展示；artists=Singers[].name；album=AlbumName；durationSeconds=Duration；songId=String(Audioid)；identity 可保留 FileHash、MixSongID、AlbumID。版本判断使用 Suffix/标题明确标签，缺标签 unknown。字段可能有实体编码，显示时解码；无需展开来源源码的 Grp 才能支持基础结果。若展开 Grp，要按子项标识判重；源码循环误用了父项 key，不应照搬。

主来源：[搜索源码](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/kg/musicSearch.js)。

## tx

POST JSON `https://u.y.qq.com/cgi-bin/musics.fcg?sign=<zzcSign(JSON.stringify(body))>`；UA=`QQMusic 14090508(android 12)`。body 包含匿名 comm（uin='0'、空 token、ct='19'、cv='2151' 等源码固定客户端字段）；服务键 `music.search.SearchCgiService`，module 同名、method=`DoSearchForQQMusicDesktop`；param={grp:1,num_per_page:limit,page_num:page,query,remoteplace:'txt.newclient.top',search_type:0,searchid}。searchid=32 位大写 hex+5 位数字。签名为源码 SHA1/索引提取/XOR/base64 组合，不是登录凭据。

取 req=response['music.search.SearchCgiService'] ?? response.req；顶层 code 和 req.code 均须为 0；req.data.body.song.list 为列表，req.data.meta.sum 为总数。title=item.title；artists=singer[].name；album=album.name；durationSeconds=interval；songId=item.mid；identity 保留数值 id、file.media_mid、album.mid。源码不拼 title_extra，需单独保留可用版本展示值；未观察到其存在，不能假定 always present。file.media_mid 缺失的项被 LX 跳过。版本只按明确文字标签，其他 unknown。

主来源：[搜索源码](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/tx/musicSearch.js)、[POST 封装](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/tx/utils/index.js)、[签名源码](https://github.com/lyswhut/lx-music-desktop/blob/ad95d5091c9ed689fa72b5e5c849df65f5a679ce/src/renderer/utils/musicSdk/tx/utils/crypto.js)。

## 失败与 fixture 边界

本次没有实际观察空结果、超时、限流或缺字段。以下是实施建议/待测契约，不能写成当日实时支持证据：

- 8 秒预算到期为 timeout；用户取消属于取消，不记入来源连续失败；DNS/TLS/连接失败是 transport error，不能标 empty。
- HTTP 429 或明确且有证据的业务限流码为 rate-limited；HTTP 403/业务非成功码默认 error，避免臆测限流。非 JSON、缺必需结构为 error；有合法结构且合法空数组才为 empty。
- 缺可用标识、标题或歌手的单项不应造值；duration 缺失/不合法设 null。整个 envelope 缺失必须报来源 error。
- 请求不按源码自动递归重试；每源单次限时，来源独立状态。首次三源实时成功不能证明长期稳定；保留每次 probe 日期、HTTP/业务状态及结果数。
- Task 4 的正常/空/缺字段/限流/超时 fixture 需分别标出 observed 或 synthetic。此次仅保存经过选择的实际观察摘要，没有保存完整原始响应，不可把此文件当完整 raw fixture。实施时获授权的探针应另取脱敏 raw fixture。

研究阶段未改应用、依赖、Git 或测试；临时探针脚本及中间 JSON 已清理。
