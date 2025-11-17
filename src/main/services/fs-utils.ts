/**
 * Утилиты для работы с файловой системой
 * Вспомогательные функции для работы с папками и файлами
 */

import { promises as fsp } from 'fs';
import * as path from 'path';
import fs from 'fs-extra';

/**
 * Проверить, помечен ли файл как уже обработанный
 * @param name - имя файла
 * @returns true если файл помечен как обработанный
 */
export function fileMarkedProcessed(name: string): boolean {
  return /(\(.*?(с увед|с уведомл|with notification).*?\)|\bс увед\b|\bс уведомл\b|\bwith notification\b|\bобъединен\b|\bprocessed\b)/i.test(name);
}

/**
 * Рекурсивно подсчитать количество PDF файлов в папке
 * @param folderPath - путь к папке
 * @returns количество PDF файлов
 */
export async function countPdfFilesInFolder(folderPath: string): Promise<number> {
  const countPdf = async (dir: string): Promise<number> => {
    let total = 0;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isFile()) {
          if (ent.name.toLowerCase().endsWith('.pdf')) {
            total++;
          }
        } else if (ent.isDirectory()) {
          // Рекурсивно обрабатываем подпапки
          total += await countPdf(full);
        }
      }
    } catch {
      // Если папка недоступна - возвращаем 0
      return 0;
    }
    return total;
  };

  try {
    if (!folderPath) return 0;
    const st = await fsp.stat(folderPath).catch(() => null);
    if (!st || !st.isDirectory()) return 0;
    return await countPdf(folderPath);
  } catch {
    return 0;
  }
}

/**
 * Подсчитать количество файлов в папке (не рекурсивно)
 * @param folderPath - путь к папке
 * @returns количество файлов
 */
export async function countFilesInFolder(folderPath: string): Promise<number> {
  try {
    const items = await fsp.readdir(folderPath, { withFileTypes: true });
    return items.filter(i => i.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Проверить, является ли путь директорией
 * @param p - путь для проверки
 * @returns true если путь является директорией
 */
export async function pathIsDirectory(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Обеспечить существование директории
 * @param dirPath - путь к директории
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}
