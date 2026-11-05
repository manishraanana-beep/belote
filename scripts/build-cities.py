#!/usr/bin/env python3
"""Génère les images des villes en tailles adaptées à l'écran : ville-<v>-740.webp (écran standard)
et ville-<v>-1100.webp (écran dense) à partir de ville-<v>-hd.webp (1481 px, écrans très denses).
Usage : python3 -I scripts/build-cities.py"""
from pathlib import Path
from PIL import Image
d = Path(__file__).resolve().parent.parent / "public" / "decor"
for f in sorted(d.glob("ville-*-hd.webp")):
    im = Image.open(f).convert("RGB")
    name = f.name[: -len("-hd.webp")]
    for w, q in ((740, 80), (1100, 80)):
        out = d / f"{name}-{w}.webp"
        im.resize((w, round(w * im.height / im.width)), Image.LANCZOS).save(out, "WEBP", quality=q, method=6)
        print(out.name, out.stat().st_size // 1024, "Ko (HD", f.stat().st_size // 1024, "Ko)")
