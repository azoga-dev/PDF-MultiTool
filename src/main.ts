import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import fs from 'fs-extra';
import { promises as fsp } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { autoUpdater } from 'electron-updater';
import { Document, Packer, Paragraph, TextRun, LevelFormat, AlignmentType } from 'docx';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { randomUUID } from 'crypto';

// Короткие комментарии: основные функции main.
// preload -> main: preload пробрасывает invoke/on к main ipc.
// main отправляет события (merge-progress, merge-complete, log-append) в renderer через webContents.send.

const PREFIXES = ["СК", "УА", "СППК", "СПД", "РВС", "ПУ", "П", "ГЗУ"];
const CODE_REGEX = new RegExp(`(${PREFIXES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-\\d+(?:\\.\\d+)?`, 'i');
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let isQuitting = false;
let lastSelectedFolder: string | null = null;
const logStore: string[] = [];

// Флаг отмены текущего слияния. Устанавливается через ipc 'cancel-merge'.
let mergeCancelRequested = false;
let compressCancelRequested = false;

/* Проверка, помечен ли файл как уже обработанный */
const fileMarkedProcessed = (name: string) =>
  /(\(.*?(с увед|с уведомл|with notification).*?\)|\bс увед\b|\bс уведомл\b|\bwith notification\b|\bобъединен\b|\bprocessed\b)/i.test(name);

/* Извлечь код уведомления из имени файла или папки */
const extractNotificationCode = (fullPath: string): string | null => {
  const filename = path.basename(fullPath);
  const foldername = path.basename(path.dirname(fullPath));
  const m = filename.match(CODE_REGEX);
  if (m) return m[0].toUpperCase();
  const folderPrefix = PREFIXES.find(p => foldername.toUpperCase().includes(p));
  if (folderPrefix) {
    const nm = filename.match(/\d+(?:\.\d+)?/);
    if (nm) return `${folderPrefix}-${nm[0]}`.toUpperCase();
  }
  return null;
};

/* Извлечь код ЗЭПБ из имени файла */
const extractZepbCode = (filename: string): string | null => {
  const m = filename.match(CODE_REGEX);
  return m ? m[0].toUpperCase() : null;
};

/* Сканирование папки и построение словаря код->путь */
async function buildDict(root: string, recursive: boolean, fileFilter: (full: string, name: string) => boolean, extractCode: (nameOrPath: string) => string | null) {
  const dict: Record<string, string> = {};
  async function scan(dir: string) {
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (recursive) await scan(full);
        continue;
      }
      if (!it.isFile()) continue;
      if (!fileFilter(full, it.name)) continue;
      if (fileMarkedProcessed(it.name)) continue;
      const code = extractCode(it.name);
      if (!code) continue;
      if (dict[code]) {
        try {
          const [s1, s2] = await Promise.all([fsp.stat(dict[code]), fsp.stat(full)]);
          if (s2.mtimeMs > s1.mtimeMs) dict[code] = full;
        } catch { /* ignore */ }
        continue;
      }
      dict[code] = full;
    }
  }
  await scan(root);
  return dict;
}

