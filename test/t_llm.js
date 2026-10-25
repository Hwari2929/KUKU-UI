const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; }; const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); n++; };
const enc = new TextEncoder();
const sse = (events, { cut } = {}) => { // 이벤트 배열 → Response 비슷한 객체 (청크를 일부러 어긋나게 쪼갬)
  let s = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''); const bytes = enc.encode(s); const chunks = []; for (let i = 0; i < bytes.length; i += 37) chunks.push(bytes.slice(i, i + 37));
  let i = 0, rel = null; return { ok: true, status: 200, headers: new Map(), body: { getReader: () => ({ read: async () => { if (cut != null && i >= cut) await new Promise((r) => (rel = r)); return i < chunks.length && !(cut != null && i >= cut) ? { value: chunks[i++], done: false } : { done: true }; }, cancel: async () => { cut = 0; i = 0; rel && rel(); } }) } };
};
const mk = (extra = {}) => [
  { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 } } },
  { type: 'ping' },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '안녕' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '하세요 ✨' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_note', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"name":"린' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '디웨"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 500 } },
  { type: 'message_stop' },
];
const calls = [];
let script = [];
global.fetch = async (url, opts = {}) => { calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null }); const s = script.shift(); if (typeof s === 'function') return s(opts); return s; };
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js'], { fetch: (...a) => global.fetch(...a) }, 'LLM, Ledger, Budget, costOf, priceFor, buildBody, anthropicStream, openaiStream, toOpenAIMessages, normUsage, estimateCost, ApiError, zeroUsage');
const { S, LLM, Ledger, Budget, costOf, buildBody, anthropicStream, openaiStream } = X;
(async () => {
  S.secrets.apiKey = 'sk-test'; S.settings.budget.anchorUSD = 92.8571; S.settings.budget.anchorTs = 0;
  // 비용: sonnet 5.5  in 1000*2 + cw5 2000*2.5 + cr 10000*0.1 + out 500*10 = 2000+5000+1000+5000 = 13000 /1e6
  const c = costOf('claude-sonnet-5-5', { input: 1000, cw5: 2000, cw1h: 0, cacheRead: 10000, output: 500 }); near(c.total, 0.013, 'sonnet'); near(c.saved, 10000 * 1.9e-6, 'saved'); near(c.premium, 2000 * 0.5e-6, 'premium');
  near(costOf('claude-sonnet-5-5-20261201', { input: 1e6, cw5: 0, cw1h: 0, cacheRead: 0, output: 0 }).total, 2, '날짜 접미사 모델 접두 매칭');
  ok(costOf('mystery-model', { input: 1e6, cw5: 0, cw1h: 0, cacheRead: 0, output: 0 }).guess, '모르는 모델 → 보수적 추정 표시');
  near(costOf('claude-haiku-5-5', { input: 50000, cw5: 0, cw1h: 0, cacheRead: 0, output: 1000 }).total, 0.005 + 0.0005, 'haiku ≤100k');
  near(costOf('claude-haiku-5-5', { input: 150000, cw5: 0, cw1h: 0, cacheRead: 0, output: 1000 }).total, 0.075 + 0.0025, 'haiku >100k 단가');
  near(costOf('claude-sonnet-5-5', { input: 0, cw5: 0, cw1h: 1000, cacheRead: 0, output: 0 }).total, 0.004, '1h 쓰기');
  // 요청 본문
  const b = buildBody({ model: 'claude-sonnet-5-5', sys: [{ text: '규칙', cache: true }, { text: '색인', cache: true }, { text: '' }], tools: [{ name: 'a', description: '', input_schema: { type: 'object' } }, { name: 'b', description: '', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'text', text: '네' }] }, { role: 'user', content: [{ type: 'text', text: '다음', _x: 1 }] }], maxTokens: 100, ttl: '1h' });
  eq(b.system.length, 2); eq(b.system[0].cache_control, { type: 'ephemeral', ttl: '1h' }); ok(!b.tools[0].cache_control && !b.tools[1].cache_control, 'system 중단점이 있으면 도구엔 표시 안 함'); const bt = buildBody({ model: 'x', sys: [{ text: 'a' }], tools: [{ name: 'a', input_schema: {} }, { name: 'b', input_schema: {} }], messages: [{ role: 'user', content: 'q' }], maxTokens: 1 }); ok(!bt.tools[0].cache_control && bt.tools[1].cache_control, 'system 중단점 없으면 마지막 도구');
  eq(b.messages[1].content, [{ type: 'text', text: '네' }]); eq(b.messages[2].content[0], { type: 'text', text: '다음', cache_control: { type: 'ephemeral' } }); ok(!('temperature' in b));
  const brk = JSON.stringify(b).split('cache_control').length - 1; ok(brk === 3, 'breakpoints ' + brk);
  const b2 = buildBody({ model: 'x', sys: [{ text: 'a', cache: true }, { text: 'b', cache: true }, { text: 'c', cache: true }], tools: [{ name: 'a', input_schema: {} }], messages: [{ role: 'user', content: 'q' }], maxTokens: 1, temperature: 0.5 });
  ok(JSON.stringify(b2).split('cache_control').length - 1 <= 4, '4 초과 방지'); eq(b2.temperature, 0.5);
  // 스트리밍
  script = [sse(mk())]; const texts = []; const tools = []; const usages = [];
  let r = await anthropicStream({ model: 'claude-sonnet-5-5', sys: [{ text: 'x' }], tools: [], messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, ttl: '5m' }, { onText: (d) => texts.push(d), onToolStart: (t) => tools.push(t.name), onUsage: (u) => usages.push(u) });
  eq(r.content, [{ type: 'text', text: '안녕하세요 ✨' }, { type: 'tool_use', id: 'tu_1', name: 'read_note', input: { name: '린디웨' } }]); eq(r.stop_reason, 'tool_use'); eq(r.usage, { input: 1000, output: 500, cacheRead: 10000, cw5: 2000, cw1h: 0 }); eq(tools, ['read_note']); eq(texts.join(''), '안녕하세요 ✨');
  eq(calls[0].opts.headers['anthropic-dangerous-direct-browser-access'], 'true'); eq(calls[0].url, 'https://api.anthropic.com/v1/messages'); eq(calls[0].opts.headers['x-api-key'], 'sk-test');
  // 장부
  const e1 = await Ledger.add({ chatId: 'c1', turnId: 't1', label: '질문', iter: 1, model: r.model, usage: r.usage, tools: ['read_note'], stop: r.stop_reason }); near(e1.cost, 0.013, 'ledger cost');
  const e2 = await Ledger.add({ chatId: 'c1', turnId: 't1', iter: 2, model: 'claude-sonnet-5-5', usage: { input: 200, output: 300, cacheRead: 12000, cw5: 500, cw1h: 0 } });
  const tt = Ledger.turns(); eq(tt.length, 1); eq(tt[0].iters, 2); near(tt[0].cost, e1.cost + e2.cost, 'turn sum'); eq(tt[0].usage.cacheRead, 22000);
  ok(Ledger.cacheHit() > 0.5, 'cache hit'); ok(Ledger.csv().split('\n').length === 3, 'csv');
  // 예산
  let st = Budget.state(); near(st.remaining, 92.8571 - e1.cost - e2.cost, 'remaining'); eq(st.level, 'ok'); near(st.creditUSD, 130000 / 1400, 'credit');
  Budget.calibrateUSD(50); near(Budget.remaining(), 50, '보정 직후'); eq(S.settings.budget.calibLog.length, 1);
  await sleepMs(5); await Ledger.add({ turnId: 't2', model: 'claude-opus-5-5', usage: { input: 1e6, output: 0, cacheRead: 0, cw5: 0, cw1h: 0 } }); near(Budget.remaining(), 46, '보정 이후 지출만 차감'); ok(Budget.usedPct() > 50);
  Budget.calibrateUSD(0.4); eq(Budget.level(), 'stop'); ok(!Budget.precheck(0.01).ok); Budget.calibrateUSD(10); ok(Budget.precheck(0.01).ok); ok(!Budget.precheck(20).ok, '최악 비용 초과'); Budget.calibrateUSD(10 + 0.0); 
  S.settings.budget.warnPct = 1; eq(Budget.level(), 'warn');
  // 재시도 + 오류
  calls.length = 0; const resp = (st, body, hd) => ({ ok: false, status: st, statusText: 'x', headers: { get: (k) => (hd || {})[k] }, json: async () => body, text: async () => JSON.stringify(body) });
  script = [resp(529, { error: { type: 'overloaded_error', message: 'busy' } }, { 'retry-after': '0' }), sse(mk())]; const retries = [];
  r = await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }, { onRetry: (a, d, m) => retries.push(a) }); eq(retries, [1]); eq(calls.length, 2);
  script = [resp(400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } })]; let err; try { await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }); } catch (e) { err = e; } ok(err && /잔액/.test(err.message) && err.status === 400, err && err.message);
  script = [resp(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } })]; err = null; try { await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }); } catch (e) { err = e; } ok(err && /키/.test(err.message) && calls.length === 4, '401 은 재시도 없음');
  // 스트림 중 오류 → partial 사용량 보존
  const ev = mk().slice(0, 5); ev.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }); script = [sse(ev)]; err = null; try { await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }); } catch (e) { err = e; }
  ok(err && err.partial && err.partial.usage.input === 1000 && err.partial.usage.output > 0 && err.partial.content[0].text === '안녕하세요 ✨'.slice(0, 2) + '하세요 ✨', 'partial ' + JSON.stringify(err && err.partial));
  // 중단
  const ac = new AbortController(); script = [sse(mk(), { cut: 14 })]; err = null; setTimeout(() => ac.abort(), 30);
  try { await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }, { signal: ac.signal }); } catch (e) { err = e; } ok(err && err.kind === 'abort' && err.partial && err.partial.usage.input === 1000, 'abort partial');
  // tool 입력 JSON 깨짐
  const bad = mk(); bad[8].delta.partial_json = '"'; script = [sse(bad)]; r = await anthropicStream({ model: 'm', sys: [], messages: [{ role: 'user', content: 'x' }], maxTokens: 10 }); ok(r.content[1].parseError && JSON.stringify(r.content[1].input) === '{}', 'parseError');
  // OpenAI 호환
  S.secrets.openaiKey = 'ok'; S.settings.openai.in = 1; S.settings.openai.out = 2; S.settings.provider = 'openai';
  const oev = [{ choices: [{ delta: { content: '안' } }] }, { choices: [{ delta: { content: '녕' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search', arguments: '{"q":' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"린"}' } }] }, finish_reason: 'tool_calls' }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } } }];
  const osse = (evs) => { const s = evs.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'; const by = enc.encode(s); let d = false; return { ok: true, status: 200, headers: new Map(), body: { getReader: () => ({ read: async () => (d ? { done: true } : ((d = true), { value: by, done: false })), cancel: async () => {} }) } }; };
  script = [osse(oev)]; calls.length = 0;
  r = await LLM.stream({ sys: [{ text: 'S' }], tools: [{ name: 'search', description: 'd', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'search', input: { q: 1 } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'res' }] }], maxTokens: 50 });
  eq(r.content, [{ type: 'text', text: '안녕' }, { type: 'tool_use', id: 'c1', name: 'search', input: { q: '린' } }]); eq(r.stop_reason, 'tool_use'); eq(r.usage, { input: 600, output: 50, cacheRead: 400, cw5: 0, cw1h: 0 });
  eq(calls[0].body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool']); eq(calls[0].body.tools[0].function.name, 'search'); eq(calls[0].url, 'https://api.openai.com/v1/chat/completions'); ok(calls[0].opts.headers.authorization === 'Bearer ok');
  near(costOf('gpt', r.usage, 'openai').total, (600 * 1 + 400 * 0.5 + 50 * 2) * 1e-6, 'openai cost');
  // count_tokens
  S.settings.provider = 'anthropic'; script = [{ ok: true, status: 200, headers: new Map(), json: async () => ({ input_tokens: 1234 }) }]; calls.length = 0;
  const ct = await LLM.count({ model: 'claude-sonnet-5-5', sys: [{ text: 'x', cache: true }], tools: [], messages: [{ role: 'user', content: 'q' }] }); eq(ct, { tokens: 1234, approx: false }); ok(calls[0].url.endsWith('/v1/messages/count_tokens') && !('max_tokens' in calls[0].body) && !('stream' in calls[0].body), 'count body');
  console.log(`llm OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }
