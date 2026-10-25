/* ═══════════ 60 · 대화 저장 · 에이전트 턴 루프 ═══════════ */
const Chats = {
  async load() { S.chats = (await DB.all('chats')).sort((a, b) => b.updated - a.updated); for (const c of S.chats) if (c.model && !S.settings.models[c.model]) c.model = ''; },   // 지워진 모델(Fable 등)은 기본값으로
  get(id) { return S.chats.find((c) => c.id === id) || null; },
  create(title = '새 대화') {
    const c = { id: uid('c'), title, created: Date.now(), updated: Date.now(), skill: '', model: '', effort: '', messages: [] };
    S.chats.unshift(c); this.save(c); return c;
  },
  save(c) { c.updated = Date.now(); return DB.put('chats', c.id, c); },
  async remove(id) { S.chats = S.chats.filter((c) => c.id !== id); await DB.del('chats', id); },
  rename(c, t) { c.title = t.trim().slice(0, 60) || c.title; this.save(c); },
  // API 로 보낼 메시지만 (로컬 안내문 제외)
  api(c) { return c.messages.filter((m) => !m.local); },
  popLastTurn(c) {   // 마지막 사용자 입력과 그 뒤 응답을 지움
    let i = c.messages.length - 1; while (i >= 0 && !(c.messages[i].role === 'user' && !c.messages[i].toolResults && !c.messages[i].local)) i--;
    if (i < 0) return null; const removed = c.messages.splice(i); this.save(c); return removed;
  },
  /* ── 질문·답변 고치기 / 지우기 / 다시 생성 ──
     한 "턴" = 질문(user, 도구 결과 아님) + 그 뒤 응답들(assistant·도구 결과·안내) — 다음 질문 직전까지.
     다시 생성하면 원래 응답 묶음은 질문 메시지의 vers 에 보관되고(vi = 지금 보이는 것의 번호, 보이는 쪽은 null), 새 응답이 messages 에 붙는다. */
  isBoundary(m) { return !!m && m.role === 'user' && !m.toolResults; },
  textOf(m) { return (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(m.role === 'user' ? '\n' : '\n\n'); },
  turnAt(c, i) {
    let s = Math.min(i, c.messages.length - 1); while (s >= 0 && !this.isBoundary(c.messages[s])) s--;
    if (s < 0) return null; let e = s + 1; while (e < c.messages.length && !this.isBoundary(c.messages[e])) e++;
    return { inp: s, from: s + 1, to: e, real: isUserInput(c.messages[s]) };
  },
  lastTurn(c) {   // 맨 끝 턴이 진짜 질문으로 시작할 때만
    let s = c.messages.length - 1; while (s >= 0 && !this.isBoundary(c.messages[s])) s--;
    return s >= 0 && isUserInput(c.messages[s]) ? this.turnAt(c, s) : null;
  },
  // 질문(user)·답변(assistant)의 글만 바꾼다. 도구 호출 블록 등은 그대로 둔다.
  editText(c, i, text) {
    const m = c.messages[i]; text = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    if (!m || m.local || m.toolResults || !text.trim()) return false;
    const out = []; let placed = false;
    for (const b of m.content || []) { if (b.type === 'text') { if (!placed) { out.push({ type: 'text', text }); placed = true; } } else out.push(b); }
    if (!placed) return false;
    m.content = out; m.edited = true; this.save(c); return true;
  },
  deleteTurn(c, i) {   // 질문 + 모든 응답
    const t = this.turnAt(c, i); if (!t) return false; c.messages.splice(t.inp, t.to - t.inp); this.save(c); return true;
  },
  deleteReply(c, i) {   // 응답만 (질문은 남김). 마지막 턴에 다른 버전이 보관돼 있으면 그중 하나가 대신 나타난다.
    const t = this.turnAt(c, i); if (!t) return false; const inp = c.messages[t.inp]; const last = this.lastTurn(c); const isLast = !!last && last.inp === t.inp;
    c.messages.splice(t.from, t.to - t.from);
    if (inp.vers) {
      if (isLast) { inp.vers.splice(inp.vi, 1); if (inp.vers.length) { const k = Math.min(inp.vi, inp.vers.length - 1); const g = inp.vers[k] || []; inp.vers[k] = null; inp.vi = k; c.messages.push(...g); } this.tidyVers(inp); }
      else { delete inp.vers; delete inp.vi; }   // 중간 턴은 다른 버전으로 바꿔 끼울 수 없으니 보관본도 버린다
    }
    this.save(c); return true;
  },
  tidyVers(inp) { if (inp.vers && inp.vers.length < 2) { delete inp.vers; delete inp.vi; } },
  // 마지막 턴의 응답을 치우고 보관한다 → 이어서 runTurn/Batch.send 를 reuse 로 부르면 새 응답이 붙는다. 반환: 질문 글.
  startReroll(c) {
    const t = this.lastTurn(c); if (!t) return null; const inp = c.messages[t.inp]; const text = this.textOf(inp);
    const group = c.messages.splice(t.from, t.to - t.from);
    if (group.length) {
      if (!inp.vers) inp.vers = [group]; else inp.vers[inp.vi] = group;
      inp.vers.push(null); inp.vi = inp.vers.length - 1;
    }
    this.save(c); return text;
  },
  // 보관된 다른 응답으로 바꿔 보기 (마지막 턴에서만)
  switchVer(c, k) {
    const t = this.lastTurn(c); if (!t) return false; const inp = c.messages[t.inp];
    if (!inp.vers || k < 0 || k >= inp.vers.length || k === inp.vi || !inp.vers[k]) return false;
    inp.vers[inp.vi] = c.messages.splice(t.from); const nxt = inp.vers[k]; inp.vers[k] = null; inp.vi = k; c.messages.push(...nxt);
    this.save(c); return true;
  },
};
const isUserInput = (m) => m.role === 'user' && !m.local && !m.toolResults;
function addLocal(chat, md, kind = 'notice') { chat.messages.push({ role: 'assistant', local: true, kind, md, ts: Date.now(), content: [] }); Chats.save(chat); UI.chat(chat.id); }

/* ── 긴 대화 정리: 임계 토큰을 넘을 때만, 오래된 도구 결과·긴 쓰기 내용을 짧은 표시로 바꿔 저장한다.
   (매 턴 조금씩 바꾸면 캐시가 매번 깨지므로, 넘었을 때 한꺼번에 정리해서 한동안 안 깨지게 한다) */
function msgTokens(msgs) { return estTokens(JSON.stringify(msgs.map((m) => m.content))); }
function compactHistory(chat) {
  const keep = Math.max(1, S.settings.keepToolTurns), limit = S.settings.trimAboveTokens;
  if (!limit || msgTokens(Chats.api(chat)) <= limit) return 0;
  const idx = []; chat.messages.forEach((m, i) => { if (isUserInput(m)) idx.push(i); });
  if (idx.length <= keep) return 0; const cut = idx[idx.length - keep]; let saved = 0;
  for (let i = 0; i < cut; i++) {
    const m = chat.messages[i]; if (m.local || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 300 && !b.trimmed) { saved += b.content.length; b.content = `(이전 도구 결과 생략: ${b.content.length}자 — 필요하면 다시 read_note)`; b.trimmed = true; }
      else if (b.type === 'tool_use' && b.input && !b.trimmed) {
        for (const k of ['content', 'new', 'old']) if (typeof b.input[k] === 'string' && b.input[k].length > 400) { saved += b.input[k].length; b.input[k] = `(생략 ${b.input[k].length}자)`; b.trimmed = true; }
      }
    }
  }
  if (saved) Chats.save(chat);
  return saved;
}

