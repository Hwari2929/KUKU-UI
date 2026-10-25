// 조립된 HTML 을 jsdom 에서 실제로 실행해 화면 흐름을 검증한다
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const fakeIDB = require('fake-indexeddb');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();
function sseRes(events) { const bytes = enc.encode(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')); const ch = []; for (let i = 0; i < bytes.length; i += 80) ch.push(bytes.slice(i, i + 80)); let i = 0; return { ok: true, status: 200, headers: new Map(), body: { getReader: () => ({ read: async () => { await sleep(1); return i < ch.length ? { value: ch[i++], done: false } : { done: true }; }, cancel: async () => {} }) } }; }
let sq = 0;
function reply({ text, tools = [], usage = {}, out = 200 }) {
  const ev = [{ type: 'message_start', message: { id: 'm' + ++sq, model: 'claude-sonnet-5-5', usage: { input_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, ...usage } } }]; let i = 0;
  if (text) ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: i++ });
  for (const t of tools) ev.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: 'tu' + ++sq, name: t.name, input: {} } }, { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } }, { type: 'content_block_stop', index: i++ });
  ev.push({ type: 'message_delta', delta: { stop_reason: tools.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: out } }, { type: 'message_stop' }); return ev;
}
// ── 가짜 GitHub
const gitSha = (s) => { const b = Buffer.from(s, 'utf8'); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const repo = { files: new Map(), trees: new Map(), blobs: new Map(), commits: [], head: null }; let cn = 0;
function commitAll(msg) { const es = [...repo.files].map(([p, c]) => ({ path: p, mode: '100644', type: 'blob', sha: gitSha(c), size: Buffer.byteLength(c) })); es.forEach((e) => repo.blobs.set(e.sha, repo.files.get(e.path))); const t = 'tree' + ++cn; repo.trees.set(t, es); const c = 'commit' + cn; repo.commits.push({ sha: c, tree: { sha: t }, message: msg }); repo.head = c; }
repo.files.set('lore/인물/린디웨.md', '# 린디웨\n협력팀장. [[비비안]] 과 친구.\n'); repo.files.set('lore/인물/비비안.md', '# 비비안\n작전반.\n'); repo.files.set('docs/VOICES.md', '# VOICES\n## 린디웨\n해요체\n'); repo.files.set('CLAUDE.md', '# 규칙\n숫자는 아라비아 숫자\n'); commitAll('init');
let anth = []; const anthReqs = []; let fxMode = 'ok'; const fxCalls = [];
const J = (o, st = 200) => ({ ok: st < 300, status: st, statusText: 'x', headers: { get: () => null }, json: async () => o, text: async () => JSON.stringify(o) });
const mockFetch = async (url, opts = {}) => {
  const u = new URL(url), p = decodeURIComponent(u.pathname), method = opts.method || 'GET';
  if (u.host === 'api.anthropic.com') { if (p.endsWith('/models')) return J({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' }] }); if (p.endsWith('/count_tokens')) return J({ input_tokens: 4321 }); anthReqs.push(JSON.parse(opts.body)); const s = anth.shift(); if (!s) throw new Error('anthropic script empty'); return sseRes(s); }
  if (u.host === 'api.frankfurter.dev') { fxCalls.push(u.host); return fxMode === 'ok' ? J({ base: 'USD', date: '2026-10-23', rates: { KRW: 1385.5 } }) : J({}, 500); }
  if (u.host === 'open.er-api.com') { fxCalls.push(u.host); return J({ result: 'success', time_last_update_utc: 'Sun, 25 Oct 2026 00:02:31 +0000', rates: { KRW: 1401.25 } }); }
  if (u.host === 'raw.githubusercontent.com') { const m = p.match(/^\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/); const c = repo.files.get(m[2]); return c == null ? J('nf', 404) : { ok: true, status: 200, text: async () => c }; }
  let m;
  if ((m = p.match(/\/git\/ref\/heads\/(.+)$/))) return J({ object: { sha: repo.head } });
  if ((m = p.match(/\/git\/commits\/(.+)$/)) && method === 'GET') return J(repo.commits.find((c) => c.sha === m[1]));
  if ((m = p.match(/\/git\/trees\/(.+)$/)) && method === 'GET') return J({ tree: repo.trees.get(m[1]), truncated: false });
  if (p.endsWith('/git/blobs') && method === 'POST') { const b = JSON.parse(opts.body); const sha = gitSha(b.content); repo.blobs.set(sha, b.content); return J({ sha }, 201); }
  if (p.endsWith('/git/trees') && method === 'POST') { const b = JSON.parse(opts.body); const base = new Map(repo.trees.get(repo.commits.find((c) => c.tree.sha === b.base_tree).tree.sha).map((e) => [e.path, e])); for (const e of b.tree) { if (e.sha === null) base.delete(e.path); else base.set(e.path, { path: e.path, mode: e.mode, type: 'blob', sha: e.sha, size: 1 }); } const t = 'tree' + ++cn; repo.trees.set(t, [...base.values()]); return J({ sha: t }, 201); }
  if (p.endsWith('/git/commits') && method === 'POST') { const b = JSON.parse(opts.body); const sha = 'commit' + ++cn; repo.commits.push({ sha, tree: { sha: b.tree }, message: b.message }); return J({ sha }, 201); }
  if (p.match(/\/git\/refs\/heads\/.+$/) && method === 'PATCH') { const b = JSON.parse(opts.body); repo.head = b.sha; const t = repo.trees.get(repo.commits.find((c) => c.sha === b.sha).tree.sha); repo.files = new Map(t.map((e) => [e.path, repo.blobs.get(e.sha)])); return J({}); }
  return J({ message: 'nope ' + p }, 404);
};

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ERTES-Studio.html'), 'utf8');
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && e.detail.stack || e.message))); vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.test/', virtualConsole: vc, beforeParse(w) { w.indexedDB = fakeIDB.indexedDB; w.IDBKeyRange = fakeIDB.IDBKeyRange; w.fetch = mockFetch; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} }); w.HTMLElement.prototype.scrollIntoView = function () {}; } });
  const W = dom.window; const $ = (s) => W.document.querySelector(s), $$ = (s) => [...W.document.querySelectorAll(s)]; const ev = (c) => W.eval(c);
  for (let i = 0; i < 100 && !W.__ready; i++) await sleep(30);
  ok(W.__ready != null, '부팅 완료'); eq(ev('DB.kind'), 'indexeddb');
  ok($('#top .brand').textContent.includes('ERTES')); ok($('#btnBudget').textContent.includes('$100') && !$('#btnBudget').textContent.includes('₩'), '예산 칩(달러): ' + $('#btnBudget').textContent);
  // ── 환율: 첫 실행에서 한 번 받아 기록
  for (let i = 0; i < 50 && !ev('S.settings.budget.fx.ts'); i++) await sleep(30);
  eq(ev('S.settings.budget.fx.rate'), 1385.5); eq(ev('S.settings.budget.krwPerUSD'), 1385.5); eq(ev('S.settings.budget.fx.source'), 'frankfurter.dev'); eq(ev('S.settings.budget.fx.date'), '2026-10-23'); eq(ev('S.settings.budget.creditUSD'), 100); eq(ev('S.settings.budget.creditKRW'), undefined);
  eq(fxCalls.length, 1, '첫 실행에 한 번만'); ok(Math.abs(ev('Budget.remaining()') - 100) < 1e-6, '남은 크레딧 100달러');
  fxMode = 'bad'; const fr = await ev('FX.refresh({ silent: true })'); ok(fr.ok && fr.source === 'open.er-api.com' && ev('S.settings.budget.krwPerUSD') === 1401.25, '보조 출처로 갱신'); eq(fxCalls.length, 3);
  // ── 설정에 키 넣고 GitHub 에서 받기
  ev("S.secrets.apiKey='sk-test'; S.settings.gh.branch='main'; S.settings.gh.includes=['lore/','docs/','CLAUDE.md']; S.settings.pinned=['CLAUDE.md']");
  $('#sideTabs [data-tab=sync]').click(); await sleep(30); ok($('#sidePane').textContent.includes('Hwari2929/ERTES'), '동기화 탭'); $('#sidePane [data-act=doPull]').click();
  for (let i = 0; i < 50 && ev('FS.paths().length') < 4; i++) await sleep(30); eq(ev('FS.paths().length'), 4, 'pull 결과');
  $('#sideTabs [data-tab=files]').click(); await sleep(250); ok($('#tree').textContent.includes('lore'), '트리에 lore 폴더');
  // ── 파일 열기 · 편집
  ev("Ed.open('lore/인물/린디웨.md')"); await sleep(50); const ta = $('#edBody textarea'); ok(ta && ta.value.includes('협력팀장'), '에디터에 내용'); ok($('#tabbar').textContent.includes('린디웨'));
  ta.value = ta.value + '세 잔을 마셨다\n'; ta.dispatchEvent(new W.Event('input', { bubbles: true })); await sleep(600);
  ok(ev("FS.read('lore/인물/린디웨.md')").includes('세 잔을'), '입력이 FS 에 반영'); ok($('#edBody pre').innerHTML.includes('class="le"') || $('#edBody pre').innerHTML.includes('le'), '린트 밑줄'); ok($('#lintbar').textContent.includes('오류'), '린트 바: ' + $('#lintbar').textContent.slice(0, 40));
  ok($('#edTools').textContent.includes('M') || $('#edTools .bd.M'), '수정 배지'); eq(ev("FS.status(FS.get('lore/인물/린디웨.md'))"), 'M'); ok($('#btnSync').textContent.includes('변경 1'), '상단 변경 수');
  // 자동 고치기
  $('#lintbar [data-act=lintFix]').click(); await sleep(400); ok(ev("FS.read('lore/인물/린디웨.md')").includes('3잔을'), '수 표기 자동 수정');
  // 미리보기 · 변경 보기
  $('#edTools [data-v=preview]').click(); await sleep(30); ok($('#edScroll .md a.wl'), '미리보기 위키링크'); $('#edTools [data-v=diff]').click(); await sleep(30); ok($('#edScroll .df'), 'diff 보기'); $('#edTools [data-v=edit]').click(); await sleep(30);
  // 찾기
  ev('Ed.findOpen("팀장")'); await sleep(60); ok($('#findN').textContent.includes('1/1'), '찾기 결과: ' + $('#findN').textContent); ev('Ed.findClose()');
  // 장면 문서 미리보기
  ev("FS.set('drafts/장면/a.md', '## 주연: 린디웨\\n## 본문\\n{bg=bar bgm=calm} 문이 열린다.\\n린디웨 {L smile}: 안녕하세요\\n[조연]\\n## 조연 비비안\\n비비안: 왔어?\\n## 결과 0\\n린디웨: 네')"); ev("Ed.open('drafts/장면/a.md')"); await sleep(30); ev("S.ui.view='preview'; Ed.renderAll()"); await sleep(30); ok($('.scene .pill') && $('.scene').textContent.includes('조연 후보'), '장면 미리보기'); ev("S.ui.view='edit'; Ed.renderAll()");
  // ── 빠른 열기
  ev('Quick.open()'); await sleep(50); ok($('.modal #qi'), '빠른 열기'); const qi = $('.modal #qi'); qi.value = '비비'; qi.dispatchEvent(new W.Event('input')); await sleep(30); ok($('.modal .qo').textContent.includes('비비안')); qi.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(50); eq(ev('S.ui.cur'), 'lore/인물/비비안.md', '빠른 열기로 이동'); ok(!$('.modal'), '모달 닫힘');
  // ── 대화: 도구 루프 + 비용 요약
  anth = [
    reply({ text: '찾아볼게요.', tools: [{ name: 'search', input: { query: '린디웨 팀장' } }], usage: { cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 0 } } }),
    reply({ text: '린디웨는 협력팀장이에요. (lore/인물/린디웨.md)', usage: { cache_read_input_tokens: 3000, input_tokens: 700 }, out: 150 }),
  ];
  const ci = $('#chatInput'); ci.value = '린디웨는 어떤 인물이야?'; ci.dispatchEvent(new W.Event('input')); $('#sendBtn').click();
  for (let i = 0; i < 100 && ev('S.run.busy'); i++) await sleep(30); await sleep(100);
  eq(anthReqs.length, 2); ok(anthReqs[0].system[0].text.includes('아라비아 숫자') && anthReqs[0].system[0].text.includes('[고정 문서: CLAUDE.md]'), '시스템 프롬프트 + 고정 문서');
  ok(anthReqs[0].system[1].text.includes('파일 색인') && anthReqs[0].system.every((b) => b.cache_control), '색인 블록 캐시'); ok(anthReqs[0].messages[0].content[0].text.includes('[열린 문서:'), '열린 문서 알림 포함');
  ok($('#msgs').textContent.includes('린디웨는 협력팀장이에요'), '답변 표시'); ok($('#msgs .tcall'), '도구 카드'); ok($('#msgs .turnsum'), '턴 요약'); const ts = $('#msgs .turnsum').textContent;
  ok(/호출 2회/.test(ts) && /\$0\.\d+/.test(ts) && /₩\d+/.test(ts) && ts.indexOf('$') < ts.indexOf('₩') && ts.includes('읽기') && ts.includes('쓰기'), '턴 요약 내용: ' + ts.slice(0, 160));
  const cost1 = ev('S.ledger.reduce((a,e)=>a+e.cost,0)'); // 500*2+3000*2.5+200*10 =10500 ; 700*2+3000*.1+150*10 = 3200 → 13700e-6
  ok(Math.abs(cost1 - 0.0137) < 1e-9, '비용 계산 ' + cost1); ok(/\$9\d\.\d+/.test($('#btnBudget').textContent), '칩 갱신: ' + $('#btnBudget').textContent);
  // ── 예산 패널
  $('#btnBudget').click(); await sleep(50); const bt = $('.modal').textContent; ok(bt.includes('남은 크레딧') && bt.includes('캐시 읽기') && bt.includes('토큰 종류별'), '예산 현황'); ok(/\$0\.0137/.test(bt), '누적 비용 표시');
  $('.modal [data-t=turns]').click(); await sleep(30); ok($('.modal').textContent.includes('린디웨는 어떤 인물이야?'), '턴 내역 행'); $('.modal tr.cl').click(); await sleep(30); ok($$('.modal tr.sub').length === 2, '호출별 펼침');
  $('.modal [data-t=cfg]').click(); await sleep(30); const cal = $('.modal #calVal'); cal.value = '50'; $('.modal #calUnit').value = 'USD'; $('.modal [data-act=budCalib]').click(); await sleep(50); near(ev('Budget.remaining()'), 50); ok($('.modal').textContent.includes('보정 시각'), '보정 기록');
  { const ct = $('.modal').textContent; ok(ct.includes('총 크레딧 (USD)') && ct.includes('지금 갱신') && ct.includes('마지막으로 받은 값') && ct.includes('Rates By Exchange Rate API'), '환율 설정 UI: ' + ct.slice(ct.indexOf('환율'), ct.indexOf('환율') + 120)); eq($('.modal #cfCredit').value, '100');
    fxMode = 'ok'; $('.modal [data-act=fxRefresh]').click(); for (let i = 0; i < 50 && ev('S.settings.budget.krwPerUSD') !== 1385.5; i++) await sleep(30); eq(ev('S.settings.budget.krwPerUSD'), 1385.5); await sleep(30); eq($('.modal #cfRate').value, '1385.5');
    ok(!W.document.documentElement.classList.contains('nokrw')); $('.modal #cfShowKRW').checked = false; $('.modal [data-act=budSave]').click(); await sleep(30); ok(W.document.documentElement.classList.contains('nokrw'), '원화 숨김'); eq(ev('altUSD(1)'), ''); $('.modal #cfShowKRW').checked = true; $('.modal [data-act=budSave]').click(); await sleep(30); ok(!W.document.documentElement.classList.contains('nokrw')); }
  $('.modal [data-t=stats]').click(); await sleep(30); ok($('.modal').textContent.includes('모델별')); ev('Modal.closeAll()');
  // ── AI 쓰기 승인
  anth = [reply({ tools: [{ name: 'write_note', input: { path: 'drafts/장면/new.md', content: '## 본문\n세 잔', summary: '시험' } }] }), reply({ text: '올렸어요.' })];
  ci.value = '써 줘'; ci.dispatchEvent(new W.Event('input')); $('#sendBtn').click(); for (let i = 0; i < 100 && ev('S.run.busy'); i++) await sleep(30); await sleep(100);
  eq(ev('S.pending.length'), 1); ok(!$('#btnPending').classList.contains('hidden'), '승인 대기 칩'); $('#btnPending').click(); await sleep(50); ok($('.modal .pitem').textContent.includes('drafts/장면/new.md') && $('.modal .pitem').textContent.includes('린트 오류'), '승인 화면'); $('.modal [data-act=apprOk]').click(); await sleep(150);
  ok(ev("FS.has('drafts/장면/new.md')"), '승인 후 파일 생성'); eq(ev('S.pending.length'), 0); ok(ev('S.snaps.length') >= 1, '스냅샷 기록');
  // ── 슬래시 로컬 명령은 무료
  const nreq = anthReqs.length; ci.value = '/검색 협력팀장'; ci.dispatchEvent(new W.Event('input')); ci.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(100); ok($('#msgs').textContent.includes('린디웨'), '로컬 검색 결과'); eq(anthReqs.length, nreq, 'API 호출 없음');
  // 슬래시 팝업
  ci.value = '/장'; ci.dispatchEvent(new W.Event('input')); await sleep(30); ok(!$('#slashpop').classList.contains('hidden') && $('#slashpop').textContent.includes('/장면'), '슬래시 팝업'); ci.value = '';
  // ── 충돌 해결 화면
  ev("FS.set('docs/VOICES.md','LOCAL'); GH.base"); repo.files.set('docs/VOICES.md', 'REMOTE'); commitAll('r'); $('#sideTabs [data-tab=sync]').click(); await sleep(30); $('#sidePane [data-act=doPull]').click(); for (let i = 0; i < 60 && !$('.modal'); i++) await sleep(30);
  ok($('.modal .conf'), '충돌 화면'); $('.modal input[value=theirs]').click(); $('.modal input[value=theirs]').dispatchEvent(new W.Event('change', { bubbles: true })); await sleep(20); ok($('.modal #cfFinal').value === 'REMOTE', '원격 선택 결과: ' + $('.modal #cfFinal').value); [...$$('.modal footer button')].find((b) => b.textContent.includes('적용')).click(); await sleep(60); eq(ev("FS.status(FS.get('docs/VOICES.md'))"), null, '원격 선택 시 변경 없음');
  // ── 푸시
  ev("S.secrets.ghToken='tok'"); $('#sideTabs [data-tab=sync]').click(); ev("Side.render()"); await sleep(30); ok($('#sidePane').textContent.includes('커밋 · 푸시'), '푸시 버튼'); ev("Side.commitMsg='studio: 시험'"); ev("Side.render()"); $('#sidePane [data-act=doPush]').click(); await sleep(60); [...$$('.modal footer button')].find((b) => b.textContent === '푸시').click();
  for (let i = 0; i < 80 && !$$('.modal header').some((h) => h.textContent.includes('푸시 완료')); i++) await sleep(30); ok($$('.modal header').some((h) => h.textContent.includes('푸시 완료')), '푸시 완료 모달'); ev('Modal.closeAll()');
  ok(repo.files.get('docs/VOICES.md') === 'REMOTE' || repo.files.has('drafts/장면/new.md'), '리포에 반영'); ok(repo.files.has('drafts/장면/new.md'), '새 파일이 리포에');
  // ── 설정 저장 · 백업
  $('#btnSettings').click(); await sleep(40); ok($('.modal #sKey').value === 'sk-test'); $('.modal #sTTL').value = '1h'; [...$$('.modal footer button')].find((b) => b.textContent === '저장').click(); await sleep(60); eq(ev('S.settings.cacheTTL'), '1h');
  // OpenRouter 프리셋 버튼: 칸 채움 → 저장 → 설정 반영
  $('#btnSettings').click(); await sleep(40); $('.modal [data-act=oPreset]').click(); await sleep(20);
  eq([$('.modal #sProv').value, $('.modal #sOBase').value, $('.modal #sOModel').value, $('.modal #sOIn').value, $('.modal #sOOut').value, $('.modal #sOCr').value], ['openai', 'https://openrouter.ai/api/v1', 'google/gemini-4-argon', '2', '10', '0.1']);
  $('.modal #sOKey').value = 'sk-or-test'; [...$$('.modal footer button')].find((b) => b.textContent === '저장').click(); await sleep(60);
  eq(ev('[S.settings.provider, S.settings.openai.model, S.settings.openai.cr, S.secrets.openaiKey]'), ['openai', 'google/gemini-4-argon', 0.1, 'sk-or-test']); eq(ev('LLM.modelId'), 'google/gemini-4-argon');
  ev("S.settings.provider='anthropic'; saveSettings()");
  const bk = await ev('Settings.backup(false)'); ok(bk.files.length >= 5 && bk.chats.length >= 1 && bk.ledger.length >= 4 && !bk.secrets, '백업 내용');
  ok(errors.length === 0, '콘솔 오류 없음: ' + errors.join('\n').slice(0, 800));
  console.log(`ui OK (${n} assertions)`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`); }
