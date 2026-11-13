/* UNIFIED_IIFE_START */
(function () {
/* Клиентский модуль страницы index.html (v21 Enterprise) */
const esc = window.escapeHtml || ((s) => String(s == null ? '' : s));
const API_URL = window.COFFEE.API_URL;
let LOCATION = "Кофейня №1";
let PLAN = 45000;   // реальные значения приходят из таблицы настроек

const $ = (id) => document.getElementById(id);

function safeShowModal(dlg) {
  if (!dlg) return;
  try {
    if (dlg.open) safeCloseModal(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  } catch (_) {
    dlg.setAttribute("open", "open");
  }
}
function safeCloseModal(dlg) {
  if (!dlg) return;
  try {
    if (dlg.open && typeof dlg.close === "function") dlg.close();
    dlg.removeAttribute("open");
  } catch (_) {
    dlg.removeAttribute("open");
  }
}

const rub = (n) => Number(n || 0).toLocaleString("ru-RU") + " руб.";
const isoToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
const tgu = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
let _hasExplicitBaristaChoice = (function () {
  try { return !!localStorage.getItem("coffee_active_barista"); } catch (_) { return false; }
})();
let userName = (function () {
  try {
    const saved = localStorage.getItem("coffee_active_barista");
    if (saved) return saved;
  } catch (_) {}
  return tgu && tgu.first_name ? tgu.first_name : "Алина";
})();
const tap = () => { try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {} };
const tgt = (f) => { try { return f(); } catch (e) {} };
$("loc").textContent = LOCATION; $("who").textContent = userName;
const curTheme = () => document.documentElement.getAttribute("data-theme") ||'light';
function paintTheme() {
  const d = curTheme() === "dark";
  ["theme", "termThemeBtn"].forEach((id) => {
    const b = $(id);
    if (b) {
      b.textContent = d ? "☀️" : "🌙";
      b.setAttribute("aria-label", d ? "Светлая тема" : "Тёмная тема");
    }
  });
}
["theme", "termThemeBtn"].forEach((id) => {
  const b = $(id);
  if (b) {
    b.onclick = () => {
      const n = curTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", n);
      try { localStorage.setItem("coffee_illy_theme", n); } catch (e) {}
      paintTheme();
    };
  }
});
paintTheme();
/* ---------- Telegram Mini App ---------- */
if (tg) {
  tgt(() => tg.ready()); tgt(() => tg.expand()); tgt(() => tg.disableVerticalSwipes());     // не закрывается случайным свайпом вниз
  const hasTheme = () => { try { return !!localStorage.getItem("coffee_illy_theme"); } catch (e) { return false; } };
  const tgTheme = () => { /* светлая тема по умолчанию: тему Telegram не копируем */ };
  tgTheme(); tgt(() => tg.onEvent("themeChanged", tgTheme));
  tgt(() => tg.setHeaderColor("#fbf6ef"));
  tgt(() => { const d = curTheme() === "dark"; tg.setBackgroundColor(d ? "#121316" : "#f7f5f2"); if (tg.setHeaderColor) tg.setHeaderColor(d ? "#1a1c20" : "#ffffff"); });
  tgt(() => tg.BackButton.onClick(() => { const b = $("backBtn"); if (!b.hidden && !b.disabled) b.click(); }));   // системная «назад» = предыдущий шаг
  setInterval(() => {        // подтверждение закрытия, пока есть несохранённая работа; кнопка «назад» на шагах 2+
    const work = (typeof inProgress === "function" && inProgress()) || photoBusy || (!$("cashView").hidden && !!trans);
    tgt(() => { if (tg && tg.initData) { work ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } });
    const back = block !== "КАССА" && !$("checklistView").hidden && idx > 0;
    tgt(() => back ? tg.BackButton.show() : tg.BackButton.hide());
  }, 700);
}
document.addEventListener("focusin", (e) => {     // клавиатура не перекрывает поле ввода
  if (/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) setTimeout(() => { try { e.target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {} }, 320);
});
$("today").textContent = new Date().toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });

let tasks = [], cur = [], idx = 0, answers = [], META = {};
let block = "Открытие", photo = "", incident = false, priority = "Терпит";
let photoUrl = "", photoBusy = false, stream = null;
const PHOTO_MAX_AGE = 3 * 60 * 1000;   // запасной режим: фото старше 3 минут не принимаем
const ADDON = /молоко|сироп|мёд|маршмеллоу|топпинг|открытка|десерт от бариста/i;   // добавки не попадают в «хиты дня»
function toast(t, forceShow) {
  const msg = String(t || "").trim();
  if (!msg) return;
  if (!forceShow && /^(✓ Вход выполнен|🔄 Синхронизация|✅ Данные синхронизированы|✓ Вы ознакомлены|Чек-лист начат|Поле текста смены очищено|Выбран день|Загружен пример|✓ Суммы подставлены|Рассчитано дней:|Все 5 дней распознаны)/i.test(msg)) {
    return;
  }
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 1800);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
let trans = null, sales = null;
let reportDate = isoToday();
const shiftIso = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function setReportDate(s) {
  reportDate = s; $("rdPick").value = s; $("rdPick").max = isoToday();
  const t = isoToday(), y = shiftIso(t, -1);
  $("rdToday").className = s === t ? "ok" : ""; $("rdYest").className = s === y ? "ok" : "";
  const nice = new Date(s + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  $("rdLabel").textContent = "Отчёт будет записан в строку за " + nice + (s === t ? " (сегодня)" : s === y ? " (вчера)" : "") + ". Если за эту дату уже есть данные, они обновятся.";
}
$("rdToday").onclick = () => setReportDate(isoToday());
$("rdYest").onclick = () => setReportDate(shiftIso(isoToday(), -1));
$("rdPick").onchange = (e) => { const v = e.target.value; setReportDate(v && v <= isoToday() ? v : reportDate); };

const VIEWS = ["loader", "errorView", "emptyView", "checklistView", "infoView", "cashView", "doneView"];
function show(v) { VIEWS.forEach((x) => $(x).hidden = x !== v); }

/* отметки «сегодня уже сдано» с персональной привязкой к аккаунту сотрудника и синхронизацией между устройствами */
window.coffeeGetActiveBarista = () => userName;
const doneKey = (b, u) => "coffee_illy_done_" + isoToday() + "_" + (u || userName || "Бариста") + "_" + ((b === "КАССА" || b === "Касса") ? "Касса" : b);
const isDone = (b) => {
  const normB = (b === "КАССА" || b === "Касса") ? "Касса" : b;
  if (window.coffeeIsBlockCompletedToday) {
    return !!window.coffeeIsBlockCompletedToday(normB, undefined, userName).completed;
  }
  try { return !!localStorage.getItem(doneKey(normB, userName)); } catch (e) { return false; }
};
const markDone = (b) => {
  const normB = (b === "КАССА" || b === "Касса") ? "Касса" : b;
  try {
    localStorage.setItem(doneKey(normB, userName), "1");
    localStorage.setItem("coffee_illy_done_" + isoToday() + "_" + normB, "1");
  } catch (e) {}
};

function migrateAndSyncAccountDoneFlags() {
  try {
    if (typeof getUDB !== "function") return;
    const db = getUDB();
    db.checklists = Array.isArray(db.checklists) ? db.checklists : [];
    const today = isoToday();
    const blocks = window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks(db) : [
      { name: "Открытие" }, { name: "Лайн Чек 1" }, { name: "Лайн Чек 2" }, { name: "Закрытие" }, { name: "Касса", isCash: true }, { name: "Карта добрых дел" }
    ];
    let pushedNew = false;
    blocks.forEach((bObj) => {
      const bName = (bObj.isCash || bObj.name === "Касса") ? "Касса" : bObj.name;
      if (bName === "Касса") return;
      const legacyKey = "coffee_illy_done_" + today + "_" + bName;
      const userKey = doneKey(bName, userName);
      const hasLegacy = localStorage.getItem(legacyKey) === "1" && !localStorage.getItem("coffee_migrated_v55_" + today + "_" + bName);
      if (hasLegacy) {
        localStorage.setItem("coffee_migrated_v55_" + today + "_" + bName, "1");
        localStorage.setItem(userKey, "1");
      }
      const hasUserLocal = localStorage.getItem(userKey) === "1";
      const inVault = db.checklists.some((c) => c && c.date === today && c.block === bName && String(c.who || "").trim().toLowerCase() === String(userName || "").trim().toLowerCase());
      if (hasUserLocal && !inVault) {
        const nowHm = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        db.checklists.push({
          sid: "sync_" + today + "_" + userName + "_" + bName,
          date: today,
          time: nowHm,
          startedAt: nowHm,
          deadline: bObj.deadline || "23:59",
          isLate: false,
          status: "Выполнено",
          totalSteps: 8,
          block: bName,
          who: userName,
          problems: 0,
          photos: []
        });
        pushedNew = true;
      } else if (inVault && !hasUserLocal) {
        localStorage.setItem(userKey, "1");
      }
    });
    if (pushedNew) {
      if (typeof saveUDB === "function") saveUDB(db);
      if (window.coffeePushCloudEnvelopeNow) window.coffeePushCloudEnvelopeNow();
    }
  } catch (_) {}
}
function drawTabs() {
  const unreadCount = getUnreadInfoCount();
  if ($("termInfoModeLbl")) {
    $("termInfoModeLbl").textContent = unreadCount > 0 ? ("📢 Инфо и ТТК (" + unreadCount + ")") : "📢 Инфо и ТТК";
  }
  const isInfoMode = block === "ИНФО";
  if ($("termModeSwitch")) {
    document.querySelectorAll("#termModeSwitch button").forEach((btn) => {
      const on = (btn.dataset.tmode === "tasks_info") === isInfoMode;
      btn.className = on ? "ok" : "";
      btn.removeAttribute("style");
    });
  }
  const tlBar = $("termTimelineTabs");
  if (tlBar) {
    tlBar.hidden = isInfoMode;
    const dynBlocks = window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks() : [
      { name: "Открытие", openTime: "07:30", deadline: "08:30" },
      { name: "Лайн Чек 1", openTime: "08:30", deadline: "09:30" },
      { name: "Лайн Чек 2", openTime: "14:00", deadline: "16:00" },
      { name: "Закрытие", openTime: "21:30", deadline: "22:30" },
      { name: "Касса", openTime: "22:00", deadline: "23:59", isCash: true },
      { name: "Карта добрых дел", openTime: "11:00", deadline: "22:00" }
    ];
    const newTabsHtml = dynBlocks.map((bObj) => {
      const bVal = (bObj.isCash || bObj.name === "Касса") ? "КАССА" : bObj.name;
      const isSel = block === bVal;
      const done = isDone(bVal);
      const locked = false;
      return '<button role="tab" type="button" data-b="' + esc(bVal) + '" data-l="' + esc(bObj.name) + '" aria-selected="' + (isSel ? 'true' : 'false') + '" class="' + (locked ? 'locked' : '') + '">' +
        '<span>' + esc(bObj.name) + '</span>' +
        (done ? '<span class="ck">✓</span>' : '') +
        '<div style="font-size:10px;opacity:0.78;font-weight:500;margin-top:1px">' + esc(bObj.openTime || '') + '–' + esc(bObj.deadline || '') + '</div>' +
      '</button>';
    }).join("");
    if (tlBar._lastHtml !== newTabsHtml) {
      tlBar._lastHtml = newTabsHtml;
      tlBar.innerHTML = newTabsHtml;
    }
  }
}

if ($("termModeSwitch")) {
  $("termModeSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tmode]");
    if (!b) return;
    if (inProgress()) { try { saveAnswer(); saveShiftDraft(); } catch (_) {} }
    if (b.dataset.tmode === "tasks_info") {
      selectBlock("ИНФО");
    } else {
      const dynBlocks = window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks() : [{ name: "Открытие" }];
      const firstBlk = (dynBlocks[0] && dynBlocks[0].name) || "Открытие";
      selectBlock(block === "ИНФО" ? firstBlk : block);
    }
  });
}

/* ---------- загрузка чек-листов ---------- */
let subGroup = "all";
const BLOCK_GROUPS = {
  "Открытие": [
    { k: "o", l: "Стандарт (o01–o08 · 8)" },
    { k: "pa", l: "Приёмка (pa01–pa21 · 21)" },
    { k: "all", l: "Все (29)" }
  ],
  "День": [
    { k: "d", l: "Обход дня (d01–d06 · 6)" },
    { k: "q", l: "Чистка До/После (q01–q09 · 9)" },
    { k: "all", l: "Все (15)" }
  ],
  "Закрытие": [
    { k: "c", l: "Стандарт (c01–c14 · 14)" },
    { k: "pe", l: "Полная сдача (pe01–pe26 · 26)" },
    { k: "u", l: "Уборка (u01–u07 · 7)" },
    { k: "all", l: "Все (47)" }
  ]
};
const DEFAULT_SUBGROUP = { "Открытие": "o", "День": "d", "Закрытие": "c" };

async function loadTasks() {
  const defTasks = (window.COFFEE && window.COFFEE.DEFAULT_TASKS) || [];
  let saved = []; try { saved = JSON.parse(localStorage.getItem("coffee_illy_tasks") || "[]"); } catch (_) {}
  if (!saved.length) saved = defTasks;
  if (window.coffeeNormalizeTasksTimeline) saved = window.coffeeNormalizeTasksTimeline(saved);
  $("cacheNote").hidden = true;
  if (saved.length) { tasks = saved; try { selectBlock(block); } catch (_) {} } else show("loader");
  try {
    const d = await coffeeFetch(API_URL + "?action=get_checklists&nocache=1&_t=" + Date.now());
    if (!d || d.ok === false || !d.tasks) throw new Error("bad response");
    tasks = (Array.isArray(d.tasks) && d.tasks.length > 0) ? (window.coffeeNormalizeTasksTimeline ? window.coffeeNormalizeTasksTimeline(d.tasks) : d.tasks) : defTasks;
    META = d;
    if (d.plan > 0) PLAN = d.plan;
    if (d.location) { LOCATION = d.location; $("loc").textContent = LOCATION; }
    if (d.initCounter > 0 && $("initCounterIn")) $("initCounterIn").value = d.initCounter;
    renderCash();
    try { localStorage.setItem("coffee_illy_tasks", JSON.stringify(tasks)); } catch (e) {}
    syncStaffSelector();
    drawTabs();
    if (!inProgress() && !photoBusy) {
      selectBlock(block);
    } else {
      reloadTerminalFromVault();
    }
  } catch (e) {
    if (!tasks.length) tasks = defTasks;
    if (!tasks.length && block !== "КАССА") { show("errorView"); return; }
    if (!saved.length) selectBlock(block);
  }
}

function emptyHint(b) {      // почему пусто: подсказка администратору
  const m = META || {}; let t;
  if (!m.v) t = "Скрипт на сервере устарел. Администратору: Apps Script → «Развернуть» → «Управление развёртываниями» → ✏️ → Версия «Новая версия» → «Развернуть».";
  else if (!m.rows) t = "Лист «" + (m.sheet || "Задачи") + "» пуст. Загрузите задачи в закрытую таблицу.";
  else t = "В блоке «" + b + "» нет активных задач. В листе «" + m.sheet + "» строк: " + m.rows + ". Блок берётся из столбца «Блок» (Открытие / День / Закрытие), включение — столбец «Активна» = да.";
  $("emptyText").textContent = t;
}

let photos = [];
let choiceMade = false;
let checklistStartedAt = "";
let stepNavLock = false;
let infoFilter = "unread";
const DRAFT_KEY = "coffee_shift_draft_v10";

function syncStaffSelector() {
  try {
    if (!_hasExplicitBaristaChoice && typeof getUDB === "function") {
      const db = getUDB();
      const actMap = (db && db.userActiveState && typeof db.userActiveState === "object") ? db.userActiveState : {};
      let bestUser = "";
      let bestTs = 0;
      Object.keys(actMap).forEach((u) => {
        const st = actMap[u];
        if (st && st.date === isoToday() && Number(st.updatedAt || 0) > bestTs) {
          bestTs = Number(st.updatedAt || 0);
          bestUser = u;
        }
      });
      if (!bestUser && Array.isArray(db.checklists) && db.checklists.length) {
        const todayChks = db.checklists.filter((c) => c && c.date === isoToday() && c.who);
        if (todayChks.length) bestUser = todayChks[todayChks.length - 1].who;
      }
      if (bestUser) userName = bestUser;
    }
  } catch (_) {}
  const sel = $("baristaSelect");
  if (!sel) return;
  const rawList = (META && Array.isArray(META.staff) && META.staff.length)
    ? META.staff.filter((s) => s.active !== "нет")
    : ((window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_STAFF) || []);
  const staffList = rawList.filter((s) => s && !/^(администратор|владелец)$/i.test(String(s.name || "").trim()));
  sel.innerHTML = staffList.map((s) => '<option value="' + s.name.replace(/"/g, '&quot;') + '"' + (s.name === userName ? ' selected' : '') + '>👤 ' + s.name + '</option>').join("");
  if (!staffList.some((s) => s.name === userName) && staffList.length) {
    userName = staffList[0].name;
    sel.value = userName;
  }
  $("who").textContent = userName;
  if ($("shiftBaristaIn") && !$("shiftBaristaIn").value) $("shiftBaristaIn").value = userName;
}
function promptStaffPinAndSwitch(targetName, isStartupLogin) {
  const dlg = $("staffPinDlg");
  const rawList = (META && Array.isArray(META.staff) && META.staff.length)
    ? META.staff.filter((s) => s.active !== "нет")
    : ((window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_STAFF) || []);
  const staffList = rawList.filter((s) => s && !/^(администратор|владелец)$/i.test(String(s.name || "").trim()));
  const uSel = $("staffPinUserSelect");
  if (uSel && staffList.length) {
    uSel.innerHTML = staffList.map((s) => '<option value="' + esc(s.name) + '"' + (s.name === targetName ? ' selected' : '') + '>👤 ' + esc(s.name) + '</option>').join("");
    uSel.value = targetName;
  }
  if (!dlg) {
    userName = targetName;
    try { _hasExplicitBaristaChoice = true; localStorage.setItem("coffee_active_barista", userName); } catch (_) {}
    if ($("baristaSelect")) $("baristaSelect").value = userName;
    $("who").textContent = userName;
    drawTabs();
    return;
  }
  $("staffPinTitle").textContent = isStartupLogin ? "Вход сотрудника" : ("Сотрудник: " + targetName);
  $("staffPinSub").textContent = "Выберите имя и введите личный PIN-код";
  $("staffPinInput").value = "";
  $("staffPinErr").textContent = "";
  if ($("staffPinCancelBtn")) {
    $("staffPinCancelBtn").hidden = !!isStartupLogin;
  }
  safeShowModal(dlg);
  setTimeout(() => { if ($("staffPinInput")) $("staffPinInput").focus(); }, 50);

  if ($("staffPinCancelBtn")) {
    $("staffPinCancelBtn").onclick = () => {
      if ($("baristaSelect")) $("baristaSelect").value = userName;
      safeCloseModal(dlg);
    };
  }
  $("staffPinForm").onsubmit = (ev) => {
    ev.preventDefault();
    const chosenName = (uSel && uSel.value) ? uSel.value : targetName;
    const entered = $("staffPinInput").value.trim();
    const actorKey = "staff_" + chosenName;
    if (window.coffeeRateLimiter) {
      const rlCheck = window.coffeeRateLimiter.check(actorKey);
      if (rlCheck.locked) {
        $("staffPinErr").textContent = rlCheck.message;
        return;
      }
    }
    const ok = window.coffeeVerifyStaffPin ? window.coffeeVerifyStaffPin(chosenName, entered) : (entered === "1234");
    if (!ok) {
      const rlAfter = window.coffeeRateLimiter ? window.coffeeRateLimiter.check(actorKey) : { remainingAttempts: 4 };
      $("staffPinErr").textContent = rlAfter.locked
        ? rlAfter.message
        : ("Неверный PIN-код для «" + chosenName + "» (по умолчанию: 1234). Осталось попыток: " + (rlAfter.remainingAttempts ?? 4));
      return;
    }
    userName = chosenName;
    try {
      _hasExplicitBaristaChoice = true; localStorage.setItem("coffee_active_barista", userName);
      sessionStorage.setItem("coffee_term_pin_unlocked_v1", userName);
      localStorage.setItem("coffee_term_pin_unlocked_v1", userName);
      if (window.coffeeAuth && window.coffeeAuth.createLocalSession) {
        const role = (userName === "Администратор" || /админ|владелец/i.test(userName)) ? "admin" : "staff";
        window.coffeeAuth.createLocalSession(role, userName, entered);
      }
    } catch (_) {}
    if ($("baristaSelect")) $("baristaSelect").value = userName;
    $("who").textContent = userName;
    if ($("shiftBaristaIn")) $("shiftBaristaIn").value = userName;
    safeCloseModal(dlg);
    migrateAndSyncAccountDoneFlags();
    try {
      if (typeof getUDB === "function") {
        const db = getUDB();
        const actState = db.userActiveState && db.userActiveState[userName];
        if (actState && actState.date === isoToday() && actState.block && actState.block !== "ИНФО") {
          block = actState.block;
        }
      }
    } catch (_) {}
    drawTabs();
    if (block === "ИНФО") renderInfoView();
    else selectBlock(block);
    if (window.coffeeLiveSyncNow) window.coffeeLiveSyncNow();
    toast("✓ Вход выполнен: " + userName + " (профиль синхронизирован)");
  };
}

if ($("baristaSelect")) {
  $("baristaSelect").addEventListener("change", (e) => {
    const nextUser = e.target.value || "Соня";
    if (nextUser === userName) return;
    if (inProgress()) { try { saveAnswer(); saveShiftDraft(); } catch (_) {} }
    promptStaffPinAndSwitch(nextUser);
  });
}

function getUnreadInfoCount() {
  const list = (META && Array.isArray(META.announcements) && META.announcements.length)
    ? META.announcements
    : ((window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_ANNOUNCEMENTS(isoToday())) || []);
  return list.filter((a) => {
    const acks = Array.isArray(a.acks) ? a.acks : [];
    return !acks.some((k) => String(k.name || "").toLowerCase() === String(userName || "").toLowerCase());
  }).length;
}

let _draftCloudTimer = null;
let _lastAppliedDraftTs = {};

function getUserDraftKey(targetBlock, targetUser) {
  return isoToday() + ":" + (targetUser || userName || "Бариста") + ":" + (targetBlock || block || "Открытие");
}

function getLocalDraftStorageKey(targetBlock, targetUser) {
  return DRAFT_KEY + "_" + isoToday() + "_" + (targetUser || userName || "Бариста") + "_" + (targetBlock || block || "Открытие");
}

function saveShiftDraft(skipCloudPush) {
  if (block === "КАССА" || block === "ИНФО" || !cur.length) return;
  const nowTs = Date.now();
  const dKey = getUserDraftKey(block, userName);
  const compactAnswers = answers.map((a) => {
    if (!a) return null;
    const pUrl = a.photo_url && String(a.photo_url).length <= 35000 ? a.photo_url : "";
    const prevShort = a.preview && String(a.preview).length <= 35000 ? a.preview : pUrl;
    return {
      id: a.id,
      title: a.title,
      choiceMade: !!a.choiceMade,
      isIncident: !!a.isIncident,
      incType: a.incType || "",
      comment: a.comment || "",
      priority: a.priority || "Терпит",
      photos: Array.isArray(a.photos) ? a.photos.filter((p) => p && String(p).length <= 35000).slice(0, 3) : [],
      photo_url: pUrl,
      preview: prevShort,
      completedAt: a.completedAt || "",
      responsible: a.responsible || "Администратор"
    };
  });
  const draftObj = {
    date: isoToday(),
    block,
    idx,
    startedAt: checklistStartedAt || new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    userName,
    answers,
    updatedAt: nowTs
  };
  const cloudDraftObj = Object.assign({}, draftObj, { answers: compactAnswers });
  _lastAppliedDraftTs[dKey] = nowTs;
  try {
    localStorage.setItem(getLocalDraftStorageKey(block, userName), JSON.stringify(draftObj));
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftObj));
  } catch (_) {}
  try {
    if (typeof getUDB === "function") {
      const db = getUDB();
      db.userDrafts = (db.userDrafts && typeof db.userDrafts === "object") ? db.userDrafts : {};
      db.userActiveState = (db.userActiveState && typeof db.userActiveState === "object") ? db.userActiveState : {};
      db.userDrafts[dKey] = cloudDraftObj;
      db.userActiveState[userName] = { date: isoToday(), block, idx, updatedAt: nowTs };
      if (typeof saveUDB === "function") saveUDB(db);
    }
  } catch (_) {}
  if (!skipCloudPush) {
    if (_draftCloudTimer) clearTimeout(_draftCloudTimer);
    _draftCloudTimer = setTimeout(() => {
      if (window.coffeePushCloudEnvelopeNow) window.coffeePushCloudEnvelopeNow();
      post({
        action: "save_checklist_draft",
        date: isoToday(),
        userName,
        block,
        draft: cloudDraftObj,
        activeState: { date: isoToday(), block, idx, updatedAt: nowTs },
        updatedAt: nowTs
      }).catch(() => {});
    }, 100);
  }
}

function clearShiftDraft(isCompleted) {
  const nowTs = Date.now();
  const dKey = getUserDraftKey(block, userName);
  _lastAppliedDraftTs[dKey] = nowTs;
  try {
    localStorage.removeItem(getLocalDraftStorageKey(block, userName));
    localStorage.removeItem(DRAFT_KEY);
  } catch (_) {}
  try {
    if (typeof getUDB === "function") {
      const db = getUDB();
      db.userDrafts = (db.userDrafts && typeof db.userDrafts === "object") ? db.userDrafts : {};
      db.userDrafts[dKey] = {
        date: isoToday(),
        userName,
        block,
        idx: 0,
        answers: [],
        cleared: !isCompleted,
        completed: !!isCompleted,
        updatedAt: nowTs
      };
      if (typeof saveUDB === "function") saveUDB(db);
    }
  } catch (_) {}
  if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
}

function tryRestoreShiftDraft(targetBlock) {
  try {
    const dKey = getUserDraftKey(targetBlock, userName);
    let d = null;
    if (typeof getUDB === "function") {
      const db = getUDB();
      if (db.userDrafts && db.userDrafts[dKey]) {
        d = db.userDrafts[dKey];
      }
    }
    try {
      const rawLocal = localStorage.getItem(getLocalDraftStorageKey(targetBlock, userName)) || localStorage.getItem(DRAFT_KEY);
      if (rawLocal) {
        const parsedLocal = JSON.parse(rawLocal);
        if (parsedLocal && parsedLocal.date === isoToday() && parsedLocal.block === targetBlock && (!parsedLocal.userName || parsedLocal.userName === userName)) {
          if (!d || Number(parsedLocal.updatedAt || 0) >= Number(d.updatedAt || 0)) {
            d = parsedLocal;
          }
        }
      }
    } catch (_) {}
    if (!d || d.date !== isoToday() || d.block !== targetBlock || d.completed || d.cleared) return false;
    if (d.userName && d.userName !== userName) return false;
    if (!Array.isArray(d.answers) || !d.answers.length) return false;
    const hasProgress = d.idx > 0 || d.answers.some((a) => a && (a.choiceMade || (a.photos && a.photos.length)));
    if (!hasProgress) return false;
    idx = Math.min(d.idx || 0, Math.max(0, cur.length - 1));
    answers = d.answers.slice();
    checklistStartedAt = d.startedAt || "";
    _lastAppliedDraftTs[dKey] = Number(d.updatedAt) || Date.now();
    if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
    return true;
  } catch (_) {
    return false;
  }
}

if ($("resetDraftBtn")) {
  $("resetDraftBtn").onclick = () => {
    const nowTs = Date.now();
    clearShiftDraft(false);
    idx = 0;
    answers = [];
    renderStep();
    if (window.coffeePushCloudEnvelopeNow) window.coffeePushCloudEnvelopeNow();
    post({ action: "save_checklist_draft", date: isoToday(), userName, block, cleared: true, updatedAt: nowTs }).catch(() => {});
    toast("Чек-лист начат с первого шага (синхронизировано)");
  };
}

function updateDeadlineUI() {
  if (window.coffeeEnforceOverdueChecklists) {
    const createdIncs = window.coffeeEnforceOverdueChecklists(userName);
    if (createdIncs && createdIncs.length) {
      toast("🚨 Дедлайн истёк! Доступ закрыт, инцидент отправлен администратору");
    }
  }
  const banner = $("deadlineBanner");
  if (!banner || block === "ИНФО") return true;
  const checkBlkName = block === "КАССА" ? "Касса" : block;
  const win = window.coffeeGetBlockWindow
    ? window.coffeeGetBlockWindow(checkBlkName, undefined, userName)
    : { openTime: "07:30", deadline: "08:30", isOverdue: false, isBefore: false, completed: false, canPass: true, state: "open", currentTime: "08:00" };

  banner.className = "dl-banner " + (win.state === "overdue_closed" ? "overdue" : "ontime");
  $("deadlineText").textContent = "⏰ Отведённое время «" + checkBlkName + "»: " + win.openTime + " – " + win.deadline + (win.extended ? " (разблокировано админом)" : "");
  if ($("deadlineTimerChip")) {
    if (win.state === "open") {
      const leftStr = window.coffeeFormatTimeLeft ? window.coffeeFormatTimeLeft(win.deadline, win.currentTime) : "";
      $("deadlineTimerChip").textContent = "⏱ До закрытия: " + leftStr;
      $("deadlineTimerChip").hidden = false;
    } else if (win.state === "before_window") {
      const waitStr = window.coffeeFormatTimeLeft ? window.coffeeFormatTimeLeft(win.openTime, win.currentTime) : "";
      $("deadlineTimerChip").textContent = "⏳ Откроется через: " + waitStr;
      $("deadlineTimerChip").hidden = false;
    } else {
      $("deadlineTimerChip").hidden = true;
    }
  }
  if (win.state === "completed") {
    $("deadlineBadge").innerHTML = '<span style="color:var(--good)">✓ Сдано вовремя</span>';
  } else if (win.state === "overdue_closed") {
    $("deadlineBadge").innerHTML = '<span style="color:var(--bad)">🔒 Доступ закрыт (просрочено после ' + win.deadline + ')</span>';
  } else if (win.state === "before_window") {
    $("deadlineBadge").innerHTML = '<span style="color:var(--warn)">⏳ Доступ с ' + win.openTime + '</span>';
  } else {
    $("deadlineBadge").innerHTML = '<span style="color:var(--good)">🟢 Доступ открыт (до ' + win.deadline + ')</span>';
  }

  const lockCard = $("windowLockCard");
  const stepWrap = $("taskStepWrap");
  const progWrap = $("stepProgressWrap");
  if (lockCard && stepWrap) {
    if (!win.canPass) {
      banner.hidden = true;
      if (progWrap) progWrap.hidden = true;
      lockCard.hidden = false;
      stepWrap.hidden = true;
      $("steps").hidden = true;
      if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
      const alertBox = $("windowLockAlertBox");
      if (win.state === "completed") {
        lockCard.style.borderColor = "var(--good)";
        $("windowLockIcon").textContent = "✅";
        $("windowLockTitle").textContent = "Чек-лист «" + checkBlkName + "» выполнен";
        const whoDone = (win.completedRecord && win.completedRecord.who) ? (" (" + win.completedRecord.who + ")") : (" (" + userName + ")");
        $("windowLockDesc").textContent = "Все пункты блока «" + checkBlkName + "» сданы" + whoDone + (win.completedRecord && win.completedRecord.time ? " в " + win.completedRecord.time : "") + ".";
        alertBox.hidden = true;
      } else if (win.state === "before_window") {
        lockCard.style.borderColor = "var(--warn)";
        $("windowLockIcon").textContent = "⏳";
        $("windowLockTitle").textContent = "Окно «" + checkBlkName + "»: " + win.openTime + " – " + win.deadline;
        $("windowLockDesc").textContent = "Доступ откроется по расписанию в " + win.openTime + " (сейчас " + win.currentTime + ").";
        alertBox.hidden = true;
      } else {
        lockCard.style.borderColor = "var(--bad)";
        $("windowLockIcon").textContent = "🔒";
        $("windowLockTitle").textContent = "Доступ к «" + checkBlkName + "» закрыт (" + win.openTime + "–" + win.deadline + ")";
        $("windowLockDesc").textContent = "Время выполнения чек-листа истекло в " + win.deadline + ". Самостоятельное открытие на терминале бариста недоступно.";
        alertBox.hidden = false;
        alertBox.innerHTML =
          "<b>🚨 Зафиксирована просрочка дедлайна:</b><br>" +
          "• Уведомление отправлено администратору.<br>" +
          "• Открыть доступ или продлить дедлайн смены может только <b>Администратор</b> в Панели управления.";
      }
      // Проверяем, какой чек-лист сейчас открыт по времени, чтобы дать кнопку быстрого перехода в 1 клик
      const jumpBtn = $("goToActiveBlockFromLockBtn");
      if (jumpBtn && window.coffeeGetChecklistBlocks && window.coffeeGetBlockWindow) {
        const openBlkObj = window.coffeeGetChecklistBlocks().find((bObj) => {
          const w = window.coffeeGetBlockWindow(bObj.name);
          return w && w.canPass && bObj.name !== checkBlkName;
        });
        if (openBlkObj) {
          jumpBtn.hidden = false;
          jumpBtn.textContent = "🟢 Открыть активный сейчас: «" + openBlkObj.name + "» (" + openBlkObj.openTime + "–" + openBlkObj.deadline + ")";
          jumpBtn.onclick = () => selectBlock((openBlkObj.isCash || openBlkObj.name === "Касса") ? "КАССА" : openBlkObj.name);
        } else {
          jumpBtn.hidden = true;
        }
      }
      return false;
    } else {
      banner.hidden = false;
      if (progWrap) progWrap.hidden = false;
      lockCard.hidden = true;
      stepWrap.hidden = false;
      $("steps").hidden = false;
    }
  }
  return true;
}
setInterval(() => {
  updateDeadlineUI();
  drawTabs();
}, 10000);

function selectBlock(b) {
  if (b === "День") b = "Лайн Чек 1";
  block = b;
  syncStaffSelector();
  drawTabs();
  if (b === "ИНФО") { $("steps").hidden = true; show("infoView"); renderInfoView(); return; }
  if (b === "КАССА" || b === "Касса") {
    const winCash = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow("Касса") : { canPass: true };
    if (!winCash.canPass) {
      $("steps").hidden = true;
      show("checklistView");
      updateDeadlineUI();
      return;
    }
    $("steps").hidden = true;
    show("cashView");
    renderCash();
    return;
  }
  cur = tasks.filter((t) => t.block === b && t.active !== "нет");
  idx = 0;
  answers = [];
  checklistStartedAt = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
  if (!cur.length) { $("steps").hidden = true; emptyHint(b); show("emptyView"); return; }
  show("checklistView");
  if (!updateDeadlineUI()) {
    $("steps").hidden = true;
    return;
  }
  tryRestoreShiftDraft(b);
  $("steps").hidden = false;
  renderStep();
}

/* ---------- шаги чек-листа (1 экран = 1 задача) ---------- */
function drawSteps() {
  const totalS = cur.length || 1;
  const doneS = cur.filter((_, i) => answers[i] && answers[i].choiceMade).length;
  const pctS = Math.round((doneS / totalS) * 100);
  if ($("stepProgressLbl")) $("stepProgressLbl").textContent = "Выполнено: " + pctS + "%";
  if ($("stepProgressFill")) $("stepProgressFill").style.width = pctS + "%";
  if ($("stepDoneCountLbl")) $("stepDoneCountLbl").textContent = doneS + " из " + cur.length + " задач";
  $("steps").innerHTML = cur.map((_, i) => '<i class="' + (i < idx ? "done" : i === idx ? "now" : "") + '"></i>').join("");
}

function getTaskPhotoMode(t) {
  if (!t) return "нет";
  if (t.photoMode) return t.photoMode;
  return t.mediaRequired || t.photo === "да" ? "да" : "нет";
}

function renderStep() {
  show("checklistView");
  if (!updateDeadlineUI()) { $("steps").hidden = true; return; }
  const t = cur[idx], a = answers[idx] || {};
  const pMode = getTaskPhotoMode(t);
  $("stepCounter").textContent = "Пункт " + (idx + 1) + " из " + cur.length;
  if ($("photoModeTag")) {
    $("photoModeTag").textContent = pMode === "да" ? "📷 Фото обязательно" : (pMode === "при проблеме" ? "📷 Фото при проблеме" : "✓ Без фото");
    $("photoModeTag").style.color = pMode === "да" ? "var(--warn)" : "var(--muted)";
  }
  $("taskTitle").textContent = t.title || "";
  $("taskInstruction").textContent = t.instruction || "";
  $("taskInstruction").hidden = !t.instruction;
  if ($("inlineSampleDetails")) $("inlineSampleDetails").open = false;
  if ($("inlineSamplePhotos")) {
    const samples = window.coffeeGetSamplePhotos ? window.coffeeGetSamplePhotos(t) : [];
    $("inlineSamplePhotos").innerHTML = samples.map((s) => (
      '<div style="border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--surface)">' +
        '<div style="font-weight:700;font-size:12.5px;margin-bottom:4px">' + esc(s.label) + '</div>' +
        '<img src="' + s.url + '" alt="' + esc(s.label) + '" style="width:100%;border-radius:8px;display:block">' +
        '<div class="muted" style="font-size:11.5px;margin-top:4px">' + esc(s.caption || '') + '</div>' +
      '</div>'
    )).join("");
  }

  photos = Array.isArray(a.photos) ? a.photos.slice() : (a.preview ? [a.preview] : []);
  photo = photos[0] || "";
  photoUrl = a.photo_url || "";
  photoBusy = false;

  choiceMade = !!a.choiceMade;
  incident = !!a.isIncident;
  if ($("incidentType")) $("incidentType").value = a.incType || "Поломка оборудования";
  $("incidentComment").value = a.comment || "";
  setPriority(a.priority || "Терпит");

  /* Применяем состояние выбора (нельзя автоматически считать задачу выполненной без подтверждения сотрудника!) */
  $("incidentBox").hidden = !(choiceMade && incident);
  $("btnOk").className = (choiceMade && !incident) ? "ok" : "";
  $("btnInc").className = (choiceMade && incident) ? "bad" : "";
  if ($("choiceHint")) {
    $("choiceHint").textContent = !choiceMade ? "" : (incident ? "Опишите проблему ниже" : "✓ Подтверждено");
    $("choiceHint").style.color = !choiceMade ? "var(--warn)" : (incident ? "var(--bad)" : "var(--good)");
  }

  const showPhoto = (pMode === "да") || (choiceMade && incident);
  $("photoBlock").hidden = !showPhoto;
  setPhotoUI();
  photoMsg(photos.length ? ("✓ Прикреплено кадров: " + photos.length) : "", photos.length ? "good" : "");

  $("backBtn").hidden = idx === 0;
  $("nextBtn").textContent = idx === cur.length - 1 ? "Завершить и отправить чек-лист" : "Следующая задача →";
  drawSteps();
  validate();
  window.scrollTo(0, 0);
}

function setPhotoUI() {
  photo = photos[0] || "";
  const isV = /^data:video/.test(photo);
  $("photoPreview").hidden = !photo || isV;
  if (photo && !isV) $("photoPreview").src = photo;
  $("vidPreview").hidden = !isV;
  if (isV) { if ($("vidPreview").getAttribute("src") !== photo) $("vidPreview").src = photo; } else $("vidPreview").removeAttribute("src");
  $("camIco").style.display = photo ? "none" : "";
  $("drop").classList.toggle("has", photos.length > 0);
  $("photoPrompt").textContent = photos.length ? ("Снято кадров: " + photos.length + " (нажмите, чтобы снять ещё)") : "Открыть камеру";
  if ($("addMorePhotoBtn")) $("addMorePhotoBtn").hidden = photos.length === 0;

  const gal = $("multiPhotoGallery");
  if (gal) {
    gal.hidden = photos.length === 0;
    gal.innerHTML = photos.map((src, i) => {
      const v = /^data:video/.test(src);
      return '<div class="mp-item">' +
        (v ? '<video src="' + src + '" muted playsinline></video>' : '<img src="' + src + '" alt="Кадр ' + (i + 1) + '">') +
        '<button type="button" class="mp-del" data-delphoto="' + i + '" title="Удалить кадр">×</button>' +
        '<span class="mp-lbl">Кадр ' + (i + 1) + '</span>' +
      '</div>';
    }).join("");
  }
  $("backBtn").disabled = photoBusy;
}

if ($("multiPhotoGallery")) {
  $("multiPhotoGallery").addEventListener("click", (e) => {
    const b = e.target.closest("[data-delphoto]");
    if (!b) return;
    const rmIdx = Number(b.dataset.delphoto);
    photos.splice(rmIdx, 1);
    photo = photos[0] || "";
    setPhotoUI();
    validate();
    saveAnswer();
  });
}
if ($("addMorePhotoBtn")) {
  $("addMorePhotoBtn").onclick = () => openCamera();
}

/* Быстрый штамп-снимок для тестирования или при блокировке камеры браузером */
/* Встроенный фотообразец прямо внутри блока информации задачи (не выглядит как отдельная задача) */
if ($("btnSampleModal") && $("btnSampleModal").tagName !== "SUMMARY") {
  $("btnSampleModal").onclick = () => {
    if ($("inlineSampleDetails")) $("inlineSampleDetails").open = !$("inlineSampleDetails").open;
  };
}
if ($("sampleDlgClose")) $("sampleDlgClose").onclick = () => safeCloseModal($("sampleDlg"));

function setStatus(isInc) {
  choiceMade = true;
  incident = isInc;
  $("incidentBox").hidden = !isInc;
  const t = cur[idx];
  const pMode = getTaskPhotoMode(t);
  if (t && $("photoBlock")) {
    $("photoBlock").hidden = !(pMode === "да" || isInc);
    const lbl = $("photoBlockLabel") || $("photoBlock").querySelector(".label");
    if (lbl) lbl.textContent = isInc ? "📸 Фото или видео неисправности (можно несколько ракурсов)" : "Фото или видео — можно прикрепить несколько снимков";
  }
  $("btnOk").className = !isInc ? "ok" : "";
  $("btnInc").className = isInc ? "bad" : "";
  if ($("choiceHint")) {
    $("choiceHint").textContent = isInc
      ? "Укажите тип проблемы и описание — карточка сразу сохранится в реестре инцидентов"
      : "✓ Нормальное состояние подтверждено";
    $("choiceHint").style.color = isInc ? "var(--bad)" : "var(--good)";
  }
  validate();
  saveAnswer();
}
function setPriority(p) {
  priority = p;
  $("prLow").className = p === "Терпит" ? "warn" : "";
  $("prHigh").className = p === "Критично" ? "bad" : "";
}
function isCurrentStepReady() {
  const t = cur[idx]; if (!t) return false;
  const pMode = getTaskPhotoMode(t);
  const needPhoto = (pMode === "да") || (incident && pMode === "при проблеме");
  const hasPhoto = photos.length > 0 || !!photo;
  const commentOk = !incident || $("incidentComment").value.trim().length > 2;
  return !!(choiceMade && (!needPhoto || hasPhoto) && !photoBusy && commentOk);
}
function validate() {
  const t = cur[idx]; if (!t) return;
  const ready = isCurrentStepReady();
  $("nextBtn").disabled = false;
  $("nextBtn").style.opacity = ready ? "1" : "0.65";
  $("backBtn").disabled = photoBusy;
}

/* ---------- камера: живой снимок или видео, без чёрного экрана + мульти-фото ---------- */
function photoMsg(t, cls) { $("photoState").textContent = t; $("photoState").className = "pstate" + (cls ? " " + cls : ""); }
const VID_MAX = 15;
let camFacing = "environment", camMode = "photo", camFlash = false, camHwTorch = false, camT = null, recT = null, rec = null, recChunks = [], armed = false;
document.addEventListener("pointerdown", () => { armed = true; }, { once: true });

function paintCamControls() {
  if ($("camRearBtn")) $("camRearBtn").classList.toggle("on", camFacing === "environment");
  if ($("camFrontBtn")) $("camFrontBtn").classList.toggle("on", camFacing === "user");
  if ($("camFlashBtn")) {
    $("camFlashBtn").classList.toggle("on", camFlash);
    $("camFlashBtn").style.background = camFlash ? "#f5b82e" : "";
    $("camFlashBtn").style.color = camFlash ? "#1b160d" : "";
    $("camFlashBtn").textContent = camFlash ? "⚡ Вспышка: Вкл" : "⚡ Вспышка: Выкл";
  }
  const v = $("camVideo");
  if (v) {
    v.style.boxShadow = (camFlash && (camFacing === "user" || !camHwTorch))
      ? "inset 0 0 0 14px rgba(255,253,244,0.88)"
      : "none";
  }
}

async function applyCamFlashState() {
  if (!stream) {
    camHwTorch = false;
    paintCamControls();
    return;
  }
  if (camFlash && camFacing === "environment" && window.coffeeCameraPool && typeof window.coffeeCameraPool.setTorch === "function") {
    camHwTorch = await window.coffeeCameraPool.setTorch(stream, true);
  } else {
    camHwTorch = false;
    if (window.coffeeCameraPool && typeof window.coffeeCameraPool.setTorch === "function") {
      await window.coffeeCameraPool.setTorch(stream, false);
    }
  }
  paintCamControls();
}

function stopStream() {
  const v = $("camVideo");
  if (v) {
    try { v.pause(); } catch (_) {}
    v.srcObject = null;
    v.style.boxShadow = "none";
  }
  if (window.coffeeCameraPool && typeof window.coffeeCameraPool.suspend === "function") {
    window.coffeeCameraPool.suspend(stream);
  } else if (stream) {
    stream.getTracks().forEach((t) => { try { t.enabled = false; } catch (_) {} });
  }
  stream = null;
  camHwTorch = false;
}
async function startStream() {
  stopStream(); $("camShot").disabled = true;
  paintCamControls();
  const v = $("camVideo");
  let s = null;
  if (window.coffeeCameraPool && typeof window.coffeeCameraPool.acquire === "function") {
    s = await window.coffeeCameraPool.acquire(camFacing);
  } else {
    const tries = [
      { video: { facingMode: { exact: camFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: camFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false }
    ];
    let err;
    for (const c of tries) { try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; if (e && /NotAllowed|Permission|Security/i.test(e.name)) break; } }
    if (!s) throw err || new Error("no camera");
  }
  stream = s; v.srcObject = s; v.style.transform = camFacing === "user" ? "scaleX(-1)" : "";
  try { await v.play(); } catch (e) {}
  await new Promise((r) => { if (v.videoWidth) return r(); v.onloadedmetadata = () => r(); setTimeout(r, 1200); });
  $("camShot").disabled = !v.videoWidth;
  await applyCamFlashState();
}
function camError(e) {
  const n = (e && e.name) || "";
  photoMsg(/NotAllowed|Permission|Security/i.test(n) ? "Нет доступа к камере. Разрешите камеру в настройках браузера или Telegram и нажмите «Открыть камеру» ещё раз." : "Камера недоступна на этом устройстве.", "bad");
}
async function fallbackNativeChecklistCapture(facing) {
  if (!(window.coffeeCameraPool && typeof window.coffeeCameraPool.captureNativeCanvas === "function")) return false;
  const natRes = await window.coffeeCameraPool.captureNativeCanvas({
    mode: camMode,
    facing: facing || camFacing,
    stamp: false
  });
  if (!natRes) return true;
  if (natRes.kind === "video" && natRes.dataUrl) {
    photos.push(natRes.dataUrl);
    photo = photos[0];
    photoUrl = "";
    setPhotoUI();
    uploadNow(natRes.dataUrl);
    saveAnswer();
    return true;
  }
  if (natRes.canvas) {
    gotPhoto(natRes.canvas);
    return true;
  }
  return false;
}
async function openCamera() {
  if (photoBusy || !$("cam").hidden) return;
  camFacing = (cur[idx] && /селфи|selfie/i.test(cur[idx].title || "")) ? "user" : "environment";
  if (window.coffeeCameraPool && window.coffeeCameraPool.isNativeModePreferred && window.coffeeCameraPool.isNativeModePreferred()) {
    await fallbackNativeChecklistCapture(camFacing);
    return;
  }
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    const okNat = await fallbackNativeChecklistCapture(camFacing);
    if (!okNat) camError();
    return;
  }
  $("cam").hidden = false; setMode("photo"); paintCamControls(); photoMsg("");
  try { await startStream(); }
  catch (e) {
    closeCamera();
    const okNat = await fallbackNativeChecklistCapture(camFacing);
    if (!okNat) camError(e);
  }
}
function setMode(m) { camMode = m; cancelAuto(); $("mPhoto").classList.toggle("on", m === "photo"); $("mVideo").classList.toggle("on", m === "video"); }
function cancelAuto() { clearInterval(camT); $("camCount").hidden = true; }
function closeCamera() {
  cancelAuto(); clearInterval(recT);
  if (rec && rec.state === "recording") { rec.onstop = null; try { rec.stop(); } catch (e) {} }
  rec = null; $("camRec").hidden = true; $("camShot").classList.remove("rec"); stopStream(); $("cam").hidden = true;
}
function isBlack(c) { const t = document.createElement("canvas"); t.width = t.height = 8; const x = t.getContext("2d"); x.drawImage(c, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return sum / (d.length / 4) < 10; }
async function shot(n) {
  const v = $("camVideo"); if (!v.videoWidth) return;
  if (camFlash && (camFacing === "user" || !camHwTorch) && window.coffeeCameraPool && typeof window.coffeeCameraPool.triggerScreenFlash === "function") {
    await window.coffeeCameraPool.triggerScreenFlash($("camScreenFlash"), 260);
  }
  const k = Math.min(1, 1280 / v.videoWidth), c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  if (isBlack(c) && n < 2) return void setTimeout(() => shot(n + 1), 200);
  if (camFlash && window.coffeeCameraPool && typeof window.coffeeCameraPool.enhanceFlashExposure === "function") {
    window.coffeeCameraPool.enhanceFlashExposure(c);
  }
  closeCamera(); gotPhoto(c);
}
function pickMime() { if (!window.MediaRecorder) return null; for (const m of ["video/webm;codecs=vp8", "video/webm", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return m; return ""; }
function toggleRec() {
  if (rec && rec.state === "recording") { rec.stop(); return; }
  const mime = pickMime(); if (mime === null) { toast("Запись видео не поддерживается — снимите фото", true); return; }
  recChunks = [];
  try { rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: 1200000 }, mime ? { mimeType: mime } : {})); } catch (e) { toast("Не удалось начать запись видео", true); return; }
  const r = rec;
  r.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  r.onstop = () => {
    const blob = new Blob(recChunks, { type: (r.mimeType || mime || "video/webm").split(";")[0] }); closeCamera();
    if (!blob.size) { photoMsg("Видео не записалось — попробуйте ещё раз", "bad"); return; }
    const fr = new FileReader();
    fr.onload = () => {
      photos.push(fr.result);
      photo = photos[0];
      photoUrl = "";
      setPhotoUI();
      uploadNow(fr.result);
      saveAnswer();
    };
    fr.readAsDataURL(blob);
  };
  r.start(500); const t0 = Date.now(); $("camRec").hidden = false; $("camShot").classList.add("rec"); $("camTime").textContent = "0:00";
  recT = setInterval(() => { const sec = Math.floor((Date.now() - t0) / 1000); $("camTime").textContent = Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); if (sec >= VID_MAX && r.state === "recording") r.stop(); }, 250);
}
async function switchCamFacing(targetFacing) {
  if (rec && rec.state === "recording") return;
  cancelAuto();
  const prev = camFacing;
  camFacing = targetFacing === "user" ? "user" : "environment";
  paintCamControls();
  try {
    await startStream();
  } catch (e) {
    camFacing = prev;
    paintCamControls();
    try { await startStream(); } catch (x) { closeCamera(); camError(x); return; }
  }
}
$("drop").onclick = openCamera;
$("drop").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCamera(); } };
$("camCancel").onclick = closeCamera;
$("camShot").onclick = () => { cancelAuto(); if (camMode === "video") toggleRec(); else shot(0); };
$("mPhoto").onclick = () => { if (!(rec && rec.state === "recording")) setMode("photo"); };
$("mVideo").onclick = () => { if (!(rec && rec.state === "recording")) setMode("video"); };
if ($("camRearBtn")) $("camRearBtn").onclick = () => switchCamFacing("environment");
if ($("camFrontBtn")) $("camFrontBtn").onclick = () => switchCamFacing("user");
if ($("camFlashBtn")) {
  $("camFlashBtn").onclick = async () => {
    camFlash = !camFlash;
    await applyCamFlashState();
  };
}
if ($("mNativeCam")) {
  $("mNativeCam").onclick = async () => {
    if (rec && rec.state === "recording") return;
    const curFac = camFacing;
    closeCamera();
    await fallbackNativeChecklistCapture(curFac);
  };
}
$("camFlip").onclick = () => switchCamFacing(camFacing === "user" ? "environment" : "user");
function gotPhoto(c) {
  const x = c.getContext("2d"), h = Math.max(16, Math.round(c.width / 45));
  x.fillStyle = "rgba(0,0,0,.58)"; x.fillRect(0, c.height - h * 1.9, c.width, h * 1.9);
  x.fillStyle = "#fff"; x.font = "600 " + h + "px system-ui,sans-serif";
  x.fillText(new Date().toLocaleString("ru-RU") + " · " + LOCATION + " · " + userName + " · " + (cur[idx] ? cur[idx].title : ""), h * .6, c.height - h * .6);
  const newShot = c.toDataURL("image/jpeg", 0.74);
  photos.push(newShot);
  photo = photos[0];
  photoUrl = "";
  setPhotoUI();
  uploadNow(newShot);
  saveAnswer();
}
async function uploadNow(targetShot) {
  const my = targetShot || photo, step = (idx + 1) + " " + (cur[idx] ? cur[idx].title : "");
  photoBusy = true; setPhotoUI(); validate();
  try {
    const d = await api({ action: "upload_photo", block, step, photo: my, kind: /^data:video/.test(my) ? "video" : "photo" });
    photoUrl = d.url || "";
    photoMsg("✓ Сохранено кадров: " + photos.length, "good");
  } catch (e) {
    photoMsg("✓ Кадров прикреплено: " + photos.length + " (отправятся с отчётом)", "good");
  }
  photoBusy = false; setPhotoUI(); validate();
}
$("photoState").onclick = () => { if (!photos.length && !photoBusy) openCamera(); };
$("btnOk").onclick = () => { tap(); setStatus(false); };
$("btnInc").onclick = () => { tap(); setStatus(true); };
$("prLow").onclick = () => { setPriority("Терпит"); saveAnswer(); };
$("prHigh").onclick = () => { setPriority("Критично"); saveAnswer(); };
if ($("incidentType")) $("incidentType").addEventListener("change", saveAnswer);
$("incidentComment").addEventListener("input", () => { validate(); saveAnswer(); });

function saveAnswer() {
  const t = cur[idx];
  if (!t) return;
  const nowHm = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  answers[idx] = {
    id: t.id,
    title: t.title,
    choiceMade,
    isIncident: incident,
    incType: incident && $("incidentType") ? $("incidentType").value : "",
    comment: incident ? $("incidentComment").value.trim() : "",
    priority: incident ? priority : "",
    photos: photos.slice(),
    photo_url: photoUrl || photos[0] || "",
    preview: photos[0] || "",
    completedAt: nowHm,
    responsible: t.responsible || "Администратор"
  };
  saveShiftDraft();
}
$("backBtn").onclick = () => {
  if (stepNavLock || idx <= 0) return;
  stepNavLock = true;
  setTimeout(() => { stepNavLock = false; }, 220);
  saveAnswer();
  idx--;
  saveShiftDraft();
  renderStep();
};
$("nextBtn").onclick = async () => {
  if (stepNavLock) return;
  if (!isCurrentStepReady()) {
    const t = cur[idx];
    const pMode = getTaskPhotoMode(t);
    const needPhoto = (pMode === "да") || (incident && pMode === "при проблеме");
    const hasPhoto = photos.length > 0 || !!photo;
    const commentOk = !incident || $("incidentComment").value.trim().length > 2;
    if (!choiceMade) {
      toast("👆 Сначала выберите «✅ Всё в норме» или «⚠️ Обнаружена проблема»");
    } else if (needPhoto && !hasPhoto) {
      toast("📸 Для этого шага нужно фото — нажмите «Открыть камеру»");
    } else if (incident && !commentOk) {
      toast("✍️ Опишите проблему в комментарии (минимум 3 символа)");
      if ($("incidentComment")) $("incidentComment").focus();
    }
    return;
  }
  if (!updateDeadlineUI()) {
    toast("🔒 Время вышло! Доступ к чек-листу закрыт.");
    return;
  }
  stepNavLock = true;
  setTimeout(() => { stepNavLock = false; }, 320);
  tap();
  saveAnswer();
  if (idx < cur.length - 1) {
    idx++;
    saveShiftDraft();
    renderStep();
    return;
  }
  $("loaderText").textContent = "Отправляем…"; show("loader"); $("steps").hidden = true;
  const win = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow(block) : { deadline: "08:30", isOverdue: false };
  const items = answers.map((a, i) => {
    const curTask = cur[i] || {};
    return Object.assign({}, a, {
      responsible: a.responsible || curTask.responsible || "Администратор",
      photo_url: a.photo_url || a.preview || "",
      photo_base64: a.photo_url ? "" : (a.preview || "")
    });
  });
  const n = answers.filter((a) => a && a.isIncident).length;
  const lateNote = win.isOverdue ? " · ⚠️ Статус: Выполнено с опозданием (после " + win.deadline + ")" : " · ✓ Выполнено в срок";
  clearShiftDraft(true);
  markDone(block);
  idx = 0;
  answers = [];
  choiceMade = false;
  photos = [];
  photo = "";
  window._coffeeSubmittingChecklistNow = true;
  let ok = false;
  try {
    ok = await post({
      action: "submit_checklist",
      sid: uid(),
      location: LOCATION,
      userName,
      block,
      startedAt: checklistStartedAt,
      deadline: win.deadline,
      isLate: win.isOverdue,
      items
    });
  } finally {
    window._coffeeSubmittingChecklistNow = false;
  }
  drawTabs();
  finish(ok, (n ? "Зарегистрировано проблем: " + n : "Все пункты в норме") + lateNote);
  if ($("toDash")) $("toDash").hidden = true;
};

/* ---------- Вкладка 3.2: Информирование и кнопка «Ознакомлен» ---------- */
let ttkShowAllMode = false;
function renderTtkCatalog() {
  const box = $("ttkListContainer");
  if (!box) return;
  const q = ($("ttkSearchIn") ? $("ttkSearchIn").value : "").trim().toLowerCase();
  const allTtk = (window.coffeeGetInstantAdmin && window.coffeeGetInstantAdmin().ttk) || window.COFFEE_DEFAULT_TTK || [];
  if (!q && !ttkShowAllMode) {
    box.innerHTML = '<div class="muted" style="font-size:13px;padding:10px 12px;border-radius:12px;background:var(--bg);border:1px dashed var(--line)">💡 Нажмите на быструю кнопку напитка выше или введите запрос (например, <b>Капучино</b>, <b>Флэт Уайт</b>, <b>Раф</b>), чтобы бот показал точный рецепт и граммовки.</div>';
    return;
  }
  const list = allTtk.filter((t) => !q || (t.name + " " + t.category + " " + t.recipe + " " + (t.serving || "")).toLowerCase().indexOf(q) >= 0);
  if (!list.length) {
    box.innerHTML = '<div class="muted" style="font-size:13px;padding:10px 12px;border-radius:12px;background:var(--bg)">По запросу «' + esc(q) + '» техкарта не найдена. Попробуйте другое название или нажмите «Все ТТК».</div>';
    return;
  }
  box.innerHTML = list.map((t) => (
    '<div style="border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--bg)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<b>' + esc(t.name) + ' <span class="tag">' + esc(t.volume) + '</span></b>' +
        '<span class="tag ok">' + esc(t.category) + ' · ' + esc(t.price) + ' руб.</span>' +
      '</div>' +
      '<div style="font-size:13.5px;margin-top:6px;line-height:1.45"><b>📐 Рецептура:</b> ' + esc(t.recipe) + '</div>' +
      (t.serving ? '<div class="muted" style="font-size:12.5px;margin-top:4px"><b>🍽 Подача:</b> ' + esc(t.serving) + '</div>' : '') +
    '</div>'
  )).join('');
}
if ($("ttkSearchIn")) {
  $("ttkSearchIn").addEventListener("input", () => {
    ttkShowAllMode = false;
    renderTtkCatalog();
  });
}
if ($("ttkShowAllBtn")) {
  $("ttkShowAllBtn").onclick = () => {
    ttkShowAllMode = !ttkShowAllMode;
    if (ttkShowAllMode && $("ttkSearchIn")) $("ttkSearchIn").value = "";
    $("ttkShowAllBtn").textContent = ttkShowAllMode ? "Скрыть список" : "Все ТТК";
    renderTtkCatalog();
  };
}
if ($("ttkQuickChips")) {
  $("ttkQuickChips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-ttkchip]");
    if (!chip) return;
    if ($("ttkSearchIn")) {
      $("ttkSearchIn").value = chip.dataset.ttkchip;
      ttkShowAllMode = false;
      renderTtkCatalog();
    }
  });
}

