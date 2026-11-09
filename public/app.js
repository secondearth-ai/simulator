// Dot view: each dot is one persona, placed by what that persona did. People live in a pool, meet ads inside their own apps, and some come through.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CELL = 3, DOT = 2.4, TOP = 216, HOP = 7, HOURS_PER_SEC = 24, POOL_W = 282;
const WORD = { click: 'clicked ad', skip: 'skipped', next: 'moved on', store: 'tapped get app', leave: 'left', install: 'installed', annual: 'started annual trial', weekly: 'started weekly plan', free: 'stayed free', pay: 'paid', cancel: 'canceled', keep: 'kept plan', open: 'reopened', drop: 'stopped opening', paid_annual: 'annual plan paid', free_active: 'using it free' };
const STOP = new Set(['skip', 'leave', 'cancel', 'drop']);
const GOOD = new Set(['install', 'annual', 'weekly', 'pay', 'keep', 'paid_annual']);
const LOG = new Set(['click', 'leave', 'cancel', 'drop', 'install', 'annual', 'weekly', 'pay', 'paid_annual']);
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MOM = { commute_am: 'AM commute', commute_pm: 'PM commute', lunch: 'Lunch', work: 'Work', evening: 'Evening', morning: 'Morning', late: 'Late night', weekend: 'Weekend', out: 'Out' };
const GAUGES = [
  ['budget', 'Ad budget', 500, 50000, 500, v => `$${v.toLocaleString('en-US')}`], ['cpm', 'CPM', 2, 30, 0.5, v => `$${v}`], ['adSensitivity', 'Ad sensitivity', 0.3, 2, 0.05, v => `×${v.toFixed(2)}`],
  ['ctr', 'Click rate', 0.2, 5, 0.1, v => `${v}%`], ['clickToInstall', 'Click to install', 5, 70, 1, v => `${v}%`], ['onboardingDone', 'Onboarding done', 20, 95, 1, v => `${v}%`],
  ['firstResult', 'First result reached', 10, 90, 1, v => `${v}%`], ['paywallConvert', 'Paywall conversion', 0.5, 25, 0.5, v => `${v}%`], ['priceSensitivity', 'Price sensitivity', 0.5, 2, 0.05, v => `×${v.toFixed(2)}`],
  ['priceAnnual', 'Annual price', 19.99, 299.99, 5, v => `$${v.toFixed(2)}`], ['priceWeekly', 'Weekly price', 0.99, 29.99, 0.5, v => `$${v.toFixed(2)}`], ['elasticity', 'Price elasticity', 0, 3, 0.1, v => `${v.toFixed(1)}`],
  ['annualShare', 'Annual share', 0, 100, 5, v => `${v}%`], ['trialToPaid', 'Trial to paid', 5, 80, 1, v => `${v}%`], ['weeklyRenew', 'Weekly renewal', 10, 90, 1, v => `${v}%`], ['revisit', 'Revisits', 0, 2, 0.05, v => `×${v.toFixed(2)}`],
];
let D, raw = [], agents = [], cols = [], rows = [], events = [], g = {}, mode = 'pure', selected = null, panelView = 'calc', split = '';
let speed = 1, t = 0, tEnd = 720, last = 0, playing = true, W = 0, H = 0, logIdx = 0, statTick = 0, dotsReady = false;
const view = { x: 0, y: 0, k: 1 };
let follow = null, person = null, dayShown = 0, drag = null;
const filter = { country: '', age: '', moment: '' };
const canvas = $('c'), ctx = canvas.getContext('2d');
const hash = n => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const matches = a => (!filter.country || a.country === filter.country) && (!filter.moment || a.moment === filter.moment) && (!filter.age || (a.age >= +filter.age.split('-')[0] && a.age <= +filter.age.split('-')[1]));
const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const band = a => (a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 55 ? '45-54' : '55+');
const isPayer = a => a.v.some(v => v.a === 'weekly' || (v.a === 'pay' && v.plan === 'annual'));
const SPLITS = {
  creative: a => (a.st === 'ad' ? `Ad ${a.src.toUpperCase()}` : 'Organic'), country: a => (a.country === 'KR' ? 'Korea' : 'US'), age: a => band(a.age),
  sector: a => a.sector, moment: a => MOM[a.moment] || a.moment, outcome: a => (isPayer(a) ? 'Paid' : a.v.some(v => v.a === 'install') ? 'Installed only' : 'Not installed'),
};

const defaults = () => ({ priceAnnual: D.cfg.prices.annual, priceWeekly: D.cfg.prices.weekly, elasticity: 1, ...D.cfg.defaults });
async function boot() {
  D = await (await fetch('/api/run')).json();
  raw = D.agents; g = defaults();
  $('runInfo').textContent = `${D.cfg.product} · ${raw.length.toLocaleString('en-US')} agents · ${D.cfg.days} days`;
  $('fMoment').innerHTML = '<option value="">All</option>' + Object.entries(MOM).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  rebuild(); fit(); renderPanel(); loadReport(); initPeople();
  requestAnimationFrame(frame);
}

