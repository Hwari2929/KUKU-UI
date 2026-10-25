/* ═══════════ 40 · LLM 클라이언트 (Anthropic SSE · OpenAI 호환) · 비용 계산 · 장부 · 예산 ═══════════ */
const PRICE_VERIFIED = '2026-10-25';

/* ── 오류 ── */
class ApiError extends Error {
  constructor(msg, o = {}) { super(msg); this.name = 'ApiError'; Object.assign(this, o); }
}
function friendlyApiError(status, type, msg) {
  const m = String(msg || '');
  if (/credit balance|billing|insufficient/i.test(m)) return `크레딧 잔액 부족 또는 결제 문제: ${m} — 콘솔(Billing)에서 잔액을 확인하세요.`;
  if (status === 401) return `API 키가 올바르지 않음 (401): ${m}`;
  if (status === 403) return `권한 없음 (403): ${m}`;
  if (status === 404) return `모델 또는 주소를 찾을 수 없음 (404): ${m} — 설정에서 모델 이름을 확인하세요.`;
  if (status === 413) return `요청이 너무 큼 (413): 대화/색인이 한도를 넘음 — 새 대화를 시작하거나 색인을 끄세요.`;
  if (status === 429) return `호출 한도 초과 (429): ${m}`;
  if (status === 529 || type === 'overloaded_error') return `서버가 혼잡함 (529): 잠시 뒤 다시 시도하세요.`;
  if (status === 400) return `요청 오류 (400): ${m}`;
  return `API 오류 ${status || ''} ${type || ''}: ${m}`;
}

/* ── 가격 · 비용 ── */
function priceFor(model, promptTokens = 0) {
  const M = S.settings.models || {};
  let key = M[model] ? model : Object.keys(M).filter((k) => String(model).startsWith(k)).sort((a, b) => b.length - a.length)[0];
  let p = key ? M[key] : null, guess = false;
  if (!p) { guess = true; p = Object.values(M).sort((a, b) => b.out - a.out)[0] || { in: 10, out: 50, cw5: 12.5, cw1h: 20, cr: 0.25 }; }   // 모르는 모델은 가장 비싼 값으로 보수적으로 계산
  if (p.tier && promptTokens > p.tier.over) p = { ...p, ...p.tier };
  return { p, key, guess };
}
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cw5: 0, cw1h: 0 });
const addUsage = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cw5: a.cw5 + b.cw5, cw1h: a.cw1h + b.cw1h });
function costOf(model, u, provider = 'anthropic') {
  const sc = S.settings.budget.costScale || 1, K = 1e-6;
  if (provider === 'openai') {
    const o = S.settings.openai; const ci = (o.in || 0), co = (o.out || 0), cc = (o.cr != null && o.cr !== '' ? +o.cr : ci * 0.5);
    const c = { in: u.input * ci * K * sc, cw5: 0, cw1h: 0, cr: u.cacheRead * cc * K * sc, out: u.output * co * K * sc }; c.total = c.in + c.cr + c.out; c.guess = !(ci || co);
    if (typeof u.extCost === 'number' && u.extCost >= 0) {   // OpenRouter 가 알려준 실제 청구액이 있으면 그것을 기준으로 (항목별 비율만 단가표로 나눔)
      const t = c.total; if (t > 0) { const f = u.extCost / t; c.in *= f; c.cr *= f; c.out *= f; } else { c.in = 0; c.cr = 0; c.out = u.extCost; }
      c.total = u.extCost; c.guess = false;
    }
    return c;
  }
  const prompt = u.input + u.cacheRead + u.cw5 + u.cw1h;
  const { p, guess } = priceFor(model, prompt);
  const c = { in: u.input * p.in * K * sc, cw5: u.cw5 * p.cw5 * K * sc, cw1h: u.cw1h * p.cw1h * K * sc, cr: u.cacheRead * p.cr * K * sc, out: u.output * p.out * K * sc };
  c.total = c.in + c.cw5 + c.cw1h + c.cr + c.out; c.guess = guess;
  // 캐시가 아니었다면 더 냈을 금액(절감)과 캐시 쓰기 할증
  c.saved = u.cacheRead * (p.in - p.cr) * K * sc; c.premium = (u.cw5 * (p.cw5 - p.in) + u.cw1h * (p.cw1h - p.in)) * K * sc;
  return c;
}
// 호출 전 어림 비용: 입력 토큰 수, 그중 캐시에서 읽힐 것으로 보는 양
function estimateCost(model, inTokens, cachedTokens = 0, outTokens = 0) {
  const K = 1e-6, sc = S.settings.budget.costScale || 1;
  if (S.settings.provider === 'openai') { const o = S.settings.openai, ci = o.in || 0, cc = (o.cr != null && o.cr !== '' ? +o.cr : ci * 0.5); return (Math.max(0, inTokens - cachedTokens) * ci + cachedTokens * cc + outTokens * (o.out || 0)) * K * sc; }
  const { p } = priceFor(model, inTokens);
  const fresh = Math.max(0, inTokens - cachedTokens);
  return (fresh * p.in + cachedTokens * p.cr + outTokens * p.out) * K * sc;
}