function getAnnouncementsSource() {
  if (META && Array.isArray(META.announcements) && META.announcements.length) return META.announcements;
  if (typeof getUDB === 'function' && Array.isArray(getUDB().announcements) && getUDB().announcements.length) return getUDB().announcements;
  return (window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_ANNOUNCEMENTS(isoToday())) || [];
}

function renderPersonalTasksInInfo() {
  const pBox = $("personalTasksList");
  if (!pBox) return;
  if ($("personalTasksWho")) $("personalTasksWho").textContent = userName + " · Карта добрых дел и периодические задачи";
  const goodDeeds = (typeof getUDB === "function" && getUDB().goodDeeds) || window.COFFEE_DEFAULT_GOOD_DEEDS || [];
  const showList = goodDeeds.map((g) => ({
    id: g.id,
    title: g.title,
    block: g.frequency || "Периодическая задача",
    instruction: (g.window ? "⏰ Окно: " + g.window + " · " : "") + (g.instruction || ""),
    responsible: g.responsible + (g.reviewer ? " (Проверяющий: " + g.reviewer + ")" : "")
  }));
  if ($("personalTasksCountTag")) $("personalTasksCountTag").textContent = "Задач: " + showList.length;
  const dbPt = (typeof getUDB === "function" && getUDB().personalTasksDone) || {};
  pBox.innerHTML = showList.map((t) => {
    const tId = String(t.id || t.row || "");
    const pCloudKey = isoToday() + ":" + userName + ":" + tId;
    const doneKey = "coffee_ptask_done_" + isoToday() + "_" + tId + "_" + userName;
    let isDoneTask = false;
    if (dbPt[pCloudKey] && typeof dbPt[pCloudKey].done === "boolean") {
      isDoneTask = dbPt[pCloudKey].done;
    } else {
      try { isDoneTask = localStorage.getItem(doneKey) === "1"; } catch (_) {}
    }
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg)">' +
      '<div><b>' + esc(t.title) + '</b> <span class="tag">' + esc(t.block) + '</span>' +
      (t.instruction ? '<div class="muted" style="font-size:12.5px;margin-top:3px">' + esc(t.instruction) + '</div>' : '') +
      '<div class="muted" style="font-size:11.5px;margin-top:2px">Ответственный: <b>' + esc(t.responsible || "Бариста") + '</b></div></div>' +
      '<button type="button" class="b-sm" data-ptaskdone="' + esc(doneKey) + '" data-ptaskid="' + esc(tId) + '" style="padding:7px 12px;border-radius:10px;border:1px solid ' + (isDoneTask ? 'var(--good)' : 'var(--line)') + ';background:' + (isDoneTask ? 'color-mix(in srgb,var(--good) 16%,var(--bg))' : 'var(--surface,#fff)') + ';color:' + (isDoneTask ? 'var(--good)' : 'var(--ink)') + ';font-weight:700;cursor:pointer;white-space:nowrap">' + (isDoneTask ? '✓ Выполнено' : 'Отметить') + '</button>' +
    '</div>';
  }).join("");
}
if ($("personalTasksList")) {
  $("personalTasksList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ptaskdone]");
    if (!b) return;
    const k = b.dataset.ptaskdone;
    const tId = b.dataset.ptaskid || "";
    const pCloudKey = isoToday() + ":" + userName + ":" + tId;
    let nextVal = true;
    try {
      const db = typeof getUDB === "function" ? getUDB() : null;
      const curVal = (db && db.personalTasksDone && db.personalTasksDone[pCloudKey] != null)
        ? !!db.personalTasksDone[pCloudKey].done
        : (localStorage.getItem(k) === "1");
      nextVal = !curVal;
      localStorage.setItem(k, nextVal ? "1" : "0");
    } catch (_) {}
    renderPersonalTasksInInfo();
    post({ action: "toggle_personal_task", date: isoToday(), userName, taskId: tId, done: nextVal, updatedAt: Date.now() }).catch(() => {});
    if (window.coffeePushCloudEnvelopeNow) window.coffeePushCloudEnvelopeNow();
  });
}

function renderInfoView() {
  renderPersonalTasksInInfo();
  renderTtkCatalog();
  const list = getAnnouncementsSource();
  const box = $("infoCardsList");
  if (!box) return;
  const filtered = list.filter((a) => {
    const acks = Array.isArray(a.acks) ? a.acks : [];
    const isAcked = acks.some((k) => String(k.name || "").toLowerCase() === String(userName || "").toLowerCase());
    if (infoFilter === "unread") return !isAcked;
    return true;
  });
  if (!filtered.length) {
    box.innerHTML = '<div class="panel center" style="padding:24px 16px"><h2 style="margin:0 0 8px">Все материалы прочитаны ✓</h2><p class="muted" style="margin:0">Для сотрудника «' + esc(userName) + '» нет непрочитанных объявлений.</p></div>';
    return;
  }
  box.innerHTML = filtered.map((a) => {
    const acks = Array.isArray(a.acks) ? a.acks : [];
    const myAck = acks.find((k) => String(k.name || "").toLowerCase() === String(userName || "").toLowerCase());
    const targetList = Array.isArray(a.targetStaff) && a.targetStaff.length ? a.targetStaff : ["Соня", "Алина", "Настя"];
    const calDateStr = a.calendarDate ? String(a.calendarDate).split("-").reverse().join(".") : "";
    return '<div class="info-card ' + (myAck ? "acked" : "unread") + '">' +
      (calDateStr ? '<div class="cal-pill">📅 Событие календаря: ' + calDateStr + (a.calendarEventTitle ? ' — ' + esc(a.calendarEventTitle) : '') + '</div>' : '') +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--bg);color:var(--brew)">' + esc(a.category || "Объявление") + '</span>' +
        '<span class="muted" style="font-size:12px">Опубликовано: ' + String(a.publishedAt || isoToday()).split("-").reverse().join(".") + (a.validTo ? ' · Актуально до ' + String(a.validTo).split("-").reverse().join(".") : '') + '</span>' +
      '</div>' +
      '<h3 style="font-size:18px;margin:8px 0">' + esc(a.title || "") + '</h3>' +
      '<p class="instr" style="margin:0 0 12px;white-space:pre-line">' + esc(a.text || "") + '</p>' +
      (a.mediaUrl ? '<div style="margin-bottom:12px">' + (window.coffeeMediaHtml ? window.coffeeMediaHtml(a.mediaUrl, a.title) : '') + '</div>' : '') +
      '<div class="muted" style="font-size:12px;margin-bottom:10px">Назначено: ' + esc(targetList.join(", ")) + '</div>' +
      (myAck
        ? '<div style="padding:10px;border-radius:12px;background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good);font-weight:700;font-size:14px;text-align:center">✓ Вы ознакомились (' + esc(myAck.name) + ' · ' + esc(myAck.at) + ')</div>'
        : '<button type="button" class="btn" data-ackinfo="' + esc(a.id) + '" style="min-height:48px;font-size:15px">✅ Ознакомлен (' + esc(userName) + ')</button>') +
    '</div>';
  }).join("");
}

if ($("infoFilterSeg")) {
  $("infoFilterSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-iflt]");
    if (!b) return;
    infoFilter = b.dataset.iflt;
    document.querySelectorAll("#infoFilterSeg button").forEach((x) => x.className = x.dataset.iflt === infoFilter ? "ok" : "");
    renderInfoView();
  });
}

if ($("infoCardsList")) {
  $("infoCardsList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ackinfo]");
    if (!b) return;
    const infoId = b.dataset.ackinfo;
    b.disabled = true;
    b.textContent = "Сохраняем подтверждение…";
    const tm = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const stamp = isoToday().split("-").reverse().join(".") + " " + tm;
    const list = getAnnouncementsSource();
    const item = list.find((x) => x.id === infoId);
    if (item) {
      item.acks = item.acks || [];
      if (!item.acks.some((k) => String(k.name || "").toLowerCase() === String(userName || "").toLowerCase())) {
        item.acks.push({ name: userName, at: stamp });
      }
    }
    drawTabs();
    renderInfoView();
    toast("✓ Вы ознакомлены с материалом (" + userName + ")");
    await post({ action: "ack_announcement", id: infoId, userName });
  });
}

let qiMediaList = [];
function renderQiMediaPreview() {
  const box = $("qiMediaPreview");
  if (!box) return;
  box.hidden = qiMediaList.length === 0;
  box.innerHTML = qiMediaList.map((src, i) => {
    const isVid = /^data:video/.test(src);
    return '<div class="qi-media-item">' +
      (isVid ? '<video src="' + src + '" muted playsinline></video>' : '<img src="' + src + '" alt="Фото поломки">') +
      '<button type="button" class="qi-media-del" data-qidel="' + i + '" title="Удалить">×</button>' +
    '</div>';
  }).join("");
}
/* Только живая камера (фото / видео / фронталка) — без выбора из галереи */
async function captureQi(mode) {
  if (!window.coffeeCamera) { toast("Камера недоступна"); return; }
  const src = await window.coffeeCamera.open({ mode, facing: "environment", stamp: LOCATION + " · " + userName });
  if (src) { qiMediaList.push(src); renderQiMediaPreview(); }
}
function bindBtn(id, fn) {
  const b = $(id); if (!b) return;
  b.addEventListener("click", fn);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
}
bindBtn("qiPhotoBtn", () => captureQi("photo"));
bindBtn("qiVideoBtn", () => captureQi("video"));
if ($("qiMediaPreview")) {
  $("qiMediaPreview").addEventListener("click", (e) => {
    const b = e.target.closest("[data-qidel]");
    if (!b) return;
    qiMediaList.splice(Number(b.dataset.qidel), 1);
    renderQiMediaPreview();
  });
}
function openQuickInc() {
  $("qiStep").value = "";
  $("qiText").value = "";
  qiMediaList = [];
  renderQiMediaPreview();
  safeShowModal($("quickIncDlg"));
}
/* кнопка «Сообщить о поломке» доступна с любого экрана: в шапке и во вкладке «Инфо» */
["quickIncidentBtn", "quickIncidentTopBtn"].forEach((id) => { if ($(id)) $(id).onclick = openQuickInc; });
if ($("qiCancel")) $("qiCancel").onclick = () => safeCloseModal($("quickIncDlg"));
if ($("qiCloseX")) $("qiCloseX").onclick = () => safeCloseModal($("quickIncDlg"));
if ($("quickIncForm")) {
  $("quickIncForm").onsubmit = async (e) => {
    e.preventDefault();
    const txt = $("qiText").value.trim();
    if (txt.length < 3) { toast("Опишите проблему (минимум 3 символа)"); if ($("qiText")) $("qiText").focus(); return; }
    const btn = $("qiSubmit");
    if (btn) { btn.disabled = true; btn.textContent = "Отправка…"; }
    const ok = await post({
      action: "report_standalone_incident",
      userName,
      incType: $("qiType").value,
      step: $("qiStep").value.trim() || $("qiType").value,
      text: txt,
      priority: $("qiPriority").value,
      photo: qiMediaList[0] || "",
      photos: qiMediaList.slice()
    });
    if (btn) { btn.disabled = false; btn.textContent = "🚨 Отправить руководителю"; }
    safeCloseModal($("quickIncDlg"));
    toast(ok ? "🚨 Сообщение о поломке отправлено руководителю!" : "🚨 Сохранено офлайн — отправится при появлении сети!");
  };
}


