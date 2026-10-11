# Sky Restyling First — 实际回归，2026-10-11

基线：`9bf6b3d`。本轮保持三种风格、原页面和实验入口，新增天空编辑保护与自适应视差。下面区分实际生成成功、功能通过和明确降级。

## 诊断分类

| 问题 | 本轮源码/实测结论 | 处理 |
| --- | --- | --- |
| 视差过弱 | 固定0.06世界单位行程在小画布上得到更小像素差；主体中位深度映射又存在截取平台 | 按实际投影求行程，随尺寸/缩放/触摸更新，并用实际映射后的深度计算 |
| 视差完全失效 | 未复现此前修复后的 After 绑定失效；深度异常/资源失败仍应保持静态 | 保留失败提示与当前资源身份门控，加入真实资源故障回归 |
| 切换图片/风格错误 | 基线已取消旧场景；生成中切换风格存在交互歧义，缓存 Show result 未主动终止原长按 | 生成中禁用风格切换；切换风格及显示缓存结果均结束长按；新上传清除旧结果 |
| 编辑范围错误 | 原流程生成整片天空，之后仅恢复主体；主体以外道路/桌面都可能消失 | 单独语义天空遮罩，原始非天空场景保留 |
| 无天空也生成 | 没有适用性检查 | 客户端禁用 Generate，服务端422且不创建生成任务 |
| 预览/动态/导出不同步 | 基线原生/填充资源一致；局部编辑后必须新增相同像素来源的动态分层 | 相同天空纹理和保留场景生成原生背景、填充背景与动态层；导出独立于临时相机 |

## 具体规则与能力边界

- BiRefNet **Subject Mask** 不变。SegFormer B0 ADE 的 **Editable Sky Mask** 来自独立语义预测，保护主体alpha>=2。
- 天空种子要求sky argmax及概率>=0.8；候选sky argmax且概率>=0.5。候选至少占1%，其中高置信度覆盖至少90%；不足则拒绝整个编辑。可靠边界最多延伸12原图像素，始终限制在候选天空；2px向内羽化，去除小碎片。
- 无天空、边界大面积歧义、模型不可用分别有明确原因，不用Mask反面代替天空，不提交SD任务。
- SD1.5仍只生成天空纹理，输入为中性色场。语义合成才决定源图哪些像素允许变化；天空以外的可见原始RGB不送去重绘。
- 主体下被遮挡的背景用有界Telea近似，天空覆盖只在这些不可见像素中推断。未编辑地面的半透明接触边保留原始底色。
- 新天空远景z=-0.8；保留场景与主体共用原始深度中位值映射后的z=.78–.98。背景场景整体是一个支撑平面，主体仍是透明DOM层。这是轻量2.5D；没有宣称主体/各建筑的真实三维形变。
- 行程目标桌面4–6px、触摸2.8–4px，按占比轻调。换算系数为 `zoom*focalPixels*(1/(3.5-zSubject)-1/(3.5-zSky))`；再受填充余量与主体源图侧边裁切限制。单侧裁切采用单向往返，两侧都无余量时静态并提示。最终相机位置亦受限，避免弹簧越界。实际缓动峰值可低于目标。
- 对低位置人物，统一构图尽量保留至少15%画高的可见天空带；Before、After和PNG采用同一中心构图。

## 至少四类真实样例

| 类型/样例 | 实测结果 | 可见效果与限制 |
| --- | --- | --- |
| A 大本钟+天空 | Dreamy Pink真实生成；桌面/触摸模拟通过 | 塔尖越框、等高黑边、轻量视差。峰值差5.30/3.47px；轮廓局部仍有窄旧天空色带，不声称边缘完美 |
| B 海边人物+天空 | 三种风格实际生成；桌面/触摸模拟通过 | 人物、海浪和岸边保留，天空改变；脚部继续越框。Dreamy峰值差5.31/2.40px；人物很小，头发细节不是高难度近景头发验收 |
| C 夜间发射场结构+局部天空 | 明确降级，未生成 | 高置信度覆盖84.8%低于90%；提示天空边界不确定，API422，不移除发射塔/地面 |
| C 追加日间城市街景 | 主体分割明确拒绝，未生成 | BiRefNet结果过小或几乎覆盖全图；界面给出原始错误并可换图。该街景不算生成成功 |
| D 咖啡桌面、室内猫 | 无天空降级通过 | Generate禁用；API422；生成任务GET404；桌面/支撑面未被换成天空 |
| 追加平滑蓝天人像 | 歧义降级通过 | 第一版实际出现新旧天空碎片拼接，不能算视觉成功。诊断覆盖35.6%，现在拒绝并提示；未通过降低阈值强行换天空 |

本轮没有证明任意街景均可换天空。C类完成的是用户允许的“明确限制”路径，A/B为实际可演示生成路径。原生成模型、分割模型和深度模型未更换，没有新增风格或页面。

## 回归与一致性

