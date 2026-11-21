/* Pip: demo prototype for IPD 5510 Digital Prototype Demo Day.
   Everything here is SAMPLE data (a pretend family). No real personal or health data.
   State lives only in this browser (localStorage). The Pip device is simulated with
   the "Simulate" controls; the real device link (MQTT over Wi-Fi) is not part of this build. */

const KEY = 'pip-demo-v1';
const PX_PER_MIN = 48 / 60;
const SNAP = 15;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- Sample data ---------- */
function sampleState() {
  const now = Date.now();
  return {
    v: 1,
    day: new Date().toDateString(),
    baby: 'Henry',
    people: [
      { id: 'mom', name: 'Mom', admin: true },
      { id: 'dad', name: 'Dad', admin: false },
      { id: 'nan', name: 'Nan', admin: false, role: 'Nanny' },
    ],
    me: 'mom',
    blocks: [
      { id: uid(), start: 0, end: 420, people: ['dad'], daily: true },
      { id: uid(), start: 420, end: 720, people: ['mom'], daily: true },
      { id: uid(), start: 720, end: 1020, people: ['nan'], daily: true },
      { id: uid(), start: 1080, end: 1320, people: ['mom', 'dad'], daily: true },
      { id: uid(), start: 1320, end: 1440, people: ['dad'], sugg: true },
    ],
    lastChanged: now - 72 * 60000,
    poops: [now - 6 * 3600000, now - 75 * 60000],
    history: [],
    pip: { connected: true, battery: 80, led: false },
    alert: null,
    handled: null,
    settings: { demo: true, tracking: false, night: 'auto', delay: 20, handoff: 180 },
    introSeen: false,
    log: [],
  };
}

let S = load();
let tab = 'home';
let sensing = null; // {kind, start, until}
let chimeTimer = null;
let weekView = false;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) {
      if (s.day !== new Date().toDateString()) { s.day = new Date().toDateString(); s.poops = []; }
      return s;
    }
  } catch (e) { /* fall through */ }
  return sampleState();
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

