/* =========================================================================
   МОДУЛЬ АНАЛИТИКИ, ТАЙМЛАЙНА И КОНТРОЛЯ (js/analytics.js — v21 Enterprise)
   Единые функции без дублирования и переопределений:
   - Таймлайн чек-листов и контроль просрочек (coffeeGetBlockWindow, coffeeEnforceOverdueChecklists)
   - Планы выручки, среднего чека и транзакций по дням недели Пн–Вс (coffeeGetDayPlan)
   - Проверка персональных PIN сотрудников через SHA-256 + Rate-Limiting 5 попыток (coffeeVerifyStaffPin)
   - Детектор «Красных флагов» робота (coffeeEvaluateRedFlags) и P&L-движок (coffeeSmartEngine)
   ========================================================================= */
window.coffeeNormIncStatus = function (st) {
  const s = String(st || '').trim();
  if (!s || s === 'Open' || s === 'Открыта' || s === 'Новая проблема') return 'Новая проблема';
  if (s === 'Принята в работу' || s === 'InProgress') return 'Принята в работу';
  if (s === 'Ожидает решения' || s === 'Pending') return 'Ожидает решения';
  if (s === 'Resolved' || s === 'Решена' || s === 'Решено') return 'Решена';
  if (s === 'Closed' || s === 'Закрыта') return 'Закрыта';
  return 'Новая проблема';
};

window.coffeeIsIncActive = function (st) {
  const norm = window.coffeeNormIncStatus(st);
  return norm !== 'Решена' && norm !== 'Закрыта';
};

window.coffeeIncStatusBadge = function (st) {
  const norm = window.coffeeNormIncStatus(st);
  const cls = (norm === 'Решена' || norm === 'Закрыта') ? 'ok' : (norm === 'Новая проблема' ? 'no' : 'warn');
  return '<span class="tag ' + cls + '">' + norm + '</span>';
};

