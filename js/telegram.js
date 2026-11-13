/* =========================================================================
   МОДУЛЬ СЕРВЕРНЫХ УВЕДОМЛЕНИЙ И TELEGRAM MINI APP (js/telegram.js — v60)
   1. Серверные уведомления Telegram через Google Apps Script (PropertiesService).
   2. Полноценный контроллер Telegram Mini App (window.coffeeTgMiniApp):
      - Автопривязка initDataUnsafe.user.id / @username к профилю сотрудника (Алина, Соня, Настя, Максим)
        для мгновенного входа в ILLY_BOT без выбора имени и без ввода PIN-кода.
      - Синхронизация состояния через Telegram.WebApp.CloudStorage между телефоном и ПК.
      - Управление системной кнопкой BackButton, HapticFeedback, disableVerticalSwipes и цветами темы.
   ========================================================================= */
window.coffeeTelegram = {
  async detectChatId(tokenOpt) {
    const cleanTok = String(tokenOpt || '').trim();
    if (cleanTok && cleanTok.indexOf('••') === -1 && typeof fetch === 'function') {
      try {
        const r = await fetch('https://api.telegram.org/bot' + encodeURIComponent(cleanTok) + '/getUpdates?limit=10');
        const d = await r.json();
        if (d && d.ok && Array.isArray(d.result)) {
          for (let i = d.result.length - 1; i >= 0; i--) {
            const msg = d.result[i].message || d.result[i].channel_post || d.result[i].my_chat_member;
            const ch = msg && msg.chat;
            if (ch && ch.id) {
              return { chatId: String(ch.id), title: ch.title || ch.username || ch.first_name || 'Чат Telegram' };
            }
          }
        }
      } catch (_) {}
    }
    throw new Error('Напишите любое сообщение вашему боту в Telegram и нажмите кнопку снова (или укажите Chat ID вручную)');
  },
  getConfig() {
    const db = typeof getUDB === 'function' ? getUDB() : {};
    const sMap = {};
    (db.settings || []).forEach((s) => { sMap[s.id] = s.value; });
    const rawChat = String(sMap.TG_CHAT || '').trim();
    const chats = rawChat.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const configured = !!(db.tgConfiguredOnServer || (sMap.TG_TOKEN && String(sMap.TG_TOKEN).trim()) || chats.length);
    return {
      configured,
      serverManaged: true,
      chats
    };
  },

  async saveServerCredentials(tgToken, tgChat) {
    const apiUrl = window.COFFEE && window.COFFEE.API_URL;
    if (!apiUrl || typeof fetch !== 'function') return { ok: false, error: 'API_URL не задан' };
    const sessionToken = window.coffeeAuth ? window.coffeeAuth.getSessionToken() : '';
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'save_telegram_credentials',
          sessionToken,
          tgToken: String(tgToken || '').trim(),
          tgChat: String(tgChat || '').trim()
        })
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },

  async _sendViaServer(type, text, extra) {
    const apiUrl = window.COFFEE && window.COFFEE.API_URL;
    if (!apiUrl || typeof fetch !== 'function') return { ok: false, skipped: true };
    try {
      const payload = Object.assign({
        action: 'send_telegram_alert',
        type: type || 'info',
        text: String(text || ''),
        sessionToken: window.coffeeAuth ? window.coffeeAuth.getSessionToken() : ''
      }, extra || {});
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { ok: false, offlineQueued: true, error: String((e && e.message) || e) };
    }
  },

  async sendIncidentAlert(inc) {
    if (!inc) return { ok: false };
    const msg =
      '🚨 ПОЛОМКА / ЭКШН-ПЛАН (24ч)\n' +
      '📍 Точка: ' + ((typeof getUDB === 'function' && getUDB().location) || 'Кофейня №1') + '\n' +
      '🔧 Участок: ' + (inc.step || 'Оборудование') + '\n' +
      '⚠️ Срочность: ' + (inc.priority || 'Критично') + '\n' +
      '👷 Исполнитель: ' + (inc.responsible || 'Техник') + '\n' +
      '👁 Проверяющий: ' + (inc.reviewer || 'Управляющий смены') + '\n' +
      '📝 Описание: ' + (inc.text || 'Без описания');
    return this._sendViaServer('incident', msg, { incidentId: inc.id });
  },

  async sendOverdueAlert(info) {
    if (!info) return { ok: false };
    const msg =
      '⏰ ПРОСРОЧКА ЧЕК-ЛИСТА\n' +
      '📋 Блок: ' + (info.block || 'Открытие') + '\n' +
      '👤 Дежурный: ' + (info.barista || 'Бариста') + '\n' +
      '⏱ Дедлайн был: ' + (info.deadline || '08:30');
    return this._sendViaServer('overdue', msg);
  },

  async sendStatusChangeAlert(inc, newStatus, comment) {
    if (!inc) return { ok: false };
    const msg =
      '🔄 ОБНОВЛЕНИЕ СТАТУСА ЭКШН-ПЛАНА\n' +
      '🆔 Задача: ' + (inc.id || '') + ' (' + (inc.step || '') + ')\n' +
      '📌 Статус: ' + (newStatus || inc.status || '') + '\n' +
      (comment ? '💬 Комментарий: ' + comment : '');
    return this._sendViaServer('status_change', msg);
  },

  async sendTestMessage() {
    return this._sendViaServer(
      'test',
      '✅ Серверная интеграция Telegram «Кофейня v60» работает! Токен защищён на сервере Apps Script (PropertiesService).'
    );
  },

  async sendCustomMessage(text) {
    return this._sendViaServer('digest', text);
  }
};