/* ---------- Helpers ---------- */
const person = id => S.people.find(p => p.id === id);
const nameOf = id => (person(id) || { name: 'Someone' }).name;
const namesOf = ids => ids.map(nameOf).join(' + ');
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtMin(m) {
  m = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return mm ? `${h}:${String(mm).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}
function fmtTime(ts) { const d = new Date(ts); return fmtMin(d.getHours() * 60 + d.getMinutes()).replace(/^(\d+) /, '$1:00 '); }
function fmtDur(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
}
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s < 10 ? 'just now' : `${s} sec ago`;
  const m = Math.floor(s / 60);
  return `${m} min ago`;
}
function mmss(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
const delaySec = () => S.settings.demo ? 5 : S.settings.delay;
const handoffSec = () => S.settings.demo ? 20 : S.settings.handoff;

function confirmed() { return S.blocks.filter(b => !b.sugg); }
function blocksAt(m) { return confirmed().filter(b => b.start <= m && m < b.end); }
function onDutyAt(m) { return [...new Set(blocksAt(m).flatMap(b => b.people))].filter(person); }
function currentShift() {
  const m = nowMin(), bs = blocksAt(m);
  if (!bs.length) {
    const next = confirmed().filter(b => b.start > m).sort((a, b) => a.start - b.start)[0];
    return { people: [], until: next ? next.start : 1440, next: next ? next.people : null };
  }
  const until = Math.min(...bs.map(b => b.end));
  const nextPeople = onDutyAt(until % 1440);
  return { people: onDutyAt(m), until, next: nextPeople };
}

/* ---------- Night mode ---------- */
function isNight() {
  if (S.settings.night === 'on') return true;
  if (S.settings.night === 'off') return false;
  const h = new Date().getHours();
  return h >= 21 || h < 6;
}

/* ---------- Render ---------- */
function render() {
  document.body.classList.toggle('night', isNight());
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderBanner();
  const el = $('#screen');
  if (tab === 'home') el.innerHTML = homeHTML();
  if (tab === 'schedule') { el.innerHTML = scheduleHTML(); wireSchedule(); }
  if (tab === 'team') el.innerHTML = teamHTML();
  renderAlert();
}

function renderBanner() {
  const b = $('#banner');
  let msg = '';
  if (!S.pip.connected) msg = `<span>Pip lost connection. Check on ${esc(S.baby)} the usual way for now.</span><button data-act="reconnect">Reconnect</button>`;
  else if (S.pip.battery < 20) msg = `<span>Pip battery is low (${S.pip.battery}%). Charge it soon.</span><button data-act="charge">Charged</button>`;
  b.innerHTML = msg;
  b.classList.toggle('hidden', !msg);
}

function pipChip() {
  if (!S.pip.connected) return `<span class="chip warn">Pip not connected</span>`;
  if (S.pip.battery < 20) return `<span class="chip warn">Pip · ${S.pip.battery}% battery</span>`;
  return `<span class="chip ok">Pip connected · ${S.pip.battery}%</span>`;
}

function youChips() {
  return `<div class="label">Viewing as (demo)</div><div class="you">${S.people.map(p =>
    `<button data-act="me" data-id="${p.id}" class="${p.id === S.me ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`;
}

function dutyText() {
  const sh = currentShift();
  if (!sh.people.length) {
    return { head: 'No one on duty', sub: 'Alerts go to everyone right now.' };
  }
  const mine = sh.people.includes(S.me);
  const others = sh.people.filter(id => id !== S.me);
  let head;
  if (mine && others.length) head = `You're on duty with ${namesOf(others)}`;
  else if (mine) head = "You're on duty";
  else head = `${namesOf(sh.people)} ${sh.people.length > 1 ? 'are' : 'is'} on duty`;
  const left = sh.until - nowMin();
  const sugg = S.blocks.find(b => b.sugg && b.start === sh.until);
  const nextTxt = sh.next && sh.next.length ? `then ${sh.next.includes(S.me) && sh.next.length === 1 ? 'you' : namesOf(sh.next)}` : sugg ? `then maybe ${namesOf(sugg.people)} (not confirmed yet)` : 'then no one is scheduled';
  return { head, sub: `for ${fmtDur(left)} more, ${nextTxt}`, mine };
}

function stripHTML() {
  const bs = confirmed().slice().sort((a, b) => a.start - b.start);
  const segs = []; let t = 0;
  const m = nowMin();
  // walk the day in pieces where the on-duty set is constant
  const cuts = [...new Set([0, 1440, ...bs.flatMap(b => [b.start, b.end])])].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], z = cuts[i + 1], who = onDutyAt(a);
    const last = segs[segs.length - 1];
    if (last && last.key === who.join()) { last.z = z; continue; }
    segs.push({ a, z, who, key: who.join() });
  }
  return `<div class="strip">${segs.map(s => {
    const cls = s.who.length === 0 ? 'gap' : s.who.length > 1 ? 'p-multi' : `p-${esc(nameOf(s.who[0]))}`;
    const now = m >= s.a && m < s.z ? ' now' : '';
    return `<div class="${cls}${now}" style="flex:${s.z - s.a}" title="${fmtMin(s.a)} to ${fmtMin(s.z)}">${s.z - s.a >= 150 ? (s.who.length ? esc(namesOf(s.who)) : 'open') : ''}</div>`;
  }).join('')}</div>
  <div class="row small muted" style="margin-top:4px"><span>12 am</span><span>noon</span><span>12 am</span></div>`;
}

function homeHTML() {
  const needs = !!S.alert;
  const d = dutyText();
  const me = person(S.me);
  const poopsLast = S.poops.length ? fmtTime(S.poops[S.poops.length - 1]) : null;
  let h = `<div class="top"><h1>${greeting()}, ${esc(me ? me.name : '')}</h1>
    <button class="gear" data-act="settings" aria-label="Settings">⚙</button></div>`;
  if (!S.introSeen) h += `<div class="intro"><b>Welcome to Pip.</b> This is a prototype with a pretend family: baby Henry, Mom, Dad and Nan the nanny. Nothing here is real data.<br><br>
    <b>Try this:</b> 1. See who's on duty below. 2. Tap <b>Simulate</b> and choose "Diaper is soiled". 3. Answer the alert, or tap "Can't right now" to pass it to the next person.<br>
    <button class="link" data-act="intro-ok" style="padding-left:0">Got it</button></div>`;
  h += youChips();
  if (S.handled && S.handled.for.includes(S.me)) h += `<div class="note">✓ ${esc(S.handled.text)} <button class="link" data-act="handled-ok">OK</button></div>`;
  if (sensing && sensing.kind === 'soiled') h += `<div class="note">Pip is noticing a smell. It waits ${delaySec()} seconds to be sure before alerting anyone, so passing gas doesn't set it off.</div>`;
  h += `<div class="card status ${needs ? 'needs' : 'clean'}">
      <div class="row"><div class="label">${esc(S.baby)}'s diaper</div>${pipChip()}</div>
      <div class="big">${needs ? 'Needs a change' : 'Clean'}</div>
      <div class="muted" style="margin-top:6px">${needs ? `since ${fmtTime(S.alert.detectedAt)} · ` : ''}last changed ${fmtTime(S.lastChanged)}</div>
    </div>`;
  if (needs && !S.alert.to.includes(S.me)) {
    const who = S.alert.everyone ? 'everyone' : namesOf(S.alert.to);
    h += `<div class="note">Pip is alerting <b>${esc(who)}</b>. You're not on duty, so your phone stays quiet.
      <div style="margin-top:8px">${S.alert.to.map(id => `<button class="link" data-act="me" data-id="${id}" style="padding-left:0">See ${esc(nameOf(id))}'s phone →</button>`).join(' ')}</div></div>`;
  }
  h += `<div class="card ${d.mine ? 'status clean' : ''}"><div class="label">On duty now</div>
      <div class="mid">${esc(d.head)}</div><div class="muted">${esc(d.sub)}</div></div>`;
  h += `<div class="card"><div class="row"><div class="label">Today's shifts</div><button class="link small" data-act="tab" data-tab="schedule">See schedule</button></div>${stripHTML()}</div>`;
  h += `<div class="card"><div class="label">Today</div><div class="mid">${S.poops.length} poop${S.poops.length === 1 ? '' : 's'}</div>
      <div class="muted">${poopsLast ? `last at ${poopsLast} · counted by Pip, no logging` : 'counted by Pip, no logging'}</div></div>`;
  return h;
}