window.coffeeMakeSampleSvg = function (title, angleLabel, bullets, accentColor) {
  const safeTitle = String(title || 'Стандарт выполнения').replace(/[<>&"']/g, '');
  const safeAngle = String(angleLabel || 'Ракурс 1: Общий план').replace(/[<>&"']/g, '');
  const lines = (bullets || []).slice(0, 3).map((b) => String(b).replace(/[<>&"']/g, '').slice(0, 56));
  const acc = accentColor || '#e0a76a';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#231710"/><stop offset="100%" stop-color="#4b3122"/></linearGradient></defs>' +
      '<rect width="640" height="360" rx="18" fill="url(#bg)"/>' +
      '<rect x="16" y="16" width="608" height="328" rx="14" fill="none" stroke="' + acc + '" stroke-width="2" stroke-dasharray="6 4"/>' +
      '<rect x="32" y="30" width="235" height="28" rx="8" fill="rgba(224,167,106,0.22)"/>' +
      '<text x="44" y="49" fill="' + acc + '" font-family="system-ui,sans-serif" font-size="13" font-weight="700">✓ ФОТООБРАЗЕЦ СТАНДАРТА</text>' +
      '<text x="594" y="49" text-anchor="end" fill="#f6ece2" font-family="system-ui,sans-serif" font-size="13" font-weight="600">' + safeAngle + '</text>' +
      '<text x="32" y="90" fill="#ffffff" font-family="system-ui,sans-serif" font-size="20" font-weight="700">' + safeTitle.slice(0, 44) + '</text>' +
      '<rect x="32" y="110" width="576" height="164" rx="12" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.12)"/>' +
      '<circle cx="90" cy="192" r="34" fill="rgba(76,195,138,0.18)" stroke="#4cc38a" stroke-width="2.5"/>' +
      '<text x="90" y="202" text-anchor="middle" fill="#4cc38a" font-family="system-ui,sans-serif" font-size="26" font-weight="700">✓</text>' +
      '<text x="144" y="146" fill="#e0a76a" font-family="system-ui,sans-serif" font-size="13.5" font-weight="700">КРИТЕРИИ ПРАВИЛЬНОГО ВЫПОЛНЕНИЯ:</text>' +
      '<text x="144" y="176" fill="#f6ece2" font-family="system-ui,sans-serif" font-size="13.5">1. ' + (lines[0] || 'Чистая поверхность без пятен, крошек и разводов') + '</text>' +
      '<text x="144" y="206" fill="#f6ece2" font-family="system-ui,sans-serif" font-size="13.5">2. ' + (lines[1] || 'Все элементы на штатных местах согласно регламенту') + '</text>' +
      '<text x="144" y="236" fill="#f6ece2" font-family="system-ui,sans-serif" font-size="13.5">3. ' + (lines[2] || 'Хорошее освещение и чёткий фокус при съёмке') + '</text>' +
      '<rect x="32" y="290" width="576" height="36" rx="8" fill="rgba(0,0,0,0.45)"/>' +
      '<text x="46" y="313" fill="#c9d6d9" font-family="system-ui,sans-serif" font-size="12.5">Эталонный образец · При отклонении от стандарта нажмите «Обнаружена проблема»</text>' +
    '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};

window.coffeeGetSamplePhotos = function (task) {
  if (!task) return [];
  if (Array.isArray(task.samplePhotos) && task.samplePhotos.length) return task.samplePhotos;
  const rawLines = String(task.instruction || '')
    .split(/\r?\n/)
    .map((s) => s.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean);
  return [
    {
      label: 'Ракурс 1 · Общий вид',
      caption: 'Общий план рабочей зоны / оборудования по стандарту',
      url: window.coffeeMakeSampleSvg(task.title, 'Ракурс 1: Общий план', rawLines.slice(0, 3), '#e0a76a')
    },
    {
      label: 'Ракурс 2 · Детали контроля',
      caption: 'Крупный план узлов контроля (отсутствие подтёков, накипи, чистота поверхностей)',
      url: window.coffeeMakeSampleSvg(task.title, 'Ракурс 2: Крупный план', rawLines.slice(1, 4).length ? rawLines.slice(1, 4) : rawLines, '#4cc38a')
    }
  ];
};

window.coffeeIsBlockCompletedToday = function (block, dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  const today = _isoToday();
  const rec = (db.checklists || []).find((c) => c.date === today && c.block === block);
  let lsDone = false;
  try { lsDone = localStorage.getItem('coffee_illy_done_' + today + '_' + block) === '1'; } catch (_) {}
  return {
    completed: !!rec || lsDone,
    record: rec || null
  };
};


window.coffeeFormatTimeLeft = function (deadlineHm, currentHm) {
  const [dh, dm] = String(deadlineHm || '23:59').split(':').map(Number);
  const [ch, cm] = String(currentHm || '00:00').split(':').map(Number);
  const diff = (dh * 60 + dm) - (ch * 60 + cm);
  if (diff <= 0) return '0 мин';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 ? (h + ' ч ' + String(m).padStart(2, '0') + ' мин') : (m + ' мин');
};

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
    const minAvg = Math.max(1, Number(db.minAvgCheck) || 390);
    const planChecks = Math.max(1, Number(db.planChecks) || 150);

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
    const avgDailyExp = expList.length ? Math.round(totalExp / Math.max(1, nDays)) : Math.round(avgDailyRev * 0.35);
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
        if (sh.counter != null && sh.prevCounter != null && Number(sh.counter) >= Number(sh.prevCounter)) {
          counterCheckedShifts += 1;
          const delta = Number(sh.counter) - Number(sh.prevCounter);
          st.counterDelta += delta;
          const accounted = sCups + sWo;
          const diff = delta - accounted;
          if (Math.abs(diff) > 0 && sCups > 0 && delta !== sCups) {
            counterDiscrepancyCups += Math.abs(diff);
            counterAlerts.push(dayRec.date + ' (' + nm + '): счётчик +' + delta + ', учтено ' + sCups);
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
  calcStaffBonus(staffRow, dscPct, srvPct, avgDailyWo, woNorm) {
    const rev = Number(staffRow.revenue) || 0;
    const shifts = Math.max(1, Number(staffRow.shifts) || 1);
    const baseRate = shifts * 1500;
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


window.coffeeNormalizeTasksTimeline = function (tasksList) {
  if (!Array.isArray(tasksList)) return [];
  return tasksList
    .filter((t) => t && t.id !== '__SYS_CONFIG_V19__' && t.title !== '__SYS_SYNC__')
    .map((t) => {
      if (t.block === 'День') {
        const idStr = String(t.id || '').toLowerCase();
        const newBlk = /^d\d+/.test(idStr) ? 'Лайн Чек 1' : 'Лайн Чек 2';
        return Object.assign({}, t, { block: newBlk });
      }
      return t;
    });
};

window.coffeeEnsureV19Schema = function (db) {
  if (!db || typeof db !== 'object') return db;
  if (!Array.isArray(db.checklistBlocks) || !db.checklistBlocks.length) {
    db.checklistBlocks = window.COFFEE_DEFAULT_CHECKLIST_BLOCKS.map((b) => Object.assign({}, b));
  } else {
    /* Если в старой базе не было Лайн Чек 1 / Лайн Чек 2, мигрируем на новый таймлайн */
    const hasLc1 = db.checklistBlocks.some((b) => b.name === 'Лайн Чек 1');
    const hasOldDay = db.checklistBlocks.some((b) => b.name === 'День');
    if (!hasLc1 && hasOldDay) {
      db.checklistBlocks = window.COFFEE_DEFAULT_CHECKLIST_BLOCKS.map((b) => Object.assign({}, b));
    }
  }
  db.blocks = db.checklistBlocks.filter((b) => b && b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
  if (!db.blocks.length) db.blocks = ['Открытие', 'Лайн Чек 1', 'Лайн Чек 2', 'Закрытие'];

  if (Array.isArray(db.tasks)) {
    db.tasks = window.coffeeNormalizeTasksTimeline(db.tasks);
  }

  /* Планы по дням недели (Пн–Вс): выручка, средний чек, транзакции */
  const basePlan = Number(db.plan) || 2500;
  const baseAvg = Number(db.minAvgCheck) || 390;
  const baseChk = Number(db.planChecks) || 150;
  if (!db.dailyPlans || typeof db.dailyPlans !== 'object') {
    db.dailyPlans = {};
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach((d) => {
      const def = window.COFFEE_DEFAULT_DAILY_PLANS[d] || { revenue: basePlan, avgCheck: baseAvg, checks: baseChk };
      db.dailyPlans[d] = {
        revenue: Number(def.revenue) || basePlan,
        avgCheck: Number(def.avgCheck) || baseAvg,
        checks: Number(def.checks) || baseChk
      };
    });
  } else {
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach((d) => {
      const cur = db.dailyPlans[d] || {};
      db.dailyPlans[d] = {
        revenue: Math.max(1, Number(cur.revenue) || basePlan),
        avgCheck: Math.max(1, Number(cur.avgCheck) || baseAvg),
        checks: Math.max(1, Number(cur.checks) || baseChk)
      };
    });
  }

  /* Коды доступа для всех сотрудников */
  if (Array.isArray(db.staff)) {
    db.staff.forEach((s, idx) => {
      if (s.pin && !s.pinHash) {
        s.pinHash = window.coffeeHashPin ? window.coffeeHashPin(s.pin) : s.pin;
        delete s.pin;
      }
      if (!s.pinHash) {
        const defMap = window.COFFEE_STAFF_PIN_HASHES || {};
        s.pinHash = defMap[s.name] || (window.coffeeHashPin ? window.coffeeHashPin(String(1111 + idx * 1111).slice(0, 4)) : '');
      }
    });
  }
  if (!Array.isArray(db.goodDeeds) || !db.goodDeeds.length) {
    db.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((g) => Object.assign({}, g));
  }
  /* Обогащаем каждый инцидент полями Action Plan (дедлайн 24ч, проверяющий reviewer, запрет галереи cameraOnly) */
  if (Array.isArray(db.incidents)) {
    db.incidents.forEach((inc) => {
      if (!inc.reviewer) inc.reviewer = 'Управляющий / Менеджер смены';
      if (!inc.actionDeadline) inc.actionDeadline = '24 часа';
      if (inc.cameraOnly == null) inc.cameraOnly = true;
    });
  }
  return db;
};

window.coffeeGetDayPlan = function (dateStr, dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  window.coffeeEnsureV19Schema(db);
  const dt = new Date((dateStr || _isoToday()) + 'T12:00:00');
  const dowMap = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const dayCode = !isNaN(dt) ? dowMap[dt.getDay()] : 'Пн';
  const dp = (db.dailyPlans && db.dailyPlans[dayCode]) || {
    revenue: Number(db.plan) || 2500,
    avgCheck: Number(db.minAvgCheck) || 35,
    checks: Number(db.planChecks) || 75
  };
  return {
    dayCode,
    revenue: Math.max(1, Number(dp.revenue) || Number(db.plan) || 2500),
    avgCheck: Math.max(1, Number(dp.avgCheck) || Number(db.minAvgCheck) || 390),
    checks: Math.max(1, Number(dp.checks) || Number(db.planChecks) || 150)
  };
};

window.coffeeGetChecklistBlocks = function (dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  window.coffeeEnsureV19Schema(db);
  return (db.checklistBlocks || window.COFFEE_DEFAULT_CHECKLIST_BLOCKS).filter((b) => b && b.active !== false);
};

window.coffeeVerifyStaffPin = function (staffName, pinInput, dbOpt) {
  const actorKey = 'staff_' + String(staffName || 'default');
  if (window.coffeeRateLimiter) {
    const rl = window.coffeeRateLimiter.check(actorKey);
    if (rl.locked) return false;
  }
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  window.coffeeEnsureV19Schema(db);
  const cleanPin = String(pinInput || '').trim();
  if (!cleanPin) return false;
  const candHash = window.coffeeHashPin ? window.coffeeHashPin(cleanPin) : cleanPin;
  const ownerHash = window.coffeeAuth ? window.coffeeAuth.getExpectedOwnerPinHash(db) : (window.COFFEE_DEFAULT_OWNER_PIN_HASH || '');
  const defaultOwnerHash = window.COFFEE_DEFAULT_OWNER_PIN_HASH || (window.coffeeHashPin ? window.coffeeHashPin('1234') : '');
  if (candHash === ownerHash || candHash === defaultOwnerHash) {
    if (window.coffeeRateLimiter) window.coffeeRateLimiter.reset(actorKey);
    return true;
  }
  const st = (db.staff || []).find((s) => s && s.name === staffName);
  const defHashes = window.COFFEE_STAFF_PIN_HASHES || {};
  const expectedHash = (st && (st.pinHash || (st.pin && window.coffeeHashPin(st.pin)))) || defHashes[staffName] || (window.coffeeHashPin ? window.coffeeHashPin('1111') : '');
  const ok = candHash === expectedHash;
  if (window.coffeeRateLimiter) {
    if (ok) window.coffeeRateLimiter.reset(actorKey);
    else window.coffeeRateLimiter.recordFailure(actorKey);
  }
  return ok;
};

/* Переопределяем coffeeGetBlockWindow для поддержки нового таймлайна (Открытие, Лайн Чек 1, Лайн Чек 2, Закрытие, Касса и любых добавленных чек-листов) */
window.coffeeGetBlockWindow = function (block, dbOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  window.coffeeEnsureV19Schema(db);
  if (typeof window !== 'undefined' && window.META && window.META.deadlineExtensions) {
    db.deadlineExtensions = Object.assign({}, db.deadlineExtensions || {}, window.META.deadlineExtensions);
  }
  const blocksList = window.coffeeGetChecklistBlocks(db);
  const found = blocksList.find((b) => b.name === block);
  const w = found
    ? { openTime: found.openTime || '07:30', deadline: found.deadline || '23:59' }
    : { openTime: '07:30', deadline: '23:59' };

  const now = new Date();
  const curHm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = _isoToday();
  const extKey = today + ':' + block;
  const extObj = (db.deadlineExtensions && db.deadlineExtensions[extKey]) || null;
  const effectiveOpen = (extObj && extObj.openFrom) ? extObj.openFrom : w.openTime;
  const effectiveDeadline = (extObj && extObj.until) ? extObj.until : w.deadline;
  const comp = window.coffeeIsBlockCompletedToday(block, db);
  const completed = comp.completed;

  const adminForcedOpen = !!(extObj && extObj.forceOpen && curHm >= effectiveOpen && curHm <= effectiveDeadline);
  const isBefore = !adminForcedOpen && !completed && curHm < effectiveOpen;
  const isOverdue = !adminForcedOpen && !completed && curHm > effectiveDeadline;
  const canPass = adminForcedOpen || (!completed && curHm >= effectiveOpen && curHm <= effectiveDeadline);

  let state = 'open';
  let status = 'Доступ открыт (' + effectiveOpen + '–' + effectiveDeadline + ')';
  if (completed) {
    state = 'completed';
    status = 'Выполнено в срок' + (comp.record && comp.record.time ? ' (' + comp.record.time + ')' : '');
  } else if (isOverdue) {
    state = 'overdue_closed';
    status = 'Доступ закрыт · Просрочено (дедлайн ' + effectiveDeadline + ')';
  } else if (isBefore) {
    state = 'before_window';
    status = 'Доступ с ' + effectiveOpen + ' (окно ' + effectiveOpen + '–' + effectiveDeadline + ')';
  }

  return {
    block,
    openTime: effectiveOpen,
    deadline: effectiveDeadline,
    baseOpenTime: w.openTime,
    baseDeadline: w.deadline,
    extended: !!extObj,
    extensionReason: extObj ? extObj.reason : '',
    currentTime: curHm,
    completed,
    completedRecord: comp.record,
    isBefore,
    isOverdue,
    canPass,
    state,
    status
  };
};

/* Автоконтроль просрочки по всем активным чек-листам динамического таймлайна */
window.coffeeEnforceOverdueChecklists = function (activeBaristaOpt) {
  if (typeof getUDB !== 'function') return [];
  const db = getUDB();
  window.coffeeEnsureV19Schema(db);
  const today = _isoToday();
  db.overdueIncidentsCreated = db.overdueIncidentsCreated || {};
  let activeBarista = activeBaristaOpt || '';
  if (!activeBarista) {
    try { activeBarista = localStorage.getItem('coffee_active_barista') || 'Дежурный бариста'; } catch (_) { activeBarista = 'Дежурный бариста'; }
  }
  const newlyCreated = [];
  let changed = false;

  const checkBlocks = window.coffeeGetChecklistBlocks(db).filter((b) => !b.isCash && b.name !== 'Касса');
  checkBlocks.forEach((bObj, bIdx) => {
    const blk = bObj.name;
    const win = window.coffeeGetBlockWindow(blk, db);
    const key = today + ':' + blk;
    if (win.state === 'overdue_closed' && !db.overdueIncidentsCreated[key]) {
      db.overdueIncidentsCreated[key] = { at: win.currentTime, deadline: win.deadline };
      const incId = 'INC-LATE-' + today.slice(8, 10) + today.slice(5, 7) + '-' + (bObj.id || ('B' + bIdx)).toUpperCase();
      const existing = (db.incidents || []).find((x) => x.id === incId);
      if (!existing) {
        const newInc = {
          id: incId,
          date: today,
          time: win.deadline,
          location: db.location || 'Кофейня №1',
          block: blk,
          incType: 'Проблемы с персоналом',
          step: '⏰ Не выполнен в срок чек-лист «' + blk + '»',
          text: 'Чек-лист «' + blk + '» не был пройден в отведённое время (' + win.openTime + ' – ' + win.deadline + '). Доступ в терминале автоматически закрыт.',
          priority: 'Критично',
          status: 'Новая проблема',
          who: activeBarista,
          owner: 'Администратор',
          photo: '',
          photos: [],
          isOverdueAuto: true,
          history: [
            {
              time: today.split('-').reverse().join('.') + ' ' + win.currentTime,
              actor: 'Система автоконтроля',
              status: 'Новая проблема',
              note: 'Автоматическая блокировка чек-листа после дедлайна (' + win.deadline + ') и назначение задачи на Администратора'
            }
          ]
        };
        db.incidents.unshift(newInc);
        appendAudit(db, 'Система автоконтроля', 'Просрочка чек-листа «' + blk + '»', 'Создан инцидент ' + incId + ' (Ответственный: Администратор)');
        newlyCreated.push(newInc);
        changed = true;
      }
    }
  });

  if (changed) {
    saveUDB(db);
    if (window.coffeeCache) window.coffeeCache.invalidate('all');
    if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'overdue_auto_incident', count: newlyCreated.length });
  }
  return newlyCreated;
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

    /* Флаг 2: Сверка счётчика проливов кофемашины (гриндер) с продажами и списаниями */
    const shifts = Array.isArray(c.shifts) ? c.shifts : [];
    let totalCounterDelta = 0;
    let totalAccountedCups = 0;
    let hasCounter = false;
    shifts.forEach((sh) => {
      if (sh.counter != null && sh.prevCounter != null && Number(sh.counter) >= Number(sh.prevCounter)) {
        hasCounter = true;
        totalCounterDelta += (Number(sh.counter) - Number(sh.prevCounter));
        totalAccountedCups += (Number(sh.cups || sh.checks) || 0) + (Number(sh.writeoff) || 0);
      }
    });
    if (hasCounter) {
      const cupGap = Math.abs(totalCounterDelta - totalAccountedCups);
      if (cupGap > deltaNorm) {
        flags.push({
          level: 'red',
          title: '🚩 КРАСНЫЙ ФЛАГ: Не сходится счётчик кофемашины (разница ' + cupGap + ' порций при допуске ≤ ' + deltaNorm + ')',
          desc: 'По счётчику пролито ' + totalCounterDelta + ' порций, а в продажах и списаниях учтено ' + totalAccountedCups + '. Проверьте списания на проработку или неучтённые проливы!',
          tag: 'Счётчик / Гриндер'
        });
      } else {
        flags.push({
          level: 'green',
          title: '🟢 Проливы кофемашины совпадают с продажами и списаниями',
          desc: 'Пролито по счётчику: ' + totalCounterDelta + ' порц. · Учтено с учётом списаний: ' + totalAccountedCups + ' (в пределах сезонного допуска ±' + deltaNorm + ' порц.).',
          tag: 'Счётчик ОК'
        });
      }
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
window.coffeeEnsureSchema = window.coffeeEnsureV19Schema;
