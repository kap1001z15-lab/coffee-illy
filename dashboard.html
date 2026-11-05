/* Единое ядро приложения «Кофейня»: сквозная навигация, общая дата, бейджи поломок,
   доступ владельца, неблокирующие диалоги и синхронизация вкладок. Подключается на всех страницах. */
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

  /* Неблокирующее диалоговое окно подтверждения (работает и в обычном браузере, и в песочнице/Telegram) */
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
    const d = await coffeeFetch(API + '?action=dashboard&nocache=1&pin=' + encodeURIComponent(pin), {}, 20000);
    if (d && d.ok !== false && d.days) return '';
    const e = String((d && d.error) || '');
    if (/PIN_NOT_SET/.test(e)) return 'Код доступа не задан в таблице (лист «Настройки»)';
    return /PIN/.test(e) ? 'Неверный код' : (e || 'Не удалось проверить код');
  }

  function logout() {
    ls.del(OK);
    ls.del(PIN);
    if (window.coffeeBus) window.coffeeBus.emit('auth', { ok: false });
    location.href = 'index.html';
  }
  window.coffeeLogout = logout;

  /* Вход по коду: окно поверх страницы */
  function gate(onOk) {
    let g = document.getElementById('gate');
    if (g) return;
    g = document.createElement('div');
    g.id = 'gate';
    g.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg,#e6ecee)';
    g.innerHTML = '<form style="width:min(360px,100%);background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:22px;padding:24px;box-shadow:var(--shadow)"><h2 style="margin:0 0 6px;font-family:var(--font-d)">Вход для владельца</h2><p style="margin:0 0 14px;color:var(--muted);font-size:14px">Дашборд, отчёты и управление доступны только по коду администратора.</p><input id="gPin" type="password" autocomplete="current-password" placeholder="Код доступа" style="width:100%;height:48px;border-radius:14px;border:1px solid var(--line,#ddd);background:var(--bg);padding:0 14px;font:inherit;color:var(--ink)"><div id="gErr" style="color:var(--bad,#c23b22);font-size:14px;min-height:20px;margin:8px 0" role="alert"></div><button id="gGo" style="width:100%;min-height:50px;border:0;border-radius:14px;background:#5a3a29;color:#f6ece2;font:inherit;font-weight:700;cursor:pointer">Войти</button><a href="index.html" style="display:block;text-align:center;margin-top:12px;color:var(--muted);font-size:14px">← В терминал</a></form>';
    document.body.appendChild(g);
    const f = g.querySelector('form'), inp = g.querySelector('#gPin');
    inp.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const b = g.querySelector('#gGo');
      b.disabled = true;
      b.textContent = 'Проверяем…';
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
        b.textContent = 'Войти';
      }
    };
  }

  /* Синхронизация выбранной даты между Дашбордом, Отчётами, Управлением и Терминалом */
  function syncNavLinks() {
    const pick = document.getElementById('pick') || document.getElementById('rdPick');
    if (pick && pick.value) ls.set(SHARED_DATE, pick.value);
    const sharedDate = new URLSearchParams(location.search).get('date') || ls.get(SHARED_DATE);
    const openInc = parseInt(ls.get('coffee_meta_open_inc') || '0', 10);

    document.querySelectorAll('nav.tabs a').forEach((a) => {
      const href = a.getAttribute('href').split('?')[0];
      if (sharedDate && (href === 'dashboard.html' || href === 'index.html')) {
        a.setAttribute('href', href + '?date=' + encodeURIComponent(sharedDate));
      }
      /* Бейдж открытых поломок на вкладках Дашборд и Управление */
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

    /* В Терминале (index.html) добавляем сквозную панель навигации для владельца */
    if (page === 'index') {
      const th = document.getElementById('theme');
      if (th) {
        const b = document.createElement('button');
        b.className = 'theme-btn';
        b.type = 'button';
        const paint = () => {
          b.textContent = isAdmin() ? '📊' : '🔒';
          b.title = isAdmin() ? 'Панель владельца' : 'Вход для владельца';
          b.setAttribute('aria-label', b.title);
        };
        paint();
        b.onclick = () => isAdmin() ? (location.href = 'dashboard.html') : gate(() => { paint(); location.href = 'dashboard.html'; });
        th.parentNode.insertBefore(b, th);
      }
      if (isAdmin()) {
        const hdrWrap = document.querySelector('header .wrap');
        if (hdrWrap && !hdrWrap.querySelector('.owner-nav')) {
          const nav = document.createElement('nav');
          nav.className = 'tabs owner-nav';
          nav.setAttribute('aria-label', 'Разделы системы');
          nav.style.marginBottom = '6px';
          nav.innerHTML = '<a href="dashboard.html" style="display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:12px;color:rgba(246,236,226,.8);font-weight:600;font-size:13px;text-decoration:none">Дашборд</a>' +
            '<a href="report.html" style="display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:12px;color:rgba(246,236,226,.8);font-weight:600;font-size:13px;text-decoration:none">Отчёты</a>' +
            '<a href="admin.html" style="display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:12px;color:rgba(246,236,226,.8);font-weight:600;font-size:13px;text-decoration:none">Управление</a>' +
            '<a href="index.html" style="display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:12px;background:var(--cream);color:var(--espresso);font-weight:600;font-size:13px;text-decoration:none">Терминал</a>';
          const brand = hdrWrap.querySelector('.brand');
          if (brand && brand.nextSibling) hdrWrap.insertBefore(nav, brand.nextSibling);
        }
      }
      syncNavLinks();
    } else {
      /* Дашборд / Отчёты / Управление — только владелец */
      if (isAdmin()) {
        document.documentElement.classList.remove('gate');
        const t = document.getElementById('theme');
        if (t) {
          const x = document.createElement('button');
          x.className = 'theme-btn';
          x.type = 'button';
          x.textContent = '⎋';
          x.title = 'Выйти из режима владельца';
          x.setAttribute('aria-label', 'Выйти');
          x.style.marginLeft = '6px';
          x.onclick = logout;
          t.parentNode.style.display = 'flex';
          t.parentNode.appendChild(x);
        }
        verify(ls.get(PIN)).then((err) => {
          if (err && /Неверный|не задан/.test(err)) { ls.del(OK); location.reload(); }
        }).catch(() => {});
      } else {
        gate(() => location.reload());
      }
    }

    const pick = document.getElementById('pick') || document.getElementById('rdPick');
    if (pick) pick.addEventListener('change', syncNavLinks);
    setInterval(syncNavLinks, 1500);

    /* Реактивное обновление открытых страниц при изменениях в соседних вкладках */
    if (window.coffeeBus) {
      window.coffeeBus.on((msg) => {
        if (msg.type === 'auth') location.reload();
        if (msg.type === 'mutation') {
          if (typeof window.load === 'function') {
            try { window.load(true, true); } catch (_) {}
          } else if (typeof window.loadTasks === 'function') {
            try { window.loadTasks(); } catch (_) {}
          }
          syncNavLinks();
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