/* ── 요청 만들기 ── */
function cleanBlocks(content) {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  const out = [];
  for (const b of content || []) {
    if (b.type === 'text') { if (b.text && String(b.text).trim()) out.push({ type: 'text', text: b.text }); }
    else if (b.type === 'tool_use') out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input || {} });
    else if (b.type === 'tool_result') { const r = { type: 'tool_result', tool_use_id: b.tool_use_id, content: typeof b.content === 'string' ? (b.content || '(빈 결과)') : b.content }; if (b.is_error) r.is_error = true; out.push(r); }
  }
  return out;
}
function cleanMessages(messages) {
  const out = [];
  for (const m of messages) { const c = cleanBlocks(m.content); if (c.length) out.push({ role: m.role, content: c }); }
  return out;
}
function cacheCtl(ttl) { return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; }
// sys: [{text, cache?}]  tools: [{name, description, input_schema}]  messages: Anthropic 형식
function buildBody({ model, sys, tools, messages, maxTokens, temperature, ttl = '5m', stream = true, cacheTail = true }) {
  const body = { model, max_tokens: maxTokens, stream };
  const sysBlocks = (sys || []).filter((b) => b.text && b.text.trim()).map((b) => { const o = { type: 'text', text: b.text }; if (b.cache) o.cache_control = cacheCtl(ttl); return o; });
  if (sysBlocks.length) body.system = sysBlocks;
  // 도구 정의는 캐시 순서상 system 보다 앞이라, system 에 중단점이 있으면 거기에 함께 묶인다 → 따로 표시하지 않음(중단점 절약)
  const sysCached = sysBlocks.some((b) => b.cache_control);
  if (tools && tools.length) { body.tools = tools.map((t, i) => (i === tools.length - 1 && !sysCached ? { ...t, cache_control: cacheCtl(ttl) } : { ...t })); }
  const msgs = cleanMessages(messages);
  if (cacheTail && msgs.length) { const last = msgs[msgs.length - 1]; last.content = last.content.map((b, i) => (i === last.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b)); }
  body.messages = msgs;
  if (typeof temperature === 'number' && temperature !== 1) body.temperature = temperature;
  // 중단점은 최대 4개: 넘치면 앞쪽(도구)부터 덜어냄
  let n = 0; const count = () => { n = (body.tools || []).filter((t) => t.cache_control).length + (body.system || []).filter((b) => b.cache_control).length + msgs.reduce((a, m) => a + m.content.filter((b) => b.cache_control).length, 0); return n; };
  while (count() > 4) { const t = (body.tools || []).find((t) => t.cache_control); if (t) { delete t.cache_control; continue; } const s = (body.system || []).find((b) => b.cache_control); if (s) { delete s.cache_control; continue; } break; }
  return body;
}
function anthropicHeaders() {
  return { 'content-type': 'application/json', 'x-api-key': S.secrets.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
}
function normUsage(u, defaultTTL = '5m') {
  u = u || {};
  const cc = u.cache_creation || null; let cw5 = 0, cw1h = 0;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) { cw5 = cc.ephemeral_5m_input_tokens || 0; cw1h = cc.ephemeral_1h_input_tokens || 0; }
  else { const t = u.cache_creation_input_tokens || 0; if (defaultTTL === '1h') cw1h = t; else cw5 = t; }
  return { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cw5, cw1h };
}

