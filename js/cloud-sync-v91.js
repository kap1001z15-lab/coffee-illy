/* Coffee Illy v91.0 — Production Cloud Sync Engine (Google Apps Script + Offline Outbox + Telegram Mini App) */
(function () {
  const CFG = window.COFFEE_CONFIG || {};
  const API_URL = CFG.API_URL || '';
  const OUTBOX_KEY = 'coffee_illy_v91_outbox';
  const SESSION_KEY = 'coffee_illy_v91_session';

  function localISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
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
    const body = Object.assign({ action: action, operationId: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }, payload || {});
    if (!body.sessionToken && sess.adminToken) body.sessionToken = sess.adminToken;
    if (!body.staffSessionToken && sess.staffToken) body.staffSessionToken = sess.staffToken;
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  let _flushing = false;
  async function flushOutbox() {
    if (_flushing || !API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const q = readOutbox();
    if (!q.length) return;
    _flushing = true;
    const keep = [];
    try {
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        try {
          const res = await gasPost(item.action, item.payload);
          if (res && res.ok === false && /PIN_REQUIRED|STAFF_AUTH_REQUIRED|FORBIDDEN/i.test(String(res.error || ''))) {
            // Drop unauthorized queued op so it doesn't block queue
            continue;
          }
        } catch (_) {
          keep.push(item);
        }
      }
      writeOutbox(keep);
    } finally {
      _flushing = false;
    }
  }

  function enqueueOp(action, payload) {
    if (!action) return;
    const q = readOutbox();
    q.push({ action: action, payload: payload || {}, ts: Date.now() });
    writeOutbox(q);
    flushOutbox().catch(() => {});
  }

  async function authLogin(role, opts) {
    try {
      const res = await gasPost('auth_login', Object.assign({ role: role }, opts || {}));
      if (res && res.ok && res.sessionToken) {
        if (role === 'admin') setSession({ adminToken: res.sessionToken });
        else setSession({ staffToken: res.sessionToken, staffName: (opts && opts.name) || '' });
      }
      return res;
    } catch (e) {
      return { ok: false, offline: true, error: String(e && e.message || e) };
    }
  }

  function mergeServerIntoState(state, data) {
    if (!data || typeof data !== 'object') return false;
    let changed = false;
    if (data.location) { state.location = data.location; changed = true; }
    if (Number(data.plan) > 0) { state.plan = Number(data.plan); changed = true; }
    if (Array.isArray(data.blocks) && data.blocks.length) {
      if (typeof data.blocks[0] === 'object') {
        state.blocks = data.blocks.map((b) => ({
          name: b.name || b.block || '',
          openTime: b.openTime || b.start || '08:00',
          deadline: b.deadline || b.end || '22:00'
        })).filter((b) => b.name);
        changed = true;
      }
    }
    if (Array.isArray(data.checklistBlocks) && data.checklistBlocks.length) {
      state.blocks = data.checklistBlocks.map((b) => ({
        name: b.name || '',
        openTime: b.openTime || '08:00',
        deadline: b.deadline || '22:00'
      })).filter((b) => b.name);
      changed = true;
    }
    if (Array.isArray(data.tasks) && data.tasks.length) {
      const clean = data.tasks.filter((t) => t && t.title && !String(t.id || '').startsWith('__SYS'));
      if (clean.length) {
        state.tasks = clean.map((t) => ({
          id: t.id || ('t_' + Math.random().toString(36).slice(2, 6)),
          block: t.block || 'Открытие',
          title: t.title || '',
          instruction: t.instruction || '',
          photo: String(t.photo || 'нет').toLowerCase() === 'да' ? 'да' : 'нет',
          responsible: t.responsible || 'Бариста',
          active: String(t.active || 'да').toLowerCase() === 'нет' ? 'нет' : 'да'
        }));
        changed = true;
      }
    }
    if (Array.isArray(data.cash) && data.cash.length) {
      state.cash = data.cash.map((c) => ({
        date: String(c.date || '').slice(0, 10),
        who: c.who || c.barista || '',
        total: Number(c.total || c.revenue || 0),
        cash: Number(c.cash || 0),
        card: Number(c.card || 0),
        checks: Number(c.checks || 0),
        avgCheck: Number(c.avgCheck || c.avg || 0)
      })).filter((c) => c.date);
      changed = true;
    }
    if (Array.isArray(data.expenses) && data.expenses.length) {
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
    if (Array.isArray(data.incidents) && data.incidents.length) {
      state.incidents = data.incidents.map((x) => ({
        id: x.id || ('INC-' + Math.random().toString(36).slice(2, 6)),
        date: String(x.date || '').slice(0, 10),
        time: x.time || '',
        block: x.block || '',
        zone: x.zone || x.step || '',
        text: x.text || x.comment || '',
        priority: x.priority || 'Терпит',
        status: x.status || 'Открыта',
        who: x.who || '',
        owner: x.owner || x.responsible || 'Администратор'
      }));
      changed = true;
    }
    if (Array.isArray(data.checklistsLog) && data.checklistsLog.length) {
      state.checklists = data.checklistsLog.map((c) => ({
        date: String(c.date || '').slice(0, 10),
        time: c.time || '',
        block: c.block || '',
        who: c.who || '',
        done: Number(c.done || 0),
        total: Number(c.total || 0)
      }));
      changed = true;
    }
    if (Array.isArray(data.staff) && data.staff.length) {
      const prevMap = {};
      (state.staff || []).forEach((s) => { prevMap[s.name] = s; });
      state.staff = data.staff.map((s) => {
        const prev = prevMap[s.name] || {};
        return Object.assign({}, prev, {
          name: s.name,
          role: s.role || prev.role || 'Бариста',
          shift: s.shift || prev.shift || '08:00–20:00',
          tgId: s.tgId || prev.tgId || '',
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
    return changed;
  }

  let _lastServerRev = '';
  let _lastActive = Date.now();
  let _pollTimer = null;

  function startCloudLoop(opts) {
    const mode = (opts && opts.mode) || 'terminal';
    const getState = opts && opts.getState;
    const onSynced = opts && opts.onSynced;

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Telegram WebApp setup
    try {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
    } catch (_) {}

    async function pullNow(forceFull) {
      if (!API_URL || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      try {
        await flushOutbox();
        const revRes = await gasGet({ action: 'get_rev', sinceRev: _lastServerRev });
        const srvRev = revRes && (revRes.rev != null ? String(revRes.rev) : '');
        if (!forceFull && srvRev && srvRev === _lastServerRev) return;
        if (srvRev) _lastServerRev = srvRev;

        let data = null;
        const sess = getSession();
        if (mode === 'owner' && sess.adminToken) {
          data = await gasPost('admin', { sessionToken: sess.adminToken });
        } else {
          data = await gasGet({ action: 'get_checklists', nocache: '1' });
        }
        if (data && getState) {
          const st = getState();
          const changed = mergeServerIntoState(st, data);
          if (srvRev) st.cloudRev = srvRev;
          if (changed && onSynced) onSynced(st, srvRev);
        }
      } catch (_) {}
    }

    function nextDelay() {
      if (document.hidden) return 30000;
      const idle = Date.now() - _lastActive;
      return idle < 120000 ? 1500 : (idle < 600000 ? 4000 : 12000);
    }

    function schedule() {
      clearTimeout(_pollTimer);
      _pollTimer = setTimeout(async () => {
        await pullNow(false);
        schedule();
      }, nextDelay());
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
      window.addEventListener(ev, () => { _lastActive = Date.now(); }, { passive: true })
    );
    const wake = () => { _lastActive = Date.now(); pullNow(false); };
    window.addEventListener('focus', wake);
    window.addEventListener('online', () => { flushOutbox(); wake(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });

    pullNow(true).finally(schedule);
    return { pullNow: pullNow, flushOutbox: flushOutbox };
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


  function dispatchStateChange(st, actor, desc) {
    if (!desc || !st) return;
    if (desc.indexOf('Сдан чек-лист') === 0 && st.checklists && st.checklists.length) {
      const last = st.checklists[0];
      enqueueOp('submit_checklist', { block: last.block, who: last.who || actor, date: last.date || localISO(), done: last.done, total: last.total });
    } else if (desc.indexOf('Закрыта касса') === 0 && st.cash && st.cash.length) {
      const last = st.cash[0];
      enqueueOp('submit_cash', { date: last.date || localISO(), who: last.who || actor, total: last.total, cash: last.cash, card: last.card, checks: last.checks });
    } else if (desc.indexOf('Проблема:') === 0 || desc.indexOf('Внеплановая поломка:') === 0) {
      const inc = st.incidents && st.incidents[0];
      if (inc) enqueueOp('report_standalone_incident', { id: inc.id, block: inc.block, zone: inc.zone, text: inc.text, priority: inc.priority, who: inc.who || actor, date: inc.date || localISO() });
    } else if (desc.indexOf('Решён инцидент') === 0) {
      const id = desc.replace('Решён инцидент ', '').trim();
      enqueueOp('update_incident', { id: id, status: 'Решена' });
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
      (st.plans || []).forEach((p) => { plansObj[p.day] = { revenue: p.revenue, avgCheck: p.avgCheck, checks: p.checks }; });
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
      enqueueOp('save_task', st.tasks[st.tasks.length - 1]);
    }
  }

  window.CoffeeCloudV91 = {
    dispatchStateChange: dispatchStateChange,
    localISO: localISO,
    localHHMM: localHHMM,
    authLogin: authLogin,
    enqueueOp: enqueueOp,
    flushOutbox: flushOutbox,
    startCloudLoop: startCloudLoop,
    getTelegramUser: getTelegramUser,
    getPendingCount: function () { return readOutbox().length; }
  };
})();
