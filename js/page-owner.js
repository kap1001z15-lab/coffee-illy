/* =========================================================================
   ЕДИНОЕ ПРИЛОЖЕНИЕ ВЛАДЕЛЬЦА И АДМИНИСТРАТОРА (ДАШБОРД + ОТЧЁТЫ + УПРАВЛЕНИЕ)
   Бесшовное переключение в одном окне без перезагрузки страницы и без диалогов!
   Любое изменение в «Управлении» в ту же миллисекунду отражается на Дашборде,
   в Отчётах и в Мобильном Терминале бариста.
   ========================================================================= */
let ownerTopSection = ['dashboard', 'report', 'admin'].includes(window.OWNER_START_SECTION) ? window.OWNER_START_SECTION : 'dashboard'; // 'dashboard' | 'report' | 'admin'
let ownerDashDate = window._isoToday ? window._isoToday() : new Date().toISOString().slice(0, 10);
try { const qd = new URLSearchParams(location.search).get('date'); if (/^\d{4}-\d{2}-\d{2}$/.test(qd || '')) ownerDashDate = qd; } catch (_) {}
let ownerDashFrom = ownerDashDate;
let ownerDashTo = ownerDashDate;
let ownerDashPeriodMode = 'today'; // 'today' | 'yest' | '7' | 'range'
let ownerRepFrom = window._shiftIso ? window._shiftIso(ownerDashDate, -6) : ownerDashDate;
let ownerRepTo = ownerDashDate;
let ownerSimAvg = 5, ownerSimChk = 10, ownerSimWo = 30;


/* ---------- ВХОД ПО PIN-КОДУ НА СТАРТЕ ПАНЕЛИ ВЛАДЕЛЬЦА И УПРАВЛЕНИЯ (СТАРТОВЫЙ PIN: 1234) ---------- */
function ensureOwnerPinGate(forceShow) {
  if (typeof document === 'undefined') return true;
  if (!forceShow && window.COFFEE_ACTIVE_SYSTEM_MODE === 'terminal') {
    const existing = document.getElementById('ownerPinGateModal');
    if (existing) existing.remove();
    return true;
  }
  if (!forceShow && window.coffeeAuth && window.coffeeAuth.isAuthorized('admin')) {
    const existing = document.getElementById('ownerPinGateModal');
    if (existing) existing.remove();
    return true;
  }
  let modal = document.getElementById('ownerPinGateModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ownerPinGateModal';
    modal.className = 'ntf-modal';
    modal.style.zIndex = '9999';
    document.body.appendChild(modal);
  }

  modal.innerHTML =
    '<div class="ntf-card" style="max-width:340px;width:90vw;padding:24px 20px;text-align:center">' +
      '<h3 style="margin:0 0 4px;font-size:18px">Панель владельца</h3>' +
      '<p class="mu" style="margin:0 0 14px;font-size:13px">Введите код доступа владельца</p>' +
      '<form id="ownerPinGateForm">' +
        '<input type="password" id="ownerPinGateInp" inputmode="numeric" autocomplete="off" placeholder="PIN (1234)" style="width:100%;height:46px;border-radius:12px;border:1px solid var(--line);background:var(--bg);padding:0 14px;font-size:18px;font-weight:700;text-align:center;letter-spacing:4px;color:var(--ink)">' +
        '<div id="ownerPinGateErr" style="color:var(--bad);font-size:12.5px;min-height:18px;margin:6px 0"></div>' +
        '<button type="submit" class="p" style="width:100%;min-height:44px;font-size:15px;cursor:pointer">Войти</button>' +
      '</form>' +
    '</div>';

  const inp = document.getElementById('ownerPinGateInp');
  const form = document.getElementById('ownerPinGateForm');
  const errBox = document.getElementById('ownerPinGateErr');
  setTimeout(() => { if (inp) inp.focus(); }, 40);

  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const pinVal = (inp && inp.value ? inp.value.trim() : '');
      if (!pinVal) {
        if (errBox) errBox.textContent = 'Введите PIN-код';
        return;
      }
      const rl = window.coffeeRateLimiter ? window.coffeeRateLimiter.check('owner_admin') : { locked: false };
      if (rl.locked) {
        if (errBox) errBox.textContent = rl.message;
        return;
      }
      const okOwner = window.coffeeAuth && window.coffeeAuth.verifyOwnerPin ? window.coffeeAuth.verifyOwnerPin(pinVal) : (pinVal === '1234');
      if (!okOwner) {
        const st = window.coffeeRateLimiter ? window.coffeeRateLimiter.check('owner_admin') : { remainingAttempts: 4 };
        if (errBox) {
          errBox.textContent = st.locked
            ? st.message
            : ('Неверный код. Осталось попыток: ' + (st.remainingAttempts ?? 4));
        }
        return;
      }
      if (window.coffeeRateLimiter) window.coffeeRateLimiter.reset('owner_admin');
      const expHash = window.coffeeAuth && window.coffeeAuth.getExpectedOwnerPinHash ? window.coffeeAuth.getExpectedOwnerPinHash() : pinVal;
      if (window.coffeeAuth && window.coffeeAuth.createLocalSession) {
        window.coffeeAuth.createLocalSession('admin', 'Владелец', expHash);
      }
      const m = document.getElementById('ownerPinGateModal');
      if (m) m.remove();
      switchOwnerTopSection(ownerTopSection);
    };
  }
  return false;
}
window.ensureOwnerPinGate = ensureOwnerPinGate;

function switchOwnerTopSection(sec, focusDateOpt) {
  ownerTopSection = sec || 'dashboard';
  if (focusDateOpt) {
    ownerDashDate = focusDateOpt;
    ownerDashFrom = focusDateOpt;
    ownerDashTo = focusDateOpt;
    ownerDashPeriodMode = 'range';
  }
  document.querySelectorAll('#ownerMainNav button[data-osec]').forEach((b) => {
    b.classList.toggle('on', b.dataset.osec === ownerTopSection);
  });
  $('ownerSecDashboard').hidden = ownerTopSection !== 'dashboard';
  $('ownerSecReport').hidden = ownerTopSection !== 'report';
  $('content').hidden = ownerTopSection !== 'admin';
  if (ownerTopSection === 'dashboard') renderOwnerDashboardSection();
  if (ownerTopSection === 'report') renderOwnerReportSection();
  if (ownerTopSection === 'admin') load();
}

function renderOwnerNotificationsDrawer() {
  const db = getUDB();
  const list = Array.isArray(db.liveNotifications) ? db.liveNotifications : [];
  const unread = list.filter((n) => n && !n.read).length;
  if ($('ownerNotifCount')) {
    $('ownerNotifCount').textContent = unread > 0 ? String(unread) : '0';
    $('ownerNotifBtn').style.borderColor = unread > 0 ? '#ff7a5f' : 'rgba(255,255,255,.22)';
    $('ownerNotifBtn').style.background = unread > 0 ? 'rgba(194,59,34,.35)' : 'rgba(255,255,255,.1)';
  }
  const box = $('ownerNotifDrawer');
  if (!box || box.hidden) return;
  box.innerHTML =
    '<div class="top" style="margin-bottom:8px">' +
      '<div><h2 style="margin:0">🔔 Мгновенные уведомления (' + list.length + ')</h2></div>' +
      '<div style="display:flex;gap:6px">' +
        '<button type="button" class="b ok" id="ownerNotifReadAllBtn">✓ Прочитано</button>' +
        '<button type="button" class="b" id="ownerNotifCloseBtn">✕</button>' +
      '</div>' +
    '</div>' +
    (list.length ? list.slice(0, 15).map((n) => {
      const col = n.level === 'critical' ? 'var(--bad)' : (n.level === 'warn' ? 'var(--warn)' : 'var(--good)');
      const mediaCnt = ntfCollect(n, db).media.length;
      return '<div class="row ntf-row" data-ntf-id="' + esc(n.id) + '" tabindex="0" role="button" title="Открыть фото и комментарии" style="grid-template-columns:1fr auto;border-left:4px solid ' + col + ';padding-left:10px;cursor:pointer">' +
        '<div><b>' + esc(n.title) + '</b> <span class="mu">(' + dmy(n.date) + ' ' + esc(n.time) + ' · ' + esc(n.actor) + ')</span>' +
        '<div class="mu" style="margin-top:2px">' + esc(n.text) + '</div>' +
        '<div class="mu" style="margin-top:3px;font-size:12px">' + (mediaCnt ? '📷 ' + mediaCnt + ' · ' : '') + 'Нажмите, чтобы открыть ›</div></div>' +
        '<span class="tag ' + (n.level === 'critical' ? 'no' : (n.level === 'ok' ? 'ok' : '')) + '">' + (n.read ? 'Прочитано' : 'Новое') + '</span>' +
      '</div>';
    }).join('') : '<p class="mu" style="margin:0">Новых уведомлений нет.</p>');
}

