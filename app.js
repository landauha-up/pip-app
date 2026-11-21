/* Pip: demo prototype for IPD 5510 Digital Prototype Demo Day.
   Everything here is SAMPLE data (a pretend family). No real personal or health data.
   State lives only in this browser (localStorage). The Pip device is simulated with
   the "Simulate" controls; the real device link (MQTT over Wi-Fi) is not part of this build. */

const KEY = 'pip-demo-v2';
const PX_PER_MIN = 48 / 60;
const SNAP = 15;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, '0');

/* ---------- Dates ---------- */
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
const weekday = s => new Date(s + 'T12:00:00').getDay(); // 0 Sun
const isWeekend = s => [0, 6].includes(weekday(s));
function mondayOf(s) { return addDays(s, -((weekday(s) + 6) % 7)); }
function dayLabel(s) {
  const n = dayDiff(today(), s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return new Date(s + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
const shortDay = s => new Date(s + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });

/* ---------- Sample data ---------- */
function sampleState() {
  const now = Date.now(), t = today();
  const blocks = [];
  const add = (date, start, end, people) => blocks.push({ id: uid(), date, start, end, people });
  // Last 7 days of history, so Pip has a pattern to learn from
  for (let i = -7; i <= 0; i++) {
    const d = addDays(t, i);
    add(d, 0, 420, ['dad']);
    add(d, 420, 720, ['mom']);
    add(d, 720, 1020, isWeekend(d) ? ['mom'] : ['nan']);
    add(d, 1080, 1320, ['mom', 'dad']);
    if (i < 0 && i !== -4) add(d, 1320, 1440, ['dad']); // Dad usually takes late evening (not confirmed today)
  }
  return {
    v: 2,
    day: t,
    baby: 'Henry',
    people: [
      { id: 'mom', name: 'Mom', admin: true },
      { id: 'dad', name: 'Dad', admin: false },
      { id: 'nan', name: 'Nan', admin: false, role: 'Nanny' },
    ],
    me: 'mom',
    blocks,
    away: [],      // {id, date, start, end, person}: "Not Mom" times
    dismissed: [], // suggestion keys the family dismissed
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
let sensing = null;
let chimeTimer = null;
let weekView = false;
let viewDay = today();
let viewWeek = mondayOf(today());

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 2) {
      if (s.day !== today()) { s.day = today(); s.poops = []; }
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
const allIds = () => S.people.map(p => p.id);
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtMin(m) {
  m = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return mm ? `${h}:${pad(mm)} ${ap}` : `${h} ${ap}`;
}
function fmtEnd(m) { return m >= 1440 ? 'midnight' : fmtMin(m); }
function fmtTime(ts) { const d = new Date(ts); return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() >= 12 ? 'pm' : 'am'}`; }
function fmtDur(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
}
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s < 10 ? 'just now' : `${s} sec ago`;
  return `${Math.floor(s / 60)} min ago`;
}
function mmss(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
const delaySec = () => S.settings.demo ? 5 : S.settings.delay;
const handoffSec = () => S.settings.demo ? 20 : S.settings.handoff;

/* ---------- Schedule model ---------- */
const blocksOn = date => S.blocks.filter(b => b.date === date);
const awayOn = date => S.away.filter(a => a.date === date);
function awayAt(date, m) { return awayOn(date).filter(a => a.start <= m && m < a.end).map(a => a.person); }
function isAway(id, date = today(), m = nowMin()) { return awayAt(date, m).includes(id); }
// Who is on duty at minute m: people in confirmed shifts, minus anyone marked "Not available"
function scheduledAt(date, m) { return [...new Set(blocksOn(date).filter(b => b.start <= m && m < b.end).flatMap(b => b.people))].filter(person); }
function onDutyAt(m, date = today()) { const out = awayAt(date, m); return scheduledAt(date, m).filter(id => !out.includes(id)); }
const available = (date = today(), m = nowMin()) => allIds().filter(id => !isAway(id, date, m));

// Pattern recognition: if the same person covered the same time slot on 2+ of the
// last 7 days (weekdays matched with weekdays, weekends with weekends), suggest it
// as a faded shift on any day (today or later) where that time isn't covered yet.
const sugKey = (date, b) => `${date}|${b.start}|${b.end}|${b.people.slice().sort().join('+')}`;
function suggestionsOn(date) {
  if (dayDiff(today(), date) < 0) return [];
  const counts = new Map();
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), -i);
    if (isWeekend(d) !== isWeekend(date)) continue;
    blocksOn(d).forEach(b => {
      const k = `${b.start}|${b.end}|${b.people.slice().sort().join('+')}`;
      const c = counts.get(k) || { start: b.start, end: b.end, people: b.people.slice(), days: new Set() };
      c.days.add(d); counts.set(k, c);
    });
  }
  const mine = blocksOn(date);
  const out = [];
  counts.forEach(c => {
    if (c.days.size < 2) return;
    if (mine.some(b => b.start < c.end && c.start < b.end)) return;
    if (out.some(s => s.start < c.end && c.start < s.end)) return;
    const key = sugKey(date, c);
    if (S.dismissed.includes(key)) return;
    out.push({ id: 's:' + key, key, date, start: c.start, end: c.end, people: c.people, sugg: true, seen: c.days.size });
  });
  return out.sort((a, b) => a.start - b.start);
}
function confirmSugg(s) {
  S.blocks.push({ id: uid(), date: s.date, start: s.start, end: s.end, people: s.people.slice() });
}
function findSugg(id) {
  const date = id.slice(2).split('|')[0];
  return suggestionsOn(date).find(s => s.id === id);
}
// Put people on duty for [a, z) on a date, trimming whatever was there before
function setRange(date, a, z, people) {
  const next = [];
  S.blocks.forEach(b => {
    if (b.date !== date || b.end <= a || b.start >= z) return next.push(b);
    if (b.start < a) next.push({ ...b, id: uid(), end: a });
    if (b.end > z) next.push({ ...b, id: uid(), start: z });
  });
  S.blocks = next;
  if (people.length) S.blocks.push({ id: uid(), date, start: a, end: z, people: people.slice() });
}
function setAwayRange(date, a, z, ids) {
  S.away = S.away.filter(x => !(x.date === date && x.start === a && x.end === z));
  ids.forEach(p => S.away.push({ id: uid(), date, start: a, end: z, person: p }));
}

function currentShift() {
  const t = today(), m = nowMin(), people = onDutyAt(m);
  const key = people.join();
  const cuts = [...new Set([1440, ...blocksOn(t).flatMap(b => [b.start, b.end]), ...awayOn(t).flatMap(a => [a.start, a.end])])].filter(x => x > m).sort((a, b) => a - b);
  let until = 1440;
  for (const c of cuts) { if (c >= 1440 || onDutyAt(c).join() !== key) { until = c; break; } }
  const next = until < 1440 ? onDutyAt(until) : [];
  const sugg = suggestionsOn(t).find(s => s.start === until);
  return { people, until, next, sugg };
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
  const keepScroll = $('#tl') ? $('#tl').scrollTop : null;
  if (tab === 'home') el.innerHTML = homeHTML();
  if (tab === 'schedule') { el.innerHTML = scheduleHTML(); wireSchedule(keepScroll); }
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

function dutyCard() {
  const sh = currentShift(), t = today(), m = nowMin();
  const outNow = awayAt(t, m);
  const outTxt = outNow.map(id => {
    const a = awayOn(t).find(x => x.person === id && x.start <= m && m < x.end);
    return `${nameOf(id)} can't until ${fmtEnd(a.end)}`;
  }).join(' · ');
  let head, sub, mine = false, extra = '';
  if (!sh.people.length) {
    const who = available();
    head = 'No one on duty';
    sub = `Alerts go to ${who.length === allIds().length ? 'everyone' : `everyone who's free (${namesOf(who)})`} until someone is scheduled.`;
    const scheduled = scheduledAt(t, m);
    if (scheduled.length && outNow.length) {
      extra = `<div style="margin-top:10px">${who.map(id => `<button class="chip" style="min-height:40px;margin:0 6px 6px 0" data-act="cover" data-p="${id}">Ask ${esc(id === S.me ? 'me' : nameOf(id))} to cover</button>`).join('')}</div>`;
    }
  } else {
    mine = sh.people.includes(S.me);
    const others = sh.people.filter(id => id !== S.me);
    if (mine && others.length) head = `You're on duty with ${namesOf(others)}`;
    else if (mine) head = "You're on duty";
    else head = `${namesOf(sh.people)} ${sh.people.length > 1 ? 'are' : 'is'} on duty`;
    const left = sh.until - m;
    const nextTxt = sh.next.length ? `then ${sh.next.length === 1 && sh.next[0] === S.me ? 'you' : namesOf(sh.next)}`
      : sh.sugg ? `then maybe ${namesOf(sh.sugg.people)} (not confirmed yet)` : 'then no one is scheduled';
    sub = `for ${fmtDur(left)} more, ${nextTxt}`;
  }
  return `<div class="card ${mine ? 'status clean' : ''}"><div class="label">On duty now</div>
    <div class="mid">${esc(head)}</div><div class="muted">${esc(sub)}</div>
    ${outTxt ? `<div class="small" style="margin-top:6px"><b>✕ ${esc(outTxt)}</b></div>` : ''}${extra}
    <button class="btn quiet" data-act="away" style="margin-top:12px;min-height:44px;font-size:15px">I can't be on duty…</button></div>`;
}

function stripHTML() {
  const t = today(), m = nowMin();
  const cuts = [...new Set([0, 1440, ...blocksOn(t).flatMap(b => [b.start, b.end]), ...awayOn(t).flatMap(a => [a.start, a.end])])].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], z = cuts[i + 1], who = onDutyAt(a);
    const last = segs[segs.length - 1];
    if (last && last.key === who.join()) { last.z = z; continue; }
    segs.push({ a, z, who, key: who.join() });
  }
  return `<div class="strip">${segs.map(s => {
    const cls = s.who.length === 0 ? 'gap' : s.who.length > 1 ? 'p-multi' : pClass(s.who[0]);
    const now = m >= s.a && m < s.z ? ' now' : '';
    return `<div class="${cls}${now}" style="flex:${s.z - s.a}" title="${fmtMin(s.a)} to ${fmtEnd(s.z)}">${s.z - s.a >= 150 ? (s.who.length ? esc(namesOf(s.who)) : 'open') : ''}</div>`;
  }).join('')}</div>
  <div class="row small muted" style="margin-top:4px"><span>12 am</span><span>noon</span><span>12 am</span></div>`;
}

