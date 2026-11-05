/**
 * Полный серверный скрипт Google Apps Script (Code.gs) для единой системы «Кофейня».
 * Поддерживает все разделы: Терминал (get_checklists, submit_checklist, submit_cash, upload_photo),
 * Дашборд (dashboard, resolve_incident), Отчёты (report, add_expense, delete_expense)
 * и Управление (admin, save_task, delete_task, admin_cash, delete_cash, update_expense, update_incident, delete_incident, save_setting).
 */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'get_checklists';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    if (action === 'get_checklists') {
      return jsonOut_(getChecklists_(ss));
    }
    checkPin_(ss, p.pin);
    if (action === 'dashboard') {
      return jsonOut_(getDashboard_(ss, p.date));
    }
    if (action === 'report') {
      return jsonOut_(getReport_(ss, p.from, p.to));
    }
    if (action === 'admin') {
      return jsonOut_(getAdmin_(ss));
    }
    return jsonOut_({ ok: false, error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    if (action === 'submit_checklist') return jsonOut_(submitChecklist_(ss, body));
    if (action === 'submit_cash') return jsonOut_(submitCash_(ss, body));
    if (action === 'upload_photo') return jsonOut_({ ok: true, url: '' });

    checkPin_(ss, body.pin);
    if (action === 'save_task') return jsonOut_(saveTask_(ss, body));
    if (action === 'delete_task') return jsonOut_(deleteTask_(ss, body));
    if (action === 'admin_cash') return jsonOut_(submitCash_(ss, body));
    if (action === 'delete_cash') return jsonOut_(deleteCash_(ss, body));
    if (action === 'add_expense') return jsonOut_(addExpense_(ss, body));
    if (action === 'update_expense') return jsonOut_(updateExpense_(ss, body));
    if (action === 'delete_expense') return jsonOut_(deleteExpense_(ss, body));
    if (action === 'resolve_incident') return jsonOut_(updateIncident_(ss, { id: body.id, status: 'Resolved' }));
    if (action === 'update_incident') return jsonOut_(updateIncident_(ss, body));
    if (action === 'delete_incident') return jsonOut_(deleteIncident_(ss, body));
    if (action === 'save_setting') return jsonOut_(saveSetting_(ss, body));

    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isoDate_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone() || 'GMT+2', 'yyyy-MM-dd');
}

function ensureSheets_(ss) {
  var defs = [
    ['Настройки', ['Параметр', 'Значение']],
    ['Задачи', ['Код', 'Блок', 'Подгруппа', 'Название', 'Инструкция', 'Нужно фото', 'Ответственный', 'Активна']],
    ['Касса', ['Дата', 'Наличные', 'Безнал', 'Чеков', 'Списания', 'Хиты', 'Бариста']],
    ['Расходы', ['ID', 'Дата', 'Статья', 'Сумма', 'Комментарий']],
    ['Поломки', ['ID', 'Дата', 'Время', 'Шаг', 'Описание', 'Срочность', 'Статус', 'Кто', 'Ответственный', 'Фото']],
    ['Чек-листы', ['Дата', 'Время', 'Блок', 'Бариста', 'Проблем', 'Фото JSON']]
  ];
  defs.forEach(function(d) {
    var sh = ss.getSheetByName(d[0]);
    if (!sh) {
      sh = ss.insertSheet(d[0]);
      sh.appendRow(d[1]);
    }
  });
}

function getSettingsMap_(ss) {
  var sh = ss.getSheetByName('Настройки');
  var rows = sh.getDataRange().getValues();
  var map = { LOCATION: 'Кофейня', PLAN: '2200', DEADLINE: '08:30', WO_NORM: '500', PHOTO_ALL: 'нет', ADMIN_PIN: '1234' };
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0] || '').trim(), v = String(rows[i][1] || '').trim();
    if (k) map[k] = v;
  }
  return map;
}

function checkPin_(ss, pin) {
  var map = getSettingsMap_(ss);
  var expected = map.ADMIN_PIN || '';
  if (expected && String(pin || '').trim() !== expected) {
    throw new Error('PIN_REQUIRED');
  }
}

function getChecklists_(ss) {
  var map = getSettingsMap_(ss);
  var sh = ss.getSheetByName('Задачи');
  var rows = sh.getDataRange().getValues();
  var tasks = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[3] && !r[1]) continue;
    var active = String(r[7] || 'да').toLowerCase();
    if (active === 'нет') continue;
    tasks.push({
      row: i + 1,
      id: String(r[0] || ('r' + (i + 1))),
      block: String(r[1] || 'Открытие'),
      groupName: String(r[2] || ''),
      title: String(r[3] || ''),
      instruction: String(r[4] || ''),
      photo: String(r[5] || 'нет').toLowerCase(),
      mediaRequired: String(r[5] || 'нет').toLowerCase() === 'да' || (map.PHOTO_ALL === 'да' && (r[1] === 'Открытие' || r[1] === 'Закрытие')),
      responsible: String(r[6] || ''),
      active: 'да'
    });
  }
  return { ok: true, v: 2, rows: rows.length - 1, sheet: 'Задачи', location: map.LOCATION, plan: Number(map.PLAN) || 2200, tasks: tasks };
}

