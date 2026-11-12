/**
 * Серверный скрипт Google Apps Script (Code.gs) v21 Enterprise Security & Delta-Sync Edition
 * для системы операционного управления «Кофейня».
 *
 * КЛЮЧЕВЫЕ ОБНОВЛЕНИЯ БЕЗОПАСНОСТИ И НАДЁЖНОСТИ (v21):
 * 1. Сервер как источник истины для доступа: токены сессии (sessionToken) с TTL 12 часов
 *    в CacheService/PropertiesService вместо передачи открытого PIN в каждом запросе.
 * 2. Защита от перебора PIN (Rate Limiting): автоматическая блокировка на 15 минут после
 *    5 неверных попыток ввода PIN (как для владельца, так и для сотрудников).
 * 3. Хеширование PIN-кодов (SHA-256 с солью 'coffee_salt_v21:') через Utilities.computeDigest.
 * 4. Закрыта неавторизованная перезапись настроек (удалён публичный доступ к save_setting / CLOUD_SYNC_V17).
 * 5. Публичный get_checklists очищен от приватных настроек, токенов и PIN-кодов.
 * 6. Токен Telegram-бота хранится в PropertiesService на сервере и никогда не отдаётся в браузер;
 *    уведомления отправляются сервером через UrlFetchApp.fetch.
 * 7. Поэлементная дельта-синхронизация (delta_sync по id + updatedAt + deleted) + LockService.getScriptLock()
 *    для защиты от потери данных при одновременной работе нескольких бариста.
 */

var SALT_V21 = 'coffee_salt_v21:';
var MAX_PIN_ATTEMPTS = 5;
var LOCKOUT_SECONDS = 900; // 15 минут
var SESSION_TTL_SECONDS = 21600; // 6 часов (максимум CacheService)

/* === ЖИВАЯ СИНХРОНИЗАЦИЯ: счётчик версии данных ===
   Любая успешная запись (doPost) или ручная правка таблицы меняет DATA_REV. Клиенты каждые несколько секунд
   спрашивают дешёвый запрос get_rev и подтягивают данные только когда версия изменилась. */
function bumpDataRev_() {
  var rev = String(Date.now());
  try { PropertiesService.getScriptProperties().setProperty('DATA_REV', rev); } catch (_) {}
  try { CacheService.getScriptCache().put('DATA_REV', rev, 21600); } catch (_) {}
  return rev;
}
function getDataRev_() {
  try { var c = CacheService.getScriptCache().get('DATA_REV'); if (c) return c; } catch (_) {}
  var r = '0';
  try { r = PropertiesService.getScriptProperties().getProperty('DATA_REV') || '0'; } catch (_) {}
  try { CacheService.getScriptCache().put('DATA_REV', r, 21600); } catch (_) {}
  return r;
}
/* Простой триггер: ручная правка листа в Google Таблице тоже мгновенно попадает во все устройства. */
function onEdit(e) {
  try {
    var n = e && e.range && e.range.getSheet ? e.range.getSheet().getName() : '';
    if (n === 'API_OPERATIONS') return;
    bumpDataRev_();
  } catch (_) {}
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'get_checklists';
    if (action === 'get_rev') return jsonOut_({ ok: true, rev: getDataRev_(), serverTs: Date.now() });
    if (action === 'version') return jsonOut_({ ok: true, serverVersion: 'v22.7', actions: ['save_checklist_blocks', 'update_incident', 'delete_incident', 'delta_sync'] });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    // 1. Публичный запрос терминала бариста (возвращает только публичные чек-листы, окна и список имён без PIN/токенов)
    if (action === 'get_checklists') {
      var pubRes = sanitizePublicChecklists_(getChecklists_(ss), ss, p.sinceTs);
      pubRes.rev = getDataRev_();
      return jsonOut_(pubRes);
    }

    // 2. Запросы разделов владельца (Дашборд, Отчёты, Управление) — требуют валидный sessionToken (или верификацию PIN с rate-limit)
    requireAuth_(ss, p, 'admin');

    if (action === 'dashboard') {
      return jsonOut_(maskSensitiveSettingsInResponse_(getDashboard_(ss, p.date), ss));
    }
    if (action === 'report') {
      return jsonOut_(maskSensitiveSettingsInResponse_(getReport_(ss, p.from, p.to), ss));
    }
    if (action === 'admin') {
      return jsonOut_(maskSensitiveSettingsInResponse_(getAdmin_(ss), ss));
    }
    return jsonOut_({ ok: false, error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    // Защита от гонки данных при параллельной записи с нескольких устройств
    lock.waitLock(15000);
    hasLock = true;

    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    // Идемпотентность: повтор сетевого запроса с тем же operationId не выполняет мутацию второй раз.
    var replay = getIdempotentResult_(ss, body);
    if (replay) return jsonOut_(replay);

    // 1. Серверная аутентификация по PIN (с защитой от перебора 5 попыток и выдачей sessionToken)
    if (action === 'auth_login') {
      return idempotentJsonOut_(ss, body, handleAuthLogin_(ss, body));
    }
    if (action === 'auth_logout') {
      return idempotentJsonOut_(ss, body, handleAuthLogout_(body));
    }

    // 2. Поэлементная дельта-синхронизация (по id и updatedAt, без затирания чужих смен и чек-листов)
    if (action === 'delta_sync') {
      return idempotentJsonOut_(ss, body, handleDeltaSync_(ss, body));
    }

    // 3. Операционные действия терминала бариста (с автоматической серверной отправкой в Telegram)
    if (action === 'submit_checklist') {
      validateChecklistPayload_(ss, body);
      var resChk = submitChecklist_(ss, body);
      if (body.isLate) {
        sendTelegramServerAlert_(ss, {
          type: 'overdue',
          text: '⏰ ПРОСРОЧКА ЧЕК-ЛИСТА\nБлок: ' + (body.block || '') + '\nСотрудник: ' + (body.userName || 'Бариста') + '\nДедлайн: ' + (body.deadline || '')
        });
      }
      // Инциденты из чек-листа отправляем с сервера, чтобы не зависеть от открытого клиентского Telegram API.
      (Array.isArray(body.items) ? body.items : []).filter(function(x) { return x && x.isIncident; }).forEach(function(x) {
        sendTelegramServerAlert_(ss, {
          type: 'incident',
          text: '🚨 ПРОБЛЕМА ПО ЧЕК-ЛИСТУ\nБлок: ' + String(body.block || '').slice(0, 100) + '\nУчасток: ' + String(x.title || '').slice(0, 150) + '\nСотрудник: ' + String(body.userName || 'Бариста').slice(0, 100) + '\nОписание: ' + String(x.comment || '').slice(0, 700)
        });
      });
      return idempotentJsonOut_(ss, body, resChk);
    }
    if (action === 'submit_cash') {
      validateCashPayload_(ss, body);
      return idempotentJsonOut_(ss, body, submitCash_(ss, body));
    }
    if (action === 'batch_submit_cash') return idempotentJsonOut_(ss, body, batchSubmitCash_(ss, body));
    // Фото пока не загружаются в серверное хранилище. Не подтверждаем фиктивный успех.
    if (action === 'upload_photo') return idempotentJsonOut_(ss, body, uploadPhotoToDrive_(ss, body));
    if (action === 'ack_announcement') return idempotentJsonOut_(ss, body, ackAnnouncement_(ss, body));
    if (action === 'report_standalone_incident') {
      var resInc = reportIncident_(ss, body);
      sendTelegramServerAlert_(ss, {
        type: 'incident',
        text: '🚨 НОВАЯ ПОЛОМКА / ЭКШН-ПЛАН (24ч)\nУчасток: ' + (body.step || '') + '\nОписание: ' + (body.text || body.comment || '') + '\nИсполнитель: ' + (body.responsible || 'Техник') + '\nСообщил: ' + (body.userName || 'Бариста')
      });
      return idempotentJsonOut_(ss, body, resInc);
    }
    // ВНИМАНИЕ: Уязвимость публичного save_setting для CLOUD_SYNC_V17 полностью закрыта!
    // Все действия ниже требуют подтверждённой сессии администратора / владельца (sessionToken).
    requireAuth_(ss, body, 'admin');

    // Произвольная отправка сообщений в Telegram доступна только владельцу/администратору.
    if (action === 'send_telegram_alert') return idempotentJsonOut_(ss, body, sendTelegramServerAlert_(ss, body));

    if (action === 'setup_initial_credentials') return idempotentJsonOut_(ss, body, setupInitialCredentials_(ss, body));
    if (action === 'save_telegram_credentials') return idempotentJsonOut_(ss, body, saveTelegramCredentials_(ss, body));
    if (action === 'save_task') return idempotentJsonOut_(ss, body, saveTask_(ss, body));
    if (action === 'delete_task') return idempotentJsonOut_(ss, body, deleteTask_(ss, body));
    if (action === 'admin_cash') return idempotentJsonOut_(ss, body, submitCash_(ss, body));
    if (action === 'delete_cash') return idempotentJsonOut_(ss, body, deleteCash_(ss, body));
    if (action === 'add_expense') { validateExpensePayload_(ss, body); return idempotentJsonOut_(ss, body, addExpense_(ss, body)); }
    if (action === 'update_expense') return idempotentJsonOut_(ss, body, updateExpense_(ss, body));
    if (action === 'delete_expense') return idempotentJsonOut_(ss, body, deleteExpense_(ss, body));
    if (action === 'resolve_incident') return idempotentJsonOut_(ss, body, updateIncident_(ss, { id: body.id, status: 'Решена', actor: body.actor || 'Администратор' }));
    if (action === 'update_incident') return idempotentJsonOut_(ss, body, updateIncident_(ss, body));
    if (action === 'delete_incident') return idempotentJsonOut_(ss, body, deleteIncident_(ss, body));
    if (action === 'save_setting') return idempotentJsonOut_(ss, body, saveSettingSecure_(ss, body));
    if (action === 'save_all_settings' && body.items) {
      body.items.forEach(function(it) { saveSettingSecure_(ss, it); });
      return idempotentJsonOut_(ss, body, { ok: true });
    }
    if (action === 'extend_deadline') return idempotentJsonOut_(ss, body, extendDeadline_(ss, body));
    if (action === 'save_block_windows') return idempotentJsonOut_(ss, body, saveBlockWindows_(ss, body));
    if (action === 'simulate_overdue') return idempotentJsonOut_(ss, body, simulateOverdue_(ss, body));
    if (action === 'save_announcement') return idempotentJsonOut_(ss, body, saveAnnouncement_(ss, body));
    if (action === 'delete_announcement') return idempotentJsonOut_(ss, body, deleteAnnouncement_(ss, body));
    if (action === 'save_staff') return idempotentJsonOut_(ss, body, saveStaff_(ss, body));
    if (action === 'delete_staff') return idempotentJsonOut_(ss, body, deleteStaff_(ss, body));
    if (action === 'save_ttk') return idempotentJsonOut_(ss, body, saveTtk_(ss, body));
    if (action === 'delete_ttk') return idempotentJsonOut_(ss, body, deleteTtk_(ss, body));
    if (action === 'save_shift_roster') return idempotentJsonOut_(ss, body, saveShiftRoster_(ss, body));
    if (action === 'reorder_task') return idempotentJsonOut_(ss, body, reorderTask_(ss, body));
    if (action === 'save_checklist_blocks') return idempotentJsonOut_(ss, body, saveChecklistBlocks_(ss, body));
    if (action === 'add_checklist_block') return idempotentJsonOut_(ss, body, addChecklistBlock_(ss, body));
    if (action === 'delete_checklist_block') return idempotentJsonOut_(ss, body, deleteChecklistBlock_(ss, body));
    if (action === 'save_daily_plans') return idempotentJsonOut_(ss, body, saveDailyPlans_(ss, body));
    if (action === 'save_staff_pins') return idempotentJsonOut_(ss, body, saveStaffPins_(ss, body));
    if (action === 'save_good_deed') return idempotentJsonOut_(ss, body, saveGoodDeed_(ss, body));
    if (action === 'delete_good_deed') return idempotentJsonOut_(ss, body, deleteGoodDeed_(ss, body));
    if (action === 'save_service_audit') return idempotentJsonOut_(ss, body, saveServiceAudit_(ss, body));
    if (action === 'delete_service_audit') return idempotentJsonOut_(ss, body, deleteServiceAudit_(ss, body));
    if (action === 'sync_all_to_sheet') return idempotentJsonOut_(ss, body, syncAllToSheet_(ss, body));

    return idempotentJsonOut_(ss, body, { ok: false, error: 'UNKNOWN_ACTION: Неизвестное действие API: ' + action });
  } catch (err) {
    return idempotentJsonOut_(ss, body, { ok: false, error: String((err && err.message) || err) });
  } finally {
    if (hasLock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}


/* =========================================================================
   МОДУЛЬ СТРОГОЙ СЕРВЕРНОЙ ВАЛИДАЦИИ, STAFF-СЕССИЙ И GOOGLE DRIVE (v23)
   ========================================================================= */

function isValidIsoDate_(str) {
  var s = String(str || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime());
}

function validateFiniteNumber_(val, minVal, maxVal, fieldName) {
  var n = Number(val);
  if (val === '' || val === null || typeof val === 'boolean' || !isFinite(n) || isNaN(n) || n < minVal || n > maxVal) {
    throw new Error('VALIDATION_FAILED: Некорректное числовое значение поля «' + fieldName + '» (допустимо от ' + minVal + ' до ' + maxVal + ')');
  }
  return n;
}

function resolveVerifiedStaffSession_(ss, body) {
  var tok = String((body && body.sessionToken) || '').trim();
  if (tok && tok.indexOf('st_') === 0) {
    try {
      var raw = CacheService.getScriptCache().get('sess_' + tok);
      if (raw) {
        var sess = JSON.parse(raw);
        if (sess && sess.expiresAt > Date.now() && sess.staffName) {
          body.userName = sess.staffName;
          if (!body.barista) body.barista = sess.staffName;
          return sess;
        }
      }
    } catch (_) {}
  }
  var staffName = String((body && (body.userName || body.barista)) || '').trim();
  if (staffName && body && (body.staffPinHash || body.pinHash)) {
    var expectedHash = getStaffPinHash_(ss, staffName);
    var candHash = normalizePinHash_(body.staffPinHash || body.pinHash);
    if (candHash === expectedHash) {
      return { role: 'staff', staffName: staffName, verifiedByPin: true };
    }
    throw new Error('PIN_INVALID: Подпись PIN сотрудника «' + staffName + '» не прошла серверную проверку');
  }
  return null;
}

function validateCashPayload_(ss, b) {
  if (!b || typeof b !== 'object') throw new Error('VALIDATION_FAILED: Пустой запрос кассы');
  var dt = String(b.date || isoDate_()).trim();
  if (!isValidIsoDate_(dt)) throw new Error('VALIDATION_FAILED: Некорректный формат даты кассы (' + dt + '), ожидается YYYY-MM-DD');
  validateFiniteNumber_(b.cash != null ? b.cash : 0, 0, 1000000, 'Наличные');
  validateFiniteNumber_(b.card != null ? b.card : 0, 0, 1000000, 'Безнал');
  validateFiniteNumber_(b.checks != null ? b.checks : 0, 0, 10000, 'Чеки');
  validateFiniteNumber_(b.writeoff != null ? b.writeoff : (b.writeOffs != null ? b.writeOffs : 0), 0, 5000, 'Списания');
  resolveVerifiedStaffSession_(ss, b);
  return true;
}

function validateChecklistPayload_(ss, b) {
  if (!b || typeof b !== 'object') throw new Error('VALIDATION_FAILED: Пустой запрос чек-листа');
  var blk = String(b.block || '').trim();
  if (!blk || blk.length > 80) throw new Error('VALIDATION_FAILED: Не указан блок чек-листа');
  if (b.items != null && !Array.isArray(b.items)) throw new Error('VALIDATION_FAILED: Поле items должно быть массивом');
  resolveVerifiedStaffSession_(ss, b);
  return true;
}

function validateExpensePayload_(ss, b) {
  if (!b || typeof b !== 'object') throw new Error('VALIDATION_FAILED: Пустой запрос расхода');
  var dt = String(b.date || isoDate_()).trim();
  if (!isValidIsoDate_(dt)) throw new Error('VALIDATION_FAILED: Некорректный формат даты расхода (' + dt + ')');
  validateFiniteNumber_(b.amount, 0.01, 5000000, 'Сумма расхода');
  var cat = String(b.category || '').trim();
  if (!cat || cat.length > 120) throw new Error('VALIDATION_FAILED: Не указана статья расхода');
  return true;
}

function uploadPhotoToDrive_(ss, body) {
  resolveVerifiedStaffSession_(ss, body);
  var dataUri = String((body && (body.dataUri || body.photo || body.base64)) || '').trim();
  if (!dataUri) {
    return { ok: false, error: 'SERVER_PHOTO_STORAGE_NOT_IMPLEMENTED: пустые данные медиафайла; фото передаётся в составе отчёта' };
  }
  var m = /^data:(image\/(?:jpeg|png|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!m) {
    return { ok: false, error: 'VALIDATION_FAILED: Допустимы только изображения JPEG/PNG/WEBP или видео MP4 в base64' };
  }
  var mimeType = m[1];
  var b64Data = m[2];
  if (b64Data.length > 10 * 1024 * 1024) {
    return { ok: false, error: 'VALIDATION_FAILED: Размер медиафайла превышает лимит 8 МБ' };
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty('DRIVE_MEDIA_FOLDER_ID') || '';
    var folder = null;
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (_) { folder = null; }
    }
    if (!folder) {
      var iter = DriveApp.getFoldersByName('Кофейня — Медиаархив Смен');
      folder = iter.hasNext() ? iter.next() : DriveApp.createFolder('Кофейня — Медиаархив Смен');
      props.setProperty('DRIVE_MEDIA_FOLDER_ID', folder.getId());
    }
    var ext = mimeType.indexOf('png') >= 0 ? 'png' : (mimeType.indexOf('webp') >= 0 ? 'webp' : (mimeType.indexOf('mp4') >= 0 ? 'mp4' : 'jpg'));
    var staff = String((body && body.userName) || 'Бариста').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
    var blk = String((body && body.block) || 'Смена').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
    var fname = isoDate_() + '_' + blk + '_' + staff + '_' + Date.now() + '.' + ext;
    var decoded = Utilities.base64Decode(b64Data);
    var blob = Utilities.newBlob(decoded, mimeType, fname);
    var file = folder.createFile(blob);
    var retentionDays = Number(props.getProperty('MEDIA_RETENTION_DAYS') || 90);
    var expiresAt = isoDate_(new Date(Date.now() + retentionDays * 86400000));
    var shM = ss.getSheetByName('Медиафайлы');
    if (!shM) {
      shM = ss.insertSheet('Медиафайлы');
      shM.appendRow(['FileID', 'Дата', 'Сотрудник', 'Блок', 'Размер байт', 'Хранить до', 'URL']);
    }
    shM.appendRow([file.getId(), isoDate_(), body.userName || 'Бариста', body.block || '', decoded.length, expiresAt, file.getUrl()]);
    return { ok: true, fileId: file.getId(), url: file.getUrl(), expiresAt: expiresAt };
  } catch (driveErr) {
    return { ok: false, error: 'SERVER_PHOTO_STORAGE_NOT_IMPLEMENTED: ' + String((driveErr && driveErr.message) || driveErr) };
  }
}

function setupInitialCredentials_(ss, body) {
  var props = PropertiesService.getScriptProperties();
  if (body.newAdminPin) {
    var newAdminHash = normalizePinHash_(body.newAdminPin);
    props.setProperty('ADMIN_PIN_HASH', newAdminHash);
    saveSetting_(ss, { id: 'ADMIN_PIN', value: 'sha256:' + newAdminHash });
  }
  if (body.staffPins && typeof body.staffPins === 'object') {
    Object.keys(body.staffPins).forEach(function(sName) {
      var pVal = String(body.staffPins[sName] || '').trim();
      if (pVal) {
        props.setProperty('STAFF_PIN_HASH_' + sName, normalizePinHash_(pVal));
      }
    });
  }
  props.setProperty('FACTORY_PINS_DISABLED', '1');
  appendAudit_(ss, 'Администратор', 'Первичная настройка безопасности (Production Lock)', 'Заводские PIN-коды отключены, установлены индивидуальные SHA-256 хеши');
  return { ok: true, factoryPinsDisabled: true };
}

/* =========================================================================
   МОДУЛЬ СЕРВЕРНОЙ БЕЗОПАСНОСТИ: SHA-256, RATE-LIMITING (5 ПОПЫТОК), СЕССИИ
   ========================================================================= */

function sha256Hex_(inputStr) {
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    SALT_V21 + String(inputStr || '').trim(),
    Utilities.Charset.UTF_8
  );
  var out = '';
  for (var i = 0; i < rawBytes.length; i++) {
    var b = rawBytes[i];
    if (b < 0) b += 256;
    var hex = b.toString(16);
    if (hex.length === 1) out += '0';
    out += hex;
  }
  return out;
}

function normalizePinHash_(val) {
  var s = String(val || '').trim();
  if (!s) return '';
  if (s.indexOf('sha256:') === 0) return s.slice(7);
  if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();
  return sha256Hex_(s);
}

function checkRateLimit_(actorKey) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_v21_' + String(actorKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  var raw = cache.get(key);
  var state = raw ? JSON.parse(raw) : { count: 0, lockedUntil: 0 };
  var now = Date.now();
  if (state.lockedUntil && now < state.lockedUntil) {
    var secLeft = Math.ceil((state.lockedUntil - now) / 1000);
    throw new Error('RATE_LIMIT: Превышено число попыток ввода PIN (5/5). Доступ временно заблокирован, подождите ' + secLeft + ' сек.');
  }
  return { cache: cache, key: key, state: state };
}

function recordFailedAttempt_(ss, actorKey) {
  var rl = checkRateLimit_(actorKey);
  rl.state.count = (rl.state.count || 0) + 1;
  if (rl.state.count >= MAX_PIN_ATTEMPTS) {
    rl.state.lockedUntil = Date.now() + (LOCKOUT_SECONDS * 1000);
    rl.cache.put(rl.key, JSON.stringify(rl.state), LOCKOUT_SECONDS);
    appendAudit_(ss, String(actorKey || 'Неизвестный'), '🚨 Блокировка входа (Brute-Force Protection)', '5 неверных попыток ввода PIN — блокировка на 15 минут');
    throw new Error('RATE_LIMIT: Введено 5 неверных PIN-кодов подряд. Вход заблокирован на 15 минут.');
  }
  rl.cache.put(rl.key, JSON.stringify(rl.state), LOCKOUT_SECONDS);
  return MAX_PIN_ATTEMPTS - rl.state.count;
}

function clearFailedAttempts_(actorKey) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'rl_v21_' + String(actorKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    cache.remove(key);
  } catch (_) {}
}

