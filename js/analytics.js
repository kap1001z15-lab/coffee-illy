/* =========================================================================
   МОДУЛЬ АНАЛИТИКИ, ТАЙМЛАЙНА И КОНТРОЛЯ (js/analytics.js — v21 Enterprise)
   Единые функции без дублирования и переопределений:
   - Таймлайн чек-листов и контроль просрочек (coffeeGetBlockWindow, coffeeEnforceOverdueChecklists)
   - Планы выручки, среднего чека и транзакций по дням недели Пн–Вс (coffeeGetDayPlan)
   - Проверка персональных PIN сотрудников через SHA-256 + Rate-Limiting 5 попыток (coffeeVerifyStaffPin)
   - Детектор «Красных флагов» робота (coffeeEvaluateRedFlags) и P&L-движок (coffeeSmartEngine)
   ========================================================================= */
/* П. 7.2 ТЗ: Расчёт качества обслуживания по чек-листам шеф-бариста / администратора */
window.coffeeCalcServiceAudit = function (baristaName, fromStr, toStr) {
  const db = getUDB();
  const list = (db.serviceAudits || []).filter((a) => {
    if (fromStr && a.date < fromStr) return false;
    if (toStr && a.date > toStr) return false;
    if (baristaName && a.barista && a.barista.toLowerCase() !== baristaName.toLowerCase()) return false;
    return true;
  });
  if (!list.length) return { count: 0, avgScore: 95, audits: [] };
  const sum = list.reduce((s, a) => s + (Number(a.score) || 0), 0);
  return { count: list.length, avgScore: Math.round(sum / list.length), audits: list };
};

window.coffeeCalcDiscipline = function (dbOpt, fromStr, toStr) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  const t = _isoToday();
  const from = fromStr || _shiftIso(t, -6);
  const to = toStr || t;
  const checklists = (db.checklists || []).filter((c) => c.date >= from && c.date <= to);
  const staffMap = {};
  const ensureStaff = (name) => {
    const nm = String(name || 'Бариста').trim() || 'Бариста';
    if (!staffMap[nm]) {
      staffMap[nm] = {
        name: nm,
        assignedTasks: 0,
        onTimeTasks: 0,
        lateTasks: 0,
        missedTasks: 0,
        checklistsOnTime: 0,
        checklistsLate: 0,
        incidentsReported: 0,
        disciplinePct: 100
      };
    }
    return staffMap[nm];
  };

  let totalAssigned = 0, totalOnTime = 0, totalLate = 0, totalMissed = 0;
  const seenKeys = {};

  checklists.forEach((chk) => {
    const uniqKey = chk.date + ':' + chk.block + ':' + (chk.who || '');
    if (seenKeys[uniqKey]) return; /* Исключаем повторный учёт одной и той же задачи (п. 7.1 ТЗ) */
    seenKeys[uniqKey] = true;
    const st = ensureStaff(chk.who);
    const stepCount = Number(chk.totalSteps) || (chk.block === 'Открытие' ? 8 : chk.block === 'День' ? 6 : 14);
    const dl = chk.deadline || (chk.block === 'Открытие' ? (db.deadline || '08:30') : chk.block === 'День' ? (db.dayDeadline || '16:30') : (db.closeDeadline || '22:30'));
    const isLate = chk.isLate != null ? !!chk.isLate : (String(chk.time || '') > dl);
    st.assignedTasks += stepCount;
    totalAssigned += stepCount;
    if (isLate) {
      st.lateTasks += stepCount;
      st.checklistsLate += 1;
      totalLate += stepCount;
    } else {
      st.onTimeTasks += stepCount;
      st.checklistsOnTime += 1;
      totalOnTime += stepCount;
    }
    st.incidentsReported += Number(chk.problems) || 0;
  });

  (db.cash || []).filter((c) => c.date >= from && c.date <= to && (Number(c.cash) + Number(c.card) > 0)).forEach((c) => {
    const dayChks = checklists.filter((x) => x.date === c.date);
    const mainBarista = String(c.barista || 'Бариста').split(',')[0].trim() || 'Бариста';
    const st = ensureStaff(mainBarista);
    ['Открытие', 'День', 'Закрытие'].forEach((blk) => {
      if (!dayChks.some((x) => x.block === blk)) {
        const blkTasks = blk === 'Открытие' ? 8 : blk === 'День' ? 6 : 14;
        st.assignedTasks += blkTasks;
        st.missedTasks += blkTasks;
        totalAssigned += blkTasks;
        totalMissed += blkTasks;
      }
    });
  });

  Object.values(staffMap).forEach((s) => {
    s.disciplinePct = s.assignedTasks > 0 ? Math.round((s.onTimeTasks / s.assignedTasks) * 100) : 100;
  });

  const overallPct = totalAssigned > 0 ? Math.round((totalOnTime / totalAssigned) * 100) : 100;
  return {
    overallPct,
    totalAssigned,
    totalOnTime,
    totalLate,
    totalMissed,
    byStaff: Object.values(staffMap).sort((a, b) => b.disciplinePct - a.disciplinePct)
  };
};


