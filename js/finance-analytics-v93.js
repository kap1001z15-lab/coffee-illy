/* Coffee Illy v93.0 — Smart Financial Analytics Engine + Progressive Disclosure UI */
(function () {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function addDays(iso, delta) {
    const p = String(iso || '').split('-').map(Number);
    if (p.length !== 3) return iso;
    const d = new Date(p[0], p[1] - 1, p[2] + delta);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function diffDaysInclusive(fromIso, toIso) {
    const a = new Date(fromIso + 'T00:00:00');
    const b = new Date(toIso + 'T00:00:00');
    const ms = b - a;
    return Math.max(1, Math.round(ms / 86400000) + 1);
  }
  function fmtDateShort(iso) {
    if (!iso || iso.length < 10) return iso || '';
    return iso.slice(8, 10) + '.' + iso.slice(5, 7);
  }
  function fmtDateFull(iso) {
    if (!iso || iso.length < 10) return iso || '';
    return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
  }
  function fmtRub(n) {
    return (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function resolveRange(periodState, todayIso) {
    const mode = (periodState && periodState.mode) || 'month';
    const today = todayIso || (window.CoffeeCloudV93 ? window.CoffeeCloudV93.localISO() : new Date().toISOString().slice(0, 10));
    let from = today, to = today, label = 'Сегодня';

    if (mode === 'today') {
      from = today; to = today; label = 'Сегодня (' + fmtDateShort(today) + ')';
    } else if (mode === 'day') {
      const d = (periodState && periodState.day) || today;
      from = d; to = d; label = fmtDateFull(d);
    } else if (mode === 'week') {
      from = addDays(today, -6); to = today;
      label = 'Неделя (' + fmtDateShort(from) + '–' + fmtDateShort(to) + ')';
    } else if (mode === 'month') {
      from = addDays(today, -29); to = today;
      label = '30 дней (' + fmtDateShort(from) + '–' + fmtDateShort(to) + ')';
    } else if (mode === 'custom') {
      let f = (periodState && periodState.from) || addDays(today, -13);
      let t = (periodState && periodState.to) || today;
      if (f > t) { const tmp = f; f = t; t = tmp; }
      from = f; to = t;
      label = fmtDateFull(from) + ' — ' + fmtDateFull(to);
    }

    const spanDays = diffDaysInclusive(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(spanDays - 1));
    return { mode, from, to, spanDays, prevFrom, prevTo, label };
  }

  function computeAnalytics(state, periodState, todayIso) {
    const range = resolveRange(periodState, todayIso);
    const allCash = Array.isArray(state && state.cash) ? state.cash : [];
    const allExp = Array.isArray(state && state.expenses) ? state.expenses : [];
    const dailyPlan = Number(state && state.plan) || 2200;
    const minAvg = Number(state && state.minAvgCheck) || 35;
    const woNorm = Number(state && state.woNorm) || 15;

    const inRange = (d) => d >= range.from && d <= range.to;
    const inPrev = (d) => d >= range.prevFrom && d <= range.prevTo;

    const cashList = allCash.filter((c) => c && c.date && inRange(c.date));
    const prevCashList = allCash.filter((c) => c && c.date && inPrev(c.date));
    const expList = allExp.filter((e) => e && e.date && inRange(e.date));
    const prevExpList = allExp.filter((e) => e && e.date && inPrev(e.date));

    const sumRev = (arr) => arr.reduce((a, c) => a + (Number(c.revenue || c.total) || 0), 0);
    const revenue = sumRev(cashList);
    const prevRevenue = sumRev(prevCashList);
    const revDeltaPct = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;

    const expenses = expList.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const prevExpenses = prevExpList.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const netProfit = revenue - expenses;
    const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

    const checks = cashList.reduce((a, c) => a + (Number(c.checks) || 0), 0);
    const avgCheck = checks > 0 ? Math.round(revenue / checks) : 0;
    const cashSum = cashList.reduce((a, c) => a + (Number(c.cash) || 0), 0);
    const cardSum = cashList.reduce((a, c) => a + (Number(c.card) || 0), 0);
    const payTotal = cashSum + cardSum;
    const cashPct = payTotal > 0 ? Math.round((cashSum / payTotal) * 100) : 0;
    const cardPct = payTotal > 0 ? (100 - cashPct) : 0;

    const writeoffSum = cashList.reduce((a, c) => a + (Number(c.writeoff) || 0), 0);
    const writeoffPct = revenue > 0 ? Number(((writeoffSum / revenue) * 100).toFixed(1)) : 0;

    // Group by date for chart
    const byDateMap = {};
    cashList.forEach((c) => {
      if (!byDateMap[c.date]) byDateMap[c.date] = { date: c.date, revenue: 0, cash: 0, card: 0, checks: 0, shifts: 0 };
      const b = byDateMap[c.date];
      b.revenue += Number(c.revenue || c.total) || 0;
      b.cash += Number(c.cash) || 0;
      b.card += Number(c.card) || 0;
      b.checks += Number(c.checks) || 0;
      b.shifts += 1;
    });
    const chartSeries = Object.values(byDateMap).sort((a, b) => a.date.localeCompare(b.date));
    const activeDays = Math.max(chartSeries.length, (range.mode === 'today' || range.mode === 'day') ? 1 : 0);
    const periodPlan = dailyPlan * Math.max(1, activeDays || 1);
    const planPct = periodPlan > 0 ? Math.round((revenue / periodPlan) * 100) : 0;

    // Expense breakdown by category
    const catMap = {};
    expList.forEach((e) => {
      const k = e.category || 'Прочее';
      catMap[k] = (catMap[k] || 0) + (Number(e.amount) || 0);
    });
    const expenseByCategory = Object.keys(catMap)
      .map((k) => ({ category: k, amount: catMap[k], sharePct: expenses > 0 ? Math.round((catMap[k] / expenses) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount);

    // Barista performance
    const barMap = {};
    cashList.forEach((c) => {
      const nm = c.barista || c.who || 'Бариста';
      if (!barMap[nm]) barMap[nm] = { name: nm, shifts: 0, revenue: 0, checks: 0, writeoff: 0 };
      barMap[nm].shifts += 1;
      barMap[nm].revenue += Number(c.revenue || c.total) || 0;
      barMap[nm].checks += Number(c.checks) || 0;
      barMap[nm].writeoff += Number(c.writeoff) || 0;
    });
    const byBarista = Object.values(barMap)
      .map((b) => Object.assign(b, {
        avgShift: b.shifts > 0 ? Math.round(b.revenue / b.shifts) : 0,
        avgCheck: b.checks > 0 ? Math.round(b.revenue / b.checks) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Smart Plain-Language Insights (1–3 concise, actionable bullets)
    const insights = [];
    if (cashList.length === 0) {
      const latest = allCash.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      insights.push({
        tone: 'muted',
        text: latest
          ? `За выбранный период закрытых смен пока нет. Последняя смена была ${fmtDateFull(latest.date)} (${fmtRub(latest.revenue)}).`
          : 'За выбранный период кассовых смен пока нет.'
      });
    } else {
      if (revDeltaPct !== null) {
        if (revDeltaPct >= 5) {
          insights.push({ tone: 'good', text: `Выручка выросла на +${revDeltaPct}% к прошлому периоду (${fmtRub(prevRevenue)} → ${fmtRub(revenue)}).` });
        } else if (revDeltaPct <= -5) {
          insights.push({ tone: 'warn', text: `Выручка ниже прошлого периода на ${revDeltaPct}% (${fmtRub(prevRevenue)} → ${fmtRub(revenue)}).` });
        } else {
          insights.push({ tone: 'accent', text: `Выручка стабильна (${revDeltaPct >= 0 ? '+' : ''}${revDeltaPct}% к прошлому периоду).` });
        }
      } else {
        insights.push({
          tone: planPct >= 100 ? 'good' : 'accent',
          text: `Выполнение плана за период: ${planPct}% (${fmtRub(revenue)} из ${fmtRub(periodPlan)}).`
        });
      }

      if (chartSeries.length >= 2) {
        const sorted = chartSeries.slice().sort((a, b) => b.revenue - a.revenue);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        insights.push({
          tone: 'accent',
          text: `Лучший день: ${fmtDateShort(best.date)} (${fmtRub(best.revenue)}), самый слабый: ${fmtDateShort(worst.date)} (${fmtRub(worst.revenue)}).`
        });
      }

      if (avgCheck > 0 && avgCheck < minAvg) {
        insights.push({ tone: 'warn', text: `Средний чек ${avgCheck} ₽ ниже нормы (${minAvg} ₽) — проверьте допродажи десертов и сиропов.` });
      } else if (writeoffPct > woNorm) {
        insights.push({ tone: 'bad', text: `Списания составили ${writeoffPct}% от выручки (норма до ${woNorm}%).` });
      } else if (expenses > 0 && revenue > 0) {
        const expRatio = Math.round((expenses / revenue) * 100);
        const topCat = expenseByCategory[0];
        insights.push({
          tone: expRatio <= 30 ? 'good' : 'warn',
          text: `Расходы ${expRatio}% от выручки (маржа ${marginPct}%)${topCat ? ` · главная статья: ${topCat.category} (${topCat.sharePct}%)` : ''}.`
        });
      }
    }

    const latestShiftDate = allCash.length ? allCash.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].date : null;

    return {
      range,
      revenue, prevRevenue, revDeltaPct,
      expenses, prevExpenses, netProfit, marginPct,
      checks, avgCheck, minAvg,
      cashSum, cardSum, cashPct, cardPct,
      writeoffSum, writeoffPct,
      periodPlan, planPct, dailyPlan,
      shiftsCount: cashList.length,
      chartSeries,
      insights: insights.slice(0, 3),
      expenseByCategory,
      byBarista,
      filteredCash: cashList.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      filteredExpenses: expList.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      latestShiftDate
    };
  }

  function ensureFinanceCss() {
    if (typeof document === 'undefined' || document.getElementById('m3-fin-v93-css')) return;
    const st = document.createElement('style');
    st.id = 'm3-fin-v93-css';
    st.textContent = `
      .fin-bar {
        display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
        gap: 10px; margin-bottom: 16px;
      }
      .fin-seg {
        display: inline-flex; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--line);
        border-radius: 999px; padding: 3px; gap: 2px;
      }
      .fin-seg button {
        border: none; background: transparent; color: var(--muted); padding: 7px 14px;
        border-radius: 999px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
        transition: background .14s, color .14s;
      }
      .fin-seg button.active { background: var(--accent); color: var(--accent-ink); }
      .fin-date-picks { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .fin-date-pill {
        background: var(--surface); border: 1px solid var(--line); color: var(--ink);
        border-radius: 999px; padding: 7px 14px; font-family: inherit; font-size: 13px; font-weight: 700;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
      }
      .fin-date-pill:hover { border-color: var(--accent); }

      .fin-delta {
        display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
        font-size: 11px; font-weight: 800; margin-left: 6px;
      }
      .fin-delta.up { background: rgba(138,214,167,.16); color: var(--good); }
      .fin-delta.down { background: rgba(242,162,162,.16); color: var(--bad); }
      .fin-delta.flat { background: var(--surface-2); color: var(--muted); }

      .fin-split-bar {
        height: 8px; border-radius: 999px; overflow: hidden; display: flex;
        background: var(--surface-2); margin-top: 8px;
      }
      .fin-split-cash { background: var(--accent); height: 100%; }
      .fin-split-card { background: var(--good); height: 100%; }

      .fin-insights {
        display: grid; gap: 8px; margin-bottom: 16px;
      }
      .fin-insight {
        display: flex; align-items: flex-start; gap: 10px;
        background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
        padding: 11px 14px; font-size: 13px; line-height: 1.45;
      }
      .fin-insight-dot {
        width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0;
        background: var(--accent);
      }
      .fin-insight.good .fin-insight-dot { background: var(--good); }
      .fin-insight.warn .fin-insight-dot { background: var(--warn); }
      .fin-insight.bad .fin-insight-dot { background: var(--bad); }
      .fin-insight.muted .fin-insight-dot { background: var(--muted); }

      /* Progressive Disclosure Accordion */
      .m3-drill {
        background: var(--card); border: 1px solid var(--line); border-radius: 22px;
        margin-bottom: 12px; overflow: hidden; transition: border-color .15s;
      }
      .m3-drill[open] { border-color: rgba(232,184,138,.35); }
      .m3-drill > summary {
        list-style: none; cursor: pointer; padding: 15px 18px;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        user-select: none;
      }
      .m3-drill > summary::-webkit-details-marker { display: none; }
      .m3-drill-head { display: flex; flex-direction: column; gap: 2px; }
      .m3-drill-title { font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
      .m3-drill-sub { font-size: 12px; color: var(--muted); }
      .m3-drill-chev {
        width: 30px; height: 30px; border-radius: 50%; background: var(--surface-2);
        display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
        color: var(--muted); transition: transform .18s ease, color .18s; flex-shrink: 0;
      }
      .m3-drill[open] .m3-drill-chev { transform: rotate(180deg); color: var(--accent); }
      .m3-drill-body { padding: 0 18px 18px; border-top: 1px solid var(--line); padding-top: 14px; }

      .cat-row { display: grid; gap: 6px; margin-bottom: 10px; }
      .cat-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; }
      .cat-bar { height: 7px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
      .cat-fill { height: 100%; border-radius: 999px; background: var(--accent); }
    `;
    document.head.appendChild(st);
  }

  function renderFinanceTab(root, state, uiState, handlers) {
    ensureFinanceCss();
    const today = (window.CoffeeCloudV93 ? window.CoffeeCloudV93.localISO() : new Date().toISOString().slice(0, 10));
    const a = computeAnalytics(state, uiState, today);
    const openMap = uiState.openSections || {};
    const searchQ = (uiState.shiftSearch || '').trim().toLowerCase();

    const maxRev = Math.max(a.dailyPlan, ...a.chartSeries.map((c) => c.revenue), 1);
    const planPctLine = Math.min(92, Math.max(16, Math.round((a.dailyPlan / maxRev) * 100) * 0.78));
    const deltaHtml = a.revDeltaPct !== null
      ? `<span class="fin-delta ${a.revDeltaPct > 0 ? 'up' : (a.revDeltaPct < 0 ? 'down' : 'flat')}">${a.revDeltaPct > 0 ? '+' : ''}${a.revDeltaPct}%</span>`
      : '';

    const shownShifts = searchQ
      ? a.filteredCash.filter((c) => (c.date + ' ' + (c.barista || '') + ' ' + (c.topItems || '')).toLowerCase().includes(searchQ))
      : a.filteredCash;

    root.innerHTML = `
      <div class="fin-bar">
        <div class="fin-seg" id="fin-seg">
          <button class="${a.range.mode === 'today' ? 'active' : ''}" data-pm="today">Сегодня</button>
          <button class="${a.range.mode === 'day' ? 'active' : ''}" data-pm="day">День</button>
          <button class="${a.range.mode === 'week' ? 'active' : ''}" data-pm="week">Неделя</button>
          <button class="${a.range.mode === 'month' ? 'active' : ''}" data-pm="month">Месяц</button>
          <button class="${a.range.mode === 'custom' ? 'active' : ''}" data-pm="custom">Период</button>
        </div>
        <div class="fin-date-picks">
          ${a.range.mode === 'day' ? `<button type="button" class="fin-date-pill" id="fin-pick-day">📅 ${fmtDateFull(a.range.from)} ▾</button>` : ''}
          ${a.range.mode === 'custom' ? `
            <button type="button" class="fin-date-pill" id="fin-pick-from">С ${fmtDateFull(a.range.from)} ▾</button>
            <button type="button" class="fin-date-pill" id="fin-pick-to">По ${fmtDateFull(a.range.to)} ▾</button>
          ` : ''}
          ${a.shiftsCount === 0 && a.latestShiftDate ? `<button type="button" class="chip-btn accent" id="fin-jump-last">Последняя смена (${fmtDateShort(a.latestShiftDate)})</button>` : ''}
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-lbl">Выручка · ${esc(a.range.label)}</div>
          <div class="kpi-val">${fmtRub(a.revenue)}${deltaHtml}</div>
          <div class="kpi-meta">План: ${a.planPct}% (${fmtRub(a.periodPlan)}) · Смен: ${a.shiftsCount}</div>
        </div>
        <div class="kpi">
          <div class="kpi-lbl">Чистая прибыль</div>
          <div class="kpi-val" style="color:${a.netProfit >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtRub(a.netProfit)}</div>
          <div class="kpi-meta">Маржа: <b>${a.marginPct}%</b> · Расходы: ${fmtRub(a.expenses)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-lbl">Средний чек</div>
          <div class="kpi-val" style="color:${a.avgCheck >= a.minAvg || a.avgCheck === 0 ? 'var(--ink)' : 'var(--warn)'}">${a.avgCheck} ₽</div>
          <div class="kpi-meta">Чеков: <b>${a.checks}</b> · Норма: от ${a.minAvg} ₽</div>
        </div>
        <div class="kpi">
          <div class="kpi-lbl">Нал / Безнал</div>
          <div class="kpi-val" style="font-size:20px;">${a.cashPct}% / ${a.cardPct}%</div>
          <div class="kpi-meta">${fmtRub(a.cashSum)} / ${fmtRub(a.cardSum)}</div>
          <div class="fin-split-bar"><div class="fin-split-cash" style="width:${a.cashPct}%"></div><div class="fin-split-card" style="width:${a.cardPct}%"></div></div>
        </div>
      </div>

      <div class="fin-insights">
        ${a.insights.map((ins) => `<div class="fin-insight ${ins.tone}"><span class="fin-insight-dot"></span><span>${esc(ins.text)}</span></div>`).join('')}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div class="card-head">
          <div>
            <h2 class="card-title">Динамика выручки</h2>
            <div class="card-sub">${esc(a.range.label)} · Дневной план ${fmtRub(a.dailyPlan)}</div>
          </div>
          <button type="button" class="chip-btn accent" id="e-add">+ Расход</button>
        </div>
        ${a.chartSeries.length ? `
          <div class="chart-wrap">
            <div class="chart-plan-line" style="bottom:${planPctLine}%"><span class="chart-plan-lbl">План ${fmtRub(a.dailyPlan)}</span></div>
            ${a.chartSeries.slice(-14).map((c) => `
              <div class="bar-col" title="${fmtDateFull(c.date)}: ${fmtRub(c.revenue)} (${c.checks} чек.)">
                <div class="bar-val">${c.revenue}</div>
                <div class="bar-fill ${c.revenue >= a.dailyPlan ? 'hit' : ''}" style="height:${Math.max(12, Math.round((c.revenue / maxRev) * 100))}%"></div>
                <div class="bar-dt">${c.date.slice(5)}</div>
              </div>`).join('')}
          </div>` : `<div style="padding:26px 12px;text-align:center;color:var(--muted);font-size:13px;">Нет закрытых смен за выбранный период. Выберите «Неделя», «Месяц» или «Период» выше.</div>`}
      </div>

      <!-- Progressive Disclosure: Deep-Dive Sections -->
      <details class="m3-drill" data-sec="expenses" ${openMap.expenses ? 'open' : ''}>
        <summary>
          <div class="m3-drill-head">
            <div class="m3-drill-title">📊 Структура расходов <span class="badge">${fmtRub(a.expenses)}</span></div>
            <div class="m3-drill-sub">${a.filteredExpenses.length} записей за период · нажмите, чтобы раскрыть категории и список</div>
          </div>
          <span class="m3-drill-chev">▾</span>
        </summary>
        <div class="m3-drill-body">
          ${a.expenseByCategory.length ? `
            <div style="margin-bottom:14px;">
              ${a.expenseByCategory.map((c) => `
                <div class="cat-row">
                  <div class="cat-top"><span>${esc(c.category)}</span><span>${fmtRub(c.amount)} <span style="color:var(--muted);font-weight:600;">(${c.sharePct}%)</span></span></div>
                  <div class="cat-bar"><div class="cat-fill" style="width:${Math.max(4, c.sharePct)}%"></div></div>
                </div>`).join('')}
            </div>` : ''}
          <div class="stack">
            ${a.filteredExpenses.length
              ? a.filteredExpenses.map((e) => `<div class="row-item"><div class="row-main"><div class="row-title">${esc(e.category)} · ${fmtRub(e.amount)}</div><div class="row-sub">${e.date}${e.comment ? ' · ' + esc(e.comment) : ''}</div></div><button type="button" class="chip-btn bad" data-de="${esc(e.id)}">✕</button></div>`).join('')
              : `<div style="color:var(--muted);font-size:13px;">Расходов за этот период нет.</div>`}
          </div>
        </div>
      </details>

      <details class="m3-drill" data-sec="baristas" ${openMap.baristas ? 'open' : ''}>
        <summary>
          <div class="m3-drill-head">
            <div class="m3-drill-title">👥 Эффективность бариста <span class="badge">${a.byBarista.length}</span></div>
            <div class="m3-drill-sub">Сравнение выручки, смен и среднего чека по сотрудникам</div>
          </div>
          <span class="m3-drill-chev">▾</span>
        </summary>
        <div class="m3-drill-body">
          ${a.byBarista.length ? `
            <div class="tbl-wrap"><table>
              <thead><tr><th>Бариста</th><th>Смен</th><th>Выручка</th><th>В среднем / смена</th><th>Ср. чек</th></tr></thead>
              <tbody>
                ${a.byBarista.map((b) => `<tr><td><b>${esc(b.name)}</b></td><td>${b.shifts}</td><td><b>${fmtRub(b.revenue)}</b></td><td>${fmtRub(b.avgShift)}</td><td>${b.avgCheck} ₽</td></tr>`).join('')}
              </tbody>
            </table></div>` : `<div style="color:var(--muted);font-size:13px;">Нет данных по бариста за выбранный период.</div>`}
        </div>
      </details>

      <details class="m3-drill" data-sec="shifts" ${openMap.shifts ? 'open' : ''}>
        <summary>
          <div class="m3-drill-head">
            <div class="m3-drill-title">🧾 Детализация кассовых смен <span class="badge">${a.shiftsCount}</span></div>
            <div class="m3-drill-sub">Полная таблица: наличные, безнал, чеки, списания и поиск</div>
          </div>
          <span class="m3-drill-chev">▾</span>
        </summary>
        <div class="m3-drill-body">
          <div class="field" style="margin-bottom:10px;">
            <input id="fin-shift-search" placeholder="Поиск по дате или бариста..." value="${esc(uiState.shiftSearch || '')}">
          </div>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Дата</th><th>Выручка</th><th>Нал / Безнал</th><th>Чеков</th><th>Ср. чек</th><th>Списания</th><th>Бариста</th></tr></thead>
            <tbody>
              ${shownShifts.length ? shownShifts.map((c) => `<tr>
                <td><b>${c.date}</b></td>
                <td><b>${fmtRub(c.revenue)}</b></td>
                <td style="color:var(--muted)">${fmtRub(c.cash)} / ${fmtRub(c.card)}</td>
                <td>${c.checks}</td>
                <td>${c.checks ? Math.round(c.revenue / c.checks) : 0} ₽</td>
                <td style="color:${c.writeoff ? 'var(--warn)' : 'var(--muted)'}">${c.writeoff ? fmtRub(c.writeoff) : '—'}</td>
                <td>${esc(c.barista)}</td>
              </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--muted);">Ничего не найдено</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </details>

      <details class="m3-drill" data-sec="plans" ${openMap.plans ? 'open' : ''}>
        <summary>
          <div class="m3-drill-head">
            <div class="m3-drill-title">🎯 Планы и график (Пн–Вс)</div>
            <div class="m3-drill-sub">Дневные цели по выручке, чекам и расписание смен</div>
          </div>
          <span class="m3-drill-chev">▾</span>
        </summary>
        <div class="m3-drill-body">
          <div class="tbl-wrap"><table>
            <thead><tr><th>День</th><th>План</th><th>Чеков</th><th>Смена</th><th></th></tr></thead>
            <tbody>
              ${(state.plans || []).map((p, i) => `<tr><td><b>${esc(p.day)}</b></td><td>${fmtRub(p.rev)}</td><td>${p.checks}</td><td style="font-size:12px;color:var(--muted)">${esc(p.roster)}</td><td><button type="button" class="chip-btn" data-ep="${i}" style="padding:4px 8px;">✏️</button></td></tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </details>
    `;

    // Bindings
    root.querySelectorAll('#fin-seg [data-pm]').forEach((b) => {
      b.onclick = () => {
        uiState.mode = b.dataset.pm;
        if (uiState.mode === 'day' && !uiState.day) uiState.day = a.latestShiftDate || today;
        if (uiState.mode === 'custom') {
          if (!uiState.from) uiState.from = addDays(today, -13);
          if (!uiState.to) uiState.to = today;
        }
        handlers.onRefresh();
      };
    });

    const pickDay = root.querySelector('#fin-pick-day');
    if (pickDay && window.M3Controls) {
      pickDay.onclick = () => window.M3Controls.openDatePicker({
        value: uiState.day || today,
        title: 'Выберите день',
        onChange: (iso) => { uiState.day = iso; handlers.onRefresh(); }
      });
    }
    const pickFrom = root.querySelector('#fin-pick-from');
    if (pickFrom && window.M3Controls) {
      pickFrom.onclick = () => window.M3Controls.openDatePicker({
        value: uiState.from || addDays(today, -13),
        title: 'Начало периода',
        onChange: (iso) => { uiState.from = iso; handlers.onRefresh(); }
      });
    }
    const pickTo = root.querySelector('#fin-pick-to');
    if (pickTo && window.M3Controls) {
      pickTo.onclick = () => window.M3Controls.openDatePicker({
        value: uiState.to || today,
        title: 'Конец периода',
        onChange: (iso) => { uiState.to = iso; handlers.onRefresh(); }
      });
    }
    const jumpLast = root.querySelector('#fin-jump-last');
    if (jumpLast && a.latestShiftDate) {
      jumpLast.onclick = () => {
        uiState.mode = 'day';
        uiState.day = a.latestShiftDate;
        handlers.onRefresh();
      };
    }

    root.querySelectorAll('details.m3-drill').forEach((d) => {
      d.addEventListener('toggle', () => {
        uiState.openSections = uiState.openSections || {};
        uiState.openSections[d.dataset.sec] = d.open;
      });
    });

    const searchInput = root.querySelector('#fin-shift-search');
    if (searchInput) {
      searchInput.oninput = () => {
        uiState.shiftSearch = searchInput.value;
        uiState.openSections = Object.assign(uiState.openSections || {}, { shifts: true });
        handlers.onRefresh();
        const el = document.getElementById('fin-shift-search');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      };
    }

    const addBtn = root.querySelector('#e-add');
    if (addBtn) addBtn.onclick = handlers.onAddExpense;
    root.querySelectorAll('[data-de]').forEach((b) => { b.onclick = () => handlers.onDeleteExpense(b.dataset.de); });
    root.querySelectorAll('[data-ep]').forEach((b) => { b.onclick = () => handlers.onEditPlan(Number(b.dataset.ep)); });
  }

  window.CoffeeFinanceV93 = {
    resolveRange: resolveRange,
    computeAnalytics: computeAnalytics,
    renderFinanceTab: renderFinanceTab
  };
})();