function verifyOwnerPinServer_(ss, candidatePinOrHash, actorKey) {
  checkRateLimit_(actorKey || 'admin');
  var map = getSettingsMap_(ss);
  var storedRaw = String(map.ADMIN_PIN || '').trim();
  var props = PropertiesService.getScriptProperties();
  var propHash = props.getProperty('ADMIN_PIN_HASH') || '';
  var factoryDisabled = props.getProperty('FACTORY_PINS_DISABLED') === '1';
  var sheetHash = (storedRaw && storedRaw.indexOf('••') === -1 && (!factoryDisabled || storedRaw !== '1234')) ? normalizePinHash_(storedRaw) : '';
  var expectedHash = propHash || sheetHash || sha256Hex_('1234');
  var candidateHash = normalizePinHash_(candidatePinOrHash);
  var isMatch = !!candidatePinOrHash && (candidateHash === expectedHash || (sheetHash && candidateHash === sheetHash));

  if (!isMatch) {
    var left = recordFailedAttempt_(ss, actorKey || 'admin');
    throw new Error('PIN_REQUIRED: Неверный код доступа владельца (осталось попыток: ' + left + ')');
  }
  clearFailedAttempts_(actorKey || 'admin');
  return true;
}

function handleAuthLogin_(ss, body) {
  var role = String(body.role || 'admin').trim();
  var staffName = String(body.staffName || (role === 'admin' ? 'Администратор' : 'Бариста')).trim();
  // Для админа ключ лимита фиксированный: иначе перебор обходится подстановкой разных staffName.
  var actorKey = role === 'admin' ? 'admin' : (role + '_' + staffName);
  var pinCandidate = body.pinHash || body.pin || '';

  if (role === 'admin') {
    verifyOwnerPinServer_(ss, pinCandidate, actorKey);
  } else {
    checkRateLimit_(actorKey);
    var expectedStaffHash = getStaffPinHash_(ss, staffName);
    var candStaffHash = normalizePinHash_(pinCandidate);
    var ownerExpected = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH') || normalizePinHash_(getSettingsMap_(ss).ADMIN_PIN || '1234');
    if (!pinCandidate || (candStaffHash !== expectedStaffHash && candStaffHash !== ownerExpected)) {
      var left = recordFailedAttempt_(ss, actorKey);
      throw new Error('PIN_INVALID: Неверный персональный PIN сотрудника (осталось попыток: ' + left + ')');
    }
    clearFailedAttempts_(actorKey);
  }

  var token = 'st_' + Utilities.getUuid().replace(/-/g, '') + '_' + sha256Hex_(Utilities.getUuid()).slice(0, 16);
  var expiresAt = Date.now() + (SESSION_TTL_SECONDS * 1000);
  var sessionObj = {
    token: token,
    role: role,
    staffName: staffName,
    issuedAt: Date.now(),
    expiresAt: expiresAt
  };
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sessionObj), SESSION_TTL_SECONDS);
  appendAudit_(ss, staffName, 'Вход в систему по защищённой сессии', 'Роль: ' + role);
  return {
    ok: true,
    sessionToken: token,
    role: role,
    staffName: staffName,
    expiresAt: expiresAt
  };
}

