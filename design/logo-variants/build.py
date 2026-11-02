"""Build the original SVG logo decision package. Python 3.12: fonttools, Pillow, PyMuPDF."""
from pathlib import Path
from functools import lru_cache
import html, json, urllib.request, xml.etree.ElementTree as ET
from html.parser import HTMLParser
from PIL import Image, ImageFont, ImageDraw
import fitz
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT=Path(__file__).resolve().parent
BLUE="#4D6BFE"; INK="#152137"; MUTED="#697386"; DARK="#111A2B"; WHITE="#FFFFFF"
FONTDIR=ROOT/"fonts"; FONTDIR.mkdir(exist_ok=True)
FONTS={
 "human":("sourcesans3","SourceSans3[wght].ttf",600),
 "geo":("manrope","Manrope[wght].ttf",650),
 "serif":("sourceserif4","SourceSerif4[opsz,wght].ttf",650),
 "mono":("ibmplexmono","IBMPlexMono-Medium.ttf",500),
 "geobold":("manrope","Manrope[wght].ttf",800),
 "serifbold":("sourceserif4","SourceSerif4[opsz,wght].ttf",800),
 "monobold":("ibmplexmono","IBMPlexMono-SemiBold.ttf",600)
}
for key,(family,filename,weight) in FONTS.items():
    source=FONTDIR/filename
    url="https://raw.githubusercontent.com/google/fonts/main/ofl/"+family+"/"+urllib.parse.quote(filename)
    if not source.exists():
        urllib.request.urlretrieve(url,source)
    lic=FONTDIR/(family+"-OFL.txt")
    if not lic.exists(): urllib.request.urlretrieve("https://raw.githubusercontent.com/google/fonts/main/ofl/"+family+"/OFL.txt",lic)
    target=FONTDIR/(key+"-instance.ttf")
    if not target.exists():
        font=TTFont(source)
        if "fvar" in font:
            axes={a.axisTag:(weight if a.axisTag=="wght" else 36 if a.axisTag=="opsz" else a.defaultValue) for a in font["fvar"].axes}
            font=instantiateVariableFont(font,axes,inplace=True)
        font.save(target)

@lru_cache(None)
def fontdata(key):
    path=FONTDIR/(key+"-instance.ttf")
    f=TTFont(path)
    return f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm, ImageFont.truetype(str(path),1000)

def lettering(text,key,size,color=INK,tracking=0):
    f,gs,cmap,upem,pil=fontdata(key)
    pieces=[]
    for i,ch in enumerate(text):
        # Prefix shaping supplies kerning; outline geometry remains independent of fonts at delivery.
        x=(pil.getlength(text[:i+1])-pil.getlength(ch))*size/1000+i*tracking
        glyph=cmap.get(ord(ch))
        if glyph:
            pen=SVGPathPen(gs); gs[glyph].draw(pen)
            pieces.append(f'<path d="{pen.getCommands()}" transform="translate({x:.4f} 0) scale({size/upem:.7f} {-size/upem:.7f})"/>')
    width=pil.getlength(text)*size/1000+max(0,len(text)-1)*tracking
    return '<g fill="'+color+'">'+''.join(pieces)+'</g>',width

def txt(s,x,y,size=14,key="human",color=INK,tracking=0):
    g,w=lettering(s,key,size,color,tracking)
    return f'<g transform="translate({x} {y})">{g}</g>'

def rect(x,y,w,h,fill,rx=0,stroke=None):
    st=f' stroke="{stroke}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{st}/>'
def group(s,x=0,y=0,scale=1):
    return f'<g transform="translate({x} {y}) scale({scale})">{s}</g>'
