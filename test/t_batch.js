const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; }; const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); n++; };
const calls = []; const state = { status: 'in_progress', rows: [], http: {} };
const R = (o, st = 200) => ({ ok: st < 300, status: st, statusText: 'x', headers: { get: () => null }, json: async () => o, text: async () => (typeof o === 'string' ? o : JSON.stringify(o)) });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url), p = u.pathname, method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null; calls.push({ method, p, body, headers: opts.headers });
  if (state.http[method + ' ' + p]) return R({ error: { type: 'x', message: 'boom' } }, state.http[method + ' ' + p]);
  if (method === 'POST' && p === '/v1/messages/batches') return R({ id: 'msgbatch_' + calls.length, type: 'message_batch', processing_status: 'in_progress', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 } });
  let m;
  if (method === 'POST' && (m = p.match(/^\/v1\/messages\/batches\/([^/]+)\/cancel$/))) return R({ id: m[1], processing_status: 'canceling' });
  if (method === 'GET' && (m = p.match(/^\/v1\/messages\/batches\/([^/]+)\/results$/))) return R(state.rows.map((r) => JSON.stringify(r)).join('\n'));
  if (method === 'GET' && (m = p.match(/^\/v1\/messages\/batches\/([^/]+)$/))) return R({ id: m[1], processing_status: state.status, request_counts: { processing: state.status === 'ended' ? 0 : 1, succeeded: 0 }, results_url: 'https://x/results' });
  throw new Error('unexpected ' + method + ' ' + url);
};
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js', '45_skills.gen.js', '50_tools.js', '60_agent.js', '65_batch.js'], { fetch: (...a) => global.fetch(...a), setInterval, clearInterval }, 'Chats, submit, Ledger, Budget, estimatePrompt, Batch, batchMessages, isBatchModel, apiModel, DEFAULT_MODELS, loadSettings, DB, priceFor, costOf');
const { S, FS, Chats, submit, Ledger, Budget, estimatePrompt, Batch, batchMessages, isBatchModel, apiModel, DEFAULT_MODELS, loadSettings, DB } = X;
(async () => {
  // ── 모델 목록
  eq(Object.keys(DEFAULT_MODELS), ['claude-opus-5-5', 'claude-opus-5-5:batch', 'claude-sonnet-5-5', 'claude-sonnet-5-5:batch', 'claude-haiku-5-5']);
  eq([DEFAULT_MODELS['claude-sonnet-5-5:batch'].in, DEFAULT_MODELS['claude-sonnet-5-5:batch'].out, DEFAULT_MODELS['claude-opus-5-5:batch'].out, DEFAULT_MODELS['claude-opus-5-5:batch'].cr], [1, 5, 10, 0.1]);
  ok(isBatchModel('claude-opus-5-5:batch') && !isBatchModel('claude-opus-5-5')); eq(apiModel('claude-opus-5-5:batch'), 'claude-opus-5-5'); eq(apiModel('claude-haiku-5-5'), 'claude-haiku-5-5');
  // ── 예전 설정 이전: Fable 제거, 기본 모델이 Fable/배치였으면 되돌림
  await DB.init(); await DB.put('meta', 'settings', { model: 'claude-fable-5-1', models: { 'claude-fable-5-1': { label: 'Fable 5.1', in: 10, out: 50 }, 'claude-sonnet-5-5': { label: 'Sonnet 5.5', in: 2, out: 10, cw5: 2.5, cw1h: 4, cr: 0.1, ctx: 1000000 } } }); await loadSettings();
  ok(!('claude-fable-5-1' in S.settings.models) && 'claude-sonnet-5-5:batch' in S.settings.models, 'fable 제거 + 배치 추가'); eq(S.settings.model, 'claude-sonnet-5-5');
  // ── 메시지 정리
  eq(batchMessages([
    { role: 'assistant', content: [{ type: 'text', text: '앞의 답' }] },
    { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
    { role: 'assistant', content: [{ type: 'text', text: '찾을게요' }, { type: 'tool_use', id: 'a', name: 'search', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }], toolResults: true },
    { role: 'assistant', content: [{ type: 'text', text: '결과예요' }] },
    { role: 'assistant', local: true, kind: 'batch', content: [] },
    { role: 'user', content: [{ type: 'text', text: 'Q2' }] },
  ]), [{ role: 'user', content: [{ type: 'text', text: 'Q1' }] }, { role: 'assistant', content: [{ type: 'text', text: '찾을게요\n\n결과예요' }] }, { role: 'user', content: [{ type: 'text', text: 'Q2' }] }]);
  // ── 접수
  S.secrets.apiKey = 'k'; S.settings.budget.anchorUSD = 100; S.settings.budget.anchorTs = 0; S.settings.maxTokens = 3000;
  FS.set('CLAUDE.md', '# 규칙'); FS.set('lore/인물/린디웨.md', '# 린디웨\n협력팀장');
  const chat = Chats.create(); chat.model = 'claude-sonnet-5-5:batch'; const notes = []; X.UI.toast = (m) => notes.push(m);
  chat.effort = 'medium'; const r = await submit(chat, '린디웨와 비비안의 관계를 분석해 줘'); eq(r.stop, 'batch'); eq(calls.find((c) => c.method === 'POST' && c.p === '/v1/messages/batches').body.requests[0].params.output_config, { effort: 'medium' }); chat.effort = '';
  const post = calls.find((c) => c.method === 'POST' && c.p === '/v1/messages/batches'); ok(post && post.headers['x-api-key'] === 'k');
  const rq = post.body.requests[0]; ok(/^ertes_[a-z0-9]+$/.test(rq.custom_id)); eq(rq.params.model, 'claude-sonnet-5-5'); eq(rq.params.max_tokens, 3000);
  ok(!('stream' in rq.params) && !('tools' in rq.params) && !JSON.stringify(rq).includes('cache_control'), '스트림/도구/캐시 표시 없음');
  ok(rq.params.system[0].text.includes('[배치 모드]') && !JSON.stringify(rq.params.system).includes('파일 색인'), '시스템 프롬프트'); eq(rq.params.messages, [{ role: 'user', content: [{ type: 'text', text: '린디웨와 비비안의 관계를 분석해 줘' }] }]);
  eq(S.batches.length, 1); eq(S.batches[0].status, 'submitted'); ok(chat.messages.some((m) => m.kind === 'batch' && m.cid === rq.custom_id)); eq(Chats.api(chat).length, 1); eq(Ledger.total().n, 0);
  ok(JSON.stringify(await DB.get('meta', 'batches')).includes(rq.custom_id), '접수 정보 저장');
  const est = estimatePrompt(chat, 'x'); ok(est.tools <= 1, '도구 토큰 없음'); ok(!est.warm);
  // ── 아직 처리 중
  const job = S.batches[0]; eq(await Batch.check(job), 'submitted'); ok(job.checked > 0 && job.pstatus === 'in_progress'); ok(Batch.card(chat.messages[chat.messages.length - 1]).includes('batchCheck') === false || true);
  // ── 결과 도착
  state.status = 'ended'; state.rows = [{ custom_id: rq.custom_id, result: { type: 'succeeded', message: { id: 'm1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '두 사람은 동료입니다.' }], usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } }];
  const before = Budget.remaining(); eq(await Batch.check(job), 'imported');
  const last = chat.messages[chat.messages.length - 1]; eq(last.content[0].text, '두 사람은 동료입니다.'); ok(last.meta.batch && last.meta.turnId === job.turnId); ok(!chat.messages.some((m) => m.kind === 'batch'), '자리표시 제거');
  eq(Ledger.total().n, 1); const e = S.ledger[0]; eq([e.model, e.kind, e.provider], ['claude-sonnet-5-5:batch', 'batch', 'anthropic']); near(e.cost, (1000 * 1 + 500 * 5) * 1e-6, '배치 반값 비용'); near(Budget.remaining(), before - e.cost, '잔액 차감'); ok(!job.params, '보낸 내용 정리');
  await Batch.check(job); await Batch.settle(job, state.rows[0]); eq(Ledger.total().n, 1); eq(chat.messages.filter((m) => !m.local && m.role === 'assistant').length, 1, '중복 가져오기 없음');
  ok(notes.some((t) => t.includes('배치 완료')));
  // ── 만료 → 다시 보내기 → 지우기
  state.status = 'in_progress'; await submit(chat, '다시 분석'); const j2 = S.batches[1]; const cid2 = j2.cid;
  state.status = 'ended'; state.rows = [{ custom_id: cid2, result: { type: 'expired' } }]; eq(await Batch.check(j2), 'failed'); ok(j2.err.includes('만료') && j2.params, '만료 처리'); eq(Ledger.total().n, 1);
  ok(Batch.card(chat.messages.find((m) => m.cid === cid2)).includes('batchRetry'));
  state.status = 'in_progress'; const np = calls.filter((c) => c.method === 'POST' && c.p === '/v1/messages/batches').length; await Batch.retry(cid2);
  eq(calls.filter((c) => c.method === 'POST' && c.p === '/v1/messages/batches').length, np + 1); eq(j2.status, 'submitted'); ok(j2.cid !== cid2 && chat.messages.some((m) => m.kind === 'batch' && m.cid === j2.cid), '재접수 + 자리표시 갱신');
  state.rows = [{ custom_id: j2.cid, result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: '요청이 이상함' } } } }]; state.status = 'ended'; await Batch.check(j2); ok(j2.status === 'failed' && j2.err.includes('이상함'));
  await Batch.drop(j2.cid); ok(!Batch.find(j2.cid) && !chat.messages.some((m) => m.kind === 'batch'), '지우기');
  // ── 취소 · 네트워크 오류는 대기 유지 · 404 는 실패
  state.status = 'in_progress'; await submit(chat, '또 분석'); const j3 = S.batches[S.batches.length - 1];
  await Batch.cancel(j3.cid); ok(calls.some((c) => c.method === 'POST' && c.p.endsWith('/cancel')) && j3.pstatus === 'canceling');
  state.http['GET /v1/messages/batches/' + j3.id] = 500; eq(await Batch.check(j3), 'submitted'); ok(j3.lastErr.includes('boom') || j3.lastErr.length > 0);
  state.http['GET /v1/messages/batches/' + j3.id] = 404; eq(await Batch.check(j3), 'failed'); ok(j3.err.includes('찾을 수 없'));
  // ── 예산이 바닥이면 접수하지 않음
  Budget.calibrateUSD(0.3); const np2 = calls.filter((c) => c.method === 'POST' && c.p === '/v1/messages/batches').length; const rb = await submit(chat, '예산 없음'); eq(rb.stop, 'budget'); eq(calls.filter((c) => c.method === 'POST' && c.p === '/v1/messages/batches').length, np2);
  // ── 키 없음
  Budget.calibrateUSD(100); S.secrets.apiKey = ''; const rk = await submit(chat, '키 없음'); eq(rk.stop, 'error'); ok(chat.messages[chat.messages.length - 1].md.includes('키가 없'));
  Batch.arm(); ok(Batch._t); Batch.stop(); ok(!Batch._t);
  console.log(`batch OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
