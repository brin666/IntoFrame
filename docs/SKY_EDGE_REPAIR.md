# 旧天空边块修复候选 — 2026-10-11

## 状态

基线 HEAD：`d58406a3a73485033869adb4eca6d8012749513f`，开始时工作区干净。本轮只在 `fix/sky-boundary-contamination` 工作，保留 main，不推送。此前的功能通过不等于视觉验收；用户指出的大本钟夜空确实存在明显质量回退。

当前候选：http://127.0.0.1:5191/ ，旧实验：http://127.0.0.1:5191/experiment.html 。5190旧服务在冻结资源后停止，释放本机GPU；旧提交和失败资源保留。

功能测试通过；本机看图确认大本钟成块旧蓝天明显修复。**最终视觉验收等待用户确认**。不将下列全部照片宣布为视觉通过。

## 1. 冻结的真实失败样例

- 实际失败任务：`3534dba305414eb8ba733552b565edd9`，Cinematic Night，seed `2667092351`，生成尺寸576×640，22 steps，guidance9，strength1，skyCropFraction0.35。
- 用户截图：`screenshots/edge-repair/user-failure.png`。源照片原始3000×3366，无EXIF旋转；标准RGB1426×1600，与原始上传经现有处理后的RGB逐字节一致。
- 原任务目录完整复制到 `screenshots/edge-repair/before/`：source、上传阶段mask/subject、editable-sky、depth、render-depth、原背景、每种风格的background/composite/subject/render-sky/render-scene/sky-underlay/metadata。
- 补充保存原始JPEG、主体黑底/灰底、独立生成天空、保留场景及其权重、浏览器预览和真实下载PNG。Night原资源先冻结；Pink另外生成一次后冻结，其修改前后也复用同一份天空。
- 模型在裁切/调色之前的SD输出，以及第一次天空语义logits，旧代码没有写盘，无法回溯。独立天空取自原任务保存的无主体、无损render-sky纹理，去除86×96 padding；未为Night重新生成天空。
- 原语义输出用相同固定模型、原RGB重算并保存为 `semantic-recomputed.npz`。由它重建的旧编辑mask与失败文件逐字节一致；明确标为重算，不冒充第一次推理的原文件。
- `frozen-manifest.json`记录HEAD、文件SHA256、真实API结果；`frozen-pink.json`记录Pink版本。原主体mask/Alpha不作侵蚀、扩张、羽化或重采样。

## 2. 已证明的根因

### 逐层隔离

`diagnostic-layers.png`：第一行是原图、Alpha、主体黑底、主体灰底；第二行是旧天空编辑mask、保留场景灰底、隐藏主体后的天空+保留场景、最终全图。

黑/灰底主体不含截图中的大片蓝块；**隐藏顶部主体后，蓝块已出现在保留场景层**。

关键原生坐标 `(894,651)`：

| 数据 | 修改前 | 修改后 |
| --- | --- | --- |
| 原始RGB | `[182,223,243]` | 相同 |
| 主体Alpha | 0 | 0 |
| 天空编辑权重 | 0 | 255 |
| 保留场景RGBA | `[182,223,243,255]` | `[182,223,243,0]` |
| 最终RGB | `[182,223,243]` | `[16,29,59]`，等于冻结新天空 |

这些像素不在主体中，却被天空识别漏掉，随后 `build_sky_layers` 使用 `sceneAlpha = 255 - skyWeight` 将它们作为不透明原场景保留。新天空无法覆盖它们。

现有SegFormer输出150×128×128 logits；类别argmax经最近邻放大到原生网格，屋顶跨格的旧天空被标为建筑/摩天楼。原规则只向sky argmax候选扩展最多12px，因此不能穿过这些漏标块。全局98.7%置信覆盖仍允许边界错误。没有证明主体Alpha被新模块扩大；根因是**漏标天空被保留场景层贴回**。

### 历史与坐标核对

用 `git show 9bf6b3d:backend/compositing.py` 在独立诊断文件中执行，同一RGB、Alpha和Night天空得到 `historical-9bf6b3d-same-sky.png`，没有大片残留；历史和本轮原mask均保持Alpha。没有reset、覆盖工作区或重写历史。全背景替换仅作为纯天空建筑的诊断对照。

原图、Alpha、编辑mask和背景均1426×1600；padding左右86、上下96，动态1598×1792。静态/动态资源的原生中心一致。背景预览读取background，而非含主体的composite；主体PNG只在顶部绘制一次。RGBA为普通straight alpha，PIL、PNG、Canvas和Three.js纹理未在应用代码中重复预乘。未发现造成大块残留的EXIF、坐标或预乘错误。不同渲染器的窄边界采样仍可能有细微差异。

## 3. 最小修复与图层权重

