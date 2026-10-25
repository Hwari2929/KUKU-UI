/* ═══════════ 30 · GitHub 동기화 (REST) ═══════════ */
async function fetchT(url, opts = {}, ms = 30000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: opts.signal || ac.signal }); }
  catch (e) { if (e && e.name === 'AbortError') throw new Error(`요청 시간 초과 (${Math.round(ms / 1000)}초): ${String(url).slice(0, 80)}`); throw e; }
  finally { clearTimeout(t); }
}
function b64ToUtf8(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder('utf-8').decode(u); }
async function pool(items, n, fn) {
  const q = [...items]; const out = []; let err = null;
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length && !err) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { err = e; } } }));
  if (err) throw err; return out;
}
const GH = {
  get cfg() { return wsNow() === 'self' ? S.settings.self : S.settings.gh; },   // 자가개선 모드에선 KUKU-UI(작업 브랜치)
  prefix() { return wsNow() === 'self' ? SELF_PREFIX : ''; },            // 원격 경로 ↔ 로컬 경로 접두사
  lp(r) { return this.prefix() + r; },
  rp(l) { return l.startsWith(this.prefix()) ? l.slice(this.prefix().length) : l; },
  owns(l) { return inSelf(l) === (wsNow() === 'self'); },
  sy() { if (wsNow() !== 'self') return S.sync; return S.sync.self || (S.sync.self = { lastHead: null, lastPull: null, branch: null }); },
  base: 'https://api.github.com',
  repoPath() { const c = this.cfg; return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`; },
  refPath(b) { return String(b).split('/').map(encodeURIComponent).join('/'); },
  async api(path, { method = 'GET', body } = {}) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (S.secrets.ghToken) h.Authorization = 'Bearer ' + S.secrets.ghToken;
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetchT(this.base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
      const hint = r.status === 404 ? ' (리포·브랜치 이름이 틀렸거나, 비공개 리포인데 토큰이 없음)' : r.status === 401 ? ' (토큰이 잘못됨)' : r.status === 403 ? ' (권한 부족이거나 호출 한도 초과 — 토큰을 넣으면 한도가 커짐)' : r.status === 409 || r.status === 422 ? ' (원격이 먼저 바뀜 — 다시 동기화한 뒤 시도)' : '';
      const e = new Error(`GitHub ${r.status}: ${msg || r.statusText}${hint}`); e.status = r.status; throw e;
    }
    return r.status === 204 ? null : r.json();
  },
  async head(branch) { const r = await this.api(`${this.repoPath()}/git/ref/heads/${this.refPath(branch || this.cfg.branch)}`); return r.object.sha; },
  async listBranches() { const r = await this.api(`${this.repoPath()}/branches?per_page=100`); return r.map((b) => b.name); },
  async createBranch(name, from) { const sha = await this.head(from || this.cfg.branch); await this.api(`${this.repoPath()}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name}`, sha } }); return sha; },
  wanted(path, size) {
    const c = this.cfg;
    if (!c.includes.some((i) => (i.endsWith('/') ? path.startsWith(i) : path === i))) return false;
    if (c.excludes.some((x) => matchRule(path, x))) return false;
    const ext = ((path.match(/\.[^./]+$/) || [''])[0]).toLowerCase();
    if (c.exts.length && !c.exts.map((x) => x.toLowerCase()).includes(ext)) return false;
    if (size && size > c.maxKB * 1024) return false;
    return true;
  },
  async selectiveTree(rootSha) {
    const inc = this.cfg.includes, out = [];
    const walk = async (sha, prefix) => {
      const t = await this.api(`${this.repoPath()}/git/trees/${sha}`);
      for (const e of t.tree) {
        const p = prefix + e.path;
        if (e.type === 'blob') out.push({ ...e, path: p });
        else if (e.type === 'tree') { const ps = p + '/'; if (inc.some((i) => i.endsWith('/') && (ps.startsWith(i) || i.startsWith(ps)))) await walk(e.sha, ps); }
      }
    };
    await walk(rootSha, ''); return out;
  },
  async listRemote(headSha) {
    const commit = await this.api(`${this.repoPath()}/git/commits/${headSha}`);
    const t = await this.api(`${this.repoPath()}/git/trees/${commit.tree.sha}?recursive=1`);
    const entries = t.truncated ? await this.selectiveTree(commit.tree.sha) : t.tree;
    const files = new Map();
    for (const e of entries) if (e.type === 'blob' && this.wanted(e.path, e.size)) files.set(e.path, { sha: e.sha, size: e.size });
    return { treeSha: commit.tree.sha, files };
  },
  async blobText(sha, path, commitSha) {
    if (S.secrets.ghToken) { const b = await this.api(`${this.repoPath()}/git/blobs/${sha}`); return b64ToUtf8(b.content); }
    const c = this.cfg; const url = `https://raw.githubusercontent.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${commitSha}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const r = await fetchT(url); if (!r.ok) throw new Error(`raw ${r.status}: ${path}`); return r.text();
  },
  async test() { const head = await this.head(); const c = await this.api(`${this.repoPath()}/git/commits/${head}`); return { head, message: (c.message || '').split('\n')[0], date: c.author && c.author.date }; },

  // 원격 → 로컬. 로컬에서 고친 파일은 3-way 병합한다.
  async pull({ force = false } = {}) {
    const c = this.cfg, sy = this.sy(); UI.progress('원격 확인 중…');
    let branch = c.branch, head;
    try { head = await this.head(branch); }
    catch (e) { if (e.status === 404 && wsNow() === 'self' && c.base && c.base !== branch) { branch = c.base; head = await this.head(branch); } else throw e; }   // 작업 브랜치가 아직 없으면 base 에서 읽기만
    if (!force && sy.lastHead === head && sy.branch === branch) { UI.progress(''); return { upToDate: true, head, added: 0, updated: 0, merged: 0, conflicts: [], removed: 0 }; }
    const { files } = await this.listRemote(head);
    const rep = { upToDate: false, head, added: 0, updated: 0, merged: 0, conflicts: [], removed: 0, kept: 0, total: files.size };
    const todo = [...files].filter(([p, info]) => { const f = FS.get(this.lp(p)); return force || !f || f.baseSha !== info.sha; });
    let done = 0;
    const fetched = await pool(todo, 6, async ([path, info]) => { const text = await this.blobText(info.sha, path, head); UI.progress(`받는 중 ${++done}/${todo.length}`); return { path, info, text }; });
    const snap = [];
    for (const { path: rpath, info, text } of fetched.sort((a, b) => a.path.localeCompare(b.path))) {
      const path = this.lp(rpath); const f = FS.get(path);
      if (!f) { FS.set(path, text); FS.markSynced(path, text, info.sha); rep.added++; continue; }
      if (f.deleted) { f.base = text; f.baseSha = info.sha; FS.touch(path); rep.kept++; continue; }
      if (f.content === text) { FS.markSynced(path, text, info.sha); continue; }
      if (!FS.status(f) || f.content === f.base) { FS.set(path, text); FS.markSynced(path, text, info.sha); rep.updated++; continue; }
      const m = merge3(f.base ?? '', f.content, text);
      if (!m.conflicts) { snap.push({ path, before: f.content, after: m.text }); FS.set(path, m.text); FS.markSynced(path, text, info.sha); FS.get(path).content = m.text; rep.merged++; }
      else { f.conflict = { segs: m.segs, remote: text, remoteSha: info.sha }; FS.touch(path); rep.conflicts.push(path); }
    }
    for (const f of [...FS.map.values()]) {
      if (this.owns(f.path) && f.baseSha && !files.has(this.rp(f.path)) && this.wanted(this.rp(f.path), 0)) {
        if (FS.status(f) === 'M' || f.content !== f.base) { f.baseSha = null; f.base = null; FS.touch(f.path); rep.kept++; }  // 내가 고친 파일은 새 파일로 남김
        else { FS.map.delete(f.path); FS.touch(f.path); rep.removed++; }
      }
    }
    if (snap.length) await Snap.record('pull 병합 (병합 전 내용)', snap);
    sy.lastHead = head; sy.branch = branch; sy.lastPull = Date.now(); rep.branch = branch; await saveSync();
    UI.progress(''); UI.files(); return rep;
  },
  resolveConflict(path, content) {
    const f = FS.get(path); if (!f || !f.conflict) return;
    f.content = content; f.base = f.conflict.remote; f.baseSha = f.conflict.remoteSha; f.conflict = null; f.deleted = false; FS.touch(path); UI.files();
  },

  // 로컬 → 원격 (Git Data API 로 한 번에 커밋). 먼저 pull 해서 병합한다.
  async push(paths, message) {
    if (!S.secrets.ghToken) throw new Error('커밋·푸시에는 GitHub 토큰이 필요합니다 (설정 → GitHub).');
    const c = this.cfg, sy = this.sy(); if (!message || !message.trim()) throw new Error('커밋 메시지가 비어 있음');
    if (wsNow() === 'self') {   // 작업 브랜치가 없으면 base 에서 만든다. base(main)에는 절대 직접 푸시하지 않는다.
      if (!c.branch || c.branch === c.base) throw new Error('자가개선은 main 에 직접 푸시하지 않습니다. 설정 → 자가개선에서 작업 브랜치 이름을 지정하세요.');
      try { await this.head(c.branch); } catch (e) { if (e.status === 404) { UI.progress('작업 브랜치 만드는 중…'); await this.createBranch(c.branch, c.base); } else throw e; }
    }
    const rep = await this.pull({});
    const blocked = paths.filter((p) => FS.get(p) && FS.get(p).conflict);
    if (blocked.length) throw new Error(`충돌이 있는 파일이 있어 푸시하지 않음: ${blocked.join(', ')} — 먼저 충돌을 해결하세요.`);
    UI.progress('커밋 만드는 중…');
    const head = await this.head(c.branch); const commit = await this.api(`${this.repoPath()}/git/commits/${head}`);
    const entries = [], uploaded = [], deleted = [];
    for (const path of paths) {
      const f = FS.get(path); if (!f) continue; const st = FS.status(f);
      if (!this.owns(path)) continue;
      if (st === 'D') { entries.push({ path: this.rp(path), mode: '100644', type: 'blob', sha: null }); deleted.push(path); }
      else if (st === 'A' || st === 'M') { const content = f.content; const b = await this.api(`${this.repoPath()}/git/blobs`, { method: 'POST', body: { content, encoding: 'utf-8' } }); entries.push({ path: this.rp(path), mode: '100644', type: 'blob', sha: b.sha }); uploaded.push({ path, sha: b.sha, content }); }
    }
    if (!entries.length) throw new Error('커밋할 변경이 없음');
    const tree = await this.api(`${this.repoPath()}/git/trees`, { method: 'POST', body: { base_tree: commit.tree.sha, tree: entries } });
    const nc = await this.api(`${this.repoPath()}/git/commits`, { method: 'POST', body: { message: message.trim(), tree: tree.sha, parents: [head] } });
    await this.api(`${this.repoPath()}/git/refs/heads/${this.refPath(c.branch)}`, { method: 'PATCH', body: { sha: nc.sha, force: false } });
    for (const u of uploaded) FS.markSynced(u.path, u.content, u.sha);
    for (const p of deleted) { FS.map.delete(p); FS.touch(p); }
    sy.lastHead = nc.sha; sy.branch = c.branch; await saveSync(); UI.progress(''); UI.files();
    return { sha: nc.sha, files: entries.length, pulled: rep, branch: c.branch };
  },

  // 자가개선: 작업 브랜치를 base(main)와 같은 상태로 되돌린다 (병합이 끝난 뒤 새로 시작할 때). 작업 브랜치의 미병합 커밋은 사라진다.
  async resetWork() {
    if (wsNow() !== 'self') throw new Error('자가개선 모드에서만 가능');
    if (!S.secrets.ghToken) throw new Error('GitHub 토큰이 필요합니다 (설정 → GitHub).');
    const c = this.cfg; const sha = await this.head(c.base);
    try { await this.api(`${this.repoPath()}/git/refs/heads/${this.refPath(c.branch)}`, { method: 'PATCH', body: { sha, force: true } }); }
    catch (e) { if (e.status === 404 || e.status === 422) await this.createBranch(c.branch, c.base); else throw e; }
    const sy = this.sy(); sy.lastHead = null; sy.branch = null; await saveSync(); return sha;
  },
  // 자가개선: 작업 브랜치 → base 로 PR. 이미 열린 PR 이 있으면 그 주소를 돌려준다. (병합은 GitHub 에서 사용자가 직접)
  async openPR(title, body = '') {
    if (wsNow() !== 'self') throw new Error('자가개선 모드에서만 가능');
    if (!S.secrets.ghToken) throw new Error('GitHub 토큰이 필요합니다 (설정 → GitHub).');
    const c = this.cfg;
    try { const pr = await this.api(`${this.repoPath()}/pulls`, { method: 'POST', body: { title, head: c.branch, base: c.base, body } }); return { url: pr.html_url, number: pr.number, created: true }; }
    catch (e) {
      if (e.status === 422) { const list = await this.api(`${this.repoPath()}/pulls?state=open&head=${encodeURIComponent(c.owner + ':' + c.branch)}&base=${encodeURIComponent(c.base)}`); if (list && list.length) return { url: list[0].html_url, number: list[0].number, created: false }; }
      throw e;
    }
  },
};
