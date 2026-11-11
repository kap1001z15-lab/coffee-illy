/* Клиентский модуль страницы report.html (v21 Enterprise) */
const API_URL = window.COFFEE.API_URL;
const PIN_KEY = 'coffee_illy_pin';
const $ = (id) => document.getElementById(id);
const rub = (n) => Math.round(Number(n || 0)).toLocaleString('ru-RU') + ' руб.';
const dm = (s) => s.slice(8) + '.' + s.slice(5, 7);
const dmy = (s) => dm(s) + '.' + s.slice(0, 4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shift = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const getPin = () => { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } };
const signed = (n) => (n > 0 ? '+' : '') + n;
let R = null;

function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2800); }
async function apiGet(q) {
  const d = await coffeeFetch(API_URL + '?' + q + '&sessionToken=' + encodeURIComponent(window.coffeeAuth && window.coffeeAuth.getSessionToken ? window.coffeeAuth.getSessionToken() : ''));
  if (d && d.ok === false && /PIN_REQUIRED/.test(d.error || '')) { const e = new Error('Введите код доступа администратора'); e.pin = true; throw e; }
  return d;
}
async function apiPost(p) {
  const d = await coffeeFetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({}, p)) }, 30000);
  if (!d || d.ok === false) throw new Error((d && d.error) || 'ошибка сервера');
  return d;
}

/* ---------- период ---------- */
function preset(p) {
  const t = iso(new Date()), d = new Date();
  let a = t, b = t;
  if (p === 'yest') a = b = shift(t, -1);
  else if (p === '7') a = shift(t, -6);
  else if (p === '30') a = shift(t, -29);
  else if (p === 'month') a = iso(new Date(d.getFullYear(), d.getMonth(), 1));
  else if (p === 'pmonth') { a = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)); b = iso(new Date(d.getFullYear(), d.getMonth(), 0)); }
  $('from').value = a; $('to').value = b;
  document.querySelectorAll('#presets button').forEach((x) => x.classList.toggle('on', x.dataset.p === p));
  load();
}
document.querySelectorAll('#presets button').forEach((b) => b.onclick = () => preset(b.dataset.p));
$('apply').onclick = () => {
  let a = $('from').value, b = $('to').value, t = iso(new Date());
  if (!a || !b) { toast('Укажите обе даты'); return; }
  if (a > b) { const x = a; a = b; b = x; $('from').value = a; $('to').value = b; }
  if (b > t) { b = t; $('to').value = t; }
  if (new Date(b) - new Date(a) > 399 * 864e5) { toast('Период не больше 13 месяцев'); return; }
  document.querySelectorAll('#presets button').forEach((x) => x.classList.remove('on'));
  load(true);
};

async function load(fresh) {
  const from = $('from').value, to = $('to').value, ck = 'rep:' + from + ':' + to, saved = coffeeCache.get(ck);
  $('err').hidden = true;
  if (saved && saved.finance) { R = saved; render(saved); } else $('main').classList.add('loading');
  try {
    const d = await apiGet('action=report&from=' + from + '&to=' + to + (fresh ? '&nocache=1' : ''));
    if (!d || d.ok === false || !d.finance) throw new Error((d && d.error) || 'сервер вернул неожиданный ответ. Обновите код в Apps Script и разверните новую версию');
    coffeeCache.set(ck, d); R = d; render(d);
  } catch (e) {
    $('err').hidden = false;
    if (!e.pin && saved && saved.finance) { $('err').innerHTML = '<b>Нет связи.</b> Показаны сохранённые данные.'; return; }
    $('err').innerHTML = e.pin
      ? '<b>' + esc(e.message) + '</b><div style="display:flex;gap:8px;margin-top:10px"><input id="pinIn" type="password" autocomplete="current-password" placeholder="Код" style="height:40px;border-radius:12px;border:1px solid var(--line);background:var(--surface);padding:0 12px"><button class="btn-s" id="pinOk" type="button">Войти</button></div>'
      : '<b>Не удалось загрузить отчёт.</b> ' + esc(e.message);
  } finally { $('main').classList.remove('loading'); }
}
$('err').addEventListener('click', (e) => { if (e.target.id !== 'pinOk') return; try { localStorage.setItem(PIN_KEY, $('pinIn').value.trim()); localStorage.setItem('coffee_admin_ok', '1'); } catch (x) {} load(); });
$('err').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pinIn') $('pinOk').click(); });

