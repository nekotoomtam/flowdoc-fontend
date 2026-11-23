import type {PDFDocumentProxy} from 'pdfjs-dist';
import {maerskFields, type MaerskField} from './import-pdf-maersk-schema';

export type PdfBox = {left: number; top: number; width: number; height: number};
export type FieldOccurrence = {page: number; value: string; box: PdfBox; sourceText?: string; blank?: boolean};
export type ImportField = MaerskField & {occurrences: FieldOccurrence[]};
type PageRange = {start: number; end: number};

type FieldRule = {
  key: string;
  anchor?: string;
  // Window below the source label, in points on the 595 × 841 reference layout.
  window: [left: number, right: number, firstLine: number, lastLine: number];
  fits?: RegExp;
  multiline?: boolean;
};

const fields: FieldRule[] = [
  {key: 'bl_number', window: [-5, 105, 8, 37]},
  {key: 'vessel_name', window: [-5, 150, 5, 23]},
  {key: 'voyage_number', window: [-5, 150, 5, 23]},
  {key: 'port_of_loading', window: [-5, 150, 5, 23]},
  {key: 'port_of_discharge', window: [-5, 150, 5, 23]},
  {key: 'place_of_delivery', window: [-5, 150, 5, 24]},
  {key: 'estimated_arrival_date', window: [-5, 105, 5, 25], fits: /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/},
  {key: 'consignee_details', window: [-5, 278, 8, 132], multiline: true},
  {key: 'notify_party_details', window: [-5, 278, 8, 79], multiline: true},
  {key: 'shipper_exporter_details', window: [-5, 265, 8, 79], multiline: true},
  {key: 'shipping_marks', window: [-22, 84, 10, 188], fits: /^(?![A-Z]{4}\s?\d{7}$).+/, multiline: true},
  {key: 'container_numbers', window: [-26, 78, 21, 188], fits: /^[A-Z]{4}\s?\d{7}$/, multiline: true},
  {key: 'package_count', anchor: 'No. of Containers', window: [-12, 60, 22, 49], fits: /^[\d,]+$/},
  {key: 'package_type', anchor: 'No. of Containers', window: [-12, 60, 48, 70], fits: /^[A-Za-z][A-Za-z ]+$/},
  {key: 'goods_description', window: [-62, 180, 19, 227], multiline: true},
  {key: 'gross_weight_kg', window: [-15, 72, 21, 49], fits: /^[\d,.]+$/},
  {key: 'cargo_volume_cbm', window: [-10, 64, 21, 49], fits: /^[\d,.]+$/},
  {key: 'demurrage_expiry_date', window: [-5, 105, 4, 34], fits: /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/},
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
  return occurrenceFromLines(matches, page);
}

function occurrenceFromLines(matches: TextLine[], page: number): FieldOccurrence {
  const x = Math.min(...matches.map(line => line.x));
  const y = Math.min(...matches.map(line => line.top));
  const rightEdge = Math.max(...matches.map(line => line.right));
  const bottom = Math.max(...matches.map(line => line.bottom));
  return {
    page,
    value: matches.map(line => line.value).join('\n'),
    box: {left: x / 595, top: y / 841, width: (rightEdge - x) / 595, height: (bottom - y) / 841},
  };
}

export async function readImportFields(source: PDFDocumentProxy, selection: readonly PageRange[], signal: AbortSignal) {
  const results = new Map(maerskFields.map(field => [field.key, {...field, occurrences: []} as ImportField]));
  const unreadablePages: number[] = [];
  let recognizedPages = 0;
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
      recognizedPages++;
      for (const rule of fields) {
        const field = results.get(rule.key)!;
        const anchor = labels.get(rule.anchor ?? field.sourceLabel);
        if (!anchor) continue;
        let occurrence = readField(rule, anchor, lines, number);
        if (!occurrence && field.disposition === 'blank') {
          occurrence = {...occurrenceFromLines([anchor], number), value: '', blank: true};
        }
        if (occurrence) field.occurrences.push(occurrence);
      }

      const container = results.get('container_numbers')!.occurrences.at(-1);
      if (container?.page === number) {
        results.get('listed_container_count')!.occurrences.push({
          ...container, sourceText: container.value, value: String(container.value.split('\n').length),
        });
      }
      const description = lines.filter(line => line.x >= 195 && line.x < 440 && line.y >= 370 && line.y < 575);
      const hs = description.filter(line => /HS\s*CODE\s*:?\s*\d/i.test(line.value));
      if (hs.length) {
        const occurrence = occurrenceFromLines(hs, number);
        const codes = [...occurrence.value.matchAll(/HS\s*CODE\s*:?\s*(\d[\d. ]*)/gi)];
        results.get('hs_codes')!.occurrences.push({
          ...occurrence, sourceText: occurrence.value, value: codes.map(match => match[1].trim()).join('\n'),
        });
      }
      const transit = lines.filter(line => line.y >= 370 && line.y < 575 &&
        /TO LAOS VIA|CARGO IN TRANSIT|IN[- ]TRANSIT SHIPMENT/i.test(line.value));
      if (transit.length) results.get('onward_transit_text')!.occurrences.push(occurrenceFromLines(transit, number));
      const say = lines.find(line => /^SAY\s*:/i.test(line.value) && line.y >= 570 && line.y < 610);
      if (say) {
        const continuation = lines.filter(line => line.x >= say.x - 8 && line.x < 425 && line.y > say.y + 3 && line.y < say.y + 20);
        results.get('package_count_in_words')!.occurrences.push(occurrenceFromLines([say, ...continuation], number));
      }
      const printed = lines.find(line => /^Page \d+ of \d+$/i.test(line.value) && line.x >= 440 && line.y < 300);
      if (printed) {
        results.get('printed_page_counter')!.occurrences.push(occurrenceFromLines([printed], number));
      }
    }
  }
  return {fields: recognizedPages ? Array.from(results.values()) : [], unreadablePages};
}