/* ---------- Уведомление → сразу фото/видео и комментарии баристы ---------- */
function ntfPhotoSrc(u) {
  try { return String((window.CoffeeIDB ? window.CoffeeIDB.getPhotoSync(u) : u) || '').trim(); } catch (_) { return String(u || '').trim(); }
}
function ntfCollect(n, db) {
  const res = { media: [], comments: [], inc: null };
  if (!n || !db) return res;
  const seen = {};
  const addMedia = (url, label, comment) => {
    const u = ntfPhotoSrc(url);
    if (!u || seen[u]) return;
    seen[u] = 1;
    res.media.push({ url: u, label: label || '', comment: comment || '' });
  };
  const incs = Array.isArray(db.incidents) ? db.incidents : [];
  const txt = String(n.text || '');
  let inc = null;
  const idRef = n.incId || ((txt.match(/INC-[A-Z0-9_-]+/) || [])[0] || '');
  if (idRef) inc = incs.find((x) => x && x.id === idRef) || null;
  if (!inc && n.type === 'incident') {
    inc = incs.find((x) => x && x.date === n.date && x.who === n.actor && x.text && txt.indexOf(x.text) === 0) || null;
  }
  if (inc) {
    res.inc = inc;
    const list = (Array.isArray(inc.photos) && inc.photos.length ? inc.photos : (inc.photo ? [inc.photo] : []));
    list.forEach((u, i) => addMedia(u, (inc.step || 'Поломка') + (list.length > 1 ? ' · кадр ' + (i + 1) : ''), ''));
    if (inc.text) res.comments.push({ who: inc.who || n.actor, time: (inc.time || ''), label: inc.step || inc.incType || 'Комментарий', text: inc.text, meta: [inc.priority, inc.status].filter(Boolean).join(' · ') });
  }
  if (n.type === 'checklist' || n.type === 'overdue') {
    const blk = n.block || ((String(n.title || '').match(/«(.+?)»/) || [])[1] || '');
    if (blk) {
      const chks = (db.checklists || []).filter((c) => c && c.date === n.date && c.block === blk);
      const chk = chks.find((c) => c.who === n.actor) || chks[chks.length - 1];
      if (chk && Array.isArray(chk.photos)) {
        chk.photos.forEach((p) => {
          if (!p) return;
          addMedia(p.url, p.step, p.comment);
          if (p.comment) res.comments.push({ who: chk.who || n.actor, time: p.completedAt || '', label: p.step || 'Пункт чек-листа', text: p.comment, meta: p.isIncident ? 'Проблема' : '' });
        });
      }
      incs.filter((x) => x && x.date === n.date && x.block === blk && x !== inc).forEach((x) => {
        const list = (Array.isArray(x.photos) && x.photos.length ? x.photos : (x.photo ? [x.photo] : []));
        list.forEach((u, i) => addMedia(u, (x.step || 'Проблема') + (list.length > 1 ? ' · кадр ' + (i + 1) : ''), x.text));
        if (x.text && !x.isOverdueAuto) res.comments.push({ who: x.who || n.actor, time: x.time || '', label: x.step || 'Проблема', text: x.text, meta: [x.priority, x.status].filter(Boolean).join(' · ') });
      });
    }
  }
  return res;
}
function ntfMediaBigHtml(m) {
  if (!m) return '<div class="ntf-empty">📷 К этому уведомлению фото или видео не приложено</div>';
  const u = esc(m.url);
  if (/^data:video\/|\.(mp4|webm|mov)(\?|$)/i.test(m.url)) return '<video src="' + u + '" controls autoplay muted playsinline class="ntf-big"></video>';
  return '<a href="' + u + '" target="_blank" rel="noopener"><img src="' + u + '" alt="' + esc(m.label || 'Фото') + '" class="ntf-big"></a>';
}
function closeNtfModal() {
  const m = $('ownerNtfModal');
  if (m) m.remove();
  document.removeEventListener('keydown', ntfEsc, true);
}
function ntfEsc(e) { if (e.key === 'Escape') { e.preventDefault(); closeNtfModal(); } }
function openNtfModal(id) {
  const db = getUDB();
  const n = (db.liveNotifications || []).find((x) => x && x.id === id);
  if (!n) return;
  closeNtfModal();
  const data = ntfCollect(n, db);
  const thumbs = data.media.length > 1
    ? '<div class="ntf-thumbs">' + data.media.map((m, i) => {
        const isVid = /^data:video\/|\.(mp4|webm|mov)(\?|$)/i.test(m.url);
        return '<button type="button" class="ntf-th' + (i === 0 ? ' on' : '') + '" data-ntf-th="' + i + '">' +
          (isVid ? '<span>▶</span>' : '<img src="' + esc(m.url) + '" alt="">') + '</button>';
      }).join('') + '</div>'
    : '';
  const comments = data.comments.length
    ? data.comments.map((c) =>
        '<div class="ntf-cm"><div class="ntf-cm-h"><b>' + esc(c.who) + '</b>' + (c.time ? ' <span class="mu">· ' + esc(c.time) + '</span>' : '') +
        (c.label ? ' <span class="mu">· ' + esc(c.label) + '</span>' : '') + '</div>' +
        '<div class="ntf-cm-t">' + esc(c.text) + '</div>' +
        (c.meta ? '<div class="mu" style="font-size:12px;margin-top:2px">' + esc(c.meta) + '</div>' : '') + '</div>').join('')
    : '<div class="ntf-cm"><div class="ntf-cm-t">' + esc(n.text || 'Подробностей нет.') + '</div></div>';
  const wrap = document.createElement('div');
  wrap.id = 'ownerNtfModal';
  wrap.className = 'ntf-modal';
  wrap.innerHTML =
    '<div class="ntf-card" role="dialog" aria-modal="true" aria-label="Уведомление">' +
      '<div class="ntf-head"><div><b>' + esc(n.title) + '</b><div class="mu" style="font-size:12.5px">' + dmy(n.date) + ' ' + esc(n.time) + ' · ' + esc(n.actor) + (data.inc ? ' · ' + esc(data.inc.id) : '') + '</div></div>' +
      '<button type="button" class="b" id="ntfCloseBtn">✕</button></div>' +
      (data.media.length ? '<div class="ntf-media" id="ntfMediaBox">' + ntfMediaBigHtml(data.media[0]) + '</div>' + thumbs : '') +
      '<div class="ntf-sec">' + (data.media.length ? '💬 Комментарий баристы' : 'ℹ️ Что произошло') + '</div>' + comments +
    '</div>';
  document.body.appendChild(wrap);
  document.addEventListener('keydown', ntfEsc, true);
  try { $('ntfCloseBtn').focus(); } catch (_) {}
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.id === 'ntfCloseBtn') { closeNtfModal(); return; }
    const th = e.target.closest('[data-ntf-th]');
    if (th) {
      const i = Number(th.dataset.ntfTh);
      const box = $('ntfMediaBox'); if (box) box.innerHTML = ntfMediaBigHtml(data.media[i]);
      wrap.querySelectorAll('.ntf-th').forEach((b) => b.classList.toggle('on', b === th));
    }
  });
  // открытое уведомление считается прочитанным
  if (!n.read) {
    n.read = true;
    try { saveUDB(db); if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'notifications_read' }); } catch (_) {}
    renderOwnerNotificationsDrawer();
  }
}
document.addEventListener('click', (e) => {
  const row = e.target && e.target.closest && e.target.closest('[data-ntf-id]');
  if (row) openNtfModal(row.getAttribute('data-ntf-id'));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target && e.target.closest && e.target.closest('[data-ntf-id]');
  if (row) { e.preventDefault(); openNtfModal(row.getAttribute('data-ntf-id')); }
});

/* =========================================================================
   1. ДАШБОРД — ТОЛЬКО КРАТКАЯ ИНФОРМАЦИЯ («ВСЁ ЛИ В ПОРЯДКЕ?»)
      За Сегодня, Вчера или выбранный промежуток дат
   ========================================================================= */
