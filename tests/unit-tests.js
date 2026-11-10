/* =========================================================================
   АВТОМАТИЧЕСКИЕ UNIT-ТЕСТЫ И АУДИТ БЕЗОПАСНОСТИ (tests/unit-tests.js — v21)
   Проверяет расчёты кассы, планы по дням недели (Пн–Вс), контроль просрочек таймлайна,
   детектор «Красных флагов» робота, поэлементную дельта-синхронизацию (Set-Union & Tombstones),
   SHA-256 хеширование PIN, блокировку после 5 попыток (Rate-Limiting) и защиту от XSS.
   Запускается как в браузере (Управление -> Настройки), так и в CLI: `node tests/unit-tests.js`
   ========================================================================= */
(function (root) {
  'use strict';

  // Поддержка запуска в Node.js (CLI)
  if (typeof window === 'undefined' && typeof global !== 'undefined') {
    global.window = global;
    const memStore = {};
    const mockStorage = {
      getItem(k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
      setItem(k, v) { memStore[k] = String(v); },
      removeItem(k) { delete memStore[k]; }
    };
    global.localStorage = mockStorage;
    global.sessionStorage = mockStorage;
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const baseDir = path.resolve(__dirname, '..');
    ['config.js', 'js/defaults.js', 'js/security.js', 'js/storage.js', 'js/analytics.js', 'js/sync.js', 'js/telegram.js'].forEach((rel) => {
      const code = fs.readFileSync(path.join(baseDir, rel), 'utf8');
      vm.runInThisContext(code, { filename: rel });
    });
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
  }

  const tests = [
    {
      name: '1. План выручки, среднего чека и транзакций по дням недели (Пн–Вс)',
      fn() {
        const db = {
          plan: 2500,
          dailyPlans: {
            'Пн': { revenue: 2200, avgCheck: 32, checks: 70 },
            'Пт': { revenue: 2800, avgCheck: 36, checks: 85 },
            'Сб': { revenue: 3000, avgCheck: 38, checks: 90 }
          }
        };
        // 2026-11-09 — Понедельник (Пн), 2026-11-13 — Пятница (Пт), 2026-11-14 — Суббота (Сб)
        const pMon = window.coffeeGetDayPlan('2026-11-09', db);
        const pFri = window.coffeeGetDayPlan('2026-11-13', db);
        const pSat = window.coffeeGetDayPlan('2026-11-14', db);
        assert(pMon.dayCode === 'Пн' && pMon.revenue === 2200 && pMon.avgCheck === 32 && pMon.checks === 70, 'План Пн (ПМР) должен быть 2200 руб. / ср. чек 32 руб. / 70 чеков');
        assert(pFri.dayCode === 'Пт' && pFri.revenue === 2800 && pFri.avgCheck === 36, 'План Пт (ПМР) должен быть 2800 руб. / 36 руб.');
        assert(pSat.dayCode === 'Сб' && pSat.revenue === 3000 && pSat.checks === 90, 'План Сб (ПМР) должен быть 3000 руб. / 90 чеков');
      }
    },
    {
      name: '2. Касса: суммирование смен двух бариста за один день (mergeMode: sum)',
      fn() {
        const db = { cash: [], settings: [] };
        window.mergeOrSaveCashDay(db, {
          date: '2026-11-10',
          barista: 'Соня',
          cash: 800,
          card: 1200,
          checks: 50,
          writeoff: 5,
          coffeeCups: 42,
          mergeMode: 'sum'
        });
        window.mergeOrSaveCashDay(db, {
          date: '2026-11-10',
          barista: 'Алина',
          cash: 600,
          card: 900,
          checks: 40,
          writeoff: 3,
          coffeeCups: 35,
          mergeMode: 'sum'
        });
        const rec = db.cash.find((x) => x.date === '2026-11-10');
        assert(rec, 'Запись за 2026-11-10 должна существовать');
        assert(rec.cash === 1400 && rec.card === 2100 && (rec.cash + rec.card) === 3500, 'Выручка двух смен должна суммироваться (1400 + 2100 = 3500)');
        assert(rec.checks === 90 && rec.writeoff === 8, 'Чеки (90) и списания (8) должны суммироваться');
        assert(rec.shifts.length === 2, 'Должны сохраниться обе смены (Соня и Алина)');
      }
    },
    {
      name: '3. Касса: режим перезаписи дня администратором (mergeMode: replace)',
      fn() {
        const db = { cash: [], settings: [] };
        window.mergeOrSaveCashDay(db, { date: '2026-11-10', barista: 'Соня', cash: 1000, card: 1000, checks: 50, mergeMode: 'sum' });
        window.mergeOrSaveCashDay(db, { date: '2026-11-10', barista: 'Администратор', cash: 1500, card: 2000, checks: 85, mergeMode: 'replace' });
        const rec = db.cash.find((x) => x.date === '2026-11-10');
        assert((rec.cash + rec.card) === 3500 && rec.checks === 85 && rec.shifts.length === 1, 'В режиме replace запись дня должна заменяться');
      }
    },
    {
      name: '4. Таймлайн чек-листов: 5 регламентных окон (Открытие, Лайн Чек 1/2, Закрытие, Касса)',
      fn() {
        const db = {};
        const blocks = window.coffeeGetChecklistBlocks(db);
        const names = blocks.map((b) => b.name);
        assert(names.includes('Открытие') && names.includes('Лайн Чек 1') && names.includes('Лайн Чек 2') && names.includes('Закрытие') && names.includes('Касса'), 'Все 5 окон таймлайна должны присутствовать');
        const lc2 = blocks.find((b) => b.name === 'Лайн Чек 2');
        assert(lc2.openTime === '14:00' && lc2.deadline === '16:00', 'Окно Лайн Чек 2 должно быть 14:00–16:00');
      }
    },
    {
      name: '5. Контроль просрочки дедлайна и ручное продление окна администратором',
      fn() {
        const today = window._isoToday();
        const db = {
          checklistBlocks: [
            { id: 'blk_open', name: 'Открытие', openTime: '00:01', deadline: '00:02', isCash: false, active: true }
          ],
          checklistSubmissions: [],
          deadlineExtensions: {}
        };
        const wClosed = window.coffeeGetBlockWindow('Открытие', db);
        assert(wClosed.isOverdue === true && wClosed.canPass === false && wClosed.state === 'overdue_closed', 'После дедлайна 00:02 окно должно блокироваться');
        db.deadlineExtensions[today + ':Открытие'] = { until: '23:59', forceOpen: true, reason: 'Тест продления' };
        const wExtended = window.coffeeGetBlockWindow('Открытие', db);
        assert(wExtended.extended === true && wExtended.canPass === true && wExtended.state === 'open', 'После продления дедлайна до 23:59 доступ должен открыться');
      }
    },
    {
      name: '6. Робот «Красные флаги»: детекция расхождения наличных по бумажному отчёту и Z-отчёту',
      fn() {
        const db = {
          settings: [{ id: 'COFFEE_DELTA_NORM', value: '4' }],
          cash: [{
            date: '2026-11-10',
            cash: 1200,
            card: 1800,
            zTotal: 2750,
            checks: 110,
            writeoff: 5
          }]
        };
        const flags = window.coffeeEvaluateRedFlags('2026-11-10', db);
        const cashFlag = flags.find((f) => f.level === 'red' && /кассе|наличным/i.test(f.title));
        assert(cashFlag, 'При расхождении кассы 3000 vs Z-отчёт 2750 должен сработать красный флаг');
      }
    },
    {
      name: '7. Робот «Красные флаги»: детекция дельты счётчика кофемашины с учётом сезонной погрешности',
      fn() {
        const db = {
          settings: [{ id: 'COFFEE_DELTA_NORM', value: '4' }],
          cash: [{
            date: '2026-11-10',
            cash: 1000,
            card: 1600,
            zTotal: 2600,
            checks: 100,
            writeoff: 2,
            shifts: [
              { barista: 'Соня', prevCounter: 1000, counter: 1120, cups: 95, writeoff: 2 }
            ]
          }]
        };
        const flags = window.coffeeEvaluateRedFlags('2026-11-10', db);
        const counterFlag = flags.find((f) => f.level === 'red' && /счётчик кофемашины/i.test(f.title));
        assert(counterFlag, 'При дельте проливов 23 порции (> порога 4) должен сработать красный флаг счётчика');
      }
    },
    {
      name: '8. Поэлементная дельта-синхронизация: параллельные правки двух бариста не затирают друг друга',
      fn() {
        const phoneA = [
          { id: 'INC-1', step: 'Кофемолка', status: 'Принята в работу', updatedAt: 2000 },
          { id: 'INC-2', step: 'Льдогенератор', status: 'Новая проблема', updatedAt: 1000 }
        ];
        const phoneB = [
          { id: 'INC-1', step: 'Кофемолка', status: 'Новая проблема', updatedAt: 1000 },
          { id: 'INC-2', step: 'Льдогенератор', status: 'Решена', updatedAt: 3000 },
          { id: 'INC-3', step: 'Холодильник', status: 'Новая проблема', updatedAt: 2500 }
        ];
        const merged = window.coffeeMergeRecordLists(phoneA, phoneB, 'id');
        const m1 = merged.find((x) => x.id === 'INC-1');
        const m2 = merged.find((x) => x.id === 'INC-2');
        const m3 = merged.find((x) => x.id === 'INC-3');
        assert(m1.status === 'Принята в работу', 'INC-1 должен сохранить более свежий статус с телефона А (updatedAt: 2000)');
        assert(m2.status === 'Решена', 'INC-2 должен получить более свежий статус с телефона Б (updatedAt: 3000)');
        assert(m3 && m3.step === 'Холодильник', 'INC-3 с телефона Б должен добавиться без потери');
      }
    },
    {
      name: '9. Поэлементная дельта-синхронизация: Set-Union для отметок «Ознакомлен» (acks / readBy)',
      fn() {
        const dev1 = [{
          id: 'ann_1',
          title: 'Новое меню',
          updatedAt: 1000,
          readBy: ['Соня'],
          acks: [{ staff: 'Соня', name: 'Соня', at: '10:00' }]
        }];
        const dev2 = [{
          id: 'ann_1',
          title: 'Новое меню',
          updatedAt: 1050,
          readBy: ['Алина'],
          acks: [{ staff: 'Алина', name: 'Алина', at: '10:01' }]
        }];
        const merged = window.coffeeMergeRecordLists(dev1, dev2, 'id');
        assert(merged[0].readBy.includes('Соня') && merged[0].readBy.includes('Алина'), 'Обе отметки readBy (Соня и Алина) должны объединиться');
        assert(merged[0].acks.length === 2, 'Оба подтверждения acks должны сохраниться');
      }
    },
    {
      name: '10. Поэлементная дельта-синхронизация: корректное удаление через Tombstone (deleted: true)',
      fn() {
        const local = [
          { id: 't1', title: 'Задача 1', updatedAt: 1000 },
          { id: 't2', title: 'Задача 2', updatedAt: 1000 }
        ];
        const remote = [
          { id: 't1', deleted: true, updatedAt: 2000 }
        ];
        const tombstones = {};
        const merged = window.coffeeMergeRecordLists(local, remote, 'id', { tombstones });
        assert(merged.length === 1 && merged[0].id === 't2', 'Удалённая запись t1 с более свежим updatedAt должна быть удалена');
        assert(tombstones.t1 === 2000, 'Tombstone для t1 должен быть зафиксирован');
      }
    },
    {
      name: '11. Безопасность: хеширование PIN через SHA-256 с солью и отсутствие открытых PIN в памяти',
      fn() {
        const h1 = window.coffeeHashPin('1234');
        const h2 = window.coffeeHashPin('1234');
        const h3 = window.coffeeHashPin('1111');
        assert(h1.length === 64 && /^[a-f0-9]{64}$/.test(h1), 'Хеш PIN должен быть 64-символьной SHA-256 строкой');
        assert(h1 === h2 && h1 !== h3, 'Детерминированный солёный SHA-256 хеш');
        assert(!window.COFFEE_DEFAULT_STAFF_PINS, 'Открытая таблица COFFEE_DEFAULT_STAFF_PINS не должна существовать');
        assert(window.coffeeVerifyStaffPin('Соня', '1111', {}) === true, 'Проверка PIN Сони по SHA-256 хешу должна проходить');
        assert(window.coffeeVerifyStaffPin('Соня', '9999', {}) === false, 'Неверный PIN Сони должен отклоняться');
        window.coffeeRateLimiter.reset('staff_Соня');
      }
    },
    {
      name: '12. Безопасность: блокировка входа после 5 неверных попыток ввода PIN (Rate-Limiting 15 мин)',
      fn() {
        const actor = 'test_brute_force_actor';
        window.coffeeRateLimiter.reset(actor);
        for (let i = 1; i <= 4; i++) {
          const r = window.coffeeRateLimiter.recordFailure(actor);
          assert(r.locked === false && r.remainingAttempts === 5 - i, 'Попытка ' + i + ' должна уменьшать счётчик');
        }
        const fifth = window.coffeeRateLimiter.recordFailure(actor);
        assert(fifth.locked === true && fifth.remainingSec > 800, 'После 5-й ошибки вход должен блокироваться на 15 минут');
        window.coffeeRateLimiter.reset(actor);
      }
    },
    {
      name: '13. Безопасность: защита от подделки localStorage.coffee_admin_ok = "1" без подписанного токена сессии',
      fn() {
        window.coffeeAuth.logout();
        localStorage.setItem('coffee_admin_ok', '1');
        localStorage.setItem('coffee_illy_pin', '1234');
        assert(window.coffeeAuth.isAuthorized('admin') === false, 'Простая установка coffee_admin_ok=1 в localStorage не должна давать доступ без подписанного sessionToken');
        window.coffeeAuth.logout();
      }
    },
    {
      name: '14. Безопасность: создание и криптографическая проверка подписанного sessionToken',
      fn() {
        window.coffeeRateLimiter.reset('owner_admin');
        const sess = window.coffeeAuth.createLocalSession('admin', 'Администратор', '1234');
        assert(sess && sess.token.indexOf('st_') === 0, 'Должен создаваться токен сессии с префиксом st_');
        assert(window.coffeeAuth.isAuthorized('admin') === true, 'С валидным подписанным токеном доступ владельца разрешён');
        // Попытка подделать роль или подпись в sessionStorage
        const tampered = Object.assign({}, sess, { sig: '000000000000000000000000' });
        sessionStorage.setItem('coffee_session_token_v21', JSON.stringify(tampered));
        localStorage.setItem('coffee_session_token_v21', JSON.stringify(tampered));
        assert(window.coffeeAuth.isAuthorized('admin') === false, 'Токен с нарушенной криптоподписью должен автоматически отклоняться');
      }
    },
    {
      name: '15. Защита от XSS: экранирование тегов <script>, кавычек и обработчиков событий',
      fn() {
        const dirty = '<' + 'script>evil("xss")<' + '/script><' + 'div onerror="evil(1)" title=\'test\'>';
        const escaped = window.escapeHtml(dirty);
        assert(escaped.indexOf('<' + 'script>') === -1 && escaped.indexOf('&lt;script&gt;') >= 0, 'Тег script должен экранироваться в &lt;script&gt;');
        assert(escaped.indexOf('"') === -1 && escaped.indexOf("'") === -1, 'Кавычки должны экранироваться в &quot; и &#39;');
        const cleanObj = window.sanitizeRecord({ title: '<' + 'script>evil()<' + '/script>Промыть холдер', comment: 'javascript:evil(1)' });
        assert(cleanObj.title === 'Промыть холдер' && cleanObj.comment.indexOf('javascript:') === -1, 'sanitizeRecord должен вырезать script и javascript: URI');
      }
    },
    {
      name: '16. Надёжность IndexedDB: выгрузка тяжёлых base64-фото из localStorage в ссылки idb://photo/',
      fn() {
        const fakePhoto = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
        const dbSample = {
          incidents: [{ id: 'INC-99', step: 'Кофемашина', photo: fakePhoto }]
        };
        const offloaded = window.CoffeeIDB.offloadPhotosFromDB(dbSample);
        const ref = offloaded.incidents[0].photo;
        assert(ref.indexOf('idb://photo/') === 0 && ref.length < 40, 'Тяжёлое фото должно заменяться компактной ссылкой idb://photo/<hash>');
        const hydrated = window.CoffeeIDB.hydratePhotosInDB(offloaded);
        assert(hydrated.incidents[0].photo === fakePhoto, 'При чтении ссылка idb://photo/ должна мгновенно разворачиваться обратно в фото');
      }
    },
    {
      name: '17. Схема «Карты добрых дел»: поддержка циклических задач (раз в 2 недели / раз в 4 недели)',
      fn() {
        const deeds = window.COFFEE_DEFAULT_GOOD_DEEDS || [];
        assert(deeds.length >= 4, 'Карта добрых дел должна содержать базовые периодические задачи');
        const biweekly = deeds.find((d) => /2 нед/i.test(d.frequency));
        const fourWeeks = deeds.find((d) => /4 нед/i.test(d.frequency));
        assert(biweekly && /холодильник/i.test(biweekly.title), 'Задача разморозки холодильника раз в 2 недели во вторник');
        assert(fourWeeks && /водоумягчител/i.test(fourWeeks.title), 'Задача регенерации водоумягчителя солью раз в 4 недели');
      }
    },
    {
      name: '18. Проверка отсутствия переопределений функций (единая версия coffeeGetBlockWindow)',
      fn() {
        assert(typeof window.coffeeGetBlockWindow === 'function', 'coffeeGetBlockWindow должна быть функцией');
        assert(typeof window.coffeeEnforceOverdueChecklists === 'function', 'coffeeEnforceOverdueChecklists должна быть функцией');
        assert(typeof window.coffeeEvaluateRedFlags === 'function', 'coffeeEvaluateRedFlags должна быть функцией');
      }
    }
  ];

  function runAll() {
    const results = [];
    let passed = 0;
    let failed = 0;
    tests.forEach((t) => {
      try {
        t.fn();
        passed++;
        results.push({ name: t.name, ok: true });
      } catch (err) {
        failed++;
        results.push({ name: t.name, ok: false, error: String((err && err.message) || err) });
      }
    });
    return { total: tests.length, passed, failed, results };
  }

  root.CoffeeTestSuite = { runAll, tests };

  if (typeof module !== 'undefined' && require.main === module) {
    const summary = runAll();
    summary.results.forEach((r) => {
      console.log((r.ok ? '  [PASS] ' : '  [FAIL] ') + r.name + (r.error ? ' -> ' + r.error : ''));
    });
    console.log('\nИТОГО АВТОТЕСТОВ: ' + summary.passed + '/' + summary.total + ' успешно.');
    process.exit(summary.failed > 0 ? 1 : 0);
  }
})(typeof window !== 'undefined' ? window : global);
