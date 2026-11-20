/* Coffee Illy v95.0 — Unified Material 3 Soft Controls (Google Pixel Time Picker + Custom M3Select) */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const STYLE_ID = 'm3-controls-v95-style';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      .m3-sel-native { position: absolute !important; width: 1px !important; height: 1px !important; opacity: 0 !important; pointer-events: none !important; margin: 0 !important; padding: 0 !important; }
      .m3-sel-wrap { position: relative; display: inline-flex; width: 100%; }
      .m3-sel-wrap.m3-sel-inline { width: auto; min-width: 140px; }
      .m3-sel-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--ink); font-size: 14px; cursor: pointer; text-align: left; transition: border-color .15s, background .15s; min-height: 40px; }
      .m3-sel-btn:hover:not(:disabled) { border-color: var(--accent); }
      .m3-sel-btn:disabled { opacity: .55; cursor: not-allowed; }
      .m3-sel-btn.chip-look { border-radius: 999px; padding: 6px 12px; font-size: 12.5px; min-height: 34px; }
      .m3-sel-chev { width: 16px; height: 16px; flex-shrink: 0; opacity: .7; transition: transform .18s; }
      .m3-sel-btn[aria-expanded="true"] .m3-sel-chev { transform: rotate(180deg); }
      .m3-pop-bg { position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,0.28); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; }
      .m3-pop-bg.desktop-pop { background: transparent; backdrop-filter: none; display: block; }
      .m3-pop-menu { background: var(--card); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 12px 32px rgba(0,0,0,0.28); max-height: 290px; overflow-y: auto; padding: 6px; min-width: 180px; z-index: 9999; }
      .m3-pop-sheet { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--border); border-radius: 24px 24px 0 0; padding: 10px 14px calc(18px + env(safe-area-inset-bottom, 0px)); max-height: 70vh; overflow-y: auto; box-shadow: 0 -10px 30px rgba(0,0,0,0.32); z-index: 9999; }
      .m3-sheet-handle { width: 38px; height: 4px; border-radius: 99px; background: var(--border); margin: 0 auto 10px; }
      .m3-sheet-title { font-size: 13px; font-weight: 600; color: var(--muted); padding: 0 6px 8px; }
      .m3-opt { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: none; background: transparent; color: var(--ink); border-radius: 12px; font-size: 14px; cursor: pointer; text-align: left; }
      .m3-opt:hover { background: var(--surface); }
      .m3-opt.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
      .m3-tp-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--ink); font-size: 15px; font-weight: 600; cursor: pointer; min-height: 44px; }
      .m3-tp-btn:hover { border-color: var(--accent); }
      .m3-tp-dialog { width: min(350px, 94vw); background: var(--card); border: 1px solid var(--border); border-radius: 28px; padding: 20px; box-shadow: 0 18px 44px rgba(0,0,0,0.38); }
      .m3-tp-lbl { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 12px; }
      .m3-tp-tiles { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px; }
      .m3-tp-tile { width: 92px; height: 74px; border-radius: 18px; border: 2px solid transparent; background: var(--surface); color: var(--ink); font-size: 40px; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s; }
      .m3-tp-tile.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
      .m3-tp-colon { font-size: 36px; font-weight: 700; color: var(--muted); }
      .m3-tp-dial { position: relative; width: 244px; height: 244px; margin: 0 auto 14px; border-radius: 50%; background: var(--surface); touch-action: none; user-select: none; }
      .m3-tp-center { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); transform: translate(-50%,-50%); z-index: 3; }
      .m3-tp-hand { position: absolute; left: 50%; top: 50%; width: 2px; background: var(--accent); transform-origin: 50% 100%; z-index: 2; pointer-events: none; }
      .m3-tp-num { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: none; background: transparent; color: var(--ink); font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 4; transition: background .12s, color .12s; }
      .m3-tp-num.inner { font-size: 11.5px; color: var(--muted); }
      .m3-tp-num.selected { background: var(--accent); color: var(--accent-ink); }
      .m3-tp-presets { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 14px; }
      .m3-tp-preset { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); font-size: 12px; cursor: pointer; }
      .m3-tp-preset:hover { border-color: var(--accent); color: var(--accent); }
      .m3-tp-actions { display: flex; justify-content: flex-end; gap: 8px; }
      @media (max-width: 640px) { .m3-sel-btn { min-height: 44px; font-size: 15px; } }
    `;
    document.head.appendChild(st);
  }

  let _activeOverlay = null;
  function closeOverlay() {
    if (_activeOverlay && _activeOverlay.parentNode) _activeOverlay.parentNode.removeChild(_activeOverlay);
    _activeOverlay = null;
  }

  function enhanceSelect(sel) {
    if (!sel || sel.dataset.m3Enhanced === '1' || sel.dataset.m3Skip === '1') return;
    injectStyles();
    sel.dataset.m3Enhanced = '1';
    const isChip = sel.classList.contains('chip-btn');
    const wrap = document.createElement('span');
    wrap.className = 'm3-sel-wrap' + (isChip ? ' m3-sel-inline' : '');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('m3-sel-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm3-sel-btn' + (isChip ? ' chip-look' : '');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.disabled = !!sel.disabled;

    const lblSpan = document.createElement('span');
    lblSpan.style.overflow = 'hidden';
    lblSpan.style.textOverflow = 'ellipsis';
    lblSpan.style.whiteSpace = 'nowrap';

    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '2');
    chev.setAttribute('stroke-linecap', 'round');
    chev.setAttribute('stroke-linejoin', 'round');
    chev.classList.add('m3-sel-chev');
    chev.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    btn.appendChild(lblSpan);
    btn.appendChild(chev);
    wrap.appendChild(btn);

    function syncLabel() {
      const opt = sel.options[sel.selectedIndex];
      lblSpan.textContent = opt ? opt.textContent : '';
      btn.disabled = !!sel.disabled;
    }
    syncLabel();
    sel.addEventListener('change', syncLabel);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (sel.disabled) return;
      closeOverlay();
      const isMobile = window.innerWidth <= 640;
      const bg = document.createElement('div');
      bg.className = 'm3-pop-bg' + (isMobile ? '' : ' desktop-pop');
      bg.onclick = (ev) => { if (ev.target === bg) { btn.setAttribute('aria-expanded', 'false'); closeOverlay(); } };

      const menu = document.createElement('div');
      menu.className = isMobile ? 'm3-pop-sheet' : 'm3-pop-menu';
      if (isMobile) {
        const h = document.createElement('div');
        h.className = 'm3-sheet-handle';
        menu.appendChild(h);
        const fieldLbl = sel.closest('.field') && sel.closest('.field').querySelector('label');
        if (fieldLbl) {
          const t = document.createElement('div');
          t.className = 'm3-sheet-title';
          t.textContent = fieldLbl.textContent;
          menu.appendChild(t);
        }
      } else {
        const rect = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 10) + 'px';
        menu.style.minWidth = Math.max(rect.width, 180) + 'px';
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < 220 && rect.top > spaceBelow) {
          menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        } else {
          menu.style.top = (rect.bottom + 6) + 'px';
        }
      }

      Array.from(sel.options).forEach((o, idx) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'm3-opt' + (idx === sel.selectedIndex ? ' active' : '');
        item.innerHTML = `<span>${o.textContent}</span>${idx === sel.selectedIndex ? '<span>✓</span>' : ''}`;
        item.onclick = () => {
          sel.selectedIndex = idx;
          sel.value = o.value;
          syncLabel();
          btn.setAttribute('aria-expanded', 'false');
          closeOverlay();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
        menu.appendChild(item);
      });

      bg.appendChild(menu);
      document.body.appendChild(bg);
      _activeOverlay = bg;
      btn.setAttribute('aria-expanded', 'true');
    });
  }

  function enhanceSelects(root) {
    const scope = root || document;
    scope.querySelectorAll('select:not([data-m3-enhanced="1"])').forEach(enhanceSelect);
  }

  function openTimePicker(initialHHMM, onSelect, labelText) {
    injectStyles();
    closeOverlay();
    const m = String(initialHHMM || '08:00').match(/(\d{1,2}):(\d{2})/);
    let hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 8;
    let mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
    let mode = 'h';

    const pad = (n) => String(n).padStart(2, '0');
    const bg = document.createElement('div');
    bg.className = 'm3-pop-bg';
    bg.onclick = (e) => { if (e.target === bg) closeOverlay(); };

    const dlg = document.createElement('div');
    dlg.className = 'm3-tp-dialog';
    bg.appendChild(dlg);

    function renderDial() {
      const presets = ['07:30', '08:30', '11:00', '14:00', '18:00', '21:30', '22:30', '23:59'];
      dlg.innerHTML = `
        <div class="m3-tp-lbl">${labelText || 'Выберите время'}</div>
        <div class="m3-tp-tiles">
          <button type="button" class="m3-tp-tile ${mode === 'h' ? 'active' : ''}" id="m3-tp-h">${pad(hh)}</button>
          <span class="m3-tp-colon">:</span>
          <button type="button" class="m3-tp-tile ${mode === 'm' ? 'active' : ''}" id="m3-tp-m">${pad(mm)}</button>
        </div>
        <div class="m3-tp-dial" id="m3-tp-dial">
          <div class="m3-tp-center"></div>
          <div class="m3-tp-hand" id="m3-tp-hand"></div>
        </div>
        <div class="m3-tp-presets">${presets.map(p => `<button type="button" class="m3-tp-preset" data-p="${p}">${p}</button>`).join('')}</div>
        <div class="m3-tp-actions">
          <button type="button" class="chip-btn" id="m3-tp-cancel">Отмена</button>
          <button type="button" class="chip-btn accent" id="m3-tp-ok">Готово</button>
        </div>`;

      dlg.querySelector('#m3-tp-h').onclick = () => { mode = 'h'; renderDial(); };
      dlg.querySelector('#m3-tp-m').onclick = () => { mode = 'm'; renderDial(); };
      dlg.querySelector('#m3-tp-cancel').onclick = closeOverlay;
      dlg.querySelector('#m3-tp-ok').onclick = () => {
        const val = pad(hh) + ':' + pad(mm);
        closeOverlay();
        if (onSelect) onSelect(val);
      };
      dlg.querySelectorAll('[data-p]').forEach(b => {
        b.onclick = () => {
          const parts = b.dataset.p.split(':');
          hh = Number(parts[0]); mm = Number(parts[1]);
          renderDial();
        };
      });

      const dial = dlg.querySelector('#m3-tp-dial');
      const hand = dlg.querySelector('#m3-tp-hand');
      const cx = 122, cy = 122;

      if (mode === 'h') {
        const outerR = 98, innerR = 64;
        for (let i = 0; i < 12; i++) {
          const ang = (i * 30 - 90) * Math.PI / 180;
          const bOut = document.createElement('button');
          bOut.type = 'button';
          bOut.className = 'm3-tp-num' + (hh === i ? ' selected' : '');
          bOut.textContent = pad(i);
          bOut.style.left = (cx + outerR * Math.cos(ang)) + 'px';
          bOut.style.top = (cy + outerR * Math.sin(ang)) + 'px';
          bOut.onclick = () => { hh = i; mode = 'm'; renderDial(); };
          dial.appendChild(bOut);

          const hIn = i + 12;
          const bIn = document.createElement('button');
          bIn.type = 'button';
          bIn.className = 'm3-tp-num inner' + (hh === hIn ? ' selected' : '');
          bIn.textContent = pad(hIn);
          bIn.style.left = (cx + innerR * Math.cos(ang)) + 'px';
          bIn.style.top = (cy + innerR * Math.sin(ang)) + 'px';
          bIn.onclick = () => { hh = hIn; mode = 'm'; renderDial(); };
          dial.appendChild(bIn);
        }
        const hDeg = (hh % 12) * 30;
        const hLen = hh >= 12 ? innerR : outerR;
        hand.style.height = hLen + 'px';
        hand.style.marginTop = (-hLen) + 'px';
        hand.style.transform = `rotate(${hDeg}deg)`;
      } else {
        const r = 98;
        for (let i = 0; i < 12; i++) {
          const val = i * 5;
          const ang = (i * 30 - 90) * Math.PI / 180;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'm3-tp-num' + (mm === val ? ' selected' : '');
          b.textContent = pad(val);
          b.style.left = (cx + r * Math.cos(ang)) + 'px';
          b.style.top = (cy + r * Math.sin(ang)) + 'px';
          b.onclick = () => { mm = val; renderDial(); };
          dial.appendChild(b);
        }
        const mDeg = mm * 6;
        hand.style.height = r + 'px';
        hand.style.marginTop = (-r) + 'px';
        hand.style.transform = `rotate(${mDeg}deg)`;
      }
    }

    renderDial();
    document.body.appendChild(bg);
    _activeOverlay = bg;
  }

  function bindTimeField(hiddenInputId, btnId, labelText) {
    const inp = document.getElementById(hiddenInputId);
    const btn = document.getElementById(btnId);
    if (!inp || !btn) return;
    btn.onclick = () => {
      openTimePicker(inp.value, (val) => {
        inp.value = val;
        const valEl = btn.querySelector('[data-tp-val]');
        if (valEl) valEl.textContent = val;
        else btn.textContent = val;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }, labelText);
    };
  }

  if (typeof MutationObserver !== 'undefined') {
    const startObs = () => {
      enhanceSelects(document);
      const mo = new MutationObserver(() => enhanceSelects(document));
      mo.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObs);
    else startObs();
  }

  window.M3Controls = {
    enhanceSelects: enhanceSelects,
    openTimePicker: openTimePicker,
    bindTimeField: bindTimeField,
    closeOverlay: closeOverlay
  };
})();
