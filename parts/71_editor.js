/* ═══════════ 71 · 에디터: 탭 · 하이라이트 · 린트 · 찾기 · 미리보기 · 변경 보기 ═══════════ */
function copyText(t) {
  const ok = () => UI.toast('복사됨');
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(ok, () => legacy());
  legacy(); function legacy() { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); ok(); } catch (e) { UI.toast('복사 실패'); } a.remove(); }
}
function downloadText(name, text, mime = 'text/plain') {
  try { const u = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); UI.toast('내려받기: ' + name); }
  catch (e) { copyText(text); UI.toast('내려받기가 막혀 있어 클립보드에 복사함'); }
}

/* ── 하이라이트 ── */
const SCENE_LINE = /^(\s*)([^\s:(){}\[\]#\/〔][^:(){}]*?)(\s*\([^)]*\))?(\s*\{[^}]*\})?\s*:/;
function lineSyntax(ln, st) {   // → [{s,e,c}]
  const R = [];
  if (/^\s*(```|~~~)/.test(ln)) { R.push({ s: 0, e: ln.length, c: 'fence' }); st.fence = !st.fence; return R; }
  if (st.scene) {
    const t = ln.trim();
    if (/^##\s/.test(ln)) { R.push({ s: 0, e: ln.length, c: 'h2' }); return R; }
    if (t === '[조연]') { R.push({ s: 0, e: ln.length, c: 'sub' }); return R; }
    const cm = ln.search(/\s\/\/\s/); if (cm >= 0) R.push({ s: cm, e: ln.length, c: 'cm' });
    const m = ln.match(SCENE_LINE);
    if (m) { const a = m[1].length, b = a + m[2].length, c = b + (m[3] || '').length, d = c + (m[4] || '').length; R.push({ s: a, e: b, c: 'spk' }); if (m[3]) R.push({ s: b, e: c, c: 'th' }); if (m[4]) R.push({ s: c, e: d, c: 'tg' }); }
    else { const o = ln.match(/^\s*\{[^}]*\}/); if (o) R.push({ s: 0, e: o[0].length, c: 'tg' }); }
  }
  if (st.fence) return R;
  let m;
  if ((m = ln.match(/^(#{1,6})\s/))) R.push({ s: 0, e: ln.length, c: m[1].length === 1 ? 'h1' : m[1].length === 2 ? 'h2' : 'h3' });
  else if (/^\s*>/.test(ln)) R.push({ s: 0, e: ln.length, c: 'bq' });
  else if ((m = ln.match(/^\s*([-*+]|\d+\.)\s/))) R.push({ s: m[0].search(/\S/), e: m[0].length - 1, c: 'li' });
  const rx = [[/\[\[[^\]\n]+\]\]/g, 'wl'], [/\*\*[^*\n]+\*\*/g, 'em'], [/`[^`\n]+`/g, 'cd'], [/〔[^〕\n]*〕/g, 'br']];
  for (const [re, c] of rx) { re.lastIndex = 0; while ((m = re.exec(ln))) R.push({ s: m.index, e: m.index + m[0].length, c }); }
  return R;
}
function renderSpans(ln, ranges) {
  if (!ln) return '​';
  if (!ranges.length) return esc(ln);
  const cuts = new Set([0, ln.length]); for (const r of ranges) { cuts.add(Math.max(0, r.s)); cuts.add(Math.min(ln.length, r.e)); }
  const pts = [...cuts].sort((a, b) => a - b); let out = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; if (a === b) continue; const cls = []; for (const r of ranges) if (r.s <= a && r.e >= b && !cls.includes(r.c)) cls.push(r.c);
    out += cls.length ? `<span class="${cls.join(' ')}">${esc(ln.slice(a, b))}</span>` : esc(ln.slice(a, b));
  }
  return out;
}
// 단축키용 글쇠 이름. 한글 입력 상태에서는 e.key 가 'ㄹ' 처럼 나오므로 물리 글쇠(e.code)로 되돌린다.
function keyOf(e) { const k = String(e.key || '').toLowerCase(); if (/^[a-z]$/.test(k)) return k; const m = /^Key([A-Z])$/.exec(e.code || ''); return m ? m[1].toLowerCase() : k; }
function highlightHTML(text, { lint = [], finds = [], cur = -1 } = {}) {
  const lines = text.split('\n'); const st = { fence: false, scene: /^##\s*본문/m.test(text) };
  const lm = new Map(); for (const it of lint) { if (!lm.has(it.line)) lm.set(it.line, []); lm.get(it.line).push(it); }
  const starts = []; let o = 0; for (const l of lines) { starts.push(o); o += l.length + 1; }
  const fm = new Map(); finds.forEach((f, i) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= f.s) lo = mid; else hi = mid - 1; } if (!fm.has(lo)) fm.set(lo, []); fm.get(lo).push({ s: f.s - starts[lo], e: f.e - starts[lo], c: i === cur ? 'fc' : 'fh' }); });
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]; const R = lineSyntax(ln, st);
    for (const it of lm.get(i + 1) || []) { const c = it.level === 'error' ? 'le' : it.level === 'warn' ? 'lw' : 'li2'; if (it.col != null && it.len) R.push({ s: it.col, e: it.col + it.len, c }); else if (it.level !== 'info' && ln.trim()) R.push({ s: ln.search(/\S/), e: ln.length, c }); }
    for (const f of fm.get(i) || []) R.push(f);
    out += `<span class="lnx">${renderSpans(ln, R)}</span>`;
  }
  return out;
}

