/**
 * Сервис для объединения PDF файлов
 * Логика сопоставления Уведомлений и ЗЭПБ по кодам
 */

import { promises as fsp } from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  Document,
  Packer,
  WidthType,
  VerticalAlign,
  Table,
  TableCell,
  TableRow,
  Paragraph,
  TextRun,
  AlignmentType
} from 'docx';
import { fileMarkedProcessed } from './fs-utils';

/**
 * Префиксы для извлечения кодов из имен файлов
 */
const PREFIXES = ['СК', 'УА', 'СППК', 'СПД', 'РВС', 'ПУ', 'П', 'ГЗУ', 'ПТП', 'ТТП', 'НА'];

/**
 * Регулярное выражение для поиска кодов в именах файлов
 */
const CODE_REGEX = new RegExp(
  `(${PREFIXES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-\\d+(?:\\.\\d+)?`,
  'i'
);

/**
 * Конвертировать сантиметры в twips для DOCX
 */
const cmToTwip = (cm: number) => Math.round(cm * 567);

/**
 * Форматировать число с ведущим нулем
 */
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * Форматировать дату и время
 */
const formatDateTime = (d: Date) =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * Форматировать дату
 */
const formatDate = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;

/**
 * Извлечь код уведомления из имени файла или папки
 */
export function extractNotificationCode(fullPath: string): string | null {
  const filename = path.basename(fullPath);
  const foldername = path.basename(path.dirname(fullPath));

  const m = filename.match(CODE_REGEX);
  if (m) return m[0].toUpperCase();

  const folderPrefix = PREFIXES.find(p => foldername.toUpperCase().includes(p));
  if (folderPrefix) {
    const nm = filename.match(/\d+(?:\.\d+)?/);
    if (nm) return `${folderPrefix}-${nm[0]}`.toUpperCase();
  }

  return null;
}

/**
 * Извлечь код ЗЭПБ из имени файла
 */
