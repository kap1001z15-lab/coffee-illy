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

function absorbServerData(url, data) {
  if (!data || data.ok === false) return data;
  const db = getUDB();
  let changed = false;
  if (Array.isArray(data.deltas) && data.deltas.length && window.coffeeDeltaSync) {
    if (window.coffeeDeltaSync.applyIncomingDeltas(db, data.deltas)) changed = true;
    if (data.serverTs) db.lastServerDeltaTs = data.serverTs;
  }
  const now = Date.now();
  const recentlyMutatedLocally = db.lastLocalMutationAt && (now - db.lastLocalMutationAt < 10000);

  /* 1. Если в ответе сервера (или в листе Настройки) есть конверт CLOUD_SYNC_V17 от Терминала/Управления — сливаем новые записи */
  if (Array.isArray(data.settings)) {
    const syncRow = data.settings.find((s) => (s.id || s.label) === 'CLOUD_SYNC_V17');
    if (syncRow && syncRow.value) {
      try {
        const env = JSON.parse(syncRow.value);
        if (env && typeof env === 'object') {
          if (Array.isArray(env.cash)) {
            env.cash.forEach((sc) => {
              if (!sc || !sc.date) return;
              const loc = db.cash.find((x) => x.date === sc.date);
              const scRev = (Number(sc.cash) || 0) + (Number(sc.card) || 0);
              const locRev = loc ? (Number(loc.cash) || 0) + (Number(loc.card) || 0) : -1;
              if (!loc) {
                db.cash.push(sc);
                changed = true;
              } else if (!recentlyMutatedLocally && (scRev !== locRev || (sc.shifts && sc.shifts.length > (loc.shifts || []).length))) {
                Object.assign(loc, sc);
                changed = true;
              }
            });
          }
          if (Array.isArray(env.checklists)) {
            env.checklists.forEach((chk) => {
              if (!chk || !chk.date || !chk.block) return;
              const exists = (db.checklists || []).some((x) => x.date === chk.date && x.block === chk.block && x.time === chk.time);
              if (!exists) {
                db.checklists.push(chk);
                changed = true;
              }
            });
          }
          if (Array.isArray(env.incidents)) {
            env.incidents.forEach((inc) => {
              if (!inc || !inc.id || db.deletedIncidents[inc.id]) return;
              const ex = db.incidents.find((x) => x.id === inc.id);
              if (!ex) {
                db.incidents.unshift(inc);
                changed = true;
              } else if (!recentlyMutatedLocally && inc.status && inc.status !== ex.status) {
                ex.status = inc.status;
                ex.history = inc.history || ex.history;
                changed = true;
              }
            });
          }
          if (env.deadlineExtensions && typeof env.deadlineExtensions === 'object') {
            db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, env.deadlineExtensions);
          }
        }
      } catch (_) {}
    }

    data.settings.forEach((srvSet) => {
      if ((srvSet.id || srvSet.label) === 'CLOUD_SYNC_V17') return;
      const nk = normalizeSettingKey(srvSet.id || srvSet.label);
      if (!db.modifiedSettings[nk] && srvSet.value !== undefined && String(srvSet.value).trim() !== '') {
        const target = db.settings.find((x) => x.id === nk);
        if (target && target.value !== String(srvSet.value).trim()) {
          target.value = String(srvSet.value).trim();
          changed = true;
        }
      }
    });
  }

  /* 2. Поглощаем массив кассы из ?action=admin */
  if (Array.isArray(data.cash)) {
    data.cash.forEach((srvC) => {
      if (!srvC || !srvC.date) return;
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
      } else if (!recentlyMutatedLocally) {
        const lRev = (Number(loc.cash) || 0) + (Number(loc.card) || 0);
        if (sRev !== lRev && (!loc.localUpdatedAt || (now - loc.localUpdatedAt > 15000))) {
          loc.cash = Number(srvC.cash) || 0;
          loc.card = Number(srvC.card) || 0;
          loc.checks = Number(srvC.checks) || loc.checks || 0;
          loc.writeoff = Number(srvC.writeoff != null ? srvC.writeoff : loc.writeoff) || 0;
          if (srvC.topItems) loc.topItems = srvC.topItems;
          if (srvC.barista) loc.barista = srvC.barista;
          changed = true;
        }
      }
    });
  }

  /* 3. Поглощаем данные выбранного дня и 14 дней из ?action=dashboard */
  if (data.date && (data.hasData || Number(data.revenue) > 0)) {
    const dRev = Number(data.revenue) || 0;
    const dCash = data.cash != null ? Number(data.cash) : dRev;
    const dCard = data.card != null ? Number(data.card) : Math.max(0, dRev - dCash);
    const loc = db.cash.find((c) => c.date === data.date);
    if (!loc && dRev > 0) {
      db.cash.push({
        date: data.date,
        cash: dCash,
        card: dCard,
        checks: Number(data.checks) || Math.max(1, Math.round(dRev / 35)),
        writeoff: Number(data.writeoff) || 0,
        barista: data.barista || '',
        topItems: data.topItems || ''
      });
      changed = true;
    } else if (loc && !recentlyMutatedLocally && dRev > 0) {
      const lRev = (Number(loc.cash) || 0) + (Number(loc.card) || 0);
      if (dRev !== lRev && (!loc.localUpdatedAt || (now - loc.localUpdatedAt > 15000))) {
        loc.cash = dCash;
        loc.card = dCard;
        if (data.checks != null) loc.checks = Number(data.checks) || loc.checks;
        if (data.writeoff != null) loc.writeoff = Number(data.writeoff) || 0;
        changed = true;
      }
    }
  }

  if (Array.isArray(data.days)) {
    data.days.forEach((dayBar) => {
      if (dayBar && dayBar.date && dayBar.revenue > 0) {
        const exists = db.cash.find((c) => c.date === dayBar.date);
        if (!exists) {
          const isFocusDay = dayBar.date === data.date;
          db.cash.push({
            date: dayBar.date,
            cash: dayBar.revenue,
            card: 0,
            checks: isFocusDay && data.checks ? Number(data.checks) : Math.max(1, Math.round(dayBar.revenue / 35)),
            writeoff: isFocusDay && data.writeoff ? Number(data.writeoff) : 0,
            topItems: ''
          });
          changed = true;
        }
      }
    });
  }

  /* 4. Поглощаем чек-листы, время открытия и фотоотчёты из ответа сервера */
  if (data.date && data.openedAt && data.openedAt !== '—') {
    const hasOpen = (db.checklists || []).some((c) => c.date === data.date && c.block === 'Открытие');
    if (!hasOpen) {
      db.checklists.push({
        date: data.date,
        time: data.openedAt,
        block: 'Открытие',
        who: data.barista || 'Бариста',
        problems: 0,
        photos: []
      });
      changed = true;
    }
  }
  if (Array.isArray(data.photoReports) && data.date) {
    data.photoReports.forEach((pr) => {
      if (!pr || !pr.block) return;
      const ex = (db.checklists || []).find((c) => c.date === data.date && c.block === pr.block);
      if (!ex) {
        db.checklists.push({
          date: data.date,
          time: pr.time || '08:20',
          block: pr.block,
          who: pr.who || 'Бариста',
          problems: 0,
          photos: Array.isArray(pr.photos) ? pr.photos : []
        });
        changed = true;
      } else if (Array.isArray(pr.photos) && pr.photos.length > (ex.photos || []).length) {
        ex.photos = pr.photos;
        changed = true;
      }
    });
  }
  if (Array.isArray(data.checklists)) {
    data.checklists.forEach((chk) => {
      if (!chk || !chk.date || !chk.block) return;
      const ex = (db.checklists || []).some((c) => c.date === chk.date && c.block === chk.block && c.time === chk.time);
      if (!ex) {
        db.checklists.push(chk);
        changed = true;
      }
    });
  }

  /* 5. Поглощаем инциденты / поломки (и извлекаем без-PIN пакеты синхронизации терминала __SYS_TERM_SYNC__) */
  if (Array.isArray(data.incidents)) {
    const realIncs = [];
    data.incidents.forEach((srvInc) => {
      if (!srvInc) return;
      if (srvInc.step === '__SYS_TERM_SYNC__' || srvInc.who === '__SYS__' || srvInc.block === '__SYS__') {
        if (srvInc.text) {
          try {
            const td = JSON.parse(srvInc.text);
            if (td && Array.isArray(td.acks)) {
              td.acks.forEach((akObj) => {
                const targetAnn = (db.announcements || []).find((a) => a.id === akObj.id);
                if (targetAnn && Array.isArray(akObj.acks)) {
                  targetAnn.acks = targetAnn.acks || [];
                  akObj.acks.forEach((k) => {
                    if (k && k.name && !targetAnn.acks.some((x) => String(x.name).toLowerCase() === String(k.name).toLowerCase())) {
                      targetAnn.acks.push(k);
                      changed = true;
                    }
                  });
                }
              });
            }
            if (td && Array.isArray(td.checklists)) {
              td.checklists.forEach((chk) => {
                if (chk && chk.date && chk.block && chk.block !== '__SYS__') {
                  const ex = (db.checklists || []).some((c) => c.date === chk.date && c.block === chk.block);
                  if (!ex) {
                    db.checklists.push(chk);
                    changed = true;
                  }
                }
              });
            }
          } catch (_) {}
        }
        return;
      }
      realIncs.push(srvInc);
      if (!srvInc.id || db.deletedIncidents[srvInc.id]) return;
      const localStatus = db.resolvedIncidents[srvInc.id];
      const normStatus = localStatus || window.coffeeNormIncStatus(srvInc.status);
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
          photo: srvInc.photo || ''
        });
        changed = true;
      } else {
        if (localStatus) existing.status = localStatus;
        if (!existing.photo && srvInc.photo) existing.photo = srvInc.photo;
      }
    });
  }

  if (data.deadlineExtensions && typeof data.deadlineExtensions === 'object') {
    db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, data.deadlineExtensions);
    changed = true;
  }
  if (Array.isArray(data.announcements) && data.announcements.length) {
    db.announcements = data.announcements;
    changed = true;
  }
  if (Array.isArray(data.staff) && data.staff.length) {
    db.staff = data.staff;
    changed = true;
  }
  if (data.openStart && data.openStart !== db.openStart) { db.openStart = data.openStart; changed = true; }
  if (data.deadline && data.deadline !== db.deadline) { db.deadline = data.deadline; changed = true; }
  if (data.dayStart && data.dayStart !== db.dayStart) { db.dayStart = data.dayStart; changed = true; }
  if (data.dayDeadline && data.dayDeadline !== db.dayDeadline) { db.dayDeadline = data.dayDeadline; changed = true; }
  if (data.closeStart && data.closeStart !== db.closeStart) { db.closeStart = data.closeStart; changed = true; }
  if (data.closeDeadline && data.closeDeadline !== db.closeDeadline) { db.closeDeadline = data.closeDeadline; changed = true; }

  if (Array.isArray(data.incidents)) data.incidents = (db.incidents || []).filter((i) => i && i.step !== '__SYS_TERM_SYNC__' && i.block !== '__SYS__');
  if (changed) saveUDB(db);
  return data;
}