/* ── 장면 미리보기 (스크립트 DSL 구조 확인용) ── */
function sceneParse(text) {
  const secs = []; let cur = null;
  for (const ln of text.split('\n')) {
    const h = ln.match(/^##\s*(.+?)\s*(\/\/.*)?$/);
    if (h) { cur = { name: h[1], memo: (h[2] || '').replace(/^\/\/\s*/, ''), rows: [] }; secs.push(cur); continue; }
    if (!ln.trim() || !cur) continue; cur.rows.push(ln);
  }
  return secs;
}
function renderScene(text) {
  const secs = sceneParse(text); const body = secs.find((s) => s.name === '본문'); const subs = secs.filter((s) => /^조연\s/.test(s.name)); const res = secs.filter((s) => /^결과/.test(s.name));
  const bl = body ? body.rows.length : 0; const slots = body ? body.rows.filter((r) => r.trim() === '[조연]').length : 0;
  const sfx = (text.match(/\bsfx=/g) || []).length; const th = body ? body.rows.filter((r) => /\(속마음\)/.test(r)).length : 0;
  const pill = (t, good) => `<span class="pill ${good ? 'good' : 'bad'}">${esc(t)}</span>`;
  let h = `<div class="scene"><div class="meta">${pill(`본문 ${bl}줄`, bl >= 15 && bl <= 25)}${pill(`[조연] ${slots}개`, slots === 1)}${pill(`조연 후보 ${subs.length}`, subs.length >= 4 && subs.length <= 6)}${pill(`결과 ${res.length}`, res.length > 0)}${pill(`sfx ${sfx}`, sfx >= 2 && sfx <= 4)}${pill(`속마음 ${th}`, th <= 1)}</div>`;
  const row = (r) => {
    if (r.trim() === '[조연]') return '<div class="sl slot">[조연] — 여기에 조연 후보 장면이 들어갑니다</div>';
    const m = r.match(SCENE_LINE);
    if (!m) { const o = r.match(/^\s*(\{[^}]*\})\s*(.*)$/); return o ? `<div class="sl nar"><span class="who"></span><span class="tx"><span class="tgs">${esc(o[1])}</span>${esc(o[2])}</span></div>` : `<div class="sl nar"><span class="who"></span><span class="tx">${esc(r.trim())}</span></div>`; }
    const rest = r.slice(m[0].length).trim(); const thought = m[3] ? `<span class="th">${esc(m[3].trim())}</span> ` : '';
    return `<div class="sl"><span class="who">${esc(m[2].trim())}</span><span class="tx">${m[4] ? `<span class="tgs">${esc(m[4].trim())}</span>` : ''}${thought}${esc(rest)}</span></div>`;
  };
  for (const s of secs) h += `<h3>${esc(s.name)}${s.memo ? ` <span class="muted xs">// ${esc(s.memo)}</span>` : ''}</h3>` + s.rows.map(row).join('');
  return h + '</div>';
}

