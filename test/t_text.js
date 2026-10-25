const load = require('./load');
const X = load(['00_util.js', '10_store.js', '20_text.js']);
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };

// ── 한글 수 표기
const t = (s) => X.findNumerals(s).map((x) => `${x.text}→${x.to}:${x.level}`);
eq(t('세 잔 마셨다'), ['세 잔→3잔:error']);
eq(t('새벽 두 시에 일어났다'), ['두 시→2시:error']);
eq(t('사흘 뒤에 오지'), ['사흘→3일:error']);
eq(t('열두 개'), ['열두 개→12개:error']);
eq(t('백열두 번째'), ['백열두 번째→112번째:error']);
eq(t('이십 분 걸렸다'), ['이십 분→20분:error']);
eq(t('한 번 더 해 보자'), []);
eq(t('한 잔 하자'), []);
eq(t('한두 번 해 봤어'), []);
eq(t('두세 개만'), []);
eq(t('두 분 모두 오셨네요'), []);
eq(t('한 개만 줘'), ['한 개→1개:warn']);
eq(t('첫 번째 줄'), []);
eq(t('셋째 줄을 봐'), ['셋째 줄→3번째 줄:warn']);
eq(t('스물한 살이야'), ['스물한 살→21살:error']);
eq(X.fixNumerals('세 잔과 사흘, 한 번 더. 두 시간'), '3잔과 3일, 한 번 더. 2시간');
eq(t('이 일은 내가 한다'), []);
eq(t('네 말이 맞아'), []);

// ── 린트: 장면
const scene = [
  '## 주연: 린디웨, 비비안', '', '## 본문',
  '{bg=bar bgm=calm} 문이 열린다.', ...Array.from({ length: 16 }, (_, i) => `린디웨 {L smile}: 대사 ${i + 1}번이에요.`), '[조연]', '린디웨 (속마음): 하나', '린디웨 (속마음): 둘',
  '', '## 조연 비비안', '비비안: 안녕!', '비비안: 왔어?', '', '## 결과 0', '린디웨: "따옴표 대사"',
].join('\n');
const is = X.lintText(scene, { path: 'x.md' }); const rules = is.map((i) => i.rule);
ok(rules.includes('scene-think'), 'think'); ok(rules.includes('scene-subs'), 'subs'); ok(rules.includes('scene-after-len'), 'after'); ok(rules.includes('scene-quote'), 'quote');
ok(!rules.includes('scene-slot'), 'slot ok'); ok(!rules.includes('scene-bg'), 'bg ok'); ok(!rules.includes('scene-len'), 'len ok');

// ── 린트: 확장 문서
X.FS.set('src/data/scenes/a.ts', "S('lindiwe', '장부부터 펴요')");
X.FS.set('lore/인물/린디웨.md', '# 린디웨\n원본');
const ext = [
  '원본 시트: [[린디웨]]', '금지 설정: 연인, 가족사', '', '## 항목',
  '- 매주 네일을 바꾼다 〔관계: 원본 확장〕 〔출처: src/data/scenes/a.ts 「장부부터 펴요」〕',
  '- 연인이 있다 〔관계: 새 설정〕 〔출처: src/data/scenes/a.ts 「장부부터 펴요」〕',
  '- 고양이를 키운다 〔관계: 몰라〕 〔출처: src/data/scenes/a.ts 「없는 문구」〕',
  '- 그냥 적음 〔관계: 새 설정〕',
].join('\n');
const ei = X.lintText(ext, { path: 'lore/인물/확장/린디웨.md' });
const er = ei.map((i) => `${i.line}:${i.rule}`);
ok(!er.some((x) => x.startsWith('5:')), '5행 정상: ' + er); ok(er.includes('6:ext-forbidden'), '금지어'); ok(er.includes('7:ext-rel'), '관계'); ok(er.includes('7:ext-quote'), '문구'); ok(er.includes('8:ext-src'), '출처');

