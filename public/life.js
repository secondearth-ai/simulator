// Each persona's day, built from their own commute, phone hours and apps. Same person and day always give the same plan.
// Used by the simulation (where and when an ad is seen) and by the viewer (the personal timeline).
(function (root) {
  const seeded = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const AD_APP = /instagram|youtube|tiktok|facebook|threads|naver|reddit|kakao|snapchat|pinterest|^x$/i;
  const NO_COMMUTE = new Set(['Retired', 'Homemaker or parenting', 'Job seeking']);
  const DAYTIME = { Retired: 'Walks and housework', 'Homemaker or parenting': 'Childcare and housework', 'Job seeking': 'Job hunting' };

  function plan(p, day) {
    const r = seeded(p.id * 1009 + day * 7919 + 3);
    const wd = ((day % 7) + 7) % 7, weekend = wd >= 5;
    const c = p.commute || {};
    let leave = num(c.leave, 8), back = num(c.back, 18);
    const mins = Math.max(0, num(c.minutes, 0));
    const student = p.sector === 'College & grad students';
    const worker = !NO_COMMUTE.has(p.sector) && leave >= 4 && leave <= 12 && back > 12;
    const seg = [];
    const add = (from, to, kind, label) => { if (to > from) seg.push({ from, to, kind, label }); };
    const evening = from => {
      const v = r();
      const bed = 23 + r() * 0.9;
      let cur = from;
      if (v < 0.1) { add(cur, cur + 2.3, 'dine', student ? 'Dinner with friends' : 'Dinner with coworkers'); cur += 2.3; }
      else if (v < 0.2) { add(cur, cur + 2.5, 'friends', 'Seeing friends'); cur += 2.5; }
      else if (v < 0.32) { add(cur, cur + 1.2, 'exercise', 'Exercise'); cur += 1.2; }
      else if (v < 0.42) { add(cur, cur + 0.8, 'errand', 'Grocery shopping'); cur += 0.8; }
      if (cur < 24) add(cur, Math.max(cur, bed), 'rest', 'Resting at home');
      add(Math.max(cur, bed), 24, 'sleep', 'Asleep');
    };
    if (weekend) {
      const wake = 8 + r() * 2.5;
      add(0, wake, 'sleep', 'Asleep'); add(wake, 12.5, 'rest', 'Resting at home'); add(12.5, 13.5, 'lunch', 'Lunch');
      const v = r(), lab = v < 0.25 ? ['friends', 'Seeing friends'] : v < 0.45 ? ['family', 'Family outing'] : v < 0.6 ? ['errand', 'Shopping'] : v < 0.72 ? ['exercise', 'Exercise'] : ['rest', 'Resting at home'];
      add(13.5, 18, lab[0], lab[1]);
      if (r() < 0.3) { add(18, 20, 'dine', 'Eating out'); evening(20); } else evening(18);
    } else if (worker) {
      const wake = Math.max(4, leave - 0.9), arrive = leave + mins / 60, home = back + mins / 60;
      add(0, wake, 'sleep', 'Asleep'); add(wake, leave, 'ready', 'Getting ready for work');
      if (mins) add(leave, arrive, 'commute', `${student ? 'Going to class' : 'Commuting to work'}: ${c.mode || 'Travel'}`);
      const job = student ? 'Class' : 'Work';
      add(arrive, 12, 'work', job); add(Math.max(arrive, 12), 13, 'lunch', 'Lunch');
      add(13, back, 'work', job);
      if (mins) add(back, home, 'commute', `${student ? 'Heading home' : 'Commuting home'}: ${c.mode || 'Travel'}`);
      evening(Math.max(home, 13));
    } else {
      const wake = 7 + r() * 2;
      const label = DAYTIME[p.sector] || 'Daily routine';
      add(0, wake, 'sleep', 'Asleep'); add(wake, 9.5, 'ready', 'Morning routine'); add(9.5, 12, 'day', label); add(12, 13, 'lunch', 'Lunch'); add(13, 18, 'day', label);
      evening(18);
    }
    seg.sort((a, b) => a.from - b.from);
    return { segments: seg, sessions: sessions(p, day, seg, r) };
  }

  function sessions(p, day, seg, r) {
    const apps = p.apps && p.apps.length ? p.apps : ['YouTube'];
    const adApps = apps.filter(a => AD_APP.test(a));
    const hours = new Set((p.phoneHours || []).map(h => Math.floor(num(h, -1))));
    const out = [];
    for (const s of seg) {
      if (s.kind === 'sleep') continue;
      const chance = { commute: 0.95, lunch: 0.8, rest: 0.6, ready: 0.35, work: 0.12, day: 0.3, dine: 0.15, friends: 0.15, family: 0.2, errand: 0.2, exercise: 0.15 }[s.kind] ?? 0.2;
      for (let h = Math.ceil(s.from); h < s.to || (h === Math.ceil(s.from) && s.to - s.from < 1); h++) {
        const inside = Math.max(s.from, Math.min(h + r() * 0.8, s.to - 0.05));
        if (r() < (hours.has(h) ? Math.min(1, chance + 0.55) : chance)) {
          const app = adApps.length && r() < 0.55 ? adApps[Math.floor(r() * adApps.length)] : apps[Math.floor(r() * apps.length)];
          out.push({ h: inside, min: 2 + Math.floor(r() * 18), app, adApp: AD_APP.test(app), during: s.label, kind: s.kind });
        }
        if (s.to - s.from < 1) break;
      }
    }
    return out.sort((a, b) => a.h - b.h);
  }

  function at(p, day, hour) {
    const { segments } = plan(p, day);
    const s = segments.find(x => hour >= x.from && hour < x.to) || segments[segments.length - 1];
    const wd = ((day % 7) + 7) % 7;
    let kind = 'evening';
    if (hour < 6 || hour >= 23 || s.kind === 'sleep') kind = 'late';
    else if (s.kind === 'dine' || s.kind === 'friends' || s.kind === 'family') kind = 'out';
    else if (s.kind === 'commute') kind = hour < 12 ? 'commute_am' : 'commute_pm';
    else if (wd >= 5) kind = 'weekend';
    else if (s.kind === 'lunch') kind = 'lunch';
    else if (s.kind === 'work' || s.kind === 'day') kind = 'work';
    else if (s.kind === 'ready') kind = 'morning';
    return { kind, label: s.label, seg: s };
  }

  // When this person meets the campaign: a share of their sessions in ad-carrying apps, capped.
  function exposures(p, campaignDays = 14, rate = 0.05, cap = 6) {
    const r = seeded(p.id * 31337 + 11);
    const list = [], all = [];
    for (let d = 0; d < campaignDays; d++) for (const s of plan(p, d).sessions) if (s.adApp) { const e = { t: d * 24 + s.h, day: d, hour: s.h, app: s.app, during: s.during }; all.push(e); if (r() < rate) list.push(e); }
    if (!list.length && all.length) list.push(all[Math.floor(r() * all.length)]);
    return list.slice(0, cap);
  }

  // After installing, the app shows up in ordinary days: more often at work or class, some at lunch.
  function productUse(p, day, hour0, hourEnd, name) {
    const r = seeded(p.id * 271 + day * 13);
    const useful = plan(p, day).segments.filter(s => s.kind === 'work' || s.kind === 'day' || s.kind === 'lunch');
    const out = [];
    for (const s of useful) if (r() < 0.22) { const h = s.from + r() * Math.max(0.1, s.to - s.from - 0.1), t = day * 24 + h; if (t >= hour0 && t <= hourEnd) out.push({ h, min: 5 + Math.floor(r() * 40), app: name, adApp: false, during: s.label, kind: s.kind, product: true }); }
    return out;
  }
  root.Life = { plan, at, exposures, productUse };
})(typeof globalThis !== 'undefined' ? globalThis : this);
