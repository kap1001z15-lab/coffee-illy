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
    if (typeof dlg.showModal === "function") safeShowModal(dlg);
    else dlg.setAttribute("open", "open");
  } catch (_) {
    dlg.setAttribute("open", "open");
  }
}
function safeCloseModal(dlg) {
  if (!dlg) return;
  try {
    if (dlg.open && typeof dlg.close === "function") safeCloseModal(dlg);
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
let userName = (function () {
  try {
    const saved = localStorage.getItem("coffee_active_barista");
    if (saved) return saved;
  } catch (_) {}
  return tgu && tgu.first_name ? tgu.first_name : "Соня";
})();
const tap = () => { try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {} };
const tgt = (f) => { try { return f(); } catch (e) {} };
$("loc").textContent = LOCATION; $("who").textContent = userName;
const curTheme = () => document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function paintTheme() { const d = curTheme() === "dark"; $("theme").textContent = d ? "☀️" : "🌙"; $("theme").setAttribute("aria-label", d ? "Светлая тема" : "Тёмная тема"); }
$("theme").onclick = () => { const n = curTheme() === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", n); try { localStorage.setItem("coffee_illy_theme", n); } catch (e) {} paintTheme(); };
paintTheme();
/* ---------- Telegram Mini App ---------- */
if (tg) {
  tgt(() => tg.ready()); tgt(() => tg.expand()); tgt(() => tg.disableVerticalSwipes());     // не закрывается случайным свайпом вниз
  const hasTheme = () => { try { return !!localStorage.getItem("coffee_illy_theme"); } catch (e) { return false; } };
  const tgTheme = () => { if (!hasTheme() && tg.colorScheme) { document.documentElement.setAttribute("data-theme", tg.colorScheme === "dark" ? "dark" : "light"); paintTheme(); } };
  tgTheme(); tgt(() => tg.onEvent("themeChanged", tgTheme));
  tgt(() => tg.setHeaderColor("#5a3a29"));
  tgt(() => tg.setBackgroundColor(curTheme() === "dark" ? "#161211" : "#f6ece2"));
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
$("today").textContent = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

let tasks = [], cur = [], idx = 0, answers = [], META = {};
let block = "Открытие", photo = "", incident = false, priority = "Терпит";
let photoUrl = "", photoBusy = false, stream = null;
const PHOTO_MAX_AGE = 3 * 60 * 1000;   // запасной режим: фото старше 3 минут не принимаем
const ADDON = /молоко|сироп|мёд|маршмеллоу|топпинг|открытка|десерт от бариста/i;   // добавки не попадают в «хиты дня»
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3200); }
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

/* отметки «сегодня уже сдано» */
const doneKey = (b) => "coffee_illy_done_" + isoToday() + "_" + b;
const isDone = (b) => { try { return !!localStorage.getItem(doneKey(b)); } catch (e) { return false; } };
const markDone = (b) => { try { localStorage.setItem(doneKey(b), "1"); } catch (e) {} };
function drawTabs() {
  const unreadCount = getUnreadInfoCount();
  if ($("termInfoModeLbl")) {
    $("termInfoModeLbl").textContent = unreadCount > 0 ? ("📢 Задачи + Информирование (" + unreadCount + ")") : "📢 Задачи + Информирование";
  }
  const isInfoMode = block === "ИНФО";
  if ($("termModeSwitch")) {
    document.querySelectorAll("#termModeSwitch button").forEach((btn) => {
      const on = (btn.dataset.tmode === "tasks_info") === isInfoMode;
      btn.className = on ? "ok" : "";
      btn.style.background = on ? "var(--surface,#fff)" : "transparent";
      btn.style.color = on ? "var(--ink,#231812)" : "#f6ece2";
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
      { name: "Касса", openTime: "22:00", deadline: "23:59", isCash: true }
    ];
    tlBar.innerHTML = dynBlocks.map((bObj) => {
      const bVal = (bObj.isCash || bObj.name === "Касса") ? "КАССА" : bObj.name;
      const isSel = block === bVal;
      const done = isDone(bVal);
      const locked = bVal !== block && inProgress();
      return '<button role="tab" type="button" data-b="' + esc(bVal) + '" data-l="' + esc(bObj.name) + '" aria-selected="' + (isSel ? 'true' : 'false') + '" class="' + (locked ? 'locked' : '') + '">' +
        '<span>' + esc(bObj.name) + '</span>' +
        (done ? '<span class="ck">✓</span>' : '') +
        '<div style="font-size:10px;opacity:0.78;font-weight:500;margin-top:1px">' + esc(bObj.openTime || '') + '–' + esc(bObj.deadline || '') + '</div>' +
      '</button>';
    }).join("");
  }
}

if ($("termModeSwitch")) {
  $("termModeSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tmode]");
    if (!b) return;
    if (inProgress()) { toast("Сначала завершите начатый чек-лист"); return; }
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
    const d = await coffeeFetch(API_URL + "?action=get_checklists&nocache=1");
    if (!d || d.ok === false || !d.tasks) throw new Error("bad response");
    tasks = (Array.isArray(d.tasks) && d.tasks.length > 0) ? (window.coffeeNormalizeTasksTimeline ? window.coffeeNormalizeTasksTimeline(d.tasks) : d.tasks) : defTasks;
    META = d;
    if (d.plan > 0) PLAN = d.plan;
    if (d.location) { LOCATION = d.location; $("loc").textContent = LOCATION; }
    if (d.initCounter > 0 && $("initCounterIn")) $("initCounterIn").value = d.initCounter;
    renderCash();
    try { localStorage.setItem("coffee_illy_tasks", JSON.stringify(tasks)); } catch (e) {}
    if (!inProgress() && !photoBusy) selectBlock(block);
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
  const sel = $("baristaSelect");
  if (!sel) return;
  const staffList = (META && Array.isArray(META.staff) && META.staff.length)
    ? META.staff.filter((s) => s.active !== "нет")
    : ((window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_STAFF) || []);
  sel.innerHTML = staffList.map((s) => '<option value="' + s.name.replace(/"/g, '&quot;') + '"' + (s.name === userName ? ' selected' : '') + '>👤 ' + s.name + ' (' + (s.role || 'Бариста') + ')</option>').join("");
  if (!staffList.some((s) => s.name === userName) && staffList.length) {
    userName = staffList[0].name;
    sel.value = userName;
  }
  $("who").textContent = userName;
  if ($("shiftBaristaIn") && !$("shiftBaristaIn").value) $("shiftBaristaIn").value = userName;
}
function promptStaffPinAndSwitch(targetName) {
  const dlg = $("staffPinDlg");
  if (!dlg || typeof dlg.showModal !== "function") {
    userName = targetName;
    try { localStorage.setItem("coffee_active_barista", userName); } catch (_) {}
    $("who").textContent = userName;
    drawTabs();
    if (block === "ИНФО") renderInfoView();
    return;
  }
  $("staffPinTitle").textContent = "🔑 Вход: " + targetName;
  $("staffPinSub").textContent = "Введите личный код доступа сотрудника «" + targetName + "» (задаётся в Управлении → Штат):";
  $("staffPinInput").value = "";
  $("staffPinErr").textContent = "";
  safeShowModal(dlg);
  setTimeout(() => $("staffPinInput").focus(), 40);

  $("staffPinCancelBtn").onclick = () => {
    if ($("baristaSelect")) $("baristaSelect").value = userName;
    safeCloseModal(dlg);
  };
  $("staffPinForm").onsubmit = (ev) => {
    ev.preventDefault();
    const entered = $("staffPinInput").value.trim();
    const ok = window.coffeeVerifyStaffPin ? window.coffeeVerifyStaffPin(targetName, entered) : (entered.length >= 4);
    if (!ok) {
      $("staffPinErr").textContent = "Неверный личный код сотрудника «" + targetName + "»";
      return;
    }
    userName = targetName;
    try { localStorage.setItem("coffee_active_barista", userName); } catch (_) {}
    if ($("baristaSelect")) $("baristaSelect").value = userName;
    $("who").textContent = userName;
    if ($("shiftBaristaIn")) $("shiftBaristaIn").value = userName;
    safeCloseModal(dlg);
    drawTabs();
    if (block === "ИНФО") renderInfoView();
    else updateDeadlineUI();
    toast("✓ Активный профиль: " + userName);
  };
}

if ($("baristaSelect")) {
  $("baristaSelect").addEventListener("change", (e) => {
    const nextUser = e.target.value || "Соня";
    if (nextUser === userName) return;
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

function saveShiftDraft() {
  if (block === "КАССА" || block === "ИНФО" || !cur.length) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      date: isoToday(),
      block,
      idx,
      startedAt: checklistStartedAt || new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      userName,
      answers
    }));
  } catch (_) {}
}

function clearShiftDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
}

function tryRestoreShiftDraft(targetBlock) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || d.date !== isoToday() || d.block !== targetBlock || !Array.isArray(d.answers) || !d.answers.length) return false;
    const hasProgress = d.idx > 0 || d.answers.some((a) => a && (a.choiceMade || (a.photos && a.photos.length)));
    if (!hasProgress) return false;
    idx = Math.min(d.idx || 0, Math.max(0, cur.length - 1));
    answers = d.answers;
    checklistStartedAt = d.startedAt || "";
    if ($("draftRestoreBanner")) {
      $("draftRestoreBanner").hidden = false;
      $("draftRestoreText").textContent = "↺ Восстановлен черновик смены (шаг " + (idx + 1) + " из " + cur.length + ") — данные сохранены";
    }
    return true;
  } catch (_) {
    return false;
  }
}

