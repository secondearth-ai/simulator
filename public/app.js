// Dot view: each dot is one persona, placed by what that persona did. People live in a pool, meet ads inside their own apps, and some come through.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CELL = 3, DOT = 2.4, TOP = 216, HOP = 7, HOURS_PER_SEC = 24, POOL_W = 282;
const WORD = { click: '광고 클릭', skip: '넘김', next: '다음으로', store: '앱 받기', leave: '이탈', install: '설치', annual: '연간 체험 시작', weekly: '주간 구독', free: '무료로 사용', pay: '결제', cancel: '해지', keep: '구독 유지', open: '다시 열기', drop: '안 열기', paid_annual: '연간 결제 완료', free_active: '무료 사용 중' };
const STOP = new Set(['skip', 'leave', 'cancel', 'drop']);
const GOOD = new Set(['install', 'annual', 'weekly', 'pay', 'keep', 'paid_annual']);
const LOG = new Set(['click', 'leave', 'cancel', 'drop', 'install', 'annual', 'weekly', 'pay', 'paid_annual']);
const WD = ['월', '화', '수', '목', '금', '토', '일'];
const MOM = { commute_am: '출근길', commute_pm: '퇴근길', lunch: '점심', work: '일과 중', evening: '저녁', morning: '아침', late: '심야', weekend: '주말', out: '외출 중' };
const GAUGES = [
  ['budget', '광고 예산', 500, 50000, 500, v => `$${v.toLocaleString()}`], ['cpm', 'CPM', 2, 30, 0.5, v => `$${v}`], ['adSensitivity', '광고 민감도', 0.3, 2, 0.05, v => `×${v.toFixed(2)}`],
  ['ctr', '클릭률', 0.2, 5, 0.1, v => `${v}%`], ['clickToInstall', '클릭→설치', 5, 70, 1, v => `${v}%`], ['onboardingDone', '온보딩 완료', 20, 95, 1, v => `${v}%`],
  ['firstResult', '첫 결과 도달', 10, 90, 1, v => `${v}%`], ['paywallConvert', '페이월 전환', 0.5, 25, 0.5, v => `${v}%`], ['priceSensitivity', '가격 민감도', 0.5, 2, 0.05, v => `×${v.toFixed(2)}`],
  ['priceAnnual', '연간 요금', 19.99, 299.99, 5, v => `$${v.toFixed(2)}`], ['priceWeekly', '주간 요금', 0.99, 29.99, 0.5, v => `$${v.toFixed(2)}`], ['elasticity', '가격 탄력', 0, 3, 0.1, v => `${v.toFixed(1)}`],
  ['annualShare', '연간 비중', 0, 100, 5, v => `${v}%`], ['trialToPaid', '체험→결제', 5, 80, 1, v => `${v}%`], ['weeklyRenew', '주간 갱신', 10, 90, 1, v => `${v}%`], ['revisit', '재방문', 0, 2, 0.05, v => `×${v.toFixed(2)}`],
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
  creative: a => (a.st === 'ad' ? `소재 ${a.src.toUpperCase()}` : '자연 유입'), country: a => (a.country === 'KR' ? '한국' : '미국'), age: a => band(a.age),
  sector: a => a.sector, moment: a => MOM[a.moment] || a.moment, outcome: a => (isPayer(a) ? '결제' : a.v.some(v => v.a === 'install') ? '설치만' : '미설치'),
};

const defaults = () => ({ priceAnnual: D.cfg.prices.annual, priceWeekly: D.cfg.prices.weekly, elasticity: 1, ...D.cfg.defaults });
async function boot() {
  D = await (await fetch('/api/run')).json();
  raw = D.agents; g = defaults();
  $('runInfo').textContent = `${D.cfg.product} · ${raw.length.toLocaleString()} agents · ${D.cfg.days}일`;
  $('fMoment').innerHTML = '<option value="">전체</option>' + Object.entries(MOM).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  rebuild(); fit(); renderPanel(); loadReport(); initPeople();
  requestAnimationFrame(frame);
}