function homeHTML() {
  const needs = !!S.alert;
  const me = person(S.me);
  const poopsLast = S.poops.length ? fmtTime(S.poops[S.poops.length - 1]) : null;
  let h = `<div class="top"><h1>${greeting()}, ${esc(me ? me.name : '')}</h1>
    <button class="gear" data-act="settings" aria-label="Settings">⚙</button></div>`;
  if (!S.introSeen) h += `<div class="intro"><b>Welcome to Pip.</b> This is a prototype with a pretend family: baby Henry, Mom, Dad and Nan the nanny. Nothing here is real data.<br><br>
    <b>Things to try:</b><br>1. <b>Plan who's on duty</b> in Schedule, by the day or the week. Faded shifts are Pip's guesses from past weeks: double-tap one to confirm it.<br>
    2. <b>Say you can't</b> with "I can't be on duty…", for example for a last-minute meeting.<br>
    3. Tap <b>Simulate</b> and choose "Diaper is soiled", then answer the alert or pass it on with "Can't right now".<br>
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
    const who = S.alert.everyone ? 'everyone who is free' : namesOf(S.alert.to);
    h += `<div class="note">Pip is alerting <b>${esc(who)}</b>. You're not on duty, so your phone stays quiet.
      <div style="margin-top:8px">${S.alert.to.map(id => `<button class="link" data-act="me" data-id="${id}" style="padding-left:0">See ${esc(nameOf(id))}'s phone →</button>`).join(' ')}</div></div>`;
  }
  h += dutyCard();
  h += `<div class="card"><div class="row"><div class="label">Today's shifts</div><button class="link small" data-act="tab" data-tab="schedule">See schedule</button></div>${stripHTML()}</div>`;
  h += `<div class="card"><div class="label">Today</div><div class="mid">${S.poops.length} poop${S.poops.length === 1 ? '' : 's'}</div>
      <div class="muted">${poopsLast ? `last at ${poopsLast} · counted by Pip, no logging` : 'counted by Pip, no logging'}</div></div>`;
  return h;
}