// ── diff / merge3
const base = ['a', 'b', 'c', 'd', 'e'].join('\n');
let r = X.merge3(base, ['a', 'B', 'c', 'd', 'e'].join('\n'), ['a', 'b', 'c', 'd', 'E'].join('\n'));
eq(r.conflicts, 0); eq(r.text, ['a', 'B', 'c', 'd', 'E'].join('\n'));
r = X.merge3(base, ['a', 'X', 'c', 'd', 'e'].join('\n'), ['a', 'Y', 'c', 'd', 'e'].join('\n'));
eq(r.conflicts, 1); ok(r.text.includes('<<<<<<<'));
eq(X.resolveSegs(r.segs, ['theirs']), ['a', 'Y', 'c', 'd', 'e'].join('\n'));
eq(X.resolveSegs(r.segs, ['both']), ['a', 'X', 'Y', 'c', 'd', 'e'].join('\n'));
r = X.merge3(base, ['a', 'b', 'c', 'd', 'e', 'f'].join('\n'), ['0', 'a', 'b', 'c', 'd', 'e'].join('\n'));
eq(r.conflicts, 0); eq(r.text, ['0', 'a', 'b', 'c', 'd', 'e', 'f'].join('\n'));
const st = X.diffStat('a\nb\nc', 'a\nB\nc\nd'); eq(st, { add: 2, del: 1 });
ok(X.diffHTML('a\nb', 'a\nb').includes('변경 없음'));
ok(X.diffHTML('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nZ').includes('생략'));
// 큰 파일 성능
const big1 = Array.from({ length: 3000 }, (_, i) => 'line ' + i).join('\n'); const big2 = big1.replace('line 1500', 'LINE').replace('line 10\n', 'x\ny\n');
const t0 = Date.now(); X.merge3(big1, big2, big1.replace('line 2900', 'Z')); ok(Date.now() - t0 < 1500, 'perf ' + (Date.now() - t0));

// ── 구획 · 검색 · 링크
const voices = ['# VOICES', '## 운영반', '### 린디웨 (lindiwe) — 협력팀장', '- 말투: 해요체', '- 금지: 느낌표', '### 예레나 (yelena) — 대외협력', '- 말투: 사무적', '## 작전반', '### 비비안 (vivian)', '- 반말'].join('\n');
X.FS.set('docs/VOICES.md', voices);
const sec = X.sectionOf(voices, '린디웨'); ok(sec.h && sec.text.includes('해요체') && !sec.text.includes('예레나'), 'section');
eq(X.sectionOf(voices, 'yelena').h.title.startsWith('예레나'), true);
eq(X.sectionOf(voices, '운영반').text.includes('예레나'), true);
X.FS.set('lore/인물/비비안.md', '# 비비안\n린디웨와 [[린디웨]] 친구. ![[틀-에란테스]] [[없는문서|별칭]] [[VOICES#비비안]]');
X.IDX.dirty = true;
eq(X.resolveName('린디웨').path, 'lore/인물/린디웨.md');
eq(X.resolveName('VOICES').path, 'docs/VOICES.md');
eq(X.backlinksOf('lore/인물/린디웨.md'), ['lore/인물/비비안.md']);
const lk = X.linksOf('lore/인물/비비안.md'); eq(lk.length, 4); eq(lk.find((l) => l.target === '없는문서').path, null); eq(lk.find((l) => l.target === 'VOICES').heading, '비비안');
const sr = X.searchNotes('린디웨 해요체'); ok(sr[0].path === 'docs/VOICES.md' || sr[0].path === 'lore/인물/린디웨.md', 'search ' + sr.map((s) => s.path)); ok(sr.find((s) => s.path === 'docs/VOICES.md').snips[0].section.includes('린디웨'), 'snippet section');

// ── 쓰기 규칙
ok(X.canWrite('lore/인물/확장/린디웨.md').ok); ok(!X.canWrite('lore/인물/린디웨.md').ok); ok(!X.canWrite('lore/세력/페트라.md').ok); ok(!X.canWrite('docs/SCENES.md').ok); ok(X.canWrite('drafts/a.md').ok); ok(!X.canWrite('../x.md').ok); ok(!X.canWrite('src/a.md').ok); ok(!X.canWrite('drafts/a.exe').ok);

// ── 마크다운
const html = X.renderMd('# 제목\n\n**굵게** 와 `코드 [[x]]` 그리고 [[린디웨#말투|별칭]]\n\n- a\n- b\n\n```scene\n## 본문\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
ok(html.includes('<h2') && html.includes('<b>굵게</b>') && html.includes('data-wl="린디웨"') && html.includes('class="codeblk"') && html.includes('<table>'), html);
ok(!html.includes('<script'), 'xss'); ok(X.renderMd('<script>alert(1)</script>').includes('&lt;script&gt;'));
console.log(`text OK (${n} assertions)`);