if ($("resetDraftBtn")) {
  $("resetDraftBtn").onclick = () => {
    clearShiftDraft();
    idx = 0;
    answers = [];
    renderStep();
    toast("Чек-лист начат с первого шага");
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
    ? window.coffeeGetBlockWindow(checkBlkName)
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
  if (lockCard && stepWrap) {
    if (!win.canPass) {
      lockCard.hidden = false;
      stepWrap.hidden = true;
      $("steps").hidden = true;
      if ($("draftRestoreBanner")) $("draftRestoreBanner").hidden = true;
      const alertBox = $("windowLockAlertBox");
      if (win.state === "completed") {
        lockCard.style.borderColor = "var(--good)";
        $("windowLockIcon").textContent = "✅";
        $("windowLockTitle").textContent = "Чек-лист «" + block + "» за сегодня выполнен";
        $("windowLockDesc").textContent = "Все обязательные пункты блока «" + block + "» успешно сданы" + (win.completedRecord && win.completedRecord.time ? " в " + win.completedRecord.time : "") + ". Повторная отправка не требуется.";
        alertBox.hidden = true;
      } else if (win.state === "before_window") {
        lockCard.style.borderColor = "var(--warn)";
        $("windowLockIcon").textContent = "⏳";
        $("windowLockTitle").textContent = "Доступ к чек-листу «" + block + "» ещё не открыт";
        $("windowLockDesc").textContent = "Прохождение чек-листа доступно для сотрудников строго в отведённое время: с " + win.openTime + " до " + win.deadline + " (сейчас " + win.currentTime + ").";
        alertBox.hidden = true;
      } else {
        lockCard.style.borderColor = "var(--bad)";
        $("windowLockIcon").textContent = "🔒";
        $("windowLockTitle").textContent = "Доступ закрыт — время выполнения истекло!";
        $("windowLockDesc").textContent = "Отведённое время для прохождения чек-листа «" + block + "» (" + win.openTime + " – " + win.deadline + ") закончилось. Прохождение после дедлайна заблокировано.";
        alertBox.hidden = false;
        alertBox.innerHTML =
          "<b>🚨 Автоматическая фиксация нарушения:</b><br>" +
          "• В реестр проблем занесён критический инцидент о несвоевременном выполнении чек-листа «" + block + "».<br>" +
          "• Администратору отправлено уведомление в Telegram.<br>" +
          "• Открыть доступ или продлить окно может только администратор в разделе <b>«Управление → Задачи»</b>.";
      }
      return false;
    } else {
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
  $("stepCounter").textContent = "Задача " + (idx + 1) + " из " + cur.length + (t.id ? " · код " + t.id : "");
  if ($("photoModeTag")) {
    $("photoModeTag").textContent = pMode === "да" ? "📷 Фото обязательно" : (pMode === "при проблеме" ? "📷 Фото при проблеме" : "✓ Без фото");
    $("photoModeTag").style.color = pMode === "да" ? "var(--warn)" : "var(--muted)";
  }
  $("taskTitle").textContent = t.title || "";
  $("taskInstruction").textContent = t.instruction || "";
  $("taskInstruction").hidden = !t.instruction;

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
    $("choiceHint").textContent = !choiceMade
      ? "Нажмите «Всё в норме» или «Обнаружена проблема», чтобы разблокировать переход далее"
      : (incident ? "Заполните карточку проблемы — она сразу поступит в реестр инцидентов и Telegram" : "✓ Выполнение по стандарту подтверждено");
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
function makeStampedFallbackPhoto() {
  const c = document.createElement("canvas");
  c.width = 800; c.height = 500;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, "#2e1b11"); g.addColorStop(1, "#5a3a29");
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = "rgba(224,167,106,.45)"; x.lineWidth = 3;
  x.strokeRect(22, 22, c.width - 44, c.height - 44);
  x.fillStyle = "#e0a76a"; x.font = "700 22px system-ui,sans-serif";
  x.fillText("📸 ФОТОФИКСАЦИЯ ПУНКТА · КАДР №" + (photos.length + 1), 44, 90);
  x.fillStyle = "#fff"; x.font = "700 26px system-ui,sans-serif";
  x.fillText(String((cur[idx] && cur[idx].title) || "Проверка").slice(0, 40), 44, 150);
  x.fillStyle = "#f6ece2"; x.font = "500 19px system-ui,sans-serif";
  x.fillText("Блок: " + block + " · Сотрудник: " + userName, 44, 205);
  x.fillStyle = "rgba(0,0,0,.6)"; x.fillRect(0, c.height - 54, c.width, 54);
  x.fillStyle = "#fff"; x.font = "600 17px system-ui,sans-serif";
  x.fillText(new Date().toLocaleString("ru-RU") + " · " + LOCATION, 24, c.height - 20);
  return c.toDataURL("image/jpeg", 0.8);
}

if ($("simPhotoBtn")) {
  $("simPhotoBtn").onclick = () => {
    const dataUrl = makeStampedFallbackPhoto();
    photos.push(dataUrl);
    photo = photos[0];
    setPhotoUI();
    photoMsg("✓ Добавлен контрольный снимок (всего кадров: " + photos.length + ")", "good");
    validate();
    saveAnswer();
  };
}

/* Модальное окно «Как правильно выполнить (фотообразец)» */
if ($("btnSampleModal")) {
  $("btnSampleModal").onclick = () => {
    const t = cur[idx];
    if (!t) return;
    $("sampleDlgTitle").textContent = "📖 Стандарт: " + (t.title || "");
    $("sampleDlgInstr").textContent = t.instruction || "Выполните операцию согласно регламенту смены.";
    const samples = window.coffeeGetSamplePhotos ? window.coffeeGetSamplePhotos(t) : [];
    $("sampleDlgPhotos").innerHTML = samples.map((s) => (
      '<div style="border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--bg)">' +
        '<div style="font-weight:700;font-size:13.5px;margin-bottom:6px">' + esc(s.label) + '</div>' +
        '<img src="' + s.url + '" alt="' + s.label + '" style="width:100%;border-radius:10px;display:block">' +
        '<div class="muted" style="font-size:12.5px;margin-top:6px">' + esc(s.caption || '') + '</div>' +
      '</div>'
    )).join("");
    safeShowModal($("sampleDlg"));
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
let camFacing = "environment", camMode = "photo", camT = null, recT = null, rec = null, recChunks = [], armed = false;
document.addEventListener("pointerdown", () => { armed = true; }, { once: true });
function stopStream() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $("camVideo").srcObject = null; }
async function startStream() {
  stopStream(); $("camShot").disabled = true;
  const v = $("camVideo"), tries = [{ video: { facingMode: { ideal: camFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }, { video: true, audio: false }];
  let s = null, err;
  for (const c of tries) { try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; if (e && /NotAllowed|Permission|Security/i.test(e.name)) break; } }
  if (!s) throw err || new Error("no camera");
  stream = s; v.srcObject = s; v.style.transform = camFacing === "user" ? "scaleX(-1)" : "";
  try { await v.play(); } catch (e) {}
  await new Promise((r) => { if (v.videoWidth) return r(); v.onloadedmetadata = () => r(); setTimeout(r, 2500); });
  await new Promise((r) => setTimeout(r, 300));
  $("camShot").disabled = !v.videoWidth;
}
function camError(e) {
  const n = (e && e.name) || "";
  photoMsg(/NotAllowed|Permission|Security/i.test(n) ? "Нет доступа к камере — нажмите «📸 Контрольный снимок со штампом» ниже." : "Камера недоступна — нажмите «📸 Контрольный снимок со штампом».", "bad");
}
async function openCamera() {
  if (photoBusy || !$("cam").hidden) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    if ($("simPhotoBtn")) $("simPhotoBtn").click();
    return;
  }
  $("cam").hidden = false; setMode("photo"); photoMsg("");
  try { await startStream(); }
  catch (e) {
    closeCamera();
    if ($("simPhotoBtn")) {
      $("simPhotoBtn").click();
      toast("📸 Камера недоступна в этом окне — прикреплён контрольный снимок со штампом");
    } else {
      camError(e);
    }
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
function shot(n) {
  const v = $("camVideo"); if (!v.videoWidth) return;
  const k = Math.min(1, 1280 / v.videoWidth), c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  if (isBlack(c) && n < 3) return void setTimeout(() => shot(n + 1), 350);
  closeCamera(); gotPhoto(c);
}
function pickMime() { if (!window.MediaRecorder) return null; for (const m of ["video/webm;codecs=vp8", "video/webm", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return m; return ""; }
function toggleRec() {
  if (rec && rec.state === "recording") { rec.stop(); return; }
  const mime = pickMime(); if (mime === null) { toast("Запись видео не поддерживается — снимите фото"); return; }
  recChunks = [];
  try { rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: 1200000 }, mime ? { mimeType: mime } : {})); } catch (e) { toast("Не удалось начать запись видео"); return; }
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
$("drop").onclick = openCamera;
$("drop").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCamera(); } };
$("camCancel").onclick = closeCamera;
$("camShot").onclick = () => { cancelAuto(); if (camMode === "video") toggleRec(); else shot(0); };
$("mPhoto").onclick = () => { if (!(rec && rec.state === "recording")) setMode("photo"); };
$("mVideo").onclick = () => { if (!(rec && rec.state === "recording")) setMode("video"); };
$("camFlip").onclick = async () => {
  if (rec && rec.state === "recording") return;
  cancelAuto(); const prev = camFacing; camFacing = prev === "user" ? "environment" : "user";
  try { await startStream(); } catch (e) { camFacing = prev; try { await startStream(); } catch (x) { closeCamera(); camError(x); return; } toast("Вторая камера недоступна"); }
};
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
      toast("📸 Для этого шага нужно фото — нажмите «Открыть камеру» или «📸 Контрольный снимок со штампом»");
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
  if (idx < cur.length - 1) { idx++; renderStep(); return; }
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
  const ok = await post({
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
  clearShiftDraft();
  if (ok) { markDone(block); drawTabs(); }
  const n = answers.filter((a) => a && a.isIncident).length;
  const lateNote = win.isOverdue ? " · ⚠️ Статус: Выполнено с опозданием (после " + win.deadline + ")" : " · ✓ Выполнено в срок";
  finish(ok, (n ? "Зарегистрировано проблем: " + n : "Все пункты в норме") + lateNote);
  if ($("toDash")) $("toDash").hidden = true;
};

/* ---------- Вкладка 3.2: Информирование и кнопка «Ознакомлен» ---------- */
function renderTtkCatalog() {
  const box = $("ttkListContainer");
  if (!box) return;
  const q = ($("ttkSearchIn") ? $("ttkSearchIn").value : "").trim().toLowerCase();
  const list = ((window.coffeeGetInstantAdmin && window.coffeeGetInstantAdmin().ttk) || window.COFFEE_DEFAULT_TTK || []).filter((t) => !q || (t.name + " " + t.category + " " + t.recipe).toLowerCase().indexOf(q) >= 0);
  box.innerHTML = list.map((t) => (
    '<div style="border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:color-mix(in srgb,var(--crema,#c89b6d) 8%,var(--surface,#fff))">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<b>' + esc(t.name) + ' <span class="tag">' + esc(t.volume) + '</span></b>' +
        '<span class="tag ok">' + esc(t.category) + ' · ' + esc(t.price) + ' руб.</span>' +
      '</div>' +
      '<div style="font-size:13.5px;margin-top:6px;line-height:1.45"><b>📐 Рецептура:</b> ' + esc(t.recipe) + '</div>' +
      (t.serving ? '<div class="muted" style="font-size:12.5px;margin-top:4px"><b>🍽 Подача:</b> ' + esc(t.serving) + '</div>' : '') +
    '</div>'
  )).join('');
}
if ($("ttkSearchIn")) $("ttkSearchIn").addEventListener("input", renderTtkCatalog);

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
  pBox.innerHTML = showList.map((t) => {
    const doneKey = "coffee_ptask_done_" + isoToday() + "_" + (t.id || t.row) + "_" + userName;
    let isDoneTask = false;
    try { isDoneTask = localStorage.getItem(doneKey) === "1"; } catch (_) {}
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg)">' +
      '<div><b>' + esc(t.title) + '</b> <span class="tag">' + esc(t.block) + '</span>' +
      (t.instruction ? '<div class="muted" style="font-size:12.5px;margin-top:3px">' + esc(t.instruction) + '</div>' : '') +
      '<div class="muted" style="font-size:11.5px;margin-top:2px">Ответственный: <b>' + esc(t.responsible || "Бариста") + '</b></div></div>' +
      '<button type="button" class="b-sm" data-ptaskdone="' + esc(doneKey) + '" style="padding:7px 12px;border-radius:10px;border:1px solid ' + (isDoneTask ? 'var(--good)' : 'var(--line)') + ';background:' + (isDoneTask ? 'color-mix(in srgb,var(--good) 16%,var(--bg))' : 'var(--surface,#fff)') + ';color:' + (isDoneTask ? 'var(--good)' : 'var(--ink)') + ';font-weight:700;cursor:pointer;white-space:nowrap">' + (isDoneTask ? '✓ Выполнено' : 'Отметить') + '</button>' +
    '</div>';
  }).join("");
}
if ($("personalTasksList")) {
  $("personalTasksList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ptaskdone]");
    if (!b) return;
    const k = b.dataset.ptaskdone;
    try {
      const curVal = localStorage.getItem(k) === "1";
      localStorage.setItem(k, curVal ? "0" : "1");
    } catch (_) {}
    renderPersonalTasksInInfo();
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

if ($("quickIncidentBtn")) {
  $("quickIncidentBtn").onclick = () => {
    $("qiStep").value = "";
    $("qiText").value = "";
    safeShowModal($("quickIncDlg"));
  };
}
if ($("qiCancel")) $("qiCancel").onclick = () => safeCloseModal($("quickIncDlg"));
if ($("quickIncForm")) {
  $("quickIncForm").onsubmit = async (e) => {
    e.preventDefault();
    const txt = $("qiText").value.trim();
    if (txt.length < 3) { toast("Опишите проблему (минимум 3 символа)"); return; }
    await post({
      action: "report_standalone_incident",
      userName,
      incType: $("qiType").value,
      step: $("qiStep").value.trim() || $("qiType").value,
      text: txt,
      priority: $("qiPriority").value
    });
    safeCloseModal($("quickIncDlg"));
    toast("🚨 Инцидент зарегистрирован и отправлен в Telegram!");
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
  try { await sendRaw(p); return true; }
  catch (e) {
    const q = getQ(); q.push(p);
    if (!setQ(q)) {
      q.pop(); const light = JSON.parse(JSON.stringify(p));
      if (light.items) light.items.forEach((i) => i.photo_base64 = "");
      q.push(light); setQ(q);
    }
    queueUI(); return false;
  }
}
async function flush() {
  const q = getQ(); if (!q.length) return;
  const rest = [];
  for (const p of q) { try { await sendRaw(p); } catch (e) { rest.push(p); } }
  setQ(rest); queueUI();
}
function queueUI() {
  const n = getQ().length;
  $("queueNote").hidden = !n;
  $("queueText").textContent = "Не отправлено отчётов: " + n;
}
$("queueBtn").onclick = flush;
window.addEventListener("online", flush);

/* Реактивное обновление терминала при любых изменениях в разделе «Управление» */
async function syncFromAdminChanges() {
  try {
    const d = await coffeeFetch(API_URL + "?action=get_checklists&nocache=1");
    if (d && d.ok !== false && Array.isArray(d.tasks)) {
      tasks = d.tasks;
      META = d;
      if (d.plan > 0) PLAN = d.plan;
      if (d.location) { LOCATION = d.location; $("loc").textContent = LOCATION; }
      if (d.initCounter > 0 && $("initCounterIn")) $("initCounterIn").value = d.initCounter;
      syncStaffSelector();
      drawTabs();
      if (block === "ИНФО") {
        renderInfoView();
      } else if (block === "КАССА") {
        renderCash();
      } else {
        cur = tasks.filter((t) => t.block === block && t.active !== "нет");
        if (idx >= cur.length) idx = Math.max(0, cur.length - 1);
        updateDeadlineUI();
        if (cur.length && !$("taskStepWrap").hidden) renderStep();
      }
    }
  } catch (_) {}
}
if (window.coffeeBus) {
  window.coffeeBus.on((msg) => {
    if (msg && msg.type === "mutation") syncFromAdminChanges();
  });
}
window.addEventListener("storage", (e) => {
  if (e && (e.key === "coffee_unified_hybrid_db_v3" || e.key === "coffee_sync_signal" || e.key === "coffee_illy_tasks")) {
    syncFromAdminChanges();
  }
});
window.addEventListener("focus", syncFromAdminChanges);


function finish(ok, text) {
  tgt(() => tg.HapticFeedback.notificationOccurred(ok ? "success" : "warning"));
  $("steps").hidden = true; show("doneView");
  $("doneTitle").textContent = ok ? "Отправлено!" : "Сохранено на телефоне";
  $("doneText").textContent = ok ? text : "Нет связи — отчёт уйдёт автоматически, когда появится интернет.";
}

/* ---------- касса: CSV ---------- */
async function readText(file) {
  const buf = await file.arrayBuffer();
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { s = new TextDecoder("windows-1251").decode(buf); }
  return s.replace(/^\uFEFF/, "");
}
function parseCsv(text) {
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
const COFFEE_ITEM_RE = /американо|капучино|латте|лате|flat\s*white|флэт|длинный\s*черный|эспрессо|ice\s*latte|айс\s*латте|раф|кофе\s*по/i;
const WEEKDAY_STOP_RE = /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|вокскресенье|продажи|транзакции|отчет|отчёт|касса|csv|шт|день)$/i;
let lastParsedShiftDays = [];
let activeShiftCounterCups = null;

function extractMetaFromFilename(fname) {
  const s = String(fname || "").replace(/\.csv$/i, "");
  let dateIso = "";
  const dm = /(\d{1,2})[._-](\d{1,2})[._-](\d{4})/.exec(s);
  if (dm) dateIso = dm[3] + "-" + String(dm[2]).padStart(2, "0") + "-" + String(dm[1]).padStart(2, "0");
  const words = s.match(/[А-ЯЁа-яё]{3,}/g) || [];
  const names = words.filter((w) => !WEEKDAY_STOP_RE.test(w)).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return { date: dateIso, barista: Array.from(new Set(names)).join(", "), isSales: /продаж/i.test(s), isTrans: /транзакц/i.test(s) };
}

function fileDate(rows) {
  const c = {};
  for (let i = 1; i < rows.length; i++) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(rows[i][0] || "");
    if (m) { const k = m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); c[k] = (c[k] || 0) + 1; }
  }
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || "";
}

function detectCsvKind(rows, fname) {
  const head = (rows[0] || []).join(" ").toLowerCase();
  if (/способ оплаты|сумма документа/.test(head)) return "trans";
  if (/номенклатура|номиенклатура|количество/.test(head)) return "sales";
  const meta = extractMetaFromFilename(fname);
  if (meta.isTrans) return "trans";
  if (meta.isSales) return "sales";
  return "sales";
}

function cleanProductName(raw) {
  return String(raw || "").replace(/^["']+|["']+$/g, "").replace(/""/g, '"').replace(/\s+(шт\.?|бут\.?)$/i, "").replace(/\s{2,}/g, " ").trim();
}

function calcTrans(rows, fname) {
  let cash = 0, card = 0, checks = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.length < 4) continue;
    const method = r[2] || "", amt = num(r[3]);
    if (amt <= 0) continue;
    if (/налич/i.test(method)) cash += amt;
    else if (/мобил|карт|безнал/i.test(method)) card += amt;
    else cash += amt;
    checks++;
  }
  if (!checks && !cash && !card) throw new Error("empty");
  const meta = extractMetaFromFilename(fname);
  return { cash: Math.round(cash), card: Math.round(card), checks, date: meta.date || fileDate(rows), barista: meta.barista };
}

function calcSales(rows, fname) {
  const head = rows[0] || [];
  let qtyCol = head.findIndex((h) => /кол/i.test(h));
  let sumCol = head.findIndex((h) => /сумм|выруч/i.test(h));
  if (qtyCol < 0) qtyCol = head.length >= 9 ? 7 : 2;
  if (sumCol < 0) sumCol = head.length >= 9 ? 8 : 3;
  const map = {};
  let total = 0, calcSum = 0, totalQty = 0, coffeeCups = 0, addonsSum = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c && c.trim())) continue;
    const rawName = (r[0] || "").trim();
    const sum = num(r[sumCol]), qty = qtyCol >= 0 ? num(r[qtyCol]) : 1;
    if (!rawName && sum > 0) { total = Math.round(sum); if (qty > 0) totalQty = Math.round(qty); continue; }
    if (!rawName || rawName === "nan") continue;
    const name = cleanProductName(rawName);
    if (sum <= 0 && qty <= 0) continue;
    calcSum += sum;
    if (COFFEE_ITEM_RE.test(name) && !ADDON.test(name)) coffeeCups += Math.round(qty);
    if (ADDON.test(name)) { addonsSum += Math.round(sum); continue; }
    const m = map[name] || (map[name] = { name, qty: 0, sum: 0 });
    m.qty += qty; m.sum += sum;
  }
  const list = Object.values(map).map((x) => ({ name: x.name, qty: Math.round(x.qty), sum: Math.round(x.sum) }));
  if (!list.length && !calcSum) throw new Error("empty");
  list.sort((a, b) => b.qty - a.qty || b.sum - a.sum);
  const meta = extractMetaFromFilename(fname);
  const top = list.slice(0, 10);
  top.total = total || Math.round(calcSum);
  top.totalQty = totalQty || Math.round(list.reduce((s, x) => s + x.qty, 0));
  top.coffeeCups = coffeeCups;
  top.addonsSum = addonsSum;
  top.date = meta.date;
  top.barista = meta.barista;
  return top;
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
    $("salesState").textContent = "✓ " + labelName + " · сумма " + rub(data.total) + " · кофе по кассе: " + data.coffeeCups + " чашек";
    if (data.date && data.date <= isoToday() && (!trans || !trans.date)) setReportDate(data.date);
    if (data.barista && !$("shiftBaristaIn").value) { $("shiftBaristaIn").value = data.barista; $("who").textContent = data.barista; }
    if (!trans && data.total > 0) {
      trans = { cash: data.total, card: 0, checks: data.totalQty || data.coffeeCups || 1, date: data.date || reportDate, fromSalesOnly: true };
    }
  }
  renderCash();
}

