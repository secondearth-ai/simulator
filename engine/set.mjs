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

const KR_LAST = w([['김', 21], ['이', 15], ['박', 8], ['최', 5], ['정', 4], ['강', 2], ['조', 2], ['윤', 2], ['장', 2], ['임', 2], ['한', 1], ['오', 1], ['서', 1], ['신', 1], ['권', 1], ['황', 1], ['안', 1], ['송', 1], ['전', 1], ['홍', 1], ['유', 1], ['고', 1], ['문', 1], ['양', 1], ['손', 1], ['배', 1], ['백', 1], ['허', 1]]);
const KR_M = ['민준', '서준', '도윤', '예준', '시우', '주원', '지호', '지후', '현우', '준서', '건우', '우진', '선우', '서진', '민재', '현준', '연우', '정우', '승우', '승현', '성민', '재현', '동현', '태훈', '상우', '진호', '영호', '성호', '경수', '종민', '병철', '기훈', '한결', '태윤', '은호', '재민', '형준', '용준', '대현', '석진'];
const KR_F = ['서연', '서윤', '지우', '하윤', '민서', '하은', '지유', '윤서', '채원', '수아', '지민', '소율', '예은', '유진', '다은', '수빈', '지현', '은지', '혜진', '미영', '은경', '수진', '정은', '현정', '영희', '보람', '나영', '소연', '아름', '세은', '가은', '주희', '혜원', '민경', '지영', '선영', '경희', '유나', '하린', '다인'];
const US_M = ['James', 'Michael', 'Robert', 'David', 'William', 'Daniel', 'Matthew', 'Anthony', 'Andrew', 'Joshua', 'Ryan', 'Brandon', 'Tyler', 'Kevin', 'Jason', 'Eric', 'Marcus', 'Luis', 'Carlos', 'Jamal', 'Trevor', 'Nathan', 'Aaron', 'Sean', 'Derek', 'Omar', 'Wei', 'Raj', 'Miguel', 'Caleb'];
const US_F = ['Mary', 'Jennifer', 'Linda', 'Sarah', 'Jessica', 'Ashley', 'Emily', 'Megan', 'Rachel', 'Lauren', 'Nicole', 'Amanda', 'Brittany', 'Hannah', 'Olivia', 'Sofia', 'Maria', 'Priya', 'Keisha', 'Tiffany', 'Grace', 'Chloe', 'Madison', 'Danielle', 'Vanessa', 'Yuna', 'Aaliyah', 'Camila', 'Erin', 'Paige'];
const US_LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Nguyen', 'Hill', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Patel', 'Kim', 'Chen', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Howard', 'Ward', 'Cox', 'Diaz', 'Brooks'];

const CITIES = {
  KR: w([['서울 강남구', 7], ['서울 마포구', 5], ['서울 송파구', 6], ['서울 노원구', 5], ['서울 관악구', 4], ['성남 분당', 6], ['수원', 7], ['고양 일산', 5], ['인천 부평', 6], ['부산 해운대', 6], ['대구 수성구', 5], ['대전 유성구', 4], ['광주 서구', 3], ['창원', 3], ['전주', 2], ['청주', 2]]),
  US: w([['New York, NY', 8], ['Los Angeles, CA', 7], ['Chicago, IL', 5], ['Houston, TX', 5], ['Phoenix, AZ', 4], ['Philadelphia, PA', 3], ['San Antonio, TX', 3], ['San Diego, CA', 3], ['Dallas, TX', 5], ['Austin, TX', 3], ['Seattle, WA', 3], ['Denver, CO', 3], ['Atlanta, GA', 4], ['Miami, FL', 3], ['Boston, MA', 3], ['Columbus, OH', 3], ['Nashville, TN', 2], ['Minneapolis, MN', 2], ['Rural Iowa', 2], ['Small town Georgia', 2]]),
};
const AGES = w([[[18, 24], 16], [[25, 34], 26], [[35, 44], 24], [[45, 54], 20], [[55, 69], 14]]);
const SECTORS = w([['IT·소프트웨어', 8], ['제조업', 9], ['의료·간호', 7], ['교육(교사·강사)', 7], ['대학생·대학원생', 9], ['금융·보험', 5], ['법률·회계', 3], ['마케팅·광고', 4], ['언론·콘텐츠 제작', 3], ['행사·컨퍼런스 운영', 2], ['공공기관·공무원', 5], ['소매·서비스 판매', 9], ['음식점·카페', 5], ['물류·운송·배달', 5], ['건설·현장직', 4], ['프리랜서·1인 사업', 5], ['스타트업 창업', 2], ['연구·제약', 3], ['주부·육아 중', 4], ['구직 중', 3], ['은퇴', 3]]);
const pct = () => Math.round(Math.min(100, Math.max(0, (r() + r() + r()) / 3 * 100)));
const used = new Set();
function makeName(country, gender) {
  for (let i = 0; i < 200; i++) {
    const n = country === 'KR' ? weighted(r, KR_LAST).v + pick(gender === '남' ? KR_M : KR_F) : `${pick(gender === '남' ? US_M : US_F)} ${pick(US_LAST)}`;
    if (!used.has(n) || i > 150) { used.add(n); return n; }
  }
}
const seeds = Array.from({ length: Number(N) }, (_, id) => {
  const country = countries[id % countries.length];
  const gender = r() < 0.5 ? '남' : '여';
  const band = weighted(r, AGES).v;
  let sector = weighted(r, SECTORS).v;
  const age = band[0] + Math.floor(r() * (band[1] - band[0] + 1));
  if (age >= 62 && r() < 0.6) sector = '은퇴';
  if (age <= 23 && r() < 0.6) sector = '대학생·대학원생';
  return { id, country, gender, age, sector, city: weighted(r, CITIES[country]).v, name: makeName(country, gender),
    patience: pct(), priceSensitivity: pct(), privacyConcern: pct(), techComfort: pct(), adSensitivity: pct(), impulse: pct() };
});

