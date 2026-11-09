// Report for a 30-day run. Counts come from the walks; the model only groups reasons, voices people and writes prose.
// usage: node engine/report30.mjs <run>
import fs from 'node:fs';
import { chat, pool, readJson, writeJson, usage, imageUrl } from './lib.mjs';
import '../public/calc.js';
const Calc = globalThis.Calc;
const run = process.argv[2];
const dir = `runs/${run}`, cfg = readJson(`${dir}/run.json`), creatives = readJson(`${dir}/creatives.json`);
const jsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const people = new Map(jsonl(`sets/${cfg.set}/personas.jsonl`).map(p => [p.id, p]));
const walks = jsonl(`${dir}/walks.jsonl`);
const A = walks.map(w => { const p = people.get(w.id); return { id: w.id, p, country: p.country, age: p.age, gender: p.gender, sector: p.sector, st: w.source.type, src: w.source.id, moment: w.moment, lang: w.lang, w: w.paidWeeks || 0, v: w.visits.map(x => ({ s: x.stage, t: x.t, a: x.action, p: x.p, att: x.att, tag: x.tag, rev: x.revisit ? 1 : 0, cr: x.creative, plan: x.plan, raw: x })) }; }).filter(a => a.v.length);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, t, d = 1) => (t ? (a / t * 100).toFixed(d) + '%' : '-');
const STOP = new Set(['skip', 'leave', 'cancel', 'drop']);
const title = s => (s === 'ad' ? 'Ad' : cfg.stages.find(x => x.id === s)?.title || s);
const last = a => a.v[a.v.length - 1];
const paid = A.filter(a => a.st === 'ad');
const isPayer = a => a.v.some(v => v.a === 'weekly' || (v.a === 'pay' && v.plan === 'annual'));
const isInstall = a => a.v.some(v => v.a === 'install');
const fin = Calc.finance(paid, paid, cfg.defaults, cfg.prices);

// Stage table
const stages = ['ad', ...cfg.stages.map(s => s.id)].map(s => {
  const reach = A.filter(a => a.v.some(v => v.s === s)).length, out = A.filter(a => last(a)?.s === s && STOP.has(last(a).a)).length;
  return { s, title: title(s), reach, out };
});
const cut = (fn, list = A) => { const m = new Map(); for (const a of list) { const k = fn(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); } return [...m].map(([k, l]) => ({ k, n: l.length, install: l.filter(isInstall).length, payers: l.filter(isPayer).length })); };
const bandOf = a => (a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 55 ? '45-54' : '55+');
const MOM = { commute_am: 'AM commute', commute_pm: 'PM commute', lunch: 'Lunch', work: 'Work', evening: 'Evening', morning: 'Morning', late: 'Late night', weekend: 'Weekend', out: 'Out' };
const byCountry = cut(a => (a.country === 'KR' ? 'Korea' : 'US')), byAge = cut(a => bandOf(a.age)).sort((x, y) => x.k.localeCompare(y.k)), bySector = cut(a => a.sector).sort((x, y) => y.install / y.n - x.install / x.n);
const byMoment = cut(a => MOM[a.moment] || a.moment, paid).map(x => ({ ...x, ctr: paid.filter(a => (MOM[a.moment] || a.moment) === x.k && a.v.some(v => v.a === 'click')).length })).sort((x, y) => y.ctr / y.n - x.ctr / x.n);
const creativeRows = creatives.map(c => { const l = paid.filter(a => a.src === c.id), f = Calc.finance(l, paid, cfg.defaults, cfg.prices); return { c, n: f.counts.impressions, people: l.length, click: f.counts.clicked, install: f.counts.installed, payers: f.counts.annualPaid + f.counts.weekly, cal: f.cal, pure: f.pure }; }).sort((x, y) => y.cal.roasD30 - x.cal.roasD30);
const clickAt = {}; for (const a of paid) { const adv = a.v.filter(v => v.s === 'ad'); adv.forEach((v, i) => { const k = i + 1; clickAt[k] = clickAt[k] || { shown: 0, click: 0 }; clickAt[k].shown++; if (v.a === 'click') clickAt[k].click++; }); }
const byApp = {}; for (const a of paid) for (const v of a.v) if (v.s === 'ad') { const k = v.raw.app; byApp[k] = byApp[k] || { shown: 0, click: 0 }; byApp[k].shown++; if (v.a === 'click') byApp[k].click++; }
const appRows = Object.entries(byApp).sort((x, y) => y[1].shown - x[1].shown).slice(0, 10);
const revisitTotal = A.filter(a => a.v.some(v => v.rev)).length;
const revisitInstall = A.filter(a => a.v.some(v => v.a === 'install' && v.rev)).length;

