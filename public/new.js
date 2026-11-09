// The "new simulation" wizard, then the live run scenario. Everything shown during a run comes from the server's job state.
const $ = id => document.getElementById(id);
const wiz = $('wiz');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `요청이 실패했습니다 (${r.status})`);
  return j;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Estimates. Decision rate and people per run come from the brief; the set rate is what kr-us-10k actually cost.
const DECISION_COST = 0.03 / 1000, DECISIONS_PER_PERSON = 3.5, SET_COST_PER_PERSON = 0.00075, ADS_COST = 0.03, REPORT_COST = 0.1;
const STEPS = ['제품', '화면 편집', '가격', '페르소나', '광고', '실행'];
const S = {
  step: 0, draft: null, product: '', concept: '', url: '', shots: 1, screens: [],
  prices: { weekly: '', annual: '', trialDays: 3, storeCut: 15, free: true },
  mode: 'reuse', set: '', countries: [], ageMin: 18, ageMax: 99, sectors: [], text: '', count: 200, matched: null,
  newId: '', newCount: 200, newBrief: '', newCountries: ['KR', 'US'],
  adMode: 'auto', adItems: [], budget: 5000, key: '', model: '', report: true,
};
let CONF = { kinds: {}, serverKey: false, model: '', maxPeople: 2000 }, SETS = [], SET_INFO = null, RUNS = [], err = '', busy = '';

const crumbs = () => `<div class="crumbs">${STEPS.map((t, i) => `<button data-go="${i}" class="${i === S.step ? 'on' : ''}" ${i > S.step ? 'disabled' : ''}>${i + 1}. ${t}</button>`).join('')}</div>`;
const nav = last => `<p class="err" role="alert">${esc(err)}</p><p class="wait">${esc(busy)}</p><div class="nav">${S.step ? '<button data-back>이전</button>' : '<span></span>'}${last ? '<button class="primary" data-start>시작하기</button>' : '<button class="primary" data-next>다음</button>'}</div>`;

function estimate() {
  const n = S.mode === 'new' ? Math.min(Number(S.count) || 0, Number(S.newCount) || 0) : (S.matched == null ? Number(S.count) || 0 : Math.min(Number(S.count) || 0, S.matched));
  const sim = n * DECISIONS_PER_PERSON * DECISION_COST;
  const set = S.mode === 'new' ? (Number(S.newCount) || 0) * SET_COST_PER_PERSON : 0;
  const ads = S.adMode === 'auto' ? ADS_COST : 0, rep = S.report ? REPORT_COST : 0;
  return { n, sim, set, ads, rep, total: sim + set + ads + rep };
}
const usd = v => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
const costBox = () => {
  const e = estimate();
  return `<div class="box cost" id="cost"><b>추정 ${usd(e.total)}</b> <span class="dim">(추정치이며 실제 비용과 다릅니다)</span><br><span class="dim">판단 ${e.n.toLocaleString()}명 × 약 ${DECISIONS_PER_PERSON}건 × 1,000건당 약 $0.03 = ${usd(e.sim)}${e.set ? ` · 세트 생성 ${usd(e.set)}` : ''}${e.ads ? ` · 소재 생성 약 ${usd(e.ads)}` : ''}${e.rep ? ` · 보고서 약 ${usd(e.rep)}` : ''}</span></div>`;
};
const refreshCost = () => { const c = $('cost'); if (c) c.outerHTML = costBox(); };