新增 `backend/sky_refinement.py`，使用同次语义logits、原生RGB和**不变**的精细主体Alpha，局部细化可编辑天空：

1. 必须已有可靠天空且主体Alpha≥128提供可靠轮廓；只检查Alpha<2的可见像素。
2. 同时接近已确认天空和主体：最多4个模型格，最大64原生px；本例50px。
3. 原生Lab颜色与最近可靠天空的距离≤8，不是全图删除蓝色。
4. 其他语义类别保留。局部主体同类别仅在置信度<0.98且sky概率≥0.01时允许重新判断。
5. 四邻域路径必须连接已有天空，不能跨过颜色/类别障碍或跳入独立洞。
6. 已确认的主体是遮挡物，精细轮廓由其Alpha合成；天空边缘只向可见非天空环境做2px内侧过渡，避免在轮廓外再保留旧天空。

大本钟新增24,741个编辑像素，增强4,716个原羽化像素。原Alpha逐字节不变；不透明主体RGB不变。原边缘颜色恢复函数没有改动，仍只在需要改变天空的细边带运行。相机、阻尼、UI、电影黑边、生成模型与风格代码均未改。

定义：`I`为原始RGB，`A`为主体Alpha，`G`为冻结生成天空，`U`为补入隐藏主体区域后的sky-underlay，`J`为去除主体的保留场景RGB，`F`为原有边缘颜色恢复后的主体RGB。

```text
保留场景RGBA = (J, 1-U)
背景 B = U*G + (1-U)*J
中心最终画面 C = A*F + (1-A)*B
```

可见非天空且A=0时J=I，U=0，原RGB保持。隐藏主体部分用现有Telea近似；未编辑的半透明接触边沿用原RGB。主体内部A=1时最终只显示F，没有再次显示原主体。新天空远景与保留场景/主体沿用现有相机关系；背景限于画幅，黑边盖背景，主体在黑边上方。PNG使用中心变换，与长按临时状态无关。

`main.py`仅接入诊断保存、添加合成版本 `native-sky-boundary-v2`；`sky_detector.py`在原适用性检查通过后调用细化。无天空/不确定拒绝条件不放宽。新上传同时保存真实 `sky-semantic.npz` 和 `editable-sky-coarse.png`，便于后续逐层核对；每任务约8MiB额外磁盘数据，不由前端下载。

## 4. 功能测试（与视觉验收分开）

| 项目 | 实际结果 |
| --- | --- |
| 数值/状态 | 56通过：天空15含真实CPU模型、细化7、天空合成6、原合成6、任务调度6、原视差16 |
| Build | TypeScript/Vite通过；既有Three约515kB分包提示 |
| 新代码真实Generate | 巴黎混合场景实际上传/推理/生成；另一个巴黎任务三种风格真实生成、503重试、纹理恢复通过 |
| 冻结资源回放 | BigBen/金毛/巴黎 × 桌面/触摸共6组，加Pink桌面1组；不是新AI推理，明确标注 |
| Before/After、切图/切风格 | Before静态；实际不同照片和Night/Pink资源切换正确；取消旧长按 |
| 长按/回正/触摸 | 两端极值、松手回正和触摸取消通过；0浏览器/console/HTTP错误 |
| PNG | 7组回放中静止与长按导出SHA256一致；中心构图、没有控件 |
| 无天空 | 咖啡真实上传：Generate禁用、服务端422且无生成任务；实际CPU模型也识别室内猫为无天空 |
| 旧experiment.html | Flat/Depth左中右、长按、回正通过，错误0；第一次脚本误用默认5190，使用EXPERIMENT_URL=5191后通过 |

BigBen相机源码SHA和中心宽高/zoom/x/y/skyZ/targetGap与基线完全相同；桌面实测行程约 `[-0.03205,+0.02941]`，基线 `[-0.03206,+0.02941]`，差异来自采样时刻。没有提高最小位移目标。实体手机未测试，不将CDP触摸模拟称为实体设备验收。

回放初次遇到PNG差异时，证据表明后台重合成在两次下载之间重写测试fixture；该次结果作废。随后独立冻结浏览器fixture，7组重新通过。没有用该次失败宣称产品导出故障或忽略差异。

## 5. 视觉检查与限制

