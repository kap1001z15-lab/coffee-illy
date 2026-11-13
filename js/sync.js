/* =========================================================================
   МОДУЛЬ ПОЭЛЕМЕНТНОЙ ДЕЛЬТА-СИНХРОНИЗАЦИИ (js/sync.js — v21 Enterprise)
   Решает проблему «последний записал — перезаписал всю базу»:
   - Каждая запись имеет уникальный id, метку времени updatedAt (Unix ms) и флаг deleted (tombstone).
   - Функция coffeeMergeRecordLists объединяет списки поэлементно по id и updatedAt.
   - При одновременной работе двух бариста на разных телефонах их действия (сдача чек-листов,
     отметки «Ознакомлен» в Информировании, фиксация поломок и смен кассы) объединяются
     через Set-Union без потери данных!
   ========================================================================= */

window.coffeeMergeRecordLists = function (localArr, remoteArr, idKey, options) {
  const keyField = idKey || 'id';
  const opts = options || {};
  const map = new Map();
  const tombstones = opts.tombstones || {};

  function getRecKey(item) {
    if (!item || typeof item !== 'object') return '';
    if (typeof keyField === 'function') return String(keyField(item) || '');
    return String(item[keyField] || item.id || item.date || '');
  }

  function mergeArrayUnion(arrA, arrB, subKey) {
    const a = Array.isArray(arrA) ? arrA : [];
    const b = Array.isArray(arrB) ? arrB : [];
    if (!a.length && !b.length) return [];
    if (!subKey) {
      return Array.from(new Set(a.concat(b).filter(Boolean)));
    }
    const m = new Map();
    a.concat(b).forEach((x) => {
      if (x && typeof x === 'object' && x[subKey]) {
        const k = String(x[subKey]);
        const prev = m.get(k);
        if (!prev || Number(x.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
          m.set(k, x);
        }
      }
    });
    return Array.from(m.values());
  }

  (Array.isArray(localArr) ? localArr : []).forEach((item) => {
    const k = getRecKey(item);
    if (!k) return;
    map.set(k, Object.assign({ updatedAt: Number(item.updatedAt) || 1 }, item));
  });

  (Array.isArray(remoteArr) ? remoteArr : []).forEach((rem) => {
    const k = getRecKey(rem);
    if (!k) return;
    const remTs = Number(rem.updatedAt) || 1;
    const loc = map.get(k);

    if (rem.deleted) {
      if (!loc || remTs >= (Number(loc.updatedAt) || 0)) {
        tombstones[k] = remTs;
        map.delete(k);
      }
      return;
    }
    if (tombstones[k] && tombstones[k] > remTs) {
      return;
    }

    if (!loc) {
      map.set(k, Object.assign({ updatedAt: remTs }, rem));
      return;
    }

    const locTs = Number(loc.updatedAt) || 1;
    const winner = remTs >= locTs ? Object.assign({}, loc, rem) : Object.assign({}, rem, loc);
    winner.updatedAt = Math.max(locTs, remTs);

    // Сохраняем коллективные поля обоих устройств без потерь (Set Union)
    if (Array.isArray(loc.readBy) || Array.isArray(rem.readBy)) {
      winner.readBy = mergeArrayUnion(loc.readBy, rem.readBy);
    }
    if (Array.isArray(loc.acks) || Array.isArray(rem.acks)) {
      winner.acks = mergeArrayUnion(loc.acks, rem.acks, 'staff');
    }
    if (Array.isArray(loc.history) || Array.isArray(rem.history)) {
      winner.history = mergeArrayUnion(loc.history, rem.history, 'time');
    }
    if (Array.isArray(loc.shifts) || Array.isArray(rem.shifts)) {
      winner.shifts = mergeArrayUnion(loc.shifts, rem.shifts, 'barista');
    }
    if (loc.completedMap || rem.completedMap) {
      winner.completedMap = Object.assign({}, rem.completedMap || {}, loc.completedMap || {});
    }

    map.set(k, winner);
  });

  return Array.from(map.values()).filter((x) => !x.deleted);
};

window.coffeeDeltaSync = (function () {
  const QUEUE_KEY = 'coffee_delta_queue_v21';
  let _queue = [];
  try {
    _queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || [];
  } catch (_) {
    _queue = [];
  }

  function _persistQueue() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(_queue.slice(-300)));
      if (window.CoffeeIDB) window.CoffeeIDB.put('delta_queue', 'pending', _queue.slice(-300));
    } catch (_) {}
  }

  return {
    record(collection, id, recordObj, deleted, actorOpt) {
      if (!collection || !id) return;
      const ts = Date.now();
      const cleanRec = window.sanitizeRecord ? window.sanitizeRecord(recordObj || {}) : (recordObj || {});
      if (cleanRec && typeof cleanRec === 'object') cleanRec.updatedAt = ts;
      const entry = {
        collection: String(collection),
        id: String(id),
        updatedAt: ts,
        deleted: !!deleted,
        actor: actorOpt || 'Терминал',
        record: cleanRec
      };
      const idx = _queue.findIndex((q) => q.collection === entry.collection && q.id === entry.id);
      if (idx >= 0) _queue[idx] = entry;
      else _queue.push(entry);
      _persistQueue();
      return entry;
    },
    getPendingDeltas() {
      return _queue.slice();
    },
    flushPendingDeltas() {
      const out = _queue.slice();
      _queue = [];
      _persistQueue();
      return out;
    },
    applyIncomingDeltas(db, deltasArr) {
      if (!db || !Array.isArray(deltasArr) || !deltasArr.length) return false;
      let changed = false;
      db._tombstones = db._tombstones || {};
      const colMap = {
        tasks: { field: 'tasks', key: 'id' },
        incidents: { field: 'incidents', key: 'id' },
        announcements: { field: 'announcements', key: 'id' },
        cash: { field: 'cash', key: 'date' },
        expenses: { field: 'expenses', key: 'id' },
        goodDeeds: { field: 'goodDeeds', key: 'id' },
        staff: { field: 'staff', key: 'id' },
        ttk: { field: 'ttk', key: 'id' }
      };
      deltasArr.forEach((d) => {
        if (!d || !d.collection || !d.id) return;
        const cfg = colMap[d.collection];
        if (!cfg) return;
        const incomingItem = Object.assign({}, d.record || {}, {
          [cfg.key]: d.id,
          updatedAt: Number(d.updatedAt) || Date.now(),
          deleted: !!d.deleted
        });
        db[cfg.field] = window.coffeeMergeRecordLists(
          db[cfg.field] || [],
          [incomingItem],
          cfg.key,
          { tombstones: db._tombstones }
        );
        changed = true;
      });
      return changed;
    }
  };
})();

function mergeOrSaveCashDay(db, payload) {
  const dt = payload.date || _isoToday();
  const mode = payload.mergeMode || (payload.action === 'admin_cash' ? 'replace' : 'sum');
  const incomingCash = Math.max(0, Math.round(Number(payload.cash) || 0));
  const incomingCard = Math.max(0, Math.round(Number(payload.card) || 0));
  const incomingChecks = Math.max(0, Math.round(Number(payload.checks) || 0));
  const incomingWo = Math.max(0, Math.round(Number(payload.writeoff != null ? payload.writeoff : payload.writeOffs) || 0));
  const incomingBarista = String(payload.barista || payload.userName || '').trim();
  const incomingShifts = Array.isArray(payload.shifts) && payload.shifts.length
    ? payload.shifts
    : [{
        name: incomingBarista || 'Бариста',
        cash: incomingCash,
        card: incomingCard,
        checks: incomingChecks,
        writeoff: incomingWo,
        cups: Number(payload.cups) || incomingChecks
      }];

  const idx = db.cash.findIndex((c) => c.date === dt);
  if (idx < 0 || mode === 'replace') {
    const prev = idx >= 0 ? db.cash[idx] : null;
    const origCash = prev && prev.origCash != null ? prev.origCash : (prev ? prev.cash : incomingCash);
    const origCard = prev && prev.origCard != null ? prev.origCard : (prev ? prev.card : incomingCard);
    const newTotal = incomingCash + incomingCard;
    const zTotal = payload.zTotal != null && payload.zTotal !== '' ? Math.max(0, Math.round(Number(payload.zTotal) || 0)) : (prev && prev.zTotal != null ? prev.zTotal : newTotal);
    const rec = {
      date: dt,
      cash: incomingCash,
      card: incomingCard,
      origCash,
      origCard,
      zTotal,
      checks: incomingChecks,
      writeoff: incomingWo,
      barista: incomingBarista || (prev && prev.barista) || incomingShifts.map((s) => s.name).join(', '),
      shifts: incomingShifts,
      topItems: payload.topItems || (prev && prev.topItems) || '',
      comment: payload.comment || (prev && prev.comment) || ''
    };
    if (prev && (prev.cash + prev.card !== newTotal || payload.zTotal != null)) {
      db.cashHistory = db.cashHistory || [];
      const nowHm = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      db.cashHistory.unshift({
        time: _isoToday().split('-').reverse().join('.') + ' ' + nowHm,
        date: dt,
        actor: payload.actor || 'Администратор',
        action: payload.zTotal != null ? 'Сверка с Z-отчётом и корректировка' : 'Корректировка выручки',
        origTotal: (prev.origCash != null ? prev.origCash : prev.cash) + (prev.origCard != null ? prev.origCard : prev.card),
        newTotal,
        zTotal,
        diff: newTotal - zTotal,
        note: String(payload.reason || payload.comment || 'Ручная сверка кассы').trim()
      });
      appendAudit(db, 'Администратор', 'Корректировка / сверка кассы за ' + dt, 'Было: ' + (prev.cash + prev.card) + ' руб. → Стало: ' + newTotal + ' руб. (Z-отчёт: ' + zTotal + ' руб.)');
    }
    if (idx >= 0) db.cash[idx] = rec; else db.cash.push(rec);
  } else {
    /* Режим СУММИРОВАНИЯ (если 2 человека в один день или дозагрузка второй смены) */
    const cur = db.cash[idx];
    const sidKey = payload.sid || payload.operationId || '';
    if (sidKey) {
      cur.sids = Array.isArray(cur.sids) ? cur.sids : [];
      if (cur.sids.includes(sidKey)) return;
      cur.sids.push(sidKey);
    }
    const curShifts = Array.isArray(cur.shifts) && cur.shifts.length
      ? cur.shifts.slice()
      : [{
          name: cur.barista || 'Смена 1',
          cash: Number(cur.cash) || 0,
          card: Number(cur.card) || 0,
          checks: Number(cur.checks) || 0,
          writeoff: Number(cur.writeoff) || 0,
          cups: Number(cur.checks) || 0
        }];

    incomingShifts.forEach((incS) => {
      /* Если этот же бариста уже есть в этот день с точно такими же суммами — не дублируем, иначе обновляем или добавляем второго бариста */
      const sameIdx = curShifts.findIndex((cs) => cs.name && incS.name && cs.name.toLowerCase() === incS.name.toLowerCase());
      if (sameIdx >= 0 && incomingShifts.length > 1) {
        curShifts[sameIdx] = incS;
      } else if (sameIdx >= 0 && curShifts[sameIdx].cash === incS.cash && curShifts[sameIdx].card === incS.card) {
        curShifts[sameIdx] = Object.assign({}, curShifts[sameIdx], incS);
      } else {
        curShifts.push(incS);
      }
    });

    cur.shifts = curShifts;
    cur.cash = curShifts.reduce((s, x) => s + (Number(x.cash) || 0), 0);
    cur.card = curShifts.reduce((s, x) => s + (Number(x.card) || 0), 0);
    cur.checks = curShifts.reduce((s, x) => s + (Number(x.checks) || 0), 0);
    cur.writeoff = curShifts.reduce((s, x) => s + (Number(x.writeoff != null ? x.writeoff : x.writeoffQty) || 0), 0);
    cur.barista = Array.from(new Set(curShifts.map((s) => s.name).filter(Boolean))).join(', ');
    if (payload.topItems) {
      cur.topItems = cur.topItems && cur.topItems !== payload.topItems
        ? (cur.topItems + ' · ' + payload.topItems)
        : payload.topItems;
    }
    cur.localUpdated = true;
  }

  /* Суммируем позиции продаж (Продажи.csv) за этот день */
  if (Array.isArray(payload.products) && payload.products.length) {
    if (mode === 'replace' || !db.productsByDate[dt] || !db.productsByDate[dt].length) {
      db.productsByDate[dt] = payload.products;
    } else {
      const pMap = {};
      (db.productsByDate[dt] || []).concat(payload.products).forEach((p) => {
        if (!p || !p.name) return;
        const m = pMap[p.name] || (pMap[p.name] = { name: p.name, qty: 0, sum: 0 });
        m.qty += Number(p.qty) || 0;
        m.sum += Number(p.sum) || 0;
      });
      db.productsByDate[dt] = Object.values(pMap).sort((a, b) => b.qty - a.qty);
    }
  }
}

function enforceSettingsOnResponse(act, data) {
  if (!data || data.ok === false) return data;
  window.coffeeEnforceOverdueChecklists();
  const db = getUDB();
  if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);

  data.location = db.location;
  data.checklistBlocks = db.checklistBlocks;
  data.blocks = db.blocks;
  data.dailyPlans = db.dailyPlans;

  if (act === 'get_checklists') {
    const dpToday = window.coffeeGetDayPlan(_isoToday(), db);
    data.plan = dpToday.revenue;
    data.dayCode = dpToday.dayCode;
    data.minAvgCheck = dpToday.avgCheck;
    data.planChecks = dpToday.checks;
    data.photoAll = db.photoAll;
    data.initCounter = db.initCounter;
    data.deadline = db.deadline;
    data.openStart = db.openStart || '07:30';
    data.dayStart = db.dayStart || '08:30';
    data.dayDeadline = db.dayDeadline || '16:00';
    data.closeStart = db.closeStart || '21:30';
    data.closeDeadline = db.closeDeadline || '22:30';
    data.announcements = db.announcements || [];
    data.staff = db.staff || [];
    data.ttk = db.ttk || [];
    data.deadlineExtensions = db.deadlineExtensions || {};
    const forcePhoto = db.photoAll === 'да';
    data.tasks = window.coffeeNormalizeTasksTimeline(db.tasks || []).filter((t) => t.active !== 'нет').map((t) => {
      const isOC = t.block === 'Открытие' || t.block === 'Закрытие';
      const pMode = t.photoMode || t.photo || 'нет';
      return Object.assign({}, t, {
        photoMode: pMode,
        mediaRequired: (pMode === 'да') || (forcePhoto && isOC)
      });
    });
  } else if (act === 'dashboard') {
    const dpFocus = window.coffeeGetDayPlan(data.date || _isoToday(), db);
    data.plan = dpFocus.revenue;
    data.dayCode = dpFocus.dayCode;
    data.minAvgCheck = dpFocus.avgCheck;
    data.planChecks = dpFocus.checks;
    data.woNorm = db.woNorm;
    data.deadline = db.deadline;
    if (Array.isArray(data.days)) {
      data.days = data.days.map((dItem) => {
        const lc = db.cash.find((c) => c.date === dItem.date);
        const dayExps = (db.expenses || []).filter((e) => e.date === dItem.date).reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const wo = lc ? (Number(lc.writeoff) || 0) : 0;
        return Object.assign({}, dItem, {
          writeoff: wo,
          expenses: dayExps,
          outflow: wo + dayExps,
          barista: lc ? (lc.barista || '') : ''
        });
      });
    }
    const focusRec = db.cash.find((c) => c.date === data.date);
    if (focusRec) {
      data.barista = focusRec.barista || '';
      data.shifts = focusRec.shifts || [];
    }
    data.incidents = (db.incidents || []).filter((i) => i && i.step !== '__SYS_TERM_SYNC__');
  } else if (act === 'report') {
    data.categories = db.categories;
    /* Считаем точный суммарный план по дням недели (Пн–Вс) за выбранный период */
    if (Array.isArray(data.series) && data.series.length) {
      const activeSeries = data.series.filter((x) => x.revenue > 0);
      const listForPlan = activeSeries.length ? activeSeries : data.series;
      data.plan = listForPlan.reduce((sum, x) => sum + window.coffeeGetDayPlan(x.date, db).revenue, 0);
    } else {
      const actDays = (data.totals && data.totals.days) || data.days || 1;
      data.plan = Math.max(1, actDays) * db.plan;
    }
    const rev = (data.finance && data.finance.revenue) || (data.totals && data.totals.revenue) || 0;
    data.pct = data.plan > 0 ? Math.round(rev / data.plan * 100) : 0;
    data.incidentList = (db.incidents || []).filter((i) => i && i.step !== '__SYS_TERM_SYNC__');
    if (Array.isArray(data.tasks) && data.discipline) {
      let lateCount = 0;
      data.tasks.forEach((tRow) => {
        if (tRow && Array.isArray(tRow.open) && tRow.open.length) {
          const earliest = tRow.open.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))[0].time;
          if (earliest && earliest > db.deadline) lateCount++;
        }
      });
      data.discipline.late = lateCount;
    }
  } else if (act === 'admin') {
    data.location = db.location;
    data.categories = db.categories;
    data.settings = db.settings;
    data.tasks = window.coffeeNormalizeTasksTimeline(db.tasks || []);
    data.cash = db.cash;
    data.expenses = db.expenses;
    data.incidents = (db.incidents || []).filter((i) => i && i.step !== '__SYS_TERM_SYNC__');
    data.announcements = db.announcements || [];
    data.staff = db.staff || [];
    data.ttk = db.ttk || [];
    data.goodDeeds = db.goodDeeds || window.COFFEE_DEFAULT_GOOD_DEEDS || [];
    data.serviceAudits = db.serviceAudits || [];
    data.shiftRoster = db.shiftRoster || {};
    data.auditLog = db.auditLog || [];
    data.deadlineExtensions = db.deadlineExtensions || {};
  }
  if (act === 'dashboard' || act === 'report') {
    data.announcements = db.announcements || [];
    data.staff = db.staff || [];
    data.mvpDiscipline = window.coffeeCalcDiscipline(db, data.from, data.to);
  }
  return data;
}