/* ── SSE 읽기 ── */
async function* sseEvents(res, signal) {
  const rd = res.body.getReader(), dec = new TextDecoder('utf-8'); let buf = '';
  const onAbort = () => { try { rd.cancel(); } catch (e) {} };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        let ev = '', data = '';
        for (const ln of raw.split(/\r?\n/)) { if (ln.startsWith('event:')) ev = ln.slice(6).trim(); else if (ln.startsWith('data:')) data += (data ? '\n' : '') + ln.slice(5).replace(/^ /, ''); }
        if (data) yield { event: ev, data };
      }
    }
    buf += dec.decode(); const rest = buf.trim();
    if (rest) { let ev = '', data = ''; for (const ln of rest.split(/\r?\n/)) { if (ln.startsWith('event:')) ev = ln.slice(6).trim(); else if (ln.startsWith('data:')) data += ln.slice(5).replace(/^ /, ''); } if (data) yield { event: ev, data }; }
  } finally { if (signal) signal.removeEventListener('abort', onAbort); }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);
async function postWithRetry(url, init, { signal, onRetry, retries = 3 } = {}) {
  let lastErr;
  for (let a = 0; a <= retries; a++) {
    if (signal && signal.aborted) throw new ApiError('중단됨', { kind: 'abort' });
    let res;
    try { res = await fetch(url, { ...init, signal }); }
    catch (e) {
      if (signal && signal.aborted) throw new ApiError('중단됨', { kind: 'abort' });
      lastErr = new ApiError(`네트워크 오류: ${e && e.message || e} — 인터넷 연결, API 주소, 키 형식을 확인하세요.`, { kind: 'network' });
      if (a < retries) { const d = 1000 * 2 ** a; onRetry && onRetry(a + 1, d, lastErr.message); await sleep(d); continue; }
      throw lastErr;
    }
    if (res.ok) return res;
    let type = '', msg = ''; try { const j = await res.json(); type = j.error && j.error.type || ''; msg = j.error && j.error.message || j.message || ''; } catch (e) { try { msg = await res.text(); } catch (e2) {} }
    const ra = Number((res.headers && res.headers.get && res.headers.get('retry-after')) || 0);
    lastErr = new ApiError(friendlyApiError(res.status, type, msg), { status: res.status, type, kind: 'http', raw: msg });
    if (RETRY_STATUS.has(res.status) && a < retries && !/credit balance/i.test(msg)) { const d = ra ? ra * 1000 : 1500 * 2 ** a; onRetry && onRetry(a + 1, d, lastErr.message); await sleep(d); continue; }
    throw lastErr;
  }
  throw lastErr;
}

/* ── Anthropic Messages (스트리밍) ──
   반환: { content:[blocks], stop_reason, usage, model, id, ms }
   실패해도 이미 청구된 토큰은 e.partial = {content, usage} 로 알려 장부에 남긴다. */