| 样例 | 本机人工观察 | 验收边界 |
| --- | --- | --- |
| A 用户失败BigBen Night | 同天空全图、局部、黑边关闭、中心/左右极值均不再有原来的大块蓝天；塔尖和装饰保留 | 放大仍可能见细微轮廓色边；正式验收等待用户 |
| B 同原图Dreamy Pink | 使用独立冻结的Pink天空，修改前后不换天空；大片旧蓝区域同样消除 | 不是只对深色背景设阈值；细色边不宣称完美 |
| C 户外金毛 | 细毛发/花朵和地面/fence保留，Alpha不变；同天空修复前后局部细节保留 | 背景树木语义边界仍较粗，未宣称整张照片抠图完美 |
| D 巴黎河岸混合场景 | 实际替换天空，桥/船/岸边建筑保留；已在修复API真实生成，并保存同天空Night对比 | 481,521个可见保护像素原RGB一致；另取不依赖mask的底部1600×194非天空区域，310,400像素一致 |
| E 咖啡 | 拒绝生成，桌面保留 | 只计降级测试通过 |
| 额外埃菲尔正视照 | 道路/其他建筑/树保留且天空实际生成，但塔内部大开口仍有旧天空 | **视觉未通过**。61–74px远离可靠天空，且被高置信摩天楼类别挡住；不为它放宽全部照片的保护规则 |

夜空与白天塔楼照明不一致仍然存在。轮廓修复不等于整体夜景自然，没有新增重新打光。相对深度仍只是现有轻量2.5D运动；本轮不新增几何或模型。独立审查未发现阻塞问题，不代替用户视觉确认。

## 6. 可查看的实际图片

全部图片和模型结果在gitignored本地目录，不随commit提交。

- [主体/保留层诊断](../screenshots/edge-repair/diagnostic-layers.png)
- [天空原始输出重算与编辑权重前后](../screenshots/edge-repair/diagnostic-repair.png)
- [Night同天空/同构图实际导出前后](../screenshots/edge-repair/bigben-night-preview-comparison.png)
- [Night原生关键局部前后](../screenshots/edge-repair/bigben-cinematic-night-details.png)
- [Pink同天空全图前后](../screenshots/edge-repair/bigben-dreamy-pink-full.png)
- [中心/左极值/右极值/回正](../screenshots/edge-repair/bigben-motion-comparison.png)
- [金毛细节](../screenshots/edge-repair/dog-cinematic-night-details.png)
- [巴黎混合场景同天空前后](../screenshots/edge-repair/paris-cinematic-night-full.png)
- [Night真实下载PNG](http://127.0.0.1:5191/media/edge-repair-delivery/bigben-night-after.png)
- [Pink真实下载PNG](http://127.0.0.1:5191/media/edge-repair-delivery/bigben-pink-after.png)
- [混合场景真实下载PNG](http://127.0.0.1:5191/media/edge-repair-delivery/mixed-scene-after.png)

原浏览器回放、资源身份、视角和SHA记录：`browser-before/results.json`、`browser-after/results.json`、`browser-after-pink/results.json`、`browser-after/trajectory-comparison.json`。源和生成一致性：`repair-audit.json`、`diagnosis.json`、`live-audit.json`、`live-mixed-scene/results.json`、`live-no-sky/results.json`。

## 7. 文件、复现与模型记录

生产修改仅：`backend/sky_refinement.py`、`backend/sky_detector.py`、`backend/main.py`。诊断/测试：`scripts/diagnose-sky-edge.py`、`prepare-edge-acceptance.py`、`recompose-sky-edge.py`、`edge-browser-replay.mjs`、`test-sky-refinement.py`。文档：本报告、README、ARCHITECTURE、旧回归报告纠正说明。

```powershell
# 已保存本机失败资源；本轮未分发私人图片
.\.venv\Scripts\python.exe scripts\test-sky-refinement.py
.\.venv\Scripts\python.exe scripts\test-sky-detector.py --model-smoke
# 同天空重合成会重写 AFTER fixture，须在浏览器测试开始前完成
.\.venv\Scripts\python.exe scripts\recompose-sky-edge.py
node scripts\edge-browser-replay.mjs --manifest screenshots\edge-repair\replay-manifest.json --base http://127.0.0.1:5191 --out screenshots\edge-repair\replayed
$env:EXPERIMENT_URL='http://127.0.0.1:5191/experiment.html'
node scripts\subject-experiment-browser.mjs
```

本轮没有新增或更换模型。语义模型仍为 `nvidia/segformer-b0-finetuned-ade-512-512`，revision `489d5cd81a0b59fab9b7ea758d3548ebe99677da`，NVIDIA非商业研究/评测条款。生成模型仍为 `stable-diffusion-v1-5/stable-diffusion-inpainting`，revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`，CreativeML OpenRAIL-M及其限制。BiRefNet/Depth版本与[第三方记录](THIRD_PARTY.md)相同。此次本地检查没有核实所有未来发布/商业用途的授权，也没有因文档已有许可证就视作获得许可。

金毛、巴黎和埃菲尔评测原图仅下载到本地，来源分别为Unsplash照片 `photo-1552053831-71594a27632d`、`photo-1502602898657-3e91760cbb34`、`photo-1511739001486-6bfe10ce785f`；不随代码分发，不声称已核实所有传播用途。