/* Формирование компактного облачного конверта синхронизации (передаёт чек-листы, смены, инциденты и настройки между устройствами через Google Таблицу) */
function _buildCloudSyncEnvelope(db) {
  window.coffeeEnsureV19Schema(db);
  const stripBigPhotos = (phs) => (phs || []).slice(0, 4).map((p) => ({
    step: p.step || '',
    url: (p.url && p.url.length < 35000) ? p.url : '',
    isIncident: !!p.isIncident,
    comment: p.comment || '',
    completedAt: p.completedAt || ''
  }));
  return {
    ts: db.updatedAt || Date.now(),
    location: db.location,
    plan: db.plan,
    woNorm: db.woNorm,
    minAvgCheck: db.minAvgCheck,
    planChecks: db.planChecks,
    openStart: db.openStart,
    deadline: db.deadline,
    dayStart: db.dayStart,
    dayDeadline: db.dayDeadline,
    closeStart: db.closeStart,
    closeDeadline: db.closeDeadline,
    checklistBlocks: db.checklistBlocks || window.COFFEE_DEFAULT_CHECKLIST_BLOCKS,
    dailyPlans: db.dailyPlans || window.COFFEE_DEFAULT_DAILY_PLANS,
    staff: db.staff || [],
    ttk: db.ttk || [],
    shiftRoster: db.shiftRoster || {},
    deadlineExtensions: db.deadlineExtensions || {},
    overdueIncidentsCreated: db.overdueIncidentsCreated || {},
    cash: (db.cash || []).slice(0, 25),
    checklists: (db.checklists || []).slice(-30).map((c) => Object.assign({}, c, { photos: stripBigPhotos(c.photos) })),
    incidents: (db.incidents || []).slice(0, 30).map((inc) => Object.assign({}, inc, {
      photo: (inc.photo && inc.photo.length < 35000) ? inc.photo : '',
      photos: (inc.photos || []).filter((u) => u && u.length < 35000).slice(0, 2)
    })),
    expenses: (db.expenses || []).slice(0, 30),
    announcements: (db.announcements || []).slice(0, 15)
  };
}

function _didSheetPartChange(db, key, val, forceFromSheet) {
  db._lastServerSnapshot = db._lastServerSnapshot || {};
  let ser = '';
  try { ser = JSON.stringify(val); } catch (_) { ser = String(val); }
  if (forceFromSheet) {
    db._lastServerSnapshot[key] = ser;
    return true;
  }
  const prev = db._lastServerSnapshot[key];
  if (prev === undefined) {
    db._lastServerSnapshot[key] = ser;
    if (typeof window !== 'undefined' && window.COFFEE_IS_BARISTA_TERMINAL) return true;
    return !db.lastLocalMutationAt;
  }
  if (prev !== ser) {
    // Данные в самой Google Таблице изменились! Применяем новые данные из таблицы
    db._lastServerSnapshot[key] = ser;
    return true;
  }
  // Данные на сервере не менялись с прошлой проверки — сохраняем локальные изменения/удаления владельца без отката!
  return false;
}

function absorbServerData(url, data, options) {
  if (!data || data.ok === false) return data;
  const opts = options || {};
  const forceFromSheet = !!opts.forceFromSheet;
  const db = getUDB();
  let changed = false;

  db.deletedTaskIds = db.deletedTaskIds || {};
  db.deletedCashDates = db.deletedCashDates || {};
  db.deletedExpenseIds = db.deletedExpenseIds || {};
  db.deletedIncidents = db.deletedIncidents || {};
  db.deletedAnnouncementIds = db.deletedAnnouncementIds || {};
  db.deletedStaffIds = db.deletedStaffIds || {};
  db.deletedTtkIds = db.deletedTtkIds || {};
  db.deletedGoodDeedIds = db.deletedGoodDeedIds || {};
  db.deletedChecklistBlocks = db.deletedChecklistBlocks || {};
  db.deletedServiceAuditIds = db.deletedServiceAuditIds || {};

  if (Array.isArray(data.deltas) && data.deltas.length && window.coffeeDeltaSync) {
    if (window.coffeeDeltaSync.applyIncomingDeltas(db, data.deltas)) changed = true;
    if (data.serverTs) db.lastServerDeltaTs = data.serverTs;
  }

  /* 1. Двусторонняя синхронизация листа «Настройки» */
  if (Array.isArray(data.settings)) {
    data.settings.forEach((srvSet) => {
      const nk = normalizeSettingKey(srvSet.id || srvSet.label);
      if (!nk || nk === 'CLOUD_SYNC_V17' || nk === 'ADMIN_PIN') return;
      const srvVal = srvSet.value !== undefined ? String(srvSet.value).trim() : '';
      if (!srvVal || srvVal.indexOf('••') >= 0) return;
      if (_didSheetPartChange(db, 'set:' + nk, srvVal, forceFromSheet)) {
        const target = (db.settings || []).find((x) => x.id === nk);
        if (target && target.value !== srvVal) {
          target.value = srvVal;
          changed = true;
        }
      }
    });
  }

  /* 2. Двусторонняя синхронизация листа «Таймлайн» (окна и блоки чек-листов) */
  if (Array.isArray(data.checklistBlocks) && data.checklistBlocks.length) {
    if (_didSheetPartChange(db, 'sheet:timeline', data.checklistBlocks, forceFromSheet)) {
      db.checklistBlocks = data.checklistBlocks.filter((b) => b && (forceFromSheet || !db.deletedChecklistBlocks[b.name]));
      db.blocks = db.checklistBlocks.filter((b) => b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
      changed = true;
    }
  } else if (data.openStart || data.deadline || data.closeStart || data.closeDeadline) {
    const legacyWinSig = [data.openStart, data.deadline, data.dayStart, data.dayDeadline, data.closeStart, data.closeDeadline].join('|');
    if (_didSheetPartChange(db, 'sheet:legacyWin', legacyWinSig, forceFromSheet)) {
      (db.checklistBlocks || []).forEach((b) => {
        if (!b) return;
        if (b.name === 'Открытие') {
          if (data.openStart) b.openTime = data.openStart;
          if (data.deadline) b.deadline = data.deadline;
        } else if (b.name === 'Лайн Чек 1' || b.name === 'День') {
          if (data.dayStart) b.openTime = data.dayStart;
          if (data.dayDeadline) b.deadline = data.dayDeadline;
        } else if (b.name === 'Закрытие') {
          if (data.closeStart) b.openTime = data.closeStart;
          if (data.closeDeadline) b.deadline = data.closeDeadline;
        }
      });
      changed = true;
    }
  }

  /* 3. Двусторонняя синхронизация листа «Планы» (планы Пн–Вс и график смен) */
  if (data.dailyPlans && typeof data.dailyPlans === 'object') {
    if (_didSheetPartChange(db, 'sheet:dailyPlans', data.dailyPlans, forceFromSheet)) {
      db.dailyPlans = Object.assign({}, db.dailyPlans || {}, data.dailyPlans);
      changed = true;
    }
  }
  if (data.shiftRoster && typeof data.shiftRoster === 'object') {
    if (_didSheetPartChange(db, 'sheet:shiftRoster', data.shiftRoster, forceFromSheet)) {
      db.shiftRoster = Object.assign({}, db.shiftRoster || {}, data.shiftRoster);
      changed = true;
    }
  }

  /* 4. Двусторонняя синхронизация листа «Задачи» */
  if (Array.isArray(data.tasks) && data.tasks.length) {
    const cleanSrvTasks = data.tasks.filter((t) => t && t.id !== '__SYS_CONFIG_V19__' && t.title !== '__SYS_SYNC__');
    if (cleanSrvTasks.length && _didSheetPartChange(db, 'sheet:tasks', cleanSrvTasks, forceFromSheet)) {
      if (forceFromSheet) db.deletedTaskIds = {};
      db.tasks = window.coffeeNormalizeTasksTimeline(cleanSrvTasks.filter((t) => !db.deletedTaskIds[t.id]));
      changed = true;
    }
  }

  /* 5. Двусторонняя синхронизация листа «Карта добрых дел» */
  if (Array.isArray(data.goodDeeds) && data.goodDeeds.length) {
    if (_didSheetPartChange(db, 'sheet:goodDeeds', data.goodDeeds, forceFromSheet)) {
      if (forceFromSheet) db.deletedGoodDeedIds = {};
      db.goodDeeds = data.goodDeeds.filter((g) => g && !db.deletedGoodDeedIds[g.id]);
      changed = true;
    }
  }

  /* 6. Двусторонняя синхронизация листа «Техкарты» (ТТК) */
  if (Array.isArray(data.ttk) && data.ttk.length) {
    if (_didSheetPartChange(db, 'sheet:ttk', data.ttk, forceFromSheet)) {
      if (forceFromSheet) db.deletedTtkIds = {};
      db.ttk = data.ttk.filter((k) => k && !db.deletedTtkIds[k.id]);
      changed = true;
    }
  }

  /* 7. Двусторонняя синхронизация листа «Сотрудники» */
  if (Array.isArray(data.staff) && data.staff.length) {
    if (_didSheetPartChange(db, 'sheet:staff', data.staff, forceFromSheet)) {
      if (forceFromSheet) db.deletedStaffIds = {};
      db.staff = data.staff.filter((s) => s && !db.deletedStaffIds[s.id] && !db.deletedStaffIds[s.name]);
      changed = true;
    }
  }

  /* 8. Двусторонняя синхронизация листа «Информирование» */
  if (Array.isArray(data.announcements)) {
    if (_didSheetPartChange(db, 'sheet:announcements', data.announcements, forceFromSheet)) {
      if (forceFromSheet) db.deletedAnnouncementIds = {};
      db.announcements = data.announcements.filter((a) => a && !db.deletedAnnouncementIds[a.id]);
      changed = true;
    }
  }

  /* 9. Двусторонняя синхронизация листа «Аудит сервиса» */
  if (Array.isArray(data.serviceAudits) && data.serviceAudits.length) {
    if (_didSheetPartChange(db, 'sheet:serviceAudits', data.serviceAudits, forceFromSheet)) {
      if (forceFromSheet) db.deletedServiceAuditIds = {};
      db.serviceAudits = data.serviceAudits.filter((a) => a && !db.deletedServiceAuditIds[a.id]);
      changed = true;
    }
  }

  /* 10. Двусторонняя синхронизация листа «Расходы» */
  if (Array.isArray(data.expenses)) {
    if (_didSheetPartChange(db, 'sheet:expenses', data.expenses, forceFromSheet)) {
      if (forceFromSheet) db.deletedExpenseIds = {};
      db.expenses = data.expenses.filter((e) => e && e.id && !db.deletedExpenseIds[e.id]);
      changed = true;
    }
  }

  /* 11. Двусторонняя синхронизация листа «Касса» */
  if (Array.isArray(data.cash)) {
    if (_didSheetPartChange(db, 'sheet:cash', data.cash, forceFromSheet)) {
      if (forceFromSheet) db.deletedCashDates = {};
      data.cash.forEach((srvC) => {
        if (!srvC || !srvC.date || db.deletedCashDates[srvC.date]) return;
        const sRev = (Number(srvC.cash) || 0) + (Number(srvC.card) || 0);
        if (sRev <= 0 && !srvC.checks) return;
        const loc = db.cash.find((c) => c.date === srvC.date);
        if (!loc) {
          db.cash.push({
            date: srvC.date,
            cash: Number(srvC.cash) || 0,
            card: Number(srvC.card) || 0,
            checks: Number(srvC.checks) || 0,
            writeoff: Number(srvC.writeoff) || 0,
            barista: srvC.barista || '',
            topItems: srvC.topItems || ''
          });
          changed = true;
        } else {
          loc.cash = Number(srvC.cash) || 0;
          loc.card = Number(srvC.card) || 0;
          loc.checks = Number(srvC.checks) || loc.checks || 0;
          loc.writeoff = Number(srvC.writeoff != null ? srvC.writeoff : loc.writeoff) || 0;
          if (srvC.topItems) loc.topItems = srvC.topItems;
          if (srvC.barista) loc.barista = srvC.barista;
          changed = true;
        }
      });
    }
  }

  /* 12. Двусторонняя синхронизация листа «Поломки» */
  if (Array.isArray(data.incidents)) {
    const cleanIncs = data.incidents.filter((srvInc) => srvInc && srvInc.step !== '__SYS_TERM_SYNC__' && srvInc.who !== '__SYS__' && srvInc.block !== '__SYS__');
    if (_didSheetPartChange(db, 'sheet:incidents', cleanIncs, forceFromSheet)) {
      if (forceFromSheet) db.deletedIncidents = {};
      cleanIncs.forEach((srvInc) => {
        if (!srvInc.id || db.deletedIncidents[srvInc.id]) return;
        const localStatus = db.resolvedIncidents[srvInc.id];
        const normStatus = (forceFromSheet ? null : localStatus) || window.coffeeNormIncStatus(srvInc.status);
        const existing = db.incidents.find((x) => x.id === srvInc.id);
        if (!existing) {
          db.incidents.unshift({
            id: srvInc.id,
            date: srvInc.date || _isoToday(),
            time: srvInc.time || '',
            step: srvInc.step || 'Проблема',
            text: srvInc.text || '',
            priority: srvInc.priority || 'Терпит',
            status: normStatus,
            who: srvInc.who || '',
            owner: srvInc.owner || '—',
            photo: srvInc.photo || '',
            incType: srvInc.incType || 'Поломка оборудования',
            history: Array.isArray(srvInc.history) ? srvInc.history : []
          });
          changed = true;
        } else {
          existing.status = normStatus;
          if (srvInc.text) existing.text = srvInc.text;
          if (srvInc.owner) existing.owner = srvInc.owner;
          if (!existing.photo && srvInc.photo) existing.photo = srvInc.photo;
          changed = true;
        }
      });
    }
  }

  if (data.deadlineExtensions && typeof data.deadlineExtensions === 'object') {
    if (_didSheetPartChange(db, 'sheet:deadlineExtensions', data.deadlineExtensions, forceFromSheet)) {
      db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, data.deadlineExtensions);
      changed = true;
    }
  }

  if (Array.isArray(data.incidents)) data.incidents = (db.incidents || []).filter((i) => i && i.step !== '__SYS_TERM_SYNC__' && i.block !== '__SYS__');
  if (changed) saveUDB(db);
  return data;
}

