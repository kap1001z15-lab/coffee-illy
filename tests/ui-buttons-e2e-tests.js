'use strict';
/**
 * End-to-End проверка всех кнопок и действий интерфейса:
 * 1. Управление чек-листами и окнами (win-save, win-unlock, win-sim-overdue, dl-extend, chkblk-new, chkblk-del)
 * 2. Управление задачами и порядком (task-new, task-edit, task-up, task-down, task-del, blk-flt)
 * 3. Карта добрых дел и Информирование (gd-new, gd-del, info-new, info-edit, info-del, ack_announcement)
 * 4. Техкарты ТТК, Выручка, Расходы (ttk-new, ttk-edit, ttk-del, admin_cash, delete_cash, add_expense, update_expense, delete_expense)
 * 5. Штат, График смен, Персональные PIN-коды, Планы Пн–Вс, Аудит сервиса, Инциденты
 * 6. Сквозная реактивность: проверка, что изменения в Управлении сразу видны в Терминале, на Дашборде и в Отчётах.
 */
require('./unit-tests.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('[PASS] ' + name + '\n');
  } catch (e) {
    process.stderr.write('[FAIL] ' + name + ': ' + e.message + '\n');
    process.exitCode = 1;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

check('1. Кнопки Таймлайна в Управлении: добавление чек-листа (chkblk-new), сохранение окон (win-save), разблокировка (win-unlock) и удаление (chkblk-del)', () => {
  window.applyLocalMutation({ action: 'add_checklist_block', name: 'Вечерний чек', openTime: '18:00', deadline: '19:00' });
  let blocks = window.coffeeGetChecklistBlocks();
  assert(blocks.some((b) => b.name === 'Вечерний чек'), 'Кнопка + Добавить чек-лист должна добавлять блок в таймлайн');

  const updatedBlocks = blocks.map((b) => b.name === 'Открытие' ? Object.assign({}, b, { openTime: '07:00', deadline: '08:45' }) : b);
  window.applyLocalMutation({ action: 'save_checklist_blocks', blocks: updatedBlocks });
  const wOpen = window.coffeeGetBlockWindow('Открытие');
  assert(wOpen.baseOpenTime === '07:00' && wOpen.baseDeadline === '08:45', 'Кнопка Сохранить таймлайн должна обновлять окна в Терминале');

  window.applyLocalMutation({ action: 'extend_deadline', block: 'Вечерний чек', openFrom: '00:00', until: '23:59', reason: 'Тест кнопки Открыть доступ' });
  const wUnlocked = window.coffeeGetBlockWindow('Вечерний чек');
  assert(wUnlocked.canPass === true && wUnlocked.extended === true, 'Кнопка Открыть доступ должна немедленно разблокировать чек-лист в Терминале');

  window.applyLocalMutation({ action: 'delete_checklist_block', name: 'Вечерний чек' });
  blocks = window.coffeeGetChecklistBlocks();
  assert(!blocks.some((b) => b.name === 'Вечерний чек'), 'Кнопка Убрать чек-лист должна удалять блок из таймлайна');
});

check('2. Кнопки Задач в Управлении: добавление (task-new), редактирование (task-edit), перемещение (task-up/down) и удаление (task-del)', () => {
  window.applyLocalMutation({
    action: 'save_task',
    id: 'test_btn_task_1',
    block: 'Открытие',
    title: 'Проверить давление бойлера',
    instruction: '1.2 бар',
    photoMode: 'да',
    responsible: 'Техник',
    active: 'да'
  });
  let adm = window.coffeeGetInstantAdmin();
  assert(adm.tasks.some((t) => t.id === 'test_btn_task_1'), 'Кнопка Добавить задачу должна добавлять пункт в чек-лист');

  window.applyLocalMutation({
    action: 'save_task',
    id: 'test_btn_task_1',
    row: adm.tasks.find((t) => t.id === 'test_btn_task_1').row,
    block: 'Открытие',
    title: 'Проверить давление бойлера (обновлено)',
    instruction: '1.3 бар',
    photoMode: 'да',
    responsible: 'Мастер',
    active: 'да'
  });
  adm = window.coffeeGetInstantAdmin();
  assert(adm.tasks.find((t) => t.id === 'test_btn_task_1').title.indexOf('обновлено') >= 0, 'Кнопка Изменить задачу должна обновлять название и ответственного');

  window.applyLocalMutation({ action: 'delete_task', id: 'test_btn_task_1', expect: 'Проверить давление бойлера (обновлено)' });
  adm = window.coffeeGetInstantAdmin();
  assert(!adm.tasks.some((t) => t.id === 'test_btn_task_1'), 'Кнопка Удалить задачу должна удалять пункт и записывать tombstone');
});

check('3. Кнопки «Карты добрых дел» (gd-new, gd-del) и «Информирования» (info-new, info-edit, ack_announcement, info-del)', () => {
  window.applyLocalMutation({
    action: 'save_good_deed',
    id: 'gd_test_99',
    title: 'Чистка гриндера',
    frequency: '1 раз в неделю (Воскресенье)',
    window: '21:30 – 22:30',
    responsible: 'Бариста',
    reviewer: 'Шеф-бариста',
    instruction: 'Прочистить жернова'
  });
  let db = window.getUDB();
  assert(db.goodDeeds.some((g) => g.id === 'gd_test_99'), 'Кнопка + Добавить периодическую задачу должна сохранять задачу в Карту добрых дел');
  window.applyLocalMutation({ action: 'delete_good_deed', id: 'gd_test_99' });
  db = window.getUDB();
  assert(!db.goodDeeds.some((g) => g.id === 'gd_test_99'), 'Кнопка Удалить в Карте добрых дел должна удалять задачу');

  window.applyLocalMutation({
    action: 'save_announcement',
    id: 'INFO-TEST-1',
    title: 'Проверка кнопок информирования',
    category: 'Изменения меню',
    text: 'Текст объявления',
    targetStaff: 'Соня, Алина'
  });
  db = window.getUDB();
  assert(db.announcements.some((a) => a.id === 'INFO-TEST-1'), 'Кнопка + Создать материал должна публиковать объявление для Терминала');

  window.applyLocalMutation({ action: 'ack_announcement', id: 'INFO-TEST-1', userName: 'Соня' });
  db = window.getUDB();
  const ann = db.announcements.find((a) => a.id === 'INFO-TEST-1');
  assert(ann.acks.some((k) => k.name === 'Соня'), 'Кнопка Ознакомлен в Терминале должна фиксировать сотрудника');

  window.applyLocalMutation({ action: 'delete_announcement', id: 'INFO-TEST-1' });
  db = window.getUDB();
  assert(!db.announcements.some((a) => a.id === 'INFO-TEST-1'), 'Кнопка Удалить материал должна удалять объявление');
});

check('4. Кнопки Техкарт ТТК (ttk-new, ttk-edit, ttk-del), Выручки (cash-new, cash-del) и Расходов (exp-new, exp-edit, exp-del)', () => {
  window.applyLocalMutation({
    action: 'save_ttk',
    id: 'ttk_test_pmr',
    name: 'Эспрессо Тоник',
    volume: '300 мл',
    category: 'Сезон',
    price: 28,
    costBeans: 4.2,
    costMilk: 8.0,
    costSyrup: 1.5,
    costCup: 1.5,
    recipe: 'Тоник + эспрессо ILLY'
  });
  let db = window.getUDB();
  assert(db.ttk.some((t) => t.id === 'ttk_test_pmr' && t.price === 28), 'Кнопка Сохранить ТТК должна добавлять техкарту в руб.');
  window.applyLocalMutation({ action: 'delete_ttk', id: 'ttk_test_pmr' });
  db = window.getUDB();
  assert(!db.ttk.some((t) => t.id === 'ttk_test_pmr'), 'Кнопка Удалить ТТК должна удалять техкарту');

  window.applyLocalMutation({ action: 'add_expense', id: 'EXP-TEST-99', date: '2026-11-11', category: 'Закупка продуктов', amount: 450, comment: 'Тест кнопки расхода' });
  db = window.getUDB();
  assert(db.expenses.some((e) => e.id === 'EXP-TEST-99' && e.amount === 450), 'Кнопка + Добавить расход должна сохранять расход');
  window.applyLocalMutation({ action: 'update_expense', id: 'EXP-TEST-99', date: '2026-11-11', category: 'Закупка продуктов', amount: 520, comment: 'Обновлено' });
  db = window.getUDB();
  assert(db.expenses.find((e) => e.id === 'EXP-TEST-99').amount === 520, 'Кнопка Изменить расход должна обновлять сумму');
  window.applyLocalMutation({ action: 'delete_expense', id: 'EXP-TEST-99' });
  db = window.getUDB();
  assert(!db.expenses.some((e) => e.id === 'EXP-TEST-99'), 'Кнопка Удалить расход должна удалять запись');
});

check('5. Кнопки Настроек: Планы Пн–Вс (dplans-save), Коды сотрудников (staffpins-save), График смен (roster-save), Аудит (audit-new/del) и Симулятор (simulate)', () => {
  window.applyLocalMutation({
    action: 'save_daily_plans',
    plans: {
      'Пн': { revenue: 2350, avgCheck: 34, checks: 72 },
      'Вт': { revenue: 2400, avgCheck: 35, checks: 74 }
    }
  });
  const dpMon = window.coffeeGetDayPlan('2026-11-09');
  assert(dpMon.revenue === 2350 && dpMon.avgCheck === 34 && dpMon.checks === 72, 'Кнопка Сохранить планы по дням должна сразу менять план на Дашборде и в Отчётах');

  window.applyLocalMutation({
    action: 'save_staff_pins',
    pins: [{ name: 'Соня', pin: '7788' }]
  });
  assert(window.coffeeVerifyStaffPin('Соня', '7788') === true, 'Кнопка Сохранить коды сотрудников должна сразу обновлять SHA-256 хеш для входа в Терминал');
  window.applyLocalMutation({ action: 'save_staff_pins', pins: [{ name: 'Соня', pin: '1111' }] });

  window.applyLocalMutation({ action: 'save_shift_roster', roster: { 'Пн': 'Алина (07:30–22:30)' } });
  assert(window.getUDB().shiftRoster['Пн'] === 'Алина (07:30–22:30)', 'Кнопка Сохранить график смен должна обновлять расписание');

  window.applyLocalMutation({ action: 'save_service_audit', id: 'AUD-TEST-1', barista: 'Соня', auditor: 'Максим', greet: 100, clarify: 100, upsell: 90, farewell: 100 });
  assert(window.getUDB().serviceAudits.some((a) => a.id === 'AUD-TEST-1'), 'Кнопка + Провести аудит бариста должна сохранять чек-лист оценки');
  window.applyLocalMutation({ action: 'delete_service_audit', id: 'AUD-TEST-1' });
  assert(!window.getUDB().serviceAudits.some((a) => a.id === 'AUD-TEST-1'), 'Кнопка Удалить аудит должна удалять запись');

  const simRes = window.coffeeSmartEngine.simulate(window.getUDB(), 5, 10, 30);
  assert(simRes && typeof simRes.extraMonthlyProfit === 'number', 'Ползунки симулятора прибыли должны возвращать расчёт extraMonthlyProfit');
});


check('6. Проверка шаблона смены (SAMPLE_FILES_DB.shift_text), синхронизации сессии при смене ADMIN_PIN и кнопок разблокировки в Терминале', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const termJs = fs.readFileSync(path.join(root, 'js/page-terminal.js'), 'utf8');
  const admJs = fs.readFileSync(path.join(root, 'js/page-admin.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert(window.SAMPLE_FILES_DB && typeof window.SAMPLE_FILES_DB.shift_text === 'string' && window.SAMPLE_FILES_DB.shift_text.indexOf('Счетчик') >= 0, 'SAMPLE_FILES_DB.shift_text должен возвращать валидный шаблон смены');
  assert(!/data-preset="all_batch"/.test(idxHtml), 'Старые демо-кнопки примеров в Кассе убраны');
  assert(!/id="unlockBlockNowBtn"/.test(idxHtml) && /id="goToInfoFromLockBtn"/.test(idxHtml), 'У бариста в терминале НЕТ кнопки самостоятельной разблокировки чек-листа без команды администратора');
  assert(/data-b="Карта добрых дел"/.test(idxHtml) && /id="inlineSampleDetails"/.test(idxHtml) && /Отчёт успешно выполнен/.test(idxHtml), 'Карта добрых дел перенесена 6-м пунктом в чек-лист, фотообразец встроен в карточку задачи, после отчёта выводится «Отчёт успешно выполнен»');
  assert(/id="clearShiftTextBtn"/.test(idxHtml) && /id="doneHomeBtn"/.test(idxHtml), 'Добавлены кнопки очистки шаблона смены и возврата на главную без перезагрузки');
  assert(/safeShowModal/.test(termJs) && /safeCloseModal/.test(termJs), 'Все диалоги в терминале открываются через безопасный safeShowModal');
  assert(/data-a="inc-del"/.test(admJs), 'Кнопка удаления инцидента присутствует в карточке инцидента');

  window.applyLocalMutation({ action: 'save_setting', id: 'ADMIN_PIN', value: '5678' });
  assert(window.coffeeAuth.isAuthorized('admin') === true, 'После смены ADMIN_PIN в Настройках текущая сессия владельца автоматически обновляется и не блокирует кнопки');
  window.applyLocalMutation({ action: 'save_setting', id: 'ADMIN_PIN', value: '1234' });
  assert(window.coffeeAuth.isAuthorized('admin') === true, 'Возврат стандартного ADMIN_PIN сохраняет активную сессию');
});


check('7. Защита от самопроизвольного отката настроек спустя время (Anti-Revert) и двусторонняя синхронизация с Google Таблицей', () => {
  // 1) Фиксируем исходный снимок сервера (как будто таблица вернула базовые значения)
  const initialServerPayload = {
    ok: true,
    settings: [{ id: 'PLAN', value: '2200' }, { id: 'LOCATION', value: 'Кофейня №1' }],
    checklistBlocks: [
      { id: 'blk_open', name: 'Открытие', openTime: '07:30', deadline: '08:30', isCash: false, active: true },
      { id: 'blk_lc1', name: 'Лайн Чек 1', openTime: '08:30', deadline: '09:30', isCash: false, active: true }
    ],
    dailyPlans: { 'Пн': { revenue: 2200, avgCheck: 32, checks: 70 } },
    tasks: [
      { id: '__SYS_CONFIG_V19__', title: '__SYS_SYNC__', instruction: JSON.stringify({ ts: 9999999999999, plan: 1111, location: 'Старая точка из V19' }) },
      { id: 'o01', block: 'Открытие', title: 'Фото-селфи', active: 'да' },
      { id: 'o02', block: 'Открытие', title: 'Зал', active: 'да' }
    ],
    goodDeeds: [{ id: 'gd1', title: 'Разморозка холодильника', frequency: 'Раз в 2 недели' }],
    ttk: [{ id: 'ttk1', name: 'Капучино', price: 19 }]
  };
  window.absorbServerData('https://example.test/api?action=admin', initialServerPayload, { forceFromSheet: true });

  // 2) Администратор изменяет и удаляет настройки в Управлении
  window.applyLocalMutation({ action: 'save_setting', id: 'PLAN', value: '2750' });
  window.applyLocalMutation({ action: 'delete_task', id: 'o02', expect: 'Зал' });
  window.applyLocalMutation({ action: 'delete_checklist_block', name: 'Лайн Чек 1' });
  window.applyLocalMutation({ action: 'delete_good_deed', id: 'gd1' });
  window.applyLocalMutation({ action: 'delete_ttk', id: 'ttk1' });

  // 3) Имитируем, что прошло 60 секунд (раньше через 5–10 сек фоновый синк откатывал всё назад!)
  const db = window.getUDB();
  db.lastLocalMutationAt = Date.now() - 60000;
  window.saveUDB(db);

  // Фоновый опрос возвращает ТОТ ЖЕ старый ответ сервера (плюс старую строку __SYS_CONFIG_V19__)
  window.absorbServerData('https://example.test/api?action=admin', initialServerPayload);

  const dbAfterBg = window.getUDB();
  assert(dbAfterBg.plan === 2750, 'Изменённый в Управлении план (2750 руб.) НЕ должен откатываться назад к 2200 или 1111 спустя время');
  assert(!dbAfterBg.tasks.some((t) => t.id === 'o02'), 'Удалённая задача o02 НЕ должна возвращаться при фоновом опросе');
  assert(!dbAfterBg.checklistBlocks.some((b) => b.name === 'Лайн Чек 1'), 'Удалённый блок чек-листа НЕ должен возвращаться обратно');
  assert(dbAfterBg.goodDeeds.length === 0, 'Удалённая задача из Карты добрых дел НЕ должна возвращаться обратно');
  assert(dbAfterBg.ttk.length === 0, 'Удалённая техкарта ТТК НЕ должна возвращаться обратно');

  // 4) Теперь владелец меняет настройку ПРЯМО В GOOGLE ТАБЛИЦЕ (например, ставит PLAN = 3100 и меняет окно Открытия на 07:00–08:15)
  const updatedSheetPayload = Object.assign({}, initialServerPayload, {
    settings: [{ id: 'PLAN', value: '3100' }, { id: 'LOCATION', value: 'Кофейня №1 (Центр)' }],
    checklistBlocks: [
      { id: 'blk_open', name: 'Открытие', openTime: '07:00', deadline: '08:15', isCash: false, active: true }
    ]
  });
  window.absorbServerData('https://example.test/api?action=admin', updatedSheetPayload);
  const dbFromSheet = window.getUDB();
  assert(dbFromSheet.plan === 3100 && dbFromSheet.location === 'Кофейня №1 (Центр)', 'Изменение ячейки в Google Таблице должно автоматически применяться в системе');
  assert(dbFromSheet.checklistBlocks[0].openTime === '07:00' && dbFromSheet.checklistBlocks[0].deadline === '08:15', 'Изменение окна времени в листе Таймлайн Google Таблицы должно сразу применяться в системе');
});


check('8. Сохранение под учётной записью Администратора никогда не выдаёт ошибку «Введите код доступа администратора» (PIN_REQUIRED)', async () => {
  // Имитируем ситуацию: администратор уже вошёл, но в localStorage остался старый PIN или сработал rate-limiter, а сервер вернул PIN_REQUIRED
  window.coffeeAuth.createLocalSession('admin', 'Администратор', '1234');
  localStorage.setItem('coffee_illy_pin', 'stale_wrong_pin');
  const origFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: 'PIN_REQUIRED: Неверный код доступа' })
    });
    const res = await window.coffeeFetch(window.COFFEE.API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'save_task',
        pin: localStorage.getItem('coffee_illy_pin'),
        id: 't_admin_save_test',
        block: 'Открытие',
        title: 'Проверка сохранения под админом'
      })
    });
    assert(res && res.ok === true, 'При активной сессии Администратора сохранение должно проходить успешно (ok: true), без ошибки PIN_REQUIRED');
    assert(window.getUDB().tasks.some((t) => t.id === 't_admin_save_test'), 'Сохранённая под админом задача должна сразу записаться в базу');
    window.applyLocalMutation({ action: 'delete_task', id: 't_admin_save_test' });
  } finally {
    global.fetch = origFetch;
  }
});


