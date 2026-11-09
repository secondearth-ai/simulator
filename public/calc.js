// Shared by the browser and the report so both compute the same numbers.
(function (root) {
  const has = (a, stage, test) => a.v.some(x => x.s === stage && test(x));
  const lastAt = (a, stage) => { for (let i = a.v.length - 1; i >= 0; i--) if (a.v[i].s === stage) return a.v[i]; return null; };

  // Counts for one group of agents, using what they actually did.
  function counts(list) {
    const c = { n: list.length, clicked: 0, installed: 0, onboarded: 0, first: 0, sawPaywall: 0, annualStart: 0, weekly: 0, annualPaid: 0, weeklyWeeks: 0, revisitInstalls: 0, impressions: 0, freq: 0 };
    for (const a of list) {
      c.impressions += a.v.filter(x => x.s === 'ad').length;
      if (has(a, 'ad', x => x.a === 'click')) c.clicked++;
      const inst = a.v.find(x => x.s === 'store' && x.a === 'install');
      if (inst) { c.installed++; if (inst.rev) c.revisitInstalls++; }
      if (has(a, 'onboarding', x => x.a === 'next')) c.onboarded++;
      if (has(a, 'result', x => x.a === 'next')) c.first++;
      if (has(a, 'paywall', () => true)) c.sawPaywall++;
      if (has(a, 'paywall', x => x.a === 'annual')) c.annualStart++;
      if (has(a, 'paywall', x => x.a === 'weekly')) { c.weekly++; c.weeklyWeeks += a.w || 1; }
      if (has(a, 'trial', x => x.a === 'pay' && x.plan === 'annual')) c.annualPaid++;
    }
    c.freq = c.n ? c.impressions / c.n : 0;
    return c;
  }
  const safe = (a, b) => (b ? a / b : 0);

  function pureRates(c) {
    return {
      ctr: safe(c.clicked, c.impressions),
      install: safe(c.installed, c.clicked),
      onboard: safe(c.onboarded, c.installed),
      first: safe(c.first, c.onboarded),
      convert: safe(c.annualStart + c.weekly, c.sawPaywall),
      annualShare: safe(c.annualStart, c.annualStart + c.weekly),
      trialPay: safe(c.annualPaid, c.annualStart),
      weeks: safe(c.weeklyWeeks, c.weekly),
    };
  }

  // Money for a budget, given stage rates.
  function money(r0, g, basePrices) {
    // Price scenario: changing a price moves paywall conversion by a rough elasticity. It is an assumption, shown as a gauge.
    const prices = { ...basePrices, annual: g.priceAnnual ?? basePrices.annual, weekly: g.priceWeekly ?? basePrices.weekly };
    const e = g.elasticity ?? 1, ratio = ((prices.annual / basePrices.annual) + (prices.weekly / basePrices.weekly)) / 2;
    const r = { ...r0, convert: Math.min(0.9, r0.convert * Math.pow(ratio, -e)) };
    const net = 1 - prices.storeCut;
    const impressions = g.budget / g.cpm * 1000;
    const clicks = impressions * r.ctr;
    const installs = clicks * r.install;
    const firstUse = installs * r.onboard * r.first;
    const buyers = firstUse * r.convert;
    const annualStarts = buyers * r.annualShare, weekly = buyers - annualStarts;
    const annualPaid = annualStarts * r.trialPay;
    const payers = annualPaid + weekly;
    const revD7 = (annualPaid * prices.annual + weekly * prices.weekly) * net;
    const revD30 = (annualPaid * prices.annual + weekly * prices.weekly * Math.max(1, r.weeks)) * net;
    return { impressions, clicks, installs, firstUse, buyers, payers, cpi: safe(g.budget, installs), cac: safe(g.budget, payers), arppu: safe(revD30, payers), revD7, revD30, roasD7: safe(revD7, g.budget), roasD30: safe(revD30, g.budget), rates: r };
  }

  function finance(paidFiltered, paidAll, g, prices) {
    const cf = counts(paidFiltered), ca = counts(paidAll);
    const pf = pureRates(cf), pa = pureRates(ca);
    const pure = money(pf, g, prices);
    const lift = k => { if (!pa[k]) return 1; if (!pf[k]) return 0.2; return Math.min(3, Math.max(0.2, pf[k] / pa[k])); };
    const rv = safe(ca.revisitInstalls, ca.installed);
    const renew = g.weeklyRenew / 100;
    const cal = {
      ctr: g.ctr / 100 * g.adSensitivity * lift('ctr'),
      install: Math.min(0.95, g.clickToInstall / 100 * lift('install') * (1 + rv * (g.revisit - 1))),
      onboard: Math.min(0.98, g.onboardingDone / 100 * lift('onboard')),
      first: Math.min(0.98, g.firstResult / 100 * lift('first')),
      convert: Math.min(0.8, g.paywallConvert / 100 / g.priceSensitivity * lift('convert')),
      annualShare: g.annualShare / 100,
      trialPay: Math.min(0.95, g.trialToPaid / 100 * lift('trialPay')),
      weeks: 1 + renew + renew ** 2 + renew ** 3,
    };
    return { pure, cal: money(cal, g, prices), counts: cf };
  }

  // Calibrated dots: at each stage keep only the most likely forward movers, up to the target rate. Stages already below target stay as they are.
  const RULES = g => [
    { s: 'store', go: x => x.a === 'install', stop: 'leave', rate: g.clickToInstall / 100 },
    { s: 'onboarding', go: x => x.a === 'next', stop: 'leave', rate: g.onboardingDone / 100 },
    { s: 'result', go: x => x.a === 'next', stop: 'leave', rate: g.firstResult / 100 },
    { s: 'paywall', go: x => x.a === 'annual' || x.a === 'weekly', stop: 'free', rate: g.paywallConvert / 100 / g.priceSensitivity },
    { s: 'trial', go: x => x.a === 'pay' && x.plan === 'annual', stop: 'cancel', rate: g.trialToPaid / 100, only: x => x.plan === 'annual' },
    { s: 'retain', go: x => x.a === 'keep', stop: 'cancel', rate: g.weeklyRenew / 100, only: x => x.a === 'keep' || x.a === 'cancel' },
  ];
  function calibrate(agents, g) {
    const out = agents.map(a => ({ ...a, v: a.v.slice() }));
    const notes = {};
    for (const rule of RULES(g)) {
      const here = [];
      for (const a of out) { const i = a.v.findIndex(x => x.s === rule.s && (!rule.only || rule.only(x))); if (i >= 0) here.push({ a, i, x: a.v[i] }); }
      const forward = here.filter(h => rule.go(h.x)).sort((m, n) => n.x.p - m.x.p);
      const allowed = Math.round(here.length * rule.rate);
      notes[rule.s] = { pure: safe(forward.length, here.length), target: rule.rate, capped: forward.length < allowed };
      for (const h of forward.slice(allowed)) {
        h.a.v = h.a.v.slice(0, h.i).concat([{ ...h.x, a: rule.stop, tag: `보정 탈락: ${h.x.tag}`, cal: true, installed: false }]);
        if (rule.s === 'paywall') h.a.v.push({ s: 'retain', t: h.x.t + 1, a: 'free_active', p: 50, att: 50, tag: '무료로 계속 사용', cal: true });
      }
    }
    if (g.revisit < 1) for (const a of out) {
      const i = a.v.findIndex(x => x.rev && x.s !== 'ad' && (a.id * 2654435761 % 100) / 100 > g.revisit);
      if (i > 0) a.v = a.v.slice(0, i);
    }
    return { agents: out, notes };
  }
  root.Calc = { counts, pureRates, money, finance, calibrate, safe };
})(typeof globalThis !== 'undefined' ? globalThis : this);