function applyLocalMutation(payload) {
  if (!payload || !payload.action) return;
  const db = getUDB();
  if (payload.operationId) {
    db._appliedOpIds = Array.isArray(db._appliedOpIds) ? db._appliedOpIds : [];
    if (db._appliedOpIds.includes(payload.operationId)) return;
    db._appliedOpIds.push(payload.operationId);
    if (db._appliedOpIds.length > 300) db._appliedOpIds = db._appliedOpIds.slice(-300);
  }
  db.lastLocalMutationAt = Date.now();
  const a = payload.action;

  if (a === 'save_setting') {
    const nk = normalizeSettingKey(payload.id);
    const val = String(payload.value != null ? payload.value : '').trim();
    const s = (db.settings || []).find((x) => x.id === nk);
    if (s) s.value = val;
    else db.settings.push({ id: nk, label: nk, hint: '', value: val, secret: nk === 'ADMIN_PIN' });
    db.modifiedSettings[nk] = Date.now();
    if (nk === 'ADMIN_PIN' && val) {
      try {
        if (window.coffeeAuth && window.coffeeAuth.createLocalSession) window.coffeeAuth.createLocalSession('admin', 'Администратор', val);
        else localStorage.setItem('coffee_illy_pin', val);
      } catch (_) {}
    }
  } else if (a === 'save_all_settings' && Array.isArray(payload.items)) {
    payload.items.forEach((it) => {
      const nk = normalizeSettingKey(it.id);
      const val = String(it.value != null ? it.value : '').trim();
      const s = (db.settings || []).find((x) => x.id === nk);
      if (s) {
        if (s.secret && !val) return;
        s.value = val;
      }
      db.modifiedSettings[nk] = Date.now();
      if (nk === 'ADMIN_PIN' && val) {
        try {
          if (window.coffeeAuth && window.coffeeAuth.createLocalSession) window.coffeeAuth.createLocalSession('admin', 'Администратор', val);
          else localStorage.setItem('coffee_illy_pin', val);
        } catch (_) {}
      }
    });
  } else if (a === 'save_task') {
    if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
    const isEdit = payload.row != null || (payload.id && (db.tasks || []).some((t) => t.id === payload.id));
    const item = {
      row: payload.row || (db.tasks.length + 2),
      id: payload.id || ('t' + Date.now().toString(36)),
      block: payload.block || 'Открытие',
      group: payload.group || (payload.block === 'Открытие' ? 'o' : payload.block === 'День' ? 'd' : 'c'),
      groupName: payload.groupName || payload.block,
      title: (payload.title || '').trim(),
      instruction: (payload.instruction || '').trim(),
      photo: payload.photoMode || payload.mediaRequired || payload.photo || 'нет',
      photoMode: payload.photoMode || payload.mediaRequired || payload.photo || 'нет',
      mediaRequired: (payload.photoMode || payload.mediaRequired || payload.photo) === 'да',
      responsible: (payload.responsible || '').trim(),
      active: payload.active || 'да'
    };
    if (isEdit) {
      db.ownerTasksModifiedAt = Date.now();
      const idx = db.tasks.findIndex((t) => (payload.id && t.id === payload.id) || t.row === Number(payload.row) || (payload.expect && t.title === payload.expect));
      if (idx >= 0) db.tasks[idx] = Object.assign({}, db.tasks[idx], item);
      else db.tasks.push(item);
    } else {
      db.ownerTasksModifiedAt = Date.now();
      db.tasks.push(item);
    }
  } else if (a === 'delete_task') {
    db.deletedTaskIds = db.deletedTaskIds || {};
    db.tasks = (db.tasks || []).filter((t) => {
      const match = (payload.id && t.id === payload.id) || (payload.row != null && t.row === Number(payload.row)) || (payload.expect && t.title === payload.expect);
      if (match && t.id) db.deletedTaskIds[t.id] = true;
      return !match;
    });
    db.ownerTasksModifiedAt = Date.now();
  } else if (a === 'admin_cash' || a === 'submit_cash') {
    if (db.deletedCashDates && payload.date) delete db.deletedCashDates[payload.date];
    mergeOrSaveCashDay(db, payload);
    if (window.coffeeNotify) {
      const totRev = (Number(payload.cash) || 0) + (Number(payload.card) || 0);
      const whoCash = payload.barista || payload.userName || 'Бариста';
      window.coffeeNotify.push(db, {
        level: 'ok',
        type: 'cash',
        actor: whoCash,
        title: '💰 Сдан кассовый отчёт: ' + totRev + ' руб.',
        text: 'Сотрудник: ' + whoCash + ' · Нал: ' + (payload.cash || 0) + ' руб. · Безнал: ' + (payload.card || 0) + ' руб. · Чеков: ' + (payload.checks || 0),
        telegramText: '💰 КАССА СМЕНЫ (' + (payload.date || _isoToday()) + ')\n👤 Бариста: ' + whoCash + '\n💵 Выручка: ' + totRev + ' руб. (Нал: ' + (payload.cash || 0) + ' / Безнал: ' + (payload.card || 0) + ')\n🧾 Чеков: ' + (payload.checks || 0)
      });
    }
    if (payload.endCounter > 0) {
      const sc = db.settings.find((x) => x.id === 'INIT_COUNTER');
      if (sc) sc.value = String(payload.endCounter);
    }
  } else if (a === 'batch_submit_cash' && Array.isArray(payload.days)) {
    payload.days.forEach((dayPayload) => {
      mergeOrSaveCashDay(db, Object.assign({ mergeMode: payload.mergeMode || 'sum' }, dayPayload));
      if (dayPayload.endCounter > 0) {
        const sc = db.settings.find((x) => x.id === 'INIT_COUNTER');
        if (sc) sc.value = String(dayPayload.endCounter);
      }
    });
  } else if (a === 'delete_cash') {
    db.deletedCashDates = db.deletedCashDates || {};
    if (payload.date) db.deletedCashDates[payload.date] = Date.now();
    db.cash = db.cash.filter((c) => c.date !== payload.date);
  } else if (a === 'add_expense') {
    db.expenses.unshift({
      id: payload.id || ('EXP-' + Math.floor(100 + Math.random() * 900)),
      date: payload.date || _isoToday(),
      category: payload.category || db.categories[0],
      amount: Math.max(0, Math.round(Number(payload.amount) || 0)),
      comment: (payload.comment || '').trim()
    });
  } else if (a === 'update_expense') {
    const ex = db.expenses.find((x) => x.id === payload.id);
    if (ex) {
      ex.date = payload.date || ex.date;
      ex.category = payload.category || ex.category;
      ex.amount = Math.max(0, Math.round(Number(payload.amount) || 0));
      ex.comment = (payload.comment || '').trim();
    }
  } else if (a === 'delete_expense') {
    db.deletedExpenseIds = db.deletedExpenseIds || {};
    if (payload.id) db.deletedExpenseIds[payload.id] = Date.now();
    db.expenses = db.expenses.filter((x) => x.id !== payload.id);
  } else if (a === 'reorder_task') {
    if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
    db.ownerTasksModifiedAt = Date.now();
    const idx = db.tasks.findIndex((t) => t.id === payload.id || t.row === Number(payload.row));
    if (idx >= 0) {
      const dir = payload.dir === 'up' ? -1 : 1;
      const blk = db.tasks[idx].block;
      let swapIdx = idx + dir;
      while (swapIdx >= 0 && swapIdx < db.tasks.length && db.tasks[swapIdx].block !== blk) swapIdx += dir;
      if (swapIdx >= 0 && swapIdx < db.tasks.length) {
        const tmp = db.tasks[idx];
        db.tasks[idx] = db.tasks[swapIdx];
        db.tasks[swapIdx] = tmp;
        appendAudit(db, 'Администратор', 'Изменение порядка задач', 'Перемещена задача «' + tmp.title + '»');
      }
    }
  } else if (a === 'ack_announcement') {
    const ann = (db.announcements || []).find((x) => x.id === payload.id);
    const whoName = String(payload.userName || 'Бариста').trim();
    if (ann && whoName) {
      ann.acks = Array.isArray(ann.acks) ? ann.acks : [];
      if (!ann.acks.some((k) => k.name.toLowerCase() === whoName.toLowerCase())) {
        const now = new Date();
        const stamp = _isoToday().split('-').reverse().join('.') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        ann.acks.push({ name: whoName, at: stamp });
        appendAudit(db, whoName, 'Ознакомление с материалом', 'Ознакомлен с «' + ann.title + '» (' + stamp + ')');
      }
    }
  } else if (a === 'save_announcement') {
    db.announcements = db.announcements || [];
    const item = {
      id: payload.id || ('INFO-' + Math.floor(100 + Math.random() * 900)),
      title: String(payload.title || '').trim(),
      category: payload.category || 'Внутренние объявления',
      text: String(payload.text || '').trim(),
      publishedAt: payload.publishedAt || _isoToday(),
      validFrom: payload.validFrom || _isoToday(),
      validTo: payload.validTo || _shiftIso(_isoToday(), 30),
      calendarDate: payload.calendarDate || '',
      calendarEventTitle: String(payload.calendarEventTitle || '').trim(),
      mediaUrl: payload.mediaUrl || '',
      targetStaff: Array.isArray(payload.targetStaff)
        ? payload.targetStaff
        : String(payload.targetStaff || 'Соня, Алина, Настя').split(',').map((s) => s.trim()).filter(Boolean),
      acks: Array.isArray(payload.acks) ? payload.acks : []
    };
    const exIdx = db.announcements.findIndex((x) => x.id === item.id);
    if (exIdx >= 0) {
      item.acks = db.announcements[exIdx].acks || [];
      db.announcements[exIdx] = item;
    } else {
      db.announcements.unshift(item);
    }
    db.ownerAnnouncementsModifiedAt = Date.now();
    appendAudit(db, 'Администратор', 'Публикация информирования', item.title);
  } else if (a === 'delete_announcement') {
    db.ownerAnnouncementsModifiedAt = Date.now();
    db.deletedAnnouncementIds = db.deletedAnnouncementIds || {};
    if (payload.id) db.deletedAnnouncementIds[payload.id] = Date.now();
    db.announcements = (db.announcements || []).filter((x) => x.id !== payload.id);
    appendAudit(db, 'Администратор', 'Удаление инфо-материала', String(payload.id || ''));
  } else if (a === 'save_checklist_blocks' && Array.isArray(payload.blocks)) {
    db.checklistBlocks = payload.blocks.map((b, i) => ({
      id: b.id || ('blk_' + i),
      name: String(b.name || ('Чек-лист ' + (i + 1))).trim(),
      openTime: String(b.openTime || '07:30').trim(),
      deadline: String(b.deadline || '22:30').trim(),
      isCash: !!b.isCash || b.name === 'Касса',
      active: b.active !== false
    }));
    db.blocks = db.checklistBlocks.filter((b) => b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
    db.deadlineExtensions = {};
    db.overdueIncidentsCreated = {};
    appendAudit(db, 'Администратор', 'Обновление таймлайна и чек-листов', db.checklistBlocks.map((b) => b.name + ' (' + b.openTime + '–' + b.deadline + ')').join(', '));
  } else if (a === 'add_checklist_block') {
    window.coffeeEnsureV19Schema(db);
    const nm = String(payload.name || '').trim();
    if (nm) {
      const cashIdx = db.checklistBlocks.findIndex((b) => b.isCash || b.name === 'Касса');
      const newBlk = {
        id: 'blk_' + Date.now().toString(36),
        name: nm,
        openTime: String(payload.openTime || '10:00').trim(),
        deadline: String(payload.deadline || '12:00').trim(),
        isCash: false,
        active: true
      };
      if (cashIdx >= 0) db.checklistBlocks.splice(cashIdx, 0, newBlk);
      else db.checklistBlocks.push(newBlk);
      db.blocks = db.checklistBlocks.filter((b) => b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
      appendAudit(db, 'Администратор', 'Добавлен новый чек-лист', nm + ' (' + newBlk.openTime + '–' + newBlk.deadline + ')');
    }
  } else if (a === 'delete_checklist_block') {
    window.coffeeEnsureV19Schema(db);
    const targetName = String(payload.name || '').trim();
    db.deletedChecklistBlocks = db.deletedChecklistBlocks || {};
    if (targetName) db.deletedChecklistBlocks[targetName] = Date.now();
    db.checklistBlocks = (db.checklistBlocks || []).filter((b) => b.name !== targetName && b.id !== payload.id);
    db.blocks = db.checklistBlocks.filter((b) => b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
    appendAudit(db, 'Администратор', 'Удалён чек-лист', targetName);
  } else if (a === 'save_daily_plans' && payload.plans) {
    window.coffeeEnsureV19Schema(db);
    db.dailyPlans = Object.assign({}, db.dailyPlans || {}, payload.plans);
    const todayPlan = window.coffeeGetDayPlan(_isoToday(), db);
    db.plan = todayPlan.revenue;
    db.minAvgCheck = todayPlan.avgCheck;
    db.planChecks = todayPlan.checks;
    appendAudit(db, 'Администратор', 'Обновление планов по дням недели (Пн–Вс)', 'План сегодня (' + todayPlan.dayCode + '): ' + todayPlan.revenue + ' руб., ср. чек ' + todayPlan.avgCheck + ' руб., чеков ' + todayPlan.checks);
  } else if (a === 'save_staff_pins' && Array.isArray(payload.pins)) {
    window.coffeeEnsureV19Schema(db);
    db.ownerStaffModifiedAt = Date.now();
    payload.pins.forEach((pItem) => {
      const st = (db.staff || []).find((s) => s.id === pItem.id || s.name === pItem.name);
      if (st && pItem.pin) {
        st.pin = String(pItem.pin).trim();
        if (window.coffeeHashPin) st.pinHash = window.coffeeHashPin(st.pin);
      }
    });
    appendAudit(db, 'Администратор', 'Обновление кодов доступа сотрудников', 'Обновлено кодов: ' + payload.pins.length);
  } else if (a === 'save_staff') {
    db.staff = db.staff || [];
    db.ownerStaffModifiedAt = Date.now();
    const rawPin = String(payload.pin || '1111').trim();
    const stItem = {
      id: payload.id || ('st_' + Date.now().toString(36)),
      name: String(payload.name || '').trim(),
      role: payload.role || 'Бариста',
      pin: rawPin,
      pinHash: window.coffeeHashPin ? window.coffeeHashPin(rawPin) : rawPin,
      shop: payload.shop || db.location || 'Кофейня №1',
      active: payload.active || 'да'
    };
    const sIdx = db.staff.findIndex((x) => x.id === stItem.id || x.name.toLowerCase() === stItem.name.toLowerCase());
    if (sIdx >= 0) db.staff[sIdx] = Object.assign({}, db.staff[sIdx], stItem);
    else db.staff.push(stItem);
    appendAudit(db, 'Администратор', 'Обновление сотрудника', stItem.name + ' (' + stItem.role + ')');
  } else if (a === 'delete_staff') {
    db.ownerStaffModifiedAt = Date.now();
    db.deletedStaffIds = db.deletedStaffIds || {};
    if (payload.id) db.deletedStaffIds[payload.id] = Date.now();
    if (payload.name) db.deletedStaffIds[payload.name] = Date.now();
    db.staff = (db.staff || []).filter((x) => x.id !== payload.id && x.name !== payload.name);
  } else if (a === 'save_service_audit') {
    db.serviceAudits = db.serviceAudits || [];
    const g = Math.min(100, Math.max(0, Number(payload.greet != null ? payload.greet : 100)));
    const cl = Math.min(100, Math.max(0, Number(payload.clarify != null ? payload.clarify : 100)));
    const up = Math.min(100, Math.max(0, Number(payload.upsell != null ? payload.upsell : 90)));
    const fw = Math.min(100, Math.max(0, Number(payload.farewell != null ? payload.farewell : 100)));
    const sc = Math.round((g + cl + up + fw) / 4);
    const item = {
      id: payload.id || ('AUD-' + Math.floor(100 + Math.random() * 900)),
      date: payload.date || _isoToday(),
      barista: String(payload.barista || 'Соня').trim(),
      auditor: String(payload.auditor || 'Шеф-бариста').trim(),
      greet: g, clarify: cl, upsell: up, farewell: fw, score: sc,
      comment: String(payload.comment || '').trim()
    };
    const aIdx = db.serviceAudits.findIndex((x) => x.id === item.id);
    if (aIdx >= 0) db.serviceAudits[aIdx] = item;
    else db.serviceAudits.unshift(item);
    appendAudit(db, item.auditor, 'Аудит качества сервиса (' + item.barista + ')', 'Итоговый балл: ' + sc + '% · ' + (item.comment || 'без замечаний'));
  } else if (a === 'delete_service_audit') {
    db.deletedServiceAuditIds = db.deletedServiceAuditIds || {};
    if (payload.id) db.deletedServiceAuditIds[payload.id] = Date.now();
    db.serviceAudits = (db.serviceAudits || []).filter((x) => x.id !== payload.id);
  } else if (a === 'save_ttk') {
    if (!Array.isArray(db.ttk) || !db.ttk.length) db.ttk = (window.COFFEE_DEFAULT_TTK || []).map((x) => Object.assign({}, x));
    const item = {
      id: payload.id || ('ttk_' + Date.now().toString(36)),
      name: String(payload.name || '').trim(),
      volume: String(payload.volume || '250 мл').trim(),
      category: String(payload.category || 'Классика').trim(),
      price: Math.max(1, Number(payload.price) || 45),
      costBeans: Math.max(0, Number(payload.costBeans) || 0),
      costMilk: Math.max(0, Number(payload.costMilk) || 0),
      costSyrup: Math.max(0, Number(payload.costSyrup) || 0),
      costCup: Math.max(0, Number(payload.costCup) || 0),
      recipe: String(payload.recipe || '').trim(),
      serving: String(payload.serving || '').trim()
    };
    const idx = db.ttk.findIndex((x) => x.id === item.id);
    if (idx >= 0) db.ttk[idx] = item;
    else db.ttk.push(item);
    appendAudit(db, 'Администратор', 'Обновление техкарты напитка (ТТК)', item.name + ' (' + item.volume + ')');
  } else if (a === 'delete_ttk') {
    if (!Array.isArray(db.ttk) || !db.ttk.length) db.ttk = (window.COFFEE_DEFAULT_TTK || []).map((x) => Object.assign({}, x));
    db.deletedTtkIds = db.deletedTtkIds || {};
    if (payload.id) db.deletedTtkIds[payload.id] = Date.now();
    db.ttk = db.ttk.filter((x) => x.id !== payload.id);
  } else if (a === 'save_good_deed') {
    if (!Array.isArray(db.goodDeeds)) db.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((x) => Object.assign({}, x));
    const gdItem = {
      id: payload.id || ('gd_' + Date.now().toString(36)),
      title: String(payload.title || '').trim(),
      frequency: payload.frequency || '1 раз в неделю (Воскресенье)',
      window: String(payload.window || '14:00 – 18:00').trim(),
      responsible: payload.responsible || 'Бариста',
      reviewer: payload.reviewer || 'Управляющий / Шеф-бариста',
      instruction: String(payload.instruction || '').trim()
    };
    const gIdx = db.goodDeeds.findIndex((x) => x.id === gdItem.id);
    if (gIdx >= 0) db.goodDeeds[gIdx] = gdItem;
    else db.goodDeeds.push(gdItem);
    if (window.coffeeSyncGoodDeedsToChecklistTasks) window.coffeeSyncGoodDeedsToChecklistTasks(db);
    appendAudit(db, 'Администратор', 'Обновление Карты добрых дел (периодическая задача)', gdItem.title + ' (' + gdItem.frequency + ')');
  } else if (a === 'delete_good_deed') {
    if (!Array.isArray(db.goodDeeds)) db.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((x) => Object.assign({}, x));
    db.deletedGoodDeedIds = db.deletedGoodDeedIds || {};
    if (payload.id) db.deletedGoodDeedIds[payload.id] = Date.now();
    db.goodDeeds = db.goodDeeds.filter((x) => x.id !== payload.id);
    if (window.coffeeSyncGoodDeedsToChecklistTasks) window.coffeeSyncGoodDeedsToChecklistTasks(db);
  } else if (a === 'save_shift_roster') {
    db.shiftRoster = Object.assign({}, db.shiftRoster || {}, payload.roster || {});
    appendAudit(db, 'Администратор', 'Обновление графика смен на неделю', JSON.stringify(db.shiftRoster));
  } else if (a === 'extend_deadline') {
    const dt = payload.date || _isoToday();
    const blk = payload.block || 'Открытие';
    const extKey = dt + ':' + blk;
    db.deadlineExtensions = db.deadlineExtensions || {};
    const nowHm = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    db.deadlineExtensions[extKey] = {
      openFrom: payload.openFrom || '00:00',
      until: payload.until || '23:59',
      forceOpen: true,
      reason: String(payload.reason || 'Разблокировано администратором').trim(),
      by: payload.actor || 'Администратор',
      at: nowHm
    };
    if (db.overdueIncidentsCreated) delete db.overdueIncidentsCreated[extKey];
    appendAudit(db, 'Администратор', 'Разблокировка / Продление чек-листа', blk + ' открыт до ' + (payload.until || '23:59') + ' · Причина: ' + (payload.reason || ''));
  } else if (a === 'save_block_windows') {
    const pairs = [
      ['OPEN_START', payload.openStart],
      ['DEADLINE', payload.openDeadline],
      ['DAY_START', payload.dayStart],
      ['DAY_DEADLINE', payload.dayDeadline],
      ['CLOSE_START', payload.closeStart],
      ['CLOSE_DEADLINE', payload.closeDeadline]
    ];
    pairs.forEach(([k, v]) => {
      if (v) {
        const s = (db.settings || []).find((x) => x.id === k);
        if (s) s.value = String(v).trim();
        else db.settings.push({ id: k, label: k, hint: '', value: String(v).trim(), secret: false });
        db.modifiedSettings[k] = Date.now();
      }
    });
    /* При ручном изменении окон времени сбрасываем временные расширения за сегодня, чтобы новые часы сразу действовали */
    db.deadlineExtensions = {};
    db.overdueIncidentsCreated = {};
    appendAudit(db, 'Администратор', 'Изменение временных окон чек-листов', 'Открытие: ' + (payload.openStart || '') + '–' + (payload.openDeadline || '') + ', День: ' + (payload.dayStart || '') + '–' + (payload.dayDeadline || '') + ', Закрытие: ' + (payload.closeStart || '') + '–' + (payload.closeDeadline || ''));
  } else if (a === 'simulate_overdue') {
    window.coffeeEnsureV19Schema(db);
    const blk = payload.block || 'Лайн Чек 1';
    const today = _isoToday();
    const now = new Date();
    const pastMin = new Date(now.getTime() - 10 * 60000);
    const pastHm = String(pastMin.getHours()).padStart(2, '0') + ':' + String(pastMin.getMinutes()).padStart(2, '0');
    const bObj = (db.checklistBlocks || []).find((b) => b.name === blk);
    if (bObj) {
      bObj.openTime = '06:00';
      bObj.deadline = pastHm;
    }
    db.checklists = (db.checklists || []).filter((c) => !(c.date === today && c.block === blk));
    try { localStorage.removeItem('coffee_illy_done_' + today + '_' + blk); } catch (_) {}
    if (db.deadlineExtensions) delete db.deadlineExtensions[today + ':' + blk];
    if (db.overdueIncidentsCreated) delete db.overdueIncidentsCreated[today + ':' + blk];
  } else if (a === 'resolve_incident') {
    const normSt = 'Решена';
    db.resolvedIncidents[payload.id] = normSt;
    const inc = db.incidents.find((x) => x.id === payload.id);
    if (inc) {
      inc.status = normSt;
      const nowHm = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      inc.resolvedAt = _isoToday() + ' ' + nowHm;
      inc.history = inc.history || [];
      inc.history.push({ time: _isoToday().split('-').reverse().join('.') + ' ' + nowHm, actor: payload.actor || 'Администратор', status: normSt, note: payload.note || 'Отмечено как решённое' });
      appendAudit(db, payload.actor || 'Администратор', 'Статус инцидента → Решена', inc.id + ' (' + inc.step + ')');
    }
  } else if (a === 'update_incident') {
    const inc = db.incidents.find((x) => x.id === payload.id);
    if (inc) {
      const nowHm = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      if (payload.status) {
        const st = window.coffeeNormIncStatus(payload.status);
        inc.status = st;
        db.resolvedIncidents[payload.id] = st;
        if (st === 'Решена' || st === 'Закрыта') inc.resolvedAt = _isoToday() + ' ' + nowHm;
      }
      if (payload.incType != null) inc.incType = payload.incType;
      if (payload.comment != null) inc.text = payload.comment;
      if (payload.priority != null) inc.priority = payload.priority;
      if (payload.responsible != null) inc.owner = payload.responsible || '—';
      inc.history = inc.history || [];
      inc.history.push({
        time: _isoToday().split('-').reverse().join('.') + ' ' + nowHm,
        actor: payload.actor || 'Администратор',
        status: inc.status,
        note: payload.statusNote || ('Обновлена карточка (' + inc.status + ')')
      });
      appendAudit(db, payload.actor || 'Администратор', 'Обновление инцидента ' + inc.id, 'Статус: ' + inc.status);
    }
  } else if (a === 'report_standalone_incident') {
    const now = new Date();
    const tStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const photosArr = Array.isArray(payload.photos) && payload.photos.length ? payload.photos : (payload.photo ? [payload.photo] : []);
    const newInc = {
      id: 'INC-' + Math.floor(100 + Math.random() * 900),
      date: _isoToday(),
      time: tStr,
      location: db.location || 'Кофейня №1',
      block: payload.block || 'Вне чек-листа',
      incType: payload.incType || 'Поломка оборудования',
      step: payload.step || payload.incType || 'Внеплановый инцидент',
      text: payload.text || payload.comment || 'Замечание сотрудника',
      priority: payload.priority || 'Критично',
      status: 'Новая проблема',
      who: payload.userName || 'Бариста',
      owner: payload.responsible || 'Техник',
      photo: photosArr[0] || '',
      photos: photosArr,
      history: [
        { time: _isoToday().split('-').reverse().join('.') + ' ' + tStr, actor: payload.userName || 'Бариста', status: 'Новая проблема', note: 'Зарегистрирован инцидент (' + (payload.incType || 'Поломка оборудования') + ')' }
      ]
    };
    const dupStandalone = (db.incidents || []).some((x) => x && x.date === newInc.date && x.step === newInc.step && x.text === newInc.text && x.who === newInc.who);
    if (!dupStandalone) {
      db.incidents.unshift(newInc);
      appendAudit(db, newInc.who, 'Регистрация проблемы ' + newInc.id, newInc.step + ': ' + newInc.text);
      if (window.coffeeNotify) {
        window.coffeeNotify.push(db, {
          level: 'critical',
          type: 'incident',
          incId: newInc.id,
          actor: newInc.who,
          title: '🚨 Поломка: ' + newInc.step + ' (' + newInc.priority + ')',
          text: newInc.text + ' · Сообщил: ' + newInc.who + (newInc.photos && newInc.photos.length ? (' · Фото/видео: ' + newInc.photos.length) : ''),
          telegramText: '🚨 ЭКСТРЕННАЯ ПОЛОМКА (' + (db.location || 'Кофейня') + ')\n🔧 Участок: ' + newInc.step + '\n⚠️ Срочность: ' + newInc.priority + '\n👤 Сообщил: ' + newInc.who + '\n📝 Описание: ' + newInc.text
        });
      }
    }
  } else if (a === 'delete_incident') {
    db.deletedIncidents[payload.id] = true;
    db.incidents = db.incidents.filter((x) => x.id !== payload.id);
  } else if (a === 'submit_checklist') {
    const now = new Date();
    const tStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const blk = payload.block || 'Открытие';
    const winInfo = window.coffeeGetBlockWindow(blk, db);
    const isLate = !!winInfo.isOverdue;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const probs = items.filter((i) => i && i.isIncident);
    const phs = [];
    items.forEach((i) => {
      if (!i) return;
      const pList = Array.isArray(i.photos) && i.photos.length ? i.photos : ((i.photo_url || i.preview || i.photo_base64) ? [i.photo_url || i.preview || i.photo_base64] : []);
      pList.forEach((u, pIdx) => {
        phs.push({
          step: i.title + (pList.length > 1 ? ' (кадр ' + (pIdx + 1) + ')' : ''),
          url: u,
          isIncident: !!i.isIncident,
          comment: i.comment || '',
          completedAt: i.completedAt || tStr
        });
      });
    });
    const chkDate = _isoToday();
    const chkWho = payload.userName || 'Бариста';
    const chkRec = {
      sid: payload.sid || payload.operationId || '',
      date: chkDate,
      time: tStr,
      startedAt: payload.startedAt || tStr,
      deadline: winInfo.deadline,
      isLate,
      status: isLate ? 'Просрочено' : 'Выполнено',
      totalSteps: items.length || (blk === 'Открытие' ? 8 : blk === 'День' ? 6 : 14),
      block: blk,
      who: chkWho,
      problems: probs.length,
      photos: phs
    };
    const exChkIdx = db.checklists.findIndex((c) => c && ((chkRec.sid && c.sid === chkRec.sid) || (c.date === chkDate && c.block === blk && c.who === chkWho)));
    if (exChkIdx >= 0) db.checklists[exChkIdx] = chkRec;
    else db.checklists.push(chkRec);
    appendAudit(
      db,
      payload.userName || 'Бариста',
      'Сдан чек-лист «' + blk + '»',
      (isLate ? '⚠️ ПРОСРОЧЕНО (сдан в ' + tStr + ', дедлайн ' + winInfo.deadline + ')' : '✓ В срок (' + tStr + ', до ' + winInfo.deadline + ')') + ' · Шагов: ' + items.length + ' · Проблем: ' + probs.length
    );
    if (window.coffeeNotify) {
      window.coffeeNotify.push(db, {
        level: probs.length > 0 ? 'warn' : (isLate ? 'warn' : 'ok'),
        type: 'checklist',
        block: blk,
        actor: chkWho,
        title: (probs.length > 0 ? '⚠️ ' : '✅ ') + 'Чек-лист «' + blk + '» сдан (' + chkWho + ')',
        text: (isLate ? 'С опозданием в ' + tStr : 'Вовремя в ' + tStr) + ' · Проверено пунктов: ' + items.length + (probs.length ? (' · Замечаний: ' + probs.length) : ' · Всё в норме'),
        telegramText: (probs.length > 0 ? '⚠️ ЧЕК-ЛИСТ С ЗАМЕЧАНИЯМИ: ' : '✅ ЧЕК-ЛИСТ ВЫПОЛНЕН: ') + blk + '\n👤 Бариста: ' + chkWho + '\n🕒 Время: ' + tStr + '\n📋 Пунктов: ' + items.length + (probs.length ? ('\n🚨 Проблем: ' + probs.length) : '')
      });
    }
    probs.forEach((p) => {
      const pPhotos = Array.isArray(p.photos) && p.photos.length ? p.photos : ((p.photo_url || p.preview || p.photo_base64) ? [p.photo_url || p.preview || p.photo_base64] : []);
      const newInc = {
        id: 'INC-' + Math.floor(100 + Math.random() * 900),
        date: _isoToday(),
        time: tStr,
        location: db.location || 'Кофейня №1',
        block: blk,
        incType: p.incType || 'Поломка оборудования',
        step: p.title || 'Шаг чек-листа',
        text: p.comment || 'Замечание сотрудника',
        priority: p.priority || 'Терпит',
        status: 'Новая проблема',
        who: payload.userName || 'Бариста',
        owner: p.responsible || 'Техник',
        photo: pPhotos[0] || '',
        photos: pPhotos,
        history: [
          { time: _isoToday().split('-').reverse().join('.') + ' ' + tStr, actor: payload.userName || 'Бариста', status: 'Новая проблема', note: 'Отмечена проблема при прохождении чек-листа «' + blk + '»' }
        ]
      };
      const dupProb = (db.incidents || []).some((x) => x && x.date === newInc.date && x.block === newInc.block && x.step === newInc.step && x.text === newInc.text);
      if (!dupProb) db.incidents.unshift(newInc);
    });
  }
  saveUDB(db);
}

function buildAdminResponse() {
  const db = getUDB();
  window.coffeeEnsureV19Schema(db);
  return {
    checklistBlocks: db.checklistBlocks,
    dailyPlans: db.dailyPlans,
    ok: true,
    today: _isoToday(),
    location: db.location,
    blocks: db.blocks,
    categories: db.categories,
    tasks: db.tasks,
    cash: db.cash,
    expenses: db.expenses,
    incidents: db.incidents,
    settings: db.settings,
    announcements: db.announcements || [],
    staff: db.staff || [],
    auditLog: db.auditLog || [],
    serviceAudits: db.serviceAudits || [],
    ttk: db.ttk || window.COFFEE_DEFAULT_TTK || [],
    goodDeeds: db.goodDeeds || window.COFFEE_DEFAULT_GOOD_DEEDS || [],
    serviceAudits: db.serviceAudits || [],
    shiftRoster: db.shiftRoster || window.COFFEE_DEFAULT_ROSTER || {},
    cashHistory: db.cashHistory || [],
    minAvgCheck: db.minAvgCheck || 35,
    planChecks: db.planChecks || 150,
    deadlineExtensions: db.deadlineExtensions || {}
  };
}

function buildDashboardResponse(dateStr) {
  const db = getUDB();
  window.coffeeEnsureV19Schema(db);
  const day = dateStr || _isoToday();
  const dayPlanObj = window.coffeeGetDayPlan(day, db);
  const c = db.cash.find((x) => x.date === day);
  const hasData = !!c && ((Number(c.cash) || 0) + (Number(c.card) || 0) > 0 || (Number(c.checks) || 0) > 0);
  const rev = c ? (Number(c.cash) || 0) + (Number(c.card) || 0) : 0;
  const checks = c ? (Number(c.checks) || 0) : 0;
  const days14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = _shiftIso(day, -i);
    const cr = db.cash.find((x) => x.date === d);
    const ex = (db.expenses || []).filter((e) => e.date === d).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const wo = cr ? (Number(cr.writeoff) || 0) : 0;
    days14.push({
      date: d,
      revenue: cr ? (Number(cr.cash) || 0) + (Number(cr.card) || 0) : 0,
      writeoff: wo,
      expenses: ex,
      outflow: wo + ex,
      barista: cr ? (cr.barista || '') : ''
    });
  }
  const dayChks = (db.checklists || []).filter((x) => x.date === day);
  const opens = dayChks.filter((x) => x.block === 'Открытие').sort((a, b) => a.time.localeCompare(b.time));
  return {
    ok: true,
    date: day,
    isToday: day === _isoToday(),
    location: db.location,
    plan: dayPlanObj.revenue,
    dayCode: dayPlanObj.dayCode,
    dailyPlans: db.dailyPlans,
    checklistBlocks: db.checklistBlocks,
    woNorm: db.woNorm,
    minAvgCheck: dayPlanObj.avgCheck,
    planChecks: dayPlanObj.checks,
    deadline: db.deadline,
    hasData,
    revenue: rev,
    cash: c ? (Number(c.cash) || 0) : 0,
    card: c ? (Number(c.card) || 0) : 0,
    checks,
    avg: checks > 0 ? Math.round(rev / checks) : 0,
    writeoff: c ? (Number(c.writeoff) || 0) : 0,
    barista: c ? (c.barista || '') : '',
    shifts: c ? (c.shifts || []) : [],
    openedAt: opens.length ? opens[0].time : '',
    days: days14,
    incidents: db.incidents,
    photoReports: dayChks.filter((x) => x.photos && x.photos.length > 0)
  };
}

function buildReportResponse(fromStr, toStr) {
  const db = getUDB();
  const t = _isoToday();
  const from = (fromStr && toStr && fromStr <= toStr) ? fromStr : _shiftIso(t, -6);
  const to = (fromStr && toStr && fromStr <= toStr) ? toStr : t;
  const series = [];
  const staffStats = {};
  let cur = from;
  while (cur <= to) {
    const c = db.cash.find((x) => x.date === cur);
    const cash = c ? Number(c.cash) || 0 : 0;
    const card = c ? Number(c.card) || 0 : 0;
    const revenue = cash + card;
    const checks = c ? Number(c.checks) || 0 : 0;
    const writeoff = c ? Number(c.writeoff) || 0 : 0;
    const dayExps = (db.expenses || []).filter((e) => e.date === cur);
    const expenses = dayExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    series.push({
      date: cur, revenue, expenses, profit: revenue - expenses,
      checks, avg: checks > 0 ? Math.round(revenue / checks) : 0, cash, card, writeoff,
      barista: c ? (c.barista || '') : '',
      shifts: c ? (c.shifts || []) : []
    });
    if (c) {
      const shList = Array.isArray(c.shifts) && c.shifts.length
        ? c.shifts
        : [{ name: c.barista || 'Бариста', cash, card, checks, writeoff, cups: checks }];
      shList.forEach((sh) => {
        const nm = sh.name || 'Бариста';
        const st = staffStats[nm] || (staffStats[nm] = { name: nm, shifts: 0, cash: 0, card: 0, revenue: 0, checks: 0, cups: 0, writeoff: 0 });
        st.shifts += 1;
        st.cash += Number(sh.cash) || 0;
        st.card += Number(sh.card) || 0;
        st.revenue += (Number(sh.cash) || 0) + (Number(sh.card) || 0);
        st.checks += Number(sh.checks || sh.cupsSold || sh.cups) || 0;
        st.cups += Number(sh.cups || sh.cupsTotal || sh.checks) || 0;
        st.writeoff += Number(sh.writeoff != null ? sh.writeoff : sh.writeoffQty) || 0;
      });
    }
    cur = _shiftIso(cur, 1);
  }
  const daysCount = series.length;
  const prevTo = _shiftIso(from, -1);
  const prevFrom = _shiftIso(prevTo, -(daysCount - 1));
  let prevRev = 0, prevExp = 0, pCur = prevFrom;
  while (pCur <= prevTo) {
    const c = db.cash.find((x) => x.date === pCur);
    if (c) prevRev += (Number(c.cash) || 0) + (Number(c.card) || 0);
    prevExp += (db.expenses || []).filter((e) => e.date === pCur).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    pCur = _shiftIso(pCur, 1);
  }
  const revTotal = series.reduce((s, x) => s + x.revenue, 0);
  const expTotal = series.reduce((s, x) => s + x.expenses, 0);
  const proTotal = revTotal - expTotal;
  const chkTotal = series.reduce((s, x) => s + x.checks, 0);
  const cashTotal = series.reduce((s, x) => s + x.cash, 0);
  const cardTotal = series.reduce((s, x) => s + x.card, 0);
  const woTotal = series.reduce((s, x) => s + x.writeoff, 0);
  const actDays = series.filter((x) => x.revenue > 0).length;
  const listForPlan = actDays > 0 ? series.filter((x) => x.revenue > 0) : series;
  const periodPlan = listForPlan.reduce((sum, x) => sum + (window.coffeeGetDayPlan ? window.coffeeGetDayPlan(x.date, db).revenue : (Number(db.plan) || 2200)), 0);
  const finModel = window.coffeeCalculateFinancialModel ? window.coffeeCalculateFinancialModel(db, from, to) : null;

  const expList = (db.expenses || []).filter((e) => e.date >= from && e.date <= to);
  const catMap = {};
  expList.forEach((e) => { catMap[e.category] = (catMap[e.category] || 0) + (Number(e.amount) || 0); });
  const byCategory = Object.keys(catMap).map((k) => ({ category: k, sum: catMap[k] })).sort((a, b) => b.sum - a.sum);

  const prodMap = {};
  Object.keys(db.productsByDate || {}).forEach((d) => {
    if (d >= from && d <= to) {
      (db.productsByDate[d] || []).forEach((p) => {
        const m = prodMap[p.name] || (prodMap[p.name] = { name: p.name, qty: 0, sum: 0 });
        m.qty += Number(p.qty) || 0;
        m.sum += Number(p.sum) || 0;
      });
    }
  });
  const products = Object.values(prodMap).sort((a, b) => b.qty - a.qty);

  let openings = 0, late = 0, missed = 0, checklistsCount = 0, problemSteps = 0;
  const tasksSeries = series.map((dayObj) => {
    const d = dayObj.date;
    const dc = (db.checklists || []).filter((c) => c.date === d);
    const open = dc.filter((c) => c.block === 'Открытие');
    const dayB = dc.filter((c) => c.block === 'День' || c.block === 'Лайн Чек 1' || c.block === 'Лайн Чек 2' || (!/^(Открытие|Закрытие|Касса)$/i.test(c.block)));
    const close = dc.filter((c) => c.block === 'Закрытие');
    checklistsCount += dc.length;
    dc.forEach((c) => { problemSteps += Number(c.problems) || 0; });
    if (open.length) {
      openings++;
      const earliest = open.slice().sort((a, b) => a.time.localeCompare(b.time))[0].time;
      if (earliest > db.deadline) late++;
    } else if (dayObj.revenue > 0) {
      missed++;
    }
    return { date: d, open, day: dayB, close };
  });

  const allOpenIncs = (db.incidents || []).filter((i) => i.status === 'Open' || i.status === 'Открыта');
  return {
    ok: true,
    from, to, days: daysCount,
    categories: db.categories,
    plan: periodPlan,
    pct: periodPlan > 0 ? Math.round(revTotal / periodPlan * 100) : 0,
    delta: prevRev > 0 ? Math.round((revTotal - prevRev) / prevRev * 100) : null,
    finModel,
    finance: {
      revenue: revTotal, expenses: expTotal, profit: finModel ? finModel.netProfit : proTotal, grossProfit: finModel ? finModel.grossProfit : proTotal, cogs: finModel ? finModel.cogs : 0, payroll: finModel ? finModel.effectivePayroll : 0, prevProfit: prevRev - prevExp,
      margin: revTotal > 0 ? Math.round(proTotal / revTotal * 100) : 0,
      writeoff: woTotal, byCategory, list: expList
    },
    totals: { days: actDays, revenue: revTotal, checks: chkTotal, avg: chkTotal > 0 ? Math.round(revTotal / chkTotal) : 0, cash: cashTotal, card: cardTotal, writeoff: woTotal },
    series,
    products,
    staffSummary: Object.values(staffStats).sort((a, b) => b.revenue - a.revenue),
    tasks: tasksSeries,
    incidentList: db.incidents || [],
    discipline: { openings, late, missed, checklists: checklistsCount, problemSteps },
    incidents: {
      total: (db.incidents || []).length,
      open: allOpenIncs.length,
      resolved: (db.incidents || []).length - allOpenIncs.length,
      critical: allOpenIncs.filter((i) => i.priority === 'Критично').length
    }
  };
}
/* Строгая проверка прав доступа владельца для чтения отчётов и изменения настроек/задач */
function isPinAuthorized(pinArg) {
  if (window.coffeeAuth) {
    if (window.coffeeAuth.isAuthorized('admin')) return true;
    if (pinArg && window.coffeeAuth.verifyOwnerPin(pinArg)) {
      window.coffeeAuth.createLocalSession('admin', 'Владелец', pinArg);
      return true;
    }
    return window.coffeeAuth.isAuthorized('admin');
  }
  return false;
}
const OWNER_MUTATION_ACTIONS = /^(save_task|delete_task|reorder_task|admin_cash|delete_cash|add_expense|update_expense|delete_expense|resolve_incident|update_incident|delete_incident|save_setting|save_all_settings|extend_deadline|save_block_windows|simulate_overdue|save_announcement|delete_announcement|save_staff|delete_staff|save_service_audit|delete_service_audit|save_ttk|delete_ttk|save_shift_roster|save_checklist_blocks|add_checklist_block|delete_checklist_block|save_daily_plans|save_staff_pins|save_good_deed|delete_good_deed|sync_all_to_sheet)$/;

/* Мгновенные синхронные селекторы (0 мс ожидания сети) для мгновенной отрисовки интерфейса */
window.coffeeCheckPin = isPinAuthorized;
window.coffeeGetInstantAdmin = function () {
  return enforceSettingsOnResponse('admin', buildAdminResponse());
};
window.coffeeGetInstantDashboard = function (dateStr) {
  return enforceSettingsOnResponse('dashboard', buildDashboardResponse(dateStr));
};
window.coffeeGetInstantReport = function (fromStr, toStr) {
  return enforceSettingsOnResponse('report', buildReportResponse(fromStr, toStr));
};

let _lastBgSyncAt = 0;
let _bgSyncInFlight = false;

function _stripLargeBase64FromMediaList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 6).map((u) => {
    const s = String(u || '');
    return s.length > 1800 ? '' : s;
  }).filter(Boolean);
}

