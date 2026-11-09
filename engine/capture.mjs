// Capture a product's public pages as phone-sized screens for one language.
// usage: node engine/capture.mjs <run> <ko|en> <stage>=<url>[#scrollY] ...
import { chromium } from 'playwright';
import fs from 'node:fs';
const [run, lang, ...specs] = process.argv.slice(2);
const dir = `runs/${run}/screens/${lang}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
const page = await ctx.newPage();
for (const spec of specs) {
  const [id, rest] = [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)];
  const [url, y] = rest.split('#');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(v => window.scrollTo(0, v), Number(y || 0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/${id}.jpg`, type: 'jpeg', quality: 72 });
  console.log(lang, id, url, await page.title());
}
await browser.close();
