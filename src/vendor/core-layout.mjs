// ../flowdoc-core/src/layout/formatLayout.ts
var FormatStop = class extends Error {
  constructor(reason, pending, completedNodeIds = []) {
    super(reason);
    this.reason = reason;
    this.pending = pending;
    this.completedNodeIds = completedNodeIds;
  }
  reason;
  pending;
  completedNodeIds;
};
function formatCursor(d, nodeId, kind, extra = {}) {
  const s = d.sourceMap[nodeId];
  return { kind, nodeId, sourceNodeId: s?.sourceId ?? nodeId, ...s?.groupId ? { groupId: s.groupId, groupIndex: s.groupIndex } : {}, ...s?.itemIndex === void 0 ? {} : { itemIndex: s.itemIndex }, ...s?.repeatId ? { repeatId: s.repeatId } : {}, ...extra };
}
function formatIdentity(f) {
  return { version: 1, areaId: f.areaId, areaEntryIndex: f.areaEntryIndex, areaFormatId: f.areaFormatId, format: f.format };
}
function formatWarning(f, code, details) {
  const base = { code, path: `areaFormats.${f.areaFormatId}.sizing`, sectionId: f.sectionId, action: "skipped" };
  const key = code === "FORMAT_CONTENT_OMITTED" ? "formatOmission" : code === "FORMAT_FRAME_NOT_SHOWN" ? "formatFrameOmission" : "formatImageOmission";
  const message = code === "FORMAT_CONTENT_OMITTED" ? "Format instance exceeded its fixed frame; remaining content was not shown" : code === "FORMAT_FRAME_NOT_SHOWN" ? "Format instance frame did not fit the current page and was not shown" : "Image frame exceeded printable page height and was not shown";
  return { ...base, message, [key]: { ...formatIdentity(f), ...details } };
}
function instanceForNode(d, id) {
  const s = d.sourceMap[id];
  return s?.areaId === void 0 ? void 0 : d.formatInstances?.find((f) => f.sectionId === s.sectionId && f.areaId === s.areaId && f.areaEntryIndex === s.areaEntryIndex && f.areaFormatId === s.areaFormatId);
}

// ../flowdoc-core/src/composition/resolvedDocument.ts
function toPt(length) {
  return length.unit === "mm" ? length.value * 72 / 25.4 : length.value;
}

// ../flowdoc-core/src/composition/linkContract.ts
var linkLabel = (value) => value.type === "url" ? value.value : value.text;

// ../flowdoc-core/src/fonts/types.ts
var FontError = class extends Error {
  constructor(code, path = "/font") {
    super("Requested font could not be used");
    this.code = code;
    this.path = path;
  }
  code;
  path;
};

// ../flowdoc-core/src/fonts/selection.ts
function fontIdForStyle(style, runtime) {
  if (runtime?.fontId) return runtime.fontId(style);
  if ("font" in style) throw new FontError(style.font.kind === "unselected" ? "FONT_NOT_SELECTED" : "FONT_FACE_UNAVAILABLE");
  return style.fontWeight === "bold" ? style.fontStyle === "italic" ? "font-bold-italic" : "font-bold" : style.fontStyle === "italic" ? "font-italic" : "font-regular";
}

// spike:prefixFit
async function tryPrefixFit() {
  return false;
}

// ../flowdoc-core/src/layout/measureText.ts
async function measureText(node, style, available, runtime, firstLineWidth = available) {
  let lineWidth = firstLineWidth;
  let raw = "", rawSpans = [];
  for (const c of node.children) {
    const start = raw.length;
    raw += c.type === "system-page-field" ? "" : c.type === "text" ? c.text : c.type === "line-break" ? "\n" : linkLabel(c);
    if (c.type === "url" || c.type === "link" || c.type === "reference") rawSpans.push({ id: c.id, start, end: raw.length, link: c });
  }
  const normalizedOffset = (offset) => raw.slice(0, offset).replace(/\r\n?/g, "\n").length;
  const spans = rawSpans.map((s) => ({ ...s, start: normalizedOffset(s.start), end: normalizedOffset(s.end) }));
  const id = node.id, epsilon2 = 1e-6, size = style.fontSize.value, lineHeight = style.lineHeightPt;
  const probe = runtime.spacingProbe?.lineBox?.(id, style);
  if (probe && (!Number.isFinite(probe.heightPt) || probe.heightPt <= 0 || !Number.isFinite(probe.baselineOffsetPt) || probe.baselineOffsetPt < 0 || probe.baselineOffsetPt > probe.heightPt)) throw new LayoutError(id, "Invalid spacing probe line box");
  const fontId = fontIdForStyle(style, runtime);
  if (available <= 0) throw new LayoutError(id, "No content width");
  const cache = /* @__PURE__ */ new Map();
  const shape = async (text3) => {
    if (!cache.has(text3)) {
      const native = await runtime.shape(text3, fontId, size);
      cache.set(text3, runtime.spacingProbe?.shapedText?.(id, text3, fontId, size, native) ?? native);
    }
    return cache.get(text3);
  };
  const extent = (s) => Math.max(s.glyphs.reduce((a, g) => a + g.advancePt, 0), s.inkRightPt ?? 0) - Math.min(0, s.inkLeftPt ?? 0);
  const lines = [];
  const emit = async (text3, sourceStart = 0) => {
    if (!text3) {
      lines.push({ heightPt: Math.max(lineHeight, probe?.heightPt ?? 0) });
      lineWidth = available;
      return;
    }
    const shaped = await shape(text3), advance = shaped.glyphs.reduce((a, g) => a + g.advancePt, 0);
    if (extent(shaped) > lineWidth + epsilon2) throw new LayoutError(id, "Text ink does not fit the configured line");
    const actualHeight = Math.max(lineHeight, shaped.ascentPt + shaped.descentPt, probe?.heightPt ?? 0);
    const baseline = runtime.spacingProbe?.baselineOffsetPt?.(id, style, actualHeight, shaped);
    if (baseline !== void 0 && (!Number.isFinite(baseline) || baseline < 0 || baseline > actualHeight)) throw new LayoutError(id, "Invalid spacing probe baseline");
    lines.push({ heightPt: actualHeight, occupiedWidthPt: extent(shaped), run: { nodeId: id, kind: "glyph-run", text: text3, fontId, fontSizePt: size, lineHeightPt: actualHeight, baselineOffsetPt: baseline ?? probe?.baselineOffsetPt ?? shaped.ascentPt + (actualHeight - shaped.ascentPt - shaped.descentPt) / 2, color: "000000", bounds: { xPt: -Math.min(0, shaped.inkLeftPt ?? 0), yPt: 0, widthPt: advance, heightPt: actualHeight }, glyphs: shaped.glyphs, ...spans.length ? { sourceStart, ...shaped.glyphInkBoundsPt ? { glyphInkBoundsPt: shaped.glyphInkBoundsPt } : {}, links: spans.filter((s) => s.start < sourceStart + text3.length && s.end > sourceStart) } : {} } });
    lineWidth = available;
  };
  const text2 = raw.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  let paragraphStart = 0;
  for (const paragraph of text2.split("\n")) {
    if (!paragraph) {
      await emit("");
      paragraphStart++;
      continue;
    }
    const breaks = [.../* @__PURE__ */ new Set([...await runtime.breaks(paragraph), paragraph.length])].sort((a, b) => a - b);
    let start = 0;
    while (start < paragraph.length) {
      let end = start;
      for (const boundary of breaks) {
        if (boundary <= start) continue;
        const text3 = paragraph.slice(start, boundary);
        if (await tryPrefixFit(runtime, text3, fontId, size, lineWidth, epsilon2) || extent(await shape(text3)) <= lineWidth + epsilon2) end = boundary;
        else break;
      }
      if (end === start) {
        const firstBreak = breaks.find((b) => b > start);
        for (const part of new Intl.Segmenter("th", { granularity: "grapheme" }).segment(paragraph.slice(start, firstBreak))) {
          const boundary = start + part.index + part.segment.length;
          const text3 = paragraph.slice(start, boundary);
          if (await tryPrefixFit(runtime, text3, fontId, size, lineWidth, epsilon2) || extent(await shape(text3)) <= lineWidth + epsilon2) end = boundary;
          else break;
        }
      }
      if (end === start) throw new LayoutError(id, "A whole grapheme cannot fit the content width");
      await emit(paragraph.slice(start, end), paragraphStart + start);
      start = end;
    }
    paragraphStart += paragraph.length + 1;
  }
  return lines;
}

// ../flowdoc-core/src/layout/textFlow.ts
var LayoutError = class extends Error {
  constructor(nodeId, message, sectionId, path) {
    super(message);
    this.nodeId = nodeId;
    this.sectionId = sectionId;
    this.path = path;
  }
  nodeId;
  sectionId;
  path;
  warnings;
  reason;
};

// ../flowdoc-core/src/composition/strokeStyle.ts
var TABLE_BORDER_SIDES = ["top", "right", "bottom", "left", "insideHorizontal", "insideVertical", "headerBottom"];
var widthPt = (l) => l.unit === "mm" ? l.value * 72 / 25.4 : l.value;
var strokeEnvelope = (s) => s.widthPt * (s.style === "double" ? 3 : 1);
var strokePaintProps = (s) => ({ widthPt: s.widthPt, color: s.color, ...s.style === "single" ? {} : { style: s.style } });
function resolveLineStroke(n) {
  return { style: n.props.lineStyle ?? "single", widthPt: n.props.thickness ? widthPt(n.props.thickness) : 0.5, color: n.props.color ?? "000000" };
}
function resolveTableStroke(t, side) {
  const p = t.props, s = p.borders?.[side] ?? (side === "headerBottom" ? p.borders?.insideHorizontal : void 0);
  return { style: s?.style ?? p.borderStyle ?? "single", widthPt: s?.width ? widthPt(s.width) : p.borderWidth ? widthPt(p.borderWidth) : 0.5, color: s?.color ?? p.borderColor ?? "000000" };
}
function legacyTableStrokeGeometry(t) {
  return !t.props.borders && [void 0, "single", "none"].includes(t.props.borderStyle) && Math.abs((t.props.borderWidth ? widthPt(t.props.borderWidth) : 0.5) - 0.5) < 1e-8;
}
function tableStrokeEnvelope(t) {
  const active = TABLE_BORDER_SIDES.filter((side) => side === "headerBottom" ? t.props.headerRowCount > 0 && t.rowIds.length > t.props.headerRowCount : side === "insideHorizontal" ? t.rowIds.length > t.props.headerRowCount + 1 : side === "insideVertical" ? t.columns.length > 1 : true);
  return Math.max(0, ...active.map((side) => resolveTableStroke(t, side)).filter((s) => s.style !== "none").map(strokeEnvelope));
}

