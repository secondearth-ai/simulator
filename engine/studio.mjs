// Server side of the "new simulation" screen: capture and upload images, turn the form into run.json, run the engine steps as child processes.
// A key typed by the user lives only in the running job's closure and the child's environment. It is never written or returned.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { readJson, writeJson, rng } from './lib.mjs';

export const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export const MAX_PEOPLE = 2000;
const check = (ok, msg) => { if (!ok) throw Object.assign(new Error(msg), { status: 400 }); };

// What a person is told at each kind of screen. The baseline is the part the user can edit.
export const KINDS = {
  web: { label: 'Web page', situation: 'You tapped a link and saw this web page on your phone.', baseline: 'In reality, more than half of people close a product page they are seeing for the first time within seconds.' },
  store: { label: 'App store or sign-up', situation: 'You saw the install or sign-up page.', baseline: 'In reality, about 30% of people who see this page install. Answer p in line with this baseline.' },
  onboarding: { label: 'Onboarding', situation: 'You installed the app and opened it for the first time.', baseline: 'In reality, about 60% of people who install get past this step.' },
  app: { label: 'App screen', situation: 'You were trying the app and saw this screen.', baseline: 'In reality, fewer than half of people keep using an app after first use.' },
  paywall: { label: 'Paywall', situation: 'A pricing screen appeared.', baseline: 'In reality, only about 5% of people who see this screen start a trial or subscribe. Answer p in line with this baseline.' },
};

// ---------- images ----------
export const draftDir = id => { check(ID_RE.test(id || ''), 'Invalid draft id.'); return `drafts/${id}`; };
export function newDraft() { const id = `d${crypto.randomBytes(6).toString('hex')}`; fs.mkdirSync(`drafts/${id}`, { recursive: true }); return id; }
const newImageId = () => `i${crypto.randomBytes(4).toString('hex')}`;

// Only literal addresses are checked, no DNS lookup. Enough to stop a pasted link reaching this machine or its network by accident.
function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || (h.includes(':') && /^(fc|fd|fe80)/.test(h))
    || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

