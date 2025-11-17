/**
 * Preload скрипт для безопасного взаимодействия renderer ↔ main
 * 
 * Этот модуль пробрасывает чистый API в window.electronAPI с помощью contextBridge.
 * Все взаимодействия между renderer и main процессами проходят через IPC каналы.
 * 
 * Комментарии на русском языке для удобства разработки.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * API для взаимодействия renderer процесса с main
 * Экспортируется в window.electronAPI
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ========================================
  // Управление папками и файлами
  // ========================================

  /**
   * Открыть диалог выбора папки
   * @param defaultPath - путь по умолчанию (опционально)
   * @returns выбранный путь или null если отменено
   */
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('select-folder', defaultPath),

  /**
   * Безопасное получение базового имени файла (без node path в renderer)
   * @param fullPath - полный путь к файлу
   * @returns базовое имя файла
   */
  basename: (fullPath: string) => fullPath.replace(/\\/g, '/').split('/').pop() || fullPath,

  /**
   * Проверить, является ли путь директорией
   * @param p - путь для проверки
   * @returns true если директория
   */
  pathIsDirectory: (p: string) => ipcRenderer.invoke('path-is-directory', p),

  /**
   * Подсчитать файлы в папке (не рекурсивно)
   * @param folderPath - путь к папке
   * @returns количество файлов
   */
  countFilesInFolder: (p: string) => ipcRenderer.invoke('count-files-in-folder', p),

  /**
   * Подсчитать PDF файлы в папке (рекурсивно)
   * @param folderPath - путь к папке
   * @returns количество PDF файлов
   */
  countPdfFilesInFolder: (folderPath: string) =>
    ipcRenderer.invoke('count-pdf-files-in-folder', folderPath),

  /**
   * Открыть папку в файловом менеджере
   * @param folderPath - путь к папке
   * @returns true если успешно
   */
  openFolder: (p: string) => ipcRenderer.invoke('open-folder', p),

  /**
   * Прочитать файл как буфер (для pdf.js в renderer)
   * @param filePath - путь к файлу
   * @returns объект с данными или ошибкой
   */
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('read-file-buffer', filePath),

  // ========================================
  // Настройки приложения
  // ========================================

  /**
   * Загрузить настройки из settings.json
   * @returns объект настроек
   */
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  /**
   * Сохранить настройки в settings.json
   * @param settings - объект настроек
   * @returns true если успешно
   */
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),

  // ========================================
  // Объединение PDF
  // ========================================

  /**
   * Запустить объединение PDF файлов (Уведомления + ЗЭПБ)
   * @param options - параметры объединения
   * @returns результат операции
   */
  mergePDFs: (options: any) => ipcRenderer.invoke('merge-pdfs', options),

  /**
   * Отменить текущее объединение
   * @returns true если запрос отправлен
   */
  cancelMerge: () => ipcRenderer.invoke('cancel-merge'),

  /**
   * Построить словарь код→путь для zepb или insert
   * @param type - тип словаря ('zepb' или 'insert')
   * @param folderPath - путь к папке
   * @param recursive - рекурсивное сканирование
   * @returns словарь код→путь
   */
  buildDict: (type: 'zepb' | 'insert', folderPath: string, recursive: boolean) =>
    ipcRenderer.invoke('build-dict', type, folderPath, recursive),

  // ========================================
  // Сжатие PDF
  // ========================================

  /**
   * Сжать список файлов (drag&drop режим)
   * @param opts - файлы, папка вывода, качество
   * @returns результат операции
   */
  compressFiles: (opts: { files: string[]; outputFolder: string; quality?: number }) =>
    ipcRenderer.invoke('compress-files', opts),

  /**
   * Сжать все PDF в папке
   * @param opts - папка ввода, папка вывода, качество
   * @returns результат операции
   */
  compressPDFs: (opts: { inputFolder: string; outputFolder: string; quality?: number }) =>
    ipcRenderer.invoke('compress-pdfs', opts),

  /**
   * Отменить текущее сжатие
   * @returns true если запрос отправлен
   */
  cancelCompress: () => ipcRenderer.invoke('cancel-compress'),

  // ========================================
  // Обновления приложения
  // ========================================

  /**
   * Проверить наличие обновлений
   * @returns null
   */
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  /**
   * Загрузить доступное обновление
   * @returns true если успешно
   */
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  /**
   * Завершить приложение и установить обновление
   */
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  /**
   * Получить информацию о приложении
   * @returns версия, платформа, архитектура
   */
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  /**
   * Открыть URL во внешнем браузере
   * @param url - URL для открытия
   */
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

  // ========================================
  // Логирование
  // ========================================

  /**
   * Отправить строку лога в main (logStore)
   * @param line - строка для логирования
   */
  appendLog: (line: string) => ipcRenderer.send('append-log', line),

  /**
   * Открыть окно логов
   * @returns true если успешно
   */
  openLogWindow: () => ipcRenderer.invoke('open-log-window'),

  /**
   * Экспортировать логи в файл
   * @param suggestedName - предложенное имя файла
   * @returns результат операции
   */
  exportLog: (suggestedName?: string) => ipcRenderer.invoke('export-log', suggestedName),

  // ========================================
  // Тема приложения
  // ========================================

  /**
   * Сообщить main о смене темы (для синхронизации с окном логов)
   * @param isDark - true если темная тема
   */
  setTheme: (isDark: boolean) => ipcRenderer.send('theme-changed', isDark),

  // ========================================
  // События из main → renderer
  // ========================================

  /**
   * Подписаться на событие прогресса сжатия
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onCompressProgress: (cb: (event: any, payload: any) => void) => {
    ipcRenderer.on('compress-progress', (_e, payload) => cb(null, payload));
    return () => ipcRenderer.removeAllListeners('compress-progress');
  },

  /**
   * Подписаться на событие завершения сжатия
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onCompressComplete: (cb: (event: any, payload: any) => void) => {
    ipcRenderer.on('compress-complete', (_e, payload) => cb(null, payload));
    return () => ipcRenderer.removeAllListeners('compress-complete');
  },

  /**
   * Подписаться на событие прогресса объединения
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onMergeProgress: (cb: (event: any, payload: any) => void) => {
    ipcRenderer.on('merge-progress', (_e, payload) => cb(null, payload));
    return () => ipcRenderer.removeAllListeners('merge-progress');
  },

  /**
   * Подписаться на событие несшитых файлов (предварительное)
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onMergeUnmatched: (cb: (event: any, payload: any) => void) => {
    ipcRenderer.on('merge-unmatched', cb);
    return () => ipcRenderer.removeListener('merge-unmatched', cb);
  },

  /**
   * Подписаться на событие завершения объединения
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onMergeComplete: (cb: (event: any, payload: any) => void) => {
    ipcRenderer.on('merge-complete', cb);
    return () => ipcRenderer.removeListener('merge-complete', cb);
  },

  /**
   * Подписаться на получение содержимого лога
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onLogContent: (cb: (event: any, content: string) => void) => {
    ipcRenderer.on('log-content', (_e, content) => cb(_e, content));
    return () => ipcRenderer.removeAllListeners('log-content');
  },

  /**
   * Подписаться на добавление строки в лог
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onLogAppend: (cb: (event: any, line: string) => void) => {
    ipcRenderer.on('log-append', (_e, line) => cb(_e, line));
    return () => ipcRenderer.removeAllListeners('log-append');
  },

  /**
   * Подписаться на событие смены темы
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onSetTheme: (cb: (event: any, isDark: boolean) => void) => {
    ipcRenderer.on('set-theme', (_e, isDark) => cb(_e, isDark));
    return () => ipcRenderer.removeAllListeners('set-theme');
  },

  /**
   * Подписаться на доступность обновления
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onUpdateAvailable: (cb: (event: any, version: string) => void) => {
    ipcRenderer.on('update-available', cb);
    return () => ipcRenderer.removeListener('update-available', cb);
  },

  /**
   * Подписаться на отсутствие обновлений
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onUpdateNotAvailable: (cb: (event: any) => void) => {
    ipcRenderer.on('update-not-available', cb);
    return () => ipcRenderer.removeListener('update-not-available', cb);
  },

  /**
   * Подписаться на ошибку обновления
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onUpdateError: (cb: (event: any, error: string) => void) => {
    ipcRenderer.on('update-error', cb);
    return () => ipcRenderer.removeListener('update-error', cb);
  },

  /**
   * Подписаться на прогресс загрузки обновления
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onUpdateDownloadProgress: (cb: (event: any, percent: number) => void) => {
    ipcRenderer.on('update-download-progress', cb);
    return () => ipcRenderer.removeAllListeners('update-download-progress');
  },

  /**
   * Подписаться на завершение загрузки обновления
   * @param cb - callback функция
   * @returns функция для отписки
   */
  onUpdateDownloaded: (cb: (event: any, version: string) => void) => {
    ipcRenderer.on('update-downloaded', cb);
    return () => ipcRenderer.removeAllListeners('update-downloaded');
  }
});
