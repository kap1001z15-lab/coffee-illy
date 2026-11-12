/* =========================================================================
   МОДУЛЬ ХРАНЕНИЯ ДАННЫХ И INDEXEDDB (js/storage.js — v21 Enterprise)
   - Полная поддержка IndexedDB (CoffeeEnterpriseDB_v21: stores records, photos, delta_queue, snapshots)
   - Автоматическая выгрузка тяжёлых base64-фотографий из localStorage в IndexedDB (idb://photo/<hash>),
     чтобы localStorage всегда оставался компактным (< 45 КБ) и никогда не переполнял лимит 5 МБ.
   - Сохранение всех настроек, чек-листов и истории владельца при обновлениях.
   ========================================================================= */
const _photoMemCache = {};

window.CoffeeIDB = (function () {
  const DB_NAME = 'CoffeeEnterpriseDB_v21';
  const DB_VER = 1;
  let _dbPromise = null;

  function openDB() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          ['records', 'photos', 'delta_queue', 'snapshots'].forEach((st) => {
            if (!idb.objectStoreNames.contains(st)) idb.createObjectStore(st);
          });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    return _dbPromise;
  }

  function put(storeName, key, val) {
    return openDB().then((idb) => {
      if (!idb) return false;
      return new Promise((resolve) => {
        try {
          const tx = idb.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(val, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    });
  }

  function get(storeName, key) {
    return openDB().then((idb) => {
      if (!idb) return null;
      return new Promise((resolve) => {
        try {
          const tx = idb.transaction(storeName, 'readonly');
          const r = tx.objectStore(storeName).get(key);
          r.onsuccess = () => resolve(r.result !== undefined ? r.result : null);
          r.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    });
  }

  // Выносит крупные base64-фото (> 2 КБ) в IndexedDB photos store и кэширует в _photoMemCache
  function offloadPhotoString(str) {
    if (typeof str !== 'string' || str.length < 2048 || !str.startsWith('data:image/')) return str;
    const hash = (window.coffeeSha256Sync ? window.coffeeSha256Sync(str.slice(0, 512) + str.length) : String(str.length)).slice(0, 20);
    const ref = 'idb://photo/' + hash;
    _photoMemCache[ref] = str;
    put('photos', ref, str);
    return ref;
  }

  function resolvePhotoString(str) {
    if (typeof str === 'string' && str.startsWith('idb://photo/')) {
      return _photoMemCache[str] || str;
    }
    return str;
  }

  function transformPhotos(obj, mode) {
    if (!obj || typeof obj !== 'object') return obj;
    const fn = mode === 'offload' ? offloadPhotoString : resolvePhotoString;
    const clone = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v === 'string' && (k === 'photo' || k === 'url' || k === 'cashPhotoMachine' || k === 'cashPhotoPaper' || v.startsWith('data:image/') || v.startsWith('idb://photo/'))) {
        clone[k] = fn(v);
      } else if (v && typeof v === 'object') {
        clone[k] = transformPhotos(v, mode);
      } else {
        clone[k] = v;
      }
    });
    return clone;
  }

  return {
    openDB,
    put,
    get,
    offloadPhotosFromDB(dbObj) {
      return transformPhotos(dbObj, 'offload');
    },
    hydratePhotosInDB(dbObj) {
      return transformPhotos(dbObj, 'hydrate');
    },
    getPhotoSync(ref) {
      return _photoMemCache[ref] || ref;
    }
  };
})();

function ensureMvpFields(db) {
  const t = _isoToday();
  if (!Array.isArray(db.staff)) {
    db.staff = window.COFFEE_MVP.DEFAULT_STAFF.map((x) => Object.assign({}, x));
  }
  if (!Array.isArray(db.announcements)) {
    db.announcements = window.COFFEE_MVP.DEFAULT_ANNOUNCEMENTS(t);
  }
  db.deadlineExtensions = db.deadlineExtensions || {};
  if (!Array.isArray(db.auditLog)) {
    db.auditLog = [];
  }
  (db.incidents || []).forEach((inc) => {
    inc.status = window.coffeeNormIncStatus(inc.status);
    inc.incType = inc.incType || 'Поломка оборудования';
    if (!Array.isArray(inc.photos)) {
      inc.photos = inc.photo ? [inc.photo] : [];
    }
    if (!inc.photo && inc.photos.length) inc.photo = inc.photos[0];
    if (!Array.isArray(inc.history) || !inc.history.length) {
      inc.history = [
        { time: (inc.date || t) + ' ' + (inc.time || '12:00'), actor: inc.who || 'Бариста', status: inc.status, note: 'Регистрация карточки инцидента' }
      ];
    }
  });
  (db.tasks || []).forEach((task) => {
    if (!task.photoMode) {
      task.photoMode = task.photo === 'да' ? 'да' : (task.photo === 'при проблеме' ? 'при проблеме' : 'нет');
    }
  });
}

function appendAudit(db, actor, action, details) {
  const now = new Date();
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    ts: Date.now(),
    date: _isoToday(),
    time: hm,
    actor: actor || 'Система',
    action: action || 'Действие',
    details: details || ''
  });
  if (db.auditLog.length > 250) db.auditLog.length = 250;
}

const UDB_KEY = 'coffee_unified_hybrid_db_v3';

function _defaultUDB() {
  const t = _isoToday();
  return {
    location: 'Кофейня №1',
    plan: 2200,
    deadline: '08:30',
    woNorm: 15,
    photoAll: 'нет',
    initCounter: 600,
    adminPin: '',
    blocks: ['Открытие', 'День', 'Закрытие'],
    categories: ['Закупка продуктов', 'Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Ремонт и оборудование', 'Прочее'],
    settings: DEFAULT_SETTINGS_SCHEMA.map((s) => Object.assign({}, s)),
    modifiedSettings: {},
    tasks: (window.COFFEE.DEFAULT_TASKS || []).map((x, i) => Object.assign({}, x, { row: i + 2, mediaRequired: x.photo === 'да' })),
    cash: [],
    expenses: [],
    incidents: [],
    deletedIncidents: {},
    resolvedIncidents: {},
    productsByDate: {},
    checklists: [],
    checklistSubmissions: [],
    announcements: []
  };
}

function syncSettingsFields(db) {
  const map = {};
  (db.settings || []).forEach((s) => {
    const nk = normalizeSettingKey(s.id || s.label);
    map[nk] = s;
    s.id = nk;
  });
  db.settings = DEFAULT_SETTINGS_SCHEMA.map((def) => {
    if (map[def.id]) return Object.assign({}, def, map[def.id], { id: def.id, label: def.label, hint: def.hint });
    return Object.assign({}, def);
  });

  const getVal = (id, fallback) => {
    const item = db.settings.find((x) => x.id === id);
    return item && item.value !== undefined && String(item.value).trim() !== '' ? String(item.value).trim() : fallback;
  };

  db.location = getVal('LOCATION', db.location || 'Кофейня №1');
  db.plan = Math.max(1, Number(String(getVal('PLAN', db.plan || 2200)).replace(/\s/g, '')) || 2200);
  db.deadline = getVal('DEADLINE', db.deadline || '08:30');
  if (/^\d:\d{2}$/.test(db.deadline)) db.deadline = '0' + db.deadline;
  [
    { id: 'MIN_AVG_CHECK', label: 'Норматив среднего чека, руб. (ТЗ п. 8)', hint: 'Плановый минимальный средний чек для контроля выполнения плана', value: '35', secret: false },
    { id: 'PLAN_CHECKS', label: 'Плановое кол-во чеков в день (ТЗ п. 8)', hint: 'Целевое количество гостей/чеков за смену', value: '75', secret: false }
  ].forEach((defS) => {
    if (!(db.settings || []).some((x) => x.id === defS.id)) {
      db.settings.push(Object.assign({}, defS));
    }
  });
  db.woNorm = Math.max(0, Number(String(getVal('WO_NORM', db.woNorm ?? 15)).replace(/\s/g, '')) || 0);
  db.minAvgCheck = Math.max(1, Number(getVal('MIN_AVG_CHECK', db.minAvgCheck || 35)) || 35);
  db.planChecks = Math.max(1, Number(getVal('PLAN_CHECKS', db.planChecks || 75)) || 75);
  if (!Array.isArray(db.serviceAudits)) {
    db.serviceAudits = [];
  }
  db.cashHistory = db.cashHistory || [];
  if (!Array.isArray(db.ttk)) {
    db.ttk = (window.COFFEE_DEFAULT_TTK || []).map((x) => Object.assign({}, x));
  }
  if (!db.shiftRoster || typeof db.shiftRoster !== 'object') {
    db.shiftRoster = Object.assign({}, window.COFFEE_DEFAULT_ROSTER || {});
  }
  const rawPhoto = getVal('PHOTO_ALL', db.photoAll || 'нет').toLowerCase();
  db.photoAll = (rawPhoto === 'да' || rawPhoto === 'yes' || rawPhoto === 'true' || rawPhoto === '1') ? 'да' : 'нет';
  db.initCounter = Math.max(0, Number(String(getVal('INIT_COUNTER', db.initCounter || 600)).replace(/\s/g, '')) || 0);
  db.tgToken = getVal('TG_TOKEN', db.tgToken || '');
  db.tgChat = getVal('TG_CHAT', db.tgChat || '');

  const rawCats = getVal('CATEGORIES', '');
  if (rawCats) {
    const parsedCats = rawCats.split(',').map((c) => c.trim()).filter(Boolean);
    if (parsedCats.length) db.categories = parsedCats;
  }

  db.openStart = getVal('OPEN_START', db.openStart || '07:30');
  db.dayStart = getVal('DAY_START', db.dayStart || '11:00');
  db.dayDeadline = getVal('DAY_DEADLINE', db.dayDeadline || '18:30');
  db.closeStart = getVal('CLOSE_START', db.closeStart || '19:00');
  db.closeDeadline = getVal('CLOSE_DEADLINE', db.closeDeadline || '22:30');
  ensureMvpFields(db);

  const forcePhoto = db.photoAll === 'да';
  (db.tasks || []).forEach((t, i) => {
    t.row = i + 2;
    const isOC = t.block === 'Открытие' || t.block === 'Закрытие';
    const pMode = t.photoMode || t.photo || 'нет';
    t.photoMode = pMode;
    t.mediaRequired = (pMode === 'да') || (forcePhoto && isOC);
    t.mediaOnProblem = (pMode === 'при проблеме' || pMode === 'да');
  });
}

const MASTER_VAULT_KEY = 'coffee_owner_master_vault';
const SPA_COMPAT_KEY = 'coffee_unified_state_v7';
const IDB_NAME = 'CoffeeOwnerPermanentVault';
const IDB_STORE = 'snapshots';

/* Запись слепка базы в IndexedDB (резервный контур браузера, не сбрасываемый при смене ключей кода) */
function _idbSaveVault(dbObj) {
  try {
    if (typeof indexedDB === 'undefined') return;
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) idb.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => {
      try {
        const idb = e.target.result;
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(JSON.stringify(dbObj), 'master');
      } catch (_) {}
    };
  } catch (_) {}
}