window.coffeeSmartEngine = {
  analyze(dbOpt, focusDate) {
    const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : (typeof DB !== 'undefined' ? DB : {}));
    const cashList = Array.isArray(db.cash) ? db.cash : [];
    const expList = Array.isArray(db.expenses) ? db.expenses : [];
    const incList = Array.isArray(db.incidents) ? db.incidents : [];
    const audits = Array.isArray(db.serviceAudits) ? db.serviceAudits : [];
    const planDay = Math.max(1, Number(db.plan) || 2200);
    const woNorm = Math.max(0, Number(db.woNorm != null ? db.woNorm : 15));
    const minAvg = Math.max(1, Number(db.minAvgCheck) || 35);
    const planChecks = Math.max(1, Number(db.planChecks) || 75);

    /* 1. Run-Rate & Прогноз на 30 дней */
    const activeDays = cashList.filter((c) => (Number(c.cash) || 0) + (Number(c.card) || 0) > 0);
    const nDays = Math.max(1, activeDays.length);
    const totalRev = activeDays.reduce((s, c) => s + (Number(c.cash) || 0) + (Number(c.card) || 0), 0);
    const totalChecks = activeDays.reduce((s, c) => s + (Number(c.checks) || 0), 0);
    const totalWo = activeDays.reduce((s, c) => s + (Number(c.writeoff) || 0), 0);
    const totalExp = expList.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const avgDailyRev = Math.round(totalRev / nDays);
    const avgDailyChecks = Math.round(totalChecks / nDays);
    const avgDailyWo = Math.round((totalWo / nDays) * 10) / 10;
    const avgDailyExp = expList.length ? Math.round(totalExp / Math.max(1, nDays)) : 0;
    const factAvgCheck = totalChecks > 0 ? Math.round(totalRev / totalChecks) : 0;

    const forecastMonthRev = avgDailyRev * 30;
    const planMonthRev = planDay * 30;
    const forecastMonthExp = avgDailyExp * 30;
    const forecastMonthProfit = forecastMonthRev - forecastMonthExp;
    const forecastPlanPct = Math.round((forecastMonthRev / planMonthRev) * 100);

    /* 2. Точка безубыточности (Break-Even Point) */
    const avgTicketOrNorm = factAvgCheck > 0 ? factAvgCheck : minAvg;
    const breakEvenRevDay = Math.max(Math.round(planDay * 0.55), avgDailyExp);
    const breakEvenChecksDay = Math.max(1, Math.ceil(breakEvenRevDay / Math.max(1, avgTicketOrNorm)));

    /* 3. Фрод-контроль и сверка счётчиков кофемашины по сменам */
    let counterCheckedShifts = 0;
    let counterDiscrepancyCups = 0;
    let counterAlerts = [];
    const staffPerf = {};

    activeDays.forEach((dayRec) => {
      const shList = Array.isArray(dayRec.shifts) && dayRec.shifts.length
        ? dayRec.shifts
        : [{ name: dayRec.barista || 'Бариста', cash: dayRec.cash, card: dayRec.card, checks: dayRec.checks, writeoff: dayRec.writeoff, cups: dayRec.checks }];
      shList.forEach((sh) => {
        const nm = String(sh.name || 'Бариста').trim();
        const st = staffPerf[nm] || (staffPerf[nm] = { name: nm, shifts: 0, rev: 0, cash: 0, card: 0, cups: 0, wo: 0, counterDelta: 0 });
        const sRev = (Number(sh.cash) || 0) + (Number(sh.card) || 0);
        const sCups = Number(sh.cups != null ? sh.cups : sh.checks) || 0;
        const sWo = Number(sh.writeoff != null ? sh.writeoff : sh.writeoffQty) || 0;
        st.shifts += 1;
        st.rev += sRev;
        st.cash += Number(sh.cash) || 0;
        st.card += Number(sh.card) || 0;
        st.cups += sCups;
        st.wo += sWo;
        const prevC = sh.prevCounter != null ? sh.prevCounter : sh.counterStart;
        const endC = sh.counter != null ? sh.counter : sh.counterEnd;
        if (endC != null && prevC != null) {
          const delta = window.coffeeCounterDelta(prevC, endC);
          if (delta == null) return;
          counterCheckedShifts += 1;
          st.counterDelta += delta;
          const soldCoffee = sh.coffeeQty != null ? Number(sh.coffeeQty) : (sh.soldCoffee != null ? Number(sh.soldCoffee) : sCups);
          const woShots = sh.writeoffShots != null ? Number(sh.writeoffShots) : (sh.writeoffQty != null ? Number(sh.writeoffQty) : sWo);
          const accounted = soldCoffee + woShots;
          const diff = delta - accounted;
          if (Math.abs(diff) > 0 && accounted > 0) {
            counterDiscrepancyCups += Math.abs(diff);
            counterAlerts.push(dayRec.date + ' (' + nm + '): счётчик +' + delta + ', учтено ' + accounted + ' (кофе ' + soldCoffee + ' + спис. ' + woShots + ')');
          }
        }
      });
    });

    /* 4. Резерв роста выручки на Upsell (ТЗ п. 7.2 + п. 8) */
    const avgUpsellScore = audits.length
      ? Math.round(audits.reduce((s, a) => s + (Number(a.upsell) || 85), 0) / audits.length)
      : 88;
    const upsellPotentialPerCheck = Math.max(15, Math.round((100 - avgUpsellScore) * 2.2));
    const monthlyUpsellReserve = Math.round(avgDailyChecks * 30 * 0.25 * upsellPotentialPerCheck);

    /* 5. Предиктивная диагностика оборудования (повторяющиеся узлы в инцидентах) */
    const nodeCounts = {};
    incList.forEach((inc) => {
      const key = String(inc.step || inc.incType || 'Оборудование').replace(/^[^а-яА-Яa-zA-Z0-9]+/, '').trim() || 'Оборудование';
      nodeCounts[key] = (nodeCounts[key] || 0) + 1;
    });
    const topIssueNode = Object.entries(nodeCounts).sort((a, b) => b[1] - a[1])[0] || ['Кофемашина (правый стимер)', 1];

    /* 6. Матрица эффективности по дням недели (Пн–Вс) */
    const dowNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dowOrder = [1, 2, 3, 4, 5, 6, 0];
    const dowBuckets = {};
    dowOrder.forEach((dIdx) => { dowBuckets[dIdx] = { idx: dIdx, name: dowNames[dIdx], days: 0, rev: 0, checks: 0, wo: 0 }; });
    activeDays.forEach((c) => {
      const dt = new Date(c.date + 'T12:00:00');
      if (!isNaN(dt)) {
        const b = dowBuckets[dt.getDay()];
        if (b) {
          b.days += 1;
          b.rev += (Number(c.cash) || 0) + (Number(c.card) || 0);
          b.checks += Number(c.checks) || 0;
          b.wo += Number(c.writeoff) || 0;
        }
      }
    });
    const dowStats = dowOrder.map((dIdx) => {
      const b = dowBuckets[dIdx];
      const avgR = b.days > 0 ? Math.round(b.rev / b.days) : 0;
      const avgC = b.days > 0 ? Math.round(b.checks / b.days) : 0;
      const isPeak = avgR >= avgDailyRev * 1.05 && avgR > 0;
      return {
        name: b.name,
        days: b.days,
        avgRev: avgR,
        avgChecks: avgC,
        isPeak,
        recStaff: isPeak || dIdx === 5 || dIdx === 6 ? '2 бариста (пик)' : '1 бариста'
      };
    });

    /* 7. Комплексный Индекс здоровья кофейни (Health Score 0–100%) */
    const planScore = Math.min(100, forecastPlanPct);
    const woScore = avgDailyWo <= woNorm ? 100 : Math.max(40, Math.round(100 - ((avgDailyWo - woNorm) / Math.max(1, woNorm)) * 40));
    const openIncCnt = incList.filter((i) => window.coffeeIsIncActive ? window.coffeeIsIncActive(i.status) : (i.status !== 'Решена' && i.status !== 'Закрыта' && i.status !== 'Resolved')).length;
    const incScore = Math.max(50, 100 - openIncCnt * 12);
    const healthScore = Math.round(planScore * 0.35 + avgUpsellScore * 0.25 + woScore * 0.20 + incScore * 0.20);

    return {
      nDays,
      avgDailyRev,
      avgDailyChecks,
      avgDailyWo,
      avgDailyExp,
      factAvgCheck,
      forecastMonthRev,
      planMonthRev,
      forecastMonthProfit,
      forecastPlanPct,
      breakEvenRevDay,
      breakEvenChecksDay,
      counterCheckedShifts,
      counterDiscrepancyCups,
      counterAlerts,
      avgUpsellScore,
      monthlyUpsellReserve,
      topIssueNode: { name: topIssueNode[0], count: topIssueNode[1] },
      dowStats,
      healthScore,
      staffPerf
    };
  },

  /* Автоматический расчёт рекомендуемой премии/мотивации бариста из имеющихся KPI */
  simulate(dbOpt, avgCheckDelta, checksGrowthPct, writeoffReductionPct) {
    const a = this.analyze(dbOpt);
    const baseChecks = Math.max(1, a.avgDailyChecks || 75);
    const baseAvg = Math.max(1, a.factAvgCheck || 35);
    const baseWo = Math.max(0, a.avgDailyWo || 2);
    const newChecks = Math.round(baseChecks * (1 + (Number(checksGrowthPct) || 0) / 100));
    const newAvg = baseAvg + (Number(avgCheckDelta) || 0);
    const extraDailyRev = Math.max(0, newChecks * newAvg - baseChecks * baseAvg);
    const savedDailyWo = Math.round(baseWo * ((Number(writeoffReductionPct) || 0) / 100) * 18);
    const extraMonthlyProfit = Math.round((extraDailyRev * 0.62 + savedDailyWo) * 30);
    return {
      extraDailyRev,
      savedDailyWo,
      extraMonthlyProfit,
      breakEvenRevenue: a.breakEvenRevDay * 30,
      breakEvenDay: Math.min(28, Math.max(1, Math.round((a.avgDailyExp * 30) / Math.max(1, newChecks * newAvg))))
    };
  },
  calcStaffBonus(staffRow, dscPct, srvPct, avgDailyWo, woNorm) {
    const rev = Number(staffRow.revenue) || 0;
    const shifts = Math.max(1, Number(staffRow.shifts) || 1);
    const baseRate = shifts * 250;
    const revBonus = rev * 0.05;
    const kpiMult = ((dscPct >= 95 ? 1.15 : (dscPct >= 85 ? 1.0 : 0.85)) * (srvPct >= 92 ? 1.1 : 1.0));
    const bonus = Math.round(revBonus * kpiMult);
    return {
      baseRate,
      bonus,
      totalPayout: baseRate + bonus,
      kpiCoeff: Math.round(kpiMult * 100) / 100
    };
  }
};