async function anthropicStream(req, cb = {}) {
  if (!S.secrets.apiKey) throw new ApiError('Anthropic API 키가 없습니다 (설정 → API).', { kind: 'nokey' });
  const body = buildBody({ ...req, model: apiModel(req.model) }); const t0 = Date.now();
  const res = await postWithRetry(S.settings.anthropicBase.replace(/\/+$/, '') + '/v1/messages', { method: 'POST', headers: anthropicHeaders(), body: JSON.stringify(body) }, { signal: cb.signal, onRetry: cb.onRetry });
  const blocks = []; let usage = zeroUsage(), stop = null, mid = '', mdl = req.model, started = false, textSoFar = 0;
  const partialUsage = () => { const u = { ...usage }; if (!u.output) u.output = Math.ceil(textSoFar / 1.2); return u; };
  const live = () => blocks.map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b._json ? (() => { try { return JSON.parse(b._json); } catch (e) { return {}; } })() : b.input || {} } : b.type === 'text' ? { type: 'text', text: b.text } : null)).filter(Boolean);
  try {
    for await (const { event, data } of sseEvents(res, cb.signal)) {
      let d; try { d = JSON.parse(data); } catch (e) { continue; }
      const type = d.type || event;
      if (type === 'message_start') { started = true; mid = d.message.id; mdl = d.message.model || mdl; usage = normUsage(d.message.usage, req.ttl); cb.onUsage && cb.onUsage({ ...usage }); }
      else if (type === 'content_block_start') {
        const cbk = d.content_block; const b = { type: cbk.type };
        if (cbk.type === 'text') b.text = cbk.text || '';
        else if (cbk.type === 'tool_use') { b.id = cbk.id; b.name = cbk.name; b.input = cbk.input || {}; b._json = ''; cb.onToolStart && cb.onToolStart(b); }
        else if (cbk.type === 'thinking' || cbk.type === 'redacted_thinking') b.skip = true;
        blocks[d.index] = b;
      } else if (type === 'content_block_delta') {
        const b = blocks[d.index]; if (!b) continue; const dl = d.delta;
        if (dl.type === 'text_delta' && b.type === 'text') { b.text += dl.text; textSoFar += dl.text.length; cb.onText && cb.onText(dl.text, b.text); }
        else if (dl.type === 'input_json_delta' && b.type === 'tool_use') { b._json += dl.partial_json || ''; }
      } else if (type === 'content_block_stop') {
        const b = blocks[d.index]; if (b && b.type === 'tool_use') { if (b._json) { try { b.input = JSON.parse(b._json); } catch (e) { b.input = {}; b.parseError = true; } } delete b._json; }
      } else if (type === 'message_delta') {
        if (d.delta && d.delta.stop_reason) stop = d.delta.stop_reason;
        if (d.usage) { const u = d.usage; if (u.output_tokens != null) usage.output = u.output_tokens; if (u.input_tokens) usage.input = u.input_tokens; if (u.cache_read_input_tokens) usage.cacheRead = u.cache_read_input_tokens; if (u.cache_creation_input_tokens) { const nu = normUsage(u, req.ttl); usage.cw5 = nu.cw5; usage.cw1h = nu.cw1h; } cb.onUsage && cb.onUsage({ ...usage }); }
      } else if (type === 'error') {
        const er = d.error || {}; throw new ApiError(friendlyApiError(0, er.type, er.message), { kind: 'stream', type: er.type });
      }
    }
    if (signal_aborted(cb.signal)) throw new ApiError('중단됨', { kind: 'abort' });   // 취소하면 스트림이 조용히 끝나므로 직접 확인
  } catch (e) {
    if (signal_aborted(cb.signal)) { const ae = new ApiError('중단됨', { kind: 'abort' }); ae.partial = { content: live(), usage: started ? partialUsage() : zeroUsage(), model: mdl }; throw ae; }
    if (!(e instanceof ApiError)) e = new ApiError(`스트림 오류: ${e && e.message || e}`, { kind: 'stream' });
    e.partial = { content: live(), usage: started ? partialUsage() : zeroUsage(), model: mdl }; throw e;
  }
  const content = blocks.filter((b) => b && !b.skip).map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.input, ...(b.parseError ? { parseError: true } : {}) } : { type: 'text', text: b.text || '' })).filter((b) => b.type !== 'text' || b.text);
  return { content, stop_reason: stop || 'end_turn', usage, model: mdl, id: mid, ms: Date.now() - t0 };
}
const signal_aborted = (s) => !!(s && s.aborted);

