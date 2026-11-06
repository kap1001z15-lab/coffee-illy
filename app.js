/* Единое ядро авторизации и защиты «Кофейня» (v9):
   - Терминал бариста (index.html) полностью отделён от панели владельца: в нём нет вкладок Дашборда, Отчётов и Управления.
   - Неавторизованные пользователи (бариста) не имеют доступа к просмотру отчётов или редактированию настроек и задач.
   - При переходе в Терминал сессия владельца автоматически блокируется, чтобы бариста не мог зайти в панель управления без PIN-кода. */
(function () {
  'use strict';
  const API = window.COFFEE && window.COFFEE.API_URL;
  const PIN = 'coffee_illy_pin', OK = 'coffee_admin_ok', SHARED_DATE = 'coffee_shared_date';
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  const ls = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const isAdmin = () => ls.get(OK) === '1' && !!ls.get(PIN);

  /* Неблокирующее диалоговое окно подтверждения */
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
    dlg.showModal();
  };

  async function verify(pin) {
    if (!pin || !String(pin).trim()) return 'Введите код доступа';
    const d = await coffeeFetch(API + '?action=dashboard&nocache=1&pin=' + encodeURIComponent(pin), {}, 20000);
    if (d && d.ok !== false && d.days) return '';
    const e = String((d && d.error) || '');
    if (/PIN_NOT_SET/.test(e)) return 'Код доступа не задан в таблице (лист «Настройки»)';
    return /PIN/.test(e) ? 'Неверный код доступа' : (e || 'Не удалось проверить код');
  }

  function logout() {
    ls.del(OK);
    ls.del(PIN);
    if (window.coffeeBus) window.coffeeBus.emit('auth', { ok: false });
    location.href = 'index.html';
  }
  window.coffeeLogout = logout;

  /* Окно ввода PIN-кода владельца (скрывает содержимое страницы до успешного входа) */
  function gate(onOk) {
    document.documentElement.classList.add('gate');
    let g = document.getElementById('gate');
    if (g) return;
    g = document.createElement('div');
    g.id = 'gate';
    g.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg,#12191b)';
    g.innerHTML = '<form style="width:min(360px,100%);background:var(--surface,#1b2528);border:1px solid var(--line,#2c3a3e);border-radius:22px;padding:24px;box-shadow:var(--shadow)"><h2 style="margin:0 0 6px;font-family:var(--font-d)">🔒 Вход для владельца</h2><p style="margin:0 0 14px;color:var(--muted);font-size:14px">Дашборд, отчёты и управление закрыты от сотрудников и доступны только по коду администратора.</p><input id="gPin" type="password" autocomplete="current-password" placeholder="Код доступа администратора" style="width:100%;height:48px;border-radius:14px;border:1px solid var(--line,#2c3a3e);background:var(--bg);padding:0 14px;font:inherit;color:var(--ink)"><div id="gErr" style="color:var(--bad,#c23b22);font-size:14px;min-height:20px;margin:8px 0" role="alert"></div><button id="gGo" type="submit" style="width:100%;min-height:50px;border:0;border-radius:14px;background:#5a3a29;color:#f6ece2;font:inherit;font-weight:700;cursor:pointer">Войти в панель управления</button><a href="index.html" id="gBackTerm" style="display:block;text-align:center;margin-top:12px;color:var(--muted);font-size:14px;text-decoration:none">← Вернуться в терминал бариста</a></form>';
    document.body.appendChild(g);
    const backLink = g.querySelector('#gBackTerm');
    if (page === 'index') {
      backLink.onclick = (e) => { e.preventDefault(); g.remove(); document.documentElement.classList.remove('gate'); };
    }
    const f = g.querySelector('form'), inp = g.querySelector('#gPin');
    setTimeout(() => inp.focus(), 50);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const b = g.querySelector('#gGo');
      b.disabled = true;
      b.textContent = 'Проверяем код…';
      try {
        const err = await verify(v);
        if (err) throw new Error(err);
        ls.set(PIN, v);
        ls.set(OK, '1');
        if (window.coffeeBus) window.coffeeBus.emit('auth', { ok: true });
        g.remove();
        document.documentElement.classList.remove('gate');
        if (onOk) onOk();
      } catch (x) {
        g.querySelector('#gErr').textContent = x.message;
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
      const href = a.getAttribute('href').split('?')[0];
      if (href === 'index.html') {
        /* При переходе из панели владельца в Терминал бариста автоматически блокируем сессию владельца */
        a.onclick = () => { ls.del(OK); ls.del(PIN); };
      }
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

    /* В Терминале бариста (index.html):
       1. Сбрасываем активную сессию владельца, чтобы бариста не имел доступа к отчётам и настройкам.
       2. НЕ показываем панель вкладок Дашборд / Отчёты / Управление — только чистый Терминал и иконку замка 🔒 для владельца. */
    if (page === 'index') {
      ls.del(OK);
      ls.del(PIN);
      document.documentElement.classList.remove('gate');
      const oldOwnerNav = document.querySelector('.owner-nav');
      if (oldOwnerNav) oldOwnerNav.remove();
      const th = document.getElementById('theme');
      if (th && !document.getElementById('ownerLockBtn')) {
        const b = document.createElement('button');
        b.id = 'ownerLockBtn';
        b.className = 'theme-btn';
        b.type = 'button';
        b.textContent = '🔒';
        b.title = 'Вход для владельца (по коду)';
        b.setAttribute('aria-label', 'Вход для владельца');
        b.onclick = () => gate(() => { location.href = 'dashboard.html'; });
        th.parentNode.insertBefore(b, th);
      }
      return;
    }

    /* Разделы владельца (dashboard.html, report.html, admin.html) строго требуют авторизации по PIN */
    if (isAdmin()) {
      document.documentElement.classList.remove('gate');
      const t = document.getElementById('theme');
      if (t && !document.getElementById('ownerLogoutBtn')) {
        const x = document.createElement('button');
        x.id = 'ownerLogoutBtn';
        x.className = 'theme-btn';
        x.type = 'button';
        x.textContent = '⎋';
        x.title = 'Выйти и закрыть панель владельца';
        x.setAttribute('aria-label', 'Выйти');
        x.style.marginLeft = '6px';
        x.onclick = logout;
        t.parentNode.style.display = 'flex';
        t.parentNode.appendChild(x);
      }
      verify(ls.get(PIN)).then((err) => {
        if (err && /Неверный|не задан/.test(err)) {
          ls.del(OK);
          ls.del(PIN);
          gate(() => location.reload());
        }
      }).catch(() => {});
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
        if (msg.type === 'mutation' && isAdmin()) {
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