function applyLocalMutation(payload) {
  if (!payload || !payload.action) return;
  const db = getUDB();
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
      try { localStorage.setItem('coffee_illy_pin', val); localStorage.setItem('coffee_admin_ok', '1'); } catch (_) {}
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
        try { localStorage.setItem('coffee_illy_pin', val); localStorage.setItem('coffee_admin_ok', '1'); } catch (_) {}
      }
    });
  } else if (a === 'save_task') {
    const isEdit = payload.row != null;
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
      const idx = db.tasks.findIndex((t) => t.row === Number(payload.row) || t.title === payload.expect);
      if (idx >= 0) db.tasks[idx] = Object.assign({}, db.tasks[idx], item);
      else db.tasks.push(item);
    } else {
      db.tasks.push(item);
    }
  } else if (a === 'delete_task') {
    db.tasks = db.tasks.filter((t) => !(t.row === Number(payload.row) || (payload.expect && t.title === payload.expect)));
  } else if (a === 'admin_cash' || a === 'submit_cash') {
    mergeOrSaveCashDay(db, payload);
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
    db.expenses = db.expenses.filter((x) => x.id !== payload.id);
  } else if (a === 'reorder_task') {
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
    appendAudit(db, 'Администратор', 'Публикация информирования', item.title);
  } else if (a === 'delete_announcement') {
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
    payload.pins.forEach((pItem) => {
      const st = (db.staff || []).find((s) => s.id === pItem.id || s.name === pItem.name);
      if (st && pItem.pin) st.pin = String(pItem.pin).trim();
    });
    appendAudit(db, 'Администратор', 'Обновление кодов доступа сотрудников', 'Обновлено кодов: ' + payload.pins.length);
  } else if (a === 'save_staff') {
    db.staff = db.staff || [];
    const stItem = {
      id: payload.id || ('st_' + Date.now().toString(36)),
      name: String(payload.name || '').trim(),
      role: payload.role || 'Бариста',
      pin: String(payload.pin || '1111').trim(),
      shop: payload.shop || db.location || 'Кофейня №1',
      active: payload.active || 'да'
    };
    const sIdx = db.staff.findIndex((x) => x.id === stItem.id || x.name.toLowerCase() === stItem.name.toLowerCase());
    if (sIdx >= 0) db.staff[sIdx] = Object.assign({}, db.staff[sIdx], stItem);
    else db.staff.push(stItem);
    appendAudit(db, 'Администратор', 'Обновление сотрудника', stItem.name + ' (' + stItem.role + ')');
  } else if (a === 'delete_staff') {
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
    db.serviceAudits = (db.serviceAudits || []).filter((x) => x.id !== payload.id);
  } else if (a === 'save_ttk') {
    db.ttk = db.ttk || [];
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
    db.ttk = (db.ttk || []).filter((x) => x.id !== payload.id);
  } else if (a === 'save_good_deed') {
    db.goodDeeds = db.goodDeeds || [];
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
    appendAudit(db, 'Администратор', 'Обновление Карты добрых дел (периодическая задача)', gdItem.title + ' (' + gdItem.frequency + ')');
  } else if (a === 'delete_good_deed') {
    db.goodDeeds = (db.goodDeeds || []).filter((x) => x.id !== payload.id);
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
    db.incidents.unshift(newInc);
    appendAudit(db, newInc.who, 'Регистрация проблемы ' + newInc.id, newInc.step + ': ' + newInc.text);
    if (window.coffeeTelegram) {
      window.coffeeTelegram.sendIncidentAlert(newInc).catch(() => {});
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
    db.checklists.push({
      date: _isoToday(),
      time: tStr,
      startedAt: payload.startedAt || tStr,
      deadline: winInfo.deadline,
      isLate,
      status: isLate ? 'Просрочено' : 'Выполнено',
      totalSteps: items.length || (blk === 'Открытие' ? 8 : blk === 'День' ? 6 : 14),
      block: blk,
      who: payload.userName || 'Бариста',
      problems: probs.length,
      photos: phs
    });
    appendAudit(
      db,
      payload.userName || 'Бариста',
      'Сдан чек-лист «' + blk + '»',
      (isLate ? '⚠️ ПРОСРОЧЕНО (сдан в ' + tStr + ', дедлайн ' + winInfo.deadline + ')' : '✓ В срок (' + tStr + ', до ' + winInfo.deadline + ')') + ' · Шагов: ' + items.length + ' · Проблем: ' + probs.length
    );
    if (isLate && window.coffeeTelegram && window.coffeeTelegram.sendOverdueAlert) {
      window.coffeeTelegram.sendOverdueAlert({
        block: blk,
        time: tStr,
        deadline: winInfo.deadline,
        who: payload.userName || 'Бариста',
        location: db.location
      }).catch(() => {});
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
      db.incidents.unshift(newInc);
      if (window.coffeeTelegram) {
        window.coffeeTelegram.sendIncidentAlert(newInc).catch(() => {});
      }
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
  const periodPlan = Math.max(1, actDays || daysCount) * db.plan;

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
    finance: {
      revenue: revTotal, expenses: expTotal, profit: proTotal, prevProfit: prevRev - prevExp,
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
    if (pinArg) return window.coffeeAuth.verifyOwnerPin(pinArg);
    return window.coffeeAuth.isAuthorized('admin');
  }
  return false;
}
const OWNER_MUTATION_ACTIONS = /^(save_task|delete_task|reorder_task|admin_cash|delete_cash|add_expense|update_expense|delete_expense|resolve_incident|update_incident|delete_incident|save_setting|save_all_settings|save_announcement|delete_announcement|extend_deadline|save_block_windows|simulate_overdue|save_staff|delete_staff|save_service_audit|delete_service_audit|save_ttk|delete_ttk|save_shift_roster|save_checklist_blocks|add_checklist_block|delete_checklist_block|save_daily_plans|save_staff_pins|save_good_deed|delete_good_deed)$/;

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

/* CORS-безопасная отправка POST в Google Apps Script (text/plain не вызывает блокирующий OPTIONS preflight!) */
function _sendCorsSafePost(url, bodyObj) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj),
      signal: ac.signal
    }).then((r) => { clearTimeout(t); return r.json().catch(() => ({ ok: true })); })
      .catch(() => { clearTimeout(t); return { ok: false }; });
  } catch (_) {
    return Promise.resolve({ ok: false });
  }
}

