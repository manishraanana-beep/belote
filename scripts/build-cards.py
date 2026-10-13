"""Génère public/cards/<carte>.svg à partir de assets/cards-source.svg (SVG-cards, LGPL).

Usage : python3 scripts/build-cards.py
Chaque carte devient un SVG autonome (seules les définitions utiles sont copiées),
sans attribut style (compatible CSP), avec des index français agrandis.
"""
import copy, pathlib, re, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG, XL = "http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"
HREF = f"{{{XL}}}href"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XL)
tree = ET.parse(ROOT / "assets/cards-source.svg")
ids = {e.get("id"): e for e in tree.iter() if e.get("id")}
SUITS = {"S": "spade", "H": "heart", "C": "club", "D": "diamond"}
RANKS = {"7": "7", "8": "8", "9": "9", "10": "10", "J": "jack", "Q": "queen", "K": "king", "A": "1"}
LABEL = {"J": "V", "Q": "D", "K": "R", "A": "A"}
SYMBOL = {"S": "♠", "H": "♥", "C": "♣", "D": "♦"}
INDEX_IDS = {"ace", "king", "queen", "jack"} | {f"n_{i}" for i in range(1, 11)}
RED = "#d0161f"


def unstyle(el):
    for e in el.iter():
        style = e.attrib.pop("style", None)
        for decl in (style or "").split(";"):
            if ":" in decl:
                k, v = (x.strip() for x in decl.split(":", 1))
                if k == "font-family":
                    v = v.replace("'", "")
                if k in ("fill-opacity", "stroke-opacity") and float(v) > 1:
                    v = "1"
                e.set(k, v)
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


def corner(rank, suit, red):
    fill = RED if red else "#111"
    label = LABEL.get(rank, rank)
    size = 29 if label == "10" else 37
    g = ET.Element("g", {"fill": fill, "font-family": "Georgia, DejaVu Serif, Times New Roman, serif",
                         "font-weight": "bold", "text-anchor": "middle"})
    ET.SubElement(g, "rect", {"x": "3", "y": "3", "width": "28", "height": "60", "rx": "5", "fill": "#fff"})
    t = ET.SubElement(g, "text", {"x": "17", "y": "35", "font-size": str(size)})
    if label == "10":
        t.set("letter-spacing", "-2")
    t.text = label
    s = ET.SubElement(g, "use", {HREF: f"#{SUITS[suit]}", "transform": "translate(17 51) scale(1.5)"})
    return g


out_dir = ROOT / "public/cards"
out_dir.mkdir(exist_ok=True)
for suit, sname in SUITS.items():
    for rank, rname in RANKS.items():
        src = copy.deepcopy(ids[f"{sname}_{rname}"])
        for parent in list(src.iter()):
            for child in list(parent):
                ref = (child.get(HREF) or "")[1:]
                small_suit = ref in SUITS.values() and "2.4" not in (child.get("transform") or "")
                if ref in INDEX_IDS or small_suit:
                    parent.remove(child)
        root = ET.Element("svg", {"viewBox": "0 0 169.075 244.64", "width": "169.075", "height": "244.64"})
        defs = ET.SubElement(root, "defs")
        need = deps(src, {SUITS[suit]: None})
        deps(ids[SUITS[suit]], need)
        for i in need:
            defs.append(copy.deepcopy(ids[i]))
        root.append(src)
        red = suit in "HD"
        for flip in (False, True):
            g = corner(rank, suit, red)
            if flip:
                g.set("transform", "rotate(180 84.5375 122.32)")
            root.append(g)
        unstyle(root)
        for e in root.iter():
            if e.get("id") == f"{sname}_{rname}":
                del e.attrib["id"]
        xml = ET.tostring(root, encoding="unicode")
        xml = re.sub(r">\s+<", "><", xml)
        (out_dir / f"{rank}{suit}.svg").write_text(xml + "\n", encoding="utf-8")
print("32 cartes générées dans", out_dir)