/* ---------- Schedule ---------- */
function layoutCols(bs) {
  // side-by-side columns for overlapping blocks
  const sorted = bs.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map(); let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach(b => {
      let c = cols.findIndex(end => end <= b.start);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = b.end; out.set(b.id, { col: c });
    });
    cluster.forEach(b => out.get(b.id).n = cols.length);
    cluster = [];
  };
  sorted.forEach(b => { if (b.start >= clusterEnd) { flush(); clusterEnd = b.end; } else clusterEnd = Math.max(clusterEnd, b.end); cluster.push(b); });
  flush();
  return out;
}
function blockClass(b) {
  if (b.sugg) return 'sugg';
  if (b.people.length > 1) return 'p-multi';
  const n = nameOf(b.people[0]);
  return ['Mom', 'Dad', 'Nan'].includes(n) ? `p-${n}` : 'p-other';
}
function blockHTML(b, pos) {
  const top = b.start * PX_PER_MIN, ht = Math.max(18, (b.end - b.start) * PX_PER_MIN);
  const w = 100 / pos.n, l = pos.col * w;
  const label = b.sugg ? `${esc(namesOf(b.people))}?` : b.people.length ? esc(namesOf(b.people)) : 'Who?';
  return `<div class="blk ${blockClass(b)}" data-id="${b.id}" style="top:${top}px;height:${ht}px;left:calc(${l}% + 4px);width:calc(${w}% - 8px)">
    <div class="h top" data-edge="start"></div>
    ${label}${b.daily && !b.sugg ? ' <span class="t">↻</span>' : ''}<div class="t tt">${fmtMin(b.start)} to ${fmtMin(b.end)}${b.sugg ? ' · tap to confirm' : ''}</div>
    <div class="h bot" data-edge="end"></div></div>`;
}
function scheduleHTML() {
  let h = `<div class="top"><h1>${weekView ? 'This week' : 'Today'}</h1><div class="seg">
    <button data-act="view" data-v="day" class="${weekView ? '' : 'on'}">Day</button>
    <button data-act="view" data-v="week" class="${weekView ? 'on' : ''}">Week</button></div></div>`;
  if (weekView) return h + weekHTML();
  h += `<div class="muted small">Tap an empty time to add a shift. Drag the little bar on a shift's edge to stretch it. Dashed shifts are suggestions from past days.</div>
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn quiet" data-act="add" style="min-height:44px;font-size:15px">+ Add shift</button>
    <button class="btn quiet" data-act="repeat" style="min-height:44px;font-size:15px;margin-top:0">↻ Repeat every day</button></div>`;
  const pos = layoutCols(S.blocks);
  h += `<div class="tl" id="tl"><div class="hours">${Array.from({ length: 24 }, (_, i) => `<div>${fmtMin(i * 60)}</div>`).join('')}</div>
    <div class="grid" id="grid" style="height:${1440 * PX_PER_MIN}px">
      ${S.blocks.map(b => blockHTML(b, pos.get(b.id))).join('')}
      <div class="nowline" style="top:${nowMin() * PX_PER_MIN}px"></div>
    </div></div>`;
  return h;
}
function weekHTML() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today = (new Date().getDay() + 6) % 7;
  const periods = [['Night', 180], ['Morn', 540], ['Day', 900], ['Eve', 1200]];
  let h = `<div class="week"><div></div>${days.map((d, i) => `<div class="h" style="${i === today ? 'color:var(--indigo)' : ''}">${d}${i === today ? '•' : ''}</div>`).join('')}`;
  periods.forEach(([label, m]) => {
    h += `<div class="h">${label}</div>`;
    days.forEach((_, i) => {
      const bs = S.blocks.filter(b => b.start <= m && m < b.end && (i === today || b.daily || (b.sugg)));
      const conf = bs.filter(b => !b.sugg && (i === today || b.daily));
      const sug = bs.filter(b => b.sugg);
      const ids = [...new Set(conf.flatMap(b => b.people))];
      if (ids.length) h += `<div class="${ids.length > 1 ? 'p-multi' : `p-${esc(nameOf(ids[0]))}`}">${ids.map(id => esc(nameOf(id)[0])).join('+')}</div>`;
      else if (sug.length) h += `<div style="border:2px dashed rgba(151,126,110,.6);color:var(--taupe)">${esc(nameOf(sug[0].people[0])[0])}?</div>`;
      else h += `<div class="gap" style="background:#f4f1ee;color:var(--taupe)">open</div>`;
    });
  });
  h += `</div><p class="muted small">Solid = confirmed. Dashed = suggested from past weeks. M+D = both on duty. "Open" = no one assigned, so alerts go to everyone.</p>
    <button class="btn quiet" data-act="repeat">↻ Repeat this week</button>`;
  return h;
}

