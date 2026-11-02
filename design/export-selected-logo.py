"""Export the selected Responsive Node logo into a self-contained asset package."""
from pathlib import Path
import json, shutil, xml.etree.ElementTree as ET, zipfile
import fitz
from PIL import Image, ImageDraw, ImageFont

REPO=Path(__file__).resolve().parents[1]
SOURCE=REPO/"design"/"logo-variants"/"02-responsive-node"
OUT=REPO/"assets"/"branding"/"responsive-node-v1"
OUT.mkdir(parents=True,exist_ok=True)
FILES={
 "logo.svg":"symbol-blue.svg",
 "logo-black.svg":"symbol-black.svg",
 "logo-white.svg":"symbol-white.svg",
 "logo-small.svg":"symbol-micro.svg",
 "logo-small-black.svg":"symbol-micro-black.svg",
 "logo-small-white.svg":"symbol-micro-white.svg",
 "logo-horizontal.svg":"primary-blue.svg",
 "logo-horizontal-black.svg":"primary-black.svg",
 "logo-horizontal-white.svg":"primary-white.svg",
 "logo-stacked.svg":"stacked-blue.svg",
 "logo-stacked-black.svg":"stacked-black.svg",
 "logo-stacked-white.svg":"stacked-white.svg",
}
for target,source in FILES.items():
    shutil.copyfile(SOURCE/source,OUT/target)

def render(source,dest,width):
    svg=fitz.open(stream=source.read_bytes(),filetype="svg")
    pdf=fitz.open(stream=svg.convert_to_pdf(),filetype="pdf")
    p=pdf[0]; scale=width/p.rect.width
    p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=True).save(dest)
    pdf.close(); svg.close()

for color in ("","-black","-white"):
    for size in (256,512,1024):
        render(OUT/("logo"+color+".svg"),OUT/f"logo{color}-{size}.png",size)
    render(OUT/("logo-horizontal"+color+".svg"),OUT/("logo-horizontal"+color+".png"),1600)
    render(OUT/("logo-stacked"+color+".svg"),OUT/("logo-stacked"+color+".png"),800)

icons=OUT/"icons"; icons.mkdir(exist_ok=True)
for size in (16,20,24,28,32,48,64,128,256):
    for color in ("","-black","-white"):
        src="logo-small" if size<32 else "logo"
        render(OUT/(src+color+".svg"),icons/f"icon-{size}{color}.png",size)

shutil.copyfile(REPO/"design"/"logo-variants"/"fonts"/"manrope-OFL.txt",OUT/"Manrope-OFL.txt")
shutil.copyfile(REPO/"LICENSE",OUT/"LICENSE")
selection={
 "brand":"DeepSeek GenUI",
 "selected_variant":"02",
 "name":"Responsive Node",
 "name_zh":"交互节点",
 "date":"2026-11-02",
 "version":"1",
 "primary_color":"#4D6BFE",
 "wordmark_font":"Manrope 650",
 "source":"design/logo-variants/02-responsive-node",
 "asset_directory":"assets/branding/responsive-node-v1",
 "status":"selected; exported; application integration pending",
 "artwork":"Original geometry preserved; small-size optical versions retained",
}
(OUT/"selection.json").write_text(json.dumps(selection,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

# Native vector-derived artwork on a new presentation sheet.
im=Image.new("RGB",(1200,580),"#F2F4F8"); d=ImageDraw.Draw(im)
font_path=Path("C:/Windows/Fonts/msyh.ttc")
title=ImageFont.truetype(str(font_path),32)
sub=ImageFont.truetype(str(font_path),18)
label=ImageFont.truetype(str(font_path),20)
d.text((40,30),"DeepSeek GenUI",font=title,fill="#152137")
d.text((40,86),"02 / Responsive Node · 交互节点 · 已选定",font=sub,fill="#697386")
for x,color,caption,bg in [
 (40,"","DeepSeek 蓝  #4D6BFE","#FFFFFF"),
 (428,"-black","单色黑  #000000","#FFFFFF"),
 (816,"-white","暗色反白  #FFFFFF","#111A2B"),
]:
    d.rounded_rectangle((x,140,x+344,470),radius=18,fill=bg)
    logo=Image.open(OUT/f"logo{color}-256.png").resize((230,230),Image.Resampling.LANCZOS)
    im.paste(logo,(x+57,180),logo)
    d.text((x+24,428),caption,font=label,fill="#DCE3F0" if color=="-white" else "#152137")
d.text((40,516),"SVG · 透明 PNG · 16–256px 图标 · 横向 / 纵向组合",font=sub,fill="#697386")
im.save(OUT/"preview.png")

# Validate production files rather than changing application code.
for path in OUT.rglob("*.svg"):
    root=ET.parse(path).getroot()
    assert not any(e.tag.endswith("text") or e.tag.endswith("image") for e in root.iter()),path
for path in icons.glob("*.png"):
    size=int(path.stem.split("-")[1])
    icon=Image.open(path); assert icon.mode=="RGBA" and icon.size==(size,size)
    alpha=icon.getchannel("A"); assert alpha.getextrema()==(0,255)
    left,top,right,bottom=alpha.getbbox()
    assert left>0 and top>0 and right<size and bottom<size,(path.name,(left,top,right,bottom))

archive=OUT.parent/"deepseek-genui-responsive-node-v1.zip"
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
    for p in sorted(OUT.rglob("*")):
        if p.is_file(): z.write(p,p.relative_to(OUT.parent))
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
print(json.dumps({"selected":"02 / Responsive Node","svg":len(list(OUT.glob("*.svg"))),"icons":len(list(icons.glob("*.png"))),"assets":str(OUT),"archive":str(archive)},ensure_ascii=False))