const VIEW = [
  () => `<h1>제품</h1><p class="dim">이름과 컨셉을 쓰고, 화면을 가져옵니다. 웹페이지, App Store, Play 스토어 주소를 넣으면 폰 크기로 캡처합니다.</p>
    <label class="f"><span>제품 이름</span><input type="text" data-bind="product" value="${esc(S.product)}"></label>
    <label class="f"><span>컨셉 설명 (광고 문구와 보고서는 여기 적힌 사실만 씁니다)</span><textarea data-bind="concept" rows="4">${esc(S.concept)}</textarea></label>
    <h2>화면 가져오기</h2>
    <div class="inline"><input type="url" data-bind="url" value="${esc(S.url)}" placeholder="https://… 또는 play.google.com/store/apps/details?id=…" aria-label="캡처할 주소">
      <label class="dim">장수 <select data-bind="shots">${[1, 2, 3, 4].map(n => `<option ${+S.shots === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button data-capture>캡처</button></div>
    <p class="note">여러 주소를 차례로 캡처해도 됩니다. 스토어 주소는 앱스토어 화면으로 자동 분류합니다.</p>
    <label class="f" style="margin-top:12px"><span>또는 스크린샷 올리기 (여러 장 가능, PNG·JPG·WEBP)</span><input type="file" id="files" accept="image/png,image/jpeg,image/webp" multiple></label>
    <p>지금까지 <b>${S.screens.length}</b>장</p>
    ${RUNS.length ? `<h2>지난 실행</h2><div class="tableScroll"><table class="runs"><tr><th>제품</th><th>실행 id</th><th>인원</th><th>상태</th></tr>${RUNS.map(r => `<tr><td><a href="/?run=${encodeURIComponent(r.id)}">${esc(r.product)}</a></td><td>${esc(r.id)}</td><td>${r.people.toLocaleString()}</td><td class="dim">${esc({ done: '완료', running: '실행 중', failed: '실패', cancelled: '중단', interrupted: '끊김', empty: '결과 없음' }[r.status] || r.status)}</td></tr>`).join('')}</table></div>` : ''}${nav()}`,

  () => `<h1>화면 편집</h1><p class="dim">사람들이 보는 순서대로 놓습니다. 현실 기준 문구는 AI에게 함께 알려 주는 문장이고, 비워도 됩니다.</p>
    ${S.screens.map((s, i) => `<div class="scr" data-i="${i}"><div class="no">${i + 1}</div><div><img src="/draft/${S.draft}/${s.id}-ko.jpg" alt="${esc(s.name)}" data-zoom="/draft/${S.draft}/${s.id}-ko.jpg"><div class="ctl"><button data-up aria-label="위로" ${i ? '' : 'disabled'}>↑</button><button data-down aria-label="아래로" ${i < S.screens.length - 1 ? '' : 'disabled'}>↓</button><button data-del aria-label="삭제">삭제</button></div></div>
      <div><div class="grid2"><label class="f"><span>이름</span><input type="text" data-s="name" value="${esc(s.name)}"></label>
      <label class="f"><span>종류</span><select data-s="kind">${Object.entries(CONF.kinds).map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label></div>
      <label class="f"><span>현실 기준 문구 (선택)</span><textarea data-s="baseline" rows="2">${esc(s.baseline)}</textarea></label></div></div>`).join('') || '<p class="empty">화면이 없습니다. 이전 단계에서 가져와 주세요.</p>'}
    <p class="note">퍼널은 웹 → 스토어·가입 → 앱 → 페이월 순서로 돕니다. 빠진 단계는 화면 없이 제품 설명으로 판단합니다.</p>${nav()}`,

  () => `<h1>가격</h1><p class="dim">달러 기준입니다. 쓰지 않는 요금은 비워 둡니다. 지금은 주간과 연간만 계산합니다.</p>
    <div class="grid2"><label class="f"><span>주간 요금 ($)</span><input type="number" min="0" step="0.01" data-bind="prices.weekly" value="${esc(S.prices.weekly)}"></label>
    <label class="f"><span>연간 요금 ($)</span><input type="number" min="0" step="0.01" data-bind="prices.annual" value="${esc(S.prices.annual)}"></label>
    <label class="f"><span>연간 무료 체험 (일, 없으면 0)</span><input type="number" min="0" step="1" data-bind="prices.trialDays" value="${esc(S.prices.trialDays)}"></label>
    <label class="f"><span>스토어 수수료 (%)</span><input type="number" min="0" max="50" step="1" data-bind="prices.storeCut" value="${esc(S.prices.storeCut)}"></label></div>
    <label><input type="checkbox" data-check="prices.free" ${S.prices.free ? 'checked' : ''}> 페이월을 닫고 무료로 계속 쓸 수 있음</label>${nav()}`,

  () => `<h1>페르소나</h1>
    <p class="inline"><label><input type="radio" name="pm" data-mode="reuse" ${S.mode === 'reuse' ? 'checked' : ''}> 있는 세트 다시 쓰기</label> <label><input type="radio" name="pm" data-mode="new" ${S.mode === 'new' ? 'checked' : ''}> 새 세트 만들기</label></p>
    ${S.mode === 'reuse' ? `
      <label class="f"><span>세트</span><select data-bind="set">${SETS.map(x => `<option value="${esc(x.id)}" ${S.set === x.id ? 'selected' : ''}>${esc(x.id)} · ${esc(x.name)} · ${Number(x.count).toLocaleString()}명</option>`).join('')}</select></label>
      <h2>타깃 필터</h2>
      <div class="f"><span class="dim">국가</span><div class="chips">${chips('countries', [['KR', '한국'], ['US', '미국']])}</div></div>
      <div class="grid2"><label class="f"><span>최소 나이</span><input type="number" min="0" data-bind="ageMin" value="${esc(S.ageMin)}"></label><label class="f"><span>최대 나이</span><input type="number" min="0" data-bind="ageMax" value="${esc(S.ageMax)}"></label></div>
      <div class="f"><span class="dim">분야</span><div class="chips" id="sectorChips">${chips('sectors', (SET_INFO?.sectors || []).map(x => [x, x]))}</div></div>
      <label class="f"><span>자유 글 (직무·취향·앱에서 찾을 단어, 띄어쓰기로 구분. 하나라도 맞으면 포함)</span><input type="text" data-bind="text" value="${esc(S.text)}" placeholder="예: 회의 강의 노션"></label>
      <p>조건에 맞는 사람 <b id="matched">${S.matched == null ? '…' : S.matched.toLocaleString()}</b>명</p>` : `
      <div class="grid2"><label class="f"><span>세트 id (영문·숫자·-·_)</span><input type="text" data-bind="newId" value="${esc(S.newId)}"></label><label class="f"><span>만들 인원</span><input type="number" min="1" max="${CONF.maxPeople}" data-bind="newCount" value="${esc(S.newCount)}"></label></div>
      <div class="f"><span class="dim">국가</span><div class="chips">${chips('newCountries', [['KR', '한국'], ['US', '미국']])}</div></div>
      <label class="f"><span>모집 조건 (자유 글)</span><textarea data-bind="newBrief" rows="2" placeholder="예: 회의가 많은 직장인과 대학원생">${esc(S.newBrief)}</textarea></label>
      <p class="note">세트를 만드는 비용은 한 번만 들고, 다음 실행부터 다시 쓸 수 있습니다.</p>`}
    <label class="f"><span>실행 인원: <b id="countOut">${Number(S.count).toLocaleString()}</b>명</span><input type="range" data-bind="count" min="20" max="${CONF.maxPeople}" step="10" value="${esc(S.count)}" id="countRange"></label>
    ${costBox()}${nav()}`,

  () => `<h1>광고</h1>
    <p class="inline"><label><input type="radio" name="am" data-admode="auto" ${S.adMode === 'auto' ? 'checked' : ''}> 소재 자동 생성 (4개)</label> <label><input type="radio" name="am" data-admode="upload" ${S.adMode === 'upload' ? 'checked' : ''}> 소재 이미지 올리기</label></p>
    ${S.adMode === 'upload' ? `<label class="f"><span>소재 이미지 (세로 9:16로 잘립니다)</span><input type="file" id="adFiles" accept="image/png,image/jpeg,image/webp" multiple></label>
      <div class="ads2">${S.adItems.map((a, i) => `<div><img src="/draft/${S.draft}/${a.id}-ko.jpg" alt="${esc(a.name)}"><input type="text" data-ad="${i}" value="${esc(a.name)}" aria-label="소재 이름" style="width:100%"><button data-addel="${i}" style="margin-top:4px">삭제</button></div>`).join('')}</div>` : '<p class="dim">컨셉 설명과 화면으로 한국어·영어 소재를 만듭니다.</p>'}
    <label class="f" style="margin-top:12px"><span>광고 예산 ($)</span><input type="number" min="1" data-bind="budget" value="${esc(S.budget)}"></label>${nav()}`,

  () => `<h1>실행</h1>
    <label class="f"><span>OpenRouter 키 ${CONF.serverKey ? '(비우면 서버 키를 씁니다)' : '(필수)'}</span><input type="password" autocomplete="off" spellcheck="false" data-bind="key" value="${esc(S.key)}" placeholder="sk-or-…"></label>
    <p class="note">키는 이번 실행의 메모리에서만 쓰고 파일, 로그, 응답에 남기지 않습니다. 이 키로 돌린 실행은 서버에 키가 없으면 나중에 "생각 보기"가 되지 않습니다.</p>
    <details style="margin:12px 0"><summary class="dim" style="cursor:pointer">고급 옵션</summary>
      <label class="f" style="margin-top:8px"><span>판단 모델 (OpenRouter 모델 이름, 비우면 ${esc(CONF.model)})</span><input type="text" data-bind="model" value="${esc(S.model)}" placeholder="${esc(CONF.model)}" spellcheck="false"></label>
      <p class="note">비용 추정은 기본 모델 기준입니다. 소재와 보고서 문안은 별도 모델을 씁니다.</p></details>
    <label><input type="checkbox" data-check="report" ${S.report ? 'checked' : ''}> 끝나면 보고서도 만들기</label>
    ${costBox()}
    <p class="dim">가상 사람들의 시뮬레이션입니다. 다음에 시험할 것을 찾는 용도이고 매출 예측이 아닙니다.</p>${nav(true)}`,
];
function chips(field, opts) { return opts.map(([v, l]) => `<label class="${S[field].includes(v) ? 'on' : ''}"><input type="checkbox" data-chip="${field}" value="${esc(v)}" ${S[field].includes(v) ? 'checked' : ''}>${esc(l)}</label>`).join(''); }
function render() { wiz.innerHTML = crumbs() + VIEW[S.step](); wiz.parentElement.scrollTop = 0; }

const setPath = (path, v) => { const k = path.split('.'); let o = S; while (k.length > 1) o = o[k.shift()]; o[k[0]] = v; };
let matchTimer;
function refreshMatched() {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(async () => {
    if (!S.set) return;
    const q = new URLSearchParams({ set: S.set, ageMin: S.ageMin, ageMax: S.ageMax, text: S.text });
    S.countries.forEach(c => q.append('country', c)); S.sectors.forEach(c => q.append('sector', c));
    try { S.matched = (await api(`/api/audience?${q}`)).matched; } catch { return; }
    if ($('matched')) $('matched').textContent = S.matched.toLocaleString();
    refreshCost();
  }, 250);
}
async function chooseSet(id) { S.set = id; SET_INFO = null; S.sectors = []; S.matched = null; try { SET_INFO = await api(`/api/set?id=${encodeURIComponent(id)}`); } catch (e) { err = e.message; } if (S.step === 3) render(); refreshMatched(); }

wiz.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.bind) {
    setPath(t.dataset.bind, t.value);
    if (t.dataset.bind === 'count' && $('countOut')) $('countOut').textContent = Number(t.value).toLocaleString();
    if (t.dataset.bind === 'set') chooseSet(t.value);
    else if (['ageMin', 'ageMax', 'text'].includes(t.dataset.bind)) refreshMatched();
    if (['count', 'newCount'].includes(t.dataset.bind)) refreshCost();
  }
  if (t.dataset.s) {
    const s = S.screens[Number(t.closest('.scr').dataset.i)];
    if (t.dataset.s === 'kind') { const old = CONF.kinds[s.kind]?.baseline; if (s.baseline === old) s.baseline = CONF.kinds[t.value].baseline; s.kind = t.value; render(); return; }
    s[t.dataset.s] = t.value;
  }
  if (t.dataset.ad !== undefined) S.adItems[Number(t.dataset.ad)].name = t.value;
});
wiz.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.check) { setPath(t.dataset.check, t.checked); refreshCost(); }
  if (t.dataset.chip) { const a = S[t.dataset.chip], i = a.indexOf(t.value); if (t.checked && i < 0) a.push(t.value); if (!t.checked && i >= 0) a.splice(i, 1); t.parentElement.classList.toggle('on', t.checked); refreshMatched(); }
  if (t.dataset.mode) { S.mode = t.dataset.mode; render(); }
  if (t.dataset.admode) { S.adMode = t.dataset.admode; render(); }
  if (t.id === 'files' || t.id === 'adFiles') await upload([...t.files], t.id === 'adFiles' ? 'creative' : 'screen');
});
async function ensureDraft() { if (!S.draft) S.draft = (await post('/api/draft', {})).draft; }
const addScreen = (id, name, kind) => S.screens.push({ id, name, kind, baseline: CONF.kinds[kind]?.baseline || '' });
async function work(label, fn) { err = ''; busy = label; render(); try { await fn(); } catch (e) { err = e.message; } busy = ''; render(); }
function upload(files, kind) {
  return work('이미지를 올리는 중입니다…', async () => {
    await ensureDraft();
    for (const f of files) {
      const { id } = await api(`/api/upload?draft=${S.draft}&kind=${kind}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const name = f.name.replace(/\.[^.]+$/, '').slice(0, 30);
      if (kind === 'creative') S.adItems.push({ id, name }); else addScreen(id, name, S.screens.length ? 'app' : 'onboarding');
    }
  });
}
wiz.addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.zoom) { $('zoom').querySelector('img').src = t.dataset.zoom; $('zoom').hidden = false; return; }
  if (t.dataset.go !== undefined && !t.disabled) { err = ''; S.step = Number(t.dataset.go); render(); return; }
  if (t.hasAttribute('data-back')) { err = ''; S.step--; render(); return; }
  if (t.hasAttribute('data-next')) { const bad = validate(); err = bad || ''; if (!bad) S.step++; render(); return; }
  if (t.hasAttribute('data-capture')) {
    if (!S.url.trim()) { err = '주소를 입력해 주세요.'; render(); return; }
    return work('캡처하는 중입니다. 사이트에 따라 30초 정도 걸립니다…', async () => {
      await ensureDraft();
      const { screens } = await post('/api/capture', { draft: S.draft, url: S.url.trim(), shots: S.shots });
      screens.forEach(s => addScreen(s.id, s.name, s.kind));
      S.url = '';
    });
  }
  const row = t.closest?.('.scr');
  if (row) {
    const i = Number(row.dataset.i), a = S.screens;
    if (t.hasAttribute('data-up')) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; render(); }
    if (t.hasAttribute('data-down')) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; render(); }
    if (t.hasAttribute('data-del')) { a.splice(i, 1); render(); }
  }
  if (t.dataset.addel !== undefined) { S.adItems.splice(Number(t.dataset.addel), 1); render(); }
  if (t.hasAttribute('data-start')) return launch();
});
$('zoom').addEventListener('click', () => { $('zoom').hidden = true; });

