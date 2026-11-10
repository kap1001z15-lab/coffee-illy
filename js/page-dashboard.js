/* Клиентский модуль страницы dashboard.html (v21 Enterprise) */
const API_URL = (window.COFFEE && window.COFFEE.API_URL) || '';
const PIN_KEY = 'coffee_illy_pin', OK_KEY = 'coffee_admin_ok', $ = (i) => document.getElementById(i);
const getPin = () => { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } };
const rub = (n) => Math.round(Number(n || 0)).toLocaleString('ru-RU') + ' руб.';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shift = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
let D = null;

async function load(silent, fresh) {
  const day = $('pick').value || iso(new Date());
  const ck = 'dash:' + day;
  const saved = window.coffeeCache ? coffeeCache.get(ck) : null;
  $('err').hidden = true;
  if (!silent) {
    if (saved && saved.days) { D = saved; render(saved); }
    else $('main').classList.add('ld');
  }
  try {
    const r = await coffeeFetch(API_URL + '?action=dashboard&date=' + day + '&pin=' + encodeURIComponent(getPin()) + (fresh ? '&nocache=1' : ''));
    if (r && r.ok === false && /PIN_REQUIRED/.test(r.error || '')) {
      const e = new Error('Введите код доступа администратора');
      e.pin = true;
      throw e;
    }
    if (!r || r.ok === false || !r.days) throw new Error((r && r.error) || 'сервер вернул неожиданный ответ');
    if (window.coffeeCache) coffeeCache.set(ck, r);
    D = r;
    render(r);
    if (r.location) $('sub').textContent = r.location;
  } catch (e) {
    $('err').hidden = false;
    if (!e.pin && saved && saved.days) {
      $('err').innerHTML = '<b>Нет связи с облаком.</b> Показаны сохранённые данные.';
      return;
    }
    $('err').innerHTML = e.pin
      ? '<b>' + esc(e.message) + '</b><div style="display:flex;gap:8px;margin-top:10px"><input id="pinIn" type="password" placeholder="Код доступа" style="height:38px;border:1px solid var(--ln);border-radius:10px;padding:0 10px;background:var(--bg)"><button id="pinOk" type="button" style="height:38px;border-radius:10px;border:1px solid var(--ln);background:var(--bg);padding:0 14px;cursor:pointer;font-weight:600">Войти</button></div>'
      : '<b>Не удалось загрузить данные.</b> ' + esc(e.message);
  } finally {
    $('main').classList.remove('ld');
  }
}

$('err').addEventListener('click', (e) => {
  if (e.target.id !== 'pinOk') return;
  try {
    const v = $('pinIn').value.trim();
    localStorage.setItem(PIN_KEY, v);
    localStorage.setItem(OK_KEY, '1');
  } catch (x) {}
  load(false, true);
});
$('err').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'pinIn') $('pinOk').click();
});