/* Создание .docx реестра: Times New Roman, нумерованный список */
async function createRegistryDocx(outputFolder: string, processedFiles: string[]) {
  if (!processedFiles.length) return null;
  const now = new Date();
  const formatted = now.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const numberingConfig = [
    {
      reference: 'num-ref',
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
        },
      ],
    },
  ];

  const children: Paragraph[] = [];
  children.push(new Paragraph({ children: [new TextRun({ text: 'Реестр обработанных файлов', bold: true, size: 28, font: 'Times New Roman' })] }));
  children.push(new Paragraph({ text: '' }));

  for (const fname of processedFiles) {
    children.push(new Paragraph({
      numbering: { reference: 'num-ref', level: 0 },
      children: [new TextRun({ text: fname, size: 24, font: 'Times New Roman' })],
    }));
  }

  children.push(new Paragraph({ text: '' }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Дата обработки: ${formatted}`, italics: true, size: 24, font: 'Times New Roman' })] }));

  const doc = new Document({ numbering: { config: numberingConfig }, sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);
  const safeDate = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const filename = `Реестр обработанных файлов ${safeDate}.docx`;
  const outPath = path.join(outputFolder, filename);
  await fsp.writeFile(outPath, buffer);
  return filename;
}

let currentThemeIsDark = false; // текущее состояние темы (renderer сообщает main)

/* IPC: принять изменение темы от renderer и форвардить в окно логов */
ipcMain.on('theme-changed', (_e, isDark: boolean) => {
  currentThemeIsDark = !!isDark;
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('set-theme', currentThemeIsDark);
  }
});

// Замените существующую функцию createLogWindow на этот вариант.
// Он копирует styles.css, вставляет его, затем синхронизирует CSS-переменные
// из mainWindow в logWindow, и только в крайнем случае применяет fallback CSS.

import { pathToFileURL } from 'url'; // убедитесь, что импорт есть вверху файла

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) return;
  logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
    title: 'Лог приложения',
  });

  const htmlPath = path.join(__dirname, 'logWindow.html');
  logWindow.loadFile(htmlPath).catch(err => {
    console.error('Ошибка загрузки logWindow.html:', err);
    logStore.push(`[ERROR] Ошибка загрузки logWindow.html: ${(err as Error).message}`);
  });

  logWindow.on('closed', () => { logWindow = null; });

  logWindow.webContents.once('did-finish-load', async () => {
    try {
      // 1) Отправляем текущий лог и тему
      logWindow?.webContents.send('log-content', logStore.join('\n'));
      logWindow?.webContents.send('set-theme', currentThemeIsDark);

      // 2) Найти styles.css (dist предпочтительно)
      const candidates = [
        path.join(__dirname, 'styles.css'),              // dist/styles.css
        path.join(process.cwd(), 'dist', 'styles.css'), // альтернатива
        path.join(process.cwd(), 'src', 'styles.css'),  // исходник (dev)
      ];

      let cssPath: string | null = null;
      for (const p of candidates) {
        if (await fs.pathExists(p)) { cssPath = p; break; }
      }

      if (cssPath) {
        // вставляем внешний CSS в окно логов
        try {
          const css = await fsp.readFile(cssPath, 'utf8');
          await logWindow!.webContents.insertCSS(css);
          logStore.push(`[DEBUG] insertCSS applied for ${cssPath}`);
        } catch (err) {
          console.warn('[logWindow] insertCSS failed:', (err as Error).message);
          logStore.push(`[WARN] insertCSS failed: ${(err as Error).message}`);
        }

        // добавляем <link> с file:// для относительных ресурсов (шрифты и пр.)
        try {
          const cssFileUrl = pathToFileURL(cssPath).href;
          await logWindow!.webContents.executeJavaScript(`
            (function(){
              if (!document.querySelector('link[data-injected-styles]')) {
                const l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = ${JSON.stringify(cssFileUrl)};
                l.setAttribute('data-injected-styles', '1');
                document.head.appendChild(l);
              }
              return true;
            })();
          `, true);
          logStore.push(`[DEBUG] <link> injected: ${cssPath}`);
        } catch (err) {
          console.warn('[logWindow] insert <link> failed:', (err as Error).message);
          logStore.push(`[WARN] insert <link> failed: ${(err as Error).message}`);
        }
      } else {
        const warn = `styles.css не найден (пытались: ${candidates.join(', ')})`;
        console.warn('[logWindow] ' + warn);
        logStore.push(`[WARN] ${warn}`);
      }

      // 3) Синхронизировать CSS-переменные из mainWindow в logWindow
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // получить все переменные --* из mainWindow
          const vars: Record<string, string> = await mainWindow.webContents.executeJavaScript(`
            (function(){
              try {
                const cs = getComputedStyle(document.documentElement);
                const out = {};
                for (let i = 0; i < cs.length; i++) {
                  const name = cs[i];
                  if (name && name.startsWith('--')) {
                    out[name] = cs.getPropertyValue(name).trim();
                  }
                }
                return out;
              } catch (e) { return {}; }
            })();
          `, true);

          // сформировать CSS :root { --var: value; ... }
          const varsEntries = Object.entries(vars);
          if (varsEntries.length) {
            let varsCss = ':root {\\n';
            for (const [k, v] of varsEntries) {
              // экранируем одинарные слэши и кавычки на всякий
              const safeV = String(v).replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
              varsCss += `  ${k}: ${safeV};\\n`;
            }
            varsCss += '}';
            try {
              await logWindow!.webContents.insertCSS(varsCss);
              logStore.push('[DEBUG] CSS variables synced to logWindow');
            } catch (err) {
              console.warn('[logWindow] failed to insert CSS vars:', (err as Error).message);
              logStore.push(`[WARN] failed to insert CSS vars: ${(err as Error).message}`);
            }
            // повторно отправим тему (чтобы переменные применились)
            logWindow?.webContents.send('set-theme', currentThemeIsDark);
          } else {
            logStore.push('[DEBUG] No CSS variables found in mainWindow to sync');
          }
        } else {
          logStore.push('[DEBUG] mainWindow not available for CSS var sync');
        }
      } catch (err) {
        console.warn('[logWindow] error syncing CSS vars from mainWindow:', (err as Error).message);
        logStore.push(`[WARN] error syncing CSS vars: ${(err as Error).message}`);
      }

      // 4) Диагностика и fallback (как страховка)
      const diag = await logWindow!.webContents.executeJavaScript(`
        (function(){
          try {
            const sheets = document.styleSheets ? document.styleSheets.length : 0;
            const btn = document.querySelector('.btn') || document.querySelector('button') || document.body;
            const computed = btn ? window.getComputedStyle(btn) : null;
            const bg = computed ? computed.backgroundColor : null;
            const color = computed ? computed.color : null;
            const hasLink = !!document.querySelector('link[data-injected-styles]');
            return { sheets, bg, color, hasLink };
          } catch (e) { return { error: e && e.message }; }
        })();
      `, true);

      logStore.push(`[DEBUG] logWindow diag: ${JSON.stringify(diag)}`);

      const needFallback = !diag || diag.sheets === 0 || !diag.bg || diag.bg === 'rgba(0, 0, 0, 0)' || diag.bg === 'transparent';
      if (needFallback) {
        const fallbackCss = `
          :root { --bg: #ffffff; --text: #111827; --panel: #f9fafb; --border: #e5e7eb; --btn-bg: #3b82f6; --btn-text: #fff; --muted: #6b7280; }
          [data-theme="dark"] { --bg: #0b1220; --text: #e5e7eb; --panel: #111827; --border: #374151; --btn-bg: #2563eb; --btn-text: #fff; --muted: #9ca3af; }
          html,body { background:var(--bg); color:var(--text); font-family: Inter, system-ui, Arial; }
          .wrap { padding:12px; box-sizing:border-box; height:100%; display:flex; flex-direction:column; gap:12px; }
          .btn { padding:8px 12px; border-radius:8px; border:1px solid var(--border); cursor:pointer; background:var(--panel) !important; color:var(--text) !important; }
          .btn.primary { background:var(--btn-bg) !important; color:var(--btn-text) !important; border:none !important; }
          .filters { display:flex; gap:8px; align-items:center; }
          .log { flex:1; width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--panel); color:var(--text); font-family:monospace; font-size:13px; overflow:auto; white-space:pre-wrap; }
          .search { padding:6px 8px; border-radius:6px; border:1px solid var(--border); background:var(--panel); }
          .small { color:var(--muted); font-size:12px; }
        `;
        try {
          await logWindow!.webContents.insertCSS(fallbackCss);
          logStore.push('[DEBUG] fallback CSS inserted into logWindow');
          logWindow?.webContents.send('set-theme', currentThemeIsDark);
        } catch (err) {
          console.error('[logWindow] failed to insert fallback CSS:', (err as Error).message);
          logStore.push(`[ERROR] failed to insert fallback CSS: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.error('[main] Ошибка при инициализации окна логов:', err);
      logStore.push(`[ERROR] Ошибка инициализации окна логов: ${(err as Error).message}`);
    }
  });
}