/* ── OpenAI 호환 (형식상 구현: 채팅 + 도구 호출 + 스트리밍) ── */
function toOpenAIMessages(sys, messages) {
  const out = []; const s = (sys || []).map((b) => b.text).filter(Boolean).join('\n\n'); if (s) out.push({ role: 'system', content: s });
  for (const m of cleanMessages(messages)) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      const o = { role: 'assistant', content: text || null }; if (calls.length) o.tool_calls = calls; out.push(o);
    } else {
      for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('') });
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}
async function openaiStream(req, cb = {}) {
  const o = S.settings.openai; if (!S.secrets.openaiKey) throw new ApiError('OpenAI 호환 API 키가 없습니다 (설정 → API).', { kind: 'nokey' });
  const body = { model: o.model, messages: toOpenAIMessages(req.sys, req.messages), stream: true, stream_options: { include_usage: true }, max_tokens: req.maxTokens };
  if (isOpenRouter(o.base)) body.usage = { include: true };   // OpenRouter: 마지막 청크에 실제 청구액(usage.cost)을 포함
  if (req.tools && req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (typeof req.temperature === 'number' && req.temperature !== 1) body.temperature = req.temperature;
  const t0 = Date.now();
  const res = await postWithRetry(o.base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.secrets.openaiKey }, body: JSON.stringify(body) }, { signal: cb.signal, onRetry: cb.onRetry });
  let text = '', calls = [], fin = null, usage = zeroUsage(), id = '';
  const build = () => { const c = []; if (text) c.push({ type: 'text', text }); for (const t of calls) if (t) { let inp = {}; try { inp = t.args ? JSON.parse(t.args) : {}; } catch (e) {} c.push({ type: 'tool_use', id: t.id || uid('call_'), name: t.name, input: inp }); } return c; };
  try {
    for await (const { data } of sseEvents(res, cb.signal)) {
      if (data.trim() === '[DONE]') break; let d; try { d = JSON.parse(data); } catch (e) { continue; }
      id = d.id || id;
      if (d.usage) { const cached = (d.usage.prompt_tokens_details && d.usage.prompt_tokens_details.cached_tokens) || 0; usage = { input: Math.max(0, (d.usage.prompt_tokens || 0) - cached), output: d.usage.completion_tokens || 0, cacheRead: cached, cw5: 0, cw1h: 0 }; if (typeof d.usage.cost === 'number') usage.extCost = d.usage.cost; cb.onUsage && cb.onUsage({ ...usage }); }
      const ch = d.choices && d.choices[0]; if (!ch) continue;
      if (ch.delta && ch.delta.content) { text += ch.delta.content; cb.onText && cb.onText(ch.delta.content, text); }
      for (const tc of (ch.delta && ch.delta.tool_calls) || []) { const t = calls[tc.index] || (calls[tc.index] = { id: '', name: '', args: '' }); if (tc.id) t.id = tc.id; if (tc.function && tc.function.name) { t.name += tc.function.name; if (cb.onToolStart && t.name === tc.function.name) cb.onToolStart({ type: 'tool_use', name: t.name }); } if (tc.function && tc.function.arguments) t.args += tc.function.arguments; }
      if (ch.finish_reason) fin = ch.finish_reason;
    }
    if (signal_aborted(cb.signal)) throw new ApiError('중단됨', { kind: 'abort' });
  } catch (e) {
    if (!(e instanceof ApiError)) e = new ApiError(`스트림 오류: ${e && e.message || e}`, { kind: signal_aborted(cb.signal) ? 'abort' : 'stream' });
    const pu = usage.output ? usage : { ...usage, output: Math.ceil(text.length / 1.2) }; e.partial = { content: build(), usage: pu, model: o.model }; throw e;
  }
  const stop = fin === 'tool_calls' || fin === 'function_call' ? 'tool_use' : fin === 'length' ? 'max_tokens' : 'end_turn';
  return { content: build(), stop_reason: stop, usage, model: o.model, id, ms: Date.now() - t0 };
}
const LLM = {
  stream(req, cb) { return S.settings.provider === 'openai' ? openaiStream(req, cb) : anthropicStream(req, cb); },
  get provider() { return S.settings.provider === 'openai' ? 'openai' : 'anthropic'; },
  get modelId() { return this.provider === 'openai' ? S.settings.openai.model : S.settings.model; },
  // count_tokens 는 무료 (분당 한도만 있음). OpenAI 호환 쪽은 어림값.
  async count(req) {
    if (this.provider === 'openai') { const t = JSON.stringify([req.sys, req.tools, req.messages]); return { tokens: estTokens(t), approx: true }; }
    if (!S.secrets.apiKey) throw new ApiError('Anthropic API 키가 없습니다.', { kind: 'nokey' });
    const b = buildBody({ ...req, model: apiModel(req.model), stream: false, maxTokens: 1 }); delete b.max_tokens; delete b.stream;
    const res = await postWithRetry(S.settings.anthropicBase.replace(/\/+$/, '') + '/v1/messages/count_tokens', { method: 'POST', headers: anthropicHeaders(), body: JSON.stringify(b) }, { retries: 1 });
    const j = await res.json(); return { tokens: j.input_tokens, approx: false };
  },
  async listModels() {
    if (!S.secrets.apiKey) throw new ApiError('Anthropic API 키가 없습니다.', { kind: 'nokey' });
    const res = await postWithRetryGet(S.settings.anthropicBase.replace(/\/+$/, '') + '/v1/models?limit=100'); const j = await res.json();
    return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  },
};
async function postWithRetryGet(url) {
  let res; try { res = await fetchT(url, { headers: anthropicHeaders() }, 20000); } catch (e) { throw new ApiError(`네트워크 오류: ${e && e.message || e}`, { kind: 'network' }); }
  if (!res.ok) { let type = '', msg = ''; try { const j = await res.json(); type = j.error && j.error.type; msg = j.error && j.error.message; } catch (e) {} throw new ApiError(friendlyApiError(res.status, type, msg), { status: res.status }); }
  return res;
}

