import { contextBridge, ipcRenderer } from 'electron';

// Проброс API из main в renderer.
// Каждая функция вызывает соответствующий ipc канал или подписывается на событие.
// Используйте window.electronAPI.<method> в renderer.

contextBridge.exposeInMainWorld('electronAPI', {
  // Открыть диалог выбора папки (main -> dialog)
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('select-folder', defaultPath),

  // Безопасный basename (renderer не имеет доступа к node path)
  basename: (fullPath: string) => fullPath.replace(/\\/g, '/').split('/').pop() || fullPath,

  // Настройки: load/save в main (файл settings.json)
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),

  // Запустить объединение PDF в main
  mergePDFs: (options: any) => ipcRenderer.invoke('merge-pdfs', options),

  // Отменить текущее объединение (main ставит флаг cancel)
  cancelMerge: () => ipcRenderer.invoke('cancel-merge'),
  cancelCompress: () => ipcRenderer.invoke('cancel-compress'),

  // Отправить в main информацию о текущей теме (sync theme main -> logWindow)
  setTheme: (isDark: boolean) => ipcRenderer.send('theme-changed', isDark),

  // Открыть папку в файловом менеджере (main -> shell)
  openFolder: (p: string) => ipcRenderer.invoke('open-folder', p),

  // Построить словарь (код -> путь) для zepb/insert
  buildDict: (type: 'zepb' | 'insert', folderPath: string, recursive: boolean) => ipcRenderer.invoke('build-dict', type, folderPath, recursive),

  // Подсчитать файлы в папке (main fs)
  countFilesInFolder: (p: string) => ipcRenderer.invoke('count-files-in-folder', p),

  // Информация об приложении
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Открыть внешний URL
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  onCompressProgress: (cb: (event: any, payload: any) => void) => { ipcRenderer.on('compress-progress', (_e, payload) => cb(null, payload)); return () => ipcRenderer.removeAllListeners('compress-progress'); },
  onCompressComplete: (cb: (event: any, payload: any) => void) => { ipcRenderer.on('compress-complete', (_e, payload) => cb(null, payload)); return () => ipcRenderer.removeAllListeners('compress-complete'); },

  // Сжатие PDF (main)
  compressPDFs: (opts: { inputFolder: string, outputFolder: string, quality?: number }) => ipcRenderer.invoke('compress-pdfs', opts),
  compressFiles: (opts: { files: string[]; outputFolder: string; quality?: number }) => ipcRenderer.invoke('compress-files', opts),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('read-file-buffer', filePath),
  
  // Проверка — является ли путь директорией
  pathIsDirectory: (p: string) => ipcRenderer.invoke('path-is-directory', p),

  // Подсчитать количество PDF-файлов в папке (рекурсивно)
  countPdfFilesInFolder: (folderPath: string) => ipcRenderer.invoke('count-pdf-files-in-folder', folderPath),

  // Обновления
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  // Логирование: отправить строку в main (logStore)
  appendLog: (line: string) => ipcRenderer.send('append-log', line),

  // Окно логов: открыть и экспортировать (main обрабатывает)
  openLogWindow: () => ipcRenderer.invoke('open-log-window'),
  exportLog: (suggestedName?: string) => ipcRenderer.invoke('export-log', suggestedName),

  // Слушатели событий из main
  onLogContent: (cb: (event: any, content: string) => void) => { ipcRenderer.on('log-content', (_e, content) => cb(_e, content)); return () => ipcRenderer.removeAllListeners('log-content'); },
  onLogAppend: (cb: (event: any, line: string) => void) => { ipcRenderer.on('log-append', (_e, line) => cb(_e, line)); return () => ipcRenderer.removeAllListeners('log-append'); },

  // Слушатель темы (main -> renderer/logWindow)
  onSetTheme: (cb: (event: any, isDark: boolean) => void) => { ipcRenderer.on('set-theme', (_e, isDark) => cb(_e, isDark)); return () => ipcRenderer.removeAllListeners('set-theme'); },

  onUpdateAvailable: (cb: (event: any, version: string) => void) => { ipcRenderer.on('update-available', cb); return () => ipcRenderer.removeListener('update-available', cb); },
  onUpdateNotAvailable: (cb: (event: any) => void) => { ipcRenderer.on('update-not-available', cb); return () => ipcRenderer.removeListener('update-not-available', cb); },
  onUpdateError: (cb: (event: any, error: string) => void) => { ipcRenderer.on('update-error', cb); return () => ipcRenderer.removeListener('update-error', cb); },
  onUpdateDownloadProgress: (cb: (event: any, percent: number) => void) => { ipcRenderer.on('update-download-progress', cb); return () => ipcRenderer.removeAllListeners('update-download-progress'); },
  onUpdateDownloaded: (cb: (event: any, version: string) => void) => { ipcRenderer.on('update-downloaded', cb); return () => ipcRenderer.removeAllListeners('update-downloaded'); },
  
  // Прогресс и завершение объединения
  onMergeProgress: (cb: (event: any, payload: any) => void) => { ipcRenderer.on('merge-progress', (_e, payload) => cb(null, payload)); return () => ipcRenderer.removeAllListeners('merge-progress'); },
  onMergeComplete: (cb: (event: any, payload: any) => void) => { ipcRenderer.on('merge-complete', (_e, payload) => cb(null, payload)); return () => ipcRenderer.removeAllListeners('merge-complete'); }
});