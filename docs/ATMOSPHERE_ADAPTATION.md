# Pink / Blue-hour atmosphere update

2026-10-12，沿用 `fix/sky-boundary-contamination` 工作区。此次颜色调整前 HEAD 为 `a2180d18433e5c0979102dff6a6e5819cc477454`，工作区已有未提交的深度、拖动及 Remotion 网页动画代码。本次未重置这些修改，未推送 main。

## 已确认的问题

- 原 Pink 仅靠 SD1.5 提示词决定颜色；实际天空为灰蓝色，未做粉紫色调约束。
- 原 Night 提取顶部 35% 的小块天空，放大后用亮度阈值额外增强亮点，星点和噪声因此粗大。前景和保留场景完全保留日光 RGB，与深夜星空不匹配。
- 新 Pink 第一轮实际输出虽然已粉紫，但顶部裁切主要是空天空和颗粒；保留这次输出后，改成向上观看近景云层的提示词，并只对生成天空做原始裁切分辨率下的轻微降噪。

## 当前处理

仍使用 `stable-diffusion-v1-5/stable-diffusion-inpainting`，revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`，FP16 CPU offload、22 steps、CFG 9、最长边约640px。未加模型或付费 API。许可证记录继续见 [THIRD_PARTY](THIRD_PARTY.md)，此次未重新核实所有发布用途。

1. Pink：原生天空裁切中的云层亮度连续映射到柔和粉紫/玫瑰/浅桃色；轻微降噪后放大。
2. Night：生成蓝调暮色云天，负提示抑制星空；局部亮点抑制只作用于合成天空，取消星点增强。
3. `atmosphere.harmonize_layer()` 对主体和保留环境使用同一套逐像素 RGB 曲线。Pink 加少量暖紫环境色；Night 对阴影和高光使用温和曝光曲线及冷色阴影，保留金色建筑和白色钟面。
4. 原图、Alpha、编辑天空遮罩、保留场景 Alpha、几何、深度及相机行程不变。前景和保留场景不做空间模糊或侵蚀。
5. 所有静态/Three.js/Remotion/导出图层来自同一 `sky-scene-ambience-v2` 结果。新 URL 为 `styles/<style>/<version>/...`，过时缓存需要 Update atmosphere；旧图保留。
6. Golden Hour 继续使用原天空调色，前景和保留环境 RGB 不调整。

这是整体颜色协调，**不是重新打光**。原照片的日光阴影、反射及建筑表面照明仍存在；蓝调傍晚比深夜星空更适合这个主体，不能据此称为真实夜景重建。

## 实际图像证据

本轮实际 API 推理复用用户大本钟作业 `a2bc9adae2b64a3bac527fb496439eb2` 的原图、Mask、天空遮罩和原深度，不重新分割或估计深度。

- Pink seed `42906370`，第二轮生成及合成约24.1s，模型推理6.55s，冷模型加载9.36s。
- Night seed `2667092351`，生成及合成约10.2s，模型推理3.98s，模型已加载。
- 实际 PNG：`screenshots/style-adaptation/browser/verified/desktop/{dreamy-pink,cinematic-night}-export-static.png`。
- 同一原图、Alpha、中心构图的旧/新对照：`screenshots/style-adaptation/bigben-atmosphere-before-after.png`。旧图使用保存的旧背景/主体，按当前导出 Canvas 的相同构图重合成；新图是实际 Download PNG。
- 原始模型输出：`backend/data/<job>/styles/<style>/sky-scene-ambience-v2/model-sky-raw.png`，保留裁切前的真实生成图；可能包含生成模型擅自加入的地面，最终天空只采用安全的顶部裁切。
- 初次尝试与旧失败资源保存在 `screenshots/style-adaptation/before/` 和同目录的 attempt1 JSON；不是用演示插画替代模型输出。

## 验证与边界

`test-atmosphere.py`、`test-restyle-jobs.py`、`test-compositing.py`、`test-sky-compositing.py` 合计26项通过；`test-reveal-timeline.mjs` 和 TypeScript/Vite build 通过。更新旧测试的版本路径和颜色契约：受保护场景允许已声明的 RGB 曲线，Alpha 和空间内容仍受保护。

实际资源审计 `check-sky-assets.py`：原有及两个新版本的7组风格资源通过；原生/补边纹理一致、分层/扁平背景一致、主体 Alpha 一致、主体不进入编辑遮罩，非天空 RGB 符合声明的曲线。

浏览器脚本 `scripts/style-adaptation-browser.mjs` 复用已完成的真实本地作业，GET 和素材字节来自实际服务器并核验 SHA256，POST 只确认已有作业，不宣称这部分重新做了模型推理。检查桌面 Pink/Night、CDP 触摸 Night、原图 Before、六秒 Remotion 回放/取消/交接、长按拖动、静态 PNG 和旧实验入口。完整记录及屏幕截图见 `screenshots/style-adaptation/browser/`。触摸是浏览器模拟，不是实体手机测试；测试计时不能当作实际显示 FPS。

最终49项浏览器检查通过：桌面31/31，CDP触摸18/18。权威汇总为 `browser/accepted-summary.json`，桌面为 `browser/verified/desktop/results.json`。早期两次回放分别遇到测试脚本的实验按钮选择器歧义，以及 Before 一像素一灰度级的 GPU 舍入差异；修正选择器，改成整图 RGB 容差与原始资源 SHA256 双重检查后通过，产品代码无需为此修改。最终 Before 的两次风格对照实际像素完全一致。

本次查看的普通预览尺寸中 Pink 颜色更明确，Night 无旧密集星点；中心/长按/导出使用正确资源。高倍放大仍可看到低分辨率生成天空的柔化、少量原有抠图颜色误差。未将功能测试等同于普遍视觉质量保证，最终审美效果以用户查看实际图像为准。

本地网页：`http://127.0.0.1:5190/`。刷新网页后上传照片并选择风格；旧缓存需 Update atmosphere/重新生成。PNG 始终导出静止中心构图。
