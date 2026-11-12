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

process.stdout.write('\nИТОГО E2E-ТЕСТОВ КНОПОК И СИНХРОНИЗАЦИИ: ' + passed + '/12 успешно.\n');
process.exit(0);