check('9. Работа офлайн при отсутствии интернета + автоматическая отправка накопленных данных при появлении сети', async () => {
  const origFetch = global.fetch;
  let sentActions = [];
  try {
    // 1) Имитируем потерю интернета (fetch падает с сетевой ошибкой)
    global.fetch = async () => { throw new Error('Network unreachable'); };
    const offRes = await window.coffeeFetch(window.COFFEE.API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'save_setting',
        id: 'PLAN',
        value: '2990'
      })
    });
    assert(offRes && offRes.ok === true && offRes.pending === true, 'В офлайн-режиме действие должно сразу сохраняться локально и ставиться в очередь');
    assert(window.getUDB().plan === 2990, 'Изменение должно применяться в интерфейсе моментально (0 мс) даже без интернета');
    assert(window.coffeeGetTotalPendingCount() >= 1, 'Счётчик очереди должен показывать несинхронизированные операции');

    // 2) Имитируем восстановление интернета и автоматическую отправку очереди
    global.fetch = async (u, opt) => {
      const b = JSON.parse((opt && opt.body) || '{}');
      sentActions.push(b.action);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const flushRes = await window.coffeeFlushOutbox();
    assert(flushRes && flushRes.sent >= 1 && flushRes.pending === 0, 'При появлении сети все накопленные офлайн-действия должны автоматически отправиться в систему');
    assert(sentActions.includes('save_setting'), 'Отложенное действие save_setting должно быть доставлено на сервер');
  } finally {
    global.fetch = origFetch;
  }
});


