#!/usr/bin/env python3
"""Re-encode a (bilevel) multi-page TIFF as CCITT Group 4.

sharp/libvips cannot write Group 4, so generate-ocr-fixtures.mjs calls this
helper (PIL) as a post-processing step. Usage: g4_tiff.py <in.tif> <out.tif>
"""
import sys
from PIL import Image, ImageSequence

src, dst = sys.argv[1], sys.argv[2]
with Image.open(src) as im:
    pages = [f.convert("1") for f in ImageSequence.Iterator(im)]
pages[0].save(dst, save_all=True, append_images=pages[1:], compression="group4")