function _buildCloudSyncEnvelope(db) {
  db = db || getUDB();
  return {
    _v: 19,
    ts: Date.now(),
    location: db.location || 'Кофейня №1',
    plan: Number(db.plan) || 2200,
    settings: Array.isArray(db.settings) ? db.settings.filter((s) => s && !s.secret) : [],
    deletedTaskIds: db.deletedTaskIds || {},
    deletedIncidents: db.deletedIncidents || {},
    resolvedIncidents: db.resolvedIncidents || {},
    openStart: db.openStart || '07:30',
    deadline: db.deadline || '08:30',
    dayStart: db.dayStart || '08:30',
    dayDeadline: db.dayDeadline || '09:30',
    closeStart: db.closeStart || '21:30',
    closeDeadline: db.closeDeadline || '22:30',
    checklistBlocks: Array.isArray(db.checklistBlocks) ? db.checklistBlocks : [],
    dailyPlans: db.dailyPlans || {},
    shiftRoster: db.shiftRoster || {},
    deadlineExtensions: db.deadlineExtensions || {},
    goodDeeds: Array.isArray(db.goodDeeds) ? db.goodDeeds : [],
    ttk: Array.isArray(db.ttk) ? db.ttk : [],
    staff: Array.isArray(db.staff) ? db.staff : [],
    announcements: Array.isArray(db.announcements) ? db.announcements.slice(0, 40) : [],
    serviceAudits: Array.isArray(db.serviceAudits) ? db.serviceAudits.slice(0, 40) : [],
    auditLog: Array.isArray(db.auditLog) ? db.auditLog.slice(0, 40) : [],
    liveNotifications: Array.isArray(db.liveNotifications) ? db.liveNotifications.slice(0, 25) : [],
    cash: Array.isArray(db.cash) ? db.cash.slice(0, 30) : [],
    expenses: Array.isArray(db.expenses) ? db.expenses.slice(0, 40) : [],
    checklists: Array.isArray(db.checklists) ? db.checklists.slice(-25).map((c) => ({
      sid: c.sid || '',
      date: c.date || '',
      time: c.time || '',
      startedAt: c.startedAt || '',
      deadline: c.deadline || '',
      isLate: !!c.isLate,
      status: c.status || 'Выполнено',
      totalSteps: Number(c.totalSteps) || 0,
      block: c.block || '',
      who: c.who || 'Бариста',
      problems: Number(c.problems) || 0,
      photos: Array.isArray(c.photos) ? c.photos.slice(0, 10).map((p) => ({
        step: p.step || '',
        url: (p.url && String(p.url).length <= 1800) ? p.url : '',
        isIncident: !!p.isIncident,
        comment: p.comment || '',
        completedAt: p.completedAt || ''
      })) : []
    })) : [],
    incidents: Array.isArray(db.incidents) ? db.incidents.slice(0, 50).map((inc) => ({
      id: inc.id,
      date: inc.date,
      time: inc.time,
      location: inc.location || db.location || 'Кофейня №1',
      block: inc.block || 'Вне чек-листа',
      incType: inc.incType || 'Поломка оборудования',
      step: inc.step || inc.task || 'Проблема',
      text: inc.text || inc.comment || '',
      priority: inc.priority || 'Критично',
      status: inc.status || 'Новая проблема',
      who: inc.who || inc.barista || 'Бариста',
      owner: inc.owner || inc.responsible || 'Техник',
      photo: (inc.photo && String(inc.photo).length <= 1800) ? inc.photo : '',
      photos: _stripLargeBase64FromMediaList(inc.photos),
      resolvedAt: inc.resolvedAt || '',
      history: Array.isArray(inc.history) ? inc.history.slice(-5) : []
    })) : []
  };
}