/* Отправка облачного конверта синхронизации в лист Настройки, чтобы данные Терминала и Дашборда
   мгновенно синхронизировались между разными телефонами и ПК даже без ручного обновления Code.gs */
function _pushCloudSyncToSheet(pinArg) {
  try {
    const db = getUDB();
    window.coffeeEnsureV19Schema(db);
    const activePin = pinArg || db.adminPin || (function(){ try { return localStorage.getItem('coffee_illy_pin') || '1234'; } catch(e){ return '1234'; } })() || '1234';
    const env = _buildCloudSyncEnvelope(db);
    const envJson = JSON.stringify(env);
    /* 1. Записываем в лист Настройки */
    _sendCorsSafePost(window.COFFEE.API_URL, {
      action: 'save_setting',
      pin: activePin,
      id: 'CLOUD_SYNC_V17',
      value: envJson
    });
    /* 2. Записываем в системную строку __SYS_CONFIG_V19__ листа Задачи (читается всеми терминалами через get_checklists без PIN!) */
    const sysTaskPayload = {
      action: 'save_task',
      pin: activePin,
      id: '__SYS_CONFIG_V19__',
      block: 'Открытие',
      groupName: '__SYS__',
      title: '__SYS_SYNC__',
      instruction: envJson,
      photo: 'нет',
      responsible: activePin,
      active: 'да'
    };
    if (db.sysSyncRow && Number(db.sysSyncRow) >= 2) {
      sysTaskPayload.row = Number(db.sysSyncRow);
    }
    _sendCorsSafePost(window.COFFEE.API_URL, sysTaskPayload);
  } catch (_) {}
}

