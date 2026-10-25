/* ═══════════ 72 · 사이드바: 파일 트리 · 검색 · 정보 · 동기화(Git) · 빠른 열기 ═══════════ */
const FileOps = {
  async newFile(dir = '') {
    const d = dir || (S.ui.cur && S.ui.cur.includes('/') ? S.ui.cur.slice(0, S.ui.cur.lastIndexOf('/') + 1) : 'drafts/');
    const p = await dlg.prompt('새 파일 경로 (폴더/이름.md)', d, { title: '새 파일' }); if (!p) return;
    const np = normPath(p); if (!np || !isText(np)) return UI.toast('.md / .txt 등 텍스트 파일 이름이 필요합니다');
    if (FS.has(np)) return Ed.open(np); FS.set(np, ''); Ed.open(np);
  },
  async rename(path) {
    const p = await dlg.prompt('새 경로', path, { title: '이름 바꾸기 / 이동' }); if (!p || normPath(p) === path) return; const np = normPath(p);
    if (!isText(np)) return UI.toast('텍스트 파일 이름이 필요합니다'); if (FS.has(np)) return UI.toast('이미 있는 경로입니다');
    const content = FS.read(path); await FS.apply([{ path, after: null }, { path: np, after: content }], `이름 변경: ${path} → ${np}`);
    S.ui.open = S.ui.open.map((x) => (x === path ? np : x)); if (S.ui.cur === path) S.ui.cur = np; Ed.renderAll(); saveUi();
  },
  async duplicate(path) {
    const base = path.replace(/(\.[^./]+)?$/, (m) => ' 복사' + (m || '')); const p = await dlg.prompt('복제할 경로', base, { title: '복제' }); if (!p) return; const np = normPath(p);
    if (FS.has(np)) return UI.toast('이미 있는 경로입니다'); FS.set(np, FS.read(path)); Ed.open(np);
  },
  async remove(path) {
    if (!(await dlg.confirm(`"${path}" 을(를) 삭제할까요?\n(동기화 전이라면 스냅샷으로 되돌릴 수 있어요)`, { danger: true, ok: '삭제' }))) return;
    await FS.apply([{ path, after: null }], `삭제: ${path}`); S.ui.open = S.ui.open.filter((x) => x !== path); if (S.ui.cur === path) S.ui.cur = S.ui.open[0] || null; Ed.renderAll(); saveUi();
  },
  async revert(path) {
    const f = FS.get(path); if (!f) return;
    if (!(await dlg.confirm(`"${path}" 의 변경을 버리고 ${f.baseSha ? '마지막 동기화 상태' : '삭제'}로 되돌릴까요?`, { danger: true, ok: '되돌리기' }))) return;
    const after = f.baseSha ? (f.base ?? '') : null; await FS.apply([{ path, after }], `변경 취소: ${path}`);
    if (f.baseSha) { const g = FS.get(path); if (g) { g.conflict = null; g.deleted = false; FS.touch(path); } }
    Ed.afterFilesChange(); Ed.renderAll();
  },
  importFiles() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.md,.txt,.json,.markdown,text/*';
    inp.onchange = async () => {
      const fs = [...inp.files]; if (!fs.length) return; const dir = await dlg.prompt('가져올 폴더', 'drafts/', { title: `파일 ${fs.length}개 가져오기` }); if (dir == null) return;
      let n = 0; for (const f of fs) { const t = await f.text(); const p = normPath((dir.endsWith('/') || !dir ? dir : dir + '/') + f.name); if (isText(p)) { FS.set(p, t); n++; } }
      UI.toast(`${n}개 가져옴`); Side.render();
    };
    inp.click();
  },
};

/* ── 빠른 열기 · 명령 팔레트 ── */
const Quick = {
  recent: [],
  noteOpen(p) { this.recent = [p, ...this.recent.filter((x) => x !== p)].slice(0, 20); },
  commands() {
    const c = [
      { label: wsNow() === 'self' ? '작업공간: 설정집으로 전환' : '작업공간: 자가개선(이 도구의 소스)으로 전환', fn: () => ACT.ws({ dataset: { ws: wsNow() === 'self' ? 'lore' : 'self' } }) },
      { label: '새 파일', fn: () => FileOps.newFile() }, { label: 'GitHub 에서 받기 (Pull)', fn: () => ACT.doPull() }, { label: '변경 사항 커밋 · 푸시 화면', fn: () => ACT.sideTab({ dataset: { tab: 'sync' } }) },
      { label: '예산 패널 열기', fn: () => BudgetUI.open() }, { label: '설정 열기', fn: () => Settings.open() }, { label: 'AI 쓰기 승인 대기 열기', fn: () => Appr.open() }, { label: '새 대화', fn: () => ACT.chatNew() },
      { label: '테마 바꾸기', fn: () => ACT.theme() }, { label: '스냅샷(되돌리기 기록) 보기', fn: () => Snaps.open() }, { label: '도움말 · 단축키', fn: () => Help.open() },
    ];
    for (const s of Skills.all().values()) c.push({ label: `스킬 켜기: /${s.name} — ${s.description}`, fn: () => Chat.setSkill(s.name) });
    c.push({ label: '스킬 끄기', fn: () => Chat.setSkill('') });
    return c;
  },
  items(q) {
    if (q.startsWith('>')) { const t = q.slice(1).trim().toLowerCase(); return this.commands().filter((c) => !t || c.label.toLowerCase().includes(t)).map((c) => ({ label: c.label, fn: c.fn })); }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean); let list = FS.paths();
    if (!terms.length) { const rec = this.recent.filter((p) => FS.has(p)); list = [...rec, ...list.filter((p) => !rec.includes(p))].slice(0, 40); return list.map((p) => ({ label: titleOf(p), detail: p, path: p })); }
    return list.map((p) => { const pl = p.toLowerCase(), tl = titleOf(p).toLowerCase(); if (!terms.every((t) => pl.includes(t))) return null; let sc = 0; for (const t of terms) { if (tl === t) sc += 100; else if (tl.startsWith(t)) sc += 60; else if (tl.includes(t)) sc += 30; else sc += 5; } sc -= p.length * 0.02; return { sc, label: titleOf(p), detail: p, path: p }; }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 40);
  },
  open(prefix = '') { return this.run({ title: prefix ? '명령 팔레트' : '빠른 열기', placeholder: prefix ? '명령 검색…' : '파일 이름 (> 를 앞에 붙이면 명령)', prefix, items: (q) => this.items(q), choose: (it) => (it.path ? Ed.open(it.path) : it.fn && it.fn()) }); },
  pick(list, title = '선택') { return new Promise((res) => { let done = false; this.run({ title, placeholder: '필터…', prefix: '', items: (q) => list.filter((p) => p.toLowerCase().includes(q.toLowerCase())).map((p) => ({ label: titleOf(p), detail: p, value: p })), choose: (it) => { done = true; res(it.value); }, onClose: () => { if (!done) res(null); } }); }); },
  run({ title, placeholder, prefix, items, choose, onClose }) {
    let sel = 0, cur = [];
    const m = Modal.show({ title, buttons: [], cls: 'mid', onClose, html: `<input type="text" id="qi" placeholder="${esc(placeholder)}" autocomplete="off"><div id="ql" style="margin-top:8px;max-height:52vh;overflow:auto"></div>` });
    const inp = m.body.querySelector('#qi'), list = m.body.querySelector('#ql'); inp.value = prefix;
    const draw = () => { cur = items(inp.value); sel = Math.min(sel, Math.max(0, cur.length - 1)); list.innerHTML = cur.map((it, i) => `<div class="qo ${i === sel ? 'on' : ''}" data-i="${i}"><span>${esc(it.label)}</span><span class="d">${esc(it.detail || '')}</span></div>`).join('') || '<div class="muted sm" style="padding:10px">결과 없음</div>'; const on = list.querySelector('.on'); on && on.scrollIntoView && on.scrollIntoView({ block: 'nearest' }); };
    const go = (i) => { const it = cur[i]; if (!it) return; m.close(undefined); choose(it); };
    inp.addEventListener('input', () => { sel = 0; draw(); });
    inp.addEventListener('keydown', (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'ArrowDown') { sel = Math.min(cur.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') { e.preventDefault(); go(sel); } });
    list.addEventListener('click', (e) => { const r = e.target.closest('.qo'); if (r) go(+r.dataset.i); });
    draw(); setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 30);
  },
};

/* ── 사이드바 ── */
const Side = {
  q: '', sq: '', sfolder: '', off: new Set(), commitMsg: '', _t: 0, _tab: null, _branches: null,
  renderSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.render(), 120); },
  render() {
    const pane = document.getElementById('sidePane'); if (!pane || !S.ui.sideOpen) return; const tab = S.ui.sideTab || 'files';
    const keep = { y: pane.scrollTop };
    if (tab === 'files') this.renderFiles(pane);
    else if (tab === 'search') this.renderSearch(pane);
    else if (tab === 'info') this.renderInfo(pane);
    else this.renderSync(pane);
    if (this._tab === tab) pane.scrollTop = keep.y; this._tab = tab;
  },
  // ── 파일
  buildTree(filter) {
    const root = { dirs: new Map(), files: [] }; const ft = filter.toLowerCase().split(/\s+/).filter(Boolean);
    for (const f of FS.map.values()) {
      if (!inWs(f.path)) continue;
      if (ft.length && !ft.every((t) => f.path.toLowerCase().includes(t))) continue;
      const parts = f.path.split('/'); let n = root; for (let i = 0; i < parts.length - 1; i++) { if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [] }); n = n.dirs.get(parts[i]); } n.files.push(f);
    }
    return root;
  },
  renderFiles(pane) {
    if (this._tab !== 'files' || !pane.querySelector('#fq')) {
      pane.innerHTML = `<div class="inl"><input type="search" id="fq" placeholder="파일 필터…" value="${esc(this.q)}"><button class="sm" data-act="newFile" title="새 파일">＋</button><button class="sm" data-act="importFiles" title="가져오기">⇪</button></div><div id="tree" class="tree" style="margin-top:8px"></div>`;
      pane.querySelector('#fq').addEventListener('input', (e) => { this.q = e.target.value; this.fillTree(); });
    }
    this.fillTree();
  },
  fillTree() {
    const tr = document.getElementById('tree'); if (!tr) return; const root = this.buildTree(this.q); const filt = !!this.q.trim(); const cur = S.ui.cur || '';
    const dirChanges = (n) => { let c = 0; for (const f of n.files) if (FS.status(f)) c++; for (const d of n.dirs.values()) c += dirChanges(d); return c; };
    const rows = [];
    const walk = (n, prefix, depth) => {
      const dirs = [...n.dirs].sort((a, b) => a[0].localeCompare(b[0], 'ko')); const files = n.files.sort((a, b) => baseName(a.path).localeCompare(baseName(b.path), 'ko'));
      for (const [name, d] of dirs) {
        const p = prefix + name + '/'; const open = filt || (S.ui.openDirs[p] ?? cur.startsWith(p)); const ch = dirChanges(d);
        rows.push(`<div class="tr" data-act="dirToggle" data-d="${esc(p)}" style="padding-left:${4 + depth * 14}px"><span class="car">${open ? '▾' : '▸'}</span><span class="nm">📁 ${esc(name)}</span>${ch ? `<span class="bd M">${ch}</span>` : ''}<button class="more" data-act="dirMore" data-d="${esc(p)}">⋯</button></div>`);
        if (open) walk(d, p, depth + 1);
      }
      for (const f of files) {
        if (f.deleted && !f.baseSha) continue; const st = FS.status(f); const pend = Pending.get(f.path);
        rows.push(`<div class="tr ${f.path === cur ? 'cur' : ''} ${f.deleted ? 'del' : ''}" data-act="fileOpen" data-p="${esc(f.path)}" style="padding-left:${22 + depth * 14}px" title="${esc(f.path)}"><span class="nm">${esc(baseName(f.path))}</span>${pend ? '<span class="bd P">AI</span>' : ''}${H.badge(st)}<button class="more" data-act="rowMore" data-p="${esc(f.path)}">⋯</button></div>`);
      }
    };
    walk(root, '', 0);
    // 아직 파일에 반영 안 된 AI 새 파일
    const pendNew = S.pending.filter((p) => inWs(p.path) && !FS.has(p.path) && (!this.q || p.path.toLowerCase().includes(this.q.toLowerCase())));
    const pn = pendNew.length ? `<div class="sect">AI 새 파일 (승인 대기)</div>` + pendNew.map((p) => `<div class="tr" data-act="reviewPending" data-id="${p.id}"><span class="nm">✦ ${esc(p.path)}</span></div>`).join('') : '';
    tr.innerHTML = (rows.join('') || `<div class="empty" style="padding:24px 8px"><div>${filt ? '일치하는 파일이 없음' : '파일이 없습니다'}</div>${filt ? '' : '<div class="sm" style="margin-top:8px">동기화 탭에서 GitHub 문서를 받아 오세요.</div>'}</div>`) + pn;
  },
  // ── 검색
  renderSearch(pane) {
    if (this._tab !== 'search' || !pane.querySelector('#sq')) {
      const tops = [...new Set(FS.paths().map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/') + 1) : '')).filter(Boolean))];
      pane.innerHTML = `<input type="search" id="sq" placeholder="본문 검색 (공백 = AND)" value="${esc(this.sq)}"><select id="sf" style="margin-top:6px"><option value="">전체 폴더</option>${tops.map((t) => `<option ${t === this.sfolder ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><div class="xs muted" style="margin:6px 2px">이 검색은 기기 안에서만 돌아서 크레딧이 들지 않아요.</div><div id="sres"></div>`;
      const run = debounce(() => this.fillSearch(), 200); pane.querySelector('#sq').addEventListener('input', (e) => { this.sq = e.target.value; run(); }); pane.querySelector('#sf').addEventListener('change', (e) => { this.sfolder = e.target.value; this.fillSearch(); });
    }
    this.fillSearch();
  },
  fillSearch() {
    const el = document.getElementById('sres'); if (!el) return; if (!this.sq.trim()) { el.innerHTML = ''; return; }
    const r = searchNotes(this.sq, { folder: this.sfolder, limit: 30 }); const terms = this.sq.trim().split(/\s+/).filter(Boolean);
    const mk = (s) => { let h = esc(s); for (const t of terms) { const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); h = h.replace(re, (m) => `<mark>${m}</mark>`); } return h; };
    el.innerHTML = r.length ? r.map((x) => `<div class="hit" data-act="hitOpen" data-p="${esc(x.path)}" data-q="${esc(terms[0] || '')}"><div class="p">${esc(titleOf(x.path))} <span class="muted xs">${esc(x.path)}</span></div>${x.snips.map((s) => `<div class="sn">${s.section ? `<b>§${esc(s.section)}</b> ` : ''}${mk(s.text)}</div>`).join('')}</div>`).join('') : '<div class="empty" style="padding:20px">결과 없음</div>';
  },
  // ── 정보
  renderInfo(pane) {
    const f = Ed.file; if (!f) { pane.innerHTML = '<div class="empty">열린 파일이 없습니다</div>'; return; }
    const text = f.content, ol = outlineOf(text), out = linksOf(f.path), back = backlinksOf(f.path); const tok = estTokens(text);
    const model = S.settings.model; const cost = estimateCost(model, tok);
    const uniq = []; const seen = new Set(); for (const l of out) { const k = l.target + '#' + l.heading; if (!seen.has(k)) { seen.add(k); uniq.push(l); } }
    const lintSm = lintSummary(Ed.lint);
    pane.innerHTML = `<div class="card flat"><b>${esc(titleOf(f.path))}</b> ${H.badge(FS.status(f))}<div class="xs muted mono" style="word-break:break-all">${esc(f.path)}</div>
      <div class="sm" style="margin-top:6px">${fmtN(text.length)}자 · 약 ${fmtN(tok)} 토큰</div><div class="xs muted">AI 가 이 문서를 통째로 읽으면 입력 약 ${fmtUSD(cost)}<span class="krw"> (${fmtKRW(cost)})</span>, 캐시 적중 시 약 1/10</div>
      <div class="sm" style="margin-top:4px">린트: <span class="err">오류 ${lintSm.error}</span> · <span class="warn">경고 ${lintSm.warn}</span></div></div>
      <div class="sect">목차 (${ol.length})</div>${ol.length ? ol.slice(0, 200).map((h) => `<div class="tr" data-act="goLine" data-l="${h.line}" style="padding-left:${6 + (h.lvl - 1) * 12}px"><span class="nm">${esc(h.title)}</span><span class="xs muted">${kfmt(h.size)}</span></div>`).join('') : '<div class="xs muted" style="padding:4px 8px">제목이 없음</div>'}
      <div class="sect">나가는 링크 (${uniq.length})</div>${uniq.map((l) => `<div class="tr" data-act="linkOpen" data-t="${esc(l.target)}" data-h="${esc(l.heading)}"><span class="nm ${l.path ? '' : 'err'}">${l.embed ? '⤷ ' : ''}${esc(l.target)}${l.heading ? '#' + esc(l.heading) : ''}</span>${l.path ? '' : '<span class="bd D">없음</span>'}</div>`).join('') || '<div class="xs muted" style="padding:4px 8px">없음</div>'}
      <div class="sect">들어오는 링크 (${back.length})</div>${back.map((p) => `<div class="tr" data-act="fileOpen" data-p="${esc(p)}"><span class="nm">${esc(titleOf(p))}</span><span class="xs muted">${esc(p.split('/').slice(0, -1).join('/'))}</span></div>`).join('') || '<div class="xs muted" style="padding:4px 8px">없음</div>'}`;
  },
  // ── 동기화
  renderSync(pane) {
    const self = wsNow() === 'self'; const c = GH.cfg, sy = GH.sy(); const ch = FS.changes(); const sel = ch.filter((x) => !this.off.has(x.path) && x.st !== 'C'); const hasTok = !!S.secrets.ghToken;
    const names = { M: '수정', A: '추가', D: '삭제', C: '충돌' };
    const branchBlock = self
      ? `<div><b>${esc(c.owner)}/${esc(c.repo)}</b> <span class="tag warn">자가개선</span></div><div class="selfnote">작업 브랜치 <b class="mono">${esc(c.branch)}</b> (기준 <span class="mono">${esc(c.base)}</span>)<br>AI 가 고친 내용은 승인 후 작업 브랜치로만 올라가고 <b>${esc(c.base)} 에는 직접 올라가지 않습니다.</b> 병합은 GitHub 에서 직접 하세요.${sy.branch && sy.branch !== c.branch ? `<br><span class="warn">지금은 ${esc(sy.branch)} 에서 받은 상태 (작업 브랜치가 아직 없음 — 첫 푸시 때 만들어져요)</span>` : ''}</div>`
      : `<div><b>${esc(c.owner)}/${esc(c.repo)}</b></div><div class="inl" style="margin:6px 0"><select id="brSel" style="min-width:0"><option>${esc(c.branch)}</option>${(this._branches || []).filter((b) => b !== c.branch).map((b) => `<option>${esc(b)}</option>`).join('')}</select><button class="sm" data-act="brLoad" title="브랜치 목록 불러오기">↻</button><button class="sm" data-act="brNew" title="새 브랜치">＋</button></div>`;
    const selfBlock = self ? `<div class="sect">빌드 · 미리보기</div><div class="inl" style="flex-wrap:wrap;gap:6px"><button class="sm" data-act="selfCheck">빌드 점검</button><button class="sm" data-act="selfPreview">미리보기 열기</button><button class="sm" data-act="selfDownload">HTML 받기</button></div><div class="selfnote">합치기·문법 점검만 합니다(승인 대기 중인 초안 포함). 미리보기는 새 탭에서 열리며 저장소가 분리되어 빈 상태로 시작해요. <b>테스트(npm test)는 Claude Code/로컬에서</b> 돌리세요.</div>
      <div class="sect">병합</div><div class="inl" style="flex-wrap:wrap;gap:6px"><button class="sm" data-act="selfPR" ${hasTok ? '' : 'disabled'}>PR 만들기 / 열기</button><button class="sm ghost" data-act="selfReset" ${hasTok ? '' : 'disabled'}>작업 브랜치 초기화</button></div><div class="selfnote">PR 을 GitHub 에서 병합한 뒤에는 "작업 브랜치 초기화"로 ${esc(c.base)} 와 맞춰 새로 시작하세요.</div>` : '';
    pane.innerHTML = `<div class="card">${branchBlock}
      <div class="xs muted">마지막 받기: ${sy.lastPull ? fmtDT(sy.lastPull) : '아직 없음'}${sy.lastHead ? ' · ' + sy.lastHead.slice(0, 7) : ''}<br>${hasTok ? '토큰 설정됨 — 커밋·푸시 가능' : '토큰 없음 — 읽기만 가능 (설정 → GitHub)'}</div>
      <div class="inl" style="margin-top:8px"><button class="primary" data-act="doPull" style="flex:1">⬇ 받기 (Pull)</button><button class="sm" data-act="pullMore" title="더보기">⋯</button></div></div>
      <div class="sect">변경 ${ch.length}건</div>
      ${ch.length ? ch.map((x) => `<div class="tr" style="padding-left:2px"><input type="checkbox" data-act="selChange" data-p="${esc(x.path)}" ${this.off.has(x.path) ? '' : 'checked'} ${x.st === 'C' ? 'disabled' : ''}><span class="nm" data-act="fileOpen" data-p="${esc(x.path)}" title="${esc(x.path)}">${esc(self ? x.path.slice(SELF_PREFIX.length) : x.path)}</span>${H.badge(x.st)}<button class="more" style="opacity:.8" data-act="changeMore" data-p="${esc(x.path)}" data-st="${x.st}">⋯</button></div>`).join('') : '<div class="xs muted" style="padding:4px 8px">GitHub 와 같은 상태입니다</div>'}
      ${ch.length ? `<textarea class="fld" id="cmsg" rows="2" placeholder="커밋 메시지" style="margin-top:8px">${esc(this.commitMsg)}</textarea><div class="inl" style="margin-top:6px"><button class="sm" data-act="autoMsg">자동 메시지</button><button class="primary" data-act="doPush" style="flex:1" ${hasTok && sel.length ? '' : 'disabled'}>⬆ 커밋 · 푸시 (${sel.length})</button></div>${hasTok && sel.length ? '' : `<div class="xs muted" style="margin-top:4px">${!hasTok ? '비활성: GitHub 토큰이 없어요 (설정 → GitHub).' : '비활성: 체크된 변경이 없어요' + (ch.some((x) => x.st === 'C') ? ' (충돌 파일은 해결한 뒤에 올릴 수 있어요).' : '.')}</div>`}` : ''}
      ${selfBlock}
      <div class="sect">되돌리기 기록 <button class="sm ghost" data-act="openSnaps">전체 보기</button></div>
      ${[...S.snaps].reverse().slice(0, 5).map((s) => `<div class="tr" data-act="snapRestore" data-id="${s.id}"><span class="nm">${esc(s.label)}</span><span class="xs muted">${fmtDT(s.ts)} · ${s.files.length}</span></div>`).join('') || '<div class="xs muted" style="padding:4px 8px">아직 없음</div>'}`;
    const cm = pane.querySelector('#cmsg'); if (cm) cm.addEventListener('input', () => (this.commitMsg = cm.value));
    const bsel = pane.querySelector('#brSel'); if (bsel) bsel.addEventListener('change', (e) => { S.settings.gh.branch = e.target.value; saveSettings(); UI.toast(`브랜치: ${e.target.value} — 받기를 눌러 불러오세요`); this.render(); });
  },
};
const rowMenu = (t, items) => Menu.at(t, items);
ACT.dirToggle = (t, e) => { if (e.target.closest('.more')) return; const d = t.dataset.d; const cur = S.ui.cur || ''; const open = S.ui.openDirs[d] ?? cur.startsWith(d); S.ui.openDirs[d] = !open; saveUi(); Side.fillTree(); };
ACT.fileOpen = (t, e) => { if (e.target.closest('.more') || e.target.closest('input')) return; Quick.noteOpen(t.dataset.p); Ed.open(t.dataset.p); if (innerWidth < 980) { S.ui.sideOpen = false; applyLayout(); } };
ACT.hitOpen = (t) => { Quick.noteOpen(t.dataset.p); Ed.open(t.dataset.p, { find: t.dataset.q }); if (innerWidth < 980) { S.ui.sideOpen = false; applyLayout(); } };
ACT.goLine = (t) => Ed.gotoLine(+t.dataset.l);
ACT.linkOpen = (t) => openWikilink(t.dataset.t, t.dataset.h);
ACT.newFile = (t, e) => { e && e.stopPropagation(); return FileOps.newFile(); };
ACT.importFiles = () => FileOps.importFiles();
ACT.rowMore = (t, e) => { e.stopPropagation(); const p = t.dataset.p; const f = FS.get(p); const st = f && FS.status(f); rowMenu(t, [{ label: '열기', fn: () => Ed.open(p) }, { label: '이름 바꾸기 / 이동', fn: () => FileOps.rename(p) }, { label: '복제', fn: () => FileOps.duplicate(p) }, { label: '경로 복사', fn: () => copyText(p) }, ...(st && st !== 'A' ? [{ label: '변경 되돌리기', fn: () => FileOps.revert(p) }] : []), ...(f && f.deleted ? [{ label: '삭제 취소', fn: () => { FS.undelete(p); UI.files(); } }] : [{ label: '삭제', danger: true, fn: () => FileOps.remove(p) }])]); };
ACT.dirMore = (t, e) => { e.stopPropagation(); const d = t.dataset.d; rowMenu(t, [{ label: '여기에 새 파일', fn: () => FileOps.newFile(d) }, { label: '모두 펼치기', fn: () => { for (const p of FS.paths()) { let i = p.indexOf('/'); while (i >= 0) { if (p.slice(0, i + 1).startsWith(d)) S.ui.openDirs[p.slice(0, i + 1)] = true; i = p.indexOf('/', i + 1); } } saveUi(); Side.fillTree(); } }, { label: '접기', fn: () => { S.ui.openDirs[d] = false; saveUi(); Side.fillTree(); } }]); };
ACT.selChange = (t, e) => { e.stopPropagation(); if (t.checked) Side.off.delete(t.dataset.p); else Side.off.add(t.dataset.p); Side.render(); };
ACT.changeMore = (t, e) => { e.stopPropagation(); const p = t.dataset.p, st = t.dataset.st; rowMenu(t, [{ label: '변경 내용 보기', fn: () => Diffs.open(p) }, ...(st === 'C' ? [{ label: '충돌 해결', fn: () => Conflict.open(p) }] : []), { label: '열기', fn: () => Ed.open(p) }, { label: '변경 되돌리기', danger: true, fn: () => FileOps.revert(p) }]); };
ACT.autoMsg = () => {
  const ch = FS.changes().filter((x) => !Side.off.has(x.path)); const g = { A: [], M: [], D: [] }; ch.forEach((x) => g[x.st] && g[x.st].push(titleOf(x.path)));
  const part = (k, l) => (g[k].length ? `${l} ${g[k].slice(0, 3).join(', ')}${g[k].length > 3 ? ` 외 ${g[k].length - 3}` : ''}` : '');
  Side.commitMsg = (wsNow() === 'self' ? 'self: ' : 'studio: ') + [part('A', '추가'), part('M', '수정'), part('D', '삭제')].filter(Boolean).join(' / '); Side.render();
};
ACT.brLoad = async () => { try { Side._branches = await GH.listBranches(); UI.toast(`브랜치 ${Side._branches.length}개`); Side.render(); } catch (e) { UI.toast('⚠ ' + e.message, 5000); } };
ACT.brNew = async () => {
  const n = await dlg.prompt(`새 브랜치 이름 (현재 ${S.settings.gh.branch} 에서 갈라짐)`, 'claude/studio-' + dayKey(Date.now()).replace(/-/g, ''), { title: '새 브랜치' }); if (!n) return;
  try { await GH.createBranch(n.trim()); S.settings.gh.branch = n.trim(); saveSettings(); S.sync.lastHead = null; await saveSync(); Side._branches = null; UI.toast('브랜치를 만들었습니다'); Side.render(); } catch (e) { UI.toast('⚠ ' + e.message, 6000); }
};
ACT.doPull = async (t, e, force = false) => {
  if (S.run.busy) return UI.toast('AI 응답이 끝난 뒤에 받아 주세요'); try {
    const r = await GH.pull({ force });
    if (r.upToDate) UI.toast('이미 최신입니다'); else UI.toast(`받기 완료 — 새 ${r.added} · 갱신 ${r.updated} · 병합 ${r.merged} · 제거 ${r.removed}${r.conflicts.length ? ` · ⚠ 충돌 ${r.conflicts.length}` : ''}`, 5000);
    if (r.conflicts.length) Conflict.open(r.conflicts[0]); Side.render(); Ed.afterFilesChange();
  } catch (er) { UI.progress(''); UI.toast('⚠ ' + er.message, 7000); }
};
ACT.pullMore = (t) => Menu.at(t, [{ label: '전체 다시 받기 (강제)', fn: () => ACT.doPull(null, null, true) }, { label: '연결 테스트', fn: async () => { try { const r = await GH.test(); UI.toast(`연결 OK — 최신 커밋 "${r.message}"`, 5000); } catch (e) { UI.toast('⚠ ' + e.message, 6000); } } }]);
ACT.doPush = async () => {
  const paths = FS.changes().filter((x) => !Side.off.has(x.path) && x.st !== 'C').map((x) => x.path); const msg = (document.getElementById('cmsg') || {}).value || Side.commitMsg;
  if (!paths.length) return UI.toast('커밋할 파일을 선택하세요'); if (!msg.trim()) return UI.toast('커밋 메시지를 적어 주세요');
  const self = wsNow() === 'self'; const c = GH.cfg; if (!(await dlg.confirm(`${paths.length}개 파일을 ${c.owner}/${c.repo} 의 ${c.branch} 브랜치에 커밋·푸시합니다.${self ? `\n(${c.base} 에는 올라가지 않습니다)` : ''}\n\n${msg}`, { ok: '푸시' }))) return;
  try { const r = await GH.push(paths, msg); Side.commitMsg = ''; Side.render(); await Modal.open({ title: '푸시 완료', html: `<div>커밋 <b class="mono">${r.sha.slice(0, 7)}</b> — 파일 ${r.files}개</div><div class="sm muted" style="margin-top:6px"><a href="https://github.com/${esc(c.owner)}/${esc(c.repo)}/commit/${r.sha}" target="_blank" rel="noopener">GitHub 에서 보기 ↗</a></div>`, buttons: self ? [{ label: '확인', value: 1 }, { label: 'PR 만들기', kind: 'primary', value: 'pr' }] : [{ label: '확인', kind: 'primary', value: 1 }] }).then((v) => { if (v === 'pr') ACT.selfPR(); }); }
  catch (e) { UI.progress(''); UI.toast('⚠ ' + e.message, 8000); Side.render(); }
};
ACT.snapRestore = async (t) => { const s = S.snaps.find((x) => x.id === t.dataset.id); if (!s) return; if (await dlg.confirm(`"${s.label}" 이전 상태로 되돌릴까요?\n파일 ${s.files.length}개 (${s.files.map((f) => baseName(f.path)).slice(0, 4).join(', ')}${s.files.length > 4 ? '…' : ''})`, { ok: '되돌리기' })) { await FS.restoreSnap(s); Ed.afterFilesChange(); UI.toast('되돌렸습니다'); } };
ACT.openSnaps = () => Snaps.open();
// ── 자가개선: 빌드 점검 · 미리보기 · PR · 작업 브랜치 초기화
ACT.selfCheck = () => {
  const r = SelfBuild.build();
  Modal.open({ title: r.ok ? '빌드 점검: 성공' : '빌드 점검: 실패', html: r.ok ? `<div>합본 <b>${kfmt(r.bytes)}B</b> (JS ${kfmt(r.jsBytes)}B) · 조각 ${r.order.length}개</div><div class="sm muted" style="margin-top:8px">문법만 확인한 결과예요. 동작은 "미리보기 열기"로 직접 눌러 보고, 테스트는 Claude Code/로컬에서 <code>npm test</code> 로 돌리세요.</div>` : `<div class="err" style="white-space:pre-wrap">${esc(r.error)}</div>`, buttons: [{ label: '확인', kind: 'primary', value: 1 }] });
};
ACT.selfPreview = () => { const r = SelfBuild.preview(); if (!r.ok) dlg.alert(r.error, '미리보기를 열 수 없음'); else UI.toast(`새 탭에서 열었어요 (${kfmt(r.bytes)}B) — 저장소가 분리되어 빈 상태로 시작합니다`, 5000); };
ACT.selfDownload = () => { const r = SelfBuild.build(); if (!r.ok) return dlg.alert(r.error, '빌드 실패'); downloadText('ERTES-Studio-preview.html', r.html, 'text/html'); };
ACT.selfPR = async () => {
  if (wsNow() !== 'self') return; const c = GH.cfg;
  const title = await dlg.prompt('PR 제목', '자가개선: ', { title: `${c.branch} → ${c.base} PR` }); if (!title || !title.trim()) return;
  try { UI.progress('PR 확인 중…'); const r = await GH.openPR(title.trim(), 'ERTES Studio 의 자가개선 기능으로 만든 변경입니다. 병합 전에 `npm test` 와 미리보기 확인을 권장합니다.'); UI.progress('');
    await Modal.open({ title: r.created ? 'PR 을 만들었어요' : '이미 열린 PR 이 있어요', html: `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number} GitHub 에서 열기 ↗</a></div><div class="sm muted" style="margin-top:8px">병합은 GitHub 에서 직접 하세요. 병합 후에는 "작업 브랜치 초기화"를 눌러 ${esc(c.base)} 와 맞춥니다.</div>`, buttons: [{ label: '확인', kind: 'primary', value: 1 }] });
  } catch (e) { UI.progress(''); UI.toast('⚠ ' + e.message, 7000); }
};
ACT.selfReset = async () => {
  if (wsNow() !== 'self') return; const c = GH.cfg;
  if (!(await dlg.confirm(`작업 브랜치 ${c.branch} 를 ${c.base} 와 같은 상태로 되돌립니다.\n아직 ${c.base} 에 병합하지 않은 커밋은 브랜치에서 사라집니다. (이 기기에 있는 로컬 변경은 유지되어 다시 받을 때 병합됩니다)`, { danger: true, ok: '초기화' }))) return;
  try { await GH.resetWork(); UI.toast('초기화했어요. 받기(Pull)로 최신 상태를 불러오세요.', 5000); Side.render(); } catch (e) { UI.toast('⚠ ' + e.message, 7000); }
};