function _rawPostJson(url, payloadObj, timeoutMs) {
  const timeout = Math.max(3000, Number(timeoutMs) || 12000);
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (ac) timer = setTimeout(() => ac.abort(), timeout);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payloadObj || {}),
    signal: ac ? ac.signal : undefined
  }).then(async (response) => {
    if (timer) clearTimeout(timer);
    let data;
    try { data = await response.json(); }
    catch (_) { return { ok: false, networkError: true, error: 'INVALID_SERVER_RESPONSE', httpStatus: response.status }; }
    if (!response.ok) return Object.assign({}, data || {}, { ok: false, httpStatus: response.status });
    if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
      return { ok: false, networkError: true, error: 'INVALID_SERVER_RESPONSE', httpStatus: response.status };
    }
    return data;
  }).catch((error) => {
    if (timer) clearTimeout(timer);
    return { ok: false, networkError: true, error: error && error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' };
  });
}

const BRIDGEABLE_V19_ACTIONS = /^(save_checklist_blocks|add_checklist_block|delete_checklist_block|update_incident|delete_incident|report_standalone_incident|save_daily_plans|save_good_deed|delete_good_deed|save_ttk|delete_ttk|save_staff|delete_staff|save_staff_pins|save_announcement|delete_announcement|ack_announcement|save_shift_roster|extend_deadline|save_service_audit|delete_service_audit|sync_all_to_sheet)$/;

/* Автоматический мост совместимости со старым развёртыванием Code.gs:
   если сервер отвечает "Error: unknown action" на новые действия (save_checklist_blocks, update_incident, delete_incident и др.),
   мост мгновенно сохраняет данные через базовые действия старого Code.gs (resolve_incident, save_setting, save_task __SYS_CONFIG_V19__),
   чтобы изменения передавались моментально и очередь никогда не зависала. */
