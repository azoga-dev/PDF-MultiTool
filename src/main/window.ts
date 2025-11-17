/**
 * Фабрика для создания окон приложения
 * Управление главным окном и окном логов
 */

import { BrowserWindow } from 'electron';
import * as path from 'path';
import { promises as fsp } from 'fs';
import fs from 'fs-extra';
import { pathToFileURL } from 'url';

/**
 * Создать главное окно приложения
 * @returns созданное окно
 */
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    autoHideMenuBar: true,
    minWidth: 900
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  return mainWindow;
}

/**
 * Создать окно логов с применением стилей из основного приложения
 * @param logStore - хранилище логов для отображения
 * @param currentThemeIsDark - текущая тема (темная/светлая)
 * @returns созданное окно логов
 */
export async function createLogWindow(
  logStore: string[],
  currentThemeIsDark: boolean
): Promise<BrowserWindow> {
  const logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Лог приложения'
  });

  const htmlPath = path.join(__dirname, 'logWindow.html');

  await logWindow.loadFile(htmlPath).catch(err => {
    console.error('Ошибка загрузки logWindow.html:', err);
    logStore.push(`[ERROR] Ошибка загрузки logWindow.html: ${(err as Error).message}`);
  });

  // Применяем стили и инициализируем окно после загрузки
  logWindow.webContents.once('did-finish-load', async () => {
    try {
      // Отправляем текущий лог и тему
      logWindow.webContents.send('log-content', logStore.join('\n'));
      logWindow.webContents.send('set-theme', currentThemeIsDark);

      // Найти styles.css (dist предпочтительно)
      const candidates = [
        path.join(__dirname, 'styles.css'),
        path.join(process.cwd(), 'dist', 'styles.css'),
        path.join(process.cwd(), 'src', 'styles.css')
      ];

      let cssPath: string | null = null;
      for (const p of candidates) {
        if (await fs.pathExists(p)) {
          cssPath = p;
          break;
        }
      }

      if (cssPath) {
        try {
          const css = await fsp.readFile(cssPath, 'utf8');
          await logWindow.webContents.insertCSS(css);
          logStore.push(`[DEBUG] insertCSS applied for ${cssPath}`);
        } catch (err) {
          console.warn('[logWindow] insertCSS failed:', (err as Error).message);
          logStore.push(`[WARN] insertCSS failed: ${(err as Error).message}`);
        }

        try {
          const cssFileUrl = pathToFileURL(cssPath).href;
          await logWindow.webContents.executeJavaScript(
            `
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
          `,
            true
          );
          logStore.push(`[DEBUG] <link> injected: ${cssPath}`);
        } catch (err) {
          console.warn('[logWindow] insert <link> failed:', (err as Error).message);
          logStore.push(`[WARN] insert <link> failed: ${(err as Error).message}`);
        }
      } else {
        const warn = `styles.css не найден (пытались: ${candidates.join(', ')})`;
        console.warn(`[logWindow] ${warn}`);
        logStore.push(`[WARN] ${warn}`);
      }

      // Диагностика и fallback CSS
      const diag = await logWindow.webContents.executeJavaScript(
        `
        (function(){
          try {
            const sheets = document.styleSheets ? document.styleSheets.length : 0;
            const btn = document.querySelector('.btn') || document.querySelector('button') || document.body;
            const computed = btn ? window.getComputedStyle(btn) : null;
            const bg = computed ? computed.backgroundColor : null;
            const color = computed ? computed.color : null;
            const hasLink = !!document.querySelector('link[data-injected-styles]');
            return { sheets, bg, color, hasLink };
          } catch (e) {
            return { error: e && e.message };
          }
        })();
      `,
        true
      );

      logStore.push(`[DEBUG] logWindow diag: ${JSON.stringify(diag)}`);

      const needFallback =
        !diag ||
        diag.sheets === 0 ||
        !diag.bg ||
        diag.bg === 'rgba(0, 0, 0, 0)' ||
        diag.bg === 'transparent';

      if (needFallback) {
        const fallbackCss = `
          :root { --bg: #ffffff; --text: #111827; --panel: #f9fafb; --border: #e5e7eb; --btn-bg: #3b82f6; --btn-text: #fff; --muted: #6b7280; }
          [data-theme="dark"] { --bg: #0b1220; --text: #e5e7eb; --panel: #111827; --border: #374151; --btn-bg: #2563eb; --btn-text: #fff; --muted: #9ca3af; }
          html,body { background:var(--bg); color:var(--text); font-family: Inter, system-ui, Arial; }
          .wrap { padding:12px; box-sizing:border-box; height:100%; display:flex; flex-direction:column; gap:12px; }
          .btn { padding:8px 12px; border-radius:8px; border:1px solid var(--border); cursor:pointer; background:var(--panel) !important; color:var(--text) !important; }
          .btn.primary { background:var(--btn-bg) !important; color:var(--btn-text) !important; border:none !important; }
          .filters { display:flex; gap:8px; align-items:center; }
          .log { flex:1; width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--panel); color:var(--text); font-family:monospace; font-size:13px; overflow:auto; white-space:pre; }
          .search { padding:6px 8px; border-radius:6px; border:1px solid var(--border); background:var(--panel); color:var(--text); }
          .small { color:var(--muted); font-size:12px; }
        `;
        try {
          await logWindow.webContents.insertCSS(fallbackCss);
          logStore.push('[DEBUG] fallback CSS inserted into logWindow');
          logWindow.webContents.send('set-theme', currentThemeIsDark);
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

  return logWindow;
}