function rebuild() {
  cols = [{ type: 'pool', id: 'pool', title: 'User pool and ads' }, ...D.cfg.stages.map(s => ({ type: 'stage', ...s }))];
  const colOf = Object.fromEntries(cols.map((c, i) => [c.id, i]));
  const list = mode === 'cal' ? Calc.calibrate(raw, g).agents : raw;
  const keyOf = split ? SPLITS[split] : () => 'All';
  const rowMap = new Map();
  agents = list.map(a => {
    const key = keyOf(a);
    if (!rowMap.has(key)) rowMap.set(key, { key, n: 0, cells: cols.map(() => ({ reach: 0, out: 0 })) });
    const row = rowMap.get(key);
    a.row = row; a.pool = row.n++;
    let prev = -1; a.path = [];
    a.v.forEach((v, i) => {
      const col = v.s === 'ad' ? 0 : colOf[v.s];
      if (col === undefined) return;
      const arr = prev < 0 ? v.t + 1 : Math.max(v.t, prev + HOP);
      const dep = arr + 3 + hash(a.id * 31 + i) * 6;
      a.path.push({ col, v, i, arr, dep, slot: 0, out: -1 });
      prev = dep;
    });
    return a;
  });
  rows = [...rowMap.values()];
  if (split === 'age') rows.sort((a, b) => a.key.localeCompare(b.key)); else rows.sort((a, b) => b.n - a.n);
  tEnd = D.cfg.days * 24;
  for (const row of rows) cols.forEach((c, ci) => {
    if (!ci) return;
    const here = agents.filter(a => a.row === row).flatMap(a => a.path.filter(p => p.col === ci).map(p => ({ a, p }))).sort((x, y) => x.p.arr - y.p.arr);
    here.forEach((h, i) => { h.p.slot = i; });
    const out = here.filter(h => STOP.has(h.p.v.a)).sort((x, y) => x.p.dep - y.p.dep);
    out.forEach((h, i) => { h.p.out = i; });
    row.cells[ci] = { reach: here.length, out: out.length };
  });
  events = agents.flatMap(a => a.path.filter(p => LOG.has(p.v.a)).map(p => ({ time: p.dep, a, p }))).sort((x, y) => x.time - y.time);
  layout(); syncLog();
}

function layout() {
  const r = $('stage').getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!r.width) return;
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const margin = 12, gap = 10, base = Math.max(W, 1040);
  const cw = (base - margin * 2 - gap * (cols.length - 1) - POOL_W) / (cols.length - 1);
  let x = margin;
  cols.forEach((c, i) => { c.x = x; c.w = i ? cw : POOL_W; c.perRow = Math.floor(c.w / CELL); x += c.w + gap; });
  let y = TOP;
  for (const row of rows) {
    row.y = y;
    const poolH = Math.ceil(row.n / cols[0].perRow) * CELL + 18;
    let hMax = poolH;
    cols.forEach((c, ci) => {
      if (!ci) return;
      const cell = row.cells[ci];
      cell.reachY = y + 16;
      cell.outY = cell.reachY + Math.ceil(cell.reach / c.perRow) * CELL + 20;
      hMax = Math.max(hMax, cell.outY - y + Math.ceil(cell.out / c.perRow) * CELL + 6);
    });
    y += hMax + (split ? 16 : 0);
  }
  worldH = y; worldW = x;
  renderCols(); dotsReady = true;
}
let worldH = 0, worldW = 0;
function fit() { const usable = H - 142; view.k = Math.min(1.6, Math.max(0.3, Math.min(W / worldW, usable / worldH))); view.x = (W - worldW * view.k) / 2 > 0 ? 0 : 0; view.y = 0; follow = null; }
function zoomAt(px, py, f) { const k = Math.max(0.3, Math.min(30, view.k * f)); view.x = px - (px - view.x) * (k / view.k); view.y = py - (py - view.y) * (k / view.k); view.k = k; }
function focusCol(i) { const c = cols[i]; view.k = Math.min(4, W / (c.w + 24)); view.x = (W - c.w * view.k) / 2 - c.x * view.k; view.y = -(TOP - 14) * view.k; }