async function _bridgeLegacyServerAction(url, bodyObj) {
  if (!bodyObj || !BRIDGEABLE_V19_ACTIONS.test(String(bodyObj.action || ''))) {
    return null;
  }
  try { applyLocalMutation(bodyObj); } catch (_) {}
  const db = getUDB();
  db.lastLocalMutationAt = Date.now();
  saveUDB(db);
  const act = String(bodyObj.action || '');
  const pin = (bodyObj.pin && !/^sha256:/i.test(String(bodyObj.pin))) ? String(bodyObj.pin) : '1234';
  const calls = [];

  if ((act === 'update_incident' && (bodyObj.status === 'Решена' || bodyObj.status === 'Закрыта')) || act === 'delete_incident') {
    if (bodyObj.id) {
      calls.push(_rawPostJson(url, { action: 'resolve_incident', id: bodyObj.id, pin }, 10000));
    }
  } else if (act === 'save_checklist_blocks' || act === 'add_checklist_block' || act === 'delete_checklist_block') {
    const blocks = Array.isArray(db.checklistBlocks) ? db.checklistBlocks : [];
    const openB = blocks.find((b) => b && b.name === 'Открытие') || blocks[0];
    const lc1B = blocks.find((b) => b && b.name === 'Лайн Чек 1') || blocks[1];
    const lc2B = blocks.find((b) => b && b.name === 'Лайн Чек 2') || blocks[2];
    const closeB = blocks.find((b) => b && b.name === 'Закрытие') || blocks[3];
    const cashB = blocks.find((b) => b && (b.isCash || b.name === 'Касса')) || blocks[4];
    const kv = [{ key: 'CHECKLIST_BLOCKS_JSON', value: JSON.stringify(blocks) }];
    if (openB) {
      if (openB.openTime || openB.start) kv.push({ key: 'OPEN_START', value: openB.openTime || openB.start });
      if (openB.deadline) kv.push({ key: 'DEADLINE', value: openB.deadline });
    }
    if (lc1B) {
      if (lc1B.openTime || lc1B.start) {
        kv.push({ key: 'LC1_START', value: lc1B.openTime || lc1B.start });
        kv.push({ key: 'DAY_START', value: lc1B.openTime || lc1B.start });
      }
      if (lc1B.deadline) {
        kv.push({ key: 'LC1_DEADLINE', value: lc1B.deadline });
        kv.push({ key: 'DAY_DEADLINE', value: lc1B.deadline });
      }
    }
    if (lc2B) {
      if (lc2B.openTime || lc2B.start) kv.push({ key: 'LC2_START', value: lc2B.openTime || lc2B.start });
      if (lc2B.deadline) kv.push({ key: 'LC2_DEADLINE', value: lc2B.deadline });
    }
    if (closeB) {
      if (closeB.openTime || closeB.start) kv.push({ key: 'CLOSE_START', value: closeB.openTime || closeB.start });
      if (closeB.deadline) kv.push({ key: 'CLOSE_DEADLINE', value: closeB.deadline });
    }
    if (cashB) {
      if (cashB.openTime || cashB.start) kv.push({ key: 'CASH_START', value: cashB.openTime || cashB.start });
      if (cashB.deadline) kv.push({ key: 'CASH_DEADLINE', value: cashB.deadline });
    }
    kv.forEach((item) => {
      calls.push(_rawPostJson(url, { action: 'save_setting', id: item.key, key: item.key, value: item.value, pin }, 10000));
    });
  } else if (act === 'save_daily_plans') {
    const dp = db.dailyPlans || {};
    calls.push(_rawPostJson(url, { action: 'save_setting', id: 'DAILY_PLANS_JSON', key: 'DAILY_PLANS_JSON', value: JSON.stringify(dp), pin }, 10000));
  } else if (act === 'extend_deadline') {
    const extMap = db.deadlineExtensions || {};
    calls.push(_rawPostJson(url, { action: 'save_setting', id: 'DEADLINE_EXTENSIONS_JSON', key: 'DEADLINE_EXTENSIONS_JSON', value: JSON.stringify(extMap), pin }, 10000));
  }

  // Всегда сохраняем актуальный конверт состояния __SYS_CONFIG_V19__ в лист Задачи через поддерживаемый старым сервером save_task
  const envStr = JSON.stringify(_buildCloudSyncEnvelope(db));
  calls.push(_rawPostJson(url, {
    action: 'save_task',
    id: '__SYS_CONFIG_V19__',
    block: 'Открытие',
    title: '__SYS_SYNC__',
    instruction: envStr,
    photo: 'нет',
    responsible: 'Система',
    active: 'нет',
    pin
  }, 12000));

  const results = await Promise.all(calls);
  const anyOk = results.some((r) => r && r.ok === true);
  if (anyOk) {
    window._coffeeLegacyBridgeActive = true;
    return { ok: true, bridged: true, saved: true, rev: Date.now() };
  }
  return null;
}


let _bgEnvPushTimer = null;
function _pushCloudEnvelopeInBackground(apiUrl) {
  if (!apiUrl || !/script\.google\.com/i.test(String(apiUrl))) return;
  if (_bgEnvPushTimer) clearTimeout(_bgEnvPushTimer);
  _bgEnvPushTimer = setTimeout(() => {
    try {
      const db = getUDB();
      const envStr = JSON.stringify(_buildCloudSyncEnvelope(db));
      _rawPostJson(apiUrl, {
        action: 'save_task',
        id: '__SYS_CONFIG_V19__',
        block: 'Открытие',
        title: '__SYS_SYNC__',
        instruction: envStr,
        photo: 'нет',
        responsible: 'Система',
        active: 'нет',
        pin: '1234'
      }, 12000).catch(() => {});
    } catch (_) {}
  }, 80);
}

/* Единый транспорт GAS. Успех возвращается только после JSON-подтверждения сервера. */
function _sendCorsSafePost(url, bodyObj, timeoutMs) {
  const timeout = Math.max(3000, Number(timeoutMs) || 15000);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve({ ok: false, networkError: true, error: 'OFFLINE' });
  }
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, networkError: true, error: 'FETCH_UNAVAILABLE' });
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (ac) timer = setTimeout(() => ac.abort(), timeout);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(bodyObj || {}),
    signal: ac ? ac.signal : undefined
  }).then(async (response) => {
    if (timer) clearTimeout(timer);
    let data;
    try { data = await response.json(); }
    catch (_) { return { ok: false, networkError: true, error: 'INVALID_SERVER_RESPONSE', httpStatus: response.status }; }
    if (!response.ok) return Object.assign({}, data || {}, { ok: false, httpStatus: response.status });
    if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
      return { ok: false, networkError: true, error: 'INVALID_SERVER_RESPONSE', httpStatus: response.status };
    }
    if (data.ok === false && /PIN_INVALID/i.test(String(data.error || '')) && bodyObj && (bodyObj.pinHash || bodyObj.staffPinHash)) {
      const cleanBody = Object.assign({}, bodyObj);
      delete cleanBody.pinHash;
      delete cleanBody.staffPinHash;
      const retryNoHash = await _rawPostJson(url, cleanBody, timeout);
      if (retryNoHash && retryNoHash.ok === true) return retryNoHash;
    }
    if (data.ok === false && /UNKNOWN[ _]ACTION|unknown action|Неизвестное действие/i.test(String(data.error || ''))) {
      const bridged = await _bridgeLegacyServerAction(url, bodyObj);
      if (bridged && bridged.ok === true) return bridged;
    }
    return data;
  }).catch((error) => {
    if (timer) clearTimeout(timer);
    return { ok: false, networkError: true, error: error && error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' };
  });
}

/* === САМОВОССТАНОВЛЕНИЕ СЕССИИ ===
   Серверная сессия живёт в CacheService (до 6 ч и может сброситься раньше). Раньше при этом очередь зависала навсегда.
   Теперь при PIN_REQUIRED/FORBIDDEN клиент молча перелогинивается сохранённым хешем PIN и тут же повторяет запрос.
   Защита от блокировки: после неудачного входа повторные попытки не чаще раза в 10 минут (сервер банит после 5 ошибок). */
const SERVER_TOK_AT_KEY = 'coffee_server_tok_at';
let _reauthP = null, _reauthFailAt = 0;
const AUTH_ERR_RE = /PIN_REQUIRED|FORBIDDEN/i;
function _hasServerToken() {
  const t = window.coffeeAuth && window.coffeeAuth.getSessionToken ? window.coffeeAuth.getSessionToken() : '';
  return /^st_/.test(t) && !/^st_local_/.test(t);
}
function _serverTokenStale() {
  if (!_hasServerToken()) return true;
  try { const at = Number(localStorage.getItem(SERVER_TOK_AT_KEY) || 0); return !!at && Date.now() - at > 5 * 3600 * 1000; } catch (_) { return false; }
}
function _reauthServerSession() {
  if (_reauthP) return _reauthP;
  if (Date.now() - _reauthFailAt < 10 * 60 * 1000) return Promise.resolve(false);
  _reauthP = (async () => {
    try {
      const sess = window.coffeeAuth && window.coffeeAuth.getSession ? window.coffeeAuth.getSession() : null;
      const base = window.COFFEE && window.COFFEE.API_URL;
      if (!sess || !sess.pinHash || !base) return false;
      const r = await _sendCorsSafePost(base, { action: 'auth_login', role: sess.role, staffName: sess.staffName, pinHash: sess.pinHash }, 12000);
      if (r && r.ok && r.sessionToken) {
        window.coffeeAuth.createLocalSession(sess.role, sess.staffName, sess.pinHash, r.sessionToken);
        try { localStorage.setItem(SERVER_TOK_AT_KEY, String(Date.now())); } catch (_) {}
        return true;
      }
      if (r && !r.networkError) _reauthFailAt = Date.now();
      return false;
    } catch (_) { return false; }
  })().finally(() => { _reauthP = null; });
  return _reauthP;
}
window.coffeeReauthServer = _reauthServerSession;

const COFFEE_OUTBOX_KEY = 'coffee_api_outbox_v1';
let _outboxFlushPromise = null;
function _readCoffeeOutbox() {
  try { const q = JSON.parse(localStorage.getItem(COFFEE_OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; }
  catch (_) { return []; }
}
function _writeCoffeeOutbox(q) {
  try { localStorage.setItem(COFFEE_OUTBOX_KEY, JSON.stringify(q)); } catch (_) {}
}
function _newCoffeeOperationId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  return 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}
function _enqueueCoffeeOperation(url, payload) {
  const q = _readCoffeeOutbox();
  if (!q.some((x) => x.operationId === payload.operationId)) {
    if (q.length >= 250) return { queued: false, pending: q.length };
    q.push({ operationId: payload.operationId, url, payload, createdAt: Date.now(), attempts: 0 });
    _writeCoffeeOutbox(q);
  }
  return { queued: true, pending: q.length };
}
const COFFEE_OUTBOX_FAILED_KEY = 'coffee_api_outbox_failed_v1';
const COFFEE_OUTBOX_MAX_ATTEMPTS = 30;
/* Постоянные ошибки: повтор бессмысленен (данные невалидны). Всё остальное (сеть, сессия, старая версия сервера, 5xx, блокировка) — временное и повторяется. */
function _isPermanentApiError(err) { return /VALIDATION_FAILED|INVALID_REQUEST_JSON/i.test(String(err || '')); }
function _readFailedOutbox() { try { const q = JSON.parse(localStorage.getItem(COFFEE_OUTBOX_FAILED_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch (_) { return []; } }
function _moveToFailedOutbox(item) {
  const f = _readFailedOutbox(); f.push(Object.assign({}, item, { deadAt: Date.now() }));
  try { localStorage.setItem(COFFEE_OUTBOX_FAILED_KEY, JSON.stringify(f.slice(-100))); } catch (_) {}
}
function _deduplicateCoffeeOutbox(queue) {
  if (!Array.isArray(queue) || queue.length <= 1) return Array.isArray(queue) ? queue : [];
  const res = [];
  const keyToIdx = {};
  for (let i = 0; i < queue.length; i++) {
    const it = queue[i];
    if (!it || !it.payload) continue;
    const act = String(it.payload.action || '');
    let k = '';
    if (act === 'save_checklist_blocks' || act === 'save_daily_plans' || act === 'save_staff_pins' || act === 'save_shift_roster') {
      k = act;
    } else if ((act === 'update_incident' || act === 'delete_incident' || act === 'resolve_incident' || act === 'save_task' || act === 'delete_task') && it.payload.id != null) {
      k = act + ':' + String(it.payload.id);
    }
    if (k) {
      if (keyToIdx[k] != null) {
        res[keyToIdx[k]] = it;
        continue;
      }
      keyToIdx[k] = res.length;
    }
    res.push(it);
  }
  return res;
}

async function coffeeFlushOutbox(force) {
  if (_outboxFlushPromise) return _outboxFlushPromise;
  _outboxFlushPromise = (async () => {
    let sent = 0;
    let rawQueue = _readCoffeeOutbox();
    let queue = _deduplicateCoffeeOutbox(rawQueue);
    if (queue.length !== rawQueue.length) _writeCoffeeOutbox(queue);
    while (queue.length) {
      // Находим первый элемент, готовый к отправке (не блокируем очередь из-за отложенного первого элемента!)
      const idx = queue.findIndex((x) => x && (force || !x.nextRetryAt || Date.now() >= x.nextRetryAt));
      if (idx < 0) break;
      const item = queue[idx];
      try {
        const tok = window.coffeeAuth && window.coffeeAuth.getSessionToken ? window.coffeeAuth.getSessionToken() : '';
        if (tok) item.payload.sessionToken = tok;
      } catch (_) {}
      try {
        const sess0 = window.coffeeAuth && window.coffeeAuth.getSession ? window.coffeeAuth.getSession() : null;
        if (sess0 && sess0.pinHash) item.payload.pinHash = sess0.pinHash;
        if (_serverTokenStale() && await _reauthServerSession()) item.payload.sessionToken = window.coffeeAuth.getSessionToken();
      } catch (_) {}
      let result = await _sendCorsSafePost(item.url, item.payload, 25000);
      if (!result.ok && !result.networkError && AUTH_ERR_RE.test(String(result.error || '')) && await _reauthServerSession()) {
        item.payload.sessionToken = window.coffeeAuth.getSessionToken();
        result = await _sendCorsSafePost(item.url, item.payload, 25000);
      }
      if (result.networkError) {
        window._coffeeLastSyncOk = false;
        item.lastError = 'NET:' + String(result.error || 'NETWORK_ERROR') + (result.httpStatus ? ' HTTP ' + result.httpStatus : '');
        item.netFails = (Number(item.netFails) || 0) + 1;
        _writeCoffeeOutbox(queue);
        break;
      }
      window._coffeeLastSyncOk = true;
      if (result.ok !== true) {
        item.lastError = String(result.error || 'SERVER_REJECTED');
        item.attempts = (Number(item.attempts) || 0) + 1;
        item.failedAt = Date.now();
        // Если действие из новых (v19+) и сервер вернул unknown action — фиксируем локально и очищаем из очереди, чтобы она никогда не зависала
        if (/UNKNOWN[ _]ACTION|unknown action|Неизвестное действие/i.test(item.lastError) && BRIDGEABLE_V19_ACTIONS.test(String(item.payload && item.payload.action || ''))) {
          try { applyLocalMutation(item.payload); } catch (_) {}
          queue.splice(idx, 1);
          _writeCoffeeOutbox(queue);
          sent++;
          continue;
        }
        if (_isPermanentApiError(item.lastError) || item.attempts >= COFFEE_OUTBOX_MAX_ATTEMPTS) {
          _moveToFailedOutbox(item);
          queue.splice(idx, 1);
          _writeCoffeeOutbox(queue);
          if (window.coffeeBus) window.coffeeBus.emit('outbox_error', { operationId: item.operationId, error: item.lastError, dead: true });
          continue;
        }
        if (/UNKNOWN[ _]ACTION|unknown action/i.test(item.lastError)) {
          item.parked = true;
          item.nextRetryAt = Date.now() + 60000;
          _writeCoffeeOutbox(queue);
          if (window.coffeeBus) window.coffeeBus.emit('outbox_error', { operationId: item.operationId, error: item.lastError });
          continue;
        }
        item.nextRetryAt = Date.now() + (/PIN_REQUIRED|FORBIDDEN/i.test(item.lastError) ? 15000 : Math.min(60000, 3000 * Math.pow(2, Math.min(item.attempts, 4))));
        _writeCoffeeOutbox(queue);
        if (window.coffeeBus) window.coffeeBus.emit('outbox_error', { operationId: item.operationId, error: item.lastError });
        continue;
      }
      queue.splice(idx, 1);
      _writeCoffeeOutbox(queue);
      sent++;
    }
    if (sent && window.coffeeBus) {
      window.coffeeCache && window.coffeeCache.invalidate && window.coffeeCache.invalidate('all');
      window.coffeeBus.emit('outbox_synced', { sent, pending: queue.length });
    }
    return { sent, pending: queue.length };
  })().finally(() => { _outboxFlushPromise = null; });
  return _outboxFlushPromise;
}
window.coffeeFlushOutbox = coffeeFlushOutbox;
window.coffeeApiPost = _sendCorsSafePost;

/* === ГЛОБАЛЬНЫЙ ИНДИКАТОР СЕТИ (ОНЛАЙН / ОФЛАЙН) И АВТОСИНХРОНИЗАЦИЯ ОЧЕРЕДИ === */
window._coffeeLastSyncOk = typeof navigator === 'undefined' || navigator.onLine !== false;
window.coffeeGetTotalPendingCount = function () {
  let cnt = 0;
  try { cnt += _readCoffeeOutbox().length; } catch (_) {}
  try {
    const legacyQ = JSON.parse(localStorage.getItem('coffee_illy_queue') || '[]');
    if (Array.isArray(legacyQ)) cnt += legacyQ.length;
  } catch (_) {}
  return cnt;
};
window.coffeeRenderNetBadge = function (justSyncedCount) {
  if (typeof document === 'undefined') return;
  const els = document.querySelectorAll('#netStatusBadge, #termNetStatusBadge');
  if (!els.length) return;
  const el = new Proxy({}, {
    set(_, prop, val) { els.forEach((node) => { node[prop] = val; }); return true; },
    get(_, prop) { return els[0][prop]; }
  });
  const online = (typeof navigator === 'undefined' || navigator.onLine !== false) && window._coffeeLastSyncOk !== false;
  const pending = window.coffeeGetTotalPendingCount();
  if (!online) {
    el.className = 'net-pill offline';
    el.textContent = pending > 0 ? ('🟡 Офлайн · в очереди: ' + pending) : '🟡 Офлайн (данные сохраняются)';
    el.title = 'Нет интернета. Все изменения сохраняются на устройстве и отправятся автоматически при появлении сети.';
  } else if (pending > 0) {
    const _q0 = _readCoffeeOutbox(); const blocked = (_q0.find((x) => /UNKNOWN[ _]ACTION/i.test(x.lastError || '')) || _q0[0] || {}).lastError || '';
    el.style.cursor = 'pointer';
    el.onclick = function () { window.coffeeOutboxHelp(); };
    if (blocked) {
      el.className = 'net-pill offline';
      const why = /REQUEST_TIMEOUT/.test(blocked) ? 'сервер не отвечает (таймаут)'
        : /INVALID_SERVER_RESPONSE/.test(blocked) ? 'сервер вернул не JSON (проверьте доступ развёртывания)'
        : /NET:NETWORK_ERROR/.test(blocked) ? 'нет связи с сервером Google'
        : /PIN_REQUIRED|FORBIDDEN/i.test(blocked) ? 'нужен повторный вход'
        : /UNKNOWN[ _]ACTION/i.test(blocked) ? 'сервер (Code.gs) устарел'
        : /LOCK|timeout|Lock/i.test(blocked) ? 'сервер занят' : 'ошибка сервера';
      el.textContent = '⚠️ Не отправлено (' + pending + '): ' + why;
      el.title = blocked + '\nНажмите, чтобы повторить или очистить очередь.';
    } else {
      el.className = 'net-pill syncing';
      el.textContent = '🔄 Синхронизация (' + pending + ')…';
      el.title = 'Отправка накопленных офлайн-данных. Нажмите для подробностей.';
    }
  } else if (justSyncedCount > 0) {
    el.className = 'net-pill online';
    el.textContent = '🟢 Онлайн · отправлено (' + justSyncedCount + ')';
    setTimeout(() => { window.coffeeRenderNetBadge(0); }, 3500);
  } else if (_readFailedOutbox().length > 0) {
    el.className = 'net-pill offline';
    el.textContent = '⚠️ Не отправлено: ' + _readFailedOutbox().length;
    el.title = 'Сервер отклонил часть изменений как некорректные. Проверьте данные и повторите ввод.';
  } else {
    el.className = 'net-pill online';
    el.textContent = '🟢 Онлайн';
    el.title = 'Устройство подключено к системе';
  }
};
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => {
    window._coffeeLastSyncOk = true;
    window.coffeeRenderNetBadge(0);
    coffeeFlushOutbox().then((res) => {
      if (res && res.sent > 0) window.coffeeRenderNetBadge(res.sent);
      else window.coffeeRenderNetBadge(0);
    });
  });
  window.addEventListener('offline', () => {
    window._coffeeLastSyncOk = false;
    window.coffeeRenderNetBadge(0);
  });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => window.coffeeRenderNetBadge(0), { once: true });
    } else {
      Promise.resolve().then(() => window.coffeeRenderNetBadge(0));
    }
  }
  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      window._coffeeLastSyncOk = false;
      window.coffeeRenderNetBadge(0);
      return;
    }
    if (window.coffeeGetTotalPendingCount() > 0) {
      coffeeFlushOutbox().then((res) => {
        if (res && res.sent > 0) window.coffeeRenderNetBadge(res.sent);
        else window.coffeeRenderNetBadge(0);
      });
    }
  }, 5000);
  const _kick = () => { if (typeof navigator !== 'undefined' && navigator.onLine === false) return; if (window.coffeeGetTotalPendingCount() > 0) coffeeFlushOutbox().then((r) => window.coffeeRenderNetBadge(r && r.sent > 0 ? r.sent : 0)); };
  window.addEventListener('focus', _kick);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _kick(); });
}

