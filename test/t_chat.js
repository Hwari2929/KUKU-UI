// 질문·답변 수정 / 삭제 / 다시 생성(원래 답 보관) 로직 테스트
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
const enc = new TextEncoder();
function sseRes(events) { const bytes = enc.encode(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')); let i = 0; return { ok: true, status: 200, headers: new Map(), body: { getReader: () => ({ read: async () => (i++ === 0 ? { value: bytes, done: false } : { done: true }), cancel: async () => {} }) } }; }
let seq = 0;
function reply({ text, tools = [], stop }) {
  const ev = [{ type: 'message_start', message: { id: 'm' + ++seq, model: 'claude-sonnet-5-5', usage: { input_tokens: 500, output_tokens: 1 } } }]; let idx = 0;
  if (text) ev.push({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: idx++ });
  for (const t of tools) ev.push({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: 'tu' + ++seq, name: t.name, input: {} } }, { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } }, { type: 'content_block_stop', index: idx++ });
  ev.push({ type: 'message_delta', delta: { stop_reason: stop || (tools.length ? 'tool_use' : 'end_turn') }, usage: { output_tokens: 100 } }, { type: 'message_stop' });
  return ev;
}
const reqs = []; let script = [];
global.fetch = async (url, opts = {}) => { reqs.push(opts.body ? JSON.parse(opts.body) : null); const s = script.shift(); if (!s) throw new Error('script empty'); return sseRes(s); };
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js', '45_skills.gen.js', '50_tools.js', '60_agent.js'], { fetch: (...a) => global.fetch(...a) }, 'Chats, runTurn, submit, regenerate, chatLocked, isUserInput');
const { S, FS, Chats, submit, regenerate, chatLocked, UI } = X;
const txt = (m) => Chats.textOf(m);
const shape = (c) => c.messages.map((m) => (m.local ? 'L' : m.toolResults ? 'R' : m.role === 'user' ? 'U' : 'A')).join('');
(async () => {
  S.secrets.apiKey = 'k'; S.settings.budget.anchorUSD = 100; S.settings.budget.anchorTs = 0; FS.set('CLAUDE.md', '# 규칙'); UI.stream = () => {};
  const toasts = []; UI.toast = (m) => toasts.push(m);
  const chat = Chats.create();
  // 두 턴: 1턴은 도구를 쓰는 응답(A R A), 2턴은 한 번에 답
  script = [reply({ text: '찾아볼게요.', tools: [{ name: 'list_notes', input: {} }] }), reply({ text: '첫 답입니다.' }), reply({ text: '둘째 답입니다.' })];
  await submit(chat, '첫 질문'); await submit(chat, '둘째 질문');
  eq(shape(chat), 'UARAUA');
  // turnAt / lastTurn
  eq(Chats.turnAt(chat, 2), { inp: 0, from: 1, to: 4, real: true }); eq(Chats.turnAt(chat, 5), { inp: 4, from: 5, to: 6, real: true }); eq(Chats.lastTurn(chat).inp, 4);
  // 수정: 질문, 답변(도구 호출 블록 유지)
  ok(Chats.editText(chat, 0, '첫 질문 (고침)') && txt(chat.messages[0]) === '첫 질문 (고침)' && chat.messages[0].edited);
  ok(Chats.editText(chat, 1, '다른 말') && txt(chat.messages[1]) === '다른 말' && chat.messages[1].content.some((b) => b.type === 'tool_use'), '도구 블록은 그대로'); eq(chat.messages[1].content[0].type, 'text');
  ok(!Chats.editText(chat, 0, '   '), '빈 내용은 거부'); ok(!Chats.editText(chat, 2, 'x'), '도구 결과는 수정 불가'); ok(txt(chat.messages[0]) === '첫 질문 (고침)');
  ok(!Chats.editText(chat, 99, 'x'));
  // 다시 생성: 같은 맥락·같은 질문, 원래 답은 보관
  const before = chat.messages.slice(0, 4).map((m) => JSON.stringify(m)); const oldReply = chat.messages[5];
  script = [reply({ text: '둘째 답, 다른 버전.' })]; reqs.length = 0;
  let r = await regenerate(chat);
  eq(shape(chat), 'UARAUA'); ok(txt(chat.messages[5]) === '둘째 답, 다른 버전.'); eq(chat.messages.slice(0, 4).map((m) => JSON.stringify(m)), before, '앞 맥락 그대로');
  eq(reqs.length, 1); eq(reqs[0].messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']); ok(JSON.stringify(reqs[0].messages[4]).includes('둘째 질문'), '같은 질문으로 호출'); ok(!JSON.stringify(reqs[0]).includes('둘째 답입니다'), '이전 답은 맥락에 안 들어감');
  const inp = chat.messages[4]; eq(inp.vers.length, 2); eq(inp.vi, 1); ok(inp.vers[1] === null && txt(inp.vers[0][0]) === '둘째 답입니다.', '원래 답 보관'); ok(inp.vers[0][0] === oldReply);
  eq(shape(chat).length, 6, '질문이 두 번 생기지 않음');
  // 한 번 더 → 3개
  script = [reply({ text: '세 번째.' })]; await regenerate(chat); eq(chat.messages[4].vers.length, 3); eq(chat.messages[4].vi, 2); eq(chat.messages[4].vers.map((v) => v && txt(v[0])), ['둘째 답입니다.', '둘째 답, 다른 버전.', null]);
  // 넘겨 보기
  ok(Chats.switchVer(chat, 0) && txt(chat.messages[5]) === '둘째 답입니다.' && chat.messages[4].vi === 0 && chat.messages[4].vers[0] === null && txt(chat.messages[4].vers[2][0]) === '세 번째.');
  ok(Chats.switchVer(chat, 2) && txt(chat.messages[5]) === '세 번째.'); ok(!Chats.switchVer(chat, 2), '같은 번호'); ok(!Chats.switchVer(chat, 7), '범위 밖'); ok(Chats.switchVer(chat, 1) && txt(chat.messages[5]) === '둘째 답, 다른 버전.'); eq(shape(chat), 'UARAUA');
  // 저장본과 새로 읽은 것이 같다 (JSON 왕복)
  const round = JSON.parse(JSON.stringify(chat)); ok(Chats.switchVer(round, 0) && txt(round.messages[5]) === '둘째 답입니다.', '저장 후에도 전환');
  // 다시 생성 중 오류 → 새 묶음엔 안내만, 원래 답은 보관본으로 돌아갈 수 있음
  script = []; await regenerate(chat); ok(chat.messages[5].local && chat.messages[5].kind === 'error', '오류 안내'); eq(chat.messages[4].vers.length, 4); ok(Chats.switchVer(chat, 1) && txt(chat.messages[5]) === '둘째 답, 다른 버전.'); ok(chat.messages[4].vers[3].length === 1);
  // 실행 중에는 잠금
  S.run = { busy: true, abort: null, chatId: chat.id }; ok(chatLocked(chat) !== ''); toasts.length = 0; eq(await regenerate(chat), null); ok(toasts.length === 1); S.run = { busy: false, abort: null, chatId: null }; eq(chatLocked(chat), '');
  // 응답 삭제: 마지막 턴에 보관본이 있으면 하나가 대신 나타남
  const k = chat.messages[4].vers.length; ok(Chats.deleteReply(chat, 5)); eq(chat.messages[4].vers.length, k - 1); ok(chat.messages[5] && !chat.messages[5].local || chat.messages[5].local); eq(shape(chat).startsWith('UARAU'), true);
  while (chat.messages[4].vers) Chats.deleteReply(chat, 5);   // 보관본이 하나만 남으면 보관 정보가 정리되고 그 응답이 그대로 남음
  eq(shape(chat), 'UARAUA'); ok(Chats.deleteReply(chat, 5));
  eq(shape(chat), 'UARAU'); ok(!('vers' in chat.messages[4]) && !('vi' in chat.messages[4]), '보관 정보 정리');
  // 응답이 없는 질문에서 "답 받기" → 보관할 것 없이 그냥 받음
  script = [reply({ text: '새로 받은 답.' })]; await regenerate(chat); eq(shape(chat), 'UARAUA'); ok(!chat.messages[4].vers); ok(txt(chat.messages[5]) === '새로 받은 답.');
  // 중간 턴 응답 삭제: 도구 호출/결과 쌍이 함께 지워져 API 요청이 유효함
  ok(Chats.deleteReply(chat, 2)); eq(shape(chat), 'UUA'); script = [reply({ text: '이어서.' })]; await submit(chat, '셋째 질문'); const roles = reqs[reqs.length - 1].messages; ok(roles.every((m) => m.role === 'user' || m.role === 'assistant')); ok(!JSON.stringify(roles).includes('tool_result'), '짝 잃은 도구 결과 없음');
  // 중간 턴에 보관본이 있으면 응답 삭제 때 버림
  const c2 = Chats.create(); script = [reply({ text: 'a1' }), reply({ text: 'a1b' }), reply({ text: 'a2' })]; await submit(c2, 'q1'); await regenerate(c2); await submit(c2, 'q2'); eq(c2.messages[0].vers.length, 2); ok(!Chats.switchVer(c2, 0), '중간 턴은 바꿔 끼울 수 없음'); eq(Chats.lastTurn(c2).inp, 2);
  ok(Chats.deleteReply(c2, 1)); ok(!('vers' in c2.messages[0])); eq(shape(c2), 'UUA');
  // 질문 삭제: 질문+응답 전부
  const c3 = Chats.create(); script = [reply({ text: 'x1', tools: [{ name: 'list_notes', input: {} }] }), reply({ text: 'x1done' }), reply({ text: 'x2' })]; await submit(c3, 'p1'); await submit(c3, 'p2'); eq(shape(c3), 'UARAUA');
  ok(Chats.deleteTurn(c3, 0)); eq(shape(c3), 'UA'); ok(txt(c3.messages[0]) === 'p2'); ok(Chats.deleteTurn(c3, 1)); eq(shape(c3), '');   // 응답 위치를 줘도 그 턴 전체
  ok(!Chats.deleteTurn(c3, 0)); ok(Chats.lastTurn(c3) === null && !(await regenerate(c3)));
  // 슬래시 명령(로컬)은 턴 경계지만 "마지막 질문"이 아님
  const c4 = Chats.create(); script = [reply({ text: 'r' })]; await submit(c4, '질문'); await submit(c4, '/예산'); ok(c4.messages[c4.messages.length - 2].local); ok(Chats.lastTurn(c4) === null, '로컬 명령이 마지막이면 다시 생성 없음');
  console.log(`chat OK (${n} assertions)`);
})().catch((e) => { console.error(e); process.exit(1); });
