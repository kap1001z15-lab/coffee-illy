/* Coffee Illy v95.0 — Smart Financial Analytics with Progressive Disclosure */
(function () {
  if (typeof window === 'undefined') return;

  function fmtRub(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽'; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function shiftDateISO(iso, deltaDays) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }

  function calcPeriodData(state, periodKey, customFrom, customTo, todayISO) {
    const today = todayISO || new Date().toISOString().slice(0, 10);
    let from = today, to = today, prevFrom = shiftDateISO(today, -1), prevTo = shiftDateISO(today, -1), label = 'Сегодня';
    if (periodKey === 'day') {
      from = shiftDateISO(today, -1); to = from;
      prevFrom = shiftDateISO(from, -1); prevTo = prevFrom;
      label = 'Вчера (' + from.slice(5) + ')';
    } else if (periodKey === 'week') {
      from = shiftDateISO(today, -6); to = today;
      prevFrom = shiftDateISO(from, -7); prevTo = shiftDateISO(from, -1);
      label = '7 дней';
    } else if (periodKey === 'month') {
      from = shiftDateISO(today, -29); to = today;
      prevFrom = shiftDateISO(from, -30); prevTo = shiftDateISO(from, -1);
      label = '30 дней';
    } else if (periodKey === 'custom') {
      from = customFrom || shiftDateISO(today, -13);
      to = customTo || today;
      const span = Math.max(1, Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1);
      prevTo = shiftDateISO(from, -1);
      prevFrom = shiftDateISO(prevTo, -(span - 1));
      label = from.slice(5) + ' — ' + to.slice(5);
    } else if (periodKey === 'all') {
      from = '2000-01-01'; to = '2099-12-31';
      prevFrom = '1990-01-01'; prevTo = '1999-12-31';
      label = 'Всё время';
    }

    const inRng = (dt, a, b) => { const s = String(dt || '').slice(0, 10); return s >= a && s <= b; };
    const cash = (state.cash || []).filter(c => inRng(c.date, from, to));
    const prevCash = (state.cash || []).filter(c => inRng(c.date, prevFrom, prevTo));
    const exp = (state.expenses || []).filter(e => inRng(e.date, from, to));
    const prevExp = (state.expenses || []).filter(e => inRng(e.date, prevFrom, prevTo));

    const sum = (arr, fn) => arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
    const rev = sum(cash, c => c.revenue || c.total);
    const prevRev = sum(prevCash, c => c.revenue || c.total);
    const expSum = sum(exp, e => e.amount);
    const prevExpSum = sum(prevExp, e => e.amount);
    const net = rev - expSum;
    const prevNet = prevRev - prevExpSum;
    const checks = sum(cash, c => c.checks);
    const prevChecks = sum(prevCash, c => c.checks);
    const avg = checks > 0 ? Math.round(rev / checks) : 0;
    const prevAvg = prevChecks > 0 ? Math.round(prevRev / prevChecks) : 0;

    const deltaPct = (cur, prev) => {
      if (!prev) return null;
      return Math.round(((cur - prev) / Math.abs(prev)) * 100);
    };

    const byCat = {};
    exp.forEach(e => {
      const k = e.category || 'Прочее';
      byCat[k] = (byCat[k] || 0) + (Number(e.amount) || 0);
    });
    const expCats = Object.keys(byCat)
      .map(k => ({ category: k, amount: byCat[k], pct: expSum > 0 ? Math.round((byCat[k] / expSum) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount);

    const byBarista = {};
    cash.forEach(c => {
      const nm = c.barista || c.who || 'Бариста';
      if (!byBarista[nm]) byBarista[nm] = { name: nm, shifts: 0, rev: 0, checks: 0 };
      byBarista[nm].shifts += 1;
      byBarista[nm].rev += Number(c.revenue || c.total || 0);
      byBarista[nm].checks += Number(c.checks || 0);
    });
    const baristas = Object.values(byBarista)
      .map(b => Object.assign(b, { avgCheck: b.checks > 0 ? Math.round(b.rev / b.checks) : 0 }))
      .sort((a, b) => b.rev - a.rev);

    const insights = [];
    const revDelta = deltaPct(rev, prevRev);
    if (revDelta !== null && cash.length > 0) {
      insights.push(revDelta >= 0
        ? `Выручка выросла на +${revDelta}% по сравнению с прошлым периодом (${fmtRub(prevRev)} → ${fmtRub(rev)}).`
        : `Выручка ниже прошлого периода на ${Math.abs(revDelta)}% (${fmtRub(prevRev)} → ${fmtRub(rev)}).`);
    }
    const minAvg = Number(state.minAvgCheck || 35);
    if (avg > 0) {
      insights.push(avg >= minAvg
        ? `Средний чек ${avg} ₽ держится выше целевой нормы (${minAvg} ₽).`
        : `Средний чек ${avg} ₽ ниже нормы ${minAvg} ₽ — стоит усилить допродажи десертов и сиропов.`);
    }
    if (expCats.length > 0) {
      insights.push(`Главная статья расходов — «${expCats[0].category}»: ${fmtRub(expCats[0].amount)} (${expCats[0].pct}% от всех трат).`);
    } else if (baristas.length > 0 && insights.length < 3) {
      insights.push(`Лидер периода по выручке: ${baristas[0].name} — ${fmtRub(baristas[0].rev)} за ${baristas[0].shifts} смен.`);
    }
    if (!insights.length) {
      insights.push('За выбранный период кассовых смен пока нет — переключите период на «Неделя», «Месяц» или «Всё время».');
    }

    return {
      label, from, to, cash, exp,
      kpi: {
        rev, revDelta,
        expSum, expDelta: deltaPct(expSum, prevExpSum),
        net, netDelta: deltaPct(net, prevNet),
        avg, avgDelta: deltaPct(avg, prevAvg),
        checks, shifts: cash.length,
        cashSum: sum(cash, c => c.cash),
        cardSum: sum(cash, c => c.card)
      },
      expCats,
      baristas,
      insights: insights.slice(0, 3)
    };
  }

  function renderDeltaBadge(pct, invertGood) {
    if (pct === null || pct === undefined) return '';
    const isGood = invertGood ? pct <= 0 : pct >= 0;
    const cls = isGood ? 'good' : 'bad';
    const arrow = pct >= 0 ? '▲' : '▼';
    return `<span class="badge ${cls}" style="margin-left:6px;">${arrow} ${Math.abs(pct)}%</span>`;
  }

  function renderSmartAnalyticsHtml(state, opts) {
    const period = (opts && opts.period) || 'month';
    const d = calcPeriodData(state, period, opts && opts.from, opts && opts.to, opts && opts.today);
    const periods = [
      { k: 'today', l: 'Сегодня' },
      { k: 'day', l: 'Вчера' },
      { k: 'week', l: 'Неделя' },
      { k: 'month', l: 'Месяц' },
      { k: 'all', l: 'Всё время' }
    ];
    const maxRev = Math.max(Number(state.plan || 2200), ...d.cash.map(c => Number(c.revenue || c.total || 0)), 1);
    const chartDays = d.cash.slice(0, 14).reverse();

    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-head" style="margin-bottom:12px;">
          <div>
            <h2 class="card-title">Умная финансовая аналитика</h2>
            <div class="card-sub">Сравнение с предыдущим периодом и автоматические выводы · Период: ${esc(d.label)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="fin-period-pills">
            ${periods.map(p => `<button type="button" class="chip-btn ${period === p.k ? 'accent' : ''}" data-finp="${p.k}">${p.l}</button>`).join('')}
          </div>
        </div>

        <div class="kpi-grid" style="margin-bottom:14px;">
          <div class="kpi">
            <div class="kpi-lbl">Выручка ${renderDeltaBadge(d.kpi.revDelta, false)}</div>
            <div class="kpi-val">${fmtRub(d.kpi.rev)}</div>
            <div class="kpi-meta">Нал: ${fmtRub(d.kpi.cashSum)} · Безнал: ${fmtRub(d.kpi.cardSum)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-lbl">Расходы ${renderDeltaBadge(d.kpi.expDelta, true)}</div>
            <div class="kpi-val" style="color:var(--bad)">${fmtRub(d.kpi.expSum)}</div>
            <div class="kpi-meta">Операций: ${d.exp.length}</div>
          </div>
          <div class="kpi">
            <div class="kpi-lbl">Чистый итог ${renderDeltaBadge(d.kpi.netDelta, false)}</div>
            <div class="kpi-val" style="color:var(--good)">${fmtRub(d.kpi.net)}</div>
            <div class="kpi-meta">Смен: ${d.kpi.shifts}</div>
          </div>
          <div class="kpi">
            <div class="kpi-lbl">Средний чек ${renderDeltaBadge(d.kpi.avgDelta, false)}</div>
            <div class="kpi-val">${d.kpi.avg} ₽</div>
            <div class="kpi-meta">Чеков: ${d.kpi.checks}</div>
          </div>
        </div>

        <div class="card-soft" style="margin-bottom:14px;border-left:3px solid var(--accent);">
          <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;">Ключевые выводы</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;">
            ${d.insights.map(t => `<li>${esc(t)}</li>`).join('')}
          </ul>
        </div>

        ${chartDays.length ? `
          <div class="chart-wrap" style="margin-bottom:14px;">
            ${chartDays.map(c => {
              const rv = Number(c.revenue || c.total || 0);
              const hit = rv >= Number(state.plan || 2200);
              return `<div class="bar-col"><div class="bar-val">${rv}</div><div class="bar-fill ${hit ? 'hit' : ''}" style="height:${Math.max(12, Math.round((rv / maxRev) * 100))}%"></div><div class="bar-dt">${String(c.date).slice(5)}</div></div>`;
            }).join('')}
          </div>` : ''}

        <div class="stack" style="gap:8px;">
          <details class="card-soft" style="cursor:pointer;">
            <summary style="font-weight:600;font-size:13.5px;list-style:none;display:flex;justify-content:space-between;">
              <span>Структура расходов по категориям (${d.expCats.length})</span>
              <span style="color:var(--muted)">${fmtRub(d.kpi.expSum)} ▾</span>
            </summary>
            <div class="stack" style="margin-top:10px;gap:8px;">
              ${d.expCats.length ? d.expCats.map(ec => `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                    <span>${esc(ec.category)}</span>
                    <b>${fmtRub(ec.amount)} (${ec.pct}%)</b>
                  </div>
                  <div class="pbar"><div style="width:${ec.pct}%"></div></div>
                </div>`).join('') : '<div style="font-size:12.5px;color:var(--muted);">Нет расходов за период</div>'}
            </div>
          </details>

          <details class="card-soft" style="cursor:pointer;">
            <summary style="font-weight:600;font-size:13.5px;list-style:none;display:flex;justify-content:space-between;">
              <span>Эффективность бариста за период (${d.baristas.length})</span>
              <span style="color:var(--muted)">Подробнее ▾</span>
            </summary>
            <div class="tbl-wrap" style="margin-top:10px;">
              <table><thead><tr><th>Сотрудник</th><th>Смен</th><th>Выручка</th><th>Чеков</th><th>Ср. чек</th></tr></thead><tbody>
                ${d.baristas.length ? d.baristas.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${b.shifts}</td><td><b>${fmtRub(b.rev)}</b></td><td>${b.checks}</td><td><span class="badge accent">${b.avgCheck} ₽</span></td></tr>`).join('') : '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Нет данных за период</td></tr>'}
              </tbody></table>
            </div>
          </details>
        </div>
      </div>`;
  }

  window.CoffeeFinanceAnalyticsV95 = {
    calcPeriodData: calcPeriodData,
    renderSmartAnalyticsHtml: renderSmartAnalyticsHtml
  };
})();
