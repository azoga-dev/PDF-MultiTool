/**
 * Unit тесты для Ghostscript сервиса
 * Проверка обнаружения GS и преобразования качества в настройки
 */

import { qualityToPdfSettings } from '../../src/main/services/ghostscript';

describe('Ghostscript Service', () => {
  describe('qualityToPdfSettings', () => {
    it('должен вернуть /screen для качества <= 12', () => {
      expect(qualityToPdfSettings(0)).toBe('/screen');
      expect(qualityToPdfSettings(12)).toBe('/screen');
    });

    it('должен вернуть /ebook для качества 13-25', () => {
      expect(qualityToPdfSettings(13)).toBe('/ebook');
      expect(qualityToPdfSettings(20)).toBe('/ebook');
      expect(qualityToPdfSettings(25)).toBe('/ebook');
    });

    it('должен вернуть /printer для качества 26-40', () => {
      expect(qualityToPdfSettings(26)).toBe('/printer');
      expect(qualityToPdfSettings(30)).toBe('/printer');
      expect(qualityToPdfSettings(40)).toBe('/printer');
    });

    it('должен вернуть /prepress для качества > 40', () => {
      expect(qualityToPdfSettings(41)).toBe('/prepress');
      expect(qualityToPdfSettings(50)).toBe('/prepress');
      expect(qualityToPdfSettings(100)).toBe('/prepress');
    });

    it('должен корректно работать с граничными значениями', () => {
      expect(qualityToPdfSettings(12)).toBe('/screen');
      expect(qualityToPdfSettings(13)).toBe('/ebook');
      expect(qualityToPdfSettings(25)).toBe('/ebook');
      expect(qualityToPdfSettings(26)).toBe('/printer');
      expect(qualityToPdfSettings(40)).toBe('/printer');
      expect(qualityToPdfSettings(41)).toBe('/prepress');
    });
  });

  // Примечание: findGhostscript не тестируется напрямую,
  // так как требует реальной файловой системы и Ghostscript установки.
  // В реальном проекте можно использовать моки для execFile.
});