function render(d) {
  const plan = Math.max(1, Number(d.plan) || 2200);
  const rev = Number(d.revenue) || 0;
  const has = !!d.hasData || rev > 0;
  const pct = has ? Math.round(rev / plan * 100) : 0;
  const today = iso(new Date());
  const dStr = d.date || today;

  $('pick').value = dStr;
  $('pick').max = today;
  $('next').disabled = dStr >= today;
  $('date').textContent = new Date(dStr + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + (d.isToday ? ' · сегодня' : '');
  $('rev').textContent = has ? rub(rev) : '—';
  $('bar').style.width = Math.min(pct, 100) + '%';
  $('bar').className = pct >= 100 ? 'done' : '';
  const dpDay = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(dStr) : { dayCode: d.dayCode || '', revenue: plan, avgCheck: d.minAvgCheck || 35, checks: d.planChecks || 75 };
  $('planL').textContent = 'План (' + (dpDay.dayCode || 'день') + '): ' + rub(dpDay.revenue) + ' · Ср. чек ≥ ' + rub(dpDay.avgCheck) + ' · Чеков ≥ ' + dpDay.checks;
  $('planR').textContent = has ? (pct + '%') : 'данных нет';
  $('checks').textContent = has ? (d.checks ?? '—') : '—';
  if ($('chk2')) $('chk2').textContent = has ? ('Нал ' + rub(d.cash || 0) + ' · Безнал ' + rub(d.card || 0)) : '\u00a0';
  $('avg').textContent = has ? rub(d.avg || (d.checks ? rev / d.checks : 0)) : '—';
  $('wo').textContent = has ? rub(d.writeoff) : '—';
  const wn = Number(d.woNorm) || 500;
  $('woS').innerHTML = has ? '<span class="t ' + ((Number(d.writeoff) || 0) <= wn ? 'ok' : 'no') + '">' + ((Number(d.writeoff) || 0) <= wn ? 'в норме' : 'выше нормы') + '</span>' : '&nbsp;';
  const dl = d.deadline || '08:30';
  $('open').textContent = d.openedAt || '—';
  $('openS').innerHTML = d.openedAt ? '<span class="t ' + (d.openedAt <= dl ? 'ok' : 'no') + '">' + (d.openedAt <= dl ? 'вовремя' : 'с опозданием') + '</span>' : '<span class="mu">нет отметки</span>';
  if ($('shiftBreak')) {
    if (Array.isArray(d.shifts) && d.shifts.length > 1) {
      $('shiftBreak').innerHTML = '👥 Сумма 2 смен за день: ' + d.shifts.map((s) => '<b>' + esc(s.name) + '</b> (' + rub((Number(s.cash) || 0) + (Number(s.card) || 0)) + (s.cups ? ', ' + s.cups + ' чаш.' : '') + ')').join(' + ');
    } else if (d.barista) {
      $('shiftBreak').textContent = '👤 Смена: ' + d.barista;
    } else {
      $('shiftBreak').textContent = '';
    }
  }
  chart(d, plan, dStr);
  incs(d);
  photos(d);
}

function chart(d, plan, curDate) {
  const days = Array.isArray(d.days) && d.days.length ? d.days : [{ date: curDate, revenue: Number(d.revenue) || 0, outflow: Number(d.writeoff) || 0 }];
  const W = 640, H = 195, p = 16, base = H - 22;
  const max = Math.max(plan * 1.15, ...days.map((x) => Math.max(Number(x.revenue) || 0, Number(x.outflow || x.writeoff) || 0)), 1);
  const bw = (W - p * 2) / days.length;
  const y = (v) => base - (Number(v) || 0) / max * (base - 10);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Доход и списания по дням">';
  days.forEach((x, i) => {
    const xr = Number(x.revenue) || 0;
    const xwo = Number(x.outflow != null ? x.outflow : x.writeoff) || 0;
    const xd = String(x.date || '');
    const hRev = Math.max(base - y(xr), xr ? 3 : 0);
    const hWo = Math.max(base - y(xwo), xwo ? 4 : 0);
    const cx = p + i * bw;
    const isSel = xd === curDate;
    s += '<rect data-d="' + esc(xd) + '" style="cursor:pointer" x="' + (cx + bw * .1) + '" y="' + (base - hRev) + '" width="' + (bw * .44) + '" height="' + hRev + '" rx="3" fill="var(--good)" opacity="' + (isSel ? '1' : '0.78') + '" stroke="' + (isSel ? 'var(--ink)' : 'none') + '" stroke-width="1.5"><title>' + esc(xd.slice(8) + '.' + xd.slice(5, 7)) + ' · Доход: ' + rub(xr) + (x.barista ? ' (' + esc(x.barista) + ')' : '') + '</title></rect>';
    s += '<rect data-d="' + esc(xd) + '" style="cursor:pointer" x="' + (cx + bw * .56) + '" y="' + (base - hWo) + '" width="' + (bw * .32) + '" height="' + hWo + '" rx="3" fill="var(--bad)"><title>' + esc(xd.slice(8) + '.' + xd.slice(5, 7)) + ' · Списания/расходы: ' + rub(xwo) + '</title></rect>';
    if (i % 2 === 0 || days.length < 8) s += '<text x="' + (cx + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" style="font-weight:' + (isSel ? '700' : '400') + '">' + esc(xd.slice(8)) + '</text>';
  });
  s += '<line x1="' + p + '" x2="' + (W - p) + '" y1="' + y(plan) + '" y2="' + y(plan) + '" stroke="var(--cr)" stroke-dasharray="5 4"/></svg>';
  $('chart').innerHTML = s;
}

$('chart').addEventListener('click', (e) => {
  const r = e.target.closest('[data-d]');
  if (r && r.dataset.d) { $('pick').value = r.dataset.d; load(); }
});

let dashPeriodMode = 'day';
function renderGaugesAndFlags(d) {
  const dp = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(d.date) : { dayCode: d.dayCode || 'Пн', revenue: Number(d.plan) || 2500, avgCheck: Number(d.minAvgCheck) || 390, checks: Number(d.planChecks) || 140 };
  let factRev = Number(d.revenue) || 0;
  let planRev = dp.revenue;
  let factChk = Number(d.checks) || 0;
  let planChk = dp.checks;
  let factAvg = factChk > 0 ? Math.round(factRev / factChk) : (Number(d.avg) || 0);
  let planAvg = dp.avgCheck;
  let periodTitle = 'За ' + d.date.split('-').reverse().join('.') + ' (' + dp.dayCode + ')';

  if (dashPeriodMode === '7' && Array.isArray(d.days) && d.days.length) {
    const last7 = d.days.slice(-7);
    factRev = last7.reduce((s, x) => s + (Number(x.revenue) || 0), 0);
    planRev = last7.reduce((s, x) => s + (window.coffeeGetDayPlan ? window.coffeeGetDayPlan(x.date).revenue : dp.revenue), 0);
    const dbCash = (window.coffeeGetInstantAdmin && window.coffeeGetInstantAdmin().cash) || [];
    factChk = last7.reduce((s, x) => {
      const cr = dbCash.find((c) => c.date === x.date);
      return s + (cr ? (Number(cr.checks) || 0) : (x.revenue > 0 ? Math.round(x.revenue / 35) : 0));
    }, 0);
    planChk = last7.reduce((s, x) => s + (window.coffeeGetDayPlan ? window.coffeeGetDayPlan(x.date).checks : dp.checks), 0);
    factAvg = factChk > 0 ? Math.round(factRev / factChk) : 0;
    periodTitle = 'За 7 дней (сумма планов Пн–Вс)';
  }

  const gClass = (fact, plan) => {
    if (!fact) return 'g-red';
    const r = fact / Math.max(1, plan);
    return r >= 0.98 ? 'g-green' : (r >= 0.85 ? 'g-yellow' : 'g-red');
  };
  if ($('dashGaugesTrio')) {
    const cCls = gClass(factRev, planRev);
    const tCls = gClass(factChk, planChk);
    const aCls = gClass(factAvg, planAvg);
    $('dashGaugesTrio').innerHTML =
      '<div class="gauge-card ' + cCls + '">' +
        '<span class="mu" style="font-weight:700">1. КАССА (ВЫРУЧКА) · ' + esc(periodTitle) + '</span>' +
        '<div class="gauge-val">' + rub(factRev) + '</div>' +
        '<div style="font-size:13px;font-weight:700">План: ' + rub(planRev) + ' (' + Math.round((factRev / Math.max(1, planRev)) * 100) + '%)</div>' +
      '</div>' +
      '<div class="gauge-card ' + tCls + '">' +
        '<span class="mu" style="font-weight:700">2. ТРАНЗАКЦИИ (ГОСТИ / ЧЕКИ)</span>' +
        '<div class="gauge-val">' + factChk + '</div>' +
        '<div style="font-size:13px;font-weight:700">План транзакций: ' + planChk + ' (' + Math.round((factChk / Math.max(1, planChk)) * 100) + '%)</div>' +
      '</div>' +
      '<div class="gauge-card ' + aCls + '">' +
        '<span class="mu" style="font-weight:700">3. СРЕДНИЙ ЧЕК</span>' +
        '<div class="gauge-val">' + rub(factAvg) + '</div>' +
        '<div style="font-size:13px;font-weight:700">План ср. чека: ' + rub(planAvg) + ' (' + Math.round((factAvg / Math.max(1, planAvg)) * 100) + '%)</div>' +
      '</div>';
  }

  if ($('redFlagsList') && window.coffeeEvaluateRedFlags) {
    const flags = window.coffeeEvaluateRedFlags(d.date);
    const redCnt = flags.filter((f) => f.level === 'red').length;
    if ($('redFlagsCountBadge')) {
      $('redFlagsCountBadge').textContent = redCnt > 0 ? ('🚩 Красных флагов: ' + redCnt) : '🟢 Флагов нет (норма)';
      $('redFlagsCountBadge').className = 'tag ' + (redCnt > 0 ? 'no' : 'ok');
    }
    $('redFlagsList').innerHTML = flags.map((f) => (
      '<div class="flag-item flag-' + f.level + '">' +
        '<div><b>' + esc(f.title) + '</b><div class="mu" style="margin-top:3px">' + esc(f.desc) + '</div></div>' +
        '<span class="tag ' + (f.level === 'red' ? 'no' : (f.level === 'green' ? 'ok' : '')) + '" style="white-space:nowrap">' + esc(f.tag) + '</span>' +
      '</div>'
    )).join('');
  }
}
if ($('dashQuickPeriodBar')) {
  $('dashQuickPeriodBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dp]');
    if (!b) return;
    const mode = b.dataset.dp;
    if (mode === 'yest') {
      dashPeriodMode = 'day';
      $('pick').value = shift(iso(new Date()), -1);
      load();
    } else if (mode === 'today') {
      dashPeriodMode = 'day';
      $('pick').value = iso(new Date());
      load();
    } else if (mode === '7') {
      dashPeriodMode = '7';
      if (D) renderGaugesAndFlags(D);
    }
  });
}