/* ---------- отправка с очередью на случай offline ---------- */
function getQ() { try { return JSON.parse(localStorage.getItem("coffee_illy_queue") || "[]"); } catch (e) { return []; } }
function setQ(q) { try { localStorage.setItem("coffee_illy_queue", JSON.stringify(q)); return true; } catch (e) { return false; } }
async function api(p) {
  const d = await coffeeFetch(API_URL, { method: "POST", body: JSON.stringify(p) }, 5000);
  if (!d || d.ok === false) throw new Error((d && d.error) || "ошибка сервера"); return d;
}
const sendRaw = api;
async function post(p) {
  try {
    await sendRaw(p);
    return true;
  } catch (e) {
    if (typeof window.applyLocalMutation === "function") {
      try { window.applyLocalMutation(p); } catch (_) {}
    }
    const errMsg = String((e && e.message) || e || "");
    if (/VALIDATION_FAILED|INVALID_REQUEST_JSON|PIN_REQUIRED|PIN_INVALID|UNKNOWN_ACTION|FORBIDDEN/i.test(errMsg)) {
      queueUI();
      if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
      return true;
    }
    const q = getQ(); q.push(p);
    if (!setQ(q)) {
      q.pop(); const light = JSON.parse(JSON.stringify(p));
      if (light.items) light.items.forEach((i) => i.photo_base64 = "");
      q.push(light); setQ(q);
    }
    queueUI(); if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0); return false;
  }
}
let _legacyFlushing = false;
async function flush() {
  if (_legacyFlushing) return;
  const q = getQ(); if (!q.length) { if (window.coffeeFlushOutbox) { try { await window.coffeeFlushOutbox(); } catch (_) {} } return; }
  _legacyFlushing = true;
  try {
    const rest = [];
    for (const p of q) {
      if (typeof window.applyLocalMutation === "function") {
        try { window.applyLocalMutation(p); } catch (_) {}
      }
      try { await sendRaw(p); }
      catch (e) {
        const msg = String((e && e.message) || e || "");
        if (/VALIDATION_FAILED|INVALID_REQUEST_JSON|PIN_REQUIRED|PIN_INVALID|UNKNOWN_ACTION|FORBIDDEN/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine !== false)) {
          // Уже применено локально или передано в основной outbox coffeeFetch — не блокируем баннер терминала
        } else {
          rest.push(p);
        }
      }
    }
    setQ(rest); queueUI();
    if (window.coffeeFlushOutbox) { try { await window.coffeeFlushOutbox(); } catch (_) {} }
    if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(q.length - rest.length);
  } finally { _legacyFlushing = false; }
}
function queueUI() {
  const n = getQ().length;
  $("queueNote").hidden = !n;
  $("queueText").textContent = "Не отправлено отчётов: " + n;
}
$("queueBtn").onclick = flush;
window.addEventListener("online", flush);
/* Автоотправка без участия пользователя: при запуске, при возврате на вкладку и по таймеру */
const _autoFlush = () => { if (typeof navigator !== "undefined" && navigator.onLine === false) return; if (getQ().length) flush(); };
setTimeout(_autoFlush, 1500);
setInterval(_autoFlush, 8000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") _autoFlush(); });

/* Реактивное обновление терминала при любых изменениях в разделе «Управление» (без сетевых петель и мигания) */
let _termSyncDebounceTimer = null;
function syncFromAdminChanges() {
  if (_termSyncDebounceTimer) clearTimeout(_termSyncDebounceTimer);
  _termSyncDebounceTimer = setTimeout(() => {
    if (typeof reloadTerminalFromVault === "function") reloadTerminalFromVault();
  }, 150);
}


function finish(ok, text) {
  tgt(() => tg.HapticFeedback.notificationOccurred("success"));
  $("steps").hidden = true; show("doneView");
  $("doneTitle").textContent = "✅ Отчёт успешно выполнен";
  const pendingCnt = window.coffeeGetTotalPendingCount ? window.coffeeGetTotalPendingCount() : getQ().length;
  const isOffline = !ok || (typeof navigator !== "undefined" && navigator.onLine === false) || pendingCnt > 0;
  $("doneText").textContent = isOffline
    ? ((text ? text + " · " : "") + "Сохранено офлайн — данные автоматически отправятся в систему при появлении интернета.")
    : (text || "Данные успешно записаны в систему.");
  if (window.coffeeRenderNetBadge) window.coffeeRenderNetBadge(0);
}

/* ---------- касса: CSV и сверка счётчика v54 ---------- */
async function readText(file) {
  const buf = await file.arrayBuffer();
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { s = new TextDecoder("windows-1251").decode(buf); }
  return s.replace(/^\uFEFF/, "");
}
function parseCsv(text) {
  if (window.CoffeeSalesReconciliation && window.CoffeeSalesReconciliation.parseCsvRows) {
    return window.CoffeeSalesReconciliation.parseCsvRows(text).map((r) => r.map((c) => String(c || "").trim()));
  }
  const first = text.split("\n")[0] || "";
  const d = first.split(";").length >= first.split(",").length ? ";" : ",";
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const out = []; let c = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) { out.push(c); c = ""; }
      else c += ch;
    }
    out.push(c); return out.map((s) => s.trim());
  });
}
const num = (s) => parseFloat(String(s || "0").replace(/\s/g, "").replace(",", ".")) || 0;

const SAMPLE_FILES_DB = window.SAMPLE_FILES_DB || {};
let lastParsedShiftDays = [];
let activeShiftCounterCups = null;
let sessionUploadedCsvHashes = new Set();

function isCsvHashAlreadyUploaded(hash, dateStr) {
  if (!hash) return false;
  if (sessionUploadedCsvHashes.has(hash)) return true;
  try {
    if (typeof getUDB === "function") {
      const db = getUDB();
      const d = dateStr || reportDate || isoToday();
      if (db.uploadedCsvHashes && db.uploadedCsvHashes[d + ":" + hash]) return true;
      const dayRec = (db.cash || []).find((c) => c && c.date === d);
      if (dayRec && Array.isArray(dayRec.csvHashes) && dayRec.csvHashes.includes(hash)) return true;
    }
  } catch (_) {}
  return false;
}

function extractMetaFromFilename(fname) {
  if (window.CoffeeSalesReconciliation && window.CoffeeSalesReconciliation.extractFileMeta) {
    return window.CoffeeSalesReconciliation.extractFileMeta(fname);
  }
  return { date: "", barista: "", specificBarista: "", dayBaristas: [], isSales: /продаж/i.test(fname), isTrans: /транзакц/i.test(fname) };
}

function detectCsvKind(rowsOrText, fname) {
  const head = Array.isArray(rowsOrText)
    ? (rowsOrText[0] || []).join(" ").toLowerCase()
    : String(rowsOrText || "").split(/\r?\n/)[0].toLowerCase();
  if (/способ оплаты|сумма документа/.test(head)) return "trans";
  if (/номенклатура|номиенклатура|количество/.test(head)) return "sales";
  const meta = extractMetaFromFilename(fname);
  if (meta.isTrans) return "trans";
  return "sales";
}