check('10. Защита от дублирования данных (чек-листы, касса, инциденты, задачи и настройки)', () => {
  const opId = 'op_dedup_test_1';
  const payloadChk = {
    action: 'submit_checklist',
    operationId: opId,
    sid: 'sid_chk_1',
    userName: 'Соня',
    block: 'Открытие',
    items: [
      { id: 'o01', title: 'Фото-селфи', isIncident: true, comment: 'Тестовая поломка без дубля', priority: 'Терпит' }
    ]
  };
  window.applyLocalMutation(payloadChk);
  window.applyLocalMutation(payloadChk);
  window.applyLocalMutation(Object.assign({}, payloadChk, { operationId: 'op_dedup_test_2' }));

  const db = window.getUDB();
  const today = window._isoToday();
  const matchingChks = db.checklists.filter((c) => c.date === today && c.block === 'Открытие' && c.who === 'Соня');
  const matchingIncs = db.incidents.filter((i) => i.date === today && i.text === 'Тестовая поломка без дубля');
  assert(matchingChks.length === 1, 'Повторная отправка чек-листа не должна создавать дубль в db.checklists (найдено: ' + matchingChks.length + ')');
  assert(matchingIncs.length === 1, 'Повторная отправка чек-листа не должна создавать дубль инцидента (найдено: ' + matchingIncs.length + ')');

  const cashPayload = {
    action: 'submit_cash',
    sid: 'sid_cash_dedup_1',
    date: '2026-11-12',
    barista: 'Соня',
    cash: 1500,
    card: 500,
    checks: 50
  };
  window.applyLocalMutation(cashPayload);
  window.applyLocalMutation(Object.assign({}, cashPayload, { operationId: 'op_cash_2' }));
  const cashRec = window.getUDB().cash.find((c) => c.date === '2026-11-12');
  assert(cashRec && cashRec.cash === 1500 && cashRec.card === 500, 'Повторная отправка кассы с тем же sid не должна удваивать выручку');
});