/* ---------- отрисовка ---------- */
function delta(cur, prev) { return prev ? Math.round((cur - prev) / Math.abs(prev) * 100) : null; }
function render(d) {
  if (d.location && $('sub')) $('sub').textContent = 'Отчёты владельца · ' + d.location;
  if (d.categories && d.categories.length) { const c = $('xCat').value; $('xCat').innerHTML = d.categories.map((x) => '<option' + (x === c ? ' selected' : '') + '>' + esc(x) + '</option>').join(''); }
  const f = d.finance, t = d.totals;
  $('periodLbl').textContent = d.from === d.to ? dmy(d.from) : dmy(d.from) + ' — ' + dmy(d.to) + ' · ' + d.days + ' дн., с выручкой: ' + t.days;
  $('kRev').textContent = rub(f.revenue);
  const dv = d.delta; $('kRevS').innerHTML = dv == null ? 'нет данных за прошлый период' : '<span class="dchip ' + (dv >= 0 ? 'up' : 'down') + '">' + signed(dv) + '%</span> к прошлому периоду';
  $('kExp').textContent = rub(f.expenses); $('kExpS').textContent = f.revenue ? Math.round(f.expenses / f.revenue * 100) + '% от выручки' : '\u00a0';
  $('kPro').textContent = rub(f.profit); $('kPro').className = 'num ' + (f.profit >= 0 ? 'pos' : 'neg');
  const pd = delta(f.profit, f.prevProfit);
  $('kProS').innerHTML = 'маржа ' + f.margin + '%' + (pd == null ? '' : ' · <span class="dchip ' + (pd >= 0 ? 'up' : 'down') + '">' + signed(pd) + '%</span>');
  $('kChk').textContent = t.checks + ' · ' + rub(t.avg);
  $('kChkS').textContent = t.days ? 'в среднем ' + rub(t.revenue / t.days) + ' в день' : '\u00a0';
  $('kPlan').textContent = d.pct + '%'; $('kPlanS').textContent = 'план ' + rub(d.plan) + ' (' + t.days + ' дн.)';
  $('kWo').textContent = rub(f.writeoff);
  drawPnl(d); drawChart(d); drawCats(f); drawTop(d); drawExps(f); drawDisc(d); drawTable(d); drawTasks(d);
}

