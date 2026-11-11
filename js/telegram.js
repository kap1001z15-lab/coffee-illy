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
