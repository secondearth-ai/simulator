// Local viewer and run builder. Serves any run in runs/ and generates a thought only when someone asks for it.
// A page picks its run with ?run=<id>. app.js calls the API without it, so the run also comes from the page address in the Referer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chat, imageUrl, readJson, MODEL } from './engine/lib.mjs';
import { ID_RE, KINDS, MAX_PEOPLE, newDraft, draftDir, captureUrl, ingestImage, buildRun, writeRunFiles, matchAudience, startJob, jobStatus, jobPeople, cancelJob, verifyKey, isBusy } from './engine/studio.mjs';
import './public/life.js';

const defaultRun = process.argv[2] || 'demo';
const port = Number(process.env.PORT || 4317);
const jsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ACTION = { click: 'clicked the ad', skip: 'skipped the ad', next: 'moved on to the next step', store: 'tapped get the app', leave: 'left', install: 'installed it', annual: 'started the annual free trial', weekly: 'started the weekly plan', free: 'closed it and chose to stay free', pay: 'kept the payment', cancel: 'canceled', keep: 'kept the subscription', open: 'reopened the app', drop: 'decided not to open the app again' };

const setCache = new Map();
function loadSet(id) {
  if (!ID_RE.test(id || '') || !fs.existsSync(`sets/${id}/personas.jsonl`)) throw Object.assign(new Error('Persona set not found.'), { status: 404 });
  const mtime = fs.statSync(`sets/${id}/personas.jsonl`).mtimeMs;
  const hit = setCache.get(id);
  if (hit?.mtime === mtime) return hit.people;
  const people = jsonl(`sets/${id}/personas.jsonl`).sort((a, b) => a.id - b.id);
  setCache.set(id, { mtime, people });
  return people;
}

// One loaded run. Walks are a snapshot from when it loaded; opening the page again picks up a run that has since moved on.
const runCache = new Map();
function loadRun(id, refresh = false) {
  if (!ID_RE.test(id || '') || !fs.existsSync(`runs/${id}/run.json`)) throw Object.assign(new Error(`Run not found: ${String(id).slice(0, 64)}`), { status: 404 });
  const dir = `runs/${id}`, walksFile = `${dir}/walks.jsonl`;
  const mtime = fs.existsSync(walksFile) ? fs.statSync(walksFile).mtimeMs : 0;
  const hit = runCache.get(id);
  if (hit && (!refresh || hit.mtime === mtime)) return hit;
  const cfg = readJson(`${dir}/run.json`);
  let personas = loadSet(cfg.set);
  if (fs.existsSync(`${dir}/people.json`)) { const keep = new Set(readJson(`${dir}/people.json`)); personas = personas.filter(p => keep.has(p.id)); }
  const thoughtsFile = `${dir}/thoughts.json`;
  const R = { id, dir, cfg, mtime, personas, byId: new Map(personas.map(p => [p.id, p])), walks: new Map(jsonl(walksFile).map(w => [w.id, w])), thoughtsFile, thoughts: hit?.thoughts || (fs.existsSync(thoughtsFile) ? readJson(thoughtsFile) : {}), cache: null };
  runCache.set(id, R);
  return R;
}
function pickRun(req, q) {
  if (q.get('run')) return q.get('run');
  try { const r = new URL(req.headers.referer).searchParams.get('run'); if (r) return r; } catch {}
  return defaultRun;
}

function compact(R) {
  const out = [];
  for (const p of R.personas) {
    const w = R.walks.get(p.id);
    if (!w) continue;
    out.push({ id: p.id, name: p.name, country: p.country, gender: p.gender, age: p.age, sector: p.sector, job: p.job, st: w.source.type, src: w.source.id, moment: w.moment, lang: w.lang, w: w.paidWeeks || 0,
      v: w.visits.map(x => ({ s: x.stage, t: x.t, a: x.action, p: x.p, att: x.att, tag: x.tag, rev: x.revisit ? 1 : 0, cr: x.creative, plan: x.plan, app: x.app, seen: x.seen, ctx: x.ctx, installed: x.installed ? 1 : 0 })) });
  }
  return out;
}
const bundle = R => (R.cache ||= JSON.stringify({ cfg: R.cfg, creatives: readJson(`${R.dir}/creatives.json`), agents: compact(R), set: readJson(`sets/${R.cfg.set}/set.json`) }));