function photos(d) {
  renderGaugesAndFlags(d);
  const has = !!d.hasData || (Number(d.revenue) || 0) > 0;
  const ord = { 'Открытие': 0, 'День': 1, 'Закрытие': 2 };
  const r = (d.photoReports || []).slice().sort((a, b) => (ord[a.block] ?? 9) - (ord[b.block] ?? 9) || String(a.time || '').localeCompare(String(b.time || '')));
  if($('shiftMatrixGrid')&&window.coffeeGetBlockWindow){
    const minAvg=d.minAvgCheck||390, planChk=d.planChecks||150;
    const dynNames=(window.coffeeGetChecklistBlocks?window.coffeeGetChecklistBlocks():[{name:'Открытие'},{name:'Лайн Чек 1'},{name:'Лайн Чек 2'},{name:'Закрытие'},{name:'Касса'}]).map((x)=>x.name);
    const blkCards=dynNames.map((b)=>{
      const w=window.coffeeGetBlockWindow(b);
      const cls=w.state==='completed'?'ok':(w.state==='overdue_closed'?'bad':(w.state==='open'?'ok':'warn'));
      const ic=w.state==='completed'?'✅':(w.state==='overdue_closed'?'🔒':(w.state==='open'?'🟢':'⏳'));
      return '<div class="pro-matrix-card '+cls+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:center"><b>'+ic+' Чек-лист «'+esc(b)+'»</b><span class="mu" style="font-size:12px">'+esc(w.openTime)+'–'+esc(w.deadline)+'</span></div>'+
        '<div style="font-size:13px;font-weight:600">'+esc(w.status)+'</div>'+
      '</div>';
    }).join('');
    const avgOk=has&&d.avg>=minAvg;
    const chkOk=has&&d.checks>=planChk;
    const normCard='<div class="pro-matrix-card '+(avgOk&&chkOk?'ok':'warn')+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center"><b>🎯 Нормативы точки (ТЗ п. 8)</b><span class="mu" style="font-size:12px">План / Факт</span></div>'+
      '<div style="font-size:12.5px">Ср. чек: <b>'+(has?rub(d.avg):'—')+'</b> (норма ≥ '+rub(minAvg)+') · Чеков: <b>'+(has?d.checks:'—')+'</b> (план '+planChk+')</div>'+
    '</div>';
    $('shiftMatrixGrid').innerHTML=blkCards+normCard;
  }
  if($('smartRadarGrid')&&window.coffeeSmartEngine){
    const sm=window.coffeeSmartEngine.analyze(null,d.date);
    if($('smartHealthBadge'))$('smartHealthBadge').textContent='⚡ Индекс точки: '+sm.healthScore+'%';
    $('smartRadarGrid').innerHTML=
      '<div class="smart-box '+(sm.forecastPlanPct>=100?'insight-ok':'insight-warn')+'">'+
        '<b>📈 Прогноз на 30 дней (Run-Rate)</b>'+
        '<div style="font-size:18px;font-weight:800;color:var(--good)">'+rub(sm.forecastMonthRev)+' <span class="mu" style="font-size:12px">('+sm.forecastPlanPct+'% плана)</span></div>'+
        '<div class="mu" style="font-size:12px">Средний темп: <b>'+rub(sm.avgDailyRev)+'/день</b> · Прогноз чистой прибыли: <b>'+rub(sm.forecastMonthProfit)+'</b></div>'+
      '</div>'+
      '<div class="smart-box insight-ok">'+
        '<b>🔍 Фрод-контроль счётчиков кофемашины</b>'+
        '<div style="font-size:14px;font-weight:700">'+(sm.counterDiscrepancyCups===0?'✅ Все смены сходятся со счётчиком':'⚠️ Расхождение: '+sm.counterDiscrepancyCups+' чаш.')+'</div>'+
        '<div class="mu" style="font-size:12px">Проверено смен по счётчику: <b>'+sm.counterCheckedShifts+'</b> · Точка безубыточности: <b>'+sm.breakEvenChecksDay+' чек./день</b> ('+rub(sm.breakEvenRevDay)+')</div>'+
      '</div>'+
      '<div class="smart-box insight-warn">'+
        '<b>💡 Резерв доп. продаж (Upsell) и техрегламент</b>'+
        '<div style="font-size:14px;font-weight:700;color:var(--accent)">+'+rub(sm.monthlyUpsellReserve)+' / мес за счёт Upsell</div>'+
        '<div class="mu" style="font-size:12px">Текущий Upsell по аудиту: <b>'+sm.avgUpsellScore+'%</b> · Узел внимания: <b>'+esc(sm.topIssueNode.name)+'</b> ('+sm.topIssueNode.count+' обращ.)</div>'+
      '</div>';
  }
  $('phC').hidden = !r.length;
  $('ph').innerHTML = r.map((x) => '<div class="inc"><div><b>' + esc(x.block) + '</b> <span class="mu">' + esc(x.time) + (x.who ? ' · ' + esc(x.who) : '') + '</span></div><div>' + (x.photos || []).filter((p) => p && p.url).map((p, i) => '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" title="' + esc(p.step) + '" style="display:inline-block;min-width:30px;text-align:center;margin-left:6px;padding:5px 8px;border:1px solid var(--ln);border-radius:9px;color:var(--br);text-decoration:none">' + (i + 1) + '</a>').join('') + '</div></div>').join('');
}

