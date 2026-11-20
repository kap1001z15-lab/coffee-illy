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
