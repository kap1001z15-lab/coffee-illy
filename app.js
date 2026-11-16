/* Единое ядро авторизации и защиты «Кофейня» (v21 Enterprise Security):
   - Использует подписанные токены сессии (window.coffeeAuth.isAuthorized) вместо флага coffee_admin_ok=1.
   - Защита от перебора PIN-кода: блокировка на 15 минут после 5 неверных попыток (window.coffeeRateLimiter).
   - Персональные и административные PIN-коды проверяются через солёный SHA-256 хеш и серверный auth_login. */
(function () {
  'use strict';
  const SHARED_DATE = 'coffee_shared_date';
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  const ls = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // Строгая проверка криптографической сессии (подстановка coffee_admin_ok=1 в консоли не работает!)
  const isAdmin = () => !!(window.coffeeAuth && window.coffeeAuth.isAuthorized('admin'));

  window.coffeeConfirm = function (message, onConfirm) {
    let dlg = document.getElementById('coffeeConfirmDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'coffeeConfirmDlg';
      dlg.style.cssText = 'border:1px solid var(--line,#292B30);border-radius:18px;background:var(--surface,#202126);color:var(--ink,#F2F0EC);padding:20px;width:min(440px,92vw);box-shadow:0 30px 60px -20px rgba(0,0,0,.6)';
      dlg.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<span style="display:inline-flex;width:28px;height:28px;border-radius:8px;background:color-mix(in srgb,var(--bad,#C65C50) 18%,transparent);color:var(--bad,#C65C50);align-items:center;justify-content:center;font-weight:800">!</span>' +
          '<h3 style="margin:0;font-size:18px;font-family:var(--font-d,sans-serif)">Подтверждение операции</h3>' +
        '</div>' +
        '<p id="ccMsg" style="margin:0 0 10px;color:var(--ink,#F2F0EC);font-size:14px;line-height:1.4"></p>' +
        '<div style="padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--warn,#D69A43) 12%,var(--bg,#151619));border:1px solid color-mix(in srgb,var(--warn,#D69A43) 40%,var(--line));font-size:12px;color:var(--muted,#898A91);margin-bottom:10px">' +
          'Операция будет зафиксирована в журнале аудита с указанием автора, времени и причины.' +
        '</div>' +
        '<div style="margin-bottom:14px">' +
          '<label for="ccReasonInp" style="display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#898A91);margin-bottom:4px">Причина отмены / удаления (обязательно)</label>' +
          '<input id="ccReasonInp" type="text" value="Ошибочный ввод / актуализация данных" placeholder="Укажите причину операции…" style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--line,#292B30);background:var(--bg,#151619);color:var(--ink,#F2F0EC);font-size:13px">' +
          '<div id="ccReasonErr" style="color:var(--bad,#C65C50);font-size:12px;min-height:16px;margin-top:4px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button type="button" id="ccNo" class="btn-secondary" style="border:1px solid var(--line,#292B30);background:var(--chip,#292B30);color:var(--ink,#F2F0EC);border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer">Оставить без изменений</button>' +
          '<button type="button" id="ccYes" class="btn-danger" style="border:0;background:var(--bad,#C65C50);color:#fff;border-radius:10px;padding:8px 16px;font-weight:700;cursor:pointer">Подтвердить</button>' +
        '</div>';
      document.body.appendChild(dlg);
    }
    dlg.querySelector('#ccMsg').textContent = message;
    const rInp = dlg.querySelector('#ccReasonInp');
    const rErr = dlg.querySelector('#ccReasonErr');
    if (rInp && !rInp.value) rInp.value = 'Ошибочный ввод / актуализация данных';
    if (rErr) rErr.textContent = '';
    dlg.querySelector('#ccNo').onclick = () => { try { dlg.close(); dlg.removeAttribute('open'); } catch (_) {} };
    dlg.querySelector('#ccYes').onclick = () => {
      const reason = rInp ? rInp.value.trim() : 'Подтверждено';
      if (!reason) {
        if (rErr) rErr.textContent = 'Укажите причину отмены / удаления для журнала аудита';
        return;
      }
      window._lastConfirmReason = reason;
      try {
        if (typeof getUDB === 'function' && typeof saveUDB === 'function') {
          const db = getUDB();
          db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
          db.auditLog.unshift({
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            actor: 'Администратор',
            action: 'Подтверждение опасного действия',
            details: message + ' · Причина: ' + reason
          });
          saveUDB(db);
        }
      } catch (_) {}
      try { dlg.close(); dlg.removeAttribute('open'); } catch (_) {}
      if (onConfirm) onConfirm(reason);
    };
    try { if (dlg.open) dlg.close(); if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', 'open'); } catch (_) { dlg.setAttribute('open', 'open'); }
  };

  async function verify(pin) {
    if (!pin || !String(pin).trim()) return 'Введите код доступа';
    if (window.coffeeAuth) {
      const res = await window.coffeeAuth.loginOwner(pin);
      if (res && res.ok) return '';
      return (res && res.error) || 'Неверный код доступа';
    }
    return 'Модуль безопасности не загружен';
  }

  function logout() {
    if (window.coffeeAuth) window.coffeeAuth.logout();
    if (window.coffeeBus) window.coffeeBus.emit('auth', { ok: false });
    location.reload();
  }
  window.coffeeLogout = logout;

  function gate(onOk) {
    document.documentElement.classList.add('gate');
    let g = document.getElementById('gate');
    if (g) return;
    g = document.createElement('div');
    g.id = 'gate';
    g.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg,#12191b)';
    g.innerHTML = '<form style="width:min(380px,100%);background:var(--surface,#1b2528);border:1px solid var(--line,#2c3a3e);border-radius:22px;padding:24px;box-shadow:var(--shadow)"><h2 style="margin:0 0 6px;font-family:var(--font-d)">🔒 Защищённый вход (SHA-256)</h2><p style="margin:0 0 14px;color:var(--muted);font-size:13.5px">Дашборд, отчёты и управление защищены токеном сессии и блокировкой перебора (макс. 5 попыток).</p><input id="gPin" type="password" autocomplete="current-password" placeholder="Код доступа администратора" style="width:100%;height:48px;border-radius:14px;border:1px solid var(--line,#2c3a3e);background:var(--bg);padding:0 14px;font:inherit;color:var(--ink)"><div id="gErr" style="color:var(--bad,#c23b22);font-size:13.5px;min-height:20px;margin:8px 0;font-weight:600" role="alert"></div><button id="gGo" type="submit" style="width:100%;min-height:50px;border:0;border-radius:14px;background:#5a3a29;color:#f6ece2;font:inherit;font-weight:700;cursor:pointer">Войти в панель управления</button></form>';
    document.body.appendChild(g);
    
    const f = g.querySelector('form'), inp = g.querySelector('#gPin'), errBox = g.querySelector('#gErr');
    if (window.coffeeRateLimiter) {
      const st = window.coffeeRateLimiter.check('owner_admin');
      if (st.locked) errBox.textContent = st.message;
    }
    setTimeout(() => inp.focus(), 50);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const b = g.querySelector('#gGo');
      b.disabled = true;
      b.textContent = 'Проверяем хеш и сессию…';
      try {
        const err = await verify(v);
        if (err) throw new Error(err);
        if (window.coffeeBus) window.coffeeBus.emit('auth', { ok: true });
        g.remove();
        document.documentElement.classList.remove('gate');
        if (onOk) onOk();
      } catch (x) {
        errBox.textContent = x.message;
        b.disabled = false;
        b.textContent = 'Войти в панель управления';
      }
    };
  }

  function syncNavLinks() {
    const pick = document.getElementById('pick') || document.getElementById('rdPick');
    if (pick && pick.value) ls.set(SHARED_DATE, pick.value);
    const sharedDate = new URLSearchParams(location.search).get('date') || ls.get(SHARED_DATE);
    const openInc = parseInt(ls.get('coffee_meta_open_inc') || '0', 10);

    document.querySelectorAll('nav.tabs a').forEach((a) => {
      const rawHref = a.getAttribute('href'); if (!rawHref) return;
      const href = rawHref.split('?')[0];
      /* Переход между окнами Дашборд, Отчёты, Управление и Терминал без сброса сессии владельца */
      if (sharedDate && href === 'dashboard.html') {
        a.setAttribute('href', href + '?date=' + encodeURIComponent(sharedDate));
      }
      if ((href === 'dashboard.html' || href === 'admin.html') && openInc > 0) {
        if (!a.querySelector('.inc-pill')) {
          const pill = document.createElement('span');
          pill.className = 'inc-pill';
          pill.style.cssText = 'margin-left:5px;padding:1px 6px;border-radius:99px;background:#c23b22;color:#fff;font-size:11px;font-weight:700';
          a.appendChild(pill);
        }
        a.querySelector('.inc-pill').textContent = openInc;
      } else {
        const old = a.querySelector('.inc-pill');
        if (old) old.remove();
      }
    });
  }

  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js?v=86').then((reg) => {
        try { reg.update(); } catch (_) {}
      }).catch(() => {});
    }

    if (page === 'index' || page === 'barista' || page === 'barista_terminal') {
      document.documentElement.classList.remove('gate');
      const oldOwnerNav = document.querySelector('.owner-nav');
      if (oldOwnerNav) oldOwnerNav.remove();
      return; /* Терминал бариста полностью отделён от приложения владельца/администратора */
    }

    if (isAdmin()) {
      document.documentElement.classList.remove('gate');
      const t = document.getElementById('theme');
      if (t && !document.getElementById('ownerLogoutBtn')) {
        const x = document.createElement('button');
        x.id = 'ownerLogoutBtn';
        x.className = 'theme-btn';
        x.type = 'button';
        x.textContent = '⎋';
        x.title = 'Выйти и закрыть сессию владельца';
        x.setAttribute('aria-label', 'Выйти');
        x.style.marginLeft = '6px';
        x.onclick = logout;
        t.parentNode.style.display = 'flex';
        t.parentNode.appendChild(x);
      }
      syncNavLinks();
      const pick = document.getElementById('pick') || document.getElementById('rdPick');
      if (pick) pick.addEventListener('change', syncNavLinks);
      setInterval(syncNavLinks, 1500);
    } else if (typeof window.ensureOwnerPinGate === 'function') {
      document.documentElement.classList.remove('gate');
      window.ensureOwnerPinGate(false);
    } else {
      gate(() => location.reload());
    }

    if (window.coffeeBus) {
      window.coffeeBus.on((msg) => {
        if (msg.type === 'auth') location.reload();
        const liveSync = msg.type === 'server_sync' && msg.detail && msg.detail.live;
        if ((msg.type === 'mutation' || liveSync) && isAdmin()) {
          /* Не перерисовываем экран под руками у пользователя, пока открыт диалог редактирования */
          if (liveSync && document.querySelector('dialog[open]')) return;
          if (typeof window.load === 'function' && (!window.ownerTopSection || window.ownerTopSection === 'admin')) {
            try { window.load(true, true); } catch (_) {}
          }
          syncNavLinks();
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
