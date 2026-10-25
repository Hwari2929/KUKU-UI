/* ═══════════ 70 · UI 코어: 이벤트 위임 · 모달 · 메뉴 · 토스트 · 테마/레이아웃 · 상단바 ═══════════ */
const ACT = {};   // data-act 핸들러
const H = {       // 자주 쓰는 HTML 조각
  badge: (st) => (st ? `<span class="bd ${st}">${st}</span>` : ''),
  tag: (t, c = '') => `<span class="tag ${c}">${esc(t)}</span>`,
  kb: (n) => kfmt(n),
};
function mount() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!Menu.el || !e.target.closest('.menu')) Menu.close();
    if (!t) return;
    const f = ACT[t.dataset.act]; if (f) { try { const r = f(t, e); if (r && r.catch) r.catch(reportErr); } catch (err) { reportErr(err); } }
  });
}
function reportErr(e) { console.error(e); UI.toast('⚠ ' + (e && e.message || e), 5000); }

/* ── 토스트 ── */
UI.toast = (msg, ms = 2600) => {
  const box = document.getElementById('toasts'); if (!box) return console.log('[toast]', msg);
  const d = document.createElement('div'); d.className = 'toast' + (/^⚠|실패|오류/.test(msg) ? ' err' : ''); d.textContent = msg; box.appendChild(d);
  setTimeout(() => d.remove(), ms);
};
UI.progress = (t) => {
  const p = document.getElementById('progress'), x = document.getElementById('progText'); if (!p) return;
  p.classList.toggle('on', !!t); x.classList.toggle('hidden', !t); x.textContent = t || '';
};

/* ── 모달 ── */
const Modal = {
  stack: [],
  show({ title = '', html = '', node = null, buttons = [{ label: '닫기', value: true }], cls = '', onMount, closable = true, onClose } = {}) {
    const root = document.getElementById('modalRoot');
    const ovl = document.createElement('div'); ovl.className = 'ovl';
    ovl.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"><header><span class="grow">${esc(title)}</span>${closable ? '<button class="ghost sm" data-m="x" aria-label="닫기">✕</button>' : ''}</header><div class="bd2"></div>${buttons.length ? '<footer></footer>' : ''}</div>`;
    const m = { el: ovl, box: ovl.firstChild, body: ovl.querySelector('.bd2'), footer: ovl.querySelector('footer'), done: false };
    if (node) m.body.appendChild(node); else m.body.innerHTML = html;
    let res; m.promise = new Promise((r) => (res = r));
    m.close = (v) => { if (m.done) return; m.done = true; onClose && onClose(v); ovl.remove(); Modal.stack = Modal.stack.filter((x) => x !== m); res(v); };
    buttons.forEach((b) => {
      const bt = document.createElement('button'); bt.textContent = b.label; if (b.kind) bt.className = b.kind; if (b.id) bt.id = b.id;
      bt.onclick = async () => { if (b.onClick) { const r = await b.onClick(m); if (r === false) return; } if (!b.keep) m.close(b.value); };
      m.footer.appendChild(bt); b.el = bt;
    });
    m.buttons = buttons;
    ovl.addEventListener('mousedown', (e) => { if (e.target === ovl && closable) m.close(undefined); });
    const x = ovl.querySelector('[data-m=x]'); if (x) x.onclick = () => m.close(undefined);
    root.appendChild(ovl); Modal.stack.push(m);
    onMount && onMount(m);
    const f = m.body.querySelector('input:not([type=checkbox]),textarea,select'); if (f && !('ontouchstart' in window && false)) setTimeout(() => f.focus(), 30);
    return m;
  },
  open(o) { return this.show(o).promise; },
  top() { return this.stack[this.stack.length - 1]; },
  closeAll() { [...this.stack].forEach((m) => m.close(undefined)); },
};
const dlg = {
  alert: (msg, title = '알림') => Modal.open({ title, html: `<div style="white-space:pre-wrap">${esc(msg)}</div>`, buttons: [{ label: '확인', kind: 'primary', value: true }] }),
  confirm: (msg, { title = '확인', ok = '확인', danger = false, html = false } = {}) => Modal.open({ title, html: `<div style="white-space:pre-wrap">${html ? msg : esc(msg)}</div>`, buttons: [{ label: '취소', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }] }).then((v) => !!v),
  prompt: (label, def = '', { title = '입력', ok = '확인', multiline = false, hint = '' } = {}) => {
    const id = uid('in'); let m;
    const p = Modal.open({ title, html: `<label class="sm muted" for="${id}">${esc(label)}</label>${multiline ? `<textarea class="fld" id="${id}" rows="6"></textarea>` : `<input type="text" id="${id}">`}${hint ? `<div class="xs muted" style="margin-top:6px">${esc(hint)}</div>` : ''}`,
      buttons: [{ label: '취소', value: null }, { label: ok, kind: 'primary', onClick: (mm) => { mm.close(mm.body.querySelector('#' + id).value); return false; } }],
      onMount: (mm) => { m = mm; const i = mm.body.querySelector('#' + id); i.value = def; i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); mm.close(i.value); } }); setTimeout(() => { i.focus(); i.select && i.select(); }, 40); } });
    return p.then((v) => (v === undefined ? null : v));
  },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (Menu.el) return Menu.close(); const m = Modal.top(); if (m) { m.close(undefined); e.preventDefault(); } } });

