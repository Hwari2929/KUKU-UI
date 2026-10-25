/* ═══════════ 73 · 대화창: 메시지 · 도구 카드 · 턴별 비용 · 입력창 · 슬래시 ═══════════ */
const tokStr = (u) => `입력 ${kfmt(u.input)} · 읽기 ${kfmt(u.cacheRead)} · 쓰기 ${kfmt(u.cw5 + u.cw1h)} · 출력 ${kfmt(u.output)}`;
const usd = (x) => fmtUSD(x);
const Chat = {
  stick: true, hist: [], hi: -1, slash: { open: false, items: [], sel: 0 }, _rl: 0, exact: null,
  get cur() { let c = Chats.get(S.ui.chatId); if (!c) { c = S.chats[0] || Chats.create(); S.ui.chatId = c.id; saveUi(); } return c; },
  init() {
    this.renderHead(); this.renderComposer(); this.render();
    const m = document.getElementById('msgs'); m.addEventListener('scroll', () => { this.stick = m.scrollHeight - m.scrollTop - m.clientHeight < 90; });
    m.addEventListener('click', (e) => this.onMsgClick(e));
  },
  setSkill(name) { const c = this.cur; c.skill = name; Chats.save(c); this.renderEst(); this.renderComposer(); UI.toast(name ? `스킬 "${name}" 켜짐` : '스킬 꺼짐'); },
  // ── 헤더
  renderHead() {
    const h = document.getElementById('chatHead'); if (!h) return; const cur = this.cur;
    const cost = (id) => Ledger.sum(S.ledger.filter((e) => e.chatId === id)).cost;
    h.innerHTML = `<select id="chatSel" aria-label="대화 선택">${S.chats.map((c) => `<option value="${c.id}" ${c.id === cur.id ? 'selected' : ''}>${esc(c.title)} · ${fmtDT(c.updated)} · ${usd(cost(c.id))}</option>`).join('')}</select><button class="sm" data-act="chatNew" title="새 대화">＋</button><button class="sm" data-act="chatMore">⋯</button>`;
    h.querySelector('#chatSel').addEventListener('change', (e) => { S.ui.chatId = e.target.value; saveUi(); this.stick = true; this.render(); this.renderHead(); this.renderComposer(); });
  },
  // ── 메시지
  render() {
    const box = document.getElementById('msgs'); if (!box) return; const c = this.cur; const msgs = c.messages;
    const tm = new Map(Ledger.turns(1e6, c.id).map((t) => [t.turnId, t])); const lastIdx = new Map(); msgs.forEach((m, i) => { if (m.meta && m.meta.turnId && !m.local) lastIdx.set(m.meta.turnId, i); });
    let h = '';
    if (!msgs.length) h = this.welcome();
    msgs.forEach((m, i) => {
      if (m.local && m.kind === 'batch') { h += Batch.card(m); return; }
      if (m.local) { h += m.role === 'user' ? `<div class="msg user"><div class="bubble">${esc(m.md)}</div></div>` : `<div class="msg ai local ${m.kind || ''}"><div class="bubble"><div class="md">${renderMd(m.md)}</div></div></div>`; return; }
      if (m.toolResults) return;
      if (m.role === 'user') { const t = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'); h += `<div class="msg user"><div class="bubble">${esc(t)}</div></div>`; return; }
      const next = msgs[i + 1]; const results = next && next.toolResults ? next.content : [];
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n'); const uses = m.content.filter((b) => b.type === 'tool_use');
      h += `<div class="msg ai">${text ? `<div class="bubble"><div class="md">${renderMd(text)}</div></div>` : ''}${uses.length ? `<div class="tools">${uses.map((u) => this.toolCard(u, results.find((r) => r.tool_use_id === u.id), false)).join('')}</div>` : ''}`;
      if (m.meta && m.meta.turnId && lastIdx.get(m.meta.turnId) === i && tm.get(m.meta.turnId)) h += this.turnSummary(tm.get(m.meta.turnId));
      h += '</div>';
    });
    h += '<div id="liveHold"></div>';
    box.innerHTML = h; $$('.codeblk', box).forEach((cb) => this.decorateCode(cb));
    if (S.run.busy && S.run.chatId === c.id && this._live) this.renderLive(this._live);
    if (this.stick) this.scrollEnd();
  },
  welcome() {
    const have = FS.paths().length;
    return `<div class="empty"><h3>ERTES 집필 도우미</h3><div>${have ? `문서 ${have}개를 읽을 수 있어요. 질문하면 필요한 문서만 찾아 읽고 답합니다.` : '먼저 사이드바의 <b>동기화</b> 탭에서 GitHub 문서를 받아 오세요.'}</div><div class="sm" style="margin-top:12px;text-align:left;display:inline-block"><b>/</b> 로 시작하면 스킬 선택<br><code>/장면</code> 장면 스크립트 작성 · <code>/확장</code> 인물 확장 문서<br><code>/정합</code> 모순 점검 · <code>/구상</code> 아이디어 · <code>/캠페인</code> 전개<br><code>/검색</code> <code>/읽기</code> <code>/린트</code> 는 크레딧이 들지 않는 로컬 명령</div></div>`;
  },
  toolCard(u, res, running) {
    const icon = { search: '🔎', read_note: '📖', list_notes: '📁', write_note: '✍️', edit_note: '✏️', lint: '🧹' }[u.name] || '🔧';
    const st = running ? 'run' : res ? (res.is_error ? 'bad' : 'okk') : 'bad';
    return `<div><div class="tcall ${st}" data-act="toolToggle"><span class="s">${running ? '…' : res ? (res.is_error ? '✕' : '✓') : '–'}</span><span>${icon} ${esc(u.name)}</span><span class="sm">${esc(toolSummary(u))}</span></div>${res && !running ? `<div class="tres hidden">${esc(typeof res.content === 'string' ? res.content : JSON.stringify(res.content)).slice(0, 6000)}</div>` : ''}</div>`;
  },
  turnSummary(t) {
    const u = t.usage, w = u.cw5 + u.cw1h; const rem = Budget.remaining();
    const rows = t.entries.map((e) => `<tr><td>${e.iter}${e.partial ? ' (중단)' : ''}</td><td>${fmtN(e.usage.input)}</td><td>${fmtN(e.usage.cw5 + e.usage.cw1h)}</td><td>${fmtN(e.usage.cacheRead)}</td><td>${fmtN(e.usage.output)}</td><td>${usd(e.cost)}</td><td class="l" style="text-align:left;color:var(--muted)">${esc((e.tools || []).join(', '))}</td></tr>`).join('');
    return `<details class="turnsum"><summary><b>${usd(t.cost)}</b><span class="krw">${fmtKRW(t.cost)}</span><span>호출 ${t.iters}회</span><span class="muted">${tokStr(u)}</span><span class="muted">▾</span></summary><div class="det"><table><thead><tr><th>호출</th><th>입력</th><th>캐시 쓰기</th><th>캐시 읽기</th><th>출력</th><th>비용</th><th class="l" style="text-align:left">도구</th></tr></thead><tbody>${rows}<tr><td><b>합계</b></td><td><b>${fmtN(u.input)}</b></td><td><b>${fmtN(w)}</b></td><td><b>${fmtN(u.cacheRead)}</b></td><td><b>${fmtN(u.output)}</b></td><td><b>${usd(t.cost)}</b></td><td></td></tr></tbody></table><div class="muted" style="margin-top:5px">${esc(t.model)} · 캐시로 아낀 금액 약 ${usd(t.saved)} · 남은 크레딧 ${usd(rem)}<span class="krw"> (${fmtKRW(rem)})</span></div></div></details>`;
  },
  decorateCode(cb) {
    const code = cb.querySelector('code'); if (!code) return; const text = code.textContent; const bar = cb.querySelector('.cbh');
    const sceneLike = /^##\s*본문/m.test(text) || cb.dataset.lang === 'scene';
    if (sceneLike || /\S/.test(text) && cb.dataset.lang !== 'bash') { const is = lintText(text, { path: sceneLike ? 'x.md' : '' }); const sm = lintSummary(is); const b = bar.querySelector('.cb-badge'); if (is.length) { b.textContent = `린트 오류 ${sm.error} · 경고 ${sm.warn}`; b.classList.add('bad'); b.title = lintReport(is.slice(0, 20)); } else if (sceneLike) { b.textContent = '린트 통과'; b.classList.add('good'); } }
    if (sceneLike || (text.split('\n').length > 6)) { const btn = document.createElement('button'); btn.className = 'mini'; btn.dataset.act = 'codeSave'; btn.textContent = '파일로'; bar.appendChild(btn); }
  },
  onMsgClick(e) {
    const cp = e.target.closest('[data-copy]'); if (cp) { const code = cp.closest('.codeblk').querySelector('code'); copyText(code.textContent); return; }
    const wl = e.target.closest('a.wl'); if (wl) { e.preventDefault(); openWikilink(wl.dataset.wl, wl.dataset.h); }
  },
  // ── 라이브(스트리밍)
  _live: null,
  renderLive(live) {
    this._live = live; const hold = document.getElementById('liveHold'); if (!hold) return;
    if (!live || live.chatId !== this.cur.id) { hold.innerHTML = ''; return; }
    if (this._rl) return; this._rl = requestAnimationFrame(() => {
      this._rl = 0; const l = this._live; const h2 = document.getElementById('liveHold'); if (!l || !h2) return;
      const turn = Ledger.sum(S.ledger.filter((e) => e.turnId === l.turnId)); const cu = l.usage ? costOf(l.model, l.usage, LLM.provider).total : 0;
      const stat = { wait: '생각하는 중…', stream: '작성 중…', tool: '도구 실행 중…', retry: l.note }[l.status] || '';
      h2.innerHTML = `<div class="msg ai live">${l.text ? `<div class="bubble"><div class="md">${renderMd(l.text)}</div></div>` : ''}${l.tools.length ? `<div class="tools">${l.tools.map((t) => `<div class="tcall ${t.done ? (t.err ? 'bad' : 'okk') : 'run'}"><span class="s">${t.done ? (t.err ? '✕' : '✓') : '…'}</span><span>${esc(t.name)}</span><span class="sm">${esc(t.summary || '')}</span></div>`).join('')}</div>` : ''}<div class="livestat">${esc(stat)} · 호출 ${l.iter}회째${l.usage ? ` · ${tokStr(l.usage)}` : ''} · 이번 턴 ${usd(turn.cost + cu)} <span class="krw">(${fmtKRW(turn.cost + cu)})</span></div></div>`;
      if (this.stick) this.scrollEnd();
    });
  },
  scrollEnd() { const m = document.getElementById('msgs'); if (m) m.scrollTop = m.scrollHeight; },
  // ── 입력창
  renderComposer() {
    const el = document.getElementById('composer'); if (!el) return; const c = this.cur; const prev = document.getElementById('chatInput'); const val = prev ? prev.value : '';
    const models = Object.keys(S.settings.models);
    el.innerHTML = `<div id="slashpop" class="hidden"></div><div id="inputRow"><textarea id="chatInput" rows="1" placeholder="${S.settings.enterSends ? 'Enter 전송 · Shift+Enter 줄바꿈 · / 로 스킬' : '⌘Enter 전송 · / 로 스킬'}"></textarea><button id="sendBtn" class="primary" data-act="send">전송</button></div>
      <div class="estline">${c.skill ? `<span class="skillchip" data-act="skillOff" title="눌러서 끄기">/${esc(c.skill)} ✕</span>` : '<span class="muted">스킬 없음</span>'}<select id="modelSel" title="이 대화의 모델">${S.settings.provider === 'openai' ? `<option>${esc(S.settings.openai.model)}</option>` : `<option value="">기본 (${esc((S.settings.models[S.settings.model] || {}).label || S.settings.model)})</option>` + models.map((m) => `<option value="${m}" ${c.model === m ? 'selected' : ''}>${esc(S.settings.models[m].label)}</option>`).join('')}</select><select id="effortSel" title="노력 수준(추론 강도). 자동 = 모델 기본값(Claude 는 높음). 높을수록 더 오래 생각하고 출력 토큰 비용이 늘 수 있어요.">${EFFORTS.map(([v, l]) => `<option value="${v}" ${(c.effort || '') === v ? 'selected' : ''}>노력: ${l}</option>`).join('')}</select><label><input type="checkbox" id="incDoc" ${S.ui.includeDoc ? 'checked' : ''}>열린 문서 알림</label><span id="estText"></span></div>`;
    const ta = el.querySelector('#chatInput'); ta.value = val;
    ta.addEventListener('input', () => { this.autoGrow(); this.slashUpdate(); this.renderEst(); });
    ta.addEventListener('keydown', (e) => this.onKey(e));
    el.querySelector('#modelSel').addEventListener('change', (e) => { c.model = e.target.value; Chats.save(c); this.renderEst(); });
    el.querySelector('#effortSel').addEventListener('change', (e) => { c.effort = e.target.value; Chats.save(c); });
    el.querySelector('#incDoc').addEventListener('change', (e) => { S.ui.includeDoc = e.target.checked; saveUi(); });
    this.autoGrow(); this.renderEst(); this.setBusy(S.run.busy);
  },
  autoGrow() { const ta = document.getElementById('chatInput'); if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; },
  renderEst: debounce(() => Chat._est(), 150),
  _est() {
    const el = document.getElementById('estText'); if (!el) return; const ta = document.getElementById('chatInput'); const c = this.cur;
    try {
      const e = estimatePrompt(c, ta ? ta.value : ''); const b = Budget.state();
      el.innerHTML = `입력 약 ${kfmt(e.total)} 토큰 · 예상 ${usd(e.warm ? e.costWarm : e.costCold)}${e.warm ? ' <span title="이전 호출의 캐시가 살아 있다고 가정">(캐시 적중)</span>' : ' <span title="캐시가 식었거나 첫 호출">(캐시 없음)</span>'} · <a href="#" data-act="countExact">정확히</a>${this.exact ? ` <b>${fmtN(this.exact)}</b>` : ''}${b.level !== 'ok' ? ` · <span class="${b.level === 'stop' ? 'err' : 'warn'}">예산 ${b.pct.toFixed(0)}%</span>` : ''}`;
      if (isBatchModel(e.model)) el.innerHTML += ' · <b title="Message Batches API: 토큰 단가 50%, 보통 몇 분~몇 시간(최대 24시간). 도구·파일 색인 없이 한 번에 답합니다.">배치(반값)</b>';
    } catch (er) { el.textContent = ''; }
  },
  setBusy(b) { const s = document.getElementById('sendBtn'); if (!s) return; s.textContent = b ? '중단' : '전송'; s.classList.toggle('danger', b); s.classList.toggle('primary', !b); },
  onKey(e) {
    if (e.isComposing || e.keyCode === 229) return; const ta = e.target; const mod = e.metaKey || e.ctrlKey;
    if (this.slash.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.slash.sel = (this.slash.sel + 1) % this.slash.items.length; return this.slashDraw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.slash.sel = (this.slash.sel - 1 + this.slash.items.length) % this.slash.items.length; return this.slashDraw(); }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); return this.slashPick(this.slash.sel); }
      if (e.key === 'Escape') { this.slashClose(); return; }
    }
    if (e.key === 'Enter') { const send = S.settings.enterSends ? !e.shiftKey && !e.altKey : mod; if (send) { e.preventDefault(); this.send(); } }
    else if (e.key === 'ArrowUp' && !ta.value && this.hist.length) { e.preventDefault(); this.hi = Math.min(this.hist.length - 1, this.hi + 1); ta.value = this.hist[this.hist.length - 1 - this.hi]; this.autoGrow(); }
    else if (e.key === 'Escape' && S.run.busy) stopRun();
  },
  slashUpdate() {
    const ta = document.getElementById('chatInput'); const v = ta.value; const m = v.match(/^\/(\S*)$/);
    if (!m) return this.slashClose(); const q = m[1].toLowerCase();
    const all = [...[...Skills.all().values()].map((s) => ({ name: s.name, d: s.description })), { name: '없음', d: '스킬 끄기' }, { name: '스킬', d: '스킬 목록' }, { name: '검색', d: '로컬 검색 (무료)' }, { name: '읽기', d: '문서 보기 (무료)' }, { name: '린트', d: '린트 (무료)' }, { name: '예산', d: '예산 요약 (무료)' }];
    this.slash.items = all.filter((x) => x.name.toLowerCase().includes(q)); this.slash.sel = 0; this.slash.open = this.slash.items.length > 0; this.slashDraw();
  },
  slashDraw() { const p = document.getElementById('slashpop'); if (!p) return; p.classList.toggle('hidden', !this.slash.open); p.innerHTML = this.slash.items.map((x, i) => `<div class="sp ${i === this.slash.sel ? 'on' : ''}" data-act="slashPick" data-i="${i}"><b>/${esc(x.name)}</b><span>${esc(x.d)}</span></div>`).join(''); },
  slashClose() { this.slash.open = false; const p = document.getElementById('slashpop'); if (p) p.classList.add('hidden'); },
  slashPick(i) { const it = this.slash.items[i]; if (!it) return; const ta = document.getElementById('chatInput'); ta.value = '/' + it.name + ' '; this.slashClose(); ta.focus(); this.autoGrow(); },
  docSuffix() {
    if (!S.ui.includeDoc || !Ed.file) return ''; let s = `\n\n[열린 문서: ${Ed.file.path}]`;
    if (Ed.ta && Ed.ta.selectionEnd > Ed.ta.selectionStart) { const sel = Ed.ta.value.slice(Ed.ta.selectionStart, Ed.ta.selectionEnd); if (sel.length <= 6000) s += `\n[선택한 부분]\n${sel}`; }
    return s;
  },
  async send() {
    if (S.run.busy) return stopRun(); const ta = document.getElementById('chatInput'); const text = ta.value.trim(); if (!text) return;
    const c = this.cur; this.hist.push(text); this.hi = -1; ta.value = ''; this.autoGrow(); this.slashClose(); this.stick = true; this.exact = null;
    try { await submit(c, text, { suffix: text.startsWith('/') && !/^\/[^\s]+\s+\S/.test(text) ? '' : this.docSuffix() }); } catch (e) { reportErr(e); }
    this.renderHead(); this.renderEst();
  },
};
UI.chat = (id) => { if (typeof Chat === 'undefined') return; if (!id || id === S.ui.chatId) { Chat.render(); Chat.renderHead(); } };
UI.stream = (live) => { if (typeof Chat === 'undefined') return; if (!live) { Chat._live = null; const h = document.getElementById('liveHold'); if (h) h.innerHTML = ''; return; } Chat.renderLive(live); };
UI.turn = (b) => { if (typeof Chat === 'undefined') return; Chat.setBusy(b); const bt = document.getElementById('btnSync'); if (bt) bt.disabled = false; };
ACT.send = () => Chat.send();
ACT.skillOff = () => Chat.setSkill('');
ACT.slashPick = (t) => Chat.slashPick(+t.dataset.i);
ACT.toolToggle = (t) => { const r = t.parentElement.querySelector('.tres'); if (r) r.classList.toggle('hidden'); };
ACT.codeSave = async (t) => {
  const code = t.closest('.codeblk').querySelector('code').textContent; const scene = /^##\s*본문/m.test(code);
  const p = await dlg.prompt('저장할 경로', (scene ? 'drafts/장면/' : 'drafts/') + '새 문서.md', { title: '코드 블록을 파일로' }); if (!p) return;
  const np = normPath(p); const cw = canWrite(np); if (!cw.ok && !(await dlg.confirm(`${cw.why}\n그래도 로컬에 만들까요? (직접 만드는 파일이라 규칙은 AI 에게만 적용됩니다)`))) return;
  if (FS.has(np) && !(await dlg.confirm('이미 있는 파일입니다. 덮어쓸까요?', { danger: true }))) return; await FS.apply([{ path: np, after: code }], `대화에서 저장: ${np}`); Ed.open(np);
};
ACT.countExact = async (t, e) => {
  e.preventDefault(); const c = Chat.cur; const ta = document.getElementById('chatInput'); const sk = c.skill ? Skills.find(c.skill) : null; const { blocks } = buildSystem(c); const model = (sk && sk.model) || c.model || S.settings.model;
  try { const r = await LLM.count({ model, sys: blocks, tools: toolsFor(sk), messages: [...Chats.api(c), { role: 'user', content: [{ type: 'text', text: (ta && ta.value) || '.' }] }] }); Chat.exact = r.tokens; Chat._est(); UI.toast(`정확한 입력 토큰: ${fmtN(r.tokens)}${r.approx ? ' (어림)' : ''}`); } catch (er) { UI.toast('⚠ ' + er.message, 5000); }
};
ACT.chatNew = () => { const c = Chats.create(); S.ui.chatId = c.id; saveUi(); Chat.stick = true; Chat.render(); Chat.renderHead(); Chat.renderComposer(); const i = document.getElementById('chatInput'); i && i.focus(); };
ACT.chatMore = (t) => {
  const c = Chat.cur;
  Menu.at(t, [
    { label: '이름 바꾸기', fn: async () => { const n = await dlg.prompt('대화 이름', c.title, { title: '이름 바꾸기' }); if (n) { Chats.rename(c, n); Chat.renderHead(); } } },
    { label: '마지막 질문 수정 (되돌려서 다시 쓰기)', fn: () => { if (S.run.busy) return; const r = Chats.popLastTurn(c); if (!r) return UI.toast('되돌릴 턴이 없음'); const txt = (r[0].content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'); Chat.render(); const i = document.getElementById('chatInput'); i.value = txt; Chat.autoGrow(); i.focus(); UI.toast('이미 쓴 토큰 비용은 장부에 남아 있습니다'); } },
    { label: '이 대화 내보내기 (.md)', fn: () => downloadText(`${c.title}.md`, chatToMd(c)) },
    { label: '이 대화의 비용 보기', fn: () => BudgetUI.open({ chat: c.id }) }, '-',
    { label: '대화 삭제', danger: true, fn: async () => { if (!(await dlg.confirm(`"${c.title}" 대화를 삭제할까요? (비용 기록은 장부에 남습니다)`, { danger: true, ok: '삭제' }))) return; await Chats.remove(c.id); S.ui.chatId = (S.chats[0] || {}).id; saveUi(); Chat.render(); Chat.renderHead(); Chat.renderComposer(); } },
  ]);
};
function chatToMd(c) {
  const out = [`# ${c.title}`, ''];
  for (const m of c.messages) {
    if (m.local) { out.push(m.role === 'user' ? `**나**: ${m.md}` : `> ${m.md}`, ''); continue; } if (m.toolResults) continue;
    const t = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n'); const uses = m.content.filter((b) => b.type === 'tool_use');
    if (t) out.push(m.role === 'user' ? `**나**: ${t}` : t, ''); if (uses.length) out.push(uses.map((u) => `- 🔧 ${u.name} ${toolSummary(u)}`).join('\n'), '');
  }
  return out.join('\n');
}
ACT.batchCheck = async (t) => { const j = Batch.find(t.dataset.cid); if (!j) return; UI.toast('확인 중…', 1200); const st = await Batch.check(j); if (st === 'submitted') UI.toast(j.lastErr && j.checked ? '⚠ ' + j.lastErr : '아직 처리 중이에요.'); };
ACT.batchCancel = async (t) => { if (await dlg.confirm('이 배치를 취소할까요? (이미 처리된 부분이 있으면 요금이 일부 붙을 수 있어요)', { ok: '취소 요청' })) await Batch.cancel(t.dataset.cid); };
ACT.batchRetry = (t) => Batch.retry(t.dataset.cid);
ACT.batchDrop = (t) => Batch.drop(t.dataset.cid);