function stats(list) {
  const count = (fn, top = 12) => { const m = new Map(); for (const p of list) for (const k of [].concat(fn(p) || [])) m.set(k, (m.get(k) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, top); };
  const band = a => a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 55 ? '45-54' : '55+';
  return { n: list.length, age: count(p => band(p.age), 5).sort((a, b) => a[0].localeCompare(b[0])), gender: count(p => p.gender), sector: count(p => p.sector, 10), apps: count(p => p.apps, 12), subs: count(p => (p.subscriptions || []).map(s => s.name), 10), city: count(p => p.city, 8) };
}
function people(R, q) {
  const f = k => q.get(k) || '';
  const s = f('q').toLowerCase();
  const band = f('age').split('-').map(Number);
  const list = R.personas.filter(p => (!f('country') || p.country === f('country')) && (!f('sector') || p.sector === f('sector')) && (!f('gender') || p.gender === f('gender')) && (!f('age') || (p.age >= band[0] && p.age <= (band[1] || 99)))
    && (!s || `${p.name} ${p.job} ${p.workplace} ${(p.apps || []).join(' ')} ${p.likes} ${p.city}`.toLowerCase().includes(s)));
  const offset = Number(f('offset') || 0);
  return { stats: stats(list), rows: list.slice(offset, offset + 80).map(p => ({ id: p.id, name: p.name, age: p.age, gender: p.gender, city: p.city, job: p.job, disposable: p.disposableMonthly, apps: (p.apps || []).slice(0, 4) })) };
}

const needKey = () => { if (!process.env.OPENROUTER_API_KEY) throw Object.assign(new Error('Needs OPENROUTER_API_KEY. Replay works without it.'), { status: 400 }); };

async function dayStory(R, id, day) {
  const key = `day:${id}:${day}`;
  if (R.thoughts[key]) return R.thoughts[key];
  needKey();
  const p = R.byId.get(id), w = R.walks.get(id), cfg = R.cfg;
  const plan = globalThis.Life.plan(p, day);
  const acts = (w?.visits || []).filter(v => Math.floor(v.t / 24) === day).map(v => `at ${Math.floor(v.t % 24)}:00, ${v.stage === 'ad' ? `saw a ${cfg.product} ad in ${v.app} and` : `on the ${v.stage} screen,`} ${ACTION[v.action] || v.action} (${v.tag})`);
  const text = await chat([{ role: 'user', content: `Write this day in the life of ${p.name} (age ${p.age}, ${p.job}, ${p.city}) in 3 sentences. Ordinary and concrete, in the first person, like a diary. Write in English only. Do not mix in any other language.
Household: ${p.household}. Current goal: ${p.goal} Stress: ${p.stress} Way of speaking: ${p.voice}
Schedule: ${plan.segments.filter(s => s.kind !== 'sleep').map(s => `${Math.floor(s.from)}:00 ${s.label}`).join(', ')}
App use: ${plan.sessions.slice(0, 6).map(s => `${Math.floor(s.h)}:00 ${s.app}`).join(', ')}
${acts.length ? `Things related to ${cfg.product} this day: ${acts.join('; ')}` : `Nothing related to ${cfg.product} happened this day. Do not mention it.`}` }], { json: false, max_tokens: 300, temperature: 0.9 });
  R.thoughts[key] = text.trim();
  fs.writeFileSync(R.thoughtsFile, JSON.stringify(R.thoughts, null, 1));
  return R.thoughts[key];
}

async function thought(R, id, i) {
  const key = `${id}:${i}`;
  if (R.thoughts[key]) return R.thoughts[key];
  needKey();
  const p = R.byId.get(id), w = R.walks.get(id), v = w?.visits[i];
  if (!v) throw new Error('no such step');
  const image = v.stage === 'ad' ? `${R.dir}/creatives/${v.creative}-${w.lang}.jpg` : R.cfg.stages.find(s => s.id === v.stage)?.image ? `${R.dir}/screens/${w.lang}/${v.stage}.jpg` : null;
  const parts = [{ type: 'text', text: `You are ${p.name} (age ${p.age}, ${p.job}, ${p.city}). Household: ${p.household}. Free to spend: ${p.disposableMonthly}. Apps you use: ${(p.apps || []).join(', ')}. Current goal: ${p.goal} Stress: ${p.stress} Usual way of speaking: ${p.voice} Something you often say: "${p.quote}"
${image ? 'Looking at the attached screen,' : 'About the subscription,'} you already acted like this: ${ACTION[v.action] || v.action}. Your note on why at the time: "${v.tag}". Attention ${v.att}/100.
Write what went through your head at that moment, 2 to 3 sentences in this person's way of speaking. ${image ? 'Point to at least one phrase or price actually visible on the screen, translated into English if the screen is in another language.' : ''} Mention one thing from this person's real daily life. Do not reverse the action. Write in English only, do not mix in any other language, no quotation marks.` }];
  if (image) parts.push({ type: 'image_url', image_url: { url: imageUrl(image) } });
  R.thoughts[key] = (await chat([{ role: 'user', content: parts }], { json: false, max_tokens: 400, temperature: 0.8 })).trim();
  fs.writeFileSync(R.thoughtsFile, JSON.stringify(R.thoughts, null, 1));
  return R.thoughts[key];
}

// ---------- new simulation ----------
const listDir = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : []);
function listRuns() {
  return listDir('runs').filter(id => fs.existsSync(`runs/${id}/run.json`)).map(id => {
    const cfg = readJson(`runs/${id}/run.json`), walks = `runs/${id}/walks.jsonl`, job = jobStatus(id);
    const n = fs.existsSync(walks) ? fs.readFileSync(walks, 'utf8').split('\n').filter(Boolean).length : 0;
    return { id, product: cfg.product, people: n, days: cfg.days, set: cfg.set, status: job?.status || (n ? 'done' : 'empty'), created: cfg.created || null };
  }).sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
}
const listSets = () => listDir('sets').filter(id => fs.existsSync(`sets/${id}/set.json`)).map(id => { const s = readJson(`sets/${id}/set.json`); return { id, name: s.name, count: s.count, note: s.note }; });
function setDetail(id) {
  const list = loadSet(id), m = new Map();
  for (const p of list) m.set(p.sector, (m.get(p.sector) || 0) + 1);
  return { id, count: list.length, countries: [...new Set(list.map(p => p.country))], sectors: [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k) };
}
// Someone reaching this server from another machine must bring their own key, so nobody spends the server's key by opening the page.
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const serverKey = req => !!process.env.OPENROUTER_API_KEY && isLocal(req);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('File is too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// JSON.parse errors quote the input, and this body can hold the key, so the error is replaced.
async function readJsonBody(req) {
  const buf = await readBody(req, 2e6);
  try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('Malformed request.'), { status: 400 }); }
}