function wireSchedule() {
  const grid = $('#grid');
  if (!grid) return;
  const tl = $('#tl');
  // scroll so "now" is near the top
  requestAnimationFrame(() => { tl.scrollTop = Math.max(0, nowMin() * PX_PER_MIN - 120); });
  const minAt = y => Math.max(0, Math.min(1440, Math.round(y / PX_PER_MIN / SNAP) * SNAP));
  const yIn = e => e.clientY - grid.getBoundingClientRect().top;

  // Resize by dragging a handle
  grid.querySelectorAll('.h').forEach(hd => {
    hd.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const el = hd.closest('.blk'), b = S.blocks.find(x => x.id === el.dataset.id), edge = hd.dataset.edge;
      hd.setPointerCapture(e.pointerId);
      const move = ev => {
        const m = minAt(yIn(ev));
        if (edge === 'start') b.start = Math.min(m, b.end - SNAP); else b.end = Math.max(m, b.start + SNAP);
        el.style.top = b.start * PX_PER_MIN + 'px'; el.style.height = (b.end - b.start) * PX_PER_MIN + 'px';
        el.querySelector('.tt').textContent = `${fmtMin(b.start)} to ${fmtMin(b.end)}`;
      };
      const up = () => { hd.removeEventListener('pointermove', move); save(); render(); };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up, { once: true });
      hd.addEventListener('pointercancel', up, { once: true });
    });
  });

  // Tap a block to edit; tap or (mouse) drag on empty space to create
  grid.addEventListener('pointerdown', e => {
    const blk = e.target.closest('.blk');
    const startY = yIn(e), sx = e.clientX, sy = e.clientY;
    let draft = null, moved = false;
    const move = ev => {
      if (Math.abs(ev.clientY - sy) > 6 || Math.abs(ev.clientX - sx) > 6) moved = true;
      if (blk || e.pointerType !== 'mouse' || !moved) return;
      const a = minAt(Math.min(startY, yIn(ev))), z = minAt(Math.max(startY, yIn(ev)));
      if (!draft) { draft = document.createElement('div'); draft.className = 'blk draft'; draft.style.left = '4px'; draft.style.right = '4px'; grid.appendChild(draft); }
      draft.style.top = a * PX_PER_MIN + 'px'; draft.style.height = Math.max(SNAP, z - a) * PX_PER_MIN + 'px';
      draft.textContent = `${fmtMin(a)} to ${fmtMin(Math.max(z, a + SNAP))}`;
      draft.dataset.a = a; draft.dataset.z = Math.max(z, a + SNAP);
    };
    const up = () => {
      grid.removeEventListener('pointermove', move);
      if (blk && !moved) return openBlock(blk.dataset.id);
      if (blk) return;
      if (draft) return newShift(+draft.dataset.a, +draft.dataset.z);
      if (!moved) { const a = Math.floor(startY / PX_PER_MIN / 60) * 60; newShift(a, Math.min(1440, a + 60)); }
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', up, { once: true });
  });
}

function newShift(start, end) {
  const b = { id: uid(), start, end, people: [], daily: false, isNew: true };
  S.blocks.push(b); render(); openBlock(b.id);
}

