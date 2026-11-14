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
      dlg.style.cssText = 'border:1px solid var(--line,#d3dde0);border-radius:22px;background:var(--surface,#fff);color:var(--ink,#172326);padding:20px;width:min(420px,92vw);box-shadow:0 30px 60px -20px rgba(0,0,0,.6)';
      dlg.innerHTML = '<h3 style="margin:0 0 8px;font-family:var(--font-d,sans-serif)">Подтверждение</h3><p id="ccMsg" style="margin:0 0 16px;color:var(--muted,#5b6d72);font-size:14px"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="ccNo" style="border:1px solid var(--line,#d3dde0);background:var(--bg,#e6ecee);border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer">Отмена</button><button type="button" id="ccYes" style="border:0;background:var(--bad,#c23b22);color:#fff;border-radius:10px;padding:8px 16px;font-weight:700;cursor:pointer">Подтвердить</button></div>';
      document.body.appendChild(dlg);
    }
    dlg.querySelector('#ccMsg').textContent = message;
    dlg.querySelector('#ccNo').onclick = () => dlg.close();
    dlg.querySelector('#ccYes').onclick = () => { dlg.close(); if (onConfirm) onConfirm(); };
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
      navigator.serviceWorker.register('sw.js?v=65').then((reg) => {
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
          if (typeof window.load === 'function') {
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
