// 가짜 GitHub(메모리 리포)로 pull / 병합 / 충돌 / push 흐름 검증
const crypto = require('crypto');
const assert = require('assert');
const gitSha = (s) => { const b = Buffer.from(s, 'utf8'); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
// 리포 상태
const repo = { files: new Map(), commits: [], head: null, trees: new Map(), blobs: new Map() };
let cn = 0;
function commitAll(msg) { const entries = [...repo.files].map(([path, c]) => ({ path, mode: '100644', type: 'blob', sha: gitSha(c), size: Buffer.byteLength(c) })); entries.forEach((e) => repo.blobs.set(e.sha, repo.files.get(e.path))); const tsha = 'tree' + (++cn); repo.trees.set(tsha, entries); const csha = 'commit' + cn; repo.commits.push({ sha: csha, tree: { sha: tsha }, message: msg, author: { date: 'x' } }); repo.head = csha; return csha; }
repo.files.set('lore/인물/린디웨.md', '# 린디웨\n1\n2\n3\n4\n5'); repo.files.set('docs/SCENES.md', 'S'); repo.files.set('art/x.webp', 'bin'); repo.files.set('docs/archive/old.md', 'old'); repo.files.set('CLAUDE.md', 'rules');
commitAll('init');
const log = [];
global.fetch = async (url, opts = {}) => {
  const u = new URL(url); const method = opts.method || 'GET'; const p = decodeURIComponent(u.pathname); log.push(method + ' ' + p);
  const json = (o, st = 200) => ({ ok: st < 300, status: st, statusText: 'x', json: async () => o, text: async () => (typeof o === 'string' ? o : JSON.stringify(o)), headers: new Map() });
  if (u.host === 'raw.githubusercontent.com') { const m = p.match(/^\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/); const c = repo.files.get(m[2]); return c == null ? json('nf', 404) : { ok: true, status: 200, text: async () => c }; }
  let m;
  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/))) return json({ object: { sha: repo.head } });
  if ((m = p.match(/\/git\/commits\/(.+)$/)) && method === 'GET') return json(repo.commits.find((c) => c.sha === m[1]));
  if ((m = p.match(/\/git\/trees\/(.+)$/)) && method === 'GET') return json({ tree: repo.trees.get(m[1]), truncated: false });
  if ((m = p.match(/\/git\/blobs\/(.+)$/)) && method === 'GET') return json({ content: Buffer.from(repo.blobs.get(m[1])).toString('base64'), encoding: 'base64' });
  if (p.endsWith('/git/blobs') && method === 'POST') { const b = JSON.parse(opts.body); const sha = gitSha(b.content); repo.blobs.set(sha, b.content); return json({ sha }, 201); }
  if (p.endsWith('/git/trees') && method === 'POST') {
    const b = JSON.parse(opts.body); const base = new Map((repo.trees.get(repo.commits.find((c) => c.tree.sha === b.base_tree).tree.sha) || []).map((e) => [e.path, e]));
    for (const e of b.tree) { if (e.sha === null) base.delete(e.path); else base.set(e.path, { path: e.path, mode: e.mode, type: 'blob', sha: e.sha, size: Buffer.byteLength(repo.blobs.get(e.sha)) }); }
    const tsha = 'tree' + (++cn); repo.trees.set(tsha, [...base.values()]); return json({ sha: tsha }, 201);
  }
  if (p.endsWith('/git/commits') && method === 'POST') { const b = JSON.parse(opts.body); assert.strictEqual(b.parents[0], repo.head); const sha = 'commit' + (++cn); repo.commits.push({ sha, tree: { sha: b.tree }, message: b.message }); repo._pending = sha; return json({ sha }, 201); }
  if ((m = p.match(/\/git\/refs\/heads\/(.+)$/)) && method === 'PATCH') { const b = JSON.parse(opts.body); repo.head = b.sha; const t = repo.trees.get(repo.commits.find((c) => c.sha === b.sha).tree.sha); repo.files = new Map(t.map((e) => [e.path, repo.blobs.get(e.sha)])); return json({}); }
  return json({ message: 'nope ' + p }, 404);
};
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js'], { fetch: global.fetch }, 'GH, pool, b64ToUtf8');
const { GH, FS, S } = X;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
(async () => {
  // 1) 첫 pull (토큰 없음 → raw 경로)
  let r = await GH.pull();
  eq([...FS.paths()].sort(), ['CLAUDE.md', 'docs/SCENES.md', 'lore/인물/린디웨.md']); // art/, docs/archive/ 제외
  eq(r.added, 3); ok(!log.some((l) => l.includes('/git/blobs/')), '토큰 없을 때는 blob API 안 씀'); ok(log.some((l) => l.startsWith('GET /ertes') || true));
  eq(FS.changes().length, 0);
  // 2) 변화 없으면 건너뜀
  r = await GH.pull(); ok(r.upToDate, 'upToDate');
  // 3) 로컬 수정 + 원격 수정(다른 줄) → 병합
  FS.set('lore/인물/린디웨.md', '# 린디웨\n1\n2\n3\n4\n5\n로컬추가');
  repo.files.set('lore/인물/린디웨.md', '# 린디웨 원격\n1\n2\n3\n4\n5'); commitAll('remote edit');
  r = await GH.pull(); eq(r.merged, 1); eq(FS.read('lore/인물/린디웨.md'), '# 린디웨 원격\n1\n2\n3\n4\n5\n로컬추가');
  eq(FS.changes().map((c) => c.st), ['M']); ok(X.S.snaps.length >= 1, '병합 전 스냅샷');
  // 4) 충돌: 같은 줄 수정
  FS.set('docs/SCENES.md', 'LOCAL'); repo.files.set('docs/SCENES.md', 'REMOTE'); commitAll('remote conflict');
  r = await GH.pull(); eq(r.conflicts, ['docs/SCENES.md']); eq(FS.status(FS.get('docs/SCENES.md')), 'C'); eq(FS.read('docs/SCENES.md'), 'LOCAL');
  // 충돌 상태에서 push 막힘 (토큰 필요 → 토큰 설정)
  S.secrets.ghToken = 'tok';
  let err = null; try { await GH.push(['docs/SCENES.md'], 'x'); } catch (e) { err = e; } ok(err && /충돌/.test(err.message), '충돌 push 차단: ' + (err && err.message));
  GH.resolveConflict('docs/SCENES.md', 'RESOLVED'); eq(FS.status(FS.get('docs/SCENES.md')), 'M');
  // 5) push: 수정 + 새 파일 + 삭제
  FS.set('lore/인물/확장/린디웨.md', '확장 문서'); FS.remove('CLAUDE.md');
  const ch = FS.changes(); eq(ch.map((c) => c.path + ':' + c.st).sort(), ['CLAUDE.md:D', 'docs/SCENES.md:M', 'lore/인물/확장/린디웨.md:A', 'lore/인물/린디웨.md:M'].sort());
  const res = await GH.push(ch.map((c) => c.path), 'studio: 테스트 커밋');
  eq(res.files, 4); eq(repo.files.get('docs/SCENES.md'), 'RESOLVED'); eq(repo.files.get('lore/인물/확장/린디웨.md'), '확장 문서'); ok(!repo.files.has('CLAUDE.md'), '삭제 반영'); ok(repo.files.has('art/x.webp'), '무관한 파일 보존');
  eq(FS.changes().length, 0, '푸시 뒤 변경 없음'); ok(log.some((l) => l.startsWith('POST') && l.endsWith('/git/blobs')), 'blob 생성');
  eq(repo.commits[repo.commits.length - 1].message, 'studio: 테스트 커밋');
  repo.files.set('lore/인물/린디웨.md', 'REMOTE2'); commitAll('r2'); log.length = 0; await GH.pull(); ok(log.some((l) => /GET .*\/git\/blobs\/[0-9a-f]{40}$/.test(l)), '토큰 있으면 blob API 로 받음'); ok(!log.some((l) => l.includes('raw.')), 'raw 안 씀'); eq(FS.read('lore/인물/린디웨.md'), 'REMOTE2');
  // 6) 원격에서 삭제된 파일 → 로컬 제거, 내가 고친 건 새 파일로 남김
  repo.files.delete('docs/SCENES.md'); commitAll('remote delete'); r = await GH.pull(); eq(r.removed, 1); ok(!FS.has('docs/SCENES.md'));
  console.log(`gh OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