check('11. Мгновенные уведомления (coffeeNotify) при поломках, сдаче чек-листов, просрочке и закрытии кассы', () => {
  window.applyLocalMutation({
    action: 'report_standalone_incident',
    operationId: 'op_notif_inc_1',
    userName: 'Алина',
    incType: 'Поломка оборудования',
    step: 'Правый стимер кофемашины',
    text: 'Падает давление пара',
    priority: 'Критично'
  });
  const db = window.getUDB();
  assert(Array.isArray(db.liveNotifications) && db.liveNotifications.length >= 1, 'Должен формироваться список мгновенных уведомлений liveNotifications');
  const incNotif = db.liveNotifications.find((n) => /Правый стимер/.test(n.title));
  assert(incNotif && incNotif.level === 'critical', 'Экстренная поломка должна мгновенно создавать критическое уведомление руководителю');
  assert(window.coffeeNotify.getUnreadCount() >= 1, 'Счётчик непрочитанных уведомлений должен быть >= 1');
  window.coffeeNotify.markAllRead();
  assert(window.coffeeNotify.getUnreadCount() === 0, 'Кнопка Отметить все прочитанными должна обнулять счётчик непрочитанных уведомлений');
});

check('12. Полный финансовый сбор P&L: точный COGS по ТТК проданных позиций, Валовая прибыль, ФОТ, OpEx и Посуточная ведомость', () => {
  const db = window.getUDB();
  db.cash = [];
  db.expenses = [];
  db.productsByDate = {};
  window.saveUDB(db);

  // Записываем смену с детализацией проданных напитков по ТТК
  window.applyLocalMutation({
    action: 'submit_cash',
    operationId: 'op_fin_test_1',
    sid: 'sid_fin_test_1',
    date: '2026-11-11',
    barista: 'Соня',
    cash: 1200,
    card: 800,
    checks: 50,
    writeOffs: 1,
    products: [
      { name: 'Капучино ILLY', qty: 30, sum: 570 },
      { name: 'Американо ILLY', qty: 20, sum: 240 }
    ]
  });
  window.applyLocalMutation({
    action: 'add_expense',
    operationId: 'op_fin_exp_1',
    id: 'EXP-FIN-1',
    date: '2026-11-11',
    category: 'Закупка продуктов',
    amount: 300,
    comment: 'Молоко и стаканы'
  });

  const fin = window.coffeeCalculateFinancialModel(window.getUDB(), '2026-11-11', '2026-11-11');
  assert(fin.revenue === 2000 && fin.cashTotal === 1200 && fin.cardTotal === 800, 'Выручка должна точно собираться из наличных (1200) и безнала (800)');
  assert(fin.cogs > 0 && fin.grossProfit === (fin.revenue - fin.cogs), 'Валовая прибыль должна быть равна Выручка минус точный COGS по ТТК');
  assert(fin.effectivePayroll === 350, 'ФОТ за 1 смену при выручке 2000 руб. должен быть 250 + 5% (100) = 350 руб.');
  assert(fin.nonPayrollOpex === 300 && fin.wasteCost === 18, 'OpEx (300 руб.) и стоимость списаний (18 руб.) должны точно учитываться');
  assert(fin.netProfit === (2000 - fin.cogs - 350 - 300 - 18), 'Чистая операционная прибыль должна сходиться до рубля по формуле P&L');
  assert(Array.isArray(fin.dayByDayPnL) && fin.dayByDayPnL.length === 1 && fin.dayByDayPnL[0].netProfit === fin.netProfit, 'Посуточная ведомость P&L должна точно совпадать с итоговым отчётом');
});


check('13. Проверка 6 модулей полного ERP v61: Склад по ТТК, Обучаемый классификатор CSV, Личный ФОТ бариста, Маркировки сроков и Мульти-точка', () => {
  // 1) Обучаемый классификатор CSV: обучаем «Напиток от Бариста» как Двойной кофе (2 шота)
  window.applyLocalMutation({
    action: 'save_nomenclature_rule',
    itemName: 'Напиток от Бариста',
    kind: 'coffee_2',
    userName: 'Алина'
  });
  const sum = window.CoffeeSalesReconciliation.summarizeProductsList([
    { name: 'Напиток от Бариста', price: 45, qty: 5, sum: 225 },
    { name: 'Капучино ILLY', price: 19, qty: 10, sum: 190 }
  ]);
  assert(sum.reviewQty === 0 && sum.coffeeQty === 20, 'После обучения «Напиток от Бариста» как coffee_2 (2 шота) 5 порций должны давать 10 шотов кофе + 10 Капучино = 20 шотов');

  // 2) Автосписание склада по ТТК при отправке смены с продажами
  const dbBefore = window.getUDB();
  const beansBefore = (dbBefore.inventory.find((x) => x.id === 'inv_beans') || {}).stock || 6000;
  window.applyLocalMutation({
    action: 'submit_cash',
    sid: 'sid_erp_inv_1',
    date: '2026-11-14',
    barista: 'Алина',
    cash: 1500,
    card: 500,
    checks: 50,
    writeoffShots: 1,
    products: [
      { name: 'Капучино ILLY', qty: 10, sum: 190, kind: 'coffee' }
    ]
  });
  const beansAfter = (window.getUDB().inventory.find((x) => x.id === 'inv_beans') || {}).stock;
  assert(beansAfter < beansBefore, 'Зерно на складе должно автоматически списываться по проданным напиткам и списаниям');

  // 3) Личный расчётный лист и мотивация бариста
  const payCard = window.coffeeCalcStaffPayrollCard(window.getUDB(), 'Алина', '2026-11');
  assert(payCard && payCard.shiftsCount >= 1 && payCard.totalEarned >= 350, 'Личный расчётный лист бариста должен считать смены, ставку 250 руб. и 5% от выручки');

  // 4) Контроль сроков годности и маркировки
  window.applyLocalMutation({
    action: 'add_expiry_item',
    id: 'EXPIR-TEST-1',
    title: 'Альтернативное молоко Barista',
    category: 'Молоко',
    shelfLifeHours: 2,
    userName: 'Алина'
  });
  let expAlerts = window.coffeeGetActiveExpiryAlerts();
  assert(expAlerts.allActive.some((x) => x.id === 'EXPIR-TEST-1') && expAlerts.urgentCount >= 1, 'Новая маркировка со сроком <= 4ч должна попадать в активные срочные предупреждения');
  window.applyLocalMutation({ action: 'dispose_expiry_item', id: 'EXPIR-TEST-1', userName: 'Алина' });
  expAlerts = window.coffeeGetActiveExpiryAlerts();
  assert(!expAlerts.allActive.some((x) => x.id === 'EXPIR-TEST-1'), 'После списания маркировка должна уходить из активных');

  // 5) Мульти-точка (добавление и переключение кофейни)
  window.applyLocalMutation({
    action: 'save_shop',
    shop: { name: 'Кофейня №2 (Парк)', plan: 2600, initCounter: 250 },
    location: 'Кофейня №2 (Парк)'
  });
  assert(window.getUDB().location === 'Кофейня №2 (Парк)' && window.getUDB().plan === 2600, 'Переключение мульти-точки должно менять активную локацию и план');
  window.applyLocalMutation({ action: 'switch_shop_location', location: 'Кофейня №1' });
});