/* ---------- Schedule: shared bits ---------- */
function pClass(id) { const n = nameOf(id); return ['Mom', 'Dad', 'Nan'].includes(n) ? `p-${n}` : 'p-other'; }
function blockClass(b) { return b.sugg ? 'sugg' : b.people.length > 1 ? 'p-multi' : pClass(b.people[0]); }

// Double-tap detection (works for touch and mouse)
let lastTap = { key: null, t: 0 }, singleTimer = null;
function tapOrDouble(key, onSingle, onDouble) {
  const now = Date.now();
  clearTimeout(singleTimer);
  if (lastTap.key === key && now - lastTap.t < 380) { lastTap = { key: null, t: 0 }; onDouble(); return; }
  lastTap = { key, t: now };
  singleTimer = setTimeout(onSingle, 380);
}

function scheduleHTML() {
  const title = weekView ? weekTitle() : dayLabel(viewDay);
  let h = `<div class="top"><div class="row" style="gap:4px">
      <button class="navbtn" data-act="nav" data-d="-1" aria-label="Previous">‹</button>
      <h1 style="font-size:24px;min-width:0">${esc(title)}</h1>
      <button class="navbtn" data-act="nav" data-d="1" aria-label="Next">›</button></div>
    <div class="seg"><button data-act="view" data-v="day" class="${weekView ? '' : 'on'}">Day</button>
    <button data-act="view" data-v="week" class="${weekView ? 'on' : ''}">Week</button></div></div>`;
  return h + (weekView ? weekHTML() : dayHTML());
}