function openBlock(id) {
  const b = S.blocks.find(x => x.id === id);
  if (!b) return;
  if (b.sugg) {
    return sheet(`<h2>${esc(namesOf(b.people))} usually covers this</h2>
      <p class="muted">${fmtMin(b.start)} to ${fmtMin(b.end)}. Pip noticed ${esc(namesOf(b.people))} covered this time on most of the last 7 days.</p>
      <button class="btn primary" data-act="sugg-yes" data-id="${b.id}">Confirm ${esc(namesOf(b.people))}</button>
      <button class="btn quiet" data-act="sugg-no" data-id="${b.id}">Dismiss suggestion</button>`);
  }
  const step = (edge, d) => `<button class="btn quiet" style="width:44px;min-height:44px;padding:0;display:inline-block" data-act="nudge" data-id="${b.id}" data-edge="${edge}" data-d="${d}">${d > 0 ? '+' : '−'}</button>`;
  sheet(`<h2>Who's on duty?</h2>
    <p class="muted">Pick one or more. If two people share a shift, alerts go to both.</p>
    <div class="picks">${S.people.map(p => `<button data-act="pick" data-id="${b.id}" data-p="${p.id}" class="${b.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>
    <div class="row"><span>Starts <b>${fmtMin(b.start)}</b></span><span>${step('start', -SNAP)} ${step('start', SNAP)}</span></div>
    <div class="row" style="margin-top:8px"><span>Ends <b>${fmtMin(b.end)}</b></span><span>${step('end', -SNAP)} ${step('end', SNAP)}</span></div>
    <label class="switch"><span>Same time every day</span><input type="checkbox" data-act="daily" data-id="${b.id}" ${b.daily ? 'checked' : ''}></label>
    <button class="btn primary" data-act="block-done" data-id="${b.id}">Done</button>
    <button class="btn quiet" data-act="block-del" data-id="${b.id}">${b.isNew ? 'Cancel' : 'Delete shift'}</button>`, () => cleanupNew());
}
function cleanupNew() {
  S.blocks = S.blocks.filter(b => !(b.isNew && !b.people.length));
  S.blocks.forEach(b => delete b.isNew);
  save(); render();
}

/* ---------- Team ---------- */
function teamHTML() {
  const colors = ['#dfe3f6', '#d6ebff', '#efe7e1', '#e8f0e4', '#f6e8ef'];
  let h = `<div class="top"><h1>Team</h1></div>
    <p class="muted" style="margin-top:0">Backup order: if the person on duty can't come, Pip asks the next person down the list.</p>
    <div class="card">${S.people.map((p, i) => `<div class="person">
      <div class="av" style="background:${colors[i % colors.length]}">${esc(p.name[0] || '?')}</div>
      <div class="grow"><div class="mid" style="font-size:17px">${i + 1}. ${esc(p.name)}${p.id === S.me ? ' (you)' : ''}</div>
      <div class="muted small">${p.admin ? 'Admin' : p.role ? esc(p.role) : 'Caregiver'}</div></div>
      <div class="ord"><button data-act="up" data-p="${p.id}" aria-label="Move up">↑</button><button data-act="down" data-p="${p.id}" aria-label="Move down">↓</button>
      ${p.admin ? '' : `<button data-act="remove" data-p="${p.id}" aria-label="Remove">✕</button>`}</div></div>`).join('')}</div>
    <div class="card"><div class="label">Invite a caregiver</div>
      <input type="text" id="newName" placeholder="Name, for example Grandpa" maxlength="20">
      <button class="btn primary" data-act="invite" style="margin-top:10px">Add to team</button>
      <p class="muted small">In this prototype, adding someone is instant. In the real app they'd get an invite link and their own login.</p></div>`;
  return h;
}

/* ---------- Settings ---------- */
function openSettings() {
  const st = S.settings;
  sheet(`<h2>Settings</h2>
    <label class="switch"><span><b>Fast demo</b><br><span class="small muted">Pip waits 5 s (not ${st.delay} s) before alerting, and passes the alert on after 20 s (not 3 min).</span></span><input type="checkbox" data-act="set-demo" ${st.demo ? 'checked' : ''}></label>
    <label class="switch"><span><b>Poop-time tracking</b><br><span class="small muted">Off by default. When on, Pip keeps a private history of change times. Nothing leaves the family.</span></span><input type="checkbox" data-act="set-track" ${st.tracking ? 'checked' : ''}></label>
    ${st.tracking ? `<div class="note">${S.history.length ? S.history.slice(-8).reverse().map(t => `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${fmtTime(t)}`).join('<br>') : 'No history yet. Changes are saved from now on.'}</div>` : ''}
    <div class="switch"><span><b>Night colors</b></span><div class="seg">${['auto', 'on', 'off'].map(v => `<button data-act="set-night" data-v="${v}" class="${st.night === v ? 'on' : ''}">${v === 'auto' ? 'After 9 pm' : v}</button>`).join('')}</div></div>
    <div class="note small"><b>About this prototype.</b> Henry, Mom, Dad and Nan are a pretend family. No real baby, health or personal data is used. Everything stays on this device. The Pip device is played by the Simulate button.</div>
    <button class="btn quiet" data-act="sim">Open device simulator</button>
    <button class="btn quiet" data-act="reset">Reset demo data</button>
    <button class="btn primary" data-act="close">Done</button>`);
}

/* ---------- Simulator ---------- */
function openSim() {
  const s = sensing ? (Date.now() - sensing.start) / 1000 : 0;
  const live = sensing ? `<div class="note"><b>${sensing.kind === 'soiled' ? 'Smell is staying high…' : 'Brief puff of gas…'}</b>
      <div class="meter"><i style="width:${Math.min(100, s / delaySec() * 100)}%"></i></div>
      <span class="small">Pip only alerts if the smell stays for ${delaySec()} seconds.</span></div>` : '';
  sheet(`<h2>Simulate the Pip</h2>
    <p class="muted small" style="margin-top:0">There's no real device here, so these buttons pretend to be the Pip on ${esc(S.baby)}'s diaper.</p>
    ${live}
    <div class="simgrid">
      <button class="btn primary" data-act="sim-soiled">💩 Diaper is soiled<small>Smell stays for ${delaySec()} s, then the on-duty person is alerted</small></button>
      <button class="btn quiet" data-act="sim-gas">💨 Brief gas only<small>Smell goes up, then back down. No alert.</small></button>
      <button class="btn quiet" data-act="sim-button" ${S.alert ? '' : 'disabled style="opacity:.5"'}>● Press the button on the Pip<small>Same as tapping "Changed"</small></button>
      <button class="btn quiet" data-act="${S.pip.connected ? 'sim-disc' : 'reconnect'}">${S.pip.connected ? '⚠ Pip disconnects' : '↺ Pip reconnects'}<small>${S.pip.connected ? 'What you see when Pip loses its signal' : 'Bring the signal back'}</small></button>
      <button class="btn quiet" data-act="${S.pip.battery < 20 ? 'charge' : 'sim-batt'}">${S.pip.battery < 20 ? '🔌 Charge Pip' : '🔋 Battery gets low'}<small>Pip at ${S.pip.battery}%</small></button>
    </div>
    <button class="btn quiet" data-act="close" style="margin-top:14px">Close</button>`);
}

function simulate(kind) {
  if (S.alert && kind === 'soiled') return toast('Pip is already alerting.');
  if (!S.pip.connected) return toast("Pip isn't connected, so it can't sense anything. Reconnect it first.");
  sensing = { kind, start: Date.now() };
  closeSheet(); render();
  toast(kind === 'soiled' ? `Pip noticed a smell. Waiting ${delaySec()} s to be sure…` : 'Pip noticed a brief puff of gas…');
}

/* ---------- Alert logic ---------- */
function allIds() { return S.people.map(p => p.id); }
function triggerAlert() {
  const duty = onDutyAt(nowMin());
  const to = duty.length ? duty : allIds();
  S.alert = { detectedAt: Date.now(), firstTo: to.slice(), to: to.slice(), tried: to.slice(), everyone: !duty.length, from: null, deadline: Date.now() + handoffSec() * 1000 };
  S.pip.led = true;
  S.log.push({ t: Date.now(), ev: 'soiled', to: namesOf(to) });
  save(); render();
}
function passOn(reason, byId) {
  const a = S.alert; if (!a) return;
  if (reason === 'cant' && a.to.length > 1 && !a.everyone) {
    a.to = a.to.filter(id => id !== byId); save(); render(); return toast(`OK. ${namesOf(a.to)} still has it.`);
  }
  if (a.everyone && reason === 'timeout') { a.deadline = Date.now() + handoffSec() * 1000; save(); return; }
  const prev = a.to.slice();
  a.from = { names: namesOf(prev), reason };
  const next = S.people.map(p => p.id).find(id => !a.tried.includes(id));
  if (next && !a.everyone) { a.to = [next]; a.tried.push(next); }
  else { a.to = allIds(); a.everyone = true; }
  a.deadline = Date.now() + handoffSec() * 1000;
  S.log.push({ t: Date.now(), ev: 'handoff', from: a.from.names, to: namesOf(a.to), reason });
  save(); render();
  if (reason === 'cant') toast(a.everyone ? 'No one else is free, so Pip is alerting everyone.' : `Passed to ${namesOf(a.to)}.`);
}
function changed(byId) {
  const a = S.alert; if (!a) return;
  const t = Date.now();
  S.lastChanged = t; S.poops.push(t);
  if (S.settings.tracking) S.history.push(t);
  const byName = byId ? nameOf(byId) : 'Someone';
  const missed = a.firstTo.filter(id => id !== byId);
  if (byId && !a.firstTo.includes(byId)) S.handled = { for: missed, text: `${byName} changed ${S.baby} at ${fmtTime(t)}.` };
  else if (!byId) S.handled = { for: allIds(), text: `${S.baby} was changed at ${fmtTime(t)} (Pip button pressed).` };
  S.log.push({ t, ev: 'changed', by: byName, handedOff: !!a.from });
  S.alert = null; S.pip.led = false;
  save(); render();
  toast("Changed. Pip's light is off and everyone's phone is updated.");
}
function falseAlarm() {
  S.log.push({ t: Date.now(), ev: 'false-alarm' });
  S.alert = null; S.pip.led = false; save(); render();
  toast('Cleared as a false alarm. Not counted as a poop.');
}

function renderAlert() {
  const el = $('#alert');
  const a = S.alert;
  const show = a && a.to.includes(S.me);
  el.classList.toggle('hidden', !show);
  el.classList.toggle('night', isNight());
  if (!show) { stopChime(); return; }
  const left = (a.deadline - Date.now()) / 1000;
  const nextId = S.people.map(p => p.id).find(id => !a.tried.includes(id));
  let passTxt;
  if (a.everyone) passTxt = 'Everyone is being alerted until someone answers.';
  else if (a.to.length > 1) passTxt = `${namesOf(a.to)} are both being alerted.`;
  else passTxt = nextId ? `Passes to ${nameOf(nextId)} in ${mmss(left)} if no answer` : `Alerts everyone in ${mmss(left)} if no answer`;
  const why = a.from ? `${a.from.names} ${a.from.reason === 'cant' ? "can't right now" : "didn't answer"}` : null;
  const chip = a.everyone ? (a.from ? "Everyone's alerted" : 'No one on duty, so everyone is alerted') : a.to.length > 1 ? "You're on duty together" : "You're on duty";
  el.innerHTML = `
    <div class="clock">${fmtTime(Date.now())} · viewing as ${esc(nameOf(S.me))}</div>
    <div class="icon" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
    <h1>Time for a change</h1>
    <div class="sub">${esc(S.baby)}'s diaper is soiled</div>
    <div class="muted" style="color:inherit;opacity:.75">detected ${ago(a.detectedAt)}</div>
    <div class="chips"><span class="chip ok">${esc(chip)}</span>${why ? ` <span class="chip">${esc(why)}</span>` : ''}</div>
    <div class="spacer"></div>
    <button class="btn primary" data-act="changed">Changed</button>
    <button class="btn secondary" data-act="cant">Can't right now</button>
    <div class="count">${esc(passTxt)}</div>
    <button class="link" data-act="false">False alarm</button>`;
  startChime();
}

/* ---------- Gentle chime + vibration (browser stand-in for critical alerts) ---------- */
let audioCtx = null;
function chimeOnce() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t = audioCtx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 1);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (e) { /* sound is optional */ }
}
function startChime() { if (chimeTimer) return; chimeOnce(); chimeTimer = setInterval(chimeOnce, 6000); }
function stopChime() { clearInterval(chimeTimer); chimeTimer = null; }