/* ── 에디터 ── */
const Ed = {
  lint: [], find: { open: false, q: '', r: '', hits: [], i: 0 }, mem: new Map(), ta: null, hl: null, scrollEl: null, composing: false, _raf: 0,
  get path() { return S.ui.cur; },
  get file() { return S.ui.cur ? FS.get(S.ui.cur) : null; },
  init() {
    this.scrollEl = null; this.renderAll();
    document.addEventListener('keydown', (e) => this.globalKeys(e));
  },
  isScene(t) { return /^##\s*본문/m.test(t || ''); },
  // ── 열기 / 닫기
  open(path, { line = 0, offset = null, find = '' } = {}) {
    path = normPath(path); const f = FS.get(path);
    if (!f || f.deleted) { UI.toast('파일이 없음: ' + path); return false; }
    if (!S.ui.open.includes(path)) S.ui.open.push(path);
    const changed = S.ui.cur !== path; this.saveMem(); S.ui.cur = path;
    if (S.ui.mode === 'chat') { S.ui.mode = 'split'; applyLayout(); }
    if (changed) { this.find.hits = []; this.find.i = 0; }
    this.renderAll(); saveUi(); Side.renderSoon();
    if (find) { this.findOpen(find); }
    if (line) this.gotoLine(line); else if (offset != null) this.gotoOffset(offset); else if (changed) this.restoreMem();
    return true;
  },
  close(path) {
    const i = S.ui.open.indexOf(path); if (i < 0) return; S.ui.open.splice(i, 1);
    if (S.ui.cur === path) S.ui.cur = S.ui.open[Math.min(i, S.ui.open.length - 1)] || null;
    this.renderAll(); saveUi(); Side.renderSoon();
  },
  saveMem() { if (this.ta && S.ui.cur) this.mem.set(S.ui.cur, { s: this.ta.selectionStart, e: this.ta.selectionEnd, y: this.scrollEl ? this.scrollEl.scrollTop : 0 }); },
  restoreMem() { const m = this.mem.get(S.ui.cur); if (m && this.ta) { try { this.ta.setSelectionRange(m.s, m.e); } catch (e) {} if (this.scrollEl) this.scrollEl.scrollTop = m.y; } },
  afterFilesChange() {   // 파일이 밖에서 바뀜(pull, 승인, 되돌리기 등)
    S.ui.open = S.ui.open.filter((p) => FS.has(p)); if (S.ui.cur && !FS.has(S.ui.cur)) S.ui.cur = S.ui.open[0] || null;
    const f = this.file;
    if (f && this.ta && S.ui.view === 'edit' && this.ta.value !== f.content) { const pos = this.ta.selectionStart; this.ta.value = f.content; try { this.ta.setSelectionRange(Math.min(pos, f.content.length), Math.min(pos, f.content.length)); } catch (e) {} this.afterInput(false); }
    else if (f && S.ui.view !== 'edit') this.renderBody();
    this.renderTabs(); this.renderTools(); this.renderBanner();
  },
  // ── 렌더
  renderAll() { this.renderTabs(); this.renderTools(); this.renderBody(); this.renderStatus(); },
  renderTabs() {
    const tb = document.getElementById('tabbar'); if (!tb) return;
    tb.innerHTML = S.ui.open.map((p) => { const f = FS.get(p); const st = f ? FS.status(f) : null; const pend = Pending.get(p);
      return `<div class="tab ${p === S.ui.cur ? 'cur' : ''}" data-act="tabOpen" data-p="${esc(p)}" title="${esc(p)}">${st ? `<span class="dot ${st}"></span>` : ''}${pend ? '<span class="bd P">AI</span>' : ''}<span class="t">${esc(titleOf(p))}</span><button class="x" data-act="tabClose" data-p="${esc(p)}" aria-label="닫기">✕</button></div>`; }).join('') || '<div class="muted sm" style="padding:10px 14px">열린 파일 없음</div>';
    const cur = tb.querySelector('.tab.cur'); if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
  },
  renderTools() {
    const el = document.getElementById('edTools'); if (!el) return; const f = this.file;
    if (!f) { el.innerHTML = ''; el.classList.add('hidden'); return; } el.classList.remove('hidden');
    const st = FS.status(f); const v = S.ui.view;
    el.innerHTML = `<nav class="seg"><button data-act="edView" data-v="edit" class="${v === 'edit' ? 'on' : ''}">편집</button><button data-act="edView" data-v="preview" class="${v === 'preview' ? 'on' : ''}">미리보기</button><button data-act="edView" data-v="diff" class="${v === 'diff' ? 'on' : ''}">변경</button></nav>
      <span class="path">${esc(f.path)} ${H.badge(st)}</span>
      <button class="sm" data-act="edFind" title="찾기 (⌘F)">찾기</button><button class="sm" data-act="edFont" data-d="-1">A−</button><button class="sm" data-act="edFont" data-d="1">A+</button>
      <button class="sm" data-act="edFace" title="글꼴">${S.ui.editorFont === 'mono' ? '고정폭' : '본문체'}</button><button class="sm" data-act="edWrap">${S.ui.noWrap ? '줄바꿈 끔' : '줄바꿈'}</button>
      <button class="sm" data-act="edMore">⋯</button>`;
  },
  renderBanner() {
    const b = document.getElementById('edBanner'); if (!b) return; const f = this.file; if (!f) { b.innerHTML = ''; return; }
    const p = Pending.get(f.path); let h = '';
    if (f.conflict) h += `<div class="banner err">⚠ 원격 변경과 충돌했습니다.<span class="grow"></span><button class="sm primary" data-act="resolveConflict" data-p="${esc(f.path)}">충돌 해결</button></div>`;
    if (p) h += `<div class="banner ai">✦ AI 가 이 문서의 ${p.before == null ? '새 파일' : '수정안'}을 올렸습니다${p.summary ? ' — ' + esc(p.summary) : ''}<span class="grow"></span><button class="sm primary" data-act="reviewPending" data-id="${p.id}">검토 · 승인</button></div>`;
    b.innerHTML = h;
  },
  renderBody() {
    const body = document.getElementById('edBody'); if (!body) return; const f = this.file;
    this.ta = null; this.hl = null; this.scrollEl = null;
    if (!f) { body.innerHTML = `<div class="empty"><h3>열린 파일이 없습니다</h3><div>왼쪽 파일 목록에서 문서를 고르거나 <b>⌘P</b> 로 빠르게 열 수 있어요.<br>처음이라면 <b>동기화</b> 탭에서 GitHub 문서를 불러오세요.</div><div style="margin-top:14px"><button class="primary" data-act="sideTab" data-tab="sync">GitHub 에서 불러오기</button> <button data-act="newFile">새 파일</button></div></div>`; document.getElementById('lintbar').classList.add('hidden'); this.renderStatus(); return; }
    body.innerHTML = `<div id="edBanner"></div><div id="findbar" class="${this.find.open && (S.ui.view === 'edit' || S.ui.view === 'preview') ? '' : 'hidden'}${S.ui.view === 'preview' ? ' pv' : ''}"></div><div id="edScroll"></div>`;
    const sc = this.scrollEl = document.getElementById('edScroll');
    if (S.ui.view === 'edit') {
      sc.innerHTML = `<div class="ed ${S.ui.editorFont === 'mono' ? 'mono' : ''} ${S.ui.noWrap ? 'nowrap' : ''}"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="${esc(f.path)}"></textarea></div>`;
      this.hl = sc.querySelector('pre'); const ta = this.ta = sc.querySelector('textarea'); ta.value = f.content;
      ta.addEventListener('input', () => { if (!this.composing || true) this.onInput(); });
      ta.addEventListener('compositionstart', () => (this.composing = true)); ta.addEventListener('compositionend', () => { this.composing = false; this.onInput(); });
      ta.addEventListener('keydown', (e) => this.onKey(e)); ta.addEventListener('keyup', () => this.renderStatus()); ta.addEventListener('click', (e) => { this.renderStatus(); if (e.metaKey || e.ctrlKey) this.openLinkAtCaret(); });
      ta.addEventListener('select', () => this.renderStatus());
      this.afterInput(false);
    } else if (S.ui.view === 'preview') {
      sc.innerHTML = this.isScene(f.content) ? renderScene(f.content) : `<div class="md">${renderMd(f.content)}</div>`;
      $$('a.wl', sc).forEach((a) => { if (!resolveName(a.dataset.wl).path) a.classList.add('no'); });
    } else {
      const base = f.base ?? ''; const same = base === f.content;
      sc.innerHTML = `<div style="padding:14px 18px 60px"><div class="sm muted" style="margin-bottom:8px">${f.baseSha ? '마지막 동기화(GitHub) 내용과 비교' : '새 파일 (GitHub 에 아직 없음)'} · ${same ? '변경 없음' : (() => { const s = diffStat(base, f.content); return `<span class="ok">+${s.add}</span> <span class="err">−${s.del}</span>`; })()}</div>${diffHTML(base, f.content, 4)}</div>`;
    }
    this.renderBanner(); this.renderLintBar(); this.renderFind(); this.renderStatus();
    if (S.ui.view === 'preview' && this.find.open) this.pvFind(false);
  },
  // ── 입력
  onInput() {
    const f = this.file; if (!f || !this.ta) return; const v = this.ta.value;
    if (v !== f.content) { FS.set(f.path, v); this.touchTab(); }
    this.afterInput(true);
  },
  touchTab: debounce(() => { Ed.renderTabs(); Ed.renderTools(); renderTop(); Side.renderSoon(); }, 300),
  afterInput(caret) {
    this.lintSoon(); this._caret = this._caret || caret;
    if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); if (this._caret) this.keepCaret(); this._caret = false; });
  },
  computeHits() {
    const t = this.ta ? this.ta.value : ''; const q = this.find.q; const hits = [];
    if (q && t) { const lo = t.toLowerCase(), ql = q.toLowerCase(); let i = 0; while ((i = lo.indexOf(ql, i)) !== -1 && hits.length < 5000) { hits.push({ s: i, e: i + q.length }); i += Math.max(1, q.length); } }
    this.find.hits = hits; if (this.find.i >= hits.length) this.find.i = 0;
  },
  paint() {
    if (!this.ta || !this.hl) return; if (this.find.open) this.computeHits(); const t = this.ta.value;
    this.hl.innerHTML = highlightHTML(t, { lint: this.lint, finds: this.find.open ? this.find.hits : [], cur: this.find.i });
    this.ta.style.height = 'auto'; this.ta.style.height = Math.max(this.ta.scrollHeight, 10) + 'px'; this.renderStatus();
  },
  lintSoon: debounce(() => Ed.runLint(), 350),
  runLint() {
    const f = this.file; if (!f) return; const t = this.ta ? this.ta.value : f.content;
    this.lint = t.length > 250000 ? [] : lintText(t, { path: f.path });
    if (this.hl) this.hl.innerHTML = highlightHTML(t, { lint: this.lint, finds: this.find.open ? this.find.hits : [], cur: this.find.i });
    this.renderLintBar();
  },
  // ── 위치
  lineStarts(t) { const a = [0]; for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) a.push(i + 1); return a; },
  caretInfo() { const t = this.ta.value, p = this.ta.selectionStart; let ln = 1, c = 0; for (let i = 0; i < p; i++) { if (t.charCodeAt(i) === 10) { ln++; c = 0; } else c++; } return { ln, col: c + 1, p }; },
  yOfOffset(off) {   // 오프셋의 세로 위치(px, 스크롤 영역 기준)
    if (!this.hl) return 0; const t = this.ta.value; const ls = this.lineStarts(t); let i = ls.length - 1; while (i > 0 && ls[i] > off) i--;
    const el = this.hl.children[i]; if (!el) return 0; const len = Math.max(1, (ls[i + 1] ?? t.length + 1) - ls[i] - 1); const frac = Math.min(1, (off - ls[i]) / len);
    return el.offsetTop + Math.floor(frac * Math.max(0, el.offsetHeight - 1));
  },
  keepCaret() {
    const sc = this.scrollEl; if (!sc || !this.ta) return; const y = this.yOfOffset(this.ta.selectionStart); const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 28;
    if (y < sc.scrollTop + 8) sc.scrollTop = Math.max(0, y - 40); else if (y + lh > sc.scrollTop + sc.clientHeight - 70) sc.scrollTop = y + lh - sc.clientHeight + 120;
  },
  gotoOffset(off, len = 0, focus = true) {
    if (S.ui.view !== 'edit') { S.ui.view = 'edit'; this.renderAll(); } if (!this.ta) return;
    try { this.ta.setSelectionRange(off, off + len); } catch (e) {} if (focus) this.ta.focus({ preventScroll: true });
    const y = this.yOfOffset(off); if (this.scrollEl) this.scrollEl.scrollTop = Math.max(0, y - this.scrollEl.clientHeight * 0.3); this.renderStatus();
  },
  gotoLine(line, col = 0) { if (S.ui.view !== 'edit') { S.ui.view = 'edit'; this.renderAll(); } if (!this.ta) return; const ls = this.lineStarts(this.ta.value); this.gotoOffset(ls[Math.min(ls.length, Math.max(1, line)) - 1] + col); },
  // ── 편집 조작
  replaceRange(s, e, text) {   // 실행 취소(⌘Z)가 되도록 execCommand 우선
    const ta = this.ta; ta.focus({ preventScroll: true }); ta.setSelectionRange(s, e);
    let ok = false; try { ok = document.execCommand('insertText', false, text); } catch (er) {}
    if (!ok || ta.value.slice(s, s + text.length) !== text) { ta.setRangeText(text, s, e, 'end'); this.onInput(); }
  },
  onKey(e) {
    const ta = this.ta; if (!ta || e.isComposing || e.keyCode === 229) return; const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab') {
      e.preventDefault(); const t = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      if (s === en && !e.shiftKey) return this.replaceRange(s, en, '  ');
      const a = t.lastIndexOf('\n', s - 1) + 1; let b = t.indexOf('\n', en > s && t[en - 1] === '\n' ? en - 1 : en); if (b < 0) b = t.length;
      const seg = t.slice(a, b); const out = e.shiftKey ? seg.replace(/^( {1,2}|\t)/gm, '') : seg.replace(/^/gm, '  ');
      this.replaceRange(a, b, out); ta.setSelectionRange(a, a + out.length); return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      const t = ta.value, s = ta.selectionStart; if (s !== ta.selectionEnd) return; const a = t.lastIndexOf('\n', s - 1) + 1; const line = t.slice(a, s); const eol = t.indexOf('\n', s); if ((eol < 0 ? t.length : eol) !== s) return;
      const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/); if (!m) return; e.preventDefault();
      if (!m[3].trim()) return this.replaceRange(a, s, m[1]);
      const mk = /\d/.test(m[2]) ? (parseInt(m[2], 10) + 1) + '.' : m[2]; this.replaceRange(s, s, '\n' + m[1] + mk + ' ');
      return this.keepCaret();
    }
    if (mod && keyOf(e) === 's') { e.preventDefault(); FS.flushNow(); UI.toast('저장됨 (이 기기에 자동 저장 중)'); return; }
    if (mod && e.key === 'Enter' && e.altKey) { e.preventDefault(); this.openLinkAtCaret(); }
    if (e.altKey && e.key === 'Enter') { e.preventDefault(); this.openLinkAtCaret(); }
  },
  globalKeys(e) {
    const mod = e.metaKey || e.ctrlKey; if (!mod) return; const k = keyOf(e);
    if (k === 'p' && !e.shiftKey) { e.preventDefault(); Quick.open(); }
    else if (k === 'f' && !e.shiftKey && S.ui.cur && S.ui.mode !== 'chat') { e.preventDefault(); this.findOpen(); }
    else if (k === 'b') { e.preventDefault(); ACT.toggleSide(); }
    else if (k === 'j') { e.preventDefault(); if (S.ui.mode === 'edit') ACT.mode({ dataset: { mode: 'split' } }); const i = document.getElementById('chatInput'); i && i.focus(); }
    else if (k === 'k' && !e.shiftKey) { e.preventDefault(); Quick.open('>'); }
    else if (k === 'e' && e.shiftKey) { e.preventDefault(); ACT.edView({ dataset: { v: S.ui.view === 'edit' ? 'preview' : 'edit' } }); }
  },
  linkAt() {
    const t = this.ta.value, p = this.ta.selectionStart; const a = t.lastIndexOf('\n', p - 1) + 1; let b = t.indexOf('\n', p); if (b < 0) b = t.length;
    const line = t.slice(a, b), c = p - a; for (const l of parseLinks(line)) { const m = line.slice(l.index).match(/^!?\[\[[^\]]*\]\]/); const end = l.index + (m ? m[0].length : 0); if (c >= l.index && c <= end) return l; } return null;
  },
  async openLinkAtCaret() { const l = this.linkAt(); if (!l) return UI.toast('커서 위치에 [[링크]] 가 없음'); await openWikilink(l.target, l.heading); },
  // ── 찾기 / 바꾸기
  findOpen(q) {
    if (S.ui.view !== 'edit' && S.ui.view !== 'preview') { S.ui.view = 'edit'; this.renderAll(); }   // 변경 비교 화면에서는 편집 화면으로
    const pv = S.ui.view === 'preview';
    this.find.open = true; if (q != null) this.find.q = q;
    else if (pv) { const sel = String(window.getSelection ? window.getSelection() : '').split('\n')[0].trim(); if (sel && sel.length <= 200) this.find.q = sel; }
    else if (this.ta && this.ta.selectionStart !== this.ta.selectionEnd) this.find.q = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd).split('\n')[0];
    this.renderFind(); this.doFind(true); const i = document.getElementById('findQ'); if (i) { i.focus(); i.select(); }
  },
  findClose() { this.find.open = false; this.pvClear(); this.renderFind(); this.paint(); if (this.ta) this.ta.focus({ preventScroll: true }); },
  // ── 미리보기 화면에서 찾기: 보이는 글자에서 찾아 <mark> 로 칠한다 (바꾸기는 편집 화면에서만)
  pvClear() { const sc = this.scrollEl; if (!sc) return; for (const m of [...sc.querySelectorAll('mark.pvhit')]) { const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); } },
  pvFind(jump) {
    const sc = this.scrollEl; if (!sc) return; this.pvClear(); const q = this.find.q; const marks = [];
    if (q) {
      const ql = q.toLowerCase(); const walker = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const nodes = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      for (const n of nodes) {
        const lo = n.nodeValue.toLowerCase(); let i = lo.indexOf(ql); if (i < 0 || marks.length >= 5000) continue; const parts = []; let last = 0;
        while (i !== -1 && marks.length + parts.length < 5000) { parts.push([i, i + q.length]); last = i + q.length; i = lo.indexOf(ql, Math.max(last, i + 1)); }
        const txt = n.nodeValue; const frag = document.createDocumentFragment(); let at = 0;
        for (const [s, e] of parts) { if (s > at) frag.appendChild(document.createTextNode(txt.slice(at, s))); const m = document.createElement('mark'); m.className = 'pvhit fh'; m.textContent = txt.slice(s, e); frag.appendChild(m); marks.push(m); at = e; }
        if (at < txt.length) frag.appendChild(document.createTextNode(txt.slice(at))); n.parentNode.replaceChild(frag, n);
      }
    }
    this.find.hits = marks; if (this.find.i >= marks.length || jump) this.find.i = 0; this.pvShow(jump);
  },
  pvShow(scroll) {
    const ms = this.find.hits; ms.forEach((m, i) => m.classList.toggle('fc', i === this.find.i)); const m = ms[this.find.i];
    if (m && scroll && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); this.renderFind();
  },
  renderFind() {
    const fb = document.getElementById('findbar'); if (!fb) return; fb.classList.toggle('hidden', !(this.find.open && (S.ui.view === 'edit' || S.ui.view === 'preview'))); fb.classList.toggle('pv', S.ui.view === 'preview');
    if (!this.find.open) return;
    if (!fb.dataset.built) {
      fb.dataset.built = '1';
      fb.innerHTML = `<input type="search" id="findQ" placeholder="찾기"><input type="search" id="findR" placeholder="바꾸기"><span id="findN" class="xs muted"></span><button class="sm" data-act="findPrev">▲</button><button class="sm" data-act="findNext">▼</button><button class="sm" data-act="findRep">바꾸기</button><button class="sm" data-act="findRepAll">모두</button><button class="sm ghost" data-act="findClose">✕</button>`;
      const q = fb.querySelector('#findQ'), r = fb.querySelector('#findR');
      q.addEventListener('input', () => { this.find.q = q.value; this.doFind(true); });
      q.addEventListener('keydown', (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); this.stepFind(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') this.findClose(); });
      r.addEventListener('input', () => (this.find.r = r.value)); r.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.findClose(); });
    }
    const q = fb.querySelector('#findQ'); if (q.value !== this.find.q) q.value = this.find.q; fb.querySelector('#findR').value = this.find.r;
    fb.querySelector('#findN').textContent = this.find.q ? (this.find.hits.length ? `${this.find.i + 1}/${this.find.hits.length}` : '없음') : '';
  },
  doFind(jump) {
    if (S.ui.view === 'preview') return this.pvFind(jump);
    this.computeHits(); const hits = this.find.hits;
    if (jump && hits.length && this.ta) { const p = this.ta.selectionStart; const k = hits.findIndex((h) => h.s >= p); this.find.i = k < 0 ? 0 : k; }
    this.paint(); this.renderFind(); if (jump && hits.length) this.showHit();
  },
  showHit() { const h = this.find.hits[this.find.i]; if (!h || !this.ta) return; this.ta.setSelectionRange(h.s, h.e); const y = this.yOfOffset(h.s); this.scrollEl.scrollTop = Math.max(0, y - this.scrollEl.clientHeight * 0.3); },
  stepFind(d) { const n = this.find.hits.length; if (!n) return; this.find.i = (this.find.i + d + n) % n; if (S.ui.view === 'preview') return this.pvShow(true); this.paint(); this.renderFind(); this.showHit(); },
  replaceOne() { if (S.ui.view !== 'edit') return; const h = this.find.hits[this.find.i]; if (!h) return; this.replaceRange(h.s, h.e, this.find.r); this.doFind(false); this.renderFind(); },
  replaceAll() {
    if (S.ui.view !== 'edit' || !this.find.q || !this.find.hits.length) return; const t = this.ta.value, n = this.find.hits.length; let out = '', last = 0;
    for (const h of this.find.hits) { out += t.slice(last, h.s) + this.find.r; last = h.e; } out += t.slice(last);
    this.replaceRange(0, t.length, out); this.find.hits = []; this.doFind(false); UI.toast(`${n}곳 바꿈 (⌘Z 로 되돌리기)`);
  },
  // ── 린트 바 / 상태바
  renderLintBar() {
    const lb = document.getElementById('lintbar'); if (!lb) return; const f = this.file;
    if (!f || S.ui.view !== 'edit') { lb.classList.add('hidden'); return; } lb.classList.remove('hidden');
    const sm = lintSummary(this.lint); const nfix = this.lint.filter((i) => i.rule === 'numeral' && i.level === 'error').length;
    const open = lb.classList.contains('open');
    lb.innerHTML = `<div id="lintHead" data-act="lintToggle"><span>${this.lint.length ? '' : '<span class="ok">✓ 린트 통과</span>'}${sm.error ? `<span class="err">● 오류 ${sm.error}</span> ` : ''}${sm.warn ? `<span class="warn">● 경고 ${sm.warn}</span> ` : ''}${sm.info ? `<span class="muted">● 참고 ${sm.info}</span>` : ''}</span><span class="grow"></span>${nfix ? `<button class="sm" data-act="lintFix">수 표기 ${nfix}건 자동 고치기</button>` : ''}<span class="muted xs">${open ? '▼' : '▲'}</span></div><div id="lintList">${this.lint.map((i, k) => `<div class="li-row" data-act="lintGo" data-k="${k}"><span class="dotc ${i.level}"></span><span class="muted" style="min-width:42px">${i.line}행</span><span>${esc(i.msg)}</span></div>`).join('')}</div>`;
    lb.classList.toggle('open', open);
  },
  renderStatus() {
    const sb = document.getElementById('statusbar'); if (!sb) return; const f = this.file; if (!f) { sb.innerHTML = `<span>저장소: ${esc(DB.kind)}</span>`; return; }
    let pos = ''; if (this.ta && S.ui.view === 'edit') { const c = this.caretInfo(); pos = `${c.ln}행 ${c.col}열`; const sel = this.ta.selectionEnd - this.ta.selectionStart; if (sel) pos += ` (선택 ${fmtN(sel)}자)`; }
    const t = this.ta ? this.ta.value : f.content; sb.innerHTML = `<span>${pos}</span><span>${fmtN(t.length)}자 · 약 ${fmtN(estTokens(t))} 토큰</span><span>${isScene(t) ? '장면 스크립트' : isMd(f.path) ? 'Markdown' : '텍스트'}</span><span class="grow"></span><span>저장소: ${esc(DB.kind)}</span>`;
  },
};
const isScene = (t) => Ed.isScene(t);
async function openWikilink(target, heading) {
  const r = resolveName(target);
  if (r.path) { Ed.open(r.path); if (heading) { const f = FS.get(r.path); const s = sectionOf(f.content, heading); if (s.h) Ed.gotoLine(s.h.line); } return; }
  if (r.candidates) { const pick = await Quick.pick(r.candidates, `"${target}" 후보`); if (pick) Ed.open(pick); return; }
  const dir = S.ui.cur && S.ui.cur.includes('/') ? S.ui.cur.slice(0, S.ui.cur.lastIndexOf('/') + 1) : 'drafts/';
  const p = await dlg.prompt(`"${target}" 노트가 없습니다. 새로 만들 경로:`, dir + normPath(target) + '.md', { title: '링크 대상 만들기' });
  if (p) { const np = normPath(p); const cw = FS.has(np) ? { ok: true } : { ok: true }; FS.set(np, `# ${titleOf(np)}\n\n`); Ed.open(np); }
}