function incs(d) {
  const isAct = (i) => i && (window.coffeeIsIncActive ? window.coffeeIsIncActive(i.status) : (i.status === 'Open' || i.status === 'Открыта'));
  const open = (d.incidents || []).filter(isAct);
  $('incT').textContent = 'Активные инциденты и фото поломок' + (open.length ? ' · ' + open.length : '');
  $('inc').innerHTML = open.length
    ? open.slice(0, 6).map((i) => {
        const dt = String(i.date || '');
        const dmStr = dt.length >= 10 ? (dt.slice(8, 10) + '.' + dt.slice(5, 7)) : dt;
        const media = window.coffeeMediaHtml ? window.coffeeMediaHtml(i.photo, i.step) : '';
        const stNorm = window.coffeeNormIncStatus ? window.coffeeNormIncStatus(i.status) : i.status;
        return '<div class="inc" style="align-items:flex-start"><div><b>' + esc(i.step || 'Проблема') + '</b> <span class="t ' + (stNorm === 'Новая проблема' ? 'no' : 'ok') + '">' + esc(stNorm) + '</span>' + (i.priority === 'Критично' ? ' <span class="t no">критично</span>' : '') + ' <span class="t">⏱ Срок: 24ч · 📷 Только камера</span><div class="mu">' + (i.incType ? '<b>' + esc(i.incType) + ':</b> ' : '') + esc(i.text) + '</div><div class="mu" style="margin-top:3px">👤 Исполнитель: <b>' + esc(i.owner || 'Техник') + '</b> · 👁 Проверяющий (Владелец задачи): <b>' + esc(i.reviewer || 'Управляющий смены') + '</b>' + (dmStr ? ' · ' + esc(dmStr) : '') + '</div>' + media + '</div><button type="button" data-r="' + esc(i.id) + '">✓ Принять работу</button></div>';
      }).join('') + (open.length > 6 ? '<p class="mu">и ещё ' + (open.length - 6) + ' — в управлении</p>' : '')
    : '<p class="mu" style="margin:0">Всё в порядке — активных проблем нет</p>';
}