const cardXY = (a, cr) => { const i = D.creatives.findIndex(c => c.id === cr), cw = 66, gapc = 6; return [cols[0].x + i * (cw + gapc) + 4 + hash(a.id * 3) * (cw - 8), 22 + 6 + hash(a.id * 5) * 100]; };
const poolXY = a => { const c = cols[0]; return [c.x + (a.pool % c.perRow) * CELL, a.row.y + 16 + Math.floor(a.pool / c.perRow) * CELL]; };
const reachXY = (a, p) => { const c = cols[p.col], cell = a.row.cells[p.col]; return [c.x + (p.slot % c.perRow) * CELL, cell.reachY + Math.floor(p.slot / c.perRow) * CELL]; };
const outXY = (a, p) => { const c = cols[p.col], cell = a.row.cells[p.col]; return [c.x + (p.out % c.perRow) * CELL, cell.outY + Math.floor(p.out / c.perRow) * CELL]; };
const posOf = (a, p) => (p.col === 0 ? cardXY(a, p.v.cr) : reachXY(a, p));
const ease = x => (x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const mix = (p, q, k) => { const e = ease(Math.min(1, Math.max(0, k))); return [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e]; };
function after(a, p) { return p.col === 0 ? poolXY(a) : p.out >= 0 ? outXY(a, p) : posOf(a, p); }

function place(a, tt) {
  const path = a.path;
  if (!path.length || tt < path[0].arr - HOP) return { xy: poolXY(a), s: 'pool' };
  for (let i = 0; i < path.length; i++) {
    const p = path[i], nx = path[i + 1], here = posOf(a, p);
    if (tt < p.arr) { const from = i ? (STOP.has(path[i - 1].v.a) ? after(a, path[i - 1]) : posOf(a, path[i - 1])) : poolXY(a); return { xy: mix(from, here, 1 - (p.arr - tt) / HOP), s: 'live' }; }
    if (tt < p.dep) return { xy: here, s: p.col === 0 ? 'seeing' : 'live' };
    const out = (tt - p.dep) / HOP;
    if (nx && tt < nx.arr - HOP) {
      if (p.col === 0) return { xy: out < 1 ? mix(here, poolXY(a), out) : poolXY(a), s: 'seen' };
      if (p.out >= 0) return { xy: out < 1 ? mix(here, outXY(a, p), out) : outXY(a, p), s: 'wait' };
      return { xy: here, s: 'live' };
    }
    if (!nx) {
      if (p.col === 0) return { xy: out < 1 ? mix(here, poolXY(a), out) : poolXY(a), s: STOP.has(p.v.a) ? 'gone' : 'live' };
      if (p.out >= 0) return { xy: out < 1 ? mix(here, outXY(a, p), out) : outXY(a, p), s: 'leave' };
      return { xy: here, s: GOOD.has(p.v.a) ? 'paid' : 'live' };
    }
  }
  return { xy: posOf(a, path[path.length - 1]), s: 'live' };
}

function draw() {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
  const bins = { trace: [], dim: [], pool: [], seen: [], seeing: [], live: [], wait: [], leave: [], gone: [], paid: [] };
  for (const a of agents) {
    const m = matches(a);
    if (m) for (const p of a.path) if (p.col > 0 && t >= p.dep) { const q = reachXY(a, p); bins.trace.push(q[0], q[1]); }
    const { xy, s } = place(a, t);
    (m ? bins[s] : bins.dim).push(xy[0], xy[1]);
  }
  const fill = (arr, color) => { ctx.fillStyle = color; for (let i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i], arr[i + 1], DOT, DOT); };
  fill(bins.trace, '#2f3a46'); fill(bins.dim, '#171b20'); fill(bins.pool, '#3d4854'); fill(bins.seen, '#71808f'); fill(bins.gone, '#6a332e');
  fill(bins.leave, '#ff6a5c'); fill(bins.wait, '#e8a33d'); fill(bins.seeing, '#ffffff'); fill(bins.live, '#c3d2e0'); fill(bins.paid, '#5fe08f');
  const sel = selected && agents.find(x => x.id === selected.id);
  if (sel && sel.path.length) {
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1 / view.k; ctx.beginPath();
    const pts = [poolXY(sel), ...sel.path.map(p => posOf(sel, p))];
    const lp = sel.path[sel.path.length - 1]; if (lp.out >= 0) pts.push(outXY(sel, lp)); else if (lp.col === 0) pts.push(poolXY(sel));
    pts.forEach((q, i) => { if (i) ctx.lineTo(q[0] + 1, q[1] + 1); else ctx.moveTo(q[0] + 1, q[1] + 1); });
    ctx.stroke();
    const { xy } = place(sel, t), r = 5 / view.k;
    ctx.lineWidth = 1.5 / view.k; ctx.strokeRect(xy[0] + 1.2 - r, xy[1] + 1.2 - r, r * 2, r * 2);
  }
}

// What is under the pointer: a live dot or a trace it left behind.
function hit(px, py) {
  const x = (px - view.x) / view.k, y = (py - view.y) / view.k, lim = Math.max(2.5, 7 / view.k) ** 2;
  let best = null, bd = lim;
  const test = (q, a, p) => { const d = (q[0] + 1.2 - x) ** 2 + (q[1] + 1.2 - y) ** 2; if (d < bd) { bd = d; best = { a, p }; } };
  for (const a of agents) {
    if (!matches(a)) continue;
    const { xy } = place(a, t);
    const now = a.path.find(p => t >= p.arr - HOP && t < p.dep) || a.path[a.path.length - 1];
    test(xy, a, now);
    for (const p of a.path) if (p.col > 0 && t >= p.dep) test(reachXY(a, p), a, p);
  }
  return best;
}

