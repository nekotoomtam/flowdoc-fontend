import type {FieldOccurrence, ImportField} from './import-pdf-fields';
import {maerskFieldGroups, sectionInputSchema} from './import-pdf-maersk-schema';

function fieldStatus(field: ImportField, totalPages: number) {
  if (field.disposition === 'pending') return 'รอจับคู่ตามบทบาท';
  if (field.disposition === 'derived') return 'ค่าจากการนับ';
  if (field.disposition === 'system') return 'เลขหน้าจากต้นฉบับ';
  const found = field.occurrences.filter(occurrence => !occurrence.blank).length;
  if (found === totalPages) return 'พบทุกหน้าที่เลือก';
  if (found) return 'พบ ' + found + ' จาก ' + totalPages + ' หน้า';
  if (field.occurrences.some(occurrence => occurrence.blank)) return 'ช่องว่างในต้นฉบับ';
  return 'ไม่พบค่าในหน้าที่เลือก';
}

function validSample(field: ImportField, raw: string, occurrence: FieldOccurrence) {
  if (!raw.trim()) return occurrence.blank === true;
  if (field.definition?.type !== 'number') return true;
  return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw.trim());
}

export function showImportFieldReview(
  panel: HTMLElement,
  fields: ImportField[],
  totalPages: number,
  unreadablePages: number[],
  showEvidence: (occurrence?: FieldOccurrence) => void,
) {
  const list = panel.querySelector('#import-pdf-field-list')!;
  const heading = panel.querySelector<HTMLElement>('#import-pdf-fields-title')!;
  const count = panel.querySelector('#import-pdf-field-count')!;
  const note = panel.querySelector('#import-pdf-field-note')!;
  const picker = panel.querySelector<HTMLElement>('#import-pdf-field-picker')!;
  const fieldSelect = panel.querySelector<HTMLSelectElement>('#import-pdf-field-select')!;
  const detail = panel.querySelector<HTMLElement>('#import-pdf-field-detail')!;
  const key = panel.querySelector('#import-pdf-field-key')!;
  const status = panel.querySelector('#import-pdf-field-status')!;
  const type = panel.querySelector('#import-pdf-field-type')!;
  const help = panel.querySelector('#import-pdf-field-help')!;
  const name = panel.querySelector<HTMLInputElement>('#import-pdf-field-name')!;
  const page = panel.querySelector<HTMLSelectElement>('#import-pdf-field-page')!;
  const evidence = panel.querySelector<HTMLElement>('#import-pdf-field-evidence')!;
  const source = panel.querySelector('#import-pdf-field-source')!;
  const value = panel.querySelector<HTMLTextAreaElement>('#import-pdf-field-value')!;
  const valueError = panel.querySelector<HTMLElement>('#import-pdf-field-value-error')!;
  const confirm = panel.querySelector<HTMLButtonElement>('#import-pdf-field-confirm')!;
  const schema = panel.querySelector('#import-pdf-schema-json')!;
  const schemaDetails = panel.querySelector<HTMLDetailsElement>('#import-pdf-field-schema')!;
  const catalog = panel.querySelector<HTMLDetailsElement>('#import-pdf-field-catalog')!;

  const entries = fields.map(field => ({
    field,
    option: new Option(field.label, field.key),
    button: document.createElement('button'),
    buttonLabel: document.createElement('span'),
    badge: document.createElement('small'),
    label: field.label,
    confirmed: false,
    statusText: fieldStatus(field, totalPages),
    occurrenceIndex: 0,
    values: field.occurrences.map(occurrence => occurrence.value),
  }));
  let active = entries[0];
  const recognized = fields.filter(field => field.definition && field.occurrences.some(occurrence => !occurrence.blank)).length;
  const proposals = entries.filter(entry => entry.field.definition).length;
  note.textContent = unreadablePages.length
    ? 'ไม่พบช่องที่รองรับในหน้า ' + unreadablePages.join(', ')
    : 'ต้นแบบนี้อ่านจากชั้นข้อความ PDF ของ Maersk';
  detail.hidden = !entries.length;
  picker.hidden = !entries.length;
  catalog.hidden = !entries.length;
  schemaDetails.hidden = !entries.length;
  catalog.open = false;
  schemaDetails.open = false;

  function updateStatus() {
    const confirmed = entries.filter(entry => entry.confirmed).length;
    count.textContent = entries.length
      ? 'บัญชี ' + entries.length + ' รายการ · อ่านค่าได้ ' + recognized + ' · ยืนยันนิยาม ' + confirmed + '/' + proposals
      : 'ไม่พบตัวแปรที่รองรับในหน้าที่เลือก';
    for (const entry of entries) {
      const text = entry.label.trim() || entry.field.label;
      entry.option.textContent = text + (entry.confirmed ? ' · ยืนยันแล้ว' : '');
      entry.buttonLabel.textContent = text;
      entry.badge.textContent = entry.confirmed ? 'ยืนยันแล้ว' : entry.statusText;
      entry.button.setAttribute('aria-pressed', String(entry === active));
    }
    schema.textContent = JSON.stringify(sectionInputSchema(entries), null, 2);
    if (!active) return;

    const invalid = active.values.findIndex((sample, index) => !validSample(active.field, sample, active.field.occurrences[index]));
    const editable = !!active.field.definition && !active.confirmed;
    valueError.hidden = invalid < 0;
    valueError.textContent = invalid < 0 ? '' : 'ตรวจชนิดหรือค่าตัวอย่างในหน้า ' + active.field.occurrences[invalid].page;
    confirm.hidden = !active.field.definition;
    confirm.textContent = active.confirmed ? 'แก้ไขอีกครั้ง' : 'ยืนยันนิยาม';
    confirm.disabled = !active.confirmed && (!active.label.trim() || invalid >= 0);
    name.readOnly = !editable;
    value.readOnly = !editable;
  }

  function showOccurrence() {
    const occurrence = active.field.occurrences[active.occurrenceIndex];
    evidence.hidden = !occurrence;
    if (!occurrence) {
      showEvidence();
      return;
    }
    page.value = String(active.occurrenceIndex);
    const original = occurrence.blank ? 'ช่องว่าง' : occurrence.sourceText ?? occurrence.value;
    source.textContent = active.field.sourceLabel + '\n' + original;
    value.value = active.values[active.occurrenceIndex];
    showEvidence(occurrence);
  }

  function showField(entry: typeof active) {
    active = entry;
    fieldSelect.value = entry.field.key;
    key.textContent = entry.field.key;
    status.textContent = entry.statusText;
    name.value = entry.label;
    help.textContent = entry.field.note ?? '';
    const definition = entry.field.definition;
    const items = Object.entries(definition?.items?.fields ?? {});
    const base = 'Section · inputSchema · ' + (definition?.type ?? 'ยังไม่เสนอเป็น input field');
    type.textContent = items.length
      ? base + ' → items.fields → ' + items.map(([key, item]) => key + ' (' + item.type + ')').join(', ')
      : base;
    page.replaceChildren(...entry.field.occurrences.map((occurrence, index) =>
      new Option('หน้า ' + occurrence.page, String(index)),
    ));
    showOccurrence();
    updateStatus();
  }

  fieldSelect.replaceChildren();
  list.replaceChildren();
  for (const [group, title] of Object.entries(maerskFieldGroups)) {
    const groupEntries = entries.filter(entry => entry.field.group === group);
    if (!groupEntries.length) continue;
    const options = document.createElement('optgroup');
    options.label = title;
    const groupTitle = document.createElement('h4');
    groupTitle.textContent = title;
    const groupItems = document.createElement('ul');
    for (const entry of groupEntries) {
      options.append(entry.option);
      const item = document.createElement('li');
      entry.button.type = 'button';
      entry.button.append(entry.buttonLabel, entry.badge);
      entry.button.addEventListener('click', () => {
        showField(entry);
        catalog.open = false;
        fieldSelect.focus();
      });
      item.append(entry.button);
      groupItems.append(item);
    }
    fieldSelect.append(options);
    list.append(groupTitle, groupItems);
  }

  fieldSelect.onchange = () => {
    const entry = entries.find(item => item.field.key === fieldSelect.value);
    if (entry) showField(entry);
  };
  page.onchange = () => {
    active.occurrenceIndex = Number(page.value);
    showOccurrence();
  };
  name.oninput = () => {
    active.label = name.value;
    updateStatus();
  };
  value.oninput = () => {
    active.values[active.occurrenceIndex] = value.value;
    updateStatus();
  };
  confirm.onclick = () => {
    active.confirmed = !active.confirmed;
    updateStatus();
  };
  panel.hidden = false;
  heading.focus({preventScroll: true});
  if (active) showField(active);
  else {
    updateStatus();
    showEvidence();
  }
}