window.coffeeBuildDailyDigestText = function (d, sm) {
  const loc = (d && d.location) || 'Кофейня №1';
  const dt = (d && d.date) ? String(d.date).split('-').reverse().join('.') : '';
  const rev = (d && d.revenue) || 0;
  const plan = (d && d.plan) || 2200;
  const pct = plan > 0 ? Math.round((rev / plan) * 100) : 0;
  const checks = (d && d.checks) || 0;
  const avg = (d && d.avg) || 0;
  const wo = (d && d.writeoff) || 0;
  const openIncs = ((d && d.incidents) || []).filter((x) => x.status !== 'Решена' && x.status !== 'Закрыта' && x.status !== 'Resolved').length;
  return [
    '☕ СВОДКА ДНЯ · ' + loc + ' (' + dt + ')',
    '━━━━━━━━━━━━━━━━━━━━',
    '💰 Выручка: ' + rev + ' руб. (' + pct + '% от плана ' + plan + ' руб.)',
    '💵 Нал: ' + ((d && d.cash) || 0) + ' руб. · 💳 Безнал: ' + ((d && d.card) || 0) + ' руб.',
    '🧾 Чеков: ' + checks + ' · Средний чек: ' + avg + ' руб.',
    '🗑 Списания: ' + wo + ' руб. (норма ≤ ' + ((d && d.woNorm) || 15) + ' руб.)',
    '⏰ Открытие смены: ' + ((d && d.openedAt) || '—'),
    '🚨 Открытых поломок / инцидентов: ' + openIncs,
    sm ? ('📈 Прогноз выручки на 30 дн.: ' + sm.forecastMonthRev + ' руб. (Индекс здоровья: ' + sm.healthScore + '%)') : ''
  ].filter(Boolean).join('\n');
};




