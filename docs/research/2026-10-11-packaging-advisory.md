# 打包依赖 advisory 实施日核对

日期：2026-10-11，Asia/Hong_Kong。

当前官方 [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) 仍列 `http-cache-semantics <=4.2.0` 受影响，Patched versions 为 None。[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 列 `sprintf-js <=1.1.3` 受影响，Patched versions 也为 None，页面最近更新为 2026-10-05。

Task 7 的当日 npm production audit 为零；development/full audit 为 1 high、8 moderate。moderate 数量包含 `sprintf-js` 经 roarr/global-agent/@electron/get/electron-builder 的传播路径，不能解读为八个独立源码漏洞，也不能把 production audit 为零当成安装资源没有带入构建库的证据。

不采用未经核验的下载器替换或 builder 降级。最终 ASAR、应用 bundle、unpacked 与 extraResources 的检查需覆盖以上两个依赖及其构建下载链，准确结果见 Task 7 实施报告和包内容记录。
