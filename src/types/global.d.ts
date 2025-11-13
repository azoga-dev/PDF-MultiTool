// Описание window.electronAPI (короткие комменты).
// preload пробрасывает эти методы в renderer, они вызывают соответствующие ipc каналы в main.

declare global {
  interface Window {
    electronAPI: {
      selectFolder: (defaultPath?: string) => Promise<string | null>;
      basename: (fullPath: string) => string;
      loadSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<boolean>;
      mergePDFs: (options: {
        mainFolder: string;
        insertFolder: string;
        outputFolder: string;
        recursiveMain: boolean;
        recursiveInsert: boolean;
      }) => Promise<{
        processed: number;
        skipped: number;
        errors: string[];
        log: string[];
        total: number;
      }>;
      cancelMerge: () => Promise<boolean>;
      setTheme: (isDark: boolean) => void;
      buildDict: (type: 'zepb' | 'insert', folderPath: string, recursive: boolean) => Promise<Record<string, string>>;
      countFilesInFolder: (folderPath: string) => Promise<number>;
      openFolder: (folderPath: string) => Promise<boolean>;
      compressPDFs: (options: { inputFolder: string; outputFolder: string; quality?: number }) => Promise<{ processed: number; total: number; log: string[]; used?: string }>;
      compressFiles: (options: { files: string[]; outputFolder: string; quality?: number }) => Promise<{ processed: number; total: number; log: string[]; used?: string }>;
      pathIsDirectory: (p: string) => Promise<boolean>;
      onCompressProgress: (cb: (event: any, payload: { index: number; total: number; name: string; inSize?: number; outSize?: number; ok: boolean; error?: string | null; notes?: string | null }) => void) => () => void;
      onCompressComplete: (cb: (event: any, payload: { processed: number; total: number; log: string[] }) => void) => () => void;
      cancelCompress: () => Promise<boolean>;
      getAppInfo: () => Promise<{ version: string; platform: string; arch: string }>;
      openExternalUrl: (url: string) => Promise<void>;
      checkForUpdates: () => Promise<null>;
      downloadUpdate: () => Promise<boolean>;
      quitAndInstall: () => Promise<void>;
      // Подсчитать PDF-файлы в папке
      countPdfFilesInFolder: (folderPath: string) => Promise<number>;

      // Логирование: отправка и управление окном логов
      appendLog: (line: string) => void;
      openLogWindow: () => Promise<boolean>;
      exportLog: (suggestedName?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      onLogContent: (cb: (event: any, content: string) => void) => () => void;
      onLogAppend: (cb: (event: any, line: string) => void) => () => void;
      onSetTheme: (cb: (event: any, isDark: boolean) => void) => () => void;

      onUpdateAvailable: (cb: (event: any, version: string) => void) => () => void;
      onUpdateNotAvailable: (cb: (event: any) => void) => () => void;
      onUpdateError: (cb: (event: any, error: string) => void) => () => void;
      onUpdateDownloadProgress: (cb: (event: any, percent: number) => void) => () => void;
      onUpdateDownloaded: (cb: (event: any, version: string) => void) => () => void;
      onMergeProgress: (cb: (event: any, payload: any) => void) => () => void;
      onMergeComplete: (cb: (event: any, payload: any) => void) => () => void;
    };
  }
}

export {};