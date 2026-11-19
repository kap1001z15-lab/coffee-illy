/* Coffee Illy v93.0 — Unified Material 3 Soft Controls
 * 1. M3Select      — Custom M3 Soft dropdown (desktop popover + mobile bottom sheet, replaces all native <select>)
 * 2. M3TimePicker  — Google Pixel Material 3 Time Picker (separate HH / MM digital tiles + interactive 24h/60m radial clock dial + quick presets)
 * 3. M3DatePicker  — Unified M3 Soft Calendar Date Picker (for Finance Analytics Day & Custom Period)
 */
(function () {
  if (typeof document !== 'undefined' && !document.getElementById('m3-controls-v93-css')) {
    const st = document.createElement('style');
    st.id = 'm3-controls-v93-css';
    st.textContent = `
      /* Cross-OS polish */
      html, body { min-height: 100dvh; -webkit-tap-highlight-color: transparent; }
      body { padding-bottom: env(safe-area-inset-bottom, 0px); }
      @media (max-width: 640px) {
        input, textarea, select, .m3-sel-btn, .m3-time-btn { font-size: 16px !important; }
      }

      /* Hidden native select */
      select.m3-native-hidden {
        position: absolute !important; opacity: 0 !important; pointer-events: none !important;
        width: 1px !important; height: 1px !important; margin: 0 !important; padding: 0 !important;
      }

      /* Custom M3 Soft Select Button */
      .m3-sel-wrap { position: relative; display: inline-flex; width: 100%; }
      .m3-sel-wrap.m3-sel-inline { width: auto; }
      .m3-sel-btn {
        width: 100%; display: inline-flex; align-items: center; justify-content: space-between; gap: 10px;
        background: var(--surface-2); color: var(--ink); border: 1px solid var(--line);
        border-radius: 14px; padding: 11px 14px; font-family: inherit; font-size: 14px; font-weight: 600;
        cursor: pointer; text-align: left; transition: border-color .15s, background .15s, box-shadow .15s;
        min-height: 44px;
      }
      .m3-sel-wrap.m3-sel-chip .m3-sel-btn {
        border-radius: 999px; padding: 7px 14px; min-height: 36px; font-size: 13px;
        background: var(--surface); width: auto;
      }
      .m3-sel-btn:hover:not(:disabled) { border-color: var(--accent); }
      .m3-sel-btn:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
      .m3-sel-btn:disabled { opacity: .55; cursor: not-allowed; }
      .m3-sel-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .m3-sel-chev { flex-shrink: 0; font-size: 11px; color: var(--muted); transition: transform .18s ease; }
      .m3-sel-btn.open .m3-sel-chev { transform: rotate(180deg); color: var(--accent); }

      /* M3 Dropdown Overlay & Menu */
      .m3-pop-backdrop {
        position: fixed; inset: 0; z-index: 950; background: transparent;
      }
      .m3-pop-menu {
        position: fixed; z-index: 951; background: var(--card); border: 1px solid var(--line);
        border-radius: 20px; box-shadow: 0 18px 46px rgba(0,0,0,.45); padding: 6px;
        max-height: 320px; overflow-y: auto; overscroll-behavior: contain;
        min-width: 190px; animation: m3PopIn .14s ease-out;
      }
      @keyframes m3PopIn { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .m3-pop-item {
        width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
        background: transparent; border: none; color: var(--ink); font-family: inherit;
        font-size: 14px; font-weight: 600; padding: 11px 14px; border-radius: 13px;
        cursor: pointer; text-align: left; transition: background .12s;
      }
      .m3-pop-item:hover { background: var(--surface-2); }
      .m3-pop-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
      .m3-pop-chk { font-size: 14px; font-weight: 800; color: var(--accent); }

      /* Mobile Bottom Sheet for M3 Select */
      @media (max-width: 640px) {
        .m3-pop-backdrop.m3-sheet-mode {
          background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .m3-pop-menu.m3-sheet-mode {
          position: static; width: 100%; max-width: 520px; max-height: 70dvh;
          border-radius: 28px 28px 0 0; border-bottom: none;
          padding: 10px 14px calc(18px + env(safe-area-inset-bottom, 0px));
          animation: m3SheetUp .2s cubic-bezier(.2,.8,.2,1);
        }
        @keyframes m3SheetUp { from { transform: translateY(40px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
      }
      .m3-sheet-handle {
        width: 38px; height: 4px; border-radius: 999px; background: var(--muted); opacity: .45;
        margin: 2px auto 12px;
      }
      .m3-sheet-title {
        font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase;
        letter-spacing: .04em; padding: 0 8px 8px;
      }

      /* M3 Time Picker Trigger */
      .m3-time-btn {
        display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;
        background: var(--surface-2); color: var(--ink); border: 1px solid var(--line);
        border-radius: 14px; padding: 10px 14px; font-family: inherit; font-size: 14px; font-weight: 700;
        cursor: pointer; transition: border-color .15s, background .15s; min-height: 44px; width: 100%;
      }
      .m3-time-btn.m3-time-chip {
        border-radius: 999px; padding: 7px 14px; min-height: 36px; font-size: 13px;
        background: var(--surface); width: auto;
      }
      .m3-time-btn:hover { border-color: var(--accent); }
      .m3-time-val { font-variant-numeric: tabular-nums; letter-spacing: .02em; }

      /* Google Pixel Material 3 Time Picker Dialog */
      .m3-dlg-bg {
        position: fixed; inset: 0; z-index: 980; background: rgba(0,0,0,.62); backdrop-filter: blur(5px);
        display: flex; align-items: center; justify-content: center; padding: 16px;
        animation: m3Fade .15s ease-out;
      }
      @keyframes m3Fade { from { opacity: 0; } to { opacity: 1; } }
      .m3-dlg-card {
        background: var(--card); border: 1px solid var(--line); border-radius: 28px;
        width: 100%; max-width: 356px; padding: 20px; box-shadow: 0 24px 64px rgba(0,0,0,.55);
        color: var(--ink);
      }
      .m3-dlg-kicker {
        font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;
        letter-spacing: .06em; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;
      }
      .m3-tp-display {
        display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px;
      }
      .m3-tp-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .m3-tp-tile {
        width: 96px; height: 76px; border-radius: 20px; border: 2px solid transparent;
        background: var(--surface-2); color: var(--ink); font-family: inherit;
        font-size: 42px; font-weight: 800; font-variant-numeric: tabular-nums;
        display: flex; align-items: center; justify-content: center; cursor: pointer;
        transition: background .15s, border-color .15s, color .15s, transform .1s;
      }
      .m3-tp-tile.active {
        background: var(--accent-soft); color: var(--accent); border-color: var(--accent);
      }
      .m3-tp-tile:active { transform: scale(.97); }
      .m3-tp-sub { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
      .m3-tp-colon { font-size: 40px; font-weight: 800; color: var(--muted); padding-bottom: 22px; user-select: none; }
      .m3-tp-step-row { display: flex; gap: 6px; }
      .m3-tp-step {
        width: 44px; height: 30px; border-radius: 999px; border: 1px solid var(--line);
        background: var(--surface); color: var(--ink); font-size: 16px; font-weight: 700;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      }
      .m3-tp-step:hover { border-color: var(--accent); color: var(--accent); }

      /* Pixel Radial Clock Dial */
      .m3-dial-wrap {
        position: relative; width: 256px; height: 256px; margin: 6px auto 14px;
        border-radius: 50%; background: var(--surface); border: 1px solid var(--line);
        touch-action: none; user-select: none; cursor: pointer;
      }
      .m3-dial-center {
        position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 50%;
        background: var(--accent); transform: translate(-50%, -50%); z-index: 3; pointer-events: none;
      }
      .m3-dial-hand {
        position: absolute; left: 50%; top: 50%; width: 2px; background: var(--accent);
        transform-origin: 50% 100%; z-index: 2; pointer-events: none; border-radius: 2px;
      }
      .m3-dial-knob {
        position: absolute; width: 38px; height: 38px; border-radius: 50%;
        background: var(--accent); transform: translate(-50%, -50%); z-index: 2; pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.35);
      }
      .m3-dial-num {
        position: absolute; width: 34px; height: 34px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        transform: translate(-50%, -50%); font-size: 14px; font-weight: 700;
        font-variant-numeric: tabular-nums; color: var(--ink); z-index: 4; pointer-events: none;
        transition: color .1s;
      }
      .m3-dial-num.inner { font-size: 12px; color: var(--muted); width: 30px; height: 30px; }
      .m3-dial-num.selected { color: var(--accent-ink) !important; font-weight: 800; }

      .m3-tp-presets {
        display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 14px;
      }
      .m3-tp-preset {
        background: var(--surface); border: 1px solid var(--line); color: var(--muted);
        border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700;
        cursor: pointer; font-family: inherit;
      }
      .m3-tp-preset:hover { border-color: var(--accent); color: var(--ink); }

      .m3-dlg-actions {
        display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;
      }
      .m3-btn-text {
        background: transparent; border: 1px solid transparent; color: var(--accent);
        padding: 9px 16px; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
      }
      .m3-btn-text:hover { background: var(--accent-soft); }
      .m3-btn-fill {
        background: var(--accent); border: none; color: var(--accent-ink);
        padding: 9px 20px; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer;
      }

      /* M3 Date Picker Calendar */
      .m3-cal-head {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
      }
      .m3-cal-month { font-size: 15px; font-weight: 800; text-transform: capitalize; }
      .m3-cal-nav {
        width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line);
        background: var(--surface); color: var(--ink); font-size: 16px; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .m3-cal-nav:hover { border-color: var(--accent); color: var(--accent); }
      .m3-cal-grid {
        display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center;
      }
      .m3-cal-dow { font-size: 11px; font-weight: 700; color: var(--muted); padding: 4px 0 6px; }
      .m3-cal-day {
        height: 38px; border-radius: 50%; border: 1px solid transparent;
        background: transparent; color: var(--ink); font-family: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
      }
      .m3-cal-day:hover:not(:disabled) { background: var(--surface-2); }
      .m3-cal-day.today { border-color: var(--accent); color: var(--accent); font-weight: 800; }
      .m3-cal-day.selected { background: var(--accent) !important; color: var(--accent-ink) !important; font-weight: 800; }
      .m3-cal-day.muted { opacity: .28; pointer-events: none; }
    `;
    document.head.appendChild(st);
  }

  /* =====================================================================
     1. M3Select — Unified Material 3 Soft Dropdown
     ===================================================================== */
  let _activePop = null;
  function closeActivePop() {
    if (_activePop && _activePop.cleanup) _activePop.cleanup();
    _activePop = null;
  }

  function enhanceSelect(sel) {
    if (!sel || sel.tagName !== 'SELECT' || sel.dataset.m3Ignore === '1') return;
    let wrap = sel.parentElement;
    let btn = null;
    if (wrap && wrap.classList.contains('m3-sel-wrap')) {
      btn = wrap.querySelector('.m3-sel-btn');
    } else {
      const isChip = sel.classList.contains('chip-btn');
      wrap = document.createElement('div');
      wrap.className = 'm3-sel-wrap' + (isChip ? ' m3-sel-chip m3-sel-inline' : '');
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      sel.classList.add('m3-native-hidden');
      sel.tabIndex = -1;

      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'm3-sel-btn';
      btn.innerHTML = '<span class="m3-sel-lbl"></span><span class="m3-sel-chev">▾</span>';
      wrap.appendChild(btn);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (sel.disabled) return;
        if (_activePop && _activePop.sel === sel) { closeActivePop(); return; }
        openSelectMenu(sel, btn);
      });
    }

    syncSelectLabel(sel);
  }

  function syncSelectLabel(sel) {
    if (!sel || !sel.parentElement || !sel.parentElement.classList.contains('m3-sel-wrap')) return;
    const btn = sel.parentElement.querySelector('.m3-sel-btn');
    if (!btn) return;
    btn.disabled = !!sel.disabled;
    const opt = sel.options[sel.selectedIndex] || sel.options[0];
    const lbl = btn.querySelector('.m3-sel-lbl');
    if (lbl) lbl.textContent = opt ? opt.textContent : '';
  }

  function openSelectMenu(sel, btn) {
    closeActivePop();
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
    const backdrop = document.createElement('div');
    backdrop.className = 'm3-pop-backdrop' + (isMobile ? ' m3-sheet-mode' : '');

    const menu = document.createElement('div');
    menu.className = 'm3-pop-menu' + (isMobile ? ' m3-sheet-mode' : '');
    menu.setAttribute('role', 'listbox');

    if (isMobile) {
      const handle = document.createElement('div');
      handle.className = 'm3-sheet-handle';
      menu.appendChild(handle);
      const field = sel.closest('.field');
      const titleTxt = (field && field.querySelector('label') && field.querySelector('label').textContent) || sel.getAttribute('aria-label') || 'Выбор';
      const title = document.createElement('div');
      title.className = 'm3-sheet-title';
      title.textContent = titleTxt;
      menu.appendChild(title);
    }

    Array.from(sel.options).forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'm3-pop-item' + (opt.value === sel.value ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.value === sel.value ? 'true' : 'false');
      item.innerHTML = '<span></span>' + (opt.value === sel.value ? '<span class="m3-pop-chk">✓</span>' : '');
      item.firstChild.textContent = opt.textContent;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const changed = sel.value !== opt.value;
        sel.value = opt.value;
        syncSelectLabel(sel);
        closeActivePop();
        if (changed) {
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      menu.appendChild(item);
    });

    if (isMobile) {
      backdrop.appendChild(menu);
      document.body.appendChild(backdrop);
    } else {
      document.body.appendChild(backdrop);
      document.body.appendChild(menu);
      const rect = btn.getBoundingClientRect();
      const mw = Math.max(rect.width, 200);
      menu.style.minWidth = mw + 'px';
      let left = rect.left;
      if (left + mw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - mw - 12);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const menuH = Math.min(320, sel.options.length * 44 + 16);
      let top = rect.bottom + 6;
      if (spaceBelow < menuH && rect.top > spaceBelow) {
        top = Math.max(12, rect.top - menuH - 6);
      }
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }

    btn.classList.add('open');
    const onKey = (e) => { if (e.key === 'Escape') closeActivePop(); };
    const cleanup = () => {
      btn.classList.remove('open');
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('keydown', onKey);
    };
    backdrop.addEventListener('click', closeActivePop);
    document.addEventListener('keydown', onKey);
    _activePop = { sel: sel, cleanup: cleanup };
  }

  function enhanceAllSelects(root) {
    const scope = root || document;
    scope.querySelectorAll('select').forEach(enhanceSelect);
  }

  /* =====================================================================
     2. M3TimePicker — Google Pixel Material 3 Time Picker (Hours & Minutes)
     ===================================================================== */
  function pad2(n) { return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0'); }
  function parseHHMM(val) {
    const m = String(val || '').match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return { h: 12, m: 0 };
    return {
      h: Math.min(23, Math.max(0, parseInt(m[1], 10) || 0)),
      m: Math.min(59, Math.max(0, parseInt(m[2], 10) || 0))
    };
  }
  function formatHHMM(h, m) {
    return pad2(((h % 24) + 24) % 24) + ':' + pad2(((m % 60) + 60) % 60);
  }

  function openTimePicker(opts) {
    closeActivePop();
    const init = parseHHMM(opts && opts.value);
    let curH = init.h;
    let curM = init.m;
    let mode = 'hour'; // 'hour' | 'minute'
    const title = (opts && opts.title) || 'Выбор времени';
    const presets = (opts && opts.presets) || ['Сейчас', '07:00', '08:00', '13:25', '20:00', '22:00', '23:59'];

    const bg = document.createElement('div');
    bg.className = 'm3-dlg-bg';
    const card = document.createElement('div');
    card.className = 'm3-dlg-card';
    card.innerHTML = `
      <div class="m3-dlg-kicker"><span>${title}</span><span style="color:var(--accent);font-weight:800;">24ч</span></div>
      <div class="m3-tp-display">
        <div class="m3-tp-col">
          <button type="button" class="m3-tp-tile active" id="m3-tp-h">${pad2(curH)}</button>
          <div class="m3-tp-step-row">
            <button type="button" class="m3-tp-step" data-step="h-1">−</button>
            <button type="button" class="m3-tp-step" data-step="h+1">+</button>
          </div>
          <div class="m3-tp-sub">Часы</div>
        </div>
        <div class="m3-tp-colon">:</div>
        <div class="m3-tp-col">
          <button type="button" class="m3-tp-tile" id="m3-tp-m">${pad2(curM)}</button>
          <div class="m3-tp-step-row">
            <button type="button" class="m3-tp-step" data-step="m-5">−5</button>
            <button type="button" class="m3-tp-step" data-step="m+5">+5</button>
          </div>
          <div class="m3-tp-sub">Минуты</div>
        </div>
      </div>
      <div class="m3-dial-wrap" id="m3-tp-dial"></div>
      <div class="m3-tp-presets" id="m3-tp-presets"></div>
      <div class="m3-dlg-actions">
        <button type="button" class="m3-btn-text" id="m3-tp-cancel">Отмена</button>
        <button type="button" class="m3-btn-fill" id="m3-tp-ok">Готово</button>
      </div>
    `;
    bg.appendChild(card);
    document.body.appendChild(bg);

    const hBtn = card.querySelector('#m3-tp-h');
    const mBtn = card.querySelector('#m3-tp-m');
    const dial = card.querySelector('#m3-tp-dial');
    const preWrap = card.querySelector('#m3-tp-presets');

    presets.forEach((pr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm3-tp-preset';
      b.textContent = pr;
      b.onclick = () => {
        if (pr === 'Сейчас') {
          const now = new Date();
          curH = now.getHours();
          curM = now.getMinutes();
        } else {
          const p = parseHHMM(pr);
          curH = p.h;
          curM = p.m;
        }
        renderDial();
      };
      preWrap.appendChild(b);
    });

    function renderDial() {
      hBtn.textContent = pad2(curH);
      mBtn.textContent = pad2(curM);
      hBtn.classList.toggle('active', mode === 'hour');
      mBtn.classList.toggle('active', mode === 'minute');

      const R = 128; // half of 256
      const outerR = 102;
      const innerR = 68;

      let angleDeg = 0;
      let handLen = outerR;
      if (mode === 'hour') {
        const isInner = curH === 0 || curH >= 13;
        const idx = curH % 12;
        angleDeg = idx * 30;
        handLen = isInner ? innerR : outerR;
      } else {
        angleDeg = curM * 6;
        handLen = outerR;
      }
      const rad = (angleDeg - 90) * Math.PI / 180;
      const kx = R + Math.cos(rad) * handLen;
      const ky = R + Math.sin(rad) * handLen;

      let html = `<div class="m3-dial-center"></div>`;
      html += `<div class="m3-dial-hand" style="height:${handLen}px;transform:translate(-50%,-100%) rotate(${angleDeg}deg);"></div>`;
      html += `<div class="m3-dial-knob" style="left:${kx}px;top:${ky}px;"></div>`;

      if (mode === 'hour') {
        // Outer ring: 12, 1..11
        for (let i = 0; i < 12; i++) {
          const val = i === 0 ? 12 : i;
          const a = (i * 30 - 90) * Math.PI / 180;
          const x = R + Math.cos(a) * outerR;
          const y = R + Math.sin(a) * outerR;
          html += `<div class="m3-dial-num ${curH === val ? 'selected' : ''}" style="left:${x}px;top:${y}px;">${val}</div>`;
        }
        // Inner ring: 00, 13..23
        for (let i = 0; i < 12; i++) {
          const val = i === 0 ? 0 : i + 12;
          const a = (i * 30 - 90) * Math.PI / 180;
          const x = R + Math.cos(a) * innerR;
          const y = R + Math.sin(a) * innerR;
          html += `<div class="m3-dial-num inner ${curH === val ? 'selected' : ''}" style="left:${x}px;top:${y}px;">${pad2(val)}</div>`;
        }
      } else {
        // Minutes: 00, 05..55
        for (let i = 0; i < 12; i++) {
          const val = i * 5;
          const a = (i * 30 - 90) * Math.PI / 180;
          const x = R + Math.cos(a) * outerR;
          const y = R + Math.sin(a) * outerR;
          html += `<div class="m3-dial-num ${curM === val ? 'selected' : ''}" style="left:${x}px;top:${y}px;">${pad2(val)}</div>`;
        }
      }
      dial.innerHTML = html;
    }

    function pickFromPointer(clientX, clientY) {
      const rect = dial.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let deg = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
      if (deg < 0) deg += 360;

      if (mode === 'hour') {
        const idx = Math.round(deg / 30) % 12;
        const isInner = dist < (rect.width * 0.33);
        if (isInner) curH = idx === 0 ? 0 : idx + 12;
        else curH = idx === 0 ? 12 : idx;
      } else {
        curM = Math.round(deg / 6) % 60;
      }
      renderDial();
    }

    let dragging = false;
    dial.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { dial.setPointerCapture(e.pointerId); } catch (_) {}
      pickFromPointer(e.clientX, e.clientY);
    });
    dial.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      pickFromPointer(e.clientX, e.clientY);
    });
    dial.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      pickFromPointer(e.clientX, e.clientY);
      if (mode === 'hour') {
        setTimeout(() => { mode = 'minute'; renderDial(); }, 120);
      }
    });

    hBtn.onclick = () => { mode = 'hour'; renderDial(); };
    mBtn.onclick = () => { mode = 'minute'; renderDial(); };

    card.querySelectorAll('[data-step]').forEach((b) => {
      b.onclick = () => {
        const s = b.dataset.step;
        if (s === 'h-1') { curH = (curH + 23) % 24; mode = 'hour'; }
        else if (s === 'h+1') { curH = (curH + 1) % 24; mode = 'hour'; }
        else if (s === 'm-5') { curM = (curM + 55) % 60; mode = 'minute'; }
        else if (s === 'm+5') { curM = (curM + 5) % 60; mode = 'minute'; }
        renderDial();
      };
    });

    function close() {
      if (bg.parentNode) bg.parentNode.removeChild(bg);
      document.removeEventListener('keydown', onKey);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    card.querySelector('#m3-tp-cancel').onclick = close;
    card.querySelector('#m3-tp-ok').onclick = () => {
      const val = formatHHMM(curH, curM);
      close();
      if (opts && typeof opts.onChange === 'function') opts.onChange(val);
    };

    renderDial();
  }

  function enhanceTimeInput(el) {
    if (!el || el.dataset.m3TimeBound === '1') return;
    el.dataset.m3TimeBound = '1';
    el.type = 'hidden';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm3-time-btn' + (el.dataset.m3Chip === '1' ? ' m3-time-chip' : '');
    const refresh = () => {
      const v = el.value || '12:00';
      btn.innerHTML = `<span class="m3-time-val">🕒 ${v}</span><span class="m3-sel-chev">▾</span>`;
    };
    refresh();
    el.parentNode.insertBefore(btn, el.nextSibling);
    btn.onclick = () => {
      openTimePicker({
        value: el.value || '12:00',
        title: el.dataset.m3Title || 'Выбор времени',
        onChange: (val) => {
          el.value = val;
          refresh();
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    };
    el._m3RefreshTime = refresh;
  }

  /* =====================================================================
     3. M3DatePicker — Unified M3 Soft Calendar Picker
     ===================================================================== */
  const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const DOW_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function openDatePicker(opts) {
    closeActivePop();
    const todayIso = (window.CoffeeCloudV93 ? window.CoffeeCloudV93.localISO() : new Date().toISOString().slice(0, 10));
    let selected = (opts && opts.value && /^\d{4}-\d{2}-\d{2}$/.test(opts.value)) ? opts.value : todayIso;
    const parts = selected.split('-').map(Number);
    let viewY = parts[0];
    let viewM = parts[1] - 1;
    const title = (opts && opts.title) || 'Выбор даты';

    const bg = document.createElement('div');
    bg.className = 'm3-dlg-bg';
    const card = document.createElement('div');
    card.className = 'm3-dlg-card';
    card.innerHTML = `
      <div class="m3-dlg-kicker"><span>${title}</span><button type="button" class="m3-tp-preset" id="m3-dp-today">Сегодня</button></div>
      <div class="m3-cal-head">
        <button type="button" class="m3-cal-nav" id="m3-dp-prev">‹</button>
        <div class="m3-cal-month" id="m3-dp-lbl"></div>
        <button type="button" class="m3-cal-nav" id="m3-dp-next">›</button>
      </div>
      <div class="m3-cal-grid" id="m3-dp-grid"></div>
      <div class="m3-dlg-actions">
        <button type="button" class="m3-btn-text" id="m3-dp-cancel">Отмена</button>
      </div>
    `;
    bg.appendChild(card);
    document.body.appendChild(bg);

    const lbl = card.querySelector('#m3-dp-lbl');
    const grid = card.querySelector('#m3-dp-grid');

    function close() {
      if (bg.parentNode) bg.parentNode.removeChild(bg);
      document.removeEventListener('keydown', onKey);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    card.querySelector('#m3-dp-cancel').onclick = close;

    function pick(iso) {
      close();
      if (opts && typeof opts.onChange === 'function') opts.onChange(iso);
    }

    card.querySelector('#m3-dp-today').onclick = () => pick(todayIso);
    card.querySelector('#m3-dp-prev').onclick = () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCal(); };
    card.querySelector('#m3-dp-next').onclick = () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCal(); };

    function renderCal() {
      lbl.textContent = MONTHS_RU[viewM] + ' ' + viewY;
      let html = DOW_RU.map((d) => `<div class="m3-cal-dow">${d}</div>`).join('');
      const first = new Date(viewY, viewM, 1);
      const startDow = (first.getDay() + 6) % 7; // Mon=0
      const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
      for (let i = 0; i < startDow; i++) html += `<button type="button" class="m3-cal-day muted" disabled></button>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = viewY + '-' + pad2(viewM + 1) + '-' + pad2(d);
        const cls = ['m3-cal-day'];
        if (iso === todayIso) cls.push('today');
        if (iso === selected) cls.push('selected');
        html += `<button type="button" class="${cls.join(' ')}" data-iso="${iso}">${d}</button>`;
      }
      grid.innerHTML = html;
      grid.querySelectorAll('[data-iso]').forEach((b) => {
        b.onclick = () => pick(b.dataset.iso);
      });
    }
    renderCal();
  }

  window.M3Controls = {
    enhanceAll: function (root) {
      const scope = root || document;
      enhanceAllSelects(scope);
      scope.querySelectorAll('input[data-m3-time="1"]').forEach(enhanceTimeInput);
    },
    enhanceSelect: enhanceSelect,
    syncSelect: syncSelectLabel,
    openTimePicker: openTimePicker,
    openDatePicker: openDatePicker,
    parseHHMM: parseHHMM,
    formatHHMM: formatHHMM,
    closePopups: closeActivePop
  };
})();
