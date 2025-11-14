// Renderer: краткие комментарии о назначении функций и связях (preload -> main).
// Отвечает за UI: выбор папок, запуск мерджа, прогресс, лог, блокировку UI и спиннер.
// Также: управление темой и логикой авто-обновлений.

(() => {

function ensurePdfJsWorker() {
  try {
    const pdfjs = (window as any).pdfjsLib;
    if (pdfjs && pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
      console.debug('[pdfjs] workerSrc set');
    }
  } catch (e) {
    console.warn('[pdfjs] init error', e);
  }
}
document.addEventListener('DOMContentLoaded', ensurePdfJsWorker);


let mainFolder = '';
let insertFolder = '';
let outputFolder = '';
let insertDict: Record<string, string> = {};
let zepbDict: Record<string, string> = {};
let lastSelectedMainFolder: string | null = null;
let lastSelectedInsertFolder: string | null = null;
let lastSelectedOutputFolder: string | null = null;
let lastSelectedCompress: string | null = null;
let compressOutputFolder: string | null = null;
let lastSelectedCompressOutputFolder: string | null = null;
let lastReportPath: string | null = null;
let isCompressRunning: boolean = false;
let cancelCompressRequested: boolean = false;
let droppedFiles: string[] = [];

/* DOM элементы */
const navMode1 = document.getElementById('nav-mode1') as HTMLButtonElement;
const navMode2 = document.getElementById('nav-mode-compress') as HTMLButtonElement;
const navSettings = document.getElementById('nav-settings') as HTMLButtonElement;

const mode1Content = document.getElementById('mode1-content') as HTMLDivElement;
const mode2Content = document.getElementById('compress-content') as HTMLDivElement;
const settingsContent = document.getElementById('settings-content') as HTMLDivElement;

const btnMain = document.getElementById('btn-main') as HTMLButtonElement;
const labelMain = document.getElementById('label-main') as HTMLInputElement;
const chkMainRecursive = document.getElementById('chk-main-recursive') as HTMLInputElement;
const btnInsert = document.getElementById('btn-insert') as HTMLButtonElement;
const labelInsert = document.getElementById('label-insert') as HTMLInputElement;
const chkInsertRecursive = document.getElementById('chk-insert-recursive') as HTMLInputElement;
const btnOutput = document.getElementById('btn-output') as HTMLButtonElement;
const labelOutput = document.getElementById('label-output') as HTMLInputElement;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnOpenOutput = document.getElementById('btn-open-output') as HTMLButtonElement;
const btnClearSettings = document.getElementById('btn-clear-settings') as HTMLButtonElement;

const statsZepb = document.getElementById('stats-zepb') as HTMLSpanElement;
const statsNotif = document.getElementById('stats-notif') as HTMLSpanElement;
const statsOutput = document.getElementById('stats-output') as HTMLSpanElement;
const statsStatus = document.getElementById('stats-status') as HTMLSpanElement;
const statsResults = document.getElementById('stats-results') as HTMLDivElement;
const statsSuccess = document.getElementById('stats-success') as HTMLSpanElement;
const statsSkipped = document.getElementById('stats-skipped') as HTMLSpanElement;
const statsTotal = document.getElementById('stats-total') as HTMLSpanElement;

const logContainer = document.getElementById('log-container') as HTMLDivElement;
const logArea = document.getElementById('log') as HTMLTextAreaElement;
const progressBarFill = document.getElementById('progress-bar-fill') as HTMLDivElement;

/* Settings controls (theme + updates) */
const themeToggleCheckbox = document.getElementById('theme-toggle-checkbox') as HTMLInputElement;
const btnCheckUpdate = document.getElementById('btn-check-update') as HTMLButtonElement;
const updateStatusSpan = document.getElementById('update-status') as HTMLSpanElement;
const btnUpdateApp = document.getElementById('btn-update-app') as HTMLButtonElement;
const settingCompressQuality = document.getElementById('setting-compress-quality') as HTMLSelectElement | null;
const settingThumbsEnabled   = document.getElementById('setting-thumbnails-enabled') as HTMLInputElement | null;
const settingThumbSize       = document.getElementById('setting-thumbnail-size') as HTMLSelectElement | null;

/* Feedback controls */
const feedbackTypeSelect = document.getElementById('feedback-type') as HTMLSelectElement;
const feedbackMessageTextarea = document.getElementById('feedback-message') as HTMLTextAreaElement;
const feedbackIncludeLogCheckbox = document.getElementById('feedback-include-log') as HTMLInputElement;
const btnSendFeedback = document.getElementById('btn-send-feedback') as HTMLButtonElement;
const feedbackStatusSpan = document.getElementById('feedback-status') as HTMLSpanElement;

/* Update notification elements */
const updateNotification = document.getElementById('update-notification') as HTMLDivElement;
const updateNotificationText = document.getElementById('update-notification-text') as HTMLParagraphElement;
const btnUpdatePopup = document.getElementById('btn-update-popup') as HTMLButtonElement;
const btnDismissPopup = document.getElementById('btn-dismiss-popup') as HTMLButtonElement;

/* Compress controls */
const btnCompress = document.getElementById('btn-compress') as HTMLButtonElement | null;
const btnCompressOutput = document.getElementById('btn-compress-output') as HTMLButtonElement | null;
const btnCompressRun = document.getElementById('btn-compress-run') as HTMLButtonElement | null;
const labelCompress = document.getElementById('label-compress') as HTMLInputElement | null;
const labelCompressOutput = document.getElementById('label-compress-output') as HTMLInputElement | null;
const selectCompressQuality = document.getElementById('compress-quality') as HTMLSelectElement | null;
const compressProgressFill = document.getElementById('compress-progress-fill') as HTMLDivElement | null;
const compressProgressPercent = document.getElementById('compress-progress-percent') as HTMLSpanElement | null;
const compressStatusLabel = document.getElementById('compress-status-label') as HTMLSpanElement | null;
const compressTableBody = document.querySelector('#compress-table tbody') as HTMLTableSectionElement | null;
const btnOpenReport = document.getElementById('btn-open-report') as HTMLButtonElement | null;
const btnCompressClear = document.getElementById('btn-compress-clear') as HTMLButtonElement | null;

/* Динамически создаём кнопку "Открыть лог", если её нет в DOM */
(function ensureLogButton() {
  if (document.getElementById('btn-open-log')) return;
  const controlsRow = document.querySelector('.controls-row') as HTMLDivElement | null;
  const btn = document.createElement('button');
  btn.id = 'btn-open-log';
  btn.className = 'btn btn-outline';
  btn.textContent = 'Открыть лог';
  if (controlsRow && btnClearSettings) controlsRow.insertBefore(btn, btnClearSettings);
})();

/* Spinner overlay — создаём и добавляем в DOM, если нет; содержит кнопку Отмена */
(function ensureSpinner() {
  if (document.getElementById('spinner-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'spinner-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(255,255,255,0.6)';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';
  overlay.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
    <div style="width:40px;height:40px;border:4px solid #ccc;border-top-color:#111;border-radius:50%;animation:spin 1s linear infinite;"></div>
    <div id="busy-label">Выполняется...</div>
    <div style="height:8px"></div>
    <button id="btn-cancel-op" class="btn btn-primary">Отменить</button>
  </div>`;
  document.body.appendChild(overlay);
  const style = document.createElement('style');
  style.innerHTML = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);

  // Кнопка отмены: отменяет текущую операцию (merge или compress)
  overlay.querySelector('#btn-cancel-op')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      if (isCompressRunning) {
        cancelCompressRequested = true;
        // БЫЛО: manual background/text
        // СТАЛО: тема-френдли через классы
        setCompressStatus('cancel', 'Отмена…');
        if (compressProgressFill) compressProgressFill.classList.add('is-cancel');
        const busyLabel = document.getElementById('busy-label');
        if (busyLabel) busyLabel.textContent = 'Останавливается…';
        await window.electronAPI.cancelCompress();
        log('Запрошена отмена сжатия', 'warning');
        showPopup('Запрос отмены сжатия отправлен', 4000);
      } else {
        await window.electronAPI.cancelMerge();
        log('Запрошена отмена объединения', 'warning');
        showPopup('Запрос отмены объединения отправлен', 4000);
      }
    } catch {
      showPopup('Ошибка отправки запроса отмены', 6000);
    } finally {
      setTimeout(() => { btn.disabled = false; }, 1500);
    }
  });
})();

(function setupCompressDrop() {
  const dropEl = document.getElementById('compress-drop-hint') as HTMLDivElement | null;
  if (!dropEl) return;

  const onDragOver = (ev: DragEvent) => { ev.preventDefault(); dropEl.classList.add('drop-over'); };
  const onDragLeave = (ev: DragEvent) => { ev.preventDefault(); dropEl.classList.remove('drop-over'); };

  const onDrop = async (ev: DragEvent) => {
    ev.preventDefault();
    dropEl.classList.remove('drop-over');
    const filesList = Array.from(ev.dataTransfer?.files || []);
    if (filesList.length === 0) return;
    const paths = filesList.map(f => (f as any).path).filter(Boolean) as string[];
    if (paths.length === 0) return;

    // Если одна папка — назначаем входную папку
    if (paths.length === 1) {
      try {
        const isDir = await window.electronAPI.pathIsDirectory(paths[0]);
        if (isDir) {
          lastSelectedCompress = paths[0];
          if (labelCompress) labelCompress.value = paths[0];
          droppedFiles = [];
          const countEl = document.getElementById('compress-drop-count') as HTMLSpanElement | null;
          if (countEl) { countEl.style.display = 'none'; countEl.textContent = '0'; }
          updateCompressReady();
          try { await saveSettings(); } catch {}
          showPopup('Папка назначена как вход', 3000);
          return;
        }
      } catch { /* ignore */ }
    }

    const pdfs = paths.filter(p => p.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) { showPopup('Перетащите только PDF файлы', 4000); return; }

    droppedFiles = pdfs;
    const countEl = document.getElementById('compress-drop-count') as HTMLSpanElement | null;
    if (countEl) { countEl.style.display = ''; countEl.textContent = String(droppedFiles.length); }
    if (labelCompress) labelCompress.value = 'Перетащено файлов: ' + droppedFiles.length;
    updateCompressReady();
    showPopup(`Принято ${droppedFiles.length} PDF`, 3000);
  };

  dropEl.addEventListener('dragover', onDragOver);
  dropEl.addEventListener('dragleave', onDragLeave);
  dropEl.addEventListener('drop', onDrop);
})();

function getCompressQuality(): number {
  const v = settingCompressQuality ? parseInt(settingCompressQuality.value, 10) : 30;
  return Number.isFinite(v) ? v : 30;
}
function getThumbsEnabled(): boolean {
  return settingThumbsEnabled ? !!settingThumbsEnabled.checked : true;
}
function getThumbSize(): number {
  const v = settingThumbSize ? parseInt(settingThumbSize.value, 10) : 128;
  return Number.isFinite(v) ? v : 128;
}

// === Drag&Drop миниатюры для compress-drop-hint (Единая версия) ===
interface CompressDroppedFile {
  path: string;
  name: string;
  type: string;
  thumb?: string;
  error?: string;
}

const cdZone = document.getElementById('compress-drop-hint') as HTMLDivElement | null;
const cdCount = document.getElementById('compress-drop-count') as HTMLSpanElement | null;
const cdGallery = document.getElementById('compress-dd-gallery') as HTMLDivElement | null;
const cdBtnClear = document.getElementById('compress-dd-clear') as HTMLButtonElement | null;
const cdBtnRun = document.getElementById('compress-dd-run') as HTMLButtonElement | null;
const cdThumbs = document.getElementById('compress-dd-thumbs') as HTMLInputElement | null;
const cdSizeSelect = document.getElementById('compress-dd-size') as HTMLSelectElement | null;

let compressDropped: CompressDroppedFile[] = [];

function updateCompressDnDState(): void {
  if (!cdGallery) return;
  cdGallery.innerHTML = '';
  if (compressDropped.length === 0) {
    cdGallery.classList.add('empty');
    if (cdCount) cdCount.style.display = 'none';
    if (cdBtnClear) cdBtnClear.disabled = true;
    if (cdBtnRun) cdBtnRun.disabled = true;
    return;
  }
  cdGallery.classList.remove('empty');
  if (cdCount) {
    cdCount.style.display = 'inline-block';
    cdCount.textContent = String(compressDropped.length);
  }
  if (cdBtnClear) cdBtnClear.disabled = false;
  if (cdBtnRun) cdBtnRun.disabled = false;

  const size = getThumbSize();
  const showThumbs = getThumbsEnabled();

  compressDropped.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'compress-dd-item';
    item.style.minHeight = size + 'px';

    const thumb = document.createElement('div');
    thumb.className = 'compress-dd-thumb';
    thumb.style.height = size + 'px';

    if (showThumbs) {
      if (file.thumb) {
        const img = document.createElement('img');
        img.src = file.thumb;
        img.alt = file.name;
        thumb.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.style.fontSize = '11px';
        span.style.color = 'var(--text-muted,#666)';
        span.textContent = file.error
          ? 'Ошибка'
          : (file.type === 'application/pdf' ? 'PDF' : 'Нет превью');
        thumb.appendChild(span);
      }
    } else {
      const span = document.createElement('span');
      span.style.fontSize = '11px';
      span.style.color = 'var(--text-muted,#666)';
      span.textContent = file.name;
      thumb.appendChild(span);
    }

    const meta = document.createElement('div');
    meta.className = 'compress-dd-meta';
    meta.textContent = file.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'compress-dd-remove';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '×';
    removeBtn.title = 'Удалить';
    removeBtn.addEventListener('click', () => {
      compressDropped.splice(idx, 1);
      updateCompressDnDState();
    });

    item.appendChild(thumb);
    item.appendChild(meta);
    item.appendChild(removeBtn);
    cdGallery.appendChild(item);
  });
}

async function buildPdfThumb(target: CompressDroppedFile): Promise<void> {
  try {
    const pdfjs = (window as any).pdfjsLib;
    if (!pdfjs) return;
    const resp = await window.electronAPI.readFileBuffer(target.path);
    if (!resp.ok || !resp.data) {
      target.error = resp.error || 'read error';
      return;
    }
    const bytes = new Uint8Array(resp.data);
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.6 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) { target.error = 'canvas error'; return; }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    target.thumb = canvas.toDataURL('image/png');
  } catch (e) {
    target.error = (e as Error).message;
  }
}

async function handleCompressDrop(list: FileList): Promise<void> {
  const newItems: CompressDroppedFile[] = [];
  for (const f of Array.from(list)) {
    const anyF: any = f;
    const fullPath: string | undefined = anyF.path;
    if (!fullPath) continue;
    const type = f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    newItems.push({ path: fullPath, name: f.name, type });
  }

  compressDropped.push(...newItems);

  for (const it of newItems) {
    if (it.type === 'application/pdf') {
      await buildPdfThumb(it);
    }
  }
  updateCompressDnDState();
}

function initCompressDropzone(): void {
  if (!cdZone) return;

  cdZone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf';
    input.addEventListener('change', () => {
      if (input.files && input.files.length) void handleCompressDrop(input.files);
    });
    input.click();
  });

  ['dragenter','dragover'].forEach(evt => {
    cdZone.addEventListener(evt, e => {
      e.preventDefault();
      cdZone.classList.add('dragover');
    });
  });
  ['dragleave','dragend'].forEach(evt => {
    cdZone.addEventListener(evt, e => {
      e.preventDefault();
      cdZone.classList.remove('dragover');
    });
  });
  cdZone.addEventListener('drop', e => {
    e.preventDefault();
    cdZone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length) void handleCompressDrop(files);
  });

  cdBtnClear?.addEventListener('click', () => {
    compressDropped = [];
    updateCompressDnDState();
  });

  // Настройки в Settings управляют галереей
  settingThumbsEnabled?.addEventListener('change', () => updateCompressDnDState());
  settingThumbSize?.addEventListener('change', () => updateCompressDnDState());

  updateCompressDnDState();
}

initCompressDropzone();

function setCompressStatus(state: 'idle' | 'running' | 'cancel' | 'done', text: string) {
  const el = document.getElementById('compress-status-label') as HTMLSpanElement | null;
  if (!el) return;
  // Удаляем возможные старые inline стили (на случай прежних версий)
  el.removeAttribute('style');
  el.classList.remove('status--idle','status--running','status--cancel','status--done');
  el.classList.add(`status--${state}`);
  el.textContent = text;

  // Диагностика (можно временно оставить)
  const themeAttr = document.documentElement.getAttribute('data-theme');
  console.debug('[CompressStatus] state=', state, 'text=', text, 'data-theme=', themeAttr);
}

/* Очистка таблицы и прогресса перед новой обработкой */
function clearCompressTable() {
  try {
    if (compressTableBody) compressTableBody.innerHTML = '';
    if (compressProgressFill) {
      compressProgressFill.style.width = '0%';
      compressProgressFill.classList.remove('is-cancel');
    }
    if (compressProgressPercent) compressProgressPercent.textContent = '0%';
    setCompressStatus('idle', 'Ожидание');
  } catch (e) { console.error('clearCompressTable error', e); }
}

/* Логирование — локально и отправка в main (logStore) */
const log = (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  const ts = new Date().toLocaleTimeString();
  const lvl = level === 'warning' ? 'WARN' : level === 'success' ? 'INFO' : level.toUpperCase();
  const line = `[${ts}] [${lvl}] ${message}`;
  if (logArea) {
    logArea.value += line + '\n';
    logArea.scrollTop = logArea.scrollHeight;
  }
  try { window.electronAPI.appendLog(line); } catch { /* ignore */ }
};

// Aктивация кнопки запуска сжатия: включаем, когда выбраны входная и выходная папки
function updateCompressReady() {
  const hasInput = (labelCompress && labelCompress.value && labelCompress.value !== 'Не выбрана') || (droppedFiles && droppedFiles.length > 0);
  const hasOutput = compressOutputFolder && compressOutputFolder !== '';
  if (btnCompressRun) btnCompressRun.disabled = !(!!hasInput && !!hasOutput);
}

// Кнопка выбора папки с PDF для сжатия
  if (btnCompress) btnCompress.addEventListener('click', async () => {
    const orig = btnCompress.innerHTML;
    btnCompress.innerHTML = '<i data-lucide="loader" class="loader"></i> Сканирование...';
    btnCompress.disabled = true;
    try {
      const folder = await window.electronAPI.selectFolder(lastSelectedCompress ?? undefined);
      if (folder) {
        lastSelectedCompress = folder;
        try {
          const pdfCount = await window.electronAPI.countPdfFilesInFolder(folder!);
          if (typeof pdfCount === 'number' && pdfCount === 0) {
            log(`Выбранная папка ${folder} не содержит PDF`, 'warning');
            showPopup('В выбранной папке нет pdf файлов', 6000);
          }
        } catch (err) {
          log(`Ошибка проверки PDF в выбранной папке: ${(err as Error).message}`, 'error');
        }
        if (labelCompress) labelCompress.value = folder;

        // Если папка вывода для сжатия не выбрана — автоназначим ту же папку (удобство)
        if (!compressOutputFolder) {
          compressOutputFolder = folder;
          lastSelectedCompressOutputFolder = folder;
          if (labelCompressOutput) labelCompressOutput.value = folder;
          try { await saveSettings(); } catch { /* ignore */ }
        }
      }
      try {
        // Используем существующий метод preload -> main (countFilesInFolder)
        const cnt = await window.electronAPI.countFilesInFolder(folder!);
        if (typeof cnt === 'number' && cnt === 0) {
          const msg = `Выбранная папка "${folder}" пуста`;
          log(msg, 'warning');
          showPopup('В выбранной папке нет файлов PDF', 6000);
        } else {
          // можно логировать число файлов (необязательно)
          log(`В папке "${folder}" найдено ${typeof cnt === 'number' ? cnt : '?'} файлов`, 'info');
        }
      } catch (err) {
        log(`Ошибка проверки папки: ${(err as Error).message}`, 'error');
      }
      updateCompressReady();
    } finally {
      btnCompress.innerHTML = orig;
      btnCompress.disabled = false;
    }
  });

  // Обработчик выбора папки вывода для сжатия
  if (btnCompressOutput) btnCompressOutput.addEventListener('click', async () => {
    const orig = btnCompressOutput.innerHTML;
    btnCompressOutput.innerHTML = '<i data-lucide="loader" class="loader"></i> Сканирование...';
    btnCompressOutput.disabled = true;
    try {
      const folder = await window.electronAPI.selectFolder(lastSelectedCompressOutputFolder ?? undefined);
      if (folder) {
        compressOutputFolder = folder;
        lastSelectedCompressOutputFolder = folder;
        if (labelCompressOutput) labelCompressOutput.value = folder;
        try { await saveSettings(); } catch { /* ignore */ }
      }
      try {
        const cntOut = await window.electronAPI.countFilesInFolder(folder!).catch(() => -1);
        log(`Папка вывода для сжатия установлена: ${folder}`, 'info');
        if (typeof cntOut === 'number' && cntOut === 0) {
          showPopup('Папка вывода пуста (это нормально)', 4000);
        }
      } catch (err) {
        log(`Ошибка проверки папки вывода: ${(err as Error).message}`, 'error');
      }
      updateCompressReady();
    } finally {
      btnCompressOutput.innerHTML = orig;
      btnCompressOutput.disabled = false;
    }
  });

  /* Запуск сжатия */
  if (btnCompressRun) btnCompressRun.addEventListener('click', async () => {
    // вход — либо выбранная папка, либо droppedFiles
    if (!labelCompress || !labelCompress.value || !compressOutputFolder) {
      showPopup('Выберите входную и выходную папки для сжатия', 5000);
      return;
    }

    if (!compressOutputFolder) {
      const msg = 'Папка результатов не выбрана';
      log(msg, 'warning');
      showPopup('Выберите папку результатов (выход)', 6000);
      return;
    }

    // если выбранная входная папка (не droppedFiles) — проверим её наличие и непустоту по PDF
    if ((!droppedFiles || droppedFiles.length === 0) && labelCompress && labelCompress.value && labelCompress.value !== 'Не выбрана') {
      try {
        const pdfCount = await window.electronAPI.countPdfFilesInFolder(labelCompress.value);
        if (typeof pdfCount === 'number') {
          if (pdfCount === 0) {
            const msg = `В выбранной папке "${labelCompress.value}" нет PDF файлов`;
            log(msg, 'warning');
            showPopup('В выбранной папке нет pdf файлов', 6000);
            return;
          } else {
            log(`В папке входа найдено ${pdfCount} PDF файлов`, 'info');
          }
        } else {
          log(`Не удалось определить количество PDF в папке ${labelCompress.value}`, 'warning');
        }
      } catch (err) {
        log(`Ошибка проверки PDF в входной папке: ${(err as Error).message}`, 'error');
        showPopup('Ошибка при проверке папки входа. Проверьте лог.', 6000);
        return;
      }
    }

    // Всё ок — продолжаем запуск
    const quality = getCompressQuality();
    log(`Запущено сжатие: ${labelCompress.value} -> ${compressOutputFolder}, качество ${quality}%`, 'info');

    isCompressRunning = true;
    setCompressStatus('running', 'Выполняется…');
    setBusy(true);
    try {
      clearCompressTable();

      if (droppedFiles && droppedFiles.length > 0) {
        const res = await window.electronAPI.compressFiles({ files: droppedFiles, outputFolder: compressOutputFolder!, quality });
        if (res && Array.isArray(res.log)) res.log.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : 'info'));
      } else {
        const res = await window.electronAPI.compressPDFs({ inputFolder: labelCompress!.value, outputFolder: compressOutputFolder!, quality });
        if (res && Array.isArray(res.log)) res.log.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : 'info'));
      }

      updateStats();
    } catch (err) {
      log(`Ошибка при сжатии: ${(err as Error).message}`, 'error');
      showPopup('Ошибка при сжатии. Проверьте лог.', 8000);
    } finally {
      // очистка droppedFiles и восстановление UI
      droppedFiles = [];
      const countEl = document.getElementById('compress-drop-count') as HTMLSpanElement | null;
      if (countEl) { countEl.style.display = 'none'; countEl.textContent = '0'; }
      if (labelCompress && lastSelectedCompress) labelCompress.value = lastSelectedCompress;
      isCompressRunning = false;
      setBusy(false);
    }
  });

  if (btnCompressClear) btnCompressClear.addEventListener('click', async () => {
    if (!confirm('Очистить настройки сжатия?')) return;

    // Сбросим переменные состояния
    lastSelectedCompress = null;
    lastSelectedCompressOutputFolder = null;
    compressOutputFolder = null;
    droppedFiles = [];

    // Обновим UI поля
    try {
      if (labelCompress) updateFolderLabel(labelCompress, null);
      if (labelCompressOutput) updateFolderLabel(labelCompressOutput, null);
    } catch (e) { /* ignore */ }

    // Сохраним пустые настройки
    try { await saveSettings(); } catch (err) { log(`Ошибка сохранения настроек: ${(err as Error).message}`, 'error'); }

    // Очистка таблицы и прогресса
    try { clearCompressTable(); } catch {}

    log('Настройки сжатия очищены', 'warning');
    showPopup('Настройки сжатия очищены', 4000);
    updateCompressReady();
  });

  // В обработчик "Сжать добавленные" для drag&drop
cdBtnRun?.addEventListener('click', async () => {
  if (!compressDropped.length) return;
  if (!compressOutputFolder) {
    showPopup('Сначала выберите папку вывода (Сжатие PDF)', 5000);
    return;
  }
  const pdfPaths = compressDropped
    .filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    .map(f => f.path);
  if (!pdfPaths.length) { showPopup('Нет PDF для сжатия', 4000); return; }

  const quality = getCompressQuality();
  log(`Сжатие (drag): ${pdfPaths.length} файлов -> ${compressOutputFolder}, качество ${quality}%`, 'info');

  setBusy(true);
  try {
    const res = await window.electronAPI.compressFiles({ files: pdfPaths, outputFolder: compressOutputFolder, quality });
    res.log?.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : 'info'));
    showPopup(`Сжатие завершено: ${res.processed}/${res.total}`, 6000);
  } catch (err) {
    log(`Ошибка сжатия (drag): ${(err as Error).message}`, 'error');
    showPopup('Ошибка сжатия drag&drop.', 8000);
  } finally {
    setBusy(false);
  }
});

  function layoutCompressResize() {
  try {
    const wrap = document.getElementById('compress-table-wrap') as HTMLDivElement | null;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const bottomPadding = 24;
    const avail = Math.max(220, Math.floor(window.innerHeight - rect.top - bottomPadding));
    wrap.style.height = `${avail}px`;
    wrap.style.maxHeight = `${avail}px`;
  } catch (e) { console.error('layoutCompressResize error', e); }
}
window.addEventListener('resize', () => { try { layoutCompressResize(); } catch {} });

// Обработчик прогресса — обновляет/добавляет строку и прогресс бар
window.electronAPI.onCompressProgress((_, payload) => {
  try {
    const { index, total, name, inSize, outSize, ok, error, notes } = payload as {
      index: number;
      total: number;
      name: string;
      inSize?: number;
      outSize?: number;
      ok: boolean;
      error?: string | null;
      notes?: string | null;
    };

    // Обновление/создание строки в таблице
    if (compressTableBody) {
      const safeName = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/"/g, '\\"');
      let row = compressTableBody.querySelector(`tr[data-name="${safeName}"]`) as HTMLTableRowElement | null;

      if (!row) {
        row = document.createElement('tr');
        row.setAttribute('data-name', name);
        row.innerHTML = `
          <td>${index}</td>
          <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</td>
          <td>${inSize ? formatBytes(inSize) : ''}</td>
          <td>${outSize ? formatBytes(outSize) : ''}</td>
          <td>${computePercent(inSize, outSize)}</td>
          <td>${ok ? (notes || 'OK') : (error || 'ERROR')}</td>
        `;
        compressTableBody.appendChild(row);
      } else {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
          cells[0].textContent = String(index);
          // cells[1] (имя) — не трогаем
          cells[2].textContent = inSize ? formatBytes(inSize) : '';
          cells[3].textContent = outSize ? formatBytes(outSize) : '';
          cells[4].textContent = computePercent(inSize, outSize);
          cells[5].textContent = ok ? (notes || 'OK') : (error || 'ERROR');
        }
      }
    }

    // Прогресс (один расчёт процента)
    if (compressProgressFill && Number.isFinite(index) && Number.isFinite(total) && total > 0) {
      const percent = Math.max(0, Math.min(100, Math.round((index / total) * 100)));
      compressProgressFill.style.width = `${percent}%`;
      if (compressProgressPercent) compressProgressPercent.textContent = `${percent}%`;
    }
  } catch (e) {
    console.error('compress-progress handler error', e);
  }
});

// Обработчик завершения — включает кнопку отчёта и показывает уведомление
window.electronAPI.onCompressComplete((_, payload) => {
  try {
    const { processed, total, log } = payload as any;
    const canceled = Array.isArray(log) && log.some((m: string) => /отмен[а|ено]/i.test(m));

    if (compressProgressFill) {
      compressProgressFill.style.width = '100%';
      compressProgressFill.classList.remove('is-cancel');
    }
    if (compressProgressPercent) compressProgressPercent.textContent = '100%';

    if (canceled) {
      setCompressStatus('cancel', 'Отменено');
      showPopup(`Сжатие отменено (${processed}/${total})`, 8000);
    } else {
      setCompressStatus('done', 'Готово');
      showPopup(`Сжатие завершено: ${processed}/${total}`, 8000);
    }

    log && Array.isArray(log) && log.forEach((m: string) => logMessage(m));
  } finally {
    isCompressRunning = false;
    cancelCompressRequested = false;
    setBusy(false);
  }
});

// Вспомогательные функции
function computePercent(inSize?: number, outSize?: number) {
  if (!inSize || !outSize) return '';
  const diff = inSize - outSize;
  const pct = Math.round((diff / inSize) * 100);
  return pct >= 0 ? `-${pct}%` : `+${-pct}%`;
}
function formatBytes(bytes?: number) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Лог через привычную функцию (имя отличается от window.log)
function logMessage(msg: string) { try { log(msg, msg.includes('Ошибка') ? 'error' : msg.includes('GS') ? 'info' : 'info'); } catch { console.log(msg); } }

/* Блокировка UI и показ/скрытие спиннера */
const setBusy = (busy: boolean) => {
  const elements = [
    btnMain, btnInsert, btnOutput, btnRun, document.getElementById('btn-open-log') as HTMLButtonElement,
    btnOpenOutput, btnClearSettings, btnCompress, btnCompressRun, btnSendFeedback, btnCheckUpdate, btnUpdateApp
  ];
  elements.forEach(el => { if (el) el.disabled = busy; });
  const overlay = document.getElementById('spinner-overlay') as HTMLDivElement | null;
  if (overlay) overlay.style.display = busy ? 'flex' : 'none';
};

/* UI вспомогательные */
const updateStats = () => {
  statsZepb.textContent = Object.keys(zepbDict).length.toString();
  statsNotif.textContent = Object.keys(insertDict).length.toString();
  if (outputFolder) {
    window.electronAPI.countFilesInFolder(outputFolder).then(c => statsOutput.textContent = c.toString()).catch(() => statsOutput.textContent = '?');
  } else statsOutput.textContent = '0';
};

const checkReady = () => {
  if (mainFolder && insertFolder && outputFolder) {
    btnRun.disabled = false;
    statsStatus.textContent = 'Готово к объединению';
    statsStatus.className = 'status-ready';
  } else {
    btnRun.disabled = true;
    statsStatus.textContent = 'Выберите все папки';
    statsStatus.className = 'status-not-ready';
  }
};

const updateFolderLabel = (el: HTMLInputElement, folder: string | null) => {
  el.value = folder || 'Не выбрана';
  el.style.color = folder ? '' : '#6b7280';
};

/* Загрузка/сохранение настроек */
const loadSettings = async () => {
  try {
    const s = await window.electronAPI.loadSettings();

    // --- Основные папки ---
    if (s.mainFolder) {
      mainFolder = s.mainFolder;
      lastSelectedMainFolder = s.mainFolder;
      updateFolderLabel(labelMain, mainFolder);
      try {
        zepbDict = await window.electronAPI.buildDict(
          'zepb',
          mainFolder,
          !!s.mainRecursive
        );
      } catch {
        zepbDict = {};
      }
    } else {
      mainFolder = '';
      updateFolderLabel(labelMain, null);
      zepbDict = {};
    }

    if (s.insertFolder) {
      insertFolder = s.insertFolder;
      lastSelectedInsertFolder = s.insertFolder;
      updateFolderLabel(labelInsert, insertFolder);
      try {
        insertDict = await window.electronAPI.buildDict(
          'insert',
            insertFolder,
          !!s.insertRecursive
        );
      } catch {
        insertDict = {};
      }
    } else {
      insertFolder = '';
      updateFolderLabel(labelInsert, null);
      insertDict = {};
    }

    if (s.outputFolder) {
      outputFolder = s.outputFolder;
      lastSelectedOutputFolder = s.outputFolder;
      updateFolderLabel(labelOutput, outputFolder);
      const btnOpenOut = document.getElementById('btn-open-output') as HTMLButtonElement | null;
      if (btnOpenOut) btnOpenOut.disabled = false;
    } else {
      outputFolder = '';
      updateFolderLabel(labelOutput, null);
      const btnOpenOut = document.getElementById('btn-open-output') as HTMLButtonElement | null;
      if (btnOpenOut) btnOpenOut.disabled = true;
    }

    // --- Рекурсивные чекбоксы ---
    if (typeof s.mainRecursive === 'boolean') chkMainRecursive.checked = s.mainRecursive;
    if (typeof s.insertRecursive === 'boolean') chkInsertRecursive.checked = s.insertRecursive;

    // --- Папки / состояние режима сжатия (drag&drop + обычный) ---
    if (s.compressInputFolder && labelCompress) {
      // Сохраняем и показываем, если есть
      lastSelectedCompress = s.compressInputFolder;
      labelCompress.value = s.compressInputFolder;
    }

    if (s.compressOutputFolder) {
      compressOutputFolder = s.compressOutputFolder;
      lastSelectedCompressOutputFolder = s.compressOutputFolder;
      if (labelCompressOutput) {
        updateFolderLabel(labelCompressOutput, compressOutputFolder);
      }
    } else {
      compressOutputFolder = null;
      if (labelCompressOutput) updateFolderLabel(labelCompressOutput, null);
    }

    // --- Настройки качества (перенесены в Settings) ---
    if (s.compressQuality && settingCompressQuality) {
      const q = parseInt(String(s.compressQuality), 10);
      if (!isNaN(q)) settingCompressQuality.value = String(q);
    }

    // --- Настройки миниатюр (перенесены в Settings) ---
    if (typeof s.thumbnailsEnabled === 'boolean' && settingThumbsEnabled) {
      settingThumbsEnabled.checked = s.thumbnailsEnabled;
    }
    if (s.thumbnailSize && settingThumbSize) {
      const ts = parseInt(String(s.thumbnailSize), 10);
      if (!isNaN(ts)) settingThumbSize.value = String(ts);
    }

    // --- Обновление UI ---
    updateStats();
    checkReady();
    updateCompressReady();      // активность кнопки "Начать сжатие"
    updateCompressDnDState();   // перерисовка галереи с учетом настроек

  } catch (err) {
    console.error('Ошибка загрузки настроек', err);
  }
};

const saveSettings = async () => {
  // Собираем объект настроек для записи
  const settingsToSave: any = {
    // Основные папки
    mainFolder,
    insertFolder,
    outputFolder,

    // Флаги рекурсии
    mainRecursive: chkMainRecursive.checked,
    insertRecursive: chkInsertRecursive.checked,

    // Последние выбранные пути
    lastSelectedMainFolder,
    lastSelectedInsertFolder,
    lastSelectedOutputFolder,

    // Папки режима сжатия
    compressInputFolder: (labelCompress && labelCompress.value && labelCompress.value !== 'Не выбрана')
      ? labelCompress.value
      : (lastSelectedCompress ?? null),
    compressOutputFolder: compressOutputFolder ?? null,
    lastSelectedCompress: lastSelectedCompress ?? null,
    lastSelectedCompressOutputFolder: lastSelectedCompressOutputFolder ?? null,

    // Настройки качества (из Settings)
    compressQuality: settingCompressQuality
      ? parseInt(settingCompressQuality.value, 10)
      : undefined,

    // Миниатюры drag&drop
    thumbnailsEnabled: settingThumbsEnabled
      ? !!settingThumbsEnabled.checked
      : undefined,
    thumbnailSize: settingThumbSize
      ? parseInt(settingThumbSize.value, 10)
      : undefined,
  };

  try {
    await window.electronAPI.saveSettings(settingsToSave);
  } catch (err) {
    console.error('Ошибка сохранения настроек', err);
  }
};

// Привязка авто-сохранения при изменении настроек (если ещё не сделано)
settingCompressQuality?.addEventListener('change', () => { saveSettings().catch(() => {}); });
settingThumbsEnabled?.addEventListener('change', () => { updateCompressDnDState(); saveSettings().catch(() => {}); });
settingThumbSize?.addEventListener('change', () => { updateCompressDnDState(); saveSettings().catch(() => {}); });

/* Тема: загрузка и переключение, сохраняется в localStorage */
const loadTheme = () => {
  const saved = localStorage.getItem('theme');
  const dark = saved === 'dark' || (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  themeToggleCheckbox.checked = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('theme', dark ? 'dark' : 'light');

  // СИНХРОНИЗАЦИЯ: сообщаем main текущую тему (main пересылает окно логов)
  try { window.electronAPI.setTheme(dark); } catch { /* ignore */ }
};

/* Обработчик переключения темы (renderer -> сохраняем в localStorage) */
if (themeToggleCheckbox) {
  themeToggleCheckbox.addEventListener('change', (e) => {
    const dark = (e.target as HTMLInputElement).checked;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    // СИНХРОНИЗАЦИЯ: сообщаем main о смене темы
    try { window.electronAPI.setTheme(dark); } catch { /* ignore */ }
  });
}

const selectFolder = async (last: string | null) => await window.electronAPI.selectFolder(last ?? undefined);

/* События прогресса и завершения объединения */
window.electronAPI.onMergeProgress((_, payload) => {
  const { processed, skipped, total, message } = payload as any;
  progressBarFill.style.width = total > 0 ? `${Math.round(((processed + skipped) / total) * 100)}%` : '0%';
  if (message) {
    if (message.includes('Объединено')) log(message, 'success');
    else if (message.includes('Не найден') || message.includes('Пропущен')) log(message, 'warning');
    else if (message.includes('Ошибка')) log(message, 'error');
    else log(message, 'info');
  }
  statsSuccess.textContent = processed.toString();
  statsSkipped.textContent = skipped.toString();
  statsTotal.textContent = total.toString();
  statsResults.style.display = 'flex';
  updateStats();
});

window.electronAPI.onMergeComplete((_, payload) => {
  try {
    const { processed, skipped, total, errors, log: logs, registry, canceled } = payload as any;

    log('\n=== Обработка завершена ===', 'info');
    log(`Успешно: ${processed}`, 'info');
    log(`Пропущено: ${skipped}`, 'info');
    log(`Всего: ${total}`, 'info');
    if (Array.isArray(logs)) logs.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : m.includes('Объединено') ? 'success' : 'info'));

    if (registry) {
      lastReportPath = registry;
      const btnOpenReport = document.getElementById('btn-open-report') as HTMLButtonElement | null;
      if (btnOpenReport) btnOpenReport.disabled = false;
      log(`Реестр сформирован: ${registry}`, 'info');
    }

    if (canceled) {
      log('Операция была отменена пользователем', 'warning');
      showPopup('Объединение отменено пользователем', 8000);
    } else if (errors && errors.length) {
      log(`Ошибки: ${errors.length}`, 'error');
      showPopup(`Объединение завершено с ошибками (${errors.length}). Проверьте лог.`, 12000);
    } else {
      showPopup('Объединение завершено успешно.', 8000);
    }

    statsSuccess.textContent = processed.toString();
    statsSkipped.textContent = skipped.toString();
    statsTotal.textContent = total.toString();
    statsResults.style.display = 'flex';
    updateStats();
  } catch (err) {
    console.error('onMergeComplete handler error', err);
  } finally {
    setBusy(false);
  }
});

/* Навигация и обработчики кнопок */
navMode1?.addEventListener('click', () => showMode('mode1'));
navSettings?.addEventListener('click', () => showMode('settings'));
navMode2?.addEventListener('click', () => showMode('compress'));

/* Update API handlers: проверка, загрузка, установка */
if (btnCheckUpdate) {
  btnCheckUpdate.addEventListener('click', async () => {
    updateStatusSpan.textContent = 'Проверка обновлений...';
    btnUpdateApp.style.display = 'none';
    try {
      await window.electronAPI.checkForUpdates();
    } catch (err) {
      updateStatusSpan.textContent = `Ошибка: ${(err as Error).message}`;
    }
  });
}

/* Обработка событий авто-обновления (main -> renderer) */
window.electronAPI.onUpdateAvailable((_, version) => {
  updateNotificationText.textContent = `Доступна новая версия ${version}. Начинаю загрузку...`;
  updateNotification.classList.remove('hidden');
  updateStatusSpan.textContent = `Доступно обновление: v${version}`;
  btnUpdateApp.style.display = 'inline-flex';
  btnUpdateApp.disabled = true;
  // автоматически начать загрузку обновления
  window.electronAPI.downloadUpdate().catch(() => { /* ignore */ });
});

window.electronAPI.onUpdateNotAvailable(() => {
  updateNotification.classList.add('hidden');
  updateStatusSpan.textContent = 'Обновлений нет.';
  btnUpdateApp.style.display = 'none';
});

window.electronAPI.onUpdateError((_, err) => {
  updateNotification.classList.add('hidden');
  updateStatusSpan.textContent = `Ошибка обновления: ${err}`;
  btnUpdateApp.style.display = 'none';
});

window.electronAPI.onUpdateDownloadProgress((_, percent) => {
  updateStatusSpan.textContent = `Загрузка: ${Math.round(percent)}%`;
  // можно показать прогресс в UI при желании
});

window.electronAPI.onUpdateDownloaded((_, ver) => {
  updateStatusSpan.textContent = `Обновление v${ver} загружено.`;
  btnUpdateApp.disabled = false;
  btnUpdateApp.textContent = 'Установить обновление';
});

/* Нажатие кнопки установки обновления — производим установку */
if (btnUpdateApp) {
  btnUpdateApp.addEventListener('click', async () => {
    try {
      await window.electronAPI.quitAndInstall();
    } catch (err) {
      updateStatusSpan.textContent = `Ошибка установки: ${(err as Error).message}`;
    }
  });
}

/* Кнопки выбора папок и merge */
if (btnMain) btnMain.addEventListener('click', async () => {
  const orig = btnMain.innerHTML;
  btnMain.innerHTML = '<i data-lucide="loader" class="loader"></i> Сканирование...';
  btnMain.disabled = true;
  try {
    const folder = await selectFolder(lastSelectedMainFolder);
    if (folder) { mainFolder = folder; lastSelectedMainFolder = folder; updateFolderLabel(labelMain, folder); zepbDict = await window.electronAPI.buildDict('zepb', mainFolder, chkMainRecursive.checked); updateStats(); checkReady(); await saveSettings(); }
  } finally { btnMain.innerHTML = orig; btnMain.disabled = false; }
});

if (btnInsert) btnInsert.addEventListener('click', async () => {
  const orig = btnInsert.innerHTML;
  btnInsert.innerHTML = '<i data-lucide="loader" class="loader"></i> Сканирование...';
  btnInsert.disabled = true;
  try {
    const folder = await selectFolder(lastSelectedInsertFolder);
    if (folder) { insertFolder = folder; lastSelectedInsertFolder = folder; updateFolderLabel(labelInsert, folder); insertDict = await window.electronAPI.buildDict('insert', insertFolder, chkInsertRecursive.checked); updateStats(); checkReady(); await saveSettings(); }
  } finally { btnInsert.innerHTML = orig; btnInsert.disabled = false; }
});

if (btnOutput) btnOutput.addEventListener('click', async () => {
  const folder = await selectFolder(lastSelectedOutputFolder);
  if (folder) {
    outputFolder = folder;
    lastSelectedOutputFolder = folder;
    updateFolderLabel(labelOutput, folder);
    (document.getElementById('btn-open-output') as HTMLButtonElement).disabled = false;
    updateStats(); checkReady();
    await saveSettings();

    // <--- ВАЖНО: при изменении папки результатов обновляем готовность кнопки сжатия
    updateCompressReady();
  }
});

const btnOpenLogEl = document.getElementById('btn-open-log') as HTMLButtonElement | null;
if (btnOpenLogEl) btnOpenLogEl.addEventListener('click', async () => { await window.electronAPI.openLogWindow(); });

if (btnRun) btnRun.addEventListener('click', async () => {
  if (!mainFolder || !insertFolder || !outputFolder) { log('Не все папки выбраны', 'error'); return; }
  log('Начало объединения', 'info');
  setBusy(true);
  if (logArea) logArea.value = '';
  try {
    const result = await window.electronAPI.mergePDFs({ mainFolder, insertFolder, outputFolder, recursiveMain: chkMainRecursive.checked, recursiveInsert: chkInsertRecursive.checked });
    if (result && Array.isArray(result.log)) result.log.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : m.includes('Объединено') ? 'success' : 'info'));
    statsSuccess.textContent = (result.processed || 0).toString();
    statsSkipped.textContent = (result.skipped || 0).toString();
    statsTotal.textContent = (result.total || 0).toString();
    statsResults.style.display = 'flex';
    updateStats();
  } catch (err) {
    log(`Ошибка выполнения: ${(err as Error).message}`, 'error');
    showPopup(`Ошибка: ${(err as Error).message}`, 10000);
  } finally { /* разблокировка по событию merge-complete */ }
});

/* Остальные обработчики (open output, clear settings, feedback, compress) */
if (btnOpenOutput) btnOpenOutput.addEventListener('click', async () => {
  if (!outputFolder) { showPopup('Папка результатов не выбрана'); return; }
  const ok = await window.electronAPI.openFolder(outputFolder);
  if (!ok) alert(`Не удалось открыть папку:\n${outputFolder}`);
});

if (btnClearSettings) btnClearSettings.addEventListener('click', async () => {
  if (!confirm('Очистить настройки?')) return;
  mainFolder = ''; insertFolder = ''; outputFolder = ''; zepbDict = {}; insertDict = {};
  updateFolderLabel(labelMain, null); updateFolderLabel(labelInsert, null); updateFolderLabel(labelOutput, null);
  updateStats(); checkReady(); await saveSettings();
  log('Настройки очищены', 'warning');
});

/* Всплывающий popup */
function showPopup(message: string, timeout = 8000) {
  let popup = document.getElementById('app-popup') as HTMLDivElement | null;
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'app-popup';
    popup.className = 'app-popup hidden';
    popup.style.position = 'fixed';
    popup.style.bottom = '20px';
    popup.style.right = '20px';
    popup.style.padding = '12px 20px';
    popup.style.borderRadius = '8px';
    popup.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)';
    popup.style.zIndex = '9999';
    popup.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    document.body.appendChild(popup);
  }
  popup.textContent = message;
  popup.classList.remove('hidden');
  requestAnimationFrame(() => { popup!.style.opacity = '1'; popup!.style.transform = 'translateY(0)'; });
  setTimeout(() => { popup!.style.opacity = '0'; popup!.style.transform = 'translateY(20px)'; setTimeout(() => popup?.classList.add('hidden'), 300); }, timeout);
}

/* UI режимы */
function showMode(modeId: string) {
  // Скрываем все основные панели
  mode1Content.style.display = 'none';
  settingsContent.style.display = 'none';
  mode2Content.style.display = 'none';

  // Показываем только выбранную панель
  if (modeId === 'mode1') mode1Content.style.display = 'block';
  else if (modeId === 'settings') settingsContent.style.display = 'block';
  else if (modeId === 'compress') mode2Content.style.display = 'block';

  // Обновляем классы навигации
  navMode1.classList.toggle('active', modeId === 'mode1');
  navSettings.classList.toggle('active', modeId === 'settings');
  navMode2.classList.toggle('active', modeId === 'compress');

  // Управление видимостью контейнера compress-controls (грузим элемент)
  const compressContainer = document.getElementById('compress-controls') as HTMLElement | null;
  if (compressContainer) {
    compressContainer.style.display = (modeId === 'compress') ? '' : 'none';
  }

  // При входе в режим compress — обновим состояние готовности кнопки
  if (modeId === 'compress') {
    try {
      updateCompressReady();
      layoutCompressResize();
    } catch { /* ignore */ }
  }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  loadTheme(); loadSettings(); checkReady(); updateCompressReady();
  try { layoutCompressResize(); } catch {}
});

// Конец IIFE
})();