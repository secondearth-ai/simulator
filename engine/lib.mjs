import fs from 'node:fs';
export const MODEL = process.env.SIM_MODEL || 'qwen/qwen3.7-flash';
const KEY = process.env.OPENROUTER_API_KEY;
export const usage = { in: 0, out: 0, cost: 0, calls: 0, fails: 0 };

export async function chat(messages, { model = MODEL, json = true, max_tokens = 400, temperature = 0.8, retries = 4, reasoning = { enabled: false } } = {}) {
  if (!KEY) throw new Error('OPENROUTER_API_KEY is not set');
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens, temperature, usage: { include: true }, ...(reasoning ? { reasoning } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content || '';
      usage.calls++; usage.in += d.usage?.prompt_tokens || 0; usage.out += d.usage?.completion_tokens || 0; usage.cost += d.usage?.cost || 0;
      if (!json) return text;
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    } catch (e) {
      usage.fails++;
      if (a === retries) throw e;
      await new Promise(s => setTimeout(s, 700 * 2 ** a + Math.random() * 400));
    }
  }
}

export async function pool(items, n, fn, onTick) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); done++; onTick?.(done, items.length); }
  }));
}

export const imageUrl = p => `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));
// small seeded RNG so a run can be reproduced
export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function weighted(r, list, key = 'share') { const tot = list.reduce((a, x) => a + x[key], 0); let v = r() * tot; for (const x of list) { v -= x[key]; if (v <= 0) return x; } return list[list.length - 1]; }
