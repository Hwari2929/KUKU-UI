/* ═══════════ 76 · 승인 대기 · 변경 비교 · 충돌 해결 · 되돌리기 기록 · 도움말 ═══════════ */
const Appr = {
  m: null, focus: null, editing: null, full: new Set(),
  open(id) {
    if (!S.pending.length) return UI.toast('승인 대기 중인 항목이 없습니다');
    this.focus = id || null;
    if (this.m && !this.m.done) return this.render();
    this.m = Modal.show({ title: 'AI 쓰기 승인', cls: 'wide', buttons: [], html: '<div id="apprBox"></div>', onClose: () => (this.m = null) }); this.render();
  },
  refresh() { if (this.m && !this.m.done) { if (!S.pending.length) return this.m.close(); if (!this.editing) this.render(); } },
  render() {
    if (!this.m) return; const box = this.m.body.querySelector('#apprBox'); const list = this.focus ? S.pending.filter((p) => p.id === this.focus).concat(S.pending.filter((p) => p.id !== this.focus)) : S.pending;
    box.innerHTML = `<div class="inl" style="margin-bottom:10px;flex-wrap:wrap"><span class="muted sm">AI 가 쓴 내용은 여기서 확인하고 승인해야 파일에 반영됩니다. 승인 전에는 아무것도 바뀌지 않아요.</span><span class="grow"></span><button class="sm" data-act="apprRejAll">모두 거부</button><button class="primary sm" data-act="apprOkAll">모두 승인 (${S.pending.length})</button></div>` +
      list.map((p) => {
        const cur = FS.read(p.path); const stale = Pending.stale(p); const isNew = cur == null; const li = lintText(p.after, { path: p.path }); const sm = lintSummary(li); const st = diffStat(cur ?? '', p.after); const full = this.full.has(p.id);
        return `<div class="pitem" data-id="${p.id}"><div class="ph"><b>${esc(p.path)}</b><span class="tag ${isNew ? 'ok' : ''}">${isNew ? '새 파일' : '수정'}</span><span class="tag ok">+${st.add}</span><span class="tag error">−${st.del}</span>${sm.error ? `<span class="tag error">린트 오류 ${sm.error}</span>` : ''}${sm.warn ? `<span class="tag warn">경고 ${sm.warn}</span>` : ''}${!li.length ? '<span class="tag ok">린트 통과</span>' : ''}<span class="grow"></span><span class="xs muted">${fmtDT(p.ts)}</span></div>
        <div class="pb">${p.summary ? `<div class="sm" style="margin-bottom:6px">✦ ${esc(p.summary)}</div>` : ''}${stale ? '<div class="banner warn" style="border-radius:8px;margin-bottom:8px">AI 가 이 초안을 올린 뒤 원본 파일이 바뀌었습니다. 승인하면 현재 내용을 이 초안으로 덮어씁니다.</div>' : ''}
        ${this.editing === p.id ? `<textarea class="fld mono" id="apprEd" rows="16" style="font-size:14px">${esc(p.after)}</textarea>` : full ? `<div class="df" style="padding:10px;white-space:pre-wrap">${esc(p.after)}</div>` : diffHTML(cur ?? '', p.after, 3)}
        ${li.length && this.editing !== p.id ? `<details style="margin-top:8px"><summary class="sm muted">린트 ${li.length}건 보기</summary><pre class="mono xs" style="white-space:pre-wrap;margin:6px 0 0">${esc(lintReport(li.slice(0, 30)))}</pre></details>` : ''}
        <div class="inl" style="margin-top:10px;flex-wrap:wrap">${this.editing === p.id ? `<button class="primary sm" data-act="apprEditSave" data-id="${p.id}">수정 저장</button><button class="sm" data-act="apprEditCancel">취소</button>` : `<button class="primary" data-act="apprOk" data-id="${p.id}">승인</button><button data-act="apprRej" data-id="${p.id}">거부</button><button class="sm" data-act="apprEdit" data-id="${p.id}">직접 고치기</button><button class="sm" data-act="apprFull" data-id="${p.id}">${full ? '변경만 보기' : '전체 보기'}</button>`}</div></div></div>`;
      }).join('');
  },
};
ACT.openPending = () => Appr.open();
ACT.apprOk = async (t) => { const p = S.pending.find((x) => x.id === t.dataset.id); if (!p) return; const path = p.path; await Pending.approve(p.id); UI.toast('반영했습니다: ' + path); if (!S.pending.length) { if (Appr.m && !Appr.m.done) Appr.m.close(); Ed.open(path); } else if (Appr.m && !Appr.m.done) Appr.render(); };
ACT.apprRej = (t) => { Pending.reject(t.dataset.id); UI.toast('거부했습니다'); };
ACT.apprOkAll = async () => { const n = await Pending.approveAll(); UI.toast(`${n}건 반영했습니다`); };
ACT.apprRejAll = async () => { if (await dlg.confirm('대기 중인 모든 항목을 거부할까요?', { danger: true, ok: '모두 거부' })) Pending.rejectAll(); };
ACT.apprEdit = (t) => { Appr.editing = t.dataset.id; Appr.render(); };
ACT.apprEditCancel = () => { Appr.editing = null; Appr.render(); };
ACT.apprEditSave = (t) => { const p = S.pending.find((x) => x.id === t.dataset.id); const v = document.getElementById('apprEd').value; if (p) { p.after = v; p.lint = lintSummary(lintText(v, { path: p.path })); savePending(); } Appr.editing = null; Appr.render(); };
ACT.apprFull = (t) => { const id = t.dataset.id; if (Appr.full.has(id)) Appr.full.delete(id); else Appr.full.add(id); Appr.render(); };