function rebuild() {
  cols = [{ type: 'pool', id: 'pool', title: '유저 풀·광고 소재' }, ...D.cfg.stages.map(s => ({ type: 'stage', ...s }))];
  const colOf = Object.fromEntries(cols.map((c, i) => [c.id, i]));
  const list = mode === 'cal' ? Calc.calibrate(raw, g).agents : raw;
  const keyOf = split ? SPLITS[split] : () => '전체';
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
  html += `<div class="col" style="left:${c0.x}px;width:${c0.w}px"><h3>${c0.title}</h3><div class="cards">${D.creatives.map(c => `<div class="card"><img src="/creatives/${c.id}-ko.jpg" alt="${esc(c.ko.hook)}" data-zoom="/creatives/${c.id}-ko.jpg"><small id="cr_${c.id}"></small></div>`).join('')}</div></div>`;
  cols.forEach((c, i) => {
    if (i) html += `<div class="col" style="left:${c.x}px;width:${c.w}px"><h3 data-focus="${i}" title="이 열로 확대">${c.title}</h3>${c.image ? `<img class="thumb" src="/screens/ko/${c.id}.jpg" alt="${c.title}" data-zoom="/screens/ko/${c.id}.jpg">` : ''}<div class="n" id="st${i}"></div><button class="list" data-col="${i}">명단</button></div>`;
  });
  for (const row of rows) {
    html += `<div class="lab rowlab" style="left:${c0.x}px;top:${row.y}px">${split ? `<b>${esc(row.key)}</b> ` : '유저 풀 '}${row.n.toLocaleString()}명</div>`;
    cols.forEach((c, i) => {
      if (!i) return; const cell = row.cells[i];
      html += `<div class="lab" style="left:${c.x}px;top:${cell.reachY - 13}px">도달 ${cell.reach.toLocaleString()}</div><div class="lab x" style="left:${c.x}px;top:${cell.outY - 13}px">이탈 ${cell.out.toLocaleString()}</div>`;
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
    el.innerHTML = `도달 <b>${reach.toLocaleString()}</b><br>이탈 <span class="x">${s[i].out.toLocaleString()}</span> ${rate}%${s[i].good ? `<br>완료 <span class="i">${s[i].good.toLocaleString()}</span>` : ''}`;
  });
  for (const c of D.creatives) { const el = $('cr_' + c.id); if (el) el.innerHTML = `${c.id.toUpperCase()} 노출 ${(imp[c.id] || 0).toLocaleString()}<br>클릭 <span class="i">${(clk[c.id] || 0).toLocaleString()}</span> ${imp[c.id] ? ((clk[c.id] || 0) / imp[c.id] * 100).toFixed(1) : 0}%`; }
}

function logLine(e) {
  const v = e.p.v, cl = STOP.has(v.a) ? 'x' : (GOOD.has(v.a) || v.a === 'click') ? 'i' : '';
  const d = Math.floor(v.t / 24);
  const name = e.p.col === 0 ? `${v.app} 광고 ${v.seen || 1}번째` : cols[e.p.col].title;
  return `<div data-agent="${e.a.id}"><span class="t">D${String(d).padStart(2, '0')} ${hhmm(v.t % 24)}</span> #${String(e.a.id).padStart(5, '0')} ${esc(e.a.name)} · ${esc(v.ctx || '')} · ${esc(name)} <span class="${cl}">${WORD[v.a] || v.a}</span>${v.rev ? ' <span class="w">재방문</span>' : ''} "${esc(v.tag)}"</div>`;
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
      $('play').textContent = t >= tEnd ? '다시 재생' : playing ? '일시정지' : '재생';
      if (panelView === 'agent' && follow && person) { const d = Math.floor(t / 24); if (d !== dayShown) renderDay(d); else markNow(); }
    }
  }
  requestAnimationFrame(frame);
}

