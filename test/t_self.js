// 자가개선: 작업공간 전환 · 작업 브랜치 푸시/PR · 쓰기 규칙 · 코드용 도구 · 브라우저 빌드(= node build.js 와 바이트 단위로 같은지)
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
const W = path.join(__dirname, '..');
const gitSha = (s) => { const b = Buffer.from(s, 'utf8'); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };

// ── "KUKU-UI 리포" = 이 소스 폴더 그대로 (build.js 가 만드는 생성물/테스트 의존물은 제외)
const srcFiles = new Map();
(function walk(dir, rel) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { if (['node_modules', 'jsdomenv', '.git'].includes(e.name)) continue; walk(path.join(dir, e.name), r); } else if (/\.(js|css|html|md|json)$/.test(e.name) && e.name !== 'ERTES-Studio.html') srcFiles.set(r, fs.readFileSync(path.join(dir, e.name), 'utf8')); } })(W, '');

// ── 가짜 GitHub: 브랜치 여러 개, 리포 이름별로 따로
const gh = { branches: new Map(), commits: new Map(), trees: new Map(), blobs: new Map(), prs: [], log: [] };
let cn = 0;
function mkCommit(files, parent, message) { const entries = [...files].map(([p, c]) => ({ path: p, mode: '100644', type: 'blob', sha: gitSha(c), size: Buffer.byteLength(c) })); entries.forEach((e) => gh.blobs.set(e.sha, files.get(e.path))); const tsha = 'tree' + ++cn; gh.trees.set(tsha, entries); const sha = 'commit' + ++cn; gh.commits.set(sha, { sha, tree: { sha: tsha }, parents: parent ? [parent] : [], message }); return sha; }
gh.branches.set('main', mkCommit(srcFiles, null, 'init'));
const filesOf = (sha) => new Map(gh.trees.get(gh.commits.get(sha).tree.sha).map((e) => [e.path, gh.blobs.get(e.sha)]));
const J = (o, st = 200) => ({ ok: st < 300, status: st, statusText: 'x', json: async () => o, text: async () => (typeof o === 'string' ? o : JSON.stringify(o)), headers: { get: () => null } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url), method = opts.method || 'GET', p = decodeURIComponent(u.pathname); gh.log.push(method + ' ' + p + u.search);
  let m;
  if (u.host === 'raw.githubusercontent.com') { m = p.match(/^\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/); const c = filesOf(m[1]).get(m[2]); return c == null ? J('nf', 404) : { ok: true, status: 200, text: async () => c }; }
  if ((m = p.match(/\/git\/ref\/heads\/(.+)$/))) return gh.branches.has(m[1]) ? J({ object: { sha: gh.branches.get(m[1]) } }) : J({ message: 'Not Found' }, 404);
  if (p.endsWith('/git/refs') && method === 'POST') { const b = JSON.parse(opts.body); gh.branches.set(b.ref.replace('refs/heads/', ''), b.sha); return J({}, 201); }
  if ((m = p.match(/\/git\/commits\/(.+)$/)) && method === 'GET') return J(gh.commits.get(m[1]));
  if ((m = p.match(/\/git\/trees\/(.+)$/)) && method === 'GET') return J({ tree: gh.trees.get(m[1]), truncated: false });
  if ((m = p.match(/\/git\/blobs\/(.+)$/)) && method === 'GET') return J({ content: Buffer.from(gh.blobs.get(m[1])).toString('base64') });
  if (p.endsWith('/git/blobs') && method === 'POST') { const b = JSON.parse(opts.body); const sha = gitSha(b.content); gh.blobs.set(sha, b.content); return J({ sha }, 201); }
  if (p.endsWith('/git/trees') && method === 'POST') { const b = JSON.parse(opts.body); const base = new Map(gh.trees.get(b.base_tree).map((e) => [e.path, e])); for (const e of b.tree) { if (e.sha === null) base.delete(e.path); else base.set(e.path, { path: e.path, mode: e.mode, type: 'blob', sha: e.sha, size: Buffer.byteLength(gh.blobs.get(e.sha)) }); } const t = 'tree' + ++cn; gh.trees.set(t, [...base.values()]); return J({ sha: t }, 201); }
  if (p.endsWith('/git/commits') && method === 'POST') { const b = JSON.parse(opts.body); const sha = 'commit' + ++cn; gh.commits.set(sha, { sha, tree: { sha: b.tree }, parents: b.parents, message: b.message }); return J({ sha }, 201); }
  if ((m = p.match(/\/git\/refs\/heads\/(.+)$/)) && method === 'PATCH') { const b = JSON.parse(opts.body); if (!gh.branches.has(m[1])) return J({ message: 'nf' }, 404); gh.branches.set(m[1], b.sha); return J({}); }
  if (p.endsWith('/pulls') && method === 'POST') { const b = JSON.parse(opts.body); if (gh.prs.some((x) => x.head === b.head && x.state === 'open')) return J({ message: 'Validation Failed: A pull request already exists' }, 422); const pr = { number: gh.prs.length + 1, html_url: `https://github.com/Hwari2929/KUKU-UI/pull/${gh.prs.length + 1}`, head: b.head, base: b.base, title: b.title, state: 'open' }; gh.prs.push(pr); return J(pr, 201); }
  if (p.endsWith('/pulls') && method === 'GET') return J(gh.prs.filter((x) => x.state === 'open' && u.searchParams.get('head') === 'Hwari2929:' + x.head));
  return J({ message: 'nope ' + p }, 404);
};