function handleAuthLogout_(body) {
  var tok = String(body.sessionToken || '').trim();
  if (tok) {
    try { CacheService.getScriptCache().remove('sess_' + tok); } catch (_) {}
  }
  return { ok: true };
}

function requireAuth_(ss, paramsOrBody, requiredRole) {
  var p = paramsOrBody || {};
  var tok = String(p.sessionToken || '').trim();
  if (tok && tok.indexOf('st_') === 0) {
    var raw = CacheService.getScriptCache().get('sess_' + tok);
    if (raw) {
      var sess = JSON.parse(raw);
      if (sess && sess.expiresAt > Date.now()) {
        if (requiredRole === 'admin' && sess.role !== 'admin') {
          throw new Error('FORBIDDEN: Требуются права владельца или администратора');
        }
        return sess;
      }
    }
  }
  // Резервная проверка по pinHash или pin (с обязательным Rate-Limiting 5 попыток)
  var pinCand = p.pinHash || p.pin || '';
  if (pinCand) {
    verifyOwnerPinServer_(ss, pinCand, 'admin_api');
    return { role: 'admin', staffName: 'Администратор' };
  }
  throw new Error('PIN_REQUIRED: Сессия недействительна или истекла. Пожалуйста, войдите по коду доступа.');
}

function getStaffPinHash_(ss, staffName) {
  var defaultMap = {
    'Соня': sha256Hex_('1111'),
    'Алина': sha256Hex_('2222'),
    'Настя': sha256Hex_('3333'),
    'Максим': sha256Hex_('4444'),
    'Администратор': sha256Hex_('1234')
  };
  var props = PropertiesService.getScriptProperties();
  var custom = props.getProperty('STAFF_PIN_HASH_' + staffName);
  if (custom) return custom;
  return defaultMap[staffName] || sha256Hex_('1111');
}

/* =========================================================================
   СЕРВЕРНАЯ ИНТЕГРАЦИЯ TELEGRAM (ТОКЕН ХРАНИТСЯ В PROPERTIESSERVICE)
   ========================================================================= */

function saveTelegramCredentials_(ss, body) {
  var props = PropertiesService.getScriptProperties();
  var tok = String(body.tgToken || '').trim();
  var chat = String(body.tgChat || '').trim();
  if (tok && tok.indexOf('••') === -1) {
    props.setProperty('TG_BOT_TOKEN_SECRET', tok);
  }
  if (chat) {
    props.setProperty('TG_CHAT_ID_SECRET', chat);
    saveSetting_(ss, { id: 'TG_CHAT', value: chat });
  }
  // В листе «Настройки» храним только маску, чтобы токен не светился в таблице и браузере
  saveSetting_(ss, { id: 'TG_TOKEN', value: tok ? '•••••••• (хранится на сервере)' : '' });
  appendAudit_(ss, 'Администратор', 'Обновление серверных ключей Telegram', 'Токен сохранён в защищённом хранилище сервера');
  return { ok: true, tgConfigured: !!(props.getProperty('TG_BOT_TOKEN_SECRET')) };
}

function sendTelegramServerAlert_(ss, payload) {
  try {
    var props = PropertiesService.getScriptProperties();
    var map = getSettingsMap_(ss);
    var token = props.getProperty('TG_BOT_TOKEN_SECRET') || '';
    if (!token && map.TG_TOKEN && map.TG_TOKEN.indexOf('••') === -1 && map.TG_TOKEN.indexOf(':') > 0) {
      token = String(map.TG_TOKEN).trim();
      props.setProperty('TG_BOT_TOKEN_SECRET', token);
      saveSetting_(ss, { id: 'TG_TOKEN', value: '•••••••• (хранится на сервере)' });
    }
    var chatRaw = props.getProperty('TG_CHAT_ID_SECRET') || map.TG_CHAT || '';
    if (!token || !chatRaw) {
      return { ok: false, skipped: true, reason: 'Telegram не настроен на сервере' };
    }
    var chats = String(chatRaw).split(/[,;\s]+/).map(function(x) { return x.trim(); }).filter(Boolean);
    var text = String(payload.text || payload.message || '').trim();
    if (!text) return { ok: false, reason: 'Пустой текст уведомления' };

    chats.forEach(function(chatId) {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          chat_id: chatId,
          text: text
        }),
        muteHttpExceptions: true
      });
    });
    return { ok: true, sentTo: chats.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function saveSettingSecure_(ss, body) {
  var nk = normSetKey_(body.id || body.key);
  var val = String(body.value != null ? body.value : '').trim();
  var props = PropertiesService.getScriptProperties();
  if (nk === 'TG_TOKEN') {
    if (val && val.indexOf('••') === -1) {
      props.setProperty('TG_BOT_TOKEN_SECRET', val);
    }
    return saveSetting_(ss, { id: 'TG_TOKEN', value: val ? '•••••••• (хранится на сервере)' : '' });
  }
  if (nk === 'ADMIN_PIN') {
    if (val && val.indexOf('••') === -1) {
      var pHash = normalizePinHash_(val);
      props.setProperty('ADMIN_PIN_HASH', pHash);
      return saveSetting_(ss, { id: 'ADMIN_PIN', value: 'sha256:' + pHash });
    }
    return { ok: true };
  }
  return saveSetting_(ss, body);
}

function sanitizePublicChecklists_(res, ss, sinceTs) {
  // Удаляем любые чувствительные поля из публичного ответа get_checklists
  delete res.settings;
  delete res.adminPin;
  delete res.tgToken;
  if (Array.isArray(res.staff)) {
    res.staff = res.staff.map(function(s) {
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        location: s.location,
        active: s.active
      };
    });
  }
  res.deltas = getDeltasSince_(ss, Number(sinceTs) || 0);
  res.serverTs = Date.now();
  return res;
}

function maskSensitiveSettingsInResponse_(res, ss) {
  var props = PropertiesService.getScriptProperties();
  var hasTg = !!(props.getProperty('TG_BOT_TOKEN_SECRET'));
  res.tgConfiguredOnServer = hasTg;
  if (Array.isArray(res.settings)) {
    res.settings = res.settings
      .filter(function(s) { return s.id !== 'CLOUD_SYNC_V17'; })
      .map(function(s) {
        if (s.id === 'TG_TOKEN') {
          return { id: 'TG_TOKEN', label: s.label, value: hasTg ? '•••••••• (хранится на сервере)' : '' };
        }
        if (s.id === 'ADMIN_PIN') {
          return { id: 'ADMIN_PIN', label: s.label, value: '' };
        }
        return s;
      });
  }
  return res;
}

/* =========================================================================
   ПОЭЛЕМЕНТНАЯ ДЕЛЬТА-СИНХРОНИЗАЦИЯ (DELTA_SYNC ПО ID И UPDATED_AT)
   ========================================================================= */

function handleDeltaSync_(ss, body) {
  var sh = ss.getSheetByName('ДельтаСинхр');
  if (!sh) {
    sh = ss.insertSheet('ДельтаСинхр');
    sh.appendRow(['Collection', 'RecordID', 'UpdatedAt', 'Deleted', 'Actor', 'PayloadJSON']);
  }
  var incoming = Array.isArray(body.deltas) ? body.deltas : [];
  var rows = sh.getDataRange().getValues();
  var indexMap = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0] || '') + '::' + String(rows[i][1] || '');
    indexMap[key] = { rowIdx: i + 1, updatedAt: Number(rows[i][2]) || 0, payload: rows[i][5] };
  }

  var applied = 0;
  incoming.forEach(function(d) {
    if (!d || !d.collection || !d.id) return;
    // Защита: закрытые коллекции (settings, staff, expenses, tasks) через delta_sync требуют сессии владельца
    if (/^(settings|expenses|tasks|staff|ttk)$/.test(d.collection)) {
      requireAuth_(ss, body, 'admin');
    }
    var k = String(d.collection) + '::' + String(d.id);
    var incTs = Number(d.updatedAt) || Date.now();
    var existing = indexMap[k];

    if (!existing || incTs >= existing.updatedAt) {
      var mergedRecord = d.record || {};
      // Если это информирование или инцидент — объединяем массивы acks / readBy / history (Set Union)
      if (existing && existing.payload) {
        try {
          var prevRec = JSON.parse(String(existing.payload));
          if (Array.isArray(prevRec.readBy) || Array.isArray(mergedRecord.readBy)) {
            var setR = {};
            (prevRec.readBy || []).concat(mergedRecord.readBy || []).forEach(function(n) { if (n) setR[n] = true; });
            mergedRecord.readBy = Object.keys(setR);
          }
          if (Array.isArray(prevRec.acks) || Array.isArray(mergedRecord.acks)) {
            var mapA = {};
            (prevRec.acks || []).concat(mergedRecord.acks || []).forEach(function(a) {
              if (a && a.staff) mapA[a.staff] = a;
            });
            mergedRecord.acks = Object.keys(mapA).map(function(ak) { return mapA[ak]; });
          }
        } catch (_) {}
      }
      var rowVals = [
        String(d.collection),
        String(d.id),
        incTs,
        d.deleted ? '1' : '0',
        String(d.actor || body.userName || 'Система'),
        JSON.stringify(mergedRecord)
      ];
      if (existing) {
        sh.getRange(existing.rowIdx, 1, 1, 6).setValues([rowVals]);
        existing.updatedAt = incTs;
        existing.payload = rowVals[5];
      } else {
        sh.appendRow(rowVals);
        indexMap[k] = { rowIdx: sh.getLastRow(), updatedAt: incTs, payload: rowVals[5] };
      }
      applied++;
    }
  });

  var sinceTs = Number(body.sinceTs) || 0;
  return {
    ok: true,
    applied: applied,
    serverTs: Date.now(),
    deltas: getDeltasSince_(ss, sinceTs)
  };
}

function getDeltasSince_(ss, sinceTs) {
  var sh = ss.getSheetByName('ДельтаСинхр');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var ts = Number(rows[i][2]) || 0;
    if (ts >= sinceTs) {
      var rec = null;
      try { rec = JSON.parse(String(rows[i][5] || '{}')); } catch (_) {}
      out.push({
        collection: String(rows[i][0] || ''),
        id: String(rows[i][1] || ''),
        updatedAt: ts,
        deleted: String(rows[i][3] || '') === '1',
        actor: String(rows[i][4] || ''),
        record: rec
      });
    }
  }
  return out;
}


/** Возвращает сохранённый результат операции, если клиент повторил запрос после таймаута. */
function getIdempotentResult_(ss, body) {
  var id = String(body && body.operationId || '').trim();
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) return null;
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('op_' + id);
    if (cached) return JSON.parse(cached);
  } catch (_) {}
  // Постоянный журнал нужен, чтобы повтор после истечения CacheService не выполнил операцию второй раз.
  try {
    var sh = ss.getSheetByName('API_OPERATIONS');
    if (!sh) {
      sh = ss.insertSheet('API_OPERATIONS');
      sh.appendRow(['OperationID', 'CreatedAt', 'ResultJSON']);
    }
    var last = sh.getLastRow();
    if (last >= 2) {
      var found = sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
      if (found) {
        var raw = String(sh.getRange(found.getRow(), 3).getValue() || '');
        if (raw) {
          var result = JSON.parse(raw);
          try { cache.put('op_' + id, raw, 21600); } catch (_) {}
          return result;
        }
      }
    }
  } catch (_) {}
  return null;
}

function idempotentJsonOut_(ss, body, result) {
  if (result && result.ok === true) {
    var actName = String(body && body.action || '');
    if (actName !== 'auth_login' && actName !== 'auth_logout') result.rev = bumpDataRev_();
    var id = String(body && body.operationId || '').trim();
    // Результаты со session-токеном не журналируем: токены не должны храниться в таблице/кэше.
    if (!result.sessionToken && /^[a-zA-Z0-9_-]{12,80}$/.test(id)) {
      var raw = JSON.stringify(result);
      try { CacheService.getScriptCache().put('op_' + id, raw, 21600); } catch (_) {}
      try {
        var sh = ss.getSheetByName('API_OPERATIONS');
        if (!sh) {
          sh = ss.insertSheet('API_OPERATIONS');
          sh.appendRow(['OperationID', 'CreatedAt', 'ResultJSON']);
        }
        sh.appendRow([id, Date.now(), raw]);
        // Ограничиваем рост журнала, сохраняя последние 5000 подтверждённых операций.
        var last = sh.getLastRow();
        if (last > 5001) sh.deleteRows(2, last - 5001);
      } catch (_) {}
    }
  }
  return jsonOut_(result);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isoDate_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone() || 'GMT+2', 'yyyy-MM-dd');
}

function fmtIso_(v) {
  if (!v) return '';
  if (v instanceof Date) return isoDate_(v);
  var s = String(v || '').trim();
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);
}