// IPC: проверить, является ли путь директорией
ipcMain.handle('path-is-directory', async (_e, p: string) => {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
});

// IPC: сжатие списка файлов (drag&drop)
ipcMain.handle('compress-files', async (_e, { files, outputFolder, quality = 30 }: { files: string[]; outputFolder: string; quality?: number }) => {
  const result: { processed: number; total: number; log: string[]; used?: string; files?: any[] } = { processed: 0, total: 0, log: [], used: 'none', files: [] };
  try {
    if (!files || !Array.isArray(files) || files.length === 0) throw new Error('Нет файлов для сжатия');
    if (!outputFolder) throw new Error('Не указана папка вывода');
    await fs.ensureDir(outputFolder);

    const pdfs: string[] = [];
    for (const f of files) {
      try {
        const st = await fsp.stat(f);
        if (st.isFile() && f.toLowerCase().endsWith('.pdf')) pdfs.push(f);
      } catch { /* skip */ }
    }
    result.total = pdfs.length;
    result.log.push(`Получено ${pdfs.length} PDF для сжатия (drag&drop)`);

    async function findGhostscript(): Promise<string | null> {
      const candidates = ['gs', 'gswin64c', 'gswin32c'];
      for (const c of candidates) {
        try { await execFileAsync(c, ['--version']); return c; } catch { /* ignore */ }
      }
      return null;
    }
    function qualityToPdfSettings(q: number) {
      if (q <= 12) return '/screen';
      if (q <= 25) return '/ebook';
      if (q <= 40) return '/printer';
      return '/prepress';
    }

    const gsCmd = await findGhostscript();
    if (gsCmd) result.used = `ghostscript (${gsCmd})`;
    else result.used = 'pdf-lib(fallback)';

    let index = 0;
    for (const fullPath of pdfs) {
      index++;
      const fname = path.basename(fullPath);
      const outP = path.join(outputFolder, fname);
      const fileInfo: any = { name: fname, ok: false };
      const tmpIn = path.join(os.tmpdir(), `in-${randomUUID()}.pdf`);
      const tmpOut = path.join(os.tmpdir(), `out-${randomUUID()}.pdf`);
      try {
        const statIn = await fsp.stat(fullPath).catch(() => ({ size: undefined }));
        fileInfo.inSize = statIn.size;
        if (gsCmd) {
          await fsp.copyFile(fullPath, tmpIn);
          const pdfSetting = qualityToPdfSettings(quality);
          const args = ['-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4', `-dPDFSETTINGS=${pdfSetting}`, '-dNOPAUSE','-dBATCH', `-sOutputFile=${tmpOut}`, tmpIn];
          try {
            await execFileAsync(gsCmd, args);
            if (!(await fs.pathExists(tmpOut))) throw new Error('Ghostscript не создал выходной файл');
            await fs.copy(tmpOut, outP, { overwrite: true });
            fileInfo.ok = true;
            fileInfo.notes = `GS:${pdfSetting}`;
            result.log.push(`GS: ${fname} -> ${outP} (${pdfSetting})`);
          } catch (gsErr) {
            fileInfo.ok = false;
            fileInfo.error = (gsErr as Error).message;
            result.log.push(`Ошибка GS ${fname}: ${(gsErr as Error).message}`);
          } finally { try { await fs.remove(tmpIn); } catch {} try { await fs.remove(tmpOut); } catch {} }
        } else {
          try {
            const inputBytes = await fsp.readFile(fullPath);
            const pdfDoc = await PDFDocument.load(inputBytes);
            const outBytes = await pdfDoc.save();
            await fsp.writeFile(outP, outBytes);
            fileInfo.ok = true;
            fileInfo.notes = 'fallback';
            result.log.push(`FB: ${fname} -> ${outP}`);
          } catch (fbErr) {
            fileInfo.ok = false;
            fileInfo.error = (fbErr as Error).message;
            result.log.push(`Ошибка fallback ${fname}: ${(fbErr as Error).message}`);
          }
        }

        const statOut = await fsp.stat(outP).catch(() => ({ size: undefined as any }));
        fileInfo.outSize = statOut.size;
        result.files?.push(fileInfo);
        result.processed++;

        mainWindow?.webContents.send('compress-progress', {
          index, total: result.total, name: fname, inSize: fileInfo.inSize, outSize: fileInfo.outSize, ok: fileInfo.ok, error: fileInfo.error || null, notes: fileInfo.notes || null
        });
      } catch (err) {
        fileInfo.ok = false;
        fileInfo.error = (err as Error).message;
        result.log.push(`Ошибка обработки ${fname}: ${(err as Error).message}`);
        mainWindow?.webContents.send('compress-progress', { index, total: result.total, name: fname, ok: false, error: fileInfo.error || null });
      }
    }

    mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
    result.log.unshift(`Сжатие завершено. Engine: ${result.used}`);
    return result;
  } catch (err) {
    const em = `Ошибка compress-files: ${(err as Error).message}`;
    result.log.push(em);
    mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
    return result;
  }
});

