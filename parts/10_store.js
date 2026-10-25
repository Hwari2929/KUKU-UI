/* ═══════════ 10 · 저장소 (IndexedDB → localStorage → 메모리) · 가상 파일시스템 · 스냅샷 ═══════════ */
const DB = (() => {
  const STORES = ['meta', 'files', 'chats', 'ledger', 'snaps'];
  let idb = null, kind = 'memory', lastError = '';
  const mem = {}; STORES.forEach((s) => (mem[s] = new Map()));
  const LS = 'es:';
  const lsKey = (s, k) => `${LS}${s}:${k}`;
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function init() {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('indexedDB 없음');
      idb = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('indexedDB 열기 시간 초과')), 4000);
        const rq = indexedDB.open('ertes-studio', 1);
        rq.onupgradeneeded = () => { for (const s of STORES) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s); };
        rq.onsuccess = () => { clearTimeout(t); res(rq.result); };
        rq.onerror = () => { clearTimeout(t); rej(rq.error); };
        rq.onblocked = () => { clearTimeout(t); rej(new Error('indexedDB 차단됨')); };
      });
      await put('meta', '__probe', Date.now());
      const v = await get('meta', '__probe');
      if (!v) throw new Error('indexedDB 쓰기 확인 실패');
      kind = 'indexeddb';
    } catch (e) {
      idb = null; lastError = String(e && e.message || e);
      try { localStorage.setItem('__es_probe', '1'); localStorage.removeItem('__es_probe'); kind = 'localStorage'; } catch (e2) { kind = 'memory'; }
    }
    return kind;
  }
  async function put(s, k, v) {
    try {
      if (idb) { const tx = idb.transaction(s, 'readwrite'); tx.objectStore(s).put(v, k); await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }
      else if (kind === 'localStorage') localStorage.setItem(lsKey(s, k), JSON.stringify(v));
      else mem[s].set(k, v);
    } catch (e) { lastError = String(e && e.message || e); UI.toast('저장 실패: ' + lastError + ' — 백업 내보내기를 권장'); }
  }
  async function get(s, k) {
    if (idb) return req(idb.transaction(s).objectStore(s).get(k));
    if (kind === 'localStorage') { const r = localStorage.getItem(lsKey(s, k)); return r == null ? undefined : JSON.parse(r); }
    return mem[s].get(k);
  }
  async function del(s, k) {
    try {
      if (idb) { const tx = idb.transaction(s, 'readwrite'); tx.objectStore(s).delete(k); await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; }); }
      else if (kind === 'localStorage') localStorage.removeItem(lsKey(s, k));
      else mem[s].delete(k);
    } catch (e) { lastError = String(e && e.message || e); }
  }
  async function all(s) {
    if (idb) return req(idb.transaction(s).objectStore(s).getAll());
    if (kind === 'localStorage') { const out = []; const p = `${LS}${s}:`; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(p)) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) {} } } return out; }
    return [...mem[s].values()];
  }
  async function clear(s) {
    if (idb) { const tx = idb.transaction(s, 'readwrite'); tx.objectStore(s).clear(); await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; }); }
    else if (kind === 'localStorage') { const p = `${LS}${s}:`; for (const k of Object.keys(localStorage).filter((k) => k.startsWith(p))) localStorage.removeItem(k); }
    else mem[s].clear();
  }
  return { init, put, get, del, all, clear, get kind() { return kind; }, get lastError() { return lastError; }, STORES };
})();

/* ── 설정 · 비밀값 ── */
async function loadSettings() {
  const saved = await DB.get('meta', 'settings');
  S.settings = deepMerge(DEFAULT_SETTINGS, saved);
  const sec = await DB.get('meta', 'secrets');
  S.secrets = Object.assign({ apiKey: '', openaiKey: '', ghToken: '' }, sec || {});
  const b = S.settings.budget;
  if (b.anchorUSD == null || b.anchorTs == null) { b.anchorUSD = +(b.creditKRW / b.krwPerUSD).toFixed(4); b.anchorTs = Date.now(); }
  S.sync = Object.assign({ lastHead: null, lastPull: null, branch: null }, (await DB.get('meta', 'sync')) || {});
  S.pending = (await DB.get('meta', 'pending')) || [];
  const ui = await DB.get('meta', 'ui'); if (ui) Object.assign(S.ui, ui);
}
const saveSettings = debounce(() => DB.put('meta', 'settings', S.settings), 300);
const saveSecrets = debounce(() => DB.put('meta', 'secrets', S.secrets), 300);
const saveSync = () => DB.put('meta', 'sync', S.sync);
const savePending = () => DB.put('meta', 'pending', S.pending);
const saveUi = debounce(() => DB.put('meta', 'ui', S.ui), 400);