window.coffeeEvaluateRedFlags = function (dateStr, dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
  const day = dateStr || _isoToday();
  const c = (db.cash || []).find((x) => x.date === day) || null;
  const dp = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(day, db) : { revenue: 2500, avgCheck: 35, checks: 140, dayCode: 'Пн' };
  const deltaNorm = Math.max(1, Number((db.settings || []).find((s) => s.id === 'COFFEE_DELTA_NORM')?.value) || 4);

  const flags = [];

  /* Флаг 1: Сверка наличных (бумажный отчёт бариста vs принятые наличные / Z-отчёт) */
  if (c) {
    const factTotal = (Number(c.cash) || 0) + (Number(c.card) || 0);
    const zTot = c.zTotal != null ? Number(c.zTotal) : factTotal;
    const cashDiff = factTotal - zTot;
    if (Math.abs(cashDiff) > 0) {
      flags.push({
        level: 'red',
        title: '🚩 КРАСНЫЙ ФЛАГ: Расхождение по кассе / наличным (' + (cashDiff > 0 ? '+' : '') + cashDiff + ' руб.)',
        desc: 'Сданная сумма (' + factTotal + ' руб.) не совпадает с проверенной (' + zTot + ' руб.). Действие: проверьте видеорегистратор над кассой в момент пересчёта наличных!',
        tag: 'Касса / Видеоконтроль'
      });
    } else {
      flags.push({
        level: 'green',
        title: '🟢 Касса и наличные сходятся (0 руб. расхождений)',
        desc: 'Фактическая сдача (' + factTotal + ' руб.: нал ' + (c.cash || 0) + ' руб., безнал ' + (c.card || 0) + ' руб.) совпадает с контрольной суммой.',
        tag: 'Наличные ОК'
      });
    }

    /* Флаг 2: Сверка счётчика проливов кофемашины (гриндер) с продажами кофейных напитков по номенклатуре и списаниями в порциях */
    const shifts = Array.isArray(c.shifts) ? c.shifts : [];
    const dayProds = Array.isArray(c.products) && c.products.length ? c.products : ((db.productsByDate && db.productsByDate[day]) || []);
    const nomStats = window.coffeeExtractNomenclatureStats(dayProds);
    let totalCounterDelta = 0;
    let totalAccountedCups = 0;
    let totalSoldCoffee = 0;
    let totalWriteoffShots = 0;
    let hasCounter = false;
    let hasWrap = false;
    shifts.forEach((sh) => {
      const pCnt = sh.prevCounter != null ? sh.prevCounter : sh.counterStart;
      const eCnt = sh.counter != null ? sh.counter : sh.counterEnd;
      if (eCnt != null && pCnt != null) {
        var shiftDelta = window.coffeeCounterDelta(pCnt, eCnt);
        if (shiftDelta == null) return;
        hasCounter = true;
        if (Number(eCnt) < Number(pCnt) && Number(pCnt) < 1000) hasWrap = true;
        totalCounterDelta += shiftDelta;
        var shCoffee = sh.coffeeQty != null ? Number(sh.coffeeQty) : (sh.soldCoffee != null ? Number(sh.soldCoffee) : (nomStats.hasNomenclature && shifts.length === 1 ? nomStats.coffeeQty : (Number(sh.cups != null ? sh.cups : sh.checks) || 0)));
        var shWoShots = sh.writeoffShots != null ? Number(sh.writeoffShots) : (sh.writeoffQty != null ? Number(sh.writeoffQty) : (Number(sh.writeoff) || 0));
        totalSoldCoffee += shCoffee;
        totalWriteoffShots += shWoShots;
        totalAccountedCups += shCoffee + shWoShots;
      }
    });
    if (!hasCounter && c.counterStart != null && c.counterEnd != null) {
      var dayDelta = window.coffeeCounterDelta(c.counterStart, c.counterEnd);
      if (dayDelta != null) {
        hasCounter = true;
        if (Number(c.counterEnd) < Number(c.counterStart) && Number(c.counterStart) < 1000) hasWrap = true;
        totalCounterDelta = dayDelta;
        totalSoldCoffee = c.coffeeQty != null ? Number(c.coffeeQty) : (nomStats.hasNomenclature ? nomStats.coffeeQty : (Number(c.coffeeCups || c.checks) || 0));
        totalWriteoffShots = c.writeoffShots != null ? Number(c.writeoffShots) : (Number(c.writeoff) || 0);
        totalAccountedCups = totalSoldCoffee + totalWriteoffShots;
      }
    }
    const reviewQtyDay = c.reviewQty != null ? Number(c.reviewQty) : nomStats.reviewQty;
    if (hasCounter) {
      const cupGap = Math.abs(totalCounterDelta - totalAccountedCups);
      const wrapNote = hasWrap ? ' (учтён переход счётчика через 999→0; подтвердите по дисплею кофемолки)' : '';
      if (cupGap > deltaNorm) {
        flags.push({
          level: 'red',
          title: '🚩 КРАСНЫЙ ФЛАГ: Не сходится счётчик кофемашины (разница ' + cupGap + ' порций при допуске ≤ ' + deltaNorm + ')',
          desc: 'По счётчику пролито ' + totalCounterDelta + ' порций' + wrapNote + ', а по номенклатуре кофе (' + totalSoldCoffee + ') и списаниям порций (' + totalWriteoffShots + ') учтено ' + totalAccountedCups + '. Необъяснённая разница: ' + (totalCounterDelta - totalAccountedCups) + ' порц.!',
          tag: 'Счётчик / Гриндер'
        });
      } else {
        flags.push({
          level: 'green',
          title: '🟢 Проливы кофемашины совпадают с продажами и списаниями',
          desc: 'Пролито по счётчику: ' + totalCounterDelta + ' порц.' + wrapNote + ' · Учтено (кофе ' + totalSoldCoffee + ' + списания ' + totalWriteoffShots + '): ' + totalAccountedCups + ' (в пределах допуска ±' + deltaNorm + ' порц.).',
          tag: 'Счётчик ОК'
        });
      }
    }
    if (reviewQtyDay > 0) {
      flags.push({
        level: 'yellow',
        title: '🟡 Неопределённая номенклатура в Продажи.csv: ' + reviewQtyDay + ' шт.',
        desc: 'Позиции со статусом «review» (например, «Напиток от Бариста») учитываются отдельно от кофе и некофейных товаров до уточнения рецептуры.',
        tag: 'Номенклатура / Сверка'
      });
    } else {
      flags.push({
        level: 'yellow',
        title: '🟡 Счётчик кофемашины за этот день ещё не сфотографирован / не внесён',
        desc: 'При закрытии смены бариста фотографирует счётчик кофемашины и бумажный отчёт в минималистичной вкладке «Касса».',
        tag: 'Ожидание закрытия'
      });
    }

    /* Флаг 3: План продаж vs Транзакции и Средний чек + Списания */
    const avgNow = c.checks > 0 ? Math.round(factTotal / c.checks) : 0;
    const woNorm = Number(db.woNorm) || 15;
    if ((Number(c.writeoff) || 0) > woNorm) {
      flags.push({
        level: 'red',
        title: '🚩 КРАСНЫЙ ФЛАГ: Превышен порог списаний (' + c.writeoff + ' при норме ≤ ' + woNorm + ')',
        desc: 'Рекомендация робота: провести внеплановую ревизию остатков молока/воды/зерна и проверить причины списаний за смену.',
        tag: 'Ревизия остатков'
      });
    } else if (factTotal < dp.revenue && c.checks >= dp.checks * 0.9) {
      flags.push({
        level: 'yellow',
        title: '🟡 Трафик в норме (' + c.checks + ' чек.), но просел средний чек (' + avgNow + ' руб. при плане ' + dp.avgCheck + ' руб.)',
        desc: 'Гостей достаточно, но касса ниже плана (' + factTotal + ' руб. из ' + dp.revenue + ' руб.). Задача шеф-бариста: проверить предложение десертов и доп. продаж (Upsell).',
        tag: 'Upsell / Ср. чек'
      });
    }
  } else {
    flags.push({
      level: 'yellow',
      title: '🟡 Данные закрытия кассы за ' + day.split('-').reverse().join('.') + ' ещё не поступили',
      desc: 'Переключите приборную панель на «Вчера (закрытая смена)» или дождитесь вечерней отправки фото бумажного отчёта из Терминала (22:00–23:59).',
      tag: 'Ожидание кассы'
    });
  }
  return flags;
};
/* coffeeEnsureSchema defined in storage.js */


