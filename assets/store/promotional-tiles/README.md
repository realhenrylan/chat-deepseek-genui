# 商店推广图

沿用 Responsive Node 定稿 Logo 与主色 `#4D6BFE`，中文推广文案。

| 商店上传栏位 | 上传文件 | 尺寸 | 格式 |
| --- | --- | --- | --- |
| **Small promotional tile** | `small-promotional-tile-440x280.png` | 440 × 280 px | RGB PNG，无透明通道 |
| **Large promotional tile** | `large-promotional-tile-1400x560.png` | 1400 × 560 px | RGB PNG，无透明通道 |

按栏位分别上传以上 PNG，避免大小图传反。上传专用文件使用 96 DPI 元数据；校验依据仍为实际像素尺寸。

原始 `promotional-tile-440x280.png` 与 `promotional-tile-1400x560.png` 完整保留，画面与上传专用文件相同。同名 SVG 为文字转轮廓的矢量源文件，不依赖外部图片或字体。

画面展示预算滑块、本地派生计算与图表联动的推广示意，并标注「AI 生成 · 示例数据」与「非官方扩展」。画面不是站点截图，不包含真实用户数据。

重新导出：在仓库根目录运行 `python design/export-promotional-tiles.py`。脚本使用 Pillow、PyMuPDF、fontTools，以及 Windows 系统字体 Microsoft YaHei 和 Segoe UI；品牌字标直接复用定稿矢量文件。按 3 倍尺寸渲染后缩小，检查最终尺寸、RGB 模式及 PNG 完整性。