function allStats() {
  const s = cols.map(() => ({ seen: new Set(), out: 0, good: 0 })), imp = {}, clk = {};
  for (const a of agents) {
    if (!matches(a)) continue;
    for (const p of a.path) {
      if (t < p.arr) continue;
      if (p.col === 0) { imp[p.v.cr] = (imp[p.v.cr] || 0) + 1; if (p.v.a === 'click') clk[p.v.cr] = (clk[p.v.cr] || 0) + 1; }
      s[p.col].seen.add(a.id);
      if (GOOD.has(p.v.a) && t >= p.dep) s[p.col].good++;
    }
    const lp = a.path[a.path.length - 1];
    if (lp && t >= lp.dep && STOP.has(lp.v.a)) s[lp.col].out++;
  }
  return { s, imp, clk };
}
function renderCols() {
  let html = '';
  const c0 = cols[0];
  html += `<div class="col" style="left:${c0.x}px;width:${c0.w}px"><h3>${c0.title}</h3><div class="cards">${D.creatives.map(c => `<div class="card"><img src="/creatives/${c.id}-en.jpg" alt="${esc(c.en.hook)}" data-zoom="/creatives/${c.id}-en.jpg"><small id="cr_${c.id}"></small></div>`).join('')}</div></div>`;
  cols.forEach((c, i) => {
    if (i) html += `<div class="col" style="left:${c.x}px;width:${c.w}px"><h3 data-focus="${i}" title="Zoom to this column">${c.title}</h3>${c.image ? `<img class="thumb" src="/screens/en/${c.id}.jpg" alt="${c.title}" data-zoom="/screens/en/${c.id}.jpg">` : ''}<div class="n" id="st${i}"></div><button class="list" data-col="${i}">Who left</button></div>`;
  });
  for (const row of rows) {
    html += `<div class="lab rowlab" style="left:${c0.x}px;top:${row.y}px">${split ? `<b>${esc(row.key)}</b> ` : 'User pool '}${row.n.toLocaleString('en-US')} people</div>`;
    cols.forEach((c, i) => {
      if (!i) return; const cell = row.cells[i];
      html += `<div class="lab" style="left:${c.x}px;top:${cell.reachY - 13}px">Reached ${cell.reach.toLocaleString('en-US')}</div><div class="lab x" style="left:${c.x}px;top:${cell.outY - 13}px">Left ${cell.out.toLocaleString('en-US')}</div>`;
    });
  }
  $('cols').innerHTML = html;
  stats();
}
function stats() {
  const { s, imp, clk } = allStats();
  cols.forEach((c, i) => {
    const el = $('st' + i); if (!el) return;
    const reach = s[i].seen.size, rate = reach ? Math.round(s[i].out / reach * 100) : 0;
    el.innerHTML = `Reached <b>${reach.toLocaleString('en-US')}</b><br>Left <span class="x">${s[i].out.toLocaleString('en-US')}</span> ${rate}%${s[i].good ? `<br>Done <span class="i">${s[i].good.toLocaleString('en-US')}</span>` : ''}`;
  });
  for (const c of D.creatives) { const el = $('cr_' + c.id); if (el) el.innerHTML = `${c.id.toUpperCase()} views ${(imp[c.id] || 0).toLocaleString('en-US')}<br><span class="i">${(clk[c.id] || 0).toLocaleString('en-US')}</span> clk ${imp[c.id] ? ((clk[c.id] || 0) / imp[c.id] * 100).toFixed(1) : 0}%`; }
}

function logLine(e) {
  const v = e.p.v, cl = STOP.has(v.a) ? 'x' : (GOOD.has(v.a) || v.a === 'click') ? 'i' : '';
  const d = Math.floor(v.t / 24);
  const name = e.p.col === 0 ? `${v.app} ad, view ${v.seen || 1}` : cols[e.p.col].title;
  return `<div data-agent="${e.a.id}"><span class="t">D${String(d).padStart(2, '0')} ${hhmm(v.t % 24)}</span> #${String(e.a.id).padStart(5, '0')} ${esc(e.a.name)} · ${esc(v.ctx || '')} · ${esc(name)} <span class="${cl}">${WORD[v.a] || v.a}</span>${v.rev ? ' <span class="w">revisit</span>' : ''} "${esc(v.tag)}"</div>`;
}
function syncLog() {
  logIdx = 0; while (logIdx < events.length && events[logIdx].time <= t) logIdx++;
  const shown = []; for (let i = logIdx - 1; i >= 0 && shown.length < 5; i--) if (matches(events[i].a)) shown.unshift(logLine(events[i]));
  $('log').innerHTML = shown.join('');
}
function pushLog() {
  let added = false; const log = $('log');
  while (logIdx < events.length && events[logIdx].time <= t) { const e = events[logIdx++]; if (matches(e.a)) { log.insertAdjacentHTML('beforeend', logLine(e)); added = true; } }
  if (added) while (log.children.length > 5) log.firstChild.remove();
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
  if (playing && t < tEnd) {
    let rate = speed * HOURS_PER_SEC;
    if (follow) { // slow near this person's moments, fast across empty days
      const nx = follow.path.find(p => p.dep > t);
      const gapH = nx ? nx.arr - HOP - t : 999;
      rate = gapH > 10 ? 72 : 5;
      if (!nx) playing = false;
    }
    t = Math.min(tEnd, t + dt * rate);
  }
  if (dotsReady && !$('sim').hidden) {
    if (follow) {
      const { xy } = place(follow, t), tk = 5;
      view.k += (tk - view.k) * 0.1;
      view.x += (W * 0.5 - xy[0] * view.k - view.x) * 0.14;
      view.y += ((H - 142) * 0.5 - xy[1] * view.k - view.y) * 0.14;
    }
    $('cols').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    draw(); pushLog();
    if (now - statTick > 220) {
      stats(); statTick = now; $('scrub').value = t;
      $('clock').textContent = `D${Math.floor(t / 24)} ${hhmm(t % 24)}`;
      $('play').textContent = t >= tEnd ? 'Replay' : playing ? 'Pause' : 'Play';
      if (panelView === 'agent' && follow && person) { const d = Math.floor(t / 24); if (d !== dayShown) renderDay(d); else markNow(); }
    }
  }
  requestAnimationFrame(frame);
}

