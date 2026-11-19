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
    if (typeof str !== 'string' || str.length < 2048 || !/^data:(image|video)\//i.test(str)) return str;
    const hash = (window.coffeeSha256Sync ? window.coffeeSha256Sync(str.slice(0, 512) + str.length) : String(str.length)).slice(0, 20);
    const ref = 'idb://photo/' + hash;
    _photoMemCache[ref] = str;
    put('photos', ref, str);
    return ref;
  }

  function resolvePhotoString(str) {
    if (typeof str === 'string' && str.startsWith('idb://photo/')) {
      if (_photoMemCache[str]) return _photoMemCache[str];
      get('photos', str).then((val) => {
        if (val) {
          _photoMemCache[str] = val;
          if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'idb_photo_hydrated' });
        }
      }).catch(() => {});
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


const HISTORICAL_SHEET_CASH = [{"date": "2026-10-17", "cash": 1622, "card": 896, "checks": 73, "writeoff": 0, "writeoffShots": 0, "topItems": "", "barista": "Daniil", "counterStart": null, "counterEnd": null, "coffeeQty": 0, "nonCoffeeQty": 0, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Daniil", "cash": 1622, "card": 896, "checks": 73, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 73, "coffeeQty": 0}], "products": []}, {"date": "2026-10-30", "cash": 1717, "card": 585, "checks": 82, "writeoff": 0, "writeoffShots": 0, "topItems": "Американо ×38, Капучино ×23, Латте (мал) ×12", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 87, "nonCoffeeQty": 11, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 1717, "card": 585, "checks": 82, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 87, "coffeeQty": 87}], "products": [{"name": "Американо", "kind": "coffee", "price": 12, "qty": 38, "sum": 456, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Капучино", "kind": "coffee", "price": 19, "qty": 23, "sum": 437, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Латте (мал)", "kind": "coffee", "price": 20, "qty": 12, "sum": 240, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Эспрессо", "kind": "coffee", "price": 12, "qty": 11, "sum": 132, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15", "kind": "non_coffee", "price": 15, "qty": 5, "sum": 75, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 3, "sum": 51, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Кофе по турецки", "kind": "coffee", "price": 18, "qty": 3, "sum": 54, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Меренговый рулет", "kind": "non_coffee", "price": 40, "qty": 3, "sum": 120, "date": "2026-10-30", "barista": "Бариста"}]}, {"date": "2026-10-31", "cash": 1313, "card": 710, "checks": 53, "writeoff": 0, "writeoffShots": 0, "topItems": "Американо шт ×22, Капучино шт ×16, Латте (мал) шт ×11", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 59, "nonCoffeeQty": 13, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 1313, "card": 710, "checks": 53, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 59, "coffeeQty": 59}], "products": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 22, "sum": 264, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 16, "sum": 304, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 11, "sum": 220, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Чизкейк шт", "kind": "non_coffee", "price": 40, "qty": 6, "sum": 240, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Чай Ягодный микс 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Какао (ср) шт", "kind": "coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 3, "sum": 51, "date": "2026-10-31", "barista": "Бариста"}]}, {"date": "2026-11-01", "cash": 1475, "card": 459, "checks": 60, "writeoff": 0, "writeoffShots": 0, "topItems": "Американо шт ×28, Капучино шт ×16, Латте (мал) шт ×8", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 58, "nonCoffeeQty": 18, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 1475, "card": 459, "checks": 60, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 58, "coffeeQty": 58}], "products": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 28, "sum": 336, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 16, "sum": 304, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 8, "sum": 160, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Ягодный / фруктовый чай ... 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 7, "sum": 140, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 5, "sum": 85, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15 шт", "kind": "non_coffee", "price": 15, "qty": 3, "sum": 45, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Шоколад 10 руб шт", "kind": "non_coffee", "price": 10, "qty": 3, "sum": 30, "date": "2026-11-01", "barista": "Бариста"}]}, {"date": "2026-11-02", "cash": 1814, "card": 421, "checks": 79, "writeoff": 6, "writeoffShots": 0, "topItems": "Американо шт ×45, Капучино шт ×20, Латте (бол) шт ×6", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 80, "nonCoffeeQty": 12, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 1814, "card": 421, "checks": 79, "writeoff": 6, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 80, "coffeeQty": 80}], "products": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 45, "sum": 540, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 20, "sum": 380, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 5, "sum": 100, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 4, "sum": 48, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Напитки (кола, спрайт, фанта) бут", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Ягодный / фруктовый чай ... 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15 шт", "kind": "non_coffee", "price": 15, "qty": 4, "sum": 60, "date": "2026-11-02", "barista": "Бариста"}]}, {"date": "2026-11-03", "cash": 644, "card": 201, "checks": 31, "writeoff": 0, "writeoffShots": 0, "topItems": "Американо шт ×13, Капучино шт ×6, Латте (мал) шт ×4", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 26, "nonCoffeeQty": 9, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 644, "card": 201, "checks": 31, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 26, "coffeeQty": 26}], "products": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 13, "sum": 156, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 6, "sum": 114, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 3, "sum": 36, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Облепиховый чай 400 мл. шт", "kind": "non_coffee", "price": 25, "qty": 3, "sum": 75, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Напитки (кола, спрайт, фанта) бут", "kind": "non_coffee", "price": 20, "qty": 2, "sum": 40, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Фрукты шт", "kind": "non_coffee", "price": 5, "qty": 2, "sum": 10, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Малиново - имбирный чай 800 мл. шт", "kind": "non_coffee", "price": 45, "qty": 2, "sum": 90, "date": "2026-11-03", "barista": "Бариста"}]}, {"date": "2026-11-04", "cash": 1450, "card": 237, "checks": 47, "writeoff": 0, "writeoffShots": 0, "topItems": "Американо шт ×21, Капучино шт ×14, Чизкейк шт ×7", "barista": "Бариста", "counterStart": null, "counterEnd": null, "coffeeQty": 47, "nonCoffeeQty": 15, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Бариста", "cash": 1450, "card": 237, "checks": 47, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 47, "coffeeQty": 47}], "products": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 21, "sum": 252, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 14, "sum": 266, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Чизкейк шт", "kind": "non_coffee", "price": 40, "qty": 7, "sum": 280, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Напиток от Бариста шт", "kind": "non_coffee", "price": 1, "qty": 5, "sum": 5, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Какао (ср) шт", "kind": "coffee", "price": 20, "qty": 5, "sum": 100, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 4, "sum": 48, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 3, "sum": 60, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Облепиховый чай 400 мл. шт", "kind": "non_coffee", "price": 25, "qty": 3, "sum": 75, "date": "2026-11-04", "barista": "Бариста"}]}, {"date": "2026-11-12", "cash": 1299, "card": 0, "checks": 37, "writeoff": 0, "writeoffShots": 0, "topItems": "", "barista": "Соня", "counterStart": null, "counterEnd": null, "coffeeQty": 0, "nonCoffeeQty": 0, "reviewQty": 0, "unaccountedShots": 0, "csvHashes": [], "shifts": [{"name": "Соня", "cash": 1299, "card": 0, "checks": 37, "writeoff": 0, "writeoffShots": 0, "prevCounter": null, "counter": null, "cups": 37, "coffeeQty": 0}], "products": []}, {"date": "2026-11-13", "cash": 1000, "card": 0, "checks": 980, "writeoff": 0, "writeoffShots": 0, "topItems": "", "barista": "Соня", "counterStart": 600, "counterEnd": 580, "coffeeQty": 0, "nonCoffeeQty": 0, "reviewQty": 0, "unaccountedShots": 980, "csvHashes": [], "shifts": [{"name": "Соня", "cash": 1000, "card": 0, "checks": 980, "writeoff": 0, "writeoffShots": 0, "prevCounter": 600, "counter": 580, "cups": 980, "coffeeQty": 0}], "products": []}];
const HISTORICAL_SHEET_EXPENSES = [{"id": "#1", "date": "2026-11-06", "category": "Закупка продуктов", "amount": 150, "comment": "молоко в магазине"}, {"id": "#2", "date": "2026-11-07", "category": "Зарплата", "amount": 200, "comment": "Соня"}, {"id": "#3", "date": "2026-11-11", "category": "Закупка продуктов", "amount": 200, "comment": ""}];
const HISTORICAL_PRODUCTS_BY_DATE = {"2026-10-30": [{"name": "Американо", "kind": "coffee", "price": 12, "qty": 38, "sum": 456, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Капучино", "kind": "coffee", "price": 19, "qty": 23, "sum": 437, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Латте (мал)", "kind": "coffee", "price": 20, "qty": 12, "sum": 240, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Эспрессо", "kind": "coffee", "price": 12, "qty": 11, "sum": 132, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15", "kind": "non_coffee", "price": 15, "qty": 5, "sum": 75, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 3, "sum": 51, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Кофе по турецки", "kind": "coffee", "price": 18, "qty": 3, "sum": 54, "date": "2026-10-30", "barista": "Бариста"}, {"name": "Меренговый рулет", "kind": "non_coffee", "price": 40, "qty": 3, "sum": 120, "date": "2026-10-30", "barista": "Бариста"}], "2026-10-31": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 22, "sum": 264, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 16, "sum": 304, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 11, "sum": 220, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Чизкейк шт", "kind": "non_coffee", "price": 40, "qty": 6, "sum": 240, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Чай Ягодный микс 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Какао (ср) шт", "kind": "coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-10-31", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 3, "sum": 51, "date": "2026-10-31", "barista": "Бариста"}], "2026-11-01": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 28, "sum": 336, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 16, "sum": 304, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 8, "sum": 160, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Ягодный / фруктовый чай ... 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 7, "sum": 140, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Длинный черный", "kind": "non_coffee", "price": 17, "qty": 5, "sum": 85, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15 шт", "kind": "non_coffee", "price": 15, "qty": 3, "sum": 45, "date": "2026-11-01", "barista": "Бариста"}, {"name": "Шоколад 10 руб шт", "kind": "non_coffee", "price": 10, "qty": 3, "sum": 30, "date": "2026-11-01", "barista": "Бариста"}], "2026-11-02": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 45, "sum": 540, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 20, "sum": 380, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Латте (бол) шт", "kind": "coffee", "price": 25, "qty": 6, "sum": 150, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 5, "sum": 100, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 4, "sum": 48, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Напитки (кола, спрайт, фанта) бут", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Ягодный / фруктовый чай ... 400 мл. шт", "kind": "non_coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-02", "barista": "Бариста"}, {"name": "Чай в ассоортименте 15 шт", "kind": "non_coffee", "price": 15, "qty": 4, "sum": 60, "date": "2026-11-02", "barista": "Бариста"}], "2026-11-04": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 21, "sum": 252, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 14, "sum": 266, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Чизкейк шт", "kind": "non_coffee", "price": 40, "qty": 7, "sum": 280, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Напиток от Бариста шт", "kind": "non_coffee", "price": 1, "qty": 5, "sum": 5, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Какао (ср) шт", "kind": "coffee", "price": 20, "qty": 5, "sum": 100, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 4, "sum": 48, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 3, "sum": 60, "date": "2026-11-04", "barista": "Бариста"}, {"name": "Облепиховый чай 400 мл. шт", "kind": "non_coffee", "price": 25, "qty": 3, "sum": 75, "date": "2026-11-04", "barista": "Бариста"}], "2026-11-03": [{"name": "Американо шт", "kind": "coffee", "price": 12, "qty": 13, "sum": 156, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Капучино шт", "kind": "coffee", "price": 19, "qty": 6, "sum": 114, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Латте (мал) шт", "kind": "coffee", "price": 20, "qty": 4, "sum": 80, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Эспрессо шт", "kind": "coffee", "price": 12, "qty": 3, "sum": 36, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Облепиховый чай 400 мл. шт", "kind": "non_coffee", "price": 25, "qty": 3, "sum": 75, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Напитки (кола, спрайт, фанта) бут", "kind": "non_coffee", "price": 20, "qty": 2, "sum": 40, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Фрукты шт", "kind": "non_coffee", "price": 5, "qty": 2, "sum": 10, "date": "2026-11-03", "barista": "Бариста"}, {"name": "Малиново - имбирный чай 800 мл. шт", "kind": "non_coffee", "price": 45, "qty": 2, "sum": 90, "date": "2026-11-03", "barista": "Бариста"}]};

function seedHistoricalSheetFinance(db) {
  if (!db || typeof db !== 'object') return;
  if (typeof process !== 'undefined' && process.versions && process.versions.node) return;
  if (typeof navigator !== 'undefined' && /jsdom|node/i.test(navigator.userAgent || '')) return;
  if (db._sheetFinanceSeededV88) return;
  db._sheetFinanceSeededV88 = true;
  db.cash = Array.isArray(db.cash) ? db.cash : [];
  db.expenses = Array.isArray(db.expenses) ? db.expenses : [];
  db.productsByDate = (db.productsByDate && typeof db.productsByDate === 'object') ? db.productsByDate : {};
  const delCash = db.deletedCashDates || {};
  const delExp = db.deletedExpenseIds || {};
  HISTORICAL_SHEET_CASH.forEach((hc) => {
    if (!hc || !hc.date || delCash[hc.date]) return;
    if (!db.cash.some((x) => x && x.date === hc.date)) {
      db.cash.push(Object.assign({}, hc));
    }
  });
  db.cash.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  HISTORICAL_SHEET_EXPENSES.forEach((he) => {
    if (!he || !he.id || delExp[he.id]) return;
    if (!db.expenses.some((x) => x && (x.id === he.id || (x.date === he.date && x.category === he.category && Number(x.amount) === Number(he.amount))))) {
      db.expenses.push(Object.assign({}, he));
    }
  });
  Object.keys(HISTORICAL_PRODUCTS_BY_DATE).forEach((dKey) => {
    if (!db.productsByDate[dKey] || !db.productsByDate[dKey].length) {
      db.productsByDate[dKey] = HISTORICAL_PRODUCTS_BY_DATE[dKey].map((p) => Object.assign({}, p));
    }
  });
}

function ensureMvpFields(db) {
  seedHistoricalSheetFinance(db);
  if (db && window.coffeeCleanTime) {
    if (Array.isArray(db.incidents)) {
      db.incidents.forEach((inc) => {
        if (!inc) return;
        if (inc.time) inc.time = window.coffeeCleanTime(inc.time);
        if (Array.isArray(inc.history)) {
          inc.history.forEach((h) => { if (h && h.time) h.time = window.coffeeCleanTime(h.time); });
        }
      });
    }
    if (Array.isArray(db.checklists)) {
      db.checklists.forEach((chk) => {
        if (!chk) return;
        if (chk.time) chk.time = window.coffeeCleanTime(chk.time);
        if (chk.startedAt) chk.startedAt = window.coffeeCleanTime(chk.startedAt);
      });
    }
  }
  const t = _isoToday();
  if (!Array.isArray(db.staff)) {
    db.staff = window.COFFEE_MVP.DEFAULT_STAFF.map((x) => Object.assign({}, x));
  } else {
    db.staff = db.staff.filter((s) => s && !/^(администратор|владелец)$/i.test(String(s.name || '').trim()));
  }
  if (!Array.isArray(db.announcements)) {
    db.announcements = window.COFFEE_MVP.DEFAULT_ANNOUNCEMENTS(t);
  }
  db.deadlineExtensions = db.deadlineExtensions || {};
  if (!Array.isArray(db.inventory) || !db.inventory.length) {
    db.inventory = (window.COFFEE_DEFAULT_INVENTORY || []).map((x) => Object.assign({}, x));
  }
  db.inventoryDeductedKeys = (db.inventoryDeductedKeys && typeof db.inventoryDeductedKeys === 'object') ? db.inventoryDeductedKeys : {};
  db.customNomenclatureRules = (db.customNomenclatureRules && typeof db.customNomenclatureRules === 'object') ? db.customNomenclatureRules : {};
  if (!Array.isArray(db.expiryItems)) db.expiryItems = [];
  if (!Array.isArray(db.shops) || !db.shops.length) {
    db.shops = (window.COFFEE_DEFAULT_SHOPS || [{ id: 'shop_1', name: db.location || 'Кофейня №1', plan: db.plan || 2500, initCounter: db.initCounter || 600, active: true }]).map((x) => Object.assign({}, x));
  }
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

let _memVaultFallback = null;
function getUDB() {
  try {
    const found = _findExistingOwnerDB();
    if (found) {
      const db = _migrateAndMergeOwnerDB(found);
      _memVaultFallback = db;
      /* Если мастер-хранилище ещё не было записано (миграция со старой версии), сразу закрепляем */
      if (!localStorage.getItem(MASTER_VAULT_KEY)) {
        saveUDB(db);
      }
      return window.CoffeeIDB ? window.CoffeeIDB.hydratePhotosInDB(db) : db;
    }
  } catch (_) {}
  if (_memVaultFallback) {
    return window.CoffeeIDB ? window.CoffeeIDB.hydratePhotosInDB(_memVaultFallback) : _memVaultFallback;
  }
  const fresh = _defaultUDB();
  _memVaultFallback = fresh;
  saveUDB(fresh);
  return fresh;
}


window.coffeeDeduplicateDB = function (db) {
  if (!db || typeof db !== 'object') return db;
  function dedupBy(arr, keyFn) {
    if (!Array.isArray(arr)) return [];
    const seen = new Map();
    arr.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const k = String(keyFn(item) || '').trim();
      if (!k) return;
      const prev = seen.get(k);
      if (!prev || Number(item.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
        seen.set(k, item);
      }
    });
    return Array.from(seen.values());
  }
  if (Array.isArray(db.tasks)) db.tasks = dedupBy(db.tasks, (t) => t.id || (t.block + '|' + t.title));
  if (Array.isArray(db.checklistBlocks)) db.checklistBlocks = dedupBy(db.checklistBlocks, (b) => b.name);
  if (Array.isArray(db.cash)) db.cash = dedupBy(db.cash, (c) => c.date);
  if (Array.isArray(db.checklists)) db.checklists = dedupBy(db.checklists, (c) => c.sid || (c.date + '|' + c.block + '|' + (c.who || '')));
  if (Array.isArray(db.incidents)) {
    db.incidents = dedupBy(db.incidents, (i) => i.id);
    // Also remove exact content duplicates created on the same day & step
    const sigSeen = new Set();
    db.incidents = db.incidents.filter((i) => {
      const sig = String(i.date || '') + '|' + String(i.block || '') + '|' + String(i.step || '') + '|' + String(i.text || '').trim();
      if (sigSeen.has(sig)) return false;
      sigSeen.add(sig);
      return true;
    });
  }
  if (Array.isArray(db.expenses)) db.expenses = dedupBy(db.expenses, (e) => e.id);
  if (Array.isArray(db.goodDeeds)) db.goodDeeds = dedupBy(db.goodDeeds, (g) => g.id || g.title);
  if (Array.isArray(db.ttk)) db.ttk = dedupBy(db.ttk, (t) => t.id || t.name);
  if (Array.isArray(db.staff)) db.staff = dedupBy(db.staff, (s) => String(s.name || s.id || '').toLowerCase());
  if (Array.isArray(db.announcements)) db.announcements = dedupBy(db.announcements, (a) => a.id);
  if (Array.isArray(db.serviceAudits)) db.serviceAudits = dedupBy(db.serviceAudits, (a) => a.id);
  if (Array.isArray(db.auditLog)) {
    const aSeen = new Set();
    db.auditLog = db.auditLog.filter((l) => {
      if (!l) return false;
      const k = String(l.date || '') + '|' + String(l.time || '') + '|' + String(l.actor || '') + '|' + String(l.action || '') + '|' + String(l.details || '');
      if (aSeen.has(k)) return false;
      aSeen.add(k);
      return true;
    }).slice(0, 250);
  }
  return db;
};

let _lastSavedVaultSig = '';
let _lastSavedVaultAt = 0;
function saveUDB(db) {
  if (db && typeof db === "object") _memVaultFallback = db;
  try {
    if (window.coffeeDeduplicateDB) window.coffeeDeduplicateDB(db);
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
    const prevUpd = db.updatedAt;
    const prevSnap = db._lastServerSnapshot;
    const prevAct = db._currentAbsorbAct;
    db.updatedAt = 0;
    delete db._lastServerSnapshot;
    delete db._currentAbsorbAct;
    const sig = JSON.stringify(db);
    if (prevSnap) db._lastServerSnapshot = prevSnap;
    if (prevAct) db._currentAbsorbAct = prevAct;
    const nowMs = Date.now();
    if (sig === _lastSavedVaultSig && (nowMs - _lastSavedVaultAt < 2000)) {
      db.updatedAt = prevUpd || nowMs;
      return;
    }
    _lastSavedVaultSig = sig;
    _lastSavedVaultAt = nowMs;
    db.updatedAt = nowMs;
    const serialized = JSON.stringify(db);
    /* Сохраняем одновременно в бессрочный Master Vault и в ключи всех версий (с защитой от QuotaExceededError через IndexedDB) */
    let toStore = serialized;
    if (toStore.length > 1800000 && window.CoffeeIDB && typeof window.CoffeeIDB.offloadPhotosFromDB === 'function') {
      toStore = JSON.stringify(window.CoffeeIDB.offloadPhotosFromDB(db));
    }
    try {
      localStorage.setItem(MASTER_VAULT_KEY, toStore);
      localStorage.setItem(UDB_KEY, toStore);
      localStorage.setItem(SPA_COMPAT_KEY, toStore);
    } catch (qErr) {
      if (window.CoffeeIDB && typeof window.CoffeeIDB.offloadPhotosFromDB === 'function') {
        const slim = JSON.stringify(window.CoffeeIDB.offloadPhotosFromDB(db));
        try {
          localStorage.setItem(MASTER_VAULT_KEY, slim);
          localStorage.setItem(UDB_KEY, slim);
          localStorage.setItem(SPA_COMPAT_KEY, slim);
        } catch (_) {}
      }
    }
    localStorage.setItem('coffee_illy_tasks', JSON.stringify(db.tasks.filter((t) => t.active !== 'нет')));
    localStorage.setItem('coffee_meta_location', db.location);
    localStorage.setItem('coffee_meta_plan', String(db.plan));
    localStorage.setItem('coffee_meta_init_counter', String(db.initCounter));
    const openCnt = (db.incidents || []).filter((i) => window.coffeeIsIncActive(i.status)).length;
    localStorage.setItem('coffee_meta_open_inc', String(openCnt));
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
    minAvgCheck: db.minAvgCheck || 35,
    planChecks: db.planChecks || 75, photoAll: db.photoAll, initCounter: db.initCounter,
      tgToken: db.tgToken || '', tgChat: db.tgChat || '', categories: db.categories, settings: db.settings
    };
  }
};

window.ensureMvpFields = ensureMvpFields;
window.appendAudit = appendAudit;
window.syncSettingsFields = syncSettingsFields;
window.getUDB = getUDB;
window.saveUDB = saveUDB;


/* === COFFEE ILLY v71 MASTER DIRECTIVE: ЕДИНЫЙ СПРАВОЧНИК СОТРУДНИКОВ И АВТОМАТИЧЕСКОЕ РЕЗЕРВИРОВАНИЕ === */
(function () {
  const AUTO_BACKUP_KEY = 'coffee_auto_backups_v1';
  let _memBackups = [];

  function _readBackups() {
    try {
      const raw = localStorage.getItem(AUTO_BACKUP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return _memBackups.slice();
  }

  function _writeBackups(list) {
    _memBackups = Array.isArray(list) ? list.slice(0, 7) : [];
    try {
      localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(_memBackups));
    } catch (_) {}
  }

  function _calcChecksum(db) {
    if (!db || typeof db !== 'object') return '0';
    const s = [
      (db.staff || []).length,
      (db.tasks || []).length,
      (db.cash || []).length,
      (db.incidents || []).length,
      (db.ttk || []).length,
      (db.inventory || []).length,
      (db.expenses || []).length
    ].join('-');
    return 'chk_' + s;
  }

  // Главное правило Раздела 6: Один справочник сотрудников — один источник истины
  window.coffeeSyncStaffDirectory = function (dbOpt) {
    try {
      const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : null);
      if (!db || typeof db !== 'object') return [];
      const staffList = Array.isArray(db.staff) ? db.staff : [];
      const activeNames = [];
      staffList.forEach((s) => {
        if (s && s.name && s.active !== 'нет') {
          const nm = String(s.name).trim();
          if (nm && activeNames.indexOf(nm) < 0) activeNames.push(nm);
        }
      });
      if (!activeNames.length) {
        ['Соня', 'Алина', 'Настя', 'Максим'].forEach((n) => activeNames.push(n));
      }

      // Синхронизируем DOM-селекторы сотрудников в Терминале и модальном окне входа
      if (typeof document !== 'undefined') {
        ['baristaSelect', 'staffPinUserSelect'].forEach((selId) => {
          const sel = document.getElementById(selId);
          if (!sel) return;
          const curVal = sel.value;
          const isPinModal = selId === 'staffPinUserSelect';
          sel.innerHTML = activeNames.map((nm) => (
            '<option value="' + (window.escapeHtml ? window.escapeHtml(nm) : nm) + '">' + (isPinModal ? '👤 ' : '') + (window.escapeHtml ? window.escapeHtml(nm) : nm) + '</option>'
          )).join('');
          if (curVal && activeNames.indexOf(curVal) >= 0) sel.value = curVal;
        });
      }
      return activeNames;
    } catch (_) {
      return ['Соня', 'Алина', 'Настя', 'Максим'];
    }
  };

  // Этап 12 (Раздел 16): Автоматическая система резервных копий и проверки восстановления
  window.coffeeAutoBackupManager = {
    list() {
      return _readBackups();
    },
    createBackup(reasonOpt) {
      try {
        const db = typeof getUDB === 'function' ? getUDB() : null;
        if (!db) return null;
        const now = new Date();
        const isoDate = now.toISOString().slice(0, 10);
        const hm = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const snap = {
          id: 'bkp_' + Date.now().toString(36),
          date: isoDate,
          time: hm,
          version: (typeof window !== 'undefined' && window.COFFEE_VERSION) || 'v71',
          reason: reasonOpt || 'Ежедневное авто-резервирование',
          checksum: _calcChecksum(db),
          stats: {
            staff: (db.staff || []).length,
            tasks: (db.tasks || []).length,
            cash: (db.cash || []).length,
            incidents: (db.incidents || []).length,
            inventory: (db.inventory || []).length
          },
          payload: JSON.stringify(db)
        };
        const list = _readBackups();
        list.unshift(snap);
        _writeBackups(list.slice(0, 7));
        return snap;
      } catch (_) {
        return null;
      }
    },
    ensureDailyBackup() {
      try {
        const list = _readBackups();
        const today = new Date().toISOString().slice(0, 10);
        if (!list.some((b) => b && b.date === today)) {
          return this.createBackup('Ежедневная автоматическая копия (' + today + ')');
        }
        return list[0];
      } catch (_) {
        return null;
      }
    },
    verifyBackup(backupIdOpt) {
      try {
        const list = _readBackups();
        if (!list.length) {
          const created = this.createBackup('Контрольная точка перед проверкой');
          if (created) list.push(created);
        }
        const target = backupIdOpt ? list.find((b) => b && b.id === backupIdOpt) : list[0];
        if (!target || !target.payload) return { ok: false, error: 'Резервная копия не найдена' };
        const parsed = JSON.parse(target.payload);
        const valid = Array.isArray(parsed.tasks) && Array.isArray(parsed.staff) && Array.isArray(parsed.cash);
        const expectedChk = _calcChecksum(parsed);
        return {
          ok: valid && expectedChk === target.checksum,
          id: target.id,
          date: target.date,
          time: target.time,
          checksum: target.checksum,
          stats: target.stats
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    },
    restoreBackup(backupIdOpt) {
      try {
        const ver = this.verifyBackup(backupIdOpt);
        if (!ver.ok) return ver;
        const list = _readBackups();
        const target = backupIdOpt ? list.find((b) => b && b.id === backupIdOpt) : list[0];
        const parsed = JSON.parse(target.payload);
        parsed.auditLog = Array.isArray(parsed.auditLog) ? parsed.auditLog : [];
        parsed.auditLog.unshift({
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          actor: 'Администратор',
          action: 'Восстановление из авто-бэкапа',
          details: 'Восстановлен снимок ' + target.id + ' от ' + target.date + ' ' + target.time
        });
        if (typeof saveUDB === 'function') saveUDB(parsed);
        if (window.coffeeSyncStaffDirectory) window.coffeeSyncStaffDirectory(parsed);
        return { ok: true, restoredId: target.id, date: target.date, time: target.time };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
  };

  setTimeout(() => {
    try {
      window.coffeeAutoBackupManager.ensureDailyBackup();
      window.coffeeSyncStaffDirectory();
    } catch (_) {}
  }, 80);
})();

/* === ОПЕРАЦИОННЫЕ ФУНКЦИИ ТАЙМЛАЙНА, ОКОН, СХЕМЫ И ФОТООБРАЗЦОВ (ДОСТУПНЫ В ТЕРМИНАЛЕ И ДАШБОРДЕ) === */
window.coffeeCounterDelta = function (prev, cur) {
  if (prev == null || cur == null || prev === '' || cur === '') return null;
  const p = Number(prev), c = Number(cur);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p < 0 || c < 0) return null;
  const pi = Math.round(p), ci = Math.round(c);
  if (window.CoffeeSalesReconciliation && typeof window.CoffeeSalesReconciliation.counterDelta === 'function') {
    const d = window.CoffeeSalesReconciliation.counterDelta(pi, ci, 1000);
    if (d !== null) return d;
  }
  if (pi < 1000 && ci < 1000) {
    return ci >= pi ? (ci - pi) : ((1000 - pi) + ci);
  }
  return ci >= pi ? (ci - pi) : null;
};

window.coffeeExtractNomenclatureStats = function (productsList) {
  const prods = Array.isArray(productsList) ? productsList : [];
  let coffeeQty = 0, nonCoffeeQty = 0, reviewQty = 0;
  prods.forEach((p) => {
    if (!p || !p.name) return;
    const q = Number(p.qty) || 0;
    if (q <= 0) return;
    const kind = p.kind || (window.CoffeeSalesReconciliation && window.CoffeeSalesReconciliation.classifyCoffee
      ? window.CoffeeSalesReconciliation.classifyCoffee(p.name)
      : 'coffee');
    if (kind === 'coffee') coffeeQty += q;
    else if (kind === 'review') reviewQty += q;
    else nonCoffeeQty += q;
  });
  return { coffeeQty, nonCoffeeQty, reviewQty, hasNomenclature: prods.length > 0 };
};

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

window.coffeeNormalizeBlockName = function (block) {
  const s = String(block || '').trim().replace(/\s+/g, ' ');
  const low = s.toLowerCase();
  if (low === 'касса') return 'Касса';
  if (low === 'день') return 'Лайн Чек 1';
  if (low === 'открытие') return 'Открытие';
  if (low === 'закрытие') return 'Закрытие';
  if (low === 'лайн чек 1' || low === 'лайн-чек 1' || low === 'лайнчек 1') return 'Лайн Чек 1';
  if (low === 'лайн чек 2' || low === 'лайн-чек 2' || low === 'лайнчек 2') return 'Лайн Чек 2';
  return s;
};

function _sameIsoDate(dStr, todayIso) {
  const s = String(dStr || '').trim();
  if (!s) return false;
  if (s === todayIso || s.slice(0, 10) === todayIso) return true;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return (m[3] + '-' + m[2] + '-' + m[1]) === todayIso;
  return false;
}

window.coffeeIsBlockCompletedToday = function (block, dbOpt, userNameOpt) {
  const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
  const today = _isoToday();
  const normBlk = window.coffeeNormalizeBlockName(block);
  const normBlkLower = normBlk.toLowerCase();
  const who = String(userNameOpt || '').trim();
  const whoLower = who.toLowerCase();

  const matchesUser = (wStr) => {
    if (!whoLower) return true;
    const raw = String(wStr || '').trim().toLowerCase();
    if (!raw) return true;
    return raw === whoLower || raw.split(',').map((s) => s.trim()).includes(whoLower);
  };
  const matchesBlock = (bStr) => window.coffeeNormalizeBlockName(bStr).toLowerCase() === normBlkLower;

  if (normBlk === 'Касса') {
    const cashRec = (db.cash || []).find((c) => c && _sameIsoDate(c.date, today) && ((Number(c.cash) || 0) + (Number(c.card) || 0) > 0) && matchesUser(c.barista));
    const chkCashRec = (db.checklists || []).find((c) => c && _sameIsoDate(c.date, today) && matchesBlock(c.block) && matchesUser(c.who));
    let lsCash = false;
    try {
      if (who) {
        lsCash = localStorage.getItem('coffee_illy_done_' + today + '_' + who + '_Касса') === '1' ||
                 localStorage.getItem('coffee_illy_done_' + today + '_' + who + '_КАССА') === '1';
      } else {
        lsCash = localStorage.getItem('coffee_illy_done_' + today + '_КАССА') === '1' ||
                 localStorage.getItem('coffee_illy_done_' + today + '_Касса') === '1';
      }
    } catch (_) {}
    return {
      completed: !!cashRec || !!chkCashRec || lsCash,
      record: chkCashRec || (cashRec ? { date: today, block: 'Касса', who: cashRec.barista || who, time: 'сдано' } : null)
    };
  }

  // 1) Ищем запись в db.checklists (сначала по текущему сотруднику, затем по смене)
  const recUser = (db.checklists || []).find((c) => c && _sameIsoDate(c.date, today) && matchesBlock(c.block) && matchesUser(c.who));
  const recShift = recUser || (db.checklists || []).find((c) => c && _sameIsoDate(c.date, today) && matchesBlock(c.block));
  const shiftMap = (db.shiftCompletedBlocksToday && typeof db.shiftCompletedBlocksToday === 'object') ? db.shiftCompletedBlocksToday : null;
  const shiftEntry = shiftMap && (shiftMap[normBlk] || Object.keys(shiftMap).map((k) => matchesBlock(k) ? shiftMap[k] : null).find(Boolean));
  const shiftEntryValid = !!(shiftEntry && (!shiftEntry.date || _sameIsoDate(shiftEntry.date, today)));

  let lsDone = false;
  try {
    if (who) {
      lsDone = localStorage.getItem('coffee_illy_done_' + today + '_' + who + '_' + normBlk) === '1' ||
               localStorage.getItem('coffee_illy_done_' + today + '_' + normBlk) === '1';
    } else {
      lsDone = localStorage.getItem('coffee_illy_done_' + today + '_' + normBlk) === '1';
    }
  } catch (_) {}
  const finalRec = recUser || recShift || (shiftEntryValid ? { date: today, block: normBlk, time: shiftEntry.time || '', status: shiftEntry.status || 'В срок' } : null);
  return {
    completed: !!finalRec || lsDone,
    record: finalRec
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


/* Неразрушающее слияние и авто-восстановление задач чек-листов (v84 — фикс BUG-09):
   Гарантирует, что при редактировании одного пункта (например, в «Лайн Чек 1») или при получении
   неполного списка с сервера (1 изменённая строка из листа «Задачи») все остальные стандартные пункты
   («Открытие», «Лайн Чек 1», «Лайн Чек 2», «Закрытие») сохраняются на 100%, а уже повреждённая база
   автоматически восстанавливает пропавшие блоки с сохранением всех пользовательских правок! */
window.coffeeMergeTasksPreservingDefaults = function (existingTasks, incomingTasks, deletedTaskIdsOpt) {
  const delMap = (deletedTaskIdsOpt && typeof deletedTaskIdsOpt === 'object') ? deletedTaskIdsOpt : {};
  const rawDefaults = (window.COFFEE && Array.isArray(window.COFFEE.DEFAULT_TASKS)) ? window.COFFEE.DEFAULT_TASKS : [];
  const normDefaults = window.coffeeNormalizeTasksTimeline
    ? window.coffeeNormalizeTasksTimeline(rawDefaults.map((t, i) => Object.assign({ row: i + 2 }, t)))
    : rawDefaults.map((t, i) => Object.assign({ row: i + 2 }, t));

  const byId = new Map();
  const orderIds = [];

  function putTask(t, isOverlay) {
    if (!t || typeof t !== 'object') return;
    const id = String(t.id || '').trim();
    if (!id || id === '__SYS_CONFIG_V19__' || t.title === '__SYS_SYNC__') return;
    if (delMap[id]) return;

    const normT = (window.coffeeNormalizeTasksTimeline ? window.coffeeNormalizeTasksTimeline([t])[0] : t) || t;
    const pMode = normT.photoMode || normT.photo || (normT.mediaRequired ? 'да' : 'нет');
    const cleanItem = Object.assign({}, normT, {
      id: id,
      block: normT.block || 'Открытие',
      photo: pMode,
      photoMode: pMode,
      mediaRequired: pMode === 'да',
      active: normT.active || 'да'
    });

    if (byId.has(id)) {
      const prev = byId.get(id);
      byId.set(id, Object.assign({}, prev, cleanItem, { row: cleanItem.row || prev.row }));
    } else {
      byId.set(id, cleanItem);
      orderIds.push(id);
    }
  }

  // 1) Базовый эталонный набор (все 91 стандартных задач Открытия, Лайн Чек 1, Лайн Чек 2, Закрытия, кроме явно удалённых)
  normDefaults.forEach((d) => putTask(d, false));

  // 2) Локальные задачи и правки пользователя
  if (Array.isArray(existingTasks)) {
    existingTasks.forEach((loc) => {
      if (!loc) return;
      // Если у задачи нет стандартного id, но совпадает название и блок со стандартной задачей — обновляем стандартную
      const locId = String(loc.id || '').trim();
      if (locId && !byId.has(locId) && loc.title) {
        const matchDef = Array.from(byId.values()).find((x) => x.block !== 'Карта добрых дел' && String(x.title || '').trim() === String(loc.title || '').trim() && (x.block === loc.block || !loc.block));
        if (matchDef && !delMap[matchDef.id]) {
          putTask(Object.assign({}, matchDef, loc, { id: matchDef.id }), true);
          return;
        }
      }
      putTask(loc, true);
    });
  }

  // 3) Входящие задачи с сервера (обновляют изменённые строки без удаления остальных блоков!)
  if (Array.isArray(incomingTasks)) {
    incomingTasks.forEach((rem) => {
      if (!rem) return;
      const remId = String(rem.id || '').trim();
      if (remId && !byId.has(remId) && rem.title) {
        const matchDef = Array.from(byId.values()).find((x) => x.block !== 'Карта добрых дел' && String(x.title || '').trim() === String(rem.title || '').trim() && (x.block === rem.block || !rem.block));
        if (matchDef && !delMap[matchDef.id]) {
          putTask(Object.assign({}, matchDef, rem, { id: matchDef.id }), true);
          return;
        }
      }
      putTask(rem, true);
    });
  }

  return orderIds.map((id, idx) => {
    const item = byId.get(id);
    item.row = idx + 2;
    return item;
  });
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


window.coffeeSyncGoodDeedsToChecklistTasks = function (db) {
  if (!db || typeof db !== 'object') return;
  if (!Array.isArray(db.goodDeeds)) {
    db.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((g) => Object.assign({}, g));
  }
  if (!Array.isArray(db.tasks)) db.tasks = [];
  const delTasks = db.deletedTaskIds || {};
  const delGds = db.deletedGoodDeedIds || {};
  const gdIds = new Set(db.goodDeeds.map((g) => g && g.id).filter(Boolean));
  // Remove tasks of block 'Карта добрых дел' that were deleted from goodDeeds (if their id starts with gd)
  db.tasks = db.tasks.filter((t) => {
    if (!t) return false;
    if (delGds[t.id] || delTasks[t.id]) return false;
    if (t.block === 'Карта добрых дел' && /^gd/i.test(String(t.id || '')) && !gdIds.has(t.id)) return false;
    return true;
  });
  db.goodDeeds.forEach((g, idx) => {
    if (!g || !g.id || delGds[g.id] || delTasks[g.id]) return;
    const instrText =
      (g.frequency ? '📅 Периодичность: ' + g.frequency + '\n' : '') +
      (g.window ? '⏰ Окно выполнения: ' + g.window + '\n' : '') +
      (g.instruction || '');
    const ex = db.tasks.find((t) => t && t.id === g.id);
    if (ex) {
      ex.block = 'Карта добрых дел';
      ex.title = g.title || ex.title;
      ex.instruction = instrText || ex.instruction;
      ex.responsible = g.responsible || ex.responsible || 'Бариста';
      ex.photo = 'да';
      ex.photoMode = 'да';
      ex.mediaRequired = true;
      ex.active = 'да';
    } else {
      db.tasks.push({
        id: g.id,
        block: 'Карта добрых дел',
        group: 'gd',
        groupName: 'Карта добрых дел (периодические задачи)',
        title: g.title || 'Задача Карты добрых дел',
        instruction: instrText,
        photo: 'да',
        photoMode: 'да',
        responsible: g.responsible || 'Бариста',
        reviewer: g.reviewer || 'Управляющий',
        active: 'да',
        row: 100 + idx,
        mediaRequired: true
      });
    }
  });
};

window.coffeeEnsureV19Schema = function (db) {
  if (!db || typeof db !== 'object') return db;
  if (!Array.isArray(db.checklistBlocks)) {
    db.checklistBlocks = window.COFFEE_DEFAULT_CHECKLIST_BLOCKS.map((b) => Object.assign({}, b));
  } else if (!db._timelineMigratedV28) {
    const hasLc1 = db.checklistBlocks.some((b) => b.name === 'Лайн Чек 1');
    const hasOldDay = db.checklistBlocks.some((b) => b.name === 'День');
    if (!hasLc1 && hasOldDay) {
      db.checklistBlocks = window.COFFEE_DEFAULT_CHECKLIST_BLOCKS.map((b) => Object.assign({}, b));
    }
    db._timelineMigratedV28 = true;
  }
  if (Array.isArray(db.checklistBlocks) && !(db.deletedChecklistBlocks && db.deletedChecklistBlocks['Карта добрых дел'])) {
    if (!db.checklistBlocks.some((b) => b && b.name === 'Карта добрых дел')) {
      db.checklistBlocks.push({ id: 'blk_good_deeds', name: 'Карта добрых дел', openTime: '11:00', deadline: '22:00', isCash: false, active: true });
    }
  }
  db.blocks = db.checklistBlocks.filter((b) => b && b.active !== false && !b.isCash && b.name !== 'Касса').map((b) => b.name);
  if (!db.blocks.length) db.blocks = ['Открытие', 'Лайн Чек 1', 'Лайн Чек 2', 'Закрытие'];

  db.deletedTaskIds = (db.deletedTaskIds && typeof db.deletedTaskIds === 'object') ? db.deletedTaskIds : {};
  if (window.coffeeMergeTasksPreservingDefaults) {
    db.tasks = window.coffeeMergeTasksPreservingDefaults(db.tasks || [], [], db.deletedTaskIds);
  } else if (Array.isArray(db.tasks)) {
    db.tasks = window.coffeeNormalizeTasksTimeline(db.tasks);
  }

  /* Планы по дням недели (Пн–Вс): выручка, средний чек, транзакции */
  const basePlan = Number(db.plan) || 2500;
  const baseAvg = Number(db.minAvgCheck) || 35;
  const baseChk = Number(db.planChecks) || 75;
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

  /* Коды доступа сотрудников хранятся исключительно в виде персональных SHA-256 хешей (без заводских PIN) */
  if (Array.isArray(db.staff)) {
    db.staff.forEach((s) => {
      if (s.pin && String(s.pin).indexOf('••') === -1 && !s.pinHash) {
        s.pinHash = window.coffeeHashPin ? window.coffeeHashPin(s.pin) : s.pin;
        delete s.pin;
      }
    });
  }
  if (!Array.isArray(db.goodDeeds)) {
    db.goodDeeds = (window.COFFEE_DEFAULT_GOOD_DEEDS || []).map((g) => Object.assign({}, g));
  }
  if (window.coffeeSyncGoodDeedsToChecklistTasks) window.coffeeSyncGoodDeedsToChecklistTasks(db);
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
    avgCheck: Math.max(1, Number(dp.avgCheck) || Number(db.minAvgCheck) || 35),
    checks: Math.max(1, Number(dp.checks) || Number(db.planChecks) || 75)
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
  const st = (db.staff || []).find((s) => s && s.name === staffName);
  if (st && st.pinChangeRequired) return false;
  const expectedHash = (st && (st.pinHash || (st.pin && String(st.pin).indexOf('••') === -1 && window.coffeeHashPin(st.pin)))) || '';
  const ok = !!expectedHash && (candHash === expectedHash);
  if (window.coffeeRateLimiter) {
    if (ok) window.coffeeRateLimiter.reset(actorKey);
    else window.coffeeRateLimiter.recordFailure(actorKey);
  }
  return ok;
};

/* Переопределяем coffeeGetBlockWindow для поддержки нового таймлайна (Открытие, Лайн Чек 1, Лайн Чек 2, Закрытие, Касса и любых добавленных чек-листов) */
window.coffeeGetBlockWindow = function (block, dbOpt, userNameOpt) {
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
  const activeWho = userNameOpt !== undefined
    ? userNameOpt
    : (typeof window !== 'undefined' && window.COFFEE_IS_BARISTA_TERMINAL && typeof window.coffeeGetActiveBarista === 'function' ? window.coffeeGetActiveBarista() : '');
  const comp = window.coffeeIsBlockCompletedToday(block, db, activeWho);
  const completed = comp.completed;

  const adminForcedOpen = !!(extObj && extObj.forceOpen && curHm >= effectiveOpen && curHm <= effectiveDeadline);
  const isBefore = !adminForcedOpen && !completed && curHm < effectiveOpen;
  const isOverdue = !adminForcedOpen && !completed && curHm > effectiveDeadline;
  const canPass = !completed && (adminForcedOpen || (curHm >= effectiveOpen && curHm <= effectiveDeadline));

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
let _enforcingOverdueBusy = false;
window.coffeeEnforceOverdueChecklists = function (activeBaristaOpt) {
  if (_enforcingOverdueBusy) return [];
  _enforcingOverdueBusy = true;
  try {
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
    const normBlk = window.coffeeNormalizeBlockName ? window.coffeeNormalizeBlockName(blk) : blk;
    const win = window.coffeeGetBlockWindow(blk, db);
    const key = today + ':' + blk;
    // Если чек-лист уже выполнен — автоматически закрываем ошибочный/просроченный авто-инцидент INC-LATE-*
    if (win.state === 'completed') {
      if (db.overdueIncidentsCreated[key]) {
        delete db.overdueIncidentsCreated[key];
        changed = true;
      }
      (db.incidents || []).forEach((inc) => {
        if (!inc || inc.status === 'Решена') return;
        const incBlk = window.coffeeNormalizeBlockName ? window.coffeeNormalizeBlockName(inc.block) : inc.block;
        const isLateInc = inc.isOverdueAuto || String(inc.id || '').indexOf('INC-LATE-') === 0;
        if (isLateInc && _sameIsoDate(inc.date, today) && incBlk === normBlk) {
          inc.status = 'Решена';
          inc.history = Array.isArray(inc.history) ? inc.history : [];
          inc.history.push({ time: today.split('-').reverse().join('.') + ' ' + win.currentTime, actor: 'Система автоконтроля', status: 'Решена', note: 'Чек-лист «' + blk + '» выполнен — просрочка снята автоматически' });
          db.resolvedIncidents = db.resolvedIncidents || {};
          db.resolvedIncidents[inc.id] = 'Решена';
          changed = true;
        }
      });
      return;
    }
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
        if (window.coffeeNotify) {
          window.coffeeNotify.push(db, {
            level: 'critical',
            type: 'overdue',
            incId: incId,
            block: blk,
            actor: activeBarista,
            title: '⏰ Просрочен чек-лист «' + blk + '»',
            text: 'Дедлайн ' + win.deadline + ' истёк (дежурный: ' + activeBarista + '). Доступ закрыт, создан инцидент ' + incId + '.',
            telegramText: '⏰ ПРОСРОЧКА ЧЕК-ЛИСТА\n📋 Блок: ' + blk + '\n👤 Сотрудник: ' + activeBarista + '\n⏱ Дедлайн: ' + win.deadline
          });
        }
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
  } finally { _enforcingOverdueBusy = false; }
};


window.coffeeEnsureSchema = window.coffeeEnsureV19Schema;