async function start(req) {
  const f = await readJsonBody(req);
  const key = String(f.key || '').trim();
  if (!key && !serverKey(req)) throw Object.assign(new Error('Please enter an OpenRouter key.'), { status: 400 });
  if (isBusy()) throw Object.assign(new Error('A run is already in progress. Please try again when it finishes.'), { status: 409 });
  const ns = f.persona?.newSet;
  if (ns) {
    if (!ID_RE.test(ns.id || '')) throw Object.assign(new Error('A new set name can use letters, numbers, - and _ only.'), { status: 400 });
    if (fs.existsSync(`sets/${ns.id}`)) throw Object.assign(new Error('A set with that name already exists.'), { status: 400 });
    ns.count = Math.max(1, Math.min(MAX_PEOPLE, Number(ns.count) || 0));
  }
  const setId = ns ? ns.id : f.persona?.set;
  const audience = ns ? {} : (f.persona?.filters || {});
  const count = Math.max(1, Math.min(MAX_PEOPLE, Number(f.persona?.count) || 200));
  if (!ns && !matchAudience(loadSet(setId), audience).length) throw Object.assign(new Error('No personas match. Please loosen the filters.'), { status: 400 });
  const uploaded = f.ads?.mode === 'upload' ? (f.ads.items || []) : [];
  if (f.ads?.mode === 'upload' && !uploaded.length) throw Object.assign(new Error('Please upload at least one ad image.'), { status: 400 });
  const { cfg, notes } = buildRun({ ...f, budget: f.ads?.budget, audience: { ...audience, count } });
  cfg.set = setId;
  if (ns) cfg.newSet = true;
  const model = String(f.model || '').trim();
  if (model) {
    if (!/^[\w.-]+\/[\w.:-]+$/.test(model)) throw Object.assign(new Error('Invalid model name. Example: qwen/qwen3.7-flash'), { status: 400 });
    cfg.model = model;
  }
  if (key) await verifyKey(key);
  draftDir(f.draft);
  writeRunFiles(cfg, f.draft, uploaded);
  return startJob({ cfg, notes, key, count, newSet: ns, report: f.report !== false, autoCreatives: !uploaded.length, loadSet, audience });
}

