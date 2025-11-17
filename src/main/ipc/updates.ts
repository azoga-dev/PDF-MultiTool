/**
 * IPC обработчики для авто-обновлений
 * Управление проверкой, загрузкой и установкой обновлений
 */

import { ipcMain, app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Флаг завершения приложения
 */
let isQuitting = false;

/**
 * Установить флаг завершения приложения
 * @param value - значение флага
 */
export function setIsQuitting(value: boolean): void {
  isQuitting = value;
}

/**
 * Получить флаг завершения приложения
 * @returns значение флага
 */
export function getIsQuitting(): boolean {
  return isQuitting;
}

/**
 * Зарегистрировать обработчики IPC для обновлений
 * @param getMainWindow - функция для получения главного окна
 */
export function registerUpdateHandlers(getMainWindow: () => BrowserWindow | null): void {
  // IPC: проверить обновления
  ipcMain.handle('check-for-updates', async () => {
    try {
      autoUpdater.checkForUpdates();
      return null;
    } catch (e) {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('update-error', (e as Error).message);
      throw e;
    }
  });

  // IPC: загрузить обновление
  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch {
      return false;
    }
  });

  // IPC: завершить и установить
  ipcMain.handle('quit-and-install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  // IPC: получить информацию о приложении
  ipcMain.handle('get-app-info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }));
}

/**
 * Настроить слушатели событий autoUpdater
 * @param getMainWindow - функция для получения главного окна
 */
export function setupAutoUpdaterListeners(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.on('update-available', info => {
    const mainWindow = getMainWindow();
    if (info.version !== app.getVersion()) {
      mainWindow?.webContents.send('update-available', info.version);
    } else {
      mainWindow?.webContents.send('update-not-available');
    }
  });

  autoUpdater.on('update-not-available', () => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('error', err => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('update-error', (err as Error).message);
  });

  autoUpdater.on('download-progress', p => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('update-download-progress', p.percent);
  });

  autoUpdater.on('update-downloaded', info => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('update-downloaded', info.version);
  });
}