const Diffs = {
  open(path) {
    const f = FS.get(path); if (!f) return; const base = f.base ?? ''; const s = diffStat(base, f.content);
    Modal.open({ title: `변경 내용 — ${path}`, cls: 'wide', html: `<div class="sm muted" style="margin-bottom:8px">${f.baseSha ? '마지막 동기화(GitHub) 대비' : '새 파일'} · <span class="ok">+${s.add}</span> <span class="err">−${s.del}</span></div>${f.deleted ? '<div class="banner warn" style="border-radius:8px;margin-bottom:8px">이 파일은 삭제 표시되어 푸시하면 GitHub 에서 지워집니다.</div>' : ''}${diffHTML(base, f.deleted ? '' : f.content, 4)}`, buttons: [{ label: '열기', value: 'open' }, { label: '닫기', kind: 'primary', value: true }] }).then((v) => v === 'open' && FS.has(path) && Ed.open(path));
  },
};

const Conflict = {
  open(path) {
    const f = FS.get(path); if (!f || !f.conflict) return UI.toast('충돌 상태가 아닙니다'); const segs = f.conflict.segs; const choices = []; let ci = 0;
    segs.forEach((s) => { if (s.t === 'conflict') choices.push('ours'); });
    const build = () => `<div class="sm muted" style="margin-bottom:8px">내 변경과 GitHub 의 변경이 같은 곳을 고쳤습니다. 충돌마다 고른 뒤 적용하세요. (합친 결과는 아래 상자에서 직접 고칠 수도 있어요)</div>` +
      segs.map((s, i) => { if (s.t === 'ok') return ''; const k = segs.slice(0, i).filter((x) => x.t === 'conflict').length;
        return `<div class="conf" data-k="${k}"><div class="bar2"><b>충돌 ${k + 1}</b><label><input type="radio" name="c${k}" value="ours" ${choices[k] === 'ours' ? 'checked' : ''}> 내 것</label><label><input type="radio" name="c${k}" value="theirs" ${choices[k] === 'theirs' ? 'checked' : ''}> 원격</label><label><input type="radio" name="c${k}" value="both" ${choices[k] === 'both' ? 'checked' : ''}> 둘 다</label></div><pre class="o">${esc(s.ours.join('\n')) || '(비어 있음)'}</pre><pre class="t">${esc(s.theirs.join('\n')) || '(비어 있음)'}</pre></div>`; }).join('') +
      `<div class="sect">합친 결과 (직접 고칠 수 있음)</div><textarea class="fld mono" id="cfFinal" rows="10" style="font-size:13.5px"></textarea>`;
    const m = Modal.show({ title: `충돌 해결 — ${path}`, cls: 'wide', html: build(), buttons: [{ label: '나중에', value: false }, { label: '모두 원격 것으로', value: 'theirs', keep: true, onClick: () => { choices.fill('theirs'); setAll('theirs'); return false; } }, { label: '이 내용으로 적용', kind: 'primary', onClick: () => { GH.resolveConflict(path, m.body.querySelector('#cfFinal').value); UI.toast('충돌을 해결했습니다. 이제 푸시할 수 있어요.'); Ed.afterFilesChange(); Ed.renderAll(); Side.render(); } }] });
    const fin = m.body.querySelector('#cfFinal'); const sync = () => { fin.value = resolveSegs(segs, choices); }; const setAll = (v) => { $$('.conf', m.body).forEach((c) => { const r = c.querySelector(`input[value=${v}]`); r.checked = true; }); sync(); };
    m.body.addEventListener('change', (e) => { const r = e.target.closest('input[type=radio]'); if (!r) return; const k = +r.closest('.conf').dataset.k; choices[k] = r.value; sync(); }); sync();
  },
};