// Reasons: categories first, then every person classified, so counts add up.
const groups = {};
for (const st of stages.filter(x => x.out > 0 && x.s !== 'ad')) {
  const list = A.filter(a => last(a)?.s === st.s && STOP.has(last(a).a));
  const sample = list.slice(0, 400).map(a => last(a).tag);
  const cats = list.length < 8 ? ['Other reasons'] : (await chat([{ role: 'user', content: `These are reasons fictional users left when they stopped at the "${st.title}" step. Make 4 to 6 reason categories that do not overlap, each at most 5 words. Write in English only. Do not mix in any other language. JSON only: {"cats":["..."]}\n${sample.join('\n')}` }], { max_tokens: 400, temperature: 0.2 })).cats;
  const map = new Map(), batches = [];
  for (let i = 0; i < list.length; i += 40) batches.push(list.slice(i, i + 40));
  if (cats.length > 1) await pool(batches, 16, async b => {
    const res = await chat([{ role: 'user', content: `Assign each note to the one category number that fits best.\nCategories: ${cats.map((c, i) => `${i}=${c}`).join(', ')}\nJSON only: {"id number":category number}\n${b.map(a => `${a.id}: ${last(a).tag}`).join('\n')}` }], { max_tokens: 900, temperature: 0 });
    for (const a of b) if (cats[res[String(a.id)]] !== undefined) map.set(a.id, res[String(a.id)]);
  });
  const g = cats.map(() => []), rest = [];
  for (const a of list) (cats.length === 1 ? g[0] : map.has(a.id) ? g[map.get(a.id)] : rest).push(a.id);
  groups[st.s] = cats.map((reason, i) => ({ reason, ids: g[i] })).filter(x => x.ids.length).sort((m, n) => n.ids.length - m.ids.length);
  if (rest.length) groups[st.s].push({ reason: 'Not classified', ids: rest });
  if (groups[st.s].reduce((n, x) => n + x.ids.length, 0) !== list.length) throw new Error('reason counts do not add up: ' + st.s);
  console.log(st.title, list.length, groups[st.s].map(x => `${x.reason}:${x.ids.length}`).join(' | '));
}

// People's own words
const thoughtsFile = `${dir}/thoughts.json`;
const thoughts = fs.existsSync(thoughtsFile) ? readJson(thoughtsFile) : {};
async function voice(a, i) {
  const v = a.v[i], p = a.p, key = `${a.id}:${i}`;
  if (!thoughts[key]) {
    const image = v.s === 'ad' ? `${dir}/creatives/${v.cr}-${a.lang}.jpg` : cfg.stages.find(s => s.id === v.s)?.image ? `${dir}/screens/${a.lang}/${v.s}.jpg` : null;
    const parts = [{ type: 'text', text: `You are ${p.name} (age ${p.age}, ${p.job}, ${p.city}). Household: ${p.household}. Free to spend: ${p.disposableMonthly}. Apps you use: ${(p.apps || []).join(', ')}. Current goal: ${p.goal} Stress: ${p.stress} Usual way of speaking: ${p.voice} Something you often say: "${p.quote}"
${image ? 'Looking at the attached screen,' : 'About the subscription,'} you acted like this: ${v.a}. Your note on why at the time: "${v.tag}". Write what went through your head at that moment, 2 to 3 sentences in this person's way of speaking. ${image ? 'Point to one phrase or price actually visible on the screen, translated into English if the screen is in another language.' : ''} Mention one thing from this person's daily life. Do not reverse the action. Write in English only, do not mix in any other language, no quotation marks.` }];
    if (image) parts.push({ type: 'image_url', image_url: { url: imageUrl(image) } });
    thoughts[key] = (await chat([{ role: 'user', content: parts }], { json: false, max_tokens: 400 })).trim();
  }
  return { id: a.id, name: p.name, job: p.job, age: p.age, city: p.city, text: thoughts[key] };
}
const byId = new Map(A.map(a => [a.id, a]));
const quotes = {};
for (const st of stages) {
  if (!groups[st.s]) continue;
  quotes[st.s] = [];
  for (const g of groups[st.s].slice(0, 3)) {
    const pick = g.ids.slice(0, 2).map(id => byId.get(id));
    quotes[st.s].push({ reason: g.reason, n: g.ids.length, said: await Promise.all(pick.map(a => voice(a, a.v.length - 1))) });
  }
}
const payersList = A.filter(isPayer).slice(0, 4);
const payerQuotes = await Promise.all(payersList.map(a => voice(a, a.v.findIndex(v => v.a === 'weekly' || v.a === 'annual'))));
writeJson(thoughtsFile, thoughts);