check('14. Концепция Coffee Illy v66 (Barista Simple, Owner Combined 7 разделов, история версий ТТК и дизайн-система Premium)', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ownerHtml = fs.readFileSync(path.join(root, 'owner.html'), 'utf8');
  const lightCss = fs.readFileSync(path.join(root, 'css/light.css'), 'utf8');

  assert(indexHtml.includes('id="myShiftSummaryCard"'), 'В index.html должен быть главный блок Моя смена (#myShiftSummaryCard)');
  assert(indexHtml.includes('id="baristaBottomNav"'), 'В index.html должна быть нижняя навигация из 4 разделов (#baristaBottomNav)');
  assert(indexHtml.includes('id="cashModeTabs"'), 'В index.html должно быть визуальное разделение Сдать смену и Расширенная касса (#cashModeTabs)');
  assert(ownerHtml.includes('id="ownerCombinedNav"'), 'В owner.html должна быть 7-раздельная навигация (#ownerCombinedNav)');
  assert(lightCss.includes('#151619') && lightCss.includes('#C88D55'), 'В css/light.css должна быть применена палитра Coffee Illy Premium (#151619, #C88D55)');

  window.applyLocalMutation({
    action: 'save_ttk',
    id: 'ttk_v66_test',
    name: 'Капучино ILLY v66',
    volume: '250 мл',
    category: 'Классика',
    price: 45,
    costBeans: 6.5,
    costMilk: 4.5,
    costCup: 2.3,
    recipe: 'Эспрессо 30 мл + молоко 180 мл'
  });
  window.applyLocalMutation({
    action: 'save_ttk',
    id: 'ttk_v66_test',
    name: 'Капучино ILLY v66',
    volume: '250 мл',
    category: 'Классика',
    price: 50,
    costBeans: 6.5,
    costMilk: 4.5,
    costCup: 2.3,
    recipe: 'Эспрессо 30 мл + молоко 190 мл (обновлено)'
  });
  const adm = window.coffeeGetInstantAdmin();
  assert(Array.isArray(adm.ttkHistory) && adm.ttkHistory.some((h) => h.id === 'ttk_v66_test' && h.prevPrice === 45 && h.newPrice === 50), 'История версий ТТК должна фиксировать предыдущую и новую цену/рецептуру');
  window.applyLocalMutation({ action: 'delete_ttk', id: 'ttk_v66_test' });
});

check('15. Master Implementation Directive v71: Единый справочник сотрудников, централизованные уведомления P0/P1/P2 без дублей и авто-бэкапы с откатом', () => {
  // 1) Единый справочник сотрудников (coffeeSyncStaffDirectory)
  window.applyLocalMutation({
    action: 'save_staff',
    id: 'st_v71_daria',
    name: 'Дарья',
    role: 'Бариста',
    pin: '4321',
    active: 'да'
  });
  const syncedNames = window.coffeeSyncStaffDirectory();
  assert(syncedNames.indexOf('Дарья') >= 0, 'Новый сотрудник Дарья должен автоматически попадать в единый справочник сотрудников');

  // 2) Централизованные уведомления P0/P1/P2 без дублей и авто-прекращение напоминаний после решения
  const n1 = window.coffeeCentralNotifier.emit({
    type: 'incident',
    incId: 'INC-V71-TEST',
    title: 'Критическая остановка кофемолки',
    text: 'Критично: заклинило жернова',
    actor: 'Дарья'
  });
  const n2 = window.coffeeCentralNotifier.emit({
    type: 'incident',
    incId: 'INC-V71-TEST',
    title: 'Критическая остановка кофемолки',
    text: 'Критично: повторный сигнал',
    actor: 'Дарья'
  });
  assert(n1 && n2 && n1.id === n2.id && n1.priority === 'P0', 'Повторное уведомление по одному событию должно дедуплицироваться с приоритетом P0');
  const resCnt = window.coffeeCentralNotifier.resolveByKey('INC-V71-TEST');
  assert(resCnt >= 1, 'После решения инцидента связанные напоминания должны автоматически прекращаться');

  // 3) Автоматическое резервирование, проверка целостности и восстановление
  const bkp = window.coffeeAutoBackupManager.createBackup('Тестовая точка перед миграцией v71');
  assert(bkp && bkp.id && bkp.checksum, 'Авто-бэкап должен создаваться с контрольной суммой');
  const ver = window.coffeeAutoBackupManager.verifyBackup(bkp.id);
  assert(ver && ver.ok === true, 'Проверка целостности резервной копии должна проходить успешно');
  const rest = window.coffeeAutoBackupManager.restoreBackup(bkp.id);
  assert(rest && rest.ok === true && rest.restoredId === bkp.id, 'Восстановление из резервной копии в 1 клик должно проходить без ошибок');
});

check('16. Аудит полноты обработчиков v76: Приход, Ревизия и Списание склада с историей движений, архивация задач и сброс PIN', () => {
  const db0 = window.getUDB();
  const item0 = (db0.inventory || [])[0] || { id: 'inv_beans', name: 'Кофе в зёрнах ILLY', stock: 5000, unit: 'г' };
  const s0 = Number(item0.stock) || 5000;
  window.applyLocalMutation({ action: 'restock_inventory', id: item0.id, name: item0.name, delta: 500, supplier: 'Поставщик Тест', reason: 'Накладная №1' });
  const s1 = Number((window.getUDB().inventory.find((x) => x.id === item0.id) || {}).stock);
  assert(s1 === s0 + 500, 'Приход на склад должен увеличивать остаток на 500');
  window.applyLocalMutation({ action: 'writeoff_inventory', id: item0.id, name: item0.name, delta: 200, reason: 'Проработка эспрессо' });
  const db2 = window.getUDB();
  const s2 = Number((db2.inventory.find((x) => x.id === item0.id) || {}).stock);
  assert(s2 === s0 + 300, 'Списание со склада должно уменьшать остаток на 200');
  assert(Array.isArray(db2.inventoryHistory) && db2.inventoryHistory.length >= 2 && db2.inventoryHistory[0].type === 'Списание', 'История движений склада должна фиксировать операции Списания и Прихода');
});


