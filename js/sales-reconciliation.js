/* Sales CSV & Transactions CSV parsing and grinder reconciliation for Coffee POS (v54).
 * CSV contracts:
 *   1) Продажи: Номенклатура (или Номиенклатура), Цена, Количество, Сумма [опц. Дата, Пользователь/Бариста]
 *   2) Транзакции: Дата, Номер, Способ оплаты, Сумма документа, Пользователь
 * Pure module: works in browser (index.html, owner.html, admin.html, report.html, dashboard.html) and Node tests.
 */
(function (root) {
  'use strict';

  var WEEKDAY_STOP_RE = /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|вокскресенье|продажи|транзакции|отчет|отчёт|касса|csv|шт|день|смена|кофейня|итого)$/i;

  var CASHIER_MAP = [
    { re: /топал|алина/i, name: 'Алина' },
    { re: /молокова|соня|софия/i, name: 'Соня' },
    { re: /настя|анастасия/i, name: 'Настя' },
    { re: /максим/i, name: 'Максим' },
    { re: /даша|дарья/i, name: 'Даша' }
  ];

  function resolveCashierName(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    for (var i = 0; i < CASHIER_MAP.length; i++) {
      if (CASHIER_MAP[i].re.test(s)) return CASHIER_MAP[i].name;
    }
    return s;
  }

  function csvHash(text) {
    var clean = String(text == null ? '' : text)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .join('\n');
    var h1 = 0x811c9dc5;
    var h2 = 0x01000193;
    for (var i = 0; i < clean.length; i++) {
      var c = clean.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (c + (i & 0xff));
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return 'csv_' + ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8) + '_' + clean.length;
  }

  function parseCsvRows(text, delimiter) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!delimiter) {
      var firstLine = text.split(/\r?\n/)[0] || '';
      delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    }
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], next = text[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
    return rows;
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е')
      .replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();
  }

  function num(v) {
    var s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.');
    var n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDateIso(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var mIso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (mIso) return mIso[1] + '-' + mIso[2] + '-' + mIso[3];
    var mDmy = /(\d{1,2})[._/-](\d{1,2})[._/-](\d{4})/.exec(s);
    if (mDmy) {
      return mDmy[3] + '-' + ('0' + mDmy[2]).slice(-2) + '-' + ('0' + mDmy[1]).slice(-2);
    }
    return '';
  }

  function extractFileMeta(fname) {
    var s = String(fname || '').replace(/\.[^.]+$/, '');
    var dateIso = parseDateIso(s);
    var isSales = /продаж/i.test(s);
    var isTrans = /транзакц/i.test(s);

    var words = s.match(/[А-ЯЁа-яё]{3,}/g) || [];
    var allNames = [];
    words.forEach(function (w) {
      if (WEEKDAY_STOP_RE.test(w)) return;
      var formatted = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      var resolved = resolveCashierName(formatted);
      if (allNames.indexOf(resolved) < 0) allNames.push(resolved);
    });

    // Если в конце имени файла после «Продажи» или «Транзакции» указано конкретное имя бариста
    // (например: Вторник_Алина_Соня_3_11_2026_Продажи_Алина.csv -> бариста файла: Алина)
    var specificBarista = '';
    var tailMatch = /(?:продажи|транзакции)[_\s-]+([А-ЯЁа-яё]{3,})/i.exec(s);
    if (tailMatch && !WEEKDAY_STOP_RE.test(tailMatch[1])) {
      var rawTail = tailMatch[1].charAt(0).toUpperCase() + tailMatch[1].slice(1).toLowerCase();
      specificBarista = resolveCashierName(rawTail);
    }
    if (!specificBarista && allNames.length === 1) {
      specificBarista = allNames[0];
    }

    return {
      date: dateIso,
      barista: specificBarista || allNames.join(', '),
      specificBarista: specificBarista,
      dayBaristas: allNames,
      isSales: isSales,
      isTrans: isTrans
    };
  }

  // Правила классификации кофейных напитков (1 порция зерна / срабатывание гриндера).
  var COFFEE_RULES = [
    /американо/, /эспрессо/, /капучино/, /латте/, /лате/, /flat\s*white/,
    /флэт\s*уайт/, /мокко/, /мокка/, /длинный черный/, /лонг блэк/,
    /(?:^|\s)раф(?:\s|$|\()/, /доппио/, /ристретто/, /макиато/, /кортадо/, /айс\s*латте/, /ice\s*latte/, /кофе\s*по/
  ];
  var EXCLUDE_RULES = [
    /молоко/, /сироп/, /альтернативн/, /сливки/, /чай/, /какао/, /шоколад/,
    /маршмеллоу/, /кола/, /спрайт/, /фанта/, /вода/, /минеральн/, /пина\s*колада/, /стимер/,
    /лимонад/, /чизкейк/, /эклер/, /десерт/, /фрукт/, /стикер/, /круассан/, /торт/
  ];

  function classifyCoffee(name) {
    var n = norm(name);
    if (!n || EXCLUDE_RULES.some(function (r) { return r.test(n); })) return 'non_coffee';
    return COFFEE_RULES.some(function (r) { return r.test(n); }) ? 'coffee' : 'review';
  }

  function cleanProductName(raw) {
    return String(raw || '').replace(/^["']+|["']+$/g, '').replace(/""/g, '"').replace(/\s{2,}/g, ' ').trim();
  }

  function summarizeProductsList(products) {
    var coffeeQty = products.filter(function (p) { return p.kind === 'coffee'; })
      .reduce(function (a, p) { return a + p.qty; }, 0);
    var reviewQty = products.filter(function (p) { return p.kind === 'review'; })
      .reduce(function (a, p) { return a + p.qty; }, 0);
    var nonCoffeeQty = products.filter(function (p) { return p.kind === 'non_coffee'; })
      .reduce(function (a, p) { return a + p.qty; }, 0);
    var revenue = products.reduce(function (a, p) { return a + p.sum; }, 0);
    var totalQty = coffeeQty + nonCoffeeQty + reviewQty;
    var sorted = products.slice().sort(function (a, b) { return b.qty - a.qty || b.sum - a.sum; });
    return {
      products: products,
      sortedProducts: sorted,
      topItems: sorted.slice(0, 3).map(function (x) { return x.name.replace(/\s+(шт\.?|бут\.?)$/i, '') + ' ×' + x.qty; }).join(', '),
      coffeeQty: coffeeQty,
      reviewQty: reviewQty,
      nonCoffeeQty: nonCoffeeQty,
      totalQty: totalQty,
      revenue: revenue,
      warnings: reviewQty ? ['Есть ' + reviewQty + ' шт. номенклатуры, требующей классификации вручную'] : []
    };
  }

  function parseSalesCsv(text, fname) {
    var rows = parseCsvRows(text);
    if (!rows.length) throw new Error('CSV пустой');
    var headers = rows[0].map(norm);
    function col(names) {
      for (var i = 0; i < names.length; i++) {
        var idx = headers.indexOf(norm(names[i]));
        if (idx >= 0) return idx;
      }
      return -1;
    }
    var nameI = col(['Номенклатура', 'Номиенклатура', 'Наименование', 'Товар', 'Позиция']);
    var priceI = col(['Цена']);
    var qtyI = col(['Количество', 'Кол-во', 'Кол.']);
    var sumI = col(['Сумма', 'Итого', 'Выручка']);
    var dateI = col(['Дата', 'Дата смены']);
    var userI = col(['Пользователь', 'Бариста', 'Сотрудник', 'Кассир']);
    if (nameI < 0 || qtyI < 0) throw new Error('Не найдены обязательные колонки «Номенклатура» и «Количество»');

    var meta = extractFileMeta(fname || '');
    var hash = csvHash(text);
    var products = [], ignoredTotalRows = 0;
    var byDateMap = {};

    rows.slice(1).forEach(function (r) {
      var name = cleanProductName(r[nameI] || '');
      if (!name || /^итого$/i.test(name)) { ignoredTotalRows++; return; }
      var qty = num(r[qtyI]);
      if (!Number.isFinite(qty) || qty <= 0) return;
      var price = priceI >= 0 ? num(r[priceI]) : 0;
      var sum = sumI >= 0 ? num(r[sumI]) : Math.round(price * qty);
      var kind = classifyCoffee(name);
      var rowDate = (dateI >= 0 ? parseDateIso(r[dateI]) : '') || meta.date || '';
      var rowBarista = (userI >= 0 ? resolveCashierName(r[userI]) : '') || meta.barista || '';
      var item = {
        name: name,
        price: price,
        qty: qty,
        sum: sum,
        kind: kind,
        date: rowDate,
        barista: rowBarista
      };
      products.push(item);
      var dKey = rowDate || '_default';
      if (!byDateMap[dKey]) byDateMap[dKey] = [];
      byDateMap[dKey].push(item);
    });

    var summary = summarizeProductsList(products);
    var byDate = {};
    Object.keys(byDateMap).forEach(function (k) {
      if (k !== '_default') byDate[k] = summarizeProductsList(byDateMap[k]);
    });

    return {
      kind: 'sales',
      fileName: fname || '',
      hash: hash,
      date: meta.date || Object.keys(byDate)[0] || '',
      barista: meta.barista || '',
      specificBarista: meta.specificBarista || '',
      dayBaristas: meta.dayBaristas || [],
      products: summary.products,
      sortedProducts: summary.sortedProducts,
      topItems: summary.topItems,
      coffeeQty: summary.coffeeQty,
      reviewQty: summary.reviewQty,
      nonCoffeeQty: summary.nonCoffeeQty,
      totalQty: summary.totalQty,
      revenue: summary.revenue,
      warnings: summary.warnings,
      ignoredTotalRows: ignoredTotalRows,
      byDate: byDate
    };
  }

  function parseTransactionsCsv(text, fname) {
    var rows = parseCsvRows(text);
    if (!rows.length) throw new Error('CSV транзакций пустой');
    var headers = rows[0].map(norm);
    function col(names) {
      for (var i = 0; i < names.length; i++) {
        var idx = headers.indexOf(norm(names[i]));
        if (idx >= 0) return idx;
      }
      return -1;
    }
    var dateI = col(['Дата', 'Время', 'Дата и время']);
    var numI = col(['Номер', 'Чек', 'Номер чека']);
    var methodI = col(['Способ оплаты', 'Оплата', 'Тип оплаты']);
    var sumI = col(['Сумма документа', 'Сумма', 'Итого']);
    var userI = col(['Пользователь', 'Кассир', 'Бариста', 'Сотрудник']);
    if (dateI < 0) dateI = 0;
    if (methodI < 0) methodI = 2;
    if (sumI < 0) sumI = 3;
    if (userI < 0) userI = 4;

    var meta = extractFileMeta(fname || '');
    var hash = csvHash(text);
    var cash = 0, card = 0, checks = 0;
    var byDate = {};
    var baristasSet = [];

    rows.slice(1).forEach(function (r) {
      if (!r || r.length < 3) return;
      var amt = num(r[sumI]);
      if (!Number.isFinite(amt) || amt <= 0) return;
      var method = String(r[methodI] || '');
      var isCard = /мобил|карт|безнал|qr|apb|клевер/i.test(method) && !/налич/i.test(method);
      var rowDate = parseDateIso(r[dateI]) || meta.date || '';
      var rawUser = String(r[userI] || '').trim();
      var barista = resolveCashierName(rawUser) || meta.specificBarista || meta.barista || 'Бариста';
      if (barista && baristasSet.indexOf(barista) < 0) baristasSet.push(barista);

      if (isCard) card += amt;
      else cash += amt;
      checks++;

      var dKey = rowDate || meta.date || '';
      if (dKey) {
        if (!byDate[dKey]) {
          byDate[dKey] = { date: dKey, cash: 0, card: 0, checks: 0, baristas: [], shiftsByBarista: {} };
        }
        var dObj = byDate[dKey];
        if (isCard) dObj.card += amt;
        else dObj.cash += amt;
        dObj.checks += 1;
        if (barista && dObj.baristas.indexOf(barista) < 0) dObj.baristas.push(barista);
        if (!dObj.shiftsByBarista[barista]) {
          dObj.shiftsByBarista[barista] = { name: barista, rawUser: rawUser, cash: 0, card: 0, checks: 0 };
        }
        if (isCard) dObj.shiftsByBarista[barista].card += amt;
        else dObj.shiftsByBarista[barista].cash += amt;
        dObj.shiftsByBarista[barista].checks += 1;
      }
    });

    if (!checks && !cash && !card) throw new Error('В файле транзакций нет чеков с положительной суммой');
    var datesList = Object.keys(byDate).sort();
    var primaryDate = meta.date || datesList[0] || '';
    var primaryBarista = meta.specificBarista || (baristasSet.length ? baristasSet.join(', ') : meta.barista);

    return {
      kind: 'trans',
      fileName: fname || '',
      hash: hash,
      date: primaryDate,
      dates: datesList,
      barista: primaryBarista,
      specificBarista: meta.specificBarista || (baristasSet.length === 1 ? baristasSet[0] : ''),
      dayBaristas: meta.dayBaristas && meta.dayBaristas.length ? meta.dayBaristas : baristasSet,
      cash: Math.round(cash),
      card: Math.round(card),
      revenue: Math.round(cash + card),
      checks: checks,
      byDate: byDate
    };
  }

  function detectCsvKind(text, fname) {
    var rows = parseCsvRows(text);
    var head = (rows[0] || []).map(norm).join(' ');
    if (/способ оплаты|сумма документа/.test(head)) return 'trans';
    if (/номенклатура|номиенклатура|количество/.test(head)) return 'sales';
    var meta = extractFileMeta(fname || '');
    if (meta.isTrans) return 'trans';
    return 'sales';
  }

  // Циклический счётчик 0..999 (после 999 идёт 0).
  // Примечание: физический переход 999 → 0 принят как правило работы прибора (требует визуального контроля при сбросе).
  function counterDelta(previous, current, modulus) {
    modulus = Number(modulus) || 1000;
    var p = Number(previous), c = Number(current);
    if (!Number.isInteger(p) || !Number.isInteger(c) || p < 0 || c < 0 || p >= modulus || c >= modulus) return null;
    return c >= p ? c - p : (modulus - p) + c;
  }

  function counterDeltaInfo(previous, current, modulus) {
    modulus = Number(modulus) || 1000;
    var delta = counterDelta(previous, current, modulus);
    if (delta === null) return { delta: null, wrapped: false, previous: previous, current: current, note: '' };
    var wrapped = Number(current) < Number(previous);
    return {
      delta: delta,
      wrapped: wrapped,
      previous: Number(previous),
      current: Number(current),
      note: wrapped
        ? ('Циклический переход через ' + (modulus - 1) + '→0 (' + previous + '→' + current + ' = +' + delta + '; убедитесь, что не было ручного сброса)')
        : (previous + '→' + current + ' = +' + delta)
    };
  }

  // Сверка счётчика со строго проданными кофейными напитками по номенклатуре (чеки НЕ подменяют кофейные напитки!).
  function reconcile(grinderDelta, sales, writeoffShots, tolerance) {
    var sold = Number(sales && (sales.coffeeQty != null ? sales.coffeeQty : sales.soldCoffee)) || 0;
    var nonCoffee = Number(sales && sales.nonCoffeeQty) || 0;
    var review = Number(sales && sales.reviewQty) || 0;
    var writeoffs = Number(writeoffShots) || 0;
    var fact = Number(grinderDelta) || 0;
    var accounted = sold + writeoffs;
    var diff = fact - accounted;
    var tol = Number(tolerance) || 0;
    var warnings = [];
    if (sales && Array.isArray(sales.warnings) && sales.warnings.length) {
      warnings = warnings.concat(sales.warnings);
    } else if (review > 0) {
      warnings.push('Есть ' + review + ' шт. неопределённой номенклатуры (требует ручной классификации)');
    }
    if (Math.abs(diff) > tol) {
      if (diff > 0) {
        warnings.push('Необъяснённая разница счётчика: +' + diff + ' срабатываний сверх проданного кофе (' + sold + ') и списаний в порциях (' + writeoffs + ')');
      } else {
        warnings.push('По кассе учтено на ' + Math.abs(diff) + ' порц. кофе больше, чем срабатываний счётчика (' + fact + ')');
      }
    }
    return {
      grinderShots: fact,
      soldCoffee: sold,
      nonCoffeeQty: nonCoffee,
      reviewQty: review,
      writeoffShots: writeoffs,
      accountedShots: accounted,
      unaccountedShots: Math.max(0, diff),
      overAccountedShots: Math.max(0, -diff),
      diff: diff,
      status: Math.abs(diff) <= tol ? 'ok' : 'warning',
      warnings: warnings
    };
  }

  root.CoffeeSalesReconciliation = {
    parseCsvRows: parseCsvRows,
    parseSalesCsv: parseSalesCsv,
    parseTransactionsCsv: parseTransactionsCsv,
    detectCsvKind: detectCsvKind,
    extractFileMeta: extractFileMeta,
    resolveCashierName: resolveCashierName,
    csvHash: csvHash,
    classifyCoffee: classifyCoffee,
    counterDelta: counterDelta,
    counterDeltaInfo: counterDeltaInfo,
    reconcile: reconcile
  };
})(typeof window !== 'undefined' ? window : globalThis);
