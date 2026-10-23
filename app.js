(() => {
  // Orange, sky, green, navy and their tints/shades.
  const SW = ['#E07B45', '#4A9DD8', '#3B7A35', '#2E6A8E', '#B5562A', '#73D168', '#74C2EE', '#E5A57E'];
  const KINDS = {
    focus: { name: 'Focus', label: 'Focus', color: '#E07B45', dur: 25 },
    short: { name: 'Short break', label: 'Short break', color: '#4A9DD8', dur: 5 },
    long:  { name: 'Long break', label: 'Long break', color: '#3B7A35', dur: 15 },
  };
  const LS = 'focus-timer-v2';
  const MIN = 60000;
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- state ---------- */
  let state = load() || { blocks: sample(), run: null, h24: true, sound: true };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      if (s && Array.isArray(s.blocks)) return s;
    } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

  function mk(kind, extra = {}) {
    const k = KINDS[kind];
    return Object.assign({ id: uid(), kind, label: k.label, color: k.color, at: '', dur: k.dur }, extra);
  }

  function sample() {
    // Example plan: first session pinned to the next half hour, lunch pinned later.
    const d = new Date(); d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
    const t = d.getTime();
    return [
      mk('focus', { label: 'Deep work', at: hhmm(t) }),
      mk('short'),
      mk('focus', { label: 'Writing' }),
      mk('short', { label: 'Stretch', color: '#73D168' }),
      mk('focus', { label: 'Email and admin', color: '#2E6A8E' }),
      mk('long', { label: 'Lunch', at: hhmm(t + 95 * MIN), dur: 45 }),
      mk('focus', { label: 'Review and plan', color: '#B5562A' }),
    ];
  }

  /* ---------- schedule maths ---------- */
  // Nearest occurrence of HH:MM within ±12h of ref.
  function clockToMs(at, ref) {
    const [h, m] = at.split(':').map(Number);
    const d = new Date(ref); d.setHours(h, m, 0, 0);
    let ms = d.getTime();
    if (ms < ref - 12 * 60 * MIN) { d.setDate(d.getDate() + 1); ms = d.getTime(); }
    else if (ms > ref + 12 * 60 * MIN) { d.setDate(d.getDate() - 1); ms = d.getTime(); }
    return ms;
  }

  function build(anchor, run) {
    const B = state.blocks, out = [];
    const ext = (run && run.ext) || {}, cut = (run && run.cut) || {}, go = (run && run.go) || {};
    for (let i = 0; i < B.length; i++) {
      const b = B[i], prev = out[i - 1];
      const ref = prev ? prev.start : anchor;
      const start = go[b.id] != null ? go[b.id] : b.at ? clockToMs(b.at, ref) : prev ? prev.end : anchor;
      const nb = B[i + 1];
      let end, untilNext = false;
      if (b.dur > 0) end = start + b.dur * MIN;
      else if (nb && (nb.at || go[nb.id] != null)) {
        end = go[nb.id] != null ? go[nb.id] : clockToMs(nb.at, start);
        untilNext = true;
        if (end <= start) end = start + KINDS[b.kind].dur * MIN;
      } else end = start + KINDS[b.kind].dur * MIN;
      end += ext[b.id] || 0;
      if (cut[b.id] != null) end = Math.max(start, Math.min(end, cut[b.id]));
      out.push({ b, start, end, untilNext });
    }
    out.forEach((x, i) => {
      const n = out[i + 1];
      x.eff = x.end; x.overlap = false; x.back = false;
      if (n && n.start < x.start) x.back = true;
      else if (n && n.start < x.end) { x.eff = n.start; x.overlap = true; }
    });
    return out;
  }

  function status(t, tl) {
    if (!tl.length) return { mode: 'empty' };
    for (let i = 0; i < tl.length; i++) if (t >= tl[i].start && t < tl[i].eff) return { mode: 'block', i };
    let j = -1;
    tl.forEach((x, i) => { if (x.start > t && x.eff > x.start && (j < 0 || x.start < tl[j].start)) j = i; });
    if (j < 0) return { mode: 'done' };
    const started = tl.some((x) => x.start <= t);
    return { mode: started ? 'gap' : 'wait', j };
  }

  function currentTL(now) {
    return state.run ? build(state.run.anchor, state.run) : build(Math.floor(now / 1000) * 1000, null);
  }

  /* ---------- formatting ---------- */
  function fmtClock(ms, withSec) {
    const d = new Date(ms);
    let h = d.getHours(), suf = '';
    if (!state.h24) { suf = h < 12 ? ' am' : ' pm'; h = h % 12 || 12; }
    return (state.h24 ? pad(h) : h) + ':' + pad(d.getMinutes()) + (withSec ? ':' + pad(d.getSeconds()) : '') + suf;
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
  }
  function fmtSpan(ms) {
    const m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? `${h}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`;
  }

  /* ---------- dial ticks ---------- */
  (function drawTicks() {
    let s = '';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, major = i % 5 === 0;
      const r1 = 116, r2 = major ? 109 : 112;
      s += `<line class="tick${major ? ' major' : ''}" x1="${120 + r1 * Math.sin(a)}" y1="${120 - r1 * Math.cos(a)}" x2="${120 + r2 * Math.sin(a)}" y2="${120 - r2 * Math.cos(a)}" stroke-width="${major ? 2 : 1}" stroke-linecap="round"></line>`;
    }
    $('ticks').innerHTML = s;
  })();
  const C = 2 * Math.PI * 100;
  $('prog').style.strokeDasharray = C;

  /* ---------- plan list ---------- */
  const ICON = {
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10l4-4 4 4"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>',
    del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };

  function renderList() {
    const B = state.blocks, el = $('blocks');
    if (!B.length) {
      el.innerHTML = '<li class="empty">No blocks yet. Add a focus session below, or open Quick build.</li>';
      return;
    }
    el.innerHTML = B.map((b, i) => {
      const kinds = Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === b.kind ? ' selected' : ''}>${v.name}</option>`).join('');
      const start = b.at
        ? `<label class="field"><span class="lbl">Starts at</span><input type="time" class="at-in" id="at-${b.id}" value="${b.at}"><button type="button" class="clear-at" data-act="clear" aria-label="Remove clock time" title="Remove clock time">×</button></label>`
        : `<button type="button" class="follow" data-act="pin" title="Pin this block to a clock time">${i === 0 ? 'Starts when you press <b>Start</b>' : 'Starts <b>after previous</b>'} · set time</button>`;
      return `<li class="block" data-id="${b.id}" style="--c:${b.color}">
        <button type="button" class="swatch" data-act="color" aria-label="Change colour" title="Change colour">${i + 1}</button>
        <input class="label-in" id="lbl-${b.id}" value="${esc(b.label)}" aria-label="Block name" maxlength="60">
        <div class="row-actions">
          <button type="button" class="icon-btn" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="Move down" ${i === B.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button type="button" class="icon-btn" data-act="del" aria-label="Delete block">${ICON.del}</button>
        </div>
        <div class="meta">
          <label class="field"><select class="kind-in" id="kind-${b.id}" aria-label="Block type">${kinds}</select></label>
          ${start}
          <label class="field"><span class="lbl">Length</span><input type="number" class="dur-in" id="dur-${b.id}" min="1" max="600" value="${b.dur || ''}"><span class="lbl">min</span></label>
          <span class="times"></span>
          <span class="warn" hidden></span>
        </div>
      </li>`;
    }).join('');
  }

  function updateList(tl, st, t) {
    const rows = $('blocks').querySelectorAll('.block');
    rows.forEach((row, i) => {
      const x = tl[i]; if (!x) return;
      row.querySelector('.times').textContent = `${fmtClock(x.start)} – ${fmtClock(x.eff)}`;
      const dur = row.querySelector('.dur-in');
      const nb = state.blocks[i + 1];
      dur.placeholder = nb && nb.at ? 'to next' : String(KINDS[x.b.kind].dur);
      const w = row.querySelector('.warn');
      const msg = x.back ? 'The next block is pinned to an earlier time than this one starts.'
        : x.overlap ? `Cut short to ${fmtSpan(x.eff - x.start)}: the next block is pinned to ${fmtClock(x.eff)}.` : '';
      w.hidden = !msg; w.textContent = msg;
      row.classList.toggle('on', st.mode === 'block' && st.i === i);
      row.classList.toggle('past', !!state.run && x.eff <= t && !(st.mode === 'block' && st.i === i));
    });
  }

  function blockIndex(el) {
    const row = el.closest('.block');
    return row ? state.blocks.findIndex((b) => b.id === row.dataset.id) : -1;
  }

  $('blocks').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const i = blockIndex(btn); if (i < 0) return;
    const B = state.blocks, b = B[i], act = btn.dataset.act;
    if (act === 'color') {
      b.color = SW[(SW.indexOf(b.color) + (e.shiftKey ? SW.length - 1 : 1)) % SW.length];
      btn.closest('.block').style.setProperty('--c', b.color);
      changed(false); return;
    }
    if (act === 'pin') {
      const tl = currentTL(Date.now());
      b.at = hhmm(tl[i] ? tl[i].start : Date.now());
      changed(true);
      const inp = $('at-' + b.id); if (inp) inp.focus();
      return;
    }
    if (act === 'clear') b.at = '';
    if (act === 'up' && i > 0) [B[i - 1], B[i]] = [B[i], B[i - 1]];
    if (act === 'down' && i < B.length - 1) [B[i + 1], B[i]] = [B[i], B[i + 1]];
    if (act === 'del') B.splice(i, 1);
    changed(true);
  });

  $('blocks').addEventListener('input', (e) => {
    const i = blockIndex(e.target); if (i < 0) return;
    const b = state.blocks[i];
    if (e.target.classList.contains('label-in')) b.label = e.target.value;
    else if (e.target.classList.contains('dur-in')) { const v = parseInt(e.target.value, 10); b.dur = v > 0 ? Math.min(v, 600) : null; }
    else if (e.target.classList.contains('at-in')) { if (e.target.value) b.at = e.target.value; }
    else return;
    changed(false);
  });

  $('blocks').addEventListener('change', (e) => {
    const i = blockIndex(e.target); if (i < 0) return;
    const b = state.blocks[i];
    if (e.target.classList.contains('kind-in')) {
      const old = KINDS[b.kind], nk = KINDS[e.target.value];
      if (b.label === old.label || !b.label.trim()) b.label = nk.label;
      if (b.color === old.color) b.color = nk.color;
      if (b.dur === old.dur) b.dur = nk.dur;
      b.kind = e.target.value;
      changed(true);
    } else if (e.target.classList.contains('at-in') && !e.target.value) {
      b.at = ''; changed(true);
    }
  });

  document.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    state.blocks.push(mk(btn.dataset.add));
    changed(true);
    const last = state.blocks[state.blocks.length - 1];
    const inp = $('lbl-' + last.id); if (inp) { inp.focus(); inp.select(); }
  }));

  /* ---------- quick build ---------- */
  (function initQB() {
    const d = new Date(); d.setSeconds(0, 0); d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
    $('qbStart').value = hhmm(d.getTime());
  })();
  let qbMode = 'replace';
  $('qbForm').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) qbMode = b.dataset.mode; });
  $('qbForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const num = (id, d) => { const v = parseInt($(id).value, 10); return v > 0 ? v : d; };
    const count = num('qbCount', 4), f = num('qbFocus', 25), s = num('qbShort', 5), l = num('qbLong', 15), every = num('qbEvery', 4);
    const pin = $('qbPin').checked, startAt = $('qbStart').value;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(mk('focus', { dur: f, label: count > 1 ? `Focus ${i + 1}` : 'Focus' }));
      if (i < count - 1) out.push((i + 1) % every === 0 ? mk('long', { dur: l }) : mk('short', { dur: s }));
    }
    let t;
    if (startAt) t = clockToMs(startAt, Date.now());
    else if (qbMode === 'append' && state.blocks.length) { const tl = currentTL(Date.now()); t = tl[tl.length - 1].eff; }
    else t = Date.now();
    out.forEach((b, i) => {
      if (pin || (i === 0 && startAt)) b.at = hhmm(t);
      t += b.dur * MIN;
    });
    state.blocks = qbMode === 'append' ? state.blocks.concat(out) : out;
    if (qbMode === 'replace') state.run = null;
    changed(true);
  });

  /* ---------- clear all, with confirmation and undo ---------- */
  const UNDO_MS = 8000;
  let undoData = null, undoTimer = null;

  $('btnClear').addEventListener('click', () => {
    if (!state.blocks.length) return;
    const n = state.blocks.length;
    $('clearMsg').textContent = `Clear all ${n} block${n === 1 ? '' : 's'} from your plan?` + (state.run ? ' The running timer will stop.' : '');
    $('clearConfirm').hidden = false;
    $('clearCancel').focus();
  });
  $('clearCancel').addEventListener('click', () => { $('clearConfirm').hidden = true; $('btnClear').focus(); });
  $('clearYes').addEventListener('click', () => {
    $('clearConfirm').hidden = true;
    const n = state.blocks.length;
    undoData = JSON.stringify({ blocks: state.blocks, run: state.run });
    state.blocks = []; state.run = null; lastKey = null; keepAwake(false);
    changed(true);
    showToast(`Plan cleared. ${n} block${n === 1 ? '' : 's'} removed.`);
  });
  $('toastUndo').addEventListener('click', () => {
    if (!undoData) return;
    const d = JSON.parse(undoData);
    state.blocks = d.blocks; state.run = d.run;
    lastKey = null;
    if (state.run && !state.run.pausedAt) keepAwake(true);
    hideToast();
    changed(true);
    showToast('Plan restored.', false);
  });
  $('toastClose').addEventListener('click', hideToast);

  function showToast(msg, undoable = true) {
    clearTimeout(undoTimer);
    const t = $('toast'), bar = $('toastBar');
    $('toastMsg').textContent = msg;
    $('toastUndo').hidden = !undoable;
    if (!undoable) undoData = null;
    t.hidden = false;
    const ms = undoable ? UNDO_MS : 2500;
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${ms}ms linear`; bar.style.transform = 'scaleX(0)';
    undoTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(undoTimer);
    $('toast').hidden = true;
    undoData = null;
  }

  /* ---------- run controls ---------- */
  let lastKey = null, wakeLock = null, actx = null;

  function ensureAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function chime(kind) {
    if (!state.sound || !actx) return;
    const notes = kind === 'focus' ? [523.25, 659.25, 783.99] : kind === 'done' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
    try {
      notes.forEach((f, k) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t0 = actx.currentTime + k * 0.18;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
        o.connect(g).connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.75);
      });
    } catch (e) {}
  }
  function notify(title, body) {
    try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body }); } catch (e) {}
  }
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  function startOrPause() {
    ensureAudio();
    if (!state.blocks.length) return;
    const now = Date.now();
    if (!state.run) {
      state.run = { anchor: now, ext: {}, cut: {}, go: {}, pausedAt: null };
      lastKey = null;
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch (e) {}
      keepAwake(true);
    } else if (state.run.pausedAt) {
      const tl = currentTL(now), st = status(state.run.pausedAt, tl);
      if (st.mode === 'block') {
        const id = tl[st.i].b.id;
        state.run.ext[id] = (state.run.ext[id] || 0) + (now - state.run.pausedAt);
      }
      state.run.pausedAt = null;
      keepAwake(true);
    } else {
      state.run.pausedAt = now;
      keepAwake(false);
    }
    changed(false);
  }
  function skip() {
    if (!state.run) return;
    ensureAudio();
    const now = state.run.pausedAt || Date.now();
    const tl = currentTL(now), st = status(now, tl);
    if (st.mode === 'block') state.run.cut[tl[st.i].b.id] = now;
    else if (st.mode === 'wait' || st.mode === 'gap') state.run.go[tl[st.j].b.id] = now;
    if (state.run.pausedAt) state.run.pausedAt = Date.now();
    changed(false);
  }
  function reset() {
    state.run = null; lastKey = null; keepAwake(false);
    changed(false);
  }
  $('btnStart').addEventListener('click', startOrPause);
  $('btnSkip').addEventListener('click', skip);
  $('btnStop').addEventListener('click', reset);
  $('tglSound').addEventListener('click', () => { state.sound = !state.sound; ensureAudio(); changed(false); });
  $('tgl24').addEventListener('click', () => { state.h24 = !state.h24; changed(false); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (e.target.closest('input, select, textarea, button, summary')) return;
    e.preventDefault(); startOrPause();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.run && !state.run.pausedAt) keepAwake(true); });

  /* ---------- rendering ---------- */
  let tlSig = '';
  function renderTimeline(tl, st, t) {
    const bar = $('trackBar');
    const live = tl.filter((x) => x.eff > x.start);
    if (!live.length) { bar.innerHTML = ''; $('scaleStart').textContent = ''; $('scaleEnd').textContent = ''; tlSig = ''; return; }
    const lo = Math.min(...live.map((x) => x.start)), hi = Math.max(...live.map((x) => x.eff));
    const span = Math.max(hi - lo, 1);
    const sig = live.map((x) => [x.b.id, x.b.color, Math.floor(x.start / 1000), Math.floor(x.eff / 1000), x.b.label].join()).join('|') + (st.mode === 'block' ? st.i : '') + state.h24;
    if (sig !== tlSig) {
      tlSig = sig;
      bar.innerHTML = live.map((x) => {
        const i = tl.indexOf(x);
        return `<div class="seg" data-i="${i}" style="--c:${x.b.color};left:${((x.start - lo) / span) * 100}%;width:${((x.eff - x.start) / span) * 100}%" title="${esc(x.b.label)} · ${fmtClock(x.start)} – ${fmtClock(x.eff)}"></div>`;
      }).join('') + '<div class="nowline" id="nowline" hidden></div>';
      $('scaleStart').textContent = fmtClock(lo);
      $('scaleEnd').textContent = fmtClock(hi);
    }
    bar.querySelectorAll('.seg').forEach((s) => {
      const i = +s.dataset.i;
      s.classList.toggle('on', st.mode === 'block' && st.i === i);
      s.classList.toggle('past', !!state.run && tl[i].eff <= t);
    });
    const nl = $('nowline');
    if (nl) { const inRange = t >= lo && t <= hi; nl.hidden = !inRange; if (inRange) nl.style.left = ((t - lo) / span) * 100 + '%'; }

    const focus = tl.filter((x) => x.b.kind === 'focus').reduce((a, x) => a + Math.max(0, x.eff - x.start), 0);
    const nF = tl.filter((x) => x.b.kind === 'focus').length;
    $('summary').textContent = `${nF} focus session${nF === 1 ? '' : 's'} · ${fmtSpan(focus)} of focus · ${fmtClock(lo)} → ${fmtClock(hi)}`;
  }

  function setCur(color) { document.documentElement.style.setProperty('--cur', color); }

  function renderDial(st, tl, t, now) {
    const run = state.run;
    let color = KINDS.focus.color, chip = 'Ready', label = 'Add a session to begin', cd = '00:00', sub = '', frac = 1, dashed = false, next = null;
    if (st.mode === 'empty') { /* defaults */ }
    else if (st.mode === 'idle') {
      const f = tl[0];
      color = f.b.color; label = f.b.label || KINDS[f.b.kind].name; cd = fmtDur(f.eff - f.start);
      sub = f.b.at && f.start > now ? `Starts at ${fmtClock(f.start)} · press Start to arm` : `${fmtClock(f.start)} – ${fmtClock(f.eff)} if you start now`;
      next = tl[1];
    } else if (st.mode === 'block') {
      const x = tl[st.i];
      color = x.b.color; chip = KINDS[x.b.kind].name; label = x.b.label || chip;
      cd = fmtDur(x.eff - t); sub = `${fmtClock(x.start)} – ${fmtClock(x.eff)}`;
      frac = (x.eff - t) / Math.max(1, x.eff - x.start);
      next = tl.slice(st.i + 1).find((n) => n.eff > n.start);
    } else if (st.mode === 'wait' || st.mode === 'gap') {
      const n = tl[st.j];
      color = n.b.color; chip = st.mode === 'wait' ? 'Waiting to start' : 'Free time';
      label = `${n.b.label || KINDS[n.b.kind].name} starts at ${fmtClock(n.start)}`;
      cd = fmtDur(n.start - t); sub = 'Skip to start it now'; dashed = true; next = n;
    } else if (st.mode === 'done') {
      const last = tl[tl.length - 1];
      color = last.b.color; chip = 'All done'; label = 'Plan complete';
      cd = '00:00'; sub = `Finished at ${fmtClock(Math.max(...tl.map((x) => x.eff)))}`; frac = 0;
    }
    const paused = run && run.pausedAt;
    setCur(color);
    const chipEl = $('phaseChip');
    chipEl.textContent = paused ? `${chip} · paused` : chip;
    chipEl.classList.toggle('is-paused', !!paused);
    $('dialLabel').textContent = label;
    $('countdown').textContent = cd;
    $('dialSub').textContent = sub;
    const prog = $('prog');
    prog.classList.toggle('dashed', dashed);
    prog.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, frac)));

    const up = $('upNext');
    if (next && st.mode !== 'wait' && st.mode !== 'gap') {
      up.hidden = false;
      up.innerHTML = `<span class="dot" style="--c:${next.b.color}"></span><div><div class="k">Up next</div><div class="v">${esc(next.b.label || KINDS[next.b.kind].name)}</div></div><span class="t">${fmtClock(next.start)}</span>`;
    } else up.hidden = true;

    const bs = $('btnStart');
    bs.textContent = !run ? 'Start' : paused ? 'Resume' : 'Pause';
    bs.disabled = !state.blocks.length;
    $('btnSkip').disabled = !run || st.mode === 'done';
    $('btnSkip').textContent = run && (st.mode === 'wait' || st.mode === 'gap') ? 'Start now' : 'Skip';
    $('btnStop').disabled = !run;
    $('tglSound').textContent = state.sound ? 'Sound on' : 'Sound off';
    $('tglSound').setAttribute('aria-pressed', String(state.sound));
    $('tgl24').setAttribute('aria-pressed', String(state.h24));
    $('tgl24').textContent = state.h24 ? '24-hour clock' : '12-hour clock';
    document.title = run && st.mode !== 'done' ? `${cd} · ${label}` : 'Focus Timer';
    cheerMood(st.mode === 'block' ? tl[st.i].b.kind : st.mode);
  }

  function onTransition(st, tl) {
    const card = $('timerCard');
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    if (st.mode === 'block') {
      const x = tl[st.i];
      chime(x.b.kind);
      notify(`${x.b.label || KINDS[x.b.kind].name} started`, `Until ${fmtClock(x.eff)}`);
    } else if (st.mode === 'done') {
      chime('done'); confetti(); notify('Plan complete', 'Every session and break is finished.');
      keepAwake(false);
    } else {
      chime('short');
    }
  }

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas'); c.className = 'confetti'; document.body.appendChild(c);
    const dpr = window.devicePixelRatio || 1, W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
    const ctx = c.getContext('2d');
    const P = Array.from({ length: 160 }, () => ({
      x: W / 2, y: H * 0.4, vx: (Math.random() - 0.5) * W * 0.022, vy: -Math.random() * H * 0.028 - H * 0.006,
      r: (5 + Math.random() * 7) * dpr, c: SW[Math.floor(Math.random() * SW.length)], a: Math.random() * 6,
    }));
    let f = 0;
    (function step() {
      ctx.clearRect(0, 0, W, H);
      P.forEach((p) => {
        p.vy += H * 0.0009; p.x += p.vx; p.y += p.vy; p.a += 0.2;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
      });
      if (++f < 170) requestAnimationFrame(step); else c.remove();
    })();
  }

  /* ---------- encouragement ---------- */
  const CHEERS = {
    work: ['You can do it.', 'You are strengthened.', 'Keep it up.', 'One step at a time.', 'You’ve got this.',
      'Small steps add up.', 'Stay with it. You’re doing well.', 'Progress, not perfection.', 'Every minute counts.',
      'You are stronger than you think.', 'Focus now, celebrate later.', 'Keep going. It’s working.'],
    rest: ['Rest well. You earned it.', 'Breathe in. Breathe out.', 'Stretch and drink some water.',
      'Rest is part of the work.', 'Great effort. Recharge now.'],
    done: ['You did it!', 'Well done. Every block finished.', 'Proud of you. Plan complete.'],
  };
  let cheerSet = 'work', cheerLast = '', cheerAt = 0;
  function cheerMood(mode) {
    const set = mode === 'done' ? 'done' : mode === 'short' || mode === 'long' || mode === 'gap' ? 'rest' : 'work';
    if (set !== cheerSet) { cheerSet = set; showCheer(); }
    else if (Date.now() - cheerAt > 12000) showCheer();
  }
  function showCheer() {
    cheerAt = Date.now();
    const list = CHEERS[cheerSet].filter((c) => c !== cheerLast);
    const text = list[Math.floor(Math.random() * list.length)];
    cheerLast = text;
    const el = $('cheer');
    el.classList.add('out');
    setTimeout(() => { el.textContent = text; el.classList.remove('out'); }, 450);
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  $('nowTz').textContent = tz ? '· ' + tz.replace(/_/g, ' ') : '';

  function tick() {
    const now = Date.now();
    const d = new Date(now);
    let h = d.getHours(), suf = '';
    if (!state.h24) { suf = h < 12 ? ' am' : ' pm'; h = h % 12 || 12; }
    $('nowTime').innerHTML = `${state.h24 ? pad(h) : h}:${pad(d.getMinutes())}<span class="sec">:${pad(d.getSeconds())}</span>${suf ? `<small style="font-size:.45em">${suf}</small>` : ''}`;
    $('nowDate').textContent = dateFmt.format(d);

    if (state.run && !state.blocks.length) state.run = null;
    const run = state.run;
    const tl = currentTL(now);
    const t = run && run.pausedAt ? run.pausedAt : now;
    const st = !tl.length ? { mode: 'empty' } : run ? status(t, tl) : { mode: 'idle' };
    const key = st.mode + ':' + (st.i != null ? tl[st.i].b.id : st.j != null ? tl[st.j].b.id : '');
    if (run && !run.pausedAt && lastKey !== null && key !== lastKey) onTransition(st, tl);
    lastKey = run ? key : null;

    renderDial(st, tl, t, now);
    renderTimeline(tl, st, t);
    updateList(tl, st, t);
  }

  function changed(structural) {
    if (structural) renderList();
    save();
    tick();
  }

  renderList();
  if (state.run && !state.run.pausedAt) keepAwake(true);
  tick();
  setInterval(tick, 250);
})();