// Calculator
function fmt$(v) { if (!isFinite(v) || v === 0) return '-'; const s = v < 0 ? '-' : '', x = Math.abs(v); return x >= 100 ? `${s}$${Math.round(x).toLocaleString()}` : `${s}$${x.toFixed(2)}`; }
const fmtN = v => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
function renderCalcResults() {
  const paid = raw.filter(a => a.st === 'ad');
  const f = Calc.finance(paid.filter(matches), paid, g, D.cfg.prices);
  const P = f.pure, C = f.cal, row = (l, a, b, cl = '') => `<tr class="${cl}"><td>${l}</td><td>${a}</td><td>${b}</td></tr>`;
  const adsRows = D.creatives.map(c => {
    const r = Calc.finance(paid.filter(a => a.src === c.id && matches(a)), paid, g, D.cfg.prices);
    return `<div class="ads"><img src="/creatives/${c.id}-ko.jpg" alt="" data-zoom="/creatives/${c.id}-ko.jpg"><div><em>${c.id.toUpperCase()} ${esc(c.ko.hook)}</em><small>노출당 클릭 ${(r.pure.rates.ctr * 100).toFixed(1)}% · 결제 ${r.counts.annualPaid + r.counts.weekly}명</small></div><div>${fmt$(r.cal.cpi)}<br><small>CPI</small></div><div>${r.cal.roasD30.toFixed(2)}<br><small>ROAS</small></div></div>`;
  }).join('');
  $('calcOut').innerHTML = `<table class="money"><tr><th></th><th>순수</th><th>보정</th></tr>
    ${row('노출', fmtN(P.impressions), fmtN(C.impressions))}${row('1인 평균 노출', f.counts.freq.toFixed(1) + '회', '-')}${row('노출당 클릭률', (P.rates.ctr * 100).toFixed(1) + '%', (C.rates.ctr * 100).toFixed(2) + '%')}${row('설치', fmtN(P.installs), fmtN(C.installs))}${row('결제자', fmtN(P.payers), fmtN(C.payers))}
    ${row('CPI', fmt$(P.cpi), fmt$(C.cpi), 'big')}${row('결제자당 비용', fmt$(P.cac), fmt$(C.cac))}${row('7일 ROAS', P.roasD7.toFixed(2), C.roasD7.toFixed(2))}${row('30일 ROAS', P.roasD30.toFixed(2), C.roasD30.toFixed(2), 'big')}${row('30일 매출', fmt$(P.revD30), fmt$(C.revD30), 'big')}${row('결제자당 매출', fmt$(P.arppu), fmt$(C.arppu))}${row('30일 순이익', fmt$(P.revD30 - g.budget), fmt$(C.revD30 - g.budget))}</table>
    <p class="note">보정 범위 ±20%: ROAS ${(C.roasD30 * .8).toFixed(2)}~${(C.roasD30 * 1.2).toFixed(2)}. 게이지와 가격 탄력은 임시 가정입니다.</p><h4>소재 비교 (CPI·ROAS는 보정 기준)</h4>${adsRows}`;
}
function renderPanel() {
  panelView = 'calc'; selected = null; person = null; follow = null; $('followBtn').hidden = true;
  $('panel').innerHTML = `<h2>광고·매출 계산기</h2><p class="sub">순수는 AI 행동 그대로, 보정은 아래 값에 맞춘 결과입니다. 필터를 바꾸면 그 타깃 기준으로 다시 계산합니다.</p>
    ${GAUGES.map(([k, l, min, max, step, f]) => `<label class="gauge"><span>${l}</span><input type="range" data-g="${k}" min="${min}" max="${max}" step="${step}" value="${g[k]}"><output id="o_${k}">${f(g[k])}</output></label>`).join('')}
    <button id="resetG" style="margin-top:6px">기본값으로</button><h4>결과</h4><div id="calcOut"></div>`;
  renderCalcResults();
}
const STAGE_IMG = (a, v) => (v.s === 'ad' ? `/creatives/${v.cr}-${a.lang}.jpg` : ['landing', 'pricing', 'store', 'onboarding', 'result', 'paywall'].includes(v.s) ? `/screens/${a.lang}/${v.s}.jpg` : null);
const stageName = s => (s === 'ad' ? '광고' : (D.cfg.stages.find(x => x.id === s) || {}).title || s);

function profileHtml(p) {
  const list = x => `<div class="tags">${(x || []).map(i => `<span>${esc(i)}</span>`).join('')}</div>`;
  return `<dl class="kv"><dt>직장</dt><dd>${esc(p.workplace)}</dd><dt>가족</dt><dd>${esc(p.household)}</dd><dt>소득</dt><dd>${esc(p.incomeMonthly)} · 자유 지출 ${esc(p.disposableMonthly)}</dd><dt>출퇴근</dt><dd>${esc(p.commute?.mode)} ${esc(p.commute?.minutes)}분 · ${esc(p.commute?.leave)}시 출발 · ${esc(p.commute?.back)}시 퇴근</dd><dt>평일</dt><dd>${esc(p.weekday)}</dd><dt>주말</dt><dd>${esc(p.weekend)}</dd><dt>폰 보는 때</dt><dd>${(p.phoneHours || []).map(h => `${h}시`).join(' · ')}</dd><dt>쓰는 앱</dt><dd>${list(p.apps)}</dd><dt>구독</dt><dd>${list((p.subscriptions || []).map(s => `${s.name} ${s.monthly}`))}</dd><dt>보는 채널</dt><dd>${list(p.media)}</dd><dt>좋아하는 것</dt><dd>${esc(p.likes)}</dd><dt>브랜드</dt><dd>${list(p.brands)}</dd><dt>최근 구매</dt><dd>${esc(p.recentBuy)}</dd><dt>후회한 소비</dt><dd>${esc(p.regret)}</dd><dt>요즘 목표</dt><dd>${esc(p.goal)}</dd><dt>스트레스</dt><dd>${esc(p.stress)}</dd><dt>광고 태도</dt><dd>${esc(p.adView)}</dd><dt>말투</dt><dd>${esc(p.voice)}<br>"${esc(p.quote)}"</dd></dl>
  <div class="meters">${[['인내심', p.patience], ['가격 민감', p.priceSensitivity], ['개인정보', p.privacyConcern], ['기술', p.techComfort], ['광고 민감', p.adSensitivity], ['충동구매', p.impulse]].map(([l, v]) => `<div><span>${l}</span>${v}</div>`).join('')}</div>`;
}