const facts = {
  product: cfg.product, facts: cfg.facts, total: A.length, stages,
  reasons: Object.fromEntries(Object.entries(groups).map(([k, v]) => [title(k), v.map(x => ({ reason: x.reason, n: x.ids.length }))])),
  creatives: creativeRows.map(r => ({ id: r.c.id, angle: r.c.angle, hook: r.c.en.hook, n: r.n, click: r.click, install: r.install, payers: r.payers, calCPI: +r.cal.cpi.toFixed(2), calROAS: +r.cal.roasD30.toFixed(2) })),
  clickByExposure: clickAt, clickByApp: appRows, frequency: fin.counts.freq, byCountry, byAge, bySector: bySector.slice(0, 10), byMoment: byMoment.map(x => ({ moment: x.k, shown: x.n, clicks: x.ctr })),
  revisit: { people: revisitTotal, installs: revisitInstall },
  budget: cfg.defaults.budget, pure: { ctr: fin.pure.rates.ctr, cpi: fin.pure.cpi, roasD7: fin.pure.roasD7, roasD30: fin.pure.roasD30, payers: fin.pure.payers }, calibrated: { ctr: fin.cal.rates.ctr, cpi: fin.cal.cpi, roasD7: fin.cal.roasD7, roasD30: fin.cal.roasD30, payers: fin.cal.payers }, assumptions: cfg.defaults,
};
const w = await chat([{ role: 'user', content: `Below are the totals from a simulation of fictional users. Using only these numbers, write the text a product lead will read. Do not invent numbers. Do not call anything a forecast or a real conversion rate; say "in the simulation". Short declarative sentences. Write in English only. Do not mix in any other language.
limits must include: the persona distributions, daily schedule rules and calibration values are placeholder assumptions; actions were drawn from the likelihood the AI stated, and the prompts told it real-world baselines for each stage, so those assumptions are also in the pure results; ${cfg.limitsNote ?? 'the paywall screen is a capture of an October draft and the App Store page is a web capture'}.
Output JSON only:
{"title":"a title that states the conclusion","summary":"the main conclusion in 2 sentences","priorities":[{"what":"one line on what to fix this week","why":"1 sentence with the supporting number","check":"1 sentence on how to confirm with real people"}],"bestCreative":"the best ad and why, 2 sentences","frequency":"how clicks change with the number of views and which app did better, 2 sentences with supporting numbers","target":"the audience and time of day to target first, 2 sentences with supporting numbers","avoid":"who not to target now, 1 sentence","pureVsCal":"why pure and calibrated results differ and how to use each, 2 sentences","features":["1 sentence on something the product seems to need"],"newAds":["1 line with an ad hook to test next and who it targets"],"limits":"limits in 3 sentences"}
3 priorities, 3 features, 3 newAds.
Totals: ${JSON.stringify(facts)}` }], { model: 'anthropic/claude-sonnet-5.5', max_tokens: 8000, reasoning: { effort: 'low' } });