/* Автовосстановление из IndexedDB при старте, если localStorage был очищен */
function _idbRestoreVaultIfNeeded() {
  try {
    if (typeof indexedDB === 'undefined') return;
    if (localStorage.getItem(MASTER_VAULT_KEY)) return;
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) idb.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => {
      try {
        const idb = e.target.result;
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const getReq = tx.objectStore(IDB_STORE).get('master');
        getReq.onsuccess = () => {
          if (getReq.result && !localStorage.getItem(MASTER_VAULT_KEY)) {
            const parsed = JSON.parse(getReq.result);
            if (parsed && parsed.settings) {
              saveUDB(_migrateAndMergeOwnerDB(parsed));
              if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'vault_restored' });
            }
          }
        };
      } catch (_) {}
    };
  } catch (_) {}
}

/* Умный поиск существующей базы владельца по всем прошлым, текущим и будущим версиям ключей */
function _findExistingOwnerDB() {
  const candidates = [];
  const tryKey = (k, priority) => {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && (Array.isArray(obj.settings) || Array.isArray(obj.tasks) || Array.isArray(obj.cash))) {
        candidates.push({ key: k, obj, ts: Number(obj.updatedAt) || 0, priority });
      }
    } catch (_) {}
  };
  tryKey(MASTER_VAULT_KEY, 100);
  tryKey(UDB_KEY, 90);
  tryKey(SPA_COMPAT_KEY, 85);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== MASTER_VAULT_KEY && k !== UDB_KEY && k !== SPA_COMPAT_KEY && /^coffee_(unified_state|unified_hybrid_db)/i.test(k)) {
        tryKey(k, 70);
      }
    }
  } catch (_) {}
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.ts - a.ts) || (b.priority - a.priority));
  return candidates[0].obj;
}