// Calculator
function fmt$(v) { if (!isFinite(v) || v === 0) return '-'; const s = v < 0 ? '-' : '', x = Math.abs(v); return x >= 100 ? `${s}$${Math.round(x).toLocaleString('en-US')}` : `${s}$${x.toFixed(2)}`; }
const fmtN = v => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
function renderCalcResults() {
  const paid = raw.filter(a => a.st === 'ad');
  const f = Calc.finance(paid.filter(matches), paid, g, D.cfg.prices);
  const P = f.pure, C = f.cal, row = (l, a, b, cl = '') => `<tr class="${cl}"><td>${l}</td><td>${a}</td><td>${b}</td></tr>`;
  const adsRows = D.creatives.map(c => {
    const r = Calc.finance(paid.filter(a => a.src === c.id && matches(a)), paid, g, D.cfg.prices);
    return `<div class="ads"><img src="/creatives/${c.id}-en.jpg" alt="" data-zoom="/creatives/${c.id}-en.jpg"><div><em>${c.id.toUpperCase()} ${esc(c.en.hook)}</em><small>Clicks per view ${(r.pure.rates.ctr * 100).toFixed(1)}% · ${r.counts.annualPaid + r.counts.weekly} paid</small></div><div>${fmt$(r.cal.cpi)}<br><small>CPI</small></div><div>${r.cal.roasD30.toFixed(2)}<br><small>ROAS</small></div></div>`;
  }).join('');
  $('calcOut').innerHTML = `<table class="money"><tr><th></th><th>Pure</th><th>Calibrated</th></tr>
    ${row('Views', fmtN(P.impressions), fmtN(C.impressions))}${row('Average views per person', f.counts.freq.toFixed(1), '-')}${row('Clicks per view', (P.rates.ctr * 100).toFixed(1) + '%', (C.rates.ctr * 100).toFixed(2) + '%')}${row('Installs', fmtN(P.installs), fmtN(C.installs))}${row('Payers', fmtN(P.payers), fmtN(C.payers))}
    ${row('CPI', fmt$(P.cpi), fmt$(C.cpi), 'big')}${row('Cost per payer', fmt$(P.cac), fmt$(C.cac))}${row('7-day ROAS', P.roasD7.toFixed(2), C.roasD7.toFixed(2))}${row('30-day ROAS', P.roasD30.toFixed(2), C.roasD30.toFixed(2), 'big')}${row('30-day revenue', fmt$(P.revD30), fmt$(C.revD30), 'big')}${row('Revenue per payer', fmt$(P.arppu), fmt$(C.arppu))}${row('30-day profit', fmt$(P.revD30 - g.budget), fmt$(C.revD30 - g.budget))}</table>
    <p class="note">Calibrated range ±20%: ROAS ${(C.roasD30 * .8).toFixed(2)} to ${(C.roasD30 * 1.2).toFixed(2)}. The gauges and price elasticity are placeholder assumptions.</p><h4>Ads compared (CPI and ROAS are calibrated)</h4>${adsRows}`;
}
function renderPanel() {
  panelView = 'calc'; selected = null; person = null; follow = null; $('followBtn').hidden = true;
  $('panel').innerHTML = `<h2>Ad and revenue calculator</h2><p class="sub">Pure is what the AI personas did. Calibrated is fitted to the values below. Changing a filter recalculates for that audience.</p>
    ${GAUGES.map(([k, l, min, max, step, f]) => `<label class="gauge"><span>${l}</span><input type="range" data-g="${k}" min="${min}" max="${max}" step="${step}" value="${g[k]}"><output id="o_${k}">${f(g[k])}</output></label>`).join('')}
    <button id="resetG" style="margin-top:6px">Reset to defaults</button><h4>Results</h4><div id="calcOut"></div>`;
  renderCalcResults();
}
const STAGE_IMG = (a, v) => (v.s === 'ad' ? `/creatives/${v.cr}-en.jpg` : ['landing', 'pricing', 'store', 'onboarding', 'result', 'paywall'].includes(v.s) ? `/screens/en/${v.s}.jpg` : null);
const stageName = s => (s === 'ad' ? 'Ad' : (D.cfg.stages.find(x => x.id === s) || {}).title || s);

function profileHtml(p) {
  const list = x => `<div class="tags">${(x || []).map(i => `<span>${esc(i)}</span>`).join('')}</div>`;
  return `<dl class="kv"><dt>Workplace</dt><dd>${esc(p.workplace)}</dd><dt>Household</dt><dd>${esc(p.household)}</dd><dt>Income</dt><dd>${esc(p.incomeMonthly)} · Free to spend: ${esc(p.disposableMonthly)}</dd><dt>Commute</dt><dd>${esc(p.commute?.mode)}, ${esc(p.commute?.minutes)} min · leaves at ${hhmm(p.commute?.leave)} · heads back at ${hhmm(p.commute?.back)}</dd><dt>Weekdays</dt><dd>${esc(p.weekday)}</dd><dt>Weekends</dt><dd>${esc(p.weekend)}</dd><dt>Phone time</dt><dd>${(p.phoneHours || []).map(hhmm).join(' · ')}</dd><dt>Apps</dt><dd>${list(p.apps)}</dd><dt>Subscriptions</dt><dd>${list((p.subscriptions || []).map(s => `${s.name} ${s.monthly}`))}</dd><dt>Channels</dt><dd>${list(p.media)}</dd><dt>Likes</dt><dd>${esc(p.likes)}</dd><dt>Brands</dt><dd>${list(p.brands)}</dd><dt>Recent buy</dt><dd>${esc(p.recentBuy)}</dd><dt>Regretted buy</dt><dd>${esc(p.regret)}</dd><dt>Current goal</dt><dd>${esc(p.goal)}</dd><dt>Stress</dt><dd>${esc(p.stress)}</dd><dt>View of ads</dt><dd>${esc(p.adView)}</dd><dt>Voice</dt><dd>${esc(p.voice)}<br>"${esc(p.quote)}"</dd></dl>
  <div class="meters">${[['Patience', p.patience], ['Price sensitive', p.priceSensitivity], ['Privacy', p.privacyConcern], ['Tech comfort', p.techComfort], ['Ad sensitive', p.adSensitivity], ['Impulse', p.impulse]].map(([l, v]) => `<div><span>${l}</span>${v}</div>`).join('')}</div>`;
}