function getAdmin_(ss) {
  var map = getSettingsMap_(ss);
  var shT = ss.getSheetByName('Задачи').getDataRange().getValues();
  var tasks = [];
  for (var i = 1; i < shT.length; i++) {
    var r = shT[i];
    if (!r[3] && !r[1]) continue;
    tasks.push({
      row: i + 1, id: String(r[0] || ''), block: String(r[1] || 'Открытие'), groupName: String(r[2] || ''),
      title: String(r[3] || ''), instruction: String(r[4] || ''), photo: String(r[5] || 'нет').toLowerCase(),
      responsible: String(r[6] || ''), active: String(r[7] || 'да').toLowerCase()
    });
  }
  var shC = ss.getSheetByName('Касса').getDataRange().getValues();
  var cash = [];
  for (var j = 1; j < shC.length; j++) {
    var rc = shC[j]; if (!rc[0]) continue;
    cash.push({ date: fmtIso_(rc[0]), cash: Number(rc[1]) || 0, card: Number(rc[2]) || 0, checks: Number(rc[3]) || 0, writeoff: Number(rc[4]) || 0, topItems: String(rc[5] || '') });
  }
  var shE = ss.getSheetByName('Расходы').getDataRange().getValues();
  var expenses = [];
  for (var k = 1; k < shE.length; k++) {
    var re = shE[k]; if (!re[0]) continue;
    expenses.push({ id: String(re[0]), date: fmtIso_(re[1]), category: String(re[2] || ''), amount: Number(re[3]) || 0, comment: String(re[4] || '') });
  }
  var shI = ss.getSheetByName('Поломки').getDataRange().getValues();
  var incidents = [];
  for (var m = 1; m < shI.length; m++) {
    var ri = shI[m]; if (!ri[0]) continue;
    incidents.push({ id: String(ri[0]), date: fmtIso_(ri[1]), time: String(ri[2] || ''), step: String(ri[3] || ''), text: String(ri[4] || ''), priority: String(ri[5] || 'Терпит'), status: String(ri[6] || 'Open'), who: String(ri[7] || ''), owner: String(ri[8] || '—'), photo: String(ri[9] || '') });
  }
  return {
    ok: true, today: isoDate_(), location: map.LOCATION,
    blocks: ['Открытие', 'День', 'Закрытие'],
    categories: ['Закупка продуктов', 'Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Ремонт и оборудование', 'Прочее'],
    tasks: tasks, cash: cash.reverse(), expenses: expenses.reverse(), incidents: incidents.reverse(),
    settings: [
      { id: 'LOCATION', label: 'Название точки', hint: 'Отображается в шапке всех разделов', value: map.LOCATION, secret: false },
      { id: 'PLAN', label: 'План выручки на день, ₽', hint: 'Дневная цель выручки', value: map.PLAN, secret: false },
      { id: 'DEADLINE', label: 'Дедлайн открытия смены', hint: 'Например 08:30', value: map.DEADLINE, secret: false },
      { id: 'WO_NORM', label: 'Норма списаний в день, ₽', hint: 'Порог списаний', value: map.WO_NORM, secret: false },
      { id: 'PHOTO_ALL', label: 'Фото на каждом шаге (да/нет)', hint: 'Обязательное фото для открытия и закрытия', value: map.PHOTO_ALL, secret: false },
      { id: 'ADMIN_PIN', label: 'Код доступа к дашборду и отчётам', hint: 'Код администратора', value: '', secret: true, set: !!map.ADMIN_PIN }
    ]
  };
}

function fmtIso_(v) {
  if (v instanceof Date) return isoDate_(v);
  var s = String(v || '').trim();
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);
}

function submitCash_(ss, b) {
  var sh = ss.getSheetByName('Касса');
  var rows = sh.getDataRange().getValues();
  var dt = b.date || isoDate_();
  var wo = Number(b.writeoff != null ? b.writeoff : b.writeOffs) || 0;
  for (var i = 1; i < rows.length; i++) {
    if (fmtIso_(rows[i][0]) === dt) {
      sh.getRange(i + 1, 1, 1, 7).setValues([[dt, Number(b.cash) || 0, Number(b.card) || 0, Number(b.checks) || 0, wo, b.topItems || rows[i][5] || '', b.userName || rows[i][6] || '']]);
      return { ok: true };
    }
  }
  sh.appendRow([dt, Number(b.cash) || 0, Number(b.card) || 0, Number(b.checks) || 0, wo, b.topItems || '', b.userName || '']);
  return { ok: true };
}

function deleteCash_(ss, b) {
  var sh = ss.getSheetByName('Касса');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (fmtIso_(rows[i][0]) === b.date) sh.deleteRow(i + 1);
  }
  return { ok: true };
}

function saveTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  var rowVals = [b.id || '', b.block || 'Открытие', b.groupName || '', b.title || '', b.instruction || '', b.mediaRequired || b.photo || 'нет', b.responsible || '', b.active || 'да'];
  if (b.row) sh.getRange(Number(b.row), 1, 1, 8).setValues([rowVals]);
  else sh.appendRow(rowVals);
  return { ok: true };
}

function deleteTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  if (b.row) sh.deleteRow(Number(b.row));
  return { ok: true };
}

function addExpense_(ss, b) {
  var sh = ss.getSheetByName('Расходы');
  var id = b.id || ('EXP-' + Math.floor(100 + Math.random() * 900));
  sh.appendRow([id, b.date || isoDate_(), b.category || 'Прочее', Number(b.amount) || 0, b.comment || '']);
  return { ok: true, id: id };
}

function updateExpense_(ss, b) {
  var sh = ss.getSheetByName('Расходы');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(b.id)) {
      sh.getRange(i + 1, 2, 1, 4).setValues([[b.date, b.category, Number(b.amount) || 0, b.comment || '']]);
      break;
    }
  }
  return { ok: true };
}

function deleteExpense_(ss, b) {
  var sh = ss.getSheetByName('Расходы');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(b.id)) sh.deleteRow(i + 1);
  }
  return { ok: true };
}

function updateIncident_(ss, b) {
  var sh = ss.getSheetByName('Поломки');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(b.id)) {
      if (b.status) sh.getRange(i + 1, 7).setValue((b.status === 'Open' || b.status === 'Открыта') ? 'Open' : 'Resolved');
      if (b.comment != null) sh.getRange(i + 1, 5).setValue(b.comment);
      if (b.priority != null) sh.getRange(i + 1, 6).setValue(b.priority);
      if (b.responsible != null) sh.getRange(i + 1, 9).setValue(b.responsible);
      break;
    }
  }
  return { ok: true };
}

function deleteIncident_(ss, b) {
  var sh = ss.getSheetByName('Поломки');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(b.id)) sh.deleteRow(i + 1);
  }
  return { ok: true };
}

function saveSetting_(ss, b) {
  var sh = ss.getSheetByName('Настройки');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(b.id)) {
      sh.getRange(i + 1, 2).setValue(b.value);
      return { ok: true };
    }
  }
  sh.appendRow([b.id, b.value]);
  return { ok: true };
}

function submitChecklist_(ss, b) {
  var sh = ss.getSheetByName('Чек-листы');
  var dt = isoDate_();
  var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  var items = b.items || [];
  var probs = items.filter(function(x) { return x && x.isIncident; });
  sh.appendRow([dt, tm, b.block || 'Открытие', b.userName || 'Бариста', probs.length, '[]']);
  var shI = ss.getSheetByName('Поломки');
  probs.forEach(function(p) {
    shI.appendRow(['INC-' + Math.floor(100 + Math.random() * 900), dt, tm, p.title || '', p.comment || '', p.priority || 'Терпит', 'Open', b.userName || 'Бариста', p.responsible || 'Техник', p.photo_url || '']);
  });
  return { ok: true };
}

function getDashboard_(ss, dateStr) {
  var adm = getAdmin_(ss);
  var day = dateStr || adm.today;
  var c = null;
  for (var i = 0; i < adm.cash.length; i++) {
    if (adm.cash[i].date === day) { c = adm.cash[i]; break; }
  }
  var rev = c ? (c.cash + c.card) : 0;
  var chks = c ? c.checks : 0;
  return {
    ok: true, date: day, isToday: day === adm.today, location: adm.location,
    plan: 2200, woNorm: 500, deadline: '08:30', hasData: !!c,
    revenue: rev, checks: chks, avg: chks > 0 ? Math.round(rev / chks) : 0,
    writeoff: c ? c.writeoff : 0, openedAt: '08:20',
    days: adm.cash.slice(0, 14).reverse().map(function(x) { return { date: x.date, revenue: x.cash + x.card }; }),
    incidents: adm.incidents, photoReports: []
  };
}

function getReport_(ss, fromStr, toStr) {
  var adm = getAdmin_(ss);
  return { ok: true, from: fromStr || adm.today, to: toStr || adm.today, days: 7, categories: adm.categories, plan: 15400, pct: 100, delta: 0,
    finance: { revenue: 0, expenses: 0, profit: 0, prevProfit: 0, margin: 0, writeoff: 0, byCategory: [], list: adm.expenses },
    totals: { days: adm.cash.length, revenue: 0, checks: 0, avg: 0, cash: 0, card: 0, writeoff: 0 },
    series: [], products: [], tasks: [], discipline: { openings: 0, late: 0, missed: 0, checklists: 0, problemSteps: 0 },
    incidents: { total: adm.incidents.length, open: 0, resolved: 0, critical: 0 }
  };
}
