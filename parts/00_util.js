'use strict';
/* ═══════════ 00 · 공용 유틸 · 기본값 ═══════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; f.cancel = () => clearTimeout(t); return f; };
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const fmtUSD = (n) => { n = Number(n) || 0; return '$' + (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(3) : n.toFixed(4)); };
const fmtKRW = (usd) => '₩' + Math.round((Number(usd) || 0) * (S.settings.budget.krwPerUSD || 1400)).toLocaleString('ko-KR');
// 글로 쓰는 문장에 붙이는 보조 원화 표기 (설정에서 끄면 빈 문자열)
const altUSD = (usd) => (S.settings.budget.showKRW ? ` (${fmtKRW(usd)})` : '');
const fmtDT = (ts) => { const d = new Date(ts); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const deepMerge = (def, saved) => {
  if (saved === undefined || saved === null) return clone(def);
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return typeof saved === typeof def || def === null ? saved : clone(def);
  const out = {};
  for (const k of Object.keys(def)) out[k] = deepMerge(def[k], saved[k]);
  for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
  return out;
};
// 한글/한자/가나는 글자당 약 1토큰, 그 외는 3.2자당 1토큰으로 어림 (정확한 값은 count_tokens)
function estTokens(t) {
  if (!t) return 0;
  let h = 0, o = 0;
  for (const ch of String(t)) {
    const c = ch.codePointAt(0);
    if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3130 && c <= 0x318F)) h++; else o++;
  }
  return Math.ceil(h * 1.0 + o / 3.2);
}
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/{2,}/g, '/').trim();
/* ── 작업공간: 'lore'(ERTES 설정집) / 'self'(이 도구 자신의 소스 = KUKU-UI 리포, 로컬 경로 접두사 studio-src/) ── */
const SELF_PREFIX = 'studio-src/';
const wsNow = () => (S.ui.ws === 'self' ? 'self' : 'lore');
const inSelf = (p) => String(p).startsWith(SELF_PREFIX);
const inWs = (p) => (wsNow() === 'self') === inSelf(p);
const baseName = (p) => p.split('/').pop();
const titleOf = (p) => baseName(p).replace(/\.(md|txt|markdown)$/i, '');
const isText = (p) => /\.(md|markdown|txt|json|csv|yml|yaml|js|mjs|cjs|css|html)$/i.test(p);
const isMd = (p) => /\.(md|markdown|txt)$/i.test(p);

