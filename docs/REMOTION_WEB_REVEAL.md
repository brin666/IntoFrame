# 原照片到空间画幅的网页过渡 — 2026-10-12

用户选择网页播放。使用 `remotion` 和 `@remotion/player`，固定版本4.0.534，与现有React19/Vite一起运行。没有安装视频渲染器、添加MP4接口、调用额外AI服务或更换模型。

## 如何查看

打开并刷新 `http://127.0.0.1:5190/`，上传、选风格、Generate。生成完成后自动播放一次；**Replay transition**重播，**Skip animation**直接返回预览。

- 0–0.8s：未裁切的原照片。
- 0.8–3s：共享构图平滑调整，原图渐变为现有生成背景与主体的完整合成。
- 3–4.8s：上下黑边收拢到各13%，主体持续显示在黑边上方。
- 4.8–6s：保持中心破框构图，然后恢复现有深度网格和自动/拖动探索。

播放不重新请求AI，静态PNG始终导出当前中心结果，不含过渡中间帧。Before、Mask、换照片/风格、改变裁切会取消动画。后台页面暂停；系统减少动态设置跳过自动过渡并禁用重播。

## 实现

- `src/remotion/revealTimeline.ts`：30fps、180帧。由帧号计算单调、无过冲的构图、背景混合和黑边状态。
- `src/remotion/PhotoReveal.tsx`：原生source/background/subject使用同一图像矩形。**先合成背景与主体，再对整个组合渐变**，避免分别设置透明度造成主体重影。
- `src/PhotoRevealPlayer.tsx`：加载/解码三张图片，核对原生宽高；保留原图作为加载画面。资源错误恢复主预览并显示原因；取消、结束及旧回调均受当前实例保护。
- `src/App.tsx`：生成完成与重播挂接，播放期间暂停现有相机运动，结束后交回空间预览。旧原图、生成背景、主体及PNG流程沿用。
- `src/styles.css`：只新增覆盖层和播放时光标样式；沿用现有控件布局。

末帧使用 `FILM_BAR_FRACTION` 和 `exportFrame.ts` 相同的缩放/偏移/原生图层。Remotion部分是二维合成过渡，不冒充三维重建；之后的空间变化由现有深度网格处理。本轮没有修改空间网格、相机或后端推理代码。

## 验证

```powershell
npm.cmd run build
node scripts/test-reveal-timeline.mjs
node scripts/remotion-reveal-browser.mjs --base http://127.0.0.1:5190
```

浏览器验证使用本机已保存的真实模型资产/API结果回放，明确标注不是新AI推理。包含大本钟桌面和金毛触摸模拟：首帧原图、背景渐变、黑边和越框、自然结束/空间拖动恢复、重播/跳过、取消及资源503、PNG一致、减少动态设置。证据在gitignored `screenshots/remotion-reveal/`。

首轮桌面脚本错误地选择了未捕获的Golden Hour测试资产；修正为已捕获的Pink后通过。这是测试素材缺失，失败记录保留。没有通过假生成结果补齐它。

构建和时间轴端点检查通过；既有14项交互控制器、9项深度几何检查通过。最终构建桌面32项检查通过（含播放/探索提示）；此前触摸模拟21项通过，动画组件与交互源文件未改变。最终构建及较早触摸构建分别标注在 `screenshots/remotion-reveal/accepted-build-summary.json`，完整截图在 `final-desktop/` 与 `validation-01/dog-mobile/`。不将触摸模拟称为实体手机验证，不从headless计时声称真实显示FPS。

参考：[Player官方API](https://www.remotion.dev/docs/player/player)、[固定版本许可证](https://raw.githubusercontent.com/remotion-dev/remotion/v4.0.534/LICENSE.md)。Remotion不是MIT许可；本次本地实现不表示所有未来发布用途的许可都已核实。模型与图片权利边界沿用[第三方记录](THIRD_PARTY.md)。

项目已有其他未提交的深度/拖动改动，本轮保留它们；没有创建提交、合并或推送。