/* IPC: открыть окно логов */
ipcMain.handle('open-log-window', async () => {
  createLogWindow();
  return true;
});

/* IPC: экспорт логов в файл */
ipcMain.handle('export-log', async (_e, suggestedName?: string) => {
  const defaultName = suggestedName || `pdfmanager-log-${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.txt`;
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow()!, {
    defaultPath: defaultName,
    filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    await fsp.writeFile(filePath, logStore.join('\n'), { encoding: 'utf8' });
    return { ok: true, path: filePath };
  } catch (err) {
    console.error('Export log error:', err);
    return { ok: false, error: (err as Error).message };
  }
});

/* IPC: главный приёмник логов из renderer, форвардим в окно логов и сохраняем в logStore */
ipcMain.on('append-log', (_e, message: string) => {
  const line = typeof message === 'string' ? message : JSON.stringify(message);
  logStore.push(line);
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log-append', line);
  }
});

/* IPC: отмена текущего мерджа */
ipcMain.handle('cancel-merge', async () => {
  mergeCancelRequested = true;
  // если нужно, можно вернуть текущее состояние
  return true;
});

/* Основной обработчик объединения */
ipcMain.handle('merge-pdfs', async (_event, { mainFolder, insertFolder, outputFolder, recursiveMain, recursiveInsert }: any) => {
  const summary = { processed: 0, skipped: 0, errors: [] as string[], log: [] as string[], total: 0, canceled: false as boolean };
  try {
    if (!mainFolder || !insertFolder || !outputFolder) throw new Error('Не указаны папки');
    await fs.ensureDir(outputFolder);

    // сбрасываем флаг отмены перед началом
    mergeCancelRequested = false;

    const insertDict = await buildDict(insertFolder, !!recursiveInsert, (full) => full.toLowerCase().endsWith('.pdf'), extractNotificationCode);
    const zepbDict = await buildDict(mainFolder, !!recursiveMain, (full, name) => full.toLowerCase().endsWith('.pdf') && name.toLowerCase().includes('зэпб'), extractZepbCode);

    const keys = Object.keys(insertDict);
    summary.total = keys.length;
    const processedNames: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      // проверяем флаг отмены в начале каждой итерации
      if (mergeCancelRequested) {
        const cancelMsg = 'Операция объединения отменена пользователем';
        summary.log.push(cancelMsg);
        summary.canceled = true;
        mainWindow?.webContents.send('merge-progress', {
          processed: summary.processed,
          skipped: summary.skipped,
          total: summary.total,
          current: i + 1,
          message: cancelMsg
        });
        logStore.push(cancelMsg);
        if (logWindow) logWindow.webContents.send('log-append', cancelMsg);
        break;
      }

      const code = keys[i];
      const notifPath = insertDict[code];
      const zepbPath = zepbDict[code];
      const index = i + 1;

      if (!zepbPath) {
        const msg = `Не найден ЗЭПБ для уведомления: ${path.basename(notifPath)} (${code})`;
        summary.log.push(msg);
        summary.skipped++;
        mainWindow?.webContents.send('merge-progress', { processed: summary.processed, skipped: summary.skipped, total: summary.total, current: index, code, message: msg });
        logStore.push(msg);
        if (logWindow) logWindow.webContents.send('log-append', msg);
        continue;
      }

      if (fileMarkedProcessed(path.basename(zepbPath))) {
        const msg = `Пропущен уже обработанный ЗЭПБ: ${path.basename(zepbPath)}`;
        summary.log.push(msg);
        summary.skipped++;
        mainWindow?.webContents.send('merge-progress', { processed: summary.processed, skipped: summary.skipped, total: summary.total, current: index, code, message: msg });
        logStore.push(msg);
        if (logWindow) logWindow.webContents.send('log-append', msg);
        continue;
      }

      try {
        const [notifBuf, zepbBuf] = await Promise.all([fsp.readFile(notifPath), fsp.readFile(zepbPath)]);
        const [notifDoc, zepbDoc] = await Promise.all([PDFDocument.load(notifBuf), PDFDocument.load(zepbBuf)]);
        const merged = await PDFDocument.create();
        const notifPages = await merged.copyPages(notifDoc, notifDoc.getPageIndices());
        notifPages.forEach(p => merged.addPage(p));
        const zepbPages = await merged.copyPages(zepbDoc, zepbDoc.getPageIndices());
        zepbPages.forEach(p => merged.addPage(p));
        const base = path.basename(zepbPath, '.pdf').replace(/\s*\(с увед.*?\)\s*$/i, '').replace(/\s*с увед.*?$/i, '');
        const outName = `${base} (с увед).pdf`;
        const outPath = path.join(outputFolder, outName);
        const mergedBuf = await merged.save();
        await fsp.writeFile(outPath, mergedBuf);
        summary.processed++;
        processedNames.push(outName);
        const msg = `Объединено: ${outName}`;
        summary.log.push(msg);
        mainWindow?.webContents.send('merge-progress', { processed: summary.processed, skipped: summary.skipped, total: summary.total, current: index, code, outputFilename: outName, message: msg });
        logStore.push(msg);
        if (logWindow) logWindow.webContents.send('log-append', msg);
      } catch (err) {
        const em = `Ошибка при обработке ${code}: ${(err as Error).message}`;
        summary.errors.push(em);
        summary.log.push(em);
        summary.skipped++;
        mainWindow?.webContents.send('merge-progress', { processed: summary.processed, skipped: summary.skipped, total: summary.total, current: index, code, message: em });
        logStore.push(em);
        if (logWindow) logWindow.webContents.send('log-append', em);
      }
    }

    // если операция была отменена, всё равно создаём реестр для уже обработанных файлов (опционально).
    const registryName = await createRegistryDocx(outputFolder, processedNames);
    if (registryName) {
      summary.log.push(`Создан реестр: ${registryName}`);
      logStore.push(`Создан реестр: ${registryName}`);
      if (logWindow) logWindow.webContents.send('log-append', `Создан реестр: ${registryName}`);
    }

    const finishedMsg = {
      processed: summary.processed,
      skipped: summary.skipped,
      total: summary.total,
      errors: summary.errors,
      log: summary.log,
      registry: registryName || null,
      canceled: summary.canceled
    };

    mainWindow?.webContents.send('merge-complete', finishedMsg);
    if (logWindow) logWindow.webContents.send('merge-complete', finishedMsg);

    return summary;
  } catch (err) {
    const em = `Ошибка объединения: ${(err as Error).message}`;
    summary.errors.push(em);
    summary.log.push(em);
    logStore.push(em);
    mainWindow?.webContents.send('merge-complete', { processed: summary.processed, skipped: summary.skipped, total: summary.total, errors: summary.errors, log: summary.log, registry: null, canceled: false });
    if (logWindow) logWindow.webContents.send('merge-complete', { processed: summary.processed, skipped: summary.skipped, total: summary.total, errors: summary.errors, log: summary.log, registry: null, canceled: false });
    return summary;
  }
});