// ../flowdoc-core/src/layout/line.ts
function measureRule(n, available) {
  const width = n.props.width ? toPt(n.props.width) : available, thickness = n.props.thickness ? toPt(n.props.thickness) : 0.5, before = n.props.spaceBefore ? toPt(n.props.spaceBefore) : 0, after = n.props.spaceAfter ? toPt(n.props.spaceAfter) : 0;
  if (![width, thickness, before, after].every(Number.isFinite) || width <= 0 || thickness <= 0 || before < 0 || after < 0 || width > available + 1e-6) throw new LayoutError(n.id, "Invalid horizontal line geometry");
  const stroke = resolveLineStroke(n), envelope = strokeEnvelope(stroke);
  return { offset: n.props.align === "right" ? available - width : n.props.align === "center" ? (available - width) / 2 : 0, width, thickness: envelope, before, height: before + envelope + after, color: stroke.color, stroke };
}

// ../flowdoc-core/src/template/pageNumbering.ts
function normalizeNumbering(s) {
  const n = s.numbering ?? { mode: s.role === "cover" ? "exclude" : "continue" };
  return { ...n, visibility: s.role === "cover" ? "hide" : n.visibility ?? "show", ...n.mode === "restart" ? { startAt: n.startAt ?? 1 } : {} };
}

// ../flowdoc-core/src/layout/systemPageCounting.ts
function assignSystemPageNumbers(document, draw) {
  if (![18, 19, 20].includes(document.nodeModelVersion))
    return;
  const sections = new Map(document.sections.map((s) => [s.sectionId, s])), seen = /* @__PURE__ */ new Set();
  let last = 0, total = 0;
  for (const page of draw.pages) {
    const s = sections.get(page.sectionId);
    if (!s)
      throw new LayoutError("page", "Unknown page Section", page.sectionId);
    const n = normalizeNumbering(s), first = !seen.has(s.sectionId);
    seen.add(s.sectionId);
    let current = null;
    if (n.mode !== "exclude") {
      current = first && n.mode === "restart" ? n.startAt : last + 1;
      if (!Number.isSafeInteger(current) || current < 1)
        throw new LayoutError(s.rootIds[0] ?? "page", "Page number exceeds safe integer", s.sectionId, "numbering");
      last = current;
      total++;
    }
    page.pageNumbering = { current, total: 0, visibility: page.pageRole === "cover" || page.pageRole === "blank" ? "hide" : n.visibility };
    page.countedPageNumber = current;
  }
  for (const page of draw.pages)
    page.pageNumbering.total = total;
}

// ../flowdoc-core/src/layout/measurePageFieldText.ts
async function measurePageFieldText(node, style, width, runtime) {
  const commands = [], slots = [];
  let x = 0, y = 0, serial = 0, pending = [];
  const newline = () => {
    x = 0;
    y += style.lineHeightPt;
  };
  const flush = async () => {
    if (!pending.length) return;
    const chunk = { ...node, children: pending };
    let lines;
    if (width - x < 1e-6) newline();
    try {
      lines = await measureText(chunk, style, width, runtime, width - x);
    } catch (e) {
      if (x === 0 || !(e instanceof LayoutError) || !/whole grapheme/.test(e.message)) throw e;
      newline();
      lines = await measureText(chunk, style, width, runtime);
    }
    for (const [i, line] of lines.entries()) {
      if (i) newline();
      if (line.run) {
        commands.push({ ...line.run, id: `field-static-${serial++}`, bounds: { ...line.run.bounds, xPt: x + line.run.bounds.xPt, yPt: y } });
        x += line.occupiedWidthPt ?? line.run.bounds.xPt + line.run.bounds.widthPt;
      }
    }
    pending = [];
  };
  for (const c of node.children) {
    if (c.type === "system-page-field") {
      await flush();
      const w = toPt(c.width);
      if (w > width + 1e-6) throw new LayoutError(node.id, "Page field slot exceeds band width", void 0, "children." + c.id);
      if (x + w > width + 1e-6) newline();
      slots.push({ nodeId: node.id, fieldId: c.id, field: c.field, xPt: x, yPt: y, widthPt: w, style });
      x += w;
    } else if (c.type === "line-break") {
      await flush();
      newline();
    } else pending.push(c);
  }
  await flush();
  return { heightPt: y + style.lineHeightPt, commands, slots };
}

// ../flowdoc-core/src/layout/pageBands.ts
function selectPageBands(modes, role, index) {
  const show = (mode = "all") => role === "body" && (mode === "all" || mode === "first" && index === 0 || mode === "continuation" && index > 0);
  return { header: show(modes.headerMode), footer: show(modes.footerMode) };
}
async function measurePageBand(b, styles, widthPt2, runtime, images) {
  const out = { borders: [], heightPt: 0, commands: [], images: [], pageFields: [], pageTexts: [], numberBlocks: /* @__PURE__ */ new Set() };
  let serial = 0;
  const stack = async (ids, x, y, width) => {
    let at = y;
    for (const id of ids) {
      const n = b.nodes[id];
      if (n.type === "columns") {
        const gap = n.props.gap ? toPt(n.props.gap) : 0, remaining = width - gap * (n.columns.length - 1), weight = n.columns.reduce((s2, c) => s2 + c.weight, 0);
        if (remaining <= 0 || !Number.isFinite(weight)) throw new LayoutError(id, "Columns exceed page band width");
        let cx = x, high = 0;
        for (const c of n.columns) {
          const cw = remaining * c.weight / weight;
          high = Math.max(high, await stack(c.childIds, cx, at, cw));
          cx += cw + gap;
        }
        at += high;
      } else if (n.type === "line") {
        const m = measureRule(n, width);
        if (m.stroke.style !== "none") {
          const inset = m.stroke.style === "dotted" ? m.stroke.widthPt / 2 : 0;
          if (inset && m.width <= inset * 2) throw new LayoutError(id, "Stroke exceeds page band line width");
          out.borders.push({ nodeId: id, x1Pt: x + m.offset + inset, x2Pt: x + m.offset + m.width - inset, y1Pt: at + m.before + m.thickness / 2, y2Pt: at + m.before + m.thickness / 2, ...strokePaintProps(m.stroke) });
        }
        at += m.height;
      } else if (n.type === "text-block" && n.props.pageFieldLayout === "compact") {
        out.numberBlocks.add(n.id);
        const style = styles[n.props.textStyleId];
        out.pageTexts.push({ node: n, style, xPt: x, yPt: at, widthPt: width });
        at += style.lineHeightPt;
      } else if (n.type === "text-block" && n.children.some((c) => c.type === "system-page-field")) {
        out.numberBlocks.add(n.id);
        const m = await measurePageFieldText(n, styles[n.props.textStyleId], width, runtime);
        for (const run of m.commands) out.commands.push({ ...run, id: `band-run-${serial++}`, bounds: { ...run.bounds, xPt: x + run.bounds.xPt, yPt: at + run.bounds.yPt } });
        for (const slot of m.slots) out.pageFields.push({ ...slot, xPt: x + slot.xPt, yPt: at + slot.yPt });
        at += m.heightPt;
      } else if (n.type === "text-block") {
        for (const line of await measureText(n, styles[n.props.textStyleId], width, runtime)) {
          if (line.run) out.commands.push({ ...line.run, id: `band-run-${serial++}`, bounds: { ...line.run.bounds, xPt: x + line.run.bounds.xPt + (n.props.textAlign === "center" ? (width - (line.occupiedWidthPt ?? 0)) / 2 : n.props.textAlign === "right" ? width - (line.occupiedWidthPt ?? 0) : 0), yPt: at } });
          at += line.heightPt;
        }
      } else {
        const fw = toPt(n.props.width), fh = toPt(n.props.height);
        if (fw > width + 1e-6) throw new LayoutError(id, "Image frame exceeds page band width");
        const image = Object.hasOwn(images, n.props.resourceId) ? images[n.props.resourceId] : void 0;
        if (image) {
          const scale = Math.min(fw / image.width, fh / image.height), w = image.width * scale, h = image.height * scale, dx = n.props.align === "right" ? width - fw : n.props.align === "center" ? (width - fw) / 2 : 0;
          out.images.push({ nodeId: id, resourceId: n.props.resourceId, xPt: x + dx + (fw - w) / 2, yPt: at + (fh - h) / 2, widthPt: w, heightPt: h });
        }
        at += fh;
      }
    }
    return at - y;
  };
  const measured = await stack(b.rootIds, 0, 0, widthPt2), minimum = styles[b.baseTextStyleId].lineHeightPt, s = b.sizing;
  out.heightPt = Math.max(measured, minimum, s?.mode === "content" && s.minHeight ? toPt(s.minHeight) : 0);
  const ceiling = s?.mode === "fixed" ? toPt(s.height) : s?.mode === "content" && s.maxHeight ? toPt(s.maxHeight) : Infinity;
  if (out.heightPt > ceiling + 1e-6) throw new LayoutError(b.rootIds[0] ?? "page-band", "Page band exceeds configured height");
  if (s?.mode === "fixed") out.heightPt = ceiling;
  return out;
}

// ../flowdoc-core/src/layout/fixedTextBlock.ts
async function measureFixedTextBlock(node, style, widthPt2, runtime) {
  const heightPt = toPt(node.props.height);
  const lines = node.children.length ? await measureText(node, style, widthPt2, runtime) : [];
  const used = lines.reduce((sum, line) => sum + line.heightPt, 0);
  if (used > heightPt + 1e-6) throw new LayoutError(node.id, "Text exceeds reserved height");
  const remaining = Math.max(0, heightPt - used);
  return { lines, heightPt, offsetPt: node.props.verticalAlign === "bottom" ? remaining : node.props.verticalAlign === "center" ? remaining / 2 : 0 };
}

// ../flowdoc-core/src/composition/tableGrid.ts
var TableGridError = class extends Error {
  constructor(nodeId, property) {
    super("Invalid table grid: " + property);
    this.nodeId = nodeId;
    this.property = property;
  }
  nodeId;
  property;
};
function resolveTableGrid(table, nodes) {
  const bad = (id, p) => {
    throw new TableGridError(id, p);
  };
  const cells = [];
  let explicit = false, implicit = false;
  table.rowIds.forEach((rid, row) => {
    const r = nodes[rid];
    if (r?.type !== "table-row") return bad(rid, "row");
    r.cellIds.forEach((id, index) => {
      const c = nodes[id];
      if (c?.type !== "table-cell") return bad(id, "cell");
      const props = c.props;
      const placed = ["columnIndex", "rowSpan", "colSpan"].some((key) => Object.hasOwn(props, key));
      if (placed) explicit = true;
      else implicit = true;
      const column = placed ? props.columnIndex : index, rs = props.rowSpan === void 0 ? 1 : props.rowSpan, cs = props.colSpan === void 0 ? 1 : props.colSpan;
      if (!Number.isSafeInteger(column) || column < 0 || !Number.isSafeInteger(rs) || rs < 1 || !Number.isSafeInteger(cs) || cs < 1) return bad(id, "span");
      if (column + cs > table.columns.length || row + rs > table.rowIds.length) return bad(id, "bounds");
      if (row < table.props.headerRowCount && row + rs > table.props.headerRowCount) return bad(id, "header");
      cells.push({ id, row, column, rowSpan: rs, colSpan: cs });
    });
  });
  if (explicit && implicit) bad(table.id, "mixed placement");
  let active = [];
  const starts = /* @__PURE__ */ new Map();
  for (const c of cells) {
    const list = starts.get(c.row) ?? [];
    list.push(c);
    starts.set(c.row, list);
  }
  for (let row = 0; row < table.rowIds.length; row++) {
    active = active.filter((c) => c.row + c.rowSpan > row);
    active.push(...starts.get(row) ?? []);
    active.sort((a, b) => a.column - b.column);
    let end = 0;
    for (const c of active) {
      if (c.column !== end) bad(c.id, c.column < end ? "overlap" : "hole");
      end = c.column + c.colSpan;
    }
    if (end !== table.columns.length) bad(table.rowIds[row], "coverage");
  }
  return { rowIds: table.rowIds, columnCount: table.columns.length, explicit, cells };
}

// ../flowdoc-core/src/layout/measureCellContent.ts
function resolveCellPadding(padding) {
  const side = (key) => padding?.[key] === void 0 ? 4 : toPt(padding[key]);
  return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
}
async function measureCellContent(d, childIds, contentWidth, runtime) {
  const items = [];
  for (const id of childIds) {
    const n = d.nodes[id];
    if (n?.type === "text-block") for (const measured of await measureText(n, d.styles[n.props.textStyleId], contentWidth, runtime)) {
      const remaining = contentWidth - (measured.occupiedWidthPt ?? 0), offset = n.props.textAlign === "center" ? remaining / 2 : n.props.textAlign === "right" ? remaining : 0;
      const line = offset && measured.run ? { ...measured, run: { ...measured.run, bounds: { ...measured.run.bounds, xPt: measured.run.bounds.xPt + offset } } } : measured;
      items.push({ kind: "text-line", nodeId: id, heightPt: line.heightPt, line });
    }
    else if (n?.type === "image") {
      const frameWidth = toPt(n.props.width), heightPt = toPt(n.props.height);
      if (frameWidth > contentWidth + 1e-6) throw new LayoutError(id, "Image frame exceeds cell content width");
      items.push({ kind: "image-frame", nodeId: id, heightPt, frameWidth, align: n.props.align ?? "left", resourceId: n.props.resourceId });
    } else throw new LayoutError(id, "Expected TextBlock or Image");
  }
  return items;
}

// ../flowdoc-core/src/layout/nativeTableProbe.ts
function nativeTableProbe(tableId, cell, runtime) {
  const box = runtime.spacingProbe?.nativeTableBox?.(tableId), padding = resolveCellPadding(cell.props.padding);
  if (box && (!Number.isFinite(box.borderPt) || box.borderPt < 0 || box.borderPt > 1)) throw new LayoutError(tableId, "Invalid native table border");
  if (box) {
    padding.top += box.borderPt / 2;
    padding.bottom += box.borderPt / 2;
  }
  const item = (v) => {
    if (!box?.quantizeTextToTwips || v.kind !== "text-line") return v;
    const heightPt = Math.round(v.heightPt * 20) / 20;
    if (heightPt <= 0) throw new LayoutError(v.nodeId, "Invalid native table line height");
    return { ...v, heightPt, line: { ...v.line, heightPt } };
  };
  return { padding, item };
}

// ../flowdoc-core/src/layout/cellTableFlow.ts
var eps = 1e-6;
async function cellTableFlow(d, t, runtime, s) {
  const grid = resolveTableGrid(t, d.nodes), widths = t.columns.map((c) => toPt(c.width));
  if (widths.some((w) => w <= 0) || widths.reduce((a, b) => a + b, 0) > s.availableWidth + eps) throw new LayoutError(t.id, "Table columns exceed available content width");
  const xs = [0];
  for (const w of widths) xs.push(xs.at(-1) + w);
  const labelIds = new Set((t.rowGroups ?? []).flatMap((g) => g.groupLabel ? [g.groupLabel.cellId] : []));
  const cells = [];
  for (const c of grid.cells) {
    const n = d.nodes[c.id];
    if (n?.type !== "table-cell") throw new LayoutError(c.id, "Expected cell");
    const probe = nativeTableProbe(t.id, n, runtime), padding = probe.padding, contentWidth = xs[c.column + c.colSpan] - xs[c.column] - padding.left - padding.right;
    if (Object.values(padding).some((v) => !Number.isFinite(v) || v < 0)) throw new LayoutError(c.id, "Invalid converted cell padding");
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) throw new LayoutError(c.id, "Cell padding leaves no content width");
    let offset = padding.top;
    const lines = [];
    for (const measured of await measureCellContent(d, n.childIds, contentWidth, runtime)) {
      const line = probe.item(measured);
      lines.push({ line, offset, drawn: false });
      offset += line.heightPt;
    }
    const cell = { ...c, padding, contentWidth, lines, fillColor: n.props.fillColor ?? (c.row < t.props.headerRowCount ? t.props.headerFillColor : void 0) };
    if (labelIds.has(c.id)) {
      const text2 = d.nodes[n.childIds[0]];
      if (text2?.type !== "text-block") throw new LayoutError(c.id, "Expected group label text");
      const continued = { ...text2, children: [...text2.children, { id: text2.id + "~group-label-continuation", type: "text", text: " (\u0E15\u0E48\u0E2D)" }] };
      let measured;
      const continuation = async () => measured ?? (measured = await measureCellContent({ ...d, nodes: { ...d.nodes, [text2.id]: continued } }, n.childIds, contentWidth, runtime)), first2 = lines.map((l) => l.line);
      cell.label = { first: first2, continuation, active: first2, shown: false, windowFrom: 0 };
      cell.lines = [];
    }
    cells.push(cell);
  }
  const headerCount = t.props.headerRowCount, headerCells = cells.filter((c) => c.row < headerCount);
  const body = cells.filter((c) => c.row >= headerCount).map((c) => ({ ...c, row: c.row - headerCount }));
  const labelsById = new Map(body.filter((c) => c.label).map((c) => [c.id, c]));
  const rowIds = t.rowIds.slice(headerCount);
  const rowPositions = new Map(rowIds.map((id, i) => [id, i]));
  const starts = (t.rowGroups ?? []).flatMap((group, index) => group.keepStart ? [{ group, index, start: rowPositions.get(group.prefixRowIds[0] ?? group.firstMemberRowId), member: rowPositions.get(group.firstMemberRowId), relaxed: false }] : []);
  const labelHeight = (c) => c.padding.top + c.label.active.reduce((sum, line) => sum + line.heightPt, 0) + c.padding.bottom;
  const cellsByRow = /* @__PURE__ */ new Map();
  for (const c of body) {
    const list = cellsByRow.get(c.row) ?? [];
    list.push(c);
    cellsByRow.set(c.row, list);
  }
  const omitOversizedImages = (list, capacity) => {
    for (const c of list) {
      let offset = c.padding.top;
      const retained = [];
      for (const item of c.lines) {
        if (item.line.kind === "image-frame" && item.line.heightPt + c.padding.top + c.padding.bottom > capacity + eps && s.omitImage?.(item.line.nodeId)) continue;
        retained.push({ ...item, offset });
        offset += item.line.heightPt;
      }
      c.lines = retained;
    }
  };
  omitOversizedImages(headerCells, Math.max(s.bottom - s.top, s.nextCapacity ?? 0));
  const headerHeight = headerCount ? Math.max(0, ...headerCells.map((c) => (c.lines.at(-1)?.offset ?? c.padding.top) + (c.lines.at(-1)?.line.heightPt ?? 0) + c.padding.bottom)) : 0;
  if (headerHeight > Math.max(s.bottom - s.top, s.nextCapacity ?? 0) + eps) {
    if (s.bounded) throw new FormatStop("height-limit", [formatCursor(d, t.id, "node", { nodeType: "table" })]);
    throw new LayoutError(t.id, "Header exceeds page content height");
  }
  const stroke = runtime.spacingProbe?.rowStrokePt?.(t.id) ?? 0;
  if (!Number.isFinite(stroke) || stroke < 0 || stroke > 1) throw new LayoutError(t.id, "Invalid spacing probe row stroke");
  if (stroke && (headerCount || body.some((c) => c.rowSpan !== 1 || c.label))) throw new LayoutError(t.id, "Spacing probe requires ordinary unmerged rows without headers");
  const rowSpace = rowIds.map(() => stroke);
  const geometry = () => {
    const heights = rowIds.map(() => 0), ordered = [...body].sort((a, b) => a.row + a.rowSpan - b.row - b.rowSpan || a.row - b.row || a.column - b.column);
    for (const c of ordered.filter((c2) => !c2.label && c2.rowSpan === 1)) heights[c.row] = Math.max(heights[c.row], (c.lines.at(-1)?.offset ?? c.padding.top) + (c.lines.at(-1)?.line.heightPt ?? 0) + c.padding.bottom);
    for (const c of ordered.filter((c2) => !c2.label && c2.rowSpan > 1)) {
      const need = (c.lines.at(-1)?.offset ?? c.padding.top) + (c.lines.at(-1)?.line.heightPt ?? 0) + c.padding.bottom, have = heights.slice(c.row, c.row + c.rowSpan).reduce((a, b) => a + b, 0);
      if (need > have) heights[c.row + c.rowSpan - 1] += need - have;
    }
    for (let i = 0; i < heights.length; i++) heights[i] += rowSpace[i];
    for (const c of ordered.filter((c2) => c2.label)) {
      const start = heights.slice(0, c.row).reduce((a, b) => a + b, 0), need = Math.max(0, c.label.windowFrom - start) + labelHeight(c), have = heights.slice(c.row, c.row + c.rowSpan).reduce((a, b) => a + b, 0);
      if (need > have) heights[c.row + c.rowSpan - 1] += need - have;
    }
    const ys = [0];
    for (const h of heights) ys.push(ys.at(-1) + h);
    return { heights, ys };
  };
  const paintedCells = /* @__PURE__ */ new Set();
  const paint = (list, ys, from2, to, at, sharedTop = false, header = false) => {
    const edges = /* @__PURE__ */ new Map();
    const edge = (axis, fixed, a, b) => {
      if (b - a < eps) return;
      const side = axis === "v" ? Math.abs(fixed - s.left) < eps ? "left" : Math.abs(fixed - s.left - xs.at(-1)) < eps ? "right" : "insideVertical" : Math.abs(fixed - at) < eps ? sharedTop ? "headerBottom" : "top" : Math.abs(fixed - (at + to - from2)) < eps ? header && body.length ? "headerBottom" : "bottom" : "insideHorizontal";
      const stroke2 = resolveTableStroke(t, side);
      if (stroke2.style === "none") return;
      const key = axis + ":" + fixed.toFixed(6), e = edges.get(key) ?? { axis, fixed, segments: [], stroke: stroke2 };
      e.segments.push([a, b]);
      edges.set(key, e);
    };
    for (const c of list) {
      const start = ys[c.row], end = ys[c.row + c.rowSpan], lo = Math.max(start, from2), hi = Math.min(end, to);
      if (hi - lo <= eps) continue;
      paintedCells.add(c.id);
      const x = s.left + xs[c.column], right = s.left + xs[c.column + c.colSpan], top = at + lo - from2, bottom = at + hi - from2;
      if (c.fillColor) s.fill?.(x, top, right - x, bottom - top, c.fillColor, c.id);
      if (!sharedTop || lo > from2 + eps) edge("h", top, x, right);
      edge("h", bottom, x, right);
      edge("v", x, top, bottom);
      edge("v", right, top, bottom);
      if (c.label) {
        let y = top + c.padding.top;
        for (const line of c.label.active) {
          s.emitItem(line, x + c.padding.left, y, c.contentWidth);
          y += line.heightPt;
        }
        c.label.shown = true;
      }
      for (const l of c.lines) {
        const y = start + l.offset;
        if (!l.drawn && y >= from2 - eps && y + l.line.heightPt <= to + eps) {
          s.emitItem(l.line, x + c.padding.left, at + y - from2, c.contentWidth);
          l.drawn = true;
        }
      }
    }
    for (const e of edges.values()) {
      e.segments.sort((a2, b2) => a2[0] - b2[0]);
      let [a, b] = e.segments[0];
      const emit = () => e.axis === "h" ? s.border(a, e.fixed, b, e.fixed, t.id, e.stroke) : s.border(e.fixed, a, e.fixed, b, t.id, e.stroke);
      for (const [lo, hi] of e.segments.slice(1)) {
        if (lo <= b + eps) b = Math.max(b, hi);
        else {
          emit();
          a = lo;
          b = hi;
        }
      }
      emit();
    }
  };
  const drawHeader = () => {
    for (const c of headerCells) for (const l of c.lines) l.drawn = false;
    paint(headerCells, [0, headerHeight], 0, headerHeight, s.y, false, true);
    s.y += headerHeight;
  };
  const fullBodyHeight = Math.max(s.bottom - s.top, s.nextCapacity ?? 0) - (t.props.repeatHeaderRows ? headerHeight : 0);
  omitOversizedImages(body, fullBodyHeight);
  let from = 0, first = true, pendingLabel;
  const stop = (reason = "height-limit") => {
    const unfinished = body.filter((c) => c.lines.some((l) => !l.drawn)), ys = geometry().ys;
    const row = Math.min(rowIds.length - 1, Math.max(0, ys.findLastIndex((y) => y <= from + eps)));
    const cursors = unfinished.filter((c) => c.row <= row && c.row + c.rowSpan > row).map((c) => {
      const item = c.lines.find((l) => !l.drawn).line, extra = { tableId: t.id, rowId: rowIds[c.row], cellId: c.id };
      return formatCursor(d, item.nodeId, item.kind === "image-frame" ? "image" : "text", { ...extra, ...item.kind === "text-line" ? { lineIndex: c.lines.filter((l) => l.line.nodeId === item.nodeId && l.drawn).length, ...item.line.run?.sourceStart === void 0 ? {} : { sourceOffset: item.line.run.sourceStart } } : {} });
    });
    if (pendingLabel) {
      const c = pendingLabel;
      const n = d.nodes[c.id];
      if (n?.type === "table-cell") cursors.unshift(formatCursor(d, n.childIds[0], "text", { tableId: t.id, rowId: rowIds[c.row], cellId: c.id }));
    }
    const actual = cursors.some((c) => c.kind === "image") ? "image-does-not-fit" : reason;
    const completedNodeIds = [...headerCells, ...body].flatMap((c) => {
      const cell = d.nodes[c.id];
      return cell?.type === "table-cell" && paintedCells.has(c.id) ? cell.childIds.filter((id) => c.lines.filter((l) => l.line.nodeId === id).every((l) => l.drawn)) : [];
    });
    throw new FormatStop(actual, cursors.length ? cursors : [formatCursor(d, t.id, "node", { nodeType: "table" })], completedNodeIds);
  };
  for (const c of body) if (!s.bounded && c.padding.top + c.padding.bottom > fullBodyHeight + eps) throw new LayoutError(c.id, "Cell padding exceeds printable page");
  if (!rowIds.length || geometry().ys.at(-1) <= eps) {
    if (s.y + headerHeight > s.bottom + eps) s.nextPage();
    if (headerCount) drawHeader();
    return;
  }
  pages: while (true) {
    let g = geometry();
    if (from >= g.ys.at(-1) - eps) break;
    for (const c of body) if (c.label && g.ys[c.row + c.rowSpan] > from + eps) {
      c.label.active = c.label.shown ? await c.label.continuation() : c.label.first;
      c.label.windowFrom = from;
    }
    g = geometry();
    pendingLabel = void 0;
    const hh = first || t.props.repeatHeaderRows ? headerHeight : 0, capacity = s.bottom - s.y - hh;
    const full = Math.max(s.bottom - s.top, s.nextCapacity ?? 0) - (t.props.repeatHeaderRows ? headerHeight : 0);
    for (const c of body) if (!s.bounded && c.label && g.ys[c.row + c.rowSpan] > from + eps && labelHeight(c) > full + eps) {
      const error = new LayoutError(c.id, "Group label cannot fit a usable page");
      error.reason = "group-label-does-not-fit";
      throw error;
    }
    for (const [i, id] of rowIds.entries()) {
      const r = d.nodes[id];
      if (!s.bounded && r?.type === "table-row" && !r.props.allowBreak && g.ys[i + 1] > from + eps && g.heights[i] > full + eps) throw new LayoutError(id, "Protected row exceeds page");
    }
    for (const c of body) for (const l of c.lines) if (!s.bounded && !l.drawn && l.line.heightPt + c.padding.top + c.padding.bottom > full + eps) throw new LayoutError(l.line.nodeId, l.line.kind === "image-frame" ? "Image frame cannot fit with table header and padding" : "Next whole line cannot fit with header");
    let cut = Math.min(g.ys.at(-1), from + capacity);
    const pending = body.flatMap((c) => c.lines.filter((l) => !l.drawn).map((l) => ({ start: g.ys[c.row] + l.offset, end: g.ys[c.row] + l.offset + l.line.heightPt + c.padding.bottom })));
    if (cut < g.ys.at(-1) - eps && pending.length && pending.every((l) => l.end <= cut + eps)) cut = Math.min(cut, Math.max(...pending.map((l) => l.start)));
    for (const c of labelsById.values()) {
      const lo = Math.max(from, g.ys[c.row]), target = lo + labelHeight(c);
      if (g.ys[c.row + c.rowSpan] <= from + eps || target > cut + eps) continue;
      let row = -1;
      for (let i = c.row; i < c.row + c.rowSpan; i++) if (g.ys[i + 1] > lo + eps && g.ys[i + 1] <= cut + eps) row = i;
      if (row >= 0 && g.ys[row + 1] < target - eps) {
        rowSpace[row] += target - g.ys[row + 1];
        continue pages;
      }
    }
    for (let i = 0; i < rowIds.length; i++) {
      const r = d.nodes[rowIds[i]];
      if (r?.type === "table-row" && !r.props.allowBreak && cut > g.ys[i] + eps && cut < g.ys[i + 1] - eps) cut = g.ys[i];
    }
    for (const entry of starts) {
      const start = g.ys[entry.start];
      if (entry.relaxed || start < from - eps || start >= cut - eps) continue;
      const row = d.nodes[rowIds[entry.member]];
      const label = entry.group.groupLabel ? labelsById.get(entry.group.groupLabel.cellId) : void 0;
      const firstHeight = Math.max(label ? labelHeight(label) : 0, row?.type === "table-row" && !row.props.allowBreak ? g.heights[entry.member] : Math.max(0, ...(cellsByRow.get(entry.member) ?? []).map((c) => c.padding.top + (c.lines[0]?.line.heightPt ?? 0) + c.padding.bottom)));
      const end = g.ys[entry.member] + firstHeight;
      if (cut >= end - eps) continue;
      if (s.bounded) {
        cut = start;
        break;
      }
      const nextHeader = t.props.repeatHeaderRows || first && start <= from + eps ? headerHeight : 0;
      const nextSpace = (s.nextCapacity ?? s.bottom - s.top) - nextHeader;
      if (end - start <= nextSpace + eps) {
        cut = start;
        break;
      }
      entry.relaxed = true;
      const source = d.sourceMap[t.id];
      s.warn?.({
        code: "ROW_GROUP_KEEP_START_RELAXED",
        path: `nodes.${t.id}.rowGroups[${entry.index}]`,
        nodeId: t.id,
        groupId: entry.group.groupId,
        groupIndex: entry.group.groupIndex,
        ...source ? { ...source.sectionId ? { sectionId: source.sectionId } : {}, ...source.origin === "authored" ? {} : { contentIndex: source.contentIndex, format: source.format } } : {},
        message: "Group start exceeds usable page capacity; keepStart relaxed for this instance"
      });
    }
    for (const c of body.filter((c2) => c2.label)) {
      const lo = Math.max(from, g.ys[c.row]), end = g.ys[c.row + c.rowSpan];
      if (end <= from + eps || lo >= cut - eps) continue;
      const height = labelHeight(c);
      const remaining = body.filter((v) => !v.label && v.row >= c.row && v.row < c.row + c.rowSpan).flatMap((v) => v.lines.filter((l) => !l.drawn).map((l) => g.ys[v.row] + l.offset + l.line.heightPt + v.padding.bottom));
      const required = Math.max(lo + height, remaining.length ? Math.min(...remaining) : lo);
      if (Math.min(cut, end) < required - eps) {
        cut = lo;
        pendingLabel = c;
        break;
      }
    }
    let paragraphCut = true;
    while (paragraphCut) {
      paragraphCut = false;
      for (const c of body) {
        const row = d.nodes[rowIds[c.row]];
        if (c.rowSpan !== 1 || c.label || row?.type !== "table-row" || !row.props.allowBreak) continue;
        const base = g.ys[c.row];
        for (let i = 0; i < c.lines.length; ) {
          const firstLine = c.lines[i], id = firstLine.line.nodeId;
          let end = i + 1;
          while (end < c.lines.length && c.lines[end].line.kind === "text-line" && c.lines[end].line.nodeId === id) end++;
          const paragraph = c.lines.slice(i, end);
          i = end;
          if (firstLine.line.kind !== "text-line" || !runtime.spacingProbe?.paragraphWidowOrphan?.(id)) continue;
          const remaining = paragraph.filter((l) => !l.drawn);
          const fitting = remaining.filter((l) => base + l.offset >= from - eps && base + l.offset + l.line.heightPt + c.padding.bottom <= cut + eps);
          if (!fitting.length || fitting.length === remaining.length) continue;
          let carry = -1;
          if (!paragraph.some((l) => l.drawn) && fitting.length === 1) carry = 0;
          else if (remaining.length - fitting.length === 1) carry = fitting.length - 1;
          if (carry < 0) continue;
          if (!paragraph.some((l) => l.drawn) && carry === 1) carry = 0;
          const minimum = remaining.slice(carry, carry + (carry === 0 && remaining.length === 3 ? 3 : 2));
          const need = minimum.reduce((h, l) => h + l.line.heightPt, 0) + c.padding.top + c.padding.bottom;
          if (need > full + eps) continue;
          const earlier = base + remaining[carry].offset + c.padding.bottom;
          if (earlier >= from - eps && earlier < cut - eps) {
            cut = Math.max(from, earlier);
            paragraphCut = true;
          }
        }
      }
    }
    const hasLine = pending.some((l) => l.start >= from - eps && l.end <= cut + eps);
    const startsHere = pending.some((l) => l.start < cut + eps);
    if (cut <= from + eps || !hasLine && (startsHere || hh > 0 && pending.length > 0)) {
      if (s.bounded) stop(rowIds.some((id, i) => {
        const r = d.nodes[id];
        return r?.type === "table-row" && !r.props.allowBreak && g.ys[i] <= from + eps && g.ys[i + 1] > from + eps;
      }) ? "unbreakable-item-does-not-fit" : "height-limit");
      if (s.y > s.top + eps || (s.nextCapacity ?? 0) > s.bottom - s.top + eps) {
        s.nextPage();
        continue;
      }
      throw new LayoutError(t.id, "Merged row made no progress");
    }
    let shifted = true;
    while (shifted) {
      shifted = false;
      for (const c of body) {
        const base = g.ys[c.row];
        const index = c.lines.findIndex((l) => !l.drawn && base + l.offset < cut + c.padding.top - eps && base + l.offset + l.line.heightPt + c.padding.bottom > cut + eps);
        if (index >= 0) {
          const delta = cut + c.padding.top - base - c.lines[index].offset;
          for (const l of c.lines.slice(index)) l.offset += delta;
          shifted = true;
          g = geometry();
        }
      }
    }
    let paintTo = cut;
    for (let row = rowIds.length - 1; row >= 0; row--) {
      const start = g.ys[row], end = g.ys[row + 1];
      if (start >= paintTo - eps || end <= from + eps) continue;
      if (start < from - eps) break;
      const active = body.filter((c) => c.row <= row && c.row + c.rowSpan > row);
      if (active.some((c) => !c.label && (c.row !== row || c.rowSpan !== 1))) break;
      if (active.some((c) => c.label && start - Math.max(from, g.ys[c.row]) < labelHeight(c) - eps)) break;
      const lines = active.filter((c) => !c.label).flatMap((c) => c.lines.map((l) => ({ l, y: start + l.offset })));
      if (!lines.length || lines.some(({ l, y }) => l.drawn || y >= from - eps && y + l.line.heightPt <= paintTo + eps)) break;
      paintTo = start;
    }
    if (hh) drawHeader();
    paint(body, g.ys, from, paintTo, s.y, hh > 0);
    s.y += cut - from;
    from = cut;
    first = false;
    if (from < g.ys.at(-1) - eps) {
      if (s.bounded) stop();
      s.nextPage();
    }
  }
  if (body.some((c) => c.lines.some((l) => !l.drawn))) throw new LayoutError(t.id, "Merged table left pending content");
}