let batchDaysMap = {};

function mergeIntoBatchDay(dateStr, baristaName, part) {
  const d = dateStr || reportDate || isoToday();
  const sumMode = !$("sumModeChk") || $("sumModeChk").checked;
  if (!batchDaysMap[d] || !sumMode) {
    batchDaysMap[d] = {
      date: d,
      baristas: baristaName ? [baristaName] : [],
      shifts: [],
      cash: 0, card: 0, checks: 0, writeoff: 0, coffeeCups: 0,
      salesTotal: 0,
      productsMap: {},
      files: []
    };
  }
  const rec = batchDaysMap[d];
  if (baristaName) {
    baristaName.split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => {
      if (!rec.baristas.includes(n)) rec.baristas.push(n);
    });
  }
  if (part.fileName && !rec.files.includes(part.fileName)) rec.files.push(part.fileName);

  if (part.kind === "trans") {
    rec.cash += part.cash || 0;
    rec.card += part.card || 0;
    rec.checks += part.checks || 0;
    rec.shifts.push({ name: baristaName || "Бариста", cash: part.cash || 0, card: part.card || 0, checks: part.checks || 0, writeoff: 0, cups: part.checks || 0 });
  } else if (part.kind === "sales") {
    rec.salesTotal += part.total || 0;
    rec.coffeeCups += part.coffeeCups || 0;
    (part.items || []).forEach((it) => {
      const pm = rec.productsMap[it.name] || (rec.productsMap[it.name] = { name: it.name, qty: 0, sum: 0 });
      pm.qty += it.qty || 0;
      pm.sum += it.sum || 0;
    });
  } else if (part.kind === "shift") {
    rec.cash += part.cash || 0;
    rec.card += part.card || 0;
    rec.checks += part.checks || 0;
    rec.writeoff += part.writeoff || 0;
    rec.coffeeCups += part.cups || 0;
    if (Array.isArray(part.shifts)) rec.shifts = rec.shifts.concat(part.shifts);
  }
}