const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js', '45_skills.gen.js', '50_tools.js', '55_self.js'], { fetch: global.fetch }, 'GH, SelfBuild, Pending, ToolImpl, runTool, buildSystem, toolsFor, canWrite, fileIndexText, searchNotes, resolveName, outlineOfCode, Skills, SELF_PREFIX, wsNow, saveSync');
const { S, FS, GH, SelfBuild, Pending, runTool, buildSystem, toolsFor, canWrite, fileIndexText, SELF_PREFIX } = X;
(async () => {
  S.secrets.ghToken = ''; await X.DB.init();
  // 설정집(lore) 쪽 파일 하나 — 작업공간 분리 확인용
  FS.set('lore/인물/린디웨.md', '# 린디웨\n협력팀장'); eq(X.wsNow(), 'lore');

  // ── 1) 자가개선 첫 받기: 작업 브랜치가 아직 없으면 main 에서 읽기만
  S.ui.ws = 'self';
  let r = await GH.pull(); eq(r.branch, 'main'); ok(r.added > 20, '소스 받음: ' + r.added);
  ok(FS.has('studio-src/parts/40_llm.js') && FS.has('studio-src/CLAUDE.md') && !FS.has('studio-src/parts/45_skills.gen.js'), '경로 접두사 + 제외 규칙');
  ok(FS.paths().every((p) => p.startsWith(SELF_PREFIX)) && !FS.paths().some((p) => p.includes('lore/')), '자가개선에선 소스만 보임');
  eq(FS.changes().length, 0); eq(S.sync.self.branch, 'main'); eq(S.sync.lastHead, null, '설정집 동기화 상태는 건드리지 않음');
  S.ui.ws = 'lore'; eq(FS.paths(), ['lore/인물/린디웨.md'], '설정집에선 소스가 안 보임'); eq(FS.changes().length, 1);
  ok(FS.changes(true).length === 1); S.ui.ws = 'self';

  // ── 2) 쓰기 규칙
  ok(canWrite('studio-src/parts/40_llm.js').ok); ok(!canWrite('studio-src/.github/workflows/x.yml').ok && !canWrite('studio-src/parts/45_skills.gen.js').ok && !canWrite('studio-src/ERTES-Studio.html').ok);
  ok(!canWrite('lore/인물/확장/새.md').ok && !canWrite('../x.js').ok, '자가개선에서는 lore 쓰기 금지'); S.ui.ws = 'lore';
  ok(!canWrite('studio-src/parts/40_llm.js').ok, '설정집 모드에서는 소스 쓰기 금지'); ok(canWrite('lore/인물/확장/새.md').ok); S.ui.ws = 'self';

  // ── 3) AI 도구가 코드를 다룰 수 있다
  X.IDX.dirty = true;
  const sr = await runTool('search', { query: 'anthropicStream' }); ok(sr.content.includes('studio-src/parts/40_llm.js') && /L\d+:/.test(sr.content), '코드 검색 + 줄 번호: ' + sr.content.slice(0, 200));
  const rd = await runTool('read_note', { name: 'studio-src/parts/40_llm.js' }); ok(rd.content.includes('목차') && rd.content.includes('anthropicStream') && rd.content.includes('Budget'), '코드 목차');
  const rs = await runTool('read_note', { name: 'studio-src/parts/40_llm.js', section: 'openaiStream' }); ok(!rs.is_error && rs.content.includes('async function openaiStream') && !rs.content.includes('const LLM = {'), '함수 단위 읽기: ' + rs.content.slice(0, 120));
  const idx = fileIndexText(); ok(idx.includes('parts/ [') && idx.includes('40_llm.js') && idx.includes('studio-src/') && !idx.includes('린디웨'), '코드용 파일 색인');
  const sys = buildSystem({ skill: '' }).blocks; ok(sys[0].text.includes('개발 보조자') && sys[0].text.includes('[고정 문서: studio-src/CLAUDE.md]') && !sys[0].text.includes('ERTES\' 프로젝트(Obsidian'), '자가개선 시스템 프롬프트');
  ok(toolsFor(null).some((t) => t.name === 'build_check'));
  // 수정: edit_note → 승인 대기 → 문법 검사
  const e1 = await runTool('edit_note', { path: 'studio-src/parts/40_llm.js', old: "const PRICE_VERIFIED = '2026-10-25';", new: "const PRICE_VERIFIED = '2026-11-01';", summary: '확인 날짜' }); ok(!e1.is_error && e1.content.includes('승인 대기열') && e1.content.includes('문법 확인: 문제 없음'), e1.content);
  const bad = await runTool('edit_note', { path: 'studio-src/parts/40_llm.js', old: "const PRICE_VERIFIED = '2026-11-01';", new: "const PRICE_VERIFIED = ;", summary: '깨뜨림' }); ok(bad.content.includes('문법 오류'), bad.content);
  const bc = await runTool('build_check', {}); ok(bc.is_error && bc.content.includes('parts/40_llm.js'), '깨진 초안은 빌드 점검에서 걸림: ' + bc.content.slice(0, 160));
  await runTool('edit_note', { path: 'studio-src/parts/40_llm.js', old: 'const PRICE_VERIFIED = ;', new: "const PRICE_VERIFIED = '2026-11-01';" });
  const bc2 = await runTool('build_check', {}); ok(!bc2.is_error && bc2.content.includes('빌드 성공'), bc2.content);
  const w = await runTool('write_note', { path: 'lore/인물/확장/새.md', content: '# x\n' }); ok(w.is_error && w.content.includes('자가개선 모드'), '자가개선에서 lore 쓰기 거부');
  eq(Pending.list().length, 1); await Pending.approve(Pending.list()[0].id); ok(FS.read('studio-src/parts/40_llm.js').includes("'2026-11-01'")); eq(FS.changes().map((c) => [c.path, c.st]), [['studio-src/parts/40_llm.js', 'M']]);

  // ── 4) 브라우저 빌드 == node build.js (원본 소스 기준, 수정 전 상태로 되돌려 비교)
  FS.revert('studio-src/parts/40_llm.js'); eq(FS.changes().length, 0);
  const out = path.join(require('os').tmpdir(), 'ertes-build-' + process.pid + '.html'); cp.execFileSync(process.execPath, [path.join(W, 'build.js'), out], { stdio: 'ignore' });
  const nodeHtml = fs.readFileSync(out, 'utf8'); fs.unlinkSync(out);
  // gen 파일이 최신 상태가 아니었을 수 있으니, FS 에는 skills/*.md 만 있고 브라우저 쪽이 직접 만든다 — 결과가 같아야 한다
  const br = SelfBuild.build(); ok(br.ok, br.error); ok(br.html === nodeHtml, `브라우저 빌드가 node build.js 결과와 같음 (${br.html.length} vs ${nodeHtml.length})`); eq(br.order[br.order.length - 1], '90_boot');
  // 깨진 초안/중복 선언/누락 파일
  Pending.add({ path: 'studio-src/parts/00_util.js', after: 'const x = ;' }); let b2 = SelfBuild.build(); ok(!b2.ok && b2.error.includes('parts/00_util.js'), b2.error); Pending.rejectAll();
  Pending.add({ path: 'studio-src/parts/90_boot.js', after: FS.read('studio-src/parts/90_boot.js') + '\nconst uid = 1;\n' }); b2 = SelfBuild.build(); ok(!b2.ok && b2.error.includes('합치면 오류'), b2.error); Pending.rejectAll();
  Pending.add({ path: 'studio-src/build.js', after: FS.read('studio-src/build.js').replace("'90_boot'", "'90_boot', '99_nope'") }); b2 = SelfBuild.build(); ok(!b2.ok && b2.error.includes('99_nope.js')); Pending.rejectAll();
  Pending.add({ path: 'studio-src/skills/신규.md', after: '---\nname: 신규\ndescription: t\n---\n본문' }); b2 = SelfBuild.build(); ok(b2.ok && b2.html.includes('"신규"'), '대기 중인 새 스킬도 묶임'); Pending.rejectAll();

  // ── 5) 푸시: main 이 아니라 작업 브랜치에만, 경로에서 접두사 제거
  FS.set('studio-src/parts/40_llm.js', FS.read('studio-src/parts/40_llm.js').replace("'2026-10-25'", "'2026-11-01'")); FS.set('studio-src/test/t_new.js', '// new\n');
  const mainBefore = gh.branches.get('main'); S.secrets.ghToken = 'tok'; gh.log.length = 0;
  const pr1 = await GH.push(FS.changes().map((c) => c.path), '가격 확인 날짜 갱신'); eq(pr1.branch, 'self-improve');
  eq(gh.branches.get('main'), mainBefore, 'main 은 그대로'); ok(gh.branches.has('self-improve') && gh.branches.get('self-improve') !== mainBefore, '작업 브랜치 생성+커밋');
  const wf = filesOf(gh.branches.get('self-improve')); ok(wf.has('parts/40_llm.js') && wf.has('test/t_new.js') && !wf.has('studio-src/parts/40_llm.js'), '원격 경로엔 접두사 없음'); ok(wf.get('parts/40_llm.js').includes('2026-11-01'));
  ok(!gh.log.some((l) => /git\/refs\/heads\/main/.test(l) && l.startsWith('PATCH')), 'main 에 PATCH 없음'); eq(FS.changes().length, 0); eq(S.sync.self.branch, 'self-improve'); eq(S.sync.lastHead, null);
  // base 와 같은 브랜치로는 푸시 거부
  S.settings.self.branch = 'main'; FS.set('studio-src/README.md', 'x'); let err = ''; try { await GH.push(['studio-src/README.md'], 'x'); } catch (e) { err = e.message; } ok(err.includes('main 에 직접'), err); S.settings.self.branch = 'self-improve'; FS.revert('studio-src/README.md');
  // ── 6) PR
  const pr = await GH.openPR('자가개선: 가격 날짜', '본문'); ok(pr.created && pr.url.endsWith('/pull/1')); const pr2 = await GH.openPR('다시', ''); ok(!pr2.created && pr2.url === pr.url, '열린 PR 재사용');
  // ── 7) 작업 브랜치 초기화
  const mainSha = gh.branches.get('main'); await GH.resetWork(); eq(gh.branches.get('self-improve'), mainSha); eq(S.sync.self.lastHead, null);
  r = await GH.pull({ force: true }); eq(r.branch, 'self-improve'); ok(FS.read('studio-src/parts/40_llm.js').includes('2026-10-25'), '초기화 뒤 받으면 main 내용으로 돌아감');
  // 설정집 쪽 푸시/받기는 소스 파일을 건드리지 않음
  S.ui.ws = 'lore'; ok(!GH.owns('studio-src/x.js') && GH.owns('lore/a.md')); eq(GH.prefix(), ''); eq(GH.lp('a.md'), 'a.md'); S.ui.ws = 'self'; eq(GH.lp('a.js'), 'studio-src/a.js'); eq(GH.rp('studio-src/a.js'), 'a.js');
  console.log(`self OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