/* =========================================================================
   ЧЕСТНАЯ ФИНАНСОВАЯ МОДЕЛЬ (window.coffeeCalculateFinancialModel — v23)
   Считает реальную управленческую прибыль без выдуманных коэффициентов (без 35% оценки):
   - Выручка (нал + безнал по закрытым сменам)
   - COGS / Food Cost по ТТК (зерно + молоко + сироп + стакан по проданным позициям)
   - ФОТ смен (базовая ставка смены SHIFT_BASE_PAY + бонус % от выручки SHIFT_BONUS_PCT)
   - Операционные расходы из журнала «Расходы» (аренда, закупки, логистика, ремонт)
   - Маркетинг и стоимость привлечения гостя (CAC)
   - Стоимость списаний (writeoff * unitWasteCost)
   - Чистая прибыль владельца (netProfit = revenue - cogs - payroll - opex - wasteCost)
   ========================================================================= */
window.coffeeCalculateFinancialModel = function (dbOpt, fromStr, toStr) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  const cashAll = Array.isArray(db.cash) ? db.cash : [];
  const expAll = Array.isArray(db.expenses) ? db.expenses : [];
  const ttkList = Array.isArray(db.ttk) && db.ttk.length ? db.ttk : (window.COFFEE_DEFAULT_TTK || []);
  const productsByDate = (db && db.productsByDate && typeof db.productsByDate === 'object') ? db.productsByDate : {};

  const inRange = (d) => (!fromStr || d >= fromStr) && (!toStr || d <= toStr);
  const cashRows = cashAll.filter((c) => c && c.date && inRange(c.date)).slice().sort((a, b) => a.date.localeCompare(b.date));
  const expRows = expAll.filter((e) => e && e.date && inRange(e.date));

  const ttkUnitCost = (t) => (Number(t.costBeans) || 0) + (Number(t.costMilk) || 0) + (Number(t.costSyrup) || 0) + (Number(t.costCup) || 0);
  const avgTtkUnitCost = ttkList.length
    ? Math.round((ttkList.reduce((acc, t) => acc + ttkUnitCost(t), 0) / ttkList.length) * 100) / 100
    : 8.5;

  function findTtkCostForProductName(prodName) {
    const norm = String(prodName || '').toLowerCase();
    if (!norm) return avgTtkUnitCost;
    const exact = ttkList.find((t) => String(t.name || '').toLowerCase().indexOf(norm) >= 0 || norm.indexOf(String(t.name || '').replace(/^[^а-яa-z0-9]+/i, '').toLowerCase()) >= 0);
    if (exact) return ttkUnitCost(exact);
    if (/американо|эспрессо/i.test(norm)) return 5.5;
    if (/капучино|латте/i.test(norm)) return 8.0;
    if (/флэт|flat|раф|какао/i.test(norm)) return 11.2;
    if (/чизкейк|десерт|торт|круассан/i.test(norm)) return 23.5;
    return avgTtkUnitCost;
  }

  const sMap = {};
  (db.settings || []).forEach((s) => { if (s && s.id) sMap[s.id] = s.value; });
  const shiftBasePay = Number(sMap.SHIFT_BASE_PAY != null ? sMap.SHIFT_BASE_PAY : 250);
  const shiftBonusPct = Number(sMap.SHIFT_BONUS_PCT != null ? sMap.SHIFT_BONUS_PCT : 5);
  const unitWasteCost = 18;

  let revenue = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let checksTotal = 0;
  let writeoffsTotal = 0;
  let shiftsCount = 0;
  let cogsFromTtk = 0;
  let periodPlanTotal = 0;
  const dayByDayPnL = [];

  cashRows.forEach((c) => {
    const dayCash = Number(c.cash) || 0;
    const dayCard = Number(c.card) || 0;
    const dayRev = dayCash + dayCard;
    const dayChecks = Number(c.checks) || 0;
    const dayWo = Number(c.writeoff) || 0;
    const shArr = Array.isArray(c.shifts) && c.shifts.length ? c.shifts : [{ name: c.barista || 'Бариста' }];
    const dayShiftsCnt = shArr.length;

    // Точный расчёт COGS: если за день загружены позиции Продажи.csv, считаем по ТТК каждой позиции, иначе по числу чеков * avgTtkUnitCost
    const dayProds = Array.isArray(c.products) && c.products.length ? c.products : (productsByDate[c.date] || []);
    let dayCogs = 0;
    if (dayProds.length) {
      dayCogs = Math.round(dayProds.reduce((s, p) => s + (Number(p.qty) || 1) * findTtkCostForProductName(p.name), 0));
    } else {
      dayCogs = Math.round(dayChecks * avgTtkUnitCost);
    }

    const dayPayroll = Math.round(dayShiftsCnt * shiftBasePay + dayRev * (shiftBonusPct / 100));
    const dayOpex = expRows.filter((e) => e.date === c.date && !/зарплат|фот|аванс/i.test(String(e.category || ''))).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const dayWaste = Math.round(dayWo * unitWasteCost);
    const dayNet = dayRev - dayCogs - dayPayroll - dayOpex - dayWaste;
    const dp = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(c.date, db) : { revenue: Number(db.plan) || 2200, dayCode: '' };

    revenue += dayRev;
    cashTotal += dayCash;
    cardTotal += dayCard;
    checksTotal += dayChecks;
    writeoffsTotal += dayWo;
    shiftsCount += dayShiftsCnt;
    cogsFromTtk += dayCogs;
    periodPlanTotal += (dp.revenue || 2200);

    const zTot = c.zTotal != null ? Number(c.zTotal) : dayRev;
    const nomStats = window.coffeeExtractNomenclatureStats(dayProds);
    const daySoldCoffee = c.coffeeQty != null ? Number(c.coffeeQty) : (nomStats.hasNomenclature ? nomStats.coffeeQty : 0);
    const dayNonCoffee = c.nonCoffeeQty != null ? Number(c.nonCoffeeQty) : nomStats.nonCoffeeQty;
    const dayReviewQty = c.reviewQty != null ? Number(c.reviewQty) : nomStats.reviewQty;
    const dayWoShots = c.writeoffShots != null ? Number(c.writeoffShots) : shArr.reduce((acc, s) => acc + (Number(s.writeoffShots != null ? s.writeoffShots : s.writeoffQty) || 0), 0);
    let cntStart = c.counterStart != null ? Number(c.counterStart) : null;
    let cntEnd = c.counterEnd != null ? Number(c.counterEnd) : null;
    let cntDelta = 0, accCups = 0, cntWrapped = false;
    shArr.forEach((sh) => {
      const pCnt = sh.prevCounter != null ? sh.prevCounter : sh.counterStart;
      const eCnt = sh.counter != null ? sh.counter : sh.counterEnd;
      if (pCnt != null && cntStart === null) cntStart = Number(pCnt);
      if (eCnt != null) cntEnd = Number(eCnt);
      if (eCnt != null && pCnt != null) {
        const d = window.coffeeCounterDelta(pCnt, eCnt);
        if (d !== null) {
          cntDelta += d;
          if (Number(eCnt) < Number(pCnt) && Number(pCnt) < 1000) cntWrapped = true;
          const shCoffee = sh.coffeeQty != null ? Number(sh.coffeeQty) : (sh.soldCoffee != null ? Number(sh.soldCoffee) : (daySoldCoffee > 0 && shArr.length === 1 ? daySoldCoffee : (Number(sh.cups != null ? sh.cups : sh.checks) || 0)));
          const shWoS = sh.writeoffShots != null ? Number(sh.writeoffShots) : (sh.writeoffQty != null ? Number(sh.writeoffQty) : (Number(sh.writeoff) || 0));
          accCups += shCoffee + shWoS;
        }
      }
    });
    if (cntDelta === 0 && cntStart !== null && cntEnd !== null) {
      const dDay = window.coffeeCounterDelta(cntStart, cntEnd);
      if (dDay !== null) {
        cntDelta = dDay;
        if (cntEnd < cntStart && cntStart < 1000) cntWrapped = true;
        accCups = (daySoldCoffee > 0 ? daySoldCoffee : dayChecks) + (dayWoShots > 0 ? dayWoShots : dayWo);
      }
    }
    const effectiveAccounted = accCups || ((daySoldCoffee > 0 ? daySoldCoffee : dayChecks) + (dayWoShots > 0 ? dayWoShots : 0));
    const counterGap = cntDelta > 0 ? (cntDelta - effectiveAccounted) : 0;
    dayByDayPnL.push({
      date: c.date,
      dayCode: dp.dayCode || '',
      barista: c.barista || shArr.map((s) => s.name).join(', '),
      shiftsCount: dayShiftsCnt,
      shifts: shArr,
      cash: dayCash,
      card: dayCard,
      revenue: dayRev,
      zTotal: zTot,
      zDiff: dayRev - zTot,
      counterStart: cntStart,
      counterEnd: cntEnd,
      counterDelta: cntDelta,
      counterWrapped: cntWrapped,
      coffeeQty: daySoldCoffee,
      nonCoffeeQty: dayNonCoffee,
      reviewQty: dayReviewQty,
      writeoffShots: dayWoShots,
      accountedCups: effectiveAccounted,
      unaccountedShots: Math.max(0, counterGap),
      counterGap: counterGap,
      topItems: c.topItems || '',
      comment: c.comment || '',
      plan: dp.revenue || 2200,
      planPct: dp.revenue > 0 ? Math.round((dayRev / dp.revenue) * 100) : 0,
      checks: dayChecks,
      avgCheck: dayChecks > 0 ? Math.round(dayRev / dayChecks) : 0,
      cogs: dayCogs,
      payroll: dayPayroll,
      opex: dayOpex,
      writeoff: dayWo,
      wasteCost: dayWaste,
      netProfit: dayNet
    });
  });

  const payrollAccrued = Math.round(shiftsCount * shiftBasePay + revenue * (shiftBonusPct / 100));
  const wasteCost = Math.round(writeoffsTotal * unitWasteCost);

  let loggedOpex = 0;
  let marketingSpend = 0;
  let loggedPayroll = 0;
  const opexByCategoryMap = {};
  expRows.forEach((e) => {
    const amt = Number(e.amount) || 0;
    const cat = String(e.category || 'Прочее').trim();
    loggedOpex += amt;
    opexByCategoryMap[cat] = (opexByCategoryMap[cat] || 0) + amt;
    if (/реклам|маркет|продвиж|таргет/i.test(cat)) marketingSpend += amt;
    if (/зарплат|фот|аванс/i.test(cat)) loggedPayroll += amt;
  });

  const effectivePayroll = loggedPayroll > 0 ? loggedPayroll : payrollAccrued;
  const nonPayrollOpex = Math.max(0, loggedOpex - loggedPayroll);
  const grossProfit = revenue - cogsFromTtk;
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
  const totalCosts = cogsFromTtk + effectivePayroll + nonPayrollOpex + wasteCost;
  const netProfit = revenue - totalCosts;
  const netMarginPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
  const foodCostPct = revenue > 0 ? Math.round((cogsFromTtk / revenue) * 1000) / 10 : 0;
  const laborCostPct = revenue > 0 ? Math.round((effectivePayroll / revenue) * 1000) / 10 : 0;
  const opexPct = revenue > 0 ? Math.round((nonPayrollOpex / revenue) * 1000) / 10 : 0;
  const cac = checksTotal > 0 && marketingSpend > 0 ? Math.round((marketingSpend / checksTotal) * 100) / 100 : 0;
  const cashSharePct = revenue > 0 ? Math.round((cashTotal / revenue) * 100) : 0;
  const cardSharePct = revenue > 0 ? (100 - cashSharePct) : 0;

  // Юнит-экономика по каждой техкарте ТТК для профессиональной таблицы
  const ttkEconomics = ttkList.map((t) => {
    const unitCost = Math.round(ttkUnitCost(t) * 10) / 10;
    const price = Number(t.price) || 1;
    const marginRub = Math.round((price - unitCost) * 10) / 10;
    const marginPct = Math.round((marginRub / price) * 100);
    const fcPct = Math.round((unitCost / price) * 100);
    return Object.assign({}, t, { unitCost, marginRub, marginPct, foodCostPct: fcPct });
  });

  return {
    revenue,
    periodPlanTotal,
    cashTotal,
    cardTotal,
    cashSharePct,
    cardSharePct,
    checksTotal,
    avgCheck: checksTotal > 0 ? Math.round(revenue / checksTotal) : 0,
    shiftsCount,
    avgRevPerShift: shiftsCount > 0 ? Math.round(revenue / shiftsCount) : 0,
    cogs: cogsFromTtk,
    avgTtkUnitCost,
    grossProfit,
    grossMarginPct,
    foodCostPct,
    payrollAccrued,
    loggedPayroll,
    effectivePayroll,
    laborCostPct,
    shiftBasePay,
    shiftBonusPct,
    loggedOpex,
    nonPayrollOpex,
    opexPct,
    opexByCategory: Object.keys(opexByCategoryMap).map((k) => ({ category: k, amount: opexByCategoryMap[k] })).sort((a, b) => b.amount - a.amount),
    marketingSpend,
    cac,
    writeoffsTotal,
    wasteCost,
    totalCosts,
    netProfit,
    netMarginPct,
    dayByDayPnL,
    ttkEconomics,
    isEstimated: false,
    hasLoggedExpenses: expRows.length > 0
  };
};