function validate() {
  if (S.step === 0) { if (!S.product.trim()) return '제품 이름을 입력해 주세요.'; if (!S.concept.trim()) return '컨셉 설명을 입력해 주세요.'; if (!S.screens.length) return '화면을 한 장 이상 가져와 주세요.'; }
  if (S.step === 1 && !S.screens.length) return '화면을 한 장 이상 남겨 주세요.';
  if (S.step === 2 && !(Number(S.prices.weekly) > 0 || Number(S.prices.annual) > 0)) return '주간 또는 연간 요금을 하나 이상 입력해 주세요.';
  if (S.step === 3) {
    if (S.mode === 'new' && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(S.newId)) return '세트 id는 영문·숫자·-·_ 로 입력해 주세요.';
    if (S.mode === 'reuse' && S.matched === 0) return '조건에 맞는 사람이 없습니다. 필터를 줄여 주세요.';
  }
  if (S.step === 4 && S.adMode === 'upload' && !S.adItems.length) return '소재 이미지를 한 장 이상 올려 주세요.';
  return '';
}

async function launch() {
  if (!S.key.trim() && !CONF.serverKey) { err = 'OpenRouter 키를 입력해 주세요.'; render(); return; }
  err = ''; busy = '시작하는 중입니다…'; render();
  try {
    const job = await post('/api/start', {
      draft: S.draft, product: S.product, concept: S.concept, screens: S.screens, prices: S.prices, report: S.report, key: S.key, model: S.model,
      persona: S.mode === 'new'
        ? { count: S.count, newSet: { id: S.newId, count: S.newCount, name: S.newId, brief: S.newBrief, countries: S.newCountries } }
        : { set: S.set, count: S.count, filters: { countries: S.countries, sectors: S.sectors, ageMin: S.ageMin, ageMax: S.ageMax, text: S.text } },
      ads: { mode: S.adMode, items: S.adItems, budget: S.budget },
    });
    S.key = '';
    busy = '';
    history.replaceState(null, '', `?job=${encodeURIComponent(job.id)}`);
    scenario(job.id);
  } catch (e) { busy = ''; err = e.message; render(); }
}