// ../flowdoc-core/src/layout/tableStart.ts
async function tableStartHeight(d, t, runtime) {
  const grid = resolveTableGrid(t, d.nodes), widths = t.columns.map((c) => toPt(c.width));
  const count = Math.min(grid.rowIds.length, t.props.headerRowCount + 1), heights = Array.from({ length: count }, () => 0);
  for (const c of grid.cells.filter((c2) => c2.row < count)) {
    if (c.rowSpan !== 1) throw new LayoutError(t.id, "Table-start probe group requires unmerged rows");
    const n = d.nodes[c.id];
    if (n?.type !== "table-cell") throw new LayoutError(c.id, "Expected table-start cell");
    const probe = nativeTableProbe(t.id, n, runtime), pad = probe.padding, width = widths.slice(c.column, c.column + c.colSpan).reduce((a, b) => a + b, 0) - pad.left - pad.right;
    const items = (await measureCellContent(d, n.childIds, width, runtime)).map(probe.item), row = d.nodes[grid.rowIds[c.row]];
    const partial = c.row >= t.props.headerRowCount && row?.type === "table-row" && row.props.allowBreak;
    const first = items[0], second = items[1];
    const paragraphLines = first?.kind === "text-line" ? items.findIndex((item) => item.kind !== "text-line" || item.nodeId !== first.nodeId) : 0;
    const paragraphCount = paragraphLines < 0 ? items.length : paragraphLines;
    const minimum = first?.kind === "text-line" && second?.kind === "text-line" && first.nodeId === second.nodeId && runtime.spacingProbe?.paragraphWidowOrphan?.(first.nodeId) ? paragraphCount === 3 ? 3 : 2 : 1;
    const content = (partial ? items.slice(0, minimum) : items).reduce((sum, item) => sum + item.heightPt, 0);
    heights[c.row] = Math.max(heights[c.row], pad.top + content + pad.bottom);
  }
  const stroke = runtime.spacingProbe?.rowStrokePt?.(t.id) ?? 0;
  return heights.reduce((sum, h) => sum + h + stroke, 0);
}

// ../flowdoc-core/src/composition/contents.ts
var contentsTitle = (node) => node.children.map((c) => c.type === "system-page-field" ? "" : c.type === "text" ? c.text : c.type === "line-break" ? " " : linkLabel(c)).join("").replace(/\s+/gu, " ").trim();
function collectContents(document, sectionId) {
  const roots = document.sections.filter((s) => s.role !== "cover" && (sectionId === void 0 || s.sectionId === sectionId)).flatMap((s) => s.rootIds);
  const result = [], pending = [...roots].reverse();
  while (pending.length) {
    const id = pending.pop(), node = document.nodes[id];
    if (node.type === "text-block" && node.props.toc) {
      const title = contentsTitle(node);
      if (!title) throw new LayoutError(id, "Contents heading is empty");
      result.push({ nodeId: id, anchorId: node.props.anchorId, level: node.props.toc.level, title });
    } else if (node.type === "table") pending.push(...[...node.rowIds].reverse());
    else if (node.type === "table-row") pending.push(...[...node.cellIds].reverse());
    else if (node.type === "table-cell") pending.push(...[...node.childIds].reverse());
  }
  return result;
}

// ../flowdoc-core/src/layout/measureContents.ts
var CONTENTS_INDENT_PT = 12;
var CONTENTS_GAP_PT = 12;
var CONTENTS_NUMBER_WIDTH_PT = 36;
async function measureContents(node, entries, style, available, runtime) {
  const out = [];
  for (const [index, entry] of entries.entries()) {
    const xOffsetPt = (entry.level - 1) * CONTENTS_INDENT_PT, width = available - xOffsetPt - CONTENTS_GAP_PT - CONTENTS_NUMBER_WIDTH_PT;
    if (width <= 0) throw new LayoutError(node.id, "No contents title width remains");
    const text2 = { id: node.id, type: "text-block", role: { role: "paragraph" }, props: { textStyleId: node.props.textStyleId }, children: [{ id: `contents-title-${index}`, type: "reference", text: entry.title, target: entry.anchorId }] };
    const lines = await measureText(text2, style, width, runtime);
    for (const [i, line] of lines.entries()) out.push({ line, xOffsetPt, ...i === 0 ? { numberSlot: { anchorId: entry.anchorId, style, widthPt: CONTENTS_NUMBER_WIDTH_PT } } : {} });
  }
  return out;
}

