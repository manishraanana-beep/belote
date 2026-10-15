"""Cartes « épurées » de Belote Prestige : public/cards/<carte>.svg.

Usage : python3 scripts/build-cards-epure.py
Cartes numérales et As dessinés ici (vectoriel, symboles nets, index modernes) ;
Valet, Dame et Roi gardent les figures françaises traditionnelles de SVG-cards (LGPL,
assets/cards-source.svg) dans le même cadre et avec les mêmes index.
Aucun attribut style (compatible CSP).
"""
import copy, pathlib, re, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG, XL = "http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"
HREF = f"{{{XL}}}href"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XL)
W, H = 169.075, 244.64
RED, BLACK = "#c8102e", "#141414"
FONT = "Helvetica Neue, Helvetica, Arial, DejaVu Sans, sans-serif"
LABEL = {"J": "V", "Q": "D", "K": "R", "A": "A"}
# Symboles dessinés dans une boîte d'environ 20 × 21, centrés sur l'origine.
PIPS = {
    "H": '<path d="M0 9C-9.5 1.6-10.5-2.6-10.5-5.2-10.5-8.3-8-10-5.5-10-3-10-1-8.6 0-6.5 1-8.6 3-10 5.5-10 8-10 10.5-8.3 10.5-5.2 10.5-2.6 9.5 1.6 0 9Z"/>',
    "D": '<path d="M0-10.5C2.2-6.6 4.8-3.3 7.8 0 4.8 3.3 2.2 6.6 0 10.5-2.2 6.6-4.8 3.3-7.8 0-4.8-3.3-2.2-6.6 0-10.5Z"/>',
    "S": '<path d="M0-10.5C-9.4-3.4-10.4 0.6-10.4 3.1-10.4 6.2-8 7.9-5.5 7.9-3.4 7.9-1.6 6.9-0.8 5.4-1 7.8-2.2 9.4-4 10.5H4C2.2 9.4 1 7.8 0.8 5.4 1.6 6.9 3.4 7.9 5.5 7.9 8 7.9 10.4 6.2 10.4 3.1 10.4 0.6 9.4-3.4 0-10.5Z"/>',
    "C": '<circle cx="0" cy="-5.4" r="4.6"/><circle cx="-5.3" cy="2" r="4.6"/><circle cx="5.3" cy="2" r="4.6"/><circle cx="0" cy="0.4" r="2.6"/><path d="M-1 1.5C-1.1 5.4-2.3 8.6-4.2 10.5H4.2C2.3 8.6 1.1 5.4 1 1.5Z"/>',
}
# Positions des symboles (x, y) ; ceux de la moitié basse sont retournés.
L, C, R = 52, W / 2, W - 52
T, B = 52, H - 52
LAYOUT = {
    "7": [(L, T), (R, T), (C, 87), (L, H / 2), (R, H / 2), (L, B), (R, B)],
    "8": [(L, T), (R, T), (C, 87), (L, H / 2), (R, H / 2), (C, H - 87), (L, B), (R, B)],
    "9": [(L, T), (R, T), (L, 98), (R, 98), (C, H / 2), (L, H - 98), (R, H - 98), (L, B), (R, B)],
    "10": [(L, T), (R, T), (C, 75), (L, 98), (R, 98), (L, H - 98), (R, H - 98), (C, H - 75), (L, B), (R, B)],
}


def pip(suit, x, y, scale):
    flip = " rotate(180)" if y > H / 2 + 1 else ""
    return f'<g transform="translate({x:.2f} {y:.2f}) scale({scale}){flip}">{PIPS[suit]}</g>'


def corners(rank, suit, face=False):
    label = LABEL.get(rank, rank)
    size = 31 if label == "10" else 37
    spacing = ' letter-spacing="-1.5"' if label == "10" else ""
    bg = '<rect x="3" y="4" width="30" height="62" rx="5" fill="#fff"/>' if face else ""
    one = bg + f'<text x="18" y="36" font-size="{size}"{spacing}>{label}</text>{pip(suit, 18, 55, 0.85).replace(" rotate(180)", "")}'
    return f'<g font-family="{FONT}" font-weight="700" text-anchor="middle">{one}<g transform="rotate(180 {W / 2} {H / 2})">{one}</g></g>'