const send = (res, v, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(typeof v === 'string' ? v : JSON.stringify(v)); };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams;
  try {
    // Thoughts and runs spend the owner's key, so only this machine's own pages may call the API, on GET as well as POST.
    if (url.pathname.startsWith('/api/')) {
      const fetchSite = req.headers['sec-fetch-site'];
      const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
      const crossOrigin = req.headers.origin && new URL(req.headers.origin).host !== req.headers.host;
      if (!localHost || crossOrigin || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return send(res, { error: 'Request came from another site.' }, 403);
    }
    if (req.method === 'POST') {
      if (url.pathname === '/api/draft') return send(res, { draft: newDraft() });
      if (url.pathname === '/api/capture') { const b = await readJsonBody(req); return send(res, { screens: await captureUrl(b.draft, b.url, b.shots) }); }
      if (url.pathname === '/api/upload') { const buf = await readBody(req, 20e6); return send(res, { id: await ingestImage(q.get('draft'), buf, req.headers['content-type'], q.get('kind')) }); }
      if (url.pathname === '/api/start') return send(res, await start(req));
      if (url.pathname === '/api/job/cancel') return send(res, { ok: cancelJob(q.get('id')) });
      return send(res, { error: 'not found' }, 404);
    }
    if (url.pathname === '/api/config') return send(res, { serverKey: serverKey(req), model: MODEL, maxPeople: MAX_PEOPLE, kinds: KINDS });
    if (url.pathname === '/api/runs') return send(res, listRuns());
    if (url.pathname === '/api/sets') return send(res, listSets());
    if (url.pathname === '/api/set') return send(res, setDetail(q.get('id')));
    if (url.pathname === '/api/audience') return send(res, { matched: matchAudience(loadSet(q.get('set')), { countries: q.getAll('country'), sectors: q.getAll('sector'), ageMin: q.get('ageMin'), ageMax: q.get('ageMax'), text: q.get('text') }).length });
    if (url.pathname === '/api/job') { const j = jobStatus(q.get('id')); return j ? send(res, j) : send(res, { error: 'Job not found.' }, 404); }
    if (url.pathname === '/api/job/people') return send(res, jobPeople(q.get('id'), Math.max(0, Number(q.get('from')) || 0), Math.min(500, Number(q.get('limit')) || 100), loadSet));
    if (url.pathname === '/api/run') return send(res, bundle(loadRun(pickRun(req, q), true)));
    if (url.pathname === '/api/report') { const { dir } = loadRun(pickRun(req, q)); return send(res, fs.existsSync(`${dir}/report.json`) ? readJson(`${dir}/report.json`) : {}); }
    if (url.pathname === '/api/people') return send(res, people(loadRun(pickRun(req, q)), q));
    if (url.pathname === '/api/agent') { const R = loadRun(pickRun(req, q)), id = Number(q.get('id')); return send(res, { persona: R.byId.get(id), walk: R.walks.get(id) || null }); }
    if (url.pathname === '/api/day') return send(res, { text: await dayStory(loadRun(pickRun(req, q)), Number(q.get('id')), Number(q.get('day'))) });
    if (url.pathname === '/api/thought') return send(res, { text: await thought(loadRun(pickRun(req, q)), Number(q.get('id')), Number(q.get('i'))) });
    let file;
    const parts = url.pathname.split('/').filter(Boolean).map(s => path.basename(s));
    if (parts[0] === 'draft' && parts.length === 3) file = path.join(draftDir(parts[1]), parts[2]);
    else if (parts[0] === 'screens' && parts.length === 3) file = path.join('runs', pickRun(req, q), 'screens', parts[1], parts[2]);
    else if (parts[0] === 'creatives' && parts.length === 2) file = path.join('runs', pickRun(req, q), 'creatives', parts[1]);
    else if (!parts.length && !fs.existsSync(`runs/${defaultRun}/run.json`) && !q.get('run')) { res.statusCode = 302; res.setHeader('Location', '/new.html'); return res.end(); }
    else file = path.join('public', parts.length ? parts[parts.length - 1] : 'index.html');
    if (!ID_RE.test(pickRun(req, q)) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e.status) return send(res, { error: e.message }, e.status);
    console.error('request failed', url.pathname, String(e.message || e).slice(0, 200));
    send(res, { error: String(e.message || e).slice(0, 300) }, 500);
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port} run=${defaultRun}`));
