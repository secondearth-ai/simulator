// Builds a reusable persona set. A set knows nothing about any product, so any run can reuse it.
// usage: node engine/set.mjs <setId> <count>
import fs from 'node:fs';
import { chat, pool, rng, weighted, writeJson, usage } from './lib.mjs';
const [setId, N = '10000'] = process.argv.slice(2);
const dir = `sets/${setId}`, out = `${dir}/personas.jsonl`;
fs.mkdirSync(dir, { recursive: true });
const r = rng(2026);
// Optional: SET_NAME, SET_BRIEF (who to recruit, in plain words), SET_COUNTRIES (KR, US or both). Without them a set is general adults in KR and US.
const countries = (process.env.SET_COUNTRIES || 'KR,US').split(',');
const brief = process.env.SET_BRIEF || '';
const w = list => list.map(([v, share]) => ({ v, share }));
const pick = list => list[Math.floor(r() * list.length)];

const KR_LAST = w([['Kim', 21], ['Lee', 15], ['Park', 8], ['Choi', 5], ['Jung', 4], ['Kang', 2], ['Cho', 2], ['Yoon', 2], ['Jang', 2], ['Lim', 2], ['Han', 1], ['Oh', 1], ['Seo', 1], ['Shin', 1], ['Kwon', 1], ['Hwang', 1], ['Ahn', 1], ['Song', 1], ['Jeon', 1], ['Hong', 1], ['Yoo', 1], ['Ko', 1], ['Moon', 1], ['Yang', 1], ['Son', 1], ['Bae', 1], ['Baek', 1], ['Heo', 1]]);
const KR_M = ['Minjun', 'Seojun', 'Doyun', 'Yejun', 'Siwoo', 'Juwon', 'Jiho', 'Jihu', 'Hyunwoo', 'Junseo', 'Geonwoo', 'Woojin', 'Sunwoo', 'Seojin', 'Minjae', 'Hyunjun', 'Yeonwoo', 'Jungwoo', 'Seungwoo', 'Seunghyun', 'Sungmin', 'Jaehyun', 'Donghyun', 'Taehoon', 'Sangwoo', 'Jinho', 'Youngho', 'Sungho', 'Kyungsoo', 'Jongmin', 'Byungchul', 'Kihoon', 'Hangyeol', 'Taeyoon', 'Eunho', 'Jaemin', 'Hyungjun', 'Yongjun', 'Daehyun', 'Seokjin'];
const KR_F = ['Seoyeon', 'Seoyun', 'Jiwoo', 'Hayoon', 'Minseo', 'Haeun', 'Jiyu', 'Yunseo', 'Chaewon', 'Sua', 'Jimin', 'Soyul', 'Yeeun', 'Yujin', 'Daeun', 'Subin', 'Jihyun', 'Eunji', 'Hyejin', 'Miyoung', 'Eunkyung', 'Sujin', 'Jungeun', 'Hyunjung', 'Younghee', 'Boram', 'Nayoung', 'Soyeon', 'Areum', 'Seeun', 'Gaeun', 'Juhee', 'Hyewon', 'Minkyung', 'Jiyoung', 'Sunyoung', 'Kyunghee', 'Yuna', 'Harin', 'Dain'];
const US_M = ['James', 'Michael', 'Robert', 'David', 'William', 'Daniel', 'Matthew', 'Anthony', 'Andrew', 'Joshua', 'Ryan', 'Brandon', 'Tyler', 'Kevin', 'Jason', 'Eric', 'Marcus', 'Luis', 'Carlos', 'Jamal', 'Trevor', 'Nathan', 'Aaron', 'Sean', 'Derek', 'Omar', 'Wei', 'Raj', 'Miguel', 'Caleb'];
const US_F = ['Mary', 'Jennifer', 'Linda', 'Sarah', 'Jessica', 'Ashley', 'Emily', 'Megan', 'Rachel', 'Lauren', 'Nicole', 'Amanda', 'Brittany', 'Hannah', 'Olivia', 'Sofia', 'Maria', 'Priya', 'Keisha', 'Tiffany', 'Grace', 'Chloe', 'Madison', 'Danielle', 'Vanessa', 'Yuna', 'Aaliyah', 'Camila', 'Erin', 'Paige'];
const US_LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Nguyen', 'Hill', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Patel', 'Kim', 'Chen', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Howard', 'Ward', 'Cox', 'Diaz', 'Brooks'];