/* ── 호출 전 어림 (입력창 아래 표시용) ── */
function estimatePrompt(chat, text) {
  const { blocks, skill } = buildSystem(chat); const model = (skill && skill.model) || chat.model || LLM.modelId;
  const isB = isBatchModel(model); const tools = isB ? [] : toolsFor(skill); const msgs = Chats.api(chat);
  const sysT = estTokens(blocks.map((b) => b.text).join('\n')), toolT = estTokens(JSON.stringify(tools)), hist = msgTokens(msgs), cur = estTokens(text || '');
  const total = sysT + toolT + hist + cur;
  const last = [...S.ledger].reverse().find((e) => e.chatId === chat.id);
  const ttlMs = (S.settings.cacheTTL === '1h' ? 3600 : 300) * 1000;
  const warm = !isB && last && Date.now() - last.ts < ttlMs;
  const cached = warm ? Math.min(total - cur, last.usage.input + last.usage.cacheRead + last.usage.cw5 + last.usage.cw1h) : 0;
  return { model, total, sys: sysT, tools: toolT, hist, cur, cached, warm: !!warm, costCold: estimateCost(model, total, 0, 0), costWarm: estimateCost(model, total, cached, 0), ctx: (S.settings.models[model] || {}).ctx || 200000 };
}

/* ── 한 턴 실행: 사용자 입력 → (모델 호출 ↔ 도구 실행)* → 최종 답 ── */
async function runTurn(chat, text, { signal, reuse = false } = {}) {
  if (S.run.busy) throw new Error('이미 실행 중');
  const ac = new AbortController(); S.run = { busy: true, abort: ac, chatId: chat.id };
  const turnId = uid('t'); const label = text.replace(/\s+/g, ' ').slice(0, 60);
  const st = { turnId, cost: 0, iters: 0, usage: zeroUsage(), stop: '' };
  if (!reuse) {   // 다시 생성이면 질문은 이미 대화에 있다
    chat.messages.push({ role: 'user', content: [{ type: 'text', text }], ts: Date.now() });
    if (chat.title === '새 대화') chat.title = label.slice(0, 30) || chat.title;
  }
  Chats.save(chat); UI.turn(true); UI.chat(chat.id);
  const live = { chatId: chat.id, turnId, model: '', text: '', tools: [], iter: 0, status: 'wait', note: '', usage: null };
  const push = () => UI.stream(live);
  try {
    const { blocks, skill } = buildSystem(chat);   // 이 턴 동안 고정 → 도구로 파일이 바뀌어도 캐시가 깨지지 않음
    const model = LLM.provider === 'openai' ? S.settings.openai.model : ((skill && skill.model) || chat.model || S.settings.model);
    live.model = model; const tools = toolsFor(skill); const sysTok = estTokens(blocks.map((b) => b.text).join('\n')) + estTokens(JSON.stringify(tools));
    const ctxMax = ((S.settings.models[model] || {}).ctx) || 200000;
    for (let iter = 1; iter <= S.settings.maxIters; iter++) {
      if (ac.signal.aborted) throw new ApiError('중단됨', { kind: 'abort' });
      compactHistory(chat);
      const msgs = Chats.api(chat); const inEst = sysTok + msgTokens(msgs);
      if (inEst > ctxMax * 0.92) { addLocal(chat, `대화가 모델 한도(${fmtN(ctxMax)} 토큰)에 가까워 중단했습니다. 새 대화를 시작하세요. (/요약 으로 먼저 정리할 수 있습니다)`, 'error'); st.stop = 'ctx'; break; }
      const worst = estimateCost(model, inEst, 0, Math.min(2000, S.settings.maxTokens));
      // OpenAI 호환은 Anthropic 크레딧과 무관 → 크레딧 검사는 건너뜀 (한 턴 비용 상한만 적용)
      const pre = LLM.provider === 'openai' ? { ok: true, level: 'ok', msg: '' } : Budget.precheck(worst); if (!pre.ok) { addLocal(chat, '⛔ ' + pre.msg, 'error'); st.stop = 'budget'; break; }
      if (st.cost >= S.settings.budget.turnCapUSD && iter > 1) { addLocal(chat, `⏸ 이번 턴 비용이 한도 ${fmtUSD(S.settings.budget.turnCapUSD)}에 도달해 멈췄습니다 (${fmtUSD(st.cost)}). 계속하려면 "계속" 이라고 보내거나 설정에서 한도를 올리세요.`, 'notice'); st.stop = 'turncap'; break; }
      live.iter = iter; live.text = ''; live.status = 'wait'; live.note = ''; live.usage = null; live.tools = live.tools.filter((t) => t.done); push();
      let r;
      try {
        r = await LLM.stream({ model, sys: blocks, tools, messages: msgs, maxTokens: S.settings.maxTokens, temperature: S.settings.temperature, ttl: S.settings.cacheTTL, effort: effortOf(chat) },
          { signal: ac.signal,
            onText: (d, full) => { live.text = full; live.status = 'stream'; push(); },
            onToolStart: (b) => { live.tools.push({ name: b.name, done: false, summary: '' }); live.status = 'tool'; push(); },
            onUsage: (u) => { live.usage = u; push(); },
            onRetry: (n, d, m) => { live.status = 'retry'; live.note = `${m} — ${Math.round(d / 1000)}초 뒤 재시도(${n})`; push(); } });
      } catch (e) {
        if (e.partial) {
          const pu = e.partial.usage; if (pu.input || pu.output || pu.cacheRead || pu.cw5 || pu.cw1h) {
            const le = await Ledger.add({ chatId: chat.id, turnId, label, iter, model, provider: LLM.provider, usage: pu, partial: true, stop: e.kind || 'error' });
            st.cost += le.cost; st.usage = addUsage(st.usage, pu); st.iters++;
          }
          const txt = (e.partial.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          if (txt.trim()) chat.messages.push({ role: 'assistant', content: [{ type: 'text', text: txt }], ts: Date.now(), meta: { turnId, iter, model, partial: true } });
        }
        throw e;
      }
      const names = r.content.filter((b) => b.type === 'tool_use').map((b) => b.name);
      const le = await Ledger.add({ chatId: chat.id, turnId, label, iter, model: r.model || model, provider: LLM.provider, usage: r.usage, stop: r.stop_reason, tools: names });
      st.cost += le.cost; st.usage = addUsage(st.usage, r.usage); st.iters++;
      chat.messages.push({ role: 'assistant', content: r.content, ts: Date.now(), meta: { turnId, iter, model: r.model || model, usage: r.usage, cost: le.cost, ms: r.ms, stop: r.stop_reason, guess: le.guess } });
      Chats.save(chat); UI.chat(chat.id);
      const uses = r.content.filter((b) => b.type === 'tool_use');
      if (r.stop_reason === 'max_tokens' && !uses.length) { addLocal(chat, `출력 한도(${fmtN(S.settings.maxTokens)} 토큰)에서 답이 잘렸습니다. "이어서" 라고 보내거나 설정에서 한도를 올리세요.`, 'notice'); st.stop = 'max_tokens'; break; }
      if (!uses.length) { st.stop = r.stop_reason; break; }
      const results = [];
      for (const u of uses) {
        const t = live.tools.find((x) => x.name === u.name && !x.done) || (live.tools.push({ name: u.name, done: false, summary: '' }), live.tools[live.tools.length - 1]);
        t.summary = toolSummary(u); live.status = 'tool'; push();
        let res;
        if (u.parseError || r.stop_reason === 'max_tokens') res = { content: '도구 입력(JSON)을 해석하지 못했거나 출력 한도에서 잘렸습니다. 입력을 더 짧게 해서 다시 호출하세요.', is_error: true };
        else res = await runTool(u.name, u.input, { chatId: chat.id });
        t.done = true; t.err = !!res.is_error; results.push({ type: 'tool_result', tool_use_id: u.id, content: res.content, ...(res.is_error ? { is_error: true } : {}) });
      }
      chat.messages.push({ role: 'user', content: results, toolResults: true, ts: Date.now() });
      Chats.save(chat); UI.chat(chat.id);
      if (iter === S.settings.maxIters) { addLocal(chat, `도구 호출 한도(${S.settings.maxIters}회)에 도달해 멈췄습니다. "계속" 이라고 보내면 이어서 합니다.`, 'notice'); st.stop = 'iters'; }
    }
  } catch (e) {
    if (e.kind === 'abort') { addLocal(chat, '⏹ 중단됨 (이미 받은 토큰 비용은 장부에 기록됨)', 'notice'); st.stop = 'abort'; }
    else { addLocal(chat, '⚠ ' + (e.message || e), 'error'); st.stop = 'error'; st.error = e.message; }
  } finally {
    // 도구 호출만 있고 결과가 없는 상태로 끝나면 다음 요청이 거부되므로 정리
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === 'assistant' && !last.local && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) {
      chat.messages.push({ role: 'user', content: last.content.filter((b) => b.type === 'tool_use').map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: '실행되지 않음', is_error: true })), toolResults: true, ts: Date.now() });
    }
    S.run = { busy: false, abort: null, chatId: null }; live.status = 'idle'; Chats.save(chat); UI.turn(false); UI.stream(null); UI.chat(chat.id); UI.budget();
  }
  return st;
}
function toolSummary(u) {
  const i = u.input || {};
  switch (u.name) {
    case 'search': return `"${i.query || ''}"${i.folder ? ' in ' + i.folder : ''}`;
    case 'read_note': return `${i.name || ''}${i.section ? ' § ' + i.section : ''}${i.offset ? ' @' + i.offset : ''}`;
    case 'list_notes': return i.folder || '/';
    case 'write_note': return `${i.path || ''} (${kfmt((i.content || '').length)}자)`;
    case 'edit_note': return `${i.path || ''}`;
    case 'lint': return i.path || '(텍스트)';
    default: return '';
  }
}
function stopRun() { if (S.run.abort) S.run.abort.abort(); }