/* ── 스냅샷 (되돌리기용 로컬 기록) ── */
const Snap = {
  async load() { S.snaps = (await DB.all('snaps')).sort((a, b) => a.ts - b.ts); },
  async record(label, changes) {
    const ch = changes.filter((c) => c.before !== c.after);
    if (!ch.length) return null;
    const s = { id: uid('s'), ts: Date.now(), label, files: ch };
    S.snaps.push(s); await DB.put('snaps', s.id, s);
    while (S.snaps.length > 150) { const o = S.snaps.shift(); DB.del('snaps', o.id); }
    return s;
  },
};

/* ── 가상 파일시스템 ──
   File = { path, content, base, baseSha, deleted, seeded, seedContent, conflict, mtime }
   base/baseSha = 마지막으로 GitHub 와 맞춘 내용 / 블롭 해시 (없으면 로컬에서만 만든 파일) */
const FS = {
  map: new Map(), _q: new Set(),
  get(p) { return this.map.get(p); },
  has(p) { const f = this.map.get(p); return !!f && !f.deleted; },
  paths() { return [...this.map.values()].filter((f) => !f.deleted).map((f) => f.path).sort((a, b) => a.localeCompare(b, 'ko')); },
  read(p) { const f = this.map.get(p); return f && !f.deleted ? f.content : null; },
  status(f) {
    if (f.conflict) return 'C';
    if (f.deleted) return f.baseSha ? 'D' : null;
    if (!f.baseSha) return f.seeded && f.content === f.seedContent ? null : 'A';
    return f.content !== f.base ? 'M' : null;
  },
  changes() { return [...this.map.values()].map((f) => ({ path: f.path, st: this.status(f) })).filter((c) => c.st).sort((a, b) => a.path.localeCompare(b.path, 'ko')); },
  async load() { for (const f of await DB.all('files')) this.map.set(f.path, f); IDX.dirty = true; },
  _flush: debounce(function () { for (const p of FS._q) { const f = FS.map.get(p); if (f) DB.put('files', p, f); else DB.del('files', p); } FS._q.clear(); }, 400),
  touch(p) { this._q.add(p); this._flush(); IDX.dirty = true; },
  flushNow() { this._flush.flush(); },
  set(path, content) {
    path = normPath(path);
    let f = this.map.get(path);
    if (!f) { f = { path, content: '', base: null, baseSha: null, deleted: false }; this.map.set(path, f); }
    f.content = content; f.deleted = false; f.mtime = Date.now();
    this.touch(path); return f;
  },
  remove(path) {
    const f = this.map.get(path); if (!f) return;
    if (f.baseSha) { f.deleted = true; f.mtime = Date.now(); this.touch(path); }
    else { this.map.delete(path); this.touch(path); }
  },
  undelete(path) { const f = this.map.get(path); if (f) { f.deleted = false; this.touch(path); } },
  revert(path) {
    const f = this.map.get(path); if (!f) return;
    if (!f.baseSha) { if (f.seeded) { f.content = f.seedContent; f.deleted = false; } else this.map.delete(path); }
    else { f.content = f.base; f.deleted = false; f.conflict = null; }
    this.touch(path);
  },
  rename(from, to) {
    to = normPath(to); const f = this.map.get(from); if (!f || this.has(to)) return false;
    const content = f.content;
    this.remove(from); this.set(to, content); return true;
  },
  markSynced(path, content, sha) { const f = this.map.get(path); if (!f) return; f.base = content; f.baseSha = sha; f.deleted = false; f.conflict = null; this.touch(path); },
  // 여러 파일을 한꺼번에 바꾸고 되돌릴 수 있게 스냅샷을 남긴다. after === null 이면 삭제.
  async apply(changes, label) {
    const rec = [];
    for (const c of changes) {
      const before = this.read(c.path);
      rec.push({ path: c.path, before, after: c.after });
      if (c.after === null) this.remove(c.path); else this.set(c.path, c.after);
    }
    await Snap.record(label, rec);
    UI.files();
  },
  async restoreSnap(snap) {
    const rec = [];
    for (const c of snap.files) {
      const cur = this.read(c.path);
      rec.push({ path: c.path, before: cur, after: c.before });
      if (c.before === null) this.remove(c.path); else this.set(c.path, c.before);
    }
    await Snap.record(`복원: ${snap.label}`, rec);
    UI.files();
  },
};
