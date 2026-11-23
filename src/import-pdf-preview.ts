import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {FieldOccurrence, PdfBox} from './import-pdf-fields';

type PreviewPage = {
  number: number;
  row: HTMLElement;
  checkbox: HTMLInputElement;
  paper: HTMLElement;
  render?: AbortController;
  highlight?: HTMLElement;
};

function markEvidence(view: PreviewPage, box?: PdfBox) {
  const marker = view.highlight;
  if (!marker) return;
  marker.hidden = !box;
  if (!box) return;
  marker.style.left = 100 * box.left + '%';
  marker.style.top = 100 * box.top + '%';
  marker.style.width = 100 * box.width + '%';
  marker.style.height = 100 * box.height + '%';
}

async function renderPage(source: PDFDocumentProxy, view: PreviewPage, signal: AbortSignal) {
  try {
    const page = await source.getPage(view.number);
    if (signal.aborted) return;

    const bounds = page.getViewport({scale: 1});
    const viewport = page.getViewport({scale: Math.min(1150 / bounds.width, 1350 / bounds.height)});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'ตัวอย่าง PDF หน้า ' + view.number);
    const task = page.render({canvas, viewport});
    const cancel = () => task.cancel();
    signal.addEventListener('abort', cancel, {once: true});
    try {
      await task.promise;
      if (!signal.aborted) {
        const sheet = document.createElement('div');
        sheet.className = 'import-pdf-sheet';
        sheet.style.setProperty('--pdf-page-ratio', String(viewport.width / viewport.height));
        const marker = document.createElement('span');
        marker.className = 'import-pdf-marker';
        marker.hidden = true;
        marker.setAttribute('aria-hidden', 'true');
        sheet.append(canvas, marker);
        view.highlight = marker;
        view.paper.replaceChildren(sheet);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  } catch {
    if (!signal.aborted) view.paper.textContent = 'เปิดตัวอย่างหน้านี้ไม่ได้';
  }
}

export function mountPdfPreview(
  container: HTMLElement,
  source: PDFDocumentProxy,
  togglePage: (page: number, included: boolean) => void,
) {
  const pages = new Map<Element, PreviewPage>();
  let evidence: FieldOccurrence | undefined;
  const fragment = document.createDocumentFragment();
  for (let number = 1; number <= source.numPages; number++) {
    const row = document.createElement('div');
    row.className = 'import-pdf-page';
    const header = document.createElement('div');
    header.className = 'import-pdf-page-header';
    const title = document.createElement('strong');
    title.textContent = 'หน้า ' + number;
    const label = document.createElement('label');
    label.className = 'import-pdf-include';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', 'รวมหน้า ' + number);
    checkbox.addEventListener('change', () => togglePage(number, checkbox.checked));
    label.append(checkbox, 'รวมหน้านี้');
    header.append(title, label);

    const paper = document.createElement('div');
    paper.className = 'import-pdf-paper';
    row.append(header, paper);
    fragment.append(row);
    pages.set(row, {number, row, checkbox, paper});
  }
  container.replaceChildren(fragment);
  container.scrollTop = 0;

  // Keep full-size canvases only for pages near the scroll viewport.
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const view = pages.get(entry.target);
      if (!view) continue;
      if (entry.isIntersecting && !view.render) {
        view.render = new AbortController();
        view.paper.textContent = 'กำลังเปิดตัวอย่าง…';
        void renderPage(source, view, view.render.signal).then(() => {
          markEvidence(view, evidence?.page === view.number ? evidence.box : undefined);
        });
      } else if (!entry.isIntersecting && view.render) {
        view.render.abort();
        view.render = undefined;
        view.highlight = undefined;
        view.paper.replaceChildren();
      }
    }
  }, {root: container, rootMargin: '160px 0px'});
  for (const row of pages.keys()) observer.observe(row);

  return {
    showEvidence(next?: FieldOccurrence) {
      evidence = next;
      for (const view of pages.values()) {
        markEvidence(view, next?.page === view.number ? next.box : undefined);
        if (next?.page === view.number) {
          container.scrollTop += view.row.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
        }
      }
    },
    update(ranges: ReadonlyArray<{start: number; end: number}>, disabled: boolean, selectedOnly: boolean) {
      let index = 0;
      for (const {checkbox, number, row} of pages.values()) {
        while (ranges[index] && ranges[index].end < number) index++;
        const range = ranges[index];
        checkbox.checked = !!range && range.start <= number && number <= range.end;
        checkbox.disabled = disabled;
        row.hidden = selectedOnly && !checkbox.checked;
      }
    },
    dispose() {
      observer.disconnect();
      for (const view of pages.values()) view.render?.abort();
      pages.clear();
      container.replaceChildren();
    },
  };
}
