import './library.css';

type TemplateSummary = {
  templateId: string;
  docKey: string;
  name: string;
  description: string | null;
  revision: number | null;
  updatedAt: string;
};

const search = document.querySelector<HTMLInputElement>('#search')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const cards = document.querySelector('#cards')!;
const count = document.querySelector('#count')!;
const status = document.querySelector('#status')!;
const detail = document.querySelector<HTMLDialogElement>('#detail')!;
const date = new Intl.DateTimeFormat('th-TH', {dateStyle: 'medium'});
const paperIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6m-6 4h6"/>
</svg>`;

const phase1 = new URLSearchParams(location.search).get('phase1') === '1';
if (phase1) {
  document.querySelector('.badge')!.textContent = 'คลังทดสอบ · เฟส 1';
  document.querySelector('.hero p')!.textContent = 'สร้างนิยามจากกระดาษเปล่า หรือเปิดโครง UAT เพื่อดูตัวอย่าง';
  const create = document.querySelector<HTMLButtonElement>('#create-draft')!;
  create.disabled=false;
  create.onclick=()=>location.assign('/phase1-editor.html?new=1');
}

let items: TemplateSummary[] = [];
let available = false;
let loading = false;

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = '') {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function updatedAt(item: TemplateSummary) {
  const parsed = new Date(item.updatedAt);
  return Number.isNaN(parsed.getTime()) ? '' : date.format(parsed);
}

function openDetails(item: TemplateSummary) {
  document.querySelector('#detail-name')!.textContent = item.name;
  document.querySelector('#detail-key')!.textContent = item.docKey;
  document.querySelector('#detail-info')!.textContent =
    [item.revision === null ? 'ยังไม่มีนิยามโครง' : 'ฉบับร่าง · Revision ' + item.revision, updatedAt(item)].filter(Boolean).join(' · ');
  detail.showModal();
}

function closeMenus(except?: HTMLDetailsElement) {
  for (const menu of cards.querySelectorAll<HTMLDetailsElement>('details[open]')) {
    if (menu !== except) menu.open = false;
  }
}

function openEditor(item: TemplateSummary) {
  sessionStorage.setItem('flowdoc:open:'+item.templateId, String(performance.timeOrigin + performance.now()));
  location.assign('/phase1-editor.html?id='+encodeURIComponent(item.templateId));
}

function card(item: TemplateSummary) {
  const element = document.createElement('article');
  element.className = 'card';
  element.dataset.docKey=item.docKey;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'card-open';
  open.setAttribute('aria-label', (phase1 ? 'เปิดแก้ไข ' : 'เปิดดู ') + item.name);
  open.onclick = () => phase1 ? openEditor(item) : openDetails(item);

  const thumbnail = document.createElement('span');
  thumbnail.className = 'thumbnail';
  const paper = document.createElement('span');
  paper.className = 'paper';
  paper.innerHTML = paperIcon; // Constant icon. Database fields are rendered as text.
  paper.append(text('span', 'ยังไม่มีภาพตัวอย่าง'));
  thumbnail.append(paper);

  const caption = document.createElement('span');
  caption.className = 'caption';
  caption.append(text('span', item.name, 'card-title'));
  caption.append(text('span', item.description || item.docKey, 'description'));
  caption.append(text('span', [item.revision === null ? 'ยังไม่มีนิยามโครง' : 'ฉบับร่าง', updatedAt(item)].filter(Boolean).join(' · '), 'meta'));
  open.append(thumbnail, caption);

  const menu = document.createElement('details');
  menu.className = 'menu';
  const toggle = text('summary', '⋯');
  toggle.setAttribute('aria-label', 'ตัวเลือก ' + item.name);
  toggle.onclick = () => closeMenus(menu);
  const actions = document.createElement('div');
  actions.className = 'menu-actions';
  const view = text('button', 'เปิดดู');
  view.type = 'button';
  view.onclick = () => { openDetails(item); menu.open = false; };
  actions.append(view);
  for (const label of ['แก้ไข', 'ลบ']) {
    const action = text('button', label);
    action.type = 'button';
    action.disabled = !phase1 || label !== 'แก้ไข';
    if (!action.disabled) action.onclick = () => openEditor(item);
    actions.append(action);
  }
  menu.append(toggle, actions);
  menu.onkeydown = event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      toggle.focus();
    }
  };
  element.append(open, menu);
  return element;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const shown = items.filter(item => [item.name, item.docKey].some(value => value.toLowerCase().includes(query)));
  count.textContent = available ? shown.length + ' รายการ' : '';
  cards.replaceChildren(...shown.map(card));
  if (!loading && available && !shown.length) {
    cards.append(text('p', query ? 'ไม่พบโครงเอกสารที่ตรงกับคำค้น' : 'ยังไม่มีโครงเอกสารในคลัง', 'empty'));
  }
}

function isSummary(value: unknown): value is TemplateSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<TemplateSummary>;
  return typeof row.templateId === 'string' && typeof row.name === 'string' &&
    typeof row.docKey === 'string' && typeof row.updatedAt === 'string' &&
    (row.description === null || typeof row.description === 'string') &&
    (row.revision === null || (typeof row.revision === 'number' && Number.isSafeInteger(row.revision)));
}

async function load() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  status.textContent = 'กำลังโหลดโครงเอกสาร…';
  try {
    const response = await fetch(phase1 ? '/api/editor-phase1/catalog' : '/api/library', {signal: AbortSignal.timeout(12000)});
    const body: {items?: unknown; error?: string} = await response.json();
    if (body.error === 'phase1_disabled') {
      status.textContent = 'ยังไม่ได้เปิดคลังทดสอบเฟส 1';
      return;
    }
    if (body.error === 'source_disabled') {
      status.textContent = 'ยังไม่ได้เปิดแหล่งข้อมูล Oracle สำหรับหน้าคลังนี้';
      return;
    }
    if (!response.ok || !Array.isArray(body.items) || !body.items.every(isSummary)) throw Error('Catalog unavailable');
    items = body.items;
    available = true;
    status.textContent = '';
  } catch {
    status.textContent = 'อ่านรายการจากฐานข้อมูลไม่ได้ ลองกดรีเฟรชอีกครั้ง';
  } finally {
    loading = false;
    refresh.disabled = false;
    render();
  }
}

document.addEventListener('click', event => {
  if (event.target instanceof Element && !event.target.closest('.menu')) closeMenus();
});
search.addEventListener('input', render);
refresh.addEventListener('click', () => void load());
void load();
