// Renderer: краткие комментарии о назначении функций и связях (preload -> main).
// Отвечает за UI: выбор папок, запуск мерджа, прогресс, лог, блокировку UI и спиннер.
// Также: управление темой и логикой авто-обновлений.

(() => {
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
const compressTableBody = document.querySelector('#compress-table tbody') as HTMLTableSectionElement | null;
const btnOpenReport = document.getElementById('btn-open-report') as HTMLButtonElement | null;

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
    <div>Выполняется...</div>
    <div style="height:8px"></div>
    <button id="btn-cancel-merge" class="btn btn-primary">Отменить</button>
  </div>`;
  document.body.appendChild(overlay);
  const style = document.createElement('style');
  style.innerHTML = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);

  // Обработчик кнопки отмены: вызывает main через preload
  overlay.querySelector('#btn-cancel-merge')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      await window.electronAPI.cancelMerge();
      const ts = new Date().toLocaleTimeString();
      const line = `[${ts}] [WARN] Запрошена отмена объединения`;
      log(line, 'warning');
      showPopup('Запрос отмены отправлен', 4000);
    } catch (err) {
      showPopup('Ошибка отправки запроса отмены', 6000);
    }
  });
})();

// Очистка таблицы и прогресса перед новой обработкой
function clearCompressTable() {
  try {
    if (compressTableBody) {
      compressTableBody.innerHTML = '';
      // гарантируем, что tbody остаётся display:block (см. стили)
    }
    if (compressProgressFill) compressProgressFill.style.width = '0%';
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
  const hasInput = labelCompress && labelCompress.value && labelCompress.value !== 'Не выбрана';
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
        if (labelCompress) labelCompress.value = folder;

        // Если папка вывода для сжатия не выбрана — автоназначим ту же папку (удобство)
        if (!compressOutputFolder) {
          compressOutputFolder = folder;
          lastSelectedCompressOutputFolder = folder;
          if (labelCompressOutput) labelCompressOutput.value = folder;
          try { await saveSettings(); } catch { /* ignore */ }
        }
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
      updateCompressReady();
    } finally {
      btnCompressOutput.innerHTML = orig;
      btnCompressOutput.disabled = false;
    }
  });

  // Обработчик запуска сжатия — используем compressOutputFolder как выходную
  if (btnCompressRun) btnCompressRun.addEventListener('click', async () => {
    if (!labelCompress || !labelCompress.value || !compressOutputFolder) {
      showPopup('Выберите входную и выходную папки для сжатия', 5000);
      return;
    }
    const quality = selectCompressQuality ? parseInt(selectCompressQuality.value, 10) : 30;
    log(`Запущено сжатие: ${labelCompress.value} -> ${compressOutputFolder}, качество ${quality}%`, 'info');
    setBusy(true);
    try {
      clearCompressTable();
      const res = await window.electronAPI.compressPDFs({ inputFolder: labelCompress.value, outputFolder: compressOutputFolder, quality });
      if (res && Array.isArray(res.log)) res.log.forEach((m: string) => log(m, m.includes('Ошибка') ? 'error' : 'info'));
      showPopup(`Сжатие завершено: обработано ${res.processed}/${res.total}`, 6000);
      updateStats();
    } catch (err) {
      log(`Ошибка при сжатии: ${(err as Error).message}`, 'error');
      showPopup('Ошибка при сжатии. Проверьте лог.', 8000);
    } finally {
      setBusy(false);
    }
  });

// Обработчик прогресса — обновляет/добавляет строку и прогресс бар
window.electronAPI.onCompressProgress((_, payload) => {
  try {
    const { index, total, name, inSize, outSize, ok, error, notes } = payload as any;
    // обновляем прогресс-бар
    if (compressProgressFill) {
      const pct = total > 0 ? Math.round((index / total) * 100) : 0;
      compressProgressFill.style.width = `${pct}%`;
    }

    // добавляем или обновляем строку в таблице
    if (!compressTableBody) return;
    // найдём существующую строку по имени (data-name)
    let row = compressTableBody.querySelector(`tr[data-name="${CSS.escape(name)}"]`) as HTMLTableRowElement | null;
    if (!row) {
      row = document.createElement('tr');
      row.setAttribute('data-name', name);
      row.innerHTML = `<td style="padding:6px 8px; width:40px;">${index}</td>
                       <td style="padding:6px 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</td>
                       <td style="padding:6px 8px; width:120px;">${inSize ? formatBytes(inSize) : ''}</td>
                       <td style="padding:6px 8px; width:120px;">${outSize ? formatBytes(outSize) : ''}</td>
                       <td style="padding:6px 8px; width:90px;">${computePercent(inSize, outSize)}</td>
                       <td style="padding:6px 8px; width:140px;">${ok ? (notes || 'OK') : (error || 'ERROR')}</td>`;
      compressTableBody.appendChild(row);
    } else {
      // обновить существующий
      // индекс может меняться для удобства (в случае перезапуска списка его обычно используют как порядок поступления)
      const cells = row.querySelectorAll('td');
      if (cells && cells.length >= 6) {
        (cells[0] as HTMLTableCellElement).textContent = String(index);
        (cells[2] as HTMLTableCellElement).textContent = inSize ? formatBytes(inSize) : '';
        (cells[3] as HTMLTableCellElement).textContent = outSize ? formatBytes(outSize) : '';
        (cells[4] as HTMLTableCellElement).textContent = computePercent(inSize, outSize);
        (cells[5] as HTMLTableCellElement).textContent = ok ? (notes || 'OK') : (error || 'ERROR');
      }
    }
  } catch (e) { console.error('compress-progress handler error', e); }
});

// Обработчик завершения — включает кнопку отчёта и показывает уведомление
window.electronAPI.onCompressComplete((_, payload) => {
  try {
    const { processed, total, log } = payload as any;
    if (compressProgressFill) compressProgressFill.style.width = '100%';
    log && Array.isArray(log) && log.forEach((m: string) => logMessage(m));
    showPopup(`Сжатие завершено: ${processed}/${total}`, 8000);
    // таблица остаётся видимой, готова к следующей обработке (clearCompressTable() будет вызвана при старте следующей)
  } catch (e) { console.error('compress-complete handler error', e); }
});

// Кнопка "Открыть отчёт" — открывает файл отчёта в системе
if (btnOpenReport) btnOpenReport.addEventListener('click', async () => {
  if (!lastReportPath) { showPopup('Отчёт не найден', 4000); return; }
  try {
    await window.electronAPI.openFolder(lastReportPath);
  } catch (err) {
    showPopup('Не удалось открыть отчёт', 4000);
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

    // Основные папки (как раньше)
    if (s.mainFolder) {
      mainFolder = s.mainFolder;
      lastSelectedMainFolder = s.mainFolder;
      updateFolderLabel(labelMain, mainFolder);
      try { zepbDict = await window.electronAPI.buildDict('zepb', mainFolder, !!s.mainRecursive); } catch { zepbDict = {}; }
    }

    if (s.insertFolder) {
      insertFolder = s.insertFolder;
      lastSelectedInsertFolder = s.insertFolder;
      updateFolderLabel(labelInsert, insertFolder);
      try { insertDict = await window.electronAPI.buildDict('insert', insertFolder, !!s.insertRecursive); } catch { insertDict = {}; }
    }

    if (s.outputFolder) {
      outputFolder = s.outputFolder;
      lastSelectedOutputFolder = s.outputFolder;
      updateFolderLabel(labelOutput, outputFolder);
      const btnOpenOut = document.getElementById('btn-open-output') as HTMLButtonElement | null;
      if (btnOpenOut) btnOpenOut.disabled = false;
    }

    // Восстановление чекбоксов рекурсивного сканирования
    if (typeof s.mainRecursive === 'boolean') chkMainRecursive.checked = s.mainRecursive;
    if (typeof s.insertRecursive === 'boolean') chkInsertRecursive.checked = s.insertRecursive;

    // --- Новое: восстановление настроек для режима сжатия ---
    // restore compress input
    if (s.compressInputFolder) {
      lastSelectedCompress = s.compressInputFolder;
      if (labelCompress) labelCompress.value = s.compressInputFolder;
    }
    // restore compress output
    if (s.compressOutputFolder) {
      compressOutputFolder = s.compressOutputFolder;
      lastSelectedCompressOutputFolder = s.compressOutputFolder;
      if (labelCompressOutput) {
        // updateFolderLabel работает с HTMLInputElement
        updateFolderLabel(labelCompressOutput, compressOutputFolder);
      } else {
        // если элемент отсутствует — попытка прямой запись безопасно (используем пустую строку вместо null)
        try { (document.getElementById('label-compress-output') as HTMLInputElement).value = compressOutputFolder ?? ''; } catch {}
      }
      const btnCompOut = document.getElementById('btn-compress-output') as HTMLButtonElement | null;
      if (btnCompOut) btnCompOut.disabled = false;
    }

    // Восстановление выбранного качества (если сохранено)
    try {
      if (s.compressQuality && selectCompressQuality) {
        selectCompressQuality.value = String(s.compressQuality);
      }
    } catch { /* ignore */ }

    // Обновляем UI/статусы
    updateStats();
    checkReady();

    // Обновляем состояние кнопки сжатия
    updateCompressReady();
  } catch (err) {
    console.error('Ошибка загрузки настроек', err);
  }
};

const saveSettings = async () => {
  // Собираем настройки для сохранения — включаем поля для compress
  const s: any = {
    mainFolder,
    insertFolder,
    outputFolder,
    mainRecursive: chkMainRecursive.checked,
    insertRecursive: chkInsertRecursive.checked,
    lastSelectedMainFolder,
    lastSelectedInsertFolder,
    lastSelectedOutputFolder,
    // поля для режима сжатия
    compressInputFolder: lastSelectedCompress ?? null,
    compressOutputFolder: compressOutputFolder ?? null,
    lastSelectedCompressOutputFolder: lastSelectedCompressOutputFolder ?? null,
    // сохраняем выбранное качество как число, если есть
    compressQuality: selectCompressQuality ? parseInt(selectCompressQuality.value, 10) : undefined
  };

  try {
    await window.electronAPI.saveSettings(s);
  } catch (err) {
    console.error('Ошибка сохранения настроек', err);
  }
};

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
  const { processed, skipped, total, errors, log: logs, registry, canceled } = payload as any;
  log('\n=== Обработка завершена ===', 'info');
  log(`Успешно: ${processed}`, 'info');
  log(`Пропущено: ${skipped}`, 'info');
  log(`Всего: ${total}`, 'info');
  if (registry) log(`Реестр: ${registry}`, 'info');
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
  setBusy(false);
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
    try { updateCompressReady(); } catch { /* ignore */ }
  }
}

/* Инициализация */
document.addEventListener('DOMContentLoaded', () => { loadTheme(); loadSettings(); checkReady(); updateCompressReady(); });

})();