const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const todo = seeds.filter(s => !done.has(s.id));
writeJson(`${dir}/set.json`, { id: setId, name: process.env.SET_NAME || '한국·미국 일반 성인', count: Number(N), countries: { KR: '한국', US: '미국' }, note: (brief ? `모집 조건: ${brief}. ` : '') + '제품 정보 없이 만든 재사용 세트. 분포는 코드에 넣은 가정이고 실제 인구 통계와 맞춘 값이 아니다.', created: new Date().toISOString() });

await pool(todo, Number(process.env.CONC || 40), async s => {
  try {
    const p = await chat([{ role: 'user', content: `실제로 존재할 법한 사람 한 명의 UX 리서치용 페르소나를 쓴다. 특정 제품과 무관하게 이 사람의 삶만 쓴다. 평범함과 모순을 살리고 전형적인 묘사는 피한다. 실제 있는 앱·브랜드·채널 이름을 그 나라 사람답게 쓴다.
${brief ? `이 사람은 다음 모집 조건에 맞아야 한다. 분야가 조건과 어긋나면 조건을 따른다: ${brief}\n` : ''}이름 ${s.name}, ${s.gender}성, ${s.age}세, ${s.country === 'KR' ? '한국' : '미국'} ${s.city}, 분야: ${s.sector}
인내심 ${s.patience}, 가격 민감도 ${s.priceSensitivity}, 개인정보 민감도 ${s.privacyConcern}, 기술 친숙도 ${s.techComfort}, 광고 민감도 ${s.adSensitivity}, 충동구매 ${s.impulse} (각 0~100)
모든 설명은 한국어로 쓴다. 고유명사는 원어 그대로 둔다. 코드블록 없이 JSON만 출력:
{"job":"구체적 직무","workplace":"어떤 곳에서 일하는지(회사 규모·업종, 없으면 일상의 장소)","household":"가족·동거 형태","incomeMonthly":"월 소득(현지 통화 대략)","disposableMonthly":"자유롭게 쓸 수 있는 월 금액","commute":{"mode":"수단","minutes":숫자,"leave":출근 시각 숫자,"back":퇴근 시각 숫자},"weekday":"평일 하루를 시간 순서로 2문장","weekend":"주말을 1문장","phoneHours":[폰을 오래 보는 시각 숫자 4~6개],"apps":["자주 쓰는 앱 8개"],"subscriptions":[{"name":"구독 서비스","monthly":"월 금액"}],"media":["자주 보는 채널·크리에이터·매체 3개"],"likes":"평소 좋아하는 것 1문장","brands":["좋아하는 브랜드 3개"],"recentBuy":"최근 산 것과 이유","regret":"최근 후회하거나 환불한 소비","goal":"요즘 이루려는 일","stress":"요즘 스트레스","adView":"광고를 대하는 태도 1문장","voice":"평소 말투 설명","quote":"평소 할 법한 말 한 줄"}` }], { max_tokens: 1900, temperature: 1 });
    fs.appendFileSync(out, JSON.stringify({ ...s, ...p }) + '\n');
  } catch (e) { console.log('fail', s.id, String(e).slice(0, 120)); }
}, (d, t) => { if (d % 250 === 0 || process.env.SIM_PROGRESS) console.log(`set ${d}/${t} $${usage.cost.toFixed(3)} fails ${usage.fails}`); });
console.log('done', usage);
