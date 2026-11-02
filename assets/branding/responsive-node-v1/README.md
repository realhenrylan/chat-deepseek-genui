# DeepSeek GenUI — 交互节点

选定方案：首轮六案中的 **02 / Responsive Node**。日期：2026-11-02。

图形保留两个错位圆角转折与中心节点的构造。主色为 #4D6BFE，字标为已转轮廓的 Manrope 650。

## 文件使用

| 场景 | 文件 |
|---|---|
| 标准独立标志 | logo.svg / logo-512.png |
| 16–28px | logo-small.svg，或 icons/ 中对应像素尺寸 |
| 页头、README | logo-horizontal.svg / logo-horizontal.png |
| 方形组合 | logo-stacked.svg / logo-stacked.png |
| 单色输出 | 文件名带 -black 的版本 |
| 深色背景 | 文件名带 -white 的反白版本 |

独立标志另提供 256/512/1024px 透明 PNG。icons/ 中含 16/20/24/28/32/48/64/128/256px 蓝、黑、白图标。所有 SVG 均为路径或基本几何形状，字标无需安装字体。

## 规格

- 图形基准画布 104u，可见主体范围约 16–88u。主厚度 16u，内转角 4u，中心节点半径 12u。
- 微型版扩大主体占比，保持相同的形状与留白关系。
- 建议横向组合宽度至少 180px，独立图形至少 16px；浏览器最终显示仍需接入后检查。
- 正常排版安全间距至少为可见图形高度的 0.25 倍。保持比例缩放。
- 主色 #4D6BFE；文字 #152137；单黑 #000000；反白 #FFFFFF；推荐深底 #111A2B。

preview.png 为蓝色、单黑和反白展示。selection.json 记录选定信息。

本目录完成定稿资源整理；扩展清单与页面资源尚未接入。原始方向稿与应用示意位于 design/logo-variants/02-responsive-node/。

几何图形按项目 MIT 许可使用，见 LICENSE。Manrope 字体轮廓相关许可见 Manrope-OFL.txt。

可从仓库执行 python design/export-selected-logo.py 重新导出资源与压缩包。