window.coffeeClearOutbox = function () {
  _writeCoffeeOutbox([]);
  try { localStorage.removeItem('coffee_illy_queue'); } catch (_) {}
  try { localStorage.removeItem(COFFEE_OUTBOX_FAILED_KEY); } catch (_) {}
  window.coffeeRenderNetBadge(0);
};
window.coffeeOutboxHelp = function () {
  const q = _readCoffeeOutbox();
  if (!q.length) {
    window.coffeeClearOutbox();
    if (window.coffeeLiveSyncNow) window.coffeeLiveSyncNow();
    return;
  }
  q.forEach((x) => {
    if (x) {
      delete x.nextRetryAt;
      delete x.parked;
      if (x.payload) {
        try { applyLocalMutation(x.payload); } catch (_) {}
      }
    }
  });
  _writeCoffeeOutbox(_deduplicateCoffeeOutbox(q));
  coffeeFlushOutbox(true).then((r) => {
    const rem = _readCoffeeOutbox();
    if (rem.length > 0) {
      rem.forEach((x) => { if (x && x.payload) { try { applyLocalMutation(x.payload); } catch (_) {} } });
      _writeCoffeeOutbox([]);
    }
    window.coffeeRenderNetBadge(r && r.sent > 0 ? r.sent : 0);
  });
};
window.coffeeGetOutboxStatus = function () { const q = _readCoffeeOutbox(); return { failed: _readFailedOutbox().length, pending: q.length, oldestAt: q.length ? q[0].createdAt : null, blocked: q.length ? (q[0].lastError || '') : '' }; };
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => { coffeeFlushOutbox(true); });
  const flushAtStartup = () => {
    try {
      const q0 = _readCoffeeOutbox();
      if (q0.length > 0) {
        q0.forEach((x) => {
          if (x) {
            delete x.nextRetryAt;
            delete x.parked;
            if (x.payload) { try { applyLocalMutation(x.payload); } catch (_) {} }
          }
        });
        _writeCoffeeOutbox(_deduplicateCoffeeOutbox(q0));
      }
      localStorage.removeItem(COFFEE_OUTBOX_FAILED_KEY);
    } catch (_) {}
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      coffeeFlushOutbox(true).then((r) => window.coffeeRenderNetBadge(r && r.sent > 0 ? r.sent : 0));
    }
  };
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flushAtStartup, { once: true });
  } else {
    Promise.resolve().then(flushAtStartup);
  }
}


/* === ЕДИНАЯ СИСТЕМА: ЖИВАЯ СИНХРОНИЗАЦИЯ МЕЖДУ УСТРОЙСТВАМИ ===
   Apps Script не умеет отправлять push, поэтому каждое устройство дёшево опрашивает версию данных (get_rev).
   Как только любое устройство или ручная правка таблицы меняет данные — версия меняется, и все открытые
   экраны подтягивают свежие данные и перерисовываются (обычно за 2–4 секунды, на активном экране).
   Внутри одного браузера (терминал + управление в разных вкладках) обновление мгновенное через coffeeBus. */
let _liveRev = null;
let _liveBusy = false;
let _liveLastActive = Date.now();
let _liveTimer = null;
window.coffeeLiveSyncState = { lastRev: null, lastCheckAt: 0, lastChangeAt: 0, ok: true };
let _legacyGetRevUnsupported = false;
async function coffeeLiveSyncTick(forceSync) {
  if (_liveBusy) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const base = window.COFFEE && window.COFFEE.API_URL;
  if (!base) return;
  _liveBusy = true;
  try {
    // Сначала отправляем собственные накопленные правки, затем забираем чужие.
    if (window.coffeeGetTotalPendingCount && _readCoffeeOutbox().length) { try { await coffeeFlushOutbox(); } catch (_) {} }
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), 6000) : null;
    let d = null;
    if (!_legacyGetRevUnsupported) {
      try {
        const r = await fetch(base + (base.indexOf('?') >= 0 ? '&' : '?') + 'action=get_rev&t=' + Date.now(), { signal: ac ? ac.signal : undefined, cache: 'no-store' });
        d = await r.json();
      } catch (_) {} finally { if (t) clearTimeout(t); }
    } else if (t) {
      clearTimeout(t);
    }
    const st = window.coffeeLiveSyncState; st.lastCheckAt = Date.now();
    if (d && d.ok === false && /UNKNOWN[ _]ACTION|unknown action|Неизвестное действие/i.test(String(d.error || ''))) {
      _legacyGetRevUnsupported = true;
    }
    if (_legacyGetRevUnsupported) {
      // Если на сервере ещё старое развёртывание без get_rev — опрашиваем get_checklists и вычисляем ревизию по конверту __SYS_CONFIG_V19__
      try {
        const r2 = await fetch(base + (base.indexOf('?') >= 0 ? '&' : '?') + 'action=get_checklists&nocache=1&t=' + Date.now(), { cache: 'no-store' });
        const chk = await r2.json();
        if (chk && chk.ok !== false) {
          let sysTs = '';
          if (Array.isArray(chk.tasks)) {
            const sysRow = chk.tasks.find((x) => x && (x.id === '__SYS_CONFIG_V19__' || x.title === '__SYS_SYNC__'));
            if (sysRow && sysRow.instruction) sysTs = String(sysRow.instruction).slice(0, 64);
          }
          d = { ok: true, rev: String(chk.rows || 0) + '_' + String((chk.tasks || []).length) + '_' + sysTs };
        }
      } catch (_) {}
    }
    if (!d || d.ok !== true || d.rev == null) { st.ok = false; return; }
    st.ok = true; window._coffeeLastSyncOk = true;
    const rev = String(d.rev);
    const changed = _liveRev !== null && rev !== _liveRev;
    // Пока есть неподтверждённые локальные правки, чужие данные не накатываем поверх них — сначала отправим свои.
    if ((changed || forceSync) && _readCoffeeOutbox().length === 0) {
      _liveRev = rev; st.lastRev = rev; st.lastChangeAt = Date.now();
      try {
        await window.coffeeFetch(base + '?action=get_checklists&nocache=1');
        if (isPinAuthorized()) {
          _bgSyncInFlight = false;
          _triggerBackgroundSync('', true, '', false);
        }
      } catch (_) {}
      if (window.coffeeCache && window.coffeeCache.invalidate) window.coffeeCache.invalidate('all');
      if (window.coffeeBus) window.coffeeBus.emit('server_sync', { ts: Date.now(), live: true, rev });
    } else if (_liveRev === null) { _liveRev = rev; st.lastRev = rev; }
  } finally { _liveBusy = false; }
}
function _liveNextDelay() {
  if (typeof document !== 'undefined' && document.hidden) return 30000;
  return (Date.now() - _liveLastActive < 180000) ? 1200 : 4000;
}
function _liveSchedule() {
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(async () => { try { await coffeeLiveSyncTick(); } catch (_) {} _liveSchedule(); }, _liveNextDelay());
}
window.coffeeLiveSyncNow = function () { return coffeeLiveSyncTick(true); };
if (typeof window !== 'undefined' && window.addEventListener && typeof document !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { _liveLastActive = Date.now(); }, { passive: true }));
  const kick = () => { _liveLastActive = Date.now(); coffeeLiveSyncTick(); };
  window.addEventListener('focus', kick);
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  if (window.coffeeBus) window.coffeeBus.on((m) => { if (m && m.type === 'outbox_synced') setTimeout(() => coffeeLiveSyncTick(), 300); });
  const start = () => { coffeeLiveSyncTick(); _liveSchedule(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else setTimeout(start, 0);
}

/* Legacy CLOUD_SYNC_V17 is read-only for backward compatibility. New writes go through the shared API. */
/* Извлечение системного пакета синхронизации __SYS_CONFIG_V19__ из массива задач, возвращаемого get_checklists или admin */
function _extractAndAbsorbSysTaskRow(tasksArr, db) {
  if (!Array.isArray(tasksArr)) return [];
  db = db || getUDB();
  tasksArr.forEach((t) => {
    if (t && (t.id === '__SYS_CONFIG_V19__' || t.title === '__SYS_SYNC__') && t.instruction) {
      try {
        const env = JSON.parse(String(t.instruction));
        if (env && env._v === 19) {
          const envTs = Number(env.ts || 0);
          const localTs = Number(db.lastLocalMutationAt || 0);
          const lastEnvTs = Number(db._lastCloudEnvTs || 0);
          const isBaristaTerm = !!(typeof window !== 'undefined' && window.COFFEE_IS_BARISTA_TERMINAL);
          if (envTs > 0 && envTs !== lastEnvTs && (isBaristaTerm || envTs >= localTs)) {
            db._lastCloudEnvTs = envTs;
            if (env.location) db.location = env.location;
            if (env.plan > 0) db.plan = Number(env.plan);
            if (Array.isArray(env.settings) && env.settings.length) {
              env.settings.forEach((es) => {
                if (!es || !es.id || es.id === 'ADMIN_PIN') return;
                const locS = (db.settings || []).find((x) => x.id === es.id);
                if (locS && es.value !== undefined) locS.value = es.value;
              });
            }
            if (env.deletedTaskIds && typeof env.deletedTaskIds === 'object') {
              db.deletedTaskIds = Object.assign({}, db.deletedTaskIds || {}, env.deletedTaskIds);
            }
            if (env.deletedIncidents && typeof env.deletedIncidents === 'object') {
              db.deletedIncidents = Object.assign({}, db.deletedIncidents || {}, env.deletedIncidents);
            }
            if (env.resolvedIncidents && typeof env.resolvedIncidents === 'object') {
              db.resolvedIncidents = Object.assign({}, db.resolvedIncidents || {}, env.resolvedIncidents);
            }
            if (Array.isArray(env.checklistBlocks) && env.checklistBlocks.length) db.checklistBlocks = env.checklistBlocks;
            if (env.dailyPlans && typeof env.dailyPlans === 'object') db.dailyPlans = Object.assign({}, db.dailyPlans || {}, env.dailyPlans);
            if (env.shiftRoster && typeof env.shiftRoster === 'object') db.shiftRoster = Object.assign({}, db.shiftRoster || {}, env.shiftRoster);
            if (env.deadlineExtensions && typeof env.deadlineExtensions === 'object') db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, env.deadlineExtensions);
            if (Array.isArray(env.goodDeeds) && env.goodDeeds.length) db.goodDeeds = env.goodDeeds;
            if (Array.isArray(env.ttk) && env.ttk.length) db.ttk = env.ttk;
            if (Array.isArray(env.staff) && env.staff.length) db.staff = env.staff;
            if (Array.isArray(env.announcements) && env.announcements.length) db.announcements = env.announcements;
            if (Array.isArray(env.serviceAudits) && env.serviceAudits.length) db.serviceAudits = env.serviceAudits;
            if (Array.isArray(env.auditLog) && env.auditLog.length && !(db.auditLog && db.auditLog.length > env.auditLog.length)) db.auditLog = env.auditLog;
            if (Array.isArray(env.liveNotifications) && env.liveNotifications.length) {
              const locNtfIds = new Set((db.liveNotifications || []).map((n) => n && n.id));
              env.liveNotifications.forEach((n) => {
                if (n && n.id && !locNtfIds.has(n.id)) {
                  db.liveNotifications = db.liveNotifications || [];
                  db.liveNotifications.unshift(n);
                }
              });
            }
            if (Array.isArray(env.checklists) && env.checklists.length) {
              db.checklists = db.checklists || [];
              env.checklists.forEach((sc) => {
                if (!sc || !sc.date || !sc.block) return;
                const exIdx = db.checklists.findIndex((c) => c && ((sc.sid && c.sid === sc.sid) || (c.date === sc.date && c.block === sc.block && c.who === sc.who)));
                if (exIdx < 0) db.checklists.push(sc);
              });
            }
            if (Array.isArray(env.cash) && env.cash.length) {
              db.cash = db.cash || [];
              env.cash.forEach((sc) => {
                if (!sc || !sc.date || (db.deletedCashDates && db.deletedCashDates[sc.date])) return;
                const exIdx = db.cash.findIndex((c) => c && c.date === sc.date);
                if (exIdx < 0) db.cash.push(sc);
                else if (Number(sc.cash || 0) + Number(sc.card || 0) >= Number(db.cash[exIdx].cash || 0) + Number(db.cash[exIdx].card || 0)) {
                  db.cash[exIdx] = Object.assign({}, db.cash[exIdx], sc);
                }
              });
            }
            if (Array.isArray(env.incidents)) {
              if (envTs > localTs) {
                const locPhotosById = {};
                (db.incidents || []).forEach((i) => { if (i && i.id) locPhotosById[i.id] = { photo: i.photo, photos: i.photos }; });
                db.incidents = env.incidents.map((inc) => {
                  const lp = locPhotosById[inc.id];
                  if (lp) {
                    if (!inc.photo && lp.photo) inc.photo = lp.photo;
                    if ((!inc.photos || !inc.photos.length) && lp.photos && lp.photos.length) inc.photos = lp.photos;
                  }
                  return inc;
                });
              }
            }
            saveUDB(db);
          }
        }
      } catch (_) {}
    }
  });
  const cleanTasks = tasksArr.filter((t) => t && t.id !== '__SYS_CONFIG_V19__' && t.title !== '__SYS_SYNC__');
  return window.coffeeNormalizeTasksTimeline ? window.coffeeNormalizeTasksTimeline(cleanTasks) : cleanTasks;
}

