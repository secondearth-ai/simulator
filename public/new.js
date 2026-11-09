// The "new simulation" wizard, then the live run scenario. Everything shown during a run comes from the server's job state.
const $ = id => document.getElementById(id);
const wiz = $('wiz');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Estimates. Decision rate and people per run come from the brief; the set rate is what kr-us-10k actually cost.
const DECISION_COST = 0.03 / 1000, DECISIONS_PER_PERSON = 3.5, SET_COST_PER_PERSON = 0.00075, ADS_COST = 0.03, REPORT_COST = 0.1;
const STEPS = ['Product', 'Screens', 'Pricing', 'Personas', 'Ads', 'Run'];
const S = {
  step: 0, draft: null, product: '', concept: '', url: '', shots: 1, screens: [],
  prices: { weekly: '', annual: '', trialDays: 3, storeCut: 15, free: true },
  mode: 'reuse', set: '', countries: [], ageMin: 18, ageMax: 99, sectors: [], text: '', count: 200, matched: null,
  newId: '', newCount: 200, newBrief: '', newCountries: ['KR', 'US'],
  adMode: 'auto', adItems: [], budget: 5000, key: '', model: '', report: true,
};
let CONF = { kinds: {}, serverKey: false, model: '', maxPeople: 2000 }, SETS = [], SET_INFO = null, RUNS = [], err = '', busy = '';

const crumbs = () => `<div class="crumbs">${STEPS.map((t, i) => `<button data-go="${i}" class="${i === S.step ? 'on' : ''}" ${i > S.step ? 'disabled' : ''}>${i + 1}. ${t}</button>`).join('')}</div>`;
const nav = last => `<p class="err" role="alert">${esc(err)}</p><p class="wait">${esc(busy)}</p><div class="nav">${S.step ? '<button data-back>Back</button>' : '<span></span>'}${last ? '<button class="primary" data-start>Start</button>' : '<button class="primary" data-next>Next</button>'}</div>`;

function estimate() {
  const n = S.mode === 'new' ? Math.min(Number(S.count) || 0, Number(S.newCount) || 0) : (S.matched == null ? Number(S.count) || 0 : Math.min(Number(S.count) || 0, S.matched));
  const sim = n * DECISIONS_PER_PERSON * DECISION_COST;
  const set = S.mode === 'new' ? (Number(S.newCount) || 0) * SET_COST_PER_PERSON : 0;
  const ads = S.adMode === 'auto' ? ADS_COST : 0, rep = S.report ? REPORT_COST : 0;
  return { n, sim, set, ads, rep, total: sim + set + ads + rep };
}
const usd = v => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
const costBox = () => {
  const e = estimate();
  return `<div class="box cost" id="cost"><b>Estimate ${usd(e.total)}</b> <span class="dim">(an estimate; the real cost will differ)</span><br><span class="dim">Decisions: ${e.n.toLocaleString('en-US')} people × about ${DECISIONS_PER_PERSON} × about $0.03 per 1,000 = ${usd(e.sim)}${e.set ? ` · creating the set ${usd(e.set)}` : ''}${e.ads ? ` · creating ads about ${usd(e.ads)}` : ''}${e.rep ? ` · report about ${usd(e.rep)}` : ''}</span></div>`;
};
const refreshCost = () => { const c = $('cost'); if (c) c.outerHTML = costBox(); };

