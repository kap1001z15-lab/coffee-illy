/* Coffee Illy v94.0 — Быстрая двусторонняя синхронизация (Google Sheets + Drive + Offline Outbox + Telegram) */
(function () {
  const CFG = window.COFFEE_CONFIG || {};
  const API_URL = CFG.API_URL || '';
  const OUTBOX_KEY = 'coffee_illy_v94_outbox';
  const SESSION_KEY = 'coffee_illy_v94_session';
  const BC_NAME = 'coffee_illy_v94_sync';
  const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;

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
  function readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function writeOutbox(arr) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify((arr || []).slice(-250))); } catch (_) {}
  }

  let _flushPromise = null;
  let _lastRttMs = 0;
  let _lastServerRev = '';
  let _syncCallbacks = null;
  let _syncStatus = { state: 'syncing', lastSyncAt: '', error: '', pending: 0 };

  function emitSyncStatus(patch) {
    _syncStatus = Object.assign({}, _syncStatus, patch || {}, { pending: readOutbox().length });
    if (_syncCallbacks && _syncCallbacks.onStatus) {
      try { _syncCallbacks.onStatus(_syncStatus); } catch (_) {}
    }
  }

  async function gasGet(params) {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      emitSyncStatus({ state: 'offline', error: '' });
      return null;
    }
    const qs = Object.keys(params || {}).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const url = API_URL + (API_URL.indexOf('?') >= 0 ? '&' : '?') + qs + '&t=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function gasPost(action, payload) {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      emitSyncStatus({ state: 'offline', error: '' });
      return { ok: false, offline: true };
    }
    const sess = getSession();
    const body = Object.assign({
      action: action,
      operationId: (payload && payload.operationId) || ('op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))
    }, payload || {});
    if (!body.sessionToken) body.sessionToken = sess.adminToken || sess.staffToken || '';
    if (!body.staffSessionToken && sess.staffToken) body.staffSessionToken = sess.staffToken;
    const t0 = Date.now();
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    _lastRttMs = Math.max(1, Date.now() - t0);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (bc) try { bc.postMessage({ type: 'mutated', action: action, ts: Date.now() }); } catch (_) {}
    return json;
  }

  async function flushOutbox() {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      emitSyncStatus({ state: 'offline' });
      return { flushed: 0, pending: readOutbox().length };
    }
    if (_flushPromise) return _flushPromise;
    if (!readOutbox().length) return { flushed: 0, pending: 0 };
    const run = (async () => {
      let flushed = 0;
      emitSyncStatus({ state: 'syncing' });
      while (true) {
        const q = readOutbox();
        if (!q.length) break;
        const batch = q.slice();
        const doneIds = new Set();
        let anyRetryableFailure = false;
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i];
          const opId = (item.payload && item.payload.operationId) || (item.action + '_' + item.ts + '_' + i);
          try {
            const res = await gasPost(item.action, item.payload);
            if (res && res.offline) { anyRetryableFailure = true; break; }
            doneIds.add(opId);
            if (!res || res.ok !== false) flushed++;
          } catch (_) {
            anyRetryableFailure = true;
          }
        }
        const latest = readOutbox();
        const remaining = latest.filter((item, idx) => {
          const opId = (item.payload && item.payload.operationId) || (item.action + '_' + item.ts + '_' + idx);
          return !doneIds.has(opId);
        });
        writeOutbox(remaining);
        if (!remaining.length || anyRetryableFailure) break;
      }
      const left = readOutbox().length;
      if (!left) emitSyncStatus({ state: 'synced', lastSyncAt: localHHMM(), error: '' });
      return { flushed: flushed, pending: left };
    })();
    const p = run.finally(() => { if (_flushPromise === p) _flushPromise = null; });
    _flushPromise = p;
    return p;
  }

  function enqueueOp(action, payload) {
    if (!action) return;
    const opId = (payload && payload.operationId) || ('op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    const q = readOutbox();
    q.push({ action: action, payload: Object.assign({ operationId: opId }, payload || {}), ts: Date.now() });
    writeOutbox(q);
    emitSyncStatus({ state: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'syncing' });
    return flushOutbox().then((res) => {
      if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(false);
      return res;
    }).catch(() => ({ flushed: 0, pending: readOutbox().length }));
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
      const res = await gasPost('upload_photo', payload);
      if (res && res.ok) return { ok: true, fileId: res.fileId || '', url: res.url || res.viewUrl || '', fileName: res.fileName || '' };
      enqueueOp('upload_photo', payload);
      return { ok: true, queued: true, url: '' };
    } catch (err) {
      enqueueOp('upload_photo', payload);
      return { ok: true, queued: true, url: '', error: String(err && err.message || err) };
    }
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
      const sparam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
      if (sparam) {
        const raw = String(sparam).trim();
        return raw.indexOf('block_') === 0 ? decodeURIComponent(raw.slice(6)) : raw;
      }
    } catch (_) {}
    return '';
  }

  function normTgNum(val) {
    return String(val || '').replace(/^TG-/i, '').replace(/[^0-9-]/g, '').trim();
  }

  async function authLogin(role, opts) {
    try {
      const payloadAuth = Object.assign({ role: role }, opts || {});
      if (payloadAuth.name) {
        if (!payloadAuth.staffName) payloadAuth.staffName = payloadAuth.name;
        if (!payloadAuth.userName) payloadAuth.userName = payloadAuth.name;
      }
      const res = await gasPost('auth_login', payloadAuth);
      if (res && res.ok && res.sessionToken) {
        if (role === 'admin') setSession({ adminToken: res.sessionToken });
        else setSession({ staffToken: res.sessionToken, staffName: res.staffName || payloadAuth.staffName || '', tgId: res.tgId || payloadAuth.tgId || '', checkedInAt: res.checkedInAt || localHHMM(), checkedInDate: localISO() });
        if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
      }
      return res;
    } catch (e) {
      return { ok: false, offline: true, error: String(e && e.message || e) };
    }
  }

  async function autoLoginEmployee(state) {
    const tg = getTelegramUser();
    const sess = getSession();
    if (tg && (tg.id || tg.rawId)) {
      try {
        const res = await gasPost('auth_login', { role: 'staff', autoLogin: true, tgId: tg.id, rawTgId: tg.rawId, initData: tg.initData || '' });
        if (res && res.ok && res.sessionToken) {
          setSession({ staffToken: res.sessionToken, staffName: res.staffName, tgId: res.tgId || tg.id, checkedInAt: res.checkedInAt || localHHMM(), checkedInDate: localISO() });
          if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
          return res;
        }
      } catch (_) {}
      if (state && Array.isArray(state.staff)) {
        const num = normTgNum(tg.rawId || tg.id);
        const found = state.staff.find((s) => s && s.active !== false && normTgNum(s.tgId) === num);
        if (found) {
          const hm = localHHMM();
          setSession({ staffName: found.name, tgId: found.tgId || tg.id, checkedInAt: hm, checkedInDate: localISO() });
          return { ok: true, offline: true, autoLoggedIn: true, staffName: found.name, tgId: found.tgId || tg.id, onShift: true, checkedInAt: hm, welcomeMessage: 'Добро пожаловать на смену, ' + found.name + '! Вы отмечены на работе с ' + hm + '.' };
        }
      }
    }
    if (sess && sess.staffName) {
      const hm = (sess.checkedInDate === localISO() && sess.checkedInAt) ? sess.checkedInAt : localHHMM();
      if (sess.staffToken) {
        try {
          const ci = await gasPost('staff_checkin', { staffName: sess.staffName, tgId: sess.tgId || '', source: 'Авто-вход (устройство)' });
          if (ci && ci.ok && ci.checkedInAt) {
            setSession({ checkedInAt: ci.checkedInAt, checkedInDate: localISO() });
            return { ok: true, autoLoggedIn: true, staffName: sess.staffName, tgId: sess.tgId || '', onShift: true, checkedInAt: ci.checkedInAt, welcomeMessage: 'С возвращением, ' + sess.staffName + '! Вы отмечены на работе с ' + ci.checkedInAt + '.' };
          }
        } catch (_) {}
      }
      return { ok: true, autoLoggedIn: true, staffName: sess.staffName, tgId: sess.tgId || '', onShift: true, checkedInAt: hm, welcomeMessage: 'С возвращением, ' + sess.staffName + '! Вы отмечены на работе с ' + hm + '.' };
    }
    return { ok: false };
  }

  async function checkOutStaff(staffName) {
    try { await gasPost('staff_checkout', { staffName: staffName }); } catch (_) {}
    setSession({ staffToken: '', staffName: '', checkedInAt: '', checkedInDate: '' });
    return { ok: true };
  }

  function mergeServerIntoState(state, data) {
    if (!data || typeof data !== 'object') return false;
    let changed = false;
    if (data.location) { state.location = String(data.location); changed = true; }
    if (Number(data.plan) > 0) { state.plan = Number(data.plan); changed = true; }
    if (data.photoAll !== undefined) { state.photoAll = String(data.photoAll).toLowerCase() === 'да' || data.photoAll === true; changed = true; }
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
        active: b.active !== false && String(b.active || 'да').toLowerCase() !== 'нет'
      })).filter((b) => b.name);
      changed = true;
    }
    if (Array.isArray(data.tasks)) {
      const clean = data.tasks.filter((t) => t && t.title && !String(t.id || '').startsWith('__SYS'));
      state.tasks = clean.map((t) => ({
        id: t.id || ('t_' + Math.random().toString(36).slice(2, 6)),
        block: t.block || 'Открытие',
        group: t.groupName || t.group || '',
        title: t.title || '',
        instruction: t.instruction || '',
        photo: String(t.photo || 'нет').toLowerCase() === 'да' || t.photo === true,
        owner: t.responsible || t.owner || 'Бариста',
        active: String(t.active || 'да').toLowerCase() !== 'нет'
      }));
      changed = true;
    }
    if (Array.isArray(data.cash)) {
      state.cash = data.cash.map((c) => {
        const rev = Number(c.revenue || c.total || ((Number(c.cash) || 0) + (Number(c.card) || 0)) || 0);
        const who = c.barista || c.who || 'Бариста';
        return {
          date: String(c.date || '').slice(0, 10),
          who: who, barista: who,
          revenue: rev, total: rev,
          cash: Number(c.cash || 0), card: Number(c.card || 0),
          checks: Number(c.checks || 0), writeoff: Number(c.writeoff || 0),
          topItems: c.topItems || '',
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
          time: x.time || '', block: x.block || '',
          step: step, zone: step,
          text: x.text || x.comment || '',
          priority: x.priority || 'Терпит',
          status: x.status || 'Новая',
          who: x.who || '', owner: x.owner || x.responsible || 'Администратор',
          photoUrl: x.photoUrl || x.photo || '',
          history: Array.isArray(x.history) ? x.history : []
        };
      });
      changed = true;
    }
    const rawLogs = Array.isArray(data.checklistsLog) ? data.checklistsLog : (Array.isArray(data.checklists) ? data.checklists : null);
    if (rawLogs) {
      state.checklists = rawLogs.map((c) => {
        let phList = [];
        if (Array.isArray(c.photos)) phList = c.photos.map((p) => (typeof p === 'string' ? p : (p && p.url ? p.url : ''))).filter(Boolean);
        else if (typeof c.photos === 'string' && c.photos.trim().startsWith('[')) {
          try { const parsed = JSON.parse(c.photos); if (Array.isArray(parsed)) phList = parsed.map((p) => (typeof p === 'string' ? p : (p && p.url ? p.url : ''))).filter(Boolean); } catch (_) {}
        } else if (c.photoUrl) phList = [c.photoUrl];
        return {
          date: String(c.date || '').slice(0, 10), time: c.time || '', block: c.block || '', who: c.who || '',
          problems: Number(c.problems || 0), deadline: c.deadline || '', status: c.status || 'Выполнено',
          isLate: !!c.isLate, done: Number(c.done || 0), total: Number(c.total || 0), photos: phList
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
          id: s.id || prev.id || ('st_' + idx), name: s.name, role: s.role || prev.role || 'Бариста',
          shift: s.shift || prev.shift || '08:00–20:00', tgId: s.tgId || prev.tgId || '',
          active: s.active !== false && String(s.active || 'да').toLowerCase() !== 'нет',
          pin: prev.pin || '1234', pinIsDefault: prev.pinIsDefault !== false
        });
      });
      changed = true;
    }
    if (Array.isArray(data.ttk)) {
      state.ttk = data.ttk.map((k) => ({
        id: k.id || ('ttk_' + Math.random().toString(36).slice(2, 6)),
        name: k.name || '', vol: k.vol || k.volume || '250 мл',
        cat: k.cat || k.category || 'Классика',
        price: Number(k.price || 0), cost: Number(k.cost || 0),
        recipe: k.recipe || '', serve: k.serve || '',
        prepTime: k.prepTime || '2 мин', allergens: k.allergens || 'Нет',
        updatedAt: k.updatedAt || localISO()
      }));
      changed = true;
    }
    if (Array.isArray(data.announcements)) { state.announcements = data.announcements; changed = true; }
    if (Array.isArray(data.inventory)) { state.inventory = data.inventory; changed = true; }
    if (Array.isArray(data.inventoryLog)) { state.inventoryLog = data.inventoryLog; changed = true; }
    if (data.financeSummary && typeof data.financeSummary === 'object') { state.financeSummary = data.financeSummary; changed = true; }
    if (data.cashReviews && typeof data.cashReviews === 'object') { state.cashReviews = data.cashReviews; changed = true; }
    if (data.staffPresence && typeof data.staffPresence === 'object') { state.staffPresence = data.staffPresence; changed = true; }
    if (data.tgConfiguredOnServer !== undefined) { state.tgConfiguredOnServer = !!data.tgConfiguredOnServer; changed = true; }
    if (data.tgChat !== undefined) { state.tgChat = String(data.tgChat || ''); changed = true; }
    if (data.webappUrl !== undefined) { state.webappUrl = String(data.webappUrl || ''); changed = true; }
    if (data.autopilotEnabled !== undefined) { state.autopilotEnabled = !!data.autopilotEnabled; changed = true; }
    if (data.serverTime) { state.serverTime = String(data.serverTime); changed = true; }
    return changed;
  }

  let _lastActive = Date.now();
  let _pollTimer = null;

  function startCloudLoop(opts) {
    const mode = (opts && opts.mode) || 'terminal';
    const getState = opts && opts.getState;
    const onSynced = opts && opts.onSynced;
    const onStatus = opts && opts.onStatus;

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
        emitSyncStatus({ state: 'offline', error: '' });
        return null;
      }
      try {
        if (forceFull) emitSyncStatus({ state: 'syncing', error: '' });
        await flushOutbox();
        const t0 = Date.now();
        const revRes = await gasGet({ action: 'get_rev', sinceRev: _lastServerRev });
        _lastRttMs = Math.max(1, Date.now() - t0);
        const srvRev = revRes && (revRes.rev != null ? String(revRes.rev) : '');
        if (!forceFull && srvRev && srvRev === _lastServerRev) {
          emitSyncStatus({ state: 'synced', lastSyncAt: localHHMM(), error: '' });
          return { changed: false, rev: srvRev };
        }
        if (srvRev) _lastServerRev = srvRev;

        let data = null;
        const sess = getSession();
        if (mode === 'owner' && sess.adminToken) {
          data = await gasPost('admin', { sessionToken: sess.adminToken });
        } else if (mode === 'terminal' && sess.staffToken) {
          data = await gasPost('staff_bootstrap', { sessionToken: sess.staffToken });
        } else {
          data = await gasGet({ action: 'get_checklists', nocache: '1' });
        }
        if (data && data.ok === false && data.error) {
          emitSyncStatus({ state: 'error', error: String(data.error) });
          return { ok: false, error: data.error };
        }
        if (data && getState) {
          const st = getState();
          const changed = mergeServerIntoState(st, data);
          st.dataLoaded = true;
          st.loadError = '';
          st.lastSyncAt = localHHMM();
          emitSyncStatus({ state: 'synced', lastSyncAt: st.lastSyncAt, error: '' });
          if ((changed || forceFull) && onSynced) onSynced(st, srvRev, _lastRttMs);
          return { changed: changed, rev: srvRev, rttMs: _lastRttMs };
        }
      } catch (err) {
        if (getState) {
          const st = getState();
          st.loadError = 'Не удалось загрузить данные с сервера';
        }
        emitSyncStatus({ state: 'error', error: String((err && err.message) || 'Ошибка сети') });
      }
      return null;
    }

    function nextDelay() {
      if (typeof document !== 'undefined' && document.hidden) return 20000;
      const idle = Date.now() - _lastActive;
      const a = Number(CFG.SYNC_ACTIVE_MS) || 800;
      const w = Number(CFG.SYNC_WARM_MS) || 2200;
      const idl = Number(CFG.SYNC_IDLE_MS) || 8000;
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
      const wake = () => { _lastActive = Date.now(); pullNow(false); };
      window.addEventListener('focus', wake);
      window.addEventListener('online', () => { flushOutbox().then(() => pullNow(true)); });
      window.addEventListener('offline', () => { emitSyncStatus({ state: 'offline' }); });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
      }
    }
    if (bc) bc.onmessage = () => { pullNow(true); };

    _syncCallbacks = { pullNow: pullNow, flushOutbox: flushOutbox, onStatus: onStatus };
    pullNow(true).finally(schedule);
    return _syncCallbacks;
  }

  const API_OBJ = {
    localISO, localHHMM, getSession, setSession,
    gasGet, gasPost, enqueueOp, flushOutbox, uploadPhotoToDrive,
    authLogin, autoLoginEmployee, checkOutStaff,
    getTelegramUser, getDeepLinkBlock, mergeServerIntoState, startCloudLoop,
    getSyncStatus: () => _syncStatus,
    getPendingCount: () => readOutbox().length,
    getLastRttMs: () => _lastRttMs,
    saveTelegramSettings: (opts) => gasPost('save_telegram_settings', opts || {}),
    testTelegramAlert: () => gasPost('test_telegram_alert', {}),
    setupTriggers: () => gasPost('setup_autonomous_triggers', {}),
    runChecklistNotificationsNow: (opts) => gasPost('run_checklist_notifications_now', opts || {}),
    reviewCashReport: (opts) => gasPost('review_cash_report', opts || {}),
    createTaskFromIncident: (opts) => gasPost('create_task_from_incident', opts || {}),
    recordInventoryMove: (opts) => gasPost('inventory_move', opts || {}),
    createBackup: () => gasPost('create_server_backup', {})
  };
  window.CoffeeCloudV94 = API_OBJ;
  window.CoffeeCloudV93 = API_OBJ;
})();