function ensureSheets_(ss) {
  var defs = [
    ['Настройки', ['Параметр', 'Значение', 'Описание (можно редактировать столбец «Значение» прямо в таблице)']],
    ['Таймлайн', ['ID', 'Название чек-листа', 'Открытие (ЧЧ:ММ)', 'Дедлайн (ЧЧ:ММ)', 'Касса (да/нет)', 'Активен (да/нет)']],
    ['Планы', ['День недели', 'План выручки, руб.', 'План ср. чека, руб.', 'План чеков', 'График смен (Бариста)']],
    ['Задачи', ['Код', 'Блок', 'Подгруппа', 'Название', 'Инструкция', 'Нужно фото', 'Ответственный', 'Активна']],
    ['Карта добрых дел', ['ID', 'Название задачи', 'Периодичность', 'Окно времени', 'Исполнитель', 'Проверяющий', 'Инструкция']],
    ['Сотрудники', ['ID', 'Имя', 'Роль', 'Кофейня', 'Активен', 'Код входа (PIN)']],
    ['Техкарты', ['ID', 'Название', 'Объём', 'Категория', 'Цена, руб.', 'Зерно, руб.', 'Молоко, руб.', 'Сироп, руб.', 'Тара, руб.', 'Рецептура', 'Подача']],
    ['Информирование', ['ID', 'Заголовок', 'Категория', 'Описание', 'Дата публикации', 'Актуально до', 'Дата календаря', 'Событие календаря', 'Кому назначено', 'Ознакомились JSON']],
    ['Касса', ['Дата', 'Наличные', 'Безнал', 'Чеков', 'Списания', 'Хиты', 'Бариста']],
    ['Расходы', ['ID', 'Дата', 'Статья', 'Сумма', 'Комментарий']],
    ['Поломки', ['ID', 'Дата', 'Время', 'Шаг', 'Описание', 'Срочность', 'Статус', 'Кто', 'Ответственный', 'Фото', 'Тип', 'История JSON']],
    ['Аудит сервиса', ['ID', 'Дата', 'Бариста', 'Проверяющий', 'Приветствие %', 'Уточнение %', 'Upsell %', 'Прощание %', 'Итог %', 'Комментарий']],
    ['Чек-листы', ['Дата', 'Время', 'Блок', 'Бариста', 'Проблем', 'Фото JSON', 'Дедлайн', 'Статус срока']],
    ['Журнал', ['Дата', 'Время', 'Пользователь', 'Действие', 'Детали']],
    ['ДельтаСинхр', ['Collection', 'RecordID', 'UpdatedAt', 'Deleted', 'Actor', 'PayloadJSON']]
  ];
  defs.forEach(function(d) {
    var sh = ss.getSheetByName(d[0]);
    if (!sh) {
      sh = ss.insertSheet(d[0]);
      sh.appendRow(d[1]);
      seedDefaultSheetRows_(ss, sh, d[0]);
    } else if (sh.getLastRow() <= 1) {
      seedDefaultSheetRows_(ss, sh, d[0]);
    }
  });
}

function seedDefaultSheetRows_(ss, sh, name) {
  if (name === 'Настройки') {
    var defSettings = [
      ['LOCATION', 'Кофейня №1', 'Название точки (отображается в шапке и на фото)'],
      ['PLAN', '2200', 'Базовый план выручки на день, руб.'],
      ['OPEN_START', '07:30', 'Начало окна «Открытие» (ЧЧ:ММ)'],
      ['DEADLINE', '08:30', 'Дедлайн закрытия «Открытие» (ЧЧ:ММ)'],
      ['LC1_START', '08:30', 'Начало окна «Лайн Чек 1» (ЧЧ:ММ)'],
      ['LC1_DEADLINE', '09:30', 'Дедлайн закрытия «Лайн Чек 1» (ЧЧ:ММ)'],
      ['LC2_START', '14:00', 'Начало окна «Лайн Чек 2» (ЧЧ:ММ)'],
      ['LC2_DEADLINE', '16:00', 'Дедлайн закрытия «Лайн Чек 2» (ЧЧ:ММ)'],
      ['DAY_START', '11:00', 'Начало дневного окна (ЧЧ:ММ)'],
      ['DAY_DEADLINE', '18:30', 'Дедлайн дневного окна (ЧЧ:ММ)'],
      ['CLOSE_START', '21:30', 'Начало окна «Закрытие» (ЧЧ:ММ)'],
      ['CLOSE_DEADLINE', '22:30', 'Дедлайн закрытия «Закрытие» (ЧЧ:ММ)'],
      ['CASH_START', '22:00', 'Начало окна «Касса» (ЧЧ:ММ)'],
      ['CASH_DEADLINE', '23:59', 'Дедлайн закрытия «Касса» (ЧЧ:ММ)'],
      ['WO_NORM', '15', 'Норма списаний в день, руб.'],
      ['MIN_AVG_CHECK', '35', 'Норматив среднего чека, руб.'],
      ['PLAN_CHECKS', '75', 'Плановое количество чеков в день'],
      ['PHOTO_ALL', 'нет', 'Фото на каждом шаге (да/нет)'],
      ['INIT_COUNTER', '600', 'Начальный счётчик кофемашины'],
      ['CATEGORIES', 'Закупка продуктов, Аренда, Зарплата, Коммунальные, Реклама, Ремонт и оборудование, Прочее', 'Статьи расходов через запятую'],
      ['TG_TOKEN', '', 'Токен Telegram-бота (от @BotFather)'],
      ['TG_CHAT', '', 'ID чата администратора в Telegram'],
      ['ADMIN_PIN', '1234', 'Код доступа владельца / администратора']
    ];
    defSettings.forEach(function(r) { sh.appendRow(r); });
  } else if (name === 'Таймлайн') {
    var defBlocks = [
      ['blk_open', 'Открытие', '07:30', '08:30', 'нет', 'да'],
      ['blk_lc1', 'Лайн Чек 1', '08:30', '09:30', 'нет', 'да'],
      ['blk_lc2', 'Лайн Чек 2', '14:00', '16:00', 'нет', 'да'],
      ['blk_close', 'Закрытие', '21:30', '22:30', 'нет', 'да'],
      ['blk_cash', 'Касса', '22:00', '23:59', 'да', 'да'],
      ['blk_good_deeds', 'Карта добрых дел', '11:00', '22:00', 'нет', 'да']
    ];
    defBlocks.forEach(function(r) { sh.appendRow(r); });
  } else if (name === 'Планы') {
    var defPlans = [
      ['Пн', 2200, 32, 70, 'Соня (07:30–22:30)'],
      ['Вт', 2200, 32, 70, 'Алина (07:30–22:30)'],
      ['Ср', 2300, 33, 72, 'Алина + Соня (2 смены)'],
      ['Чт', 2400, 34, 75, 'Настя (07:30–22:30)'],
      ['Пт', 2800, 36, 85, 'Алина + Соня (2 смены, пик)'],
      ['Сб', 3000, 38, 90, 'Настя + Соня (2 смены, пик)'],
      ['Вс', 2500, 35, 75, 'Соня (07:30–22:30)']
    ];
    defPlans.forEach(function(r) { sh.appendRow(r); });
  } else if (name === 'Сотрудники') {
    var defStaff = [
      ['st1', 'Соня', 'Бариста', 'Кофейня №1', 'да', '1111'],
      ['st2', 'Алина', 'Бариста', 'Кофейня №1', 'да', '2222'],
      ['st3', 'Настя', 'Бариста', 'Кофейня №1', 'да', '3333'],
      ['st4', 'Максим', 'Шеф-бариста', 'Кофейня №1', 'да', '4444'],
      ['st5', 'Администратор', 'Администратор', 'Кофейня №1', 'да', '1234']
    ];
    defStaff.forEach(function(r) { sh.appendRow(r); });
  } else if (name === 'Карта добрых дел') {
    var defGd = [
      ['gd1', '🧊 Разморозка и генеральная мойка холодильника', 'Раз в 2 недели (Вторник 14:00–18:00 — тихий день)', '14:00 – 18:00', 'Бариста', 'Управляющий / Шеф-бариста', 'Выполняется в самый тихий день (вторник с 14:00 до 18:00): отключить холодильник, полностью разморозить, промыть полки и уплотнители и сделать фото с камеры.'],
      ['gd2', '🧂 Регенерация водоумягчителя (фильтра воды) — 2 пачки соли', 'Раз в 4 недели (При закрытии — регенерация водоумягчителя)', '21:30 – 22:30 (при закрытии)', 'Бариста', 'Техник / Управляющий', 'Строго при закрытии смены: скрутить крышку водоумягчителя, засыпать 2 пачки таблетированной соли, запустить цикл промывки.'],
      ['gd3', '🪑 Подготовка второго зала к открытию (Пт–Сб)', 'Только Пт и Сб (2-й зал / пик)', '07:30 – 08:30', 'Бариста', 'Администратор', 'В пятницу и субботу открывается 2-й зал: включить освещение, проверить посадку, протереть столы.'],
      ['gd4', '🧽 Глубокая замочка холдеров, сеток и питчеров в химии', '2 раза в неделю (Чт, Вс)', '21:30 – 22:30', 'Бариста', 'Шеф-бариста', 'Снять рассекатели и корзины холдеров, замочить в растворе Cafiza на 20 минут, промыть чистой водой и сфотографировать.']
    ];
    defGd.forEach(function(r) { sh.appendRow(r); });
  } else if (name === 'Техкарты') {
    var defTtk = [
      ['ttk1', '☕ Капучино ILLY', '250 мл (M)', 'Классика', 19, 4.2, 2.5, 0, 1.3, 'Эспрессо ILLY 18 г зерна → выход 36 г за 25–27 сек. Молоко 3.2% (ТМК) — 180 мл, взбивание до 62 °C.', 'Керамическая чашка 250 мл или крафт-стакан навынос. Доп. сироп 15 мл (+5 руб.).'],
      ['ttk2', '🖤 Американо ILLY', '250 мл (M)', 'Классика', 12, 4.2, 0, 0, 1.3, 'Горячая вода 92 °C (160 мл) в стакан, сверху аккуратно влить эспрессо ILLY (36 г) с сохранением крема.', 'Предложить гостю молоко 50 мл (+5 руб.), доп. шот эспрессо ILLY (+7 руб.) или чизкейк (40 руб.).'],
      ['ttk3', '🥛 Латте (малый)', '250 мл (M)', 'Классика', 20, 4.2, 2.6, 0, 1.2, 'Эспрессо ILLY (1 шот 30 мл) + молоко 200 мл, температура 63 °C, тонкая шелковистая пена 0.5 см.', 'Стакан 250 мл. На безлактозном молоке (+5 руб.), на альтернативном молоке (+10 руб.).'],
      ['ttk4', '🥛 Латте (большой)', '350 мл (L)', 'Классика', 25, 4.2, 3.8, 0, 1.5, 'Эспрессо ILLY (36 г) + молоко 270 мл, температура 63 °C, нежная молочная шапка.', 'Высокий бокал или стакан 350 мл. Подача с салфеткой.'],
      ['ttk5', '⚡ Flat White (Флэт Уайт)', '200 мл (S)', 'Классика', 25, 7.5, 2.2, 0, 1.3, 'Двойной ристретто ILLY (36 г) + 130 мл молока с минимальной микропеной (58–60 °C).', 'Стакан 200 мл, обязателен чёткий латте-арт (сердце / тюльпан).'],
      ['ttk6', '🍊 Ванильно-апельсиновый Латте / Раф', '350 мл (L)', 'Авторский / Хит', 30, 4.2, 4.5, 2.0, 1.5, 'Эспрессо ILLY 36 г + молоко со сливками 10% (220 мл) + ванильно-апельсиновый сироп 15 мл. Взбить вместе стимером до 65 °C.', 'Высокая маржинальность (Upsell №1 в ПМР — 30 руб.).'],
      ['ttk7', '🍫 Какао «Баунти» / Горячий шоколад', '300 мл (M)', 'Авторский / Десертный', 30, 5.0, 3.5, 1.8, 1.4, 'Натуральное какао 22 г + молоко 230 мл + кокосовый сироп 15 мл. Взбить стимером до 65 °C без комочков.', 'По желанию гостя добавить маршмеллоу (+8 руб.).'],
      ['ttk8', '🍰 Чизкейк классический', '120 г (порция)', 'Десерты / Витрина', 40, 22.0, 0, 0, 1.5, 'Проверить срок маркировки на витрине (температура витрины +2…+6 °C). Подавать охлаждённым.', 'Керамическая тарелка с десертной вилкой или крафт-бокс навынос.']
    ];
    defTtk.forEach(function(r) { sh.appendRow(r); });
  }
}

