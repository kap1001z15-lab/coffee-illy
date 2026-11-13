/* =========================================================================
   МОДУЛЬ БЕЗОПАСНОСТИ (js/security.js — v21 Enterprise Security)
   1. Криптографическое хеширование SHA-256 с солью ('coffee_salt_v21:') без хранения открытых PIN.
   2. Защита от перебора PIN (Rate-Limiting): блокировка на 15 минут после 5 неверных попыток.
   3. Управление защищёнными сессиями (sessionToken с подписью и TTL вместо coffee_admin_ok=1).
   4. Универсальная защита от XSS (escapeHtml, escapeAttr, sanitizeRecord).
   ========================================================================= */
(function () {
  const SALT_V21 = 'coffee_salt_v21:';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 15 * 60 * 1000; // 15 минут
  const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов
  const SESSION_STORAGE_KEY = 'coffee_session_token_v21';
  const RATE_LIMIT_KEY = 'coffee_pin_ratelimit_v21';

  // Чистая синхронная реализация SHA-256 (FIPS 180-4) для работы в любом окружении (браузер + офлайн PWA + Node.js)
  function sha256Raw(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = 'length';
    let i, j;
    let result = '';
    const words = [];
    const asciiBitLength = ascii[lengthProperty] * 8;
    let hash = sha256Raw.h = sha256Raw.h || [];
    const k = sha256Raw.k = sha256Raw.k || [];
    let primeCounter = k[lengthProperty];
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
    words[words[lengthProperty]] = asciiBitLength;
    for (j = 0; j < words[lengthProperty]; ) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const i2 = i + j;
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        const temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function utf8ToBinaryStr(str) {
    return unescape(encodeURIComponent(String(str || '')));
  }

  window.coffeeSha256Sync = function (inputStr) {
    return sha256Raw(utf8ToBinaryStr(inputStr));
  };

  window.coffeeHashPin = function (pinOrHash) {
    const s = String(pinOrHash || '').trim();
    if (!s) return '';
    if (s.indexOf('sha256:') === 0) return s.slice(7).toLowerCase();
    if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();
    return window.coffeeSha256Sync(SALT_V21 + s);
  };

  // Защита от XSS во всех шаблонах
  const ESC_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  window.escapeHtml = function (val) {
    if (val === null || val === undefined) return '';
    return String(val).replace(/[&<>"'`]/g, (ch) => ESC_MAP[ch]);
  };
  window.esc = window.escapeHtml;
  window.escapeAttr = window.escapeHtml;

  window.sanitizeRecord = function (input) {
    if (typeof input === 'string') {
      return input
        .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
        .replace(/javascript\s*:/gi, '')
        .replace(/on(error|load|click|mouseover|focus)\s*=/gi, 'data-blocked-event=');
    }
    if (Array.isArray(input)) return input.map(window.sanitizeRecord);
    if (input && typeof input === 'object') {
      const out = {};
      Object.keys(input).forEach((k) => {
        if (k === 'photo' || k === 'url' || k === 'cashPhotoMachine' || k === 'cashPhotoPaper') {
          const v = String(input[k] || '');
          out[k] = /^(data:(image|video)\/|https?:\/\/|idb:\/\/)/i.test(v) ? v : '';
        } else {
          out[k] = window.sanitizeRecord(input[k]);
        }
      });
      return out;
    }
    return input;
  };

  // Защита от перебора PIN (Brute-force Rate Limiter: 5 попыток -> блокировка 15 минут)
  function _getRateMap() {
    try {
      return JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }
  function _saveRateMap(m) {
    try {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(m));
    } catch (_) {}
  }

  window.coffeeRateLimiter = {
    MAX_ATTEMPTS,
    LOCKOUT_MS,
    check(actorKey) {
      const k = String(actorKey || 'admin');
      const map = _getRateMap();
      const entry = map[k] || { attempts: 0, lockedUntil: 0 };
      const now = Date.now();
      if (entry.lockedUntil && now < entry.lockedUntil) {
        const remSec = Math.ceil((entry.lockedUntil - now) / 1000);
        return {
          locked: true,
          attempts: entry.attempts,
          remainingSec: remSec,
          message: 'Превышено число попыток (' + MAX_ATTEMPTS + '/' + MAX_ATTEMPTS + '). Повторите через ' + remSec + ' сек.'
        };
      }
      if (entry.lockedUntil && now >= entry.lockedUntil) {
        delete map[k];
        _saveRateMap(map);
        return { locked: false, attempts: 0, remainingSec: 0, remainingAttempts: MAX_ATTEMPTS };
      }
      return {
        locked: false,
        attempts: entry.attempts || 0,
        remainingSec: 0,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - (entry.attempts || 0))
      };
    },
    recordFailure(actorKey) {
      const k = String(actorKey || 'admin');
      const status = this.check(k);
      if (status.locked) return status;
      const map = _getRateMap();
      const entry = map[k] || { attempts: 0, lockedUntil: 0 };
      entry.attempts = (entry.attempts || 0) + 1;
      if (entry.attempts >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_MS;
        map[k] = entry;
        _saveRateMap(map);
        return {
          locked: true,
          attempts: entry.attempts,
          remainingSec: Math.ceil(LOCKOUT_MS / 1000),
          remainingAttempts: 0,
          message: 'Введено 5 неверных PIN-кодов подряд. Доступ заблокирован на 15 минут.'
        };
      }
      map[k] = entry;
      _saveRateMap(map);
      return {
        locked: false,
        attempts: entry.attempts,
        remainingSec: 0,
        remainingAttempts: MAX_ATTEMPTS - entry.attempts,
        message: 'Неверный PIN-код. Осталось попыток: ' + (MAX_ATTEMPTS - entry.attempts)
      };
    },
    reset(actorKey) {
      const k = String(actorKey || 'admin');
      const map = _getRateMap();
      delete map[k];
      _saveRateMap(map);
    }
  };

  // Менеджер защищённых токенов сессии (заменяет уязвимый coffee_admin_ok=1)
  function _makeSessionSig(token, role, pinHash, expiresAt) {
    return window.coffeeSha256Sync('sess_v21:' + token + ':' + role + ':' + pinHash + ':' + expiresAt).slice(0, 24);
  }

  window.coffeeAuth = {
    getExpectedOwnerPinHash(dbOpt) {
      const db = dbOpt || (typeof getUDB === 'function' ? getUDB() : {});
      const sPin = ((db && db.settings) || []).find((x) => x.id === 'ADMIN_PIN');
      const raw = (sPin && sPin.value ? String(sPin.value).trim() : '') || (db && db.adminPin) || '';
      if (raw && raw.indexOf('••') === -1) return window.coffeeHashPin(raw);
      return window.COFFEE_DEFAULT_OWNER_PIN_HASH || window.coffeeHashPin('1234');
    },
    verifyOwnerPin(pinOrHash, dbOpt) {
      const rl = window.coffeeRateLimiter.check('owner_admin');
      if (rl.locked) return false;
      const cand = window.coffeeHashPin(pinOrHash);
      if (!cand) return false;
      const expected = this.getExpectedOwnerPinHash(dbOpt);
      const ok = cand === expected;
      if (!ok) {
        window.coffeeRateLimiter.recordFailure('owner_admin');
        return false;
      }
      window.coffeeRateLimiter.reset('owner_admin');
      return true;
    },
    createLocalSession(role, staffName, pinOrHash, serverTokenOpt) {
      const pinHash = window.coffeeHashPin(pinOrHash || this.getExpectedOwnerPinHash());
      if ((role || 'admin') === 'admin' && window.coffeeRateLimiter) {
        window.coffeeRateLimiter.reset('owner_admin');
      }
      if (serverTokenOpt) { try { localStorage.setItem('coffee_server_tok_at', String(Date.now())); } catch (_) {} }
      const token = serverTokenOpt || ('st_local_' + window.coffeeSha256Sync(Date.now() + ':' + Math.random()).slice(0, 24));
      const expiresAt = Date.now() + SESSION_TTL_MS;
      const sig = _makeSessionSig(token, role || 'admin', pinHash, expiresAt);
      const sess = { token, role: role || 'admin', staffName: staffName || 'Администратор', pinHash, expiresAt, sig };
      try {
        if ((role || 'admin') === 'admin') {
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess));
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess));
          localStorage.setItem('coffee_illy_pin', 'sha256:' + pinHash);
        } else {
          sessionStorage.setItem('coffee_staff_session_v21', JSON.stringify(sess));
          localStorage.setItem('coffee_staff_session_v21', JSON.stringify(sess));
        }
      } catch (_) {}
      return sess;
    },
    getSession() {
      try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const sess = JSON.parse(raw);
        if (!sess || !sess.token || !sess.expiresAt || Date.now() > sess.expiresAt) {
          this.logout();
          return null;
        }
        const expectedSig = _makeSessionSig(sess.token, sess.role, sess.pinHash, sess.expiresAt);
        if (sess.sig !== expectedSig) {
          this.logout();
          return null;
        }
        return sess;
      } catch (_) {
        return null;
      }
    },
    getSessionToken() {
      const s = this.getSession();
      return s ? s.token : '';
    },
    isAuthorized(requiredRole, dbOpt) {
      // ВНИМАНИЕ: Ручная подстановка coffee_admin_ok=1 в консоли отклоняется без криптографически подписанной сессии!
      const sess = this.getSession();
      if (!sess) return false;
      const expectedOwner = this.getExpectedOwnerPinHash(dbOpt);
      const defaultHash = window.COFFEE_DEFAULT_OWNER_PIN_HASH || window.coffeeHashPin('1234');
      if (requiredRole === 'admin') {
        return sess.role === 'admin' && sess.pinHash === expectedOwner;
      }
      return true;
    },
    async loginOwner(pinInput) {
      const rl = window.coffeeRateLimiter.check('owner_admin');
      if (rl.locked) {
        return { ok: false, locked: true, error: rl.message };
      }
      if (!this.verifyOwnerPin(pinInput)) {
        const st = window.coffeeRateLimiter.check('owner_admin');
        return {
          ok: false,
          locked: st.locked,
          remainingAttempts: st.remainingAttempts,
          error: st.locked
            ? st.message
            : 'Неверный код доступа владельца (осталось попыток: ' + st.remainingAttempts + ' из ' + MAX_ATTEMPTS + ')'
        };
      }
      const pinHash = window.coffeeHashPin(pinInput);
      const sess = this.createLocalSession('admin', 'Администратор', pinHash);
      // Фоновое получение серверного sessionToken от Code.gs
      try {
        if (window.COFFEE && window.COFFEE.API_URL && typeof fetch === 'function') {
          fetch(window.COFFEE.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pinHash })
          })
            .then((r) => r.json())
            .then((res) => {
              if (res && res.ok && res.sessionToken) {
                this.createLocalSession('admin', 'Администратор', pinHash, res.sessionToken);
              }
            })
            .catch(() => {});
        }
      } catch (_) {}
      return { ok: true, sessionToken: sess.token, pinHash };
    },
    async loginStaff(staffName, pinInput, dbOpt) {
      const cleanName = String(staffName || 'Бариста').trim();
      const actorKey = 'staff_' + cleanName;
      const rl = window.coffeeRateLimiter.check(actorKey);
      if (rl.locked) {
        return { ok: false, locked: true, error: rl.message };
      }
      const okLocal = window.coffeeVerifyStaffPin ? window.coffeeVerifyStaffPin(cleanName, pinInput, dbOpt) : false;
      if (!okLocal) {
        const st = window.coffeeRateLimiter.check(actorKey);
        return {
          ok: false,
          locked: st.locked,
          remainingAttempts: st.remainingAttempts,
          error: st.locked ? st.message : ('Неверный персональный PIN сотрудника (осталось попыток: ' + st.remainingAttempts + ')')
        };
      }
      const pinHash = window.coffeeHashPin(pinInput);
      const sess = this.createLocalSession('staff', cleanName, pinHash);
      try {
        if (window.COFFEE && window.COFFEE.API_URL && typeof fetch === 'function') {
          fetch(window.COFFEE.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'auth_login', role: 'staff', staffName: cleanName, pinHash })
          })
            .then((r) => r.json())
            .then((res) => {
              if (res && res.ok && res.sessionToken) {
                this.createLocalSession('staff', cleanName, pinHash, res.sessionToken);
              }
            })
            .catch(() => {});
        }
      } catch (_) {}
      return { ok: true, sessionToken: sess.token, staffName: cleanName, pinHash };
    },
    async setupInitialCredentials(newAdminPin, staffPinsMap) {
      const db = typeof getUDB === 'function' ? getUDB() : {};
      const adminHash = window.coffeeHashPin(newAdminPin);
      if (adminHash) {
        db.adminPin = 'sha256:' + adminHash;
        const sRow = (db.settings || []).find((x) => x.id === 'ADMIN_PIN');
        if (sRow) sRow.value = 'sha256:' + adminHash;
      }
      if (staffPinsMap && typeof staffPinsMap === 'object' && Array.isArray(db.staff)) {
        db.staff.forEach((s) => {
          if (s && staffPinsMap[s.name]) {
            s.pinHash = window.coffeeHashPin(staffPinsMap[s.name]);
            delete s.pin;
          }
        });
      }
      db.factoryPinsDisabled = true;
      if (typeof saveUDB === 'function') saveUDB(db);
      if (window.coffeeFetch && window.COFFEE && window.COFFEE.API_URL) {
        return window.coffeeFetch(window.COFFEE.API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'setup_initial_credentials',
            newAdminPin: adminHash ? ('sha256:' + adminHash) : '',
            staffPins: staffPinsMap || {}
          })
        });
      }
      return { ok: true, factoryPinsDisabled: true };
    },
    logout() {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem('coffee_admin_ok');
        localStorage.removeItem('coffee_illy_pin');
      } catch (_) {}
    }
  };
})();
