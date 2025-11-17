/**
 * IPC обработчики для сжатия PDF файлов
 * Регистрация handler('compress-files') и handler('compress-pdfs')
 */

import { ipcMain, BrowserWindow } from 'electron';
import { compressFiles, compressPdfs, FileProcessResult } from '../services/pdf-service';

/**
 * Флаг отмены текущего сжатия
 */
let compressCancelRequested = false;

/**
 * Зарегистрировать обработчики IPC для сжатия
 * @param getMainWindow - функция для получения главного окна
 */
export function registerCompressHandlers(getMainWindow: () => BrowserWindow | null): void {
  // IPC: сжатие списка файлов (drag&drop)
  ipcMain.handle(
    'compress-files',
    async (
      _e,
      {
        files,
        outputFolder,
        quality = 30
      }: { files: string[]; outputFolder: string; quality?: number }
    ) => {
      compressCancelRequested = false;
      const mainWindow = getMainWindow();

      const result = await compressFiles(
        files,
        outputFolder,
        quality,
        (index, total, fileResult) => {
          // Проверяем отмену
          if (compressCancelRequested) {
            return;
          }

          // Отправляем прогресс
          mainWindow?.webContents.send('compress-progress', {
            index,
            total,
            name: fileResult.name,
            inSize: fileResult.inSize,
            outSize: fileResult.outSize,
            ok: fileResult.ok,
            error: fileResult.error || null,
            notes: fileResult.notes || null
          });
        }
      );

      // Отправляем событие завершения
      mainWindow?.webContents.send('compress-complete', {
        processed: result.processed,
        total: result.total,
        log: result.log
      });

      return result;
    }
  );

  // IPC: сжатие PDF из папки
  ipcMain.handle(
    'compress-pdfs',
    async (
      _e,
      {
        inputFolder,
        outputFolder,
        quality = 30
      }: { inputFolder: string; outputFolder: string; quality?: number }
    ) => {
      compressCancelRequested = false;
      const mainWindow = getMainWindow();

      const result = await compressPdfs(
        inputFolder,
        outputFolder,
        quality,
        (index, total, fileResult) => {
          // Проверяем отмену
          if (compressCancelRequested) {
            return;
          }

          // Отправляем прогресс
          mainWindow?.webContents.send('compress-progress', {
            index,
            total,
            name: fileResult.name,
            inSize: fileResult.inSize,
            outSize: fileResult.outSize,
            ok: fileResult.ok,
            error: fileResult.error || null,
            notes: fileResult.notes || null
          });
        }
      );

      // Отправляем событие завершения
      mainWindow?.webContents.send('compress-complete', {
        processed: result.processed,
        total: result.total,
        log: result.log
      });

      return result;
    }
  );

  // IPC: отмена сжатия
  ipcMain.handle('cancel-compress', async () => {
    compressCancelRequested = true;
    return true;
  });
}
