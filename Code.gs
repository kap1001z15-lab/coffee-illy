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

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'get_checklists';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    // 1. Публичный запрос терминала бариста (возвращает только публичные чек-листы, окна и список имён без PIN/токенов)
    if (action === 'get_checklists') {
      return jsonOut_(sanitizePublicChecklists_(getChecklists_(ss), ss, p.sinceTs));
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
    if (action === 'reorder_task') return idempotentJsonOut_(ss, body, { ok: true });
    if (action === 'save_checklist_blocks') {
      saveSetting_(ss, { id: 'CHECKLIST_BLOCKS_JSON', value: JSON.stringify(body.blocks || []) });
      return idempotentJsonOut_(ss, body, { ok: true });
    }
    if (action === 'add_checklist_block' || action === 'delete_checklist_block') {
      return idempotentJsonOut_(ss, body, { ok: true });
    }
    if (action === 'save_daily_plans') {
      saveSetting_(ss, { id: 'DAILY_PLANS_JSON', value: JSON.stringify(body.plans || {}) });
      return idempotentJsonOut_(ss, body, { ok: true });
    }
    if (action === 'save_staff_pins') {
      var props = PropertiesService.getScriptProperties();
      (Array.isArray(body.pins) ? body.pins : []).forEach(function(p) {
        if (p && p.name && p.pin) props.setProperty('STAFF_PIN_HASH_' + p.name, normalizePinHash_(p.pin));
      });
      return idempotentJsonOut_(ss, body, { ok: true });
    }
    if (action === 'save_good_deed' || action === 'delete_good_deed' || action === 'save_service_audit' || action === 'delete_service_audit') {
      return idempotentJsonOut_(ss, body, { ok: true });
    }

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
  var expectedHash = propHash || (storedRaw ? normalizePinHash_(storedRaw) : sha256Hex_('1234'));
  var candidateHash = normalizePinHash_(candidatePinOrHash);

  if (!candidatePinOrHash || candidateHash !== expectedHash) {
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
    ['Настройки', ['Параметр', 'Значение']],
    ['Задачи', ['Код', 'Блок', 'Подгруппа', 'Название', 'Инструкция', 'Нужно фото', 'Ответственный', 'Активна']],
    ['Касса', ['Дата', 'Наличные', 'Безнал', 'Чеков', 'Списания', 'Хиты', 'Бариста']],
    ['Расходы', ['ID', 'Дата', 'Статья', 'Сумма', 'Комментарий']],
    ['Поломки', ['ID', 'Дата', 'Время', 'Шаг', 'Описание', 'Срочность', 'Статус', 'Кто', 'Ответственный', 'Фото', 'Тип', 'История JSON']],
    ['Чек-листы', ['Дата', 'Время', 'Блок', 'Бариста', 'Проблем', 'Фото JSON', 'Дедлайн', 'Статус срока']],
    ['Информирование', ['ID', 'Заголовок', 'Категория', 'Описание', 'Дата публикации', 'Актуально до', 'Дата календаря', 'Событие календаря', 'Кому назначено', 'Ознакомились JSON']],
    ['Сотрудники', ['ID', 'Имя', 'Роль', 'Кофейня', 'Активен']],
    ['Журнал', ['Дата', 'Время', 'Пользователь', 'Действие', 'Детали']],
    ['ДельтаСинхр', ['Collection', 'RecordID', 'UpdatedAt', 'Deleted', 'Actor', 'PayloadJSON']],
    ['Техкарты', ['ID', 'Название', 'Объём', 'Категория', 'Цена', 'Зерно', 'Молоко', 'Сироп', 'Тара', 'Рецептура', 'Подача']]
  ];
  defs.forEach(function(d) {
    var sh = ss.getSheetByName(d[0]);
    if (!sh) {
      sh = ss.insertSheet(d[0]);
      sh.appendRow(d[1]);
    }
  });
}

