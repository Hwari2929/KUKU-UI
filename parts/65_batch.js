/* ═══════════ 65 · Anthropic 배치 (Message Batches API) ═══════════
   모델 목록에서 "… 배치" 를 고르고 보내면 스트리밍 대신 배치로 접수한다. (토큰 단가 50%, 보통 몇 분~몇 시간, 최대 24시간)
   - 한 번에 끝나는 요청만: 도구(파일 읽기/쓰기)·파일 색인 없이, 대화에 들어온 내용만으로 답한다.
   - 접수 정보는 이 기기에 저장돼서 앱을 닫았다 열어도 이어서 확인한다. 끝나면 대화에 답이 붙고 장부에 반값으로 기록된다. */
const BATCH_NOTE = '\n\n[배치 모드] 이 요청은 한 번에 처리됩니다. 도구(파일 검색·읽기·쓰기)를 쓸 수 없으니, 이 대화에 들어 있는 내용만으로 완결된 답을 쓰세요. 필요한 문서가 대화에 없으면 없다고 밝히고, 추측으로 설정을 지어내지 마세요.';

// 도구 호출/결과 블록을 걷어내고 글만 남긴다 (tools 없이는 tool_use/tool_result 블록을 보낼 수 없음). 같은 역할이 이어지면 합친다.
function batchMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.local) continue;
    const text = (m.content || []).filter((b) => b.type === 'text' && b.text && String(b.text).trim()).map((b) => b.text).join('\n\n'); if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content[0].text += '\n\n' + text; else out.push({ role: m.role, content: [{ type: 'text', text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
const newBatchCid = () => 'ertes_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const Batch = {
  _t: null, busy: new Set(),
  async load() { S.batches = (await DB.get('meta', 'batches')) || []; },
  save() { return DB.put('meta', 'batches', S.batches); },
  url() { return S.settings.anthropicBase.replace(/\/+$/, '') + '/v1/messages/batches'; },
  find(cid) { return S.batches.find((j) => j.cid === cid) || null; },
  pending() { return S.batches.filter((j) => j.status === 'submitted'); },
  async _post(path, body) {
    return postWithRetry(this.url() + path, { method: 'POST', headers: anthropicHeaders(), body: body ? JSON.stringify(body) : undefined }, { retries: 2 });
  },
  async _get(path, ms = 30000) {
    let res; try { res = await fetchT(this.url() + path, { headers: anthropicHeaders() }, ms); } catch (e) { throw new ApiError(`네트워크 오류: ${e && e.message || e}`, { kind: 'network' }); }
    if (!res.ok) { let type = '', msg = ''; try { const j = await res.json(); type = j.error && j.error.type; msg = j.error && j.error.message; } catch (e) {} throw new ApiError(friendlyApiError(res.status, type, msg), { status: res.status, kind: 'http' }); }
    return res;
  },
  // 대화 한 턴을 배치로 접수
  async send(chat, text, key) {
    const turnId = uid('t'), label = text.replace(/\s+/g, ' ').slice(0, 60);
    chat.messages.push({ role: 'user', content: [{ type: 'text', text }], ts: Date.now() });
    if (chat.title === '새 대화') chat.title = label.slice(0, 30) || chat.title;
    Chats.save(chat); UI.chat(chat.id);
    try {
      if (!S.secrets.apiKey) throw new ApiError('Anthropic API 키가 없습니다 (설정 → API).', { kind: 'nokey' });
      const { blocks } = buildSystem(chat);
      const sys = blocks.filter((b) => !/^\[파일 색인/.test(b.text)).map((b, i) => ({ text: b.text + (i === 0 ? BATCH_NOTE : ''), cache: false }));
      const messages = batchMessages(Chats.api(chat));
      const inEst = estTokens(sys.map((b) => b.text).join('\n')) + msgTokens(messages);
      const ctxMax = modelInfo(key).ctx || 200000;
      if (inEst > ctxMax * 0.92) { addLocal(chat, `대화가 모델 한도(${fmtN(ctxMax)} 토큰)에 가까워 접수하지 않았습니다. 새 대화를 시작하세요.`, 'error'); return { stop: 'ctx' }; }
      const pre = Budget.precheck(estimateCost(key, inEst, 0, Math.min(4000, S.settings.maxTokens))); if (!pre.ok) { addLocal(chat, '⛔ ' + pre.msg, 'error'); return { stop: 'budget' }; }
      const params = buildBody({ model: apiModel(key), sys, tools: [], messages, maxTokens: S.settings.maxTokens, temperature: S.settings.temperature, stream: false, cacheTail: false, effort: effortOf(chat) }); delete params.stream;
      const cid = newBatchCid();
      const res = await this._post('', { requests: [{ custom_id: cid, params }] }); const j = await res.json();
      const job = { id: j.id, cid, chatId: chat.id, turnId, label, key, ts: Date.now(), status: 'submitted', pstatus: j.processing_status || 'in_progress', params, checked: 0, err: '' };
      S.batches.push(job); await this.save();
      chat.messages.push({ role: 'assistant', local: true, kind: 'batch', cid, md: '배치 접수됨', ts: Date.now(), content: [] }); Chats.save(chat); UI.chat(chat.id);
      this.arm(); return { stop: 'batch', batchId: j.id, turnId, cid };
    } catch (e) { addLocal(chat, '⚠ 배치 접수 실패: ' + (e.message || e), 'error'); return { stop: 'error', error: e.message }; }
  },
  // ── 확인 (끝났는지 보고, 끝났으면 결과를 가져와 대화에 붙임)
  async check(j) {
    if (!j || j.status !== 'submitted' || this.busy.has(j.cid)) return j && j.status;
    this.busy.add(j.cid);
    try {
      const info = await (await this._get('/' + encodeURIComponent(j.id))).json();
      j.pstatus = info.processing_status; j.counts = info.request_counts || null; j.checked = Date.now(); j.err = '';
      if (info.processing_status === 'ended') {
        const txt = await (await this._get('/' + encodeURIComponent(j.id) + '/results', 60000)).text();
        let row = null; for (const ln of txt.split(/\r?\n/)) { if (!ln.trim()) continue; let o; try { o = JSON.parse(ln); } catch (e) { continue; } if (o.custom_id === j.cid) { row = o; break; } }
        await this.settle(j, row);
      }
    } catch (e) {
      j.checked = Date.now(); j.lastErr = e.message || String(e);
      if (e.status === 404) { j.status = 'failed'; j.err = '서버에서 이 배치를 찾을 수 없습니다 (보관 기간이 지났거나 다른 키로 보낸 요청).'; }
    } finally { this.busy.delete(j.cid); await this.save(); UI.chat(j.chatId); }
    return j.status;
  },
  async settle(j, row) {
    if (j.status === 'imported') return;
    const r = (row && row.result) || {};
    if (r.type === 'succeeded') {
      const msg = r.message || {}; const usage = normUsage(msg.usage, '5m');
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const le = await Ledger.add({ chatId: j.chatId, turnId: j.turnId, label: j.label, iter: 1, model: j.key, provider: 'anthropic', usage, stop: msg.stop_reason, kind: 'batch' });
      j.status = 'imported'; j.cost = le.cost; j.done = Date.now(); delete j.params;
      const chat = Chats.get(j.chatId);
      if (chat) {
        chat.messages = chat.messages.filter((m) => !(m.kind === 'batch' && m.cid === j.cid));
        chat.messages.push({ role: 'assistant', content: [{ type: 'text', text: text || '(빈 응답)' }], ts: Date.now(), meta: { turnId: j.turnId, iter: 1, model: j.key, usage, cost: le.cost, stop: msg.stop_reason, batch: true } });
        if (msg.stop_reason === 'max_tokens') chat.messages.push({ role: 'assistant', local: true, kind: 'notice', md: `출력 한도(${fmtN(S.settings.maxTokens)} 토큰)에서 답이 잘렸습니다.`, ts: Date.now(), content: [] });
        Chats.save(chat);
      }
      UI.toast(`✓ 배치 완료: ${j.label.slice(0, 24)} (${fmtUSD(le.cost)})`, 5000); UI.budget();
    } else {
      j.status = 'failed'; j.done = Date.now();
      j.err = r.type === 'errored' ? ((r.error && (r.error.error && r.error.error.message || r.error.message)) || '처리 중 오류') : r.type === 'expired' ? '24시간 안에 처리되지 못해 만료됨' : r.type === 'canceled' ? '취소됨' : '결과를 찾지 못함';
      UI.toast('⚠ 배치 실패: ' + j.err, 6000);
    }
  },
  async tick() {
    const list = this.pending(); if (!list.length) return this.stop();
    for (const j of list) await this.check(j);
    if (!this.pending().length) this.stop();
  },
  arm() { if (this._t || typeof setInterval !== 'function') return; this._t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') this.tick().catch(() => {}); }, 60000); },
  stop() { if (this._t) { clearInterval(this._t); this._t = null; } },
  async cancel(cid) { const j = this.find(cid); if (!j || j.status !== 'submitted') return; await this._post('/' + encodeURIComponent(j.id) + '/cancel'); j.pstatus = 'canceling'; await this.save(); UI.chat(j.chatId); UI.toast('취소를 요청했어요. 곧 결과가 "취소됨" 으로 바뀝니다.'); },
  async retry(cid) {
    const j = this.find(cid); if (!j || j.status !== 'failed') return; if (!j.params) return UI.toast('다시 보낼 내용이 남아 있지 않아요. 새로 보내 주세요.');
    const pre = Budget.precheck(0); if (!pre.ok) return UI.toast(pre.msg, 5000);
    const ncid = newBatchCid(); const res = await this._post('', { requests: [{ custom_id: ncid, params: j.params }] }); const r = await res.json();
    const chat = Chats.get(j.chatId); if (chat) for (const m of chat.messages) if (m.kind === 'batch' && m.cid === j.cid) m.cid = ncid;
    Object.assign(j, { id: r.id, cid: ncid, ts: Date.now(), status: 'submitted', pstatus: r.processing_status || 'in_progress', err: '', checked: 0 });
    await this.save(); if (chat) Chats.save(chat); UI.chat(j.chatId); this.arm(); UI.toast('다시 접수했어요.');
  },
  async drop(cid) {
    const j = this.find(cid); if (!j) return; S.batches = S.batches.filter((x) => x !== j); await this.save();
    const chat = Chats.get(j.chatId); if (chat) { chat.messages = chat.messages.filter((m) => !(m.kind === 'batch' && m.cid === cid)); Chats.save(chat); } UI.chat(j.chatId);
  },
  // ── 대화창 카드
  card(m) {
    const j = this.find(m.cid); const wrap = (cls, body) => `<div class="msg ai local ${cls}"><div class="bubble"><div class="md">${body}</div></div></div>`;
    if (!j) return wrap('notice', renderMd(m.md || ''));
    const label = esc((modelInfo(j.key).label || j.key));
    const age = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 60000)); return s < 1 ? '방금' : s < 60 ? `${s}분 전` : `${Math.floor(s / 60)}시간 ${s % 60}분 전`; };
    if (j.status === 'failed') return wrap('error', `<p>⚠ <b>배치 실패</b> — ${esc(j.err)}<br><span class="muted">실패·만료된 요청에는 요금이 붙지 않아요.</span></p><div class="inl"><button class="sm" data-act="batchRetry" data-cid="${esc(j.cid)}">다시 보내기</button><button class="sm ghost" data-act="batchDrop" data-cid="${esc(j.cid)}">지우기</button></div>`);
    const cn = j.counts ? ` · 처리 중 ${j.counts.processing || 0} / 완료 ${j.counts.succeeded || 0}` : '';
    return wrap('notice', `<p>⏳ <b>배치 처리 중</b> — ${label}${j.pstatus === 'canceling' ? ' (취소 요청됨)' : ''}<br><span class="muted">${age(j.ts)} 접수${cn} · ${j.checked ? '마지막 확인 ' + age(j.checked) : '아직 확인 전'}. 끝나면 이 자리에 답이 붙어요. 앱을 닫았다 열어도 이어서 확인합니다.</span>${j.lastErr && j.checked ? `<br><span class="warn">확인 중 오류: ${esc(j.lastErr)}</span>` : ''}</p><div class="inl"><button class="sm" data-act="batchCheck" data-cid="${esc(j.cid)}">지금 확인</button>${j.pstatus === 'canceling' ? '' : `<button class="sm ghost" data-act="batchCancel" data-cid="${esc(j.cid)}">취소</button>`}</div>`);
  },
};