/* ── 컨텍스트 메뉴 ── */
const Menu = {
  el: null,
  show(x, y, items) {
    this.close(); const d = document.createElement('div'); d.className = 'menu';
    d.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" ${it.danger ? 'class="err"' : ''}>${esc(it.label)}</button>`)).join('');
    document.body.appendChild(d);
    const r = d.getBoundingClientRect(); d.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px'; d.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    d.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; e.stopPropagation(); const it = items[+b.dataset.i]; Menu.close(); it.fn && it.fn(); });
    this.el = d;
  },
  at(el, items) { const r = el.getBoundingClientRect(); this.show(r.left, r.bottom + 4, items); },
  close() { if (this.el) { this.el.remove(); this.el = null; } },
};

/* ── 테마 · 레이아웃 ── */
function applyTheme() {
  const r = document.documentElement; r.dataset.theme = S.ui.theme || 'auto';
  r.style.setProperty('--edfs', (S.ui.fontSize || 16) + 'px'); r.style.setProperty('--chatW', (S.ui.chatW || 460) + 'px');
}
function applyLayout() {
  const a = document.getElementById('app'); a.classList.remove('mode-edit', 'mode-split', 'mode-chat'); a.classList.add('mode-' + (S.ui.mode || 'split')); a.classList.toggle('side-open', !!S.ui.sideOpen);
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.ui.mode));
  $$('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.ui.sideTab));
}
ACT.toggleSide = () => { S.ui.sideOpen = !S.ui.sideOpen; applyLayout(); saveUi(); };
ACT.mode = (t) => { S.ui.mode = t.dataset.mode; applyLayout(); saveUi(); if (S.ui.mode !== 'edit') Chat.scrollEnd(); };
ACT.theme = () => { const o = ['auto', 'light', 'dark']; S.ui.theme = o[(o.indexOf(S.ui.theme) + 1) % 3]; applyTheme(); saveUi(); UI.toast('테마: ' + { auto: '시스템', light: '밝게', dark: '어둡게' }[S.ui.theme]); };
ACT.sideTab = (t) => { S.ui.sideTab = t.dataset.tab; if (!S.ui.sideOpen) S.ui.sideOpen = true; applyLayout(); Side.render(); saveUi(); };
function initSplitter() {
  const sp = document.getElementById('splitter'); let drag = false;
  const move = (e) => { if (!drag) return; const main = document.getElementById('main').getBoundingClientRect(); const w = Math.round(Math.min(Math.max(main.right - e.clientX, 300), main.width - 320)); S.ui.chatW = w; document.documentElement.style.setProperty('--chatW', w + 'px'); };
  sp.addEventListener('pointerdown', (e) => { drag = true; sp.classList.add('drag'); sp.setPointerCapture(e.pointerId); });
  sp.addEventListener('pointermove', move);
  sp.addEventListener('pointerup', () => { drag = false; sp.classList.remove('drag'); saveUi(); });
}

/* ── 상단바 ── */
function renderTop() {
  const b = Budget.state(); const bt = document.getElementById('btnBudget'); if (!bt) return;
  bt.className = 'chip budget ' + (b.level === 'stop' ? 'stop' : b.level === 'warn' ? 'warn' : '');
  bt.innerHTML = `<span>남음 <b>${fmtKRW(b.remaining)}</b></span><span class="muted">${b.pct.toFixed(0)}%</span>`;
  bt.title = `사용 ${fmtUSD(b.used)} · 남음 ${fmtUSD(b.remaining)} (장부 기준)`;
  const p = document.getElementById('btnPending'); p.classList.toggle('hidden', !S.pending.length); p.querySelector('b').textContent = S.pending.length;
  const ch = FS.changes().length; const sy = document.getElementById('btnSync'); sy.querySelector('span').textContent = ch ? `변경 ${ch}` : '동기화'; sy.style.borderColor = ch ? 'var(--warn)' : '';
}
UI.budget = () => { renderTop(); if (typeof BudgetUI !== 'undefined') BudgetUI.refresh(); if (typeof Chat !== 'undefined') Chat.renderEst(); };
UI.pending = () => { renderTop(); if (typeof Side !== 'undefined') Side.renderSoon(); if (typeof Ed !== 'undefined') Ed.renderTabs(); if (typeof Appr !== 'undefined') Appr.refresh(); };
UI.files = () => { renderTop(); if (typeof Side !== 'undefined') Side.renderSoon(); if (typeof Ed !== 'undefined') Ed.afterFilesChange(); };
ACT.syncMenu = (t) => { S.ui.sideTab = 'sync'; S.ui.sideOpen = true; applyLayout(); Side.render(); };