// ../flowdoc-core/src/layout/documentFlow.ts
var epsilon = 1e-6;
async function documentFlow(d, runtime, images = {}, bounds) {
  const warnings = [];
  const omittedNodeIds = /* @__PURE__ */ new Set();
  let fixed;
  const pending = (id, kind, extra = {}) => formatCursor(d, id, kind, extra);
  try {
    let widthPt2 = 0, heightPt = 0, left = 0, top = 0, bottom = 0, available = 0, innerTop = 0, innerBottom = 0;
    const limit = () => fixed?.end ?? bottom;
    let modes = {}, bands = {};
    let activeBands = {};
    const bandCache = /* @__PURE__ */ new Map();
    const setPage = (page) => {
      const [w, h] = page.orientation === "portrait" ? [210, 297] : [297, 210];
      widthPt2 = w * 72 / 25.4;
      heightPt = h * 72 / 25.4;
      left = toPt(page.margin.left);
      top = toPt(page.margin.top);
      bottom = heightPt - toPt(page.margin.bottom);
      available = widthPt2 - left - toPt(page.margin.right);
    };
    setPage(d.book.page);
    innerTop = top;
    innerBottom = bottom;
    let sectionId, sectionPageIndex = 0, cover = false, activeNode = "";
    let pageRole = "body";
    const contentsSlots = [];
    const contentsById = /* @__PURE__ */ new Map();
    const contentsByScope = /* @__PURE__ */ new Map();
    for (const id of d.rootIds) {
      const node = d.nodes[id];
      if (node?.type !== "table-of-contents") continue;
      const owner = node.props.scope?.kind === "section" ? d.sourceMap[id].sectionId : void 0;
      const key = owner === void 0 ? "document" : "section:" + owner;
      if (!contentsByScope.has(key)) contentsByScope.set(key, collectContents(d, owner));
      contentsById.set(id, contentsByScope.get(key));
    }
    const pageTexts = [];
    const pageFieldSlots = [];
    let hideNumbers = false;
    const pages = [];
    let current, y = top, serial = 0;
    let imagePlacements = 0;
    const addImage = (image) => {
      bounds?.signal?.throwIfAborted();
      if (bounds && imagePlacements >= (bounds.maxImagePlacements ?? 1e4)) throw new LayoutError(image.nodeId, "Image placement limit exceeded", sectionId);
      imagePlacements++;
      current.images ??= [];
      current.images.push(image);
    };
    const bandRegion = (kind) => {
      const p = activeBands[kind]?.placement;
      return p ? { left: toPt(p.left), width: widthPt2 - toPt(p.left) - toPt(p.right), edge: kind === "header" ? toPt(p.offset) : heightPt - toPt(p.offset) } : { left, width: available, edge: kind === "header" ? innerTop : innerBottom };
    };
    const geometry = (index) => {
      const shown = selectPageBands(modes, pageRole, index), h = shown.header ? bands.header : void 0, f = shown.footer ? bands.footer : void 0;
      const hy = bandRegion("header").edge, fy = bandRegion("footer").edge - (f?.heightPt ?? 0);
      for (const [kind, m, at] of [["header", h, hy], ["footer", f, fy]])
        if (m && (at < 0 || at + m.heightPt > heightPt + epsilon))
          throw new LayoutError(activeBands[kind]?.rootIds[0] ?? activeNode, "Page band exceeds physical page", sectionId, kind + ".placement");
      const hg = activeBands.header?.gap ? toPt(activeBands.header.gap) : 0, fg = activeBands.footer?.gap ? toPt(activeBands.footer.gap) : 0;
      const probeTop = runtime.spacingProbe?.bodyTopPt?.(sectionId);
      if (probeTop !== void 0 && (!Number.isFinite(probeTop) || probeTop < 0 || probeTop >= heightPt)) throw new LayoutError(activeNode, "Invalid spacing probe body top");
      const nt = Math.max(h ? Math.max(innerTop, hy + h.heightPt + hg) : innerTop, probeTop ?? 0);
      const probeBottom = runtime.spacingProbe?.bodyBottomPt?.(sectionId);
      if (probeBottom !== void 0 && (!Number.isFinite(probeBottom) || probeBottom <= nt || probeBottom > heightPt)) throw new LayoutError(activeNode, "Invalid spacing probe body bottom");
      const nb = Math.min(f ? Math.min(innerBottom, fy - fg) : innerBottom, probeBottom ?? heightPt);
      if (Math.max((h ? h.heightPt + hg : 0) + (f ? f.heightPt + fg : 0), nt - innerTop + innerBottom - nb) > (innerBottom - innerTop) * 0.4 + epsilon)
        throw new LayoutError((h ? activeBands.header : activeBands.footer)?.rootIds[0] ?? activeNode, "Page bands exceed 40 percent of inner page height", sectionId, (h ? "header" : "footer") + ".sizing");
      return { top: nt, bottom: nb, h, f, hy, fy };
    };
    const nextPage = () => {
      bounds?.signal?.throwIfAborted();
      if (bounds && pages.length >= bounds.maxPages) throw new LayoutError(activeNode, "Page limit exceeded", sectionId);
      if (fixed) throw new FormatStop("height-limit", [pending(activeNode, "node", { nodeType: d.nodes[activeNode]?.type ?? "table" })]);
      if (cover && sectionPageIndex > 0)
        throw new LayoutError(activeNode, "Cover exceeds one page");
      const g = geometry(sectionPageIndex);
      top = g.top;
      bottom = g.bottom;
      current = { ...{ pageRole }, widthPt: widthPt2, heightPt, backgroundColor: "FFFFFF", commands: [], ...sectionId === void 0 ? {} : { sectionId, sectionPageIndex: sectionPageIndex++ } };
      pages.push(current);
      y = top;
      for (const [kind, m, at] of [["header", g.h, g.hy], ["footer", g.f, g.fy]]) {
        if (!m)
          continue;
        if (m.borders.length) {
          current.borders ??= [];
          for (const b of m.borders)
            current.borders.push({ ...b, x1Pt: bandRegion(kind).left + b.x1Pt, x2Pt: bandRegion(kind).left + b.x2Pt, y1Pt: at + b.y1Pt, y2Pt: at + b.y2Pt });
        }
        for (const run of m.commands)
          if (!hideNumbers || !m.numberBlocks.has(run.nodeId))
            current.commands.push({ ...run, id: `${kind}-${pages.length}-${run.id}`, bounds: { ...run.bounds, xPt: bandRegion(kind).left + run.bounds.xPt, yPt: at + run.bounds.yPt } });
        if (!hideNumbers)
          for (const slot of m.pageFields)
            pageFieldSlots.push({ ...slot, pageIndex: pages.length - 1, sectionId, xPt: bandRegion(kind).left + slot.xPt, yPt: at + slot.yPt });
        if (!hideNumbers)
          for (const t of m.pageTexts)
            pageTexts.push({ ...t, pageIndex: pages.length - 1, sectionId, xPt: bandRegion(kind).left + t.xPt, yPt: at + t.yPt });
        if (m.images.length) {
          for (const image of m.images)
            addImage({ ...image, xPt: bandRegion(kind).left + image.xPt, yPt: at + image.yPt });
        }
      }
    };
    const ensureHeight = (height, id, cursor = pending(id, "node", { nodeType: d.nodes[id]?.type ?? "text-block" })) => {
      if (fixed && y + height > limit() + epsilon) throw new FormatStop(cursor.kind === "image" ? "image-does-not-fit" : "height-limit", [cursor]);
      if (y + height > bottom + epsilon)
        nextPage();
      if (height > bottom - top + epsilon)
        throw new LayoutError(id, "Item exceeds page content height");
    };
    const emitLine = (line, x, at) => {
      if (line.run)
        current.commands.push({ ...line.run, id: `run-${serial++}`, bounds: { ...line.run.bounds, xPt: x + line.run.bounds.xPt, yPt: at } });
    };
    const measureBlock = async (id, width) => {
      const n = d.nodes[id];
      if (n?.type !== "text-block")
        throw new LayoutError(id, "Expected a TextBlock");
      return measureText(n, d.styles[n.props.textStyleId], width, runtime);
    };
    const table = async (t) => {
      const bounded = !!fixed;
      if (bounded) y += 0.25;
      {
        await cellTableFlow(d, t, runtime, {
          bounded,
          omitImage(nodeId) {
            const f = instanceForNode(d, nodeId);
            if (fixed || f?.sizing.mode !== "auto") return false;
            warnings.push(formatWarning(f, "FORMAT_IMAGE_NOT_SHOWN", { reason: "image-exceeds-page", pending: [pending(nodeId, "image")] }));
            omittedNodeIds.add(nodeId);
            return true;
          },
          warn(issue2) {
            warnings.push(issue2);
          },
          get top() {
            return bounded ? fixed.start + 0.25 : top;
          },
          get bottom() {
            return bounded ? limit() - 0.25 : limit();
          },
          get nextCapacity() {
            if (fixed) return 0;
            const g = geometry(sectionPageIndex);
            return g.bottom - g.top;
          },
          left,
          availableWidth: available,
          get y() {
            return y;
          },
          set y(v) {
            y = v;
          },
          nextPage,
          fill(xPt, yPt, widthPt3, heightPt2, color, nodeId) {
            current.fills ??= [];
            current.fills.push({ xPt, yPt, widthPt: widthPt3, heightPt: heightPt2, color, nodeId });
          },
          emitItem(item, x, at, width) {
            if (item.kind === "text-line") {
              emitLine(item.line, x, at);
              return;
            }
            const image = Object.hasOwn(images, item.resourceId) ? images[item.resourceId] : void 0;
            if (!image)
              return;
            const fw = item.frameWidth, fh = item.heightPt, scale = Math.min(fw / image.width, fh / image.height), iw = image.width * scale, ih = image.height * scale;
            const frameLeft = x + (item.align === "right" ? width - fw : item.align === "center" ? (width - fw) / 2 : 0);
            addImage({ nodeId: item.nodeId, resourceId: item.resourceId, xPt: frameLeft + (fw - iw) / 2, yPt: at + (fh - ih) / 2, widthPt: iw, heightPt: ih });
          },
          border(x1Pt, y1Pt, x2Pt, y2Pt, nodeId, stroke = resolveTableStroke(t, "insideHorizontal")) {
            if (!legacyTableStrokeGeometry(t)) {
              const half = tableStrokeEnvelope(t) / 2, minX = bounded ? left : 0, maxX = bounded ? left + available : current.widthPt, minY = bounded ? fixed.start : 0, maxY = bounded ? limit() : current.heightPt;
              if (maxX - minX < half * 2 || maxY - minY < half * 2) throw new LayoutError(nodeId, "Stroke exceeds available frame");
              x1Pt = Math.max(minX + half, Math.min(maxX - half, x1Pt));
              x2Pt = Math.max(minX + half, Math.min(maxX - half, x2Pt));
              y1Pt = Math.max(minY + half, Math.min(maxY - half, y1Pt));
              y2Pt = Math.max(minY + half, Math.min(maxY - half, y2Pt));
              if (Math.hypot(x2Pt - x1Pt, y2Pt - y1Pt) <= epsilon) throw new LayoutError(nodeId, "Styled stroke does not fit available frame");
            } else if (bounded) {
              x1Pt = Math.max(left + 0.25, Math.min(left + available - 0.25, x1Pt));
              x2Pt = Math.max(left + 0.25, Math.min(left + available - 0.25, x2Pt));
            }
            current.borders ??= [];
            current.borders.push({ x1Pt, y1Pt, x2Pt, y2Pt, nodeId, ...strokePaintProps(stroke) });
          }
        });
        if (bounded) y += 0.25;
        return;
      }
    };
    const sections = d.sections;
    for (const section of sections) {
      if (!section.rootIds.some((id) => d.nodes[id]?.type !== "page-break" && (d.nodes[id]?.type !== "table-of-contents" || contentsById.get(id).length > 0)) && !d.formatInstances?.some((f) => f.sectionId === section.sectionId && f.sizing.mode === "fixed") && !(section.role === "cover" || section.sourceKind === "blank"))
        continue;
      hideNumbers = "numbering" in section && section.numbering?.visibility === "hide";
      sectionId = section.sectionId;
      sectionPageIndex = 0;
      cover = section.role === "cover";
      pageRole = cover ? "cover" : section.sourceKind === "blank" ? "blank" : "body";
      setPage(section.page);
      innerTop = top;
      innerBottom = bottom;
      modes = section;
      bands = {};
      activeBands = section;
      if (pageRole === "body")
        for (const k of ["header", "footer"]) {
          const b = activeBands[k];
          if (!b || modes[k === "header" ? "headerMode" : "footerMode"] === "none")
            continue;
          const region = bandRegion(k);
          if (region.width <= 0)
            throw new LayoutError(b.rootIds[0] ?? "page-band", "Page band has no available width", sectionId, k + ".placement");
          const key = sectionId + ":" + k + ":" + region.width;
          let m = bandCache.get(key);
          if (!m) {
            try {
              m = await measurePageBand(b, d.styles, region.width, runtime, images);
            } catch (e) {
              if (e instanceof LayoutError)
                throw new LayoutError(e.nodeId, e.message, sectionId, k + ".nodes." + e.nodeId + (e.path ? "." + e.path : ""));
              throw e;
            }
            bandCache.set(key, m);
          }
          bands[k] = m;
        }
      nextPage();
      let pendingBreak = false;
      let previousRoot;
      const renderRoot = async (id) => {
        const previous = previousRoot;
        previousRoot = id;
        activeNode = id;
        const n = d.nodes[id];
        if (n?.type === "page-break") {
          if (fixed) throw new FormatStop("explicit-page-break", [pending(id, "node", { nodeType: "page-break" })]);
          pendingBreak = true;
          return;
        }
        if (n?.type === "table" && !n.rowIds.length)
          return;
        const contents = n?.type === "table-of-contents" ? await measureContents(n, contentsById.get(id), d.styles[n.props.textStyleId], available, runtime) : void 0;
        if (contents && !contents.length)
          return;
        if (pendingBreak) {
          if (y > top + epsilon)
            nextPage();
          pendingBreak = false;
        }
        if (!fixed && n?.type === "text-block" && n.props.toc && runtime.spacingProbe?.keepTableStart?.(id)) {
          const index = section.rootIds.indexOf(id), next = section.rootIds.slice(index + 1, index + 3), prefix = [id];
          let t = d.nodes[next[0]];
          if (t?.type === "text-block" && !t.props.toc && d.nodes[next[1]]?.type === "table") {
            prefix.push(t.id);
            t = d.nodes[next[1]];
          }
          if (t?.type === "table" && t.rowIds.length) {
            let required = await tableStartHeight(d, t, runtime);
            for (const p of prefix) required += (await measureBlock(p, available)).reduce((sum, line) => sum + line.heightPt, 0);
            const full = geometry(sectionPageIndex).bottom - geometry(sectionPageIndex).top;
            if (required > full + epsilon) throw new LayoutError(id, "Table-start group exceeds page content height");
            if (y + required > bottom + epsilon && y > top + epsilon) nextPage();
          }
        }
        if (n?.type === "table") {
          if (previous && d.nodes[previous]?.type === "table") {
            const gap = runtime.spacingProbe?.tableBoundaryPt?.(previous, id) ?? 0;
            if (!Number.isFinite(gap) || gap < 0 || gap > 100) throw new LayoutError(id, "Invalid spacing probe table boundary");
            if (y > top + epsilon) y += gap;
          }
          await table(n);
        } else if (n?.type === "text-block") {
          if (n.props.heightMode === "fixed") {
            const measured = await measureFixedTextBlock(n, d.styles[n.props.textStyleId], available, runtime);
            if (fixed && y + measured.heightPt > limit() + epsilon) throw new FormatStop("unbreakable-item-does-not-fit", [pending(id, "node", { nodeType: "text-block" })]);
            if (y + measured.heightPt > bottom + epsilon)
              throw new LayoutError(id, "Reserved frame exceeds cover content area");
            let at = y + measured.offsetPt;
            for (const line of measured.lines) {
              emitLine(line, left, at);
              at += line.heightPt;
            }
            y += measured.heightPt;
            return;
          }
          let lineIndex = 0;
          for (const line of await measureBlock(id, available)) {
            ensureHeight(line.heightPt, id, pending(id, "text", { lineIndex, ...line.run?.sourceStart === void 0 ? {} : { sourceOffset: line.run.sourceStart } }));
            emitLine(line, left, y);
            y += line.heightPt;
            lineIndex++;
          }
        } else if (n?.type === "table-of-contents") {
          for (const measured of contents) {
            const { line, xOffsetPt, numberSlot } = measured;
            ensureHeight(line.heightPt, n.id);
            emitLine(line, left + xOffsetPt, y);
            if (numberSlot)
              contentsSlots.push({ nodeId: n.id, ...numberSlot, pageIndex: pages.length - 1, xPt: left + available - numberSlot.widthPt, yPt: y });
            y += line.heightPt;
          }
        } else if (n?.type === "line") {
          const m = measureRule(n, available);
          ensureHeight(m.height, id);
          current.borders ??= [];
          if (m.stroke.style !== "none") {
            const half = m.thickness / 2, inset = m.stroke.style === "dotted" ? m.stroke.widthPt / 2 : 0, x1 = left + m.offset, x2 = x1 + m.width;
            if (inset && m.width <= 2 * inset) throw new LayoutError(id, "Stroke exceeds available line width");
            current.borders.push({ nodeId: id, x1Pt: x1 + inset, x2Pt: x2 - inset, y1Pt: y + m.before + half, y2Pt: y + m.before + half, ...strokePaintProps(m.stroke) });
          }
          y += m.height;
        } else if (n?.type === "image") {
          const fw = toPt(n.props.width), fh = toPt(n.props.height);
          if (fw > available + epsilon)
            throw new LayoutError(id, "Image frame exceeds printable page");
          const instance = instanceForNode(d, id);
          if (!fixed && instance?.sizing.mode === "auto" && fh > Math.max(bottom - top, geometry(sectionPageIndex).bottom - geometry(sectionPageIndex).top) + epsilon) {
            warnings.push(formatWarning(instance, "FORMAT_IMAGE_NOT_SHOWN", { reason: "image-exceeds-page", pending: [pending(id, "image")] }));
            omittedNodeIds.add(id);
            return;
          }
          ensureHeight(fh, id, pending(id, "image"));
          const image = Object.hasOwn(images, n.props.resourceId) ? images[n.props.resourceId] : void 0;
          const frameLeft = left + (n.props.align === "right" ? available - fw : n.props.align === "center" ? (available - fw) / 2 : 0);
          if (image) {
            const scale = Math.min(fw / image.width, fh / image.height), iw = image.width * scale, ih = image.height * scale;
            addImage({ nodeId: id, resourceId: n.props.resourceId, xPt: frameLeft + (fw - iw) / 2, yPt: y + (fh - ih) / 2, widthPt: iw, heightPt: ih });
          }
          y += fh;
        } else
          throw new LayoutError(id, "Unsupported root");
      };
      const instances = (d.formatInstances ?? []).filter((f) => f.sectionId === section.sectionId && f.rootStartIndex !== void 0).sort((a, b) => a.rootStartIndex - b.rootStartIndex);
      const ending = section.endingArea;
      const renderEnding = async () => {
        if (!ending?.rootIds.length) return;
        if (pendingBreak) {
          if (y > top + epsilon) nextPage();
          pendingBreak = false;
        }
        const measure = async (g) => {
          const { endingArea: _, header: __, footer: ___, ...source } = section;
          let extent = 0;
          const probe = {
            ...d,
            rootIds: ending.rootIds,
            sections: [{ ...source, rootIds: ending.rootIds, headerMode: "none", footerMode: "none", page: { ...section.page, margin: { ...section.page.margin, top: { unit: "pt", value: g.top }, bottom: { unit: "pt", value: heightPt - g.bottom } } } }],
            formatInstances: (d.formatInstances ?? []).filter((f) => f.sectionId === section.sectionId && f.areaId === ending.areaId).map((f) => ({ ...f, ...f.rootStartIndex === void 0 ? {} : { rootStartIndex: f.rootStartIndex - ending.rootStartIndex } }))
          };
          const draw = await documentFlow(probe, runtime, images, { maxPages: bounds?.maxPages ?? 1e4, ...bounds?.signal ? { signal: bounds.signal } : {}, maxImagePlacements: bounds?.maxImagePlacements ?? 1e4, onSectionEnd: (e) => {
            extent = e.y - e.top;
          } });
          return { pages: draw.pages.length, height: extent };
        };
        let size = await measure({ top, bottom });
        const adjacent = previousRoot && d.nodes[previousRoot]?.type === "table" && d.nodes[ending.rootIds[0]]?.type === "table";
        const gap = adjacent ? runtime.spacingProbe?.tableBoundaryPt?.(previousRoot, ending.rootIds[0]) ?? 0 : 0;
        if (!Number.isFinite(gap) || gap < 0 || gap > 100) throw new LayoutError(ending.rootIds[0], "Invalid spacing probe table boundary");
        if (size.pages === 1 && y + gap + size.height <= bottom + epsilon) {
          y = bottom - size.height;
          previousRoot = void 0;
        } else {
          const next = geometry(sectionPageIndex), nextSize = await measure(next);
          if (nextSize.pages === 1 && nextSize.height <= next.bottom - next.top + epsilon) {
            nextPage();
            size = nextSize;
            y = bottom - size.height;
            previousRoot = void 0;
          }
        }
        const firstPage = pages.length - 1;
        for (const id of ending.rootIds) await renderRoot(id);
        const delta = Math.max(0, bottom - y), lastPage = pages.length - 1;
        const owns = (id) => d.sourceMap[id]?.sectionId === section.sectionId && d.sourceMap[id]?.areaId === ending.areaId;
        if (delta > epsilon) {
          for (const c of current.commands) if (owns(c.nodeId)) c.bounds = { ...c.bounds, yPt: c.bounds.yPt + delta };
          for (const b of current.borders ?? []) if (owns(b.nodeId)) {
            b.y1Pt += delta;
            b.y2Pt += delta;
          }
          for (const f of current.fills ?? []) if (owns(f.nodeId)) f.yPt += delta;
          for (const i of current.images ?? []) if (owns(i.nodeId)) i.yPt += delta;
          for (const slot of [...pageTexts, ...pageFieldSlots, ...contentsSlots]) if (slot.pageIndex === lastPage && owns("nodeId" in slot ? slot.nodeId : slot.node.id)) slot.yPt += delta;
        }
        if (lastPage >= firstPage) y = bottom;
      };
      let position = 0, fi = 0;
      while (position < section.rootIds.length || fi < instances.length) {
        if (ending?.rootIds.length && position === ending.rootStartIndex) {
          await renderEnding();
          position = section.rootIds.length;
          fi = instances.length;
          continue;
        }
        const f = instances[fi];
        if (!f || f.rootStartIndex !== position) {
          await renderRoot(section.rootIds[position++]);
          continue;
        }
        fi++;
        if (f.sizing.mode === "auto") {
          for (const id of f.rootIds) await renderRoot(id);
          position += f.rootIds.length;
          continue;
        }
        if (pendingBreak) {
          if (y > top + epsilon) nextPage();
          pendingBreak = false;
        }
        const height = toPt(f.sizing.height), availableHeight = Math.max(0, bottom - y), completed = /* @__PURE__ */ new Set();
        const markOmitted = (processed = []) => {
          const shown = new Set(processed), remaining = f.rootIds.filter((id) => !completed.has(id)), todo = [...remaining];
          while (todo.length) {
            const id = todo.pop();
            if (shown.has(id)) continue;
            omittedNodeIds.add(id);
            const n = d.nodes[id];
            if (!n) continue;
            for (const key of ["rowIds", "cellIds", "childIds"]) if (key in n) todo.push(...n[key]);
          }
        };
        if (availableHeight === 0) {
          warnings.push(formatWarning(f, "FORMAT_FRAME_NOT_SHOWN", { reason: "insufficient-page-space", sectionPageIndex: sectionPageIndex - 1, requiredHeightPt: height, availableHeightPt: availableHeight }));
          markOmitted();
        } else {
          fixed = { instance: f, start: y, end: Math.min(y + height, bottom) };
          try {
            for (const id of f.rootIds) {
              await renderRoot(id);
              completed.add(id);
            }
          } catch (error) {
            if (!(error instanceof FormatStop)) throw error;
            warnings.push(formatWarning(f, "FORMAT_CONTENT_OMITTED", { reason: error.reason, pending: error.pending }));
            markOmitted(error.completedNodeIds);
          } finally {
            y = fixed.end;
            fixed = void 0;
          }
        }
        position += f.rootIds.length;
      }
      bounds?.onSectionEnd?.({ y, top, bottom });
    }
    if (!pages.length) throw new LayoutError(d.rootIds[0] ?? "document", "No layout content in document");
    assignSystemPageNumbers(d, { pages });
    return { pages, ...omittedNodeIds.size ? { omittedNodeIds: [...omittedNodeIds] } : {}, ...warnings.length ? { warnings } : {}, ...pageTexts.length ? { pageTexts } : {}, ...pageFieldSlots.length ? { pageFieldSlots } : {}, ...contentsSlots.length ? { contentsSlots } : {} };
  } catch (error) {
    if (error instanceof LayoutError) error.warnings = warnings;
    throw error;
  }
}