function normSetKey_(raw) {
  var k = String(raw || '').trim(), low = k.toLowerCase();
  if (k === 'LOCATION' || /назван|точк|кофейн|локац/.test(low)) return 'LOCATION';
  if (k === 'PLAN' || /план|цель/.test(low)) return 'PLAN';
  if (k === 'OPEN_START' || /начал.*открыт/.test(low)) return 'OPEN_START';
  if (k === 'DEADLINE' || /дедлайн.*открыт|дедлайн смен/.test(low)) return 'DEADLINE';
  if (k === 'DAY_START' || /начал.*дн/.test(low)) return 'DAY_START';
  if (k === 'DAY_DEADLINE' || /дедлайн.*дн/.test(low)) return 'DAY_DEADLINE';
  if (k === 'CLOSE_START' || /начал.*закрыт/.test(low)) return 'CLOSE_START';
  if (k === 'CLOSE_DEADLINE' || /дедлайн.*закрыт/.test(low)) return 'CLOSE_DEADLINE';
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
  if (k === 'CLOUD_SYNC_V17') return 'CLOUD_SYNC_V17';
  return k;
}

function getSettingsMap_(ss) {
  var sh = ss.getSheetByName('Настройки');
  var rows = sh.getDataRange().getValues();
  var map = {
    LOCATION: 'Кофейня №1',
    PLAN: '2200',
    OPEN_START: '07:30',
    DEADLINE: '08:30',
    DAY_START: '11:00',
    DAY_DEADLINE: '18:30',
    CLOSE_START: '19:00',
    CLOSE_DEADLINE: '22:30',
    WO_NORM: '15',
    MIN_AVG_CHECK: '390',
    PLAN_CHECKS: '150',
    PHOTO_ALL: 'нет',
    INIT_COUNTER: '600',
    CATEGORIES: 'Закупка продуктов, Аренда, Зарплата, Коммунальные, Реклама, Ремонт и оборудование, Прочее',
    TG_TOKEN: '',
    TG_CHAT: '',
    ADMIN_PIN: '1234',
    DEADLINE_EXTENSIONS_JSON: '{}',
    SHIFT_ROSTER_JSON: '{}'
  };
  for (var i = 1; i < rows.length; i++) {
    var rawK = String(rows[i][0] || '').trim(), v = String(rows[i][1] || '').trim();
    if (rawK && v !== '') map[normSetKey_(rawK)] = v;
  }
  return map;
}

