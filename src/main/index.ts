/**
 * Главная точка входа main-процесса Electron приложения
 * Orchestration всех модулей, IPC handlers, окон и автообновлений
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createMainWindow, createLogWindow } from './window';
import { registerCompressHandlers } from './ipc/compress';
import { registerMergeHandlers } from './ipc/merge';
import { registerUtilsHandlers } from './ipc/utils';
import {
  registerUpdateHandlers,
  setupAutoUpdaterListeners,
  setIsQuitting
} from './ipc/updates';

/**
 * Глобальное состояние приложения
 */
let mainWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let currentThemeIsDark = false;

/**
 * Хранилище логов
 */
const logStore: string[] = [];

/**
 * Получить главное окно
 */
function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Получить окно логов
 */
function getLogWindow(): BrowserWindow | null {
  return logWindow;
}

/**
 * Создать окно логов с применением стилей
 */
async function createLogWindowWithState(): Promise<BrowserWindow> {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return logWindow;
  }

  logWindow = await createLogWindow(logStore, currentThemeIsDark);
  
  logWindow.on('closed', () => {
    logWindow = null;
  });

  return logWindow;
}

/**
 * Инициализация приложения
 */
function initialize(): void {
  // Регистрируем все IPC handlers
  registerCompressHandlers(getMainWindow);
  registerMergeHandlers(getMainWindow, getLogWindow, logStore);
  registerUtilsHandlers(logStore, getLogWindow, createLogWindowWithState);
  registerUpdateHandlers(getMainWindow);

  // Настраиваем слушатели автообновлений
  setupAutoUpdaterListeners(getMainWindow);

  // Создаем главное окно
  mainWindow = createMainWindow();

  // Проверяем обновления после загрузки
  mainWindow.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates();
  });

  // Обработка закрытия главного окна
  mainWindow.on('closed', () => {
    if (logWindow && !logWindow.isDestroyed()) {
      try {
        logWindow.close();
      } catch {
        // Игнорируем ошибки при закрытии
      }
      logWindow = null;
    }
    mainWindow = null;
  });
}

/**
 * Готовность приложения
 */
app.whenReady().then(() => {
  initialize();

  // macOS: воссоздать окно при активации
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      initialize();
    }
  });
});

/**
 * Закрытие всех окон
 */
app.on('window-all-closed', () => {
  // macOS: не завершать приложение при закрытии всех окон
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Обработка событий перед завершением (если нужно)
 */
app.on('before-quit', () => {
  setIsQuitting(true);
});