const CITIES = {
  KR: w([['Gangnam-gu, Seoul', 7], ['Mapo-gu, Seoul', 5], ['Songpa-gu, Seoul', 6], ['Nowon-gu, Seoul', 5], ['Gwanak-gu, Seoul', 4], ['Bundang, Seongnam', 6], ['Suwon', 7], ['Ilsan, Goyang', 5], ['Bupyeong, Incheon', 6], ['Haeundae, Busan', 6], ['Suseong-gu, Daegu', 5], ['Yuseong-gu, Daejeon', 4], ['Seo-gu, Gwangju', 3], ['Changwon', 3], ['Jeonju', 2], ['Cheongju', 2]]),
  US: w([['New York, NY', 8], ['Los Angeles, CA', 7], ['Chicago, IL', 5], ['Houston, TX', 5], ['Phoenix, AZ', 4], ['Philadelphia, PA', 3], ['San Antonio, TX', 3], ['San Diego, CA', 3], ['Dallas, TX', 5], ['Austin, TX', 3], ['Seattle, WA', 3], ['Denver, CO', 3], ['Atlanta, GA', 4], ['Miami, FL', 3], ['Boston, MA', 3], ['Columbus, OH', 3], ['Nashville, TN', 2], ['Minneapolis, MN', 2], ['Rural Iowa', 2], ['Small town Georgia', 2]]),
};
const AGES = w([[[18, 24], 16], [[25, 34], 26], [[35, 44], 24], [[45, 54], 20], [[55, 69], 14]]);
const SECTORS = w([['IT & software', 8], ['Manufacturing', 9], ['Healthcare & nursing', 7], ['Education (teachers, instructors)', 7], ['College & grad students', 9], ['Finance & insurance', 5], ['Law & accounting', 3], ['Marketing & advertising', 4], ['Media & content production', 3], ['Events & conferences', 2], ['Public sector', 5], ['Retail & service sales', 9], ['Restaurants & cafes', 5], ['Logistics, transport & delivery', 5], ['Construction & field work', 4], ['Freelance & solo business', 5], ['Startup founders', 2], ['Research & pharma', 3], ['Homemaker or parenting', 4], ['Job seeking', 3], ['Retired', 3]]);
const pct = () => Math.round(Math.min(100, Math.max(0, (r() + r() + r()) / 3 * 100)));
const used = new Set();
function makeName(country, gender) {
  for (let i = 0; i < 200; i++) {
    const n = country === 'KR' ? `${weighted(r, KR_LAST).v} ${pick(gender === 'Male' ? KR_M : KR_F)}` : `${pick(gender === 'Male' ? US_M : US_F)} ${pick(US_LAST)}`;
    if (!used.has(n) || i > 150) { used.add(n); return n; }
  }
}
const seeds = Array.from({ length: Number(N) }, (_, id) => {
  const country = countries[id % countries.length];
  const gender = r() < 0.5 ? 'Male' : 'Female';
  const band = weighted(r, AGES).v;
  let sector = weighted(r, SECTORS).v;
  const age = band[0] + Math.floor(r() * (band[1] - band[0] + 1));
  if (age >= 62 && r() < 0.6) sector = 'Retired';
  if (age <= 23 && r() < 0.6) sector = 'College & grad students';
  return { id, country, gender, age, sector, city: weighted(r, CITIES[country]).v, name: makeName(country, gender),
    patience: pct(), priceSensitivity: pct(), privacyConcern: pct(), techComfort: pct(), adSensitivity: pct(), impulse: pct() };
});

const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const todo = seeds.filter(s => !done.has(s.id));
writeJson(`${dir}/set.json`, { id: setId, name: process.env.SET_NAME || 'General adults in Korea and the US', count: Number(N), countries: { KR: 'Korea', US: 'US' }, note: (brief ? `Recruited for: ${brief}. ` : '') + 'A reusable set made with no product information. The distributions are assumptions in code, not fitted to real population statistics.', created: new Date().toISOString() });

await pool(todo, Number(process.env.CONC || 40), async s => {
  try {
    const p = await chat([{ role: 'user', content: `Write a UX research persona for one person who could plausibly exist. Write only about this person's life, with no reference to any product. Keep the ordinariness and the contradictions, and avoid stock descriptions. Use real app, brand and channel names the way a person from that country would.
${brief ? `This person must fit these recruiting criteria. If the sector conflicts with them, follow the criteria: ${brief}\n` : ''}Name ${s.name}, ${s.gender}, age ${s.age}, ${s.country === 'KR' ? 'Korea' : 'US'}, ${s.city}, sector: ${s.sector}
Patience ${s.patience}, price sensitivity ${s.priceSensitivity}, privacy concern ${s.privacyConcern}, tech comfort ${s.techComfort}, ad sensitivity ${s.adSensitivity}, impulse buying ${s.impulse} (each 0 to 100)
Write every description in English only. Do not mix in any other language; romanize Korean names and use official English names for apps and brands. Output JSON only, with no code block:
{"job":"specific job","workplace":"where they work (company size and industry, or their everyday place if none)","household":"family or living situation","incomeMonthly":"monthly income (rough, in local currency)","disposableMonthly":"monthly amount free to spend","commute":{"mode":"way of commuting","minutes":number,"leave":hour they leave for work as a number,"back":hour they head home as a number},"weekday":"a weekday in time order, 2 sentences","weekend":"the weekend, 1 sentence","phoneHours":[4 to 6 numbers, the hours they spend long on their phone],"apps":["8 apps they use often"],"subscriptions":[{"name":"subscription service","monthly":"monthly amount"}],"media":["3 channels, creators or outlets they often watch"],"likes":"what they usually like, 1 sentence","brands":["3 brands they like"],"recentBuy":"something they bought recently and why","regret":"a recent purchase they regretted or returned","goal":"what they are trying to achieve lately","stress":"what stresses them lately","adView":"their attitude to ads, 1 sentence","voice":"description of how they usually talk","quote":"one line they might often say"}` }], { max_tokens: 1900, temperature: 1 });
    fs.appendFileSync(out, JSON.stringify({ ...s, ...p }) + '\n');
  } catch (e) { console.log('fail', s.id, String(e).slice(0, 120)); }
}, (d, t) => { if (d % 250 === 0 || process.env.SIM_PROGRESS) console.log(`set ${d}/${t} $${usage.cost.toFixed(3)} fails ${usage.fails}`); });
console.log('done', usage);