function calcTrans(rowsOrText, fname) {
  const SR = window.CoffeeSalesReconciliation;
  const rawText = typeof rowsOrText === "string"
    ? rowsOrText
    : (rowsOrText || []).map((r) => r.map((c) => '"' + String(c || "").replace(/"/g, '""') + '"').join(",")).join("\n");
  if (SR && SR.parseTransactionsCsv) {
    return SR.parseTransactionsCsv(rawText, fname);
  }
  throw new Error("Модуль CoffeeSalesReconciliation не загружен");
}

function calcSales(rowsOrText, fname) {
  const SR = window.CoffeeSalesReconciliation;
  const rawText = typeof rowsOrText === "string"
    ? rowsOrText
    : (rowsOrText || []).map((r) => r.map((c) => '"' + String(c || "").replace(/"/g, '""') + '"').join(",")).join("\n");
  if (SR && SR.parseSalesCsv) {
    const parsed = SR.parseSalesCsv(rawText, fname);
    const list = parsed.sortedProducts.slice();
    list.total = parsed.revenue;
    list.revenue = parsed.revenue;
    list.totalQty = parsed.totalQty;
    list.coffeeCups = parsed.coffeeQty;
    list.coffeeQty = parsed.coffeeQty;
    list.nonCoffeeQty = parsed.nonCoffeeQty;
    list.reviewQty = parsed.reviewQty;
    list.warnings = parsed.warnings || [];
    list.hash = parsed.hash;
    list.date = parsed.date;
    list.barista = parsed.barista;
    list.specificBarista = parsed.specificBarista;
    list.dayBaristas = parsed.dayBaristas;
    list.products = parsed.products;
    list.byDate = parsed.byDate;
    return list;
  }
  throw new Error("Модуль CoffeeSalesReconciliation не загружен");
}

function applyParsedCsv(kind, data, labelName) {
  if (kind === "trans") {
    trans = data;
    $("fTrans").classList.add("ok");
    $("transState").textContent = "✓ " + labelName + " · нал " + rub(data.cash) + " + моб. " + rub(data.card) + " (" + data.checks + " чеков)";
    if (data.date && data.date <= isoToday()) setReportDate(data.date);
    if (data.barista) { $("shiftBaristaIn").value = data.barista; $("who").textContent = data.barista; }
  } else {
    sales = data;
    $("fSales").classList.add("ok");
    $("salesState").textContent = "✓ " + labelName + " · выручка " + rub(data.total) + " · кофе по номенклатуре: " + data.coffeeQty + " шт. · не кофе: " + data.nonCoffeeQty + " шт." + (data.reviewQty ? " · на проверку: " + data.reviewQty + " шт." : "");
    if (data.date && data.date <= isoToday() && (!trans || !trans.date)) setReportDate(data.date);
    if (data.barista && !$("shiftBaristaIn").value) { $("shiftBaristaIn").value = data.barista; $("who").textContent = data.barista; }
    if (!trans && data.total > 0) {
      // Важный принцип: количество чеков не подменяет количество проданных кофейных напитков!
      trans = {
        cash: data.total,
        card: 0,
        checks: data.totalQty || data.coffeeQty || 1,
        coffeeQty: data.coffeeQty,
        nonCoffeeQty: data.nonCoffeeQty,
        reviewQty: data.reviewQty,
        date: data.date || reportDate,
        barista: data.barista || userName,
        fromSalesOnly: true
      };
    }
  }
  renderCash();
}

let batchDaysMap = {};

function ensureBatchDayRecord(dateStr) {
  const d = dateStr || reportDate || isoToday();
  if (!batchDaysMap[d]) {
    batchDaysMap[d] = {
      date: d,
      baristas: [],
      shiftsByBarista: {},
      shifts: [],
      cash: 0,
      card: 0,
      checks: 0,
      writeoff: 0,
      writeoffShots: 0,
      coffeeQty: 0,
      nonCoffeeQty: 0,
      reviewQty: 0,
      salesTotal: 0,
      counterStart: null,
      counterEnd: null,
      productsMap: {},
      csvHashes: [],
      files: []
    };
  }
  return batchDaysMap[d];
}

function ensureShiftInBatchDay(rec, baristaName) {
  const bName = String(baristaName || "Бариста").trim() || "Бариста";
  if (!rec.baristas.includes(bName)) rec.baristas.push(bName);
  if (!rec.shiftsByBarista[bName]) {
    rec.shiftsByBarista[bName] = {
      name: bName,
      cash: 0,
      card: 0,
      checks: 0,
      salesRevenue: 0,
      writeoff: 0,
      writeoffShots: 0,
      coffeeQty: 0,
      nonCoffeeQty: 0,
      reviewQty: 0,
      prevCounter: null,
      counter: null,
      cups: 0
    };
  }
  return rec.shiftsByBarista[bName];
}

function mergeIntoBatchDay(dateStr, baristaName, part) {
  const d = dateStr || reportDate || isoToday();
  const sumMode = !$("sumModeChk") || $("sumModeChk").checked;
  if (!sumMode && !batchDaysMap[d]) {
    batchDaysMap = {};
  }
  const rec = ensureBatchDayRecord(d);
  if (part.hash) {
    if (rec.csvHashes.includes(part.hash)) {
      toast("⚠️ Повторная загрузка CSV пропущена (дубликат по хэшу): " + (part.fileName || part.hash));
      return false;
    }
    rec.csvHashes.push(part.hash);
  }
  if (baristaName) {
    baristaName.split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => {
      if (!rec.baristas.includes(n)) rec.baristas.push(n);
    });
  }
  if (part.fileName && !rec.files.includes(part.fileName)) rec.files.push(part.fileName);
  const primaryBarista = (part.specificBarista || (baristaName ? baristaName.split(",")[0].trim() : "") || "Бариста");

  if (part.kind === "trans") {
    rec.cash += part.cash || 0;
    rec.card += part.card || 0;
    rec.checks += part.checks || 0;
    const sh = ensureShiftInBatchDay(rec, primaryBarista);
    sh.cash += part.cash || 0;
    sh.card += part.card || 0;
    sh.checks += part.checks || 0;
  } else if (part.kind === "sales") {
    rec.salesTotal += part.total || 0;
    rec.coffeeQty += part.coffeeQty != null ? part.coffeeQty : (part.coffeeCups || 0);
    rec.nonCoffeeQty += part.nonCoffeeQty || 0;
    rec.reviewQty += part.reviewQty || 0;
    const sh = ensureShiftInBatchDay(rec, primaryBarista);
    sh.salesRevenue += part.total || 0;
    sh.coffeeQty += part.coffeeQty != null ? part.coffeeQty : (part.coffeeCups || 0);
    sh.nonCoffeeQty += part.nonCoffeeQty || 0;
    sh.reviewQty += part.reviewQty || 0;
    sh.cups = sh.coffeeQty;
    (part.items || part.products || []).forEach((it) => {
      if (!it || !it.name) return;
      const pm = rec.productsMap[it.name] || (rec.productsMap[it.name] = {
        name: it.name,
        price: it.price || 0,
        kind: it.kind || (window.CoffeeSalesReconciliation ? window.CoffeeSalesReconciliation.classifyCoffee(it.name) : "coffee"),
        qty: 0,
        sum: 0,
        date: d,
        barista: primaryBarista,
        csvHash: part.hash || ""
      });
      pm.qty += it.qty || 0;
      pm.sum += it.sum || 0;
    });
  } else if (part.kind === "shift") {
    if (part.counterStart != null && rec.counterStart === null) rec.counterStart = part.counterStart;
    if (part.counterEnd != null) rec.counterEnd = part.counterEnd;
    rec.writeoffShots += part.writeoffShots != null ? part.writeoffShots : (part.writeoff || 0);
    if (Array.isArray(part.shifts)) {
      part.shifts.forEach((s) => {
        const sh = ensureShiftInBatchDay(rec, s.name || primaryBarista);
        if (s.cash && !sh.cash && !sh.card) sh.cash = s.cash;
        if (s.card && !sh.card) sh.card = s.card;
        if (s.prevCounter != null) sh.prevCounter = s.prevCounter;
        if (s.counter != null) sh.counter = s.counter;
        sh.writeoffShots += Number(s.writeoffShots != null ? s.writeoffShots : (s.writeoffQty != null ? s.writeoffQty : s.writeoff)) || 0;
        if (!sh.coffeeQty && s.cupsSold != null) sh.cups = s.cupsSold;
      });
    }
  }
  return true;
}

function finalizeBatchDay(dObj) {
  const products = Object.values(dObj.productsMap || {}).sort((a, b) => b.qty - a.qty);
  const shiftsList = Object.values(dObj.shiftsByBarista || {}).map((sh) => {
    const effCash = (sh.cash + sh.card > 0) ? sh.cash : (sh.salesRevenue || 0);
    const effCard = sh.card || 0;
    const effChecks = sh.checks || sh.coffeeQty || 1;
    const delta = (sh.prevCounter != null && sh.counter != null && window.coffeeCounterDelta)
      ? window.coffeeCounterDelta(sh.prevCounter, sh.counter)
      : null;
    const rec = (delta !== null && window.CoffeeSalesReconciliation)
      ? window.CoffeeSalesReconciliation.reconcile(delta, { coffeeQty: sh.coffeeQty, nonCoffeeQty: sh.nonCoffeeQty, reviewQty: sh.reviewQty }, sh.writeoffShots || 0, 0)
      : null;
    return {
      name: sh.name,
      cash: effCash,
      card: effCard,
      checks: effChecks,
      writeoff: sh.writeoff || 0,
      writeoffShots: sh.writeoffShots || 0,
      prevCounter: sh.prevCounter,
      counter: sh.counter,
      counterDelta: delta,
      coffeeQty: sh.coffeeQty || 0,
      nonCoffeeQty: sh.nonCoffeeQty || 0,
      reviewQty: sh.reviewQty || 0,
      unaccountedShots: rec ? rec.unaccountedShots : 0,
      cups: sh.coffeeQty || sh.cups || effChecks
    };
  });

  const totalFromShiftsCash = shiftsList.reduce((a, s) => a + (s.cash || 0), 0);
  const totalFromShiftsCard = shiftsList.reduce((a, s) => a + (s.card || 0), 0);
  const cash = (dObj.cash + dObj.card > 0) ? dObj.cash : (totalFromShiftsCash || dObj.salesTotal || 0);
  const card = (dObj.cash + dObj.card > 0) ? dObj.card : (totalFromShiftsCard || 0);
  const coffeeQty = dObj.coffeeQty || shiftsList.reduce((a, s) => a + (s.coffeeQty || 0), 0);
  const nonCoffeeQty = dObj.nonCoffeeQty || shiftsList.reduce((a, s) => a + (s.nonCoffeeQty || 0), 0);
  const reviewQty = dObj.reviewQty || shiftsList.reduce((a, s) => a + (s.reviewQty || 0), 0);
  const checks = dObj.checks || shiftsList.reduce((a, s) => a + (s.checks || 0), 0) || (coffeeQty + nonCoffeeQty + reviewQty) || 1;
  const writeoffShots = dObj.writeoffShots || shiftsList.reduce((a, s) => a + (s.writeoffShots || 0), 0);
  const writeoffRub = dObj.writeoff || shiftsList.reduce((a, s) => a + (s.writeoff || 0), 0);

  const firstWithStart = shiftsList.find((s) => s.prevCounter != null);
  const lastWithEnd = shiftsList.slice().reverse().find((s) => s.counter != null);
  const counterStart = dObj.counterStart != null ? dObj.counterStart : (firstWithStart ? firstWithStart.prevCounter : null);
  const counterEnd = dObj.counterEnd != null ? dObj.counterEnd : (lastWithEnd ? lastWithEnd.counter : null);
  const totalGrinderShots = shiftsList.some((s) => s.counterDelta != null)
    ? shiftsList.reduce((a, s) => a + (s.counterDelta || 0), 0)
    : ((counterStart != null && counterEnd != null && window.coffeeCounterDelta) ? (window.coffeeCounterDelta(counterStart, counterEnd) || 0) : 0);
  const unaccountedShots = totalGrinderShots > 0 ? Math.max(0, totalGrinderShots - (coffeeQty + writeoffShots)) : 0;

  return {
    date: dObj.date,
    barista: dObj.baristas.join(", ") || "Бариста",
    shifts: shiftsList.length ? shiftsList : [{ name: dObj.baristas.join(", ") || "Бариста", cash, card, checks, writeoff: writeoffRub, writeoffShots, coffeeQty, nonCoffeeQty, reviewQty, cups: coffeeQty || checks }],
    cash,
    card,
    revenue: cash + card,
    checks,
    writeoff: writeoffRub,
    writeoffShots,
    counterStart,
    counterEnd,
    counterDelta: totalGrinderShots,
    coffeeCups: coffeeQty,
    coffeeQty,
    nonCoffeeQty,
    reviewQty,
    unaccountedShots,
    salesTotal: dObj.salesTotal || (cash + card),
    products: products,
    csvHashes: dObj.csvHashes || [],
    topItems: products.slice(0, 3).map((x) => x.name.replace(/\s+(шт\.?|бут\.?)$/i, "") + " ×" + x.qty).join(", "),
    files: dObj.files || []
  };
}

function renderBatchSummaryUI() {
  const box = $("batchSummaryBox");
  const keys = Object.keys(batchDaysMap).sort();
  if (!keys.length) { box.hidden = true; return; }
  const list = keys.map((k) => finalizeBatchDay(batchDaysMap[k]));
  const grandRev = list.reduce((s, x) => s + x.revenue, 0);
  const grandWoShots = list.reduce((s, x) => s + (x.writeoffShots || 0), 0);
  const grandCoffee = list.reduce((s, x) => s + (x.coffeeQty || 0), 0);
  const grandReview = list.reduce((s, x) => s + (x.reviewQty || 0), 0);

  box.hidden = false;
  box.innerHTML =
    '<div style="background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<b>📊 Сводка по распознанным датам и сменам (' + list.length + ' дн.)</b>' +
        '<span style="font-size:13px"><b style="color:var(--good)">Выручка: ' + rub(grandRev) + '</b> · ☕ Кофе (номенклатура): <b>' + grandCoffee + ' шт.</b>' + (grandReview ? ' · <b style="color:var(--warn)">На проверку: ' + grandReview + ' шт.</b>' : '') + (grandWoShots ? ' · <b style="color:var(--bad)">Списания: ' + grandWoShots + ' порц.</b>' : '') + '</span>' +
      '</div>' +
      list.map((d) => (
        '<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13.5px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<div>' +
            '<b>📅 ' + esc(d.date.split("-").reverse().join(".")) + '</b> · 👤 <b>' + esc(d.barista) + '</b>' +
            (d.shifts.length > 1 ? ' <span style="font-size:11.5px;padding:1px 6px;border-radius:99px;background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good);font-weight:700">Смен: ' + d.shifts.length + '</span>' : '') +
            '<div class="muted" style="font-size:12px">Нал: ' + rub(d.cash) + ' · Безнал: ' + rub(d.card) + ' · Чеков: ' + d.checks + ' · Кофе: <b>' + d.coffeeQty + ' шт.</b> · Не кофе: ' + d.nonCoffeeQty + ' шт.' + (d.reviewQty ? ' · <span style="color:var(--warn)">Неопределённых: ' + d.reviewQty + ' шт.</span>' : '') + '</div>' +
            (d.shifts.length > 1 ? '<div class="muted" style="font-size:11.5px;margin-top:2px">' + d.shifts.map((s) => esc(s.name) + ': ' + rub(s.cash + s.card) + ' (кофе ' + (s.coffeeQty || 0) + ' шт.' + (s.counterDelta != null ? ', счётчик +' + s.counterDelta : '') + ')').join(' · ') + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right">' +
            '<b style="color:var(--good);font-size:15px">' + rub(d.revenue) + '</b>' +
            (d.unaccountedShots > 0 ? '<div style="color:var(--bad);font-size:12px;font-weight:700">⚠️ Разница счётчика: ' + d.unaccountedShots + ' порц.</div>' : '') +
          '</div>' +
        '</div>'
      )).join("") +
      '<button type="button" class="btn" id="saveAllBatchBtn" style="margin-top:12px;min-height:46px;font-size:15px">💾 Записать все распознанные дни (' + list.length + ') и номенклатуру в систему</button>' +
    '</div>';

  /* Подставляем последний распознанный день в основную карточку Кассы */
  const last = list[list.length - 1];
  if (last) {
    setReportDate(last.date);
    $("shiftBaristaIn").value = last.barista;
    $("who").textContent = last.barista;
    if ($("writeOffs")) $("writeOffs").value = last.writeoff || 0;
    if ($("writeOffShots")) $("writeOffShots").value = last.writeoffShots || 0;
    if ($("counterStartIn") && last.counterStart != null) $("counterStartIn").value = last.counterStart;
    if ($("counterEndIn") && last.counterEnd != null) $("counterEndIn").value = last.counterEnd;
    activeShiftCounterCups = last.coffeeQty;
    trans = {
      cash: last.cash,
      card: last.card,
      checks: last.checks,
      date: last.date,
      barista: last.barista,
      shifts: last.shifts,
      coffeeQty: last.coffeeQty,
      nonCoffeeQty: last.nonCoffeeQty,
      reviewQty: last.reviewQty,
      csvHashes: last.csvHashes
    };
    if (last.products && last.products.length) {
      sales = last.products.slice();
      sales.total = last.salesTotal || last.revenue;
      sales.coffeeCups = last.coffeeQty;
      sales.coffeeQty = last.coffeeQty;
      sales.nonCoffeeQty = last.nonCoffeeQty;
      sales.reviewQty = last.reviewQty;
      sales.totalQty = last.coffeeQty + last.nonCoffeeQty + last.reviewQty;
      sales.csvHashes = last.csvHashes;
    }
    renderCash();
  }

  $("saveAllBatchBtn").onclick = async () => {
    const mergeMode = (!$("sumModeChk") || $("sumModeChk").checked) ? "sum" : "replace";
    await post({ action: "batch_submit_cash", mergeMode, days: list });
    markDone("КАССА"); drawTabs();
    finish(true, "Сохранено дней: " + list.length + " · Общая выручка " + rub(grandRev) + " · Кофейных напитков по номенклатуре: " + grandCoffee + " шт. · Данные записаны в «Кассу» и «Продажи».");
    if ($("toDash")) $("toDash").hidden = true;
  };
}

$("unifiedFilesIn").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  if (!$("sumModeChk") || !$("sumModeChk").checked) batchDaysMap = {};
  let processedCount = 0;
  let skippedDupCount = 0;
  for (const f of files) {
    try {
      const txt = await readText(f);
      if (/сч[её]тчик/i.test(txt) && !/способ оплаты|номенклатура|номиенклатура/i.test(txt)) {
        const sDays = parseShiftCounterText(txt, Number($("initCounterIn").value) || 600);
        sDays.forEach((sd) => {
          mergeIntoBatchDay(sd.date, sd.baristas.join(", "), {
            kind: "shift",
            fileName: f.name,
            cash: sd.totalCash,
            card: 0,
            checks: sd.totalSoldCups || sd.totalCups,
            cups: sd.totalCups,
            writeoffShots: sd.totalWoQty,
            counterStart: sd.startCounter,
            counterEnd: sd.endCounter,
            shifts: sd.shifts.map((s) => ({
              name: s.name,
              cash: s.cash,
              card: 0,
              checks: s.cupsSold || s.cupsTotal || 0,
              writeoffShots: s.writeoffQty,
              prevCounter: s.prevCounter,
              counter: s.counter,
              cups: s.cupsTotal
            }))
          });
        });
        processedCount++;
      } else {
        const kind = detectCsvKind(txt, f.name);
        if (kind === "trans") {
          const td = calcTrans(txt, f.name);
          if (isCsvHashAlreadyUploaded(td.hash, td.date)) {
            skippedDupCount++;
            toast("⚠️ Файл транзакций «" + f.name + "» уже загружен ранее (защита по хэшу)");
            continue;
          }
          sessionUploadedCsvHashes.add(td.hash);
          const datesKeys = Object.keys(td.byDate || {});
          if (datesKeys.length > 1) {
            datesKeys.forEach((dKey) => {
              const dSlice = td.byDate[dKey];
              Object.values(dSlice.shiftsByBarista || {}).forEach((bSlice) => {
                mergeIntoBatchDay(dKey, bSlice.name, {
                  kind: "trans",
                  fileName: f.name,
                  hash: td.hash + "_" + dKey + "_" + bSlice.name,
                  specificBarista: bSlice.name,
                  cash: Math.round(bSlice.cash),
                  card: Math.round(bSlice.card),
                  checks: bSlice.checks
                });
              });
            });
          } else {
            mergeIntoBatchDay(td.date, td.barista, {
              kind: "trans",
              fileName: f.name,
              hash: td.hash,
              specificBarista: td.specificBarista,
              cash: td.cash,
              card: td.card,
              checks: td.checks
            });
          }
          applyParsedCsv("trans", td, f.name);
          processedCount++;
        } else {
          const sd = calcSales(txt, f.name);
          if (isCsvHashAlreadyUploaded(sd.hash, sd.date)) {
            skippedDupCount++;
            toast("⚠️ Файл продаж «" + f.name + "» уже загружен ранее (защита по хэшу)");
            continue;
          }
          sessionUploadedCsvHashes.add(sd.hash);
          const datesKeys = Object.keys(sd.byDate || {});
          if (datesKeys.length > 1) {
            datesKeys.forEach((dKey) => {
              const dSlice = sd.byDate[dKey];
              mergeIntoBatchDay(dKey, sd.barista, {
                kind: "sales",
                fileName: f.name,
                hash: sd.hash + "_" + dKey,
                specificBarista: sd.specificBarista,
                total: dSlice.revenue,
                coffeeQty: dSlice.coffeeQty,
                nonCoffeeQty: dSlice.nonCoffeeQty,
                reviewQty: dSlice.reviewQty,
                items: dSlice.products
              });
            });
          } else {
            mergeIntoBatchDay(sd.date, sd.barista, {
              kind: "sales",
              fileName: f.name,
              hash: sd.hash,
              specificBarista: sd.specificBarista,
              total: sd.total,
              coffeeQty: sd.coffeeQty,
              nonCoffeeQty: sd.nonCoffeeQty,
              reviewQty: sd.reviewQty,
              items: sd.products
            });
          }
          applyParsedCsv("sales", sd, f.name);
          processedCount++;
        }
      }
    } catch (err) {
      toast("Не удалось обработать " + f.name + ": " + (err && err.message ? err.message : ""));
    }
  }
  $("fUnified").classList.add("ok");
  $("unifiedState").textContent = "✓ Обработано файлов: " + processedCount + (skippedDupCount ? " (пропущено дубликатов: " + skippedDupCount + ")" : "") + " · разбито по датам и бариста";
  renderBatchSummaryUI();
});

document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
  const key = btn.dataset.preset;
  if (key === "all_batch") {
    batchDaysMap = {};
    sessionUploadedCsvHashes.clear();
    ["30_10", "31_10", "01_11"].forEach((k) => {
      const p = SAMPLE_FILES_DB[k];
      if (!p) return;
      if (p.transCsv) {
        const td = calcTrans(p.transCsv, p.transName);
        mergeIntoBatchDay(td.date, td.barista, { kind: "trans", fileName: p.transName, hash: td.hash, specificBarista: td.specificBarista, cash: td.cash, card: td.card, checks: td.checks });
      }
      if (p.salesCsv) {
        const sd = calcSales(p.salesCsv, p.salesName);
        mergeIntoBatchDay(sd.date, sd.barista, { kind: "sales", fileName: p.salesName, hash: sd.hash, specificBarista: sd.specificBarista, total: sd.total, coffeeQty: sd.coffeeQty, nonCoffeeQty: sd.nonCoffeeQty, reviewQty: sd.reviewQty, items: sd.products });
      }
    });
    const sDays = parseShiftCounterText(SAMPLE_FILES_DB.shift_text, 600);
    sDays.forEach((sd) => {
      mergeIntoBatchDay(sd.date, sd.baristas.join(", "), {
        kind: "shift", fileName: "Смены 3.11 и 4.11", cash: sd.totalCash, card: 0,
        checks: sd.totalSoldCups || sd.totalCups, cups: sd.totalCups, writeoffShots: sd.totalWoQty,
        counterStart: sd.startCounter, counterEnd: sd.endCounter,
        shifts: sd.shifts.map((s) => ({ name: s.name, cash: s.cash, card: 0, checks: s.cupsSold || s.cupsTotal || 0, writeoffShots: s.writeoffQty, prevCounter: s.prevCounter, counter: s.counter, cups: s.cupsTotal }))
      });
    });
    $("fUnified").classList.add("ok");
    $("unifiedState").textContent = "✓ Загружен пакет за 5 дней (Пт 30.10 – Ср 04.11) с суммированием смен Алины и Сони";
    renderBatchSummaryUI();
    toast("Все 5 дней распознаны, разбиты по датам и бариста и просуммированы!");
    return;
  }
  const p = SAMPLE_FILES_DB[key];
  if (!p) return;
  batchDaysMap = {};
  sessionUploadedCsvHashes.clear();
  trans = null; sales = null; activeShiftCounterCups = null;
  if (p.transCsv) {
    const td = calcTrans(p.transCsv, p.transName);
    mergeIntoBatchDay(td.date, td.barista, { kind: "trans", fileName: p.transName, hash: td.hash, specificBarista: td.specificBarista, cash: td.cash, card: td.card, checks: td.checks });
    applyParsedCsv("trans", td, p.transName);
  }
  if (p.salesCsv) {
    const sd = calcSales(p.salesCsv, p.salesName);
    mergeIntoBatchDay(sd.date, sd.barista, { kind: "sales", fileName: p.salesName, hash: sd.hash, specificBarista: sd.specificBarista, total: sd.total, coffeeQty: sd.coffeeQty, nonCoffeeQty: sd.nonCoffeeQty, reviewQty: sd.reviewQty, items: sd.products });
    applyParsedCsv("sales", sd, p.salesName);
  }
  $("fUnified").classList.add("ok");
  $("unifiedState").textContent = "✓ " + p.label;
  renderBatchSummaryUI();
  toast("Загружен пример: " + p.label);
}));

function parseShiftCounterText(rawText, initialCounterValue) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  const dateRe = /(?:(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|вокскресенье)\s+)?(\d{1,2})[._/-](\d{1,2})[._/-](\d{4})([^\n]*)/gi;
  const matches = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    matches.push({ index: m.index, end: dateRe.lastIndex, d: m[2], mo: m[3], y: m[4], tail: m[5] || "" });
  }
  const chunks = [];
  if (!matches.length) {
    chunks.push({ date: reportDate || isoToday(), headerNames: [], body: text });
  } else {
    matches.forEach((mt, idx) => {
      const nextStart = idx + 1 < matches.length ? matches[idx + 1].index : text.length;
      const isoD = mt.y + "-" + String(mt.mo).padStart(2, "0") + "-" + String(mt.d).padStart(2, "0");
      const words = (mt.tail.match(/[А-ЯЁа-яёA-Za-z]{2,}/g) || []).filter(
        (w) => !/^(счетчик|счётчик|списание|списано|наличные|нал|безнал|карта)$/i.test(w)
      ).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      chunks.push({ date: isoD, headerNames: words, body: text.slice(mt.end, nextStart).trim() });
    });
  }
  const parsedDays = chunks.map((ch) => {
    const shifts = [];
    let cur = null;
    for (const rawLine of ch.body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const mCnt = /сч[её]тчик\s*(?:([А-ЯЁа-яёA-Za-z]+)\s+)?(\d+)/i.exec(line);
      if (mCnt) {
        const nm = mCnt[1] ? (mCnt[1].charAt(0).toUpperCase() + mCnt[1].slice(1).toLowerCase()) : "";
        const val = parseInt(mCnt[2], 10);
        if (nm) { cur = { name: nm, counter: val, writeoffQty: 0, cash: 0, card: 0 }; shifts.push(cur); }
        else if (!cur || cur.counter !== null) { cur = { name: ch.headerNames[shifts.length] || ("Смена " + (shifts.length + 1)), counter: val, writeoffQty: 0, cash: 0, card: 0 }; shifts.push(cur); }
        else cur.counter = val;
        continue;
      }
      const mWo = /списан\w*\s+(\d+(?:[.,]\d+)?)/i.exec(line);
      if (mWo) {
        if (!cur) { cur = { name: ch.headerNames[0] || "Смена 1", counter: null, writeoffQty: 0, cash: 0, card: 0 }; shifts.push(cur); }
        cur.writeoffQty = Math.round(parseFloat(mWo[1].replace(",", ".")) || 0);
        continue;
      }
      const mCash = /(?:наличн\w*|нал)\s+(\d+(?:[.,]\d+)?)/i.exec(line);
      if (mCash) {
        if (!cur) { cur = { name: ch.headerNames[0] || "Смена 1", counter: null, writeoffQty: 0, cash: 0, card: 0 }; shifts.push(cur); }
        cur.cash = Math.round(parseFloat(mCash[1].replace(",", ".")) || 0);
        continue;
      }
      const mName = /^([А-ЯЁа-яёA-Za-z]{2,20})$/.exec(line);
      if (mName && !/^(счетчик|счётчик|списание|списано|наличные|нал|безнал)$/i.test(mName[1])) {
        cur = { name: mName[1].charAt(0).toUpperCase() + mName[1].slice(1).toLowerCase(), counter: null, writeoffQty: 0, cash: 0, card: 0 };
        shifts.push(cur);
      }
    }
    const baristas = Array.from(new Set(shifts.map((s) => s.name).concat(ch.headerNames)));
    return { date: ch.date, baristas, shifts };
  }).filter((d) => d.shifts.length > 0);

  parsedDays.sort((a, b) => a.date.localeCompare(b.date));
  let prevCnt = ($("initCounterIn") && $("initCounterIn").value !== "") ? Number($("initCounterIn").value) : initialCounterValue;
  parsedDays.forEach((d) => {
    d.startCounter = prevCnt;
    d.shifts.forEach((s) => {
      s.prevCounter = prevCnt;
      const delta = (s.counter !== null && prevCnt !== null && window.coffeeCounterDelta)
        ? window.coffeeCounterDelta(prevCnt, s.counter)
        : (s.counter !== null && prevCnt !== null && s.counter >= prevCnt ? s.counter - prevCnt : null);
      if (delta !== null) {
        s.cupsTotal = delta;
        s.wrapped = s.counter < prevCnt;
        s.cupsSold = Math.max(0, s.cupsTotal - s.writeoffQty);
      } else {
        s.cupsTotal = null;
        s.cupsSold = null;
      }
      if (s.counter !== null) prevCnt = s.counter;
    });
    d.endCounter = prevCnt;
    d.totalCash = d.shifts.reduce((a, s) => a + (s.cash || 0), 0);
    d.totalWoQty = d.shifts.reduce((a, s) => a + (s.writeoffQty || 0), 0);
    d.totalCups = d.shifts.reduce((a, s) => a + (s.cupsTotal || 0), 0);
    d.totalSoldCups = d.shifts.reduce((a, s) => a + (s.cupsSold || 0), 0);
  });
  return parsedDays;
}

