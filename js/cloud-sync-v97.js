/* Coffee Illy v97.0 — Fast Bidirectional Cloud Sync (Google Sheets + Drive Photos + Offline Outbox + Telegram) */
(function () {
  const CFG = window.COFFEE_CONFIG || {};
  const API_URL = CFG.API_URL || '';
  const OUTBOX_KEY = 'coffee_illy_v93_outbox';
  const SESSION_KEY = 'coffee_illy_v93_session';

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
  let _lastRttMs = 0;
  let _lastServerRev = '';
  let _syncCallbacks = null;
  let _mutationEpoch = 0;
  let _pullInFlight = null;
  function bumpLocalEpoch() { _mutationEpoch++; return _mutationEpoch; }

  async function flushOutbox() {
    if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { flushed: 0, pending: readOutbox().length };
    if (_flushPromise) return _flushPromise;
    if (!readOutbox().length) return { flushed: 0, pending: 0 };
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
      return { flushed: flushed, pending: readOutbox().length };
    })();
    const p = run.finally(() => { if (_flushPromise === p) _flushPromise = null; });
    _flushPromise = p;
    return p;
  }

  function enqueueOp(action, payload) {
    if (!action) return;
    bumpLocalEpoch();
    const opId = 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const q = readOutbox();
    q.push({ action: action, payload: Object.assign({ operationId: opId }, payload || {}), ts: Date.now() });
    writeOutbox(q);
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
      const payloadAuth = Object.assign({ role: role }, opts || {}); if (payloadAuth.name) { if (!payloadAuth.staffName) payloadAuth.staffName = payloadAuth.name; if (!payloadAuth.userName) payloadAuth.userName = payloadAuth.name; } const res = await gasPost('auth_login', payloadAuth);
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

  function normalizeSaleKind(rawKind, name) {
    const k = String(rawKind || '').trim().toLowerCase();
    const n = String(name || '').trim().toLowerCase();
    if (k === 'non_coffee' || k.includes('не-кофе') || k.includes('не кофе')) {
      if (/десерт|чизкейк|макарон|круассан|рулет|печень|торт|пирож|шоколад|батончик|сэндвич|сырник/.test(n)) return 'Десерты';
      if (/чай|матча|какао|лимонад|сок|вода|кола|смузи|милкшейк/.test(n)) return 'Чай и напитки';
      return 'Не-кофе';
    }
    if (k === 'coffee' || (k.includes('кофе') && !k.includes('не-кофе'))) return 'Кофе';
    if (k === 'review' || k.includes('отзыв')) return 'Прочее';
    if (/эспрессо|американо|капучино|латте|раф|флэт|кофе|макиато|мокко|бамбл|айс|гляссе|кортадо|доппио/.test(n)) return 'Кофе';
    if (/десерт|чизкейк|макарон|круассан|рулет|печень|торт|пирож|шоколад|батончик|сэндвич|сырник/.test(n)) return 'Десерты';
    if (/чай|матча|какао|лимонад|сок|вода|кола|смузи|милкшейк/.test(n)) return 'Чай и напитки';
    return rawKind ? String(rawKind) : 'Не-кофе';
  }

  function normalizeIncidentStatus(st) {
    const s = String(st || '').trim();
    const l = s.toLowerCase();
    if (l === 'resolved' || l === 'решено' || l === 'решена' || l === 'закрыто' || l === 'закрыта') return 'Решена';
    if (l === 'в работе' || l === 'принято в работу' || l === 'принята в работу') return 'В работе';
    return s || 'Новая проблема';
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
          csvHashes: Array.isArray(c.csvHashes) ? c.csvHashes : [],
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
          status: normalizeIncidentStatus(x.status),
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
      state.checklists.sort((a, b) => {
        const da = String((a && a.date) || '').slice(0, 10);
        const db = String((b && b.date) || '').slice(0, 10);
        if (da !== db) return db.localeCompare(da);
        const padT = (t) => {
          const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
          return m ? (String(m[1]).padStart(2, '0') + ':' + m[2]) : '00:00';
        };
        return padT(b && b.time).localeCompare(padT(a && a.time));
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
    if (Array.isArray(data.serviceAudits)) {
      state.serviceAudits = data.serviceAudits.map((a) => ({
        id: a.id || '',
        date: String(a.date || '').slice(0, 10),
        barista: a.barista || '',
        auditor: a.auditor || a.checker || '',
        greeting: Number(a.greet || a.greeting || 0),
        clarify: Number(a.clarify || 0),
        upsell: Number(a.upsell || 0),
        farewell: Number(a.farewell || 0),
        total: Number(a.total || a.score || 0),
        comment: a.comment || ''
      }));
      changed = true;
    }
    if (Array.isArray(data.goodDeeds)) {
      state.goodDeeds = data.goodDeeds.map((g) => ({
        id: g.id || '',
        title: g.title || g.name || '',
        period: g.period || g.frequency || '',
        window: g.window || g.timeWindow || '',
        executor: g.executor || 'Бариста',
        checker: g.checker || 'Администратор',
        instruction: g.instruction || ''
      }));
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
        kind: normalizeSaleKind(x.kind, x.name),
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
    if (data.deadlineExtensions && typeof data.deadlineExtensions === 'object') {
      const todayIso = localISO();
      const normExt = {};
      Object.keys(data.deadlineExtensions).forEach((k) => {
        const val = data.deadlineExtensions[k];
        if (!val) return;
        const parts = String(k).split(':');
        if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
          if (parts[0] === todayIso) {
            const blkName = parts.slice(1).join(':');
            normExt[blkName] = val;
          }
        } else {
          normExt[k] = val;
        }
      });
      state.extensions = normExt;
      changed = true;
    }
    if (Array.isArray(data.announcements)) {
      state.announcements = data.announcements.map((a) => ({
        id: a.id || '',
        date: String(a.date || '').slice(0, 10),
        title: a.title || '',
        text: a.text || a.body || '',
        priority: a.priority || 'info',
        author: a.author || 'Администратор'
      }));
      changed = true;
    }
    if (Number(data.planChecks) > 0) { state.planChecks = Number(data.planChecks); changed = true; }
    if (Number(data.minAvgCheck) > 0) { state.minAvgCheck = Number(data.minAvgCheck); changed = true; }
    if (data.woNorm !== undefined && Number(data.woNorm) >= 0) { state.woNorm = Number(data.woNorm); changed = true; }
    if (data.initCounter !== undefined && Number(data.initCounter) >= 0) { state.initCounter = Number(data.initCounter); changed = true; }
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
      const rosterObj = {};
      (st.plans || []).forEach((p) => {
        plansObj[p.day] = {
          revenue: Number(p.rev || p.revenue || st.plan || 2200),
          avgCheck: Number(p.avg || p.avgCheck || st.minAvgCheck || 35),
          checks: Number(p.checks || st.planChecks || 75)
        };
        if (p.roster !== undefined) rosterObj[p.day] = String(p.roster || '');
      });
      enqueueOp('save_daily_plans', { plans: plansObj });
      enqueueOp('save_shift_roster', { roster: rosterObj });
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
        enqueueOp('save_staff', {
          id: s.id || '',
          name: s.name,
          role: s.role || 'Бариста',
          shop: s.shop || st.location || 'Кофейня №1',
          shift: s.shift || '08:00–20:00',
          active: s.active === false ? 'нет' : 'да',
          tgId: s.tgId || '',
          pin: s.pin || ''
        });
        if (s.pin) enqueueOp('save_staff_pins', { pins: [{ name: s.name, pin: s.pin }] });
      }
    } else if (desc.indexOf('Обновлена ТТК') === 0) {
      const nm = desc.replace('Обновлена ТТК ', '').trim();
      const k = (st.ttk || []).find((x) => x.name === nm);
      if (k) enqueueOp('save_ttk', {
        id: k.id || '',
        name: k.name || '',
        volume: k.vol || k.volume || '',
        vol: k.vol || k.volume || '',
        category: k.cat || k.category || 'Классика',
        cat: k.cat || k.category || 'Классика',
        price: Number(k.price || 0),
        cost: Number(k.cost || 0),
        costBeans: Number(k.cost || 0),
        recipe: k.recipe || '',
        serving: k.serve || k.serving || ''
      });
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
      if (m) enqueueOp('extend_deadline', { block: m[1], clear: true });
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
      if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
      if (_pullInFlight && !forceFull) return _pullInFlight;
      const runPull = (async () => {
      try {
        const fl = await flushOutbox();
        if (fl && fl.pending > 0 && !forceFull) return { changed: false, pending: fl.pending };
        const reqEpoch = _mutationEpoch;
        const t0 = Date.now();
        const revRes = await gasGet({ action: 'get_rev', sinceRev: _lastServerRev });
        _lastRttMs = Math.max(1, Date.now() - t0);
        const srvRev = revRes && (revRes.rev != null ? String(revRes.rev) : '');
        if (!forceFull && srvRev && srvRev === _lastServerRev) return { changed: false, rev: srvRev };

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
        if (_mutationEpoch !== reqEpoch || readOutbox().length > 0) {
          return { changed: false, skippedStale: true };
        }
        if (srvRev) _lastServerRev = srvRev;
        if (data && getState) {
          const st = getState();
          const changed = mergeServerIntoState(st, data);
          if (srvRev) st.cloudRev = srvRev;
          st.lastSyncAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          st.lastRttMs = _lastRttMs;
          st.liveConnected = true;
          if ((changed || forceFull) && onSynced) onSynced(st, srvRev, _lastRttMs);
          return { changed: changed, rev: srvRev, rttMs: _lastRttMs };
        }
      } catch (_) {}
      return null;
      })();
      const wrapped = runPull.finally(() => { if (_pullInFlight === wrapped) _pullInFlight = null; });
      _pullInFlight = wrapped;
      return wrapped;
    }

    function nextDelay() {
      if (typeof document !== 'undefined' && document.hidden) return 25000;
      const idle = Date.now() - _lastActive;
      const a = Number(CFG.SYNC_ACTIVE_MS) || 900;
      const w = Number(CFG.SYNC_WARM_MS) || 2500;
      const idl = Number(CFG.SYNC_IDLE_MS) || 10000;
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
      window.addEventListener('online', () => { flushOutbox().then(wake); });
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
  async function testTelegramAlert() {
    return gasPost('test_telegram_alert', {});
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
  async function deleteInventoryItem(id) {
    return gasPost('delete_inventory', { id: id });
  }
  async function seedDefaultInventory() {
    return gasPost('seed_default_inventory', {});
  }
  async function recalcInventoryFromSales(dateStr) {
    return gasPost('recalc_inventory_from_sales', dateStr ? { date: dateStr } : {});
  }
  async function sendLowStockAlert() {
    return gasPost('send_low_stock_alert', {});
  }
  async function bulkSeedTtk(items, overwrite) {
    return gasPost('bulk_seed_ttk', { items: items || [], overwrite: !!overwrite });
  }
  async function saveInventoryItem(opts) {
    return gasPost('save_inventory', opts || {});
  }
  async function restockInventory(id, delta, note) {
    return gasPost('restock_inventory', { id: id, delta: Math.abs(Number(delta) || 0), note: note || '' });
  }
  async function writeoffInventory(id, delta, note) {
    return gasPost('writeoff_inventory', { id: id, delta: Math.abs(Number(delta) || 0), note: note || '' });
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

  let _progTimer = null;
  function pushLiveProgress(staffName, block, done, total) {
    if (!staffName || !block) return;
    clearTimeout(_progTimer);
    _progTimer = setTimeout(() => {
      enqueueOp('save_checklist_draft', {
        date: localISO(),
        userName: staffName,
        block: block,
        activeState: { userName: staffName, block: block, done: Number(done || 0), total: Number(total || 0), updatedAt: Date.now() },
        updatedAt: Date.now()
      });
    }, 350);
  }

  async function saveAnnouncement(opts) {
    bumpLocalEpoch();
    const res = await gasPost('save_announcement', { title: (opts && opts.title) || 'Объявление', text: (opts && opts.text) || '', pinned: true });
    if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
    return res;
  }
  async function deleteAnnouncement(id) {
    bumpLocalEpoch();
    const res = await gasPost('delete_announcement', { id: id });
    if (_syncCallbacks && _syncCallbacks.pullNow) _syncCallbacks.pullNow(true);
    return res;
  }

  const API_OBJ = {
    localISO: localISO,
    localHHMM: localHHMM,
    authLogin: authLogin,
    enqueueOp: enqueueOp,
    flushOutbox: flushOutbox,
    uploadPhotoToDrive: uploadPhotoToDrive,
    uploadMediaToDrive: uploadPhotoToDrive,
    mergeServerIntoState: mergeServerIntoState,
    dispatchStateChange: dispatchStateChange,
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
    setupTriggers: setupTriggers,
    runChecklistNotificationsNow: runChecklistNotificationsNow,
    sendDailyDigest: sendDailyDigest,
    pushLiveProgress: pushLiveProgress,
    deleteInventoryItem: deleteInventoryItem,
    seedDefaultInventory: seedDefaultInventory,
    recalcInventoryFromSales: recalcInventoryFromSales,
    sendLowStockAlert: sendLowStockAlert,
    bulkSeedTtk: bulkSeedTtk,
    saveInventoryItem: saveInventoryItem,
    restockInventory: restockInventory,
    writeoffInventory: writeoffInventory,
    addExpiryItem: addExpiryItem,
    disposeExpiryItem: disposeExpiryItem,
    saveAnnouncement: saveAnnouncement,
    deleteAnnouncement: deleteAnnouncement,
    importPosBatch: importPosBatch,
    sendStepProgress: function (userName, block, done, total) {
      if (!userName || !block) return;
      enqueueOp('save_checklist_draft', { userName: userName, block: block, done: Number(done || 0), total: Number(total || 0), updatedAt: new Date().toISOString() });
    }
  };
  window.CoffeeCloudV97 = API_OBJ;
  window.CoffeeCloudV96 = API_OBJ;
  window.CoffeeCloudV95 = API_OBJ;
  window.CoffeeCloudV94 = API_OBJ;
  window.CoffeeCloudV93 = API_OBJ;
  window.CoffeeCloudV92 = API_OBJ;
})();
