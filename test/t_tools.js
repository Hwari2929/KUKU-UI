const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };
const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js', '30_gh.js', '40_llm.js', '45_skills.gen.js', '50_tools.js'], {}, 'Pending, runTool, TOOL_DEFS, Skills, parseSlash, buildSystem, fileIndexText, toolsFor, parseSkill, ToolImpl, CORE_RULES, Budget, Ledger');
const { S, FS, Pending, runTool, Skills, parseSlash, buildSystem, toolsFor } = X;
(async () => {
  FS.set('CLAUDE.md', '# 규칙\n숫자는 아라비아 숫자');
  FS.set('lore/인물/린디웨.md', '# 린디웨\n협력팀장. [[비비안]] 과 친구. [[VOICES#린디웨]]');
  FS.set('lore/인물/비비안.md', '# 비비안\n작전반. 반말.');
  FS.set('lore/캠페인/1부.md', '# 1부\n[[린디웨]] 가 장부를 펴다');
  FS.set('docs/VOICES.md', ['# VOICES', ...Array.from({ length: 40 }, (_, i) => `## 인물${i}\n` + '말투 설명 '.repeat(120) + '\n### 세부'), '## 린디웨 (lindiwe)\n해요체, 느낌표 금지'].join('\n'));
  S.settings.readMaxChars = 3000;
  let r = await runTool('search', { query: '린디웨 해요체' }); ok(/docs\/VOICES\.md/.test(r.content) && /§/.test(r.content), r.content);
  r = await runTool('read_note', { name: '린디웨' }); ok(r.content.includes('협력팀장') && r.content.includes('← 역링크: lore/인물/비비안.md'.replace('비비안', '캠페인/1부').replace('인물/', '')) , r.content);
  r = await runTool('read_note', { name: 'VOICES' }); ok(r.content.includes('목차만') && r.content.includes('린디웨 (lindiwe)') && !r.content.includes('말투 설명 말투'), '큰 문서는 목차만');
  r = await runTool('read_note', { name: 'VOICES', section: '린디웨' }); ok(r.content.includes('해요체, 느낌표 금지') && r.content.length < 400, r.content);
  r = await runTool('read_note', { name: 'VOICES', section: '없는구획' }); ok(r.is_error && r.content.includes('목차'));
  FS.set('docs/긴글.md', '# 긴글\n## 본론\n' + '가나다라 '.repeat(1500)); r = await runTool('read_note', { name: '긴글', section: '본론' }); ok(r.content.includes('offset=3000'), '구획이 길면 이어 읽기 안내'); r = await runTool('read_note', { name: '긴글', section: '본론', offset: 3000 }); ok(r.content.includes('3000자부터') && r.content.includes('offset=6000'));
  r = await runTool('read_note', { name: 'VOICES', offset: 3000 }); ok(r.content.includes('3000자부터'));
  r = await runTool('read_note', { name: '없는이름' }); ok(r.is_error);
  r = await runTool('list_notes', { folder: 'lore' }); ok(r.content.includes('인물/') && r.content.includes('캠페인/'), r.content);
  // 쓰기: 거부 / 대기열 / 린트 / edit
  r = await runTool('write_note', { path: 'lore/인물/린디웨.md', content: 'x' }); ok(r.is_error && /쓰기 거부/.test(r.content), r.content);
  r = await runTool('write_note', { path: 'src/a.md', content: 'x' }); ok(r.is_error);
  r = await runTool('write_note', { path: 'drafts/장면/a.md', content: '세 잔을 마셨다', summary: '시험' }); ok(!r.is_error && /승인 대기열/.test(r.content) && /error 1/.test(r.content), r.content);
  ok(!FS.has('drafts/장면/a.md'), '승인 전에는 파일에 반영 안 됨'); eq(Pending.list().length, 1);
  r = await runTool('read_note', { name: 'drafts/장면/a.md' }); ok(r.content.includes('승인 대기') && r.content.includes('세 잔'));
  r = await runTool('edit_note', { path: 'drafts/장면/a.md', old: '세 잔', new: '3잔' }); ok(/린트: 문제 없음/.test(r.content), r.content); eq(Pending.list().length, 1); eq(Pending.get('drafts/장면/a.md').after, '3잔을 마셨다'); eq(Pending.get('drafts/장면/a.md').before, null);
  r = await runTool('edit_note', { path: 'drafts/장면/a.md', old: '없는말', new: 'x' }); ok(r.is_error);
  r = await runTool('edit_note', { path: 'drafts/장면/없음.md', old: 'a', new: 'x' }); ok(r.is_error);
  Pending.add({ path: 'drafts/b.md', after: 'aa aa', lint: {} }); r = await runTool('edit_note', { path: 'drafts/b.md', old: 'aa', new: 'x' }); ok(r.is_error && /2번/.test(r.content));
  ok(await Pending.approve(Pending.get('drafts/장면/a.md').id)); eq(FS.read('drafts/장면/a.md'), '3잔을 마셨다'); eq(S.snaps.length >= 1, true); Pending.reject(Pending.get('drafts/b.md').id); eq(Pending.list().length, 0);
  // 자동 승인: 에러 없을 때만
  S.settings.autoApprove = true; r = await runTool('write_note', { path: 'drafts/c.md', content: '정상 문장' }); ok(/자동 승인/.test(r.content) && FS.has('drafts/c.md'), r.content);
  r = await runTool('write_note', { path: 'drafts/d.md', content: '두 시에 만났다' }); ok(/대기열/.test(r.content) && !FS.has('drafts/d.md'), '린트 error 면 자동 승인 안 함'); S.settings.autoApprove = false; Pending.rejectAll();
  r = await runTool('lint', { text: '열두 개' }); ok(/error 1/.test(r.content));
  // 스킬 · 슬래시
  ok(Skills.names().includes('장면') && Skills.names().length === 7, Skills.names().join()); const sk = Skills.find('요약'); eq(sk.model, 'claude-haiku-5-5'); eq(sk.tools, ['search', 'read_note', 'list_notes']); eq(toolsFor(sk).map((t) => t.name), ['search', 'read_note', 'list_notes']);
  FS.set('studio/skills/장면.md', '---\nname: 장면\ndescription: 내 장면\n---\n내 규칙'); eq(Skills.find('장면').body, '내 규칙'); eq(Skills.find('장면').source, 'repo'); FS.remove('studio/skills/장면.md'); eq(Skills.find('장면').source, 'builtin');
  eq(parseSlash('/장면 린디웨 장부', {}).kind, 'skill'); eq(parseSlash('/장면 린디웨 장부', {}).rest, '린디웨 장부'); eq(parseSlash('/없음', {}).skill, ''); ok(parseSlash('/스킬', {}).md.includes('/장면')); ok(parseSlash('/검색 린디웨', {}).md.includes('lore/인물/린디웨.md')); ok(parseSlash('/린트 drafts/c.md', {}).md.includes('문제 없음')); eq(parseSlash('일반 문장', {}), null); ok(/알 수 없는/.test(parseSlash('/zzz', {}).md));
  ok(parseSlash('/예산', {}).md.includes('남음'));
  // 시스템 프롬프트
  const sys = buildSystem({ skill: '장면' }); eq(sys.blocks.length, 3); ok(sys.blocks.every((b) => b.cache)); ok(sys.blocks[0].text.includes('숫자는 아라비아 숫자') && sys.blocks[0].text.includes('[고정 문서: CLAUDE.md]')); ok(sys.blocks[1].text.includes('lore/인물/') && sys.blocks[1].text.includes('큰 문서 목차 docs/VOICES.md')); ok(sys.blocks[2].text.includes('활성 스킬: 장면'));
  const s1 = JSON.stringify(buildSystem({}).blocks), s2 = JSON.stringify(buildSystem({}).blocks); eq(s1 === s2, true);
  eq(buildSystem({}).blocks.length, 2); S.settings.includeIndex = false; eq(buildSystem({}).blocks.length, 1);
  console.log(`tools OK (${n} assertions)`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