const VIEW = [
  () => `<h1>Product</h1><p class="dim">Write the name and concept, then bring in screens. Enter a web page, App Store or Play Store address and it is captured at phone size.</p>
    <label class="f"><span>Product name</span><input type="text" data-bind="product" value="${esc(S.product)}"></label>
    <label class="f"><span>Concept (ad copy and the report use only the facts written here)</span><textarea data-bind="concept" rows="4">${esc(S.concept)}</textarea></label>
    <h2>Bring in screens</h2>
    <div class="inline"><input type="url" data-bind="url" value="${esc(S.url)}" placeholder="https://… or play.google.com/store/apps/details?id=…" aria-label="Address to capture">
      <label class="dim">Shots <select data-bind="shots">${[1, 2, 3, 4].map(n => `<option ${+S.shots === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button data-capture>Capture</button></div>
    <p class="note">You can capture several addresses one after another. Store addresses are filed as app store screens automatically.</p>
    <label class="f" style="margin-top:12px"><span>Or upload screenshots (several allowed; PNG, JPG, WEBP)</span><input type="file" id="files" accept="image/png,image/jpeg,image/webp" multiple></label>
    <p><b>${S.screens.length}</b> so far</p>
    ${RUNS.length ? `<h2>Past runs</h2><div class="tableScroll"><table class="runs"><tr><th>Product</th><th>Run id</th><th>People</th><th>Status</th></tr>${RUNS.map(r => `<tr><td><a href="/?run=${encodeURIComponent(r.id)}">${esc(r.product)}</a></td><td>${esc(r.id)}</td><td>${r.people.toLocaleString('en-US')}</td><td class="dim">${esc({ done: 'Done', running: 'Running', failed: 'Failed', cancelled: 'Canceled', interrupted: 'Interrupted', empty: 'No results' }[r.status] || r.status)}</td></tr>`).join('')}</table></div>` : ''}${nav()}`,

  () => `<h1>Screens</h1><p class="dim">Put them in the order people see them. The real-world baseline is a sentence also given to the AI, and it can be left empty.</p>
    ${S.screens.map((s, i) => `<div class="scr" data-i="${i}"><div class="no">${i + 1}</div><div><img src="/draft/${S.draft}/${s.id}-en.jpg" alt="${esc(s.name)}" data-zoom="/draft/${S.draft}/${s.id}-en.jpg"><div class="ctl"><button data-up aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button data-down aria-label="Move down" ${i < S.screens.length - 1 ? '' : 'disabled'}>↓</button><button data-del aria-label="Delete">Delete</button></div></div>
      <div><div class="grid2"><label class="f"><span>Name</span><input type="text" data-s="name" value="${esc(s.name)}"></label>
      <label class="f"><span>Kind</span><select data-s="kind">${Object.entries(CONF.kinds).map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label></div>
      <label class="f"><span>Real-world baseline (optional)</span><textarea data-s="baseline" rows="2">${esc(s.baseline)}</textarea></label></div></div>`).join('') || '<p class="empty">No screens yet. Bring some in on the previous step.</p>'}
    <p class="note">The funnel runs web → store or sign-up → app → paywall. A missing step is judged from the product description, with no screen.</p>${nav()}`,

  () => `<h1>Pricing</h1><p class="dim">In US dollars. Leave out any price you do not use. Only weekly and annual plans are calculated today.</p>
    <div class="grid2"><label class="f"><span>Weekly price ($)</span><input type="number" min="0" step="0.01" data-bind="prices.weekly" value="${esc(S.prices.weekly)}"></label>
    <label class="f"><span>Annual price ($)</span><input type="number" min="0" step="0.01" data-bind="prices.annual" value="${esc(S.prices.annual)}"></label>
    <label class="f"><span>Annual free trial (days, 0 if none)</span><input type="number" min="0" step="1" data-bind="prices.trialDays" value="${esc(S.prices.trialDays)}"></label>
    <label class="f"><span>Store fee (%)</span><input type="number" min="0" max="50" step="1" data-bind="prices.storeCut" value="${esc(S.prices.storeCut)}"></label></div>
    <label><input type="checkbox" data-check="prices.free" ${S.prices.free ? 'checked' : ''}> People can close the paywall and keep using it free</label>${nav()}`,

  () => `<h1>Personas</h1>
    <p class="inline"><label><input type="radio" name="pm" data-mode="reuse" ${S.mode === 'reuse' ? 'checked' : ''}> Reuse a set</label> <label><input type="radio" name="pm" data-mode="new" ${S.mode === 'new' ? 'checked' : ''}> Create a new set</label></p>
    ${S.mode === 'reuse' ? `
      <label class="f"><span>Set</span><select data-bind="set">${SETS.map(x => `<option value="${esc(x.id)}" ${S.set === x.id ? 'selected' : ''}>${esc(x.id)} · ${esc(x.name)} · ${Number(x.count).toLocaleString('en-US')} people</option>`).join('')}</select></label>
      <h2>Audience filters</h2>
      <div class="f"><span class="dim">Country</span><div class="chips">${chips('countries', [['KR', 'Korea'], ['US', 'US']])}</div></div>
      <div class="grid2"><label class="f"><span>Minimum age</span><input type="number" min="0" data-bind="ageMin" value="${esc(S.ageMin)}"></label><label class="f"><span>Maximum age</span><input type="number" min="0" data-bind="ageMax" value="${esc(S.ageMax)}"></label></div>
      <div class="f"><span class="dim">Sector</span><div class="chips" id="sectorChips">${chips('sectors', (SET_INFO?.sectors || []).map(x => [x, x]))}</div></div>
      <label class="f"><span>Free text (words to find in job, tastes and apps, separated by spaces; any match counts)</span><input type="text" data-bind="text" value="${esc(S.text)}" placeholder="e.g. meetings lectures Notion"></label>
      <p><b id="matched">${S.matched == null ? '…' : S.matched.toLocaleString('en-US')}</b> people match</p>` : `
      <div class="grid2"><label class="f"><span>Set id (letters, numbers, - and _)</span><input type="text" data-bind="newId" value="${esc(S.newId)}"></label><label class="f"><span>People to create</span><input type="number" min="1" max="${CONF.maxPeople}" data-bind="newCount" value="${esc(S.newCount)}"></label></div>
      <div class="f"><span class="dim">Country</span><div class="chips">${chips('newCountries', [['KR', 'Korea'], ['US', 'US']])}</div></div>
      <label class="f"><span>Who to recruit (free text)</span><textarea data-bind="newBrief" rows="2" placeholder="e.g. office workers with many meetings, and grad students">${esc(S.newBrief)}</textarea></label>
      <p class="note">You pay to create a set once, and later runs can reuse it.</p>`}
    <label class="f"><span>People in this run: <b id="countOut">${Number(S.count).toLocaleString('en-US')}</b></span><input type="range" data-bind="count" min="20" max="${CONF.maxPeople}" step="10" value="${esc(S.count)}" id="countRange"></label>
    ${costBox()}${nav()}`,

  () => `<h1>Ads</h1>
    <p class="inline"><label><input type="radio" name="am" data-admode="auto" ${S.adMode === 'auto' ? 'checked' : ''}> Generate ads automatically (4)</label> <label><input type="radio" name="am" data-admode="upload" ${S.adMode === 'upload' ? 'checked' : ''}> Upload ad images</label></p>
    ${S.adMode === 'upload' ? `<label class="f"><span>Ad images (cropped to vertical 9:16)</span><input type="file" id="adFiles" accept="image/png,image/jpeg,image/webp" multiple></label>
      <div class="ads2">${S.adItems.map((a, i) => `<div><img src="/draft/${S.draft}/${a.id}-en.jpg" alt="${esc(a.name)}"><input type="text" data-ad="${i}" value="${esc(a.name)}" aria-label="Ad name" style="width:100%"><button data-addel="${i}" style="margin-top:4px">Delete</button></div>`).join('')}</div>` : '<p class="dim">Korean and English ads are made from the concept and screens.</p>'}
    <label class="f" style="margin-top:12px"><span>Ad budget ($)</span><input type="number" min="1" data-bind="budget" value="${esc(S.budget)}"></label>${nav()}`,

  () => `<h1>Run</h1>
    <label class="f"><span>OpenRouter key ${CONF.serverKey ? '(leave empty to use the server key)' : '(required)'}</span><input type="password" autocomplete="off" spellcheck="false" data-bind="key" value="${esc(S.key)}" placeholder="sk-or-…"></label>
    <p class="note">The key is used only in this run's memory and is never written to files, logs or responses. If the server has no key of its own, "See their thoughts" will not work later for a run started this way.</p>
    <details style="margin:12px 0"><summary class="dim" style="cursor:pointer">Advanced options</summary>
      <label class="f" style="margin-top:8px"><span>Decision model (OpenRouter model name; empty means ${esc(CONF.model)})</span><input type="text" data-bind="model" value="${esc(S.model)}" placeholder="${esc(CONF.model)}" spellcheck="false"></label>
      <p class="note">The cost estimate assumes the default model. Ad copy and report text use a separate model.</p></details>
    <label><input type="checkbox" data-check="report" ${S.report ? 'checked' : ''}> Also make a report when it finishes</label>
    ${costBox()}
    <p class="dim">This is a simulation of fictional people. It is for finding what to test next, not a revenue forecast.</p>${nav(true)}`,
];
function chips(field, opts) { return opts.map(([v, l]) => `<label class="${S[field].includes(v) ? 'on' : ''}"><input type="checkbox" data-chip="${field}" value="${esc(v)}" ${S[field].includes(v) ? 'checked' : ''}>${esc(l)}</label>`).join(''); }
function render() { wiz.innerHTML = crumbs() + VIEW[S.step](); wiz.parentElement.scrollTop = 0; }

const setPath = (path, v) => { const k = path.split('.'); let o = S; while (k.length > 1) o = o[k.shift()]; o[k[0]] = v; };
let matchTimer;
function refreshMatched() {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(async () => {
    if (!S.set) return;
    const q = new URLSearchParams({ set: S.set, ageMin: S.ageMin, ageMax: S.ageMax, text: S.text });
    S.countries.forEach(c => q.append('country', c)); S.sectors.forEach(c => q.append('sector', c));
    try { S.matched = (await api(`/api/audience?${q}`)).matched; } catch { return; }
    if ($('matched')) $('matched').textContent = S.matched.toLocaleString('en-US');
    refreshCost();
  }, 250);
}
async function chooseSet(id) { S.set = id; SET_INFO = null; S.sectors = []; S.matched = null; try { SET_INFO = await api(`/api/set?id=${encodeURIComponent(id)}`); } catch (e) { err = e.message; } if (S.step === 3) render(); refreshMatched(); }

wiz.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.bind) {
    setPath(t.dataset.bind, t.value);
    if (t.dataset.bind === 'count' && $('countOut')) $('countOut').textContent = Number(t.value).toLocaleString('en-US');
    if (t.dataset.bind === 'set') chooseSet(t.value);
    else if (['ageMin', 'ageMax', 'text'].includes(t.dataset.bind)) refreshMatched();
    if (['count', 'newCount'].includes(t.dataset.bind)) refreshCost();
  }
  if (t.dataset.s) {
    const s = S.screens[Number(t.closest('.scr').dataset.i)];
    if (t.dataset.s === 'kind') { const old = CONF.kinds[s.kind]?.baseline; if (s.baseline === old) s.baseline = CONF.kinds[t.value].baseline; s.kind = t.value; render(); return; }
    s[t.dataset.s] = t.value;
  }
  if (t.dataset.ad !== undefined) S.adItems[Number(t.dataset.ad)].name = t.value;
});
wiz.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.check) { setPath(t.dataset.check, t.checked); refreshCost(); }
  if (t.dataset.chip) { const a = S[t.dataset.chip], i = a.indexOf(t.value); if (t.checked && i < 0) a.push(t.value); if (!t.checked && i >= 0) a.splice(i, 1); t.parentElement.classList.toggle('on', t.checked); refreshMatched(); }
  if (t.dataset.mode) { S.mode = t.dataset.mode; render(); }
  if (t.dataset.admode) { S.adMode = t.dataset.admode; render(); }
  if (t.id === 'files' || t.id === 'adFiles') await upload([...t.files], t.id === 'adFiles' ? 'creative' : 'screen');
});
async function ensureDraft() { if (!S.draft) S.draft = (await post('/api/draft', {})).draft; }
const addScreen = (id, name, kind) => S.screens.push({ id, name, kind, baseline: CONF.kinds[kind]?.baseline || '' });
async function work(label, fn) { err = ''; busy = label; render(); try { await fn(); } catch (e) { err = e.message; } busy = ''; render(); }
function upload(files, kind) {
  return work('Uploading images…', async () => {
    await ensureDraft();
    for (const f of files) {
      const { id } = await api(`/api/upload?draft=${S.draft}&kind=${kind}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const name = f.name.replace(/\.[^.]+$/, '').slice(0, 30);
      if (kind === 'creative') S.adItems.push({ id, name }); else addScreen(id, name, S.screens.length ? 'app' : 'onboarding');
    }
  });
}
wiz.addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.zoom) { $('zoom').querySelector('img').src = t.dataset.zoom; $('zoom').hidden = false; return; }
  if (t.dataset.go !== undefined && !t.disabled) { err = ''; S.step = Number(t.dataset.go); render(); return; }
  if (t.hasAttribute('data-back')) { err = ''; S.step--; render(); return; }
  if (t.hasAttribute('data-next')) { const bad = validate(); err = bad || ''; if (!bad) S.step++; render(); return; }
  if (t.hasAttribute('data-capture')) {
    if (!S.url.trim()) { err = 'Please enter an address.'; render(); return; }
    return work('Capturing. This takes about 30 seconds on some sites…', async () => {
      await ensureDraft();
      const { screens } = await post('/api/capture', { draft: S.draft, url: S.url.trim(), shots: S.shots });
      screens.forEach(s => addScreen(s.id, s.name, s.kind));
      S.url = '';
    });
  }
  const row = t.closest?.('.scr');
  if (row) {
    const i = Number(row.dataset.i), a = S.screens;
    if (t.hasAttribute('data-up')) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; render(); }
    if (t.hasAttribute('data-down')) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; render(); }
    if (t.hasAttribute('data-del')) { a.splice(i, 1); render(); }
  }
  if (t.dataset.addel !== undefined) { S.adItems.splice(Number(t.dataset.addel), 1); render(); }
  if (t.hasAttribute('data-start')) return launch();
});
$('zoom').addEventListener('click', () => { $('zoom').hidden = true; });