/* Извлечение системного пакета синхронизации __SYS_CONFIG_V19__ из массива задач, возвращаемого get_checklists или admin */
function _extractAndAbsorbSysTaskRow(tasksArr, db) {
  if (!Array.isArray(tasksArr)) return [];
  const cleanTasks = [];
  let sysEnv = null;
  let sysRow = null;
  let syncPin = null;
  tasksArr.forEach((t) => {
    if (!t) return;
    if (t.id === '__SYS_CONFIG_V19__' || t.title === '__SYS_SYNC__') {
      let parsed = null;
      if (t.instruction) {
        try { parsed = JSON.parse(t.instruction); } catch (_) {}
      }
      if (parsed && (!sysEnv || Number(parsed.ts || 0) >= Number(sysEnv.ts || 0))) {
        sysEnv = parsed;
        if (t.row) sysRow = Number(t.row);
        if (t.responsible) syncPin = String(t.responsible).trim();
      } else if (!sysRow && t.row) {
        sysRow = Number(t.row);
      }
      return;
    }
    cleanTasks.push(t);
  });
  if (sysRow && db) db.sysSyncRow = sysRow;
  if (syncPin && db) db.adminPin = syncPin;
  if (sysEnv && typeof sysEnv === 'object' && db) {
    const now = Date.now();
    const recentlyMutated = db.lastLocalMutationAt && (now - db.lastLocalMutationAt < 5000);
    if (!recentlyMutated) {
      if (sysEnv.location) db.location = sysEnv.location;
      if (sysEnv.plan > 0) db.plan = Number(sysEnv.plan);
      if (sysEnv.woNorm != null) db.woNorm = Number(sysEnv.woNorm);
      if (Array.isArray(sysEnv.checklistBlocks) && sysEnv.checklistBlocks.length) {
        db.checklistBlocks = sysEnv.checklistBlocks;
        db.blocks = db.checklistBlocks.filter((b) => b && b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
      }
      if (sysEnv.dailyPlans && typeof sysEnv.dailyPlans === 'object') {
        db.dailyPlans = sysEnv.dailyPlans;
      }
      if (sysEnv.deadlineExtensions && typeof sysEnv.deadlineExtensions === 'object') {
        db.deadlineExtensions = sysEnv.deadlineExtensions;
      }
      if (sysEnv.overdueIncidentsCreated && typeof sysEnv.overdueIncidentsCreated === 'object') {
        db.overdueIncidentsCreated = sysEnv.overdueIncidentsCreated;
      }
      if (Array.isArray(sysEnv.staff) && sysEnv.staff.length) {
        db.staff = sysEnv.staff;
      }
      if (Array.isArray(sysEnv.announcements) && sysEnv.announcements.length) {
        db.announcements = sysEnv.announcements;
      }
      if (Array.isArray(sysEnv.ttk) && sysEnv.ttk.length) {
        db.ttk = sysEnv.ttk;
      }
      if (sysEnv.shiftRoster && typeof sysEnv.shiftRoster === 'object') {
        db.shiftRoster = sysEnv.shiftRoster;
      }
      if (Array.isArray(sysEnv.checklists)) {
        sysEnv.checklists.forEach((chk) => {
          if (!chk || !chk.date || !chk.block) return;
          const ex = (db.checklists || []).some((x) => x.date === chk.date && x.block === chk.block);
          if (!ex) db.checklists.push(chk);
        });
      }
      if (Array.isArray(sysEnv.cash)) {
        sysEnv.cash.forEach((sc) => {
          if (!sc || !sc.date) return;
          const loc = (db.cash || []).find((x) => x.date === sc.date);
          if (!loc) db.cash.push(sc);
          else Object.assign(loc, sc);
        });
      }
      if (Array.isArray(sysEnv.incidents)) {
        sysEnv.incidents.forEach((inc) => {
          if (!inc || !inc.id || (db.deletedIncidents && db.deletedIncidents[inc.id])) return;
          const ex = (db.incidents || []).find((x) => x.id === inc.id);
          if (!ex) db.incidents.unshift(inc);
          else Object.assign(ex, inc);
        });
      }
      saveUDB(db);
    }
  }
  return window.coffeeNormalizeTasksTimeline(cleanTasks);
}

function _triggerBackgroundSync(qPin, forceNow, focusDate) {
  const now = Date.now();
  if (_bgSyncInFlight || (!forceNow && (now - _lastBgSyncAt < 3500))) return;
  _bgSyncInFlight = true;
  _lastBgSyncAt = now;
  const pinToUse = qPin || (function(){ try { return localStorage.getItem('coffee_illy_pin') || '1234'; } catch(e){ return '1234'; } })() || '1234';
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
      window.coffeeBus.emit('server_sync', { ts: Date.now() });
    }
  }).catch(() => {
    _bgSyncInFlight = false;
  });
}

