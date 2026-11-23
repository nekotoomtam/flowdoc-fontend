import type {PDFDocumentProxy} from 'pdfjs-dist';

export type PdfBox = {left: number; top: number; width: number; height: number};
export type FieldOccurrence = {page: number; value: string; box: PdfBox};
export type ImportField = {
  key: string;
  label: string;
  sourceLabel: string;
  occurrences: FieldOccurrence[];
};
type PageRange = {start: number; end: number};

type FieldRule = {
  key: string;
  label: string;
  sourceLabel: string;
  // Window below the source label, in points on the 595 × 841 reference layout.
  window: [left: number, right: number, firstLine: number, lastLine: number];
  fits?: RegExp;
  multiline?: boolean;
};

const fields: FieldRule[] = [
  {key: 'bl_number', label: 'เลข B/L', sourceLabel: 'BL No.', window: [-5, 105, 8, 37]},
  {key: 'vessel_name', label: 'ชื่อเรือ', sourceLabel: 'Vessel', window: [-5, 150, 5, 23]},
  {key: 'voyage_number', label: 'เลขเที่ยวเรือ', sourceLabel: 'Voy No.', window: [-5, 150, 5, 23]},
  {key: 'port_of_loading', label: 'ท่าต้นทาง', sourceLabel: 'Port of Loading', window: [-5, 150, 5, 23]},
  {key: 'port_of_discharge', label: 'ท่าปลายทาง', sourceLabel: 'Port of Discharge', window: [-5, 150, 5, 23]},
  {key: 'place_of_delivery', label: 'สถานที่ส่งมอบ', sourceLabel: 'Place of delivery', window: [-5, 150, 5, 24]},
  {key: 'estimated_arrival_date', label: 'วันถึงตามต้นฉบับ', sourceLabel: 'Estimate Time Arrival', window: [-5, 105, 5, 25], fits: /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/},
  {key: 'consignee_details', label: 'ข้อมูลผู้รับสินค้า', sourceLabel: 'Consignee (Complete Name and Address)', window: [-5, 278, 8, 132], multiline: true},
  {key: 'notify_party_details', label: 'ข้อมูลผู้รับแจ้ง', sourceLabel: 'Notify Party (Complete Name and Address)', window: [-5, 278, 8, 79], multiline: true},
  {key: 'shipper_exporter_details', label: 'ข้อมูลผู้ส่งสินค้า', sourceLabel: 'Shipper/Exporter (Complete Name and Address)', window: [-5, 265, 8, 79], multiline: true},
  {key: 'container_numbers', label: 'เลขตู้สินค้า', sourceLabel: 'Container No.', window: [-26, 78, 21, 172], fits: /^[A-Z]{4}\s?\d{7}$/, multiline: true},
  {key: 'package_count', label: 'จำนวนหีบห่อ', sourceLabel: 'No. of Containers', window: [-12, 60, 22, 49], fits: /^[\d,]+$/},
  {key: 'package_type', label: 'หน่วยบรรจุ', sourceLabel: 'No. of Containers', window: [-12, 60, 48, 70], fits: /^[A-Za-z][A-Za-z ]+$/},
  {key: 'gross_weight_kg', label: 'น้ำหนักรวม (กก.)', sourceLabel: 'Gross Weight', window: [-15, 72, 21, 49], fits: /^[\d,.]+$/},
  {key: 'cargo_volume_cbm', label: 'ปริมาตร (ลบ.ม.)', sourceLabel: 'Measurement', window: [-10, 64, 21, 49], fits: /^[\d,.]+$/},
];

type TextLine = {value: string; x: number; y: number; right: number; top: number; bottom: number};

function readField(rule: FieldRule, anchor: TextLine, lines: TextLine[], page: number): FieldOccurrence | undefined {
  const [left, right, firstLine, lastLine] = rule.window;
  const candidates = lines.filter(line =>
    line.x >= anchor.x + left && line.x <= anchor.x + right &&
    line.y >= anchor.y + firstLine && line.y <= anchor.y + lastLine &&
    (!rule.fits || rule.fits.test(line.value)),
  ).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);
  if (!candidates.length) return;
  const matches = rule.multiline ? candidates : [candidates[0]];
  const x = Math.min(...matches.map(line => line.x));
  const y = Math.min(...matches.map(line => line.top));
  const rightEdge = Math.max(...matches.map(line => line.right));
  const bottom = Math.max(...matches.map(line => line.bottom));
  return {
    page,
    value: matches.map(line => line.value).join(rule.multiline ? '\n' : ''),
    box: {left: x / 595, top: y / 841, width: (rightEdge - x) / 595, height: (bottom - y) / 841},
  };
}

export async function readImportFields(source: PDFDocumentProxy, selection: readonly PageRange[], signal: AbortSignal) {
  const results = new Map<string, ImportField>();
  const unreadablePages: number[] = [];
  for (const {start, end} of selection) {
    for (let number = start; number <= end; number++) {
      signal.throwIfAborted();
      const page = await source.getPage(number);
      const viewport = page.getViewport({scale: 1});
      const text = await page.getTextContent();
      signal.throwIfAborted();

      const sx = 595 / viewport.width;
      const sy = 841 / viewport.height;
      const lines: TextLine[] = [];
      for (const item of text.items) {
        if (!('str' in item) || !item.str.trim() || item.dir === 'ttb') continue;
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        lines.push({
          value: item.str.trim(),
          x: x * sx,
          y: y * sy,
          right: (x + item.width) * sx,
          top: (y - item.height) * sy,
          bottom: (y + 2) * sy,
        });
      }

      const labels = new Map(lines.map(line => [line.value, line]));
      if (!labels.has('BL No.') || !labels.has('Vessel') || !labels.has('Port of Loading')) {
        unreadablePages.push(number);
        continue;
      }
      for (const rule of fields) {
        const anchor = labels.get(rule.sourceLabel);
        if (!anchor) continue;
        const occurrence = readField(rule, anchor, lines, number);
        if (!occurrence) continue;
        let field = results.get(rule.key);
        if (!field) {
          field = {key: rule.key, label: rule.label, sourceLabel: rule.sourceLabel, occurrences: []};
          results.set(rule.key, field);
        }
        field.occurrences.push(occurrence);
      }
    }
  }
  return {fields: Array.from(results.values()), unreadablePages};
}