// ---------- live scenario ----------
const SCENE = { screens: '제품 화면 읽기', people: '페르소나', ads: '광고 소재 생성', sim: '시뮬레이션', report: '보고서' };
let J = null, stop = null;
const passed = name => J.status === 'done' || J.steps.indexOf(J.step) > J.steps.indexOf(name);
const reached = name => J.status === 'done' || J.steps.indexOf(J.step) >= J.steps.indexOf(name);
const dead = () => ['failed', 'cancelled', 'interrupted'].includes(J.status);
async function until(fn) { while (!fn()) { if (dead()) throw new Error('stopped'); await sleep(200); } }

function section(name, body) {
  const el = document.createElement('section');
  el.className = 'box'; el.dataset.scene = name;
  el.innerHTML = `<h2 style="margin:0 0 8px"><span class="st wait">진행 중</span> ${esc(SCENE[name])}</h2>${body}`;
  $('scenes').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}
const finishSection = (el, text) => { const s = el.querySelector('.st'); s.textContent = text || '완료'; s.className = 'st'; s.style.color = 'var(--install)'; };

async function poll(id) {
  while (!stop) {
    try { J = await api(`/api/job?id=${encodeURIComponent(id)}`); } catch { await sleep(1500); continue; }
    $('totalCost').textContent = `지금까지 실제 비용 $${J.cost.toFixed(4)}`;
    if (J.status !== 'running') { $('cancel').hidden = true; if (dead()) showStop(); return; }
    await sleep(700);
  }
}
function showStop() {
  $('stopMsg').textContent = J.status === 'cancelled' ? '실행을 중단했습니다.' : J.status === 'interrupted' ? '서버가 다시 시작되어 실행이 끊겼습니다.' : `실행이 실패했습니다. ${J.error || ''}`;
}