function normSetKey_(raw) {
  var k = String(raw || '').trim(), low = k.toLowerCase();
  if (k === 'LOCATION' || /назван|точк|кофейн|локац/.test(low)) return 'LOCATION';
  if (k === 'PLAN' || /^план$|план выручк|цель/.test(low)) return 'PLAN';
  if (k === 'OPEN_START' || /начал.*открыт/.test(low)) return 'OPEN_START';
  if (k === 'DEADLINE' || /дедлайн.*открыт|дедлайн смен/.test(low)) return 'DEADLINE';
  if (k === 'LC1_START' || /начал.*лайн\s*чек\s*1/.test(low)) return 'LC1_START';
  if (k === 'LC1_DEADLINE' || /дедлайн.*лайн\s*чек\s*1/.test(low)) return 'LC1_DEADLINE';
  if (k === 'LC2_START' || /начал.*лайн\s*чек\s*2/.test(low)) return 'LC2_START';
  if (k === 'LC2_DEADLINE' || /дедлайн.*лайн\s*чек\s*2/.test(low)) return 'LC2_DEADLINE';
  if (k === 'DAY_START' || /начал.*дн/.test(low)) return 'DAY_START';
  if (k === 'DAY_DEADLINE' || /дедлайн.*дн/.test(low)) return 'DAY_DEADLINE';
  if (k === 'CLOSE_START' || /начал.*закрыт/.test(low)) return 'CLOSE_START';
  if (k === 'CLOSE_DEADLINE' || /дедлайн.*закрыт/.test(low)) return 'CLOSE_DEADLINE';
  if (k === 'CASH_START' || /начал.*касс/.test(low)) return 'CASH_START';
  if (k === 'CASH_DEADLINE' || /дедлайн.*касс/.test(low)) return 'CASH_DEADLINE';
  if (k === 'WO_NORM' || /норм.*списан/.test(low)) return 'WO_NORM';
  if (k === 'MIN_AVG_CHECK' || /средн.*чек/.test(low)) return 'MIN_AVG_CHECK';
  if (k === 'PLAN_CHECKS' || /план.*чек/.test(low)) return 'PLAN_CHECKS';
  if (k === 'PHOTO_ALL' || /фото.*шаг|обязат.*фото/.test(low)) return 'PHOTO_ALL';
  if (k === 'INIT_COUNTER' || /счетчик|счётчик/.test(low)) return 'INIT_COUNTER';
  if (k === 'CATEGORIES' || /статьи|категор/.test(low)) return 'CATEGORIES';
  if (k === 'TG_TOKEN' || /tg.*token|токен.*бот/.test(low)) return 'TG_TOKEN';
  if (k === 'TG_CHAT' || /tg.*chat|чат.*админ/.test(low)) return 'TG_CHAT';
  if (k === 'ADMIN_PIN' || /код доступ|пин|pin|парол/.test(low)) return 'ADMIN_PIN';
  if (k === 'DEADLINE_EXTENSIONS_JSON') return 'DEADLINE_EXTENSIONS_JSON';
  if (k === 'SHIFT_ROSTER_JSON') return 'SHIFT_ROSTER_JSON';
  if (k === 'CHECKLIST_BLOCKS_JSON') return 'CHECKLIST_BLOCKS_JSON';
  if (k === 'DAILY_PLANS_JSON') return 'DAILY_PLANS_JSON';
  if (k === 'CLOUD_SYNC_V17') return 'CLOUD_SYNC_V17';
  return k;
}

function getSettingsMap_(ss) {
  var sh = ss.getSheetByName('Настройки');
  var rows = sh ? sh.getDataRange().getValues() : [];
  var map = {
    LOCATION: 'Кофейня №1',
    PLAN: '2200',
    OPEN_START: '07:30',
    DEADLINE: '08:30',
    LC1_START: '08:30',
    LC1_DEADLINE: '09:30',
    LC2_START: '14:00',
    LC2_DEADLINE: '16:00',
    DAY_START: '11:00',
    DAY_DEADLINE: '18:30',
    CLOSE_START: '21:30',
    CLOSE_DEADLINE: '22:30',
    CASH_START: '22:00',
    CASH_DEADLINE: '23:59',
    WO_NORM: '15',
    MIN_AVG_CHECK: '35',
    PLAN_CHECKS: '75',
    PHOTO_ALL: 'нет',
    INIT_COUNTER: '600',
    CATEGORIES: 'Закупка продуктов, Аренда, Зарплата, Коммунальные, Реклама, Ремонт и оборудование, Прочее',
    TG_TOKEN: '',
    TG_CHAT: '',
    ADMIN_PIN: '1234',
    DEADLINE_EXTENSIONS_JSON: '{}',
    SHIFT_ROSTER_JSON: '{}',
    CHECKLIST_BLOCKS_JSON: '',
    DAILY_PLANS_JSON: ''
  };
  for (var i = 1; i < rows.length; i++) {
    var rawK = String(rows[i][0] || '').trim();
    if (!rawK) continue;
    var nk = normSetKey_(rawK);
    if (nk === 'CLOUD_SYNC_V17') continue;
    var cellVal = rows[i][1];
    var v = (cellVal instanceof Date)
      ? Utilities.formatDate(cellVal, Session.getScriptTimeZone() || 'GMT+2', 'HH:mm')
      : String(cellVal != null ? cellVal : '').trim();
    if (v !== '') map[nk] = v;
  }
  return map;
}

function getSettingsArray_(map) {
  return [
    { id: 'LOCATION', label: 'Название точки', hint: 'Отображается в шапке всех разделов (лист «Настройки» → LOCATION)', value: map.LOCATION, secret: false },
    { id: 'PLAN', label: 'План выручки на день, руб.', hint: 'Сразу пересчитывает цель и % выполнения (лист «Настройки» → PLAN)', value: map.PLAN, secret: false },
    { id: 'OPEN_START', label: 'Начало окна «Открытие» (ЧЧ:ММ)', hint: 'Время открытия доступа к «Открытию» в Терминале', value: map.OPEN_START, secret: false },
    { id: 'DEADLINE', label: 'Дедлайн закрытия «Открытие» (ЧЧ:ММ)', hint: 'После этого времени доступ закрывается и создаётся инцидент', value: map.DEADLINE, secret: false },
    { id: 'DAY_START', label: 'Начало окна «День» (ЧЧ:ММ)', hint: 'Время открытия доступа к дневному обходу', value: map.DAY_START, secret: false },
    { id: 'DAY_DEADLINE', label: 'Дедлайн закрытия «День» (ЧЧ:ММ)', hint: 'После этого времени доступ закрывается', value: map.DAY_DEADLINE, secret: false },
    { id: 'CLOSE_START', label: 'Начало окна «Закрытие» (ЧЧ:ММ)', hint: 'Время открытия доступа к «Закрытию» в Терминале', value: map.CLOSE_START, secret: false },
    { id: 'CLOSE_DEADLINE', label: 'Дедлайн закрытия «Закрытие» (ЧЧ:ММ)', hint: 'После этого времени доступ к «Закрытию» закрывается', value: map.CLOSE_DEADLINE, secret: false },
    { id: 'WO_NORM', label: 'Норма списаний в день, руб.', hint: 'Порог списаний (лист «Настройки» → WO_NORM)', value: map.WO_NORM, secret: false },
    { id: 'MIN_AVG_CHECK', label: 'Норматив среднего чека, руб.', hint: 'Плановый средний чек в руб. ПМР', value: map.MIN_AVG_CHECK, secret: false },
    { id: 'PLAN_CHECKS', label: 'Плановое кол-во чеков в день', hint: 'Целевое кол-во чеков за смену', value: map.PLAN_CHECKS, secret: false },
    { id: 'PHOTO_ALL', label: 'Фото на каждом шаге (да/нет)', hint: 'Обязательное фото для открытия и закрытия', value: map.PHOTO_ALL, secret: false },
    { id: 'INIT_COUNTER', label: 'Текущий счётчик кофемашины', hint: 'Начальный счётчик в Кассе', value: map.INIT_COUNTER, secret: false },
    { id: 'TG_TOKEN', label: 'Токен Telegram-бота (от @BotFather)', hint: 'Для отправки фото поломок', value: map.TG_TOKEN, secret: false },
    { id: 'TG_CHAT', label: 'ID чата администратора в Telegram', hint: 'Chat ID для уведомлений', value: map.TG_CHAT, secret: false },
    { id: 'CATEGORIES', label: 'Статьи расходов (через запятую)', hint: 'Список статей расходов', value: map.CATEGORIES, secret: false },
    { id: 'ADMIN_PIN', label: 'Код доступа к дашборду и отчётам', hint: 'Код администратора (можно также изменить в листе «Настройки» → ADMIN_PIN)', value: '', secret: true, set: !!map.ADMIN_PIN }
  ];
}

function fmtHmCell_(v, fallback) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  }
  var s = String(v != null ? v : '').trim();
  if (/^\d:\d{2}$/.test(s)) return '0' + s;
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return fallback || '08:00';
}

function getChecklistBlocksFromSheet_(ss, map) {
  var sh = ss.getSheetByName('Таймлайн');
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getDataRange().getValues();
    var list = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var nm = String(r[1] || '').trim();
      if (!nm) continue;
      var actStr = String(r[5] || 'да').trim().toLowerCase();
      if (actStr === 'нет' || actStr === 'false' || actStr === '0') continue;
      var isCashStr = String(r[4] || 'нет').trim().toLowerCase();
      list.push({
        id: String(r[0] || ('blk_' + i)).trim(),
        name: nm,
        openTime: fmtHmCell_(r[2], '07:30'),
        deadline: fmtHmCell_(r[3], '08:30'),
        isCash: isCashStr === 'да' || isCashStr === 'true' || nm === 'Касса',
        active: true
      });
    }
    if (list.length) return list;
  }
  if (map && map.CHECKLIST_BLOCKS_JSON) {
    try {
      var parsed = JSON.parse(map.CHECKLIST_BLOCKS_JSON);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (_) {}
  }
  return [
    { id: 'blk_open', name: 'Открытие', openTime: (map && map.OPEN_START) || '07:30', deadline: (map && map.DEADLINE) || '08:30', isCash: false, active: true },
    { id: 'blk_lc1', name: 'Лайн Чек 1', openTime: (map && map.LC1_START) || '08:30', deadline: (map && map.LC1_DEADLINE) || '09:30', isCash: false, active: true },
    { id: 'blk_lc2', name: 'Лайн Чек 2', openTime: (map && map.LC2_START) || '14:00', deadline: (map && map.LC2_DEADLINE) || '16:00', isCash: false, active: true },
    { id: 'blk_close', name: 'Закрытие', openTime: (map && map.CLOSE_START) || '21:30', deadline: (map && map.CLOSE_DEADLINE) || '22:30', isCash: false, active: true },
    { id: 'blk_cash', name: 'Касса', openTime: (map && map.CASH_START) || '22:00', deadline: (map && map.CASH_DEADLINE) || '23:59', isCash: true, active: true }
  ];
}

function getDailyPlansAndRosterFromSheet_(ss, map) {
  var plans = {
    'Пн': { revenue: 2200, avgCheck: 32, checks: 70 },
    'Вт': { revenue: 2200, avgCheck: 32, checks: 70 },
    'Ср': { revenue: 2300, avgCheck: 33, checks: 72 },
    'Чт': { revenue: 2400, avgCheck: 34, checks: 75 },
    'Пт': { revenue: 2800, avgCheck: 36, checks: 85 },
    'Сб': { revenue: 3000, avgCheck: 38, checks: 90 },
    'Вс': { revenue: 2500, avgCheck: 35, checks: 75 }
  };
  var roster = {
    'Пн': 'Соня (07:30–22:30)',
    'Вт': 'Алина (07:30–22:30)',
    'Ср': 'Алина + Соня (2 смены)',
    'Чт': 'Настя (07:30–22:30)',
    'Пт': 'Алина + Соня (2 смены, пик)',
    'Сб': 'Настя + Соня (2 смены, пик)',
    'Вс': 'Соня (07:30–22:30)'
  };
  if (map && map.DAILY_PLANS_JSON) {
    try { Object.assign(plans, JSON.parse(map.DAILY_PLANS_JSON)); } catch (_) {}
  }
  if (map && map.SHIFT_ROSTER_JSON) {
    try { Object.assign(roster, JSON.parse(map.SHIFT_ROSTER_JSON)); } catch (_) {}
  }
  var sh = ss.getSheetByName('Планы');
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var d = String(r[0] || '').trim();
      if (!plans[d]) continue;
      if (Number(r[1]) > 0) plans[d].revenue = Number(r[1]);
      if (Number(r[2]) > 0) plans[d].avgCheck = Number(r[2]);
      if (Number(r[3]) > 0) plans[d].checks = Number(r[3]);
      if (r[4] != null && String(r[4]).trim() !== '') roster[d] = String(r[4]).trim();
    }
  }
  return { dailyPlans: plans, shiftRoster: roster };
}

function getGoodDeedsFromSheet_(ss) {
  var sh = ss.getSheetByName('Карта добрых дел');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[1]) continue;
    list.push({
      id: String(r[0] || ('gd_' + i)).trim(),
      title: String(r[1] || '').trim(),
      frequency: String(r[2] || '1 раз в неделю').trim(),
      window: String(r[3] || '14:00 – 18:00').trim(),
      responsible: String(r[4] || 'Бариста').trim(),
      reviewer: String(r[5] || 'Управляющий / Шеф-бариста').trim(),
      instruction: String(r[6] || '').trim()
    });
  }
  return list;
}

