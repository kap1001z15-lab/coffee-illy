/* Единые настройки приложения. Адрес скрипта меняется ТОЛЬКО здесь — он общий для терминала, дашборда и отчётов. */
window.COFFEE = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzCECsUCN3d2WOYvjkKZ56lgnYaqW1s1UhMs8ne6u_hzOpcHilgKgB7VaKeUNHwssdLzw/exec'
};

/* Запрос с таймаутом: чтение повторяется один раз, запись — нет (чтобы не задвоить). Возвращает разобранный JSON. */
window.coffeeFetch = async function (url, opt, ms, tries) {
  opt = opt || {}; ms = ms || 25000; tries = tries || (opt.method === 'POST' ? 1 : 2);
  let last;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, Object.assign({}, opt, { signal: ac.signal })); clearTimeout(t); return await r.json(); }
    catch (e) { clearTimeout(t); last = e.name === 'AbortError' ? new Error('сервер долго отвечает') : e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 700)); }
  }
  throw last;
};

/* Локальный кэш ответов: страница открывается мгновенно, свежие данные подгружаются следом. */
window.coffeeCache = {
  get(k) { try { const o = JSON.parse(localStorage.getItem('cc:' + k) || 'null'); return o && o.v; } catch (e) { return null; } },
  set(k, v) {
    try { localStorage.setItem('cc:' + k, JSON.stringify({ t: Date.now(), v })); }
    catch (e) { try { Object.keys(localStorage).filter((x) => x.indexOf('cc:') === 0).forEach((x) => localStorage.removeItem(x)); } catch (_) {} }
  }
};