const Snaps = {
  open() {
    const list = [...S.snaps].reverse();
    const m = Modal.show({ title: '되돌리기 기록', cls: 'mid', buttons: [{ label: '닫기', value: true }], html: list.length ? `<div class="sm muted" style="margin-bottom:8px">AI 승인 · 삭제 · 이름 변경 · 병합 같은 작업 직전의 내용이 이 기기에 저장돼 있어요 (최근 150건).</div>` + list.map((s) => `<div class="card flat"><div class="inl"><b style="flex:1">${esc(s.label)}</b><span class="xs muted">${fmtDT(s.ts)}</span><button class="sm" data-act="snapGo" data-id="${s.id}">이 이전으로</button></div><div class="xs muted">${s.files.map((f) => esc(f.path)).slice(0, 6).join(' · ')}${s.files.length > 6 ? ` 외 ${s.files.length - 6}` : ''}</div></div>`).join('') : '<div class="empty">아직 기록이 없습니다</div>' });
    this.m = m;
  },
};
ACT.snapGo = async (t) => { const s = S.snaps.find((x) => x.id === t.dataset.id); if (!s) return; if (await dlg.confirm(`"${s.label}" 이전 상태로 되돌립니다. (이 되돌리기도 기록에 남아 다시 취소할 수 있어요)`, { ok: '되돌리기' })) { await FS.restoreSnap(s); Ed.afterFilesChange(); Ed.renderAll(); UI.toast('되돌렸습니다'); if (Snaps.m) Snaps.m.close(); } };

const Help = {
  open() {
    Modal.open({ title: '도움말 · 단축키', cls: 'mid help', buttons: [{ label: '닫기', kind: 'primary', value: true }], html: `
      <table><tbody>
      <tr><td><kbd>⌘P</kbd></td><td>파일 빠르게 열기 (앞에 <kbd>&gt;</kbd> 를 붙이면 명령 팔레트)</td></tr>
      <tr><td><kbd>⌘F</kbd></td><td>찾기 / 바꾸기</td></tr><tr><td><kbd>⌘S</kbd></td><td>저장 (평소에도 입력 즉시 이 기기에 자동 저장)</td></tr>
      <tr><td><kbd>⌘B</kbd></td><td>사이드바 접기/펴기</td></tr><tr><td><kbd>⌘J</kbd></td><td>대화 입력창으로 이동</td></tr>
      <tr><td><kbd>⌘⇧E</kbd></td><td>편집 ↔ 미리보기</td></tr><tr><td><kbd>⌥Enter</kbd> / <kbd>⌘클릭</kbd></td><td>커서 위치의 [[링크]] 열기</td></tr>
      <tr><td><kbd>Tab</kbd> / <kbd>⇧Tab</kbd></td><td>들여쓰기 / 내어쓰기 (여러 줄 선택 가능)</td></tr><tr><td><kbd>Esc</kbd></td><td>응답 중단 · 창 닫기</td></tr>
      </tbody></table>
      <div class="sect">크레딧을 아끼는 방법</div>
      <ul class="sm"><li>질문은 구체적으로. AI 가 필요한 문서만 찾아 읽습니다 (큰 문서는 구획 단위로).</li><li>같은 대화 안에서 이어서 물으면 앞부분이 캐시되어 입력이 약 1/10 가격입니다.</li><li><code>/검색</code> <code>/읽기</code> <code>/린트</code> 는 AI 를 쓰지 않아 무료입니다.</li><li>대화가 길어지면 새 대화를 시작하세요. 요약은 <code>/요약</code> (Haiku).</li><li>코딩·빌드는 이 도구가 아니라 Claude Code 에서 하세요.</li></ul>
      <div class="sect">데이터는 어디에 있나요</div><div class="sm">문서·대화·비용 기록·설정은 이 기기 브라우저의 저장소(IndexedDB)에만 있습니다. API 는 브라우저에서 Anthropic 으로 직접 호출하고, GitHub 는 동기화할 때만 접속합니다. 설정 → 데이터에서 백업을 내보내 두세요.</div>` });
  },
};
ACT.openHelp = () => Help.open();