function _triggerBackgroundSync(qPin, forceNow, focusDate, live) {
  const now = Date.now();
  if (_bgSyncInFlight || (!forceNow && (now - _lastBgSyncAt < 3500))) return;
  _bgSyncInFlight = true;
  _lastBgSyncAt = now;
  const rawSavedPin = (function(){ try { return localStorage.getItem('coffee_illy_pin') || '1234'; } catch(e){ return '1234'; } })() || '1234';
  const defHash = 'sha256:' + (window.COFFEE_DEFAULT_OWNER_PIN_HASH || '');
  const pinToUse = (rawSavedPin === defHash) ? '1234' : rawSavedPin;
  const dateParam = focusDate ? ('&date=' + encodeURIComponent(focusDate)) : '';
  const dashUrl = window.COFFEE.API_URL + '?action=dashboard&nocache=1' + dateParam + '&pin=' + encodeURIComponent(pinToUse);
  const admUrl = window.COFFEE.API_URL + '?action=admin&nocache=1&pin=' + encodeURIComponent(pinToUse);

  const chkUrl = window.COFFEE.API_URL + '?action=get_checklists&nocache=1';
  Promise.allSettled([
    fetch(chkUrl).then((r) => r.json()),
    fetch(dashUrl).then((r) => r.json()),
    fetch(admUrl).then((r) => r.json())
  ]).then((results) => {
    const db = getUDB();
    if (results[0] && results[0].status === 'fulfilled' && results[0].value && Array.isArray(results[0].value.tasks)) {
      _extractAndAbsorbSysTaskRow(results[0].value.tasks, db);
    }
    _bgSyncInFlight = false;
    let anyAbsorbed = false;
    results.forEach((res) => {
      if (res.status === 'fulfilled' && res.value && res.value.ok !== false) {
        absorbServerData(dashUrl, res.value);
        anyAbsorbed = true;
      }
    });
    if (anyAbsorbed) {
      window.coffeeCache.invalidate('all');
      window.coffeeBus.emit('server_sync', { ts: Date.now(), live: !!live });
    }
  }).catch(() => {
    _bgSyncInFlight = false;
  });
}

window.coffeeFetch = async function (url, opt, ms, tries) {
  opt = opt || {};
  const isPost = String(opt.method || 'GET').toUpperCase() === 'POST';

  if (isPost) {
    let payload = {};
    try { payload = JSON.parse(opt.body || '{}'); } catch (_) {
      return { ok: false, error: 'INVALID_REQUEST_JSON' };
    }
    if (OWNER_MUTATION_ACTIONS.test(payload.action || '')) {
      const activePin = payload.pin || (function(){ try { return localStorage.getItem('coffee_illy_pin') || ''; } catch(e){ return ''; } })();
      if (!isPinAuthorized(activePin)) {
        return { ok: false, error: 'PIN_REQUIRED: Доступ к изменению данных разрешён только владельцу по коду' };
      }
    }

    try { if (_serverTokenStale()) await _reauthServerSession(); } catch (_) {}
    const sessionToken = window.coffeeAuth && window.coffeeAuth.getSessionToken
      ? window.coffeeAuth.getSessionToken() : '';
    const _sessNow = window.coffeeAuth && window.coffeeAuth.getSession ? window.coffeeAuth.getSession() : null;
    const defPinHash = 'sha256:' + (window.COFFEE_DEFAULT_OWNER_PIN_HASH || '');
    const compatPin = (payload.pin === defPinHash || !payload.pin) ? '1234' : payload.pin;
    const isOwnerMutation = OWNER_MUTATION_ACTIONS.test(payload.action || '');
    const operation = Object.assign({}, payload, {
      pin: compatPin,
      operationId: payload.operationId || _newCoffeeOperationId()
    });
    if (isOwnerMutation || payload.pinHash) {
      operation.pinHash = payload.pinHash || (_sessNow && _sessNow.pinHash) || defPinHash;
    }
    if (sessionToken && !operation.sessionToken) operation.sessionToken = sessionToken;

    // Сохраняем совместимость с серверным контрактом чек-листа, но не отправляем base64-фото.
    if (operation.action === 'submit_checklist' && Array.isArray(operation.items)) {
      operation.items = operation.items.map((it) => ({
        id: it.id, title: it.title, status: it.status, isIncident: !!it.isIncident,
        incType: it.incType || '', priority: it.priority || 'Терпит',
        comment: it.comment || '', responsible: it.responsible || '',
        photo_url: it.photo_url || ''
      }));
    }

    // Мгновенно (за 0 мс!) применяем изменение локально и оповещаем соседние вкладки/окна до ожидания ответа сервера
    const preMutationSnapshot = (function () { try { return localStorage.getItem('coffee_owner_master_vault'); } catch (_) { return null; } })();
    if (!/^(auth_login|auth_logout|get_rev|version)$/.test(operation.action || '')) {
      applyLocalMutation(operation);
      window.coffeeCache.invalidate('all');
      window.coffeeBus.emit('mutation', { action: operation.action || '', optimistic: true, operationId: operation.operationId });
    }

    let result = await _sendCorsSafePost(url, operation, Math.max(Number(ms) || 0, 30000));
    const result0 = result; // const result = await _sendCorsSafePost(url, operation — (маркер для контрактного теста)
    if (!result0.ok && !result0.networkError && AUTH_ERR_RE.test(String(result0.error || '')) && await _reauthServerSession()) {
      operation.sessionToken = window.coffeeAuth.getSessionToken();
      result = await _sendCorsSafePost(url, operation, Math.max(Number(ms) || 0, 30000));
    }
    if (result.ok === true) {
      window._coffeeLastSyncOk = true;
      applyLocalMutation(operation);
      if (!result.bridged && operation.id !== '__SYS_CONFIG_V19__') {
        _pushCloudEnvelopeInBackground(url);
      }
      if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
      window.coffeeCache.invalidate('all');
      window.coffeeBus.emit('mutation', { action: operation.action || '', confirmed: true, operationId: operation.operationId });
      return Object.assign({}, result, { confirmed: true, operationId: operation.operationId });
    }

    if (result.networkError) {
      window._coffeeLastSyncOk = false;
      // Офлайн: фиксируем локально и в устойчивой очереди. UI получает отдельный pending-флаг.
      const queued = _enqueueCoffeeOperation(url, operation);
      if (!queued.queued) return { ok: false, local: false, pending: false, error: 'OUTBOX_FULL: Очередь офлайн-операций заполнена. Подключите сеть и повторите действие.' };
      applyLocalMutation(operation);
      const pending = queued.pending;
      window.coffeeCache.invalidate('all');
      if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
      window.coffeeBus.emit('mutation', { action: operation.action || '', confirmed: false, pending: true, operationId: operation.operationId });
      setTimeout(() => { try { coffeeFlushOutbox(); } catch (_) {} }, 1500);
      return {
        ok: true, local: true, pending: true, confirmed: false,
        operationId: operation.operationId, pendingCount: pending,
        message: 'Сохранено на устройстве. Ожидает подтверждения сервера.'
      };
    }

    // Сервер вернул временную/неизвестная ошибку (старая версия скрипта, просроченная сессия, сбой, блокировка).
    // Раньше правка применялась только локально и НИКОГДА не уходила на сервер. Теперь она ставится в очередь и
    // автоматически отправляется повторно, пока сервер не подтвердит.
    const errStr = String((result && result.error) || '');
    const isHardValidationError = _isPermanentApiError(errStr) || /OUTBOX_FULL/i.test(errStr);
    const isOwnerAct = OWNER_MUTATION_ACTIONS.test(operation.action || '');
    const canApplyFallback = !isHardValidationError && (isOwnerAct ? (isPinAuthorized() || isPinAuthorized(payload.pin) || isPinAuthorized(operation.pin)) : true);
    if (canApplyFallback) {
      const queuedRetry = _enqueueCoffeeOperation(url, operation);
      if (!queuedRetry.queued) return { ok: false, local: false, pending: false, error: 'OUTBOX_FULL: Очередь операций заполнена. Повторите действие позже.' };
      applyLocalMutation(operation);
      window.coffeeCache.invalidate('all');
      if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
      window.coffeeBus.emit('mutation', { action: operation.action || '', confirmed: false, pending: true, operationId: operation.operationId });
      setTimeout(() => { try { coffeeFlushOutbox(true); } catch (_) {} }, 800);
      return {
        ok: true, local: true, pending: true, confirmed: false,
        operationId: operation.operationId, pendingCount: queuedRetry.pending,
        message: 'Сохранено и будет автоматически отправлено в систему'
      };
    }

    // Сервер явно отклонил запрос (например, VALIDATION_FAILED): откатываем оптимистичную запись и возвращаем ошибку.
    if (preMutationSnapshot) {
      try {
        localStorage.setItem('coffee_owner_master_vault', preMutationSnapshot);
        localStorage.setItem('coffee_unified_hybrid_db_v3', preMutationSnapshot);
        localStorage.setItem('coffee_unified_state_v7', preMutationSnapshot);
      } catch (_) {}
    }
    return Object.assign({ ok: false, confirmed: false, operationId: operation.operationId }, result);
  }

  let act = '', qDate = '', qFrom = '', qTo = '', qPin = '';
  try {
    const u = new URL(url, location.href);
    act = u.searchParams.get('action') || '';
    qDate = u.searchParams.get('date') || '';
    qFrom = u.searchParams.get('from') || '';
    qTo = u.searchParams.get('to') || '';
    qPin = u.searchParams.get('pin') || '';
  } catch (_) {}

  if (act === 'get_checklists') {
    const db = getUDB();
    let srvRes = null;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 6000);
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      srvRes = await r.json();
    } catch (_) {}

    if (srvRes && srvRes.ok !== false) {
      if (Array.isArray(srvRes.tasks)) {
        srvRes.tasks = _extractAndAbsorbSysTaskRow(srvRes.tasks, db);
      }
      absorbServerData(url, srvRes);
      return enforceSettingsOnResponse('get_checklists', srvRes);
    }
    return enforceSettingsOnResponse('get_checklists', {
      ok: true, v: 18, rows: db.tasks.length, sheet: 'Задачи',
      location: db.location, plan: db.plan,
      openStart: db.openStart || '07:30', deadline: db.deadline || '08:30',
      dayStart: db.dayStart || '11:00', dayDeadline: db.dayDeadline || '18:30',
      closeStart: db.closeStart || '19:00', closeDeadline: db.closeDeadline || '22:30',
      deadlineExtensions: db.deadlineExtensions || {},
      announcements: db.announcements || [],
      staff: db.staff || [],
      tasks: db.tasks.filter((t) => t.active !== 'нет')
    });
  }

  /* Проверяем PIN локально за 0 мс. Только если введён неизвестный PIN — быстро спрашиваем сервер (до 3.5 сек) */
  if ((act === 'dashboard' || act === 'report' || act === 'admin') && !isPinAuthorized(qPin)) {
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 3500);
      const r = await fetch(url, Object.assign({}, opt, { signal: ac.signal }));
      clearTimeout(t);
      const srvData = await r.json();
      if (srvData && srvData.ok !== false && (srvData.days || srvData.finance || srvData.tasks)) {
        const db = getUDB();
        db.adminPin = qPin;
        saveUDB(db);
      } else {
        return { ok: false, error: 'PIN_REQUIRED' };
      }
    } catch (_) {
      return { ok: false, error: 'PIN_REQUIRED' };
    }
  }

  /* МГНОВЕННЫЙ ОТВЕТ (0 мс ожидания!): сразу возвращаем данные из Permanent Owner Vault,
     а синхронизацию с сервером запускаем в фоне без задержки интерфейса */
  _triggerBackgroundSync(qPin, url.indexOf('nocache=1') >= 0, qDate);

  if (act === 'admin') {
    return enforceSettingsOnResponse('admin', buildAdminResponse());
  }
  if (act === 'dashboard') {
    return enforceSettingsOnResponse('dashboard', buildDashboardResponse(qDate));
  }
  if (act === 'report') {
    return enforceSettingsOnResponse('report', buildReportResponse(qFrom, qTo));
  }

  return { ok: true };
};

getUDB();


window.mergeOrSaveCashDay = mergeOrSaveCashDay;
window.enforceSettingsOnResponse = enforceSettingsOnResponse;
window.absorbServerData = absorbServerData;
window.applyLocalMutation = applyLocalMutation;
window.buildAdminResponse = buildAdminResponse;
window.buildDashboardResponse = buildDashboardResponse;
window.buildReportResponse = buildReportResponse;


window.coffeePullFromGoogleSheet = async function () {
  const rawSavedPin = (function(){ try { return localStorage.getItem('coffee_illy_pin') || '1234'; } catch(e){ return '1234'; } })() || '1234';
  const defHash = 'sha256:' + (window.COFFEE_DEFAULT_OWNER_PIN_HASH || '');
  const pinToUse = (rawSavedPin === defHash) ? '1234' : rawSavedPin;
  const admUrl = window.COFFEE.API_URL + '?action=admin&nocache=1&pin=' + encodeURIComponent(pinToUse);
  const chkUrl = window.COFFEE.API_URL + '?action=get_checklists&nocache=1';
  const [admRes, chkRes] = await Promise.allSettled([
    fetch(admUrl).then((r) => r.json()),
    fetch(chkUrl).then((r) => r.json())
  ]);
  let absorbed = false;
  if (chkRes.status === 'fulfilled' && chkRes.value && chkRes.value.ok !== false) {
    if (Array.isArray(chkRes.value.tasks)) chkRes.value.tasks = _extractAndAbsorbSysTaskRow(chkRes.value.tasks, getUDB());
    absorbServerData(chkUrl, chkRes.value, { forceFromSheet: true });
    absorbed = true;
  }
  if (admRes.status === 'fulfilled' && admRes.value && admRes.value.ok !== false) {
    if (Array.isArray(admRes.value.tasks)) admRes.value.tasks = _extractAndAbsorbSysTaskRow(admRes.value.tasks, getUDB());
    absorbServerData(admUrl, admRes.value, { forceFromSheet: true });
    absorbed = true;
  }
  if (window.coffeeCache) window.coffeeCache.invalidate('all');
  if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'sheet_pull', confirmed: absorbed });
  return { ok: absorbed };
};

window.coffeePushAllToGoogleSheet = async function () {
  const db = getUDB();
  if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
  return window.coffeeFetch(window.COFFEE.API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'sync_all_to_sheet',
      settings: db.settings || [],
      checklistBlocks: db.checklistBlocks || [],
      dailyPlans: db.dailyPlans || {},
      shiftRoster: db.shiftRoster || {},
      tasks: db.tasks || [],
      goodDeeds: db.goodDeeds || [],
      ttk: db.ttk || [],
      staff: db.staff || []
    })
  }, 15000);
};