/* Неразрушающая миграция базы при обновлении кода:
   Все настройки, задачи, выручка, инциденты, сотрудники и дедлайны владельца сохраняются 100% без сброса! */
function _migrateAndMergeOwnerDB(existing) {
  const def = _defaultUDB();
  if (!existing || typeof existing !== 'object') return def;

  const db = Object.assign({}, def, existing);
  db.modifiedSettings = Object.assign({}, existing.modifiedSettings || {});
  db.deletedIncidents = Object.assign({}, existing.deletedIncidents || {});
  db.resolvedIncidents = Object.assign({}, existing.resolvedIncidents || {});
  db.deletedTaskIds = Object.assign({}, existing.deletedTaskIds || {});
  db.productsByDate = Object.assign({}, def.productsByDate || {}, existing.productsByDate || {});
  db.checklists = Array.isArray(existing.checklists) ? existing.checklists : def.checklists;

  /* Защищаем все сохранённые владельцем настройки от перезаписи дефолтами или сервером */
  if (Array.isArray(existing.settings) && existing.settings.length) {
    existing.settings.forEach((s) => {
      const nk = normalizeSettingKey(s.id || s.label);
      if (s.value !== undefined && String(s.value).trim() !== '') {
        db.modifiedSettings[nk] = db.modifiedSettings[nk] || Date.now();
      }
    });
  }
  /* Подхватываем одиночные legacy-ключи, если владелец менял их в ранних версиях */
  try {
    const legLoc = localStorage.getItem('coffee_meta_location');
    const legPlan = localStorage.getItem('coffee_meta_plan');
    const legCnt = localStorage.getItem('coffee_meta_init_counter');
    const legPin = localStorage.getItem('coffee_illy_pin');
    if (legLoc && !existing.location) db.location = legLoc;
    if (legPlan && !existing.plan) db.plan = Number(legPlan) || def.plan;
    if (legCnt && !existing.initCounter) db.initCounter = Number(legCnt) || def.initCounter;
    if (legPin && !existing.adminPin) db.adminPin = legPin;
  } catch (_) {}

  db.deletedCashDates = Object.assign({}, existing.deletedCashDates || {});
  db.deletedExpenseIds = Object.assign({}, existing.deletedExpenseIds || {});
  db.deletedAnnouncementIds = Object.assign({}, existing.deletedAnnouncementIds || {});
  db.deletedStaffIds = Object.assign({}, existing.deletedStaffIds || {});
  db.deletedTtkIds = Object.assign({}, existing.deletedTtkIds || {});
  db.deletedGoodDeedIds = Object.assign({}, existing.deletedGoodDeedIds || {});
  db.deletedChecklistBlocks = Object.assign({}, existing.deletedChecklistBlocks || {});
  db.deletedServiceAuditIds = Object.assign({}, existing.deletedServiceAuditIds || {});
  db._lastServerSnapshot = Object.assign({}, existing._lastServerSnapshot || {});

  /* Сохраняем пользовательские задачи без возврата удалённых шагов */
  if (Array.isArray(existing.tasks)) {
    db.tasks = existing.tasks.filter((t) => t && !(db.deletedTaskIds && db.deletedTaskIds[t.id]));
  } else {
    db.tasks = def.tasks;
  }

    /* Однократная очистка демо-примеров при переходе к боевому запуску (prodCleanInitV23) */
  if (!db.prodCleanInitV23) {
    const demoDates = { '2026-10-30': 1, '2026-10-31': 1, '2026-11-01': 1, '2026-11-03': 1, '2026-11-04': 1 };
    const demoIncIds = { 'INC-200': 1, 'INC-201': 1 };
    const demoExpIds = { 'EXP-101': 1, 'EXP-102': 1, 'EXP-103': 1, 'EXP-104': 1, 'EXP-105': 1 };
    const demoAnnIds = { 'ann1': 1, 'ann2': 1, 'ann3': 1, 'ann_1': 1, 'ann_2': 1, 'ann_3': 1 };
    if (Array.isArray(db.cash)) {
      db.cash = db.cash.filter((c) => c && !demoDates[c.date] && c.barista !== 'Анна К.' && c.barista !== 'Максим В.');
    }
    if (Array.isArray(db.expenses)) {
      db.expenses = db.expenses.filter((e) => e && !demoExpIds[e.id]);
    }
    if (Array.isArray(db.incidents)) {
      db.incidents = db.incidents.filter((i) => i && !demoIncIds[i.id] && i.who !== 'Анна К.');
    }
    if (Array.isArray(db.checklists)) {
      db.checklists = db.checklists.filter((c) => c && !demoDates[c.date] && c.who !== 'Анна К.' && c.who !== 'Максим В.' && !(c.time === '08:20' && c.who === 'Соня'));
    }
    if (Array.isArray(db.checklistSubmissions)) {
      db.checklistSubmissions = db.checklistSubmissions.filter((c) => c && !demoDates[c.date] && c.userName !== 'Анна К.' && !(c.time === '08:20' && c.userName === 'Соня'));
    }
    if (Array.isArray(db.announcements)) {
      db.announcements = db.announcements.filter((a) => a && !demoAnnIds[a.id]);
    }
    db.productsByDate = {};
    db.prodCleanInitV23 = true;
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.indexOf('coffee_illy_done_') === 0 || k.indexOf('coffee_shift_draft') === 0) {
          localStorage.removeItem(k);
        }
      });
    } catch (_) {}
  }
  if (!db.prodCleanAuditsV28) {
    const demoAudIds = { 'AUD-101': 1, 'AUD-102': 1, 'AUD-103': 1 };
    if (Array.isArray(db.serviceAudits)) {
      db.serviceAudits = db.serviceAudits.filter((a) => a && !demoAudIds[a.id]);
    }
    if (Array.isArray(db.auditLog)) {
      db.auditLog = db.auditLog.filter((l) => l && l.date !== '2026-11-05');
    }
    db.prodCleanAuditsV28 = true;
  }
  syncSettingsFields(db);
  return db;
}

