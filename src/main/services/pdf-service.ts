/**
 * Сервис для работы с PDF файлами
 * Обработка сжатия PDF с использованием Ghostscript или fallback через pdf-lib
 */

import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'crypto';
import { compressWithGhostscript, findGhostscript, qualityToPdfSettings } from './ghostscript';

/**
 * Результат обработки файла
 */
export interface FileProcessResult {
  name: string;
  ok: boolean;
  inSize?: number;
  outSize?: number;
  error?: string;
  notes?: string;
}

/**
 * Результат операции сжатия
 */
export interface CompressResult {
  processed: number;
  total: number;
  log: string[];
  used?: string;
  files?: FileProcessResult[];
}

/**
 * Сжать один PDF файл используя Ghostscript или fallback
 * @param inputPath - путь к входному файлу
 * @param outputPath - путь к выходному файлу
 * @param quality - качество сжатия (0-100)
 * @param gsCmd - команда Ghostscript (если доступна)
 * @returns результат обработки файла
 */
export async function compressSinglePdf(
  inputPath: string,
  outputPath: string,
  quality: number,
  gsCmd: string | null
): Promise<FileProcessResult> {
  const fname = path.basename(inputPath);
  const result: FileProcessResult = { name: fname, ok: false };
  
  // Временные файлы для Ghostscript (с ASCII именами)
  const tmpIn = path.join(os.tmpdir(), `in-${randomUUID()}.pdf`);
  const tmpOut = path.join(os.tmpdir(), `out-${randomUUID()}.pdf`);

  try {
    // Получаем размер входного файла
    const statIn = await fsp.stat(inputPath).catch(() => ({ size: undefined }));
    result.inSize = statIn.size;

    if (gsCmd) {
      // Используем Ghostscript
      await fsp.copyFile(inputPath, tmpIn);
      
      const gsResult = await compressWithGhostscript(gsCmd, tmpIn, tmpOut, quality);
      
      if (gsResult.success) {
        await fs.copy(tmpOut, outputPath, { overwrite: true });
        result.ok = true;
        result.notes = `GS:${qualityToPdfSettings(quality)}`;
      } else {
        result.ok = false;
        result.error = gsResult.error;
      }
      
      // Очищаем временные файлы
      try { await fs.remove(tmpIn); } catch { /* ignore */ }
      try { await fs.remove(tmpOut); } catch { /* ignore */ }
    } else {
      // Fallback: используем pdf-lib (без настоящего сжатия)
      try {
        const inputBytes = await fsp.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(inputBytes);
        const outBytes = await pdfDoc.save();
        await fsp.writeFile(outputPath, outBytes);
        
        result.ok = true;
        result.notes = 'fallback';
      } catch (fbErr) {
        result.ok = false;
        result.error = (fbErr as Error).message;
      }
    }

    // Получаем размер выходного файла
    const statOut = await fsp.stat(outputPath).catch(() => ({ size: undefined }));
    result.outSize = statOut.size;
    
    return result;
  } catch (err) {
    result.ok = false;
    result.error = (err as Error).message;
    return result;
  }
}

/**
 * Сжать несколько PDF файлов
 * @param files - список путей к файлам
 * @param outputFolder - папка для результатов
 * @param quality - качество сжатия (0-100)
 * @param progressCallback - callback для прогресса
 * @returns результат операции
 */
