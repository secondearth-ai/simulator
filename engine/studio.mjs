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
  web: { label: '웹페이지', situation: '링크를 눌러 이 웹페이지를 폰으로 봤다.', baseline: '현실에서 처음 보는 제품 페이지는 절반 이상이 몇 초 안에 닫힌다.' },
  store: { label: '앱스토어·가입', situation: '설치 또는 가입 페이지를 봤다.', baseline: '현실에서 이 페이지를 본 사람의 약 30%가 설치한다. p는 이 기준에 맞춰 답한다.' },
  onboarding: { label: '온보딩', situation: '앱을 설치하고 처음 열었다.', baseline: '현실에서 설치한 사람의 약 60%가 이 단계를 넘는다.' },
  app: { label: '앱 사용 화면', situation: '앱을 써 보다가 이 화면을 봤다.', baseline: '현실에서 첫 사용 뒤 계속 쓰는 사람은 절반이 안 된다.' },
  paywall: { label: '페이월', situation: '요금 안내 화면이 떴다.', baseline: '현실에서 이 화면을 본 사람의 약 5%만 체험이나 구독을 시작한다. p는 이 기준에 맞춰 답한다.' },
};

// ---------- images ----------
export const draftDir = id => { check(ID_RE.test(id || ''), '잘못된 초안 id입니다.'); return `drafts/${id}`; };
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
  try { u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`); } catch { check(false, 'URL 형식이 올바르지 않습니다.'); }
  check(['http:', 'https:'].includes(u.protocol) && !isPrivateHost(u.hostname), '공개된 http·https 주소만 캡처할 수 있습니다.');
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
      if (!res && p.url() === 'about:blank') { await c.close(); check(false, '페이지를 열지 못했습니다. 주소를 확인해 주세요.'); }
      check(!res || res.status() < 400, `페이지가 오류를 돌려줬습니다 (HTTP ${res?.status()}).`);
      await p.waitForTimeout(1000);
      if (lang === 'ko') title = await p.title().catch(() => '');
      for (let i = 0; i < n; i++) {
        await p.evaluate(y => window.scrollTo(0, y), i * 760);
        await p.waitForTimeout(500);
        await p.screenshot({ path: `${dir}/${ids[i]}-${lang}.jpg`, type: 'jpeg', quality: 70 });
      }
      await c.close();
    }
  } finally { await b.close(); }
  const kind = /(^|\.)apps\.apple\.com$|(^|\.)play\.google\.com$/.test(u.hostname) ? 'store' : 'web';
  return ids.map((id, i) => ({ id, name: kind === 'store' ? '앱스토어' : n > 1 ? `${title.slice(0, 20) || '웹페이지'} ${i + 1}` : title.slice(0, 30) || '웹페이지', kind }));
}

// Everything is re-rendered to JPEG because the engine sends images as image/jpeg.
const ACCEPT = /^image\/(png|jpe?g|webp|gif|avif)$/;
export async function ingestImage(draft, buf, type, kind = 'screen') {
  const dir = draftDir(draft);
  check(ACCEPT.test(type || ''), 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
  const ad = kind === 'creative', id = newImageId();
  const [w, h] = ad ? [540, 960] : [390, 844];
  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: ad ? 1 : 2 })).newPage();
    await p.setContent(`<!doctype html><body style="margin:0;background:#fff;width:${w}px;height:${h}px;overflow:hidden"><img src="data:${type};base64,${buf.toString('base64')}" style="width:100%;${ad ? 'height:100%;object-fit:cover' : ''};display:block">`);
    const ok = await p.evaluate(() => document.images[0].decode().then(() => true, () => false));
    check(ok, '이미지를 읽지 못했습니다.');
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
  if (walls.length > 1) { walls.slice(0, -1).forEach(s => { s.kind = 'app'; }); notes.push('페이월이 여러 장이라 마지막 한 장만 페이월로, 나머지는 앱 화면으로 실행합니다.'); }
  const rank = { web: 0, store: 1, onboarding: 2, app: 2, paywall: 3 };
  const sorted = list.map((s, i) => [s, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map(x => x[0]);
  if (sorted.some((s, i) => s !== list[i])) notes.push('이 도구의 퍼널은 웹 → 스토어 → 앱 → 페이월 순서로만 돌아서 그 순서로 옮겨 실행합니다. 페이월 뒤 화면은 페이월 앞에 들어갑니다.');

  const virtual = (id, title, kind) => ({ id, title, kind, virtual: true });
  const web = sorted.filter(s => s.kind === 'web');
  const stores = sorted.filter(s => s.kind === 'store');
  const inApp = sorted.filter(s => s.kind === 'onboarding' || s.kind === 'app');
  const wall = sorted.find(s => s.kind === 'paywall') || virtual('paywall', '페이월(화면 없음)', 'paywall');
  if (!stores.length) stores.push(virtual('store', '설치·가입(화면 없음)', 'store'));
  let onb = -1; inApp.forEach((s, i) => { if (s.kind === 'onboarding') onb = i; });
  if (onb < 0) { inApp.unshift(virtual('onboarding', '온보딩(화면 없음)', 'onboarding')); onb = 0; }
  let res = -1; inApp.forEach((s, i) => { if (i > onb && s.kind === 'app') res = i; });
  if (res < 0) { inApp.push(virtual('result', '첫 사용(화면 없음)', 'app')); res = inApp.length - 1; }

  let n = 0;
  const custom = () => `s${++n}`;
  web.forEach((s, i) => { s.stage = i === 0 ? 'landing' : i === 1 ? 'pricing' : custom(); });
  stores.forEach((s, i) => { s.stage = i === stores.length - 1 ? 'store' : custom(); });
  inApp.forEach((s, i) => { s.stage = i === onb ? 'onboarding' : i === res ? 'result' : custom(); });
  wall.stage = 'paywall';

  const textFor = s => {
    const k = KINDS[s.kind], baseline = s.baseline ?? k.baseline;
    const noImage = s.virtual ? ` 이 단계의 화면 자료는 없다. 제품 설명으로 판단한다: ${facts}` : '';
    return `${k.situation}${noImage}${baseline ? ` ${baseline}` : ''}`.trim();
  };
  const stage = (s, acts, ask) => ({ id: s.stage, title: s.name || s.title, image: !s.virtual, ask: ask ?? textFor(s), acts, ...(s.virtual ? {} : { source: s.id }) });
  const stages = [];
  web.forEach((s, i) => stages.push(stage(s, i < web.length - 1 ? { next: '다음 화면으로 넘어간다', store: '앱 받기를 누른다', leave: '창을 닫는다' } : { store: '앱 받기를 누른다', leave: '창을 닫는다' })));
  stores.forEach((s, i) => stages.push(stage(s, i < stores.length - 1 ? { next: '다음 화면으로 넘어간다', leave: '나간다' } : { install: '받기를 눌러 설치하거나 가입한다', leave: '설치하지 않고 나간다' })));
  inApp.forEach(s => stages.push(stage(s, { next: '계속 진행한다', leave: '앱을 닫고 다시 안 연다' })));

  const acts = {};
  if (plan.annual) acts.annual = plan.trialDays ? `연간 ${plan.trialDays}일 무료 체험을 시작한다 (이후 연 $${plan.annual})` : `연간 구독을 시작한다 (연 $${plan.annual})`;
  if (plan.weekly) acts.weekly = `주간 구독을 시작한다 (주 $${plan.weekly})`;
  if (plan.free) acts.free = '닫고 무료로 쓴다';
  acts.leave = '앱을 지운다';
  const k = KINDS.paywall, baseline = wall.baseline ?? k.baseline;
  const ask = `${k.situation} ${plan.free ? '닫으면 무료로 계속 쓸 수 있다.' : '구독하지 않으면 계속 쓸 수 없다.'}${wall.virtual ? ` 이 단계의 화면 자료는 없다. 제품 설명으로 판단한다: ${facts}` : ''}${baseline ? ` ${baseline}` : ''}`;
  stages.push(stage(wall, acts, ask));
  stages.push({ id: 'trial', title: '체험·첫 결제', image: false }, { id: 'retain', title: '30일 유지', image: false });
  return { stages, notes };
}

export function buildRun(f) {
  check(String(f.product || '').trim(), '제품 이름을 입력해 주세요.');
  check(String(f.concept || '').trim(), '컨셉 설명을 입력해 주세요.');
  check(Array.isArray(f.screens) && f.screens.length, '화면을 한 장 이상 넣어 주세요.');
  const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
  const plan = { weekly: num(f.prices?.weekly), annual: num(f.prices?.annual), trialDays: Math.round(num(f.prices?.trialDays)), free: f.prices?.free !== false };
  check(plan.weekly || plan.annual, '주간 또는 연간 요금을 하나 이상 입력해 주세요.');
  const storeCut = Math.min(0.5, num(f.prices?.storeCut, 15) / 100);
  const priceText = [plan.weekly && `주 $${plan.weekly}`, plan.annual && `연 $${plan.annual}${plan.trialDays ? `(${plan.trialDays}일 무료 체험)` : ''}`].filter(Boolean).join(', ');
  const facts = `${String(f.product).trim()}: ${String(f.concept).trim()} 요금: ${priceText}. ${plan.free ? '무료로도 쓸 수 있다.' : '구독해야 쓸 수 있다.'}`;
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
      ? [{ id: 'store', name: '앱스토어 검색', share: 0.4, entry: 'store' }, { id: 'search', name: '구글 검색', share: 0.35, entry: 'landing' }, { id: 'friend', name: '지인 링크', share: 0.25, entry: 'landing' }]
      : [{ id: 'store', name: '앱스토어 검색', share: 1, entry: 'store' }],
    stages,
    prices: { annual: plan.annual, weekly: plan.weekly, storeCut, trialDays: plan.trialDays },
    defaults: { budget, cpm: 9, ctr: 1.2, adSensitivity: 1, clickToInstall: 30, onboardingDone: 65, firstResult: 40, paywallConvert: 6, priceSensitivity: 1, annualShare: plan.annual && plan.weekly ? 50 : plan.annual ? 100 : 0, trialToPaid: 35, weeklyRenew: 45, revisit: 1 },
    audience: f.audience || {},
    creativeScreens: shown.map(s => ({ id: s.id, title: s.title })),
    freeCheckAsk: '며칠이 지났다. 앱을 무료로 조금 써 본 뒤 오늘 다시 열지 고른다.',
    limitsNote: `화면은 사용자가 올린 캡처이고 실제 동작과 다를 수 있으며, ${stages.filter(s => s.acts && !s.image).map(s => s.title).join(', ') || '화면이 없는 단계'}는 화면 없이 제품 설명으로 판단했다`,
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
      check(fs.existsSync(from), `화면 이미지를 찾지 못했습니다: ${s.title}`);
      fs.copyFileSync(from, `${dir}/screens/${lang}/${s.id}.jpg`);
    }
  }
  if (creatives?.length) {
    fs.mkdirSync(`${dir}/creatives`, { recursive: true });
    const rows = creatives.map((c, i) => {
      const id = `u${i + 1}`, name = String(c.name || `소재 ${i + 1}`);
      for (const lang of ['ko', 'en']) {
        const from = `${src}/${path.basename(String(c.id))}-${lang}.jpg`;
        check(fs.existsSync(from), `소재 이미지를 찾지 못했습니다: ${name}`);
        fs.copyFileSync(from, `${dir}/creatives/${id}-${lang}.jpg`);
      }
      return { id, angle: `직접 올린 소재: ${name}`, screen: cfg.stages.find(s => s.image)?.id, ko: { hook: name, sub: '', cta: '' }, en: { hook: name, sub: '', cta: '' } };
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
  check(ID_RE.test(id || ''), '잘못된 실행 id입니다.');
  const f = `runs/${id}/job.json`;
  if (!fs.existsSync(f)) return null;
  const j = readJson(f);
  if (j.status === 'running') j.status = 'interrupted'; // the server restarted while it ran
  return j;
}
export function cancelJob(id) { const j = jobs.get(id); if (j && j.status === 'running') { j.cancelled = true; j.child?.kill('SIGTERM'); } return !!j; }
process.on('exit', () => active?.child?.kill('SIGTERM'));

const LABEL = { screens: '제품 화면 읽기', people: '페르소나', ads: '광고 소재', sim: '시뮬레이션', report: '보고서' };
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
      if (j.cancelled) return reject(new Error('사용자가 중단했습니다.'));
      if (code === 0) return resolve();
      const why = tail.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-240);
      reject(new Error(`${LABEL[name]} 단계가 실패했습니다: ${why}`));
    });
  });
}

// Checks the key before anything is spent. A failed check says only that the key failed.
export async function verifyKey(key) {
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  check(r, 'OpenRouter에 연결하지 못했습니다.');
  check(r.ok, 'OpenRouter 키가 올바르지 않습니다.');
}

export const isBusy = () => !!active;

export function startJob({ cfg, notes, key, count, newSet, report, autoCreatives, loadSet, audience }) {
  check(!active, '이미 돌고 있는 실행이 있습니다. 끝난 뒤 다시 시도해 주세요.');
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
    check(ids.length, '조건에 맞는 페르소나가 없습니다.');
    j.people = ids.length;
    writeJson(`${dir}/people.json`, ids);
    if (!newSet) j.info.people = { done: ids.length, total: ids.length, cost: 0 };

    if (autoCreatives) await runStep(j, 'ads', ['engine/creatives.mjs', j.id], env);
    else enter(j, 'ads');
    j.creatives = readJson(`${dir}/creatives.json`).map(c => ({ id: c.id, hook: c.ko?.hook || c.id, angle: c.angle }));
    j.info.ads.done = j.info.ads.total = j.creatives.length;

    await runStep(j, 'sim', ['engine/sim.mjs', j.id], env);
    const out = `${dir}/walks.jsonl`;
    const walked = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length : 0;
    check(walked, '시뮬레이션 결과가 한 명도 없습니다. run.log를 확인해 주세요.');
    if (walked < ids.length) j.warnings.push(`${ids.length}명 중 ${walked}명만 끝까지 돌았습니다.`);
    if (report) await runStep(j, 'report', ['engine/report30.mjs', j.id], env).catch(e => { if (j.cancelled) throw e; j.warnings.push(`보고서를 만들지 못했습니다. ${e.message}`); });
    j.status = 'done';
  })().catch(e => { j.status = j.cancelled ? 'cancelled' : 'failed'; j.error = String(e.message || e).slice(0, 400); })
    .finally(() => { active = null; j.child = null; save(j); });
  return publicJob(j);
}

// The people behind the persona step, for the live list. A new set is read as it is written; a reused set gives the people picked for the run.
export function jobPeople(id, from, limit, loadSet) {
  check(ID_RE.test(id || ''), '잘못된 실행 id입니다.');
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
