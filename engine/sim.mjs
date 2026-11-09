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
const WD = ['월', '화', '수', '목', '금', '토', '일'];

const ptext = p => `${p.name}, ${p.age}세 ${p.gender}, ${p.city}. ${p.job} (${p.workplace}). ${p.household}. 소득 ${p.incomeMonthly}, 자유 지출 ${p.disposableMonthly}. 평일: ${p.weekday} 자주 쓰는 앱: ${(p.apps || []).join(', ')}. 구독: ${(p.subscriptions || []).map(s => `${s.name} ${s.monthly}`).join(', ') || '없음'}. 좋아하는 것: ${p.likes} 요즘 목표: ${p.goal} 스트레스: ${p.stress} 최근 후회한 소비: ${p.regret} 광고 태도: ${p.adView} 인내심 ${p.patience}, 가격 민감도 ${p.priceSensitivity}, 개인정보 민감도 ${p.privacyConcern}, 기술 친숙도 ${p.techComfort}, 충동구매 ${p.impulse}.`;

// What the person is doing at that time, from their own daily plan.
function moment(p, day, hour) {
  const m = Life.at(p, day, hour), wd = ((day % 7) + 7) % 7;
  return { kind: m.kind, text: m.label, label: `${WD[wd]}요일 ${Math.floor(hour)}시` };
}

const cleanTag = (v, forward) => { const t = String(v || '').trim(); return !t || /[\u4e00-\u9fff]/.test(t) ? (forward ? '관심이 생김' : '끌리지 않음') : t.slice(0, 30); };

// The model's stated likelihood decides the action by a seeded draw. Picking only its top choice would collapse almost everyone into "leave".
async function decide(p, ctx) {
  const parts = [{ type: 'text', text: `너는 아래 사람이다. 실제 이 사람처럼 판단한다. 일부러 호의적이지도 부정적이지도 않게, 이 사람의 삶과 지갑과 지금 상황으로 판단한다.
사람: ${ptext(p)}
지금: ${ctx.when}
${ctx.history.length ? `지난 기록: ${ctx.history.join(' / ')}` : ''}
${ctx.ask}
고를 수 있는 행동: ${Object.entries(ctx.acts).map(([k, v]) => `${k}=${v}`).join(', ')}
앞으로 나아가는 행동: ${ctx.go.join(', ')}
go와 stop은 둘 다 반드시 한국어로 채운다. 중국어·영어를 섞지 않는다. JSON만 출력: {"action":"가장 그럴듯한 행동 키","p":앞으로 나아가는 행동을 할 가능성 0-100,"attention":지금 집중도 0-100,"go":"그래도 나아간다면 끌린 점, 15자 이내 한국어","stop":"멈춘다면 걸린 점, 15자 이내 한국어"${ctx.canReturn ? ',"back":멈춘 뒤 나중에 다시 와 볼 가능성 0-100,"backHours":돌아온다면 몇 시간 뒤 숫자' : ''}}` }];
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
  landing: '링크를 눌러 이 웹페이지를 폰으로 봤다. 현실에서 처음 보는 제품 페이지는 절반 이상이 몇 초 안에 닫힌다.',
  pricing: '요금 페이지를 봤다.',
  store: '아이폰 앱스토어 페이지를 봤다. 화면의 Mac App Store 버튼과 macOS 문구는 캡처에서 생긴 것이니 없는 것으로 친다. 현실에서 앱스토어 페이지를 본 사람의 약 30%가 설치한다. p는 이 기준에 맞춰 답한다.',
  onboarding: '앱을 설치하고 처음 열었다. 시작하려면 다음을 눌러 계정을 만들어야 한다. 현실에서 설치한 사람의 약 60%가 이 단계를 넘는다.',
  result: '직접 녹음을 한 번 해 봤고 이런 정리 결과 화면을 받았다. 현실에서 첫 사용 뒤 계속 쓰는 사람은 절반이 안 된다.',
  paywall: '요금 안내 화면이 떴다. 닫으면 무료로 계속 쓸 수 있고 무료 한도는 누적 60분이다. 현실에서 이 화면을 본 사람의 약 5%만 체험이나 구독을 시작한다. p는 이 기준에 맞춰 답한다.',
};
const ACTS = {
  landing: { next: '요금을 살펴본다', store: '앱 받기를 누른다', leave: '창을 닫는다' },
  pricing: { store: '앱 받기를 누른다', leave: '창을 닫는다' },
  store: { install: '받기를 눌러 설치한다', leave: '설치하지 않고 나간다' },
  onboarding: { next: '계정을 만들고 시작한다', leave: '앱을 닫고 다시 안 연다' },
  result: { next: '계속 쓴다', leave: '더 안 쓴다' },
  paywall: { annual: '연간 3일 무료 체험을 시작한다', weekly: '주간 구독을 시작한다', free: '닫고 무료로 쓴다', leave: '앱을 지운다' },
};