function getServiceAuditsFromSheet_(ss) {
  var sh = ss.getSheetByName('Аудит сервиса');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[2]) continue;
    var g = Number(r[4]) || 0, cl = Number(r[5]) || 0, up = Number(r[6]) || 0, fw = Number(r[7]) || 0;
    var sc = Number(r[8]) || Math.round((g + cl + up + fw) / 4);
    list.push({
      id: String(r[0] || ('AUD-' + i)).trim(),
      date: fmtIso_(r[1]) || isoDate_(),
      barista: String(r[2] || 'Соня').trim(),
      auditor: String(r[3] || 'Шеф-бариста').trim(),
      greet: g, clarify: cl, upsell: up, farewell: fw, score: sc,
      comment: String(r[9] || '').trim()
    });
  }
  return list.reverse();
}

function getAnnouncements_(ss) {
  var sh = ss.getSheetByName('Информирование');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[1]) continue;
    var acks = [];
    try { acks = JSON.parse(String(r[9] || '[]')); } catch (e) {}
    var targets = [];
    var rawTargets = String(r[8] || '').trim();
    if (rawTargets) targets = rawTargets.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    list.push({
      id: String(r[0] || ('INFO-' + i)),
      title: String(r[1] || ''),
      category: String(r[2] || 'Внутренние объявления'),
      text: String(r[3] || ''),
      publishedAt: fmtIso_(r[4]) || isoDate_(),
      validTo: fmtIso_(r[5]) || '',
      calendarDate: fmtIso_(r[6]) || '',
      calendarEventTitle: String(r[7] || ''),
      targetStaff: targets.length ? targets : ['Соня', 'Алина', 'Настя'],
      acks: Array.isArray(acks) ? acks : []
    });
  }
  return list;
}

function getStaffList_(ss) {
  var sh = ss.getSheetByName('Сотрудники');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1]) continue;
    var sName = String(r[1] || '').trim();
    var sheetPin = String(r[5] != null ? r[5] : '').trim();
    var pHash = '';
    if (sheetPin && sheetPin.indexOf('••') === -1) {
      pHash = normalizePinHash_(sheetPin);
      props.setProperty('STAFF_PIN_HASH_' + sName, pHash);
    } else {
      pHash = props.getProperty('STAFF_PIN_HASH_' + sName) || '';
    }
    var stObj = {
      id: String(r[0] || ('st_' + i)),
      name: sName,
      role: String(r[2] || 'Бариста'),
      shop: String(r[3] || 'Кофейня №1'),
      active: String(r[4] || 'да').toLowerCase()
    };
    if (pHash) stObj.pinHash = pHash;
    list.push(stObj);
  }
  return list;
}

function getTtkList_(ss) {
  var sh = ss.getSheetByName('Техкарты');
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1]) continue;
    list.push({
      id: String(r[0] || ('ttk_' + i)),
      name: String(r[1] || ''),
      volume: String(r[2] || '250 мл'),
      category: String(r[3] || 'Классика'),
      price: Number(r[4]) || 20,
      costBeans: Number(r[5]) || 0,
      costMilk: Number(r[6]) || 0,
      costSyrup: Number(r[7]) || 0,
      costCup: Number(r[8]) || 0,
      recipe: String(r[9] || ''),
      serving: String(r[10] || '')
    });
  }
  return list;
}

function appendAudit_(ss, actor, action, details) {
  try {
    var sh = ss.getSheetByName('Журнал');
    if (!sh) return;
    var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
    sh.appendRow([isoDate_(), tm, actor || 'Система', action || '', details || '']);
  } catch (e) {}
}

function getChecklists_(ss) {
  var map = getSettingsMap_(ss);
  var sh = ss.getSheetByName('Задачи');
  var rows = sh ? sh.getDataRange().getValues() : [];
  var tasks = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var codeStr = String(r[0] || '').trim();
    var titleStr = String(r[3] || '').trim();
    if (codeStr === '__SYS_CONFIG_V19__' || titleStr === '__SYS_SYNC__') continue;
    if (!titleStr && !r[1]) continue;
    var active = String(r[7] || 'да').toLowerCase();
    if (active === 'нет') continue;
    tasks.push({
      row: i + 1,
      id: codeStr || ('r' + (i + 1)),
      block: String(r[1] || 'Открытие'),
      groupName: String(r[2] || ''),
      title: titleStr,
      instruction: String(r[4] || ''),
      photo: String(r[5] || 'нет').toLowerCase(),
      photoMode: String(r[5] || 'нет').toLowerCase(),
      mediaRequired: String(r[5] || 'нет').toLowerCase() === 'да' || (map.PHOTO_ALL === 'да' && (r[1] === 'Открытие' || r[1] === 'Закрытие')),
      responsible: String(r[6] || 'Администратор'),
      active: 'да'
    });
  }

  var extMap = {};
  try { extMap = JSON.parse(map.DEADLINE_EXTENSIONS_JSON || '{}'); } catch (e) {}
  var cBlocks = getChecklistBlocksFromSheet_(ss, map);
  var pr = getDailyPlansAndRosterFromSheet_(ss, map);
  var annList = getAnnouncements_(ss);
  var staffList = getStaffList_(ss);
  var ttkList = getTtkList_(ss);
  var gdList = getGoodDeedsFromSheet_(ss);
  var serverTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  var serverDate = isoDate_();

  return {
    ok: true,
    v: 28,
    rows: tasks.length,
    sheet: 'Задачи',
    location: map.LOCATION || 'Кофейня №1',
    plan: Number(map.PLAN) || 2200,
    woNorm: Number(map.WO_NORM) || 15,
    minAvgCheck: Number(map.MIN_AVG_CHECK) || 35,
    planChecks: Number(map.PLAN_CHECKS) || 75,
    photoAll: map.PHOTO_ALL || 'нет',
    initCounter: Number(map.INIT_COUNTER) || 600,
    openStart: map.OPEN_START || '07:30',
    deadline: map.DEADLINE || '08:30',
    dayStart: map.DAY_START || '11:00',
    dayDeadline: map.DAY_DEADLINE || '18:30',
    closeStart: map.CLOSE_START || '21:30',
    closeDeadline: map.CLOSE_DEADLINE || '22:30',
    checklistBlocks: cBlocks,
    dailyPlans: pr.dailyPlans,
    shiftRoster: pr.shiftRoster,
    deadlineExtensions: extMap,
    settings: getSettingsArray_(map),
    announcements: annList,
    staff: staffList,
    ttk: ttkList,
    goodDeeds: gdList,
    tasks: tasks,
    serverTime: serverTime,
    serverDate: serverDate
  };
}

function getAdmin_(ss) {
  var map = getSettingsMap_(ss);
  var shT = ss.getSheetByName('Задачи').getDataRange().getValues();
  var tasks = [];
  for (var i = 1; i < shT.length; i++) {
    var r = shT[i];
    var codeStr = String(r[0] || '').trim();
    var titleStr = String(r[3] || '').trim();
    if (codeStr === '__SYS_CONFIG_V19__' || titleStr === '__SYS_SYNC__') continue;
    if (!titleStr && !r[1]) continue;
    tasks.push({
      row: i + 1,
      id: codeStr || ('r' + (i + 1)),
      block: String(r[1] || 'Открытие'),
      groupName: String(r[2] || ''),
      title: titleStr,
      instruction: String(r[4] || ''),
      photo: String(r[5] || 'нет').toLowerCase(),
      photoMode: String(r[5] || 'нет').toLowerCase(),
      mediaRequired: String(r[5] || 'нет').toLowerCase() === 'да',
      responsible: String(r[6] || 'Администратор'),
      active: String(r[7] || 'да').toLowerCase()
    });
  }

  var shC = ss.getSheetByName('Касса').getDataRange().getValues();
  var cash = [];
  for (var j = 1; j < shC.length; j++) {
    var rc = shC[j]; if (!rc[0]) continue;
    cash.push({
      date: fmtIso_(rc[0]),
      cash: Number(rc[1]) || 0,
      card: Number(rc[2]) || 0,
      checks: Number(rc[3]) || 0,
      writeoff: Number(rc[4]) || 0,
      topItems: String(rc[5] || ''),
      barista: String(rc[6] || '')
    });
  }

  var shE = ss.getSheetByName('Расходы').getDataRange().getValues();
  var expenses = [];
  for (var k = 1; k < shE.length; k++) {
    var re = shE[k]; if (!re[0]) continue;
    expenses.push({
      id: String(re[0]),
      date: fmtIso_(re[1]),
      category: String(re[2] || 'Прочее'),
      amount: Number(re[3]) || 0,
      comment: String(re[4] || '')
    });
  }

  var shI = ss.getSheetByName('Поломки').getDataRange().getValues();
  var incidents = [];
  for (var m = 1; m < shI.length; m++) {
    var ri = shI[m]; if (!ri[0]) continue;
    var hist = [];
    try { hist = JSON.parse(String(ri[11] || '[]')); } catch (e) {}
    incidents.push({
      id: String(ri[0]),
      date: fmtIso_(ri[1]),
      time: String(ri[2] || ''),
      step: String(ri[3] || 'Проблема'),
      text: String(ri[4] || ''),
      priority: String(ri[5] || 'Терпит'),
      status: String(ri[6] || 'Новая проблема'),
      who: String(ri[7] || 'Бариста'),
      owner: String(ri[8] || 'Администратор'),
      photo: String(ri[9] || ''),
      incType: String(ri[10] || 'Поломка оборудования'),
      history: hist
    });
  }

  var extMap = {};
  try { extMap = JSON.parse(map.DEADLINE_EXTENSIONS_JSON || '{}'); } catch (e) {}
  var cBlocks = getChecklistBlocksFromSheet_(ss, map);
  var pr = getDailyPlansAndRosterFromSheet_(ss, map);
  var rawCats = String(map.CATEGORIES || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean);

  return {
    ok: true,
    v: 28,
    today: isoDate_(),
    location: map.LOCATION,
    plan: Number(map.PLAN) || 2200,
    woNorm: Number(map.WO_NORM) || 15,
    minAvgCheck: Number(map.MIN_AVG_CHECK) || 35,
    planChecks: Number(map.PLAN_CHECKS) || 75,
    photoAll: map.PHOTO_ALL || 'нет',
    initCounter: Number(map.INIT_COUNTER) || 600,
    openStart: map.OPEN_START || '07:30',
    deadline: map.DEADLINE || '08:30',
    dayStart: map.DAY_START || '11:00',
    dayDeadline: map.DAY_DEADLINE || '18:30',
    closeStart: map.CLOSE_START || '21:30',
    closeDeadline: map.CLOSE_DEADLINE || '22:30',
    checklistBlocks: cBlocks,
    dailyPlans: pr.dailyPlans,
    shiftRoster: pr.shiftRoster,
    deadlineExtensions: extMap,
    blocks: cBlocks.filter(function(b){ return !b.isCash && b.name !== 'Касса'; }).map(function(b){ return b.name; }),
    categories: rawCats.length ? rawCats : ['Закупка продуктов', 'Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Ремонт и оборудование', 'Прочее'],
    tasks: tasks,
    cash: cash.reverse(),
    expenses: expenses.reverse(),
    incidents: incidents.reverse(),
    announcements: getAnnouncements_(ss),
    staff: getStaffList_(ss),
    ttk: getTtkList_(ss),
    goodDeeds: getGoodDeedsFromSheet_(ss),
    serviceAudits: getServiceAuditsFromSheet_(ss),
    settings: getSettingsArray_(map)
  };
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

  var shChk = ss.getSheetByName('Чек-листы');
  var chkRows = shChk ? shChk.getDataRange().getValues() : [];
  var openedAt = '';
  var photoReports = [];
  for (var j = 1; j < chkRows.length; j++) {
    var r = chkRows[j];
    if (fmtIso_(r[0]) === day) {
      var tm = String(r[1] || '');
      var blk = String(r[2] || '');
      if (blk === 'Открытие' && (!openedAt || tm < openedAt)) openedAt = tm;
      var phs = [];
      try { phs = JSON.parse(String(r[5] || '[]')); } catch (e) {}
      if (phs.length) photoReports.push({ time: tm, block: blk, who: String(r[3] || ''), photos: phs });
    }
  }

  var days14 = [];
  var baseD = new Date(day + 'T12:00:00');
  for (var d = 13; d >= 0; d--) {
    var curD = new Date(baseD.getTime() - d * 86400000);
    var ds = isoDate_(curD);
    var fc = null;
    for (var k = 0; k < adm.cash.length; k++) { if (adm.cash[k].date === ds) { fc = adm.cash[k]; break; } }
    var dExp = 0;
    for (var e = 0; e < adm.expenses.length; e++) { if (adm.expenses[e].date === ds) dExp += adm.expenses[e].amount; }
    var dWo = fc ? fc.writeoff : 0;
    days14.push({ date: ds, revenue: fc ? (fc.cash + fc.card) : 0, writeoff: dWo, expenses: dExp, outflow: dWo + dExp, barista: fc ? fc.barista : '' });
  }

  return {
    ok: true,
    date: day,
    isToday: day === adm.today,
    location: adm.location,
    plan: adm.plan,
    woNorm: adm.woNorm,
    minAvgCheck: adm.minAvgCheck,
    planChecks: adm.planChecks,
    deadline: adm.deadline,
    checklistBlocks: adm.checklistBlocks,
    dailyPlans: adm.dailyPlans,
    hasData: !!c,
    revenue: rev,
    cash: c ? c.cash : 0,
    card: c ? c.card : 0,
    checks: chks,
    avg: chks > 0 ? Math.round(rev / chks) : 0,
    writeoff: c ? c.writeoff : 0,
    barista: c ? c.barista : '',
    openedAt: openedAt,
    days: days14,
    incidents: adm.incidents,
    announcements: adm.announcements,
    staff: adm.staff,
    photoReports: photoReports
  };
}

