// Writes ad concepts from what the product actually offers, then renders each as a 9:16 static in Korean and English.
// usage: node engine/creatives.mjs <run>
import fs from 'node:fs';
import { chromium } from 'playwright';
import { chat, writeJson, imageUrl, usage } from './lib.mjs';
const run = process.argv[2];
const dir = `runs/${run}`, cfg = JSON.parse(fs.readFileSync(`${dir}/run.json`, 'utf8'));
const copy = await chat([{ role: 'user', content: `모바일 광고 소재 4개의 문구를 쓴다. 제품에 대한 사실은 아래에 있는 것만 쓴다. 없는 기능, 수치, 보안 주장은 쓰지 않는다.
제품 사실: ${cfg.facts}
소재마다 다른 사람의 다른 순간을 노린다. 짧고 구어체인 SNS 말투로 쓴다. 굽신거리지 않는다. 제품 이름은 hook에 넣지 않는다. 설명조 금지.
각 소재의 screen은 ${cfg.creativeScreens ? cfg.creativeScreens.map(x => `${x.id}(${x.title})`).join(', ') : 'result(회의 요약 결과), onboarding(앱 첫 화면, 무대와 QR), paywall(요금)'} 중 하나다.
JSON만 출력: {"creatives":[{"id":"a","angle":"누구의 어떤 순간인지 한국어 한 문장","screen":"${cfg.creativeScreens?.[0]?.id || 'result'}","ko":{"hook":"한국어 훅 20자 이내","sub":"한국어 보조 문구 22자 이내","cta":"버튼 8자 이내"},"en":{"hook":"English hook, max 8 words","sub":"English line, max 9 words","cta":"max 3 words"}}]}` }], { model: 'anthropic/claude-sonnet-5.5', reasoning: { effort: 'low' }, max_tokens: 3000 });
// The model only picks from the listed screens, but a wrong id should not lose the whole batch.
if (cfg.creativeScreens) for (const c of copy.creatives) if (!cfg.creativeScreens.some(x => x.id === c.screen)) c.screen = cfg.creativeScreens[0].id;
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const themes = [
  { bg: '#0b0d12', fg: '#ffffff', accent: '#5b6cff' },
  { bg: '#f4f1ea', fg: '#14130f', accent: '#14130f' },
  { bg: '#ffd84d', fg: '#111111', accent: '#111111' },
  { bg: '#1e3a2f', fg: '#f3f7ef', accent: '#b8f06a' },
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
fs.mkdirSync(`${dir}/creatives`, { recursive: true });
for (const [i, c] of copy.creatives.entries()) {
  const t = themes[i % themes.length];
  for (const lang of ['ko', 'en']) {
    const img = imageUrl(`${dir}/screens/${lang}/${c.screen}.jpg`);
    await page.setContent(`<!doctype html><meta charset=utf-8><body style="margin:0;width:540px;height:960px;overflow:hidden;background:${t.bg};color:${t.fg};font-family:-apple-system,'Apple SD Gothic Neo',sans-serif">
      <div style="padding:64px 44px 0"><div style="font-size:${lang === 'ko' ? 54 : 50}px;font-weight:800;line-height:1.14;letter-spacing:-.02em;word-break:keep-all">${esc(c[lang].hook)}</div>
      <div style="margin-top:18px;font-size:25px;font-weight:500;opacity:.8;word-break:keep-all">${esc(c[lang].sub)}</div></div>
      <div style="position:absolute;left:105px;top:372px;width:330px;height:714px;border-radius:44px;border:10px solid #000;overflow:hidden;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)"><img src="${img}" style="width:100%;display:block"></div>
      <div style="position:absolute;left:44px;right:44px;bottom:36px;height:72px;border-radius:36px;background:${t.accent};color:${t.accent === '#111111' || t.accent === '#14130f' ? '#fff' : t.accent === '#b8f06a' ? '#111' : '#fff'};display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:700">${esc(c[lang].cta)}</div>`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/creatives/${c.id}-${lang}.jpg`, type: 'jpeg', quality: 80 });
  }
}
await b.close();
writeJson(`${dir}/creatives.json`, copy.creatives);
console.log(JSON.stringify(copy.creatives, null, 1), usage);