/* === ЕДИНЫЙ ЦЕНТР МГНОВЕННЫХ УВЕДОМЛЕНИЙ (TELEGRAM + ВНУТРИ ПРИЛОЖЕНИЯ + ОФЛАЙН-ОЧЕРЕДЬ) === */
window.coffeeNotify = {
  push(db, evt) {
    if (!db || !evt) return null;
    db.liveNotifications = Array.isArray(db.liveNotifications) ? db.liveNotifications : [];
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const item = {
      id: evt.id || ('NTF-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)),
      ts: Date.now(),
      date: (typeof _isoToday === 'function' ? _isoToday() : new Date().toISOString().slice(0, 10)),
      time: hm,
      level: evt.level || 'info',
      type: evt.type || 'system',
      title: String(evt.title || 'Уведомление'),
      text: String(evt.text || ''),
      actor: String(evt.actor || 'Терминал'),
      incId: String(evt.incId || ''),
      block: String(evt.block || ''),
      read: false
    };
    const dup = db.liveNotifications.find((n) => n && n.date === item.date && n.title === item.title && n.text === item.text && (item.ts - (n.ts || 0) < 60000));
    if (dup) return dup;
    db.liveNotifications.unshift(item);
    if (db.liveNotifications.length > 60) db.liveNotifications.length = 60;

    try {
      if (window.coffeeTelegram && evt.telegramText) {
        window.coffeeTelegram._sendViaServer(item.type, evt.telegramText, { notificationId: item.id });
      }
    } catch (_) {}

    try {
      if (window.coffeeBus && typeof window.coffeeBus.emit === 'function') {
        window.coffeeBus.emit('live_notification', item);
      }
    } catch (_) {}

    return item;
  },
  getUnreadCount(dbOpt) {
    const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
    return (db.liveNotifications || []).filter((n) => n && !n.read).length;
  },
  markAllRead() {
    if (typeof getUDB !== 'function' || typeof saveUDB !== 'function') return;
    const db = getUDB();
    (db.liveNotifications || []).forEach((n) => { if (n) n.read = true; });
    saveUDB(db);
    if (window.coffeeBus) window.coffeeBus.emit('mutation', { action: 'notifications_read' });
  }
};


/* =========================================================================
   КОНТРОЛЛЕР ПОЛНОЦЕННОГО TELEGRAM MINI APP (window.coffeeTgMiniApp — v60)
   - Извлекает initDataUnsafe.user.id / username / first_name
   - Автоматически привязывает Telegram User ID к профилю бариста (Алина, Соня, Настя, Максим)
   - Дублирует прогресс и привязку в Telegram.WebApp.CloudStorage для мгновенной синхронизации
   - Управляет BackButton, HapticFeedback, disableVerticalSwipes и цветами шапки Telegram
   ========================================================================= */
window.coffeeTgMiniApp = (function () {
  const TG_BIND_LOCAL_KEY = 'coffee_tg_bound_user_v1';
  const NAME_SYNONYMS = {
    'софия': 'Соня',
    'софья': 'Соня',
    'sonya': 'Соня',
    'sofia': 'Соня',
    'алина': 'Алина',
    'alina': 'Алина',
    'анастасия': 'Настя',
    'настя': 'Настя',
    'nastya': 'Настя',
    'anastasia': 'Настя',
    'максим': 'Максим',
    'макс': 'Максим',
    'maxim': 'Максим',
    'max': 'Максим'
  };

  function getWebApp() {
    try {
      return (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    } catch (_) {
      return null;
    }
  }

  function isInsideTelegram() {
    const tg = getWebApp();
    return !!(tg && (tg.initData || (tg.initDataUnsafe && tg.initDataUnsafe.user) || (tg.platform && tg.platform !== 'unknown')));
  }

  function getTgUser() {
    const tg = getWebApp();
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
      const u = tg.initDataUnsafe.user;
      return {
        id: String(u.id),
        username: String(u.username || '').trim(),
        firstName: String(u.first_name || '').trim(),
        lastName: String(u.last_name || '').trim(),
        fullName: [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
      };
    }
    // Резервное извлечение из location.hash (#tgWebAppData=...)
    try {
      if (typeof location !== 'undefined' && location.hash && location.hash.indexOf('tgWebAppData=') >= 0) {
        const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
        const rawInit = hp.get('tgWebAppData') || '';
        if (rawInit) {
          const ip = new URLSearchParams(rawInit);
          const uJson = ip.get('user');
          if (uJson) {
            const u = JSON.parse(uJson);
            if (u && u.id) {
              return {
                id: String(u.id),
                username: String(u.username || '').trim(),
                firstName: String(u.first_name || '').trim(),
                lastName: String(u.last_name || '').trim(),
                fullName: [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
              };
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function initMiniAppShell(themeMode) {
    const tg = getWebApp();
    if (!tg) return;
    const isDark = (themeMode || (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'light') === 'dark';
    const bgHex = isDark ? '#121316' : '#f6f4f0';
    const surfHex = isDark ? '#1a1c20' : '#ffffff';
    try { if (typeof tg.ready === 'function') tg.ready(); } catch (_) {}
    try { if (typeof tg.expand === 'function') tg.expand(); } catch (_) {}
    try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch (_) {}
    try { if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor(bgHex); } catch (_) {}
    try { if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor(surfHex); } catch (_) {}
    try { if (typeof tg.setBottomBarColor === 'function') tg.setBottomBarColor(surfHex); } catch (_) {}
  }

  function resolveBoundStaffName(dbOpt) {
    const tgUser = getTgUser();
    if (!tgUser || !tgUser.id) return '';
    const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
    const staffList = Array.isArray(db.staff) && db.staff.length
      ? db.staff.filter((s) => s && s.active !== 'нет')
      : ((window.COFFEE_MVP && window.COFFEE_MVP.DEFAULT_STAFF) || []);

    // 1. Проверяем локальный кэш привязки этого Telegram ID
    try {
      const rawLoc = localStorage.getItem(TG_BIND_LOCAL_KEY);
      if (rawLoc) {
        const parsed = JSON.parse(rawLoc);
        if (parsed && String(parsed.tgId) === tgUser.id && parsed.staffName) {
          if (staffList.some((s) => s.name === parsed.staffName)) return parsed.staffName;
        }
      }
    } catch (_) {}

    // 2. Проверяем облачную карту привязок db.tgUserBindings[tgUser.id]
    if (db.tgUserBindings && db.tgUserBindings[tgUser.id] && db.tgUserBindings[tgUser.id].staffName) {
      const boundName = db.tgUserBindings[tgUser.id].staffName;
      if (staffList.some((s) => s.name === boundName)) return boundName;
    }

    // 3. Проверяем поле tgId непосредственно в карточках сотрудников (Штат)
    const cleanUname = tgUser.username.replace(/^@/, '').toLowerCase();
    for (let i = 0; i < staffList.length; i++) {
      const st = staffList[i];
      const stTg = String(st.tgId || '').trim();
      if (!stTg) continue;
      if (stTg === tgUser.id) return st.name;
      if (cleanUname && stTg.replace(/^@/, '').toLowerCase() === cleanUname) return st.name;
    }

    // 4. Автоматическое сопоставление по имени в профиле Telegram (например, Алина, Соня, Настя, Максим)
    const fLow = tgUser.firstName.toLowerCase();
    const fullLow = tgUser.fullName.toLowerCase();
    for (let i = 0; i < staffList.length; i++) {
      const sName = String(staffList[i].name || '').trim();
      const sLow = sName.toLowerCase();
      if (sLow && (fLow === sLow || fullLow.indexOf(sLow) === 0)) {
        return sName;
      }
    }
    if (NAME_SYNONYMS[fLow] && staffList.some((s) => s.name === NAME_SYNONYMS[fLow])) {
      return NAME_SYNONYMS[fLow];
    }
    return '';
  }

  function bindStaffToCurrentTgUser(staffName) {
    const cleanStaff = String(staffName || '').trim();
    if (!cleanStaff) return null;
    const tgUser = getTgUser();
    const nowTs = Date.now();
    const bindRec = {
      tgId: tgUser ? tgUser.id : '',
      tgUsername: tgUser ? tgUser.username : '',
      tgFirstName: tgUser ? tgUser.firstName : '',
      staffName: cleanStaff,
      updatedAt: nowTs
    };
    try {
      localStorage.setItem(TG_BIND_LOCAL_KEY, JSON.stringify(bindRec));
      localStorage.setItem('coffee_active_barista', cleanStaff);
      localStorage.setItem('coffee_term_pin_unlocked_v1', cleanStaff);
      sessionStorage.setItem('coffee_term_pin_unlocked_v1', cleanStaff);
    } catch (_) {}

    // Сохраняем в Telegram.WebApp.CloudStorage для мгновенного распознавания на всех устройствах этого Telegram-аккаунта
    const tg = getWebApp();
    if (tg && tg.CloudStorage && typeof tg.CloudStorage.setItem === 'function') {
      try {
        tg.CloudStorage.setItem('coffee_bound_staff', cleanStaff, () => {});
      } catch (_) {}
    }

    if (tgUser && tgUser.id && typeof getUDB === 'function' && typeof saveUDB === 'function') {
      try {
        const db = getUDB();
        db.tgUserBindings = (db.tgUserBindings && typeof db.tgUserBindings === 'object') ? db.tgUserBindings : {};
        db.tgUserBindings[tgUser.id] = bindRec;
        if (Array.isArray(db.staff)) {
          const st = db.staff.find((s) => s && String(s.name || '').toLowerCase() === cleanStaff.toLowerCase());
          if (st && !st.tgId) {
            st.tgId = tgUser.username ? ('@' + tgUser.username.replace(/^@/, '') + ' (' + tgUser.id + ')') : tgUser.id;
          }
        }
        saveUDB(db);
        if (window.coffeePushCloudEnvelopeNow) window.coffeePushCloudEnvelopeNow();
        if (window.coffeeFetch && window.COFFEE && window.COFFEE.API_URL) {
          window.coffeeFetch(window.COFFEE.API_URL, {
            method: 'POST',
            body: JSON.stringify({
              action: 'bind_telegram_user',
              tgId: tgUser.id,
              tgUsername: tgUser.username,
              tgFirstName: tgUser.firstName,
              staffName: cleanStaff,
              updatedAt: nowTs
            })
          }).catch(() => {});
        }
      } catch (_) {}
    }
    return bindRec;
  }

  function restoreFromTelegramCloudStorage(onRestored) {
    const tg = getWebApp();
    if (!tg || !tg.CloudStorage || typeof tg.CloudStorage.getItems !== 'function') return;
    try {
      tg.CloudStorage.getItems(['coffee_bound_staff', 'coffee_cloud_draft'], (err, vals) => {
        if (err || !vals) return;
        let changed = false;
        if (vals.coffee_bound_staff && typeof vals.coffee_bound_staff === 'string') {
          try {
            if (!localStorage.getItem('coffee_active_barista')) {
              localStorage.setItem('coffee_active_barista', vals.coffee_bound_staff);
              localStorage.setItem('coffee_term_pin_unlocked_v1', vals.coffee_bound_staff);
              sessionStorage.setItem('coffee_term_pin_unlocked_v1', vals.coffee_bound_staff);
              changed = true;
            }
          } catch (_) {}
        }
        if (vals.coffee_cloud_draft) {
          try {
            const remD = JSON.parse(vals.coffee_cloud_draft);
            if (remD && remD.date && remD.userName && remD.block && typeof getUDB === 'function') {
              const db = getUDB();
              db.userDrafts = db.userDrafts || {};
              const dKey = remD.date + ':' + remD.userName + ':' + remD.block;
              const locD = db.userDrafts[dKey];
              if (!locD || Number(remD.updatedAt || 0) > Number(locD.updatedAt || 0)) {
                db.userDrafts[dKey] = remD;
                if (typeof saveUDB === 'function') saveUDB(db);
                changed = true;
              }
            }
          } catch (_) {}
        }
        if (changed && typeof onRestored === 'function') onRestored(vals);
      });
    } catch (_) {}
  }

  function saveDraftToTelegramCloudStorage(draftObj) {
    const tg = getWebApp();
    if (!tg || !tg.CloudStorage || typeof tg.CloudStorage.setItem !== 'function' || !draftObj) return;
    try {
      const lite = {
        date: draftObj.date,
        block: draftObj.block,
        idx: draftObj.idx,
        userName: draftObj.userName,
        startedAt: draftObj.startedAt,
        completed: !!draftObj.completed,
        cleared: !!draftObj.cleared,
        updatedAt: draftObj.updatedAt || Date.now(),
        answers: (draftObj.answers || []).map((a) => a ? {
          id: a.id,
          title: a.title,
          choiceMade: !!a.choiceMade,
          isIncident: !!a.isIncident,
          incType: a.incType || '',
          comment: a.comment || '',
          priority: a.priority || 'Терпит',
          photo_url: (a.photo_url && String(a.photo_url).length < 1500) ? a.photo_url : '',
          completedAt: a.completedAt || ''
        } : null)
      };
      const str = JSON.stringify(lite);
      if (str.length <= 4000) {
        tg.CloudStorage.setItem('coffee_cloud_draft', str, () => {});
      }
    } catch (_) {}
  }

  function syncBackButton(shouldShow, onBackHandler) {
    const tg = getWebApp();
    if (!tg || !tg.BackButton) return;
    try {
      if (window._coffeeTgBackHandler) {
        tg.BackButton.offClick(window._coffeeTgBackHandler);
      }
      if (shouldShow && typeof onBackHandler === 'function') {
        window._coffeeTgBackHandler = onBackHandler;
        tg.BackButton.onClick(onBackHandler);
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    } catch (_) {}
  }

  return {
    getWebApp,
    isInsideTelegram,
    getTgUser,
    initMiniAppShell,
    resolveBoundStaffName,
    bindStaffToCurrentTgUser,
    restoreFromTelegramCloudStorage,
    saveDraftToTelegramCloudStorage,
    syncBackButton
  };
})();