function finalizeBatchDay(dObj) {
  const products = Object.values(dObj.productsMap || {}).sort((a, b) => b.qty - a.qty);
  const cash = dObj.cash || (dObj.salesTotal && !dObj.card ? dObj.salesTotal : 0);
  const card = dObj.card || 0;
  const checks = dObj.checks || dObj.coffeeCups || products.reduce((s, x) => s + x.qty, 0) || 1;
  return {
    date: dObj.date,
    barista: dObj.baristas.join(", ") || "Бариста",
    shifts: dObj.shifts.length ? dObj.shifts : [{ name: dObj.baristas.join(", ") || "Бариста", cash, card, checks, writeoff: dObj.writeoff || 0, cups: dObj.coffeeCups || checks }],
    cash,
    card,
    revenue: cash + card,
    checks,
    writeoff: dObj.writeoff || 0,
    coffeeCups: dObj.coffeeCups || checks,
    salesTotal: dObj.salesTotal || 0,
    products: products.slice(0, 12),
    topItems: products.slice(0, 3).map((x) => x.name + " ×" + x.qty).join(", "),
    files: dObj.files || []
  };
}

function renderBatchSummaryUI() {
  const box = $("batchSummaryBox");
  const keys = Object.keys(batchDaysMap).sort();
  if (!keys.length) { box.hidden = true; return; }
  const list = keys.map((k) => finalizeBatchDay(batchDaysMap[k]));
  const grandRev = list.reduce((s, x) => s + x.revenue, 0);
  const grandWo = list.reduce((s, x) => s + x.writeoff, 0);
  const grandCups = list.reduce((s, x) => s + x.coffeeCups, 0);

  box.hidden = false;
  box.innerHTML =
    '<div style="background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<b>📊 Автоматическая сводка по загруженным данным (' + list.length + ' дн.)</b>' +
        '<span style="font-size:13px"><b style="color:var(--good)">Доход: ' + rub(grandRev) + '</b> · <b style="color:var(--bad)">Списания: ' + grandWo + '</b> · ☕ Чашек: <b>' + grandCups + '</b></span>' +
      '</div>' +
      list.map((d) => (
        '<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13.5px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<div>' +
            '<b>📅 ' + esc(d.date.split("-").reverse().join(".")) + '</b> · 👤 <b>' + esc(d.barista) + '</b>' +
            (d.shifts.length > 1 ? ' <span style="font-size:11.5px;padding:1px 6px;border-radius:99px;background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good);font-weight:700">Сумма ' + d.shifts.length + ' смен</span>' : '') +
            '<div class="muted" style="font-size:12px">Нал: ' + rub(d.cash) + ' · Безнал: ' + rub(d.card) + ' · Чеков/чашек: ' + d.checks + (d.topItems ? ' · Хиты: ' + d.topItems : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<b style="color:var(--good);font-size:15px">' + rub(d.revenue) + '</b>' +
            (d.writeoff ? '<div style="color:var(--bad);font-size:12px;font-weight:700">Списания: ' + d.writeoff + '</div>' : '') +
          '</div>' +
        '</div>'
      )).join("") +
      '<button type="button" class="btn" id="saveAllBatchBtn" style="margin-top:12px;min-height:46px;font-size:15px">💾 Записать все распознанные дни (' + list.length + ') в систему</button>' +
    '</div>';

  /* Подставляем последний распознанный день в основную карточку Кассы */
  const last = list[list.length - 1];
  if (last) {
    setReportDate(last.date);
    $("shiftBaristaIn").value = last.barista;
    $("who").textContent = last.barista;
    $("writeOffs").value = last.writeoff;
    activeShiftCounterCups = last.coffeeCups;
    trans = { cash: last.cash, card: last.card, checks: last.checks, date: last.date, barista: last.barista, shifts: last.shifts };
    if (last.products && last.products.length) {
      sales = last.products.slice();
      sales.total = last.salesTotal || last.revenue;
      sales.coffeeCups = last.coffeeCups;
      sales.totalQty = last.checks;
    }
    renderCash();
  }

  $("saveAllBatchBtn").onclick = async () => {
    const mergeMode = (!$("sumModeChk") || $("sumModeChk").checked) ? "sum" : "replace";
    await post({ action: "batch_submit_cash", mergeMode, days: list });
    markDone("КАССА"); drawTabs();
    finish(true, "Сохранено дней: " + list.length + " · Общий доход " + rub(grandRev) + " · все смены просуммированы и доступны на Дашборде и в Отчётах.");
    if ($("toDash")) $("toDash").hidden = true;
  };
}

$("unifiedFilesIn").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  if (!$("sumModeChk") || !$("sumModeChk").checked) batchDaysMap = {};
  for (const f of files) {
    try {
      const txt = await readText(f);
      if (/сч[её]тчик/i.test(txt) && !/способ оплаты|номенклатура|номиенклатура/i.test(txt)) {
        const sDays = parseShiftCounterText(txt, Number($("initCounterIn").value) || 600);
        sDays.forEach((sd) => {
          mergeIntoBatchDay(sd.date, sd.baristas.join(", "), {
            kind: "shift", fileName: f.name, cash: sd.totalCash, card: 0,
            checks: sd.totalSoldCups || sd.totalCups, cups: sd.totalCups, writeoff: sd.totalWoQty,
            shifts: sd.shifts.map((s) => ({ name: s.name, cash: s.cash, card: 0, checks: s.cupsSold || s.cupsTotal || 0, writeoff: s.writeoffQty, prevCounter: s.prevCounter, counter: s.counter, cups: s.cupsTotal }))
          });
        });
      } else {
        const rows = parseCsv(txt);
        const kind = detectCsvKind(rows, f.name);
        if (kind === "trans") {
          const td = calcTrans(rows, f.name);
          mergeIntoBatchDay(td.date, td.barista, { kind: "trans", fileName: f.name, cash: td.cash, card: td.card, checks: td.checks });
          applyParsedCsv("trans", td, f.name);
        } else {
          const sd = calcSales(rows, f.name);
          mergeIntoBatchDay(sd.date, sd.barista, { kind: "sales", fileName: f.name, total: sd.total, coffeeCups: sd.coffeeCups, items: sd });
          applyParsedCsv("sales", sd, f.name);
        }
      }
    } catch (err) {
      toast("Не удалось обработать " + f.name);
    }
  }
  $("fUnified").classList.add("ok");
  $("unifiedState").textContent = "✓ Обработано файлов: " + files.length + " · разбито по датам и бариста";
  renderBatchSummaryUI();
});

