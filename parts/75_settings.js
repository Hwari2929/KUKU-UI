/* ═══════════ 75 · 설정 · 백업/복원 · 저장소 진단 ═══════════ */
const lines = (s) => String(s || '').split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
const Settings = {
  m: null, tab: 'api',
  open(tab) {
    if (tab) this.tab = tab; const s = S.settings, k = S.secrets, g = s.gh;
    const fr = (id, label, input, hint = '') => `<div class="frow"><label for="${id}">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const tx = (id, v, ph = '', type = 'text') => `<input type="${type}" id="${id}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off" spellcheck="false">`;
    const ck = (id, v) => `<input type="checkbox" id="${id}" ${v ? 'checked' : ''}>`;
    const ta = (id, v, r = 4) => `<textarea class="fld mono" id="${id}" rows="${r}" spellcheck="false" style="font-size:14px">${esc(v)}</textarea>`;
    const modelOpts = (cur) => Object.keys(s.models).map((m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(s.models[m].label || m)} — ${esc(m)}</option>`).join('');
    const tabs = [['api', 'API'], ['behave', '동작'], ['gh', 'GitHub'], ['rules', '쓰기 규칙'], ['data', '데이터']];
    const html = `<nav class="tabs" style="margin:-4px -4px 12px;border-radius:10px;overflow:hidden">${tabs.map(([t, l]) => `<button data-act="setTab" data-t="${t}" class="${this.tab === t ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <section class="sset ${this.tab === 'api' ? 'on' : ''}" data-s="api">
      ${fr('sProv', '제공자', `<select id="sProv"><option value="anthropic" ${s.provider === 'anthropic' ? 'selected' : ''}>Anthropic (권장)</option><option value="openai" ${s.provider === 'openai' ? 'selected' : ''}>OpenAI 호환 (형식상)</option></select>`)}
      <div class="sect">Anthropic</div>
      ${fr('sKey', 'API 키', `<div class="inl"><input type="password" id="sKey" value="${esc(k.apiKey)}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="sm" data-act="showKey" type="button">보기</button></div>`, '이 기기의 브라우저 저장소에만 보관됩니다 (백업에는 기본으로 빠짐).')}
      ${fr('sBase', '주소', tx('sBase', s.anthropicBase), '기본값 https://api.anthropic.com')}
      ${fr('sModel', '기본 모델', `<select id="sModel">${modelOpts(s.model)}</select>`, '대화마다, 스킬마다 따로 지정할 수도 있어요.')}
      <div class="inl" style="margin:6px 0"><button class="sm" data-act="keyTest">키 · 모델 목록 확인</button><span id="keyRes" class="xs muted"></span></div>
      <div class="sect">OpenAI 호환 <span class="xs muted">(지금은 쓰지 않아도 됨)</span></div>
      ${fr('sOKey', 'API 키', tx('sOKey', k.openaiKey, '', 'password'))}${fr('sOBase', '주소', tx('sOBase', s.openai.base))}${fr('sOModel', '모델', tx('sOModel', s.openai.model))}${fr('sOIn', '입력 단가 (USD/1M)', tx('sOIn', s.openai.in))}${fr('sOOut', '출력 단가 (USD/1M)', tx('sOOut', s.openai.out), '단가를 넣어야 장부에 비용이 잡힙니다. 캐시·도구 동작은 Anthropic 쪽만 완전 지원.')}
    </section>
    <section class="sset ${this.tab === 'behave' ? 'on' : ''}" data-s="behave">
      ${fr('sMax', '최대 출력 토큰', tx('sMax', s.maxTokens), '한 번의 답변 길이 상한. 장면 스크립트는 4000~8000이면 충분.')}
      ${fr('sTemp', '온도', tx('sTemp', s.temperature), '1 = 기본값(전송 안 함). 일부 모델은 온도를 받지 않을 수 있어요.')}
      ${fr('sTTL', '캐시 유지 시간', `<select id="sTTL"><option value="5m" ${s.cacheTTL === '5m' ? 'selected' : ''}>5분 (쓰기 1.25배)</option><option value="1h" ${s.cacheTTL === '1h' ? 'selected' : ''}>1시간 (쓰기 2배)</option></select>`, '규칙·색인 같은 고정 앞부분에 적용. 자주 쉬면서 쓰면 1시간이 이득.')}
      ${fr('sIters', '도구 연속 호출 한도', tx('sIters', s.maxIters), '한 번의 질문에서 문서를 찾고 읽는 횟수 상한')}
      ${fr('sKeep', '최근 유지 턴 수', tx('sKeep', s.keepToolTurns), '대화가 길어질 때, 이보다 오래된 도구 결과는 생략 표시로 바꿔 토큰을 아낌')}
      ${fr('sTrim', '정리 시작 토큰', tx('sTrim', s.trimAboveTokens), '대화 기록이 이 값을 넘을 때만 위 정리를 수행 (0 = 안 함)')}
      ${fr('sRead', '문서 한 번 읽기 글자 수', tx('sRead', s.readMaxChars), '이보다 큰 문서는 목차만 보여주고 구획 단위로 읽게 함')}
      ${fr('sIdx', '시스템에 파일 색인 포함', ck('sIdx', s.includeIndex), '캐시되어 싸지만, 노트가 많으면 수천 토큰')}
      ${fr('sEnter', 'Enter 로 전송', ck('sEnter', s.enterSends), '끄면 ⌘Enter 로 전송')}
      ${fr('sAuto', 'AI 쓰기 자동 승인', ck('sAuto', s.autoApprove), '허용 폴더에 한해 린트 오류가 없을 때만 바로 반영. 기본은 끄고 직접 승인.')}
      ${fr('sPin', '항상 포함할 문서', ta('sPin', (s.pinned || []).join('\n'), 3), '한 줄에 하나. 시스템 프롬프트에 통째로 들어가며 캐시됩니다 (예: CLAUDE.md).')}
    </section>
    <section class="sset ${this.tab === 'gh' ? 'on' : ''}" data-s="gh">
      ${fr('gOwner', '소유자', tx('gOwner', g.owner))}${fr('gRepo', '리포', tx('gRepo', g.repo))}${fr('gBranch', '브랜치', tx('gBranch', g.branch))}
      ${fr('gTok', '개인 액세스 토큰', `<div class="inl"><input type="password" id="gTok" value="${esc(k.ghToken)}" placeholder="github_pat_… (읽기만이면 비워도 됨)" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="sm" data-act="showTok" type="button">보기</button></div>`, '커밋·푸시에는 이 리포의 Contents 읽기/쓰기 권한(fine-grained)이 필요. 공개 리포를 읽기만 할 땐 필요 없음.')}
      ${fr('gInc', '가져올 경로', ta('gInc', g.includes.join('\n'), 4), '폴더는 끝에 /')}${fr('gExc', '제외 경로', ta('gExc', g.excludes.join('\n'), 2))}${fr('gExt', '확장자', tx('gExt', g.exts.join(', ')))}${fr('gKB', '파일 최대 크기(KB)', tx('gKB', g.maxKB))}
      <div class="inl" style="margin:6px 0"><button class="sm" data-act="ghTest">연결 테스트</button><span id="ghRes" class="xs muted"></span></div>
    </section>
    <section class="sset ${this.tab === 'rules' ? 'on' : ''}" data-s="rules">
      <div class="sm muted" style="margin-bottom:6px">AI 가 쓸 수 있는 곳을 제한합니다. 직접 편집은 제한 없음. <b>금지가 허용보다 먼저</b> 적용돼요. 한 줄에 하나, <code>*</code> 는 폴더 안 와일드카드.</div>
      ${fr('rAllow', '쓰기 허용', ta('rAllow', s.writeAllow.join('\n'), 5))}${fr('rDeny', '쓰기 금지', ta('rDeny', s.writeDeny.join('\n'), 6))}
    </section>
    <section class="sset ${this.tab === 'data' ? 'on' : ''}" data-s="data">
      <div class="card flat sm" id="diag">진단 중…</div>
      <div class="inl" style="margin:8px 0;flex-wrap:wrap"><button class="sm" data-act="persist">저장소 보호 요청</button></div>
      <div class="sect">백업</div>
      <div class="inl" style="flex-wrap:wrap"><label class="sm inl"><input type="checkbox" id="bkSec" style="flex:none"> API 키·토큰 포함</label><button class="sm" data-act="bkExport">내보내기 (.json)</button><button class="sm" data-act="bkImport">불러오기</button></div>
      <div class="xs muted" style="margin-top:4px">문서 · 대화 · 비용 장부 · 설정을 한 파일로. 브라우저 데이터가 지워질 수 있으니 가끔 내보내 두세요.</div>
      <div class="sect">초기화</div>
      <div class="inl" style="flex-wrap:wrap"><button class="sm danger" data-act="wipeFiles">문서 캐시 지우기</button><button class="sm danger" data-act="wipeAll">모든 데이터 지우기</button></div>
      <div class="xs muted" style="margin-top:4px">문서 캐시는 GitHub 에서 다시 받을 수 있지만, 아직 푸시하지 않은 변경은 사라집니다.</div>
    </section>`;
    this.m = Modal.show({ title: '설정', cls: 'mid', html, buttons: [{ label: '취소', value: false }, { label: '저장', kind: 'primary', onClick: (m) => this.save(m) }], onClose: () => (this.m = null), onMount: () => this.diag() });
  },
  async diag() {
    const el = document.getElementById('diag'); if (!el) return; let persisted = '알 수 없음', quota = '';
    try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? '보호됨' : '보호 안 됨 (브라우저가 정리할 수 있음)'; if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); quota = ` · 사용 ${((e.usage || 0) / 1048576).toFixed(1)}MB / 한도 ${((e.quota || 0) / 1048576).toFixed(0)}MB`; } } catch (e) {}
    const el2 = document.getElementById('diag'); if (el2) el2.innerHTML = `저장 방식: <b>${esc(DB.kind)}</b>${DB.kind !== 'indexeddb' ? ' <span class="warn">(IndexedDB 를 쓸 수 없어 대체 저장 중)</span>' : ''}${DB.lastError ? `<br><span class="err">최근 오류: ${esc(DB.lastError)}</span>` : ''}<br>${persisted}${quota}<br>문서 ${FS.paths().length}개 · 대화 ${S.chats.length}개 · 비용 기록 ${S.ledger.length}건 · 되돌리기 기록 ${S.snaps.length}건`;
  },
  save(m) {
    const v = (id) => (m.body.querySelector('#' + id) || {}).value; const c = (id) => !!(m.body.querySelector('#' + id) || {}).checked; const n = (id, d) => { const x = num(v(id)); return Number.isFinite(x) ? x : d; };
    const s = S.settings, k = S.secrets, g = s.gh;
    s.provider = v('sProv'); k.apiKey = v('sKey').trim(); s.anthropicBase = v('sBase').trim() || DEFAULT_SETTINGS.anthropicBase; s.model = v('sModel');
    k.openaiKey = v('sOKey').trim(); s.openai.base = v('sOBase').trim(); s.openai.model = v('sOModel').trim(); s.openai.in = n('sOIn', 0); s.openai.out = n('sOOut', 0);
    s.maxTokens = Math.max(256, Math.round(n('sMax', 8000))); s.temperature = n('sTemp', 1); s.cacheTTL = v('sTTL'); s.maxIters = Math.max(1, Math.round(n('sIters', 10))); s.keepToolTurns = Math.max(1, Math.round(n('sKeep', 2))); s.trimAboveTokens = Math.max(0, Math.round(n('sTrim', 40000))); s.readMaxChars = Math.max(1000, Math.round(n('sRead', 12000)));
    s.includeIndex = c('sIdx'); s.enterSends = c('sEnter'); s.autoApprove = c('sAuto'); s.pinned = lines(v('sPin'));
    const oldGh = JSON.stringify([g.owner, g.repo, g.branch]);
    g.owner = v('gOwner').trim(); g.repo = v('gRepo').trim(); g.branch = v('gBranch').trim(); k.ghToken = v('gTok').trim(); g.includes = lines(v('gInc')); g.excludes = lines(v('gExc')); g.exts = lines(v('gExt')).map((x) => (x.startsWith('.') ? x : '.' + x)); g.maxKB = Math.max(1, Math.round(n('gKB', 400)));
    s.writeAllow = lines(v('rAllow')); s.writeDeny = lines(v('rDeny'));
    if (oldGh !== JSON.stringify([g.owner, g.repo, g.branch])) { S.sync.lastHead = null; saveSync(); }
    saveSettings.flush(); saveSecrets.flush(); IDX.dirty = true; Chat.renderComposer(); Side.render(); UI.budget(); UI.toast('설정을 저장했습니다');
  },
  async backup(withSecrets) {
    FS.flushNow();
    const o = { app: 'ertes-studio', v: 1, ts: Date.now(), settings: S.settings, sync: S.sync, pending: S.pending, ui: S.ui, files: [...FS.map.values()], chats: S.chats, ledger: S.ledger, snaps: S.snaps };
    if (withSecrets) o.secrets = S.secrets; return o;
  },
  async restore(o) {
    if (!o || o.app !== 'ertes-studio') throw new Error('이 앱의 백업 파일이 아닙니다');
    for (const st of ['files', 'chats', 'ledger', 'snaps']) await DB.clear(st);
    await DB.put('meta', 'settings', o.settings); await DB.put('meta', 'sync', o.sync || {}); await DB.put('meta', 'pending', o.pending || []); if (o.ui) await DB.put('meta', 'ui', o.ui); if (o.secrets) await DB.put('meta', 'secrets', o.secrets);
    for (const f of o.files || []) await DB.put('files', f.path, f); for (const c of o.chats || []) await DB.put('chats', c.id, c); for (const l of o.ledger || []) await DB.put('ledger', l.id, l); for (const s of o.snaps || []) await DB.put('snaps', s.id, s);
  },
};
ACT.openSettings = () => Settings.open();
ACT.setTab = (t) => { Settings.tab = t.dataset.t; $$('.sset', Settings.m.body).forEach((s) => s.classList.toggle('on', s.dataset.s === Settings.tab)); $$('.tabs button', Settings.m.body).forEach((b) => b.classList.toggle('on', b.dataset.t === Settings.tab)); };
ACT.showKey = (t) => { const i = document.getElementById('sKey'); i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? '보기' : '숨기기'; };
ACT.showTok = (t) => { const i = document.getElementById('gTok'); i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? '보기' : '숨기기'; };
ACT.keyTest = async () => {
  const r = document.getElementById('keyRes'); const old = [S.secrets.apiKey, S.settings.anthropicBase]; S.secrets.apiKey = getVal('sKey').trim(); S.settings.anthropicBase = getVal('sBase').trim() || old[1]; r.textContent = '확인 중…';
  try { const list = await LLM.listModels(); r.innerHTML = `<span class="ok">키 정상</span> — 사용 가능 모델: ${list.slice(0, 8).map((m) => esc(m.id)).join(', ')}${list.length > 8 ? '…' : ''}`; const missing = list.filter((m) => !S.settings.models[m.id] && !Object.keys(S.settings.models).some((k) => m.id.startsWith(k))); if (missing.length) r.innerHTML += `<br><span class="warn">단가표에 없는 모델: ${missing.map((m) => esc(m.id)).join(', ')} (예산 패널에서 추가)</span>`; }
  catch (e) { r.innerHTML = `<span class="err">${esc(e.message)}</span>`; } finally { S.secrets.apiKey = old[0]; S.settings.anthropicBase = old[1]; }
};
ACT.ghTest = async () => {
  const r = document.getElementById('ghRes'); const g = S.settings.gh, k = S.secrets; const old = [g.owner, g.repo, g.branch, k.ghToken];
  g.owner = getVal('gOwner').trim(); g.repo = getVal('gRepo').trim(); g.branch = getVal('gBranch').trim(); k.ghToken = getVal('gTok').trim(); r.textContent = '확인 중…';
  try { const t = await GH.test(); r.innerHTML = `<span class="ok">연결 OK</span> — 최신 커밋 ${esc(t.head.slice(0, 7))} "${esc(t.message)}" ${k.ghToken ? '· 토큰 사용' : '· 토큰 없음(읽기 전용)'}`; }
  catch (e) { r.innerHTML = `<span class="err">${esc(e.message)}</span>`; } finally { [g.owner, g.repo, g.branch, k.ghToken] = old; }
};
ACT.persist = async () => { try { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; UI.toast(ok ? '저장소 보호가 켜졌습니다' : '브라우저가 보호 요청을 허용하지 않았습니다'); Settings.diag(); } catch (e) { UI.toast('요청 실패'); } };
ACT.bkExport = async () => { const o = await Settings.backup(!!document.getElementById('bkSec').checked); downloadText(`ertes-studio-backup-${dayKey(Date.now())}.json`, JSON.stringify(o), 'application/json'); };
ACT.bkImport = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => { try { const o = JSON.parse(await inp.files[0].text()); if (!(await dlg.confirm(`백업(${fmtDT(o.ts)})을 불러옵니다.\n현재 문서·대화·비용 기록이 모두 백업 내용으로 바뀝니다.`, { danger: true, ok: '불러오기' }))) return; await Settings.restore(o); UI.toast('불러왔습니다. 다시 시작합니다…'); setTimeout(() => location.reload(), 800); } catch (e) { UI.toast('⚠ ' + e.message, 6000); } };
  inp.click();
};
ACT.wipeFiles = async () => { if (!(await dlg.confirm('문서 캐시를 모두 지웁니다. 푸시하지 않은 변경은 사라집니다.', { danger: true, ok: '지우기' }))) return; FS.map.clear(); await DB.clear('files'); S.ui.open = []; S.ui.cur = null; S.sync.lastHead = null; await saveSync(); Pending.rejectAll(); IDX.dirty = true; Ed.renderAll(); Side.render(); renderTop(); UI.toast('지웠습니다. 동기화 탭에서 다시 받으세요.'); };
ACT.wipeAll = async () => { if (!(await dlg.confirm('설정, API 키, 문서, 대화, 비용 기록까지 전부 지웁니다. 되돌릴 수 없습니다.', { danger: true, ok: '모두 지우기' }))) return; for (const st of DB.STORES) await DB.clear(st); try { localStorage.clear(); } catch (e) {} location.reload(); };