/* ---------- Day view ---------- */
function layoutCols(bs) {
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
function blockHTML(b, pos) {
  const top = b.start * PX_PER_MIN, ht = Math.max(18, (b.end - b.start) * PX_PER_MIN);
  const w = 100 / pos.n, l = pos.col * w;
  const label = b.sugg ? `${esc(namesOf(b.people))}?` : b.people.length ? esc(namesOf(b.people)) : 'Who?';
  return `<div class="blk ${blockClass(b)}" data-id="${esc(b.id)}" style="top:${top}px;height:${ht}px;left:calc(${l}% + 4px);width:calc(${w}% - 8px)">
    <div class="h top" data-edge="start"></div>
    ${label}<div class="t tt">${fmtMin(b.start)} to ${fmtEnd(b.end)}</div>
    ${b.sugg ? `<div class="t">suggested · double-tap to confirm</div><button class="x" data-act="sugg-no" data-id="${esc(b.id)}" aria-label="Dismiss suggestion">✕</button>` : ''}
    <div class="h bot" data-edge="end"></div></div>`;
}
function dayHTML() {
  const sugg = suggestionsOn(viewDay);
  const all = [...blocksOn(viewDay), ...sugg];
  const pos = layoutCols(all);
  let h = `<div class="muted small">Tap an empty time to add a shift. Drag the bar on a shift's edge to stretch it. <b>Faded shifts</b> are Pip's guesses from past weeks: <b>double-tap</b> to confirm.</div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="btn quiet tool" data-act="away" data-date="${viewDay}">✕ Someone can't</button>
      <button class="btn quiet tool" data-act="repeat-day">↻ Same every day</button>
    </div>
    ${sugg.length ? `<button class="btn quiet tool" data-act="accept-day" style="margin-top:8px">✓ Confirm all ${sugg.length} faded shift${sugg.length > 1 ? 's' : ''}</button>` : ''}`;
  h += `<div class="tl" id="tl"><div class="hours">${Array.from({ length: 24 }, (_, i) => `<div>${fmtMin(i * 60)}</div>`).join('')}</div>
    <div class="grid" id="grid" style="height:${1440 * PX_PER_MIN}px">
      ${all.map(b => blockHTML(b, pos.get(b.id))).join('')}
      ${awayOn(viewDay).map(a => `<div class="away" style="top:${a.start * PX_PER_MIN}px;height:${(a.end - a.start) * PX_PER_MIN}px"><span>Not ${esc(nameOf(a.person))}</span></div>`).join('')}
      ${viewDay === today() ? `<div class="nowline" style="top:${nowMin() * PX_PER_MIN}px"></div>` : ''}
    </div></div>`;
  return h;
}

function wireSchedule(keepScroll) {
  if (weekView) return wireWeek();
  const grid = $('#grid');
  if (!grid) return;
  const tl = $('#tl');
  requestAnimationFrame(() => { tl.scrollTop = keepScroll != null ? keepScroll : Math.max(0, (viewDay === today() ? nowMin() : 420) * PX_PER_MIN - 120); });
  const minAt = y => Math.max(0, Math.min(1440, Math.round(y / PX_PER_MIN / SNAP) * SNAP));
  const yIn = e => e.clientY - grid.getBoundingClientRect().top;

  grid.querySelectorAll('.blk:not(.sugg) .h').forEach(hd => {
    hd.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const el = hd.closest('.blk'), b = S.blocks.find(x => x.id === el.dataset.id), edge = hd.dataset.edge;
      hd.setPointerCapture(e.pointerId);
      const move = ev => {
        const m = minAt(yIn(ev));
        if (edge === 'start') b.start = Math.min(m, b.end - SNAP); else b.end = Math.max(m, b.start + SNAP);
        el.style.top = b.start * PX_PER_MIN + 'px'; el.style.height = (b.end - b.start) * PX_PER_MIN + 'px';
        el.querySelector('.tt').textContent = `${fmtMin(b.start)} to ${fmtEnd(b.end)}`;
      };
      const up = () => { hd.removeEventListener('pointermove', move); save(); render(); };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up, { once: true });
      hd.addEventListener('pointercancel', up, { once: true });
    });
  });

  grid.addEventListener('pointerdown', e => {
    if (e.target.closest('.x')) return;
    const blk = e.target.closest('.blk');
    const startY = yIn(e), sx = e.clientX, sy = e.clientY;
    let draft = null, moved = false;
    const move = ev => {
      if (Math.abs(ev.clientY - sy) > 6 || Math.abs(ev.clientX - sx) > 6) moved = true;
      if (blk || e.pointerType !== 'mouse' || !moved) return;
      const a = minAt(Math.min(startY, yIn(ev))), z = minAt(Math.max(startY, yIn(ev)));
      if (!draft) { draft = document.createElement('div'); draft.className = 'blk draft'; draft.style.left = '4px'; draft.style.right = '4px'; grid.appendChild(draft); }
      draft.style.top = a * PX_PER_MIN + 'px'; draft.style.height = Math.max(SNAP, z - a) * PX_PER_MIN + 'px';
      draft.textContent = `${fmtMin(a)} to ${fmtEnd(Math.max(z, a + SNAP))}`;
      draft.dataset.a = a; draft.dataset.z = Math.max(z, a + SNAP);
    };
    const up = () => {
      grid.removeEventListener('pointermove', move);
      if (blk && !moved) {
        const id = blk.dataset.id;
        if (blk.classList.contains('sugg')) {
          return tapOrDouble(id, () => toast('Double-tap a faded shift to confirm it, or tap ✕ to dismiss it.'), () => {
            const s = findSugg(id); if (!s) return;
            confirmSugg(s); save(); render(); toast(`Confirmed: ${namesOf(s.people)}, ${fmtMin(s.start)} to ${fmtEnd(s.end)}.`);
          });
        }
        return openBlock(id);
      }
      if (blk) return;
      if (draft) return newShift(+draft.dataset.a, +draft.dataset.z);
      if (!moved) { const a = Math.floor(startY / PX_PER_MIN / 60) * 60; newShift(a, Math.min(1440, a + 60)); }
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', up, { once: true });
  });
}

