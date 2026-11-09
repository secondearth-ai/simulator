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
const title = s => (s === 'ad' ? '광고' : cfg.stages.find(x => x.id === s)?.title || s);
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
const MOM = { commute_am: '출근길', commute_pm: '퇴근길', lunch: '점심', work: '일과 중', evening: '저녁', morning: '아침', late: '심야', weekend: '주말', out: '외출 중' };
const byCountry = cut(a => (a.country === 'KR' ? '한국' : '미국')), byAge = cut(a => bandOf(a.age)).sort((x, y) => x.k.localeCompare(y.k)), bySector = cut(a => a.sector).sort((x, y) => y.install / y.n - x.install / x.n);
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
  const cats = list.length < 8 ? ['이유 기타'] : (await chat([{ role: 'user', content: `가상 사용자들이 "${st.title}" 단계에서 멈추며 남긴 이유다. 겹치지 않는 이유 분류 4~6개를 만든다. 각 15자 이내. JSON만: {"cats":["..."]}\n${sample.join('\n')}` }], { max_tokens: 400, temperature: 0.2 })).cats;
  const map = new Map(), batches = [];
  for (let i = 0; i < list.length; i += 40) batches.push(list.slice(i, i + 40));
  if (cats.length > 1) await pool(batches, 16, async b => {
    const res = await chat([{ role: 'user', content: `각 메모를 가장 맞는 분류 번호 하나로 나눈다.\n분류: ${cats.map((c, i) => `${i}=${c}`).join(', ')}\nJSON만: {"id숫자":분류번호}\n${b.map(a => `${a.id}: ${last(a).tag}`).join('\n')}` }], { max_tokens: 900, temperature: 0 });
    for (const a of b) if (cats[res[String(a.id)]] !== undefined) map.set(a.id, res[String(a.id)]);
  });
  const g = cats.map(() => []), rest = [];
  for (const a of list) (cats.length === 1 ? g[0] : map.has(a.id) ? g[map.get(a.id)] : rest).push(a.id);
  groups[st.s] = cats.map((reason, i) => ({ reason, ids: g[i] })).filter(x => x.ids.length).sort((m, n) => n.ids.length - m.ids.length);
  if (rest.length) groups[st.s].push({ reason: '분류 안 됨', ids: rest });
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
    const parts = [{ type: 'text', text: `너는 ${p.name}(${p.age}세, ${p.job}, ${p.city})이다. 가족: ${p.household}. 자유 지출 ${p.disposableMonthly}. 쓰는 앱: ${(p.apps || []).join(', ')}. 요즘 목표: ${p.goal} 스트레스: ${p.stress} 평소 말투: ${p.voice} 평소 하는 말: "${p.quote}"
${image ? '첨부한 화면을 보고' : '구독을 두고'} 이렇게 행동했다: ${v.a}. 당시 이유 메모: "${v.tag}". 그 순간 머릿속 혼잣말을 이 사람 말투로 2~3문장 쓴다. ${image ? '화면에 실제로 보이는 문구나 가격을 하나 짚는다.' : ''} 이 사람의 일상을 하나 언급한다. 행동을 뒤집지 않는다. 한국어로만, 중국어·영어 금지, 따옴표 없이.` }];
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
  creatives: creativeRows.map(r => ({ id: r.c.id, angle: r.c.angle, hook: r.c.ko.hook, n: r.n, click: r.click, install: r.install, payers: r.payers, calCPI: +r.cal.cpi.toFixed(2), calROAS: +r.cal.roasD30.toFixed(2) })),
  clickByExposure: clickAt, clickByApp: appRows, frequency: fin.counts.freq, byCountry, byAge, bySector: bySector.slice(0, 10), byMoment: byMoment.map(x => ({ moment: x.k, shown: x.n, clicks: x.ctr })),
  revisit: { people: revisitTotal, installs: revisitInstall },
  budget: cfg.defaults.budget, pure: { ctr: fin.pure.rates.ctr, cpi: fin.pure.cpi, roasD7: fin.pure.roasD7, roasD30: fin.pure.roasD30, payers: fin.pure.payers }, calibrated: { ctr: fin.cal.rates.ctr, cpi: fin.cal.cpi, roasD7: fin.cal.roasD7, roasD30: fin.cal.roasD30, payers: fin.cal.payers }, assumptions: cfg.defaults,
};
const w = await chat([{ role: 'user', content: `아래는 가상 사용자 시뮬레이션 집계다. 이 숫자만 근거로 제품 책임자가 읽을 문안을 쓴다. 숫자를 지어내지 않는다. 예측이나 실제 전환율이라고 쓰지 않고 "시뮬레이션에서"라고 쓴다. 짧은 평서문, 한국어.
limits에는 다음을 반드시 넣는다: 페르소나 분포·하루 일정 규칙·보정값은 임시 가정이다, AI가 말한 가능성으로 행동을 추첨했고 프롬프트에 단계별 현실 기준을 알려 줘서 순수 결과에도 그 가정이 들어 있다, ${cfg.limitsNote ?? '페이월 화면은 10월 시안 캡처고 앱스토어는 웹 캡처다'}.
JSON만 출력:
{"title":"결론이 담긴 제목","summary":"핵심 결론 2문장","priorities":[{"what":"이번 주 고칠 것 한 줄","why":"근거 숫자 포함 1문장","check":"실제 사람으로 확인하는 방법 1문장"}],"bestCreative":"가장 나은 소재와 근거 2문장","frequency":"광고를 몇 번 노출할 때 클릭이 어떻게 변하는지와 어느 앱이 나았는지, 근거 숫자 포함 2문장","target":"먼저 노릴 타깃과 시간대, 근거 숫자 포함 2문장","avoid":"지금 노리지 않을 대상 1문장","pureVsCal":"순수와 보정 결과가 왜 다른지, 어느 쪽을 어떻게 쓸지 2문장","features":["제품에 필요해 보이는 것 1문장"],"newAds":["다음에 시험할 소재 훅과 노릴 사람 1줄"],"limits":"한계 3문장"}
priorities 3개, features 3개, newAds 3개.
집계: ${JSON.stringify(facts)}` }], { model: 'anthropic/claude-sonnet-5.5', max_tokens: 8000, reasoning: { effort: 'low' } });

