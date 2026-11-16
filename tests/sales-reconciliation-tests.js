'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/sales-reconciliation.js', 'utf8'), ctx);
const R = ctx.CoffeeSalesReconciliation;

// 1. Проверка эталонного CSV Алины за 04.11.2026
const csvAlina04 = fs.readFileSync(__dirname + '/fixtures/sales-alina-2026-11-04.csv', 'utf8');
const parsed = R.parseSalesCsv(csvAlina04, 'Среда_Алина_Соня_4_11_2026_Продажи_Алина.csv');
if (parsed.coffeeQty !== 52) throw new Error('Ожидалось 52 кофейных напитка, получено ' + parsed.coffeeQty);
if (parsed.nonCoffeeQty !== 41) throw new Error('Ожидалось 41 некофейная позиция, получено ' + parsed.nonCoffeeQty);
if (parsed.reviewQty !== 5) throw new Error('Ожидалось 5 шт. неоднозначного напитка от бариста, получено ' + parsed.reviewQty);
if (parsed.revenue !== 1687) throw new Error('Ожидалась выручка 1687 руб., получено ' + parsed.revenue);
if (parsed.date !== '2026-11-04' || parsed.barista !== 'Алина') throw new Error('Ошибка распознавания даты/бариста из имени файла Алины 04.11');

// 2. Проверка циклического перехода счётчика 0..999
if (R.counterDelta(998, 2, 1000) !== 4) throw new Error('Ошибка оборота счётчика 998→2');
if (R.counterDelta(735, 777, 1000) !== 42) throw new Error('Ошибка обычной разницы счётчика 735→777');
if (R.counterDelta(999, 0, 1000) !== 1) throw new Error('Ошибка перехода счётчика 999→0');

// 3. Сверка Алины за 04.11.2026 (счётчик 87, кофе 52, списание 1 -> необъяснённая разница 34)
const recAlina04 = R.reconcile(87, parsed, 1, 0);
if (recAlina04.unaccountedShots !== 34) throw new Error('Ошибка сверки Алины: ожидалось 34, получено ' + recAlina04.unaccountedShots);

// 4. Проверка остальных реальных CSV-файлов за несколько дат (02.10.2026, 03.11.2026, 04.11.2026)
const fixDir = path.join(__dirname, 'fixtures');
if (fs.existsSync(path.join(fixDir, 'Среда_Алина_Соня_4_11_2026_Продажи_Соня.csv'))) {
  const sSonya04 = R.parseSalesCsv(fs.readFileSync(path.join(fixDir, 'Среда_Алина_Соня_4_11_2026_Продажи_Соня.csv'), 'utf8'), 'Среда_Алина_Соня_4_11_2026_Продажи_Соня.csv');
  if (sSonya04.date !== '2026-11-04' || sSonya04.barista !== 'Соня' || sSonya04.coffeeQty !== 38 || sSonya04.revenue !== 1189) {
    throw new Error('Ошибка разбора продаж Сони за 04.11.2026');
  }
  const recSonya04 = R.reconcile(R.counterDelta(735, 777, 1000), sSonya04, 1, 0);
  if (recSonya04.grinderShots !== 42 || recSonya04.accountedShots !== 39 || recSonya04.unaccountedShots !== 3) {
    throw new Error('Ошибка сверки Сони за 04.11.2026 (735→777)');
  }

  const sAlina03 = R.parseSalesCsv(fs.readFileSync(path.join(fixDir, 'Вторник_Алина_Соня_3_11_2026_Продажи_Алина.csv'), 'utf8'), 'Вторник_Алина_Соня_3_11_2026_Продажи_Алина.csv');
  const tAlina03 = R.parseTransactionsCsv(fs.readFileSync(path.join(fixDir, 'Вторник_Алина_Соня_3_11_2026_Транзакции_Алина.csv'), 'utf8'), 'Вторник_Алина_Соня_3_11_2026_Транзакции_Алина.csv');
  if (sAlina03.revenue !== 1126 || tAlina03.revenue !== 1126 || tAlina03.cash !== 1019 || tAlina03.card !== 107 || tAlina03.checks !== 40 || sAlina03.coffeeQty !== 48) {
    throw new Error('Ошибка сверки Продажи/Транзакции Алины за 03.11.2026');
  }

  const sSonya03 = R.parseSalesCsv(fs.readFileSync(path.join(fixDir, 'Вторник_Алина_Соня_3_11_2026_Продажи_Соня.csv'), 'utf8'), 'Вторник_Алина_Соня_3_11_2026_Продажи_Соня.csv');
  const tSonya03 = R.parseTransactionsCsv(fs.readFileSync(path.join(fixDir, 'Вторник_Алина_Соня_3_11_2026_Транзакции_Соня.csv'), 'utf8'), 'Вторник_Алина_Соня_3_11_2026_Транзакции_Соня.csv');
  if (sSonya03.revenue !== 845 || tSonya03.revenue !== 845 || tSonya03.cash !== 644 || tSonya03.card !== 201 || tSonya03.checks !== 31 || sSonya03.coffeeQty !== 28) {
    throw new Error('Ошибка сверки Продажи/Транзакции Сони за 03.11.2026');
  }

  const sSonya0210 = R.parseSalesCsv(fs.readFileSync(path.join(fixDir, 'Понедельник Соня 2.10.2026 - Продажи.csv'), 'utf8'), 'Понедельник Соня 2.10.2026 - Продажи.csv');
  if (sSonya0210.date !== '2026-10-02' || sSonya0210.barista !== 'Соня' || sSonya0210.revenue !== 2235 || sSonya0210.coffeeQty !== 87) {
    throw new Error('Ошибка разбора продаж Сони за 02.10.2026');
  }
}

console.log(JSON.stringify({
  coffeeQty: parsed.coffeeQty,
  nonCoffeeQty: parsed.nonCoffeeQty,
  reviewQty: parsed.reviewQty,
  revenue: parsed.revenue,
  counterWrap998to2: R.counterDelta(998, 2, 1000),
  counterWrap999to0: R.counterDelta(999, 0, 1000),
  counter735to777: R.counterDelta(735, 777, 1000),
  alinaExample: recAlina04
}, null, 2));