function applyShiftDayToForm(d) {
  if (!d) return;
  if (d.date && d.date <= isoToday()) setReportDate(d.date);
  const bNames = d.baristas.join(", ");
  $("shiftBaristaIn").value = bNames;
  $("who").textContent = bNames || userName;
  if ($("writeOffShots")) $("writeOffShots").value = d.totalWoQty;
  if ($("counterStartIn") && d.startCounter != null) $("counterStartIn").value = d.startCounter;
  if ($("counterEndIn") && d.endCounter != null) $("counterEndIn").value = d.endCounter;
  activeShiftCounterCups = d.totalCups;
  trans = {
    cash: d.totalCash,
    card: (trans && !trans.fromShiftText && trans.date === d.date) ? trans.card : 0,
    checks: (trans && !trans.fromShiftText && trans.date === d.date && trans.checks) ? trans.checks : (d.totalSoldCups || d.totalCups || 1),
    date: d.date,
    barista: bNames,
    counterStart: d.startCounter,
    counterEnd: d.endCounter,
    writeoffShots: d.totalWoQty,
    shifts: d.shifts.map((s) => ({
      name: s.name,
      cash: s.cash,
      card: 0,
      checks: s.cupsSold || s.cupsTotal || 0,
      writeoffShots: s.writeoffQty,
      prevCounter: s.prevCounter,
      counter: s.counter,
      cups: s.cupsTotal
    })),
    fromShiftText: true
  };
  renderCash();
}

if ($("fillShiftSampleBtn")) {
  $("fillShiftSampleBtn").onclick = () => {
    const d = new Date();
    const dmy = String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
    const tpl = (SAMPLE_FILES_DB && SAMPLE_FILES_DB.shift_text) || (dmy + " " + userName + "\nСчетчик " + userName + " 675\nсписание 1\nНаличные 1650");
    $("shiftTextIn").value = tpl;
    if (!$("initCounterIn").value) $("initCounterIn").value = "600";
    $("calcShiftBtn").click();
  };
}
if ($("clearShiftTextBtn")) {
  $("clearShiftTextBtn").onclick = () => {
    $("shiftTextIn").value = "";
    if ($("shiftCalcResult")) { $("shiftCalcResult").hidden = true; $("shiftCalcResult").innerHTML = ""; }
    toast("Поле текста смены очищено");
  };
}

$("calcShiftBtn").onclick = () => {
  const days = parseShiftCounterText($("shiftTextIn").value, 600);
  lastParsedShiftDays = days;
  const box = $("shiftCalcResult");
  if (!days.length) {
    box.hidden = false;
    box.innerHTML = '<p class="muted" style="color:var(--bad)">Не удалось распознать данные. Укажите «Счетчик Имя Число», «списание Число», «Наличные Число».</p>';
    return;
  }
  box.hidden = false;
  box.innerHTML = days.map((d, di) => {
    const dNice = d.date.split("-").reverse().join(".");
    return '<div style="background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
        '<b>📅 ' + esc(dNice) + ' · ' + esc(d.baristas.join(", ")) + '</b>' +
        '<button type="button" data-pickshift="' + di + '" style="border:1px solid var(--brew);background:var(--surface);color:var(--brew);border-radius:8px;padding:4px 10px;font-size:12.5px;font-weight:700;cursor:pointer">Подставить этот день в отчёт</button>' +
      '</div>' +
      d.shifts.map((s) => (
        '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:5px 0;border-top:1px dashed var(--line)">' +
          '<span>👤 <b>' + esc(s.name) + '</b>: счётчик ' + (s.prevCounter != null ? s.prevCounter + ' → ' : '') + '<b>' + (s.counter ?? '—') + '</b>' +
          (s.cupsTotal != null ? ' (<b>+' + s.cupsTotal + '</b> срабатываний' + (s.wrapped ? ' [переход 999→0]' : '') + ', списано порций: <b>' + s.writeoffQty + '</b>)' : ' (списано порций: ' + s.writeoffQty + ')') + '</span>' +
          '<b>Нал: ' + rub(s.cash) + '</b>' +
        '</div>'
      )).join("") +
      '<div style="display:flex;justify-content:space-between;font-size:14px;padding-top:7px;margin-top:4px;border-top:1px solid var(--line);font-weight:700">' +
        '<span>Итого срабатываний счётчика: ' + d.totalCups + ' (списано порций: ' + d.totalWoQty + ')</span>' +
        '<span style="color:var(--good)">Итого наличные: ' + rub(d.totalCash) + '</span>' +
      '</div>' +
    '</div>';
  }).join("");
  applyShiftDayToForm(days[days.length - 1]);
  toast("Рассчитано дней: " + days.length + " — данные подставлены в кассовый отчёт");
};

$("shiftCalcResult").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pickshift]");
  if (!b) return;
  const d = lastParsedShiftDays[Number(b.dataset.pickshift)];
  if (d) { applyShiftDayToForm(d); toast("Выбран день " + d.date.split("-").reverse().join(".")); }
});

["counterStartIn", "counterEndIn", "writeOffShots", "writeOffs"].forEach((id) => {
  if ($(id)) $(id).addEventListener("input", () => renderCash());
});

function getActiveCounterInfo() {
  const startRaw = $("counterStartIn") ? $("counterStartIn").value : "";
  const endRaw = ($("counterEndIn") && $("counterEndIn").value !== "") ? $("counterEndIn").value : ($("quickCounterIn") ? $("quickCounterIn").value : "");
  const cStart = startRaw !== "" ? Number(startRaw) : (trans && trans.counterStart != null ? Number(trans.counterStart) : null);
  const cEnd = endRaw !== "" ? Number(endRaw) : (trans && trans.counterEnd != null ? Number(trans.counterEnd) : null);
  const delta = (cStart !== null && cEnd !== null && window.coffeeCounterDelta)
    ? window.coffeeCounterDelta(cStart, cEnd)
    : (activeShiftCounterCups != null ? Number(activeShiftCounterCups) : null);
  const wrapped = cStart !== null && cEnd !== null && cEnd < cStart && cStart < 1000;
  return { counterStart: cStart, counterEnd: cEnd, grinderDelta: delta, wrapped };
}

function renderCash() {
  const t = trans, total = t ? t.cash + t.card : 0, pct = Math.round(total / PLAN * 100);
  const cntInfo = getActiveCounterInfo();
  const woShots = Math.max(0, Math.round(parseFloat($("writeOffShots") ? $("writeOffShots").value : 0) || 0));
  const woRub = Math.max(0, Math.round(parseFloat($("writeOffs") ? $("writeOffs").value : 0) || 0));
  const soldCoffee = sales && sales.coffeeQty != null ? sales.coffeeQty : (t && t.coffeeQty != null ? t.coffeeQty : 0);
  const nonCoffee = sales && sales.nonCoffeeQty != null ? sales.nonCoffeeQty : (t && t.nonCoffeeQty != null ? t.nonCoffeeQty : 0);
  const reviewQty = sales && sales.reviewQty != null ? sales.reviewQty : (t && t.reviewQty != null ? t.reviewQty : 0);

  if ($("counterDeltaPreview")) {
    if (cntInfo.grinderDelta !== null) {
      $("counterDeltaPreview").innerHTML = "Срабатывания счётчика: <b>" + cntInfo.grinderDelta + "</b>" +
        (cntInfo.counterStart !== null && cntInfo.counterEnd !== null ? " (" + cntInfo.counterStart + " → " + cntInfo.counterEnd + (cntInfo.wrapped ? " · переход 999→0" : "") + ")" : "");
    } else {
      $("counterDeltaPreview").textContent = "Срабатывания счётчика: укажите начало и конец (0–999)";
    }
  }

  $("cTotal").textContent = rub(total);
  $("cMeter").style.width = Math.min(pct, 100) + "%";
  $("cPlan").textContent = t ? "План " + rub(PLAN) + " · выполнено " + pct + "%" : "План " + rub(PLAN);
  $("cCash").textContent = t ? rub(t.cash) : "—";
  $("cCard").textContent = t ? rub(t.card) : "—";
  $("cChecks").textContent = t ? (t.checks + " чек." + (sales && sales.totalQty ? " (" + sales.totalQty + " поз.)" : "")) : "—";
  const coffeeInfo = soldCoffee ? (soldCoffee + " кофе · ") : (cntInfo.grinderDelta != null ? (cntInfo.grinderDelta + " сраб. · ") : "");
  $("cAvg").textContent = t && t.checks ? (coffeeInfo + rub(Math.round(total / t.checks))) : "—";

  const recPanel = $("reconciliationPanel");
  if (recPanel) {
    if ((sales && sales.length) || cntInfo.grinderDelta !== null) {
      const rec = (window.CoffeeSalesReconciliation && cntInfo.grinderDelta !== null)
        ? window.CoffeeSalesReconciliation.reconcile(cntInfo.grinderDelta, { coffeeQty: soldCoffee, nonCoffeeQty: nonCoffee, reviewQty: reviewQty }, woShots, 0)
        : null;
      recPanel.hidden = false;
      recPanel.style.borderColor = (rec && rec.unaccountedShots > 0) || reviewQty > 0 ? "var(--warn)" : "var(--good)";
      recPanel.innerHTML =
        '<div style="font-weight:700;margin-bottom:6px">🔍 Сверка кассы и счётчика кофемолки (по номенклатуре)</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:6px;font-size:12.5px">' +
          '<div>☕ Кофейные напитки: <b>' + soldCoffee + ' шт.</b></div>' +
          '<div>🍰 Не кофейные позиции: <b>' + nonCoffee + ' шт.</b></div>' +
          '<div>❓ Неопределённая номенклатура: <b style="color:' + (reviewQty > 0 ? 'var(--warn)' : 'inherit') + '">' + reviewQty + ' шт.</b></div>' +
          '<div>🔢 Срабатывания счётчика: <b>' + (cntInfo.grinderDelta !== null ? cntInfo.grinderDelta : '—') + '</b></div>' +
          '<div>🗑 Списания, порции: <b>' + woShots + ' шт.</b> · Руб.: <b>' + rub(woRub) + '</b></div>' +
          '<div>⚠️ Необъяснённая разница: <b style="color:' + (rec && rec.unaccountedShots > 0 ? 'var(--bad)' : 'var(--good)') + '">' + (rec ? rec.unaccountedShots : '—') + '</b></div>' +
        '</div>' +
        (cntInfo.wrapped ? '<div style="margin-top:6px;font-size:12px;color:var(--warn)">ℹ️ Зафиксирован переход счётчика через 999 → 0 (' + cntInfo.counterStart + ' → ' + cntInfo.counterEnd + '). Проверьте показание физически на дисплее прибора.</div>' : '');
    } else {
      recPanel.hidden = true;
    }
  }

  const top = sales ? sales.slice(0, 5) : [];
  $("topPanel").hidden = !top.length;
  const m = top.length ? (top[0].qty || 1) : 1;
  $("topList").innerHTML = top.map((x) => '<div class="bar"><b></b><span>' + x.qty + " шт." + (x.sum ? " · " + rub(x.sum) : "") + '</span><div class="t"><i style="width:' + (x.qty / m * 100) + '%"></i></div></div>').join("");
  $("topList").querySelectorAll("b").forEach((b, i) => b.textContent = top[i].name);
  const sum = sales && sales.total, diff = t && !t.fromSalesOnly && sum ? Math.abs(sum - total) : 0;
  let checkMsg = "";
  if (t && sum && !t.fromSalesOnly) {
    checkMsg = diff <= 1 ? "✓ Сверка: «Продажи» (" + rub(sum) + ") точно совпадают с «Транзакциями»" : "⚠️ «Продажи» на " + rub(sum) + ", а «Транзакции» на " + rub(total) + " (разница " + rub(diff) + ")";
  } else if (t && t.fromSalesOnly) {
    checkMsg = "ℹ️ Выручка рассчитана по «Продажи.csv» (" + rub(sum) + ", кофейных напитков: " + soldCoffee + " шт., не кофе: " + nonCoffee + " шт." + (reviewQty ? ", неопределённых: " + reviewQty + " шт." : "") + ")";
  } else if (t && t.fromShiftText) {
    checkMsg = "✓ Рассчитано по счётчикам смен бариста (" + (t.barista || "") + ")";
  }
  $("cCheck").textContent = checkMsg;
  $("cCheck").style.color = diff > 1 ? "var(--bad)" : "";
  $("submitCashBtn").disabled = false;
  $("submitCashBtn").style.opacity = t ? "1" : "0.75";
  $("submitCashBtn").textContent = t ? "Отправить кассовый отчёт (" + rub(total) + ")" : "Отправить кассовый отчёт (введите сумму или счётчик)";
}

function applyManualCashInputs() {
  const cVal = Math.max(0, Math.round(Number($("manCashIn") ? $("manCashIn").value : 0) || 0));
  const bVal = Math.max(0, Math.round(Number($("manCardIn") ? $("manCardIn").value : 0) || 0));
  const kVal = Math.max(0, Math.round(Number($("manChecksIn") ? $("manChecksIn").value : 0) || 0));
  if (cVal === 0 && bVal === 0 && kVal === 0) return;
  const who = ($("shiftBaristaIn") && $("shiftBaristaIn").value.trim()) || userName || "Бариста";
  const woRub = Math.max(0, Math.round(parseFloat($("writeOffs") ? $("writeOffs").value : 0) || 0));
  const woShots = Math.max(0, Math.round(parseFloat($("writeOffShots") ? $("writeOffShots").value : 0) || 0));
  const cntInfo = getActiveCounterInfo();
  trans = {
    cash: cVal,
    card: bVal,
    checks: kVal || Math.max(1, Math.round((cVal + bVal) / 35)),
    counterStart: cntInfo.counterStart,
    counterEnd: cntInfo.counterEnd,
    writeoffShots: woShots,
    shifts: [{
      name: who,
      cash: cVal,
      card: bVal,
      checks: kVal || Math.max(1, Math.round((cVal + bVal) / 35)),
      writeoff: woRub,
      writeoffShots: woShots,
      prevCounter: cntInfo.counterStart,
      counter: cntInfo.counterEnd,
      cups: (sales && sales.coffeeQty) || cntInfo.grinderDelta || kVal || Math.max(1, Math.round((cVal + bVal) / 35))
    }]
  };
  renderCash();
}
["manCashIn", "manCardIn", "manChecksIn"].forEach((id) => {
  if ($(id)) $(id).addEventListener("input", applyManualCashInputs);
});
if ($("applyManCashBtn")) {
  $("applyManCashBtn").onclick = () => {
    applyManualCashInputs();
    toast("✓ Суммы подставлены — нажмите «Отправить кассовый отчёт» внизу");
  };
}