function validate() {
  if (S.step === 0) { if (!S.product.trim()) return 'Please enter a product name.'; if (!S.concept.trim()) return 'Please describe the concept.'; if (!S.screens.length) return 'Please bring in at least one screen.'; }
  if (S.step === 1 && !S.screens.length) return 'Please keep at least one screen.';
  if (S.step === 2 && !(Number(S.prices.weekly) > 0 || Number(S.prices.annual) > 0)) return 'Please enter a weekly or annual price.';
  if (S.step === 3) {
    if (S.mode === 'new' && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(S.newId)) return 'A set id can use letters, numbers, - and _ only.';
    if (S.mode === 'reuse' && S.matched === 0) return 'Nobody matches. Please loosen the filters.';
  }
  if (S.step === 4 && S.adMode === 'upload' && !S.adItems.length) return 'Please upload at least one ad image.';
  return '';
}

async function launch() {
  if (!S.key.trim() && !CONF.serverKey) { err = 'Please enter an OpenRouter key.'; render(); return; }
  err = ''; busy = 'Starting…'; render();
  try {
    const job = await post('/api/start', {
      draft: S.draft, product: S.product, concept: S.concept, screens: S.screens, prices: S.prices, report: S.report, key: S.key, model: S.model,
      persona: S.mode === 'new'
        ? { count: S.count, newSet: { id: S.newId, count: S.newCount, name: S.newId, brief: S.newBrief, countries: S.newCountries } }
        : { set: S.set, count: S.count, filters: { countries: S.countries, sectors: S.sectors, ageMin: S.ageMin, ageMax: S.ageMax, text: S.text } },
      ads: { mode: S.adMode, items: S.adItems, budget: S.budget },
    });
    S.key = '';
    busy = '';
    history.replaceState(null, '', `?job=${encodeURIComponent(job.id)}`);
    scenario(job.id);
  } catch (e) { busy = ''; err = e.message; render(); }
}

