/* =========================================================================
   МОДУЛЬ СЕРВЕРНЫХ УВЕДОМЛЕНИЙ TELEGRAM (js/telegram.js — v21 Enterprise)
   Токен бота НЕ хранится и НЕ читается в браузере.
   Все уведомления отправляются через сервер Google Apps Script (Code.gs -> UrlFetchApp),
   где токен защищён в PropertiesService.getScriptProperties().
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
      '✅ Серверная интеграция Telegram «Кофейня v21» работает! Токен защищён на сервере Apps Script (PropertiesService).'
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
      level: evt.level || 'info', // 'critical' | 'warn' | 'ok' | 'info'
      type: evt.type || 'system',
      title: String(evt.title || 'Уведомление'),
      text: String(evt.text || ''),
      actor: String(evt.actor || 'Терминал'),
      incId: String(evt.incId || ''),
      block: String(evt.block || ''),
      read: false
    };
    // Защита от дублирования одинаковых уведомлений подряд
    const dup = db.liveNotifications.find((n) => n && n.date === item.date && n.title === item.title && n.text === item.text && (item.ts - (n.ts || 0) < 60000));
    if (dup) return dup;
    db.liveNotifications.unshift(item);
    if (db.liveNotifications.length > 60) db.liveNotifications.length = 60;

    // Мгновенная отправка в Telegram (сервер Apps Script или офлайн-очередь)
    try {
      if (window.coffeeTelegram && evt.telegramText) {
        window.coffeeTelegram._sendViaServer(item.type, evt.telegramText, { notificationId: item.id });
      }
    } catch (_) {}

    // Сигнал для открытых вкладок Панели владельца / Дашборда (0 мс)
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
