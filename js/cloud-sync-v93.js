/* Coffee Illy v93.0 — Cross-Device, Cross-OS Fast Cloud Sync (Phone / Tablet / PC · iOS / Android / Windows / macOS / Telegram) */
(function () {
  const CFG = window.COFFEE_CONFIG || {};
  const API_URL = CFG.API_URL || '';
  const OUTBOX_KEY = 'coffee_illy_v93_outbox';
  const LEGACY_OUTBOX_KEY = 'coffee_illy_v92_outbox';
  const SESSION_KEY = 'coffee_illy_v93_session';
  const LEGACY_SESSION_KEY = 'coffee_illy_v92_session';

  function localISO(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function localHHMM(d) {
    const dt = d ? new Date(d) : new Date();
    return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  }

  function detectDeviceTag() {
    try {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) return 'Telegram';
      if (/iPad|Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document) return 'iPadOS';
      if (/iPhone|iPod/i.test(ua)) return 'iOS';
      if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Android Tablet';
      if (/Windows/i.test(ua)) return 'Windows';
      if (/Mac OS X/i.test(ua)) return 'macOS';
      if (/Linux/i.test(ua)) return 'Linux';
    } catch (_) {}
    return 'Web';
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY) || '{}';
      return JSON.parse(raw) || {};
    } catch (_) { return {}; }
  }
  function setSession(patch) {
    const cur = Object.assign(getSession(), patch || {});
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(cur)); } catch (_) {}
    return cur;
  }

  function readOutbox() {
    try {
      const cur = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || [];
      if (cur.length) return cur;
      const leg = JSON.parse(localStorage.getItem(LEGACY_OUTBOX_KEY) || '[]') || [];
      if (leg.length) {
        try {
          localStorage.setItem(OUTBOX_KEY, JSON.stringify(leg));
          localStorage.removeItem(LEGACY_OUTBOX_KEY);
        } catch (_) {}
        return leg;
      }
      return [];
    } catch (_) { return []; }
  }
  function writeOutbox(arr) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify((arr || []).slice(-200))); } catch (_) {}
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
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  let _flushPromise = null;
  let _pullPromise = null;
  let _lastRttMs = 0;
  let _lastServerRev = '';
  let _lastSyncedAt = 0;
  let _status = 'idle'; // 'online' | 'syncing' | 'offline' | 'pending' | 'error'
  let _syncCallbacks = null;
  let _statusListeners = [];

  function emitStatus(nextStatus) {
    if (nextStatus) _status = nextStatus;
    const snap = getStatus();
    _statusListeners.forEach((fn) => { try { fn(snap); } catch (_) {} });
  }

  function getStatus() {
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    const pending = readOutbox().length;
    let state = _status;
    if (offline) state = 'offline';
    else if (pending > 0 && state !== 'syncing') state = 'pending';
    return {
      state: state,
      online: !offline,
      pending: pending,
      rttMs: _lastRttMs,
      rev: _lastServerRev,
      lastSyncedAt: _lastSyncedAt,
      device: detectDeviceTag()
    };
  }

  function onStatusChange(fn) {
    if (typeof fn === 'function') _statusListeners.push(fn);
    return () => { _statusListeners = _statusListeners.filter((x) => x !== fn); };
  }

  async function flushOutbox() {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      emitStatus('offline');
      return { flushed: 0, pending: readOutbox().length };
    }
    if (_flushPromise) return _flushPromise;
    if (!readOutbox().length) return { flushed: 0, pending: 0 };
    emitStatus('syncing');
    const run = (async () => {
      let flushed = 0;
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
            const t0 = Date.now();
            const res = await gasPost(item.action, item.payload);
            _lastRttMs = Math.max(1, Date.now() - t0);
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
      const rem = readOutbox().length;
      emitStatus(rem ? 'pending' : 'online');
      return { flushed: flushed, pending: rem };
    })();
    const p = run.finally(() => { if (_flushPromise === p) _flushPromise = null; });
    _flushPromise = p;
    return p;
  }

  function enqueueOp(action, payload) {
    if (!action) return;
    const opId = 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const q = readOutbox();
    q.push({ action: action, payload: Object.assign({ operationId: opId }, payload || {}), ts: Date.now() });
    writeOutbox(q);
    emitStatus('syncing');
    flushOutbox().then(() => {
      if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(false);
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
      if (res && res.ok && res.sessionToken) {
        if (role === 'admin') setSession({ adminToken: res.sessionToken });
        else setSession({ staffToken: res.sessionToken, staffName: (opts && opts.name) || '' });
        if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
      }
      return res;
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
        active: b.active !== false && String(b.active || 'да').toLowerCase() !== 'нет'
      })).filter((b) => b.name);
      changed = true;
    }
    if (Array.isArray(data.tasks) && data.tasks.length) {
      const clean = data.tasks.filter((t) => t && t.title && !String(t.id || '').startsWith('__SYS'));
      if (clean.length) {
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
          tgId: s.tgId || prev.tgId || '',
          active: s.active !== false && String(s.active || 'да').toLowerCase() !== 'нет',
          pin: prev.pin || '1234',
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
        cost: Number(k.cost || 0),
        recipe: k.recipe || '',
        serve: k.serve || ''
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
          roster: p.roster || prev.roster || ''
        };
      });
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
        { id: 'PLAN', value: String(st.plan || 2200) },
        { id: 'MIN_AVG_CHECK', value: String(st.minAvgCheck || 35) },
        { id: 'PLAN_CHECKS', value: String(st.planChecks || 75) },
        { id: 'WO_NORM', value: String(st.woNorm || 15) },
        { id: 'INIT_COUNTER', value: String(st.initCounter || 600) },
        { id: 'PHOTO_ALL', value: st.photoAll ? 'да' : 'нет' }
      ] });
    } else if (desc.indexOf('Окно «') === 0 || desc.indexOf('Создан блок') === 0) {
      enqueueOp('save_checklist_blocks', { blocks: st.blocks || [] });
    } else if (desc.indexOf('Открыт блок') === 0) {
      const m = desc.match(/«([^»]+)»/);
      if (m) enqueueOp('extend_deadline', { block: m[1], openFrom: '00:00', until: '23:59', reason: 'Открыто владельцем' });
    } else if (desc.indexOf('Обновлён план') === 0 && st.plans) {
      const plansObj = {};
      (st.plans || []).forEach((p) => { plansObj[p.day] = { revenue: p.rev || p.revenue, avgCheck: p.avg || p.avgCheck || 35, checks: p.checks }; });
      enqueueOp('save_daily_plans', { plans: plansObj });
    } else if (desc.indexOf('Сменил личный PIN') === 0) {
      const s = (st.staff || []).find((x) => x.name === actor);
      if (s && s.pin) enqueueOp('change_staff_pin', { name: s.name, newPin: s.pin });
    } else if (desc.indexOf('Привязан Telegram ID') === 0) {
      const s = (st.staff || []).find((x) => x.name === actor);
      if (s && s.tgId) enqueueOp('bind_telegram_user', { name: s.name, tgId: s.tgId });
    } else if (desc.indexOf('Обновлён сотрудник') === 0) {
      const nm = desc.replace('Обновлён сотрудник ', '').trim();
      const s = (st.staff || []).find((x) => x.name === nm);
      if (s) {
        enqueueOp('save_staff', { name: s.name, role: s.role, shift: s.shift, tgId: s.tgId || '' });
        if (s.pin) enqueueOp('save_staff_pins', { pins: [{ name: s.name, pin: s.pin }] });
      }
    } else if (desc.indexOf('Обновлена ТТК') === 0) {
      const nm = desc.replace('Обновлена ТТК ', '').trim();
      const k = (st.ttk || []).find((x) => x.name === nm);
      if (k) enqueueOp('save_ttk', k);
    } else if (desc.indexOf('Добавлена задача') === 0 && st.tasks && st.tasks.length) {
      const t = st.tasks[st.tasks.length - 1];
      enqueueOp('save_task', Object.assign({}, t, { photo: t.photo ? 'да' : 'нет', responsible: t.owner || 'Бариста', active: 'да' }));
    }
  }

  let _lastActive = Date.now();
  let _pollTimer = null;

  function startCloudLoop(opts) {
    const mode = (opts && opts.mode) || 'terminal';
    const getState = opts && opts.getState;
    const onSynced = opts && opts.onSynced;

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
        emitStatus('offline');
        return null;
      }
      if (_pullPromise && !forceFull) return _pullPromise;
      const run = (async () => {
        try {
          if (forceFull) emitStatus('syncing');
          await flushOutbox();
          const t0 = Date.now();
          const revRes = await gasGet({ action: 'get_rev', sinceRev: _lastServerRev });
          _lastRttMs = Math.max(1, Date.now() - t0);
          const srvRev = revRes && (revRes.rev != null ? String(revRes.rev) : '');
          _lastSyncedAt = Date.now();
          if (!forceFull && srvRev && srvRev === _lastServerRev) {
            emitStatus(readOutbox().length ? 'pending' : 'online');
            return { changed: false, rev: srvRev, rttMs: _lastRttMs };
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
          if (data && getState) {
            const st = getState();
            const changed = mergeServerIntoState(st, data);
            if (srvRev) st.cloudRev = srvRev;
            emitStatus(readOutbox().length ? 'pending' : 'online');
            if ((changed || forceFull) && onSynced) onSynced(st, srvRev, _lastRttMs);
            return { changed: changed, rev: srvRev, rttMs: _lastRttMs };
          }
          emitStatus(readOutbox().length ? 'pending' : 'online');
        } catch (_) {
          emitStatus('error');
        }
        return null;
      })();
      const p = run.finally(() => { if (_pullPromise === p) _pullPromise = null; });
      _pullPromise = p;
      return p;
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
      const wake = (force) => { _lastActive = Date.now(); pullNow(!!force); };
      window.addEventListener('focus', () => wake(false));
      // Critical for iOS Safari / iPadOS bfcache restore when switching apps or tabs
      window.addEventListener('pageshow', (e) => { if (e && e.persisted) wake(true); else wake(false); });
      window.addEventListener('online', () => { emitStatus('syncing'); flushOutbox().then(() => wake(true)); });
      window.addEventListener('offline', () => { emitStatus('offline'); });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') wake(false);
        });
      }
    }

    _syncCallbacks = {
      pullNow: pullNow,
      forceSyncNow: () => pullNow(true),
      flushOutbox: flushOutbox
    };
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

  const api = {
    localISO: localISO,
    localHHMM: localHHMM,
    detectDeviceTag: detectDeviceTag,
    authLogin: authLogin,
    enqueueOp: enqueueOp,
    flushOutbox: flushOutbox,
    forceSyncNow: function () { return _syncCallbacks ? _syncCallbacks.pullNow(true) : Promise.resolve(null); },
    uploadPhotoToDrive: uploadPhotoToDrive,
    mergeServerIntoState: mergeServerIntoState,
    dispatchStateChange: dispatchStateChange,
    startCloudLoop: startCloudLoop,
    getTelegramUser: getTelegramUser,
    getStatus: getStatus,
    onStatusChange: onStatusChange,
    getPendingCount: function () { return readOutbox().length; },
    getLastRttMs: function () { return _lastRttMs; },
    getLastRev: function () { return _lastServerRev; }
  };

  window.CoffeeCloudV93 = api;
  window.CoffeeCloudV92 = api;
})();