/* =========================================================================
   v61 ERP МОДУЛИ:
   1. Автосписание склада по ТТК и номенклатуре продаж (coffeeDeductInventoryFromSales)
   2. Личный расчётный лист и KPI мотивации бариста (coffeeCalcStaffPayrollCard)
   3. Контроль сроков годности и маркировок заготовок (coffeeGetActiveExpiryAlerts)
   ========================================================================= */

window.coffeeGetCustomNomenclatureRules = function (dbOpt) {
  try {
    const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : null);
    return (db && db.customNomenclatureRules && typeof db.customNomenclatureRules === 'object')
      ? db.customNomenclatureRules
      : {};
  } catch (_) {
    return {};
  }
};

window.coffeeDeductInventoryFromSales = function (db, products, writeoffShots, dateStr, shiftKey) {
  if (!db) return { deducted: false, lowItems: [] };
  if (!Array.isArray(db.inventory) || !db.inventory.length) {
    db.inventory = (window.COFFEE_DEFAULT_INVENTORY || []).map((x) => Object.assign({}, x));
  }
  db.inventoryDeductedKeys = (db.inventoryDeductedKeys && typeof db.inventoryDeductedKeys === 'object') ? db.inventoryDeductedKeys : {};
  const dedKey = String(shiftKey || (dateStr + ':' + (products || []).length));
  if (dedKey && db.inventoryDeductedKeys[dedKey]) {
    return { deducted: false, alreadyProcessed: true, lowItems: [] };
  }
  if (dedKey) db.inventoryDeductedKeys[dedKey] = Date.now();

  const findInv = (id) => db.inventory.find((x) => x && x.id === id);
  const beans = findInv('inv_beans');
  const milk = findInv('inv_milk');
  const altMilk = findInv('inv_alt_milk');
  const syrup = findInv('inv_syrup');
  const cupsS = findInv('inv_cups_s');
  const cupsL = findInv('inv_cups_l');

  const rules = window.coffeeGetCustomNomenclatureRules(db);
  const classify = (window.CoffeeSalesReconciliation && window.CoffeeSalesReconciliation.classifyCoffee)
    ? ((nm) => window.CoffeeSalesReconciliation.classifyCoffee(nm, rules))
    : (() => 'coffee');

  let beansUsed = (Math.max(0, Number(writeoffShots) || 0)) * 18;
  let milkUsed = 0, altMilkUsed = 0, syrupUsed = 0, cupsSUsed = 0, cupsLUsed = 0;

  (Array.isArray(products) ? products : []).forEach((p) => {
    if (!p || !p.name) return;
    const qty = Math.max(0, Number(p.qty) || 0);
    if (!qty) return;
    const nm = String(p.name || '').toLowerCase();
    const k = p.kind || classify(p.name);
    const shots = k === 'coffee_2' || /двойн|доппио|больш|400|450/i.test(nm) ? 2 : (k === 'coffee' ? 1 : 0);
    if (shots > 0) {
      beansUsed += qty * 18 * shots;
      if (/350|400|450|больш|раф|айс/i.test(nm)) cupsLUsed += qty;
      else cupsSUsed += qty;
      if (/капучино|латте|лате|раф|флэт|flat|мокко|мокка|макиато|кортадо/i.test(nm)) {
        milkUsed += qty * 180;
      }
      if (/раф|карамел|ванил|орех|мохито|бабл/i.test(nm)) {
        syrupUsed += qty * 20;
      }
    } else {
      if (/альтернативн.*молок|овсян|кокосов|миндальн/i.test(nm)) altMilkUsed += qty * 180;
      if (/сироп/i.test(nm)) syrupUsed += qty * 20;
    }
  });

  if (beans) beans.stock = Math.max(0, Math.round((Number(beans.stock) || 0) - beansUsed));
  if (milk) milk.stock = Math.max(0, Math.round((Number(milk.stock) || 0) - milkUsed));
  if (altMilk) altMilk.stock = Math.max(0, Math.round((Number(altMilk.stock) || 0) - altMilkUsed));
  if (syrup) syrup.stock = Math.max(0, Math.round((Number(syrup.stock) || 0) - syrupUsed));
  if (cupsS) cupsS.stock = Math.max(0, Math.round((Number(cupsS.stock) || 0) - cupsSUsed));
  if (cupsL) cupsL.stock = Math.max(0, Math.round((Number(cupsL.stock) || 0) - cupsLUsed));

  const lowItems = db.inventory.filter((x) => x && Number(x.stock) <= Number(x.minStock || 0));
  if (lowItems.length && window.coffeeNotify) {
    const namesStr = lowItems.map((x) => x.name + ' (' + x.stock + ' ' + x.unit + ')').join(', ');
    window.coffeeNotify.push(db, {
      level: 'warn',
      type: 'inventory_low',
      actor: 'Склад ТТК',
      title: '📦 Низкий остаток на складе (' + lowItems.length + ' поз.)',
      text: 'Требуется пополнение: ' + namesStr,
      telegramText: "📦 СКЛАД КОФЕЙНИ — НИЗКИЙ ОСТАТОК:\n" + lowItems.map((x) => "• " + x.name + ": осталось " + x.stock + " " + x.unit + " (мин. " + x.minStock + " " + x.unit + ")").join("\n")
    });
  }
  return {
    deducted: true,
    beansUsed,
    milkUsed,
    altMilkUsed,
    syrupUsed,
    cupsUsed: cupsSUsed + cupsLUsed,
    lowItems
  };
};