ACT.tabOpen = (t, e) => { if (e.target.closest('[data-act=tabClose]')) return; Ed.saveMem(); Ed.open(t.dataset.p); };
ACT.tabClose = (t, e) => { e.stopPropagation(); Ed.close(t.dataset.p); };
ACT.edView = (t) => { Ed.saveMem(); S.ui.view = t.dataset.v; Ed.renderAll(); saveUi(); if (S.ui.view === 'edit') Ed.restoreMem(); };
ACT.edFind = () => Ed.findOpen();
ACT.findNext = () => Ed.stepFind(1); ACT.findPrev = () => Ed.stepFind(-1); ACT.findRep = () => Ed.replaceOne(); ACT.findRepAll = () => Ed.replaceAll(); ACT.findClose = () => Ed.findClose();
ACT.edFont = (t) => { S.ui.fontSize = Math.min(26, Math.max(12, (S.ui.fontSize || 16) + +t.dataset.d)); applyTheme(); saveUi(); Ed.afterInput(false); };
ACT.edFace = () => { S.ui.editorFont = S.ui.editorFont === 'mono' ? 'sans' : 'mono'; saveUi(); Ed.renderAll(); };
ACT.edWrap = () => { S.ui.noWrap = !S.ui.noWrap; saveUi(); Ed.renderAll(); };
ACT.lintToggle = (t, e) => { if (e.target.closest('button')) return; const lb = document.getElementById('lintbar'); lb.classList.toggle('open'); Ed.renderLintBar(); };
ACT.lintGo = (t) => { const i = Ed.lint[+t.dataset.k]; if (i) Ed.gotoLine(i.line, i.col || 0); };
ACT.lintFix = (t, e) => { e.stopPropagation(); const v = Ed.ta.value; const nv = fixNumerals(v); if (nv !== v) { Ed.replaceRange(0, v.length, nv); UI.toast('수 표기를 고쳤습니다 (⌘Z 로 되돌리기)'); } };
ACT.reviewPending = (t) => Appr.open(t.dataset.id);
ACT.resolveConflict = (t) => Conflict.open(t.dataset.p);
ACT.edMore = (t) => {
  const f = Ed.file; if (!f) return; const st = FS.status(f);
  Menu.at(t, [
    { label: '링크 열기 (⌥Enter)', fn: () => Ed.openLinkAtCaret() }, { label: '전체 복사', fn: () => copyText(f.content) }, { label: '내려받기', fn: () => downloadText(baseName(f.path), f.content) }, '-',
    { label: '이름 바꾸기 / 이동', fn: () => FileOps.rename(f.path) }, { label: '복제', fn: () => FileOps.duplicate(f.path) },
    ...(st && st !== 'A' ? [{ label: '마지막 동기화 상태로 되돌리기', fn: () => FileOps.revert(f.path) }] : []), { label: '삭제', danger: true, fn: () => FileOps.remove(f.path) },
  ]);
};