async function panelAgent(id, atVisit) {
  const a = raw.find(x => x.id === id);
  selected = a; panelView = 'agent'; follow = null;
  $('panel').innerHTML = '<p class="dim">불러오는 중</p>';
  const { persona: p } = await (await fetch(`/api/agent?id=${id}`)).json();
  person = p;
  const ads = a.v.filter(v => v.s === 'ad'), clickAt = ads.find(v => v.a === 'click');
  const inst = a.v.find(v => v.a === 'install'), pay = isPayer(a);
  const start = atVisit != null ? a.v[atVisit] : a.v[0];
  $('panel').innerHTML = `<div class="ptop"><button class="back" data-back>← 계산기</button><button id="followIt" class="primary">이 사람 따라가기</button></div>
  <h2>#${String(a.id).padStart(5, '0')} ${esc(p.name)}</h2><p class="sub">${p.age}세 ${p.gender} · ${esc(p.job)} · ${esc(p.city)}</p>
  <p class="sum">${a.st === 'ad' ? `광고 ${ads.length}번 노출${clickAt ? `, ${clickAt.seen || ads.indexOf(clickAt) + 1}번째에 클릭` : ', 끝내 안 누름'}` : `자연 유입 (${esc(a.src)})`}${inst ? ` → 설치 D${Math.floor(inst.t / 24)}` : ''}${pay ? ' → <b class="i">결제</b>' : ''}</p>
  <div id="month"></div><div id="dayHead"></div><div id="dayList"></div>
  <details class="prof"><summary>프로필 전체</summary>${profileHtml(p)}</details>`;
  renderDay(Math.floor((start ? start.t : 0) / 24));
  $('panel').scrollTop = 0;
}
function renderMonth(day) {
  const a = selected;
  const mark = d => { const vs = a.v.filter(v => Math.floor(v.t / 24) === d); if (!vs.length) return ''; if (vs.some(v => GOOD.has(v.a) || v.a === 'click')) return 'g'; if (vs.some(v => STOP.has(v.a) && v.s !== 'ad')) return 'x'; return 's'; };
  $('month').innerHTML = `<div class="month">${Array.from({ length: D.cfg.days }, (_, d) => `<button data-day="${d}" class="${mark(d)} ${d === day ? 'cur' : ''}" title="D${d} ${WD[d % 7]}요일">${d}</button>`).join('')}</div>`;
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
  $('dayHead').innerHTML = `<div class="dayhead"><button data-day="${d - 1}" ${d ? '' : 'disabled'}>◀</button><b>D${d} ${WD[d % 7]}요일</b><button data-day="${d + 1}" ${d < D.cfg.days - 1 ? '' : 'disabled'}>▶</button><button id="dayStory">이날 이야기</button></div><div id="story"></div>`;
  $('dayList').innerHTML = items.map(it => {
    if (it.type === 'seg') return `<div class="tl seg k-${it.s.kind}" data-h="${it.h}"><time>${hhmm(it.h)}</time><span>${esc(it.s.label)}</span></div>`;
    if (it.type === 'use') return `<div class="tl use ${it.s.product ? 'prod' : ''}" data-h="${it.h}"><time>${hhmm(it.h)}</time><span>${esc(it.s.app)} ${it.s.min}분</span></div>`;
    const v = it.v, img = STAGE_IMG(a, v);
    return `<div class="tl act" data-h="${it.h}"><time>${hhmm(it.h)}</time><div>${img ? `<img src="${img}" alt="" data-zoom="${img}">` : ''}<div class="dim">${v.s === 'ad' ? `${esc(v.app || '')} 광고 ${v.seen || ''}번째` : esc(stageName(v.s))}${v.rev ? ' · 재방문' : ''}</div><div class="a ${STOP.has(v.a) ? 'stop' : GOOD.has(v.a) || v.a === 'click' ? 'good' : ''}">${WORD[v.a] || v.a} <small>가능성 ${v.p}</small></div><div class="dim">${esc(v.tag)}</div><button class="think" data-think="${it.i}">생각 보기</button><div id="th${it.i}"></div></div></div>`;
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
  $('panel').innerHTML = `<button class="back" data-back>← 계산기</button><h2>${esc(c.title)} 이탈 ${rowsL.length.toLocaleString()}명</h2><p class="sub">이름을 누르면 그 사람의 하루와 생각을 볼 수 있습니다.</p>` + rowsL.slice(0, 300).map(a => `<button class="row" data-agent="${a.id}">${esc(a.name)} · ${a.age}세<small>${esc(a.job)}</small><em>${esc(a.v[a.v.length - 1].tag)}</em></button>`).join('') + (rowsL.length > 300 ? '<p class="note">처음 300명만 표시합니다.</p>' : '');
  $('panel').scrollTop = 0;
}
async function loadThought(i, btn) {
  btn.disabled = true; btn.textContent = '생각 생성 중';
  const box = $('th' + i);
  try {
    const r = await fetch(`/api/thought?id=${selected.id}&i=${i}`), j = await r.json();
    if (!r.ok) throw new Error(j.error);
    box.innerHTML = `<p class="thought">${esc(j.text)}</p>`; btn.remove();
  } catch (e) { btn.disabled = false; btn.textContent = '다시 시도'; box.innerHTML = `<p class="dim">생성 실패: ${esc(e.message)}</p>`; }
}
async function loadStory(btn) {
  btn.disabled = true; btn.textContent = '쓰는 중';
  const r = await fetch(`/api/day?id=${selected.id}&day=${dayShown}`), j = await r.json();
  $('story').innerHTML = r.ok ? `<p class="thought">${esc(j.text)}</p>` : `<p class="dim">생성 실패: ${esc(j.error)}</p>`;
  btn.remove();
}

// People tab
let pOffset = 0;
function initPeople() {
  $('setName').textContent = `세트: ${D.set.name} ${D.set.count.toLocaleString()}명`;
  $('setNote').textContent = `제품과 무관하게 만든 재사용 세트입니다. ${D.set.note}`;
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
  $('pCount').textContent = `${s.n.toLocaleString()}명`;
  if (first) $('pSector').innerHTML += s.sector.map(([k]) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  const box = (title, arr) => { const mx = Math.max(1, ...arr.map(x => x[1])); return `<div><h4>${title}</h4>${arr.map(([k, v]) => `<div class="bar1"><span title="${esc(k)}">${esc(k)}</span><i style="width:${v / mx * 100}%"></i><small>${v.toLocaleString()}</small></div>`).join('')}</div>`; };
  $('dist').innerHTML = box('나이', s.age) + box('분야', s.sector) + box('많이 쓰는 앱', s.apps) + box('많이 구독하는 서비스', s.subs);
  const tr = d.rows.map(p => `<tr data-person="${p.id}"><td>${esc(p.name)}</td><td>${p.age} ${p.gender}</td><td>${esc(p.city)}</td><td>${esc(p.job)}</td><td>${esc(p.disposable)}</td><td>${esc(p.apps.join(', '))}</td></tr>`).join('');
  if (reset) $('pTable').innerHTML = `<thead><tr><th>이름</th><th>나이</th><th>사는 곳</th><th>직무</th><th>자유 지출</th><th>쓰는 앱</th></tr></thead><tbody>${tr}</tbody>`;
  else $('pTable').querySelector('tbody').insertAdjacentHTML('beforeend', tr);
}
async function openPerson(id) {
  const { persona: p, walk: w } = await (await fetch(`/api/agent?id=${id}`)).json();
  $('sheetBody').innerHTML = `<button class="back" data-close>닫기</button><h2 style="margin:0;font-size:18px">${esc(p.name)}</h2><p class="sub">${p.age}세 ${p.gender} · ${esc(p.job)} · ${esc(p.city)}</p>${profileHtml(p)}${w ? `<button data-agent="${id}">이 사람의 30일 보기</button>` : ''}`;
  $('sheet').hidden = false;
}
async function loadReport() { const r = await (await fetch('/api/report')).json(); $('doc').innerHTML = r.html || '<p class="empty">보고서가 아직 생성되지 않았습니다.</p>'; }

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
  tip.innerHTML = `<b>${esc(h.a.name)}</b> ${h.a.age}세 · ${esc(String(h.a.job).slice(0, 28))}${v ? `<br>${v.s === 'ad' ? `${esc(v.app || '')} 광고` : esc(stageName(v.s))}: <span class="${STOP.has(v.a) ? 'x' : 'i'}">${WORD[v.a] || v.a}</span> "${esc(v.tag)}"` : ''}`;
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