/* ---------- Sheet + toast ---------- */
let onSheetClose = null;
function sheet(html, onClose) { $('#sheetCard').innerHTML = html; $('#sheet').classList.remove('hidden'); onSheetClose = onClose || null; }
function closeSheet() { $('#sheet').classList.add('hidden'); const f = onSheetClose; onSheetClose = null; if (f) f(); }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200); }

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act], .tab');
  if (!t) return;
  if (t.classList.contains('tab')) { tab = t.dataset.tab; closeSheet(); render(); $('#screen').scrollTop = 0; return; }
  const act = t.dataset.act, id = t.dataset.id;
  const blk = id && S.blocks.find(b => b.id === id);
  switch (act) {
    case 'me': S.me = id; save(); render(); break;
    case 'tab': tab = t.dataset.tab; render(); break;
    case 'intro-ok': S.introSeen = true; save(); render(); break;
    case 'handled-ok': S.handled.for = S.handled.for.filter(x => x !== S.me); if (!S.handled.for.length) S.handled = null; save(); render(); break;
    case 'settings': openSettings(); break;
    case 'close': closeSheet(); break;
    case 'view': weekView = t.dataset.v === 'week'; render(); break;
    case 'add': { const m = Math.floor(nowMin() / 60) * 60; newShift(m, Math.min(1440, m + 120)); break; }
    case 'repeat': S.blocks.forEach(b => { if (!b.sugg) b.daily = true; }); save(); render(); toast('Done. These shifts now repeat every day.'); break;
    case 'pick': { const p = t.dataset.p; blk.people = blk.people.includes(p) ? blk.people.filter(x => x !== p) : [...blk.people, p]; delete blk.isNew; save(); render(); openBlock(id); break; }
    case 'nudge': { const d = +t.dataset.d; if (t.dataset.edge === 'start') blk.start = Math.max(0, Math.min(blk.end - SNAP, blk.start + d)); else blk.end = Math.min(1440, Math.max(blk.start + SNAP, blk.end + d)); save(); render(); openBlock(id); break; }
    case 'block-done': if (!blk.people.length) { toast('Pick who is on duty first.'); break; } delete blk.isNew; closeSheet(); break;
    case 'block-del': S.blocks = S.blocks.filter(b => b.id !== id); closeSheet(); break;
    case 'sugg-yes': blk.sugg = false; blk.daily = true; save(); closeSheet(); toast(`Confirmed. ${namesOf(blk.people)} is on duty then.`); break;
    case 'sugg-no': S.blocks = S.blocks.filter(b => b.id !== id); save(); closeSheet(); break;
    case 'up': case 'down': {
      const i = S.people.findIndex(p => p.id === t.dataset.p), j = act === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < S.people.length) { [S.people[i], S.people[j]] = [S.people[j], S.people[i]]; save(); render(); }
      break;
    }
    case 'remove': {
      const p = t.dataset.p;
      S.people = S.people.filter(x => x.id !== p);
      S.blocks.forEach(b => b.people = b.people.filter(x => x !== p));
      S.blocks = S.blocks.filter(b => b.people.length);
      if (S.me === p) S.me = S.people[0].id;
      save(); render(); break;
    }
    case 'invite': {
      const n = $('#newName').value.trim();
      if (!n) { toast('Type a name first.'); break; }
      S.people.push({ id: uid(), name: n.slice(0, 20), admin: false }); save(); render(); toast(`${n} added to the team.`); break;
    }
    case 'set-demo': S.settings.demo = t.checked; save(); break;
    case 'set-track': S.settings.tracking = t.checked; if (!t.checked) S.history = []; save(); openSettings(); break;
    case 'set-night': S.settings.night = t.dataset.v; save(); render(); openSettings(); break;
    case 'reset': localStorage.removeItem(KEY); S = sampleState(); sensing = null; save(); closeSheet(); tab = 'home'; render(); toast('Demo data reset.'); break;
    case 'sim': openSim(); break;
    case 'sim-soiled': simulate('soiled'); break;
    case 'sim-gas': simulate('gas'); break;
    case 'sim-button': closeSheet(); changed(null); break;
    case 'sim-disc': S.pip.connected = false; sensing = null; save(); closeSheet(); render(); break;
    case 'reconnect': S.pip.connected = true; save(); closeSheet(); render(); toast('Pip is connected again.'); break;
    case 'sim-batt': S.pip.battery = 15; save(); closeSheet(); render(); break;
    case 'charge': S.pip.battery = 100; save(); closeSheet(); render(); break;
    case 'changed': changed(S.me); break;
    case 'cant': passOn('cant', S.me); break;
    case 'false': falseAlarm(); break;
  }
});
$('#simBtn').addEventListener('click', openSim);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

/* ---------- Clock ---------- */
setInterval(() => {
  if (sensing) {
    const s = (Date.now() - sensing.start) / 1000;
    if (sensing.kind === 'gas' && s >= 3) { sensing = null; toast('The smell went away within 3 seconds, so no alert. Passing gas is ignored.'); render(); }
    else if (sensing.kind === 'soiled' && s >= delaySec()) { sensing = null; closeSheet(); triggerAlert(); }
    else if (!$('#sheet').classList.contains('hidden') && $('#sheetCard h2')?.textContent.startsWith('Simulate')) openSim();
  }
  if (S.alert && Date.now() > S.alert.deadline) passOn('timeout');
  if (S.alert && S.alert.to.includes(S.me)) renderAlert();
}, 1000);
setInterval(() => { if ($('#sheet').classList.contains('hidden') && tab === 'home') render(); }, 30000);

render();