- `npm.cmd run build`：TypeScript/Vite通过，仍有Three.js约515kB分包提示。
- 49项数值/状态测试通过：天空15（包含实际CPU模型）、天空合成6、原合成6、任务调度6、视差16。
- `parallax-browser-smoke.mjs`：大本钟/海边人物 × 桌面/触摸模拟四组通过。长按、松手、pointercancel/touchcancel、移出、blur、Before静态、Mask静态、reduced motion、导出一致、无逐帧AI调用、无横向溢出均检查。
- `restyle-browser-smoke.mjs`：真实三风格、503后重试、Before/After、PNG、长按时切换风格取消、纹理503后恢复通过。
- `sky-browser-smoke.mjs`：无天空与歧义拒绝、服务端保护、连续上传清除旧风格、缓存Show result回正通过。追加街景分割失败在UI明确显示，并作为边界记录。
- `subject-experiment-browser.mjs`：旧experiment.html Flat/Depth的左中右、长按、回正通过，浏览器错误0。
- `check-sky-assets.py`：审计8个实际生成结果，主体alpha/不透明核心保持；原生与填充中心RGB逐字节一致；动态天空+保留场景组合与填充背景逐字节一致。海边人物三风格均保护904,872个可见非天空像素。
- 四组长按中导出的PNG与静止PNG **SHA256一致**。输出不含UI和相机临时状态。Three.js与PIL/浏览器的抗锯齿、色彩混合和缩放采样会在窄边界产生差异，未声称截图与原尺寸PNG逐像素一致。

性能：实际上传后生成墙钟11.8–31.4秒（包含排队/初次加载）；缓存Cinematic Night模型推理8.83秒。CPU天空预检约0.5–0.6秒/张。浏览器rAF回调约231–240次/秒、p95间隔4.3ms，是**headless回调计时，不是显示FPS**。本轮GPU一个点读数5,444/8,188MiB，包括其他进程；不是峰值显存测量。触摸为Chrome/CDP模拟，未做实体手机验收。

## 本地证据与复现

当前入口：http://127.0.0.1:5190/ ，实验：http://127.0.0.1:5190/experiment.html 。图片、视频和日志均在gitignored目录，不上传私人图片到GitHub。

- 四组视差原图/长按/回正/导出和测量：`screenshots/parallax/regression/`。
- 两类可生成画面的对照：`screenshots/sky-regression/comparison.png`。
- 降级与连续上传：`screenshots/sky-regression/results.json`；日间街景：`screenshots/sky-street-regression/`。
- 实际资源保护审计：`screenshots/sky-asset-audit.json`。

```powershell
# 已启动5190单入口服务后
.\.venv\Scripts\python.exe scripts\prepare-sky-inputs.py
$env:INTOFRAME_URL='http://127.0.0.1:5190'
$env:INTOFRAME_TEST_PHOTO='<自己的建筑+天空照片路径>'
node scripts\parallax-browser-smoke.mjs
Remove-Item Env:INTOFRAME_TEST_PHOTO
node scripts\restyle-browser-smoke.mjs
node scripts\sky-browser-smoke.mjs
.\.venv\Scripts\python.exe scripts\check-sky-assets.py screenshots\parallax\regression\results.json screenshots\sky-regression\results.json
node scripts\subject-experiment-browser.mjs
```

评测脚本默认海边人物、歧义人像和追加街景来自Unsplash，仅下载到本地评测，不随仓库分发。歧义人像为[Joshua katt的照片](https://unsplash.com/photos/a-smiling-man-poses-against-a-blue-sky-BfwaTm2igCs)，街景来源[Unsplash原页](https://unsplash.com/photos/empty-road-between-high-rise-buildings-during-daytime-DpeXitxtix8)。咖啡/猫/发射场来自scikit-image。旧公开示例及权利说明保留为历史记录，不作为本轮成功证明。

## 修改文件

- 前端：`src/App.tsx`、`src/SpatialFrameScene.tsx`、`src/api.ts`、新增`src/parallax.ts`。
- 后端：`backend/main.py`、`backend/restyler.py`、`backend/compositing.py`、新增`backend/sky_detector.py`、`backend/sky_compositing.py`。
- 数值测试：`scripts/test-parallax.mjs`、`scripts/test-sky-detector.py`、`scripts/test-sky-compositing.py`、`scripts/test-compositing.py`、`scripts/test-restyle-jobs.py`。
- 浏览器/证据脚本：`scripts/parallax-browser-smoke.mjs`、`scripts/restyle-browser-smoke.mjs`、`scripts/sky-browser-smoke.mjs`、`scripts/check-sky-assets.py`、`scripts/prepare-sky-inputs.py`、`scripts/prepare-acceptance-inputs.py`、`scripts/visual-acceptance.mjs`、`scripts/acceptance-artifacts.py`。
- 文档：`README.md`、`ARCHITECTURE.md`、`docs/THIRD_PARTY.md`、`docs/PARALLAX_REGRESSION.md`、`docs/VISUAL_ACCEPTANCE.md`、本报告。

SegFormer许可为[NVIDIA非商业研究/评测条款](https://github.com/NVlabs/SegFormer/blob/master/LICENSE)，权重不在仓库；不能把本轮验证解释为已获得商业使用许可。
