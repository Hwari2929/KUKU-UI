const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
const enc = new TextEncoder();
function sseRes(events, { cut } = {}) {
  const bytes = enc.encode(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')); const chunks = []; for (let i = 0; i < bytes.length; i += 64) chunks.push(bytes.slice(i, i + 64));
  let i = 0, rel = null, stop = false;
  return { ok: true, status: 200, headers: new Map(), body: { getReader: () => ({ read: async () => { if (cut != null && i >= cut && !stop) await new Promise((r) => (rel = r)); if (stop || i >= chunks.length) return { done: true }; return { value: chunks[i++], done: false }; }, cancel: async () => { stop = true; rel && rel(); } }) } };
}
let seq = 0;
function reply({ text, tools = [], usage = {}, stop }) {
  const u = { input_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, ...usage };
  const ev = [{ type: 'message_start', message: { id: 'm' + ++seq, model: 'claude-sonnet-5-5', usage: u } }]; let idx = 0;
  if (text) { ev.push({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: idx++ }); }
  for (const t of tools) { ev.push({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: 'tu' + ++seq, name: t.name, input: {} } }, { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } }, { type: 'content_block_stop', index: idx++ }); }
  ev.push({ type: 'message_delta', delta: { stop_reason: stop || (tools.length ? 'tool_use' : 'end_turn') }, usage: { output_tokens: usage.out || 200 } }, { type: 'message_stop' });
  return ev;
}
const reqs = []; let script = [];
global.fetch = async (url, opts = {}) => { const body = opts.body ? JSON.parse(opts.body) : null; reqs.push(body); const s = script.shift(); if (!s) throw new Error('script empty'); return typeof s === 'function' ? s(body, opts) : sseRes(s); };
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js', '45_skills.gen.js', '50_tools.js', '60_agent.js'], { fetch: (...a) => global.fetch(...a) }, 'Chats, runTurn, submit, Pending, Ledger, Budget, compactHistory, estimatePrompt, stopRun, addLocal');
const { S, FS, Chats, submit, Pending, Ledger, Budget, compactHistory, estimatePrompt, stopRun, UI } = X;
(async () => {
  S.secrets.apiKey = 'k'; S.settings.budget.anchorUSD = 92.8571; S.settings.budget.anchorTs = 0;
  FS.set('CLAUDE.md', '# 규칙'); FS.set('lore/인물/린디웨.md', '# 린디웨\n협력팀장'); FS.set('docs/VOICES.md', '# V\n## 린디웨\n해요체');
  const streams = []; UI.stream = (l) => streams.push(l && { status: l.status, text: l.text, tools: l.tools.length });
  const chat = Chats.create();
  // 1) 스킬 켜고 다단계 도구 루프
  script = [
    reply({ text: '찾아볼게요.', tools: [{ name: 'search', input: { query: '린디웨 해요체' } }], usage: { cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 0 } } }),
    reply({ tools: [{ name: 'read_note', input: { name: 'VOICES', section: '린디웨' } }, { name: 'read_note', input: { name: '린디웨' } }], usage: { cache_read_input_tokens: 3000, input_tokens: 800 } }),
    reply({ tools: [{ name: 'write_note', input: { path: 'drafts/장면/장부.md', content: '## 주연: 린디웨\n## 본문\n세 잔', summary: '초안' } }], usage: { cache_read_input_tokens: 4000, input_tokens: 300 } }),
    reply({ text: '초안을 올렸어요.', usage: { cache_read_input_tokens: 4500, input_tokens: 200 }, stop: 'end_turn' }),
  ];
  let r = await submit(chat, '/장면 린디웨가 장부를 펴는 장면');
  eq(r.iters, 4); eq(r.stop, 'end_turn'); eq(chat.skill, '장면'); eq(reqs.length, 4);
  ok(reqs[0].system.length === 3 && reqs[0].system.every((b) => b.cache_control), '시스템 블록 3개 모두 캐시'); ok(reqs[0].system[2].text.includes('활성 스킬: 장면'));
  eq(reqs[0].tools.map((t) => t.name), ['search', 'read_note', 'list_notes', 'write_note', 'edit_note', 'lint']); eq(reqs[0].model, 'claude-sonnet-5-5');
  ok(!('temperature' in reqs[0]) && reqs[0].max_tokens === 8000);
  ok(JSON.stringify(reqs[0].system) === JSON.stringify(reqs[3].system), '턴 안에서 시스템 프롬프트 동일(캐시 유지)');
  const last = reqs[3].messages[reqs[3].messages.length - 1]; eq(last.role, 'user'); ok(last.content[last.content.length - 1].cache_control, '꼬리 캐시 표시');
  eq(reqs[1].messages.map((m) => m.role), ['user', 'assistant', 'user']); ok(reqs[1].messages[2].content[0].type === 'tool_result' && reqs[1].messages[2].content[0].tool_use_id === reqs[1].messages[1].content[1].id);
  eq(reqs[2].messages[reqs[2].messages.length - 1].content.length, 2, '병렬 도구 결과는 한 메시지에');
  eq(Pending.list().length, 1); ok(!FS.has('drafts/장면/장부.md'));
  const turns = Ledger.turns(); eq(turns.length, 1); eq(turns[0].iters, 4); eq(turns[0].tools, ['search', 'read_note', 'read_note', 'write_note']); ok(turns[0].cost > 0 && Math.abs(turns[0].cost - r.cost) < 1e-12);
  ok(streams.some((s) => s && s.status === 'stream') && streams[streams.length - 1] === null, '스트리밍 상태 전달');
  eq(S.run.busy, false); ok(chat.title.startsWith('린디웨'), chat.title);
  // 2) 로컬 명령은 무료
  const before = Ledger.total().cost; reqs.length = 0; r = await submit(chat, '/검색 린디웨'); eq(r.local, true); eq(reqs.length, 0); eq(Ledger.total().cost, before);
  // 3) 예산 한도 → API 호출 없이 중단
  Budget.calibrateUSD(0.3); r = await submit(chat, '또 해줘'); eq(r.stop, 'budget'); eq(reqs.length, 0); ok(chat.messages[chat.messages.length - 1].md.includes('예산 한도'));
  Budget.calibrateUSD(50);
  // 4) 중단 → 부분 사용량 기록
  const ev = reply({ text: '긴 답변을 쓰는 중입니다 '.repeat(30) }); script = [() => sseRes(ev, { cut: 6 })]; const n0 = Ledger.total().n; setTimeout(() => stopRun(), 40);
  r = await submit(chat, '길게 써줘'); eq(r.stop, 'abort'); eq(Ledger.total().n, n0 + 1); ok(S.ledger[S.ledger.length - 1].partial && S.ledger[S.ledger.length - 1].usage.input === 500, '중단해도 입력 토큰 기록');
  ok(chat.messages.some((m) => m.local && /중단/.test(m.md))); eq(S.run.busy, false);
  // 5) API 오류 → 안내만 남고 상태 복구
  script = [() => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { type: 'authentication_error', message: 'bad key' } }) })]; r = await submit(chat, '안녕'); eq(r.stop, 'error'); ok(/키/.test(r.error)); eq(S.run.busy, false);
  // 6) 도구 호출 횟수 한도 + 턴 비용 한도
  S.settings.maxIters = 2; script = [reply({ tools: [{ name: 'lint', input: { text: 'a' } }] }), reply({ tools: [{ name: 'lint', input: { text: 'a' } }] })]; r = await submit(chat, '계속'); eq(r.stop, 'iters'); eq(r.iters, 2);
  const lastA = chat.messages.filter((m) => !m.local); ok(lastA[lastA.length - 1].toolResults, '끝이 도구 결과면 다음 요청과 이어짐');
  S.settings.maxIters = 10; S.settings.budget.turnCapUSD = 0.0001; script = [reply({ tools: [{ name: 'lint', input: { text: 'a' } }], usage: { input_tokens: 5000 } }), reply({ text: '안 나옴' })]; r = await submit(chat, '비싼 일'); eq(r.stop, 'turncap'); S.settings.budget.turnCapUSD = 1;
  // 7) 입력 JSON 이 잘린 도구 호출
  script = [reply({ tools: [{ name: 'write_note', input: { path: 'drafts/x.md', content: 'abc' } }], stop: 'max_tokens' }), reply({ text: '다시', stop: 'end_turn' })]; reqs.length = 0; r = await submit(chat, '쓰기'); eq(r.iters, 2);
  const tr = reqs[1].messages[reqs[1].messages.length - 1].content[0]; ok(tr.is_error && /잘렸/.test(tr.content), 'max_tokens 로 잘린 tool_use 는 오류 결과');
  // 8) 긴 대화 정리
  const c2 = Chats.create(); for (let i = 0; i < 5; i++) { c2.messages.push({ role: 'user', content: [{ type: 'text', text: '질문' + i }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x' + i, name: 'write_note', input: { path: 'drafts/a.md', content: '가'.repeat(900) } }] }, { role: 'user', toolResults: true, content: [{ type: 'tool_result', tool_use_id: 'x' + i, content: '나'.repeat(2000) }] }, { role: 'assistant', content: [{ type: 'text', text: '답' + i }] }); }
  S.settings.trimAboveTokens = 100000; eq(compactHistory(c2), 0); S.settings.trimAboveTokens = 3000; S.settings.keepToolTurns = 2; ok(compactHistory(c2) > 0);
  const trimmed = c2.messages.filter((m) => m.toolResults).map((m) => m.content[0].trimmed ? 1 : 0); eq(trimmed, [1, 1, 1, 0, 0]); ok(c2.messages[1].content[0].input.content.startsWith('(생략')); eq(compactHistory(c2), 0, '재실행해도 변화 없음(멱등)');
  // 9) 사전 어림
  const est = estimatePrompt(chat, '테스트'); ok(est.total > 0 && est.costCold >= est.costWarm);
  console.log(`agent OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
