import type {PDFDocumentProxy, RenderTask} from 'pdfjs-dist';

const MOCK_BASE_CREDITS = 100;
const MOCK_INCLUDED_PAGES = 3;
const MOCK_EXTRA_PAGE_CREDITS = 20;

type PageRange = {start: number; end: number};

function mergeRanges(ranges: PageRange[]): PageRange[] {
  const merged: PageRange[] = [];
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({...range});
    }
  }
  return merged;
}

function parseRanges(selection: string, totalPages: number): PageRange[] | null {
  if (!selection.trim()) return [];
  const ranges: PageRange[] = [];
  for (const part of selection.split(',')) {
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > totalPages) return null;
    ranges.push({start, end});
  }

  return mergeRanges(ranges);
}

function removePage(ranges: PageRange[], page: number): PageRange[] {
  return ranges.flatMap(range => {
    if (page < range.start || page > range.end) return [range];
    return [
      {start: range.start, end: page - 1},
      {start: page + 1, end: range.end},
    ].filter(range => range.start <= range.end);
  });
}

async function openPdf(file: File, signal: AbortSignal): Promise<PDFDocumentProxy> {
  const [pdf, worker, data] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url'),
    file.arrayBuffer(),
  ]);
  signal.throwIfAborted();
  pdf.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdf.getDocument({data});
  const destroy = () => task.destroy().catch(() => {});
  const abort = () => { void destroy(); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    return await task.promise;
  } catch (error) {
    signal.removeEventListener('abort', abort);
    if (!signal.aborted) await destroy();
    throw error;
  }
}