document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
  const key = btn.dataset.preset;
  if (key === "all_batch") {
    batchDaysMap = {};
    ["30_10", "31_10", "01_11"].forEach((k) => {
      const p = SAMPLE_FILES_DB[k];
      if (p.transCsv) {
        const td = calcTrans(parseCsv(p.transCsv), p.transName);
        mergeIntoBatchDay(td.date, td.barista, { kind: "trans", fileName: p.transName, cash: td.cash, card: td.card, checks: td.checks });
      }
      if (p.salesCsv) {
        const sd = calcSales(parseCsv(p.salesCsv), p.salesName);
        mergeIntoBatchDay(sd.date, sd.barista, { kind: "sales", fileName: p.salesName, total: sd.total, coffeeCups: sd.coffeeCups, items: sd });
      }
    });
    const sDays = parseShiftCounterText(SAMPLE_FILES_DB.shift_text, 600);
    sDays.forEach((sd) => {
      mergeIntoBatchDay(sd.date, sd.baristas.join(", "), {
        kind: "shift", fileName: "Смены 3.11 и 4.11", cash: sd.totalCash, card: 0,
        checks: sd.totalSoldCups || sd.totalCups, cups: sd.totalCups, writeoff: sd.totalWoQty,
        shifts: sd.shifts.map((s) => ({ name: s.name, cash: s.cash, card: 0, checks: s.cupsSold || s.cupsTotal || 0, writeoff: s.writeoffQty, prevCounter: s.prevCounter, counter: s.counter, cups: s.cupsTotal }))
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
  trans = null; sales = null; activeShiftCounterCups = null;
  if (p.transCsv) {
    const td = calcTrans(parseCsv(p.transCsv), p.transName);
    mergeIntoBatchDay(td.date, td.barista, { kind: "trans", fileName: p.transName, cash: td.cash, card: td.card, checks: td.checks });
    applyParsedCsv("trans", td, p.transName);
  }
  if (p.salesCsv) {
    const sd = calcSales(parseCsv(p.salesCsv), p.salesName);
    mergeIntoBatchDay(sd.date, sd.barista, { kind: "sales", fileName: p.salesName, total: sd.total, coffeeCups: sd.coffeeCups, items: sd });
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
      if (s.counter !== null && prevCnt !== null && s.counter >= prevCnt) {
        s.cupsTotal = s.counter - prevCnt;
        s.cupsSold = Math.max(0, s.cupsTotal - s.writeoffQty);
      } else { s.cupsTotal = null; s.cupsSold = null; }
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
  $("writeOffs").value = d.totalWoQty;
  activeShiftCounterCups = d.totalCups;
  trans = {
    cash: d.totalCash,
    card: (trans && !trans.fromShiftText && trans.date === d.date) ? trans.card : 0,
    checks: d.totalSoldCups || d.totalCups || 1,
    date: d.date,
    barista: bNames,
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
          (s.cupsTotal != null ? ' (<b>+' + s.cupsTotal + '</b> чашек, списано <b>' + s.writeoffQty + '</b>, продано <b>' + s.cupsSold + '</b>)' : ' (списано ' + s.writeoffQty + ')') + '</span>' +
          '<b>Нал: ' + rub(s.cash) + '</b>' +
        '</div>'
      )).join("") +
      '<div style="display:flex;justify-content:space-between;font-size:14px;padding-top:7px;margin-top:4px;border-top:1px solid var(--line);font-weight:700">' +
        '<span>Итого по счётчику: ' + d.totalCups + ' чашек (списано ' + d.totalWoQty + ', чистых ' + d.totalSoldCups + ')</span>' +
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

function renderCash() {
  const t = trans, total = t ? t.cash + t.card : 0, pct = Math.round(total / PLAN * 100);
  $("cTotal").textContent = rub(total);
  $("cMeter").style.width = Math.min(pct, 100) + "%";
  $("cPlan").textContent = t ? "План " + rub(PLAN) + " · выполнено " + pct + "%" : "План " + rub(PLAN);
  $("cCash").textContent = t ? rub(t.cash) : "—";
  $("cCard").textContent = t ? rub(t.card) : "—";
  $("cChecks").textContent = t ? (t.checks + (sales && sales.totalQty ? " (" + sales.totalQty + " поз.)" : "")) : "—";
  const coffeeInfo = sales && sales.coffeeCups ? (sales.coffeeCups + " чаш. · ") : (activeShiftCounterCups ? (activeShiftCounterCups + " чаш. · ") : "");
  $("cAvg").textContent = t && t.checks ? (coffeeInfo + rub(Math.round(total / t.checks))) : "—";
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
    checkMsg = "ℹ️ Выручка рассчитана по «Продажи.csv» (" + rub(sum) + ", кофейных напитков: " + (sales.coffeeCups || 0) + " шт.)";
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
  trans = {
    cash: cVal,
    card: bVal,
    checks: kVal || Math.max(1, Math.round((cVal + bVal) / 35)),
    shifts: [{ name: who, cash: cVal, card: bVal, checks: kVal || Math.max(1, Math.round((cVal + bVal) / 35)), writeoff: Math.max(0, Math.round(parseFloat($("writeOffs") ? $("writeOffs").value : 0) || 0)), cups: kVal || Math.max(1, Math.round((cVal + bVal) / 35)) }]
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
function handleQuickCashPhoto(inp, isCounter) {
  const f = inp && inp.files && inp.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    if (isCounter) {
      quickCounterPhotoData = String(r.result || "");
      if ($("lblPhotoCounter")) $("lblPhotoCounter").textContent = "✓ Фото счётчика прикреплено";
    } else {
      quickPaperPhotoData = String(r.result || "");
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
  };
  r.readAsDataURL(f);
}
if ($("inPhotoCounter")) $("inPhotoCounter").addEventListener("change", (e) => handleQuickCashPhoto(e.target, true));
if ($("inPhotoPaper")) $("inPhotoPaper").addEventListener("change", (e) => handleQuickCashPhoto(e.target, false));
if ($("quickSubmitPaperCashBtn")) {
  $("quickSubmitPaperCashBtn").onclick = async () => {
    const cntVal = Number($("quickCounterIn") ? $("quickCounterIn").value : 0) || 0;
    const papCash = Number($("quickPaperCashIn") ? $("quickPaperCashIn").value : 0) || 0;
    if (!cntVal && !papCash && !quickCounterPhotoData && !quickPaperPhotoData) {
      toast("Укажите показание счётчика или прикрепите фото бумажного отчёта");
      return;
    }
    const prevCnt = Number($("initCounterIn") ? $("initCounterIn").value : 600) || 600;
    const deltaCups = cntVal > prevCnt ? (cntVal - prevCnt) : Math.max(1, Math.round(papCash / 35) || 45);
    const estCash = papCash > 0 ? papCash : (deltaCups * 35);
    if ($("manCashIn")) $("manCashIn").value = estCash;
    if ($("manChecksIn")) $("manChecksIn").value = deltaCups;
    applyManualCashInputs();
    if (trans && Array.isArray(trans.shifts) && trans.shifts[0]) {
      trans.shifts[0].prevCounter = prevCnt;
      trans.shifts[0].counter = cntVal || (prevCnt + deltaCups);
      trans.shifts[0].cups = deltaCups;
    }
    const phItems = [];
    if (quickCounterPhotoData) phItems.push({ id: "cash_cnt", title: "📷 Фото счётчика кофемашины (" + cntVal + ")", status: "ok", isIncident: false, photos: [quickCounterPhotoData], photo_url: quickCounterPhotoData });
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
  const top = sales || [];
  const ok = await post({
    action: "submit_cash", mergeMode: (!$("sumModeChk") || $("sumModeChk").checked) ? "sum" : "replace", shifts: (trans && trans.shifts) || undefined, sid: uid(), location: LOCATION, userName: ($("shiftBaristaIn") && $("shiftBaristaIn").value.trim()) || userName, date: reportDate,
    cash: trans.cash, card: trans.card, checks: trans.checks,
    writeOffs: Math.max(0, Math.round(parseFloat($("writeOffs").value) || 0)),
    topItems: top.slice(0, 3).map((x) => x.name + " ×" + x.qty).join(", "),
    products: top
  });
  if (reportDate === isoToday()) { markDone("КАССА"); drawTabs(); }
  finish(ok, "Выручка " + rub(trans.cash + trans.card) + " · чеков " + trans.checks + (reportDate === isoToday() ? "" : " · за " + reportDate.slice(8) + "." + reportDate.slice(5, 7)));
  if ($("toDash")) $("toDash").hidden = true;
};

/* ---------- старт ---------- */
const inProgress = () => block !== "КАССА" && !$("checklistView").hidden && (idx > 0 || !!photo || answers.some(Boolean));
document.addEventListener("click", (e) => {
  const b = e.target.closest("#termTimelineTabs button[data-b], .tabs button[data-b]");
  if (!b) return;
  tap();
  if (b.dataset.b !== block && inProgress()) { toast("Сначала завершите «" + block + "»: на каждом шаге нужно новое фото"); return; }
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


/* Мгновенное применение всех изменений из Панели управления владельца (окна, задачи, планы, ТТК, информирование, коды) */
function reloadTerminalFromVault() {
  try {
    if (typeof getUDB !== 'function') return;
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
    if (block === 'ИНФО') {
      renderInfoView();
    } else if (block === 'КАССА' || block === 'Касса') {
      const wCash = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow('Касса', db) : { canPass: true };
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
        renderStep();
      }
    }
  } catch (_) {}
}
if (window.coffeeBus) {
  window.coffeeBus.on((msg) => {
    if (msg && (msg.type === 'mutation' || msg.type === 'server_sync')) {
      reloadTerminalFromVault();
    }
  });
}
window.addEventListener('storage', (e) => {
  if (!e.key || /coffee_/.test(e.key)) reloadTerminalFromVault();
});
window.addEventListener('focus', reloadTerminalFromVault);


if ($("unlockBlockNowBtn")) {
  $("unlockBlockNowBtn").onclick = async () => {
    const targetBlk = (block === "КАССА" || block === "Касса") ? "Касса" : block;
    await post({
      action: "extend_deadline",
      block: targetBlk,
      openFrom: "00:00",
      until: "23:59",
      reason: "Открыто сотрудником/администратором в терминале"
    });
    if (window.applyLocalMutation) {
      window.applyLocalMutation({
        action: "extend_deadline",
        block: targetBlk,
        openFrom: "00:00",
        until: "23:59",
        reason: "Открыто сотрудником/администратором в терминале"
      });
    }
    toast("🔓 Доступ к блоку «" + targetBlk + "» открыт!");
    selectBlock(block);
  };
}
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
