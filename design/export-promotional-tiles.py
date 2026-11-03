"""Export the two store tiles using the approved vector brand and outlined type."""
from pathlib import Path
import io
import json
import xml.etree.ElementTree as ET

import fitz
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/store/promotional-tiles"
BRAND = ROOT / "assets/branding/responsive-node-v1"
BLUE = "#4D6BFE"
INK = "#152137"
MUTED = "#738099"
FONT_PATHS = {
    "regular": "C:/Windows/Fonts/msyh.ttc",
    "bold": "C:/Windows/Fonts/msyhbd.ttc",
    "number": "C:/Windows/Fonts/segoeuib.ttf",
}
FONTS = {key: TTFont(value, fontNumber=0) for key, value in FONT_PATHS.items()}


class Canvas:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.parts = []

    def add(self, markup):
        self.parts.append(markup)

    def rect(self, x, y, w, h, fill, radius=0, stroke=None):
        outline = f' stroke="{stroke}" stroke-width="1"' if stroke else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}"{outline}/>')

    def circle(self, x, y, r, fill, stroke=None, sw=1):
        outline = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"{outline}/>')

    def line(self, x1, y1, x2, y2, color, width=1):
        self.add(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')

    def text(self, x, baseline, content, size, fill=INK, weight="regular", align="left"):
        font = FONTS[weight]
        glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
        scale = size / font["head"].unitsPerEm
        advance = sum(font["hmtx"].metrics[cmap[ord(ch)]][0] for ch in content)
        if align == "right":
            x -= advance * scale
        elif align == "center":
            x -= advance * scale / 2
        paths, cursor = [], 0
        for char in content:
            name = cmap[ord(char)]
            pen = SVGPathPen(glyphs)
            glyphs[name].draw(pen)
            paths.append(f'<path d="{pen.getCommands()}" transform="translate({cursor} 0)"/>')
            cursor += font["hmtx"].metrics[name][0]
        self.add(f'<g fill="{fill}" transform="translate({x} {baseline}) scale({scale} {-scale})">{"".join(paths)}</g>')

    def brand(self, x, y, width, white=True):
        source = BRAND / ("logo-horizontal-white.svg" if white else "logo-horizontal.svg")
        root = ET.parse(source).getroot()
        ratio = width / float(root.attrib["width"])
        body = "".join(ET.tostring(child, encoding="unicode") for child in root if not child.tag.endswith("title"))
        self.add(f'<g transform="translate({x} {y}) scale({ratio})">{body}</g>')

    def slider(self, x, y, width, progress):
        self.rect(x, y, width, 5, "#E6EBF7", 2.5)
        self.rect(x, y, width * progress, 5, BLUE, 2.5)
        self.circle(x + width * progress, y + 2.5, 7, "white", BLUE, 3)

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" '
                f'viewBox="0 0 {self.width} {self.height}" role="img">'
                '<title>DeepSeek GenUI promotional tile</title>' + "".join(self.parts) + "</svg>")


