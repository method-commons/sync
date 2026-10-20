import { describe, expect, it } from 'vitest';
import { APP_NAMES, TEXTS, textsFor } from '../ui/texts.js';

/** Struktur eines Textobjekts: Schlüssel, Art und Zahl der Parameter, Länge von Listen. */
function shape(value) {
  if (typeof value === 'function') return `fn/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, shape(value[k])]));
  return typeof value;
}

describe('Texte der Oberfläche', () => {
  it('Englisch hat dieselbe Struktur wie Deutsch', () => {
    expect(shape(TEXTS.en)).toEqual(shape(TEXTS.de));
    expect(Object.keys(APP_NAMES.en)).toEqual(Object.keys(APP_NAMES.de));
  });

  it('wählt die Sprache, sonst Deutsch', () => {
    expect(textsFor('en').status.ok).toBe('In storage');
    expect(textsFor('fr')).toBe(TEXTS.de);
  });

  it('bildet Mehrzahl und Zahlen richtig', () => {
    const n = { one: 'Matrix', many: 'Matrizen', list: 'Meine Matrizen' };
    const T = textsFor('de');
    expect(T.setup.uploadButton(1, n)).toBe('1 Matrix hochladen');
    expect(T.setup.uploadButton(2, n)).toBe('2 Matrizen hochladen');
    expect(T.setup.uploadButton(0, n)).toBe('Fertig');
    expect(T.storage.counts(3, 2, 1, n)).toBe('3 Matrizen im Browser, davon 2 in der Ablage · 1 weitere nur in der Ablage');
    expect(T.storage.expires('18.01.2027', 1)).toBe('gültig bis 18.01.2027 (noch 1 Tag)');
    expect(T.storage.expires('18.01.2027', -2)).toBe('abgelaufen am 18.01.2027');
    expect(T.remoteMeta('heute 10:00', '', '3 Konzepte')).toBe('gespeichert heute 10:00 · 3 Konzepte');
  });
});