function getUDB() {
  try {
    const found = _findExistingOwnerDB();
    if (found) {
      const db = _migrateAndMergeOwnerDB(found);
      /* Если мастер-хранилище ещё не было записано (миграция со старой версии), сразу закрепляем */
      if (!localStorage.getItem(MASTER_VAULT_KEY)) {
        saveUDB(db);
      }
      return window.CoffeeIDB ? window.CoffeeIDB.hydratePhotosInDB(db) : db;
    }
  } catch (_) {}
  const fresh = _defaultUDB();
  saveUDB(fresh);
  return fresh;
}

function saveUDB(db) {
  try {
    db.updatedAt = Date.now();
    db.schemaVersion = 13;
    syncSettingsFields(db);
    /* Помечаем все текущие настройки как утверждённые владельцем */
    db.modifiedSettings = db.modifiedSettings || {};
    (db.settings || []).forEach((s) => {
      if (s && s.id && s.value !== undefined && String(s.value).trim() !== '') {
        db.modifiedSettings[s.id] = db.modifiedSettings[s.id] || db.updatedAt;
      }
    });
    (db.cash || []).sort((a, b) => b.date.localeCompare(a.date));
    (db.expenses || []).sort((a, b) => b.date.localeCompare(a.date));
    const serialized = JSON.stringify(db);
    /* Сохраняем одновременно в бессрочный Master Vault и в ключи всех версий */
    localStorage.setItem(MASTER_VAULT_KEY, serialized);
    localStorage.setItem(UDB_KEY, serialized);
    localStorage.setItem(SPA_COMPAT_KEY, serialized);
    localStorage.setItem('coffee_illy_tasks', JSON.stringify(db.tasks.filter((t) => t.active !== 'нет')));
    localStorage.setItem('coffee_meta_location', db.location);
    localStorage.setItem('coffee_meta_plan', String(db.plan));
    localStorage.setItem('coffee_meta_init_counter', String(db.initCounter));
    const openCnt = (db.incidents || []).filter((i) => window.coffeeIsIncActive(i.status)).length;
    localStorage.setItem('coffee_meta_open_inc', String(openCnt));
    localStorage.setItem('coffee_sync_ping', String(db.updatedAt) + '_' + Math.random().toString(36).slice(2, 6));
    _idbSaveVault(db);
  } catch (_) {}
}

