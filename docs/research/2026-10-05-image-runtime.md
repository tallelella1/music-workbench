# 图像运行时交接（2026-10-05）

供视觉 Task 1 和最终 Windows 打包使用。没有安装依赖或修改产品代码。

[Sharp 官方 changelog](https://sharp.pixelplumbing.com/changelog/v0.35.5/) 本次列出 `0.35.5`（2026-09-27）。实施时从官方 npm registry 核对版本和发布内容后精确固定依赖及 lockfile；不以本文代替实际安装验证。

[官方安装说明](https://sharp.pixelplumbing.com/install/) 要求 Node-API v9，示例运行时为 Node.js >=20.9.0，并提供 Windows x64 原生 Sharp/libvips。项目 Node 24.11.1 在这一版本范围内；实际 Electron 加载仍需验证。

需安装 optional dependencies，将 `sharp` 作为 production dependency，并在主进程构建中 externalize。electron-builder 启用 ASAR 时，将实际 `node_modules/sharp` 和 `node_modules/@img` 解包。不要用 Node 测试通过替代安装版原生模块验收，也不要引入 Node canvas：官方记录同一 Windows 进程混用两者可能出现 DLL 冲突。

最终保留实际 Sharp、平台包、libvips 版本及其随包许可信息，验证原生二进制位置和 DLL 邻接；本次只核对官方安装要求，没有声称已验证依赖许可闭包或安装成功。

已有计划使用 Electron 浏览器 Canvas 合成，主进程 Sharp 负责受控图像解码/归一化；本交接不更改该架构。

## 坐标与透明像素

[metadata/statistics](https://sharp.pixelplumbing.com/api-input/) 的 width/height 来自输入头部，不包含后续管线操作；hasAlpha 只表示 alpha 通道。stats().isOpaque 检查实际像素，全不透明的 alpha 图片也返回 true。统计针对输入，要先落成新 buffer，再检查经过修改的结果。

[autoOrient](https://sharp.pixelplumbing.com/api-operation/#autoorient) 按 EXIF Orientation 旋转/镜像，并移除该标记。按现有规格先生成归一化的受控图像，再用其实际尺寸解释 crop/mask 坐标；不要在未落成的旋转管线上读取原始 metadata 尺寸并当作处理后的尺寸。本次是官方接口核对，实际导入/裁剪/透明度仍由视觉 Task 1 验证。