export function extractZepbCode(filename: string): string | null {
  const m = filename.match(CODE_REGEX);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Привести код к канонической форме (удалить дробную часть)
 * Например: СПД-1245.25 -> СПД-1245
 */
export function canonicalCode(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = String(raw).replace(/\.\d{1,4}$/i, '');
  return stripped.toUpperCase();
}

/**
 * Построить словарь код → путь к файлу
 */
export async function buildDict(
  root: string,
  recursive: boolean,
  fileFilter: (full: string, name: string) => boolean,
  extractCode: (nameOrPath: string) => string | null
): Promise<Record<string, string>> {
  const dict: Record<string, string> = {};

  async function scan(dir: string) {
    let items;
    try {
      items = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const it of items) {
      const full = path.join(dir, it.name);

      if (it.isDirectory()) {
        // Пропускаем папки "отказы"
        if (/^отказы$/i.test(it.name)) {
          continue;
        }
        if (recursive) {
          await scan(full);
        }
        continue;
      }

      if (!it.isFile()) continue;
      if (!fileFilter(full, it.name)) continue;
      if (fileMarkedProcessed(it.name)) continue;

      // Извлечь сырой код
      const rawCode = extractCode(it.name);
      if (!rawCode) continue;

      // Каноническая версия
      const code = canonicalCode(rawCode);
      if (!code) continue;

      // При конфликте оставляем более новый файл по mtime
      if (dict[code]) {
        try {
          const [s1, s2] = await Promise.all([fsp.stat(dict[code]), fsp.stat(full)]);
          if (s2.mtimeMs > s1.mtimeMs) {
            dict[code] = full;
          }
        } catch {
          // Игнорируем ошибки при сравнении
        }
        continue;
      }

      dict[code] = full;
    }
  }

  await scan(root);
  return dict;
}

/**
 * Создать реестр файлов в формате DOCX
 */
export async function createRegisterDocx(outputFolder: string, files: string[]): Promise<string> {
  // Подготовка: имена без расширений
  const names = files.map(f => {
    const b = path.basename(f);
    const idx = b.lastIndexOf('.');
    return idx > 0 ? b.slice(0, idx) : b;
  });

  const children: any[] = [];

  // Заголовок
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Реестр переданных файлов посредством выгрузки на Лукойл-диск',
          bold: true,
          size: 28 // 14pt
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 }
    })
  );

  // Пустая строка
  children.push(new Paragraph({ text: '' }));

  // Заголовочная строка таблицы
  const headerRow = new TableRow({
    children: [
      new TableCell({
        verticalAlign: VerticalAlign.CENTER,
        width: { size: cmToTwip(1.0), type: WidthType.DXA },
        children: [
          new Paragraph({
            children: [new TextRun({ text: '№', bold: true, size: 24 })],
            alignment: AlignmentType.CENTER
          })
        ]
      }),
      new TableCell({
        verticalAlign: VerticalAlign.CENTER,
        width: { size: cmToTwip(17.0), type: WidthType.DXA },
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Наименование файла', bold: true, size: 24 })],
            alignment: AlignmentType.CENTER
          })
        ]
      })
    ]
  });

  // Данные таблицы
  const dataRows = names.map((nm, i) => {
    return new TableRow({
      children: [
        new TableCell({
          verticalAlign: VerticalAlign.CENTER,
          width: { size: cmToTwip(1.0), type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: String(i + 1), size: 24 })],
              alignment: AlignmentType.CENTER
            })
          ]
        }),
        new TableCell({
          verticalAlign: VerticalAlign.CENTER,
          width: { size: cmToTwip(17.0), type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: nm, size: 24 })],
              alignment: AlignmentType.CENTER
            })
          ]
        })
      ]
    });
  });

  const table = new Table({
    rows: [headerRow, ...dataRows],
    width: { size: cmToTwip(19.0), type: WidthType.DXA }
  });

  children.push(table);

  // Пустая строка
  children.push(new Paragraph({ text: '' }));

  // Дата формирования
  const now = new Date();
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Дата формирования реестра: ', bold: true, size: 24 }),
        new TextRun({ text: formatDateTime(now), size: 24 })
      ]
    })
  );

  // Создаём документ
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: cmToTwip(1),
              bottom: cmToTwip(1),
              left: cmToTwip(1),
              right: cmToTwip(1)
            }
          }
        },
        children
      }
    ],
    styles: {
      default: {
        document: {
          run: {
            font: 'Times New Roman',
            size: 24, // 12pt default
            color: '000000'
          }
        }
      }
    }
  });

  const safeDate = formatDate(now);
  const filename = `Реестр от ${safeDate}.docx`;
  const outPath = path.join(outputFolder, filename);
  const buffer = await Packer.toBuffer(doc);
  await fsp.writeFile(outPath, buffer);

  return outPath;
}

/**
 * Объединить два PDF файла (уведомление + ЗЭПБ)
 */
export async function mergePdfFiles(
  notifPath: string,
  zepbPath: string,
  outputPath: string
): Promise<void> {
  const [notifBuf, zepbBuf] = await Promise.all([fsp.readFile(notifPath), fsp.readFile(zepbPath)]);

  const [notifDoc, zepbDoc] = await Promise.all([
    PDFDocument.load(notifBuf),
    PDFDocument.load(zepbBuf)
  ]);

  const merged = await PDFDocument.create();

  // Копируем страницы уведомления
  const notifPages = await merged.copyPages(notifDoc, notifDoc.getPageIndices());
  notifPages.forEach(p => merged.addPage(p));

  // Копируем страницы ЗЭПБ
  const zepbPages = await merged.copyPages(zepbDoc, zepbDoc.getPageIndices());
  zepbPages.forEach(p => merged.addPage(p));

  // Сохраняем объединенный файл
  await fsp.writeFile(outputPath, await merged.save());
}
