/**
 * Сервис для работы с Ghostscript
 * Обеспечивает обнаружение и использование Ghostscript для сжатия PDF
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import fs from 'fs-extra';

const execFileAsync = promisify(execFile);

/**
 * Найти доступный исполняемый файл Ghostscript
 * Сначала проверяет упакованную версию, затем системный PATH
 * @returns путь к gs или null если не найден
 */
export async function findGhostscript(): Promise<string | null> {
  // 1) Сначала пробуем упакованную версию в resources/ghostscript/bin/gswin64c.exe
  try {
    const bundled = path.join(process.resourcesPath, 'ghostscript', 'bin', 'gswin64c.exe');
    if (await fs.pathExists(bundled)) {
      try {
        await execFileAsync(bundled, ['--version']);
        return bundled; // встроенный GS
      } catch (e) {
        console.warn('[GS] bundled gs failed test:', (e as Error).message);
      }
    }
  } catch {
    // Игнорируем ошибки, если bundled не найден
  }

  // 2) Потом пробуем системный PATH
  const candidates = ['gswin64c', 'gswin32c', 'gs'];
  for (const c of candidates) {
    try {
      await execFileAsync(c, ['--version']);
      return c; // системный GS из PATH
    } catch {
      // Игнорируем неудачные попытки
    }
  }

  return null;
}

/**
 * Преобразовать значение качества в настройку PDFSettings для Ghostscript
 * @param quality - процент качества (0-100)
 * @returns настройка для Ghostscript
 */
export function qualityToPdfSettings(quality: number): string {
  if (quality <= 12) return '/screen';
  if (quality <= 25) return '/ebook';
  if (quality <= 40) return '/printer';
  return '/prepress';
}

/**
 * Сжать PDF файл с помощью Ghostscript
 * @param gsCmd - путь к исполняемому файлу Ghostscript
 * @param inputPath - путь к входному файлу
 * @param outputPath - путь к выходному файлу
 * @param quality - процент качества (0-100)
 * @returns объект с результатом операции
 */
export async function compressWithGhostscript(
  gsCmd: string,
  inputPath: string,
  outputPath: string,
  quality: number
): Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }> {
  try {
    const pdfSetting = qualityToPdfSettings(quality);
    const args = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${pdfSetting}`,
      '-dNOPAUSE',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      inputPath
    ];

    const { stdout, stderr } = await execFileAsync(gsCmd, args);

    // Проверяем, что выходной файл создан
    if (!(await fs.pathExists(outputPath))) {
      return {
        success: false,
        error: 'Ghostscript не создал выходной файл'
      };
    }

    return {
      success: true,
      stdout: stdout ? String(stdout).trim() : undefined,
      stderr: stderr ? String(stderr).trim() : undefined
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    };
  }
}
