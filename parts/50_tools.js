/* ═══════════ 50 · 에이전트 도구 · 승인 대기열 · 스킬 · 시스템 프롬프트 · 슬래시 명령 ═══════════ */

/* ── 승인 대기열: AI 가 쓴 내용은 여기에 쌓이고, 사용자가 승인해야 파일에 반영된다 ── */
const Pending = {
  list() { return S.pending; },
  get(path) { return S.pending.find((p) => p.path === path); },
  view(path) { const p = this.get(path); return p ? p.after : FS.read(path); },
  add({ path, after, summary, chatId, lint }) {
    let p = this.get(path);
    if (p) { p.after = after; p.summary = summary || p.summary; p.ts = Date.now(); p.lint = lint; }
    else { p = { id: uid('p'), path, before: FS.read(path), after, summary: summary || '', chatId: chatId || '', ts: Date.now(), lint }; S.pending.push(p); }
    savePending(); UI.pending(); return p;
  },
  async approve(id) {
    const i = S.pending.findIndex((p) => p.id === id); if (i < 0) return false;
    const p = S.pending[i]; await FS.apply([{ path: p.path, after: p.after }], `AI 쓰기 승인: ${p.path}`);
    S.pending.splice(i, 1); savePending(); UI.pending(); return true;
  },
  async approveAll() { const ids = S.pending.map((p) => p.id); for (const id of ids) await this.approve(id); return ids.length; },
  reject(id) { const i = S.pending.findIndex((p) => p.id === id); if (i < 0) return false; S.pending.splice(i, 1); savePending(); UI.pending(); return true; },
  rejectAll() { S.pending.length = 0; savePending(); UI.pending(); },
  stale(p) { return (FS.read(p.path) ?? null) !== (p.before ?? null); },   // 대기열에 올린 뒤 원본이 바뀌었는지
};