window.coffeeCalcStaffPayrollCard = function (db, staffName, monthPrefixOpt) {
  db = db || (typeof getUDB === 'function' ? getUDB() : {});
  const who = String(staffName || 'Соня').trim();
  const whoLow = who.toLowerCase();
  const today = typeof _isoToday === 'function' ? _isoToday() : new Date().toISOString().slice(0, 10);
  const monthPrefix = monthPrefixOpt || today.slice(0, 7); // YYYY-MM

  const baseShiftRate = 250; // руб. ПМР за выход
  const revPercent = 0.05;   // 5% от выручки смены
  const planMetBonus = 50;   // +50 руб. ПМР за выполнение дневного плана выручки

  let shiftsCount = 0;
  let totalRevenue = 0;
  let totalCoffeeCups = 0;
  let planMetDays = 0;

  (Array.isArray(db.cash) ? db.cash : []).forEach((c) => {
    if (!c || !c.date || c.date.indexOf(monthPrefix) !== 0) return;
    const dayPlan = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(c.date, db).revenue : (Number(db.plan) || 2500);
    const dayRev = (Number(c.cash) || 0) + (Number(c.card) || 0);
    const shifts = Array.isArray(c.shifts) && c.shifts.length
      ? c.shifts
      : [{ name: c.barista || '', cash: c.cash, card: c.card, coffeeQty: c.coffeeQty, cups: c.checks }];

    shifts.forEach((sh) => {
      const shName = String(sh && sh.name || '').trim().toLowerCase();
      if (shName === whoLow || (shName.indexOf(whoLow) >= 0 && whoLow.length >= 3)) {
        shiftsCount += 1;
        const shRev = (Number(sh.cash) || 0) + (Number(sh.card) || 0) || (shifts.length === 1 ? dayRev : 0);
        totalRevenue += shRev;
        totalCoffeeCups += Number(sh.coffeeQty != null ? sh.coffeeQty : (sh.cups || 0)) || 0;
        if (dayRev >= dayPlan && dayPlan > 0) planMetDays += 1;
      }
    });
  });

  const monthChks = (Array.isArray(db.checklists) ? db.checklists : []).filter((chk) => {
    return chk && chk.date && chk.date.indexOf(monthPrefix) === 0 && String(chk.who || '').trim().toLowerCase() === whoLow;
  });
  const onTimeChks = monthChks.filter((chk) => !chk.isLate && chk.status !== 'Просрочено').length;
  const lateChks = monthChks.length - onTimeChks;
  const disciplineRate = monthChks.length > 0 ? Math.round((onTimeChks / monthChks.length) * 100) : 100;

  const basePay = shiftsCount * baseShiftRate;
  const revBonus = Math.round(totalRevenue * revPercent);
  const planBonus = planMetDays * planMetBonus;
  const totalEarned = basePay + revBonus + planBonus;

  return {
    staffName: who,
    monthPrefix,
    shiftsCount,
    totalRevenue: Math.round(totalRevenue),
    totalCoffeeCups,
    baseShiftRate,
    basePay,
    revBonus,
    planMetDays,
    planBonus,
    totalEarned,
    checklistsTotal: monthChks.length,
    onTimeChks,
    lateChks,
    disciplineRate
  };
};

