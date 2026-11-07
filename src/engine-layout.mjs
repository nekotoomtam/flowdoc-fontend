// The Engine owns line text and geometry. This adapter only maps its output
// back to offsets in the one editable value. It never computes page breaks.
export function mapLines(text, lines) {
  let cursor = 0;
  const mapped = lines.map((line, index) => {
    const start = text.indexOf(line.text, cursor);
    if (start < 0 || text.slice(cursor, start).trim()) {
      throw new Error('Engine text does not match the editable value');
    }
    const result = {...line, from: index === 0 ? 0 : start, to: start + line.text.length};
    cursor = result.to;
    return result;
  });
  if (text.slice(cursor).trim()) throw new Error('Engine text does not cover the editable value');
  for (let i = 0; i < mapped.length; i++) {
    mapped[i].to = i + 1 < mapped.length ? mapped[i + 1].from : text.length;
  }
  return mapped;
}

export function projectLayout(draw, sourceMap, request) {
  const rows = request.sections[0].data.parts[0].data.groups[0].members.map((m, member) => ({member, text:m.menu, lines:[]}));
  const pages = draw.pages.map((p, index) => {
    const staticText = [];
    for (const command of p.commands) {
      if (command.kind !== 'glyph-run') continue;
      const source = sourceMap[command.nodeId];
      const line = {page:index+1, text:command.text, ...command.bounds,
        fontSizePt:command.fontSizePt, lineHeightPt:command.lineHeightPt,
        baselineOffsetPt:command.baselineOffsetPt,
        weight:command.fontId.includes('000000000001')?300:400, color:command.color};
      if (source?.sourceId === 'v15' && source.areaEntryIndex === 0 && source.groupIndex === 0) {
        if (!rows[source.itemIndex]) throw new Error('Engine returned an unknown editable owner');
        rows[source.itemIndex].lines.push(line);
      } else staticText.push(line);
    }
    return {widthPt:p.widthPt,heightPt:p.heightPt,staticText,fills:p.fills??[],borders:p.borders??[]};
  });
  for (const row of rows) row.lines = mapLines(row.text, row.lines);
  return {pages,rows};
}