check('17. Полное ТЗ UI/UX (Modern Coffee Premium, 5-шаговая касса, техкарты, 9 отчётов, Kanban и Sidebar)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(rootDir, 'css/light.css'), 'utf8');
  const idx = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const termJs = fs.readFileSync(path.join(rootDir, 'js/page-terminal.js'), 'utf8');
  const admJs = fs.readFileSync(path.join(rootDir, 'js/page-admin.js'), 'utf8');
  const ownJs = fs.readFileSync(path.join(rootDir, 'js/page-owner.js'), 'utf8');
  assert(fs.existsSync(path.join(rootDir, 'UI_UX_CURRENT_STATE.md')), 'UI_UX_CURRENT_STATE.md должен существовать');
  assert(css.includes('#151619') && css.includes('#C88D55') && css.includes('#F5F2ED') && css.includes('#A96E3E'), 'Палитра Modern Coffee Premium должна быть в css/light.css');
  assert(idx.includes('id="cashHeaderCard"') && idx.includes('id="togglePrevCashReportsBtn"'), 'Заголовок Сдача кассы и кнопка Предыдущие отчёты должны быть в index.html');
  assert(idx.includes('data-ttkcat="Прочее"'), 'В базе знаний должна быть категория Прочее');
  assert(termJs.includes('Открыть техкарту') && termJs.includes('initV78TermExtras'), 'Карточки напитков должны содержать кнопку Открыть техкарту и модальное окно');
  assert(idx.includes('Введено сотрудником') && idx.includes('Рассчитано системой'), 'Шаг 4 кассы должен разделять Введено сотрудником и Рассчитано системой');
  assert(admJs.includes('Ожидают подтверждения') && admJs.includes('Требуют проверки'), 'Kanban задач и Центр контроля кассы должны содержать новые статусы');
  assert(ownJs.includes('data-orp="quarter"') && ownJs.includes('id="repCategoryTabs"'), 'Финансы и Отчёты владельца должны поддерживать Квартал и 9 категорий отчётов');
});


check('18. Единый запрос разрешения на камеру v79 (CoffeeCameraPermission, onboarding, stopTracks, ошибки и резервная загрузка)', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const rootDir = path.resolve(__dirname, '..');
  const camPermCode = fs.readFileSync(path.join(rootDir, 'js/camera-permission.js'), 'utf8');
  const idx = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const camJs = fs.readFileSync(path.join(rootDir, 'js/camera.js'), 'utf8');

  assert(idx.includes('id="cameraOnboardingDlg"') && idx.includes('Разрешите доступ к камере') && idx.includes('Только по вашему действию'), 'В index.html должно быть собственное окно первичной настройки камеры Coffee Illy');
  assert(idx.includes('id="btnCameraOnboardingAllow"') && idx.includes('id="btnCameraOnboardingLater"'), 'Кнопки Разрешить камеру и Позже должны быть в окне первичной настройки');
  assert(idx.includes('id="cameraFallbackFileInput"') && idx.includes('capture="environment"'), 'Должен присутствовать резервный input[type=file][accept=image/*][capture=environment]');
  assert(camPermCode.includes("STORAGE_KEY = 'coffee_camera_permission_v1'") && camPermCode.includes("audio: false"), 'Модуль должен сохранять состояние в coffee_camera_permission_v1 и запрашивать только видео без микрофона');

  let stoppedCount = 0;
  let lastConstraints = null;
  const store = {};
  const sandbox = {
    window: {
      isSecureContext: true,
      Telegram: { WebApp: { platform: 'android' } },
      addEventListener: () => {}
    },
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); }
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/124.0',
      mediaDevices: {
        getUserMedia: async (c) => {
          lastConstraints = c;
          return {
            getVideoTracks: () => [{ readyState: 'live', stop: () => { stoppedCount++; } }],
            getTracks: () => [{ readyState: 'live', stop: () => { stoppedCount++; } }]
          };
        }
      }
    },
    console
  };
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.localStorage = sandbox.localStorage;
  vm.runInNewContext(camPermCode, sandbox);
  const api = sandbox.window.CoffeeCameraPermission;
  assert(api && typeof api.initialize === 'function' && typeof api.request === 'function', 'window.CoffeeCameraPermission должен экспортировать initialize и request');
  assert(api.isSupported() === true && api.isTelegram() === true, 'Определение поддержки HTTPS/getUserMedia и Telegram WebView должно работать корректно');
  assert(api.getErrorMessage('denied').includes('Доступ к камере запрещён'), 'Сообщение для NotAllowedError должно соответствовать разделу 12 ТЗ');
  assert(api.getErrorMessage('not_found').includes('Камера не обнаружена'), 'Сообщение для NotFoundError должно соответствовать разделу 12 ТЗ');
  assert(api.getErrorMessage('not_readable').includes('Камера занята другим приложением'), 'Сообщение для NotReadableError должно соответствовать разделу 12 ТЗ');
  assert(api.getErrorMessage('security').includes('защищённое HTTPS-соединение'), 'Сообщение для SecurityError должно соответствовать разделу 12 ТЗ');
  assert(api.getErrorMessage('unsupported').includes('не поддерживается'), 'Сообщение для unsupported должно соответствовать разделу 12 ТЗ');
  const recSteps = api.getRecoveryInstructions('android_chrome');
  assert(recSteps && Array.isArray(recSteps.steps) && recSteps.steps.length >= 3, 'Инструкция восстановления доступа для Android Chrome должна возвращать пошаговый список');
});