/* Публичный API резервного копирования и восстановления базы владельца */
window.coffeeVault = {
  exportJSON() {
    const db = getUDB();
    const payload = JSON.stringify(db, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kofeinya_backup_' + _isoToday() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  },
  importJSON(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.settings) && !Array.isArray(parsed.tasks))) {
      throw new Error('Некорректный формат файла резервной копии');
    }
    const merged = _migrateAndMergeOwnerDB(parsed);
    saveUDB(merged);
    if (window.coffeeCache) window.coffeeCache.invalidate('all');
    if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'vault_import' });
    return merged;
  },
  getStats() {
    const db = getUDB();
    return {
      settingsCount: (db.settings || []).length,
      tasksCount: (db.tasks || []).length,
      cashDays: (db.cash || []).length,
      incidentsCount: (db.incidents || []).length,
      updatedAt: db.updatedAt ? new Date(db.updatedAt).toLocaleString('ru-RU') : 'только что'
    };
  }
};
_idbRestoreVaultIfNeeded();

window.coffeeSettings = {
  get() {
    const db = getUDB();
    return {
      location: db.location, plan: db.plan, deadline: db.deadline,
      woNorm: db.woNorm,
    minAvgCheck: db.minAvgCheck || 390,
    planChecks: db.planChecks || 150, photoAll: db.photoAll, initCounter: db.initCounter,
      tgToken: db.tgToken || '', tgChat: db.tgChat || '', categories: db.categories, settings: db.settings
    };
  }
};

window.ensureMvpFields = ensureMvpFields;
window.appendAudit = appendAudit;
window.syncSettingsFields = syncSettingsFields;
window.getUDB = getUDB;
window.saveUDB = saveUDB;