async function panelAgent(id, atVisit) {
  const a = raw.find(x => x.id === id);
  selected = a; panelView = 'agent'; follow = null;
  $('panel').innerHTML = '<p class="dim">Loading</p>';
  const { persona: p } = await (await fetch(`/api/agent?id=${id}`)).json();
  person = p;
  const ads = a.v.filter(v => v.s === 'ad'), clickAt = ads.find(v => v.a === 'click');
  const inst = a.v.find(v => v.a === 'install'), pay = isPayer(a);
  const start = atVisit != null ? a.v[atVisit] : a.v[0];
  $('panel').innerHTML = `<div class="ptop"><button class="back" data-back>← Calculator</button><button id="followIt" class="primary">Follow this person</button></div>
  <h2>#${String(a.id).padStart(5, '0')} ${esc(p.name)}</h2><p class="sub">${p.age}, ${esc(p.gender)} · ${esc(p.job)} · ${esc(p.city)}</p>
  <p class="sum">${a.st === 'ad' ? `Saw the ad ${ads.length} time${ads.length === 1 ? '' : 's'}${clickAt ? `, clicked on view ${clickAt.seen || ads.indexOf(clickAt) + 1}` : ', never clicked'}` : `Organic (${esc(a.src)})`}${inst ? ` → installed D${Math.floor(inst.t / 24)}` : ''}${pay ? ' → <b class="i">paid</b>' : ''}</p>
  <div id="month"></div><div id="dayHead"></div><div id="dayList"></div>
  <details class="prof"><summary>Full profile</summary>${profileHtml(p)}</details>`;
  renderDay(Math.floor((start ? start.t : 0) / 24));
  $('panel').scrollTop = 0;
}
function renderMonth(day) {
  const a = selected;
  const mark = d => { const vs = a.v.filter(v => Math.floor(v.t / 24) === d); if (!vs.length) return ''; if (vs.some(v => GOOD.has(v.a) || v.a === 'click')) return 'g'; if (vs.some(v => STOP.has(v.a) && v.s !== 'ad')) return 'x'; return 's'; };
  $('month').innerHTML = `<div class="month">${Array.from({ length: D.cfg.days }, (_, d) => `<button data-day="${d}" class="${mark(d)} ${d === day ? 'cur' : ''}" title="D${d} ${WD[d % 7]}">${d}</button>`).join('')}</div>`;
}
function renderDay(day) {
  if (!person) return;
  dayShown = Math.max(0, Math.min(D.cfg.days - 1, day));
  const a = selected, p = person, d = dayShown;
  renderMonth(d);
  const plan = Life.plan(p, d);
  const items = [];
  plan.segments.forEach(s => { if (s.kind !== 'sleep' || s.from > 0) items.push({ h: s.from, type: 'seg', s }); });
  const adTimes = a.v.filter(v => v.s === 'ad' && Math.floor(v.t / 24) === d).map(v => v.t % 24);
  plan.sessions.forEach(s => { if (!adTimes.some(x => Math.abs(x - s.h) < 0.01)) items.push({ h: s.h, type: 'use', s }); });
  const inst = a.v.find(v => v.a === 'install'), lastV = a.v[a.v.length - 1];
  if (inst) { const end = ['paid_annual', 'free_active', 'keep'].includes(lastV.a) ? D.cfg.days * 24 : lastV.t; Life.productUse(p, d, inst.t, end, D.cfg.product).forEach(s => items.push({ h: s.h, type: 'use', s })); }
  a.v.forEach((v, i) => { if (Math.floor(v.t / 24) === d) items.push({ h: v.t % 24, type: 'act', v, i }); });
  items.sort((x, y) => x.h - y.h);
  $('dayHead').innerHTML = `<div class="dayhead"><button data-day="${d - 1}" ${d ? '' : 'disabled'}>◀</button><b>D${d} ${WD[d % 7]}</b><button data-day="${d + 1}" ${d < D.cfg.days - 1 ? '' : 'disabled'}>▶</button><button id="dayStory">This day's story</button></div><div id="story"></div>`;
  $('dayList').innerHTML = items.map(it => {
    if (it.type === 'seg') return `<div class="tl seg k-${it.s.kind}" data-h="${it.h}"><time>${hhmm(it.h)}</time><span>${esc(it.s.label)}</span></div>`;
    if (it.type === 'use') return `<div class="tl use ${it.s.product ? 'prod' : ''}" data-h="${it.h}"><time>${hhmm(it.h)}</time><span>${esc(it.s.app)} ${it.s.min} min</span></div>`;
    const v = it.v, img = STAGE_IMG(a, v);
    return `<div class="tl act" data-h="${it.h}"><time>${hhmm(it.h)}</time><div>${img ? `<img src="${img}" alt="" data-zoom="${img}">` : ''}<div class="dim">${v.s === 'ad' ? `${esc(v.app || '')} ad, view ${v.seen || ''}` : esc(stageName(v.s))}${v.rev ? ' · revisit' : ''}</div><div class="a ${STOP.has(v.a) ? 'stop' : GOOD.has(v.a) || v.a === 'click' ? 'good' : ''}">${WORD[v.a] || v.a} <small>likelihood ${v.p}</small></div><div class="dim">${esc(v.tag)}</div><button class="think" data-think="${it.i}">See their thoughts</button><div id="th${it.i}"></div></div></div>`;
  }).join('');
  markNow();
}
function markNow() {
  const list = $('dayList'); if (!list) return;
  const nowH = t % 24, curDay = Math.floor(t / 24);
  let cur = null;
  list.querySelectorAll('.tl').forEach(el => { el.classList.remove('now'); if (curDay === dayShown && +el.dataset.h <= nowH) cur = el; });
  if (cur) { cur.classList.add('now'); if (follow) { const pn = $('panel'), top = cur.offsetTop - pn.clientHeight / 2; if (Math.abs(pn.scrollTop - top) > 60) pn.scrollTop = top; } }
}
function startFollow() {
  const a = agents.find(x => x.id === selected.id); if (!a || !a.path.length) return;
  follow = a; t = Math.max(0, a.path[0].arr - HOP - 8); syncLog(); playing = true;
  $('followBtn').hidden = false; $('followName').textContent = a.name; renderDay(Math.floor(t / 24));
}
function panelList(ci) {
  panelView = 'list'; selected = null; follow = null;
  const c = cols[ci];
  const rowsL = raw.filter(a => matches(a) && a.v.length && a.v[a.v.length - 1].s === c.id && STOP.has(a.v[a.v.length - 1].a));
  $('panel').innerHTML = `<button class="back" data-back>← Calculator</button><h2>${rowsL.length.toLocaleString('en-US')} left at ${esc(c.title)}</h2><p class="sub">Click a name to see that person's day and thoughts.</p>` + rowsL.slice(0, 300).map(a => `<button class="row" data-agent="${a.id}">${esc(a.name)} · ${a.age}<small>${esc(a.job)}</small><em>${esc(a.v[a.v.length - 1].tag)}</em></button>`).join('') + (rowsL.length > 300 ? '<p class="note">Showing the first 300 people.</p>' : '');
  $('panel').scrollTop = 0;
}
async function loadThought(i, btn) {
  btn.disabled = true; btn.textContent = 'Generating';
  const box = $('th' + i);
  try {
    const r = await fetch(`/api/thought?id=${selected.id}&i=${i}`), j = await r.json();
    if (!r.ok) throw new Error(j.error);
    box.innerHTML = `<p class="thought">${esc(j.text)}</p>`; btn.remove();
  } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; box.innerHTML = `<p class="dim">Could not generate: ${esc(e.message)}</p>`; }
}
async function loadStory(btn) {
  btn.disabled = true; btn.textContent = 'Writing';
  const r = await fetch(`/api/day?id=${selected.id}&day=${dayShown}`), j = await r.json();
  $('story').innerHTML = r.ok ? `<p class="thought">${esc(j.text)}</p>` : `<p class="dim">Could not generate: ${esc(j.error)}</p>`;
  btn.remove();
}