async function sceneScreens() {
  const el = section('screens', '<div class="ads2" id="scrCards"></div>');
  const box = el.querySelector('#scrCards');
  for (const s of J.screens) {
    const d = document.createElement('div');
    d.innerHTML = `<img src="/screens/ko/${encodeURIComponent(s.id)}.jpg?run=${encodeURIComponent(J.id)}" alt="${esc(s.title)}" style="aspect-ratio:auto;height:150px;object-fit:cover;object-position:top"><small>${esc(s.title)}</small>`;
    box.appendChild(d);
    await sleep(350);
  }
  finishSection(el, `${J.screens.length}장 읽음`);
}
async function scenePeople() {
  await until(() => reached('people'));
  const el = section('people', `<p class="dim" id="pplHead" style="margin:0 0 6px">${J.newSet ? '새 사람을 만들고 있습니다' : '세트에서 사람을 불러옵니다'}</p><div id="dots" style="display:flex;flex-wrap:wrap;gap:2px;max-height:96px;overflow:hidden;margin-bottom:8px"></div><div class="log" id="feed" style="position:static;height:190px"></div>`);
  let from = 0;
  for (;;) {
    const canEnd = passed('people') || (!J.newSet && J.people > 0);
    const { total, rows } = await api(`/api/job/people?id=${encodeURIComponent(J.id)}&from=${from}&limit=200`);
    const pace = Math.max(1, Math.ceil(total / 80));
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const dot = document.createElement('i');
      dot.style.cssText = 'display:block;width:5px;height:5px;background:var(--live)';
      $('dots').appendChild(dot);
      const line = document.createElement('div');
      line.textContent = `${p.country === 'KR' ? '한국' : '미국'} ${p.name}, ${p.age}세 · ${p.job} · ${(p.apps || []).join(', ')}`;
      $('feed').appendChild(line);
      while ($('feed').children.length > 9) $('feed').firstChild.remove();
      if (i % pace === 0) await sleep(45);
    }
    from += rows.length;
    $('pplHead').textContent = `${J.newSet ? '만든 사람' : '불러온 사람'} ${from.toLocaleString()}명${J.newSet && J.info.people?.total ? ` / ${J.info.people.total.toLocaleString()}명` : total ? ` / ${total.toLocaleString()}명` : ''}`;
    if (canEnd && from >= total) break;
    if (dead()) throw new Error('stopped');
    if (!rows.length) await sleep(600);
  }
  finishSection(el, `${from.toLocaleString()}명`);
}
async function sceneAds() {
  await until(() => reached('ads'));
  const el = section('ads', '<p class="dim" id="adMsg" style="margin:0 0 6px">소재 문구를 쓰고 이미지를 만드는 중입니다</p><div class="ads2" id="adCards"></div>');
  await until(() => J.creatives.length || passed('ads'));
  el.querySelector('#adMsg').textContent = `소재 ${J.creatives.length}개`;
  for (const c of J.creatives) {
    const d = document.createElement('div');
    d.innerHTML = `<img src="/creatives/${encodeURIComponent(c.id)}-ko.jpg?run=${encodeURIComponent(J.id)}" alt="${esc(c.hook)}"><small>${esc(c.hook)}</small>`;
    el.querySelector('#adCards').appendChild(d);
    await sleep(300);
  }
  finishSection(el);
}
async function sceneSim() {
  await until(() => reached('sim'));
  const el = section('sim', '<p id="simNum" style="margin:0" class="cost"></p><div class="prog"><i id="simBar"></i></div><p class="note">사람마다 광고를 보고 화면을 지나며 30일을 삽니다. 완료 인원과 비용은 서버 값입니다.</p>');
  const paint = () => {
    const i = J.info.sim || { done: 0, total: 0, cost: 0 }, total = i.total || J.people;
    el.querySelector('#simNum').innerHTML = `<b>${i.done.toLocaleString()}</b> / ${total.toLocaleString()}명 완료 · 판단 비용 $${i.cost.toFixed(4)}`;
    el.querySelector('#simBar').style.width = `${total ? i.done / total * 100 : 0}%`;
  };
  while (!passed('sim')) { if (dead()) throw new Error('stopped'); paint(); await sleep(300); }
  paint();
  el.querySelector('#simBar').style.width = '100%';
  finishSection(el);
}
async function sceneReport() {
  if (!J.steps.includes('report')) return;
  await until(() => reached('report'));
  const el = section('report', '<p class="dim" style="margin:0">이탈 이유를 묶고 문안을 쓰는 중입니다. 끝나는 시점은 예측할 수 없어 진행률이 없습니다.</p>');
  await until(() => J.status === 'done');
  finishSection(el);
}
async function scenario(id) {
  stop = null;
  wiz.innerHTML = `<h1>시뮬레이션 실행</h1><p class="dim cost"><span id="runId"></span> · <span id="totalCost"></span></p><div id="scenes"></div><p class="err" id="stopMsg" role="alert"></p><p id="after"></p><div class="nav"><button id="cancel">중단</button><a href="new.html" class="dim">새로 만들기</a></div>`;
  $('runId').textContent = id;
  $('cancel').onclick = () => { if (confirm('실행을 중단할까요? 이미 쓴 비용은 돌아오지 않습니다.')) post(`/api/job/cancel?id=${encodeURIComponent(id)}`, {}); };
  try { J = await api(`/api/job?id=${encodeURIComponent(id)}`); } catch (e) { $('stopMsg').textContent = e.message; return; }
  poll(id);
  try {
    await sceneScreens(); await scenePeople(); await sceneAds(); await sceneSim(); await sceneReport();
  } catch (e) {
    if (e.message !== 'stopped') $('stopMsg').textContent = e.message;
    if (dead()) showStop();
    return;
  }
  const url = `/?run=${encodeURIComponent(id)}`;
  const notes = [...(J.warnings || []), ...(J.notes || [])];
  $('after').innerHTML = `${notes.map(n => `<span class="dim">${esc(n)}</span><br>`).join('')}<a href="${url}">결과 화면으로 이동합니다</a>`;
  await sleep(notes.length ? 5000 : 1800);
  location.href = url;
}

// ---------- boot ----------
(async () => {
  try {
    [CONF, SETS, RUNS] = await Promise.all([api('/api/config'), api('/api/sets'), api('/api/runs')]);
  } catch (e) { err = e.message; }
  const job = new URLSearchParams(location.search).get('job');
  if (job) return scenario(job);
  render();
  const first = SETS.find(s => s.id === 'kr-us-10k') || SETS[0];
  if (first) chooseSet(first.id);
})();
