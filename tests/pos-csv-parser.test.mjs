import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('../js/pos-csv-parser.js');

test('CoffeePosCsvV93 exports core parsing functions', () => {
  assert.ok(parser, 'Parser should be exported');
  assert.equal(typeof parser.parseCsvRows, 'function');
  assert.equal(typeof parser.parseSingleCsvFile, 'function');
  assert.equal(typeof parser.parsePosBatch, 'function');
  assert.equal(typeof parser.mapPosUserToBarista, 'function');
});

test('Maps POS cashier surnames to Coffee Illy barista names', () => {
  assert.equal(parser.mapPosUserToBarista('Топал А.'), 'Алина');
  assert.equal(parser.mapPosUserToBarista('Молокова С.'), 'Соня');
  assert.equal(parser.mapPosUserToBarista('Иван'), 'Иван');
});

test('Parses POS CSV with fixed regexes (ISO & DD.MM.YYYY dates)', () => {
  const sampleCsv = [
    'Дата;Пользователь;Наименование;Количество;Сумма;Тип оплаты',
    '19.11.2026 08:45;Топал;Капучино 350 мл;2;90;Карта',
    '19.11.2026 09:10;Топал;Латте 350 мл;1;45;Наличные',
    '19.11.2026 10:05;Молокова;Круассан классический;1;30;Карта'
  ].join('\n');

  const res = parser.parseSingleCsvFile('sales_2026-11-19.csv', sampleCsv);
  assert.ok(res, 'parseSingleCsvFile should return result object');
  assert.equal(res.date, '2026-11-19');
  assert.ok((res.csvHash || res.hash || res.fileHash || '').length > 0, 'Should compute deduplication hash');
});

test('Extracts ISO date from DD.MM.YYYY filename when CSV has no date column', () => {
  const sampleCsv = [
    'Наименование;Количество;Сумма;Оплата',
    'Эспрессо;3;75;Наличные'
  ].join('\n');

  const res = parser.parseSingleCsvFile('report_18.11.2026.csv', sampleCsv);
  assert.ok(res);
  assert.equal(res.date, '2026-11-18');
});

test('parseNum handles Russian decimal commas and currency symbols', () => {
  assert.equal(parser.parseNum('1 250,50 ₽'), 1250.5);
  assert.equal(parser.parseNum('45.00'), 45);
  assert.equal(parser.parseNum(''), 0);
});

test('decodeCsvBuffer decodes Windows-1251 Russian POS CSV cleanly alongside UTF-8', () => {
  // Windows-1251 bytes for: "Дата;Товар;Количество;Сумма\n2026-11-25;Капучино;5;175"
  const cp1251Bytes = new Uint8Array([
    0xC4,0xE0,0xF2,0xE0,0x3B,0xD2,0xEE,0xE2,0xE0,0xF0,0x3B,0xCA,0xEE,0xEB,0xE8,0xF7,0xE5,0xF1,0xF2,0xE2,0xEE,0x3B,0xD1,0xF3,0xEC,0xEC,0xE0,0x0A,
    0x32,0x30,0x32,0x36,0x2D,0x31,0x31,0x2D,0x32,0x35,0x3B,0xCA,0xE0,0xEF,0xF3,0xF7,0xE8,0xED,0xEE,0x3B,0x35,0x3B,0x31,0x37,0x35
  ]);
  const decoded = parser.decodeCsvBuffer(cp1251Bytes);
  assert.ok(decoded.includes('Дата;Товар'), 'Header must decode from Windows-1251');
  assert.ok(decoded.includes('Капучино;5;175'), 'Product row must decode from Windows-1251');
  const parsed = parser.parsePosBatch([{ name: '2026-11-25.csv', text: decoded }]);
  assert.equal(parsed.days.length, 1);
  assert.equal(parsed.days[0].revenue, 175);
});