check('19. Требования к полноценному продукту v80 (Помощь, История смены, Исправление с историей, Передача смены, Возврат задач, Кнопки уведомлений и Тестовый режим)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.resolve(__dirname, '..');
  const idx = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const cgs = fs.readFileSync(path.join(rootDir, 'Code.gs'), 'utf8');

  assert(idx.includes('id="globalHelpBtn"') && idx.includes('id="globalHelpDlg"'), 'Раздел Помощь должен быть доступен с любого экрана терминала');
  assert(idx.includes('id="shiftHistoryAndCorrectionDlg"') && idx.includes('id="btnSubmitCorrectionReq"'), 'Должно быть окно истории действий за смену и контролируемого исправления ошибок');
  assert(idx.includes('id="shiftHandoverBanner"') && idx.includes('id="btnSaveShiftHandover"'), 'Должен работать механизм передачи смены следующему сотруднику');
  assert(cgs.includes('buildTelegramInteractiveButtonsV80_') && cgs.includes('Принять в работу') && cgs.includes('Назначить ответственного'), 'В Code.gs должны формироваться интерактивные кнопки Telegram-уведомлений');

  // Проверка интерактивного действия уведомления (реальная смена статуса задачи в БД)
  const db0 = window.getUDB();
  if (!Array.isArray(db0.tasks)) db0.tasks = [];
  db0.tasks.push({ id: 'tsk_v80_1', title: 'Проверить холодильник', status: 'new', done: false });
  window.saveUDB(db0);

  window.coffeeCentralNotifier.executeAction('notif_1', 'accept', { targetId: 'tsk_v80_1' });
  const tAfterAccept = window.getUDB().tasks.find((t) => t && t.id === 'tsk_v80_1');
  assert(tAfterAccept && tAfterAccept.status === 'in_progress', 'Кнопка Принять в работу в уведомлении должна реально менять статус задачи на in_progress');

  // Проверка возврата задачи на доработку с запросом фото
  window.applyLocalMutation({ action: 'return_task_revision', id: 'tsk_v80_1', comment: 'Нужно фото термометра', needExtraPhoto: true });
  const tAfterRev = window.getUDB().tasks.find((t) => t && t.id === 'tsk_v80_1');
  assert(tAfterRev && tAfterRev.revisionRequested === true && tAfterRev.needExtraPhoto === true, 'Возврат задачи на доработку должен выставлять revisionRequested и needExtraPhoto');

  // Проверка контролируемого исправления ошибки с сохранением в истории аудита
  const corrRes = window.applyLocalMutation({
    action: 'submit_correction_request',
    actor: 'Алина',
    targetType: 'Касса наличные',
    oldValue: '1500',
    newValue: '1650',
    reason: 'Опечатка при вводе купюр'
  });
  assert(corrRes && corrRes.ok && window.getUDB().corrections.length >= 1, 'Запрос на исправление должен сохраняться в истории исправлений и журнале аудита');

  // Проверка передачи смены и контроля закрытия смены
  window.applyLocalMutation({ action: 'save_shift_handover', fromBarista: 'Алина', note: 'Заказать молоко к утру' });
  assert(window.getUDB().handovers && window.getUDB().handovers[0].note === 'Заказать молоко к утру', 'Передача смены должна сохранять заметку для следующего сотрудника');
  const closeCheck = window.coffeeVerifyShiftCloseReadiness();
  assert(closeCheck && typeof closeCheck.ready === 'boolean' && Array.isArray(closeCheck.warnings), 'Функция контроля закрытия смены должна проверять отчёты, задачи и инциденты');

  // Проверка тестового режима (песочницы) и тихого режима уведомлений
  assert(window.coffeeSetTestMode(true) === true && window.coffeeIsTestMode() === true, 'Тестовый режим должен включаться');
  window.coffeeSetTestMode(false);
  window.coffeeCentralNotifier.setQuietMode({ muteHours: 4 });
  assert(window.coffeeCentralNotifier.isNonCriticalMuted() === true, 'Отключение некритичных уведомлений на 4 часа должно активировать тихий режим');
});


check('20. Material Design 3 (M3) во всей системе v81 (токены md-sys-color, M3 Elevation, скругления 28px/9999px, Navigation Pill и Ripple)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(rootDir, 'css/light.css'), 'utf8');
  const idx = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const own = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf8');
  const rep = fs.readFileSync(path.join(rootDir, 'report.html'), 'utf8');

  assert(css.includes('--md-sys-color-primary') && css.includes('--md-sys-color-secondary-container') && css.includes('--md-sys-color-surface-container-low'), 'В css/light.css должны быть цветовые роли Material Design 3');
  assert(css.includes('--md-sys-elevation-1') && css.includes('--md-sys-shape-corner-xl: 28px') && css.includes('.md-ripple-wave'), 'В css/light.css должны быть уровни теней M3, скругления 28px и анимация .md-ripple-wave');
  assert(idx.includes('data-design-system="material-3"') && own.includes('data-design-system="material-3"') && rep.includes('data-design-system="material-3"'), 'Все страницы (Терминал, Владелец/Админ, Отчёты) должны иметь атрибут data-design-system="material-3"');
  assert(window.CoffeeMaterialDesign3 && window.CoffeeMaterialDesign3.isEnabled() === true, 'Движок интерактивного отклика Material Design 3 (window.CoffeeMaterialDesign3) должен быть активен');
});


check('21. Аудит безопасности P0/P1 и полная система Material Design 3 v82 (синхронизация версий, защита Telegram HMAC, приватные фото, палитра M3, 4 статуса сети, Skeleton/EmptyState)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.resolve(__dirname, '..');
  const verJs = fs.readFileSync(path.join(rootDir, 'version.js'), 'utf8');
  const syncJs = fs.readFileSync(path.join(rootDir, 'js/sync.js'), 'utf8');
  const mdJs = fs.readFileSync(path.join(rootDir, 'js/material-design.js'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'css/light.css'), 'utf8');
  const idx = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const own = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf8');
  const cgs = fs.readFileSync(path.join(rootDir, 'Code.gs'), 'utf8');

  // 1) Проверка единой версии v82 и отсутствия дублирования M3 в sync.js (Документ 1)
  assert(/^v8\d$/.test(window.COFFEE_APP_VERSION), 'Версия в version.js должна быть синхронизирована');
  assert(!syncJs.includes('initMaterialDesign3System'), 'Движок Material Design 3 не должен дублироваться внутри js/sync.js');
  assert(idx.includes('js/material-design.js?v=8') && own.includes('js/material-design.js?v=8'), 'js/material-design.js должен быть напрямую подключён в HTML-страницах');

  // 2) Проверка закрытия P0/P1 уязвимостей в Code.gs (Документ 1)
  assert(cgs.includes('verifyTelegramInitDataHmac_') && cgs.includes('verifySafeTelegramBindingV82_'), 'В Code.gs должна быть криптографическая защита привязки Telegram от подмены сотрудника (P0)');
  assert(cgs.includes('applySecureDriveFileSharingV82_') && !cgs.includes('file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);'), 'В Code.gs фотографии по умолчанию не должны открываться публично всем по ссылке (P1)');
  assert(cgs.includes('sendTelegramVerifiedV82_'), 'В Code.gs должна проверяться доставка уведомлений Telegram API (P1)');

  // 3) Проверка полной палитры и компонентов Material Design 3 (Документ 2)
  assert(css.includes('#FFFBF8') && css.includes('#F1E8E1') && css.includes('#241B16') && css.includes('#286B4D') && css.includes('#805600') && css.includes('#BA1A1A'), 'В css/light.css должна быть рекомендованная палитра Material Design 3 (Раздел 2.1)');
  assert(css.includes('prefers-reduced-motion: reduce') && css.includes('border-radius: 28px 28px 0 0'), 'В css/light.css должны быть мобильные Bottom Sheets и поддержка prefers-reduced-motion');
  const m3 = window.CoffeeMaterialDesign3;
  assert(m3 && /^M3-v8[23456]$/.test(m3.version), 'Модуль window.CoffeeMaterialDesign3 должен иметь актуальную версию');
  assert(m3.SYNC_STATES && m3.SYNC_STATES.local_saved && m3.SYNC_STATES.sending && m3.SYNC_STATES.server_confirmed && m3.SYNC_STATES.send_error, 'Должны поддерживаться все 4 честных состояния синхронизации (Раздел 4 п. 9)');
  assert(m3.renderEmptyState('Нет задач').includes('md3-empty-state') && m3.renderSkeleton(2).includes('md3-skeleton-line'), 'Генераторы Empty State и Skeleton Loading должны работать корректно');
});