/* ── 도구 정의 (짧게 — 매 호출마다 입력 토큰으로 들어간다. 캐시되므로 읽기 비용만 든다) ── */
const TOOL_DEFS = [
  { name: 'search', description: '노트 전체에서 키워드 검색(공백=AND). 경로·크기·일치 구획·발췌를 돌려준다.', input_schema: { type: 'object', properties: { query: { type: 'string' }, folder: { type: 'string', description: '이 폴더 경로로 시작하는 파일만' }, limit: { type: 'integer', description: '기본 8, 최대 15' } }, required: ['query'] } },
  { name: 'read_note', description: '노트를 읽는다. name 은 파일명/경로/위키링크 이름. 큰 문서는 목차만 돌려주므로 section(구획 제목)으로 필요한 부분만 읽는다. 끝에 연결된 문서(링크/역링크)가 표시된다.', input_schema: { type: 'object', properties: { name: { type: 'string' }, section: { type: 'string', description: '헤딩 제목(부분 일치)' }, offset: { type: 'integer', description: '긴 본문 이어 읽기 시작 글자 위치' } }, required: ['name'] } },
  { name: 'list_notes', description: '폴더 안의 파일/하위 폴더 목록(크기 포함). folder 를 비우면 최상위.', input_schema: { type: 'object', properties: { folder: { type: 'string' } } } },
  { name: 'write_note', description: '노트를 통째로 쓴다(새 파일 또는 전체 교체). 허용 폴더에만 가능하며 사용자 승인 후 반영된다. 결과에 린트가 나오니 error 는 고친다. 일부만 바꿀 땐 edit_note.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, summary: { type: 'string', description: '무엇을 왜 썼는지 한 줄' } }, required: ['path', 'content'] } },
  { name: 'edit_note', description: '노트의 일부를 바꾼다: old 문자열(파일 안에 정확히 1번 있어야 함)을 new 로 치환. 대기 중인 초안이 있으면 그 위에서 적용된다.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, summary: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'lint', description: '무료 로컬 점검: 한글 수 표기, 장면 구조, 확장 문서 형식. path 의 파일(대기 초안 포함) 또는 text 를 검사한다.', input_schema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } } } },
];

function clipList(arr, n, more = '…') { return arr.length > n ? arr.slice(0, n).concat([`${more} (${arr.length - n}개 더)`]) : arr; }
const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

function lintBrief(text, path) {
  const is = lintText(text, { path }); const sm = lintSummary(is);
  return { is, sm, text: is.length ? `린트: error ${sm.error} / warn ${sm.warn}\n` + lintReport(clipList(is, 14)) : '린트: 문제 없음' };
}

const ToolImpl = {
  search(inp) {
    const limit = Math.min(15, Math.max(1, inp.limit || 8)); const r = searchNotes(String(inp.query || ''), { folder: normPath(inp.folder || ''), limit });
    if (!r.length) return '검색 결과 없음. 다른 키워드로 시도하거나 list_notes 로 폴더를 확인하세요.';
    return r.map((x, i) => `${i + 1}. ${x.path} (${kfmt(x.size)}자)\n` + x.snips.map((s) => `   ${s.section ? '§' + s.section + ' — ' : ''}${s.text}`).join('\n')).join('\n');
  },
  read_note(inp) {
    const nm = normPath(String(inp.name || '')); const rn = Pending.get(nm) ? { path: nm } : resolveName(String(inp.name || ''));   // 아직 승인 안 된 새 파일도 읽을 수 있게
    if (!rn.path) { if (rn.candidates) return { text: `이름이 모호함. 후보:\n- ${rn.candidates.join('\n- ')}`, err: true }; return { text: `"${inp.name}" 을(를) 찾을 수 없음. search 로 먼저 찾으세요.`, err: true }; }
    const path = rn.path; const pend = Pending.get(path); const text = Pending.view(path) ?? ''; const max = S.settings.readMaxChars;
    const tag = pend ? ' [승인 대기 중인 초안 내용]' : '';
    const head = `📄 ${path} (${kfmt(text.length)}자)${tag}${rn.ambiguous ? `\n(같은 이름 후보: ${rn.ambiguous.join(', ')})` : ''}`;
    const links = () => { const o = [...new Set(linksOf(path).filter((l) => l.path).map((l) => l.path))]; const b = backlinksOf(path); return (o.length ? `\n→ 링크: ${clipList(o, 12).join(', ')}` : '') + (b.length ? `\n← 역링크: ${clipList(b, 12).join(', ')}` : ''); };
    if (inp.section) {
      const s = sectionOf(text, inp.section);
      if (!s.h) return { text: `${head}\n"${inp.section}" 구획을 찾지 못함. 목차:\n` + clipList(s.ol.map((h) => `${'  '.repeat(h.lvl - 1)}${h.title}`), 60).join('\n'), err: true };
      const off = Math.max(0, inp.offset || 0); const body = s.text.slice(off, off + max); const more = s.text.length > off + max;
      return `${head}\n§ ${s.h.title} (${kfmt(s.text.length)}자${off ? `, ${off}자부터` : ''})${s.others.length ? `\n(비슷한 구획: ${s.others.join(', ')})` : ''}\n---\n${body}${more ? `\n---\n[이 구획이 더 있음: section 같게 offset=${off + max}]` : ''}`;
    }
    if (text.length <= max || inp.offset) {
      const off = Math.max(0, inp.offset || 0); const body = text.slice(off, off + max); const more = text.length > off + max;
      return `${head}${off ? ` — ${off}자부터` : ''}\n---\n${body}${more ? `\n---\n[더 있음: offset=${off + max}]` : ''}${off ? '' : links()}`;
    }
    const ol = outlineOf(text);
    return `${head}\n문서가 커서 목차만 보여줍니다. section 에 구획 제목을 넣어 읽으세요 (또는 offset 으로 이어 읽기).\n---\n` + clipList(ol.map((h) => `${'  '.repeat(Math.min(h.lvl - 1, 4))}${h.title} (${kfmt(h.size)})`), 90).join('\n') + links();
  },
  list_notes(inp) {
    let f = normPath(inp.folder || ''); if (f && !f.endsWith('/')) f += '/';
    const dirs = new Map(), files = [];
    for (const p of FS.paths()) { if (!p.startsWith(f)) continue; const rest = p.slice(f.length); const i = rest.indexOf('/'); if (i < 0) files.push(p); else { const d = rest.slice(0, i); dirs.set(d, (dirs.get(d) || 0) + 1); } }
    if (!dirs.size && !files.length) return `"${f || '/'}" 아래에 파일이 없음.`;
    const out = [`📁 ${f || '/'}`]; for (const [d, n] of [...dirs].sort()) out.push(`  ${d}/  (${n}개)`);
    for (const p of clipList(files, 80)) out.push(typeof p === 'string' && FS.has(p) ? `  ${baseName(p)}  (${kfmt((FS.read(p) || '').length)}자)` : `  ${p}`);
    return out.join('\n');
  },
  write_note(inp, ctx) { return ToolImpl._write(inp, ctx, normPath(inp.path), String(inp.content ?? ''), 'write'); },
  edit_note(inp, ctx) {
    const path = normPath(inp.path); const base = Pending.view(path);
    if (base == null) return { text: `${path} 파일이 없음. 새로 만들려면 write_note 를 쓰세요.`, err: true };
    const old = String(inp.old ?? ''); if (!old) return { text: 'old 가 비어 있음', err: true };
    const cnt = base.split(old).length - 1;
    if (cnt === 0) return { text: 'old 문자열이 파일에 없음 (공백·줄바꿈까지 정확히 일치해야 함). read_note 로 현재 내용을 다시 확인하세요.', err: true };
    if (cnt > 1) return { text: `old 문자열이 ${cnt}번 나옴. 앞뒤 문맥을 더 넣어 한 군데만 가리키게 하세요.`, err: true };
    return ToolImpl._write(inp, ctx, path, base.replace(old, () => String(inp.new ?? '')), 'edit');
  },
  _write(inp, ctx, path, content, kind) {
    const cw = canWrite(path); if (!cw.ok) return { text: `쓰기 거부: ${cw.why}`, err: true };
    if (content.length > 80000) return { text: `내용이 너무 큼(${content.length}자). 나누어 쓰세요.`, err: true };
    if (kind === 'write' && !content.trim()) return { text: '내용이 비어 있음', err: true };
    const cur = FS.read(path); const lint = lintBrief(content, path);
    if (cur === content && !Pending.get(path)) return '변경 사항이 없음.';
    const summary = String(inp.summary || '').slice(0, 120);
    if (S.settings.autoApprove && lint.sm.error === 0) {
      Pending.reject(Pending.get(path)?.id);
      return FS.apply([{ path, after: content }], `AI 쓰기: ${path}`).then(() => `저장됨(자동 승인): ${path} (${kfmt(content.length)}자)\n${lint.text}`);
    }
    Pending.add({ path, after: content, summary, chatId: ctx && ctx.chatId, lint: lint.sm });
    return `승인 대기열에 올림: ${path} (${cur == null ? '새 파일' : '수정'}, ${kfmt(content.length)}자). 사용자가 승인하면 반영됩니다.\n${lint.text}${lint.sm.error ? '\nerror 가 있으니 edit_note 로 고쳐 같은 경로에 다시 올리세요.' : ''}`;
  },
  lint(inp) {
    let text = inp.text, path = normPath(inp.path || '');
    if (text == null) { if (!path) return { text: 'path 또는 text 가 필요함', err: true }; text = Pending.view(path); if (text == null) return { text: `${path} 없음`, err: true }; }
    return lintBrief(text, path).text;
  },
};
// 도구 실행. 반환: { content:string, is_error?:bool }
async function runTool(name, input, ctx = {}) {
  const fn = ToolImpl[name]; if (!fn || name.startsWith('_')) return { content: `알 수 없는 도구: ${name}`, is_error: true };
  try {
    let r = await fn(input || {}, ctx);
    if (r && typeof r === 'object') return { content: String(r.text), is_error: !!r.err };
    return { content: String(r) };
  } catch (e) { return { content: `도구 오류: ${e && e.message || e}`, is_error: true }; }
}
const TOOL_TOKENS = () => estTokens(JSON.stringify(TOOL_DEFS));

/* ── 스킬: 내장 + 리포의 studio/skills/*.md (같은 이름이면 리포 것이 우선) ──
   형식: --- name/description/model/tools --- 뒤에 지시문 */
function parseSkill(text, path) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); const meta = {}; let body = String(text);
  if (m) { body = m[2]; for (const ln of m[1].split(/\r?\n/)) { const k = ln.match(/^(\w+)\s*:\s*(.*)$/); if (k) meta[k[1]] = k[2].trim(); } }
  const name = (meta.name || baseName(path || 'skill').replace(/\.md$/i, '')).trim();
  return { name, description: meta.description || '', model: meta.model || '', tools: meta.tools ? meta.tools.split(/[,\s]+/).filter(Boolean) : null, body: body.trim(), path: path || '', source: path ? 'repo' : 'builtin' };
}
const Skills = {
  all() {
    const m = new Map();
    for (const [n, t] of Object.entries(typeof DEFAULT_SKILLS === 'object' ? DEFAULT_SKILLS : {})) { const s = parseSkill(t, ''); m.set(s.name, s); }
    for (const p of FS.paths()) if (/^studio\/skills\/[^/]+\.md$/.test(p)) { const s = parseSkill(FS.read(p), p); if (s.body) m.set(s.name, s); }
    return m;
  },
  find(name) { return this.all().get(name) || null; },
  names() { return [...this.all().keys()]; },
};
function toolsFor(skill) {
  if (!skill || !skill.tools) return TOOL_DEFS;
  const set = new Set(skill.tools); const t = TOOL_DEFS.filter((d) => set.has(d.name)); return t.length ? t : TOOL_DEFS;
}