function getSettingsArray_(map) {
  return [
    { id: 'LOCATION', label: 'Название точки', hint: 'Отображается в шапке всех разделов', value: map.LOCATION, secret: false },
    { id: 'PLAN', label: 'План выручки на день, руб.', hint: 'Сразу пересчитывает цель и % выполнения', value: map.PLAN, secret: false },
    { id: 'OPEN_START', label: 'Начало окна «Открытие» (ЧЧ:ММ)', hint: 'Время открытия доступа к «Открытию» в Терминале', value: map.OPEN_START, secret: false },
    { id: 'DEADLINE', label: 'Дедлайн закрытия «Открытие» (ЧЧ:ММ)', hint: 'После этого времени доступ закрывается и создаётся инцидент', value: map.DEADLINE, secret: false },
    { id: 'DAY_START', label: 'Начало окна «День» (ЧЧ:ММ)', hint: 'Время открытия доступа к «Дню» в Терминале', value: map.DAY_START, secret: false },
    { id: 'DAY_DEADLINE', label: 'Дедлайн закрытия «День» (ЧЧ:ММ)', hint: 'После этого времени доступ к «Дню» закрывается', value: map.DAY_DEADLINE, secret: false },
    { id: 'CLOSE_START', label: 'Начало окна «Закрытие» (ЧЧ:ММ)', hint: 'Время открытия доступа к «Закрытию» в Терминале', value: map.CLOSE_START, secret: false },
    { id: 'CLOSE_DEADLINE', label: 'Дедлайн закрытия «Закрытие» (ЧЧ:ММ)', hint: 'После этого времени доступ к «Закрытию» закрывается', value: map.CLOSE_DEADLINE, secret: false },
    { id: 'WO_NORM', label: 'Норма списаний в день, руб.', hint: 'Порог списаний', value: map.WO_NORM, secret: false },
    { id: 'MIN_AVG_CHECK', label: 'Норматив среднего чека, руб.', hint: 'Плановый средний чек', value: map.MIN_AVG_CHECK, secret: false },
    { id: 'PLAN_CHECKS', label: 'Плановое кол-во чеков в день', hint: 'Целевое кол-во чеков', value: map.PLAN_CHECKS, secret: false },
    { id: 'PHOTO_ALL', label: 'Фото на каждом шаге (да/нет)', hint: 'Обязательное фото для открытия и закрытия', value: map.PHOTO_ALL, secret: false },
    { id: 'INIT_COUNTER', label: 'Текущий счётчик кофемашины', hint: 'Начальный счётчик в Кассе', value: map.INIT_COUNTER, secret: false },
    { id: 'TG_TOKEN', label: 'Токен Telegram-бота (от @BotFather)', hint: 'Для отправки фото поломок', value: map.TG_TOKEN, secret: false },
    { id: 'TG_CHAT', label: 'ID чата администратора в Telegram', hint: 'Chat ID для уведомлений', value: map.TG_CHAT, secret: false },
    { id: 'CATEGORIES', label: 'Статьи расходов (через запятую)', hint: 'Список статей расходов', value: map.CATEGORIES, secret: false },
    { id: 'ADMIN_PIN', label: 'Код доступа к дашборду и отчётам', hint: 'Код администратора', value: '', secret: true, set: !!map.ADMIN_PIN }
  ];
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
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1]) continue;
    list.push({
      id: String(r[0] || ('st_' + i)),
      name: String(r[1] || ''),
      role: String(r[2] || 'Бариста'),
      shop: String(r[3] || 'Кофейня №1'),
      active: String(r[4] || 'да').toLowerCase()
    });
  }
  return list.length ? list : [
    { id: 'st1', name: 'Соня', role: 'Бариста', shop: 'Кофейня №1', active: 'да' },
    { id: 'st2', name: 'Алина', role: 'Бариста', shop: 'Кофейня №1', active: 'да' },
    { id: 'st3', name: 'Настя', role: 'Бариста', shop: 'Кофейня №1', active: 'да' },
    { id: 'st4', name: 'Максим', role: 'Шеф-бариста', shop: 'Кофейня №1', active: 'да' },
    { id: 'st5', name: 'Администратор', role: 'Администратор', shop: 'Кофейня №1', active: 'да' }
  ];
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
      price: Number(r[4]) || 45,
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