// ---------- live scenario ----------
const SCENE = { screens: 'Reading product screens', people: 'Personas', ads: 'Generating ads', sim: 'Simulation', report: 'Report' };
let J = null, stop = null;
const passed = name => J.status === 'done' || J.steps.indexOf(J.step) > J.steps.indexOf(name);
const reached = name => J.status === 'done' || J.steps.indexOf(J.step) >= J.steps.indexOf(name);
const dead = () => ['failed', 'cancelled', 'interrupted'].includes(J.status);
async function until(fn) { while (!fn()) { if (dead()) throw new Error('stopped'); await sleep(200); } }

function section(name, body) {
  const el = document.createElement('section');
  el.className = 'box'; el.dataset.scene = name;
  el.innerHTML = `<h2 style="margin:0 0 8px"><span class="st wait">In progress</span> ${esc(SCENE[name])}</h2>${body}`;
  $('scenes').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}
const finishSection = (el, text) => { const s = el.querySelector('.st'); s.textContent = text || 'Done'; s.className = 'st'; s.style.color = 'var(--install)'; };

async function poll(id) {
  while (!stop) {
    try { J = await api(`/api/job?id=${encodeURIComponent(id)}`); } catch { await sleep(1500); continue; }
    $('totalCost').textContent = `Actual cost so far $${J.cost.toFixed(4)}`;
    if (J.status !== 'running') { $('cancel').hidden = true; if (dead()) showStop(); return; }
    await sleep(700);
  }
}
function showStop() {
  $('stopMsg').textContent = J.status === 'cancelled' ? 'The run was canceled.' : J.status === 'interrupted' ? 'The server restarted, so the run was cut off.' : `The run failed. ${J.error || ''}`;
}