const stageOf = id => cfg.stages.find(s => s.id === id);
const askOf = id => stageOf(id)?.ask ?? ASK[id];
const actsOf = id => stageOf(id)?.acts ?? ACTS[id];
const nextOf = id => cfg.stages[cfg.stages.findIndex(s => s.id === id) + 1]?.id;
const isScreen = id => !!stageOf(id) && !['paywall', 'trial', 'retain'].includes(id);
const wall = actsOf('paywall');
const buy = ['annual', 'weekly'].filter(k => wall[k]);
const { annual: annualPrice, weekly: weeklyPrice, trialDays = 3 } = cfg.prices;
const FREE_CHECK = cfg.freeCheckAsk ?? '며칠이 지났다. 앱에서 무료 60분 중 일부를 쓴 뒤 오늘 다시 열지 고른다.';

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
        when: `${m.label}, ${e.during} 중에 ${e.app}을(를) 보고 있다.`, history,
        ask: `피드를 넘기다 이 광고가 약 1.5초 눈에 들어왔다.${k ? ` 이 광고를 벌써 ${k}번 봤다.` : ''} 현실에서 사람들은 광고 100번 중 1~3번만 누른다. p는 이 기준에 맞춰 답한다. 관심이 정말 커야 높게 준다.`,
        acts: { click: '광고를 눌러 앱스토어로 간다', skip: '넘긴다' }, go: ['click'], draw: r, image: `${dir}/creatives/${c.id}-${lang}.jpg`,
      });
      rec('ad', d, { creative: c.id, app: e.app, seen: k + 1 });
      if (d.action === 'click') { clicked = true; break; }
      history.length = 0; history.push(`이 광고를 ${k + 1}번 봤고 넘겼다 (${d.tag})`);
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
        if (abs() < cfg.days * 24) { history.push(`${d.backHours}시간 뒤 다시 봤다`); continue; }
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
    history.push(`요금 화면: ${wall[d.action]} (${d.tag})`);
    if (d.action === 'leave') return finish();
    if (d.action === 'annual' || d.action === 'weekly') { plan = d.action; break; }
    advance(120 + Math.floor(r() * 96));
    if (abs() >= cfg.days * 24) return finish();
    const again = await decide(p, { when: `${moment(p, day, hour).label}.`, history, ask: FREE_CHECK, acts: { open: '다시 열어 쓴다', drop: '이제 안 연다' }, go: ['open'], draw: r });
    rec('retain', again, { freeCheck: true });
    history.push(`다시 열기: ${again.action} (${again.tag})`);
    if (again.action === 'drop') return finish();
  }
  if (!plan) { visits.push({ stage: 'retain', t: abs(), action: 'free_active', p: 50, att: 50, tag: '무료로 계속 사용' }); return finish(); }

  // Trial end and renewal
  if (plan === 'annual' && !trialDays) {
    visits.push({ stage: 'trial', t: abs() + 1, action: 'pay', p: 100, att: 70, tag: '연간 결제', plan });
    visits.push({ stage: 'retain', t: abs() + 2, action: 'paid_annual', p: 100, att: 70, tag: '연간 결제 완료', plan });
    return finish();
  }
  if (plan === 'annual') {
    advance(trialDays * 24);
    const d = await decide(p, { when: `${moment(p, day, hour).label}. ${trialDays}일 무료 체험이 오늘 끝난다.`, history, ask: `오늘 안에 해지하지 않으면 연 $${annualPrice}(또는 현지 금액)가 결제된다. 지난 3일 동안 이 사람의 실제 사용을 상상해 판단한다. 현실에서 체험자의 약 3분의 1만 결제까지 간다. p는 이 기준에 맞춰 답한다.`, acts: { pay: '유지해서 결제된다', cancel: '해지한다' }, go: ['pay'], draw: r });
    rec('trial', d, { plan });
    if (d.action === 'cancel') return finish();
    visits.push({ stage: 'retain', t: abs() + 1, action: 'paid_annual', p: d.p, att: d.attention, tag: '연간 결제 완료', plan });
    return finish();
  }
  // weekly: charged now, then decides at week 1 and week 3
  visits.push({ stage: 'trial', t: abs() + 1, action: 'pay', p: 100, att: 70, tag: '주간 첫 결제', plan });
  let weeks = 1;
  for (const w of [1, 3]) {
    advance(w === 1 ? 168 : 336);
    if (abs() >= cfg.days * 24) break;
    const d = await decide(p, { when: `${moment(p, day, hour).label}. 구독 ${weeks}주차.`, history, ask: `매주 $${weeklyPrice}가 계속 결제된다. 지금까지 쓴 만큼 돈값을 하는지 판단한다. 현실에서 주간 구독자의 절반가량이 몇 주 안에 해지한다.`, acts: { keep: '구독을 유지한다', cancel: '해지한다' }, go: ['keep'], draw: r });
    rec('retain', d, { plan });
    history.push(`구독 판단: ${d.action} (${d.tag})`);
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