// People tab
let pOffset = 0;
function initPeople() {
  $('setName').textContent = `Set: ${D.set.name}, ${D.set.count.toLocaleString('en-US')} people`;
  $('setNote').textContent = `A reusable set, built without reference to any product. ${D.set.note}`;
  ['pCountry', 'pAge', 'pGender', 'pSector'].forEach(id => { $(id).onchange = () => loadPeople(true); });
  let tm; $('pQ').oninput = () => { clearTimeout(tm); tm = setTimeout(() => loadPeople(true), 220); };
  $('pMore').onclick = () => loadPeople(false);
  loadPeople(true, true);
}
async function loadPeople(reset, first) {
  pOffset = reset ? 0 : pOffset + 80;
  const q = new URLSearchParams({ q: $('pQ').value, country: $('pCountry').value, age: $('pAge').value, gender: $('pGender').value, sector: $('pSector').value, offset: pOffset });
  const d = await (await fetch(`/api/people?${q}`)).json();
  const s = d.stats;
  $('pCount').textContent = `${s.n.toLocaleString('en-US')} people`;
  if (first) $('pSector').innerHTML += s.sector.map(([k]) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  const box = (title, arr) => { const mx = Math.max(1, ...arr.map(x => x[1])); return `<div><h4>${title}</h4>${arr.map(([k, v]) => `<div class="bar1"><span title="${esc(k)}">${esc(k)}</span><i style="width:${v / mx * 100}%"></i><small>${v.toLocaleString('en-US')}</small></div>`).join('')}</div>`; };
  $('dist').innerHTML = box('Age', s.age) + box('Sector', s.sector) + box('Top apps', s.apps) + box('Top subscriptions', s.subs);
  const tr = d.rows.map(p => `<tr data-person="${p.id}"><td>${esc(p.name)}</td><td>${p.age} ${esc(p.gender)}</td><td>${esc(p.city)}</td><td>${esc(p.job)}</td><td>${esc(p.disposable)}</td><td>${esc(p.apps.join(', '))}</td></tr>`).join('');
  if (reset) $('pTable').innerHTML = `<thead><tr><th>Name</th><th>Age</th><th>Lives in</th><th>Job</th><th>Free to spend</th><th>Apps</th></tr></thead><tbody>${tr}</tbody>`;
  else $('pTable').querySelector('tbody').insertAdjacentHTML('beforeend', tr);
}
async function openPerson(id) {
  const { persona: p, walk: w } = await (await fetch(`/api/agent?id=${id}`)).json();
  $('sheetBody').innerHTML = `<button class="back" data-close>Close</button><h2 style="margin:0;font-size:18px">${esc(p.name)}</h2><p class="sub">${p.age}, ${esc(p.gender)} · ${esc(p.job)} · ${esc(p.city)}</p>${profileHtml(p)}${w ? `<button data-agent="${id}">See this person's 30 days</button>` : ''}`;
  $('sheet').hidden = false;
}
async function loadReport() { const r = await (await fetch('/api/report')).json(); $('doc').innerHTML = r.html || '<p class="empty">No report has been generated for this run yet.</p>'; }

// Pointer
const stageEl = $('stage');
stageEl.addEventListener('wheel', e => {
  if (e.target.closest('.log, .timeline')) return;
  e.preventDefault();
  const b = stageEl.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.2) { follow = null; zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * 0.0022)); }
  else { view.x -= e.deltaX; }
}, { passive: false });
canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; });
addEventListener('mousemove', e => {
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; follow = null; } if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; } return; }
  if (e.target !== canvas) { $('tip').hidden = true; return; }
  const b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top), tip = $('tip');
  canvas.style.cursor = h ? 'pointer' : 'grab';
  if (!h) { tip.hidden = true; return; }
  const v = h.p ? h.p.v : null;
  tip.innerHTML = `<b>${esc(h.a.name)}</b> ${h.a.age} · ${esc(String(h.a.job).slice(0, 28))}${v ? `<br>${v.s === 'ad' ? `${esc(v.app || '')} ad` : esc(stageName(v.s))}: <span class="${STOP.has(v.a) ? 'x' : 'i'}">${WORD[v.a] || v.a}</span> "${esc(v.tag)}"` : ''}`;
  tip.hidden = false; tip.style.left = Math.min(e.clientX + 12, innerWidth - 300) + 'px'; tip.style.top = e.clientY + 14 + 'px';
});
addEventListener('mouseup', e => {
  if (!drag) return; const moved = drag.moved; drag = null;
  if (moved || e.target !== canvas) return;
  const b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top);
  if (h) panelAgent(h.a.id, h.p ? h.p.i : null);
});
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]');
  if (z) { $('zoom').querySelector('img').src = z.dataset.zoom; $('zoom').hidden = false; return; }
  if (e.target.closest('#zoom')) { $('zoom').hidden = true; return; }
  if (e.target.closest('[data-close]')) { $('sheet').hidden = true; return; }
  if (e.target.closest('[data-back]')) { renderPanel(); return; }
  if (e.target.id === 'resetG') { g = defaults(); renderPanel(); if (mode === 'cal') rebuild(); return; }
  if (e.target.id === 'followIt') { startFollow(); return; }
  if (e.target.id === 'stopFollow') { follow = null; $('followBtn').hidden = true; fit(); return; }
  if (e.target.id === 'dayStory') { loadStory(e.target); return; }
  const dy = e.target.closest('[data-day]'); if (dy) { const d = +dy.dataset.day; renderDay(d); t = d * 24 + 7; playing = false; syncLog(); stats(); return; }
  const fc = e.target.closest('[data-focus]'); if (fc) { follow = null; focusCol(+fc.dataset.focus); return; }
  const l = e.target.closest('[data-col]'); if (l) { panelList(+l.dataset.col); return; }
  const r = e.target.closest('[data-agent]'); if (r) { $('sheet').hidden = true; showTab('sim'); if (t < 1) t = tEnd; syncLog(); panelAgent(+r.dataset.agent); return; }
  const pr = e.target.closest('[data-person]'); if (pr) { openPerson(+pr.dataset.person); return; }
  const th = e.target.closest('[data-think]'); if (th) { loadThought(+th.dataset.think, th); return; }
  const tb = e.target.closest('[data-tab]'); if (tb) showTab(tb.dataset.tab);
});
let calTimer;
document.addEventListener('input', e => {
  const k = e.target.dataset?.g; if (!k) return;
  g[k] = Number(e.target.value);
  $('o_' + k).textContent = GAUGES.find(x => x[0] === k)[5](g[k]);
  renderCalcResults();
  if (mode === 'cal') { clearTimeout(calTimer); calTimer = setTimeout(rebuild, 180); }
});
function showTab(n) { ['sim', 'people', 'report'].forEach(v => { $(v).hidden = v !== n; }); document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n)); $('filters').style.visibility = n === 'sim' ? '' : 'hidden'; if (n === 'sim') layout(); }
$('play').onclick = () => { if (t >= tEnd) { t = 0; syncLog(); playing = true; } else playing = !playing; };
$('speed').onclick = e => { speed = speed === 1 ? 3 : speed === 3 ? 0.4 : 1; e.target.textContent = speed + 'x'; };
$('scrub').oninput = e => { t = Number(e.target.value); playing = false; syncLog(); stats(); $('clock').textContent = `D${Math.floor(t / 24)} ${hhmm(t % 24)}`; if (panelView === 'agent') markNow(); };
$('zIn').onclick = () => zoomAt(W / 2, (H - 142) / 2, 1.5);
$('zOut').onclick = () => zoomAt(W / 2, (H - 142) / 2, 1 / 1.5);
$('zFit').onclick = fit;
$('fSplit').onchange = e => { split = e.target.value; rebuild(); fit(); };
const setFilter = () => { filter.country = $('fCountry').value; filter.age = $('fAge').value; filter.moment = $('fMoment').value; stats(); syncLog(); if (panelView === 'calc') renderCalcResults(); };
['fCountry', 'fAge', 'fMoment'].forEach(id => { $(id).onchange = setFilter; });
function setMode(m) { mode = m; $('mPure').classList.toggle('on', m === 'pure'); $('mCal').classList.toggle('on', m === 'cal'); rebuild(); }
$('mPure').onclick = () => setMode('pure');
$('mCal').onclick = () => setMode('cal');
addEventListener('resize', () => { if (!$('sim').hidden) layout(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { $('zoom').hidden = true; follow = null; $('followBtn').hidden = true; } });
boot();