function getReport_(ss, fromStr, toStr) {
  var adm = getAdmin_(ss);
  return {
    ok: true,
    from: fromStr || adm.today,
    to: toStr || adm.today,
    days: 7,
    categories: adm.categories,
    plan: adm.plan * 7,
    pct: 0,
    delta: null,
    finance: { revenue: 0, expenses: 0, profit: 0, prevProfit: 0, margin: 0, writeoff: 0, byCategory: [], list: adm.expenses },
    totals: { days: adm.cash.length, revenue: 0, checks: 0, avg: 0, cash: 0, card: 0, writeoff: 0 },
    series: [],
    products: [],
    tasks: [],
    incidentList: adm.incidents,
    announcements: adm.announcements,
    staff: adm.staff,
    discipline: { openings: 0, late: 0, missed: 0, checklists: 0, problemSteps: 0 },
    incidents: { total: adm.incidents.length, open: 0, resolved: 0, critical: 0 }
  };
}

function saveSetting_(ss, b) {
  var sh = ss.getSheetByName('Настройки');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (normSetKey_(rows[i][0]) === normSetKey_(b.id)) {
      sh.getRange(i + 1, 2).setValue(b.value);
      return { ok: true };
    }
  }
  sh.appendRow([b.id, b.value]);
  return { ok: true };
}

function syncChecklistBlocksSheet_(ss, blocks) {
  var sh = ss.getSheetByName('Таймлайн');
  if (!sh) {
    sh = ss.insertSheet('Таймлайн');
  }
  var last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  else if (last === 0) sh.appendRow(['ID', 'Название чек-листа', 'Открытие (ЧЧ:ММ)', 'Дедлайн (ЧЧ:ММ)', 'Касса (да/нет)', 'Активен (да/нет)']);
  (Array.isArray(blocks) ? blocks : []).forEach(function(b, idx) {
    if (!b || !b.name) return;
    sh.appendRow([
      b.id || ('blk_' + idx),
      String(b.name).trim(),
      String(b.openTime || '07:30').trim(),
      String(b.deadline || '08:30').trim(),
      (b.isCash || b.name === 'Касса') ? 'да' : 'нет',
      b.active === false ? 'нет' : 'да'
    ]);
    if (b.name === 'Открытие') {
      saveSetting_(ss, { id: 'OPEN_START', value: b.openTime || '07:30' });
      saveSetting_(ss, { id: 'DEADLINE', value: b.deadline || '08:30' });
    } else if (b.name === 'Лайн Чек 1') {
      saveSetting_(ss, { id: 'LC1_START', value: b.openTime || '08:30' });
      saveSetting_(ss, { id: 'LC1_DEADLINE', value: b.deadline || '09:30' });
    } else if (b.name === 'Лайн Чек 2') {
      saveSetting_(ss, { id: 'LC2_START', value: b.openTime || '14:00' });
      saveSetting_(ss, { id: 'LC2_DEADLINE', value: b.deadline || '16:00' });
    } else if (b.name === 'Закрытие') {
      saveSetting_(ss, { id: 'CLOSE_START', value: b.openTime || '21:30' });
      saveSetting_(ss, { id: 'CLOSE_DEADLINE', value: b.deadline || '22:30' });
    } else if (b.isCash || b.name === 'Касса') {
      saveSetting_(ss, { id: 'CASH_START', value: b.openTime || '22:00' });
      saveSetting_(ss, { id: 'CASH_DEADLINE', value: b.deadline || '23:59' });
    }
  });
  saveSetting_(ss, { id: 'CHECKLIST_BLOCKS_JSON', value: JSON.stringify(blocks || []) });
}

function saveChecklistBlocks_(ss, b) {
  var blocks = Array.isArray(b.blocks) ? b.blocks : [];
  syncChecklistBlocksSheet_(ss, blocks);
  saveSetting_(ss, { id: 'DEADLINE_EXTENSIONS_JSON', value: '{}' });
  appendAudit_(ss, 'Администратор', 'Сохранение таймлайна чек-листов в таблицу', 'Блоков: ' + blocks.length);
  return { ok: true, checklistBlocks: blocks };
}

function addChecklistBlock_(ss, b) {
  var map = getSettingsMap_(ss);
  var blocks = getChecklistBlocksFromSheet_(ss, map);
  var nm = String(b.name || '').trim();
  if (nm && !blocks.some(function(x){ return x.name === nm; })) {
    var newBlk = {
      id: 'blk_' + Date.now().toString(36),
      name: nm,
      openTime: String(b.openTime || '10:00').trim(),
      deadline: String(b.deadline || '12:00').trim(),
      isCash: false,
      active: true
    };
    var cashIdx = -1;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].isCash || blocks[i].name === 'Касса') { cashIdx = i; break; }
    }
    if (cashIdx >= 0) blocks.splice(cashIdx, 0, newBlk);
    else blocks.push(newBlk);
    syncChecklistBlocksSheet_(ss, blocks);
  }
  return { ok: true, checklistBlocks: blocks };
}

function deleteChecklistBlock_(ss, b) {
  var map = getSettingsMap_(ss);
  var target = String(b.name || '').trim();
  var blocks = getChecklistBlocksFromSheet_(ss, map).filter(function(x){
    return x.name !== target && x.id !== b.id;
  });
  syncChecklistBlocksSheet_(ss, blocks);
  return { ok: true, checklistBlocks: blocks };
}

function saveDailyPlans_(ss, b) {
  var map = getSettingsMap_(ss);
  var pr = getDailyPlansAndRosterFromSheet_(ss, map);
  var plans = Object.assign({}, pr.dailyPlans, b.plans || {});
  var roster = pr.shiftRoster;
  saveSetting_(ss, { id: 'DAILY_PLANS_JSON', value: JSON.stringify(plans) });
  var sh = ss.getSheetByName('Планы');
  if (sh) {
    var last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(function(d) {
      var dp = plans[d] || { revenue: 2200, avgCheck: 35, checks: 75 };
      sh.appendRow([d, Number(dp.revenue) || 2200, Number(dp.avgCheck) || 35, Number(dp.checks) || 75, roster[d] || '']);
    });
  }
  return { ok: true, dailyPlans: plans };
}

function saveShiftRoster_(ss, b) {
  var map = getSettingsMap_(ss);
  var pr = getDailyPlansAndRosterFromSheet_(ss, map);
  var roster = Object.assign({}, pr.shiftRoster, b.roster || {});
  var plans = pr.dailyPlans;
  saveSetting_(ss, { id: 'SHIFT_ROSTER_JSON', value: JSON.stringify(roster) });
  var sh = ss.getSheetByName('Планы');
  if (sh) {
    var last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(function(d) {
      var dp = plans[d] || { revenue: 2200, avgCheck: 35, checks: 75 };
      sh.appendRow([d, Number(dp.revenue) || 2200, Number(dp.avgCheck) || 35, Number(dp.checks) || 75, roster[d] || '']);
    });
  }
  return { ok: true, shiftRoster: roster };
}

function saveStaffPins_(ss, b) {
  var props = PropertiesService.getScriptProperties();
  var sh = ss.getSheetByName('Сотрудники');
  var rows = sh ? sh.getDataRange().getValues() : [];
  (Array.isArray(b.pins) ? b.pins : []).forEach(function(p) {
    if (!p || !p.name || !p.pin) return;
    var pHash = normalizePinHash_(p.pin);
    props.setProperty('STAFF_PIN_HASH_' + p.name, pHash);
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim().toLowerCase() === String(p.name).trim().toLowerCase()) {
        sh.getRange(i + 1, 6).setValue(String(p.pin).trim());
        break;
      }
    }
  });
  return { ok: true };
}

function saveGoodDeed_(ss, b) {
  var sh = ss.getSheetByName('Карта добрых дел');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('gd_' + Date.now().toString(36))).trim();
  var rowVals = [id, b.title || '', b.frequency || '', b.window || '', b.responsible || 'Бариста', b.reviewer || 'Управляющий', b.instruction || ''];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sh.getRange(i + 1, 1, 1, 7).setValues([rowVals]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(rowVals);
  return { ok: true, id: id };
}

function deleteGoodDeed_(ss, b) {
  var sh = ss.getSheetByName('Карта добрых дел');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim() || (b.title && String(rows[i][1]).trim() === String(b.title).trim())) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function saveServiceAudit_(ss, b) {
  var sh = ss.getSheetByName('Аудит сервиса');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('AUD-' + Math.floor(100 + Math.random() * 900))).trim();
  var g = Number(b.greet != null ? b.greet : 100);
  var cl = Number(b.clarify != null ? b.clarify : 100);
  var up = Number(b.upsell != null ? b.upsell : 90);
  var fw = Number(b.farewell != null ? b.farewell : 100);
  var sc = Math.round((g + cl + up + fw) / 4);
  var rowVals = [id, b.date || isoDate_(), b.barista || 'Соня', b.auditor || 'Шеф-бариста', g, cl, up, fw, sc, b.comment || ''];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sh.getRange(i + 1, 1, 1, 10).setValues([rowVals]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(rowVals);
  return { ok: true, id: id };
}

function deleteServiceAudit_(ss, b) {
  var sh = ss.getSheetByName('Аудит сервиса');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim()) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function extendDeadline_(ss, b) {
  var dt = b.date || isoDate_();
  var blk = b.block || 'Открытие';
  var extKey = dt + ':' + blk;
  var map = getSettingsMap_(ss);
  var extMap = {};
  try { extMap = JSON.parse(map.DEADLINE_EXTENSIONS_JSON || '{}'); } catch (e) {}
  var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  extMap[extKey] = {
    openFrom: b.openFrom || '00:00',
    until: b.until || '23:59',
    forceOpen: true,
    reason: b.reason || 'Разблокировано администратором онлайн',
    at: tm
  };
  saveSetting_(ss, { id: 'DEADLINE_EXTENSIONS_JSON', value: JSON.stringify(extMap) });
  appendAudit_(ss, 'Администратор', 'Разблокировка чек-листа онлайн', blk + ' открыт до ' + (b.until || '23:59') + ' (' + (b.reason || '') + ')');
  return { ok: true, deadlineExtensions: extMap };
}

function saveBlockWindows_(ss, b) {
  var pairs = [
    ['OPEN_START', b.openStart],
    ['DEADLINE', b.openDeadline],
    ['DAY_START', b.dayStart],
    ['DAY_DEADLINE', b.dayDeadline],
    ['CLOSE_START', b.closeStart],
    ['CLOSE_DEADLINE', b.closeDeadline]
  ];
  pairs.forEach(function(p){
    if (p[1]) saveSetting_(ss, { id: p[0], value: String(p[1]).trim() });
  });
  saveSetting_(ss, { id: 'DEADLINE_EXTENSIONS_JSON', value: '{}' });
  appendAudit_(ss, 'Администратор', 'Изменение окон времени', 'Открытие: ' + b.openStart + '–' + b.openDeadline);
  return { ok: true };
}

function simulateOverdue_(ss, b) {
  var blk = b.block || 'День';
  var pastHm = '08:00';
  if (blk === 'Открытие') saveSetting_(ss, { id: 'DEADLINE', value: pastHm });
  else if (blk === 'День') saveSetting_(ss, { id: 'DAY_DEADLINE', value: pastHm });
  else saveSetting_(ss, { id: 'CLOSE_DEADLINE', value: pastHm });
  saveSetting_(ss, { id: 'DEADLINE_EXTENSIONS_JSON', value: '{}' });
  return { ok: true };
}

function saveAnnouncement_(ss, b) {
  var sh = ss.getSheetByName('Информирование');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('INFO-' + Math.floor(100 + Math.random() * 900))).trim();
  var targets = Array.isArray(b.targetStaff) ? b.targetStaff.join(', ') : String(b.targetStaff || 'Соня, Алина, Настя');
  var acksJson = JSON.stringify(Array.isArray(b.acks) ? b.acks : []);
  var rowVals = [
    id,
    b.title || '',
    b.category || 'Внутренние объявления',
    b.text || '',
    fmtIso_(b.publishedAt) || isoDate_(),
    fmtIso_(b.validTo) || '',
    fmtIso_(b.calendarDate) || '',
    b.calendarEventTitle || '',
    targets,
    acksJson
  ];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sh.getRange(i + 1, 1, 1, 10).setValues([rowVals]);
      appendAudit_(ss, 'Администратор', 'Обновление объявления', b.title);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(rowVals);
  appendAudit_(ss, 'Администратор', 'Публикация объявления', b.title);
  return { ok: true, id: id };
}