function renderOwnerDashboardSection() {
  const db = getUDB();
  if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
  if ($('sub') && db.location) $('sub').textContent = 'Панель управления · ' + db.location;

  const isSingleDay = ownerDashFrom === ownerDashTo;
  const periodLabel = isSingleDay
    ? (dmy(ownerDashFrom) + (ownerDashFrom === _isoToday() ? ' (Сегодня)' : (ownerDashFrom === _shiftIso(_isoToday(), -1) ? ' (Вчера)' : '')))
    : (dmy(ownerDashFrom) + ' — ' + dmy(ownerDashTo));

  const fin = window.coffeeCalculateFinancialModel ? window.coffeeCalculateFinancialModel(db, ownerDashFrom, ownerDashTo) : { revenue: 0, checksTotal: 0, avgCheck: 0, writeoffsTotal: 0, netProfit: 0 };
  let planRev = 0, planChk = 0, planAvgSum = 0, daysCnt = 0;
  let curD = ownerDashFrom;
  while (curD <= ownerDashTo && daysCnt < 366) {
    const dp = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(curD, db) : { revenue: Number(db.plan) || 2200, checks: 75, avgCheck: 35 };
    planRev += dp.revenue;
    planChk += dp.checks;
    planAvgSum += dp.avgCheck;
    daysCnt++;
    curD = _shiftIso(curD, 1);
  }
  planRev = Math.max(1, planRev);
  planChk = Math.max(1, planChk);
  const planAvg = Math.max(1, Math.round(planAvgSum / Math.max(1, daysCnt)));
  const woNormTotal = (Math.max(0, Number(db.woNorm) || 15)) * Math.max(1, daysCnt);

  const factRev = fin.revenue || 0;
  const factChk = fin.checksTotal || 0;
  const factAvg = fin.avgCheck || 0;
  const factWo = fin.writeoffsTotal || 0;
  const rPct = Math.round((factRev / planRev) * 100);
  const cPct = Math.round((factChk / planChk) * 100);

  const periodChecklists = (db.checklists || []).filter((c) => c && c.date >= ownerDashFrom && c.date <= ownerDashTo);
  const lateChecklists = periodChecklists.filter((c) => c.isLate || c.status === 'Просрочено');
  const openIncs = (db.incidents || []).filter((i) => i && window.coffeeIsIncActive(i.status));
  const flags = window.coffeeEvaluateRedFlags ? window.coffeeEvaluateRedFlags(ownerDashTo, db) : [];
  const redFlagsOnly = flags.filter((f) => f.level === 'red');
  const cBlocks = window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks(db) : [];
  const overdueBlocksNow = cBlocks.filter((bObj) => {
    const w = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow(bObj.name, db) : { state: 'open' };
    return w.state === 'overdue_closed';
  });

  let statusLevel = 'ok';
  let statusTitle = '🟢 Всё в порядке — точка работает штатно';
  let statusSub = 'За выбранный период (' + periodLabel + ') критических отклонений, красных флагов и незакрытых поломок нет.';
  if (redFlagsOnly.length > 0 || openIncs.some((i) => i.priority === 'Критично') || overdueBlocksNow.length > 0) {
    statusLevel = 'bad';
    statusTitle = '🔴 Внимание: есть отклонения, требующие реакции';
    const reasons = [];
    if (redFlagsOnly.length) reasons.push('Красных флагов: ' + redFlagsOnly.length);
    if (openIncs.length) reasons.push('Активных поломок: ' + openIncs.length);
    if (overdueBlocksNow.length) reasons.push('Просрочено чек-листов: ' + overdueBlocksNow.length);
    statusSub = reasons.join(' · ');
  } else if (openIncs.length > 0 || lateChecklists.length > 0 || (factRev > 0 && rPct < 85) || factWo > woNormTotal) {
    statusLevel = 'warn';
    statusTitle = '🟡 Работает стабильно, есть небольшие замечания';
    const reasons = [];
    if (factRev > 0 && rPct < 85) reasons.push('Выручка ' + rPct + '% от плана');
    if (openIncs.length) reasons.push('Задач в работе: ' + openIncs.length);
    if (lateChecklists.length) reasons.push('Опозданий по чек-листам: ' + lateChecklists.length);
    if (factWo > woNormTotal) reasons.push('Списания выше нормы');
    statusSub = reasons.join(' · ');
  }

  const stCol = statusLevel === 'ok' ? 'var(--good)' : (statusLevel === 'warn' ? 'var(--warn)' : 'var(--bad)');
  const hasUrgentItems = redFlagsOnly.length > 0 || openIncs.length > 0 || overdueBlocksNow.length > 0;

  const _newDashHtml =
    '<div class="card">' +
      '<div class="top" style="margin-bottom:14px">' +
        '<div><h2 style="margin:0">🏎️ Дашборд состояния · ' + esc(periodLabel) + '</h2></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
          '<button type="button" class="b ' + (ownerDashPeriodMode === 'today' ? 'on' : '') + '" data-odp="today" style="' + (ownerDashPeriodMode === 'today' ? 'background:var(--brew);color:#fff' : '') + '">Сегодня</button>' +
          '<button type="button" class="b ' + (ownerDashPeriodMode === 'yest' ? 'on' : '') + '" data-odp="yest" style="' + (ownerDashPeriodMode === 'yest' ? 'background:var(--brew);color:#fff' : '') + '">Вчера</button>' +
          '<button type="button" class="b ' + (ownerDashPeriodMode === '7' ? 'on' : '') + '" data-odp="7" style="' + (ownerDashPeriodMode === '7' ? 'background:var(--brew);color:#fff' : '') + '">7 дней</button>' +
          '<button type="button" class="b ' + (ownerDashPeriodMode === '30' ? 'on' : '') + '" data-odp="30" style="' + (ownerDashPeriodMode === '30' ? 'background:var(--brew);color:#fff' : '') + '">30 дней</button>' +
          '<input type="date" id="oDashFrom" value="' + esc(ownerDashFrom) + '" style="width:auto;padding:6px 9px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)">' +
          '<span>—</span>' +
          '<input type="date" id="oDashTo" value="' + esc(ownerDashTo) + '" style="width:auto;padding:6px 9px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)">' +
          '<button type="button" class="p" id="oDashApplyRangeBtn" style="min-height:38px;padding:0 14px">Показать</button>' +
        '</div>' +
      '</div>' +

      /* ГЛАВНЫЙ ИНДИКАТОР «ВСЁ ЛИ В ПОРЯДКЕ?» */
      '<div style="padding:16px 18px;border-radius:16px;border:2px solid ' + stCol + ';background:color-mix(in srgb,' + stCol + ' 8%,var(--surface));margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div>' +
          '<div style="font-size:18px;font-weight:800">' + esc(statusTitle) + '</div>' +
          '<div class="mu" style="margin-top:4px">' + esc(statusSub) + '</div>' +
        '</div>' +
        '<button type="button" class="p" id="oDashGoFullReportBtn" style="min-height:40px;padding:0 16px">📊 Вся информация в Отчётах ➔</button>' +
      '</div>' +

      /* 4 КРАТКИХ КАРТОЧКИ ГЛАВНЫХ ЦИФР */
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">' +
        '<div style="padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--bg)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mu" style="font-weight:700;font-size:12px">ВЫРУЧКА</span><span class="tag ' + (rPct >= 98 ? 'ok' : (rPct < 85 ? 'no' : '')) + '">' + rPct + '% плана</span></div>' +
          '<div style="font-size:24px;font-weight:800;margin:6px 0 2px;color:var(--good)">' + rub(factRev) + '</div>' +
          '<div class="mu" style="font-size:12.5px">План: ' + rub(planRev) + '</div>' +
        '</div>' +

        '<div style="padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--bg)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mu" style="font-weight:700;font-size:12px">ЧЕКИ И СРЕДНИЙ ЧЕК</span><span class="tag ' + (cPct >= 95 ? 'ok' : '') + '">' + cPct + '%</span></div>' +
          '<div style="font-size:24px;font-weight:800;margin:6px 0 2px">' + factChk + ' · ' + rub(factAvg) + '</div>' +
          '<div class="mu" style="font-size:12.5px">План: ' + planChk + ' чек. (≥ ' + rub(planAvg) + ')</div>' +
        '</div>' +

        '<div style="padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--bg)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mu" style="font-weight:700;font-size:12px">ЧИСТАЯ ПРИБЫЛЬ</span><span class="tag ' + (factWo <= woNormTotal ? 'ok' : 'no') + '">Спис.: ' + rub(factWo) + '</span></div>' +
          '<div style="font-size:24px;font-weight:800;margin:6px 0 2px;color:' + (fin.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + rub(fin.netProfit) + '</div>' +
          '<div class="mu" style="font-size:12.5px">За вычетом ТТК, ФОТ и расходов</div>' +
        '</div>' +

        '<div style="padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--bg)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mu" style="font-weight:700;font-size:12px">ЧЕК-ЛИСТЫ И ПОЛОМКИ</span><span class="tag ' + (openIncs.length === 0 && overdueBlocksNow.length === 0 ? 'ok' : 'no') + '">' + (openIncs.length === 0 && overdueBlocksNow.length === 0 ? 'ОК' : 'Внимание') + '</span></div>' +
          '<div style="font-size:24px;font-weight:800;margin:6px 0 2px">' + periodChecklists.length + ' сд. · ' + openIncs.length + ' пол.</div>' +
          '<div class="mu" style="font-size:12.5px">Опозданий: ' + lateChecklists.length + ' · Просрочено сейчас: ' + overdueBlocksNow.length + '</div>' +
        '</div>' +
      '</div>' +

      /* ПОКАЗЫВАЕМ СПИСОК ТОЛЬКО ЕСЛИ ЕСТЬ АКТИВНЫЕ ОТКЛОНЕНИЯ ИЛИ ПОЛОМКИ */
      (hasUrgentItems ? (
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
          '<div class="top" style="margin-bottom:6px"><b style="color:var(--bad)">⚠️ Пункты, требующие реакции руководителя:</b></div>' +
          redFlagsOnly.map((f) => '<div class="row" style="padding:6px 0"><div><b>' + esc(f.title) + '</b><div class="mu" style="font-size:12.5px">' + esc(f.desc) + '</div></div></div>').join('') +
          overdueBlocksNow.map((bObj) => '<div class="row" style="padding:6px 0"><div><b>🔒 Просрочен чек-лист «' + esc(bObj.name) + '»</b> <span class="mu">(дедлайн ' + esc(bObj.deadline) + ')</span></div><div class="acts"><button type="button" class="b ok" data-dashunlock="' + esc(bObj.name) + '">🔓 Открыть доступ бариста</button></div></div>').join('') +
          openIncs.slice(0, 5).map((inc) => '<div class="row" style="padding:6px 0"><div><b>🔧 ' + esc(inc.step) + '</b> <span class="tag no">' + esc(inc.priority || '24ч') + '</span><div class="mu" style="font-size:12.5px">' + esc(inc.text) + ' · Сообщил: ' + esc(inc.who || 'Бариста') + '</div></div><div class="acts"><button type="button" class="b ok" data-dashresolve="' + esc(inc.id) + '">✓ Решена</button></div></div>').join('') +
        '</div>'
      ) : '') +
    '</div>';
  const _dashEl = $('ownerSecDashboard');
  if (_dashEl && _dashEl._lastHtml !== _newDashHtml) {
    _dashEl._lastHtml = _newDashHtml;
    _dashEl.innerHTML = _newDashHtml;
  }
}

/* =========================================================================
   2. ОТЧЁТЫ — АБСОЛЮТНО ВСЯ СОБИРАЕМАЯ ИНФОРМАЦИЯ СИСТЕМЫ (7 ПОЛНЫХ БЛОКОВ)
   ========================================================================= */
function renderOwnerReportSection() {
  const db = getUDB();
  if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
  const fin = window.coffeeCalculateFinancialModel ? window.coffeeCalculateFinancialModel(db, ownerRepFrom, ownerRepTo) : { revenue: 0, cogs: 0, grossProfit: 0, grossMarginPct: 0, foodCostPct: 0, effectivePayroll: 0, laborCostPct: 0, nonPayrollOpex: 0, opexPct: 0, wasteCost: 0, netProfit: 0, netMarginPct: 0, checksTotal: 0, avgCheck: 0, cac: 0, dayByDayPnL: [], ttkEconomics: [], opexByCategory: [] };
  const rep = window.coffeeGetInstantReport ? window.coffeeGetInstantReport(ownerRepFrom, ownerRepTo) : buildReportResponse(ownerRepFrom, ownerRepTo);
  const sim = window.coffeeSmartEngine ? window.coffeeSmartEngine.simulate(db, ownerSimAvg, ownerSimChk, ownerSimWo) : { extraMonthlyProfit: 0, breakEvenDay: 12, breakEvenRevenue: 30000 };
  const disc = window.coffeeCalcDiscipline ? window.coffeeCalcDiscipline(db, ownerRepFrom, ownerRepTo) : { byStaff: [], overallPct: 100, totalOnTime: 0, totalAssigned: 0 };

  // Все чек-листы за период + все фото/видео
  const periodChecklists = (db.checklists || []).filter((c) => c && c.date >= ownerRepFrom && c.date <= ownerRepTo).slice().reverse();
  const allPhotosInPeriod = [];
  periodChecklists.forEach((chk) => {
    (chk.photos || []).forEach((ph) => {
      if (ph && ph.url) {
        allPhotosInPeriod.push({
          date: chk.date,
          time: ph.completedAt || chk.time || '',
          block: chk.block,
          who: chk.who || 'Бариста',
          step: ph.step || chk.block,
          url: ph.url,
          isIncident: !!ph.isIncident,
          comment: ph.comment || ''
        });
      }
    });
  });

  // Все инциденты за период (или все активные + закрытые за период)
  const periodIncidents = (db.incidents || []).filter((i) => i && (!i.date || (i.date >= ownerRepFrom && i.date <= ownerRepTo) || window.coffeeIsIncActive(i.status)));
  const cashHist = (db.cashHistory || []).filter((h) => !h.date || (h.date >= ownerRepFrom && h.date <= ownerRepTo));
  const auditsList = (db.serviceAudits || []).filter((a) => !a.date || (a.date >= ownerRepFrom && a.date <= ownerRepTo));
  const annsList = db.announcements || [];
  const goodDeedsList = db.goodDeeds || window.COFFEE_DEFAULT_GOOD_DEEDS || [];
  const auditLogList = (db.auditLog || []).slice(0, 80);
  const soldProducts = rep.products || [];

  // Полная таблица по сотрудникам (Смены, Выручка, Счётчик, Дисциплина, Аудит сервиса, Расчёт ФОТ и бонуса KPI)
  const staffNamesSet = new Set((db.staff || []).map((s) => s.name));
  Object.keys(rep.staff || {}).forEach((nm) => staffNamesSet.add(nm));
  (disc.byStaff || []).forEach((s) => staffNamesSet.add(s.name));
  const fullStaffRows = Array.from(staffNamesSet).filter(Boolean).map((nm) => {
    const stProfile = (db.staff || []).find((s) => s.name === nm) || { name: nm, role: 'Бариста' };
    const sFin = (rep.staff && rep.staff[nm]) || { shifts: 0, cash: 0, card: 0, revenue: 0, checks: 0, cups: 0, writeoff: 0 };
    const sDisc = (disc.byStaff || []).find((d) => d.name === nm) || { onTimeTasks: 0, lateTasks: 0, missedTasks: 0, disciplinePct: 100 };
    const sAud = window.coffeeCalcServiceAudit ? window.coffeeCalcServiceAudit(nm, ownerRepFrom, ownerRepTo) : { count: 0, avgScore: 95 };
    const sBonus = window.coffeeSmartEngine && window.coffeeSmartEngine.calcStaffBonus
      ? window.coffeeSmartEngine.calcStaffBonus(sFin, sDisc.disciplinePct, sAud.avgScore, sFin.writeoff, db.woNorm || 15)
      : { baseRate: sFin.shifts * 250, bonus: Math.round(sFin.revenue * 0.05), totalPayout: sFin.shifts * 250 + Math.round(sFin.revenue * 0.05), kpiCoeff: 1 };
    return {
      name: nm,
      role: stProfile.role || 'Бариста',
      shifts: sFin.shifts,
      cash: sFin.cash,
      card: sFin.card,
      revenue: sFin.revenue,
      checks: sFin.checks,
      cups: sFin.cups,
      writeoff: sFin.writeoff,
      onTimeTasks: sDisc.onTimeTasks,
      lateTasks: sDisc.lateTasks,
      missedTasks: sDisc.missedTasks,
      disciplinePct: sDisc.disciplinePct,
      auditScore: sAud.avgScore,
      auditCount: sAud.count,
      baseRate: sBonus.baseRate,
      bonus: sBonus.bonus,
      kpiCoeff: sBonus.kpiCoeff,
      totalPayout: sBonus.totalPayout
    };
  });

  const _newRepHtml =
    /* ШАПКА ОТЧЁТОВ И ВЫБОР ПЕРИОДА */
    '<div class="card">' +
      '<div class="top" style="margin-bottom:10px">' +
        '<div><h2 style="margin:0">📊 Полный аналитический и финансовый отчёт (' + dmy(ownerRepFrom) + ' — ' + dmy(ownerRepTo) + ')</h2>' +
        '<div class="mu">Абсолютно все собираемые данные системы: P&amp;L (ОПиУ), касса и Z-отчёты, счётчики кофемашины, продажи и ТТК, фотоотчёты 6 чек-листов, ФОТ и KPI бариста, поломки и журнал аудита</div></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
          '<button type="button" class="b" data-orp="today">Сегодня</button>' +
          '<button type="button" class="b" data-orp="yest">Вчера</button>' +
          '<button type="button" class="b" data-orp="7">7 дней</button>' +
          '<button type="button" class="b" data-orp="30">30 дней</button>' +
          '<button type="button" class="b" data-orp="month">Месяц</button>' +
          '<input type="date" id="oRepFrom" value="' + esc(ownerRepFrom) + '" style="width:auto;padding:6px 10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)">' +
          '<span>—</span>' +
          '<input type="date" id="oRepTo" value="' + esc(ownerRepTo) + '" style="width:auto;padding:6px 10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)">' +
          '<button type="button" class="p" id="oRepApplyBtn">Показать</button>' +
          '<button type="button" class="b" id="oRepCsvBtn">⬇ Скачать CSV</button>' +
          '<button type="button" class="b" id="oRepPrintBtn">🖨 Печать</button>' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:10px">' +
        '<div style="padding:13px;border-radius:14px;border:1px solid var(--line);background:var(--bg)"><div class="mu">1. Выручка (Нал + Безнал)</div><div style="font-size:22px;font-weight:800;color:var(--good);margin:4px 0">' + rub(fin.revenue) + '</div><div class="mu">Нал: ' + rub(fin.cashTotal) + ' (' + (fin.cashSharePct || 0) + '%) · Безнал: ' + rub(fin.cardTotal) + '</div><div class="mu">План периода: ' + rub(rep.plan || 0) + ' (' + (rep.pct || 0) + '%)</div></div>' +
        '<div style="padding:13px;border-radius:14px;border:1px solid var(--line);background:var(--bg)"><div class="mu">2. Себестоимость (COGS по ТТК)</div><div style="font-size:22px;font-weight:800;margin:4px 0">' + rub(fin.cogs) + '</div><div class="mu">Food Cost: <b>' + fin.foodCostPct + '%</b> · Валовая прибыль: <b>' + rub(fin.grossProfit) + '</b> (' + (fin.grossMarginPct || 0) + '%)</div></div>' +
        '<div style="padding:13px;border-radius:14px;border:1px solid var(--line);background:var(--bg)"><div class="mu">3. ФОТ смен + Опер. расходы</div><div style="font-size:22px;font-weight:800;color:var(--bad);margin:4px 0">' + rub(fin.effectivePayroll + fin.nonPayrollOpex) + '</div><div class="mu">ФОТ (' + (fin.shiftsCount || 0) + ' см.): ' + rub(fin.effectivePayroll) + ' (' + (fin.laborCostPct || 0) + '%) · OpEx: ' + rub(fin.nonPayrollOpex) + '</div></div>' +
        '<div style="padding:13px;border-radius:14px;border:1.5px solid ' + (fin.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + ';background:color-mix(in srgb,' + (fin.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + ' 6%,var(--surface))"><div class="mu" style="font-weight:700">4. Чистая прибыль (Net Profit)</div><div style="font-size:23px;font-weight:800;color:' + (fin.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + ';margin:4px 0">' + rub(fin.netProfit) + '</div><div class="mu">Рентабельность: <b>' + (fin.netMarginPct || 0) + '%</b> · Потери списаний: ' + rub(fin.wasteCost) + '</div></div>' +
        '<div style="padding:13px;border-radius:14px;border:1px solid var(--line);background:var(--bg)"><div class="mu">5. Гости, Чеки и CAC</div><div style="font-size:22px;font-weight:800;margin:4px 0">' + fin.checksTotal + ' чек. · ' + rub(fin.avgCheck) + '</div><div class="mu">Ср. выручка смены: ' + rub(fin.avgRevPerShift || 0) + ' · CAC: ' + rub(fin.cac) + '</div></div>' +
      '</div>' +
    '</div>' +

    /* БЛОК 1: ПОЛНЫЙ УПРАВЛЕНЧЕСКИЙ ОТЧЁТ P&L (ОПиУ) И СТРУКТУРА РАСХОДОВ */
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:14px">' +
      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">1. Управленческий отчёт P&amp;L (ОПиУ)</h2><span class="tag ok">Все доходы и издержки</span></div>' +
        '<div class="sx"><table class="tbl"><thead><tr><th>Статья P&amp;L</th><th>Сумма, руб.</th><th>% от выручки</th><th>Расшифровка</th></tr></thead><tbody>' +
          '<tr><td><b>Выручка (Итого)</b></td><td><b style="color:var(--good)">' + rub(fin.revenue) + '</b></td><td>100%</td><td class="mu">Нал ' + rub(fin.cashTotal) + ' + Безнал ' + rub(fin.cardTotal) + '</td></tr>' +
          '<tr><td>— Себестоимость сырья (COGS по ТТК)</td><td style="color:var(--bad)">-' + rub(fin.cogs) + '</td><td>' + fin.foodCostPct + '%</td><td class="mu">Зерно, молоко, сиропы, стаканы по ТТК</td></tr>' +
          '<tr><td><b>= Валовая прибыль (Gross Profit)</b></td><td><b>' + rub(fin.grossProfit) + '</b></td><td><b>' + (fin.grossMarginPct || 0) + '%</b></td><td class="mu">Выручка минус себестоимость напитков</td></tr>' +
          '<tr><td>— ФОТ бариста (' + fin.shiftsCount + ' смен)</td><td style="color:var(--bad)">-' + rub(fin.effectivePayroll) + '</td><td>' + (fin.laborCostPct || 0) + '%</td><td class="mu">Ставка ' + rub(fin.shiftBasePay || 250) + '/смена + ' + (fin.shiftBonusPct || 5) + '% от кассы</td></tr>' +
          '<tr><td>— Операционные расходы (OpEx)</td><td style="color:var(--bad)">-' + rub(fin.nonPayrollOpex) + '</td><td>' + (fin.opexPct || 0) + '%</td><td class="mu">Аренда, закупки, коммунальные, ремонт</td></tr>' +
          '<tr><td>— Списания и технологические потери</td><td style="color:var(--bad)">-' + rub(fin.wasteCost) + '</td><td>' + (fin.revenue > 0 ? Math.round((fin.wasteCost / fin.revenue) * 1000) / 10 : 0) + '%</td><td class="mu">Списаний: ' + fin.writeoffsTotal + ' ед.</td></tr>' +
          '<tr style="border-top:2px solid var(--line)"><td><b>= ЧИСТАЯ ОПЕРАЦИОННАЯ ПРИБЫЛЬ</b></td><td><b style="font-size:16px;color:' + (fin.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + rub(fin.netProfit) + '</b></td><td><b>' + (fin.netMarginPct || 0) + '%</b></td><td class="mu">Чистый финансовый результат</td></tr>' +
        '</tbody></table></div>' +
      '</div>' +

      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">💸 Детализация расходов по статьям (' + ((rep.finance && rep.finance.list && rep.finance.list.length) || 0) + ')</h2><button type="button" class="p" data-jumpadm="exp">+ Внести расход</button></div>' +
        (fin.opexByCategory && fin.opexByCategory.length
          ? '<div class="sx"><table class="tbl"><thead><tr><th>Категория</th><th>Сумма</th><th>Доля от OpEx</th></tr></thead><tbody>' +
            fin.opexByCategory.map((c) => '<tr><td><b>' + esc(c.category) + '</b></td><td>' + rub(c.amount) + '</td><td>' + (fin.loggedOpex > 0 ? Math.round((c.amount / fin.loggedOpex) * 100) : 0) + '%</td></tr>').join('') +
            '</tbody></table></div>'
          : '') +
        ((rep.finance && rep.finance.list && rep.finance.list.length)
          ? '<div style="margin-top:8px">' + rep.finance.list.map((x) => '<div class="row"><div><b>' + esc(x.category) + '</b> · <span style="color:var(--bad)">' + rub(x.amount) + '</span><div class="mu">' + dmy(x.date) + (x.comment ? ' · ' + esc(x.comment) : '') + ' · ID: ' + esc(x.id) + '</div></div></div>').join('') + '</div>'
          : '<p class="mu">В выбранном периоде дополнительные расходы не вносились (0 руб.).</p>') +
      '</div>' +
    '</div>' +

    /* БЛОК 2: ПОСУТОЧНАЯ ФИНАНСОВАЯ ВЕДОМОСТЬ, СЧЁТЧИКИ КОФЕМАШИНЫ И Z-ОТЧЁТЫ */
    '<div class="card" style="margin-top:14px">' +
      '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">2. Посуточная ведомость: Касса, Z-отчёты, Счётчики кофемашины и Прибыль по дням</h2><button type="button" class="b" data-jumpadm="cash">+ Внести / сверить смену</button></div>' +
      '<div class="sx"><table class="tbl"><thead><tr><th>Дата</th><th>Бариста (смены)</th><th>Счётчик кофемашины (Дельта)</th><th>Нал</th><th>Безнал</th><th>Выручка (% плана)</th><th>Z-отчёт (Разница)</th><th>Чеков (Ср. чек)</th><th>COGS</th><th>ФОТ</th><th>OpEx+Спис.</th><th>Чистая прибыль</th></tr></thead><tbody>' +
        ((fin.dayByDayPnL && fin.dayByDayPnL.length) ? fin.dayByDayPnL.map((r) => (
          '<tr>' +
            '<td><a href="#dash" data-jumpdash="' + esc(r.date) + '"><b>' + dmy(r.date) + '</b></a> <span class="mu">(' + esc(r.dayCode) + ')</span></td>' +
            '<td>' + esc(r.barista) + ' <span class="mu">(' + r.shiftsCount + ' см.)</span></td>' +
            '<td>' + (r.counterEnd != null ? ((r.counterStart != null ? r.counterStart + '→' : '') + '<b>' + r.counterEnd + '</b> (пролито ' + r.counterDelta + ', дельта ' + (r.counterGap > 0 ? '+' : '') + r.counterGap + ')') : '<span class="mu">не внесён</span>') + '</td>' +
            '<td>' + rub(r.cash) + '</td>' +
            '<td>' + rub(r.card) + '</td>' +
            '<td><b>' + rub(r.revenue) + '</b> <span class="tag ' + (r.planPct >= 98 ? 'ok' : (r.planPct < 85 ? 'no' : '')) + '">' + r.planPct + '%</span></td>' +
            '<td>' + rub(r.zTotal) + ' ' + (r.zDiff === 0 ? '<span class="tag ok">0 расх.</span>' : '<span class="tag no">' + (r.zDiff > 0 ? '+' : '') + rub(r.zDiff) + '</span>') + '</td>' +
            '<td>' + r.checks + ' (' + rub(r.avgCheck) + ')</td>' +
            '<td>-' + rub(r.cogs) + '</td>' +
            '<td>-' + rub(r.payroll) + '</td>' +
            '<td>-' + rub(r.opex + r.wasteCost) + '</td>' +
            '<td><b style="color:' + (r.netProfit >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + rub(r.netProfit) + '</b></td>' +
          '</tr>'
        )).join('') : '<tr><td colspan="12" class="mu">За выбранный период закрытых кассовых смен нет.</td></tr>') +
      '</tbody></table></div>' +
      (cashHist.length ? '<div style="margin-top:12px"><h3>История сверки Z-отчётов и корректировок кассы (' + cashHist.length + ')</h3>' + cashHist.map((h) => '<div class="row"><div><b>' + dmy(h.date) + '</b> · ' + esc(h.action) + ' (' + esc(h.actor) + ')<div class="mu">Было: ' + rub(h.origTotal) + ' → Стало: ' + rub(h.newTotal) + ' · Z-отчёт: ' + rub(h.zTotal) + ' · Причина: ' + esc(h.note) + '</div></div></div>').join('') + '</div>' : '') +
    '</div>' +

    /* БЛОК 3: ПРОДАЖИ ПО ПОЗИЦИЯМ МЕНЮ И ПОЛНАЯ ЮНИТ-ЭКОНОМИКА ПО ТТК */
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:14px">' +
      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">3. Продажи по позициям меню (из Продажи.csv)</h2><span class="tag">' + soldProducts.length + ' поз.</span></div>' +
        '<div class="sx"><table class="tbl"><thead><tr><th>Позиция меню</th><th>Продано, шт.</th><th>Выручка</th><th>Доля продаж</th></tr></thead><tbody>' +
          (soldProducts.length ? soldProducts.map((p) => {
            const totQty = soldProducts.reduce((s, x) => s + (Number(x.qty) || 0), 0) || 1;
            return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + p.qty + ' шт.</td><td>' + (p.sum ? rub(p.sum) : '—') + '</td><td>' + Math.round((p.qty / totQty) * 100) + '%</td></tr>';
          }).join('') : '<tr><td colspan="4" class="mu">Поштучная детализация заполняется автоматически при загрузке файла «Продажи.csv» в Кассе.</td></tr>') +
        '</tbody></table></div>' +
      '</div>' +

      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">☕ Юнит-экономика и рецептуры ТТК (' + (fin.ttkEconomics || []).length + ')</h2><button type="button" class="b" data-jumpadm="ttk">Управление ТТК</button></div>' +
        '<div class="sx"><table class="tbl"><thead><tr><th>Напиток / Позиция</th><th>Цена</th><th>Зерно+Мол.+Сир.+Стакан</th><th>Себест.</th><th>Маржа</th><th>Food Cost</th></tr></thead><tbody>' +
          ((fin.ttkEconomics || []).map((t) => (
            '<tr><td><b>' + esc(t.name) + '</b> <span class="mu">(' + esc(t.volume) + ')</span><div class="mu" style="font-size:11.5px">' + esc(t.recipe) + '</div></td><td>' + rub(t.price) + '</td><td class="mu">' + (t.costBeans || 0) + '+' + (t.costMilk || 0) + '+' + (t.costSyrup || 0) + '+' + (t.costCup || 0) + '</td><td>' + rub(t.unitCost) + '</td><td><b style="color:var(--good)">+' + rub(t.marginRub) + '</b> (' + t.marginPct + '%)</td><td><span class="tag ' + (t.foodCostPct <= 35 ? 'ok' : '') + '">' + t.foodCostPct + '%</span></td></tr>'
          )).join('')) +
        '</tbody></table></div>' +
      '</div>' +
    '</div>' +

    /* БЛОК 4: ПЕРСОНАЛ: СМЕНЫ, ВЫРУЧКА, ДИСЦИПЛИНА, АУДИТЫ СЕРВИСА, ФОТ И ОЗНАКОМЛЕНИЕ С РЕГЛАМЕНТАМИ */
    '<div class="card" style="margin-top:14px">' +
      '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">4. Сотрудники: Смены, Выручка, Дисциплина, Аудит сервиса и Расчёт ФОТ / Премий KPI</h2><button type="button" class="b" data-jumpadm="staff">Штат и График</button></div>' +
      '<div class="sx"><table class="tbl"><thead><tr><th>Сотрудник (Роль)</th><th>Смен</th><th>Выручка (Нал/Безнал)</th><th>Чеков / Списаний</th><th>Задач Вовремя / Опозд. / Пропуск</th><th>Дисциплина</th><th>Аудит сервиса</th><th>Расчёт ФОТ (Ставка + Бонус × KPI)</th></tr></thead><tbody>' +
        (fullStaffRows.length ? fullStaffRows.map((s) => (
          '<tr>' +
            '<td><b>' + esc(s.name) + '</b> <span class="mu">(' + esc(s.role) + ')</span></td>' +
            '<td>' + s.shifts + '</td>' +
            '<td><b>' + rub(s.revenue) + '</b> <span class="mu">(' + rub(s.cash) + ' / ' + rub(s.card) + ')</span></td>' +
            '<td>' + s.checks + ' чек. / ' + s.writeoff + ' спис.</td>' +
            '<td>' + s.onTimeTasks + ' / ' + s.lateTasks + ' / ' + s.missedTasks + '</td>' +
            '<td><span class="tag ' + (s.disciplinePct >= 90 ? 'ok' : 'no') + '">' + s.disciplinePct + '%</span></td>' +
            '<td><span class="tag ' + (s.auditScore >= 90 ? 'ok' : '') + '">⭐ ' + s.auditScore + '%</span> <span class="mu">(' + s.auditCount + ' пров.)</span></td>' +
            '<td><b style="color:var(--good)">' + rub(s.totalPayout) + '</b> <span class="mu">(база ' + rub(s.baseRate) + ' + бонус ' + rub(s.bonus) + ', коэф. ' + s.kpiCoeff + ')</span></td>' +
          '</tr>'
        )).join('') : '<tr><td colspan="8" class="mu">Нет данных по сменам за период.</td></tr>') +
      '</tbody></table></div>' +

      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px">' +
        '<div><h3>⭐ Проведённые аудиты качества сервиса (' + auditsList.length + ')</h3>' +
          (auditsList.length ? auditsList.map((a) => '<div class="row"><div><b>👤 ' + esc(a.barista) + '</b> · Итог: <b>' + a.score + '%</b> (' + dmy(a.date) + ' · ' + esc(a.auditor) + ')<div class="mu">Приветствие: ' + a.greet + '% · Уточнение: ' + a.clarify + '% · Upsell: ' + a.upsell + '% · Прощание: ' + a.farewell + '%' + (a.comment ? ' · 💬 ' + esc(a.comment) : '') + '</div></div></div>').join('') : '<p class="mu">За выбранный период чек-листы аудита сервиса не заполнялись.</p>') +
        '</div>' +
        '<div><h3>📢 Ознакомление персонала с регламентами и объявлениями (' + annsList.length + ')</h3>' +
          (annsList.length ? annsList.map((a) => {
            const acks = Array.isArray(a.acks) ? a.acks : [];
            return '<div class="row"><div><b>' + esc(a.title) + '</b> <span class="tag">' + esc(a.category || 'Инфо') + '</span><div class="mu">Ознакомились (' + acks.length + '): ' + (acks.length ? acks.map((k) => '<b>' + esc(k.name) + '</b> (' + esc(k.at) + ')').join(', ') : 'пока никто не нажал «Ознакомлен»') + '</div></div></div>';
          }).join('') : '<p class="mu">Опубликованных объявлений пока нет.</p>') +
        '</div>' +
      '</div>' +
    '</div>' +

    /* БЛОК 5: СТАТУС 6 ЧЕК-ЛИСТОВ ТАЙМЛАЙНА, ПОЛНЫЙ ЖУРНАЛ СДАЧ И ФОТО/ВИДЕО-АРХИВ */
    '<div class="card" style="margin-top:14px">' +
      '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">5. Таймлайн 6 чек-листов, Полный журнал сдач (' + periodChecklists.length + ') и Фото/Видео-архив (' + allPhotosInPeriod.length + ' кадр.)</h2><button type="button" class="b" data-jumpadm="checklists">Настроить окна</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;margin-bottom:12px">' +
        (window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks(db) : []).map((bObj) => {
          const w = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow(bObj.name, db) : { openTime: bObj.openTime, deadline: bObj.deadline, status: 'Окно', state: 'open' };
          const cls = w.state === 'completed' || w.state === 'open' ? 'ok' : (w.state === 'overdue_closed' ? 'no' : '');
          return '<div style="padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg);font-size:12.5px">' +
            '<b>' + esc(bObj.name) + '</b> <span class="mu">(' + esc(w.openTime + '–' + w.deadline) + ')</span>' +
            '<div class="mu" style="margin:4px 0"><span class="tag ' + cls + '" style="margin:0">' + esc(w.status) + '</span></div>' +
            '<button type="button" class="b ok" data-dashunlock="' + esc(bObj.name) + '" style="width:100%;font-size:11.5px;padding:4px 6px;min-height:30px">🔓 Открыть доступ</button>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="sx"><table class="tbl"><thead><tr><th>Дата и время</th><th>Чек-лист (Блок)</th><th>Бариста</th><th>Начало → Сдача (Дедлайн)</th><th>Статус</th><th>Пунктов</th><th>Проблем</th><th>Фото / Видео</th></tr></thead><tbody>' +
        (periodChecklists.length ? periodChecklists.map((c) => (
          '<tr>' +
            '<td><b>' + dmy(c.date) + '</b> ' + esc(c.time || '') + '</td>' +
            '<td><b>' + esc(c.block) + '</b></td>' +
            '<td>' + esc(c.who || 'Бариста') + '</td>' +
            '<td class="mu">' + esc(c.startedAt || c.time || '—') + ' → ' + esc(c.time || '—') + ' (до ' + esc(c.deadline || '—') + ')</td>' +
            '<td><span class="tag ' + (c.isLate ? 'no' : 'ok') + '">' + (c.isLate ? 'Просрочено' : 'Вовремя') + '</span></td>' +
            '<td>' + (c.totalSteps || 0) + '</td>' +
            '<td>' + (c.problems > 0 ? '<span class="tag no">' + c.problems + '</span>' : '0') + '</td>' +
            '<td>' + ((c.photos && c.photos.length) ? (c.photos.length + ' кадр.') : '—') + '</td>' +
          '</tr>'
        )).join('') : '<tr><td colspan="8" class="mu">За выбранный период сданных чек-листов пока нет.</td></tr>') +
      '</tbody></table></div>' +
      (allPhotosInPeriod.length ? (
        '<div style="margin-top:12px"><h3>📸 Фото- и видеоархив прохождения чек-листов (' + allPhotosInPeriod.length + ')</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:8px">' +
          allPhotosInPeriod.slice(0, 24).map((p) => (
            '<div style="border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--bg)">' +
              (window.coffeeMediaHtml ? window.coffeeMediaHtml(p.url, p.step) : '<img src="' + esc(p.url) + '" style="width:100%;border-radius:8px;max-height:140px;object-fit:cover">') +
              '<div style="font-size:12px;font-weight:700;margin-top:6px">' + esc(p.block) + ' · ' + esc(p.step) + '</div>' +
              '<div class="mu" style="font-size:11.5px">' + dmy(p.date) + ' ' + esc(p.time) + ' · ' + esc(p.who) + (p.comment ? ' · 💬 ' + esc(p.comment) : '') + '</div>' +
            '</div>'
          )).join('') +
        '</div></div>'
      ) : '') +
    '</div>' +

    /* БЛОК 6: ПОЛНЫЙ РЕЕСТР ПОЛОМОК / ИНЦИДЕНТОВ (ЭКШН-ПЛАН 24Ч) И КАРТА ДОБРЫХ ДЕЛ */
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:14px">' +
      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">6. Полный реестр поломок и инцидентов (' + periodIncidents.length + ')</h2><button type="button" class="b" data-jumpadm="inc">Управление поломками</button></div>' +
        (periodIncidents.length ? periodIncidents.map((inc) => (
          '<div class="row">' +
            '<div><b>' + esc(inc.id || '') + ' · ' + esc(inc.step) + '</b> <span class="tag ' + (window.coffeeIsIncActive(inc.status) ? 'no' : 'ok') + '">' + esc(inc.status) + '</span> <span class="tag">' + esc(inc.priority || 'Терпит') + '</span>' +
            '<div class="mu">' + esc(inc.incType || '') + ': ' + esc(inc.text) + '</div>' +
            '<div class="mu">' + dmy(inc.date) + ' ' + esc(inc.time || '') + ' · Сообщил: <b>' + esc(inc.who || 'Бариста') + '</b> · Исполнитель: <b>' + esc(inc.owner || 'Техник') + '</b> · Проверяющий: <b>' + esc(inc.reviewer || 'Управляющий') + '</b></div>' +
            (Array.isArray(inc.history) && inc.history.length ? '<div class="mu" style="font-size:11.5px;margin-top:3px">История: ' + inc.history.map((h) => esc(h.time) + ' ' + esc(h.status) + ' (' + esc(h.actor) + ')').join(' → ') + '</div>' : '') +
            '</div>' +
          '</div>'
        )).join('') : '<p class="mu">За выбранный период инцидентов и поломок не зафиксировано.</p>') +
      '</div>' +

      '<div class="card" style="margin:0">' +
        '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">🗓 Карта добрых дел и График смен Пн–Вс</h2><button type="button" class="b" data-jumpadm="tasks">Настроить задачи</button></div>' +
        goodDeedsList.map((g) => (
          '<div class="row"><div><b>' + esc(g.title) + '</b> <span class="tag ok">' + esc(g.frequency) + '</span> <span class="tag">⏰ ' + esc(g.window || '') + '</span>' +
          '<div class="mu">' + esc(g.instruction) + '</div>' +
          '<div class="mu">Ответственный: <b>' + esc(g.responsible) + '</b> · Проверяющий: <b>' + esc(g.reviewer) + '</b></div></div></div>'
        )).join('') +
        '<h3 style="margin-top:12px">График смен бариста на неделю (Пн–Вс)</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-top:6px">' +
          ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((dCode) => (
            '<div style="padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--bg);font-size:12px"><b>' + dCode + ':</b> ' + esc((db.shiftRoster && db.shiftRoster[dCode]) || '—') + '</div>'
          )).join('') +
        '</div>' +
      '</div>' +
    '</div>' +

    /* БЛОК 7: СИМУЛЯТОР ПРИБЫЛИ «ЧТО ЕСЛИ» И ПОЛНЫЙ СИСТЕМНЫЙ ЖУРНАЛ АУДИТА (AUDIT LOG) */
    '<div class="card" style="margin-top:14px">' +
      '<div class="top" style="margin-bottom:8px"><h2 style="margin:0">7. Симулятор прибыли «Что если» и Полный журнал аудита действий (' + auditLogList.length + ')</h2>' +
        '<span class="tag ok">Потенциал роста: +' + rub(sim.extraMonthlyProfit) + ' / мес</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:14px">' +
        '<div style="padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)"><label class="mu">1. Рост среднего чека (Upsell): <b>+' + ownerSimAvg + ' руб.</b></label><input type="range" id="oSimAvg" min="0" max="25" step="1" value="' + ownerSimAvg + '"></div>' +
        '<div style="padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)"><label class="mu">2. Прирост чеков в день: <b>+' + ownerSimChk + '%</b></label><input type="range" id="oSimChk" min="0" max="40" step="2" value="' + ownerSimChk + '"></div>' +
        '<div style="padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg)"><label class="mu">3. Снижение списаний: <b>-' + ownerSimWo + '%</b></label><input type="range" id="oSimWo" min="0" max="80" step="5" value="' + ownerSimWo + '"></div>' +
      '</div>' +
      '<details style="border-top:1px solid var(--line);padding-top:10px">' +
        '<summary style="cursor:pointer;font-weight:700;font-size:14px;color:var(--brew)">📜 Показать полный системный журнал аудита всех действий (' + auditLogList.length + ' записей) ▾</summary>' +
        '<div class="sx" style="margin-top:8px"><table class="tbl"><thead><tr><th>Дата и время</th><th>Кто выполнил</th><th>Действие</th><th>Подробности</th></tr></thead><tbody>' +
          (auditLogList.length ? auditLogList.map((l) => (
            '<tr><td>' + dmy(l.date) + ' ' + esc(l.time) + '</td><td><b>' + esc(l.actor) + '</b></td><td>' + esc(l.action) + '</td><td class="mu">' + esc(l.details) + '</td></tr>'
          )).join('') : '<tr><td colspan="4" class="mu">Журнал аудита пуст</td></tr>') +
        '</tbody></table></div>' +
      '</details>' +
    '</div>';
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.closest('#ownerNotifBtn')) {
    const dr = $('ownerNotifDrawer');
    if (dr) {
      dr.hidden = !dr.hidden;
      renderOwnerNotificationsDrawer();
    }
    return;
  }
  if (e.target && e.target.id === 'ownerNotifReadAllBtn') {
    if (window.coffeeNotify) window.coffeeNotify.markAllRead();
    renderOwnerNotificationsDrawer();
    toast('✓ Все уведомления отмечены прочитанными');
    return;
  }
  if (e.target && e.target.id === 'ownerNotifCloseBtn') {
    if ($('ownerNotifDrawer')) $('ownerNotifDrawer').hidden = true;
    return;
  }
  const secBtn = e.target.closest('#ownerMainNav button[data-osec]');
  if (secBtn) {
    switchOwnerTopSection(secBtn.dataset.osec);
    return;
  }
  const odpBtn = e.target.closest('[data-odp]');
  if (odpBtn) {
    const m = odpBtn.dataset.odp;
    const t = _isoToday();
    ownerDashPeriodMode = m;
    if (m === 'today') { ownerDashFrom = t; ownerDashTo = t; ownerDashDate = t; }
    else if (m === 'yest') { const y = _shiftIso(t, -1); ownerDashFrom = y; ownerDashTo = y; ownerDashDate = y; }
    else if (m === '7') { ownerDashFrom = _shiftIso(t, -6); ownerDashTo = t; ownerDashDate = t; }
    else if (m === '30') { ownerDashFrom = _shiftIso(t, -29); ownerDashTo = t; ownerDashDate = t; }
    renderOwnerDashboardSection();
    return;
  }
  if (e.target && e.target.id === 'oDashApplyRangeBtn') {
    let a = $('oDashFrom') ? $('oDashFrom').value : ownerDashFrom;
    let b = $('oDashTo') ? $('oDashTo').value : ownerDashTo;
    if (a && b && a > b) { const tmp = a; a = b; b = tmp; }
    ownerDashFrom = a || _isoToday();
    ownerDashTo = b || ownerDashFrom;
    ownerDashDate = ownerDashTo;
    ownerDashPeriodMode = 'range';
    renderOwnerDashboardSection();
    return;
  }
  if (e.target && e.target.id === 'oDashGoFullReportBtn') {
    ownerRepFrom = ownerDashFrom;
    ownerRepTo = ownerDashTo;
    switchOwnerTopSection('report');
    return;
  }
  const jumpDash = e.target.closest('[data-jumpdash]');
  if (jumpDash) {
    e.preventDefault();
    switchOwnerTopSection('dashboard', jumpDash.dataset.jumpdash);
    return;
  }
  const jumpAdm = e.target.closest('[data-jumpadm]');
  if (jumpAdm) {
    tab = jumpAdm.dataset.jumpadm || 'checklists';
    switchOwnerTopSection('admin');
    return;
  }
  const dashUnlock = e.target.closest('[data-dashunlock]');
  if (dashUnlock) {
    const blk = dashUnlock.dataset.dashunlock;
    call('extend_deadline', { block: blk, openFrom: '00:00', until: '23:59', reason: 'Открыто с Дашборда владельца' }).then(() => {
      toast('🔓 Доступ к чек-листу «' + blk + '» открыт в Терминале до конца дня!');
      renderOwnerDashboardSection();
    });
    return;
  }
  const dashRes = e.target.closest('[data-dashresolve]');
  if (dashRes) {
    const incId = dashRes.dataset.dashresolve;
    call('update_incident', { id: incId, status: 'Решена', statusNote: 'Отмечено решённым с Дашборда' }).then(() => {
      toast('✓ Поломка отмечена решённой');
      renderOwnerDashboardSection();
    });
    return;
  }
  const orpBtn = e.target.closest('[data-orp]');
  if (orpBtn) {
    const p = orpBtn.dataset.orp;
    const t = _isoToday();
    ownerRepTo = p === 'yest' ? _shiftIso(t, -1) : t;
    if (p === 'today') ownerRepFrom = t;
    else if (p === 'yest') ownerRepFrom = _shiftIso(t, -1);
    else if (p === '7') ownerRepFrom = _shiftIso(t, -6);
    else if (p === '30') ownerRepFrom = _shiftIso(t, -29);
    else if (p === 'month') ownerRepFrom = t.slice(0, 8) + '01';
    renderOwnerReportSection();
    return;
  }
  if (e.target && e.target.id === 'oRepCsvBtn') {
    const fin = window.coffeeCalculateFinancialModel ? window.coffeeCalculateFinancialModel( getUDB(), ownerRepFrom, ownerRepTo ) : { dayByDayPnL: [] };
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Дата', 'День', 'Бариста', 'Смен', 'Счётчик (пролито)', 'Наличные', 'Безнал', 'Выручка', 'Z-отчёт', 'План', '% Плана', 'Чеков', 'Средний чек', 'COGS (ТТК)', 'ФОТ', 'OpEx', 'Списания', 'Чистая прибыль'].map(q).join(';')]
      .concat((fin.dayByDayPnL || []).map((x) => [x.date, x.dayCode, x.barista, x.shiftsCount, x.counterDelta, x.cash, x.card, x.revenue, x.zTotal, x.plan, x.planPct + '%', x.checks, x.avgCheck, x.cogs, x.payroll, x.opex, x.writeoff, x.netProfit].map(q).join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'полный_отчет_кофейня_' + ownerRepFrom + '_' + ownerRepTo + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('✓ Полный финансовый отчёт скачан в CSV');
    return;
  }
  if (e.target && e.target.id === 'oRepPrintBtn') {
    window.print();
    return;
  }
  if (e.target && e.target.id === 'oRepApplyBtn') {
    if ($('oRepFrom') && $('oRepFrom').value) ownerRepFrom = $('oRepFrom').value;
    if ($('oRepTo') && $('oRepTo').value) ownerRepTo = $('oRepTo').value;
    if (ownerRepFrom > ownerRepTo) { const tmp = ownerRepFrom; ownerRepFrom = ownerRepTo; ownerRepTo = tmp; }
    renderOwnerReportSection();
    return;
  }
});

document.addEventListener('input', (e) => {
  if (e.target && (e.target.id === 'oSimAvg' || e.target.id === 'oSimChk' || e.target.id === 'oSimWo')) {
    ownerSimAvg = Number($('oSimAvg') ? $('oSimAvg').value : ownerSimAvg);
    ownerSimChk = Number($('oSimChk') ? $('oSimChk').value : ownerSimChk);
    ownerSimWo = Number($('oSimWo') ? $('oSimWo').value : ownerSimWo);
    renderOwnerReportSection();
  }
});

setTimeout(() => {
  const notifBtn = document.getElementById('ownerNotifBtn');
  if (notifBtn && !document.getElementById('ownerPinLockBtn')) {
    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.id = 'ownerPinLockBtn';
    lockBtn.className = 'theme-btn';
    lockBtn.style.cssText = 'width:40px;height:40px;font-size:16px;display:inline-flex;align-items:center;justify-content:center';
    lockBtn.textContent = '🔒';
    lockBtn.title = 'Выйти / Заблокировать панель владельца';
    lockBtn.onclick = () => {
      if (window.coffeeAuth) window.coffeeAuth.logout();
      ensureOwnerPinGate(true);
    };
    notifBtn.parentNode.insertBefore(lockBtn, notifBtn);
  }
  renderOwnerNotificationsDrawer();
  switchOwnerTopSection(ownerTopSection);
  if (window.COFFEE_ACTIVE_SYSTEM_MODE !== 'terminal') {
    ensureOwnerPinGate(false);
  }
}, 30);
let _ownerRefreshTimer = null;
function _refreshOwnerActiveSectionSafe(isFromBusOrStorage) {
  if (document.querySelector('dialog[open]')) return;
  const ae = document.activeElement;
  if (isFromBusOrStorage && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  renderOwnerNotificationsDrawer();
  if (ownerTopSection === 'dashboard') renderOwnerDashboardSection();
  if (ownerTopSection === 'report') renderOwnerReportSection();
  if (ownerTopSection === 'admin') load();
}
function _scheduleOwnerRefresh() {
  if (typeof window !== 'undefined' && window.navigator && /jsdom|node/i.test(window.navigator.userAgent || '')) {
    _refreshOwnerActiveSectionSafe(false);
    return;
  }
  if (_ownerRefreshTimer) clearTimeout(_ownerRefreshTimer);
  _ownerRefreshTimer = setTimeout(() => _refreshOwnerActiveSectionSafe(true), 180);
}
if (window.coffeeBus) {
  window.coffeeBus.on((msg) => {
    if (msg && msg.type === 'live_notification' && msg.payload) {
      renderOwnerNotificationsDrawer();
      toast('🔔 ' + (msg.payload.title || 'Новое уведомление'));
      return;
    }
    if (msg && (msg.type === 'mutation' || msg.type === 'server_sync')) {
      _scheduleOwnerRefresh();
    }
  });
}


/* === ЕДИНАЯ СИСТЕМА: МГНОВЕННОЕ ПЕРЕКЛЮЧЕНИЕ ПАНЕЛЬ ВЛАДЕЛЬЦА <-> ТЕРМИНАЛ БАРИСТА (0 МС) === */
window.coffeeSwitchAppMode = function (targetMode, sectionOpt) {
  const mode = targetMode === 'terminal' ? 'terminal' : 'owner';
  window.COFFEE_ACTIVE_SYSTEM_MODE = mode;
  const termRoot = document.getElementById('unifiedTerminalRoot');
  const ownerRoot = document.getElementById('unifiedOwnerRoot');
  if (mode === 'terminal') {
    if (ownerRoot) ownerRoot.hidden = true;
    if (termRoot) termRoot.hidden = false;
    const ownerGate = document.getElementById('ownerPinGateModal');
    if (ownerGate) ownerGate.remove();
    if (typeof window.reloadTerminalFromVault === 'function') {
      window.reloadTerminalFromVault();
    }
    if (typeof window.ensureTerminalPinGate === 'function') {
      window.ensureTerminalPinGate();
    }
  } else {
    if (termRoot) termRoot.hidden = true;
    if (ownerRoot) ownerRoot.hidden = false;
    const staffDlg = document.getElementById('staffPinDlg');
    if (staffDlg) {
      try { if (staffDlg.open && typeof staffDlg.close === 'function') staffDlg.close(); staffDlg.removeAttribute('open'); } catch (_) {}
    }
    if (sectionOpt) ownerTopSection = sectionOpt;
    renderOwnerNotificationsDrawer();
    switchOwnerTopSection(ownerTopSection);
    ensureOwnerPinGate(false);
  }
  if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
};

window.addEventListener('storage', (e) => {
  if (e && e.key === 'coffee_owner_master_vault') {
    _scheduleOwnerRefresh();
  }
});
