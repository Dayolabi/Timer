(() => {
  /* ---------- constants ---------- */
  // Orange, sky, green, navy and their tints/shades.
  const SW = ['#E07B45', '#4A9DD8', '#3B7A35', '#2E6A8E', '#B5562A', '#73D168', '#74C2EE', '#E5A57E'];
  const KINDS = {
    focus: { name: 'Focus', label: 'Focus', color: '#E07B45', dur: 25 },
    short: { name: 'Short break', label: 'Short break', color: '#4A9DD8', dur: 5 },
    long:  { name: 'Long break', label: 'Long break', color: '#3B7A35', dur: 15 },
  };
  const LS = 'focus-timer-v2';
  const MIN = 60000;
  const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const CHEERS = {
    work: ['You can do it.', 'You are strengthened.', 'Keep it up.', 'One step at a time.', 'You’ve got this.',
      'Small steps add up.', 'Stay with it. You’re doing well.', 'Progress, not perfection.', 'Every minute counts.',
      'You are stronger than you think.', 'Focus now, celebrate later.', 'Keep going. It’s working.'],
    rest: ['Rest well. You earned it.', 'Breathe in. Breathe out.', 'Stretch and drink some water.',
      'Rest is part of the work.', 'Great effort. Recharge now.'],
    done: ['You did it!', 'Well done. Every block finished.', 'Proud of you. Plan complete.'],
  };
  const ICON = {
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10l4-4 4 4"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>',
    del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };
  const C = 2 * Math.PI * 100;

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------- state ---------- */
  const DEFAULTS = {
    blocks: [], run: null, h24: true,
    sound: 'chime', volume: 0.7, warnMin: 1,
    autoStart: false, autoDone: null,
    templates: [], autoLoaded: '',
    history: {}, cheers: [], cheerMode: 'both',
  };
  let state = Object.assign({}, DEFAULTS, load() || {});
  if (state.sound === true) state.sound = 'chime';
  if (state.sound === false) state.sound = 'off';

  let lastKey = null, lastBlockId = null, lastTick = Date.now(), lastSave = 0, warnedKey = '';
  let wakeLock = null, actx = null, deferredInstall = null;
  let toastAction = null, toastTimer = null;
  let tlSig = '', progSig = '', iconSig = '';
  let cheerSet = 'work', cheerLast = '', cheerAt = 0;
  let qbMode = 'replace', sharedBlocks = null;
  const iconLinks = [...document.querySelectorAll('link[rel="icon"]')];
  const iconOrig = iconLinks.map((l) => [l.getAttribute('href'), l.getAttribute('type')]);
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = iconCanvas.height = 64;
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const fullDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      if (s && Array.isArray(s.blocks)) return s;
    } catch (e) {}
    return null;
  }
  function save() { lastSave = Date.now(); try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

  function mk(kind, extra = {}) {
    const k = KINDS[kind];
    return Object.assign({ id: uid(), kind, label: k.label, color: k.color, at: '', dur: k.dur, task: '', taskDone: false }, extra);
  }
  const snapshot = () => JSON.stringify({ blocks: state.blocks, run: state.run });
  function restore(snap, msg = 'Restored.') {
    const d = JSON.parse(snap);
    state.blocks = d.blocks; state.run = d.run;
    lastKey = null; lastBlockId = null;
    if (state.run && !state.run.pausedAt) keepAwake(true);
    changed(true);
    showToast(msg);
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
  function fmtAt(at) { const [h, m] = at.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return fmtClock(d.getTime()); }
  function fmtDur(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
  }
  function fmtSpan(ms) {
    const m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? `${h}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`;
  }
  const nameOf = (b) => b.label || KINDS[b.kind].name;

  /* ---------- toast ---------- */
  function showToast(msg, opts = {}) {
    const { action = '', onAction = null } = opts;
    const ms = opts.ms || (action ? 8000 : 3000);
    clearTimeout(toastTimer);
    const bar = $('toastBar');
    $('toastMsg').textContent = msg;
    $('toastUndo').textContent = action;
    $('toastUndo').hidden = !action;
    toastAction = onAction;
    $('toast').hidden = false;
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${ms}ms linear`; bar.style.transform = 'scaleX(0)';
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; toastAction = null; }

  /* ---------- plan list ---------- */
  function renderList() {
    const B = state.blocks, el = $('blocks');
    if (!B.length) {
      el.innerHTML = '<li class="empty">Your plan is empty. Add a focus session or a break below, open Quick build, or load a saved plan.</li>';
      return;
    }
    el.innerHTML = B.map((b, i) => {
      const kinds = Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === b.kind ? ' selected' : ''}>${v.name}</option>`).join('');
      const start = b.at
        ? `<label class="field"><span class="lbl">Starts at</span><input type="time" class="at-in" id="at-${b.id}" value="${b.at}"><button type="button" class="clear-at" data-act="clear" aria-label="Remove clock time" title="Remove clock time">×</button></label>`
        : `<button type="button" class="follow" data-act="pin" title="Pin this block to a clock time">${i === 0 ? 'Starts when you press <b>Start</b>' : 'Starts <b>after previous</b>'} · set time</button>`;
      const task = b.kind === 'focus'
        ? `<label class="field task-field"><input type="checkbox" class="task-done" id="td-${b.id}" ${b.taskDone ? 'checked' : ''} aria-label="Task done"><input class="task-in${b.taskDone ? ' is-done' : ''}" id="task-${b.id}" value="${esc(b.task || '')}" placeholder="What will you work on? (optional)" maxlength="200" aria-label="Task for this session"></label>`
        : '';
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
          ${task}
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

  /* ---------- saved plans ---------- */
  function renderTemplates() {
    const el = $('tplList');
    if (!state.templates.length) {
      el.innerHTML = '<li class="empty small">No saved plans yet. Build a plan, give it a name above and save it.</li>';
      return;
    }
    el.innerHTML = state.templates.map((t) => {
      const nF = t.blocks.filter((b) => b.kind === 'focus').length;
      const first = t.blocks[0];
      const meta = `${plural(t.blocks.length, 'block')} · ${plural(nF, 'focus session')}` + (first && first.at ? ` · starts ${fmtAt(first.at)}` : '');
      const days = WEEK_ORDER.map((d) => `<button type="button" class="day" data-act="day" data-d="${d}" aria-pressed="${t.days.includes(d)}" aria-label="${DAY_NAME[d]}" title="Load automatically on ${DAY_NAME[d]}s">${DAY_SHORT[d]}</button>`).join('');
      return `<li class="tpl" data-id="${t.id}">
        <div class="tpl-main"><b>${esc(t.name)}</b><span class="tpl-meta">${meta}</span></div>
        <div class="days" role="group" aria-label="Load ${esc(t.name)} automatically on">${days}</div>
        <div class="tpl-btns">
          <button type="button" class="btn small" data-act="load">Load</button>
          <button type="button" class="icon-btn" data-act="del" aria-label="Delete ${esc(t.name)}">${ICON.del}</button>
        </div>
      </li>`;
    }).join('');
  }

  function loadTemplate(t, auto) {
    const before = snapshot();
    state.blocks = t.blocks.map((b) => Object.assign({}, b, { id: uid(), taskDone: false }));
    state.run = null; lastKey = null; lastBlockId = null; keepAwake(false);
    changed(true);
    const msg = auto ? `Loaded “${t.name}” for ${DAY_NAME[new Date().getDay()]}.` : `Loaded “${t.name}”.`;
    showToast(msg, { action: 'Undo', onAction: () => restore(before, 'Previous plan restored.') });
  }

  function maybeAutoLoad(now) {
    const k = dayKey(now);
    if (state.autoLoaded === k) return;
    state.autoLoaded = k;
    const dow = new Date(now).getDay();
    const t = state.templates.find((x) => x.days.includes(dow));
    if (t && !state.run) loadTemplate(t, true);
    else save();
  }

  /* ---------- auto-start ---------- */
  function maybeAutoStart(now) {
    if (!state.autoStart || state.run || !state.blocks.length || !state.blocks[0].at) return;
    const tl = build(now, null);
    const first = tl[0], endAll = Math.max(...tl.map((x) => x.eff));
    if (now >= first.start && now < endAll && state.autoDone !== first.start) {
      state.autoDone = first.start;
      state.run = { anchor: first.start, ext: {}, cut: {}, go: {}, spent: {}, pausedAt: null };
      lastKey = null; lastBlockId = null;
      keepAwake(true);
      save();
      showToast(`Started automatically at ${fmtClock(first.start)}.`);
    }
  }

  /* ---------- sound ---------- */
  function ensureAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function tone(f, t0, dur, { type = 'sine', gain = 0.3, attack = 0.01 } = {}) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // kind: focus | break | done | warn
  function playSound(kind, text = '') {
    const type = state.sound, vol = state.volume;
    if (type === 'off' || vol <= 0) return;
    if (type === 'voice') {
      try {
        if (!('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.volume = vol;
        speechSynthesis.speak(u);
      } catch (e) {}
      return;
    }
    ensureAudio();
    if (!actx) return;
    const t0 = actx.currentTime + 0.02;
    try {
      if (kind === 'warn') {
        tone(1318.5, t0, 0.12, { gain: 0.2 * vol }); tone(1318.5, t0 + 0.22, 0.12, { gain: 0.2 * vol });
      } else if (type === 'chime') {
        const notes = kind === 'focus' ? [523.25, 659.25, 783.99] : kind === 'done' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
        notes.forEach((f, k) => tone(f, t0 + k * 0.18, 0.7, { type: 'triangle', gain: 0.3 * vol, attack: 0.02 }));
      } else if (type === 'bell') {
        const base = kind === 'focus' ? 659.25 : kind === 'done' ? 783.99 : 523.25;
        const strikes = kind === 'done' ? [0, 0.55] : kind === 'focus' ? [0, 0.35] : [0];
        strikes.forEach((s, i) => {
          const f = base * (i ? 1.335 : 1);
          [[1, 1], [2.76, 0.35], [5.4, 0.15]].forEach(([m, a]) => tone(f * m, t0 + s, 2.2 / Math.pow(m, 0.3), { gain: 0.32 * vol * a, attack: 0.005 }));
        });
      } else if (type === 'beep') {
        const n = kind === 'focus' ? 2 : kind === 'done' ? 3 : 1;
        for (let k = 0; k < n; k++) tone(kind === 'break' ? 660 : 880, t0 + k * 0.22, kind === 'break' ? 0.35 : 0.14, { gain: 0.22 * vol });
      }
    } catch (e) {}
  }
  function notify(title, body) {
    try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body, icon: 'favicon.png' }); } catch (e) {}
  }
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  /* ---------- run controls ---------- */
  function startOrPause() {
    ensureAudio();
    if (!state.blocks.length) return;
    const now = Date.now();
    if (!state.run) {
      state.run = { anchor: now, ext: {}, cut: {}, go: {}, spent: {}, pausedAt: null };
      lastKey = null; lastBlockId = null;
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
    if (state.run && state.blocks[0] && state.blocks[0].at) state.autoDone = currentTL(Date.now())[0].start;
    state.run = null; lastKey = null; lastBlockId = null; keepAwake(false);
    changed(false);
  }

  /* ---------- progress ---------- */
  function today(now) {
    const k = dayKey(now);
    return (state.history[k] = state.history[k] || { s: 0, f: 0 });
  }
  function pruneHistory(now) {
    const keep = dayKey(now - 120 * 24 * 60 * MIN);
    Object.keys(state.history).forEach((k) => { if (k < keep) delete state.history[k]; });
  }
  // Called when the timer moves on from a block.
  function finishBlock(id, tl, now) {
    if (!id || !state.run) return;
    const x = tl.find((y) => y.b.id === id);
    if (!x || x.b.kind !== 'focus') return;
    const spent = (state.run.spent || {})[id] || 0;
    let planned = x.b.dur > 0 ? x.b.dur * MIN : x.eff - x.start;
    if (x.overlap) planned = Math.min(planned, x.eff - x.start);
    if (planned > 0 && spent >= planned * 0.5) today(now).s++;
    if (x.b.task && !x.b.taskDone) {
      const b = x.b;
      showToast(`Session over. Did you finish “${b.task}”?`, { action: 'Mark done', ms: 15000, onAction: () => { b.taskDone = true; changed(true); showToast('Nice work. Marked as done.'); } });
    }
  }
  function streak(now) {
    let n = 0;
    const d = new Date(now); d.setHours(12, 0, 0, 0);
    if (!((state.history[dayKey(d.getTime())] || {}).s > 0)) d.setDate(d.getDate() - 1);
    while ((state.history[dayKey(d.getTime())] || {}).s > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function renderProgress(now) {
    const td = state.history[dayKey(now)] || { s: 0, f: 0 };
    const sk = streak(now);
    $('statSessions').textContent = td.s;
    $('statFocus').textContent = fmtSpan(td.f);
    $('statStreak').textContent = plural(sk, 'day');

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      const h = state.history[dayKey(d.getTime())] || { s: 0, f: 0 };
      days.push({ d, f: h.f, s: h.s, today: i === 0 });
    }
    const sig = days.map((x) => dayKey(x.d.getTime()) + ':' + Math.floor(x.f / MIN) + ':' + x.s).join('|');
    if (sig === progSig) return;
    progSig = sig;
    const max = Math.max(30 * MIN, ...days.map((x) => x.f));
    $('weekChart').innerHTML = `<div class="bars">${days.map((x) => {
      const pct = x.f >= MIN ? Math.max(4, (x.f / max) * 100) : 0;
      const desc = `${fullDayFmt.format(x.d)}: ${x.f >= MIN ? fmtSpan(x.f) : 'no'} focus, ${plural(x.s, 'session')}`;
      return `<div class="bar-col${x.today ? ' today' : ''}" tabindex="0" aria-label="${desc}">
        <span class="bar-val">${x.today && x.f >= MIN ? fmtSpan(x.f) : ''}</span>
        <div class="bar-area"><div class="bar" style="height:${pct}%"></div></div>
        <span class="bar-day">${x.today ? 'Today' : wdFmt.format(x.d)}</span>
        <span class="tip" aria-hidden="true">${desc}</span>
      </div>`;
    }).join('')}</div>`;
  }

  /* ---------- tab icon ---------- */
  function updateIcon(active, color, frac, rem, paused) {
    if (!active) {
      if (iconSig !== 'orig') { iconLinks.forEach((l, i) => { l.href = iconOrig[i][0]; l.type = iconOrig[i][1]; }); iconSig = 'orig'; }
      return;
    }
    const m = Math.ceil(rem / MIN);
    const label = m > 99 ? Math.round(m / 60) + 'h' : String(m);
    const sig = [color, Math.round(frac * 48), label, paused].join();
    if (sig === iconSig) return;
    iconSig = sig;
    const g = iconCanvas.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.beginPath(); g.arc(32, 32, 31, 0, 2 * Math.PI); g.fillStyle = '#FFFFFF'; g.fill();
    g.lineWidth = 9; g.lineCap = 'round';
    g.strokeStyle = '#CBDDEC'; g.beginPath(); g.arc(32, 32, 26, 0, 2 * Math.PI); g.stroke();
    if (frac > 0.005) {
      g.strokeStyle = paused ? '#4C6A82' : color;
      g.beginPath(); g.arc(32, 32, 26, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac); g.stroke();
    }
    g.fillStyle = '#12283B';
    g.font = `800 ${label.length > 2 ? 20 : 26}px system-ui, -apple-system, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 32, 34);
    const url = iconCanvas.toDataURL('image/png');
    iconLinks.forEach((l) => { l.href = url; l.type = 'image/png'; });
  }

  /* ---------- encouragement ---------- */
  function cheerMood(mode) {
    const set = mode === 'done' ? 'done' : mode === 'short' || mode === 'long' || mode === 'gap' ? 'rest' : 'work';
    if (set !== cheerSet) { cheerSet = set; showCheer(); }
    else if (Date.now() - cheerAt > 12000) showCheer();
  }
  function cheerPool() {
    if (cheerSet !== 'work') return CHEERS[cheerSet];
    const mine = state.cheers || [];
    let pool = state.cheerMode === 'mine' && mine.length ? mine.slice()
      : state.cheerMode === 'builtin' ? CHEERS.work.slice()
      : CHEERS.work.concat(mine);
    const n = (state.history[dayKey(Date.now())] || {}).s || 0;
    if (n > 0 && state.cheerMode !== 'mine') pool.push(`${plural(n, 'session')} done today. Keep it up.`);
    return pool;
  }
  function showCheer() {
    cheerAt = Date.now();
    const all = cheerPool();
    const list = all.length > 1 ? all.filter((c) => c !== cheerLast) : all;
    const text = list[Math.floor(Math.random() * list.length)] || 'You can do it.';
    cheerLast = text;
    const el = $('cheer');
    el.classList.add('out');
    setTimeout(() => { el.textContent = text; el.classList.remove('out'); }, 450);
  }

  /* ---------- focus mode ---------- */
  function setFocusMode(on) {
    document.body.classList.toggle('focus-mode', on);
    $('btnFocus').setAttribute('aria-pressed', String(on));
    $('btnFocus').textContent = on ? 'Exit focus mode' : 'Focus mode';
    try {
      if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (e) {}
    window.scrollTo(0, 0);
  }

  /* ---------- share and export ---------- */
  function encodePlan() {
    const json = JSON.stringify({ v: 1, b: state.blocks.map((b) => [b.kind, b.label, b.color, b.at, b.dur || 0, b.task || '']) });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function readShared() {
    const m = location.hash.match(/^#plan=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      let s = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const d = JSON.parse(decodeURIComponent(escape(atob(s))));
      if (!d || !Array.isArray(d.b)) return null;
      const blocks = d.b.slice(0, 100).map((a) => {
        if (!Array.isArray(a) || !KINDS[a[0]]) return null;
        return mk(a[0], {
          label: String(a[1] || KINDS[a[0]].label).slice(0, 60),
          color: /^#[0-9a-f]{6}$/i.test(a[2]) ? a[2] : KINDS[a[0]].color,
          at: /^\d{2}:\d{2}$/.test(a[3]) ? a[3] : '',
          dur: Number.isInteger(a[4]) && a[4] > 0 && a[4] <= 600 ? a[4] : null,
          task: String(a[5] || '').slice(0, 200),
        });
      }).filter(Boolean);
      return blocks.length ? blocks : null;
    } catch (e) { return null; }
  }
  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }

  const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function toICS(tl) {
    const stamp = icsDate(Date.now());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Focus Timer//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    tl.filter((x) => x.eff > x.start).forEach((x) => {
      lines.push('BEGIN:VEVENT', `UID:${x.b.id}-${x.start}@focus-timer`, `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(x.start)}`, `DTEND:${icsDate(x.eff)}`, `SUMMARY:${icsEsc(nameOf(x.b))}`,
        `CATEGORIES:${KINDS[x.b.kind].name}`);
      if (x.b.task) lines.push(`DESCRIPTION:${icsEsc(x.b.task)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- rendering ---------- */
  function setCur(color) { document.documentElement.style.setProperty('--cur', color); }

  function renderTimeline(tl, st, t) {
    const bar = $('trackBar');
    const live = tl.filter((x) => x.eff > x.start);
    if (!live.length) {
      bar.innerHTML = ''; $('scaleStart').textContent = ''; $('scaleEnd').textContent = ''; tlSig = '';
      $('summary').textContent = 'No blocks yet';
      return;
    }
    const lo = Math.min(...live.map((x) => x.start)), hi = Math.max(...live.map((x) => x.eff));
    const span = Math.max(hi - lo, 1);
    const sig = live.map((x) => [x.b.id, x.b.color, Math.floor(x.start / 1000), Math.floor(x.eff / 1000), x.b.label].join()).join('|') + (st.mode === 'block' ? st.i : '') + state.h24;
    if (sig !== tlSig) {
      tlSig = sig;
      bar.innerHTML = live.map((x) => {
        const i = tl.indexOf(x);
        return `<div class="seg" data-i="${i}" style="--c:${x.b.color};left:${((x.start - lo) / span) * 100}%;width:${((x.eff - x.start) / span) * 100}%" title="${esc(nameOf(x.b))} · ${fmtClock(x.start)} – ${fmtClock(x.eff)}"></div>`;
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
    $('summary').textContent = `${plural(nF, 'focus session')} · ${fmtSpan(focus)} of focus · ${fmtClock(lo)} → ${fmtClock(hi)}`;
  }

  function renderDial(st, tl, t, now) {
    const run = state.run;
    let color = KINDS.focus.color, chip = 'Ready', label = 'Add a session to begin', cd = '00:00', sub = '', frac = 1, dashed = false, next = null, rem = 0, taskBlock = null;
    if (st.mode === 'empty') {
      sub = 'Your plan is empty';
    } else if (st.mode === 'idle') {
      const f = tl[0];
      color = f.b.color; label = nameOf(f.b); cd = fmtDur(f.eff - f.start);
      if (f.b.at && f.start > now) sub = state.autoStart ? `Starts automatically at ${fmtClock(f.start)}` : `Starts at ${fmtClock(f.start)} · press Start to arm`;
      else sub = `${fmtClock(f.start)} – ${fmtClock(f.eff)} if you start now`;
      next = tl[1];
      if (f.b.kind === 'focus') taskBlock = f.b;
    } else if (st.mode === 'block') {
      const x = tl[st.i];
      color = x.b.color; chip = KINDS[x.b.kind].name; label = nameOf(x.b);
      rem = x.eff - t;
      cd = fmtDur(rem); sub = `${fmtClock(x.start)} – ${fmtClock(x.eff)}`;
      frac = rem / Math.max(1, x.eff - x.start);
      next = tl.slice(st.i + 1).find((n) => n.eff > n.start);
      if (x.b.kind === 'focus') taskBlock = x.b;
    } else if (st.mode === 'wait' || st.mode === 'gap') {
      const n = tl[st.j];
      color = n.b.color; chip = st.mode === 'wait' ? 'Waiting to start' : 'Free time';
      label = `${nameOf(n.b)} starts at ${fmtClock(n.start)}`;
      rem = n.start - t;
      cd = fmtDur(rem); sub = 'Skip to start it now'; dashed = true; next = n;
    } else if (st.mode === 'done') {
      const last = tl[tl.length - 1];
      color = last.b.color; chip = 'All done'; label = 'Plan complete';
      cd = '00:00'; sub = `Finished at ${fmtClock(Math.max(...tl.map((x) => x.eff)))}`; frac = 0;
    }
    const paused = !!(run && run.pausedAt);
    setCur(color);
    const chipEl = $('phaseChip');
    chipEl.textContent = paused ? `${chip} · paused` : chip;
    chipEl.classList.toggle('is-paused', paused);
    $('dialLabel').textContent = label;
    $('countdown').textContent = cd;
    $('dialSub').textContent = sub;
    const prog = $('prog');
    prog.classList.toggle('dashed', dashed);
    prog.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, frac)));
    $('dial').classList.toggle('ending', !!run && !paused && st.mode === 'block' && state.warnMin > 0 && rem <= state.warnMin * MIN);

    const tn = $('taskNow');
    if (taskBlock && taskBlock.task) {
      tn.hidden = false;
      tn.dataset.id = taskBlock.id;
      $('taskNowText').textContent = taskBlock.task;
      $('taskNowDone').checked = !!taskBlock.taskDone;
      tn.classList.toggle('is-done', !!taskBlock.taskDone);
    } else tn.hidden = true;

    const up = $('upNext');
    if (next && st.mode !== 'wait' && st.mode !== 'gap') {
      up.hidden = false;
      up.innerHTML = `<span class="dot" style="--c:${next.b.color}"></span><div><div class="k">Up next</div><div class="v">${esc(nameOf(next.b))}</div></div><span class="t">${fmtClock(next.start)}</span>`;
    } else up.hidden = true;

    const bs = $('btnStart');
    bs.textContent = !run ? 'Start' : paused ? 'Resume' : 'Pause';
    bs.disabled = !state.blocks.length;
    $('btnSkip').disabled = !run || st.mode === 'done';
    $('btnSkip').textContent = run && (st.mode === 'wait' || st.mode === 'gap') ? 'Start now' : 'Skip';
    $('btnStop').disabled = !run;
    $('tgl24').setAttribute('aria-pressed', String(state.h24));
    $('tgl24').textContent = state.h24 ? '24-hour clock' : '12-hour clock';
    document.title = run && st.mode !== 'done' ? `${cd} · ${label}` : 'Focus Timer';
    updateIcon(!!run && (st.mode === 'block' || st.mode === 'wait' || st.mode === 'gap'), color, dashed ? 0 : frac, rem, paused);
    cheerMood(st.mode === 'block' ? tl[st.i].b.kind : st.mode);
  }

  function onTransition(st, tl) {
    const card = $('timerCard');
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    if (st.mode === 'block') {
      const x = tl[st.i];
      const isFocus = x.b.kind === 'focus';
      playSound(isFocus ? 'focus' : 'break', `${isFocus ? 'Focus time' : 'Break time'}. ${nameOf(x.b)}`);
      notify(`${nameOf(x.b)} started`, `Until ${fmtClock(x.eff)}` + (x.b.task ? ` · ${x.b.task}` : ''));
    } else if (st.mode === 'done') {
      playSound('done', 'All done. Well done!');
      confetti(); notify('Plan complete', 'Every session and break is finished.');
      keepAwake(false);
    } else {
      playSound('break', 'Free time');
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

  /* ---------- main loop ---------- */
  function tick() {
    const now = Date.now();
    const d = new Date(now);
    let h = d.getHours(), suf = '';
    if (!state.h24) { suf = h < 12 ? ' am' : ' pm'; h = h % 12 || 12; }
    $('nowTime').innerHTML = `${state.h24 ? pad(h) : h}:${pad(d.getMinutes())}<span class="sec">:${pad(d.getSeconds())}</span>${suf ? `<small style="font-size:.45em">${suf}</small>` : ''}`;
    $('nowDate').textContent = dateFmt.format(d);

    maybeAutoLoad(now);
    maybeAutoStart(now);

    if (state.run && !state.blocks.length) state.run = null;
    const run = state.run;
    const tl = currentTL(now);
    const t = run && run.pausedAt ? run.pausedAt : now;
    const st = !tl.length ? { mode: 'empty' } : run ? status(t, tl) : { mode: 'idle' };
    const key = st.mode + ':' + (st.i != null ? tl[st.i].b.id : st.j != null ? tl[st.j].b.id : '');
    const dt = Math.min(Math.max(0, now - lastTick), 65000);
    lastTick = now;

    if (run && !run.pausedAt && lastKey !== null) {
      if (key === lastKey && st.mode === 'block') {
        const x = tl[st.i];
        if (x.b.kind === 'focus') {
          run.spent = run.spent || {};
          run.spent[x.b.id] = (run.spent[x.b.id] || 0) + dt;
          today(now).f += dt;
        }
        // Warning before the block ends
        const rem = x.eff - t, w = state.warnMin * MIN, wk = x.b.id + ':' + x.eff;
        if (w > 0 && rem > 0 && rem <= w && x.eff - x.start > w + 30000 && warnedKey !== wk) {
          warnedKey = wk;
          playSound('warn', `${plural(state.warnMin, 'minute')} left`);
          notify(`${plural(state.warnMin, 'minute')} left`, nameOf(x.b));
        }
      } else if (key !== lastKey) {
        finishBlock(lastBlockId, tl, now);
        onTransition(st, tl);
        save();
      }
    }
    if (run) {
      lastBlockId = st.mode === 'block' ? tl[st.i].b.id : null;
      lastKey = key;
    } else { lastKey = null; lastBlockId = null; }

    renderDial(st, tl, t, now);
    renderTimeline(tl, st, t);
    updateList(tl, st, t);
    renderProgress(now);
    if (now - lastSave > 5000) save();
  }

  function changed(structural) {
    if (structural) renderList();
    save();
    tick();
  }

  /* ---------- event wiring ---------- */
  // Plan list
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
    if (act === 'del') {
      const before = snapshot();
      B.splice(i, 1);
      changed(true);
      showToast(`Deleted “${nameOf(b)}”.`, { action: 'Undo', onAction: () => restore(before) });
      return;
    }
    changed(true);
  });

  $('blocks').addEventListener('input', (e) => {
    const i = blockIndex(e.target); if (i < 0) return;
    const b = state.blocks[i], cl = e.target.classList;
    if (cl.contains('label-in')) b.label = e.target.value;
    else if (cl.contains('dur-in')) { const v = parseInt(e.target.value, 10); b.dur = v > 0 ? Math.min(v, 600) : null; }
    else if (cl.contains('at-in')) { if (e.target.value) b.at = e.target.value; }
    else if (cl.contains('task-in')) b.task = e.target.value;
    else return;
    changed(false);
  });

  $('blocks').addEventListener('change', (e) => {
    const i = blockIndex(e.target); if (i < 0) return;
    const b = state.blocks[i], cl = e.target.classList;
    if (cl.contains('kind-in')) {
      const old = KINDS[b.kind], nk = KINDS[e.target.value];
      if (b.label === old.label || !b.label.trim()) b.label = nk.label;
      if (b.color === old.color) b.color = nk.color;
      if (b.dur === old.dur) b.dur = nk.dur;
      b.kind = e.target.value;
      changed(true);
    } else if (cl.contains('at-in') && !e.target.value) {
      b.at = ''; changed(true);
    } else if (cl.contains('task-done')) {
      b.taskDone = e.target.checked;
      const ti = $('task-' + b.id); if (ti) ti.classList.toggle('is-done', b.taskDone);
      changed(false);
    }
  });

  document.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    state.blocks.push(mk(btn.dataset.add));
    changed(true);
    const last = state.blocks[state.blocks.length - 1];
    const inp = $('lbl-' + last.id); if (inp) { inp.focus(); inp.select(); }
  }));

  // Task shown on the dial
  $('taskNowDone').addEventListener('change', (e) => {
    const b = state.blocks.find((x) => x.id === $('taskNow').dataset.id);
    if (!b) return;
    b.taskDone = e.target.checked;
    changed(true);
  });

  // Quick build
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
    const before = snapshot(), hadBlocks = state.blocks.length > 0;
    state.blocks = qbMode === 'append' ? state.blocks.concat(out) : out;
    if (qbMode === 'replace') { state.run = null; lastKey = null; lastBlockId = null; }
    changed(true);
    if (hadBlocks) showToast(qbMode === 'append' ? `Added ${plural(out.length, 'block')}.` : 'Plan replaced.', { action: 'Undo', onAction: () => restore(before) });
  });

  // Clear all, with confirmation and undo
  $('btnClear').addEventListener('click', () => {
    if (!state.blocks.length) { showToast('Your plan is already empty.'); return; }
    const n = state.blocks.length;
    $('clearMsg').textContent = `Clear all ${plural(n, 'block')} from your plan?` + (state.run ? ' The running timer will stop.' : '');
    $('clearConfirm').hidden = false;
    $('clearCancel').focus();
  });
  $('clearCancel').addEventListener('click', () => { $('clearConfirm').hidden = true; $('btnClear').focus(); });
  $('clearYes').addEventListener('click', () => {
    $('clearConfirm').hidden = true;
    const n = state.blocks.length, before = snapshot();
    state.blocks = []; state.run = null; lastKey = null; lastBlockId = null; keepAwake(false);
    changed(true);
    showToast(`Plan cleared. ${plural(n, 'block')} removed.`, { action: 'Undo', onAction: () => restore(before, 'Plan restored.') });
  });

  // Saved plans
  $('tplForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('tplName').value.trim();
    if (!name) { $('tplName').focus(); showToast('Type a name for this plan first.'); return; }
    if (!state.blocks.length) { showToast('Add at least one block before saving.'); return; }
    const blocks = state.blocks.map(({ kind, label, color, at, dur, task }) => ({ kind, label, color, at, dur, task: task || '' }));
    const existing = state.templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.blocks = blocks; existing.name = name; }
    else state.templates.push({ id: uid(), name, blocks, days: [] });
    $('tplName').value = '';
    renderTemplates(); save();
    showToast(existing ? `Updated “${name}”.` : `Saved “${name}”.`);
  });
  $('tplList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const li = btn.closest('.tpl'); if (!li) return;
    const t = state.templates.find((x) => x.id === li.dataset.id); if (!t) return;
    const act = btn.dataset.act;
    if (act === 'load') loadTemplate(t, false);
    else if (act === 'day') {
      const d = +btn.dataset.d;
      if (t.days.includes(d)) t.days = t.days.filter((x) => x !== d);
      else {
        state.templates.forEach((o) => { o.days = o.days.filter((x) => x !== d); });
        t.days.push(d);
      }
      renderTemplates(); save();
    } else if (act === 'del') {
      const before = JSON.stringify(state.templates);
      state.templates = state.templates.filter((x) => x !== t);
      renderTemplates(); save();
      showToast(`Deleted “${t.name}”.`, { action: 'Undo', onAction: () => { state.templates = JSON.parse(before); renderTemplates(); save(); showToast('Saved plan restored.'); } });
    }
  });

  // Share and export
  $('btnShare').addEventListener('click', () => {
    if (!state.blocks.length) { showToast('Add some blocks before sharing.'); return; }
    const url = location.href.split('#')[0] + '#plan=' + encodePlan();
    $('shareUrl').value = url;
    $('shareField').hidden = false;
    const fallback = () => { $('shareUrl').focus(); $('shareUrl').select(); showToast('Copy the selected link to share it.'); };
    try {
      navigator.clipboard.writeText(url).then(() => showToast('Link copied. Paste it anywhere to share your plan.'), fallback);
    } catch (e) { fallback(); }
  });
  $('btnIcs').addEventListener('click', () => {
    if (!state.blocks.length) { showToast('Add some blocks before exporting.'); return; }
    download(`focus-plan-${dayKey(Date.now())}.ics`, toICS(currentTL(Date.now())), 'text/calendar');
    showToast('Calendar file downloaded. Open it to add the blocks to your calendar.');
  });
  $('shareLoad').addEventListener('click', () => {
    if (!sharedBlocks) return;
    const before = snapshot();
    state.blocks = sharedBlocks; state.run = null; lastKey = null; lastBlockId = null; keepAwake(false);
    sharedBlocks = null; $('shareBanner').hidden = true; clearHash();
    changed(true);
    showToast('Shared plan loaded.', { action: 'Undo', onAction: () => restore(before, 'Your previous plan is back.') });
  });
  $('shareIgnore').addEventListener('click', () => { sharedBlocks = null; $('shareBanner').hidden = true; clearHash(); });

  // Settings
  $('setSound').addEventListener('change', (e) => { state.sound = e.target.value; ensureAudio(); save(); });
  $('setVolume').addEventListener('input', (e) => { state.volume = (+e.target.value || 0) / 100; save(); });
  $('btnTest').addEventListener('click', () => {
    ensureAudio();
    if (state.sound === 'off') { showToast('Alert sound is set to Off.'); return; }
    playSound('focus', 'Focus time. This is how alerts will sound.');
  });
  $('setWarn').addEventListener('change', (e) => { state.warnMin = +e.target.value; warnedKey = ''; save(); tick(); });
  $('setAuto').addEventListener('change', (e) => {
    state.autoStart = e.target.checked;
    ensureAudio();
    if (state.autoStart && !(state.blocks[0] && state.blocks[0].at)) showToast('Give the first block a clock time so the timer knows when to start.');
    save(); tick();
  });
  $('cheerMode').addEventListener('change', (e) => { state.cheerMode = e.target.value; save(); showCheer(); });
  $('cheerList').addEventListener('input', (e) => {
    state.cheers = e.target.value.split('\n').map((s) => s.trim().slice(0, 120)).filter(Boolean).slice(0, 50);
    save();
  });

  // Timer controls
  $('btnStart').addEventListener('click', startOrPause);
  $('btnSkip').addEventListener('click', skip);
  $('btnStop').addEventListener('click', reset);
  $('tgl24').addEventListener('click', () => { state.h24 = !state.h24; tlSig = ''; renderTemplates(); changed(false); });
  $('btnFocus').addEventListener('click', () => setFocusMode(!document.body.classList.contains('focus-mode')));
  $('toastUndo').addEventListener('click', () => { const f = toastAction; hideToast(); if (f) f(); });
  $('toastClose').addEventListener('click', hideToast);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, button, summary')) {
      if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) setFocusMode(false);
      return;
    }
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startOrPause(); }
    else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) setFocusMode(!document.body.classList.contains('focus-mode'));
    else if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) setFocusMode(false);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('focus-mode')) setFocusMode(false);
  });
  // Browsers only allow sound after a click or key press.
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, ensureAudio, { once: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.run && !state.run.pausedAt) keepAwake(true);
    if (!document.hidden) tick();
  });

  // Install as an app
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('btnInstall').hidden = false;
    $('installHint').hidden = true;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) {}
    deferredInstall = null;
    $('btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    $('btnInstall').hidden = true;
    showToast('Installed. You can now open Focus Timer from your apps.');
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('installHint').hidden = true;

  /* ---------- start up ---------- */
  (function drawTicks() {
    let s = '';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, major = i % 5 === 0;
      const r1 = 116, r2 = major ? 109 : 112;
      s += `<line class="tick${major ? ' major' : ''}" x1="${120 + r1 * Math.sin(a)}" y1="${120 - r1 * Math.cos(a)}" x2="${120 + r2 * Math.sin(a)}" y2="${120 - r2 * Math.cos(a)}" stroke-width="${major ? 2 : 1}" stroke-linecap="round"></line>`;
    }
    $('ticks').innerHTML = s;
  })();
  $('prog').style.strokeDasharray = C;

  (function initQB() {
    const d = new Date(); d.setSeconds(0, 0); d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
    $('qbStart').value = hhmm(d.getTime());
  })();

  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  $('nowTz').textContent = tz ? '· ' + tz.replace(/_/g, ' ') : '';

  $('setSound').value = state.sound;
  $('setVolume').value = Math.round(state.volume * 100);
  $('setWarn').value = String(state.warnMin);
  $('setAuto').checked = !!state.autoStart;
  $('cheerMode').value = state.cheerMode;
  $('cheerList').value = (state.cheers || []).join('\n');

  sharedBlocks = readShared();
  if (sharedBlocks) {
    $('shareMsg').textContent = `Someone shared a plan with you (${plural(sharedBlocks.length, 'block')}). Loading it replaces your current plan.`;
    $('shareBanner').hidden = false;
  } else if (location.hash.startsWith('#plan=')) {
    clearHash();
    setTimeout(() => showToast('That share link is incomplete or damaged, so no plan was loaded.'), 300);
  }

  pruneHistory(Date.now());
  renderList();
  renderTemplates();
  if (state.run && !state.run.pausedAt) keepAwake(true);
  tick();
  setInterval(tick, 250);
})();