export function setupPdfImportDialog() {
  const open = document.querySelector<HTMLButtonElement>('#import-pdf')!;
  const dialog = document.querySelector<HTMLDialogElement>('#import-pdf-dialog')!;
  const dropZone = dialog.querySelector<HTMLDivElement>('#import-pdf-drop')!;
  const choose = dialog.querySelector<HTMLButtonElement>('#import-pdf-choose')!;
  const fileInput = dialog.querySelector<HTMLInputElement>('#import-pdf-file')!;
  const status = dialog.querySelector('#import-pdf-status')!;
  const quote = dialog.querySelector<HTMLElement>('#import-pdf-quote')!;
  const fileName = dialog.querySelector('#import-pdf-name')!;
  const pages = dialog.querySelector<HTMLInputElement>('#import-pdf-pages')!;
  const pageError = dialog.querySelector<HTMLElement>('#import-pdf-page-error')!;
  const pageCount = dialog.querySelector('#import-pdf-page-count')!;
  const credits = dialog.querySelector('#import-pdf-credits')!;
  const previous = dialog.querySelector<HTMLButtonElement>('#import-pdf-prev')!;
  const next = dialog.querySelector<HTMLButtonElement>('#import-pdf-next')!;
  const previewPage = dialog.querySelector('#import-pdf-preview-page')!;
  const preview = dialog.querySelector('#import-pdf-preview')!;
  const paper = dialog.querySelector('#import-pdf-paper')!;
  const previewStatus = dialog.querySelector('#import-pdf-preview-status')!;
  const include = dialog.querySelector<HTMLInputElement>('#import-pdf-include')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('#import-pdf-confirm')!;
  let source: PDFDocumentProxy | undefined;
  let fileSession: AbortController | undefined;
  let currentPage = 1;
  let renderRevision = 0;
  let renderTask: RenderTask | undefined;

  function reset() {
    renderRevision++;
    renderTask?.cancel();
    renderTask = undefined;
    fileSession?.abort();
    fileSession = undefined;
    source = undefined;
    currentPage = 1;
    paper.replaceChildren();
    previewStatus.textContent = '';
    status.textContent = '';
    quote.hidden = true;
    confirm.disabled = true;
    pages.readOnly = false;
    dropZone.classList.remove('is-dragging');
  }

  function updateQuote() {
    if (!source) return;
    const totalPages = source.numPages;
    const ranges = parseRanges(pages.value, totalPages);
    const count = ranges?.reduce((sum, {start, end}) => sum + end - start + 1, 0) ?? 0;
    pages.setAttribute('aria-invalid', String(ranges === null));
    pageError.hidden = ranges !== null;
    pageError.textContent = ranges === null ? 'ระบุเลขหน้าตั้งแต่ 1 ถึง ' + totalPages : '';
    include.disabled = ranges === null || pages.readOnly;
    include.checked = ranges?.some(({start, end}) => start <= currentPage && currentPage <= end) ?? false;
    confirm.disabled = count === 0 || pages.readOnly;
    if (count === 0) {
      pageCount.textContent = ranges ? 'เลือกอย่างน้อย 1 หน้า' : '';
      credits.textContent = '';
      return;
    }

    const price = MOCK_BASE_CREDITS + MOCK_EXTRA_PAGE_CREDITS * Math.max(0, count - MOCK_INCLUDED_PAGES);
    pageCount.textContent = 'อ่าน ' + count + ' จาก ' + totalPages + ' หน้า';
    credits.textContent = price.toLocaleString('th-TH') + ' เครดิต';
  }

  async function showPage(pageNumber: number) {
    if (!source || pageNumber < 1 || pageNumber > source.numPages) return;
    const revision = ++renderRevision;
    renderTask?.cancel();
    renderTask = undefined;
    currentPage = pageNumber;
    previous.disabled = pageNumber === 1;
    next.disabled = pageNumber === source.numPages;
    previewPage.textContent = 'หน้า ' + pageNumber + ' จาก ' + source.numPages;
    updateQuote();
    paper.replaceChildren();
    preview.setAttribute('aria-busy', 'true');
    previewStatus.textContent = 'กำลังเปิดตัวอย่าง…';

    try {
      const page = await source.getPage(pageNumber);
      if (revision !== renderRevision) return;
      const bounds = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: Math.min(1150 / bounds.width, 1350 / bounds.height)});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'ตัวอย่าง PDF หน้า ' + pageNumber);
      renderTask = page.render({canvas, viewport});
      await renderTask.promise;
      if (revision !== renderRevision) return;
      paper.replaceChildren(canvas);
      previewStatus.textContent = '';
    } catch {
      if (revision === renderRevision) previewStatus.textContent = 'เปิดตัวอย่างหน้านี้ไม่ได้';
    } finally {
      if (revision === renderRevision) {
        preview.setAttribute('aria-busy', 'false');
        renderTask = undefined;
      }
    }
  }

  async function selectFile(files: FileList | null | undefined) {
    if (!files?.length) return;
    const [file] = files;
    reset();

    if (files.length !== 1) {
      status.textContent = 'กรุณาเลือก PDF ครั้งละหนึ่งไฟล์';
      return;
    }
    if (!/[.]pdf$/i.test(file.name) || file.size === 0) {
      status.textContent = 'กรุณาเลือกไฟล์ PDF ที่มีข้อมูล';
      return;
    }

    status.textContent = 'กำลังนับหน้า PDF…';
    const controller = new AbortController();
    fileSession = controller;
    try {
      const pdf = await openPdf(file, controller.signal);
      if (controller.signal.aborted) return;
      const count = pdf.numPages;
      if (count < 1) throw new Error('PDF has no pages');

      source = pdf;
      fileName.textContent = file.name;
      pages.value = count === 1 ? '1' : '1-' + count;
      quote.hidden = false;
      status.textContent = '';
      void showPage(1);
    } catch (error) {
      if (controller.signal.aborted) return;
      controller.abort();
      fileSession = undefined;
      status.textContent = error instanceof Error && error.name === 'PasswordException'
        ? 'ไฟล์ PDF มีรหัสผ่าน กรุณาเลือกไฟล์ที่เปิดได้โดยไม่ใช้รหัส'
        : 'เปิด PDF ไม่ได้ กรุณาเลือกไฟล์อื่น';
    }
  }

  open.addEventListener('click', () => {
    reset();
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) reset();
  });
  choose.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void selectFile(fileInput.files);
    fileInput.value = '';
  });
  pages.addEventListener('input', updateQuote);
  previous.addEventListener('click', () => { void showPage(currentPage - 1); });
  next.addEventListener('click', () => { void showPage(currentPage + 1); });
  include.addEventListener('change', () => {
    if (!source) return;
    const ranges = parseRanges(pages.value, source.numPages);
    if (!ranges) return;
    const selected = include.checked
      ? mergeRanges([...ranges, {start: currentPage, end: currentPage}])
      : removePage(ranges, currentPage);
    pages.value = selected.map(({start, end}) => start === end ? String(start) : start + '-' + end).join(', ');
    updateQuote();
  });
  confirm.addEventListener('click', () => {
    pages.readOnly = true;
    updateQuote();
    status.textContent = 'ยืนยันการทดลองแล้ว ยังไม่ได้หักเครดิต';
  });

  dialog.addEventListener('dragover', event => {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) return;
    const overDropZone = event.composedPath().includes(dropZone);
    event.dataTransfer.dropEffect = overDropZone ? 'copy' : 'none';
    dropZone.classList.toggle('is-dragging', overDropZone);
  });
  dropZone.addEventListener('dragleave', event => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !dropZone.contains(nextTarget)) {
      dropZone.classList.remove('is-dragging');
    }
  });
  dialog.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    if (event.composedPath().includes(dropZone)) {
      void selectFile(event.dataTransfer?.files);
    }
  });
}