window.coffeeFetch = async function (url, opt, ms, tries) {
  opt = opt || {};
  const isPost = opt.method === 'POST';

  if (isPost) {
    let payload = {};
    try { payload = JSON.parse(opt.body || '{}'); } catch (_) {}
    if (OWNER_MUTATION_ACTIONS.test(payload.action || '')) {
      const activePin = payload.pin || (function(){ try { return localStorage.getItem('coffee_illy_pin') || ''; } catch(e){ return ''; } })();
      if (!isPinAuthorized(activePin)) {
        return { ok: false, error: 'PIN_REQUIRED: Доступ к изменению данных разрешён только владельцу по коду' };
      }
    }
    /* 1. Мгновенно сохраняем изменение в локальном Permanent Owner Vault (< 1 мс) и оповещаем все вкладки */
    applyLocalMutation(payload);
    window.coffeeCache.invalidate('all');
    window.coffeeBus.emit('mutation', { action: payload.action || '' });

    /* 2. Отправляем в Google Apps Script в совместимом формате text/plain (без CORS-блокировки) + пушим конверт синхронизации */
    const a = payload.action || '';
    if (a === 'batch_submit_cash' && Array.isArray(payload.days)) {
      payload.days.forEach((dItem) => {
        _sendCorsSafePost(url, Object.assign({ action: 'submit_cash' }, dItem, { writeOffs: dItem.writeoff || dItem.writeOffs || 0 }));
      });
    } else if (a === 'report_standalone_incident') {
      _sendCorsSafePost(url, {
        action: 'submit_checklist',
        block: payload.block || 'Инфо',
        userName: payload.userName || 'Бариста',
        items: [{
          title: payload.step || payload.incType || 'Проблема',
          comment: payload.text || '',
          priority: payload.priority || 'Критично',
          responsible: payload.responsible || 'Техник',
          isIncident: true,
          photo_url: payload.photo || ''
        }]
      });
    } else if (a === 'submit_checklist') {
      /* Очищаем тяжёлые дубликаты base64 перед сетевой отправкой, чтобы Apps Script не сбрасывал по лимиту размера */
      const netPayload = Object.assign({}, payload, {
        items: (payload.items || []).map((it) => ({
          id: it.id, title: it.title, status: it.status, isIncident: !!it.isIncident,
          incType: it.incType || '', priority: it.priority || 'Терпит',
          comment: it.comment || '', responsible: it.responsible || '',
          photo_url: it.photo_url || ''
        }))
      });
      _sendCorsSafePost(url, netPayload);
    } else {
      _sendCorsSafePost(url, payload);
    }
    _pushCloudSyncToSheet(payload.pin);
    return { ok: true, local: true };
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
      if (Array.isArray(srvRes.tasks) && srvRes.tasks.length > 0) {
        const cleaned = _extractAndAbsorbSysTaskRow(srvRes.tasks, db);
        srvRes.tasks = cleaned;
        absorbServerData(url, srvRes);
        if (cleaned.length > 0) db.tasks = cleaned;
      }
      if (srvRes.deadlineExtensions) {
        db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, srvRes.deadlineExtensions);
      }
      if (Array.isArray(srvRes.announcements)) {
        db.announcements = srvRes.announcements;
      }
      if (Array.isArray(srvRes.staff)) {
        db.staff = srvRes.staff;
      }
      if (srvRes.openStart) db.openStart = srvRes.openStart;
      if (srvRes.deadline) db.deadline = srvRes.deadline;
      if (srvRes.dayStart) db.dayStart = srvRes.dayStart;
      if (srvRes.dayDeadline) db.dayDeadline = srvRes.dayDeadline;
      if (srvRes.closeStart) db.closeStart = srvRes.closeStart;
      if (srvRes.closeDeadline) db.closeDeadline = srvRes.closeDeadline;
      saveUDB(db);
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
