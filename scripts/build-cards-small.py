#!/usr/bin/env python3
"""Génère les cartes légères (200 px de large) à partir des cartes HD (400 px) : public/cards/<carte>-200.webp.
Usage : python3 -I scripts/build-cards-small.py   (puis augmenter le ?v= dans public/cards.js)"""
from pathlib import Path
from PIL import Image
d = Path(__file__).resolve().parent.parent / "public" / "cards"
tot = 0
for f in sorted(d.glob("*.webp")):
    if f.stem.endswith("-200"):
        continue
    im = Image.open(f).convert("RGBA")
    h = round(200 * im.height / im.width)
    out = d / f"{f.stem}-200.webp"
    im.resize((200, h), Image.LANCZOS).save(out, "WEBP", quality=82, method=6)
    tot += out.stat().st_size
print("cartes :", len(list(d.glob("*-200.webp"))), "· moyenne", tot // max(1, len(list(d.glob('*-200.webp')))), "octets")
