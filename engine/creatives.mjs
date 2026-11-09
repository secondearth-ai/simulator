// Writes ad concepts from what the product actually offers, then renders each as a 9:16 static in Korean and English.
// usage: node engine/creatives.mjs <run>
import fs from 'node:fs';
import { chromium } from 'playwright';
import { chat, writeJson, imageUrl, usage } from './lib.mjs';
const run = process.argv[2];
const dir = `runs/${run}`, cfg = JSON.parse(fs.readFileSync(`${dir}/run.json`, 'utf8'));
const copy = await chat([{ role: 'user', content: `Write the copy for 4 mobile ad creatives. Use only the product facts below. Do not write features, numbers or security claims that are not there.
Product facts: ${cfg.facts}
Each creative targets a different person in a different moment. Write in a short, spoken, social media voice. Do not grovel. Do not put the product name in the hook. Do not sound explanatory.
Each creative's screen is one of: ${cfg.creativeScreens ? cfg.creativeScreens.map(x => `${x.id} (${x.title})`).join(', ') : 'result (meeting summary result), onboarding (first app screen, stage and QR), paywall (pricing)'}.
Language: write "angle" and every "en" field in English only. Write every "ko" field in Korean only, because it is the copy for the Korean version of the ad. Do not mix any other language into a field.
Output JSON only: {"creatives":[{"id":"a","angle":"one sentence on whose moment this is","screen":"${cfg.creativeScreens?.[0]?.id || 'result'}","ko":{"hook":"Korean hook, max 20 characters","sub":"Korean supporting line, max 22 characters","cta":"button, max 8 characters"},"en":{"hook":"English hook, max 8 words","sub":"English line, max 9 words","cta":"max 3 words"}}]}` }], { model: 'anthropic/claude-sonnet-5.5', reasoning: { effort: 'low' }, max_tokens: 3000 });
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
