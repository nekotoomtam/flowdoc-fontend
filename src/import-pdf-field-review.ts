import type {FieldOccurrence, ImportField} from './import-pdf-fields';

export function showImportFieldReview(
  panel: HTMLElement,
  fields: ImportField[],
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
  const name = panel.querySelector<HTMLInputElement>('#import-pdf-field-name')!;
  const page = panel.querySelector<HTMLSelectElement>('#import-pdf-field-page')!;
  const source = panel.querySelector('#import-pdf-field-source')!;
  const value = panel.querySelector<HTMLTextAreaElement>('#import-pdf-field-value')!;
  const confirm = panel.querySelector<HTMLButtonElement>('#import-pdf-field-confirm')!;

  const entries = fields.map(field => ({
    field,
    button: document.createElement('button'),
    label: field.label,
    confirmed: false,
    occurrenceIndex: 0,
    values: field.occurrences.map(occurrence => occurrence.value),
  }));
  let active = entries[0];
  note.textContent = unreadablePages.length
    ? 'อ่านตัวแปรด้วยกฎของแบบ Maersk · ไม่พบช่องที่รองรับในหน้า ' + unreadablePages.join(', ')
    : 'อ่านจากชั้นข้อความ PDF ด้วยกฎของแบบ Maersk';
  detail.hidden = !entries.length;
  picker.hidden = !entries.length;
  fieldSelect.replaceChildren(...entries.map(entry => new Option(entry.label, entry.field.key)));

  function updateStatus() {
    const confirmed = entries.filter(entry => entry.confirmed).length;
    count.textContent = entries.length
      ? 'ยืนยัน ' + confirmed + ' จาก ' + entries.length + ' ตัวแปร'
      : 'ไม่พบตัวแปรที่รองรับในหน้าที่เลือก';
    for (const [index, entry] of entries.entries()) {
      entry.button.textContent = (entry.label.trim() || entry.field.label) + (entry.confirmed ? ' · ยืนยันแล้ว' : '');
      fieldSelect.options[index].textContent = entry.button.textContent;
      entry.button.setAttribute('aria-pressed', String(entry === active));
    }
    if (!active) return;
    confirm.textContent = active.confirmed ? 'แก้ไขอีกครั้ง' : 'ยืนยันตัวแปร';
    confirm.disabled = !active.confirmed && (!active.label.trim() || active.values.some(sample => !sample.trim()));
    name.readOnly = active.confirmed;
    value.readOnly = active.confirmed;
  }

  function showOccurrence() {
    const occurrence = active.field.occurrences[active.occurrenceIndex];
    page.value = String(active.occurrenceIndex);
    source.textContent = 'ต้นฉบับ · ' + active.field.sourceLabel + '\n' + occurrence.value;
    value.value = active.values[active.occurrenceIndex];
    showEvidence(occurrence);
  }

  function showField(entry: typeof active) {
    active = entry;
    fieldSelect.value = entry.field.key;
    key.textContent = entry.field.key;
    name.value = entry.label;
    page.replaceChildren(...entry.field.occurrences.map((occurrence, index) =>
      new Option('หน้า ' + occurrence.page, String(index)),
    ));
    showOccurrence();
    updateStatus();
  }

  const items = entries.map(entry => {
    const item = document.createElement('li');
    entry.button.type = 'button';
    entry.button.addEventListener('click', () => showField(entry));
    item.append(entry.button);
    return item;
  });
  list.replaceChildren(...items);

  fieldSelect.onchange = () => showField(entries[fieldSelect.selectedIndex]);
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