export async function compressFiles(
  files: string[],
  outputFolder: string,
  quality: number,
  progressCallback?: (index: number, total: number, result: FileProcessResult) => void
): Promise<CompressResult> {
  const result: CompressResult = {
    processed: 0,
    total: 0,
    log: [],
    used: 'none',
    files: []
  };

  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      throw new Error('Нет файлов для сжатия');
    }
    if (!outputFolder) {
      throw new Error('Не указана папка вывода');
    }
    
    await fs.ensureDir(outputFolder);

    // Фильтруем только PDF файлы
    const pdfs: string[] = [];
    for (const f of files) {
      try {
        const st = await fsp.stat(f);
        if (st.isFile() && f.toLowerCase().endsWith('.pdf')) {
          pdfs.push(f);
        }
      } catch {
        // Пропускаем недоступные файлы
      }
    }

    result.total = pdfs.length;
    result.log.push(`Получено ${pdfs.length} PDF для сжатия`);

    // Определяем доступность Ghostscript
    const gsCmd = await findGhostscript();
    if (gsCmd) {
      result.used = `ghostscript (${gsCmd.includes('resources') ? 'bundled' : 'system'})`;
      result.log.push(`[INFO] Используется Ghostscript: ${gsCmd}`);
    } else {
      result.used = 'pdf-lib(fallback)';
      result.log.push('[WARN] Ghostscript не найден, fallback режим.');
    }

    // Обрабатываем файлы
    for (let index = 0; index < pdfs.length; index++) {
      const fullPath = pdfs[index];
      const fname = path.basename(fullPath);
      const outPath = path.join(outputFolder, fname);

      const fileResult = await compressSinglePdf(fullPath, outPath, quality, gsCmd);
      
      if (fileResult.ok) {
        result.processed++;
        result.log.push(
          gsCmd
            ? `GS: ${fname} -> ${outPath} (${qualityToPdfSettings(quality)})`
            : `FB: ${fname} -> ${outPath}`
        );
      } else {
        result.log.push(`Ошибка ${fname}: ${fileResult.error}`);
      }

      result.files?.push(fileResult);
      
      // Вызываем callback для прогресса
      if (progressCallback) {
        progressCallback(index + 1, result.total, fileResult);
      }
    }

    result.log.unshift(`Сжатие завершено. Engine: ${result.used}`);
    return result;
  } catch (err) {
    const em = `Ошибка compress-files: ${(err as Error).message}`;
    result.log.push(em);
    return result;
  }
}

/**
 * Сжать все PDF файлы в папке
 * @param inputFolder - папка с входными файлами
 * @param outputFolder - папка для результатов
 * @param quality - качество сжатия (0-100)
 * @param progressCallback - callback для прогресса
 * @returns результат операции
 */
export async function compressPdfs(
  inputFolder: string,
  outputFolder: string,
  quality: number,
  progressCallback?: (index: number, total: number, result: FileProcessResult) => void
): Promise<CompressResult> {
  const result: CompressResult = {
    processed: 0,
    total: 0,
    log: [],
    used: 'none',
    files: []
  };

  try {
    if (!inputFolder || !outputFolder) {
      throw new Error('Не указаны папки inputFolder/outputFolder');
    }
    if (!(await fs.pathExists(inputFolder))) {
      throw new Error(`Input folder не найден: ${inputFolder}`);
    }
    
    await fs.ensureDir(outputFolder);

    // Получаем список PDF файлов
    const all = await fsp.readdir(inputFolder);
    const pdfs = all.filter(f => f.toLowerCase().endsWith('.pdf'));
    
    result.total = pdfs.length;
    result.log.push(`Найдено ${pdfs.length} PDF в ${inputFolder}`);

    // Определяем доступность Ghostscript
    const gsCmd = await findGhostscript();
    if (gsCmd) {
      result.used = `ghostscript (${gsCmd.includes('resources') ? 'bundled' : 'system'})`;
      result.log.push(`[INFO] Используется Ghostscript: ${gsCmd}`);
    } else {
      result.used = 'pdf-lib(fallback)';
      result.log.push('[WARN] Ghostscript не найден, fallback режим.');
    }

    // Обрабатываем файлы
    for (let index = 0; index < pdfs.length; index++) {
      const fname = pdfs[index];
      const inPath = path.join(inputFolder, fname);
      const outPath = path.join(outputFolder, fname);

      const fileResult = await compressSinglePdf(inPath, outPath, quality, gsCmd);
      
      if (fileResult.ok) {
        result.processed++;
        result.log.push(
          gsCmd
            ? `GS: ${fname} -> ${outPath} (${qualityToPdfSettings(quality)})`
            : `FB: ${fname} -> ${outPath}`
        );
      } else {
        result.log.push(`Ошибка ${fname}: ${fileResult.error}`);
      }

      result.files?.push(fileResult);
      
      // Вызываем callback для прогресса
      if (progressCallback) {
        progressCallback(index + 1, result.total, fileResult);
      }
    }

    result.log.unshift(`Сжатие завершено. Engine: ${result.used}`);
    return result;
  } catch (err) {
    const em = `Ошибка compress-pdfs: ${(err as Error).message}`;
    result.log.push(em);
    return result;
  }
}