function newShift(start, end) {
  const b = { id: uid(), date: viewDay, start, end, people: [], isNew: true };
  S.blocks.push(b); render(); openBlock(b.id);
}

function openBlock(id) {
  const b = S.blocks.find(x => x.id === id);
  if (!b) return;
  const step = (edge, d) => `<button class="btn quiet" style="width:44px;min-height:44px;padding:0;display:inline-block" data-act="nudge" data-id="${b.id}" data-edge="${edge}" data-d="${d}">${d > 0 ? '+' : '−'}</button>`;
  sheet(`<h2>Who's on duty?</h2>
    <p class="muted">${esc(dayLabel(b.date))}. Pick one or more. If two people share a shift, alerts go to both.</p>
    <div class="picks">${S.people.map(p => `<button data-act="pick" data-id="${b.id}" data-p="${p.id}" class="${b.people.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>
    <div class="row"><span>Starts <b>${fmtMin(b.start)}</b></span><span>${step('start', -SNAP)} ${step('start', SNAP)}</span></div>
    <div class="row" style="margin-top:8px"><span>Ends <b>${fmtEnd(b.end)}</b></span><span>${step('end', -SNAP)} ${step('end', SNAP)}</span></div>
    <button class="btn primary" data-act="block-done" data-id="${b.id}" style="margin-top:16px">Done</button>
    <button class="btn quiet" data-act="block-del" data-id="${b.id}">${b.isNew ? 'Cancel' : 'Delete shift'}</button>`, () => cleanupNew());
}
function cleanupNew() {
  S.blocks = S.blocks.filter(b => !(b.isNew && !b.people.length));
  S.blocks.forEach(b => delete b.isNew);
  save(); render();
}

/* ---------- Week view ---------- */
const PERIODS = [['Night', 0, 420], ['Morning', 420, 720], ['Afternoon', 720, 1020], ['Evening', 1020, 1320], ['Late', 1320, 1440]];
function weekTitle() {
  const n = dayDiff(mondayOf(today()), viewWeek) / 7;
  if (n === 0) return 'This week';
  if (n === 1) return 'Next week';
  if (n === -1) return 'Last week';
  return 'Week of ' + new Date(viewWeek + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function cellInfo(date, a, z) {
  const mid = Math.floor((a + z) / 2);
  const who = scheduledAt(date, mid);
  const outs = [...new Set(awayOn(date).filter(x => x.start < z && a < x.end).map(x => x.person))];
  const partial = !who.length && blocksOn(date).some(b => b.start < z && a < b.end);
  const sugg = who.length ? null : suggestionsOn(date).find(s => s.start < z && a < s.end);
  return { who, outs, sugg, partial };
}
function weekHTML() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(viewWeek, i));
  const t = today();
  const allSugg = days.flatMap(d => suggestionsOn(d));
  let h = `<div class="muted small">Tap a box to choose who's on duty, or who <b>can't</b>. <b>Faded boxes</b> are Pip's guesses from past weeks: <b>double-tap</b> to confirm.</div>
    <div class="week">
      <div></div>${days.map(d => `<div class="wh${d === t ? ' today' : ''}" data-act="goday" data-date="${d}">${shortDay(d)[0]}${shortDay(d)[1]}<br><span>${new Date(d + 'T12:00:00').getDate()}</span></div>`).join('')}`;
  PERIODS.forEach(([label, a, z]) => {
    h += `<div class="h">${label}<br><span>${fmtMin(a).replace(' ', '')}</span></div>`;
    days.forEach(d => {
      const c = cellInfo(d, a, z), past = dayDiff(t, d) < 0;
      const outTxt = c.outs.length ? `<i>✕${c.outs.map(id => esc(nameOf(id)[0])).join('')}</i>` : '';
      const key = `${d}|${a}`;
      if (c.who.length) h += `<button class="wc ${c.who.length > 1 ? 'p-multi' : pClass(c.who[0])}${past ? ' past' : ''}" data-cell="${key}">${c.who.map(id => esc(nameOf(id)[0])).join('+')}${outTxt}</button>`;
      else if (c.sugg) h += `<button class="wc sugg" data-cell="${key}" data-sugg="${esc(c.sugg.id)}">${c.sugg.people.map(id => esc(nameOf(id)[0])).join('+')}?${outTxt}</button>`;
      else h += `<button class="wc open${past ? ' past' : ''}" data-cell="${key}">${c.partial ? 'part' : 'open'}${outTxt}</button>`;
    });
  });
  h += `</div>
    <p class="muted small">M = Mom, D = Dad, N = Nan. M+D = both on duty. ✕M = Mom can't for part of that time. "Open" = no one assigned, so alerts go to everyone who's free.</p>
    ${allSugg.length ? `<button class="btn quiet tool" data-act="accept-week">✓ Confirm all ${allSugg.length} faded shifts this week</button>` : ''}
    <button class="btn quiet tool" data-act="repeat-week" style="margin-top:8px">↻ Copy this week to next week</button>`;
  return h;
}
function wireWeek() {
  document.querySelectorAll('.wc').forEach(el => el.addEventListener('click', () => {
    const [date, a] = el.dataset.cell.split('|');
    const P = PERIODS.find(p => p[1] === +a);
    if (el.dataset.sugg) {
      return tapOrDouble(el.dataset.cell, () => openCell(date, P), () => {
        suggestionsOn(date).filter(s => s.start < P[2] && P[1] < s.end).forEach(confirmSugg);
        save(); render(); toast(`Confirmed ${shortDay(date)} ${P[0].toLowerCase()}.`);
      });
    }
    openCell(date, P);
  }));
}
let cellDraft = null;
function openCell(date, P) {
  const [label, a, z] = P;
  if (!cellDraft || cellDraft.date !== date || cellDraft.a !== a) {
    const c = cellInfo(date, a, z);
    cellDraft = { date, a, z, label, who: c.who.length ? c.who : [], outs: c.outs };
  }
  const d = cellDraft;
  const c = cellInfo(date, a, z);
  sheet(`<h2>${esc(dayLabel(date))}, ${label.toLowerCase()}</h2>
    <p class="muted" style="margin-top:0">${fmtMin(a)} to ${fmtEnd(z)}</p>
    ${c.sugg ? `<div class="note small">Pip suggests <b>${esc(namesOf(c.sugg.people))}</b> (covered this time on ${c.sugg.seen} recent days). <button class="link" data-act="cell-sugg">Use it</button></div>` : ''}
    <div class="label">On duty</div>
    <div class="picks">${S.people.map(p => `<button data-act="cell-who" data-p="${p.id}" class="${d.who.includes(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>
    <div class="label">Can't do it</div>
    <div class="picks">${S.people.map(p => `<button data-act="cell-out" data-p="${p.id}" class="not ${d.outs.includes(p.id) ? 'on' : ''}">Not ${esc(p.name)}</button>`).join('')}</div>
    <button class="btn primary" data-act="cell-save">Save</button>
    <button class="btn quiet" data-act="cell-clear">Clear this time</button>`, () => { cellDraft = null; });
}

/* ---------- "Not Mom" quick unavailability ---------- */
let awayDraft = null;
function openAway(date) {
  const t = today();
  date = date || t;
  if (!awayDraft) {
    const m = date === t ? Math.floor(nowMin() / SNAP) * SNAP : 540;
    awayDraft = { date, who: [S.me], start: m, end: Math.min(1440, m + 120) };
  }
  const d = awayDraft;
  const quick = date === t ? [['Next hour', 60], ['Next 2 hrs', 120], ['Rest of today', 'rest']] : [['Morning', [420, 720]], ['Afternoon', [720, 1020]], ['Evening', [1020, 1320]], ['All day', [0, 1440]]];
  const step = (edge, dd) => `<button class="btn quiet" style="width:44px;min-height:44px;padding:0;display:inline-block" data-act="away-nudge" data-edge="${edge}" data-d="${dd}">${dd > 0 ? '+' : '−'}</button>`;
  const list = awayOn(date);
  sheet(`<h2>Who can't be on duty?</h2>
    <p class="muted" style="margin-top:0">${esc(dayLabel(date))}. Pip won't alert them then, and passes alerts to whoever is free.</p>
    <div class="picks">${S.people.map(p => `<button data-act="away-who" data-p="${p.id}" class="not ${d.who.includes(p.id) ? 'on' : ''}">Not ${esc(p.name)}</button>`).join('')}</div>
    <div class="label">When</div>
    <div class="picks">${quick.map(([l, v]) => `<button data-act="away-quick" data-v="${Array.isArray(v) ? v.join(',') : v}">${l}</button>`).join('')}</div>
    <div class="row"><span>From <b>${fmtMin(d.start)}</b></span><span>${step('start', -SNAP)} ${step('start', SNAP)}</span></div>
    <div class="row" style="margin-top:8px"><span>Until <b>${fmtEnd(d.end)}</b></span><span>${step('end', -SNAP)} ${step('end', SNAP)}</span></div>
    <button class="btn primary" data-act="away-save" style="margin-top:16px">Save</button>
    ${list.length ? `<div class="label" style="margin-top:16px">Already marked</div>${list.map(x => `<div class="row" style="min-height:44px"><span>Not ${esc(nameOf(x.person))}, ${fmtMin(x.start)} to ${fmtEnd(x.end)}</span><button class="link" data-act="away-del" data-id="${x.id}">Remove</button></div>`).join('')}` : ''}
    <button class="btn quiet" data-act="close" style="margin-top:8px">Cancel</button>`, () => { awayDraft = null; });
}

/* ---------- Team ---------- */
function teamHTML() {
  const colors = ['#dfe3f6', '#d6ebff', '#efe7e1', '#e8f0e4', '#f6e8ef'];
  return `<div class="top"><h1>Team</h1></div>
    <p class="muted" style="margin-top:0">Backup order: if the person on duty can't come, Pip asks the next person down the list.</p>
    <div class="card">${S.people.map((p, i) => `<div class="person">
      <div class="av" style="background:${colors[i % colors.length]}">${esc(p.name[0] || '?')}</div>
      <div class="grow"><div class="mid" style="font-size:17px">${i + 1}. ${esc(p.name)}${p.id === S.me ? ' (you)' : ''}</div>
      <div class="muted small">${p.admin ? 'Admin' : p.role ? esc(p.role) : 'Caregiver'}${isAway(p.id) ? ' · not available now' : ''}</div></div>
      <div class="ord"><button data-act="up" data-p="${p.id}" aria-label="Move up">↑</button><button data-act="down" data-p="${p.id}" aria-label="Move down">↓</button>
      ${p.admin ? '' : `<button data-act="remove" data-p="${p.id}" aria-label="Remove">✕</button>`}</div></div>`).join('')}</div>
    <div class="card"><div class="label">Invite a caregiver</div>
      <input type="text" id="newName" placeholder="Name, for example Grandpa" maxlength="20">
      <button class="btn primary" data-act="invite" style="margin-top:10px">Add to team</button>
      <p class="muted small">In this prototype, adding someone is instant. In the real app they'd get an invite link and their own login.</p></div>`;
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
function triggerAlert() {
  const duty = onDutyAt(nowMin());
  const free = available();
  const to = duty.length ? duty : (free.length ? free : allIds());
  S.alert = { detectedAt: Date.now(), firstTo: to.slice(), to: to.slice(), tried: to.slice(), everyone: !duty.length, from: null, deadline: Date.now() + handoffSec() * 1000 };
  S.pip.led = true;
  S.log.push({ t: Date.now(), ev: 'soiled', to: namesOf(to) });
  save(); render();
}
function nextInLine(a) { return allIds().find(id => !a.tried.includes(id) && !isAway(id)); }
function passOn(reason, byId) {
  const a = S.alert; if (!a) return;
  if (reason === 'cant' && a.to.length > 1) {
    a.to = a.to.filter(id => id !== byId); save(); render(); return toast(`OK. ${namesOf(a.to)} still ${a.to.length > 1 ? 'have' : 'has'} it.`);
  }
  if (a.everyone && reason === 'timeout') { a.deadline = Date.now() + handoffSec() * 1000; save(); return; }
  a.from = { names: namesOf(a.to), reason };
  const next = nextInLine(a);
  if (next && !a.everyone) { a.to = [next]; a.tried.push(next); }
  else { const free = available().filter(id => id !== byId); a.to = free.length ? free : allIds(); a.everyone = true; }
  a.deadline = Date.now() + handoffSec() * 1000;
  S.log.push({ t: Date.now(), ev: 'handoff', from: a.from.names, to: namesOf(a.to), reason });
  save(); render();
  if (reason === 'cant') toast(a.everyone ? 'No one else is next in line, so Pip is alerting everyone who is free.' : `Passed to ${namesOf(a.to)}.`);
}
function changed(byId) {
  const a = S.alert; if (!a) return;
  const t = Date.now();
  S.lastChanged = t; S.poops.push(t);
  if (S.settings.tracking) S.history.push(t);
  const byName = byId ? nameOf(byId) : 'Someone';
  if (byId && !a.firstTo.includes(byId)) S.handled = { for: a.firstTo.slice(), text: `${byName} changed ${S.baby} at ${fmtTime(t)}.` };
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
  const nextId = nextInLine(a);
  let passTxt;
  if (a.everyone) passTxt = 'Everyone who is free is being alerted until someone answers.';
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
    case 'view': weekView = t.dataset.v === 'week'; if (weekView) viewWeek = mondayOf(viewDay); render(); break;
    case 'nav': {
      const d = +t.dataset.d;
      if (weekView) viewWeek = addDays(viewWeek, 7 * d); else viewDay = addDays(viewDay, d);
      render(); break;
    }
    case 'goday': viewDay = t.dataset.date; weekView = false; render(); break;
    case 'repeat-day': {
      const src = blocksOn(viewDay);
      for (let i = 1; i <= 6; i++) {
        const d = addDays(viewDay, i);
        S.blocks = S.blocks.filter(b => b.date !== d);
        src.forEach(b => S.blocks.push({ ...b, id: uid(), date: d }));
      }
      save(); render(); toast(`Copied ${dayLabel(viewDay).toLowerCase()} to the next 6 days.`); break;
    }
    case 'accept-day': suggestionsOn(viewDay).forEach(confirmSugg); save(); render(); toast('All faded shifts confirmed.'); break;
    case 'accept-week': for (let i = 0; i < 7; i++) suggestionsOn(addDays(viewWeek, i)).forEach(confirmSugg); save(); render(); toast('All faded shifts this week confirmed.'); break;
    case 'repeat-week': {
      for (let i = 0; i < 7; i++) {
        const src = addDays(viewWeek, i), dst = addDays(viewWeek, i + 7);
        S.blocks = S.blocks.filter(b => b.date !== dst);
        blocksOn(src).forEach(b => S.blocks.push({ ...b, id: uid(), date: dst }));
      }
      save(); render(); toast('Copied this week to next week.'); break;
    }
    case 'sugg-no': { const s = findSugg(id); if (s) S.dismissed.push(s.key); save(); render(); toast('Suggestion dismissed.'); break; }
    case 'pick': { const p = t.dataset.p; blk.people = blk.people.includes(p) ? blk.people.filter(x => x !== p) : [...blk.people, p]; save(); render(); openBlock(id); break; }
    case 'nudge': { const d = +t.dataset.d; if (t.dataset.edge === 'start') blk.start = Math.max(0, Math.min(blk.end - SNAP, blk.start + d)); else blk.end = Math.min(1440, Math.max(blk.start + SNAP, blk.end + d)); save(); render(); openBlock(id); break; }
    case 'block-done': if (!blk.people.length) { toast('Pick who is on duty first.'); break; } delete blk.isNew; closeSheet(); break;
    case 'block-del': S.blocks = S.blocks.filter(b => b.id !== id); closeSheet(); break;
    case 'cell-who': case 'cell-out': {
      const p = t.dataset.p, list = act === 'cell-who' ? 'who' : 'outs';
      cellDraft[list] = cellDraft[list].includes(p) ? cellDraft[list].filter(x => x !== p) : [...cellDraft[list], p];
      if (act === 'cell-out' && cellDraft.outs.includes(p)) cellDraft.who = cellDraft.who.filter(x => x !== p);
      if (act === 'cell-who' && cellDraft.who.includes(p)) cellDraft.outs = cellDraft.outs.filter(x => x !== p);
      openCell(cellDraft.date, PERIODS.find(x => x[1] === cellDraft.a)); break;
    }
    case 'cell-sugg': { const c = cellInfo(cellDraft.date, cellDraft.a, cellDraft.z); if (c.sugg) cellDraft.who = c.sugg.people.slice(); openCell(cellDraft.date, PERIODS.find(x => x[1] === cellDraft.a)); break; }
    case 'cell-save': case 'cell-clear': {
      const d = cellDraft, clear = act === 'cell-clear';
      setRange(d.date, d.a, d.z, clear ? [] : d.who);
      S.away = S.away.filter(x => !(x.date === d.date && x.start < d.z && d.a < x.end && (clear || !d.outs.includes(x.person))));
      if (!clear) d.outs.filter(p => !S.away.some(x => x.date === d.date && x.person === p && x.start <= d.a && d.z <= x.end)).forEach(p => S.away.push({ id: uid(), date: d.date, start: d.a, end: d.z, person: p }));
      if (clear) S.dismissed.push(...suggestionsOn(d.date).filter(s => s.start < d.z && d.a < s.end).map(s => s.key));
      save(); closeSheet(); render(); break;
    }
    case 'away': awayDraft = null; openAway(t.dataset.date); break;
    case 'away-who': { const p = t.dataset.p; awayDraft.who = awayDraft.who.includes(p) ? awayDraft.who.filter(x => x !== p) : [...awayDraft.who, p]; openAway(awayDraft.date); break; }
    case 'away-quick': {
      const v = t.dataset.v, m = Math.floor(nowMin() / SNAP) * SNAP;
      if (v === 'rest') { awayDraft.start = m; awayDraft.end = 1440; }
      else if (v.includes(',')) { const [a, z] = v.split(',').map(Number); awayDraft.start = a; awayDraft.end = z; }
      else { awayDraft.start = m; awayDraft.end = Math.min(1440, m + +v); }
      openAway(awayDraft.date); break;
    }
    case 'away-nudge': { const d = +t.dataset.d; if (t.dataset.edge === 'start') awayDraft.start = Math.max(0, Math.min(awayDraft.end - SNAP, awayDraft.start + d)); else awayDraft.end = Math.min(1440, Math.max(awayDraft.start + SNAP, awayDraft.end + d)); openAway(awayDraft.date); break; }
    case 'away-save': {
      const d = awayDraft;
      if (!d.who.length) { toast('Pick who can\'t first.'); break; }
      setAwayRange(d.date, d.start, d.end, d.who);
      save(); closeSheet(); render();
      const left = available(d.date, d.start);
      toast(`Got it: not ${namesOf(d.who)}, ${fmtMin(d.start)} to ${fmtEnd(d.end)}. ${left.length ? `Alerts go to ${namesOf(onDutyAt(d.start, d.date).length ? onDutyAt(d.start, d.date) : left)}.` : ''}`);
      if (S.alert) S.alert.to = S.alert.to.filter(x => !d.who.includes(x) || !isAway(x));
      if (S.alert && !S.alert.to.length) passOn('cant', null);
      break;
    }
    case 'away-del': S.away = S.away.filter(x => x.id !== id); save(); render(); openAway(awayDraft ? awayDraft.date : today()); break;
    case 'cover': {
      const p = t.dataset.p, td = today(), m = nowMin();
      const ends = awayOn(td).filter(x => x.start <= m && m < x.end).map(x => x.end);
      setRange(td, Math.floor(m / SNAP) * SNAP, Math.min(...ends), [p]);
      save(); render(); toast(`${nameOf(p)} is covering now.`); break;
    }
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
      S.away = S.away.filter(x => x.person !== p);
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
    case 'reset': localStorage.removeItem(KEY); S = sampleState(); sensing = null; viewDay = today(); viewWeek = mondayOf(today()); save(); closeSheet(); tab = 'home'; render(); toast('Demo data reset.'); break;
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
