/**
 * IPC обработчики для объединения PDF файлов
 * Сопоставление Уведомлений и ЗЭПБ, создание реестра
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import fs from 'fs-extra';
import {
  buildDict,
  extractNotificationCode,
  extractZepbCode,
  createRegisterDocx,
  mergePdfFiles
} from '../services/merge-service';
import { fileMarkedProcessed } from '../services/fs-utils';

/**
 * Флаг отмены текущего объединения
 */
let mergeCancelRequested = false;

/**
 * Интерфейс результата объединения
 */
interface MergeSummary {
  processed: number;
  skipped: number;
  errors: string[];
  log: string[];
  total: number;
  canceled: boolean;
}

/**
 * Зарегистрировать обработчики IPC для объединения
 * @param getMainWindow - функция для получения главного окна
 * @param getLogWindow - функция для получения окна логов
 * @param logStore - хранилище логов
 */
export function registerMergeHandlers(
  getMainWindow: () => BrowserWindow | null,
  getLogWindow: () => BrowserWindow | null,
  logStore: string[]
): void {
  // IPC: объединение PDF файлов
  ipcMain.handle(
    'merge-pdfs',
    async (
      _event,
      {
        mainFolder,
        insertFolder,
        outputFolder,
        recursiveMain,
        recursiveInsert
      }: {
        mainFolder: string;
        insertFolder: string;
        outputFolder: string;
        recursiveMain: boolean;
        recursiveInsert: boolean;
      }
    ) => {
      const summary: MergeSummary = {
        processed: 0,
        skipped: 0,
        errors: [],
        log: [],
        total: 0,
        canceled: false
      };

      const mainWindow = getMainWindow();
      const logWindow = getLogWindow();

      try {
        if (!mainFolder || !insertFolder || !outputFolder) {
          throw new Error('Не указаны папки');
        }
        
        await fs.ensureDir(outputFolder);
        mergeCancelRequested = false;

        // 1) Построение словарей (код → путь к файлу)
        const insertDict = await buildDict(
          insertFolder,
          !!recursiveInsert,
          full => full.toLowerCase().endsWith('.pdf'),
          extractNotificationCode
        );

        const zepbDict = await buildDict(
          mainFolder,
          !!recursiveMain,
          (full, name) => full.toLowerCase().endsWith('.pdf') && name.toLowerCase().includes('зэпб'),
          extractZepbCode
        );

        const insertCodes = Object.keys(insertDict);
        const zepbCodes = Object.keys(zepbDict);

        summary.total = insertCodes.length;

        // 2) Вычисление несшитых файлов
        const zepbSet = new Set(zepbCodes);
        const insertSet = new Set(insertCodes);

        const unmatchedNotifications = insertCodes
          .filter(code => !zepbSet.has(code))
          .map(code => ({ code, file: path.basename(insertDict[code]) }));

        const unmatchedZepb = zepbCodes
          .filter(code => !insertSet.has(code))
          .map(code => ({ code, file: path.basename(zepbDict[code]) }));

        // Отправляем предварительный список несшитых
        mainWindow?.webContents.send('merge-unmatched', {
          unmatchedNotifications,
          unmatchedZepb
        });

        // 3) Основной цикл объединения
        const processedNames: string[] = [];

        for (let i = 0; i < insertCodes.length; i++) {
          // Проверка отмены
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
            logWindow?.webContents.send('log-append', cancelMsg);
            break;
          }

          const code = insertCodes[i];
          const notifPath = insertDict[code];
          const zepbPath = zepbDict[code];
          const index = i + 1;

          // Проверка наличия ЗЭПБ
          if (!zepbPath) {
            const msg = `Не найден ЗЭПБ для уведомления: ${path.basename(notifPath)} (${code})`;
            summary.log.push(msg);
            summary.skipped++;
            
            mainWindow?.webContents.send('merge-progress', {
              processed: summary.processed,
              skipped: summary.skipped,
              total: summary.total,
              current: index,
              code,
              message: msg
            });
            
            logStore.push(msg);
            logWindow?.webContents.send('log-append', msg);
            continue;
          }

          // Проверка, не обработан ли уже файл
          if (fileMarkedProcessed(path.basename(zepbPath))) {
            const msg = `Пропущен уже обработанный ЗЭПБ: ${path.basename(zepbPath)}`;
            summary.log.push(msg);
            summary.skipped++;
            
            mainWindow?.webContents.send('merge-progress', {
              processed: summary.processed,
              skipped: summary.skipped,
              total: summary.total,
              current: index,
              code,
              message: msg
            });
            
            logStore.push(msg);
            logWindow?.webContents.send('log-append', msg);
            continue;
          }

          // Объединение файлов
          try {
            // Формируем имя выходного файла
            const base = path
              .basename(zepbPath, '.pdf')
              .replace(/\s*\(с увед.*?\)\s*$/i, '')
              .replace(/\s*с увед.*?$/i, '');
            const outName = `${base} (с увед).pdf`;
            const outFull = path.join(outputFolder, outName);

            // Объединяем PDF
            await mergePdfFiles(notifPath, zepbPath, outFull);

            summary.processed++;
            processedNames.push(outName);

            const msg = `Сшито: ${outName}`;
            summary.log.push(msg);
            
            mainWindow?.webContents.send('merge-progress', {
              processed: summary.processed,
              skipped: summary.skipped,
              total: summary.total,
              current: index,
              code,
              message: msg
            });
            
            logStore.push(msg);
            logWindow?.webContents.send('log-append', msg);
          } catch (err) {
            const msg = `Ошибка при объединении кода ${code}: ${(err as Error).message}`;
            summary.log.push(msg);
            summary.errors.push(msg);
            summary.skipped++;
            
            mainWindow?.webContents.send('merge-progress', {
              processed: summary.processed,
              skipped: summary.skipped,
              total: summary.total,
              current: index,
              code,
              message: msg
            });
            
            logStore.push(msg);
            logWindow?.webContents.send('log-append', msg);
          }
        }

        // 4) Формирование реестра
        const registryPath = processedNames.length
          ? await createRegisterDocx(outputFolder, processedNames)
          : null;

        // Отправляем итоговое событие
        mainWindow?.webContents.send('merge-complete', {
          summary,
          registry: registryPath,
          unmatchedNotifications,
          unmatchedZepb
        });

        return {
          ...summary,
          registry: registryPath,
          unmatchedNotifications,
          unmatchedZepb
        };
      } catch (err) {
        const em = (err as Error).message || String(err);
        const msg = `Ошибка объединения: ${em}`;
        console.error(msg);
        summary.errors.push(msg);
        summary.log.push(msg);
        
        mainWindow?.webContents.send('merge-complete', {
          summary,
          registry: null,
          unmatchedNotifications: [],
          unmatchedZepb: []
        });
        
        return {
          ...summary,
          registry: null,
          unmatchedNotifications: [],
          unmatchedZepb: []
        };
      }
    }
  );

  // IPC: отмена объединения
  ipcMain.handle('cancel-merge', async () => {
    mergeCancelRequested = true;
    return true;
  });

  // IPC: построение словаря
  ipcMain.handle(
    'build-dict',
    async (
      _e,
      type: 'zepb' | 'insert',
      folderPath: string,
      recursive: boolean
    ) => {
      try {
        if (type === 'zepb') {
          return await buildDict(
            folderPath,
            recursive,
            (f, n) => f.toLowerCase().endsWith('.pdf') && n.toLowerCase().includes('зэпб'),
            extractZepbCode
          );
        } else {
          return await buildDict(
            folderPath,
            recursive,
            f => f.toLowerCase().endsWith('.pdf'),
            extractNotificationCode
          );
        }
      } catch {
        return {};
      }
    }
  );
}