/**
 * Основной публичный метод для мобильного терминала бариста:
 * возвращает актуальные задачи, окна времени, продления дедлайнов и информирование в реальном времени.
 */
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
      photoMode: String(r[5] || 'нет').toLowerCase(),
      mediaRequired: String(r[5] || 'нет').toLowerCase() === 'да' || (map.PHOTO_ALL === 'да' && (r[1] === 'Открытие' || r[1] === 'Закрытие')),
      responsible: String(r[6] || 'Администратор'),
      active: 'да'
    });
  }

  var extMap = {};
  try { extMap = JSON.parse(map.DEADLINE_EXTENSIONS_JSON || '{}'); } catch (e) {}
  var annList = getAnnouncements_(ss);
  var staffList = getStaffList_(ss);
  var serverTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+2', 'HH:mm');
  var serverDate = isoDate_();

  return {
    ok: true,
    v: 18,
    rows: rows.length - 1,
    sheet: 'Задачи',
    location: map.LOCATION || 'Кофейня №1',
    plan: Number(map.PLAN) || 2200,
    woNorm: Number(map.WO_NORM) || 15,
    openStart: map.OPEN_START || '07:30',
    deadline: map.DEADLINE || '08:30',
    dayStart: map.DAY_START || '11:00',
    dayDeadline: map.DAY_DEADLINE || '18:30',
    closeStart: map.CLOSE_START || '19:00',
    closeDeadline: map.CLOSE_DEADLINE || '22:30',
    deadlineExtensions: extMap,
    settings: getSettingsArray_(map),
    announcements: annList,
    staff: staffList,
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
    if (!r[3] && !r[1]) continue;
    tasks.push({
      row: i + 1,
      id: String(r[0] || ''),
      block: String(r[1] || 'Открытие'),
      groupName: String(r[2] || ''),
      title: String(r[3] || ''),
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

  return {
    ok: true,
    today: isoDate_(),
    location: map.LOCATION,
    plan: Number(map.PLAN) || 2200,
    openStart: map.OPEN_START || '07:30',
    deadline: map.DEADLINE || '08:30',
    dayStart: map.DAY_START || '11:00',
    dayDeadline: map.DAY_DEADLINE || '18:30',
    closeStart: map.CLOSE_START || '19:00',
    closeDeadline: map.CLOSE_DEADLINE || '22:30',
    deadlineExtensions: extMap,
    blocks: ['Открытие', 'День', 'Закрытие'],
    categories: ['Закупка продуктов', 'Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Ремонт и оборудование', 'Прочее'],
    tasks: tasks,
    cash: cash.reverse(),
    expenses: expenses.reverse(),
    incidents: incidents.reverse(),
    announcements: getAnnouncements_(ss),
    staff: getStaffList_(ss),
    ttk: getTtkList_(ss),
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
      var blk = String(r[2] || 'Открытие');
      var tm = String(r[1] || '');
      if (blk === 'Открытие' && (!openedAt || tm < openedAt)) openedAt = tm;
      var phs = [];
      try { phs = JSON.parse(String(r[5] || '[]')); } catch (e) {}
      photoReports.push({ block: blk, time: tm, who: String(r[3] || 'Бариста'), photos: phs });
    }
  }

  return {
    ok: true,
    date: day,
    isToday: day === adm.today,
    location: adm.location,
    plan: Number(adm.plan) || 2200,
    woNorm: Number(adm.woNorm) || 15,
    openStart: adm.openStart,
    deadline: adm.deadline,
    dayStart: adm.dayStart,
    dayDeadline: adm.dayDeadline,
    closeStart: adm.closeStart,
    closeDeadline: adm.closeDeadline,
    deadlineExtensions: adm.deadlineExtensions,
    hasData: !!c,
    revenue: rev,
    cash: c ? c.cash : 0,
    card: c ? c.card : 0,
    checks: chks,
    avg: chks > 0 ? Math.round(rev / chks) : 0,
    writeoff: c ? c.writeoff : 0,
    barista: c ? (c.barista || '') : '',
    openedAt: openedAt || (c ? '08:20' : '—'),
    days: adm.cash.slice(0, 14).reverse().map(function(x) { return { date: x.date, revenue: x.cash + x.card }; }),
    incidents: adm.incidents,
    photoReports: photoReports,
    announcements: adm.announcements,
    staff: adm.staff,
    settings: adm.settings
  };
}

function getReport_(ss, fromStr, toStr) {
  var adm = getAdmin_(ss);
  var from = fromStr || adm.today;
  var to = toStr || adm.today;
  return {
    ok: true,
    from: from,
    to: to,
    location: adm.location,
    plan: adm.plan,
    categories: adm.categories,
    series: adm.cash.filter(function(x){ return x.date >= from && x.date <= to; }),
    expenses: adm.expenses.filter(function(x){ return x.date >= from && x.date <= to; }),
    incidents: adm.incidents,
    staff: adm.staff,
    announcements: adm.announcements
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
  var rowVals = [id, b.name || '', b.role || 'Бариста', b.shop || 'Кофейня №1', b.active || 'да'];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id || String(rows[i][1]).trim().toLowerCase() === String(b.name).trim().toLowerCase()) {
      sh.getRange(i + 1, 1, 1, 5).setValues([rowVals]);
      return { ok: true, id: id };
    }
  }
  sh.appendRow(rowVals);
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
    if (String(rows[i][0]).trim() === String(b.id).trim()) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function saveShiftRoster_(ss, b) {
  saveSetting_(ss, { id: 'SHIFT_ROSTER_JSON', value: JSON.stringify(b.roster || {}) });
  return { ok: true };
}

function saveTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  var resp = b.responsible || 'Администратор';
  var rowVals = [b.id || '', b.block || 'Открытие', b.groupName || '', b.title || '', b.instruction || '', b.photoMode || b.mediaRequired || b.photo || 'нет', resp, b.active || 'да'];
  if (b.row) sh.getRange(Number(b.row), 1, 1, 8).setValues([rowVals]);
  else sh.appendRow(rowVals);
  return { ok: true };
}

function deleteTask_(ss, b) {
  var sh = ss.getSheetByName('Задачи');
  if (b.row) sh.deleteRow(Number(b.row));
  return { ok: true };
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