/* ── 입력 처리: 슬래시 명령 → 로컬 처리 또는 턴 실행 ── */
async function submit(chat, raw, { suffix = '' } = {}) {
  const text = raw.trim(); if (!text) return null;
  if (S.run.busy) { UI.toast('이전 응답이 끝난 뒤에 보내세요'); return null; }
  const sl = text.startsWith('/') ? parseSlash(text, chat) : null;
  if (sl && sl.kind === 'local') { chat.messages.push({ role: 'user', local: true, content: [], md: text, ts: Date.now() }); addLocal(chat, sl.md, 'cmd'); return { local: true }; }
  let body = text;
  if (sl && sl.kind === 'skill') {
    chat.skill = sl.skill; Chats.save(chat); UI.chat(chat.id);
    if (!sl.rest) { addLocal(chat, sl.note, 'notice'); return { local: true }; }
    body = sl.rest; addLocal(chat, sl.note, 'notice');
  }
  if (LLM.provider !== 'openai') {   // 배치 모델이 골라져 있으면 스트리밍 대신 배치로 접수
    const sk = chat.skill ? Skills.find(chat.skill) : null; const model = (sk && sk.model) || chat.model || S.settings.model;
    if (isBatchModel(model)) return Batch.send(chat, body + suffix, model);
  }
  return runTurn(chat, body + suffix);
}

/* ── 마지막 질문을 같은 맥락·같은 입력으로 다시 받기 (지금 응답은 보관) ── */
function chatLocked(chat) {
  if (S.run.busy) return '이전 응답이 끝난 뒤에 눌러 주세요.';
  if (typeof Batch !== 'undefined' && Batch.pending().some((j) => j.chatId === chat.id)) return '배치 처리 중에는 이 대화를 고칠 수 없어요. 끝나거나 취소한 뒤에 하세요.';
  return '';
}
async function regenerate(chat) {
  const lock = chatLocked(chat); if (lock) { UI.toast(lock); return null; }
  if (!Chats.lastTurn(chat)) { UI.toast('다시 생성할 마지막 질문이 없어요.'); return null; }
  const text = Chats.startReroll(chat); UI.chat(chat.id);
  if (LLM.provider !== 'openai') {
    const sk = chat.skill ? Skills.find(chat.skill) : null; const model = (sk && sk.model) || chat.model || S.settings.model;
    if (isBatchModel(model)) return Batch.send(chat, text, model, { reuse: true });
  }
  return runTurn(chat, text, { reuse: true });
}