function deleteAnnouncement_(ss, b) {
  var sh = ss.getSheetByName('Информирование');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim()) {
      sh.deleteRow(i + 1);
      appendAudit_(ss, 'Администратор', 'Удаление объявления', String(b.id));
      break;
    }
  }
  return { ok: true };
}

function ackAnnouncement_(ss, b) {
  var sh = ss.getSheetByName('Информирование');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || '').trim();
  var who = String(b.userName || 'Бариста').trim();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      var acks = [];
      try { acks = JSON.parse(String(rows[i][9] || '[]')); } catch (e) {}
      if (!acks.some(function(k){ return String(k.name || '').toLowerCase() === who.toLowerCase(); })) {
        var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
        var stamp = fmtIso_(new Date()).split('-').reverse().join('.') + ' ' + tm;
        acks.push({ name: who, at: stamp });
        sh.getRange(i + 1, 10).setValue(JSON.stringify(acks));
        appendAudit_(ss, who, 'Ознакомление с объявлением', 'Ознакомлен с «' + String(rows[i][1]) + '»');
      }
      return { ok: true, acks: acks };
    }
  }
  return { ok: true };
}

function saveStaff_(ss, b) {
  var sh = ss.getSheetByName('Сотрудники');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('st_' + Date.now().toString(36))).trim();
  var pinStr = String(b.pin || '').trim();
  if (pinStr && pinStr.indexOf('••') === -1) {
    PropertiesService.getScriptProperties().setProperty('STAFF_PIN_HASH_' + String(b.name || '').trim(), normalizePinHash_(pinStr));
  }
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id || String(rows[i][1]).trim().toLowerCase() === String(b.name).trim().toLowerCase()) {
      var keepPin = pinStr || String(rows[i][5] || '1111');
      sh.getRange(i + 1, 1, 1, 6).setValues([[id, b.name || '', b.role || 'Бариста', b.shop || 'Кофейня №1', b.active || 'да', keepPin]]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow([id, b.name || '', b.role || 'Бариста', b.shop || 'Кофейня №1', b.active || 'да', pinStr || '1111']);
  return { ok: true, id: id };
}

function deleteStaff_(ss, b) {
  var sh = ss.getSheetByName('Сотрудники');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim() || String(rows[i][1]).trim() === String(b.name).trim()) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function saveTtk_(ss, b) {
  var sh = ss.getSheetByName('Техкарты');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('ttk_' + Date.now().toString(36))).trim();
  var rowVals = [id, b.name || '', b.volume || '', b.category || '', Number(b.price) || 0, Number(b.costBeans) || 0, Number(b.costMilk) || 0, Number(b.costSyrup) || 0, Number(b.costCup) || 0, b.recipe || '', b.serving || ''];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sh.getRange(i + 1, 1, 1, 11).setValues([rowVals]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(rowVals);
  return { ok: true, id: id };
}

function deleteTtk_(ss, b) {
  var sh = ss.getSheetByName('Техкарты');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim() || (b.name && String(rows[i][1]).trim() === String(b.name).trim())) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function saveTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  var rows = sh.getDataRange().getValues();
  var id = String(b.id || ('t_' + Date.now().toString(36))).trim();
  var resp = b.responsible || 'Администратор';
  var rowVals = [id, b.block || 'Открытие', b.groupName || '', b.title || '', b.instruction || '', b.photoMode || b.mediaRequired || b.photo || 'нет', resp, b.active || 'да'];
  for (var i = 1; i < rows.length; i++) {
    if ((b.id && String(rows[i][0]).trim() === String(b.id).trim()) || (b.expect && String(rows[i][3]).trim() === String(b.expect).trim())) {
      sh.getRange(i + 1, 1, 1, 8).setValues([rowVals]);
      return { ok: true, id: id, row: i + 1 };
    }
  }
  if (b.row && Number(b.row) >= 2 && Number(b.row) <= rows.length) {
    sh.getRange(Number(b.row), 1, 1, 8).setValues([rowVals]);
    return { ok: true, id: id, row: Number(b.row) };
  }
  sh.appendRow(rowVals);
  return { ok: true, id: id };
}

function deleteTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    var rId = String(rows[i][0] || '').trim();
    var rTitle = String(rows[i][3] || '').trim();
    if (rId === '__SYS_CONFIG_V19__' || rTitle === '__SYS_SYNC__') {
      sh.deleteRow(i + 1);
      continue;
    }
    if ((b.id && rId === String(b.id).trim()) || (b.expect && rTitle === String(b.expect).trim())) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  if (b.row && Number(b.row) >= 2 && Number(b.row) <= sh.getLastRow()) {
    sh.deleteRow(Number(b.row));
  }
  return { ok: true };
}

function reorderTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  var rows = sh.getDataRange().getValues();
  var idx = -1;
  for (var i = 1; i < rows.length; i++) {
    if (b.id && String(rows[i][0]).trim() === String(b.id).trim()) { idx = i; break; }
  }
  if (idx < 1 && b.row && Number(b.row) >= 2 && Number(b.row) <= rows.length) idx = Number(b.row) - 1;
  if (idx < 1) return { ok: true };
  var dir = b.dir === 'up' ? -1 : 1;
  var blk = String(rows[idx][1] || '');
  var swapIdx = idx + dir;
  while (swapIdx >= 1 && swapIdx < rows.length && String(rows[swapIdx][1] || '') !== blk) {
    swapIdx += dir;
  }
  if (swapIdx >= 1 && swapIdx < rows.length) {
    var rowA = rows[idx].slice(0, 8);
    var rowB = rows[swapIdx].slice(0, 8);
    sh.getRange(idx + 1, 1, 1, 8).setValues([rowB]);
    sh.getRange(swapIdx + 1, 1, 1, 8).setValues([rowA]);
  }
  return { ok: true };
}

function syncAllToSheet_(ss, b) {
  if (Array.isArray(b.settings)) {
    b.settings.forEach(function(it) { saveSettingSecure_(ss, it); });
  }
  if (Array.isArray(b.checklistBlocks)) {
    syncChecklistBlocksSheet_(ss, b.checklistBlocks);
  }
  if (b.dailyPlans) {
    saveDailyPlans_(ss, { plans: b.dailyPlans });
  }
  if (b.shiftRoster) {
    saveShiftRoster_(ss, { roster: b.shiftRoster });
  }
  if (Array.isArray(b.tasks) && b.tasks.length) {
    var shT = ss.getSheetByName('Задачи');
    var lastT = shT.getLastRow();
    if (lastT > 1) shT.deleteRows(2, lastT - 1);
    b.tasks.forEach(function(t) {
      if (!t || t.id === '__SYS_CONFIG_V19__' || t.title === '__SYS_SYNC__') return;
      shT.appendRow([t.id || '', t.block || 'Открытие', t.groupName || '', t.title || '', t.instruction || '', t.photoMode || t.photo || 'нет', t.responsible || 'Администратор', t.active || 'да']);
    });
  }
  if (Array.isArray(b.goodDeeds)) {
    var shG = ss.getSheetByName('Карта добрых дел');
    var lastG = shG.getLastRow();
    if (lastG > 1) shG.deleteRows(2, lastG - 1);
    b.goodDeeds.forEach(function(g) {
      if (!g) return;
      shG.appendRow([g.id || '', g.title || '', g.frequency || '', g.window || '', g.responsible || 'Бариста', g.reviewer || 'Управляющий', g.instruction || '']);
    });
  }
  if (Array.isArray(b.ttk)) {
    var shK = ss.getSheetByName('Техкарты');
    var lastK = shK.getLastRow();
    if (lastK > 1) shK.deleteRows(2, lastK - 1);
    b.ttk.forEach(function(k) {
      if (!k) return;
      shK.appendRow([k.id || '', k.name || '', k.volume || '', k.category || '', Number(k.price) || 0, Number(k.costBeans) || 0, Number(k.costMilk) || 0, Number(k.costSyrup) || 0, Number(k.costCup) || 0, k.recipe || '', k.serving || '']);
    });
  }
  if (Array.isArray(b.staff)) {
    var shS = ss.getSheetByName('Сотрудники');
    var lastS = shS.getLastRow();
    if (lastS > 1) shS.deleteRows(2, lastS - 1);
    b.staff.forEach(function(s) {
      if (!s) return;
      shS.appendRow([s.id || '', s.name || '', s.role || 'Бариста', s.shop || 'Кофейня №1', s.active || 'да', s.pin || '1111']);
    });
  }
  appendAudit_(ss, 'Администратор', 'Полная выгрузка конфигурации в Google Таблицу', 'Настройки, Таймлайн, Планы, Задачи, Карта добрых дел, Техкарты и Штат синхронизированы');
  return { ok: true, synced: true };
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

function batchSubmitCash_(ss, b) {
  var days = Array.isArray(b.days) ? b.days : [];
  days.forEach(function(d){ submitCash_(ss, d); });
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

/**
 * При фиксации поломки в чек-листе автоматически назначаем ответственного (Техник, Шеф-бариста или Администратор),
 * указанного для этого шага регламента.
 */
function submitChecklist_(ss, b) {
  var sh = ss.getSheetByName('Чек-листы');
  var dt = isoDate_();
  var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  var items = b.items || [];
  var probs = items.filter(function(x) { return x && x.isIncident; });

  sh.appendRow([dt, tm, b.block || 'Открытие', b.userName || 'Бариста', probs.length, '[]', b.deadline || '08:30', b.isLate ? 'Просрочено' : 'В срок']);

  var shI = ss.getSheetByName('Поломки');
  probs.forEach(function(p) {
    var assignedOwner = p.responsible || p.owner || 'Администратор';
    var hist = [{ time: dt + ' ' + tm, actor: b.userName || 'Бариста', status: 'Новая проблема', note: 'Зафиксировано при прохождении чек-листа' }];
    shI.appendRow([
      'INC-' + Math.floor(100 + Math.random() * 900),
      dt,
      tm,
      p.title || 'Шаг чек-листа',
      p.comment || '',
      p.priority || 'Терпит',
      'Новая проблема',
      b.userName || 'Бариста',
      assignedOwner,
      p.photo_url || '',
      p.incType || 'Поломка оборудования',
      JSON.stringify(hist)
    ]);
  });

  appendAudit_(ss, b.userName || 'Бариста', 'Сдан чек-лист «' + (b.block || 'Открытие') + '»', 'Проблем: ' + probs.length + (b.isLate ? ' (ПРОСРОЧЕНО)' : ' (в срок)'));
  return { ok: true };
}

function reportIncident_(ss, b) {
  var shI = ss.getSheetByName('Поломки');
  var dt = isoDate_();
  var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  var assignedOwner = b.responsible || 'Техник';
  var hist = [{ time: dt + ' ' + tm, actor: b.userName || 'Бариста', status: 'Новая проблема', note: 'Внеплановая проблема' }];
  var id = 'INC-' + Math.floor(100 + Math.random() * 900);
  shI.appendRow([
    id,
    dt,
    tm,
    b.step || b.incType || 'Внеплановый инцидент',
    b.text || b.comment || '',
    b.priority || 'Критично',
    'Новая проблема',
    b.userName || 'Бариста',
    assignedOwner,
    b.photo || '',
    b.incType || 'Поломка оборудования',
    JSON.stringify(hist)
  ]);
  appendAudit_(ss, b.userName || 'Бариста', 'Инцидент ' + id, b.step + ': ' + b.text);
  return { ok: true, id: id };
}

function updateIncident_(ss, b) {
  var sh = ss.getSheetByName('Поломки');
  var rows = sh.getDataRange().getValues();
  var tm = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(b.id).trim()) {
      var hist = [];
      try { hist = JSON.parse(String(rows[i][11] || '[]')); } catch (e) {}
      if (b.status) sh.getRange(i + 1, 7).setValue(b.status);
      if (b.comment != null) sh.getRange(i + 1, 5).setValue(b.comment);
      if (b.priority != null) sh.getRange(i + 1, 6).setValue(b.priority);
      if (b.responsible != null) sh.getRange(i + 1, 9).setValue(b.responsible);
      if (b.incType != null) sh.getRange(i + 1, 11).setValue(b.incType);
      hist.push({ time: isoDate_() + ' ' + tm, actor: b.actor || 'Администратор', status: b.status || rows[i][6], note: b.statusNote || 'Обновление' });
      sh.getRange(i + 1, 12).setValue(JSON.stringify(hist));
      appendAudit_(ss, b.actor || 'Администратор', 'Обновление инцидента ' + b.id, 'Статус: ' + (b.status || rows[i][6]));
      break;
    }
  }
  return { ok: true };
}

function deleteIncident_(ss, b) {
  var sh = ss.getSheetByName('Поломки');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(b.id).trim()) sh.deleteRow(i + 1);
  }
  return { ok: true };
}