let quickCounterPhotoData = "";
let quickPaperPhotoData = "";
function setQuickCashPhoto(data, isCounter) {
  if (!data) return;
  if (isCounter) {
    quickCounterPhotoData = data;
    if ($("lblPhotoCounter")) $("lblPhotoCounter").textContent = "✓ Фото счётчика прикреплено";
  } else {
    quickPaperPhotoData = data;
    if ($("lblPhotoPaper")) $("lblPhotoPaper").textContent = "✓ Фото бумажного отчёта прикреплено";
  }
  const prev = $("quickCashPhotosPreview");
  if (prev) {
    prev.hidden = false;
    prev.innerHTML = [
      quickCounterPhotoData ? '<img src="' + quickCounterPhotoData + '" style="height:68px;border-radius:10px;border:2px solid var(--good)">' : '',
      quickPaperPhotoData ? '<img src="' + quickPaperPhotoData + '" style="height:68px;border-radius:10px;border:2px solid var(--good)">' : ''
    ].join("");
  }
}
async function captureQuickCash(isCounter) {
  if (!window.coffeeCamera) { toast("Камера недоступна"); return; }
  const src = await window.coffeeCamera.open({ mode: "photo", facing: "environment", stamp: LOCATION + " · " + userName });
  if (src) setQuickCashPhoto(src, isCounter);
}
bindBtn("inPhotoCounter", () => captureQuickCash(true));
bindBtn("inPhotoPaper", () => captureQuickCash(false));
if ($("quickSubmitPaperCashBtn")) {
  $("quickSubmitPaperCashBtn").onclick = async () => {
    const cntVal = $("quickCounterIn") && $("quickCounterIn").value !== "" ? Number($("quickCounterIn").value) : null;
    const papCash = Number($("quickPaperCashIn") ? $("quickPaperCashIn").value : 0) || 0;
    if (cntVal === null && !papCash && !quickCounterPhotoData && !quickPaperPhotoData) {
      toast("Укажите показание счётчика или прикрепите фото бумажного отчёта");
      return;
    }
    const prevCnt = ($("counterStartIn") && $("counterStartIn").value !== "") ? Number($("counterStartIn").value) : (Number($("initCounterIn") ? $("initCounterIn").value : 600) || 600);
    const cyclicDelta = (cntVal !== null && window.coffeeCounterDelta) ? window.coffeeCounterDelta(prevCnt, cntVal) : null;
    const deltaCups = cyclicDelta !== null ? cyclicDelta : Math.max(1, Math.round(papCash / 35) || 45);
    const estCash = papCash > 0 ? papCash : (deltaCups * 35);
    if ($("counterStartIn")) $("counterStartIn").value = prevCnt;
    if ($("counterEndIn") && cntVal !== null) $("counterEndIn").value = cntVal;
    if ($("manCashIn")) $("manCashIn").value = estCash;
    if ($("manChecksIn") && !$("manChecksIn").value) $("manChecksIn").value = deltaCups;
    applyManualCashInputs();
    if (trans && Array.isArray(trans.shifts) && trans.shifts[0]) {
      trans.shifts[0].prevCounter = prevCnt;
      trans.shifts[0].counter = cntVal !== null ? cntVal : ((prevCnt + deltaCups) % 1000);
      trans.shifts[0].cups = deltaCups;
    }
    const phItems = [];
    if (quickCounterPhotoData) phItems.push({ id: "cash_cnt", title: "📷 Фото счётчика кофемашины (" + (cntVal ?? "") + ")", status: "ok", isIncident: false, photos: [quickCounterPhotoData], photo_url: quickCounterPhotoData });
    if (quickPaperPhotoData) phItems.push({ id: "cash_pap", title: "📄 Фото бумажного отчёта кассы", status: "ok", isIncident: false, photos: [quickPaperPhotoData], photo_url: quickPaperPhotoData });
    if (phItems.length) {
      await post({ action: "submit_checklist", sid: uid(), location: LOCATION, userName, block: "Касса", startedAt: "22:00", deadline: "23:59", isLate: false, items: phItems });
    }
    $("submitCashBtn").click();
  };
}

$("submitCashBtn").onclick = async () => {
  if (!trans) {
    applyManualCashInputs();
    if (!trans && $("shiftTextIn") && $("shiftTextIn").value.trim()) {
      $("calcShiftBtn").click();
    }
    if (!trans && ($("quickCounterIn") && $("quickCounterIn").value || $("quickPaperCashIn") && $("quickPaperCashIn").value)) {
      $("quickSubmitPaperCashBtn").click();
      return;
    }
  }
  if (!trans) {
    toast("💡 Укажите сумму наличных/безнала, показание счётчика или загрузите CSV-файл");
    if ($("manCashIn")) $("manCashIn").focus();
    return;
  }
  tap();
  $("submitCashBtn").disabled = true; $("submitCashBtn").textContent = "Отправляем…";
  const top = (sales && Array.isArray(sales.products) ? sales.products : (sales || []));
  const cntInfo = getActiveCounterInfo();
  const woRub = Math.max(0, Math.round(parseFloat($("writeOffs") ? $("writeOffs").value : 0) || 0));
  const woShots = Math.max(0, Math.round(parseFloat($("writeOffShots") ? $("writeOffShots").value : 0) || 0));
  const soldCoffee = sales && sales.coffeeQty != null ? sales.coffeeQty : (trans.coffeeQty != null ? trans.coffeeQty : 0);
  const nonCoffeeQty = sales && sales.nonCoffeeQty != null ? sales.nonCoffeeQty : (trans.nonCoffeeQty != null ? trans.nonCoffeeQty : 0);
  const reviewQty = sales && sales.reviewQty != null ? sales.reviewQty : (trans.reviewQty != null ? trans.reviewQty : 0);
  const unaccountedShots = cntInfo.grinderDelta != null ? Math.max(0, cntInfo.grinderDelta - (soldCoffee + woShots)) : 0;
  const activeBaristaName = ($("shiftBaristaIn") && $("shiftBaristaIn").value.trim()) || userName;
  const csvHashVal = (sales && sales.hash) || (trans && trans.hash) || "";
  const csvHashesArr = Array.from(new Set([].concat(sales && sales.csvHashes || [], trans && trans.csvHashes || [], csvHashVal ? [csvHashVal] : [])));

  const shiftsPayload = (trans && Array.isArray(trans.shifts) && trans.shifts.length)
    ? trans.shifts.map((s, idxS) => Object.assign({}, s, {
        prevCounter: s.prevCounter != null ? s.prevCounter : (idxS === 0 ? cntInfo.counterStart : null),
        counter: s.counter != null ? s.counter : (idxS === trans.shifts.length - 1 ? cntInfo.counterEnd : null),
        writeoff: s.writeoff != null ? s.writeoff : (idxS === 0 ? woRub : 0),
        writeoffShots: s.writeoffShots != null ? s.writeoffShots : (idxS === 0 ? woShots : 0),
        coffeeQty: s.coffeeQty != null ? s.coffeeQty : (trans.shifts.length === 1 ? soldCoffee : s.cups)
      }))
    : [{
        name: activeBaristaName,
        cash: trans.cash,
        card: trans.card,
        checks: trans.checks,
        writeoff: woRub,
        writeoffShots: woShots,
        prevCounter: cntInfo.counterStart,
        counter: cntInfo.counterEnd,
        coffeeQty: soldCoffee,
        nonCoffeeQty: nonCoffeeQty,
        reviewQty: reviewQty,
        cups: soldCoffee || trans.checks
      }];

  const ok = await post({
    action: "submit_cash",
    counterStart: cntInfo.counterStart != null ? cntInfo.counterStart : undefined,
    counterEnd: cntInfo.counterEnd != null ? cntInfo.counterEnd : undefined,
    endCounter: cntInfo.counterEnd != null ? cntInfo.counterEnd : undefined,
    mergeMode: (!$("sumModeChk") || $("sumModeChk").checked) ? "sum" : "replace",
    shifts: shiftsPayload,
    sid: uid(),
    location: LOCATION,
    userName: activeBaristaName,
    barista: activeBaristaName,
    date: reportDate,
    cash: trans.cash,
    card: trans.card,
    checks: trans.checks,
    writeoff: woRub,
    writeOffs: woRub,
    writeoffShots: woShots,
    coffeeQty: soldCoffee,
    nonCoffeeQty: nonCoffeeQty,
    reviewQty: reviewQty,
    unaccountedShots: unaccountedShots,
    csvHash: csvHashVal,
    csvHashes: csvHashesArr,
    topItems: top.slice(0, 3).map((x) => x.name.replace(/\s+(шт\.?|бут\.?)$/i, "") + " ×" + x.qty).join(", "),
    products: top
  });
  if (reportDate === isoToday()) { markDone("КАССА"); drawTabs(); }
  finish(ok, "Выручка " + rub(trans.cash + trans.card) + " · чеков " + trans.checks + (soldCoffee ? " · кофе по номенклатуре " + soldCoffee + " шт." : "") + (reportDate === isoToday() ? "" : " · за " + reportDate.slice(8) + "." + reportDate.slice(5, 7)));
  if ($("toDash")) $("toDash").hidden = true;
};

/* ---------- старт ---------- */
const inProgress = () => block !== "КАССА" && !$("checklistView").hidden && (idx > 0 || !!photo || answers.some(Boolean));
document.addEventListener("click", (e) => {
  const b = e.target.closest("#termTimelineTabs button[data-b], .tabs button[data-b]");
  if (!b) return;
  tap();
  if (b.dataset.b !== block && inProgress()) { try { saveAnswer(); saveShiftDraft(); } catch (_) {} }
  if ($("loader") && !$("loader").hidden) return;
  if ($("errorView") && !$("errorView").hidden && b.dataset.b !== "КАССА") return;
  selectBlock(b.dataset.b);
});
$("retryBtn").onclick = loadTasks;
(function () {
  const qp = new URLSearchParams(location.search), qd = qp.get("date");
  if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd) && qd <= isoToday()) reportDate = qd;
  if (qp.get("tab") === "cash") block = "КАССА";
  const qb = qp.get("block"); if (qb && ["Открытие","День","Закрытие","КАССА"].includes(qb)) block = qb;
  setReportDate(reportDate);
})();

(function autoSelectOpenChecklistOnStart() {
  try {
    const qp = new URLSearchParams(location.search);
    if (qp.get("block") || qp.get("tab")) return;
    if (window.coffeeGetBlockWindow && window.coffeeGetChecklistBlocks) {
      const wCur = window.coffeeGetBlockWindow(block === "КАССА" ? "Касса" : block);
      if (wCur && !wCur.canPass) {
        const openNow = window.coffeeGetChecklistBlocks().find((bObj) => {
          const w = window.coffeeGetBlockWindow(bObj.name);
          return w && w.canPass;
        });
        if (openNow) {
          block = (openNow.isCash || openNow.name === "Касса") ? "КАССА" : openNow.name;
        }
      }
    }
  } catch (_) {}
})();

if (window.coffeeSettings) { const cs = window.coffeeSettings.get(); if (cs.location) { LOCATION = cs.location; $("loc").textContent = LOCATION; } if (cs.plan > 0) PLAN = cs.plan; if (cs.initCounter > 0 && $("initCounterIn")) $("initCounterIn").value = cs.initCounter; }

/* Поддержка перетаскивания файлов мышкой (Drag & Drop) на ПК */
document.querySelectorAll('label.file').forEach((lbl) => {
  const inp = lbl.querySelector('input[type="file"]');
  if (!inp) return;
  ['dragenter', 'dragover'].forEach((ev) => lbl.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); lbl.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => lbl.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); lbl.classList.remove('dragover');
  }));
  lbl.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      inp.files = e.dataTransfer.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
});

queueUI(); flush(); loadTasks();

/* Ручное принудительное обновление по нажатию на индикатор сети (🟢 Онлайн / 🟡 Офлайн) в шапке Терминала и Telegram Mini App */
(function bindNetStatusBadgeTapSync() {
  const badge = $("netStatusBadge");
  if (!badge) return;
  badge.style.cursor = "pointer";
  badge.addEventListener("click", async () => {
    try {
      toast("🔄 Синхронизация с сервером…");
      if (window.coffeeFlushOutbox) await window.coffeeFlushOutbox(true);
      await loadTasks();
      reloadTerminalFromVault();
      toast("✅ Данные синхронизированы с сервером");
    } catch (_) {
      reloadTerminalFromVault();
    }
  });
})();

/* В Telegram Mini App (ILLY_BOT) обновляем данные при разворачивании окна и возврате на экран */
if (tg) {
  tgt(() => tg.onEvent("viewportChanged", () => {
    reloadTerminalFromVault();
  }));
}
let _lastTermVisPull = Date.now();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (Date.now() - _lastTermVisPull > 15000)) {
    _lastTermVisPull = Date.now();
    if (window.coffeeLiveSyncNow) window.coffeeLiveSyncNow();
  }
});



/* Мгновенное применение всех изменений из Панели управления владельца (окна, задачи, планы, ТТК, информирование, коды) */
function reloadTerminalFromVault() {
  try {
    if (typeof getUDB !== 'function') return;
    migrateAndSyncAccountDoneFlags();
    const db = getUDB();
    if (window.coffeeEnsureV19Schema) window.coffeeEnsureV19Schema(db);
    LOCATION = db.location || LOCATION;
    const dp = window.coffeeGetDayPlan ? window.coffeeGetDayPlan(isoToday(), db) : { revenue: db.plan || 2200 };
    PLAN = dp.revenue || db.plan || 2200;
    if ($("loc")) $("loc").textContent = LOCATION;
    META.checklistBlocks = db.checklistBlocks || window.COFFEE_DEFAULT_CHECKLIST_BLOCKS;
    META.announcements = db.announcements || [];
    META.staff = db.staff || [];
    META.deadlineExtensions = db.deadlineExtensions || {};
    tasks = window.coffeeNormalizeTasksTimeline ? window.coffeeNormalizeTasksTimeline(db.tasks || []).filter((t) => t.active !== 'нет') : (db.tasks || []);
    syncStaffSelector();
    drawTabs();
    if (window._coffeeSubmittingChecklistNow || ($("doneView") && !$("doneView").hidden) || ($("loader") && !$("loader").hidden)) {
      return;
    }
    if (block === 'ИНФО') {
      renderInfoView();
    } else if (block === 'КАССА' || block === 'Касса') {
      const wCash = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow('Касса', db, userName) : { canPass: true };
      if (!wCash.canPass) {
        $("steps").hidden = true;
        show("checklistView");
        updateDeadlineUI();
      } else {
        show("cashView");
        renderCash();
      }
    } else {
      cur = tasks.filter((t) => t.block === block && t.active !== 'нет');
      if (!updateDeadlineUI()) {
        $("steps").hidden = true;
      } else if (cur.length) {
        // Проверяем, не пришёл ли с другого устройства более свежий прогресс прохождения шагов для текущего сотрудника (userName)
        const dKey = getUserDraftKey(block, userName);
        const remDraft = db.userDrafts && db.userDrafts[dKey];
        const lastTs = _lastAppliedDraftTs[dKey] || 0;
        if (remDraft && Number(remDraft.updatedAt || 0) > lastTs) {
          _lastAppliedDraftTs[dKey] = Number(remDraft.updatedAt);
          if (remDraft.cleared || remDraft.completed) {
            idx = 0;
            answers = [];
            if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
          } else if (Array.isArray(remDraft.answers)) {
            idx = Math.min(remDraft.idx || 0, Math.max(0, cur.length - 1));
            answers = remDraft.answers.slice();
            checklistStartedAt = remDraft.startedAt || checklistStartedAt;
            if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
          }
        }
        renderStep();
      }
    }
  } catch (_) {}
}
let _vaultReloadTimer = null;
function scheduleReloadTerminalFromVault() {
  if (_vaultReloadTimer) clearTimeout(_vaultReloadTimer);
  _vaultReloadTimer = setTimeout(() => {
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== 'baristaSelect') {
      syncStaffSelector();
      drawTabs();
      return;
    }
    reloadTerminalFromVault();
  }, 120);
}
if (window.coffeeBus) {
  window.coffeeBus.on((msg) => {
    if (msg && (msg.type === 'mutation' || msg.type === 'server_sync' || msg.type === 'outbox_synced')) {
      if (typeof window !== 'undefined' && window.navigator && /jsdom|node/i.test(window.navigator.userAgent || '')) {
        reloadTerminalFromVault();
      } else {
        scheduleReloadTerminalFromVault();
      }
    }
  });
}
window.addEventListener('storage', (e) => {
  if (e && (e.key === 'coffee_owner_master_vault' || e.key === 'coffee_sync_signal')) {
    scheduleReloadTerminalFromVault();
  }
});



if ($("goToInfoFromLockBtn")) {
  $("goToInfoFromLockBtn").onclick = () => {
    selectBlock("ИНФО");
  };
}
if ($("doneHomeBtn")) {
  $("doneHomeBtn").onclick = () => {
    selectBlock(block === "КАССА" ? "Открытие" : block);
  };
}


/* Поддержка свайпа влево/вправо для переключения шагов чек-листа на телефоне */
(function () {
  const wrapEl = $("taskStepWrap");
  if (!wrapEl) return;
  let touchStartX = 0, touchStartY = 0;
  wrapEl.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  wrapEl.addEventListener("touchend", (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 68 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (dx < 0 && $("nextBtn") && !$("nextBtn").disabled) $("nextBtn").click();
      else if (dx > 0 && $("backBtn") && !$("backBtn").hidden && !$("backBtn").disabled) $("backBtn").click();
    }
  }, { passive: true });
})();


/* Запрос PIN-кода участника при старте терминала (единый стартовый PIN: 1234) */
window.reloadTerminalFromVault = reloadTerminalFromVault;
window.promptStaffPinAndSwitch = promptStaffPinAndSwitch;
window.ensureTerminalPinGate = function () {
  try {
    if (typeof window !== "undefined" && window.navigator && /jsdom|node/i.test(window.navigator.userAgent || "")) return;
    if (window.COFFEE_ACTIVE_SYSTEM_MODE === "owner") return;
    const unlockedUser = sessionStorage.getItem("coffee_term_pin_unlocked_v1") || localStorage.getItem("coffee_term_pin_unlocked_v1");
    if (!unlockedUser) {
      promptStaffPinAndSwitch(userName || "Соня", true);
    }
  } catch (_) {}
};
(function initTerminalStartupPinGate() {
  setTimeout(() => {
    if (window.COFFEE_ACTIVE_SYSTEM_MODE !== "owner") {
      window.ensureTerminalPinGate();
    }
  }, 120);
})();

})();
/* UNIFIED_IIFE_END */
