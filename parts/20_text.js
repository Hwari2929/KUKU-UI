/* ═══════════ 20 · 텍스트 도구: 링크 색인 · 구획 · 검색 · 린트 · diff/병합 · 마크다운 ═══════════ */

/* ── 위키링크 색인 ── */
const wlRe = () => /(!?)\[\[([^\]\n|#]+?)(?:#([^\]\n|]+?))?(?:\|([^\]\n]+?))?\]\]/g;
function parseLinks(text) {
  const out = []; const re = wlRe(); let m;
  while ((m = re.exec(text))) out.push({ embed: !!m[1], target: m[2].trim(), heading: m[3] ? m[3].trim() : '', alias: m[4] ? m[4].trim() : '', index: m.index });
  return out;
}
const IDX = { dirty: true, titles: new Map(), out: new Map(), back: new Map() };
function ensureIndex() {
  if (!IDX.dirty) return IDX;
  IDX.titles = new Map(); IDX.out = new Map(); IDX.back = new Map();
  const paths = FS.paths().filter(isMd);
  for (const p of paths) { const k = titleOf(p).toLowerCase(); if (!IDX.titles.has(k)) IDX.titles.set(k, []); IDX.titles.get(k).push(p); }
  IDX.dirty = false; // resolveName 이 다시 색인을 만들지 않도록 먼저 내림
  for (const p of paths) {
    const links = parseLinks(FS.read(p) || '').map((l) => { const r = resolveName(l.target); return { ...l, path: r.path }; });
    IDX.out.set(p, links);
    for (const l of links) if (l.path && l.path !== p) { if (!IDX.back.has(l.path)) IDX.back.set(l.path, new Set()); IDX.back.get(l.path).add(p); }
  }
  return IDX;
}
const prefLore = (a, b) => (b.startsWith('lore/') - a.startsWith('lore/')) || a.length - b.length;
function resolveName(name) {
  ensureIndex();
  name = normPath(name).replace(/\.(md|markdown)$/i, '');
  if (!name) return { path: null };
  for (const p of [name + '.md', name, name + '.txt']) if (FS.has(p)) return { path: p };
  const lastT = titleOf(name).toLowerCase();
  let list = IDX.titles.get(lastT) || [];
  if (name.includes('/')) list = list.filter((p) => p.replace(/\.(md|markdown|txt)$/i, '').toLowerCase().endsWith(name.toLowerCase()));
  if (list.length === 1) return { path: list[0] };
  if (list.length > 1) { const s = [...list].sort(prefLore); return { path: s[0], ambiguous: s }; }
  const fz = []; if (lastT.length >= 2) for (const [t, ps] of IDX.titles) if (t.includes(lastT)) fz.push(...ps);
  if (fz.length === 1) return { path: fz[0], fuzzy: true };
  if (fz.length > 1 && fz.length <= 8) return { path: null, candidates: fz.sort(prefLore) };
  return { path: null };
}
const linksOf = (p) => { ensureIndex(); return IDX.out.get(p) || []; };
const backlinksOf = (p) => { ensureIndex(); return [...(IDX.back.get(p) || [])].sort(); };

/* ── 구획(헤딩) ── */
function outlineOf(text) {
  const lines = text.split('\n'); const out = []; let off = 0, fence = false;
  lines.forEach((ln, i) => {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    else if (!fence) { const m = ln.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/); if (m) out.push({ lvl: m[1].length, title: m[2].trim(), line: i + 1, offset: off }); }
    off += ln.length + 1;
  });
  out.forEach((h, i) => { let end = text.length; for (let j = i + 1; j < out.length; j++) if (out[j].lvl <= h.lvl) { end = out[j].offset; break; } h.end = end; h.size = end - h.offset; });
  return out;
}
const normH = (s) => String(s).toLowerCase().replace(/[\s\-–—·:()（）\[\]`*_\/,'"“”‘’]/g, '');
function sectionOf(text, q) {
  const ol = outlineOf(text); const qn = normH(q); if (!qn) return { ol, h: null, others: [] };
  const stages = [(h) => normH(h.title) === qn, (h) => normH(h.title).startsWith(qn), (h) => normH(h.title).includes(qn)];
  for (const f of stages) { const hit = ol.filter(f); if (hit.length) return { ol, h: hit[0], text: text.slice(hit[0].offset, hit[0].end), others: hit.slice(1, 6).map((x) => x.title) }; }
  return { ol, h: null, others: [] };
}
const headingAt = (ol, pos) => { let r = null; for (const h of ol) { if (h.offset <= pos) r = h; else break; } return r; };

/* ── 검색 ── */
function countOcc(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; if (n > 200) break; } return n; }
function searchNotes(query, { folder = '', limit = 8 } = {}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const res = [];
  for (const p of FS.paths()) {
    if (!isMd(p)) continue;
    if (folder && !p.startsWith(folder)) continue;
    const text = FS.read(p) || ''; const lower = text.toLowerCase(); const tl = titleOf(p).toLowerCase(); const pl = p.toLowerCase();
    let matched = 0, sum = 0, first = -1; const hits = [];
    for (const t of terms) { const c = countOcc(lower, t); if (c) { matched++; sum += c; const ix = lower.indexOf(t); hits.push(ix); if (first < 0 || ix < first) first = ix; } }
    const titleHit = terms.filter((t) => tl.includes(t) || pl.includes(t)).length;
    if (!matched && !titleHit) continue;
    const score = Math.max(matched, titleHit) * 100 + (matched === terms.length ? 200 : 0) + titleHit * 80 + Math.min(sum, 30);
    res.push({ path: p, score, text, lower, terms, hits });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit).map((r) => {
    const ol = outlineOf(r.text); const snips = []; const seen = new Set();
    for (const ix of r.hits.sort((a, b) => a - b)) {
      if (snips.length >= 2) break; const hd = headingAt(ol, ix);
      const key = hd ? hd.offset : -1; if (seen.has(key) && snips.length) continue; seen.add(key);
      const s = Math.max(0, ix - 50), e = Math.min(r.text.length, ix + 110);
      snips.push({ section: hd ? hd.title : '', text: r.text.slice(s, e).replace(/\s+/g, ' ').trim() });
    }
    if (!snips.length) snips.push({ section: '', text: r.text.slice(0, 120).replace(/\s+/g, ' ') });
    return { path: r.path, size: r.text.length, snips };
  });
}

/* ═══ 린트 ═══ */
const NATIVE = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };
const NATIVE_TENS = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const DAYWORD = { 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 여드레: 8, 아흐레: 9, 열흘: 10 };
const SINO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const UNITS = '번째|개월|개|명|번|잔|시간|시|분|초|살|장|마리|대|곳|층|배|줄|차례|해|달|주|병|조각|그릇|켤레|가지|척|벌|권|통|칸|판|군데|방|발|알|송이|자루|채|편|회|퍼센트|프로|년|일|킬로|미터|도|인분';
const NATIVE_RE = new RegExp(`((?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|한|두|세|네|다섯|여섯|일곱|여덟|아홉)(\\s?)(${UNITS})(?![가-힣]*다음)`, 'g');
const SINO_RE = new RegExp(`((?:[일이삼사오육칠팔구]?천)?(?:[일이삼사오육칠팔구]?백)?(?:[일이삼사오육칠팔구]?십)?[일이삼사오육칠팔구]?)(\\s?)(번째|개월|개|명|번|시간|시|분|초|년|층|퍼센트|살|장|마리|대|배|킬로|미터)`, 'g');
const ORD_RE = /(셋째|넷째|다섯째|여섯째|일곱째|여덟째|아홉째|열째)(\s?)(줄|칸|층|번|장|항|조|호|단계|구역|사건|장면)/g;
const DAY_RE = /(사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘)/g;
function nativeVal(tok) {
  let v = 0, rest = tok;
  for (const k of Object.keys(NATIVE_TENS).sort((a, b) => b.length - a.length)) if (rest.startsWith(k)) { v += NATIVE_TENS[k]; rest = rest.slice(k.length); break; }
  if (rest) { if (!(rest in NATIVE)) return null; v += NATIVE[rest]; }
  return v || null;
}
function sinoVal(tok) {
  if (!tok) return null; let v = 0, cur = 0, ok = false;
  const chars = [...tok];
  for (const c of chars) {
    if (c in SINO) cur = SINO[c];
    else if (c === '십' || c === '백' || c === '천') { const m = { 십: 10, 백: 100, 천: 1000 }[c]; v += (cur || 1) * m; cur = 0; ok = true; }
    else return null;
  }
  v += cur; return ok ? v : null; // 십·백·천이 하나도 없는 한 글자(일·이·삼…)는 이 함수로는 바꾸지 않는다
}
// 한 줄에서 한글 수 표기를 찾는다. → [{index, len, text, to, level}]
function findNumerals(line) {
  const out = [];
  const push = (m, to, level) => out.push({ index: m.index, len: m[0].length, text: m[0], to, level });
  let m;
  NATIVE_RE.lastIndex = 0;
  while ((m = NATIVE_RE.exec(line))) {
    // 백열두 번째 · 이백스물한 개 처럼 한자어 백/천 뒤에 고유어가 이어지는 합성 수
    const pre = line.slice(0, m.index).match(/((?:[일이삼사오육칠팔구]?천)?(?:[일이삼사오육칠팔구]?백))$/);
    if (pre && /^(?:열|스물|서른|마흔|쉰|예순|일흔|여든|아흔)/.test(m[1]) || (pre && m[1] in NATIVE)) {
      const hv = sinoVal(pre[1]), nv = nativeVal(m[1]);
      if (hv != null && nv != null) { out.push({ index: m.index - pre[1].length, len: pre[1].length + m[0].length, text: pre[1] + m[0], to: `${hv + nv}${m[3]}`, level: 'error' }); continue; }
    }
    const tok = m[1], unit = m[3], prev = line[m.index - 1] || '';
    if ((tok === '두' && prev === '한') || (tok === '세' && prev === '두') || (tok === '네' && prev === '서')) continue; // 한두·두세·서너
    if (prev && /[가-힣]/.test(prev) && !/[\s"'“‘(\[{…·,.!?~]/.test(prev) && !(tok in NATIVE_TENS) && prev !== '한' && prev !== '두') { if (!/^(열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)/.test(tok)) continue; } // 단어 중간의 우연한 일치
    if (tok === '한' && !/^(개|명|마리|조각|그릇|켤레|가지|병|통|송이|자루|권|칸|군데|알|벌|척|줄|살|잔|시간|차례|개월|퍼센트)$/.test(unit)) continue; // '한 일(한 + 일)' 같은 활용형 · 한 번 더 · 한 달 등은 건드리지 않음
    if (tok === '한' && unit === '잔' && /^\s*하/.test(line.slice(m.index + m[0].length))) continue; // 한 잔 하자
    if (tok === '두' && unit === '분') continue;                              // 두 분 — 높임
    if (!m[2] && tok.length === 1 && /^(일|시|분|초|도|대|배|방|판|편|회|년|장|곳|층|채|발|알|벌)$/.test(unit)) continue; // 네일 · 세일 · 한일 처럼 붙여 쓴 낱말
    const v = nativeVal(tok); if (v == null) continue;
    push(m, `${v}${unit}`, tok === '한' ? 'warn' : 'error');
  }
  SINO_RE.lastIndex = 0;
  while ((m = SINO_RE.exec(line))) {
    const tok = m[1]; if (!tok) { SINO_RE.lastIndex = m.index + 1; continue; }
    const prev = line[m.index - 1] || ''; if (/[가-힣]/.test(prev)) continue;
    const v = sinoVal(tok);
    if (v != null) push(m, `${v}${m[3]}`, 'error');
    else if (tok.length === 1 && ['삼', '사', '오', '육', '칠', '팔', '구'].includes(tok) && ['번째', '분', '초', '시간', '개월', '퍼센트'].includes(m[3])) push(m, `${SINO[tok]}${m[3]}`, 'warn');
  }
  ORD_RE.lastIndex = 0;
  while ((m = ORD_RE.exec(line))) { const n = { 셋째: 3, 넷째: 4, 다섯째: 5, 여섯째: 6, 일곱째: 7, 여덟째: 8, 아홉째: 9, 열째: 10 }[m[1]]; push(m, `${n}번째${m[2]}${m[3]}`, 'warn'); }
  DAY_RE.lastIndex = 0;
  while ((m = DAY_RE.exec(line))) push(m, `${DAYWORD[m[1]]}일`, 'error');
  return out.sort((a, b) => a.index - b.index).filter((x, i, a) => !i || x.index >= a[i - 1].index + a[i - 1].len);
}
function fixNumerals(text, levels = ['error']) {
  return text.split('\n').map((ln) => {
    const f = findNumerals(ln).filter((x) => levels.includes(x.level)); let o = ln;
    for (const x of f.sort((a, b) => b.index - a.index)) o = o.slice(0, x.index) + x.to + o.slice(x.index + x.len);
    return o;
  }).join('\n');
}

function lintScene(text, add) {
  const L = text.split('\n'); const secs = []; let cur = null;
  L.forEach((ln, i) => {
    const h = ln.match(/^##\s*(.+?)\s*(\/\/.*)?$/);
    if (h) { cur = { name: h[1], line: i + 1, beats: [] }; secs.push(cur); return; }
    if (!ln.trim() || !cur) return; cur.beats.push({ ln, i });
  });
  const body = secs.find((s) => s.name === '본문');
  if (!body) return;
  const bl = body.beats.length;
  if (bl < 15 || bl > 25) add('warn', body.line, `본문이 ${bl}줄 (권장 15~25줄)`, 'scene-len');
  const slots = body.beats.filter((b) => b.ln.trim() === '[조연]').length;
  const subs = secs.filter((s) => /^조연\s/.test(s.name));
  if (slots !== 1) add(subs.length || slots ? 'error' : 'warn', body.line, `[조연] 자리가 ${slots}개 (본문에 정확히 1번)`, 'scene-slot');
  if (subs.length && (subs.length < 4 || subs.length > 6)) add('warn', subs[0].line, `조연 후보 ${subs.length}명 (권장 4~6명)`, 'scene-subs');
  for (const s of subs) if (s.beats.length < 2 || s.beats.length > 5) add('warn', s.line, `${s.name}: ${s.beats.length}줄 (권장 2~5줄)`, 'scene-sub-len');
  const first = body.beats[0];
  if (first && !(/\bbg=/.test(first.ln) && /\bbgm=/.test(first.ln))) add('warn', first.i + 1, '본문 첫 줄에 bg= 와 bgm= 가 필요', 'scene-bg');
  const think = body.beats.filter((b) => /\(속마음\)/.test(b.ln)).length;
  if (think > 1) add('warn', body.line, `속마음 ${think}줄 (기본 0줄, 최대 1줄)`, 'scene-think');
  const sfx = L.filter((l) => /\bsfx=/.test(l)).length; if (sfx > 4) add('warn', 1, `효과음 ${sfx}개 (장면당 2~4개)`, 'scene-sfx');
  for (const s of secs) {
    if (/^결과/.test(s.name) && (s.beats.length < 3 || s.beats.length > 6)) add('warn', s.line, `${s.name}: ${s.beats.length}줄 (권장 3~6줄)`, 'scene-after-len');
    for (const b of s.beats) {
      if (b.ln.trim() === '[조연]') continue;
      const dm = b.ln.match(/^[^:{}\n]{1,24}?\s*(?:\(속마음\))?\s*(?:\{[^}]*\})?\s*:\s?(.*)$/); const txt = dm ? dm[1] : b.ln.replace(/^\{[^}]*\}\s*/, '');
      if (dm && /^["“「『']/.test(txt.trim())) add('warn', b.i + 1, '대사는 따옴표 없이 적는다', 'scene-quote');
      const sentences = (txt.match(/[.!?…]+(\s|$)/g) || []).length; if (sentences > 3) add('warn', b.i + 1, `한 줄에 ${sentences}문장 (한 줄 = 1~3문장)`, 'scene-long');
    }
  }
}
function lintExtension(text, path, add) {
  const L = text.split('\n'); let kw = [];
  const fm = text.match(/금지 설정\s*[:：]\s*(.+)/); if (fm) kw = fm[1].split(/[,，、·\/]/).map((s) => s.trim()).filter(Boolean);
  if (!/원본 시트/.test(text.slice(0, 600))) add('warn', 1, "문서 머리에 '원본 시트:' 링크(없으면 '없음')가 필요", 'ext-head');
  if (!fm) add('warn', 1, "문서 머리에 '금지 설정:' 핵심어 줄이 필요 (docs/VOICES.md 의 금지 항목)", 'ext-forbid');
  L.forEach((ln, i) => {
    if (!/^\s*-\s+/.test(ln) || !/〔(관계|출처)/.test(ln)) return;
    const rel = ln.match(/〔관계\s*[:：]\s*([^〕]*?)\s*〕/);
    if (!rel) add('error', i + 1, '〔관계: 원본 확장 | 원본 해석 | 새 설정〕 표시가 없음', 'ext-rel');
    else if (!['원본 확장', '원본 해석', '새 설정'].includes(rel[1])) add('error', i + 1, `관계 값 "${rel[1]}" 은(는) 원본 확장 · 원본 해석 · 새 설정 중 하나여야 함`, 'ext-rel');
    const src = ln.match(/〔출처\s*[:：]\s*([^「〕]*?)\s*「([^」]+)」\s*〕/);
    if (!src) add('error', i + 1, '〔출처: 파일 「대본 속 문구」〕 표시가 없음', 'ext-src');
    else {
      const sp = normPath(src[1].replace(/^파일\s*/, '')); let f = sp && FS.has(sp) ? sp : null;
      if (!f && sp) { const r = resolveName(sp); f = r.path; }
      if (f) { if (!(FS.read(f) || '').includes(src[2])) add('error', i + 1, `출처 파일(${f})에 「${src[2].slice(0, 20)}…」 문구가 그대로 없음`, 'ext-quote'); }
      else add('info', i + 1, `출처 파일 "${sp}" 이(가) 이 작업 공간에 없어 문구 확인 불가 (src/ 는 동기화하지 않음)`, 'ext-nofile');
    }
    const plain = ln.replace(/〔[^〕]*〕/g, '');
    for (const k of kw) if (plain.includes(k)) add('error', i + 1, `금지 설정 핵심어 "${k}" 포함`, 'ext-forbidden');
  });
}
function lintText(text, { path = '' } = {}) {
  const issues = [];
  const add = (level, line, msg, rule, col, len) => issues.push({ level, line, msg, rule, col, len });
  const L = text.split('\n'); let fence = false;
  const isScene = /^##\s*본문/m.test(text);
  L.forEach((ln, i) => {
    if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; return; }
    if (/^\s*(src|npm|node|git)\b/.test(ln) && fence) return;
    for (const x of findNumerals(ln)) add(x.level, i + 1, `한글 수 표기 "${x.text}" → "${x.to}"`, 'numeral', x.index, x.len);
  });
  if (isScene) lintScene(text, add);
  if (/lore\/인물\/확장\//.test(path)) lintExtension(text, path, add);
  const order = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line);
}
const lintSummary = (is) => ({ error: is.filter((x) => x.level === 'error').length, warn: is.filter((x) => x.level === 'warn').length, info: is.filter((x) => x.level === 'info').length });
const lintReport = (is) => is.length ? is.map((x) => `[${x.level}] ${x.line}행: ${x.msg}`).join('\n') : '문제 없음';

/* ═══ diff / 3-way 병합 ═══ */
const splitLines = (s) => (s === '' || s == null ? [] : String(s).split('\n'));
function lcsPairs(A, B) {
  const n = A.length, m = B.length; let s = 0;
  while (s < n && s < m && A[s] === B[s]) s++;
  let e = 0; while (e < n - s && e < m - s && A[n - 1 - e] === B[m - 1 - e]) e++;
  const pairs = []; for (let i = 0; i < s; i++) pairs.push([i, i]);
  const a = A.slice(s, n - e), b = B.slice(s, m - e), N = a.length, M = b.length;
  if (N && M && N * M <= 4000000) {
    const w = M + 1, dp = new Uint32Array((N + 1) * w);
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < N && j < M) { if (a[i] === b[j]) { pairs.push([s + i, s + j]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++; }
  }
  for (let k = e; k > 0; k--) pairs.push([n - k, m - k]);
  return pairs;
}
function diffOps(a, b) {
  const A = splitLines(a), B = splitLines(b), ops = []; let i = 0, j = 0;
  for (const [pi, pj] of [...lcsPairs(A, B), [A.length, B.length]]) {
    while (i < pi) ops.push({ t: '-', s: A[i], a: ++i, b: null });
    while (j < pj) ops.push({ t: '+', s: B[j], a: null, b: ++j });
    if (pi < A.length) { ops.push({ t: '=', s: A[pi], a: pi + 1, b: pj + 1 }); i = pi + 1; j = pj + 1; }
  }
  return ops;
}
const diffStat = (a, b) => { const o = diffOps(a, b); return { add: o.filter((x) => x.t === '+').length, del: o.filter((x) => x.t === '-').length }; };
function diffHTML(a, b, ctx = 3) {
  const ops = diffOps(a, b); if (!ops.some((o) => o.t !== '=')) return '<div class="df-none">변경 없음</div>';
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.t !== '=') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true; });
  let h = '<div class="df">', skipped = 0;
  ops.forEach((o, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { h += `<div class="df-gap">… ${skipped}줄 생략 …</div>`; skipped = 0; }
    h += `<div class="df-l df-${o.t === '+' ? 'a' : o.t === '-' ? 'd' : 'e'}"><span class="df-n">${o.a ?? ''}</span><span class="df-n">${o.b ?? ''}</span><span class="df-s">${o.t === '=' ? ' ' : o.t}</span><span class="df-t">${esc(o.s) || '&nbsp;'}</span></div>`;
  });
  if (skipped) h += `<div class="df-gap">… ${skipped}줄 생략 …</div>`;
  return h + '</div>';
}
// base 를 공통 조상으로 ours(내 것)와 theirs(원격)를 병합. segs: {t:'ok',lines} | {t:'conflict',ours,theirs,base}
function merge3(base, ours, theirs) {
  const done = (segs) => {
    const merged = []; for (const s of segs) { if (merged.length && merged[merged.length - 1].t === 'ok' && s.t === 'ok') merged[merged.length - 1].lines = merged[merged.length - 1].lines.concat(s.lines); else merged.push({ ...s }); }
    const conflicts = merged.filter((s) => s.t === 'conflict').length;
    const text = merged.map((s) => s.t === 'ok' ? s.lines.join('\n') : ['<<<<<<< 내 변경', ...s.ours, '=======', ...s.theirs, '>>>>>>> 원격'].join('\n')).filter((x, i, a) => true).join('\n');
    return { text, conflicts, segs: merged };
  };
  if (ours === theirs) return { text: ours, conflicts: 0, segs: [{ t: 'ok', lines: splitLines(ours) }] };
  if (base === ours) return { text: theirs, conflicts: 0, segs: [{ t: 'ok', lines: splitLines(theirs) }] };
  if (base === theirs) return { text: ours, conflicts: 0, segs: [{ t: 'ok', lines: splitLines(ours) }] };
  const B = splitLines(base), O = splitLines(ours), T = splitLines(theirs);
  const mo = new Map(lcsPairs(B, O)), mt = new Map(lcsPairs(B, T));
  const anchors = []; for (let i = 0; i < B.length; i++) if (mo.has(i) && mt.has(i)) anchors.push([i, mo.get(i), mt.get(i)]);
  anchors.push([B.length, O.length, T.length]);
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  let pb = 0, po = 0, pt = 0; const segs = [];
  for (const [ab, ao, at] of anchors) {
    if (ao < po || at < pt) continue; // 단조성이 깨진 앵커는 건너뜀
    const cb = B.slice(pb, ab), co = O.slice(po, ao), ct = T.slice(pt, at);
    if (eq(co, ct)) segs.push({ t: 'ok', lines: co });
    else if (eq(co, cb)) segs.push({ t: 'ok', lines: ct });
    else if (eq(ct, cb)) segs.push({ t: 'ok', lines: co });
    else segs.push({ t: 'conflict', ours: co, theirs: ct, base: cb });
    if (ab < B.length) segs.push({ t: 'ok', lines: [B[ab]] });
    pb = ab + 1; po = ao + 1; pt = at + 1;
  }
  return done(segs);
}
const resolveSegs = (segs, choices) => { let ci = 0; const out = []; for (const s of segs) { if (s.t === 'ok') out.push(...s.lines); else { const c = choices[ci++] || 'ours'; if (c === 'ours') out.push(...s.ours); else if (c === 'theirs') out.push(...s.theirs); else out.push(...s.ours, ...s.theirs); } } return out.join('\n'); };

/* ═══ 마크다운 (읽기용 최소 구현) ═══ */
function renderMd(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n'); const codes = [];
  const inline = (t) => {
    t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push(esc(c)); return `\u0000${codes.length - 1}\u0000`; });
    t = esc(t);
    t = t.replace(/(!?)\[\[([^\]\n|#]+?)(?:#([^\]\n|]+?))?(?:\|([^\]\n]+?))?\]\]/g, (m, em, a, h, al) => `<a class="wl" data-wl="${a.trim()}" data-h="${h || ''}">${al || (h ? a.trim() + '#' + h : a.trim())}</a>`);
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<i>$2</i>');
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, n) => `<code>${codes[+n]}</code>`);
  };
  let h = '', i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    let m;
    if ((m = ln.match(/^\s*(```|~~~)\s*([\w가-힣-]*)/))) {
      const lang = m[2] || ''; const buf = []; i++;
      while (i < lines.length && !/^\s*(```|~~~)\s*$/.test(lines[i])) buf.push(lines[i++]); i++;
      h += `<div class="codeblk" data-lang="${esc(lang)}"><div class="cbh"><span>${esc(lang || '코드')}</span><span class="cb-badge"></span><button class="mini" data-copy>복사</button></div><pre><code>${esc(buf.join('\n'))}</code></pre></div>`; continue;
    }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { h += `<h${m[1].length + 1} class="mdh">${inline(m[2])}</h${m[1].length + 1}>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { h += '<hr>'; i++; continue; }
    if (/^\s*>/.test(ln)) { const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); h += `<blockquote>${buf.map(inline).join('<br>')}</blockquote>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(ln); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      h += `<div class="tblw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
      const ord = /^\s*\d/.test(ln); let items = '';
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/); const depth = Math.min(3, Math.floor(mm[1].replace(/\t/g, '  ').length / 2)); items += `<li style="margin-left:${depth * 16}px">${inline(mm[3])}</li>`; i++; }
      h += ord ? `<ol>${items}</ol>` : `<ul>${items}</ul>`; continue;
    }
    if (!ln.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|\|.*\||([-*+]|\d+[.)])\s)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    h += `<p>${buf.map(inline).join('<br>')}</p>`;
  }
  return h;
}

/* ── 파일 규칙 (쓰기 허용/금지) ── */
function matchRule(path, rule) {
  rule = normPath(rule); if (!rule) return false;
  if (rule.includes('*')) { const re = new RegExp('^' + rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*') + '$'); return re.test(path); }
  return rule.endsWith('/') ? path.startsWith(rule) : path === rule || path.startsWith(rule + '/');
}
function canWrite(path) {
  path = normPath(path);
  if (!path || path.includes('..') || /^\//.test(path)) return { ok: false, why: '잘못된 경로' };
  if (!isText(path)) return { ok: false, why: '텍스트 파일(.md .txt .json)만 쓸 수 있음' };
  for (const r of S.settings.writeDeny) if (matchRule(path, r)) return { ok: false, why: `쓰기 금지 규칙(${r})에 걸림 — 원본 설정 문서는 고치지 않고 lore/인물/확장/ 에 새 설정을 적는다` };
  if (!S.settings.writeAllow.some((r) => matchRule(path, r))) return { ok: false, why: `쓰기 허용 폴더가 아님 (허용: ${S.settings.writeAllow.join(', ')})` };
  return { ok: true };
}
