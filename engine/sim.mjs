// 30-day run. Every persona moves through ad/organic entry, web, store, in-app screens, trial and renewal.
// Decisions come from the model; it also gives p, how likely the person was to take the forward action, so calibration can later keep the most likely ones.
// usage: node engine/sim.mjs <run> [limit]
import fs from 'node:fs';
import { chat, pool, imageUrl, readJson, rng, usage } from './lib.mjs';
import '../public/life.js';
const Life = globalThis.Life;
const [run, limit] = process.argv.slice(2);
const dir = `runs/${run}`, cfg = readJson(`${dir}/run.json`), creatives = readJson(`${dir}/creatives.json`);
const out = `${dir}/walks.jsonl`;
// people.json, when a run has one, narrows the set to the people picked for that run.
const picked = fs.existsSync(`${dir}/people.json`) ? new Set(readJson(`${dir}/people.json`)) : null;
const personas = fs.readFileSync(`sets/${cfg.set}/personas.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(p => !picked || picked.has(p.id)).sort((a, b) => a.id - b.id);
const img = {};
const load = p => (img[p] ||= imageUrl(p));
const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const ptext = p => `${p.name}, age ${p.age}, ${p.gender}, ${p.city}. ${p.job} (${p.workplace}). ${p.household}. Income ${p.incomeMonthly}, free to spend ${p.disposableMonthly}. Weekdays: ${p.weekday} Apps used often: ${(p.apps || []).join(', ')}. Subscriptions: ${(p.subscriptions || []).map(s => `${s.name} ${s.monthly}`).join(', ') || 'none'}. Likes: ${p.likes} Current goal: ${p.goal} Stress: ${p.stress} Recently regretted purchase: ${p.regret} View of ads: ${p.adView} Patience ${p.patience}, price sensitivity ${p.priceSensitivity}, privacy concern ${p.privacyConcern}, tech comfort ${p.techComfort}, impulse buying ${p.impulse}.`;

// What the person is doing at that time, from their own daily plan.
function moment(p, day, hour) {
  const m = Life.at(p, day, hour), wd = ((day % 7) + 7) % 7;
  return { kind: m.kind, text: m.label, label: `${WD[wd]} ${Math.floor(hour)}:00` };
}

const cleanTag = (v, forward) => { const t = String(v || '').trim(); return !t || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(t) ? (forward ? 'Got interested' : 'Not drawn in') : t.slice(0, 60); };

// The model's stated likelihood decides the action by a seeded draw. Picking only its top choice would collapse almost everyone into "leave".
async function decide(p, ctx) {
  const parts = [{ type: 'text', text: `You are the person below. Judge the way this person really would. Be neither deliberately favorable nor negative. Judge from this person's life, wallet and current situation.
Person: ${ptext(p)}
Now: ${ctx.when}
${ctx.history.length ? `Earlier record: ${ctx.history.join(' / ')}` : ''}
${ctx.ask}
Actions you can choose: ${Object.entries(ctx.acts).map(([k, v]) => `${k}=${v}`).join(', ')}
Actions that move forward: ${ctx.go.join(', ')}
Fill both go and stop in English only. Do not mix in any other language. Output JSON only: {"action":"the key of the most likely action","p":likelihood of taking a forward action 0-100,"attention":current attention 0-100,"go":"if you did move forward, what drew you, in English, max 8 words","stop":"if you stopped, what put you off, in English, max 8 words"${ctx.canReturn ? ',"back":likelihood of coming back later after stopping 0-100,"backHours":number of hours until you would come back' : ''}}` }];
  if (ctx.image) parts.push({ type: 'image_url', image_url: { url: load(ctx.image) } });
  const d = await chat([{ role: 'user', content: parts }], { max_tokens: 170, temperature: 0.9 });
  const P = Math.max(0, Math.min(100, Math.round(Number(d.p) || 0)));
  const forward = ctx.draw() * 100 < P;
  const stops = Object.keys(ctx.acts).filter(k => !ctx.go.includes(k));
  const action = forward ? (ctx.go.includes(d.action) ? d.action : ctx.go[0]) : (stops.includes(d.action) ? d.action : stops[0]);
  return {
    action, hard: ctx.acts[d.action] ? d.action : stops[0], p: P,
    attention: Math.max(0, Math.min(100, Math.round(Number(d.attention) || 0))),
    tag: cleanTag(forward ? d.go : d.stop, forward),
    back: Math.max(0, Math.min(100, Math.round(Number(d.back) || 0))),
    backHours: Math.max(1, Math.min(240, Math.round(Number(d.backHours) || 48))),
  };
}

// Used when a stage in run.json has no ask/acts of its own. These defaults describe the recording-app funnel of runs/demo, so another product should set its own in run.json.
const ASK = {
  landing: 'You tapped a link and saw this web page on your phone. In reality, more than half of people close a product page they are seeing for the first time within seconds.',
  pricing: 'You saw the pricing page.',
  store: 'You saw the iPhone App Store page. The Mac App Store button and macOS wording on the screen come from the capture, so treat them as not there. In reality, about 30% of people who see an App Store page install. Answer p in line with this baseline.',
  onboarding: 'You installed the app and opened it for the first time. To start you must tap next and create an account. In reality, about 60% of people who install get past this step.',
  result: 'You made one recording and got this summary result screen. In reality, fewer than half of people keep using an app after first use.',
  paywall: 'A pricing screen appeared. If you close it you can keep using the app free, and the free limit is 60 free minutes in total. In reality, only about 5% of people who see this screen start a trial or subscribe. Answer p in line with this baseline.',
};
const ACTS = {
  landing: { next: 'Look at the pricing', store: 'Tap get the app', leave: 'Close the window' },
  pricing: { store: 'Tap get the app', leave: 'Close the window' },
  store: { install: 'Tap get and install', leave: 'Leave without installing' },
  onboarding: { next: 'Create an account and start', leave: 'Close the app and never reopen it' },
  result: { next: 'Keep using it', leave: 'Stop using it' },
  paywall: { annual: 'Start the 3-day free trial of the annual plan', weekly: 'Start the weekly plan', free: 'Close it and use it free', leave: 'Delete the app' },
};

const stageOf = id => cfg.stages.find(s => s.id === id);
const askOf = id => stageOf(id)?.ask ?? ASK[id];
const actsOf = id => stageOf(id)?.acts ?? ACTS[id];
const nextOf = id => cfg.stages[cfg.stages.findIndex(s => s.id === id) + 1]?.id;
const isScreen = id => !!stageOf(id) && !['paywall', 'trial', 'retain'].includes(id);
const wall = actsOf('paywall');
const buy = ['annual', 'weekly'].filter(k => wall[k]);
const { annual: annualPrice, weekly: weeklyPrice, trialDays = 3 } = cfg.prices;
const FREE_CHECK = cfg.freeCheckAsk ?? 'A few days have passed. After using part of the 60 free minutes in the app, choose whether to open it again today.';

async function walk(p, i) {
  const r = rng(p.id * 7919 + 13);
  const lang = p.country === 'KR' ? 'ko' : 'en';
  const paid = r() < cfg.paidShare;
  let source, entry;
  if (paid) { const c = creatives[Math.floor(r() * creatives.length)]; source = { type: 'ad', id: c.id }; entry = 'ad'; }
  else { let v = r(), o = cfg.organic[0]; for (const x of cfg.organic) { v -= x.share; if (v <= 0) { o = x; break; } } source = { type: 'organic', id: o.id }; entry = o.entry; }

  // Organic visitors arrive during one of their ordinary phone sessions.
  let day = 0, hour = 20;
  if (!paid) {
    day = Math.floor(r() * 14);
    const ss = Life.plan(p, day).sessions;
    hour = ss.length ? ss[Math.floor(r() * ss.length)].h : 20;
  }
  let firstMoment = moment(p, day, hour);
  const visits = [], history = [];
  const abs = () => day * 24 + hour;
  const advance = h => { const t = abs() + h; day = Math.floor(t / 24); hour = t - day * 24; };
  const rec = (stage, d, extra = {}) => visits.push({ stage, t: Math.round(abs() * 100) / 100, action: d.action, hard: d.hard, p: d.p, att: d.attention, tag: d.tag, ctx: moment(p, day, hour).text, ...extra });

  // The ad meets this person several times inside their own apps, and they remember earlier sightings.
  let cur = entry;
  if (entry === 'ad') {
    const c = creatives.find(x => x.id === source.id);
    const seen = Life.exposures(p);
    let clicked = false;
    for (let k = 0; k < seen.length; k++) {
      const e = seen[k];
      day = e.day; hour = e.hour;
      const m = moment(p, day, hour);
      firstMoment = m;
      const d = await decide(p, {
        when: `${m.label}. During "${e.during}" you are looking at ${e.app}.`, history,
        ask: `Scrolling the feed, this ad caught your eye for about 1.5 seconds.${k ? ` You have already seen this ad ${k} time(s).` : ''} In reality, people click only 1 to 3 of 100 ads. Answer p in line with this baseline. Give it a high value only if your interest is truly strong.`,
        acts: { click: 'Tap the ad and go to the app store', skip: 'Scroll past' }, go: ['click'], draw: r, image: `${dir}/creatives/${c.id}-${lang}.jpg`,
      });
      rec('ad', d, { creative: c.id, app: e.app, seen: k + 1 });
      if (d.action === 'click') { clicked = true; break; }
      history.length = 0; history.push(`Saw this ad ${k + 1} time(s) and scrolled past (${d.tag})`);
    }
    if (!clicked) return finish();
    source.seen = visits.length;
    cur = cfg.adEntry || 'store';
  }

  // Web, store and in-app screens. People who leave may return once per stage.
  const returned = new Set();
  while (isScreen(cur)) {
    const m = moment(p, day, hour), st = stageOf(cur), acts = actsOf(cur);
    const d = await decide(p, { when: `${m.label}, ${m.text}.`, history, ask: askOf(cur), acts, go: Object.keys(acts).filter(k => k !== 'leave'), draw: r, image: st.image ? `${dir}/screens/${lang}/${cur}.jpg` : null, canReturn: !returned.has(cur) });
    rec(cur, d, returned.has(cur) ? { revisit: true } : {});
    history.push(`${st.ask ? st.title : cur}: ${acts[d.action]} (${d.tag})`);
    if (d.action === 'leave') {
      if (!returned.has(cur) && r() * 100 < d.back) {
        returned.add(cur); advance(d.backHours);
        if (abs() < cfg.days * 24) { history.push(`Looked again ${d.backHours} hours later`); continue; }
      }
      return finish();
    }
    // An action named after a stage jumps there; anything else moves to the next stage in run.json.
    if (d.action === 'install') visits[visits.length - 1].installed = true;
    if (cur === 'onboarding') advance(Math.floor(r() * 30));
    cur = stageOf(d.action) ? d.action : nextOf(cur);
  }

  // Paywall: first look, then a second look a week later for free users
  let plan = null;
  for (let look = 0; look < 2 && !plan; look++) {
    const m = moment(p, day, hour);
    const d = await decide(p, { when: `${m.label}, ${m.text}.`, history, ask: askOf('paywall'), acts: wall, go: buy, draw: r, image: stageOf('paywall').image ? `${dir}/screens/${lang}/paywall.jpg` : null });
    rec('paywall', d, look ? { revisit: true } : {});
    history.push(`Pricing screen: ${wall[d.action]} (${d.tag})`);
    if (d.action === 'leave') return finish();
    if (d.action === 'annual' || d.action === 'weekly') { plan = d.action; break; }
    advance(120 + Math.floor(r() * 96));
    if (abs() >= cfg.days * 24) return finish();
    const again = await decide(p, { when: `${moment(p, day, hour).label}.`, history, ask: FREE_CHECK, acts: { open: 'Open it again and use it', drop: 'Stop opening it' }, go: ['open'], draw: r });
    rec('retain', again, { freeCheck: true });
    history.push(`Reopen: ${again.action} (${again.tag})`);
    if (again.action === 'drop') return finish();
  }
  if (!plan) { visits.push({ stage: 'retain', t: abs(), action: 'free_active', p: 50, att: 50, tag: 'Keeps using it free' }); return finish(); }

  // Trial end and renewal
  if (plan === 'annual' && !trialDays) {
    visits.push({ stage: 'trial', t: abs() + 1, action: 'pay', p: 100, att: 70, tag: 'Annual payment', plan });
    visits.push({ stage: 'retain', t: abs() + 2, action: 'paid_annual', p: 100, att: 70, tag: 'Annual plan paid', plan });
    return finish();
  }
  if (plan === 'annual') {
    advance(trialDays * 24);
    const d = await decide(p, { when: `${moment(p, day, hour).label}. The ${trialDays}-day free trial ends today.`, history, ask: `Unless you cancel today, you will be charged $${annualPrice} per year (or the local amount). Imagine how this person really used it over the past 3 days and judge from that. In reality, only about a third of people on a trial go on to pay. Answer p in line with this baseline.`, acts: { pay: 'Keep it and get charged', cancel: 'Cancel' }, go: ['pay'], draw: r });
    rec('trial', d, { plan });
    if (d.action === 'cancel') return finish();
    visits.push({ stage: 'retain', t: abs() + 1, action: 'paid_annual', p: d.p, att: d.attention, tag: 'Annual plan paid', plan });
    return finish();
  }
  // weekly: charged now, then decides at week 1 and week 3
  visits.push({ stage: 'trial', t: abs() + 1, action: 'pay', p: 100, att: 70, tag: 'First weekly payment', plan });
  let weeks = 1;
  for (const w of [1, 3]) {
    advance(w === 1 ? 168 : 336);
    if (abs() >= cfg.days * 24) break;
    const d = await decide(p, { when: `${moment(p, day, hour).label}. Week ${weeks} of the subscription.`, history, ask: `You keep being charged $${weeklyPrice} every week. Judge whether what you have used so far is worth the money. In reality, about half of weekly subscribers cancel within weeks.`, acts: { keep: 'Keep the subscription', cancel: 'Cancel' }, go: ['keep'], draw: r });
    rec('retain', d, { plan });
    history.push(`Subscription decision: ${d.action} (${d.tag})`);
    if (d.action === 'cancel') return finish(weeks);
    weeks += w === 1 ? 2 : 1;
  }
  return finish(Math.min(weeks + 1, 5));

  function finish(paidWeeks) {
    const row = { id: p.id, source, moment: firstMoment.kind, lang, visits };
    if (paidWeeks) row.paidWeeks = paidWeeks;
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
  }
}

const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const todo = personas.filter(p => !done.has(p.id)).slice(0, limit ? Number(limit) : undefined);
if (process.env.SIM_REVERSE) todo.reverse();
await pool(todo, Number(process.env.CONC || 40), async (p, i) => {
  try { await walk(p, i); } catch (e) { console.log('fail', p.id, String(e).slice(0, 160)); }
}, (d, t) => { if (d % 250 === 0 || process.env.SIM_PROGRESS) console.log(`sim ${d}/${t} $${usage.cost.toFixed(3)} calls ${usage.calls} fails ${usage.fails}`); });
console.log('done', usage);