def frame():
    return f'<rect x="0.75" y="0.75" width="{W - 1.5:.3f}" height="{H - 1.5:.3f}" rx="10" fill="#fff" stroke="{BLACK}" stroke-width="1.5"/>'


# Figures traditionnelles reprises de la source SVG-cards.
tree = ET.parse(ROOT / "assets/cards-source.svg")
ids = {e.get("id"): e for e in tree.iter() if e.get("id")}
SNAME = {"S": "spade", "H": "heart", "C": "club", "D": "diamond"}
FNAME = {"J": "jack", "Q": "queen", "K": "king"}
INDEX_IDS = {"ace", "king", "queen", "jack"} | {f"n_{i}" for i in range(1, 11)}


def unstyle(el):
    for e in el.iter():
        style = e.attrib.pop("style", None)
        for decl in (style or "").split(";"):
            if ":" in decl:
                k, v = (x.strip() for x in decl.split(":", 1))
                if k in ("fill-opacity", "stroke-opacity") and float(v) > 1:
                    v = "1"
                e.set(k, v.replace("'", ""))
        for k in ("width", "height"):
            if e.tag == f"{{{SVG}}}use" and e.get(k) == "100%":
                del e.attrib[k]


def deps(el, out):
    for e in el.iter():
        ref = e.get(HREF)
        if ref and ref[1:] not in out:
            out[ref[1:]] = None
            deps(ids[ref[1:]], out)
    return out


def figure(rank, suit):
    src = copy.deepcopy(ids[f"{SNAME[suit]}_{FNAME[rank]}"])
    for parent in list(src.iter()):
        for child in list(parent):
            ref = (child.get(HREF) or "")[1:]
            small_suit = ref in SNAME.values() and "2.4" not in (child.get("transform") or "")
            if ref in INDEX_IDS or small_suit or ref == "base":
                parent.remove(child)
    need = deps(src, {})
    defs = "".join(ET.tostring(copy.deepcopy(ids[i]), encoding="unicode") for i in need)
    unstyle(src)
    for e in src.iter():
        if e.get("id") == f"{SNAME[suit]}_{FNAME[rank]}":
            del e.attrib["id"]
    body = ET.tostring(src, encoding="unicode")
    if defs:
        d = ET.fromstring(f'<defs xmlns="{SVG}" xmlns:xlink="{XL}">{defs}</defs>')
        unstyle(d)
        defs = "".join(ET.tostring(c, encoding="unicode") for c in d)
    return defs, body


out = ROOT / "public/cards"
for suit in "SHDC":
    color = RED if suit in "HD" else BLACK
    for rank in ["7", "8", "9", "10", "J", "Q", "K", "A"]:
        defs, art = "", ""
        if rank == "A":
            art = pip(suit, W / 2, H / 2, 3.1)
        elif rank in LAYOUT:
            art = "".join(pip(suit, x, y, 1.42) for x, y in LAYOUT[rank])
        else:
            defs, art = figure(rank, suit)
        svg = (f'<svg xmlns="{SVG}" xmlns:xlink="{XL}" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
               + (f"<defs>{defs}</defs>" if defs else "")
               + frame() + f'<g fill="{color}">{art}</g>' * (rank not in FNAME) + (art if rank in FNAME else "")
               + f'<g fill="{color}">{corners(rank, suit, rank in FNAME)}</g></svg>')
        svg = re.sub(r"ns0:|xmlns:ns0=\"[^\"]+\"|ns1:|xmlns:ns1=\"[^\"]+\"", lambda m: "xlink:" if m.group(0) == "ns1:" else "", svg)
        svg = re.sub(r">\s+<", "><", svg)
        (out / f"{rank}{suit}.svg").write_text(svg + "\n", encoding="utf-8")
print("32 cartes épurées générées dans", out)