// ../flowdoc-core/src/runtime/scriptSpans.ts
function scriptSpans(text2) {
  const whole = [{ text: text2, start: 0, end: text2.length }];
  if (!text2.isWellFormed() || /\p{Bidi_Control}/u.test(text2) || [...text2].some((ch) => !/[\p{Script_Extensions=Thai}\p{Script_Extensions=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(ch))) return whole;
  const spans = [];
  let start = 0, script;
  for (const g of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text2)) {
    const strong = [...g.segment].find((ch) => /[\p{Script=Thai}\p{Script=Latin}]/u.test(ch));
    const next = strong ? /\p{Script=Thai}/u.test(strong) ? "Thai" : "Latin" : void 0;
    if (next && script && next !== script) {
      spans.push({ text: text2.slice(start, g.index), start, end: g.index });
      start = g.index;
    }
    if (next) script = next;
  }
  spans.push({ text: text2.slice(start), start, end: text2.length });
  return spans;
}

// ../flowdoc-core/src/runtime/cacheTextRuntime.ts
function cacheTextRuntime(base, limits = { maxBytes: 8 * 1024 * 1024, maxEntries: 8192 }) {
  const entries = /* @__PURE__ */ new Map();
  let bytes = 0, disposed = false;
  async function get(key, load) {
    if (disposed) return load();
    const hit = entries.get(key);
    if (hit !== void 0) {
      entries.delete(key);
      entries.set(key, hit);
      return JSON.parse(hit);
    }
    const result = await load(), value = JSON.stringify(result), size = 2 * (key.length + value.length);
    if (!disposed && size <= limits.maxBytes && limits.maxEntries > 0) {
      while (entries.size && (bytes + size > limits.maxBytes || entries.size >= limits.maxEntries)) {
        const oldest = entries.keys().next().value;
        bytes -= 2 * (oldest.length + entries.get(oldest).length);
        entries.delete(oldest);
      }
      const previous = entries.get(key);
      if (previous !== void 0) {
        bytes -= 2 * (key.length + previous.length);
        entries.delete(key);
      }
      entries.set(key, value);
      bytes += size;
    }
    return result;
  }
  return { ...base.spacingProbe ? { spacingProbe: base.spacingProbe } : {}, ...base.fontId ? { fontId: (style) => base.fontId(style) } : {}, dispose() {
    disposed = true;
    entries.clear();
    bytes = 0;
  }, breaks: (text2) => get(JSON.stringify(["breaks", text2]), () => base.breaks(text2)), shape: (text2, font, size) => get(JSON.stringify(["shape", font, size, text2]), () => base.shape(text2, font, size)) };
}

// <stdin>
function byteOffsets(text2) {
  if (!text2.isWellFormed()) throw Error("Malformed Unicode");
  const map = /* @__PURE__ */ new Map();
  let b = 0, u = 0;
  for (const ch of text2) {
    map.set(b, u);
    b += new TextEncoder().encode(ch).length;
    u += ch.length;
  }
  map.set(b, u);
  return map;
}
function decodeShape(raw, text2, sizePt) {
  const offsets = byteOffsets(text2);
  if (!raw || raw.shaperRevision !== "rustybuzz-0.20.1" || !Number.isFinite(raw.unitsPerEm) || raw.unitsPerEm <= 0 || !Number.isFinite(raw.ascent) || !Number.isFinite(raw.descent) || !Array.isArray(raw.glyphs) || !raw.glyphs.length) throw Error("Invalid shape result");
  const scale = sizePt / raw.unitsPerEm;
  const starts = [...new Set(raw.glyphs.map((g) => g.cluster))].sort((a, b) => a - b);
  if (starts[0] !== 0 || starts.some((n) => !offsets.has(n) || n === new TextEncoder().encode(text2).length)) throw Error("Invalid shape cluster");
  let cursor = 0, left = 0, right = 0, top = raw.ascent * scale, bottom = -raw.descent * scale;
  const glyphs = raw.glyphs.map((g) => {
    if (!Number.isInteger(g.glyphId) || g.glyphId <= 0 || g.glyphId > 65535 || ![g.xAdvance, g.yAdvance, g.xOffset, g.yOffset].every(Number.isFinite) || g.yAdvance !== 0 || g.xAdvance < 0) throw Error("Unsupported glyph metrics");
    if (g.ink !== null) {
      if (!g.ink || ![g.ink.xMin, g.ink.xMax, g.ink.yMin, g.ink.yMax].every(Number.isFinite)) throw Error("Missing glyph ink");
      left = Math.min(left, cursor + (g.xOffset + g.ink.xMin) * scale);
      right = Math.max(right, cursor + (g.xOffset + g.ink.xMax) * scale);
      top = Math.max(top, (g.yOffset + g.ink.yMax) * scale);
      bottom = Math.max(bottom, -(g.yOffset + g.ink.yMin) * scale);
    }
    cursor += g.xAdvance * scale;
    return { glyphId: g.glyphId, advancePt: g.xAdvance * scale, offsetXPt: g.xOffset * scale, offsetYPt: g.yOffset * scale, clusterStartOffset: offsets.get(g.cluster), clusterEndOffset: offsets.get(starts[starts.indexOf(g.cluster) + 1] ?? new TextEncoder().encode(text2).length) };
  });
  return { glyphs, ascentPt: top, descentPt: bottom, inkLeftPt: left, inkRightPt: right, glyphInkBoundsPt: raw.glyphs.map((g) => g.ink ? { left: (g.xOffset + g.ink.xMin) * scale, right: (g.xOffset + g.ink.xMax) * scale } : null) };
}
export {
  byteOffsets,
  cacheTextRuntime,
  decodeShape,
  documentFlow,
  scriptSpans
};