def svg(w,h,body,title="DeepSeek GenUI"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img"><title>{html.escape(title)}</title>{body}</svg>'
def save_svg(path,w,h,body,title="DeepSeek GenUI"):
    path.write_text(svg(w,h,body,title),encoding="utf-8")
def raster(source,dest,width=None,alpha=True):
    data=source.read_bytes()
    doc=fitz.open(stream=data,filetype="svg")
    pdf=fitz.open(stream=doc.convert_to_pdf(),filetype="pdf")
    p=pdf[0]; factor=(width/p.rect.width) if width else 1
    p.get_pixmap(matrix=fitz.Matrix(factor,factor),alpha=alpha).save(dest)
    doc.close(); pdf.close()

V=[
 dict(id="01",slug="surface-g",name="Surface G",cn="界面 G",architecture="字母符号 + 横向组合",font="human",type="Source Sans 3 / 600",approach="G 字母衍生",signal="以 GenUI 的 G 连接产品名与界面容器。",reject="不叠加光标、图表或星芒。",note="主推荐；字母和界面共享同一轮廓。"),
 dict(id="02",slug="responsive-node",name="Responsive Node",cn="交互节点",architecture="抽象图形 + 横向组合",font="geo",type="Manrope / 650",approach="几何抽象",signal="围绕操作节点组织响应式界面。",reject="不用卡通、动物和多层隐喻。",note="抽象品牌方向；较接近通用框选符号。"),
 dict(id="03",slug="dg-pair",name="DG Pair",cn="DG 组合字母",architecture="组合字母 + 横向组合",font="geo",type="Manrope / 650 wordmark + 800 monogram",approach="DG 首字母组合",signal="以 DeepSeek 与 GenUI 两个名称的首字母建立记忆。",reject="不把复杂 DG 硬塞进 16px。",note="32px 起保留 DG；16/28px 使用 D 字形。"),
 dict(id="04",slug="unfold",name="Unfold",cn="回答展开",architecture="几何图形 + 横向组合",font="human",type="Source Sans 3 / 600",approach="文字到界面的抽象动作",signal="两条回答线索展开为一个可用界面。",reject="不用完整网页截图表达功能。",note="功能含义最直接；适合项目介绍与商店展示。"),
 dict(id="05",slug="editorial",name="Editorial",cn="知识字标",architecture="衬线混排字标",font="serif",type="Source Sans 3 / 600 + Source Serif 4 / 650, opsz 36",approach="字标主导；G 字母作为缩略标",signal="突出学习、理解与工具辅助思考。",reject="不追逐常见 AI 星芒视觉。",note="大字标有个性；工具栏使用专用 G 缩略标。"),
 dict(id="06",slug="command",name="Command",cn="工具字标",architecture="等宽字标 + G_ 缩略标",font="mono",type="IBM Plex Mono / 500",approach="字标与字母缩略标",signal="直接、可操作、有工程工具感。",reject="不使用细线模拟终端窗口。",note="工程气质鲜明，面向普通学习用户稍冷。"),
 dict(id="07",slug="transition",name="Transition",cn="状态切换",architecture="抽象动作 + 横向组合",font="geo",type="Manrope / 650",approach="双状态与阶梯留白",signal="两种状态通过连续的留白衔接，表达操作带来的变化。",reject="不叠加独立按钮或光标。",note="本轮首选；实心轮廓与斜向留白形成记忆点。"),
 dict(id="08",slug="workspace",name="Workspace",cn="界面构成",architecture="模块图形 + 横向组合",font="human",type="Source Sans 3 / 600",approach="三块界面模块的几何归纳",signal="用一个稳定区域与两个可变模块，表达按问题组织界面。",reject="不描绘完整的网页控件。",note="界面含义直接；与通用布局图标的距离较近。"),
 dict(id="09",slug="joined-ui",name="Joined UI",cn="UI 连字",architecture="定制连字 + 横向组合",font="geo",type="Manrope / 650 + custom ui ligature",approach="由 UI 衍生的小写连字",signal="把界面的 UI 做成连为一体的简短标志。",reject="不套用 GU 双字母模板。",note="字母关联清楚；底部连接与 i 的方形点建立统一构造。"),
]

def base_symbol(v,color=BLUE,micro=False):
    n=v["id"]
    if n=="01":
        return f'<g fill="{color}"><path d="M68 16H36C24.95 16 16 24.95 16 36V68C16 79.05 24.95 88 36 88H68C79.05 88 88 79.05 88 68V52H54V66H72V68C72 70.21 70.21 72 68 72H36C33.79 72 32 70.21 32 68V36C32 33.79 33.79 32 36 32H68Z"/>{rect(76,16,12,16,color,2)}</g>'
    if n=="02":
        return f'<g fill="{color}"><path d="M72 16H36C24.95 16 16 24.95 16 36V72H32V36C32 33.79 33.79 32 36 32H72Z"/><path d="M32 88H68C79.05 88 88 79.05 88 68V32H72V68C72 70.21 70.21 72 68 72H32Z"/><circle cx="52" cy="52" r="12"/></g>'
    if n=="03":
        letters="D" if micro else "DG"
        g,w=lettering(letters,"geobold",82 if micro else 58,color,-2.2 if not micro else 0)
        return group(g,(104-w)/2,81 if micro else 74)
    if n=="04":
        return f'<g fill="{color}"><path d="M16 28H40C46 28 46 16 56 16H76Q88 16 88 28V76Q88 88 76 88H56C46 88 46 76 40 76H16V60H42C54 60 54 72 60 72H72V32H60C54 32 54 44 42 44H16Z"/>{rect(52,44,16,16,color,3)}</g>'
    if n=="05":
        g,w=lettering("G","serifbold" if micro else "serif",88 if micro else 83,color)
        return group(g,(104-w)/2,84 if micro else 82)
    if n=="07":
        return f'<g fill="{color}"><path d="M36 16H76Q88 16 88 28V34H52L32 54H16V36Q16 16 36 16Z"/><path d="M88 50H72L52 70H16V72Q16 88 32 88H68Q88 88 88 68Z"/></g>'
    if n=="08":
        return rect(16,16,24,72,color,7)+rect(52,16,36,24,color,7)+rect(52,52,36,36,color,7)
    if n=="09":
        return f'<g fill="{color}"><path d="M16 34H32V66Q32 72 38 72H42Q48 72 48 66V34H64V68Q64 88 44 88H36Q16 88 16 68Z"/>{rect(72,40,16,48,color,3)}{rect(48,72,40,16,color,3)}{rect(72,16,16,14,color,3)}</g>'
    g,w=lettering("G","monobold" if micro else "mono",81 if micro else 77,color)
    return group(g,(104-w)/2,76)+rect(60,79 if micro else 82,24,7 if micro else 9,color)

def symbol(v,color=BLUE,micro=False):
    s=base_symbol(v,color,micro)
    return group(s,-8*104/88,-8*104/88,104/88) if micro else s

def brand(v,color=INK,accent=BLUE,size=42):
    if v["id"]=="05":
        a,aw=lettering("DeepSeek","human",size*.83,color,-size*.005)
        b,bw=lettering("GenUI","serif",size,accent,-size*.014)
    else:
        key=v["font"]
        a,aw=lettering("DeepSeek",key,size,color,-size*.012 if key!="mono" else -size*.02)
        b,bw=lettering("GenUI"+("_" if v["id"]=="06" else ""),key,size,accent,-size*.012)
    gap=size*.28
    return a+group(b,aw+gap,0),aw+gap+bw

def primary(v,color=INK,accent=BLUE):
    if v["id"] in ("05","06"):
        g,w=brand(v,color,accent,54)
        return group(g,12,72),w+24,104
    g,w=brand(v,color,accent,42)
    return symbol(v,accent)+group(g,124,65),w+142,104

def stacked(v,color=INK,accent=BLUE):
    g,w=brand(v,color,accent,30)
    width=max(280,w+36)
    return group(symbol(v,accent),(width-104*1.35)/2,10,1.35)+group(g,(width-w)/2,192),width,222

for v in V:
    folder=ROOT/(v["id"]+"-"+v["slug"]); folder.mkdir(exist_ok=True)
    for suffix,c1,c2 in [("blue",INK,BLUE),("black","#000000","#000000"),("white",WHITE,WHITE)]:
        save_svg(folder/("symbol-"+suffix+".svg"),104,104,symbol(v,c2),v["name"]+" symbol")
        g,w,h=primary(v,c1,c2)
        save_svg(folder/("primary-"+suffix+".svg"),round(w,3),h,g,v["name"]+" primary")
        g,w,h=stacked(v,c1,c2)
        save_svg(folder/("stacked-"+suffix+".svg"),round(w,3),h,g,v["name"]+" stacked")
    save_svg(folder/"symbol-micro.svg",104,104,symbol(v,BLUE,True),v["name"]+" micro")
    save_svg(folder/"symbol-micro-black.svg",104,104,symbol(v,"#000000",True),v["name"]+" micro black")
    save_svg(folder/"symbol-micro-white.svg",104,104,symbol(v,WHITE,True),v["name"]+" micro white")
    raster(folder/"symbol-micro-black.svg",folder/"icon-16-black.png",16)
    raster(folder/"symbol-micro-white.svg",folder/"icon-16-white.png",16)
    raster(folder/"symbol-blue.svg",folder/"symbol-512.png",512)
    raster(folder/"primary-blue.svg",folder/"primary.png",1200)
    for size in (16,28,32,48,128):
        src=folder/("symbol-micro.svg" if size<32 else "symbol-blue.svg")
        raster(src,folder/f"icon-{size}.png",size)
    raster(folder/"symbol-black.svg",folder/"symbol-black.png",256)
    raster(folder/"symbol-white.svg",folder/"symbol-white.png",256)

# Four wordmark-only studies precede symbol selection.
T=[("T1","Humanist","human"),("T2","Geometric","geo"),("T3","Editorial","serif"),("T4","Engineered","mono")]
for tid,name,key in T:
    v=next(v for v in V if v["font"]==key)
    g,w=brand(v,INK,BLUE,54)
    save_svg(ROOT/(tid+"-wordmark.svg"),round(w+32,3),112,group(g,16,75),name+" wordmark")
    raster(ROOT/(tid+"-wordmark.svg"),ROOT/(tid+"-wordmark.png"),1200)

# Decision board: retain the first six and add three distinct constructions.
W,H=1800,1856
body=rect(0,0,W,H,"#F2F4F8")
body+=txt("DEEPSEEK GENUI",64,64,17,"geo",BLUE,2)
body+=txt("Nine directions. One product.",64,132,49,"geo",INK,-1)
body+=txt("Logo architecture review / 02 NOV 2026 / Cobalt only / Original SVG",66,172,18,"human",MUTED)
cw,ch=544,502
board_cards=[]
for i,v in enumerate(V):
    start=len(body)
    x=64+(i%3)*568; y=214+(i//3)*526
    body+=rect(x,y,cw,ch,WHITE,20)
    body+=txt(v["id"]+" / "+v["name"],x+28,y+43,21,"geo",INK)
    body+=txt(["LETTERFORM / LOCKUP","ABSTRACT / LOCKUP","MONOGRAM / LOCKUP","GEOMETRIC / LOCKUP","EDITORIAL / WORDMARK","MONO / WORDMARK","GESTURE / LOCKUP","MODULAR / LOCKUP","LIGATURE / LOCKUP"][i],x+28,y+71,12,"human",MUTED,1)
    if v["id"] not in ("05","06"):
        body+=group(symbol(v),x+(cw-104*1.7)/2,y+105,1.7)
        g,w=brand(v,INK,BLUE,33)
        body+=group(g,x+(cw-w)/2,y+335)
    else:
        a,aw=lettering("DeepSeek",v["font"] if v["id"]=="06" else "human",42,INK,-.5)
        b,bw=lettering("GenUI"+("_" if v["id"]=="06" else ""),v["font"],68,BLUE,-1)
        body+=group(a,x+(cw-aw)/2,y+175)
        body+=group(b,x+(cw-bw)/2,y+257)
        body+=txt("Primary wordmark / letterform fallback",x+28,y+335,16,"human",MUTED)
    body+=rect(x+28,y+369,cw-56,1,"#E7EAF0")
    body+=txt("16px",x+28,y+416,12,"human",MUTED)
    body+=group(symbol(v,BLUE,True),x+76,y+402,16/104)
    body+=txt("32px",x+112,y+416,12,"human",MUTED)
    body+=group(symbol(v),x+162,y+394,32/104)
    body+=group(symbol(v,"#000000"),x+278,y+391,40/104)
    body+=rect(x+358,y+382,116,60,DARK,10)
    body+=group(symbol(v,WHITE),x+396,y+392,40/104)
    body+=txt("MICRO / STANDARD / BLACK / REVERSE",x+28,y+467,12,"human",MUTED,.8)
    board_cards.append(body[start:])
body+=txt("New round: 07 Transition / 08 Workspace / 09 Joined UI",66,H-34,17,"human",INK)
save_svg(ROOT/"comparison.svg",W,H,body,"DeepSeek GenUI - nine logo architectures")
raster(ROOT/"comparison.svg",ROOT/"comparison.png",1800,False)
new_body=rect(0,0,1800,804,"#F2F4F8")
new_body+=txt("DEEPSEEK GENUI / ROUND 02",64,64,17,"geo",BLUE,2)
new_body+=txt("Three new constructions.",64,132,49,"geo",INK,-1)
new_body+=txt("State transition / Composed interface / UI ligature / Original SVG",66,172,18,"human",MUTED)
new_body+=group(''.join(board_cards[-3:]),0,-1052)
new_body+=txt("Round 02 recommendation: 07 Transition / Alternative: 09 Joined UI",66,770,17,"human",INK)
save_svg(ROOT/"comparison-new.svg",1800,804,new_body,"DeepSeek GenUI - three additional logo candidates")
raster(ROOT/"comparison-new.svg",ROOT/"comparison-new.png",1800,False)

# Actual raster sizes on a dedicated board, including magnified nearest-neighbor views.
small=Image.new("RGB",(1500,1224),"#F2F4F8"); d=ImageDraw.Draw(small)
ui=ImageFont.truetype(str(FONTDIR/"human-instance.ttf"),24)
ui_small=ImageFont.truetype(str(FONTDIR/"human-instance.ttf"),17)
d.text((48,34),"SMALL-SIZE REVIEW / NATIVE PIXELS + 8x INSPECTION",font=ui,fill=INK)
for i,v in enumerate(V):
    x=48+(i%3)*484; y=108+(i//3)*364
    d.rounded_rectangle((x,y,x+456,y+336),radius=16,fill="white")
    d.text((x+20,y+18),v["id"]+" / "+v["name"],font=ui,fill=INK)
    p=ROOT/(v["id"]+"-"+v["slug"])
    offset=24
    for size in (16,28,32):
        im=Image.open(p/f"icon-{size}.png")
        small.paste(im,(x+offset,y+76),im)
        d.text((x+offset,y+116),str(size)+"px",font=ui_small,fill=MUTED)
        offset+=112
    im=Image.open(p/"icon-16.png").resize((128,128),Image.Resampling.NEAREST)
    small.paste(im,(x+24,y+172),im)
    d.text((x+182,y+192),"16px at 8x",font=ui_small,fill=MUTED)
    d.text((x+182,y+226),"D fallback" if v["id"]=="03" else "Letterform" if v["id"] in ("05","06") else "Same geometry",font=ui_small,fill=INK)
small.save(ROOT/"small-size-review.png")
recent_small=Image.new("RGB",(1500,496),"#F2F4F8")
ImageDraw.Draw(recent_small).text((48,34),"ROUND 02 / NATIVE PIXELS + 8x INSPECTION",font=ui,fill=INK)
recent_small.paste(small.crop((0,836,1500,1172)),(0,108))
recent_small.save(ROOT/"small-size-new.png")

# Schematic applications for all six; construction specs go deeper for the shortlist.
for v in V:
    w,h=1600,1080; b=rect(0,0,w,h,"#F2F4F8")
    b+=txt(v["id"]+" / "+v["name"],56,67,34,"geo",INK,-.5)
    b+=txt("Schematic applications / header / toolbar / card / reverse / stitch planning",58,105,18,"human",MUTED)
    # 01 header
    b+=rect(56,140,1488,126,WHITE,14)
    pg,pw,ph=primary(v)
    b+=group(pg,84,155,.72)
    b+=txt("Overview",1115,213,18,"human",MUTED)+txt("Guide",1250,213,18,"human",MUTED)
    b+=rect(1362,177,148,46,BLUE,9)+txt("Get extension",1379,207,17,"human",WHITE)
    # 02 toolbar, exact sizes
    b+=rect(56,290,728,194,WHITE,14)+txt("BROWSER TOOLBAR / NATIVE SIZES",80,328,14,"human",MUTED,1)
    b+=rect(80,350,680,58,"#F2F4F8",9)+txt("chat.deepseek.com",104,387,18,"human",MUTED)
    b+=group(symbol(v,BLUE,True),658,371,16/104)+group(symbol(v),704,363,32/104)
    b+=txt("16px",650,447,14,"human",MUTED)+txt("32px",702,447,14,"human",MUTED)
    # 03 avatar + reverse
    b+=rect(808,290,736,194,DARK,14)
    b+=group(symbol(v,WHITE),842,324,1.12)
    g,gw=brand(v,WHITE,WHITE,30); b+=group(g,1016,390)
    b+=txt("DARK SURFACE / ONE-COLOR REVERSE",1016,437,12,"human","#A8B3C8",.5)
    # 04 business card
    b+=rect(56,508,728,430,WHITE,14)
    b+=txt("BUSINESS CARD / 85 x 55mm RATIO",80,548,14,"human",MUTED,1)
    b+=rect(148,574,544,352,"#FAFBFE",2, "#D8DDEA")
    g,gw,gh=primary(v); sc=min(476/gw,.78)
    b+=group(g,180,616,sc)
    b+=txt("Interactive answers.",180,797,27,"human",INK,-.4)
    b+=txt("Browser extension / Independent project",180,843,17,"human",MUTED)
    # 05 embroidery planning, not actual physical test
    b+=rect(808,508,736,430,WHITE,14)
    b+=txt("1.5 INCH PATCH / SINGLE-COLOR SCHEMATIC",832,548,14,"human",MUTED,.6)
    b+='<circle cx="1012" cy="724" r="133" fill="#EFF2F8" stroke="#D4DAE6" stroke-width="2"/>'
    b+=group(symbol(v,BLUE,True),922,634,180/104)
    b+=txt("38.1mm patch",1192,663,22,"human",INK)
    b+=txt("Use symbol or micro mark.",1192,711,16,"human",MUTED)
    b+=txt("Physical stitch test pending.",1192,744,16,"human",MUTED)
    b+=txt("Clear space: 0.25 x mark height.",1192,797,16,"human",MUTED)
    b+=txt("No stitch, foil or print proof implied.",1192,830,15,"human",MUTED)
    b+=txt("BLUE "+BLUE+" / BLACK #000000 / WHITE #FFFFFF / DARK "+DARK,58,1006,17,"mono",MUTED)
    folder=ROOT/(v["id"]+"-"+v["slug"])
    save_svg(folder/"applications.svg",w,h,b,v["name"]+" schematic applications")
    raster(folder/"applications.svg",folder/"applications.png",1600,False)

# Small interactive local gallery. All logo artwork uses outlined local SVGs.
cards=[]
for v in V:
    folder=v["id"]+"-"+v["slug"]
    cards.append(f'''<article id="v{v['id']}"><div class="meta">{v['id']} · {html.escape(v['architecture'])}</div>
<h2>{v['cn']} <small>{v['name']}</small></h2><div class="stage"><img class="primary" src="{folder}/primary-blue.svg" alt="{v['cn']} 主标志"></div>
<p>{v['signal']}</p><p class="muted">{v['note']}</p><div class="sizes"><span>实际像素</span><img src="{folder}/icon-16.png" width="16" height="16" alt="16px"><img src="{folder}/icon-28.png" width="28" height="28" alt="28px"><img src="{folder}/icon-32.png" width="32" height="32" alt="32px"><div class="reverse"><img src="{folder}/symbol-white.svg" width="40" height="40" alt="反白"></div></div>
<div class="links"><a href="{folder}/primary-blue.svg" download>主标志 SVG</a><a href="{folder}/symbol-blue.svg" download>符号 SVG</a><a href="{folder}/applications.png">应用预览</a></div>
<details><summary>查看应用与单色版本</summary><img class="apps" src="{folder}/applications.png" alt="页头、工具栏、反白、名片与刺绣规划示意"><div class="links"><a href="{folder}/primary-black.svg">单黑</a><a href="{folder}/primary-white.svg">反白</a><a href="{folder}/stacked-blue.svg">方形组合</a></div></details></article>''')
gallery='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek GenUI · Logo Review</title><style>
:root{font-family:Segoe UI,Microsoft YaHei,sans-serif;color:#152137;background:#f2f4f8}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1440px;margin:auto;padding:54px 32px}header{max-width:930px;margin-bottom:38px}.eyebrow{font-size:13px;letter-spacing:.15em;color:#4d6bfe;font-weight:700}h1{font-size:46px;letter-spacing:-.04em;line-height:1.2;margin:16px 0}p{line-height:1.8}nav{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0}a{color:#3655e9;text-decoration:none}nav a,.links a{border:1px solid #dce2ed;border-radius:8px;padding:8px 12px;font-size:13px;background:#fff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}article{background:#fff;padding:26px;border-radius:18px;border:1px solid #e4e8f0}.meta{font-size:12px;color:#697386}h2{font-size:23px;letter-spacing:-.02em}small{font-size:14px;color:#697386;margin-left:8px;font-weight:400}.stage{height:186px;background:#f8f9fc;display:flex;align-items:center;justify-content:center;border-radius:12px;padding:30px}.primary{width:100%;height:104px;object-fit:contain}.muted{font-size:13px;color:#697386}.sizes{display:flex;align-items:center;gap:22px;min-height:76px;border-top:1px solid #eceff4}.sizes span{color:#697386;font-size:12px}.reverse{padding:8px 22px;background:#111a2b;border-radius:8px}.links{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}details{margin-top:16px;font-size:13px}summary{cursor:pointer;color:#3655e9}.apps{width:100%;margin-top:16px}footer{margin-top:32px;color:#697386;font-size:13px;line-height:1.8}@media(max-width:850px){.grid{grid-template-columns:1fr}h1{font-size:34px}.wrap{padding:28px 18px}.sizes{gap:16px}}
</style><div class="wrap"><header><div class="eyebrow">DEEPSEEK GENUI / LOGO DESIGN REVIEW / 2026.11.02</div><h1>从一张图标，走向一套标志。</h1><p>六个候选覆盖字母符号、图文组合、组合字母与纯字标。保留蓝色，以生成界面和操作反馈为核心。优先比较整体架构，再选择需要精修的方向。</p><p><strong>建议短名单：01 界面 G、04 回答展开、05 知识字标。</strong>01 最均衡；04 产品含义更直接；05 带有学习与知识气质。</p></header><nav><a href="comparison.png">六案对比</a><a href="small-size-review.png">小尺寸检查</a><a href="../logo-variants.md">完整说明与构造规格</a></nav><main class="grid">'''+''.join(cards)+'''</main><footer>本轮为评审候选。SVG 字体已转轮廓；四套字体的源文件与 OFL 许可随附。应用为示意，实物刺绣、压印和商标近似检索尚待所选方向精修。<br>重建：python design/logo-variants/build.py（fonttools、Pillow、PyMuPDF）。</footer></div></html>'''
gallery=gallery.replace("六个候选","九个候选").replace('href="comparison.png">六案对比','href="comparison.png">九案对比')
gallery=gallery.replace("<nav>",'<nav><a href="comparison-new.png">新增三案</a><a href="../logo-variants-round2.md">新增方案说明</a>')
gallery=gallery.replace("</header>","<p>第二轮新增：07 状态切换、08 界面构成、09 UI 连字。新增三案中更推荐 07；09 提供字母连字方向。</p></header>")
gallery=gallery.replace("<header>",'<header><p style="padding:14px 18px;background:#e8edff;border-radius:10px;color:#304dd1"><strong>已选定：02 交互节点 / Responsive Node。</strong> <a href="../../assets/branding/responsive-node-v1/README.md">查看定稿资源</a></p>')
gallery=gallery.replace("建议短名单：","首轮评审建议（历史）：")
gallery=gallery.replace('<article id="v02">','<article id="v02" style="border:2px solid #4D6BFE"><div class="eyebrow">已选定 / SELECTED</div>')
(ROOT/"index.html").write_text(gallery,encoding="utf-8")
(ROOT/"variants.json").write_text(json.dumps(V,ensure_ascii=False,indent=2),encoding="utf-8")
class LocalLinks(HTMLParser):
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key in ("src","href") and value and not value.startswith(("https:","http:","#")):
                assert (ROOT/value).resolve().exists(),value
LocalLinks().feed(gallery)
# Structural and export checks; visual review is performed separately.
svgs=list(ROOT.rglob("*.svg"))
for path in svgs:
    tree=ET.parse(path)
    assert not any(e.tag.endswith("text") or e.tag.endswith("image") for e in tree.iter()),path
for v in V:
    p=ROOT/(v["id"]+"-"+v["slug"])
    for n in (16,28,32,48,128):
        im=Image.open(p/f"icon-{n}.png")
        assert im.size==(n,n) and im.mode=="RGBA"
        a=im.getchannel("A")
        assert a.getextrema()==(0,255)
        bounds=a.getbbox()
        assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<n and bounds[3]<n,(v["id"],n,bounds)
print(json.dumps({"variants":len(V),"outlined_svg":len(svgs),"preview":str(ROOT/"comparison.png"),"gallery":str(ROOT/"index.html")}))