/* Диалог выбора папки */
ipcMain.handle('select-folder', async (_event, defaultPath?: string) => {
  const startPath = defaultPath && await fs.pathExists(defaultPath) ? defaultPath : (lastSelectedFolder && await fs.pathExists(lastSelectedFolder) ? lastSelectedFolder : undefined);
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, { properties: ['openDirectory'], defaultPath: startPath });
  if (!result.canceled && result.filePaths.length) {
    lastSelectedFolder = result.filePaths[0];
    return lastSelectedFolder;
  }
  return null;
});

/* Загрузка/сохранение настроек (settings.json в userData) */
ipcMain.handle('load-settings', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try { if (await fs.pathExists(settingsPath)) return await fs.readJson(settingsPath); } catch (err) { console.error('Error loading settings:', err); }
  return {};
});

ipcMain.handle('save-settings', async (_e, settings) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try { await fs.writeJson(settingsPath, settings, { spaces: 2 }); return true; } catch (err) { console.error('Error saving settings:', err); return false; }
});

/* Прочие handlers */
ipcMain.handle('build-dict', async (_e, type: 'zepb' | 'insert', folderPath: string, recursive: boolean) => {
  try { return type === 'zepb' ? await buildDict(folderPath, recursive, (f, n) => f.toLowerCase().endsWith('.pdf') && n.toLowerCase().includes('зэпб'), extractZepbCode) : await buildDict(folderPath, recursive, (f) => f.toLowerCase().endsWith('.pdf'), extractNotificationCode); } catch { return {}; }
});