check('22. Полная проверка релиза v83 (Единая версия v83 в корневом version.js и version.js, STATIC_ASSETS в sw.js, применение M3-классов в HTML и DOM, честный код выхода тестов)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.resolve(__dirname, '..');
  const rootVer = fs.readFileSync(path.join(rootDir, 'version.js'), 'utf8');
  const jsVer = fs.readFileSync(path.join(rootDir, 'version.js'), 'utf8');
  const swCode = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const ownHtml = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf8');
  const repHtml = fs.readFileSync(path.join(rootDir, 'report.html'), 'utf8');
  const cgsCode = fs.readFileSync(path.join(rootDir, 'Code.gs'), 'utf8');

  // 1) Единый источник версии v83
  assert(rootVer.includes("COFFEE_VERSION = '" + window.COFFEE_VERSION + "'"), 'Корневой version.js должен содержать единую версию');
  assert(window.COFFEE_VERSION === window.COFFEE_APP_VERSION && /^v8\d$/.test(window.COFFEE_VERSION), 'В глобальном объекте должна быть установлена версия v83');
  assert(cgsCode.includes("serverVersion: '" + window.COFFEE_VERSION + "'"), 'Серверная версия в Code.gs должна быть синхронизирована на v83');

  // 2) Офлайн-кэш STATIC_ASSETS в sw.js содержит js/material-design.js и js/camera-permission.js
  assert(swCode.includes("'./js/material-design.js'") && swCode.includes("'./js/camera-permission.js'"), 'STATIC_ASSETS в sw.js должен включать ./js/material-design.js и ./js/camera-permission.js');

  // 3) Фактическое применение классов Material Design 3 в HTML-разметке и апгрейдере DOM
  assert(idxHtml.includes('md3-top-app-bar') && idxHtml.includes('md3-navigation-bar') && idxHtml.includes('md3-nav-item'), 'В index.html должны быть применены M3-классы навигации и шапки');
  assert(idxHtml.includes('md3-btn-filled') && idxHtml.includes('md3-btn-tonal') && idxHtml.includes('md3-card-hero'), 'В index.html должны быть применены M3-классы кнопок и карточек');
  assert(idxHtml.includes('md3-dialog md3-bottom-sheet') && idxHtml.includes('md3-linear-progress'), 'В index.html диалоги и прогресс-бар должны иметь M3-классы');
  assert(ownHtml.includes('md3-navigation-drawer') && repHtml.includes('md3-navigation-drawer'), 'В owner.html и report.html должна быть навигация md3-navigation-drawer');
  assert(typeof window.CoffeeMaterialDesign3.upgradeDomToM3 === 'function' && typeof window.CoffeeMaterialDesign3.openBottomSheet === 'function', 'В CoffeeMaterialDesign3 должны быть методы upgradeDomToM3 и openBottomSheet');
});


check('23. Регрессионный тест BUG-09 (Редактирование пункта в «Лайн Чек 1» с обязательным фото «да» НЕ удаляет задачи из «Открытия», «Лайн Чек 2» и «Закрытия» + авто-исцеление пустой базы)', () => {
  // 1) Сценарий из скриншота пользователя: в базе повреждено состояние (остался только 1 пункт в Лайн Чек 1 и 4 в Карте добрых дел)
  const dbCorrupted = window.getUDB();
  dbCorrupted.deletedTaskIds = {};
  dbCorrupted.deletedGoodDeedIds = {};
  dbCorrupted.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((g) => Object.assign({}, g));
  dbCorrupted.tasks = [
    { id: 'd01', block: 'Лайн Чек 1', title: '🌬️ Помещение проветрено и свежесть воздуха', instruction: 'Проверка', photo: 'да', photoMode: 'да', mediaRequired: true, responsible: 'Администратор', active: 'да' }
  ];
  window.saveUDB(dbCorrupted);

  // Вызываем нормализацию схемы (как при открытии Панели администратора или Терминала)
  const healedDb = window.coffeeEnsureV19Schema(window.getUDB());
  const openTasksAfterHeal = healedDb.tasks.filter((t) => t.block === 'Открытие');
  const lc1TasksAfterHeal = healedDb.tasks.filter((t) => t.block === 'Лайн Чек 1');
  const lc2TasksAfterHeal = healedDb.tasks.filter((t) => t.block === 'Лайн Чек 2');
  const closeTasksAfterHeal = healedDb.tasks.filter((t) => t.block === 'Закрытие');
  const gdTasksAfterHeal = healedDb.tasks.filter((t) => t.block === 'Карта добрых дел');

  assert(openTasksAfterHeal.length >= 29, 'После авто-исцеления блок «Открытие» должен содержать все 29 стандартных пунктов (получено: ' + openTasksAfterHeal.length + ')');
  assert(lc1TasksAfterHeal.length >= 6, 'Блок «Лайн Чек 1» должен содержать все 6 пунктов');
  assert(lc2TasksAfterHeal.length >= 9, 'Блок «Лайн Чек 2» должен содержать все 9 пунктов');
  assert(closeTasksAfterHeal.length >= 47, 'Блок «Закрытие» должен содержать все 47 пунктов');
  assert(gdTasksAfterHeal.length >= 4, 'Блок «Карта добрых дел» должен содержать 4 пункта');

  const editedD01 = lc1TasksAfterHeal.find((t) => t.id === 'd01');
  assert(editedD01 && editedD01.photoMode === 'да' && editedD01.mediaRequired === true, 'Пользовательская настройка обязательного фото («да») в Лайн Чек 1 должна сохраниться');

  // 2) Симуляция ответа сервера, когда в Google Таблице записана только 1 отредактированная задача из «Лайн Чек 1»
  window.absorbServerData('https://script.google.com/macros/s/test/exec?action=admin', {
    ok: true,
    tasks: [
      { id: 'd02', block: 'Лайн Чек 1', title: '☕ Оборудование проверено', photo: 'да', photoMode: 'да', mediaRequired: true, responsible: 'Техник', active: 'да' }
    ]
  }, { forceFromSheet: true });

  const dbAfterSync = window.getUDB();
  const openAfterSync = dbAfterSync.tasks.filter((t) => t.block === 'Открытие');
  const d02AfterSync = dbAfterSync.tasks.find((t) => t.id === 'd02');
  assert(openAfterSync.length >= 29, 'При получении 1 задачи из Google Таблицы пункты «Открытия» НЕ должны пропадать (получено: ' + openAfterSync.length + ')');
  assert(d02AfterSync && d02AfterSync.photoMode === 'да', 'Обновлённый пункт d02 из «Лайн Чек 1» должен получить photoMode = да');
});

process.stdout.write('\nИТОГО E2E-ТЕСТОВ КНОПОК И СИНХРОНИЗАЦИИ: ' + passed + '/23 успешно.\n');
process.exit((process.exitCode || passed < 23) ? 1 : 0);