const table = (rows, heads) => `<table><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${heads[i][1] || ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
const money = v => (v >= 100 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`);
const n0 = v => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
const q = x => `<blockquote>${esc(x.text)}<button data-agent="${x.id}">${esc(x.name)}, ${x.age}세 · ${esc(x.job)} · 기록 보기</button></blockquote>`;
const html = `<span class="tag">시뮬레이션 보고서 · 가상 사용자 ${A.length.toLocaleString()}명 · ${cfg.days}일</span>
<h1>${esc(w.title)}</h1><p class="lede">${esc(w.summary)}</p>
<h2>이번 주 고칠 것</h2>${w.priorities.map((x, i) => `<div class="action"><b>${i + 1}. ${esc(x.what)}</b><p>${esc(x.why)}</p><p class="note dim">확인: ${esc(x.check)}</p></div>`).join('')}
<h2>광고 예산 $${cfg.defaults.budget.toLocaleString()}을 쓴다면</h2>
${table([['클릭률', (fin.pure.rates.ctr * 100).toFixed(1) + '%', (fin.cal.rates.ctr * 100).toFixed(2) + '%'], ['설치', n0(fin.pure.installs), n0(fin.cal.installs)], ['결제자', n0(fin.pure.payers), n0(fin.cal.payers)], ['CPI', money(fin.pure.cpi), money(fin.cal.cpi)], ['7일 ROAS', fin.pure.roasD7.toFixed(2), fin.cal.roasD7.toFixed(2)], ['30일 ROAS', fin.pure.roasD30.toFixed(2), fin.cal.roasD30.toFixed(2)]], [['지표'], ['순수 시뮬레이션', 'num'], ['보정 (임시 값)', 'num']])}
<p>${esc(w.pureVsCal)}</p><p class="note dim">보정 임시 값: CPM $${cfg.defaults.cpm}, 클릭률 ${cfg.defaults.ctr}%, 클릭→설치 ${cfg.defaults.clickToInstall}%, 온보딩 ${cfg.defaults.onboardingDone}%, 첫 결과 ${cfg.defaults.firstResult}%, 페이월 전환 ${cfg.defaults.paywallConvert}%, 체험→결제 ${cfg.defaults.trialToPaid}%, 주간 갱신 ${cfg.defaults.weeklyRenew}%. 시뮬레이션 탭의 게이지로 바꿀 수 있습니다.</p>
<h2>광고 소재</h2><p>${esc(w.bestCreative)}</p>
<div class="adimg">${creativeRows.map(r => `<div><img src="/creatives/${r.c.id}-ko.jpg" alt="${esc(r.c.ko.hook)}" data-zoom="/creatives/${r.c.id}-ko.jpg"><p>${r.c.id.toUpperCase()} · ${esc(r.c.angle)}</p></div>`).join('')}</div>
${table(creativeRows.map(r => [`${r.c.id.toUpperCase()} ${esc(r.c.ko.hook)}`, r.n, pct(r.click, r.n), r.install, r.payers, money(r.cal.cpi), r.cal.roasD30.toFixed(2)]), [['소재'], ['노출', 'num'], ['노출당 클릭률', 'num'], ['설치', 'num'], ['결제자', 'num'], ['보정 CPI', 'num'], ['보정 ROAS', 'num']])}
<h3>노출 횟수와 앱</h3><p>${esc(w.frequency)}</p>
${table(Object.entries(clickAt).map(([k, x]) => [`${k}번째 노출`, x.shown.toLocaleString(), x.click, pct(x.click, x.shown)]), [['노출'], ['인원', 'num'], ['클릭', 'num'], ['클릭률', 'num']])}
${table(appRows.map(([k, x]) => [esc(k), x.shown.toLocaleString(), x.click, pct(x.click, x.shown)]), [['앱'], ['노출', 'num'], ['클릭', 'num'], ['클릭률', 'num']])}
<h3>다음에 시험할 소재</h3>${w.newAds.map(x => `<p>${esc(x)}</p>`).join('')}
<h2>단계별 이탈</h2>${table(stages.map(s => [esc(s.title), s.reach.toLocaleString(), s.out.toLocaleString(), pct(s.out, s.reach)]), [['단계'], ['도달', 'num'], ['이탈', 'num'], ['이탈률', 'num']])}
<p class="note dim">재방문한 사람 ${revisitTotal.toLocaleString()}명, 재방문에서 설치한 사람 ${revisitInstall.toLocaleString()}명.</p>
<h2>사용자들이 한 말</h2>
${stages.filter(s => quotes[s.s]).map(s => `<h3>${esc(s.title)}에서 멈춘 사람들</h3>${table(groups[s.s].map(g => [esc(g.reason), g.ids.length.toLocaleString()]), [['이유'], ['인원', 'num']])}${quotes[s.s].flatMap(g => g.said.map(q)).join('')}`).join('')}
<h3>결제를 시작한 사람들</h3>${payerQuotes.map(q).join('')}
<h2>누구를 언제 노릴까</h2><p>${esc(w.target)}</p><p>${esc(w.avoid)}</p>
<h3>나라</h3>${table(byCountry.map(x => [x.k, x.n.toLocaleString(), x.install, pct(x.install, x.n), x.payers]), [['나라'], ['인원', 'num'], ['설치', 'num'], ['설치율', 'num'], ['결제자', 'num']])}
<h3>나이</h3>${table(byAge.map(x => [x.k, x.n.toLocaleString(), x.install, pct(x.install, x.n), x.payers]), [['나이'], ['인원', 'num'], ['설치', 'num'], ['설치율', 'num'], ['결제자', 'num']])}
<h3>분야 (설치율 순)</h3>${table(bySector.map(x => [esc(x.k), x.n.toLocaleString(), x.install, pct(x.install, x.n), x.payers]), [['분야'], ['인원', 'num'], ['설치', 'num'], ['설치율', 'num'], ['결제자', 'num']])}
<h3>광고를 본 시간대 (클릭률 순)</h3>${table(byMoment.map(x => [esc(x.k), x.n.toLocaleString(), x.ctr, pct(x.ctr, x.n), x.payers]), [['시간대'], ['인원', 'num'], ['클릭', 'num'], ['클릭률', 'num'], ['결제자', 'num']])}
<h2>제품에 필요해 보이는 것</h2>${w.features.map(x => `<p>${esc(x)}</p>`).join('')}
<h2>이 결과의 한계</h2><p>${esc(w.limits)}</p>
<p class="note dim">"사용자들이 한 말"은 가상 사용자가 자기 프로필과 실제 화면을 보고 생성한 말이며 실제 사람의 발언이 아닙니다. 인원은 행동 기록을 그대로 센 값이고, 이유 분류는 AI가 나눴습니다.</p>`;
writeJson(`${dir}/report.json`, { title: w.title, html, facts });
console.log(w.title, usage);