ipcMain.handle('count-files-in-folder', async (_e, folderPath: string) => {
  const items = await fsp.readdir(folderPath, { withFileTypes: true });
  return items.filter(i => i.isFile()).length;
});

ipcMain.handle('open-folder', async (_e, folderPath: string) => {
  try { await shell.openPath(folderPath); return true; } catch { return false; }
});

ipcMain.handle('cancel-compress', async () => {
  compressCancelRequested = true;
  return true;
});

ipcMain.handle('compress-pdfs', async (_e, { inputFolder, outputFolder, quality = 30 }: { inputFolder: string; outputFolder: string; quality?: number }) => {
  const result: {
    processed: number;
    total: number;
    log: string[];
    used?: string;
    files?: Array<{ name: string; inSize?: number; outSize?: number; ok: boolean; error?: string; notes?: string }>;
  } = { processed: 0, total: 0, log: [], used: 'none', files: [] };

  try {
    if (!inputFolder || !outputFolder) throw new Error('Не указаны папки inputFolder/outputFolder');
    if (!(await fs.pathExists(inputFolder))) throw new Error(`Input folder не найден: ${inputFolder}`);
    await fs.ensureDir(outputFolder);

    // Сбрасываем флаг отмены перед стартом
    compressCancelRequested = false;

    const all = await fsp.readdir(inputFolder);
    const pdfs = all.filter(f => f.toLowerCase().endsWith('.pdf'));
    result.total = pdfs.length;
    result.log.push(`Найдено ${pdfs.length} PDF в ${inputFolder}`);

    async function findGhostscript(): Promise<string | null> {
      const candidates = ['gs', 'gswin64c', 'gswin32c'];
      for (const c of candidates) {
        try { await execFileAsync(c, ['--version']); return c; } catch { /* ignore */ }
      }
      return null;
    }

    function qualityToPdfSettings(q: number) {
      if (q <= 12) return '/screen';
      if (q <= 25) return '/ebook';
      if (q <= 40) return '/printer';
      return '/prepress';
    }

    const gsCmd = await findGhostscript();
    if (gsCmd) result.used = `ghostscript (${gsCmd})`;
    else result.used = 'pdf-lib(fallback)';

    // цикл по файлам — после каждого файла отправляем событие прогресса
    let index = 0;
    for (const fname of pdfs) {
      // Проверяем отмену в начале итерации
      if (compressCancelRequested) {
        const cancelMsg = 'Операция сжатия отменена пользователем';
        result.log.push(cancelMsg);
        // Сообщаем о завершении и выходим из цикла
        mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
        break;
      }

      index++;
      const inP = path.join(inputFolder, fname);
      const outP = path.join(outputFolder, fname);
      const fileInfo: any = { name: fname, ok: false };

      // tmp имена для текущего файла (в области видимости цикла)
      const tmpIn = path.join(os.tmpdir(), `in-${randomUUID()}.pdf`);
      const tmpOut = path.join(os.tmpdir(), `out-${randomUUID()}.pdf`);

      try {
        const statIn = await fsp.stat(inP).catch(() => ({ size: undefined as any }));
        fileInfo.inSize = statIn.size;

        if (gsCmd) {
          // копируем входной файл в tmp с ASCII-именем
          await fsp.copyFile(inP, tmpIn);

          const pdfSetting = qualityToPdfSettings(quality);
          const args = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${pdfSetting}`,
            '-dNOPAUSE',
            '-dBATCH',
            `-sOutputFile=${tmpOut}`,
            tmpIn
          ];

          try {
            const { stdout, stderr } = await execFileAsync(gsCmd, args);
            if (stdout) result.log.push(`[gs stdout] ${String(stdout).trim()}`);
            if (stderr) result.log.push(`[gs stderr] ${String(stderr).trim()}`);

            if (!(await fs.pathExists(tmpOut))) {
              throw new Error(`Ghostscript не создал выходной файл (tmpOut отсутствует)`);
            }

            // Копируем tmpOut в выходную папку
            await fs.copy(tmpOut, outP, { overwrite: true });

            fileInfo.ok = true;
            fileInfo.notes = `GS:${pdfSetting}`;
            result.log.push(`GS: ${fname} -> ${outP} (${pdfSetting})`);
          } catch (gsErr) {
            fileInfo.ok = false;
            fileInfo.error = (gsErr as Error).message;
            result.log.push(`Ошибка Ghostscript для ${fname}: ${(gsErr as Error).message}`);
          } finally {
            // Чистим временные файлы
            try { await fs.remove(tmpIn); } catch { /* ignore */ }
            try { await fs.remove(tmpOut); } catch { /* ignore */ }
          }
        } else {
          // Fallback: pdf-lib (без реального влияния качества)
          try {
            const inputBytes = await fsp.readFile(inP);
            // Важно: импорт PDFDocument должен быть на уровне файла, здесь предполагается, что он уже доступен.
            const pdfDoc = await PDFDocument.load(inputBytes);
            const outBytes = await pdfDoc.save();
            await fsp.writeFile(outP, outBytes);

            fileInfo.ok = true;
            fileInfo.notes = 'fallback';
            result.log.push(`FB: ${fname} -> ${outP}`);
          } catch (fbErr) {
            fileInfo.ok = false;
            fileInfo.error = (fbErr as Error).message;
            result.log.push(`Ошибка fallback для ${fname}: ${(fbErr as Error).message}`);
          }
        }

        const statOut = await fsp.stat(outP).catch(() => ({ size: undefined as any }));
        fileInfo.outSize = statOut.size;

        result.files?.push(fileInfo);
        result.processed++;

        // Прогресс по файлу
        mainWindow?.webContents.send('compress-progress', {
          index,
          total: result.total,
          name: fname,
          inSize: fileInfo.inSize,
          outSize: fileInfo.outSize,
          ok: fileInfo.ok,
          error: fileInfo.error || null,
          notes: fileInfo.notes || null
        });
      } catch (errFile) {
        // Ошибка на уровне обработки файла
        fileInfo.ok = false;
        fileInfo.error = (errFile as Error).message;
        result.log.push(`Ошибка обработки ${fname}: ${(errFile as Error).message}`);

        mainWindow?.webContents.send('compress-progress', {
          index,
          total: result.total,
          name: fname,
          inSize: fileInfo.inSize,
          outSize: fileInfo.outSize,
          ok: false,
          error: fileInfo.error || null,
          notes: fileInfo.notes || null
        });
      }

      // Дополнительная проверка отмены в конце итерации
      if (compressCancelRequested) {
        const cancelMsg = 'Операция сжатия отменена пользователем';
        result.log.push(cancelMsg);
        mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
        break;
      }
    }

    // Если не отменили — финализируем как обычно
    if (!compressCancelRequested) {
      mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
      result.log.unshift(`Сжатие завершено. Engine: ${result.used}`);
    }
    return result;
  } catch (err) {
    const em = `Ошибка compress-pdfs: ${(err as Error).message}`;
    result.log.push(em);
    mainWindow?.webContents.send('compress-complete', { processed: result.processed, total: result.total, log: result.log });
    return result;
  }
});

/* Обновления и инфо */
ipcMain.handle('check-for-updates', async () => { try { autoUpdater.checkForUpdates(); } catch (e) { mainWindow?.webContents.send('update-error', (e as Error).message); } });
ipcMain.handle('download-update', async () => { try { await autoUpdater.downloadUpdate(); return true; } catch { return false; } });
ipcMain.handle('quit-and-install', () => { isQuitting = true; autoUpdater.quitAndInstall(); });
ipcMain.handle('get-app-info', async () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }));
ipcMain.handle('open-external-url', async (_e, url: string) => { await shell.openExternal(url); return true; });

autoUpdater.on('update-available', (info) => { if (info.version !== app.getVersion()) mainWindow?.webContents.send('update-available', info.version); else mainWindow?.webContents.send('update-not-available'); });
autoUpdater.on('update-not-available', () => mainWindow?.webContents.send('update-not-available'));
autoUpdater.on('error', (err) => mainWindow?.webContents.send('update-error', (err as Error).message));
autoUpdater.on('download-progress', (p) => mainWindow?.webContents.send('update-download-progress', p.percent));
autoUpdater.on('update-downloaded', (info) => mainWindow?.webContents.send('update-downloaded', info.version));

/* Создать главное окно */
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, '../assets/icon.png'),
    autoHideMenuBar: true,
    minWidth: 900
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => autoUpdater.checkForUpdates());

  // Закрывать окно логов при закрытии главного окна, чтобы не оставлять "плавающих" окон.
  mainWindow.on('closed', () => {
    if (logWindow && !logWindow.isDestroyed()) {
      try { logWindow.close(); } catch { /* ignore */ }
      logWindow = null;
    }
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isQuitting && process.platform !== 'darwin') app.quit(); });