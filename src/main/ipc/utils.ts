/**
 * IPC обработчики для утилит и общих функций
 * Работа с папками, файлами, настройками, логами
 */

import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { promises as fsp } from 'fs';
import fs from 'fs-extra';
import { pathIsDirectory, countFilesInFolder, countPdfFilesInFolder } from '../services/fs-utils';

/**
 * Последняя выбранная папка (для удобства диалогов)
 */
let lastSelectedFolder: string | null = null;

/**
 * Зарегистрировать обработчики IPC для утилит
 * @param logStore - хранилище логов
 * @param getLogWindow - функция для получения окна логов
 * @param createLogWindow - функция для создания окна логов
 */
export function registerUtilsHandlers(
  logStore: string[],
  getLogWindow: () => BrowserWindow | null,
  createLogWindow: () => Promise<BrowserWindow>
): void {
  // IPC: выбор папки
  ipcMain.handle('select-folder', async (_event, defaultPath?: string) => {
    const startPath =
      defaultPath && (await fs.pathExists(defaultPath))
        ? defaultPath
        : lastSelectedFolder && (await fs.pathExists(lastSelectedFolder))
        ? lastSelectedFolder
        : undefined;

    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      properties: ['openDirectory'],
      defaultPath: startPath
    });

    if (!result.canceled && result.filePaths.length) {
      lastSelectedFolder = result.filePaths[0];
      return lastSelectedFolder;
    }
    
    return null;
  });

  // IPC: проверка, является ли путь директорией
  ipcMain.handle('path-is-directory', async (_e, p: string) => {
    return await pathIsDirectory(p);
  });

  // IPC: подсчет файлов в папке
  ipcMain.handle('count-files-in-folder', async (_e, folderPath: string) => {
    return await countFilesInFolder(folderPath);
  });

  // IPC: подсчет PDF файлов в папке (рекурсивно)
  ipcMain.handle('count-pdf-files-in-folder', async (_e, folderPath: string) => {
    return await countPdfFilesInFolder(folderPath);
  });

  // IPC: открыть папку в файловом менеджере
  ipcMain.handle('open-folder', async (_e, folderPath: string) => {
    try {
      await shell.openPath(folderPath);
      return true;
    } catch {
      return false;
    }
  });

  // IPC: открыть внешний URL
  ipcMain.handle('open-external-url', async (_e, url: string) => {
    await shell.openExternal(url);
    return true;
  });

  // IPC: загрузка настроек
  ipcMain.handle('load-settings', async () => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      if (await fs.pathExists(settingsPath)) {
        return await fs.readJson(settingsPath);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
    return {};
  });

  // IPC: сохранение настроек
  ipcMain.handle('save-settings', async (_e, settings: any) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      await fs.writeJson(settingsPath, settings, { spaces: 2 });
      return true;
    } catch (err) {
      console.error('Error saving settings:', err);
      return false;
    }
  });

  // IPC: чтение файла как буфер
  ipcMain.handle('read-file-buffer', async (_e, filePath: string) => {
    try {
      const buf = await fsp.readFile(filePath);
      return { ok: true, data: Array.from(buf) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // IPC: отправка лога
  ipcMain.on('append-log', (_e, message: string) => {
    const line = typeof message === 'string' ? message : JSON.stringify(message);
    logStore.push(line);
    
    const logWindow = getLogWindow();
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.webContents.send('log-append', line);
    }
  });

  // IPC: открыть окно логов
  ipcMain.handle('open-log-window', async () => {
    await createLogWindow();
    return true;
  });

  // IPC: экспорт логов
  ipcMain.handle('export-log', async (_e, suggestedName?: string) => {
    const defaultName =
      suggestedName ||
      `pdfmanager-log-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.txt`;
      
    const { filePath, canceled } = await dialog.showSaveDialog(
      BrowserWindow.getFocusedWindow()!,
      {
        defaultPath: defaultName,
        filters: [{ name: 'Text', extensions: ['txt', 'log'] }]
      }
    );
    
    if (canceled || !filePath) {
      return { ok: false };
    }
    
    try {
      await fsp.writeFile(filePath, logStore.join('\n'), { encoding: 'utf8' });
      return { ok: true, path: filePath };
    } catch (err) {
      console.error('Export log error:', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  // IPC: тема изменена
  ipcMain.on('theme-changed', (_e, isDark: boolean) => {
    const logWindow = getLogWindow();
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.webContents.send('set-theme', !!isDark);
    }
  });
}
