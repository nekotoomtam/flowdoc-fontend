const MOCK_BASE_CREDITS = 100;
const MOCK_INCLUDED_PAGES = 3;
const MOCK_EXTRA_PAGE_CREDITS = 20;

function selectedPageCount(selection: string, totalPages: number): number | null {
  const ranges: Array<{start: number; end: number}> = [];
  for (const part of selection.split(',')) {
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > totalPages) return null;
    ranges.push({start, end});
  }

  let count = 0;
  let countedThrough = 0;
  for (const {start, end} of ranges.sort((left, right) => left.start - right.start)) {
    count += Math.max(0, end - Math.max(start - 1, countedThrough));
    countedThrough = Math.max(countedThrough, end);
  }
  return count;
}

async function countPdfPages(file: File, signal: AbortSignal): Promise<number> {
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
    const document = await task.promise;
    return document.numPages;
  } finally {
    signal.removeEventListener('abort', abort);
    if (!signal.aborted) await destroy();
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
  const confirm = dialog.querySelector<HTMLButtonElement>('#import-pdf-confirm')!;
  let totalPages = 0;
  let reading: AbortController | undefined;

  function reset() {
    reading?.abort();
    reading = undefined;
    status.textContent = '';
    quote.hidden = true;
    confirm.disabled = true;
    pages.readOnly = false;
    totalPages = 0;
    dropZone.classList.remove('is-dragging');
  }

  function updateQuote() {
    const count = selectedPageCount(pages.value, totalPages);
    pages.setAttribute('aria-invalid', String(count === null));
    pageError.hidden = count !== null;
    pageError.textContent = count === null ? 'ระบุเลขหน้าตั้งแต่ 1 ถึง ' + totalPages + ' เช่น 1 หรือ 1-3' : '';
    confirm.disabled = count === null;
    if (count === null) {
      pageCount.textContent = '';
      credits.textContent = '';
      return;
    }

    const price = MOCK_BASE_CREDITS + MOCK_EXTRA_PAGE_CREDITS * Math.max(0, count - MOCK_INCLUDED_PAGES);
    pageCount.textContent = 'อ่าน ' + count + ' จาก ' + totalPages + ' หน้า';
    credits.textContent = price.toLocaleString('th-TH') + ' เครดิต';
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
    reading = controller;
    try {
      const count = await countPdfPages(file, controller.signal);
      if (controller.signal.aborted) return;
      if (count < 1) throw new Error('PDF has no pages');

      totalPages = count;
      fileName.textContent = file.name;
      pages.value = count === 1 ? '1' : '1-' + count;
      quote.hidden = false;
      status.textContent = '';
      updateQuote();
    } catch (error) {
      if (controller.signal.aborted) return;
      status.textContent = error instanceof Error && error.name === 'PasswordException'
        ? 'ไฟล์ PDF มีรหัสผ่าน กรุณาเลือกไฟล์ที่เปิดได้โดยไม่ใช้รหัส'
        : 'เปิด PDF ไม่ได้ กรุณาเลือกไฟล์อื่น';
    } finally {
      if (reading === controller) reading = undefined;
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
  confirm.addEventListener('click', () => {
    pages.readOnly = true;
    confirm.disabled = true;
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