/* ── 장부 ──
   entry = { id, ts, chatId, turnId, label, iter, model, provider, usage, cost, parts, guess, partial, stop, tools[] } */
const Ledger = {
  async load() { S.ledger = (await DB.all('ledger')).sort((a, b) => a.ts - b.ts); },
  async add(o) {
    const c = costOf(o.model, o.usage, o.provider);
    const e = { id: uid('l'), ts: Date.now(), chatId: o.chatId || '', turnId: o.turnId || uid('t'), label: (o.label || '').slice(0, 60), iter: o.iter || 1, model: o.model, provider: o.provider || 'anthropic', usage: { ...o.usage }, cost: c.total, parts: { in: c.in, cw5: c.cw5, cw1h: c.cw1h, cr: c.cr, out: c.out, saved: c.saved || 0, premium: c.premium || 0 }, guess: !!c.guess, partial: !!o.partial, stop: o.stop || '', tools: o.tools || [], kind: o.kind || 'chat' };
    S.ledger.push(e); await DB.put('ledger', e.id, e); UI.budget(); return e;
  },
  sum(list) { return list.reduce((a, e) => { a.cost += e.cost; a.usage = addUsage(a.usage, e.usage); a.saved += e.parts.saved || 0; a.premium += e.parts.premium || 0; a.n++; return a; }, { cost: 0, usage: zeroUsage(), saved: 0, premium: 0, n: 0 }); },
  total() { return this.sum(S.ledger); },
  since(ts) { return this.sum(S.ledger.filter((e) => e.ts >= ts)); },
  today() { const k = dayKey(Date.now()); return this.sum(S.ledger.filter((e) => dayKey(e.ts) === k)); },
  turns(limit = 50, chatId) {
    const m = new Map();
    for (const e of S.ledger) {
      if (chatId && e.chatId !== chatId) continue;
      let t = m.get(e.turnId); if (!t) { t = { turnId: e.turnId, ts: e.ts, chatId: e.chatId, label: e.label, model: e.model, iters: 0, usage: zeroUsage(), cost: 0, saved: 0, tools: [], partial: false, entries: [] }; m.set(e.turnId, t); }
      t.iters++; t.usage = addUsage(t.usage, e.usage); t.cost += e.cost; t.saved += e.parts.saved || 0; t.tools.push(...(e.tools || [])); t.partial = t.partial || e.partial; t.entries.push(e); t.end = e.ts;
    }
    return [...m.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
  },
  byDay(n = 14) {
    const m = new Map(); for (const e of S.ledger) { const k = dayKey(e.ts); const d = m.get(k) || { day: k, cost: 0, n: 0, usage: zeroUsage() }; d.cost += e.cost; d.n++; d.usage = addUsage(d.usage, e.usage); m.set(k, d); }
    return [...m.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, n);
  },
  byModel() {
    const m = new Map(); for (const e of S.ledger) { const d = m.get(e.model) || { model: e.model, cost: 0, n: 0, usage: zeroUsage() }; d.cost += e.cost; d.n++; d.usage = addUsage(d.usage, e.usage); m.set(e.model, d); }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  },
  byChat() {
    const m = new Map(); for (const e of S.ledger) { const d = m.get(e.chatId) || { chatId: e.chatId, cost: 0, n: 0 }; d.cost += e.cost; d.n++; m.set(e.chatId, d); }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  },
  cacheHit(list = S.ledger) { const u = this.sum(list).usage; const tot = u.input + u.cacheRead + u.cw5 + u.cw1h; return tot ? u.cacheRead / tot : 0; },
  csv() {
    const rows = [['time', 'chat', 'turn', 'iter', 'model', 'input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output', 'cost_usd', 'cost_krw', 'tools', 'partial']];
    const rate = S.settings.budget.krwPerUSD;
    for (const e of S.ledger) rows.push([new Date(e.ts).toISOString(), e.chatId, e.turnId, e.iter, e.model, e.usage.input, e.usage.cw5, e.usage.cw1h, e.usage.cacheRead, e.usage.output, e.cost.toFixed(6), Math.round(e.cost * rate), (e.tools || []).join('|'), e.partial ? 1 : 0]);
    return rows.map((r) => r.map((x) => { x = String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\n');
  },
  async clear() { S.ledger = []; await DB.clear('ledger'); UI.budget(); },
};

/* ── 예산 ──
   남은 크레딧에는 공식 조회 API 가 없어서 "기준점 − 기준점 이후 장부 합계"로 계산하고,
   콘솔에서 본 실제 잔액으로 언제든 기준점을 다시 맞춘다(보정). */
const Budget = {
  get cfg() { return S.settings.budget; },
  creditUSD() { return this.cfg.creditUSD; },
  // Anthropic 크레딧에서 빠지는 것만 센다 — OpenRouter 등 OpenAI 호환 호출은 별도 결제라 제외
  spentSince() { return Ledger.sum(S.ledger.filter((e) => e.ts >= this.cfg.anchorTs && e.provider !== 'openai')).cost; },
  externalSince() { return Ledger.sum(S.ledger.filter((e) => e.ts >= this.cfg.anchorTs && e.provider === 'openai')); },
  remaining() { return this.cfg.anchorUSD - this.spentSince(); },
  usedUSD() { return Math.max(0, this.creditUSD() - this.remaining()); },
  usedPct() { const c = this.creditUSD(); return c > 0 ? (this.usedUSD() / c) * 100 : 0; },
  level() { const r = this.remaining(), p = this.usedPct(); return r - this.cfg.reserveUSD <= 0 || p >= this.cfg.stopPct ? 'stop' : p >= this.cfg.warnPct ? 'warn' : 'ok'; },
  avgTurn(n = 20) { const t = Ledger.turns(n).filter((x) => x.cost > 0); return t.length ? t.reduce((a, x) => a + x.cost, 0) / t.length : 0; },
  runway() { const a = this.avgTurn(); return a > 0 ? Math.max(0, Math.floor((this.remaining() - this.cfg.reserveUSD) / a)) : null; },
  state() { return { creditUSD: this.creditUSD(), remaining: this.remaining(), used: this.usedUSD(), pct: this.usedPct(), level: this.level(), avgTurn: this.avgTurn(), runway: this.runway() }; },
  // 호출 전에 막을지 판단. estUSD = 이번 호출의 최악 비용 어림.
  precheck(estUSD = 0) {
    const r = this.remaining(), lv = this.level();
    if (lv === 'stop') return { ok: false, level: lv, msg: `예산 한도(${this.cfg.stopPct}% 사용 또는 예비금 $${this.cfg.reserveUSD} 이하)에 도달해 중단됨. 남은 약 ${fmtUSD(r)}${altUSD(r)}. 한도를 올리거나 잔액을 보정하세요.` };
    if (estUSD > r - this.cfg.reserveUSD) return { ok: false, level: 'stop', msg: `이번 호출의 최대 예상 비용 ${fmtUSD(estUSD)}가 남은 예산(${fmtUSD(r)})을 넘을 수 있어 중단함.` };
    return { ok: true, level: lv, msg: lv === 'warn' ? `예산 ${this.usedPct().toFixed(0)}% 사용 — 남은 약 ${fmtUSD(r)}` : '' };
  },
  anchorHere(usd) {
    const b = this.cfg, predicted = this.remaining(), spent = this.spentSince();
    b.calibLog = (b.calibLog || []).concat([{ ts: Date.now(), predicted, actual: usd, drift: usd - predicted, spent }]).slice(-30);
    b.anchorUSD = +usd.toFixed(4); b.anchorTs = Date.now(); saveSettings(); UI.budget();
    return { predicted, actual: usd };
  },
  calibrateUSD(usd) { if (!(usd >= 0)) throw new Error('0 이상의 숫자를 넣으세요'); return this.anchorHere(+usd); },
  calibrateKRW(krw) { return this.calibrateUSD(krw / this.cfg.krwPerUSD); },
  // 크레딧 총액·환율을 바꿀 때: 남은 금액은 그대로 두고 총액만 갱신
  setCredit(usd, rate) {
    const b = this.cfg, rem = this.remaining(); b.creditUSD = usd; if (rate) b.krwPerUSD = rate;
    b.anchorUSD = +rem.toFixed(4); b.anchorTs = Date.now(); saveSettings(); UI.budget();
  },
  reset() { const b = this.cfg; b.anchorUSD = +b.creditUSD.toFixed(4); b.anchorTs = Date.now(); b.calibLog = []; saveSettings(); UI.budget(); },
};

/* ── 환율 (USD→KRW): 첫 실행 때 한 번 받아 기록하고, 이후엔 사용자가 눌러서 갱신한다. 실패해도 마지막 값을 그대로 쓴다. ── */
const FX = {
  sources: [
    { id: 'frankfurter.dev', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW', parse: (j) => ({ rate: j && j.rates && j.rates.KRW, date: (j && j.date) || '' }) },
    { id: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', parse: (j) => ({ rate: j && j.result === 'success' && j.rates && j.rates.KRW, date: ((j && j.time_last_update_utc) || '').replace(/^\w+, /, '').replace(/ \+0000$/, ' UTC') }) },
  ],
  async refresh({ silent = false } = {}) {
    const b = S.settings.budget; const errs = [];
    for (const s of this.sources) {
      try {
        const r = await fetchT(s.url, { headers: { Accept: 'application/json' } }, 8000); if (!r.ok) throw new Error('HTTP ' + r.status);
        const { rate, date } = s.parse(await r.json()); if (!(rate > 500 && rate < 5000)) throw new Error('이상한 값');
        b.krwPerUSD = +Number(rate).toFixed(2); b.fx = { rate: b.krwPerUSD, ts: Date.now(), date, source: s.id }; saveSettings(); UI.budget();
        if (!silent) UI.toast(`환율 갱신: 1달러 = ${b.krwPerUSD.toLocaleString('ko-KR')}원 (${s.id})`); return { ok: true, rate: b.krwPerUSD, source: s.id };
      } catch (e) { errs.push(`${s.id}: ${e && e.message || e}`); }
    }
    if (!silent) UI.toast('⚠ 환율을 받지 못했습니다 — 마지막 값(' + b.krwPerUSD + '원)을 계속 씁니다. 직접 입력할 수도 있어요.', 6000);
    return { ok: false, errors: errs };
  },
  // 첫 실행(받은 기록이 없을 때)에만 자동으로 한 번
  async firstRun() { if (!S.settings.budget.fx.ts) return this.refresh({ silent: true }); return null; },
  ageDays() { const t = S.settings.budget.fx.ts; return t ? (Date.now() - t) / 86400000 : null; },
};