/* ── 모델 가격 (USD / 1M tokens). 출처: platform.claude.com 가격표 (2026-10-25 확인). 설정에서 고칠 수 있다. */
const BASE_MODELS = {
  'claude-opus-5-5': { label: 'Opus 5.5', in: 4, out: 20, cw5: 5, cw1h: 8, cr: 0.20, ctx: 1000000, effort: true },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', in: 2, out: 10, cw5: 2.5, cw1h: 4, cr: 0.10, ctx: 1000000, effort: true },
  'claude-haiku-5-5': { label: 'Haiku 5.5', in: 0.10, out: 0.50, cw5: 0.125, cw1h: 0.20, cr: 0.01, ctx: 200000, tier: { over: 100000, in: 0.50, out: 2.50, cw5: 0.625, cw1h: 1, cr: 0.05 } },
};
// 배치(Message Batches API)는 모든 토큰 단가가 50%. 키는 `<모델>:batch`, 실제 API 모델 이름은 apiId.
const halve = (m) => { const o = { ...m }; for (const k of ['in', 'out', 'cw5', 'cw1h', 'cr']) o[k] = +(m[k] / 2).toFixed(6); if (m.tier) { o.tier = { ...m.tier }; for (const k of ['in', 'out', 'cw5', 'cw1h', 'cr']) o.tier[k] = +(m.tier[k] / 2).toFixed(6); } return o; };
const DEFAULT_MODELS = (() => {
  const o = {};
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5']) { o[id] = { ...BASE_MODELS[id] }; o[id + ':batch'] = { ...halve(BASE_MODELS[id]), label: BASE_MODELS[id].label + ' 배치', batch: true, apiId: id }; }
  o['claude-haiku-5-5'] = { ...BASE_MODELS['claude-haiku-5-5'] };
  return o;
})();
// 노력 수준(추론 강도): '' = 자동(보내지 않음 → 모델 기본값). Claude 는 output_config.effort, OpenRouter 는 reasoning.effort 로 보낸다.
const EFFORTS = [['', '자동'], ['medium', '중간'], ['high', '높음'], ['xhigh', '매우 높음']];
const effortLabel = (v) => (EFFORTS.find((e) => e[0] === v) || EFFORTS[0])[1];
const effortOf = (chat) => (chat && chat.effort) || S.settings.effort || '';
const modelInfo = (key) => (S.settings.models || {})[key] || {};
const isBatchModel = (key) => !!modelInfo(key).batch;
const apiModel = (key) => modelInfo(key).apiId || key;
// OpenAI 호환 쪽 프리셋 (단가 USD/1M — OpenRouter 모델 페이지 기준, 2026-10-25 확인). cr = 캐시 읽기 단가
const OPENAI_PRESETS = {
  openrouter: { label: 'OpenRouter · Gemini 4 Argon', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-4-argon', in: 2, out: 10, cr: 0.10, keyHint: 'sk-or-…' },
  'openrouter-batch': { label: 'OpenRouter · Gemini 4 Argon 배치 (반값)', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-4-argon:batch', in: 1, out: 5, cr: 0.05, keyHint: 'sk-or-…' },
};
const isOpenRouter = (base) => /(^|\/\/)([\w-]+\.)*openrouter\.ai(\/|$)/i.test(base || '');
const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  anthropicBase: 'https://api.anthropic.com',
  batchBase: '',           // 배치 전용 주소(선택). Anthropic 은 배치 API 에만 브라우저 직접 호출(CORS)을 막아서, 쓰려면 내 프록시 주소가 필요함
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', in: 0, out: 0, cr: null },   // 형식상 구현 — 단가(USD/1M)를 직접 넣으면 장부에 반영
  model: 'claude-sonnet-5-5',
  effort: '',              // 기본 노력 수준 ('' 자동 | medium | high | xhigh) — 대화마다 따로 고를 수 있음
  maxTokens: 8000,
  temperature: 1,
  cacheTTL: '5m',          // 고정 앞부분(도구·규칙·색인)의 TTL: '5m' | '1h'
  maxIters: 10,            // 한 턴에서 도구 호출을 이어 가는 최대 횟수
  keepToolTurns: 2,        // 대화가 길어졌을 때, 이 턴 수보다 오래된 도구 결과는 생략 표시로 바꿔 토큰을 아낌
  trimAboveTokens: 40000,  // 대화 기록이 이 토큰을 넘을 때만 위 정리를 함 (캐시를 자주 깨지 않도록)
  readMaxChars: 12000,     // read_note 한 번에 돌려주는 최대 글자
  includeIndex: true,      // 시스템 프롬프트에 파일 색인을 넣음
  enterSends: true,
  autoApprove: false,      // 허용 폴더 쓰기를 승인 없이 바로 반영
  gh: {
    owner: 'Hwari2929', repo: 'ERTES', branch: 'claude/peaceful-gauss-y1gdkd',
    includes: ['lore/', 'docs/', 'CLAUDE.md', 'README.md', 'studio/'],
    excludes: ['docs/archive/'],
    exts: ['.md', '.txt'],
    maxKB: 400,
  },
  writeAllow: ['lore/인물/확장/', 'lore/캠페인/', 'drafts/', 'studio/'],
  writeDeny: ['lore/인물/*.md', 'lore/세력/', 'lore/지역/', 'lore/_틀/', 'src/', '.git/'],
  pinned: ['CLAUDE.md'],
  self: {   // 자가개선: 이 도구의 소스 리포. AI 작업은 base(main)가 아니라 branch(작업 브랜치)에만 올라간다.
    owner: 'Hwari2929', repo: 'KUKU-UI', base: 'main', branch: 'self-improve',
    includes: ['parts/', 'ui/', 'skills/', 'test/', 'build.js', 'gen_skills.js', 'package.json', 'README.md', 'CLAUDE.md'],
    excludes: ['parts/45_skills.gen.js'], exts: ['.js', '.css', '.html', '.md', '.json'], maxKB: 400,
  },
  models: DEFAULT_MODELS,
  budget: { creditUSD: 100, krwPerUSD: 1400, showKRW: true, fx: { rate: null, ts: null, date: '', source: '' }, anchorUSD: null, anchorTs: null, warnPct: 80, stopPct: 97, reserveUSD: 0.5, turnCapUSD: 1.0, costScale: 1, calibLog: [] },
};
const S = {
  settings: clone(DEFAULT_SETTINGS),
  secrets: { apiKey: '', openaiKey: '', ghToken: '' },
  chats: [], ledger: [], pending: [], snaps: [], batches: [],
  sync: { lastHead: null, lastPull: null, branch: null },
  run: { busy: false, abort: null, chatId: null },
  ui: { open: [], cur: null, openDirs: {}, sideTab: 'files', mode: 'split', chatId: null, theme: 'auto', ws: 'lore', sideOpen: true, view: 'edit', fontSize: 16, editorFont: 'sans', chatW: 460, includeDoc: true },
};
// UI 가 덮어쓰는 훅 (순수 로직 부분이 DOM 없이도 돌도록)
const UI = {
  toast: (m) => console.log('[toast]', m), render: () => {}, budget: () => {}, chat: () => {}, files: () => {}, progress: () => {}, pending: () => {}, stream: () => {}, turn: () => {},
};
const toast = (m, ms) => UI.toast(m, ms);