/* ── 시스템 프롬프트 ──
   캐시 순서: 도구 → [핵심 규칙+고정 문서] → [파일 색인] → [스킬] → 대화.
   앞쪽일수록 잘 안 바뀌게 두어야 캐시가 길게 적중한다. 날짜·시간 같은 변하는 값은 넣지 않는다. */
const CORE_RULES = `당신은 'ERTES' 프로젝트(Obsidian 방식 세계관 문서 + ADV 캠페인 스크립트)의 집필·설정 보조자입니다. 사용자는 한국어로 대화하며, 답변과 문서도 한국어로 씁니다.

[일하는 방식]
- 문서는 지식 저장소입니다. 설정에 대한 사실은 추측하지 말고 search → read_note 로 확인한 뒤 말합니다. 근거는 "경로 § 구획" 으로 밝힙니다. 읽지 않은 것은 읽지 않았다고 말합니다.
- 큰 문서(수십 KB 이상)는 통째로 읽지 말고 목차를 본 뒤 section 으로 필요한 부분만 읽습니다. 같은 문서를 반복해서 읽지 않습니다.
- 도구 호출은 필요한 만큼만 합니다 (입력 토큰이 곧 비용입니다). 여러 문서를 읽을 땐 한 번에 나란히 호출합니다.
- 파일 쓰기는 write_note / edit_note 로만 합니다. 결과는 사용자의 승인을 거쳐 반영됩니다. 린트 error 는 직접 고칩니다. 쓴 뒤 본문 전체를 답변에 다시 붙이지 않고, 무엇을 만들었는지만 짧게 알립니다.
- 원본 설정 문서(인물 시트·세력·지역·틀)는 수정할 수 없습니다. 새 설정은 확장 문서나 drafts/ 에 적습니다. 정말 모호한 갈림길에서만 질문하고, 질문은 한 번에 하나만 합니다.

[글쓰기 규칙]
- 수는 아라비아 숫자로 씁니다 (3잔, 2시간, 12개). "한 번 더", "한 잔 하자", "한두 번", "두세 개" 같은 관용 표현은 그대로 둡니다.
- 대사는 따옴표 없이 자연스러운 구어체 한국어로 씁니다. 인물별 말투는 말투 문서에서 확인합니다.
- 바(bar)는 함대(fleet)가 아닙니다. {pc} 는 레이첼입니다.
- 속마음은 장면당 0~1줄, 장면 본문은 15~25줄이 기본입니다.`;