function bucket(series) {
  if (series.length <= 31) return { rows: series.map((x) => ({ label: dm(x.date), rev: x.revenue, exp: (Number(x.expenses) || 0) + (Number(x.writeoff) || 0), wo: Number(x.writeoff) || 0 })), grouped: false };
  const out = [];
  for (let i = 0; i < series.length; i += 7) {
    const g = series.slice(i, i + 7);
    out.push({ label: dm(g[0].date), rev: g.reduce((a, x) => a + x.revenue, 0), exp: g.reduce((a, x) => a + (Number(x.expenses) || 0) + (Number(x.writeoff) || 0), 0), wo: g.reduce((a, x) => a + (Number(x.writeoff) || 0), 0) });
  }
  return { rows: out, grouped: true };
}
function drawChart(d) {
  const b = bucket(d.series); $('grpNote').textContent = b.grouped ? 'столбец = неделя' : '';
  if (!b.rows.some((x) => x.rev || x.exp)) { $('chart').innerHTML = '<div class="empty"><b>За этот период данных нет</b>Выберите другие даты или загрузите кассовый отчёт в терминале.</div>'; return; }
  const W = 720, H = 260, pad = 28, base = H - 28, max = Math.max(...b.rows.map((x) => Math.max(x.rev, x.exp)), 1) * 1.1, n = b.rows.length, bw = (W - pad * 2) / n;
  const y = (v) => base - v / max * (base - 18), step = Math.ceil(n / 12);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Доход, расходы и списания"><line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + base + '" y2="' + base + '" stroke="var(--line)"/>';
  b.rows.forEach((x, i) => {
    const cx = pad + i * bw, w = bw * .36;
    s += '<rect x="' + (cx + bw * .1) + '" y="' + y(x.rev) + '" width="' + w + '" height="' + Math.max(base - y(x.rev), x.rev ? 3 : 0) + '" rx="3" fill="var(--good)"><title>' + x.label + ': доход ' + rub(x.rev) + '</title></rect>';
    s += '<rect x="' + (cx + bw * .1 + w + 2) + '" y="' + y(x.exp) + '" width="' + w + '" height="' + Math.max(base - y(x.exp), x.exp ? 4 : 0) + '" rx="3" fill="var(--bad)"><title>' + x.label + ': расходы и списания ' + rub(x.exp) + '</title></rect>';
    if (i % step === 0) s += '<text x="' + (cx + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle" style="font-size:10px">' + x.label + '</text>';
  });
  $('chart').innerHTML = s + '</svg>';
}
function drawCats(f) {
  if (!f.byCategory.length) { $('cats').innerHTML = '<div class="empty"><b>Расходов за период нет</b>Добавьте их в форме ниже — прибыль пересчитается.</div>'; return; }
  const m = f.byCategory[0].sum || 1;
  $('cats').innerHTML = f.byCategory.map((x, i) => '<div class="rank"><span class="n">' + (i + 1) + '</span><b>' + esc(x.category) + '</b><span>' + rub(x.sum) + ' · ' + Math.round(x.sum / f.expenses * 100) + '%</span><div class="t"><i style="width:' + x.sum / m * 100 + '%"></i></div></div>').join('');
}
function drawTop(d) {
  const p = d.products || [], tot = p.reduce((a, x) => a + x.qty, 0) || 1;
  $('top').innerHTML = p.length ? p.map((x) => '<tr><td>' + esc(x.name) + '</td><td><b>' + x.qty + '</b></td><td>' + (x.sum ? rub(x.sum) : '—') + '</td><td>' + Math.round(x.qty / tot * 100) + '%</td></tr>').join('')
    : '<tr><td colspan="4" style="text-align:left;color:var(--muted)">Позиций нет — они считаются из «Продажи.csv» при закрытии кассы</td></tr>';
}
function drawPnl(d) {
  const f = d.finance, act = d.series.filter((x) => x.revenue || x.expenses), loss = act.filter((x) => x.profit < 0);
  const best = act.slice().sort((a, b) => b.profit - a.profit)[0], worst = act.slice().sort((a, b) => a.profit - b.profit)[0];
  const cell = (l, v, sub, cls) => '<div><span class="muted">' + l + '</span><span class="num ' + (cls || '') + '">' + v + '</span><span class="muted">' + (sub || '') + '</span></div>';
  $('pnl').innerHTML = cell(f.profit >= 0 ? 'Прибыль за период' : 'Убыток за период', rub(Math.abs(f.profit)), 'выручка ' + rub(f.revenue) + ' − расходы ' + rub(f.expenses), f.profit >= 0 ? 'pos' : 'neg') +
    cell('Убыточных дней', loss.length, 'из ' + act.length + ' · на сумму ' + rub(loss.reduce((a, x) => a - x.profit, 0)), loss.length ? 'neg' : '') +
    cell('Лучший день', best ? rub(best.profit) : '—', best ? dm(best.date) : '', 'pos') +
    cell('Худший день', worst ? rub(worst.profit) : '—', worst ? dm(worst.date) : '', worst && worst.profit < 0 ? 'neg' : '');
}
function drawTasks(d) {
  const T = d.tasks || [], rev = {}; d.series.forEach((x) => rev[x.date] = x.revenue);
  const names = {}, add = (a, k) => a.forEach((e) => { const n = e.who || 'не указан'; (names[n] = names[n] || { open: 0, day: 0, close: 0 })[k]++; });
  T.forEach((t) => { add(t.open, 'open'); add(t.day, 'day'); add(t.close, 'close'); });
  const nm = Object.keys(names).sort((a, b) => (names[b].open + names[b].close) - (names[a].open + names[a].close));
  $('whoB').innerHTML = nm.length ? nm.map((n) => '<tr><td>' + esc(n) + '</td><td>' + names[n].open + '</td><td>' + names[n].day + '</td><td>' + names[n].close + '</td></tr>').join('') : '<tr><td colspan="4" style="text-align:left;color:var(--muted)">Отметок за период нет</td></tr>';
  const c = (a, need) => a.length ? '<span class="okc">✓ ' + a.map((x) => x.time).join(', ') + '</span><div class="muted">' + Array.from(new Set(a.map((x) => x.who).filter(Boolean))).map(esc).join(', ') + (a.some((x) => x.problems) ? ' · проблем: ' + a.reduce((s, x) => s + x.problems, 0) : '') + '</div>' : '<span class="miss' + (need ? ' bad' : '') + '">—</span>';
  const rows = T.filter((t) => t.open.length || t.day.length || t.close.length || rev[t.date]).reverse();
  $('tasks').innerHTML = rows.length ? rows.map((t) => { const need = rev[t.date] > 0; return '<tr><td>' + dm(t.date) + '</td><td>' + c(t.open, need) + '</td><td>' + c(t.day, need) + '</td><td>' + c(t.close, need) + '</td></tr>'; }).join('')
    : '<tr><td colspan="4" style="text-align:left;color:var(--muted)">нет данных</td></tr>';
}
function drawExps(f) {
  $('exps').innerHTML = f.list.length ? f.list.map((x) => '<div class="xrow"><div><b>' + esc(x.category) + '</b><div class="muted">' + dmy(x.date) + (x.comment ? ' · ' + esc(x.comment) : '') + ' · ' + esc(x.id) + '</div></div><b>' + rub(x.amount) + '</b><button class="btn-s noprint" data-del="' + esc(x.id) + '" aria-label="Удалить расход ' + esc(x.id) + '">Удалить</button></div>').join('')
    : '<div class="empty"><b>Нет расходов за период</b></div>';
}
function drawDisc(d) {
  const i = d.incidents, c = d.discipline, mvpD = d.mvpDiscipline || (window.coffeeCalcDiscipline ? window.coffeeCalcDiscipline(null, d.from, d.to) : { overallPct: 100, totalOnTime: 0, totalAssigned: 0 });
  const cell = (l, v, s) => '<div><span class="muted">' + l + '</span><span class="num">' + v + '</span><span class="muted">' + (s || '') + '</span></div>';
  $('disc').innerHTML =
    cell('Дисциплина (ТЗ 7.1)', mvpD.overallPct + '%', 'в срок ' + mvpD.totalOnTime + ' из ' + mvpD.totalAssigned + ' задач') +
    cell('Открытий смены', c.openings, 'просрочено: ' + c.late) +
    cell('Пропущено чек-листов', c.missed, 'при наличии выручки') +
    cell('Чек-листов сдано', c.checklists, 'проблемных шагов: ' + c.problemSteps) +
    cell('Инцидентов (5 статусов)', i.total, 'в работе ' + i.open + ' · закрыто ' + i.resolved) +
    cell('Критичных', i.critical);

  if ($('staffSummaryB')) {
    const st = d.staffSummary || [];
    $('staffSummaryB').innerHTML = st.length
      ? st.map((s) => {
          const dscObj = window.coffeeCalcDiscipline ? window.coffeeCalcDiscipline(null, d.from, d.to) : { overallPct: 96, byStaff: {} }; const dsc = (dscObj.byStaff && dscObj.byStaff[s.name] && dscObj.byStaff[s.name].pct != null) ? dscObj.byStaff[s.name].pct : dscObj.overallPct;
          const srv = window.coffeeCalcServiceAudit ? window.coffeeCalcServiceAudit(s.name, d.from, d.to).avgScore : 95;
          const avgChk = s.cups > 0 ? Math.round(s.revenue / s.cups) : 0;
          const totalKpi = Math.round((dsc * 0.4) + (srv * 0.4) + (Math.min(100, Math.round((avgChk / 390) * 100)) * 0.2));
          const pillCls = totalKpi >= 90 ? 'ok' : (totalKpi >= 75 ? 'warn' : 'bad');
          return '<tr>' +
            '<td><b>' + esc(s.name) + '</b></td>' +
            '<td>' + s.shifts + '</td>' +
            '<td><span class="kpi-pill ' + (dsc >= 90 ? 'ok' : 'warn') + '">' + dsc + '%</span></td>' +
            '<td><span class="kpi-pill ' + (srv >= 90 ? 'ok' : 'warn') + '">⭐ ' + srv + '%</span></td>' +
            '<td class="pos"><b>' + rub(s.revenue) + '</b><div class="muted" style="font-size:11px">Нал ' + rub(s.cash) + ' · Карта ' + rub(s.card) + '</div></td>' +
            '<td>' + rub(avgChk) + '</td>' +
            '<td>' + s.cups + '</td>' +
            '<td class="neg"><b>' + rub(s.writeoff) + '</b></td>' +
            '<td><span class="kpi-pill ' + pillCls + '">🏆 ' + totalKpi + '%</span></td>' +
            '<td><b style="color:var(--good)">+' + rub(window.coffeeSmartEngine ? window.coffeeSmartEngine.calcStaffBonus(s, dsc, srv, 2, 15).bonus : Math.round(s.revenue * 0.05)) + '</b><div class="muted" style="font-size:11px">коэф. ×' + (window.coffeeSmartEngine ? window.coffeeSmartEngine.calcStaffBonus(s, dsc, srv, 2, 15).kpiCoeff : 1) + '</div></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="9" style="text-align:left;color:var(--muted)">Нет данных по сменам сотрудников за этот период</td></tr>';
  }

  if ($('simResultGrid') && window.coffeeSmartEngine) {
    const sm = window.coffeeSmartEngine.analyze();
    if ($('simBreakEvenBadge')) $('simBreakEvenBadge').textContent = '⚖️ Безубыточность: ' + sm.breakEvenChecksDay + ' чек./день (' + rub(sm.breakEvenRevDay) + ')';
    const recalcSim = () => {
      const addAvg = Number($('simAvgSlider') ? $('simAvgSlider').value : 30) || 0;
      const addChkPct = Number($('simChkSlider') ? $('simChkSlider').value : 10) || 0;
      const cutWoPct = Number($('simWoSlider') ? $('simWoSlider').value : 30) || 0;
      if ($('simAvgVal')) $('simAvgVal').textContent = '+' + addAvg + ' руб.';
      if ($('simChkVal')) $('simChkVal').textContent = '+' + addChkPct + '%';
      if ($('simWoVal')) $('simWoVal').textContent = '-' + cutWoPct + '%';
      const baseChecks = Math.max(40, sm.avgDailyChecks || 75);
      const baseAvg = Math.max(25, sm.factAvgCheck || 32);
      const newChecks = Math.round(baseChecks * (1 + addChkPct / 100));
      const newAvg = baseAvg + addAvg;
      const deltaRevDay = (newChecks * newAvg) - (baseChecks * baseAvg);
      const savedWoDay = Math.round((sm.avgDailyWo || 2) * (cutWoPct / 100) * 10) / 10;
      const extraMonthProfit = Math.round((deltaRevDay + savedWoDay) * 30);
      const extraYearProfit = extraMonthProfit * 12;
      $('simResultGrid').innerHTML =
        '<div class="smart-box insight-ok"><b>🚀 Доп. чистая прибыль в месяц</b><div style="font-size:20px;font-weight:800;color:var(--good)">+' + rub(extraMonthProfit) + ' / мес</div><div class="muted" style="font-size:12px">При новом ср. чеке ' + rub(newAvg) + ' и ' + newChecks + ' чек./день</div></div>' +
        '<div class="smart-box insight-ok"><b>📅 Прогноз новой выручки (30 дн.)</b><div style="font-size:20px;font-weight:800">' + rub(sm.forecastMonthRev + extraMonthProfit) + '</div><div class="muted" style="font-size:12px">Базовый прогноз: ' + rub(sm.forecastMonthRev) + '</div></div>' +
        '<div class="smart-box insight-warn"><b>💰 Годовой финансовый эффект</b><div style="font-size:20px;font-weight:800;color:var(--accent)">+' + rub(extraYearProfit) + ' / год</div><div class="muted" style="font-size:12px">Экономия на списаниях: +' + rub(Math.round(savedWoDay * 30)) + '/мес</div></div>';
    };
    recalcSim();
    ['simAvgSlider', 'simChkSlider', 'simWoSlider'].forEach((id) => {
      if ($(id)) $(id).oninput = recalcSim;
    });
    if ($('dowHeatmapGrid')) {
      $('dowHeatmapGrid').innerHTML = sm.dowStats.map((dw) => (
        '<div class="dow-cell ' + (dw.isPeak ? 'peak' : '') + '">' +
          '<div style="display:flex;justify-content:space-between"><b>' + dw.name + '</b><span class="muted">' + (dw.days ? dw.days + ' дн.' : '—') + '</span></div>' +
          '<div style="font-weight:800;font-size:14px;color:' + (dw.isPeak ? 'var(--good)' : 'var(--ink)') + '">' + (dw.avgRev ? rub(dw.avgRev) : '—') + '</div>' +
          '<div class="muted" style="font-size:11px">' + (dw.avgChecks ? dw.avgChecks + ' чек.' : 'нет смен') + ' · <b>' + dw.recStaff + '</b></div>' +
        '</div>'
      )).join('');
    }
  }
  if ($('incMediaList')) {
    const list = d.incidentList || [];
    $('incMediaList').innerHTML = list.length
      ? list.map((inc) => {
          const media = window.coffeeMediaHtml ? window.coffeeMediaHtml(inc.photo, inc.step) : '';
          const isOp = window.coffeeIsIncActive ? window.coffeeIsIncActive(inc.status) : (inc.status === 'Open' || inc.status === 'Открыта');
          const normSt = window.coffeeNormIncStatus ? window.coffeeNormIncStatus(inc.status) : (isOp ? 'Новая проблема' : 'Решена');
          return '<div class="xrow" style="grid-template-columns:1fr auto;align-items:start">' +
            '<div>' +
              (inc.incType ? '<span class="tag" style="margin-right:6px">' + esc(inc.incType) + '</span>' : '') +
              '<b>' + esc(inc.step || 'Замечание') + '</b> ' +
              '<span class="tag ' + (isOp ? 'no' : 'ok') + '">' + esc(normSt) + '</span> ' +
              (inc.priority === 'Критично' ? '<span class="tag no">критично</span>' : '') +
              '<div style="margin-top:4px">' + esc(inc.text) + '</div>' +
              '<div class="muted">' + dmy(inc.date || '') + (inc.time ? ' ' + esc(inc.time) : '') + (inc.who ? ' · Сотрудник: ' + esc(inc.who) : '') + (inc.owner && inc.owner !== '—' ? ' · Отв.: ' + esc(inc.owner) : '') + '</div>' +
              media +
            '</div>' +
            '<div><a href="admin.html?tab=inc" class="btn-s" style="text-decoration:none;display:inline-block">В поломки →</a></div>' +
          '</div>';
        }).join('')
      : '<p class="muted">Замечаний и поломок нет.</p>';
  }
}
function drawTable(d) {
  const rows = d.series.filter((x) => x.revenue || x.expenses || x.writeoff).reverse();
  $('tbl').innerHTML = rows.length ? rows.map((x) => '<tr style="cursor:pointer" onclick="location.href=\'dashboard.html?date=' + esc(x.date) + '\'" title="Открыть этот день на Дашборде"><td><b>' + dm(x.date) + '</b>' + (x.barista ? '<div class="muted" style="font-size:11.5px">' + esc(x.barista) + '</div>' : '') + '</td><td class="pos"><b>' + rub(x.revenue) + '</b></td><td class="neg">' + rub(x.expenses) + '</td><td class="' + (x.profit >= 0 ? 'pos' : 'neg') + '"><b>' + rub(x.profit) + '</b></td><td>' + x.checks + '</td><td>' + rub(x.avg) + '</td><td>' + rub(x.cash) + '</td><td>' + rub(x.card) + '</td><td class="neg"><b>' + rub(x.writeoff) + '</b></td></tr>').join('')
    : '<tr><td colspan="9" style="text-align:left;color:var(--muted)">нет данных</td></tr>';
}

/* ---------- расходы ---------- */
$('xAdd').onclick = async () => {
  const amt = parseFloat($('xAmt').value);
  if (!(amt > 0)) { toast('Введите сумму больше нуля'); $('xAmt').focus(); return; }
  $('xAdd').disabled = true;
  try {
    await apiPost({ action: 'add_expense', date: $('xDate').value, category: $('xCat').value, amount: amt, comment: $('xCom').value.trim() });
    $('xAmt').value = ''; $('xCom').value = ''; toast('Расход добавлен'); await load();
  } catch (e) { toast(/PIN_REQUIRED/.test(e.message) ? 'Неверный код доступа' : 'Не удалось добавить: ' + e.message); }
  $('xAdd').disabled = false;
};
$('exps').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (window.coffeeConfirm) { window.coffeeConfirm('Удалить расход ' + b.dataset.del + '?', async () => { b.disabled = true; try { await apiPost({ action: 'delete_expense', id: b.dataset.del }); toast('Расход удалён'); load(true); } catch (x) { toast('Ошибка: ' + x.message); b.disabled = false; } }); return; }
  b.disabled = true;
  try { await apiPost({ action: 'delete_expense', id: b.dataset.del }); toast('Расход удалён'); await load(); }
  catch (err) { b.disabled = false; toast('Не удалось удалить: ' + err.message); }
});

/* ---------- экспорт ---------- */
$('csv').onclick = () => {
  if (!R) return;
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [['Дата', 'Выручка', 'Расходы', 'Прибыль', 'Чеков', 'Средний чек', 'Наличные', 'Безнал', 'Списания'].map(q).join(';')]
    .concat(R.series.filter((x) => x.revenue || x.expenses).map((x) => [x.date, x.revenue, x.expenses, x.profit, x.checks, x.avg, x.cash, x.card, x.writeoff].join(';')));
  lines.push('', ['Итого', R.finance.revenue, R.finance.expenses, R.finance.profit, R.totals.checks, R.totals.avg, R.totals.cash, R.totals.card, R.totals.writeoff].join(';'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'кофейня_' + R.from + '_' + R.to + '.csv'; document.body.appendChild(a); a.click(); a.remove();
};
$('print').onclick = () => window.print();

/* ---------- тема ---------- */
const curTheme = () => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function paintTheme() { const k = curTheme() === 'dark'; $('theme').textContent = k ? '☀️' : '🌙'; $('theme').setAttribute('aria-label', k ? 'Светлая тема' : 'Тёмная тема'); }
$('theme').onclick = () => { const n = curTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('coffee_illy_theme', n); } catch (e) {} paintTheme(); };
paintTheme();

/* ---------- старт ---------- */
(function () {
  const t = iso(new Date());
  $('xDate').value = t; $('xDate').max = t; $('from').max = t; $('to').max = t;
  const cats = ['Закупка продуктов', 'Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Ремонт и оборудование', 'Прочее'];
  $('xCat').innerHTML = cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  preset('7');
})();
$('xCat').addEventListener('focus', () => { if (R && R.categories) { const cur = $('xCat').value; $('xCat').innerHTML = R.categories.map((c) => '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join(''); } }, { once: true });
window.addEventListener('storage', (e) => {
  if (!e.key || /coffee_/.test(e.key)) {
    if (typeof load === 'function') load(true, true);
  }
});
window.addEventListener('focus', () => {
  if (typeof load === 'function') load(true, true);
});