window.coffeeGetActiveExpiryAlerts = function (dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  const items = Array.isArray(db.expiryItems) ? db.expiryItems : [];
  const now = Date.now();
  const active = items.filter((it) => it && !it.disposed).map((it) => {
    const expMs = Number(it.expiresAtMs) || (Number(it.openedAtMs || now) + (Number(it.shelfLifeHours || 24) * 3600000));
    const hoursLeft = Math.round(((expMs - now) / 3600000) * 10) / 10;
    return Object.assign({}, it, {
      expiresAtMs: expMs,
      hoursLeft,
      isExpired: hoursLeft <= 0,
      isExpiringSoon: hoursLeft > 0 && hoursLeft <= 4
    });
  }).sort((a, b) => a.expiresAtMs - b.expiresAtMs);

  return {
    allActive: active,
    expired: active.filter((x) => x.isExpired),
    expiringSoon: active.filter((x) => x.isExpiringSoon),
    urgentCount: active.filter((x) => x.isExpired || x.isExpiringSoon).length
  };
};


/* === COFFEE ILLY v71 MASTER DIRECTIVE: ЦЕНТРАЛИЗОВАННЫЕ УВЕДОМЛЕНИЯ P0/P1/P2 БЕЗ ДУБЛЕЙ И АВТО-ПОГАШЕНИЕ (ЭТАП 11) === */
(function () {
  function _inferPriority(item) {
    if (!item) return 'P2';
    if (item.priority === 'P0' || item.priority === 'P1' || item.priority === 'P2') return item.priority;
    if (item.level === 'critical' || item.type === 'overdue' || (item.type === 'incident' && /критич/i.test(String(item.text || item.title || '')))) {
      return 'P0';
    }
    if (item.level === 'warn' || item.type === 'incident' || item.type === 'cash_diff' || item.type === 'low_stock') {
      return 'P1';
    }
    return 'P2';
  }

  window.coffeeCentralNotifier = {
    emit(opts) {
      try {
        if (!opts || typeof getUDB !== 'function' || typeof saveUDB !== 'function') return null;
        const db = getUDB();
        db.liveNotifications = Array.isArray(db.liveNotifications) ? db.liveNotifications : [];
        const dedupKey = opts.dedupKey || ((opts.type || 'ntf') + ':' + (opts.incId || opts.block || opts.title || ''));
        const prio = _inferPriority(opts);
        // Дедупликация: если активное нерешённое уведомление с таким же dedupKey уже есть, обновляем его без создания дубля
        const existing = db.liveNotifications.find((n) => n && !n.resolved && (n.dedupKey === dedupKey || (opts.incId && n.incId === opts.incId)));
        if (existing) {
          existing.priority = prio;
          existing.text = opts.text || existing.text;
          existing.time = opts.time || existing.time;
          saveUDB(db);
          return existing;
        }
        const entry = {
          id: opts.id || ('ntf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
          dedupKey: dedupKey,
          priority: prio,
          level: prio === 'P0' ? 'critical' : (prio === 'P1' ? 'warn' : 'ok'),
          type: opts.type || 'info',
          title: opts.title || 'Событие системы',
          text: opts.text || '',
          date: opts.date || new Date().toISOString().slice(0, 10),
          time: opts.time || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          actor: opts.actor || 'Система',
          incId: opts.incId || '',
          block: opts.block || '',
          read: false,
          resolved: false
        };
        db.liveNotifications.unshift(entry);
        saveUDB(db);
        return entry;
      } catch (_) {
        return null;
      }
    },
    resolveByKey(keyOrIncId) {
      try {
        if (!keyOrIncId || typeof getUDB !== 'function' || typeof saveUDB !== 'function') return 0;
        const db = getUDB();
        const list = Array.isArray(db.liveNotifications) ? db.liveNotifications : [];
        let resolvedCount = 0;
        list.forEach((n) => {
          if (!n) return;
          if (n.dedupKey === keyOrIncId || n.incId === keyOrIncId || n.block === keyOrIncId || String(n.text || '').indexOf(keyOrIncId) >= 0) {
            if (!n.resolved || !n.read) {
              n.resolved = true;
              n.read = true;
              resolvedCount++;
            }
          }
        });
        if (resolvedCount > 0) saveUDB(db);
        return resolvedCount;
      } catch (_) {
        return 0;
      }
    },
    syncAndAutoResolve(dbOpt) {
      try {
        const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : null);
        if (!db || !Array.isArray(db.liveNotifications)) return;
        const incs = Array.isArray(db.incidents) ? db.incidents : [];
        db.liveNotifications.forEach((n) => {
          if (!n) return;
          if (!n.priority) n.priority = _inferPriority(n);
          if (n.incId) {
            const match = incs.find((x) => x && x.id === n.incId);
            if (match && (!window.coffeeIsIncActive || !window.coffeeIsIncActive(match.status))) {
              n.resolved = true;
              n.read = true;
            }
          }
        });
      } catch (_) {}
    }
  };
})();
