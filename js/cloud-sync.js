/* Coffee Illy v94.0 — Fast Bidirectional Cloud Sync (Google Sheets + Drive Photos + Offline Outbox + Telegram) */
(function () {
  const CFG = window.COFFEE_CONFIG || {};
  const API_URL = CFG.API_URL || '';
  const OUTBOX_KEY = 'coffee_illy_v93_outbox';
  const SESSION_KEY = 'coffee_illy_v93_session';


  // v97.0.0: Антигоночный счётчик локальных мутаций и экспоненциальная задержка outbox
  let _localMutationSeq = 0;
  let _pullInFlight = false;

  function computeBackoffMs(attempt, baseMs, maxMs) {
    const base = Number(baseMs) || (window.COFFEE_CONFIG && window.COFFEE_CONFIG.OFFLINE_BASE_DELAY_MS) || 1500;
    const cap = Number(maxMs) || 60000;
    const exp = Math.min(cap, base * Math.pow(2, Math.max(0, Number(attempt) || 0)));
    return Math.round(exp);
  }

  function markLocalMutation() {
    _localMutationSeq++;
    return _localMutationSeq;
  }

  function localISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function localHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function setSession(patch) {
    const cur = Object.assign(getSession(), patch || {});
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(cur)); } catch (_) {}
    return cur;
  }

  const FAILED_OUTBOX_KEY = 'coffee_illy_v93_failed_outbox';
  const FINANCIAL_ACTIONS = new Set([
    'submit_cash', 'batch_submit_cash', 'add_expense', 'delete_expense',
    'save_inventory', 'restock_inventory', 'writeoff_inventory', 'delete_inventory'
  ]);
  let _idbDb = null;
  let _outboxMem = null;

  function openOutboxIdb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (_idbDb) return Promise.resolve(_idbDb);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('coffee_illy_outbox_v1', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => { _idbDb = req.result; resolve(_idbDb); };
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  function persistIdbKey(key, val) {
    openOutboxIdb().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
      } catch (_) {}
    }).catch(() => {});
  }

  // Hydrate memory cache from IndexedDB on startup if available
  openOutboxIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(OUTBOX_KEY);
      req.onsuccess = () => {
        if (Array.isArray(req.result) && req.result.length) {
          const lsArr = readOutbox();
          const seen = new Set(lsArr.map((x) => x && x.payload && x.payload.operationId).filter(Boolean));
          const merged = lsArr.slice();
          req.result.forEach((it) => {
            const oid = it && it.payload && it.payload.operationId;
            if (!oid || !seen.has(oid)) merged.push(it);
          });
          _outboxMem = merged;
        }
      };
    } catch (_) {}
  }).catch(() => {});

  function readOutbox() {
    if (Array.isArray(_outboxMem)) return _outboxMem.slice();
    try {
      const arr = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || [];
      _outboxMem = Array.isArray(arr) ? arr : [];
      return _outboxMem.slice();
    } catch (_) { return []; }
  }

  function writeOutbox(arr) {
    const list = Array.isArray(arr) ? arr.slice() : [];
    // Никогда не удаляем неподтверждённые финансовые операции автоматически;
    // при росте > 500 нефинансовых записей обрезаем только старые черновики/прогресс.
    const safeList = list.length > 500
      ? list.filter((it, idx) => FINANCIAL_ACTIONS.has(it && it.action) || idx >= list.length - 500)
      : list;
    _outboxMem = safeList;
    persistIdbKey(OUTBOX_KEY, safeList);
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(safeList)); } catch (_) {
      // При QuotaExceededError в localStorage (например, из-за фото base64) данные сохранены в IndexedDB
    }
  }

  function readFailedOutbox() {
    try { return JSON.parse(localStorage.getItem(FAILED_OUTBOX_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeFailedOutbox(arr) {
    const list = (Array.isArray(arr) ? arr : []).slice(-100);
    persistIdbKey(FAILED_OUTBOX_KEY, list);
    try { localStorage.setItem(FAILED_OUTBOX_KEY, JSON.stringify(list)); } catch (_) {}
  }

  async function gasGet(params) {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    const qs = Object.keys(params || {}).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const url = API_URL + (API_URL.indexOf('?') >= 0 ? '&' : '?') + qs + '&t=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function gasPost(action, payload) {
    if (!API_URL) return { ok: false, offline: true };
    const sess = getSession();
    const body = Object.assign({
      action: action,
      operationId: (payload && payload.operationId) || ('op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))
    }, payload || {});
    if (!body.sessionToken) body.sessionToken = sess.adminToken || sess.staffToken || '';
    if (!body.staffSessionToken && sess.staffToken) body.staffSessionToken = sess.staffToken;
    const r = await fetch(API_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  let _flushPromise = null;
  let _lastRttMs = 0;
  let _lastServerRev = '';
  let _syncCallbacks = null;
  let _pullPendingForce = false;

  function isRetryableServerError(errStr) {
    return /LOCK|BUSY|RATE_LIMIT|TIMEOUT|TEMPORARY|UNAVAILABLE|PIN_REQUIRED|STAFF_AUTH_REQUIRED|SESSION/i.test(String(errStr || ''));
  }

  async function flushOutbox(forceRetry) {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { flushed: 0, pending: readOutbox().length };
    if (_flushPromise) return _flushPromise;
    if (!readOutbox().length) return { flushed: 0, pending: 0 };
    const run = (async () => {
      let flushed = 0;
      const now = Date.now();
      const q = readOutbox();
      if (!q.length) return { flushed: 0, pending: 0 };
      const doneIds = new Set();
      const retryPatches = new Map();
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        const opId = (item.payload && item.payload.operationId) || (item.action + '_' + item.ts + '_' + i);
        if (!forceRetry && item.nextRetryAt && Number(item.nextRetryAt) > now) continue;
        try {
          const t0 = Date.now();
          const res = await gasPost(item.action, item.payload);
          _lastRttMs = Math.max(1, Date.now() - t0);
          if (res && res.ok === false) {
            const errMsg = String(res.error || 'SERVER_ERROR');
            const attempts = (Number(item.attempts) || 0) + 1;
            if (isRetryableServerError(errMsg) && attempts < 12) {
              retryPatches.set(opId, { attempts: attempts, nextRetryAt: Date.now() + computeBackoffMs(attempts), lastError: errMsg });
              continue;
            }
            // Не удаляем молча — переносим в очередь проблемных операций для ручной проверки
            const failedList = readFailedOutbox();
            failedList.push(Object.assign({}, item, { status: 'failed', attempts: attempts, lastError: errMsg, failedAt: Date.now() }));
            writeFailedOutbox(failedList);
            doneIds.add(opId);
            continue;
          }
          doneIds.add(opId);
          flushed++;
        } catch (err) {
          const attempts = (Number(item.attempts) || 0) + 1;
          if (attempts < 12 || FINANCIAL_ACTIONS.has(item.action)) {
            retryPatches.set(opId, { status: 'pending', attempts: attempts, nextRetryAt: Date.now() + computeBackoffMs(attempts), lastError: String((err && err.message) || err) });
          } else {
            const failedList = readFailedOutbox();
            failedList.push(Object.assign({}, item, { status: 'failed', attempts: attempts, lastError: String((err && err.message) || err), failedAt: Date.now() }));
            writeFailedOutbox(failedList);
            doneIds.add(opId);
          }
        }
      }
      const latest = readOutbox();
      const remaining = [];
      for (let i = 0; i < latest.length; i++) {
        const item = latest[i];
        const opId = (item.payload && item.payload.operationId) || (item.action + '_' + item.ts + '_' + i);
        if (doneIds.has(opId)) continue;
        if (retryPatches.has(opId)) {
          remaining.push(Object.assign({}, item, retryPatches.get(opId)));
        } else {
          remaining.push(item);
        }
      }
      writeOutbox(remaining);
      return { flushed: flushed, pending: remaining.length };
      window.CoffeeCloud = window.CoffeeCloudV93;
})();
    const p = run.finally(() => { if (_flushPromise === p) _flushPromise = null; });
    _flushPromise = p;
    return p;
  }

  function enqueueOp(action, payload) {
    markLocalMutation();
    if (!action) return;
    const opId = 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const q = readOutbox();
    q.push({ action: action, status: 'pending', payload: Object.assign({ operationId: opId }, payload || {}), ts: Date.now(), attempts: 0, nextRetryAt: 0 });
    writeOutbox(q);
    flushOutbox(true).then((res) => {
      if (res && res.flushed > 0) _lastServerRev = '';
      if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(!!(res && res.flushed > 0));
    }).catch(() => {});
  }

  async function uploadPhotoToDrive(opts) {
    const payload = {
      dataUri: opts.dataUri,
      userName: opts.userName || (getSession().staffName || 'Бариста'),
      block: opts.block || 'Смена',
      taskId: opts.taskId || '',
      kind: opts.kind || 'checklist',
      operationId: 'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enqueueOp('upload_photo', payload);
      return { ok: true, queued: true, url: '' };
    }
    try {
      const t0 = Date.now();
      const res = await gasPost('upload_photo', payload);
      _lastRttMs = Math.max(1, Date.now() - t0);
      if (res && res.ok) {
        return { ok: true, fileId: res.fileId || '', url: res.url || res.viewUrl || '', fileName: res.fileName || '' };
      }
      // If session expired or transient error, queue it
      if (res && /STAFF_AUTH_REQUIRED/i.test(String(res.error || ''))) {
        return { ok: false, error: res.error };
      }
      enqueueOp('upload_photo', payload);
      return { ok: true, queued: true, url: '' };
    } catch (err) {
      enqueueOp('upload_photo', payload);
      return { ok: true, queued: true, url: '', error: String(err && err.message || err) };
    }
  }

  async function authLogin(role, opts) {
    try {
      const payloadAuth = Object.assign({ role: role }, opts || {});
      if (payloadAuth.name) {
        if (!payloadAuth.staffName) payloadAuth.staffName = payloadAuth.name;
        if (!payloadAuth.userName) payloadAuth.userName = payloadAuth.name;
      }
      const res = await gasPost('auth_login', payloadAuth);
      if (res && res.ok === true && res.sessionToken) {
        const srvRole = String(res.role || role || '').toLowerCase();
        if (role === 'admin' && srvRole !== 'admin') {
          return { ok: false, error: 'FORBIDDEN: Требуются права владельца' };
        }
        if (role === 'admin') setSession({ adminToken: res.sessionToken });
        else setSession({ staffToken: res.sessionToken, staffName: res.staffName || (opts && opts.name) || '' });
        if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
      }
      return res || { ok: false, error: 'Пустой ответ сервера авторизации' };
    } catch (e) {
      return { ok: false, offline: true, error: String(e && e.message || e) };
    }
  }

  async function authLogout(role) {
    const cur = getSession();
    const tok = role === 'admin' ? cur.adminToken : cur.staffToken;
    try {
      if (tok && API_URL && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        await gasPost('auth_logout', { role: role || 'staff', sessionToken: tok });
      }
    } catch (_) {}
    if (role === 'admin') setSession({ adminToken: '' });
    else setSession({ staffToken: '', staffName: '' });
    return { ok: true };
  }

  async function changeStaffPin(opts) {
    const o = opts || {};
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, offline: true, error: 'Нет подключения к интернету. Смена PIN требует связи с сервером.' };
    }
    try {
      const res = await gasPost('change_staff_pin', {
        staffName: o.staffName || o.name || (getSession().staffName || ''),
        oldPin: o.oldPin || '',
        newPin: o.newPin || '',
        resetCode: o.resetCode || ''
      });
      if (res && res.ok === true) {
        setSession({ staffToken: '', staffName: '' });
      }
      return res || { ok: false, error: 'Пустой ответ сервера' };
    } catch (e) {
      return { ok: false, offline: true, error: String(e && e.message || e) };
    }
  }

  function mergeServerIntoState(state, data) {
    if (!data || typeof data !== 'object') return false;
    let changed = false;
    if (data.location) { state.location = String(data.location); changed = true; }
    if (Number(data.plan) > 0) { state.plan = Number(data.plan); changed = true; }
    if (data.photoAll !== undefined) {
      state.photoAll = String(data.photoAll).toLowerCase() === 'да' || data.photoAll === true;
      changed = true;
    }
    if (Array.isArray(data.settings) && data.settings.length) {
      const sMap = {};
      data.settings.forEach((x) => { if (x && x.id) sMap[String(x.id).toUpperCase()] = x.value; });
      if (sMap.LOCATION) state.location = String(sMap.LOCATION);
      if (Number(sMap.PLAN) > 0) state.plan = Number(sMap.PLAN);
      if (Number(sMap.MIN_AVG_CHECK) > 0) state.minAvgCheck = Number(sMap.MIN_AVG_CHECK);
      if (Number(sMap.PLAN_CHECKS) > 0) state.planChecks = Number(sMap.PLAN_CHECKS);
      if (sMap.WO_NORM !== undefined && Number(sMap.WO_NORM) >= 0) state.woNorm = Number(sMap.WO_NORM);
      if (sMap.INIT_COUNTER !== undefined && Number(sMap.INIT_COUNTER) >= 0) state.initCounter = Number(sMap.INIT_COUNTER);
      if (sMap.PHOTO_ALL !== undefined) state.photoAll = String(sMap.PHOTO_ALL).toLowerCase() === 'да';
      changed = true;
    }
    const rawBlocks = Array.isArray(data.checklistBlocks) && data.checklistBlocks.length
      ? data.checklistBlocks
      : (Array.isArray(data.blocks) && data.blocks.length && typeof data.blocks[0] === 'object' ? data.blocks : null);
    if (rawBlocks) {
      state.blocks = rawBlocks.map((b, idx) => ({
        id: b.id || ('blk_' + idx),
        name: b.name || b.block || '',
        openTime: b.openTime || b.start || '08:00',
        deadline: b.deadline || b.end || '22:00',
        isCash: !!(b.isCash || String(b.name || '').toLowerCase() === 'касса'),
        active: b.active !== false && String(b.active || 'да').toLowerCase() !== 'нет',
        assignee: String(b.assignee || '').trim(),
        scheduleType: String(b.scheduleType || 'daily').trim(),
        scheduleDays: Array.isArray(b.scheduleDays) ? b.scheduleDays.slice() : [],
        scheduleDate: String(b.scheduleDate || '').trim()
      })).filter((b) => b.name);
      changed = true;
    }
    if (data.deadlineExtensions && typeof data.deadlineExtensions === 'object') {
      const todayKey = localISO();
      const nextExt = {};
      Object.keys(data.deadlineExtensions).forEach((k) => {
        const val = data.deadlineExtensions[k];
        if (!val || typeof val !== 'object') return;
        const colonIdx = k.indexOf(':');
        if (colonIdx === 10 && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(0, 10))) {
          const dtPart = k.slice(0, 10);
          const blkName = k.slice(11);
          if (dtPart === todayKey && blkName) nextExt[blkName] = Object.assign({}, val);
        } else if (k) {
          nextExt[k] = Object.assign({}, val);
        }
      });
      state.extensions = nextExt;
      changed = true;
    }
    if (Array.isArray(data.tasks) && data.tasks.length) {
      const clean = data.tasks.filter((t) => t && t.title && !String(t.id || '').startsWith('__SYS'));
      if (clean.length) {
        const mapped = clean.map((t) => ({
          id: t.id || ('t_' + Math.random().toString(36).slice(2, 6)),
          block: t.block || 'Открытие',
          group: t.groupName || t.group || '',
          title: t.title || '',
          instruction: t.instruction || '',
          photo: String(t.photo || 'нет').toLowerCase() === 'да' || t.photo === true,
          owner: t.responsible || t.owner || 'Бариста',
          active: String(t.active || 'да').toLowerCase() !== 'нет'
        }));
        const seen = new Map();
        const deduped = [];
        mapped.forEach((t) => {
          const normTitle = String(t.title || '')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, ' ')
            .replace(/\bфото\b/gi, ' ')
            .replace(/[+\-—·•:().,!?\d]+/g, ' ')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          const key = String(t.block || '').trim().toLowerCase() + '|' + normTitle;
          if (!normTitle || !seen.has(key)) {
            seen.set(key, deduped.length);
            deduped.push(t);
          } else {
            const idx0 = seen.get(key);
            const prev = deduped[idx0];
            if ((t.photo && !prev.photo) || (t.instruction.length > prev.instruction.length + 30 && t.photo === prev.photo)) {
              deduped[idx0] = t;
            }
          }
        });
        state.tasks = deduped;
        changed = true;
      }
    }
    if (Array.isArray(data.cash)) {
      state.cash = data.cash.map((c) => {
        const rev = Number(c.revenue || c.total || ((Number(c.cash) || 0) + (Number(c.card) || 0)) || 0);
        const who = c.barista || c.who || 'Бариста';
        return {
          date: String(c.date || '').slice(0, 10),
          who: who,
          barista: who,
          revenue: rev,
          total: rev,
          cash: Number(c.cash || 0),
          card: Number(c.card || 0),
          checks: Number(c.checks || 0),
          writeoff: Number(c.writeoff || 0),
          topItems: c.topItems || '',
          coffeeQty: Number(c.coffeeQty || 0),
          counterStart: c.counterStart != null ? c.counterStart : null,
          counterEnd: c.counterEnd != null ? c.counterEnd : null,
          csvHashes: Array.isArray(c.csvHashes) ? c.csvHashes : [],
          products: Array.isArray(c.products) ? c.products : [],
          avgCheck: Number(c.avgCheck || c.avg || (Number(c.checks) > 0 ? Math.round(rev / Number(c.checks)) : 0))
        };
      }).filter((c) => c.date);
      changed = true;
    }
    if (Array.isArray(data.expenses)) {
      state.expenses = data.expenses.map((x) => ({
        id: x.id || ('e_' + Math.random().toString(36).slice(2, 6)),
        date: String(x.date || '').slice(0, 10),
        category: x.category || 'Прочее',
        amount: Number(x.amount || 0),
        comment: x.comment || '',
        who: x.who || ''
      }));
      changed = true;
    }
    if (Array.isArray(data.incidents)) {
      state.incidents = data.incidents.map((x) => {
        const step = x.step || x.zone || 'Поломка';
        return {
          id: x.id || ('INC-' + Math.random().toString(36).slice(2, 6)),
          date: String(x.date || '').slice(0, 10),
          time: x.time || '',
          block: x.block || '',
          step: step,
          zone: step,
          text: x.text || x.comment || '',
          priority: x.priority || 'Терпит',
          status: x.status || 'Новая проблема',
          who: x.who || '',
          owner: x.owner || x.responsible || 'Администратор',
          photoUrl: x.photoUrl || x.photo || ''
        };
      });
      changed = true;
    }
    const rawLogs = Array.isArray(data.checklistsLog) ? data.checklistsLog : (Array.isArray(data.checklists) ? data.checklists : null);
    if (rawLogs) {
      state.checklists = rawLogs.map((c) => {
        let phList = [];
        if (Array.isArray(c.photos)) {
          phList = c.photos.map((p) => (typeof p === 'string' ? p : (p && p.url ? p.url : ''))).filter(Boolean);
        } else if (typeof c.photos === 'string' && c.photos.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(c.photos);
            if (Array.isArray(parsed)) phList = parsed.map((p) => (typeof p === 'string' ? p : (p && p.url ? p.url : ''))).filter(Boolean);
          } catch (_) {}
        } else if (c.photoUrl) {
          phList = [c.photoUrl];
        }
        return {
          date: String(c.date || '').slice(0, 10),
          time: c.time || '',
          block: c.block || '',
          who: c.who || '',
          problems: Number(c.problems || 0),
          deadline: c.deadline || '',
          status: c.status || 'Выполнено',
          isLate: !!c.isLate,
          done: Number(c.done || 0),
          total: Number(c.total || 0),
          photos: phList
        };
      });
      changed = true;
    }
    if (Array.isArray(data.staff) && data.staff.length) {
      const prevMap = {};
      (state.staff || []).forEach((s) => { prevMap[s.name] = s; });
      state.staff = data.staff.map((s, idx) => {
        const prev = prevMap[s.name] || {};
        return Object.assign({}, prev, {
          id: s.id || prev.id || ('st_' + idx),
          name: s.name,
          role: s.role || prev.role || 'Бариста',
          shift: s.shift || prev.shift || '08:00–20:00',
          tgId: (s.tgId !== undefined && s.tgId !== null) ? String(s.tgId) : (prev.tgId || ''),
          active: s.active !== false && String(s.active || 'да').toLowerCase() !== 'нет',
          pin: '',
          pinIsDefault: prev.pinIsDefault !== false
        });
      });
      changed = true;
    }
    if (Array.isArray(data.ttk) && data.ttk.length) {
      state.ttk = data.ttk.map((k) => ({
        id: k.id || ('ttk_' + Math.random().toString(36).slice(2, 6)),
        name: k.name || '',
        vol: k.vol || k.volume || '250 мл (M)',
        cat: k.cat || k.category || 'Классика',
        price: Number(k.price || 0),
        avgPrice: Number(k.avgPrice != null ? k.avgPrice : (k.price || 0)),
        cost: Number(k.cost || 0),
        recipe: k.recipe || '',
        serve: k.serve || k.serving || ''
      }));
      changed = true;
    }
    if (data.dailyPlans && typeof data.dailyPlans === 'object') {
      const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
      const prevByDay = {};
      (state.plans || []).forEach((p) => { prevByDay[p.day] = p; });
      state.plans = days.map((d) => {
        const p = data.dailyPlans[d] || {};
        const prev = prevByDay[d] || {};
        const rev = Number(p.revenue || p.rev || prev.rev || state.plan || 2200);
        const avg = Number(p.avgCheck || p.avg || prev.avg || 35);
        return {
          day: d,
          rev: rev,
          revenue: rev,
          avg: avg,
          avgCheck: avg,
          checks: Number(p.checks || prev.checks || 75),
          roster: (data.shiftRoster && data.shiftRoster[d] !== undefined ? data.shiftRoster[d] : (p.roster || prev.roster || ''))
        };
      });
      changed = true;
    }
    if (data.userActiveState && typeof data.userActiveState === 'object') {
      state.liveProgress = state.liveProgress || {};
      Object.keys(data.userActiveState).forEach((k) => {
        const rec = data.userActiveState[k];
        if (rec && rec.block && Number(rec.total) > 0) {
          const who = rec.userName || k.split(':')[0] || k;
          state.liveProgress[who] = { block: rec.block, done: Number(rec.done || 0), total: Number(rec.total || 0), updatedAt: rec.updatedAt || '' };
        }
      });
      changed = true;
    }
    if (data.staffPresence && typeof data.staffPresence === 'object') {
      state.staffPresence = data.staffPresence;
      changed = true;
    }
    if (data.tgConfiguredOnServer !== undefined) {
      state.tgConfiguredOnServer = !!data.tgConfiguredOnServer;
      changed = true;
    }
    if (data.tgChat !== undefined) {
      state.tgChat = String(data.tgChat || '');
      changed = true;
    }
    if (data.webappUrl !== undefined) {
      state.webappUrl = String(data.webappUrl || '');
      changed = true;
    }
    if (data.autopilotEnabled !== undefined) {
      state.autopilotEnabled = !!data.autopilotEnabled;
      changed = true;
    }
    if (Array.isArray(data.salesLog)) {
      state.salesLog = data.salesLog.map((x) => ({
        date: String(x.date || '').slice(0, 10),
        shift: x.shift || '',
        barista: x.barista || 'Бариста',
        name: x.name || '',
        kind: (String(x.kind||'').toLowerCase()==='coffee'?'Кофе':(String(x.kind||'').toLowerCase()==='non_coffee'?'Не-кофе':(x.kind||'Прочее'))),
        price: Number(x.price || 0),
        qty: Number(x.qty || 0),
        sum: Number(x.sum || ((Number(x.price || 0)) * (Number(x.qty || 0))))
      })).filter((x) => x.date && x.name && x.qty > 0);
      changed = true;
    }
    if (Array.isArray(data.inventory)) {
      state.inventory = data.inventory.map((it, idx) => ({
        id: it.id || ('inv_' + idx),
        name: it.name || '',
        category: it.category || 'Сырьё',
        unit: it.unit || 'г',
        stock: Number(it.stock || 0),
        minStock: Number(it.minStock || 0),
        updatedAt: String(it.updatedAt || '').slice(0, 10)
      })).filter((it) => it.name);
      changed = true;
    }
    if (Array.isArray(data.inventoryMoves)) {
      state.inventoryMoves = data.inventoryMoves.map((m) => ({
        id: m.id || ('mv_' + Math.random().toString(36).slice(2, 6)),
        itemId: m.itemId || '',
        name: m.name || '',
        category: m.category || 'Сырьё',
        type: m.type || 'edit',
        delta: Number(m.delta || 0),
        stockAfter: Number(m.stockAfter || 0),
        unit: m.unit || 'шт',
        date: String(m.date || '').slice(0, 10),
        time: m.time || '',
        actor: m.actor || 'Администратор',
        note: m.note || ''
      }));
      changed = true;
    }
    if (Array.isArray(data.expiryItems)) {
      state.expiryItems = data.expiryItems.map((x) => ({
        id: x.id || ('exp_' + Math.random().toString(36).slice(2, 6)),
        title: x.title || x.name || '',
        category: x.category || 'Бар',
        openedAtMs: Number(x.openedAtMs || 0),
        expiresAtMs: Number(x.expiresAtMs || 0),
        date: String(x.date || (x.openedAtMs ? new Date(Number(x.openedAtMs)).toISOString().slice(0, 10) : '')).slice(0, 10),
        expiresDate: String(x.expiresDate || (x.expiresAtMs ? new Date(Number(x.expiresAtMs)).toISOString().slice(0, 10) : '')).slice(0, 10),
        status: x.status || 'active',
        who: x.who || x.openedBy || ''
      }));
      changed = true;
    }
    if (Array.isArray(data.auditLog) && data.auditLog.length) {
      state.auditLog = data.auditLog.map((a) => ({
        date: String(a.date || '').slice(0, 10),
        time: a.time || '',
        actor: a.actor || 'Система',
        text: a.text || a.action || '',
        rev: a.rev || state.cloudRev || state.rev || 1
      }));
      changed = true;
    }
    if (Array.isArray(data.announcements)) {
      state.announcements = data.announcements;
      changed = true;
    }
    if (data.serverTime) {
      state.serverTime = String(data.serverTime);
      changed = true;
    }
    return changed;
  }

  function dispatchStateChange(st, actor, desc) {
    if (!desc || !st) return;
    if (desc.indexOf('Сдан чек-лист') === 0 && st.checklists && st.checklists.length) {
      const last = st.checklists[0];
      const items = Array.isArray(last.items) && last.items.length
        ? last.items
        : (Array.isArray(last.photos) ? last.photos.map((u, idx) => ({ title: 'Фото ' + (idx + 1), photo_url: u, isIncident: false })) : []);
      enqueueOp('submit_checklist', {
        block: last.block,
        who: last.who || actor,
        userName: last.who || actor,
        date: last.date || localISO(),
        deadline: last.deadline || '22:00',
        isLate: !!last.isLate,
        items: items
      });
    } else if (desc.indexOf('Закрыта касса') === 0 && st.cash && st.cash.length) {
      const last = st.cash[0];
      const rev = Number(last.revenue || last.total || ((Number(last.cash) || 0) + (Number(last.card) || 0)));
      enqueueOp('submit_cash', {
        date: last.date || localISO(),
        who: last.barista || last.who || actor,
        userName: last.barista || last.who || actor,
        total: rev,
        revenue: rev,
        cash: Number(last.cash || 0),
        card: Number(last.card || 0),
        checks: Number(last.checks || 0),
        writeoff: Number(last.writeoff || 0)
      });
    } else if (desc.indexOf('Проблема:') === 0 || desc.indexOf('Внеплановая поломка:') === 0) {
      const inc = st.incidents && st.incidents[0];
      if (inc) enqueueOp('report_standalone_incident', {
        id: inc.id,
        block: inc.block || '',
        step: inc.step || inc.zone || 'Поломка',
        zone: inc.zone || inc.step || 'Поломка',
        comment: inc.text || '',
        text: inc.text || '',
        priority: inc.priority || 'Терпит',
        who: inc.who || actor,
        userName: inc.who || actor,
        date: inc.date || localISO(),
        photoUrl: inc.photoUrl || '',
        photo_url: inc.photoUrl || '',
        photo: inc.photoUrl || ''
      });
    } else if (desc.indexOf('Решён инцидент') === 0) {
      enqueueOp('update_incident', { id: desc.replace('Решён инцидент ', '').trim(), status: 'Решена' });
    } else if (desc.indexOf('Добавлен расход') === 0 && st.expenses && st.expenses.length) {
      const e = st.expenses[0];
      enqueueOp('add_expense', { id: e.id, date: e.date || localISO(), category: e.category, amount: e.amount, comment: e.comment, who: e.who || actor });
    } else if (desc.indexOf('Удалён расход') === 0) {
      enqueueOp('delete_expense', { id: desc.replace('Удалён расход ', '').trim() });
    } else if (desc.indexOf('Обновлены настройки точки') === 0) {
      enqueueOp('save_all_settings', { items: [
        { id: 'LOCATION', value: String(st.location || 'Кофейня №1') },
        { id: 'WO_NORM', value: String(st.woNorm || 15) },
        { id: 'INIT_COUNTER', value: String(st.initCounter || 600) },
        { id: 'PHOTO_ALL', value: st.photoAll ? 'да' : 'нет' }
      ] });
    } else if (desc.indexOf('Окно «') === 0 || desc.indexOf('Создан блок') === 0) {
      enqueueOp('save_checklist_blocks', { blocks: st.blocks || [] });
    } else if (desc.indexOf('Открыт блок') === 0) {
      const m = desc.match(/«([^»]+)»/);
      if (m) enqueueOp('extend_deadline', { date: localISO(), block: m[1], openFrom: '00:00', until: '23:59', reason: 'Открыто владельцем' });
    } else if (desc.indexOf('Обновлён план') === 0 && st.plans) {
      const plansObj = {};
      const rosterObj = {};
      (st.plans || []).forEach((p) => {
        plansObj[p.day] = {
          revenue: Number(p.rev || p.revenue || st.plan || 2200),
          avgCheck: Number(p.avg || p.avgCheck || st.minAvgCheck || 35),
          checks: Number(p.checks || st.planChecks || 75)
        };
        if (p.roster !== undefined) rosterObj[p.day] = String(p.roster || '');
      });
      enqueueOp('save_daily_plans', { plans: plansObj, roster: rosterObj });
    /* P0.2: смена PIN выполняется только напрямую через changeStaffPin() без локальной очереди */
    } else if (desc.indexOf('Привязан Telegram ID') === 0) {
      const s = (st.staff || []).find((x) => x.name === actor);
      if (s && s.tgId) enqueueOp('bind_telegram_user', { name: s.name, tgId: s.tgId });
    } else if (desc.indexOf('Обновлён сотрудник') === 0) {
      const nm = desc.replace('Обновлён сотрудник ', '').trim();
      const s = (st.staff || []).find((x) => x.name === nm);
      if (s) {
        enqueueOp('save_staff', { id: s.id, name: s.name, role: s.role, shop: s.shop || st.location || 'Кофейня №1', active: s.active === false ? 'нет' : 'да', tgId: s.tgId || '' });
        if (s.pin) enqueueOp('save_staff_pins', { pins: [{ name: s.name, pin: s.pin }] });
      }
    } else if (desc.indexOf('Обновлена ТТК') === 0) {
      const nm = desc.replace('Обновлена ТТК ', '').trim();
      const k = (st.ttk || []).find((x) => x.name === nm);
      if (k) enqueueOp('save_ttk', Object.assign({}, k, {
        volume: k.vol || k.volume || '250 мл (M)',
        category: k.cat || k.category || 'Классика',
        serving: k.serve || k.serving || '',
        avgPrice: k.avgPrice != null ? Number(k.avgPrice) : Number(k.price || 0)
      }));
    } else if (desc.indexOf('Добавлена задача') === 0 && st.tasks && st.tasks.length) {
      const t = st.tasks[st.tasks.length - 1];
      enqueueOp('save_task', Object.assign({}, t, { photo: t.photo ? 'да' : 'нет', responsible: t.owner || 'Бариста', active: 'да' }));
    } else if (desc.indexOf('Обновлена задача ') === 0) {
      const tid = desc.replace('Обновлена задача ', '').trim();
      const t = (st.tasks || []).find((x) => String(x.id) === tid);
      if (t) enqueueOp('save_task', Object.assign({}, t, { photo: t.photo ? 'да' : 'нет', responsible: t.owner || 'Бариста', active: t.active === false ? 'нет' : 'да' }));
    } else if (desc.indexOf('Удалена задача ') === 0) {
      const tid = desc.replace('Удалена задача ', '').trim();
      if (tid) enqueueOp('delete_task', { id: tid });
    } else if (desc.indexOf('Возвращено окно «') === 0) {
      const m = desc.match(/«([^»]+)»/);
      if (m) enqueueOp('extend_deadline', { date: localISO(), block: m[1], clear: true });
    } else if (desc.indexOf('Удалён сотрудник ') === 0) {
      const nm = desc.replace('Удалён сотрудник ', '').trim();
      if (nm) enqueueOp('delete_staff', { name: nm });
    } else if (desc.indexOf('Удалена ТТК ') === 0) {
      const kid = desc.replace('Удалена ТТК ', '').trim();
      if (kid) enqueueOp('delete_ttk', { id: kid });
    }
  }

  let _lastActive = Date.now();
  let _pollTimer = null;

  function startCloudLoop(opts) {
    const mode = (opts && opts.mode) || 'terminal';
    const getState = opts && opts.getState;
    const onSynced = opts && opts.onSynced;
    const onAuthRequired = opts && opts.onAuthRequired;

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    try {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
    } catch (_) {}

    async function pullNow(forceFull) {
      if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        if (getState) {
          const stOff = getState();
          stOff.liveConnected = false;
          stOff.pendingSyncCount = readOutbox().length;
        }
        return null;
      }
      if (_pullInFlight) {
        if (forceFull) _pullPendingForce = true;
        return { skipped: true, inFlight: true };
      }
      _pullInFlight = true;
      try {
        const fl = await flushOutbox(!!forceFull);
        if (fl && fl.flushed > 0) _lastServerRev = '';
        if (fl && fl.pending > 0 && !forceFull) {
          if (getState) {
            const stP = getState();
            stP.pendingSyncCount = fl.pending;
          }
          return { changed: false, pending: fl.pending };
        }
        const seqBefore = _localMutationSeq;
        const t0 = Date.now();
        const revRes = await gasGet({ action: 'get_rev', sinceRev: _lastServerRev });
        _lastRttMs = Math.max(1, Date.now() - t0);
        const srvRev = revRes && (revRes.rev != null ? String(revRes.rev) : '');
        if (!forceFull && srvRev && srvRev === _lastServerRev) {
          if (getState) {
            const stOk = getState();
            stOk.liveConnected = true;
            stOk.syncError = '';
            stOk.pendingSyncCount = readOutbox().length;
          }
          return { changed: false, rev: srvRev };
        }

        let data = null;
        const sess = getSession();
        if (mode === 'owner' && sess.adminToken) {
          data = await gasPost('admin', { sessionToken: sess.adminToken });
          if (data && data.ok === false && /PIN_REQUIRED|PIN_INVALID|FORBIDDEN|SETUP_REQUIRED/i.test(String(data.error || ''))) {
            setSession({ adminToken: '' });
            if (onAuthRequired) onAuthRequired(String(data.error || 'PIN_REQUIRED'));
            data = await gasGet({ action: 'get_checklists', nocache: '1' });
          }
        } else if (mode === 'owner' && !sess.adminToken) {
          if (onAuthRequired) onAuthRequired('PIN_REQUIRED');
          data = await gasGet({ action: 'get_checklists', nocache: '1' });
        } else if (mode === 'terminal' && sess.staffToken) {
          data = await gasPost('staff_bootstrap', { sessionToken: sess.staffToken });
        } else {
          data = await gasGet({ action: 'get_checklists', nocache: '1' });
        }
        // Anti-race guard: if user mutated local state while pull was in flight, do NOT clobber local edit
        if (_localMutationSeq !== seqBefore) {
          _pullPendingForce = true;
          return { skipped: true, reason: 'local_mutation_race' };
        }
        if (srvRev) _lastServerRev = srvRev;
        if (data && getState) {
          const st = getState();
          const changed = mergeServerIntoState(st, data);
          if (srvRev) st.cloudRev = srvRev;
          st.lastSyncAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          st.lastRttMs = _lastRttMs;
          st.liveConnected = true;
          st.syncError = '';
          st.pendingSyncCount = readOutbox().length;
          if ((changed || forceFull) && onSynced) onSynced(st, srvRev, _lastRttMs);
          return { changed: changed, rev: srvRev, rttMs: _lastRttMs };
        }
      } catch (err) {
        if (getState) {
          const stErr = getState();
          stErr.liveConnected = false;
          stErr.syncError = String((err && err.message) || err || 'SYNC_ERROR');
          stErr.pendingSyncCount = readOutbox().length;
          if (onSynced) onSynced(stErr, _lastServerRev, _lastRttMs);
        }
      } finally {
        _pullInFlight = false;
        if (_pullPendingForce) {
          _pullPendingForce = false;
          setTimeout(() => { pullNow(true); }, 150);
        }
      }
      return null;
    }

    function nextDelay() {
      if (typeof document !== 'undefined' && document.hidden) return 25000;
      const idle = Date.now() - _lastActive;
      const a = Number(CFG.SYNC_ACTIVE_MS) || 2500;
      const w = Number(CFG.SYNC_WARM_MS) || 5000;
      const idl = Number(CFG.SYNC_IDLE_MS) || 12000;
      return idle < 120000 ? a : (idle < 600000 ? w : idl);
    }

    function schedule() {
      clearTimeout(_pollTimer);
      _pollTimer = setTimeout(async () => {
        await pullNow(false);
        schedule();
      }, nextDelay());
    }

    if (typeof window !== 'undefined') {
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
        window.addEventListener(ev, () => { _lastActive = Date.now(); }, { passive: true })
      );
      const wake = () => { _lastActive = Date.now(); pullNow(true); };
      window.addEventListener('focus', wake);
      window.addEventListener('online', () => { flushOutbox().then(wake); });
      window.addEventListener('pageshow', (ev) => { if (ev && ev.persisted) { flushOutbox().then(() => pullNow(true)); } });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
      }
    }

    _syncCallbacks = { pullNow: pullNow, flushOutbox: flushOutbox };
    pullNow(true).finally(schedule);
    return _syncCallbacks;
  }

  function getTelegramUser() {
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        return {
          id: 'TG-' + tg.initDataUnsafe.user.id,
          rawId: String(tg.initDataUnsafe.user.id),
          initData: tg.initData || '',
          name: tg.initDataUnsafe.user.first_name || ''
        };
      }
    } catch (_) {}
    return null;
  }

  function getDeepLinkBlock() {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const sp = new URLSearchParams(window.location.search);
        const b = sp.get('block') || sp.get('checklist') || '';
        if (b) return b.trim();
      }
      const tg = typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp;
      const startParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
      if (startParam) {
        const raw = String(startParam).trim();
        if (raw.indexOf('block_') === 0) return decodeURIComponent(raw.slice(6));
        return raw;
      }
    } catch (_) {}
    return '';
  }

  function normTgNum(val) {
    return String(val || '').replace(/^TG-/i, '').replace(/[^0-9-]/g, '').trim();
  }

  async function autoLoginEmployee(state) {
    const tg = getTelegramUser();
    const sess = getSession();
    // 1. Telegram Mini App auto-login by Telegram User ID
    if (tg && (tg.id || tg.rawId)) {
      try {
        const res = await gasPost('auth_login', {
          role: 'staff',
          autoLogin: true,
          tgId: tg.id,
          rawTgId: tg.rawId,
          initData: tg.initData || ''
        });
        if (res && res.ok && res.sessionToken) {
          setSession({ staffToken: res.sessionToken, staffName: res.staffName, tgId: res.tgId || tg.id, checkedInAt: res.checkedInAt || localHHMM(), checkedInDate: localISO() });
          if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
          return res;
        }
      } catch (_) {}
      // Offline / fallback match against synced staff list
      if (state && Array.isArray(state.staff)) {
        const num = normTgNum(tg.rawId || tg.id);
        const found = state.staff.find((s) => s && s.active !== false && normTgNum(s.tgId) === num);
        if (found) {
          const hm = localHHMM();
          setSession({ staffName: found.name, tgId: found.tgId || tg.id, checkedInAt: hm, checkedInDate: localISO() });
          return {
            ok: true,
            offline: true,
            autoLoggedIn: true,
            staffName: found.name,
            tgId: found.tgId || tg.id,
            onShift: true,
            checkedInAt: hm,
            welcomeMessage: 'Добро пожаловать на смену, ' + found.name + '! Вы отмечены на работе с ' + hm + '.'
          };
        }
      }
    }
    // 2. Remembered staff session on this device
    if (sess && sess.staffName) {
      const hm = (sess.checkedInDate === localISO() && sess.checkedInAt) ? sess.checkedInAt : localHHMM();
      if (sess.staffToken) {
        try {
          const ci = await gasPost('staff_checkin', { staffName: sess.staffName, tgId: sess.tgId || '', source: 'Авто-вход (устройство)' });
          if (ci && ci.ok && ci.checkedInAt) {
            setSession({ checkedInAt: ci.checkedInAt, checkedInDate: localISO() });
            return {
              ok: true,
              autoLoggedIn: true,
              staffName: sess.staffName,
              tgId: sess.tgId || '',
              onShift: true,
              checkedInAt: ci.checkedInAt,
              welcomeMessage: 'С возвращением на смену, ' + sess.staffName + '! Вы отмечены на работе с ' + ci.checkedInAt + '.'
            };
          }
        } catch (_) {}
      }
      return {
        ok: true,
        autoLoggedIn: true,
        staffName: sess.staffName,
        tgId: sess.tgId || '',
        onShift: true,
        checkedInAt: hm,
        welcomeMessage: 'С возвращением на смену, ' + sess.staffName + '! Вы отмечены на работе с ' + hm + '.'
      };
    }
    return { ok: false };
  }

  async function checkOutStaff(staffName) {
    try {
      await gasPost('staff_checkout', { staffName: staffName });
    } catch (_) {}
    setSession({ staffToken: '', staffName: '', checkedInAt: '', checkedInDate: '' });
    return { ok: true };
  }

  async function saveTelegramSettings(opts) {
    return gasPost('save_telegram_settings', opts || {});
  }
  async function testTelegramAlert(opts) {
    return gasPost('test_telegram_alert', opts || {});
  }
  async function sendTelegramAlert(payload) {
    return gasPost('send_telegram_alert', payload || {});
  }
  async function saveStaff(payload) {
    const p = Object.assign({}, payload || {});
    try {
      const res = await gasPost('save_staff', p);
      if (res && res.ok) return res;
      if (res && res.error && /AUTH_REQUIRED|FORBIDDEN/i.test(String(res.error))) return res;
    } catch (_) {}
    enqueueOp('save_staff', p);
    return { ok: true, queued: true };
  }
  async function saveChecklistBlocks(blocks, renamedBlocks) {
    const p = { blocks: Array.isArray(blocks) ? blocks : [] };
    if (renamedBlocks && Object.keys(renamedBlocks).length) p.renamedBlocks = renamedBlocks;
    try {
      const res = await gasPost('save_checklist_blocks', p);
      if (res && res.ok) return res;
      if (res && res.error && /AUTH_REQUIRED|FORBIDDEN/i.test(String(res.error))) return res;
    } catch (_) {}
    enqueueOp('save_checklist_blocks', p);
    return { ok: true, queued: true };
  }
  async function changeAdminPin(newPin) {
    const clean = String(newPin || '').trim();
    if (!/^\d{4,12}$/.test(clean)) return { ok: false, error: 'PIN должен содержать от 4 до 12 цифр' };
    return gasPost('save_setting', { id: 'ADMIN_PIN', value: clean });
  }
  async function grantPhotoReaderAccess() {
    return gasPost('grant_photo_reader_access', {});
  }
  async function reorderTasks(block, orderedIds) {
    const payload = { block: String(block || '').trim(), orderedIds: Array.isArray(orderedIds) ? orderedIds.map(String) : [] };
    if (!payload.block || !payload.orderedIds.length) return { ok: false, error: 'INVALID_REORDER_PAYLOAD' };
    try {
      const res = await gasPost('reorder_tasks', payload);
      if (res && res.ok) return res;
      if (res && res.error && /AUTH_REQUIRED|FORBIDDEN/i.test(String(res.error))) return res;
    } catch (_) {}
    enqueueOp('reorder_tasks', payload);
    return { ok: true, queued: true };
  }
  async function saveDailyPlans(plansObj, rosterObj) {
    const payload = { plans: plansObj || {}, roster: rosterObj || {} };
    try {
      const res = await gasPost('save_daily_plans', payload);
      if (res && res.ok) return res;
      if (res && res.error && /AUTH_REQUIRED|FORBIDDEN/i.test(String(res.error))) return res;
    } catch (_) {}
    enqueueOp('save_daily_plans', payload);
    return { ok: true, queued: true };
  }
  async function setupTriggers() {
    return gasPost('setup_autonomous_triggers', {});
  }
  async function runChecklistNotificationsNow(opts) {
    return gasPost('run_checklist_notifications_now', opts || {});
  }
  async function sendDailyDigest(dateStr) {
    return gasPost('send_daily_digest', dateStr ? { date: dateStr } : {});
  }
  async function safeMutateWithOutbox(action, payload) {
    markLocalMutation();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enqueueOp(action, payload);
      return { ok: true, queued: true };
    }
    try {
      const res = await gasPost(action, payload);
      if (res && res.ok === false && isRetryableServerError(res.error)) {
        enqueueOp(action, payload);
        return { ok: true, queued: true };
      }
      return res;
    } catch (_) {
      enqueueOp(action, payload);
      return { ok: true, queued: true };
    }
  }
  async function saveInventoryItem(opts) {
    return safeMutateWithOutbox('save_inventory', opts || {});
  }
  async function restockInventory(id, delta, note) {
    return safeMutateWithOutbox('restock_inventory', { id: id, delta: Math.abs(Number(delta) || 0), note: note || '' });
  }
  async function deleteInventory(id) {
    return safeMutateWithOutbox('delete_inventory', { id: id });
  }
  async function writeoffInventory(id, delta, note) {
    return safeMutateWithOutbox('writeoff_inventory', { id: id, delta: Math.abs(Number(delta) || 0), note: note || '' });
  }
  async function addExpiryItem(opts) {
    return gasPost('add_expiry_item', opts || {});
  }
  async function disposeExpiryItem(id) {
    return gasPost('dispose_expiry_item', { id: id });
  }
  async function importPosBatch(days, mergeMode) {
    const res = await gasPost('batch_submit_cash', {
      days: days || [],
      mergeMode: mergeMode || 'sum'
    });
    if (res && res.ok && _syncCallbacks && _syncCallbacks.pullNow) {
      _syncCallbacks.pullNow(true);
    }
    return res;
  }

  const API_OBJ = {
    localISO: localISO,
    localHHMM: localHHMM,
    authLogin: authLogin,
    authLogout: authLogout,
    changeStaffPin: changeStaffPin,
    enqueueOp: enqueueOp,
    flushOutbox: flushOutbox,
    uploadPhotoToDrive: uploadPhotoToDrive,
    uploadMediaToDrive: uploadPhotoToDrive,
    mergeServerIntoState: mergeServerIntoState,
    dispatchStateChange: dispatchStateChange,
    dispatchOperation: function (op) {
      const TYPE_TO_ACTION = {
        'cash.submit': 'submit_cash',
        'cash.import': 'batch_submit_cash',
        'checklist.submit': 'save_checklist',
        'incident.create': 'report_standalone_incident',
        'incident.resolve': 'update_incident',
        'expense.create': 'add_expense',
        'expense.delete': 'delete_expense',
        'inventory.save': 'save_inventory',
        'inventory.restock': 'restock_inventory',
        'inventory.writeoff': 'writeoff_inventory',
        'inventory.delete': 'delete_inventory',
        'staff.update': 'save_staff',
        'ttk.update': 'save_ttk',
        'settings.update': 'save_all_settings',
        'extensions.open': 'extend_deadline',
        'extensions.clear': 'clear_deadline_extension',
        'announcement.create': 'save_announcement',
        'tasks.reorder': 'reorder_tasks'
      };
      const act = TYPE_TO_ACTION[op && op.type];
      if (!act) return { ok: false, error: 'UNKNOWN_OPERATION_TYPE: ' + String(op && op.type) };
      const p = Object.assign({}, (op && op.payload) || {});
      if (op && op.actor && !p.userName) p.userName = op.actor;
      enqueueOp(act, p);
      return { ok: true, queued: true, action: act };
    },
    getFailedOps: readFailedOutbox,
    retryFailedOps: function () {
      const failed = readFailedOutbox();
      if (!failed.length) return { retried: 0 };
      const q = readOutbox();
      failed.forEach((it) => {
        q.push({ action: it.action, status: 'pending', payload: it.payload, ts: Date.now(), attempts: 0, nextRetryAt: 0 });
      });
      writeFailedOutbox([]);
      writeOutbox(q);
      flushOutbox(true).catch(() => {});
      return { retried: failed.length };
    },
    startCloudLoop: startCloudLoop,
    getTelegramUser: getTelegramUser,
    getPendingCount: function () { return readOutbox().length; },
    getLastRttMs: function () { return _lastRttMs; },
    getLastRev: function () { return _lastServerRev; },
    getSession: getSession,
    getDeepLinkBlock: getDeepLinkBlock,
    autoLoginEmployee: autoLoginEmployee,
    checkOutStaff: checkOutStaff,
    saveTelegramSettings: saveTelegramSettings,
    testTelegramAlert: testTelegramAlert,
    sendTelegramAlert: sendTelegramAlert,
    saveDailyPlans: saveDailyPlans,
    reorderTasks: reorderTasks,
    saveStaff: saveStaff,
    saveChecklistBlocks: saveChecklistBlocks,
    grantPhotoReaderAccess: grantPhotoReaderAccess,
    changeAdminPin: changeAdminPin,
    setupTriggers: setupTriggers,
    runChecklistNotificationsNow: runChecklistNotificationsNow,
    sendDailyDigest: sendDailyDigest,
    saveInventoryItem: saveInventoryItem,
    restockInventory: restockInventory,
    writeoffInventory: writeoffInventory,
    deleteInventory: deleteInventory,
    computeBackoffMs: computeBackoffMs,
    markLocalMutation: markLocalMutation,
    getLocalMutationSeq: function () { return _localMutationSeq; },
    addExpiryItem: addExpiryItem,
    disposeExpiryItem: disposeExpiryItem,
    importPosBatch: importPosBatch,
    sendStepProgress: function (userName, block, done, total) {
      if (!userName || !block) return;
      enqueueOp('save_checklist_draft', { userName: userName, block: block, done: Number(done || 0), total: Number(total || 0), updatedAt: new Date().toISOString() });
    }
  };
  window.CoffeeCloudV94 = API_OBJ;
  window.CoffeeCloudV93 = API_OBJ;
  window.CoffeeCloudV92 = API_OBJ;
  window.CoffeeCloud = window.CoffeeCloudV93;
})();



if (typeof module !== 'undefined' && module.exports) { module.exports = (typeof window !== 'undefined' ? window : globalThis).CoffeeCloudV94; }