def large_tile():
    c = Canvas(1400, 560)
    c.rect(0, 0, 1400, 560, BLUE)
    # The large, open node motif echoes the approved logo geometry.
    c.add('<path d="M1470 50H1120Q1050 50 1050 120V560M1010 620H1320Q1390 620 1390 550V200" '
          'fill="none" stroke="#627DFE" stroke-width="82"/>')
    c.circle(1210, 324, 93, "#627DFE")
    c.brand(57, 44, 340)
    c.text(70, 208, "让 AI 回答，", 54, "white", "bold")
    c.text(70, 283, "成为交互界面。", 54, "white", "bold")
    c.text(73, 337, "调整参数，即时探索答案中的更多可能。", 19, "#E6EBFF")
    for x, w, label in [(73, 119, "交互控件"), (205, 119, "图表联动"), (337, 119, "表格对比")]:
        c.rect(x, 377, w, 38, "#617BFE", 19)
        c.text(x + w / 2, 402, label, 15, "white", align="center")
    c.text(73, 501, "适用于 DeepSeek 网页版 · 非官方扩展", 13, "#DCE4FF")

    # A compact promotional composition of supported controls and calculations.
    c.rect(683, 83, 638, 420, "#3D58DE", 25)
    c.rect(675, 71, 638, 420, "white", 22)
    c.rect(675, 71, 638, 57, "#F7F9FF", 22)
    c.rect(675, 100, 638, 28, "#F7F9FF")
    c.circle(704, 100, 4, "#BEC9E1")
    c.circle(718, 100, 4, "#D4DCEE")
    c.circle(732, 100, 4, "#E0E6F3")
    c.text(761, 105, "交互卡片", 12, MUTED)
    c.text(1284, 105, "AI 生成 · 示例数据", 11, MUTED, align="right")
    c.text(704, 169, "月度预算规划", 24, INK, "bold")
    c.rect(1199, 143, 86, 26, "#EDF8F3", 13)
    c.circle(1213, 156, 3, "#24A179")
    c.text(1223, 160, "本地计算", 11, "#258766")

    c.rect(703, 190, 252, 207, "#F7F9FE", 14)
    c.text(724, 220, "月收入", 13, MUTED)
    c.text(724, 258, "¥ 12,000", 29, INK, "number")
    c.slider(726, 278, 205, .65)
    c.text(724, 321, "支出预算", 13, MUTED)
    c.text(931, 322, "¥ 9,000", 18, INK, "number", align="right")
    c.slider(726, 343, 205, .52)
    c.text(726, 379, "拖动滑块，结果同步更新", 11, MUTED)

    c.text(981, 215, "可支配余额", 13, MUTED)
    c.text(979, 264, "¥ 3,000", 41, BLUE, "number")
    for y, label, amount, progress, color in [
        (296, "收入", "12,000", 1, BLUE),
        (335, "支出", "9,000", .75, "#99ACFF"),
        (374, "余额", "3,000", .25, "#28AA88"),
    ]:
        c.text(982, y, label, 11, MUTED)
        c.text(1284, y, amount, 11, INK, "number", align="right")
        c.rect(982, y + 7, 302, 8, "#EEF1F9", 4)
        c.rect(982, y + 7, 302 * progress, 8, color, 4)
    c.line(704, 417, 1284, 417, "#EBEFF7")
    c.text(704, 455, "调整条件 → 计算结果 → 继续讨论", 12, MUTED)
    c.rect(1166, 433, 119, 33, BLUE, 9)
    c.text(1225.5, 455, "继续讨论  ↗", 12, "white", align="center")
    return c


def small_tile():
    c = Canvas(440, 280)
    c.rect(0, 0, 440, 280, BLUE)
    c.add('<path d="M490 16H364Q328 16 328 52V280M300 320H404Q440 320 440 284V156" '
          'fill="none" stroke="#617CFE" stroke-width="35"/>')
    c.brand(18, 13, 242)
    c.text(414, 43, "非官方扩展", 10, "#E5EBFF", align="right")
    c.text(26, 105, "让 AI 回答，动起来。", 29, "white", "bold")
    c.text(27, 131, "调参数 · 看图表 · 比方案", 12, "#E5EBFF")

    c.rect(26, 155, 392, 113, "#3E59DD", 14)
    c.rect(23, 151, 392, 113, "white", 13)
    c.text(39, 176, "月度预算", 12, INK, "bold")
    c.text(399, 175, "AI 生成 · 示例数据", 9, MUTED, align="right")
    c.line(224, 188, 224, 247, "#E8EDF8")
    c.text(40, 201, "支出预算", 10, MUTED)
    c.text(207, 202, "9,000", 14, INK, "number", align="right")
    c.slider(42, 219, 163, .64)
    c.text(41, 246, "拖动调整，即时计算", 9, MUTED)
    c.text(241, 200, "可支配余额", 10, MUTED)
    c.text(239, 231, "¥ 3,000", 27, BLUE, "number")
    c.rect(242, 241, 153, 5, "#ECF0FA", 2.5)
    c.rect(242, 241, 38, 5, "#28AA88", 2.5)
    return c


def export(canvas, stem):
    svg = canvas.svg()
    svg_path = OUT / f"{stem}.svg"
    png_path = OUT / f"{stem}.png"
    svg_path.write_text(svg, encoding="utf-8")
    with fitz.open(stream=svg.encode(), filetype="svg") as source:
        with fitz.open(stream=source.convert_to_pdf(), filetype="pdf") as pdf:
            pix = pdf[0].get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
            with Image.open(io.BytesIO(pix.tobytes("png"))) as high_res:
                output = high_res.convert("RGB").resize((canvas.width, canvas.height), Image.Resampling.LANCZOS)
                output.save(png_path, optimize=True)
    with Image.open(png_path) as check:
        assert check.size == (canvas.width, canvas.height)
        assert check.mode == "RGB"
        check.verify()
    # No font dependencies or external images remain in the vector deliverable.
    root = ET.fromstring(svg)
    assert not any(node.tag.endswith("text") or node.tag.endswith("image") for node in root.iter())
    return {"file": str(png_path.relative_to(ROOT)), "size": [canvas.width, canvas.height], "mode": "RGB", "bytes": png_path.stat().st_size}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    results = [export(small_tile(), "promotional-tile-440x280"),
               export(large_tile(), "promotional-tile-1400x560")]
    print(json.dumps(results, ensure_ascii=False, indent=2))
