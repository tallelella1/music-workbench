# 打包依赖 advisory 实施日核对

日期：2026-10-06，Asia/Hong_Kong。

[GitHub 官方 GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 当前仍列 `http-cache-semantics <=4.2.0` 受影响，Patched versions 为 None；页面最近更新为 2026-10-02。本次读取没有发现可直接升级的已修复版本。

该信息只核对上游状态。最终 lock 的实际 production/development audit、下载缓存完整性和 Windows 构建链行为，以及 ASAR、bundle、unpacked 与 extraResources 是否包含该开发依赖，由 Task 7 的真实打包验收记录证明。不得从开发依赖归类推定运行时一定无暴露，也不得用强制降级或未经验证的 downloader override 代替核验。

选定媒体运行时仍以 runtime-prep 顶部与 resources/media-runtime.json 的固定 GPL-shared 构建为准；旧包装记录中的 LGPL 字样保留为历史，不作为当前交付声明。

2026-10-11 复核：[sprintf-js 官方 GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 列 `<=1.1.3` 受影响，Patched versions 仍为 None（页面更新 2026-10-05）；http-cache-semantics 官方页面仍无修复版本。最终 lock 的开发审计为 1 high、8 moderate，后者沿 sprintf-js → roarr → global-agent → @electron/get → builder 传播；生产审计为 0。npm 建议的 builder 26.5.0 改动会替换现有下载链，未据此盲降级。安装包检查已扩展到这三个新增名称，必须以最终 ASAR/JS/extraResources 检查结果证明运行时边界。