export async function captureUrl(draft, rawUrl, shots = 1) {
  const dir = draftDir(draft);
  let u;
  try { u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`); } catch { check(false, 'Invalid URL.'); }
  check(['http:', 'https:'].includes(u.protocol) && !isPrivateHost(u.hostname), 'Only public http and https addresses can be captured.');
  const n = Math.max(1, Math.min(4, Number(shots) || 1));
  const ids = Array.from({ length: n }, newImageId);
  const b = await chromium.launch();
  let title = '';
  try {
    for (const [lang, locale] of [['ko', 'ko-KR'], ['en', 'en-US']]) {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale });
      await c.route('**/*', r => { let bad = false; try { bad = isPrivateHost(new URL(r.request().url()).hostname); } catch {} return bad ? r.abort() : r.continue(); });
      const p = await c.newPage();
      const res = await p.goto(u.href, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
      if (!res && p.url() === 'about:blank') { await c.close(); check(false, 'Could not open the page. Please check the address.'); }
      check(!res || res.status() < 400, `The page returned an error (HTTP ${res?.status()}).`);
      await p.waitForTimeout(1000);
      if (lang === 'en') title = await p.title().catch(() => '');
      for (let i = 0; i < n; i++) {
        await p.evaluate(y => window.scrollTo(0, y), i * 760);
        await p.waitForTimeout(500);
        await p.screenshot({ path: `${dir}/${ids[i]}-${lang}.jpg`, type: 'jpeg', quality: 70 });
      }
      await c.close();
    }
  } finally { await b.close(); }
  const kind = /(^|\.)apps\.apple\.com$|(^|\.)play\.google\.com$/.test(u.hostname) ? 'store' : 'web';
  return ids.map((id, i) => ({ id, name: kind === 'store' ? 'App Store' : n > 1 ? `${title.slice(0, 20) || 'Web page'} ${i + 1}` : title.slice(0, 30) || 'Web page', kind }));
}

// Everything is re-rendered to JPEG because the engine sends images as image/jpeg.
const ACCEPT = /^image\/(png|jpe?g|webp|gif|avif)$/;
export async function ingestImage(draft, buf, type, kind = 'screen') {
  const dir = draftDir(draft);
  check(ACCEPT.test(type || ''), 'Only PNG, JPG and WEBP images can be uploaded.');
  const ad = kind === 'creative', id = newImageId();
  const [w, h] = ad ? [540, 960] : [390, 844];
  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: ad ? 1 : 2 })).newPage();
    await p.setContent(`<!doctype html><body style="margin:0;background:#fff;width:${w}px;height:${h}px;overflow:hidden"><img src="data:${type};base64,${buf.toString('base64')}" style="width:100%;${ad ? 'height:100%;object-fit:cover' : ''};display:block">`);
    const ok = await p.evaluate(() => document.images[0].decode().then(() => true, () => false));
    check(ok, 'Could not read the image.');
    await p.screenshot({ path: `${dir}/${id}-ko.jpg`, type: 'jpeg', quality: ad ? 80 : 70 });
    fs.copyFileSync(`${dir}/${id}-ko.jpg`, `${dir}/${id}-en.jpg`);
  } finally { await b.close(); }
  return id;
}

// ---------- form to run.json ----------
// The calculator and the viewer count on the stage ids store, onboarding, result and paywall, so the user's screens are mapped onto them.
// A step the user has no screen for is kept without an image and judged from the product description.
export function buildFunnel(screens, facts, plan) {
  const notes = [];
  const list = screens.map(s => ({ ...s, kind: KINDS[s.kind] ? s.kind : 'app' }));
  const walls = list.filter(s => s.kind === 'paywall');
  if (walls.length > 1) { walls.slice(0, -1).forEach(s => { s.kind = 'app'; }); notes.push('There are several paywalls, so only the last one runs as the paywall and the others run as app screens.'); }
  const rank = { web: 0, store: 1, onboarding: 2, app: 2, paywall: 3 };
  const sorted = list.map((s, i) => [s, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map(x => x[0]);
  if (sorted.some((s, i) => s !== list[i])) notes.push('This tool\'s funnel only runs web → store → app → paywall, so the screens were moved into that order. Screens after the paywall go before it.');

  const virtual = (id, title, kind) => ({ id, title, kind, virtual: true });
  const web = sorted.filter(s => s.kind === 'web');
  const stores = sorted.filter(s => s.kind === 'store');
  const inApp = sorted.filter(s => s.kind === 'onboarding' || s.kind === 'app');
  const wall = sorted.find(s => s.kind === 'paywall') || virtual('paywall', 'Paywall (no screen)', 'paywall');
  if (!stores.length) stores.push(virtual('store', 'Install or sign-up (no screen)', 'store'));
  let onb = -1; inApp.forEach((s, i) => { if (s.kind === 'onboarding') onb = i; });
  if (onb < 0) { inApp.unshift(virtual('onboarding', 'Onboarding (no screen)', 'onboarding')); onb = 0; }
  let res = -1; inApp.forEach((s, i) => { if (i > onb && s.kind === 'app') res = i; });
  if (res < 0) { inApp.push(virtual('result', 'First use (no screen)', 'app')); res = inApp.length - 1; }

  let n = 0;
  const custom = () => `s${++n}`;
  web.forEach((s, i) => { s.stage = i === 0 ? 'landing' : i === 1 ? 'pricing' : custom(); });
  stores.forEach((s, i) => { s.stage = i === stores.length - 1 ? 'store' : custom(); });
  inApp.forEach((s, i) => { s.stage = i === onb ? 'onboarding' : i === res ? 'result' : custom(); });
  wall.stage = 'paywall';

  const textFor = s => {
    const k = KINDS[s.kind], baseline = s.baseline ?? k.baseline;
    const noImage = s.virtual ? ` There is no screen for this step. Judge from the product description: ${facts}` : '';
    return `${k.situation}${noImage}${baseline ? ` ${baseline}` : ''}`.trim();
  };
  const stage = (s, acts, ask) => ({ id: s.stage, title: s.name || s.title, image: !s.virtual, ask: ask ?? textFor(s), acts, ...(s.virtual ? {} : { source: s.id }) });
  const stages = [];
  web.forEach((s, i) => stages.push(stage(s, i < web.length - 1 ? { next: 'Go on to the next screen', store: 'Tap get the app', leave: 'Close the window' } : { store: 'Tap get the app', leave: 'Close the window' })));
  stores.forEach((s, i) => stages.push(stage(s, i < stores.length - 1 ? { next: 'Go on to the next screen', leave: 'Leave' } : { install: 'Tap get, and install or sign up', leave: 'Leave without installing' })));
  inApp.forEach(s => stages.push(stage(s, { next: 'Keep going', leave: 'Close the app and never reopen it' })));

  const acts = {};
  if (plan.annual) acts.annual = plan.trialDays ? `Start the ${plan.trialDays}-day free trial of the annual plan (then $${plan.annual} per year)` : `Start the annual plan ($${plan.annual} per year)`;
  if (plan.weekly) acts.weekly = `Start the weekly plan ($${plan.weekly} per week)`;
  if (plan.free) acts.free = 'Close it and use it free';
  acts.leave = 'Delete the app';
  const k = KINDS.paywall, baseline = wall.baseline ?? k.baseline;
  const ask = `${k.situation} ${plan.free ? 'If you close it you can keep using the app free.' : 'Without subscribing you cannot keep using the app.'}${wall.virtual ? ` There is no screen for this step. Judge from the product description: ${facts}` : ''}${baseline ? ` ${baseline}` : ''}`;
  stages.push(stage(wall, acts, ask));
  stages.push({ id: 'trial', title: 'Trial', image: false }, { id: 'retain', title: 'Retention', image: false });
  return { stages, notes };
}

export function buildRun(f) {
  check(String(f.product || '').trim(), 'Please enter a product name.');
  check(String(f.concept || '').trim(), 'Please describe the concept.');
  check(Array.isArray(f.screens) && f.screens.length, 'Please add at least one screen.');
  const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
  const plan = { weekly: num(f.prices?.weekly), annual: num(f.prices?.annual), trialDays: Math.round(num(f.prices?.trialDays)), free: f.prices?.free !== false };
  check(plan.weekly || plan.annual, 'Please enter a weekly or annual price.');
  const storeCut = Math.min(0.5, num(f.prices?.storeCut, 15) / 100);
  const priceText = [plan.weekly && `$${plan.weekly} per week`, plan.annual && `$${plan.annual} per year${plan.trialDays ? ` (${plan.trialDays}-day free trial)` : ''}`].filter(Boolean).join(', ');
  const facts = `${String(f.product).trim()}: ${String(f.concept).trim()} Pricing: ${priceText}. ${plan.free ? 'It can also be used free.' : 'It requires a subscription.'}`;
  const { stages, notes } = buildFunnel(f.screens, facts, plan);
  const has = id => stages.some(s => s.id === id);
  const budget = Math.max(1, num(f.budget, 5000));
  const shown = stages.filter(s => s.image);
  const slug = String(f.product).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run';
  const id = `${slug}-${Date.now().toString(36)}`;
  const cfg = {
    id, product: String(f.product).trim(), set: null, days: 30, facts, url: f.url || undefined, created: new Date().toISOString(),
    paidShare: 0.7,
    organic: has('landing')
      ? [{ id: 'store', name: 'App store search', share: 0.4, entry: 'store' }, { id: 'search', name: 'Google search', share: 0.35, entry: 'landing' }, { id: 'friend', name: 'Link from someone they know', share: 0.25, entry: 'landing' }]
      : [{ id: 'store', name: 'App store search', share: 1, entry: 'store' }],
    stages,
    prices: { annual: plan.annual, weekly: plan.weekly, storeCut, trialDays: plan.trialDays },
    defaults: { budget, cpm: 9, ctr: 1.2, adSensitivity: 1, clickToInstall: 30, onboardingDone: 65, firstResult: 40, paywallConvert: 6, priceSensitivity: 1, annualShare: plan.annual && plan.weekly ? 50 : plan.annual ? 100 : 0, trialToPaid: 35, weeklyRenew: 45, revisit: 1 },
    audience: f.audience || {},
    creativeScreens: shown.map(s => ({ id: s.id, title: s.title })),
    freeCheckAsk: 'A few days have passed. After using the app free for a little, choose whether to open it again today.',
    limitsNote: `the screens are captures the user uploaded and may differ from how the product really behaves, and ${stages.filter(s => s.acts && !s.image).map(s => s.title).join(', ') || 'steps without a screen'} were judged from the product description with no screen`,
  };
  return { cfg, notes };
}

// Writes the run folder. Images come from the draft, and an uploaded ad becomes a creative whose hook is what the user named it.
export function writeRunFiles(cfg, draft, creatives) {
  const dir = `runs/${cfg.id}`, src = draftDir(draft);
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of ['ko', 'en']) {
    fs.mkdirSync(`${dir}/screens/${lang}`, { recursive: true });
    for (const s of cfg.stages) if (s.image) {
      const from = `${src}/${path.basename(String(s.source))}-${lang}.jpg`;
      check(fs.existsSync(from), `Screen image not found: ${s.title}`);
      fs.copyFileSync(from, `${dir}/screens/${lang}/${s.id}.jpg`);
    }
  }
  if (creatives?.length) {
    fs.mkdirSync(`${dir}/creatives`, { recursive: true });
    const rows = creatives.map((c, i) => {
      const id = `u${i + 1}`, name = String(c.name || `Ad ${i + 1}`);
      for (const lang of ['ko', 'en']) {
        const from = `${src}/${path.basename(String(c.id))}-${lang}.jpg`;
        check(fs.existsSync(from), `Ad image not found: ${name}`);
        fs.copyFileSync(from, `${dir}/creatives/${id}-${lang}.jpg`);
      }
      return { id, angle: `Uploaded ad: ${name}`, screen: cfg.stages.find(s => s.image)?.id, ko: { hook: name, sub: '', cta: '' }, en: { hook: name, sub: '', cta: '' } };
    });
    writeJson(`${dir}/creatives.json`, rows);
  }
  for (const s of cfg.stages) delete s.source;
  writeJson(`${dir}/run.json`, cfg);
}

// ---------- audience ----------
export function matchAudience(personas, a = {}) {
  const countries = a.countries || [], sectors = a.sectors || [];
  const min = Number(a.ageMin) || 0, max = Number(a.ageMax) || 200;
  const words = String(a.text || '').toLowerCase().split(/[\s,]+/).filter(w => w.length >= 2);
  return personas.filter(p => (!countries.length || countries.includes(p.country)) && (!sectors.length || sectors.includes(p.sector)) && p.age >= min && p.age <= max
    && (!words.length || words.some(w => `${p.job} ${p.workplace} ${p.sector} ${p.city} ${p.likes} ${p.goal} ${p.stress} ${p.weekday} ${(p.apps || []).join(' ')}`.toLowerCase().includes(w))));
}
export function pickPeople(personas, a, count) {
  const list = matchAudience(personas, a).map(p => p.id);
  const r = rng(list.length * 31 + count);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, count);
}

// ---------- jobs ----------
const jobs = new Map();
let active = null;
const publicJob = j => ({ id: j.id, status: j.status, steps: j.steps, step: j.step, info: j.info, screens: j.screens, creatives: j.creatives, newSet: j.newSet, model: j.model, cost: j.cost, error: j.error, warnings: j.warnings, notes: j.notes, people: j.people });
const save = j => writeJson(`runs/${j.id}/job.json`, publicJob(j));

export function jobStatus(id) {
  if (jobs.has(id)) return publicJob(jobs.get(id));
  check(ID_RE.test(id || ''), 'Invalid run id.');
  const f = `runs/${id}/job.json`;
  if (!fs.existsSync(f)) return null;
  const j = readJson(f);
  if (j.status === 'running') j.status = 'interrupted'; // the server restarted while it ran
  return j;
}
export function cancelJob(id) { const j = jobs.get(id); if (j && j.status === 'running') { j.cancelled = true; j.child?.kill('SIGTERM'); } return !!j; }
process.on('exit', () => active?.child?.kill('SIGTERM'));

const LABEL = { screens: 'Reading product screens', people: 'Personas', ads: 'Ads', sim: 'Simulation', report: 'Report' };
function enter(j, name) { j.step = name; j.info[name] = { done: 0, total: 0, cost: 0 }; save(j); }

function runStep(j, name, args, env) {
  return new Promise((resolve, reject) => {
    enter(j, name);
    const info = j.info[name];
    const secret = env.OPENROUTER_API_KEY;
    const scrub = s => (secret ? s.split(secret).join('***') : s);
    const log = fs.createWriteStream(`runs/${j.id}/run.log`, { flags: 'a' });
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    j.child = child;
    let tail = '', last = 0, stepCost = 0;
    const base = j.cost;
    const onData = chunk => {
      const text = scrub(chunk.toString());
      log.write(text);
      tail = (tail + text).slice(-600);
      for (const line of text.split('\n')) {
        const m = line.match(/^(?:sim|set) (\d+)\/(\d+) \$([\d.]+)/);
        if (m) { info.done = +m[1]; info.total = +m[2]; stepCost = +m[3]; }
        const c = line.match(/cost: ([\d.e-]+)/);
        if (c) stepCost = +c[1];
      }
      j.cost = base + stepCost; info.cost = stepCost;
      if (Date.now() - last > 1000) { last = Date.now(); save(j); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => { log.end(); reject(e); });
    child.on('close', code => {
      log.end(); j.child = null;
      if (j.cancelled) return reject(new Error('Canceled by the user.'));
      if (code === 0) return resolve();
      const why = tail.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-240);
      reject(new Error(`The ${LABEL[name]} step failed: ${why}`));
    });
  });
}

// Checks the key before anything is spent. A failed check says only that the key failed.
export async function verifyKey(key) {
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  check(r, 'Could not reach OpenRouter.');
  check(r.ok, 'The OpenRouter key is not valid.');
}

export const isBusy = () => !!active;

export function startJob({ cfg, notes, key, count, newSet, report, autoCreatives, loadSet, audience }) {
  check(!active, 'A run is already in progress. Please try again when it finishes.');
  const steps = ['screens', 'people', 'ads', 'sim', ...(report ? ['report'] : [])];
  const j = { id: cfg.id, status: 'running', steps, step: 'screens', info: {}, screens: cfg.stages.filter(s => s.image).map(s => ({ id: s.id, title: s.title })), creatives: [], newSet: !!newSet, model: cfg.model || null, cost: 0, error: null, warnings: [], notes, people: 0 };
  jobs.set(j.id, j); active = j;
  enter(j, 'screens');
  j.info.screens = { done: j.screens.length, total: j.screens.length, cost: 0 };
  const env = { ...process.env, SIM_PROGRESS: '1', CONC: '30' };
  if (key) env.OPENROUTER_API_KEY = key;
  if (cfg.model) env.SIM_MODEL = cfg.model;
  const dir = `runs/${j.id}`;
  (async () => {
    if (newSet) await runStep(j, 'people', ['engine/set.mjs', newSet.id, String(newSet.count)], { ...env, SET_NAME: newSet.name || newSet.id, SET_BRIEF: newSet.brief || '', SET_COUNTRIES: (newSet.countries?.length ? newSet.countries : ['KR', 'US']).join(',') });
    else enter(j, 'people');
    const ids = pickPeople(loadSet(cfg.set), audience, count);
    check(ids.length, 'No personas match.');
    j.people = ids.length;
    writeJson(`${dir}/people.json`, ids);
    if (!newSet) j.info.people = { done: ids.length, total: ids.length, cost: 0 };

    if (autoCreatives) await runStep(j, 'ads', ['engine/creatives.mjs', j.id], env);
    else enter(j, 'ads');
    j.creatives = readJson(`${dir}/creatives.json`).map(c => ({ id: c.id, hook: c.en?.hook || c.id, angle: c.angle }));
    j.info.ads.done = j.info.ads.total = j.creatives.length;

    await runStep(j, 'sim', ['engine/sim.mjs', j.id], env);
    const out = `${dir}/walks.jsonl`;
    const walked = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length : 0;
    check(walked, 'The simulation produced no results. Please check run.log.');
    if (walked < ids.length) j.warnings.push(`Only ${walked} of ${ids.length} people finished.`);
    if (report) await runStep(j, 'report', ['engine/report30.mjs', j.id], env).catch(e => { if (j.cancelled) throw e; j.warnings.push(`Could not make the report. ${e.message}`); });
    j.status = 'done';
  })().catch(e => { j.status = j.cancelled ? 'cancelled' : 'failed'; j.error = String(e.message || e).slice(0, 400); })
    .finally(() => { active = null; j.child = null; save(j); });
  return publicJob(j);
}

// The people behind the persona step, for the live list. A new set is read as it is written; a reused set gives the people picked for the run.
export function jobPeople(id, from, limit, loadSet) {
  check(ID_RE.test(id || ''), 'Invalid run id.');
  const f = `runs/${id}/run.json`;
  if (!fs.existsSync(f)) return { total: 0, rows: [] };
  const cfg = readJson(f);
  let list = [];
  if (cfg.newSet) {
    const file = `sets/${cfg.set}/personas.jsonl`;
    if (fs.existsSync(file)) list = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(from, from + limit).map(l => JSON.parse(l));
    const total = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
    return { total, rows: list.map(row) };
  }
  if (!fs.existsSync(`runs/${id}/people.json`)) return { total: 0, rows: [] };
  const ids = readJson(`runs/${id}/people.json`), byId = new Map(loadSet(cfg.set).map(p => [p.id, p]));
  return { total: ids.length, rows: ids.slice(from, from + limit).map(i => row(byId.get(i))) };
}
const row = p => ({ id: p.id, name: p.name, age: p.age, country: p.country, job: p.job, apps: (p.apps || []).slice(0, 4) });
