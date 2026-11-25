/* Coffee Illy v93.1 — Universal POS CSV Parser (Продажи + Транзакции, multi-shift, RFC-4180, deduplication) */
(function (globalScope) {
  const POS_USER_MAP = {
    'топал': 'Алина',
    'молокова': 'Соня'
  };

  function stripBom(str) {
    return String(str || '').replace(/^\uFEFF/, '');
  }

  function parseNum(raw) {
    if (raw == null) return 0;
    const cleaned = String(raw).replace(/[\s\u00A0\u202F]+/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const n = Number(cleaned);
    return isFinite(n) ? n : 0;
  }

  function hashString(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'csv_' + (h >>> 0).toString(36);
  }

  function detectDelimiter(headerLine) {
    const line = String(headerLine || '');
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const tabs = (line.match(/\t/g) || []).length;
    if (semis > commas && semis >= tabs) return ';';
    if (tabs > commas && tabs > semis) return '\t';
    return ',';
  }

  // Full RFC-4180 CSV parser supporting quoted commas & escaped "" quotes
  function parseCsvRows(text) {
    const clean = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const firstLine = clean.split('\n')[0] || '';
    const delim = detectDelimiter(firstLine);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delim) {
          row.push(field.trim());
          field = '';
        } else if (ch === '\n') {
          row.push(field.trim());
          if (row.some((c) => c !== '')) rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
    }
    return rows;
  }

  function parseDateFromFilename(fileName) {
    const fn = String(fileName || '');
    // YYYY-MM-DD
    let m = fn.match(/(20\d{2})[-._](\d{1,2})[-._](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    // DD_MM_YYYY or DD.MM.YYYY
    m = fn.match(/(?:^|[^0-9])(\d{1,2})[-._](\d{1,2})[-._](20\d{2})(?:[^0-9]|$)/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return '';
  }

  function parseRuDateTime(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (m) {
      const date = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
      const time = m[4] ? m[4].replace(/^(\d):/, '0$1:') : '';
      return { date, time };
    }
    const iso = s.match(/(20\d{2}-\d{2}-\d{2})(?:[T\s]+(\d{2}:\d{2}(?::\d{2})?))?/);
    if (iso) return { date: iso[1], time: iso[2] || '' };
    return { date: '', time: '' };
  }

  function mapPosUserToBarista(rawUser, knownStaffNames) {
    const u = String(rawUser || '').trim();
    if (!u) return '';
    const ul = u.toLowerCase();
    for (const k in POS_USER_MAP) {
      if (ul.indexOf(k) >= 0) return POS_USER_MAP[k];
    }
    const staff = Array.isArray(knownStaffNames) ? knownStaffNames : [];
    for (let i = 0; i < staff.length; i++) {
      const nm = String(staff[i] || '').trim();
      if (nm && ul.indexOf(nm.toLowerCase()) >= 0) return nm;
    }
    return u;
  }

  function extractBaristaFromFilename(fileName, knownStaffNames) {
    const base = String(fileName || '').replace(/\.csv$/i, '');
    const staff = Array.isArray(knownStaffNames) && knownStaffNames.length
      ? knownStaffNames
      : ['Соня', 'Алина', 'Настя', 'Макс', 'Лаура'];

    // Priority 1: Explicit suffix after Продажи / Транзакции (e.g. "..._Продажи_Соня" -> "Соня")
    const afterType = base.match(/(?:продажи|транзакции)[\s_-]+([А-ЯЁа-яёA-Za-z]+)/i);
    if (afterType && afterType[1]) {
      const cand = afterType[1].trim();
      const matched = staff.find((s) => s.toLowerCase() === cand.toLowerCase());
      return matched || cand;
    }

    // Priority 2: Single known staff name appearing in filename
    const matches = staff.filter((s) => new RegExp('(?:^|[\\s_\\-.])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[\\s_\\-.])', 'i').test(base));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches[matches.length - 1];
    return '';
  }

  function normalizeStemKey(fileName) {
    return String(fileName || '')
      .toLowerCase()
      .replace(/\.csv$/i, '')
      .replace(/(продажи|транзакции).*/i, '')
      .replace(/[^а-яёa-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function classifyProductKind(name) {
    const n = String(name || '').toLowerCase();
    if (/(американо|эспрессо|капучино|латте|лате|flat\s*white|флэт|раф|мокко|макиато|длинный\s*черный|кофе)/i.test(n)) {
      return 'coffee';
    }
    return 'non_coffee';
  }

  function parseSingleCsvFile(fileName, text, knownStaffNames) {
    const rows = parseCsvRows(text);
    const csvHash = hashString(fileName + '|' + stripBom(text).trim());
    if (!rows.length) return { ok: false, fileName, error: 'Файл пустой' };

    const header = rows[0].map((h) => String(h || '').toLowerCase().trim());
    const colIdx = (patterns) => header.findIndex((h) => patterns.some((p) => h.indexOf(p) >= 0));

    // Check Type 1: Продажи (handles POS typo "Номиенклатура" and standard "Номенклатура")
    const iName = colIdx(['номиенклатур', 'номенклатур', 'товар', 'позиция', 'наименован']);
    const iQty = colIdx(['количеств', 'кол-во', 'qty']);
    const iSum = colIdx(['сумма']);
    const iPrice = colIdx(['цена']);

    // Check Type 2: Транзакции
    const iDate = colIdx(['дата']);
    const iNum = colIdx(['номер', 'чек']);
    const iPay = colIdx(['способ оплаты', 'оплата', 'тип оплаты']);
    const iDocSum = colIdx(['сумма документа', 'сумма']);
    const iUser = colIdx(['пользовател', 'кассир', 'бариста', 'сотрудник']);

    if (iDate >= 0 && iNum >= 0 && iPay >= 0 && iDocSum >= 0) {
      const transactions = [];
      let cash = 0, card = 0;
      const datesCount = {};
      const baristasCount = {};
      const fnBarista = extractBaristaFromFilename(fileName, knownStaffNames);

      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        const receiptNo = String(cols[iNum] || '').trim();
        const dtInfo = parseRuDateTime(cols[iDate]);
        const amount = parseNum(cols[iDocSum]);
        if (!receiptNo && !dtInfo.date) continue;
        if (amount <= 0) continue;

        const payRaw = String(cols[iPay] || '').trim();
        const isCard = /(мобильн|карт|безнал|qr|перевод|терминал|эквайр)/i.test(payRaw);
        const payType = isCard ? 'card' : 'cash';
        if (isCard) card += amount;
        else cash += amount;

        const userRaw = iUser >= 0 ? String(cols[iUser] || '').trim() : '';
        const barista = mapPosUserToBarista(userRaw, knownStaffNames) || fnBarista || 'Бариста';
        if (dtInfo.date) datesCount[dtInfo.date] = (datesCount[dtInfo.date] || 0) + 1;
        if (barista) baristasCount[barista] = (baristasCount[barista] || 0) + 1;

        transactions.push({
          date: dtInfo.date || parseDateFromFilename(fileName),
          time: dtInfo.time,
          receiptNo: receiptNo,
          paymentRaw: payRaw,
          paymentType: payType,
          amount: amount,
          userRaw: userRaw,
          barista: barista,
          csvHash: csvHash
        });
      }

      const mainDate = Object.keys(datesCount).sort((a, b) => datesCount[b] - datesCount[a])[0] || parseDateFromFilename(fileName);
      const mainBarista = Object.keys(baristasCount).sort((a, b) => baristasCount[b] - baristasCount[a])[0] || fnBarista || 'Бариста';
      return {
        ok: true,
        type: 'transactions',
        fileName: fileName,
        stemKey: normalizeStemKey(fileName),
        csvHash: csvHash,
        date: mainDate,
        barista: mainBarista,
        cash: Math.round(cash * 100) / 100,
        card: Math.round(card * 100) / 100,
        total: Math.round((cash + card) * 100) / 100,
        checks: transactions.length,
        transactions: transactions
      };
    }

    if (iName >= 0 && iQty >= 0 && iSum >= 0) {
      const products = [];
      let totalQty = 0, totalSum = 0;
      let footerQty = 0, footerSum = 0;
      const fnDate = parseDateFromFilename(fileName);
      const fnBarista = extractBaristaFromFilename(fileName, knownStaffNames) || 'Бариста';

      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        const name = String(cols[iName] || '').trim();
        const qty = parseNum(cols[iQty]);
        const sum = parseNum(cols[iSum]);
        const price = iPrice >= 0 ? parseNum(cols[iPrice]) : (qty > 0 ? Math.round((sum / qty) * 100) / 100 : 0);

        if (!name || /^итого$/i.test(name)) {
          if (qty > 0 || sum > 0) {
            footerQty = qty;
            footerSum = sum;
          }
          continue;
        }
        if (qty <= 0 && sum <= 0) continue;

        totalQty += qty;
        totalSum += sum;
        products.push({
          name: name,
          price: price,
          qty: qty,
          sum: sum,
          kind: classifyProductKind(name),
          barista: fnBarista,
          csvHash: csvHash
        });
      }

      return {
        ok: true,
        type: 'sales',
        fileName: fileName,
        stemKey: normalizeStemKey(fileName),
        csvHash: csvHash,
        date: fnDate,
        barista: fnBarista,
        totalQty: totalQty,
        totalSum: Math.round(totalSum * 100) / 100,
        footerQty: footerQty,
        footerSum: footerSum,
        products: products
      };
    }

    return {
      ok: false,
      fileName: fileName,
      error: 'Неизвестный формат CSV (ожидаются «Номиенклатура/Номенклатура» или «Дата, Номер, Способ оплаты»)'
    };
  }

  // Group & reconcile multiple CSV files (Продажи + Транзакции) into ready-to-save daily payloads
  function parsePosBatch(files, knownStaffNames) {
    const parsed = [];
    const errors = [];

    (files || []).forEach((f) => {
      const res = parseSingleCsvFile(f.name, f.text, knownStaffNames);
      if (res.ok) parsed.push(res);
      else errors.push(res);
    });

    const txFiles = parsed.filter((p) => p.type === 'transactions');
    const salesFiles = parsed.filter((p) => p.type === 'sales');

    // Smart date reconciliation: if a Sales file has a filename typo (e.g., 2.10.2026)
    // but matches a Transactions file by filename stem + barista (or exact revenue sum + barista),
    // align the Sales file's date to the authoritative internal timestamp date from Transactions!
    salesFiles.forEach((sf) => {
      const sameDateTx = txFiles.find((tf) => tf.date === sf.date && tf.barista.toLowerCase() === sf.barista.toLowerCase());
      if (sameDateTx) return;
      const byStem = txFiles.find((tf) =>
        tf.stemKey && sf.stemKey && tf.stemKey === sf.stemKey &&
        tf.barista.toLowerCase() === sf.barista.toLowerCase()
      );
      if (byStem && byStem.date) {
        sf.originalFilenameDate = sf.date;
        sf.date = byStem.date;
        sf.dateCorrectedFromTx = true;
        return;
      }
      const bySumAndBarista = txFiles.find((tf) =>
        Math.abs(tf.total - sf.totalSum) < 0.01 &&
        tf.barista.toLowerCase() === sf.barista.toLowerCase()
      );
      if (bySumAndBarista && bySumAndBarista.date) {
        sf.originalFilenameDate = sf.date;
        sf.date = bySumAndBarista.date;
        sf.dateCorrectedFromTx = true;
      }
    });

    // Aggregate by date -> shifts by barista
    const daysMap = {};
    function ensureDay(dt) {
      const key = dt || new Date().toISOString().slice(0, 10);
      if (!daysMap[key]) {
        daysMap[key] = {
          date: key,
          shiftsByBarista: {},
          products: [],
          transactions: [],
          csvHashes: [],
          files: [],
          warnings: []
        };
      }
      return daysMap[key];
    }

    function ensureShift(dayObj, barista) {
      const nm = barista || 'Бариста';
      if (!dayObj.shiftsByBarista[nm]) {
        dayObj.shiftsByBarista[nm] = {
          name: nm,
          cash: 0,
          card: 0,
          checks: 0,
          salesSum: 0,
          txSum: 0,
          coffeeQty: 0,
          nonCoffeeQty: 0,
          reviewQty: 0,
          hasTx: false,
          hasSales: false
        };
      }
      return dayObj.shiftsByBarista[nm];
    }

    txFiles.forEach((tf) => {
      const day = ensureDay(tf.date);
      const sh = ensureShift(day, tf.barista);
      sh.cash += tf.cash;
      sh.card += tf.card;
      sh.checks += tf.checks;
      sh.txSum += tf.total;
      sh.hasTx = true;
      day.transactions.push(...tf.transactions);
      if (day.csvHashes.indexOf(tf.csvHash) < 0) day.csvHashes.push(tf.csvHash);
      day.files.push({ name: tf.fileName, type: 'transactions', barista: tf.barista, sum: tf.total, checks: tf.checks });
    });

    salesFiles.forEach((sf) => {
      const day = ensureDay(sf.date);
      const sh = ensureShift(day, sf.barista);
      sh.salesSum += sf.totalSum;
      sh.hasSales = true;
      sf.products.forEach((p) => {
        if (p.kind === 'coffee') sh.coffeeQty += p.qty;
        else sh.nonCoffeeQty += p.qty;
      });
      day.products.push(...sf.products);
      if (day.csvHashes.indexOf(sf.csvHash) < 0) day.csvHashes.push(sf.csvHash);
      day.files.push({ name: sf.fileName, type: 'sales', barista: sf.barista, sum: sf.totalSum, items: sf.products.length });
      if (sf.dateCorrectedFromTx) {
        day.warnings.push(`Дата «${sf.fileName}» скорректирована с ${sf.originalFilenameDate} на ${sf.date} по файлу транзакций`);
      }
    });

    // Build final normalized day payloads for batchSubmitCash_
    const days = Object.keys(daysMap).sort().map((dt) => {
      const d = daysMap[dt];
      const shifts = Object.values(d.shiftsByBarista).map((sh) => {
        let finalCash = sh.cash;
        let finalCard = sh.card;
        if (!sh.hasTx && sh.hasSales && sh.salesSum > 0) {
          // Sales file without matching transactions file: put revenue into cash temporarily & warn
          finalCash = sh.salesSum;
          d.warnings.push(`Нет файла транзакций для ${sh.name} (${sh.salesSum} ₽) — сумма учтена в выручке, загрузите транзакции позже для точного разделения нал/безнал`);
        } else if (sh.hasTx && sh.hasSales && Math.abs(sh.txSum - sh.salesSum) > 0.01) {
          d.warnings.push(`Расхождение у ${sh.name}: транзакции ${sh.txSum} ₽ vs продажи ${sh.salesSum} ₽`);
        }
        return {
          name: sh.name,
          cash: Math.round(finalCash * 100) / 100,
          card: Math.round(finalCard * 100) / 100,
          checks: sh.checks,
          writeoff: 0,
          writeoffShots: 0,
          coffeeQty: sh.coffeeQty,
          nonCoffeeQty: sh.nonCoffeeQty,
          reviewQty: sh.reviewQty
        };
      });

      const totalCash = Math.round(shifts.reduce((a, s) => a + s.cash, 0) * 100) / 100;
      const totalCard = Math.round(shifts.reduce((a, s) => a + s.card, 0) * 100) / 100;
      const totalChecks = shifts.reduce((a, s) => a + s.checks, 0);
      const totalCoffee = shifts.reduce((a, s) => a + s.coffeeQty, 0);
      const totalNonCoffee = shifts.reduce((a, s) => a + s.nonCoffeeQty, 0);

      // Aggregate Top-3 items by quantity
      const byProd = {};
      d.products.forEach((p) => { byProd[p.name] = (byProd[p.name] || 0) + p.qty; });
      const topItems = Object.keys(byProd)
        .sort((a, b) => byProd[b] - byProd[a])
        .slice(0, 3)
        .map((nm) => `${nm} ×${byProd[nm]}`)
        .join(', ');

      return {
        date: dt,
        barista: shifts.map((s) => s.name).join(', '),
        cash: totalCash,
        card: totalCard,
        total: Math.round((totalCash + totalCard) * 100) / 100,
        revenue: Math.round((totalCash + totalCard) * 100) / 100,
        checks: totalChecks,
        writeoff: 0,
        coffeeQty: totalCoffee,
        nonCoffeeQty: totalNonCoffee,
        topItems: topItems,
        shifts: shifts,
        products: d.products,
        transactions: d.transactions,
        csvHashes: d.csvHashes,
        files: d.files,
        warnings: d.warnings
      };
    });

    return {
      ok: errors.length === 0 || days.length > 0,
      days: days,
      errors: errors,
      summary: {
        filesCount: parsed.length,
        daysCount: days.length,
        totalRevenue: Math.round(days.reduce((a, d) => a + d.revenue, 0) * 100) / 100,
        totalCash: Math.round(days.reduce((a, d) => a + d.cash, 0) * 100) / 100,
        totalCard: Math.round(days.reduce((a, d) => a + d.card, 0) * 100) / 100,
        totalChecks: days.reduce((a, d) => a + d.checks, 0),
        totalProducts: days.reduce((a, d) => a + d.products.length, 0),
        totalTransactions: days.reduce((a, d) => a + d.transactions.length, 0)
      }
    };
  }


  function decodeCsvBuffer(buf) {
    if (!buf) return '';
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (typeof TextDecoder === 'undefined') {
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return s.replace(/^\uFEFF/, '');
    }
    try {
      const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      if (utf8.indexOf('\uFFFD') === -1) return utf8.replace(/^\uFEFF/, '');
    } catch (_) {}
    try {
      return new TextDecoder('windows-1251').decode(u8).replace(/^\uFEFF/, '');
    } catch (_) {
      return new TextDecoder('utf-8').decode(u8).replace(/^\uFEFF/, '');
    }
  }

  async function readCsvFile(file) {
    if (!file) return '';
    if (typeof file.arrayBuffer === 'function') {
      const buf = await file.arrayBuffer();
      return decodeCsvBuffer(buf);
    }
    if (typeof file.text === 'function') {
      return file.text();
    }
    return '';
  }

  const API = {
    decodeCsvBuffer,
    readCsvFile,
    parseCsvRows,
    parseSingleCsvFile,
    parsePosBatch,
    parseNum,
    mapPosUserToBarista
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  if (globalScope) {
    globalScope.CoffeePosCsvV93 = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