function fileIndexText() {
  const cap = 14000; const byDir = new Map();
  for (const p of FS.paths()) { if (!isMd(p) || /^studio\/skills\//.test(p)) continue; const i = p.lastIndexOf('/'); const d = i < 0 ? '(루트)' : p.slice(0, i + 1); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(p); }
  const lines = []; let total = 0;
  for (const [d, ps] of [...byDir].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
    const items = ps.map((p) => { const n = (FS.read(p) || '').length; return `${titleOf(p)}${n >= 3000 ? `(${kfmt(n)})` : ''}`; });
    const ln = `${d} [${ps.length}] ` + items.join(', '); lines.push(ln); total += ln.length;
  }
  // 큰 문서는 3단계까지의 헤딩을 붙여서 곧바로 section 으로 갈 수 있게 함
  const big = FS.paths().filter((p) => isMd(p) && (FS.read(p) || '').length > S.settings.readMaxChars * 2 && !/^studio\/skills\//.test(p)).slice(0, 6);
  for (const p of big) {
    const hs = outlineOf(FS.read(p)).filter((h) => h.lvl <= 3).map((h) => h.title); let s = ''; for (const h of hs) { if (s.length + h.length > 1600) { s += ' …'; break; } s += (s ? ' | ' : '') + h; }
    const ln = `큰 문서 목차 ${p}: ${s}`; lines.push(ln); total += ln.length;
  }
  let out = lines.join('\n'); if (out.length > cap) out = out.slice(0, cap) + '\n… (색인이 길어 일부 생략 — list_notes / search 로 확인)';
  return out;
}
function buildSystem(chat) {
  const blocks = [];
  let core = CORE_RULES;
  for (const p of S.settings.pinned || []) { const t = FS.read(p); if (t) core += `\n\n[고정 문서: ${p}]\n${t.length > 24000 ? t.slice(0, 24000) + '\n…(이하 생략: read_note 로 이어 읽기)' : t}`; }
  blocks.push({ text: core, cache: true });
  const parts = [];
  if (S.settings.includeIndex) parts.push(`[파일 색인 — 폴더 [개수] 이름(크기)]\n${fileIndexText()}`);
  if (parts.length) blocks.push({ text: parts.join('\n\n'), cache: true });
  const sk = chat && chat.skill ? Skills.find(chat.skill) : null;
  if (sk) blocks.push({ text: `[활성 스킬: ${sk.name}]\n${sk.body}`, cache: true });
  return { blocks, skill: sk };
}

/* ── 슬래시 명령 ──
   /스킬이름 [요청]  스킬 켜기(대화에 유지)   /없음  스킬 끄기   /스킬  목록
   무료 로컬 명령: /검색 키워드   /읽기 이름 [구획]   /린트 경로   /예산 */
function parseSlash(text, chat) {
  const m = String(text).match(/^\/(\S+)\s*([\s\S]*)$/); if (!m) return null;
  const cmd = m[1], rest = m[2].trim();
  const esc2 = (s) => s;
  if (cmd === '없음' || cmd === 'off') return { kind: 'skill', skill: '', rest, note: '스킬을 껐습니다.' };
  if (cmd === '스킬' || cmd === 'skills') { const all = [...Skills.all().values()]; return { kind: 'local', md: '**사용 가능한 스킬** (`/이름 요청` 으로 켬, `/없음` 으로 끔)\n\n' + all.map((s) => `- \`/${s.name}\` — ${s.description}${s.model ? ` (모델: ${s.model})` : ''}${s.source === 'repo' ? ' 〔리포〕' : ''}`).join('\n') + '\n\n무료 로컬 명령: `/검색 키워드` `/읽기 이름 [구획]` `/린트 경로` `/예산`' }; }
  if (cmd === '검색') { if (!rest) return { kind: 'local', md: '사용법: `/검색 키워드`' }; return { kind: 'local', md: '```\n' + String(ToolImpl.search({ query: rest })) + '\n```' }; }
  if (cmd === '읽기') { const [n, ...sec] = rest.split(/\s+/); const r = ToolImpl.read_note({ name: n, section: sec.join(' ') }); return { kind: 'local', md: '```\n' + (typeof r === 'object' ? r.text : r) + '\n```' }; }
  if (cmd === '린트') { const r = ToolImpl.lint({ path: rest }); return { kind: 'local', md: '```\n' + (typeof r === 'object' ? r.text : r) + '\n```' }; }
  if (cmd === '예산') { const s = Budget.state(); return { kind: 'local', md: `사용 ${fmtUSD(s.used)} (${fmtKRW(s.used)}) · 남음 ${fmtUSD(s.remaining)} (${fmtKRW(s.remaining)}) · ${s.pct.toFixed(1)}% 사용` + (s.runway != null ? ` · 평균 ${fmtUSD(s.avgTurn)}/턴 → 약 ${fmtN(s.runway)}턴 남음` : '') }; }
  const sk = Skills.find(cmd);
  if (sk) return { kind: 'skill', skill: sk.name, rest, note: `스킬 "${sk.name}" 켜짐 — ${sk.description}` };
  return { kind: 'local', md: `알 수 없는 명령 \`/${cmd}\`. \`/스킬\` 로 목록을 확인하세요.` };
}