async function sceneScreens() {
  const el = section('screens', '<div class="ads2" id="scrCards"></div>');
  const box = el.querySelector('#scrCards');
  for (const s of J.screens) {
    const d = document.createElement('div');
    d.innerHTML = `<img src="/screens/en/${encodeURIComponent(s.id)}.jpg?run=${encodeURIComponent(J.id)}" alt="${esc(s.title)}" style="aspect-ratio:auto;height:150px;object-fit:cover;object-position:top"><small>${esc(s.title)}</small>`;
    box.appendChild(d);
    await sleep(350);
  }
  finishSection(el, `Read ${J.screens.length}`);
}
async function scenePeople() {
  await until(() => reached('people'));
  const el = section('people', `<p class="dim" id="pplHead" style="margin:0 0 6px">${J.newSet ? 'Creating new people' : 'Loading people from the set'}</p><div id="dots" style="display:flex;flex-wrap:wrap;gap:2px;max-height:96px;overflow:hidden;margin-bottom:8px"></div><div class="log" id="feed" style="position:static;height:190px"></div>`);
  let from = 0;
  for (;;) {
    const canEnd = passed('people') || (!J.newSet && J.people > 0);
    const { total, rows } = await api(`/api/job/people?id=${encodeURIComponent(J.id)}&from=${from}&limit=200`);
    const pace = Math.max(1, Math.ceil(total / 80));
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const dot = document.createElement('i');
      dot.style.cssText = 'display:block;width:5px;height:5px;background:var(--live)';
      $('dots').appendChild(dot);
      const line = document.createElement('div');
      line.textContent = `${p.country === 'KR' ? 'Korea' : 'US'} ${p.name}, ${p.age} · ${p.job} · ${(p.apps || []).join(', ')}`;
      $('feed').appendChild(line);
      while ($('feed').children.length > 9) $('feed').firstChild.remove();
      if (i % pace === 0) await sleep(45);
    }
    from += rows.length;
    $('pplHead').textContent = `${J.newSet ? 'Created' : 'Loaded'} ${from.toLocaleString('en-US')}${J.newSet && J.info.people?.total ? ` / ${J.info.people.total.toLocaleString('en-US')}` : total ? ` / ${total.toLocaleString('en-US')}` : ''} people`;
    if (canEnd && from >= total) break;
    if (dead()) throw new Error('stopped');
    if (!rows.length) await sleep(600);
  }
  finishSection(el, `${from.toLocaleString('en-US')} people`);
}
async function sceneAds() {
  await until(() => reached('ads'));
  const el = section('ads', '<p class="dim" id="adMsg" style="margin:0 0 6px">Writing ad copy and making images</p><div class="ads2" id="adCards"></div>');
  await until(() => J.creatives.length || passed('ads'));
  el.querySelector('#adMsg').textContent = `${J.creatives.length} ads`;
  for (const c of J.creatives) {
    const d = document.createElement('div');
    d.innerHTML = `<img src="/creatives/${encodeURIComponent(c.id)}-en.jpg?run=${encodeURIComponent(J.id)}" alt="${esc(c.hook)}"><small>${esc(c.hook)}</small>`;
    el.querySelector('#adCards').appendChild(d);
    await sleep(300);
  }
  finishSection(el);
}
async function sceneSim() {
  await until(() => reached('sim'));
  const el = section('sim', '<p id="simNum" style="margin:0" class="cost"></p><div class="prog"><i id="simBar"></i></div><p class="note">Each person sees the ad, moves through the screens and lives 30 days. People done and cost come from the server.</p>');
  const paint = () => {
    const i = J.info.sim || { done: 0, total: 0, cost: 0 }, total = i.total || J.people;
    el.querySelector('#simNum').innerHTML = `<b>${i.done.toLocaleString('en-US')}</b> / ${total.toLocaleString('en-US')} people done · decision cost $${i.cost.toFixed(4)}`;
    el.querySelector('#simBar').style.width = `${total ? i.done / total * 100 : 0}%`;
  };
  while (!passed('sim')) { if (dead()) throw new Error('stopped'); paint(); await sleep(300); }
  paint();
  el.querySelector('#simBar').style.width = '100%';
  finishSection(el);
}
async function sceneReport() {
  if (!J.steps.includes('report')) return;
  await until(() => reached('report'));
  const el = section('report', '<p class="dim" style="margin:0">Grouping reasons for leaving and writing the text. There is no progress bar because the finish time cannot be predicted.</p>');
  await until(() => J.status === 'done');
  finishSection(el);
}
async function scenario(id) {
  stop = null;
  wiz.innerHTML = `<h1>Running simulation</h1><p class="dim cost"><span id="runId"></span> · <span id="totalCost"></span></p><div id="scenes"></div><p class="err" id="stopMsg" role="alert"></p><p id="after"></p><div class="nav"><button id="cancel">Cancel</button><a href="new.html" class="dim">Start another</a></div>`;
  $('runId').textContent = id;
  $('cancel').onclick = () => { if (confirm('Cancel this run? Money already spent will not come back.')) post(`/api/job/cancel?id=${encodeURIComponent(id)}`, {}); };
  try { J = await api(`/api/job?id=${encodeURIComponent(id)}`); } catch (e) { $('stopMsg').textContent = e.message; return; }
  poll(id);
  try {
    await sceneScreens(); await scenePeople(); await sceneAds(); await sceneSim(); await sceneReport();
  } catch (e) {
    if (e.message !== 'stopped') $('stopMsg').textContent = e.message;
    if (dead()) showStop();
    return;
  }
  const url = `/?run=${encodeURIComponent(id)}`;
  const notes = [...(J.warnings || []), ...(J.notes || [])];
  $('after').innerHTML = `${notes.map(n => `<span class="dim">${esc(n)}</span><br>`).join('')}<a href="${url}">Go to the results</a>`;
  await sleep(notes.length ? 5000 : 1800);
  location.href = url;
}

// ---------- boot ----------
(async () => {
  try {
    [CONF, SETS, RUNS] = await Promise.all([api('/api/config'), api('/api/sets'), api('/api/runs')]);
  } catch (e) { err = e.message; }
  const job = new URLSearchParams(location.search).get('job');
  if (job) return scenario(job);
  render();
  const first = SETS.find(s => s.id === 'kr-us-10k') || SETS[0];
  if (first) chooseSet(first.id);
})();