const table = (rows, heads) => `<table><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${heads[i][1] || ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
const money = v => (v >= 100 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`);
const n0 = v => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
const q = x => `<blockquote>${esc(x.text)}<button data-agent="${x.id}">${esc(x.name)}, ${x.age} · ${esc(x.job)} · See record</button></blockquote>`;
const html = `<span class="tag">Simulation report · ${A.length.toLocaleString('en-US')} fictional users · ${cfg.days} days</span>
<h1>${esc(w.title)}</h1><p class="lede">${esc(w.summary)}</p>
<h2>What to fix this week</h2>${w.priorities.map((x, i) => `<div class="action"><b>${i + 1}. ${esc(x.what)}</b><p>${esc(x.why)}</p><p class="note dim">Check: ${esc(x.check)}</p></div>`).join('')}
<h2>If you spend an ad budget of $${cfg.defaults.budget.toLocaleString('en-US')}</h2>
${table([['Click rate', (fin.pure.rates.ctr * 100).toFixed(1) + '%', (fin.cal.rates.ctr * 100).toFixed(2) + '%'], ['Installs', n0(fin.pure.installs), n0(fin.cal.installs)], ['Payers', n0(fin.pure.payers), n0(fin.cal.payers)], ['CPI', money(fin.pure.cpi), money(fin.cal.cpi)], ['7-day ROAS', fin.pure.roasD7.toFixed(2), fin.cal.roasD7.toFixed(2)], ['30-day ROAS', fin.pure.roasD30.toFixed(2), fin.cal.roasD30.toFixed(2)]], [['Metric'], ['Pure simulation', 'num'], ['Calibrated (placeholder values)', 'num']])}
<p>${esc(w.pureVsCal)}</p><p class="note dim">Placeholder calibration values: CPM $${cfg.defaults.cpm}, click rate ${cfg.defaults.ctr}%, click to install ${cfg.defaults.clickToInstall}%, onboarding ${cfg.defaults.onboardingDone}%, first result ${cfg.defaults.firstResult}%, paywall conversion ${cfg.defaults.paywallConvert}%, trial to paid ${cfg.defaults.trialToPaid}%, weekly renewal ${cfg.defaults.weeklyRenew}%. Change them with the gauges on the Simulation tab.</p>
<h2>Ads</h2><p>${esc(w.bestCreative)}</p>
<div class="adimg">${creativeRows.map(r => `<div><img src="/creatives/${r.c.id}-en.jpg" alt="${esc(r.c.en.hook)}" data-zoom="/creatives/${r.c.id}-en.jpg"><p>${r.c.id.toUpperCase()} · ${esc(r.c.angle)}</p></div>`).join('')}</div>
${table(creativeRows.map(r => [`${r.c.id.toUpperCase()} ${esc(r.c.en.hook)}`, r.n, pct(r.click, r.n), r.install, r.payers, money(r.cal.cpi), r.cal.roasD30.toFixed(2)]), [['Ad'], ['Views', 'num'], ['Clicks per view', 'num'], ['Installs', 'num'], ['Payers', 'num'], ['Calibrated CPI', 'num'], ['Calibrated ROAS', 'num']])}
<h3>Number of views and apps</h3><p>${esc(w.frequency)}</p>
${table(Object.entries(clickAt).map(([k, x]) => [`View ${k}`, x.shown.toLocaleString('en-US'), x.click, pct(x.click, x.shown)]), [['View'], ['People', 'num'], ['Clicks', 'num'], ['Click rate', 'num']])}
${table(appRows.map(([k, x]) => [esc(k), x.shown.toLocaleString('en-US'), x.click, pct(x.click, x.shown)]), [['App'], ['Views', 'num'], ['Clicks', 'num'], ['Click rate', 'num']])}
<h3>Ads to test next</h3>${w.newAds.map(x => `<p>${esc(x)}</p>`).join('')}
<h2>Drop-off by stage</h2>${table(stages.map(s => [esc(s.title), s.reach.toLocaleString('en-US'), s.out.toLocaleString('en-US'), pct(s.out, s.reach)]), [['Stage'], ['Reached', 'num'], ['Left', 'num'], ['Drop-off rate', 'num']])}
<p class="note dim">${revisitTotal.toLocaleString('en-US')} people came back, and ${revisitInstall.toLocaleString('en-US')} installed on a return visit.</p>
<h2>What users said</h2>
${stages.filter(s => quotes[s.s]).map(s => `<h3>People who stopped at ${esc(s.title)}</h3>${table(groups[s.s].map(g => [esc(g.reason), g.ids.length.toLocaleString('en-US')]), [['Reason'], ['People', 'num']])}${quotes[s.s].flatMap(g => g.said.map(q)).join('')}`).join('')}
<h3>People who started paying</h3>${payerQuotes.map(q).join('')}
<h2>Who to target and when</h2><p>${esc(w.target)}</p><p>${esc(w.avoid)}</p>
<h3>Country</h3>${table(byCountry.map(x => [x.k, x.n.toLocaleString('en-US'), x.install, pct(x.install, x.n), x.payers]), [['Country'], ['People', 'num'], ['Installs', 'num'], ['Install rate', 'num'], ['Payers', 'num']])}
<h3>Age</h3>${table(byAge.map(x => [x.k, x.n.toLocaleString('en-US'), x.install, pct(x.install, x.n), x.payers]), [['Age'], ['People', 'num'], ['Installs', 'num'], ['Install rate', 'num'], ['Payers', 'num']])}
<h3>Sector (by install rate)</h3>${table(bySector.map(x => [esc(x.k), x.n.toLocaleString('en-US'), x.install, pct(x.install, x.n), x.payers]), [['Sector'], ['People', 'num'], ['Installs', 'num'], ['Install rate', 'num'], ['Payers', 'num']])}
<h3>When they saw the ad (by click rate)</h3>${table(byMoment.map(x => [esc(x.k), x.n.toLocaleString('en-US'), x.ctr, pct(x.ctr, x.n), x.payers]), [['Moment'], ['People', 'num'], ['Clicks', 'num'], ['Click rate', 'num'], ['Payers', 'num']])}
<h2>What the product seems to need</h2>${w.features.map(x => `<p>${esc(x)}</p>`).join('')}
<h2>Limits of this result</h2><p>${esc(w.limits)}</p>
<p class="note dim">"What users said" was generated by fictional users from their profile and the actual screen. No real person said it. People counts are direct tallies of the action records, and the reason categories were sorted by AI.</p>`;
writeJson(`${dir}/report.json`, { title: w.title, html, facts });
console.log(w.title, usage);