$('inc').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  b.disabled = true;
  try {
    const r = await coffeeFetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'resolve_incident', id: b.dataset.r, pin: getPin() }) }, 30000);
    if (r && r.ok === false) throw new Error(r.error);
    load(true, true);
  } catch (x) {
    b.disabled = false;
  }
});

$('prev').onclick = () => { $('pick').value = shift($('pick').value, -1); load(); };
$('next').onclick = () => { $('pick').value = shift($('pick').value, 1); load(); };
$('pick').onchange = () => load();
$('reload').onclick = () => load(false, true);

const cur = () => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
const paint = () => { $('theme').textContent = cur() === 'dark' ? '☀️' : '🌙'; };
$('theme').onclick = () => {
  const n = cur() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem('coffee_illy_theme', n); } catch (e) {}
  paint();
};
if ($('pitchGuideBtn')) $('pitchGuideBtn').onclick = () => { if ($('pitchDrawer')) $('pitchDrawer').hidden = !$('pitchDrawer').hidden; };
if ($('sendDigestBtn')) $('sendDigestBtn').onclick = async () => {
  const sm = window.coffeeSmartEngine ? window.coffeeSmartEngine.analyze(null, D && D.date) : null;
  const txt = window.coffeeBuildDailyDigestText ? window.coffeeBuildDailyDigestText(D || {}, sm) : 'Сводка дня';
  try { await navigator.clipboard.writeText(txt); } catch (_) {}
  $('sendDigestBtn').textContent = '✓ Сводка скопирована в буфер!';
  setTimeout(() => { $('sendDigestBtn').textContent = '📲 Скопировать / отправить сводку дня'; }, 2500);
};
paint();
$('pick').value = new URLSearchParams(location.search).get('date') || iso(new Date());
load(false, true);

/* Мгновенная синхронизация между Терминалом и Дашбордом (вкладки, фокус и облако каждые 12 сек) */
window.addEventListener('storage', (e) => {
  if (!e.key || /coffee_/.test(e.key)) {
    if (window.coffeeCache) window.coffeeCache.invalidate('all');
    load(true, false);
  }
});
window.addEventListener('focus', () => {
  if (window.coffeeCache) window.coffeeCache.invalidate('all');
  load(true, true);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (window.coffeeCache) window.coffeeCache.invalidate('all');
    load(true, true);
  }
});
if (window.coffeeBus) {
  window.coffeeBus.on((msg) => {
    if (msg && (msg.type === 'mutation' || msg.type === 'server_sync')) {
      if (window.coffeeCache) window.coffeeCache.invalidate('all');
      load(true, false);
    }
  });
}
setInterval(() => { if (!document.hidden) load(true, true); }, 12000);
window.addEventListener('storage', (e) => {
  if (!e.key || /coffee_/.test(e.key)) {
    if (typeof load === 'function') load(true, true);
  }
});
window.addEventListener('focus', () => {
  if (typeof load === 'function') load(true, true);
});

