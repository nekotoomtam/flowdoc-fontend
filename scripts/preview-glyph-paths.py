import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

result = {}
for font_id, path, ids in json.load(sys.stdin):
    with TTFont(path) as font:
        glyph_set = font.getGlyphSet()
        order = font.getGlyphOrder()
        paths = {}
        for i in ids:
            pen = SVGPathPen(glyph_set)
            glyph_set[order[i]].draw(pen)
            paths[i] = pen.getCommands()
        result[font_id] = [font["head"].unitsPerEm, paths]
json.dump(result, sys.stdout, separators=(",", ":"))
