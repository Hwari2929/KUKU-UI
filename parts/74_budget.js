/* ═══════════ 74 · 예산 패널: 현황 · 턴별 내역 · 통계 · 보정/설정/단가 ═══════════ */
const num = (s) => { const v = parseFloat(String(s ?? '').replace(/[,₩$\s]/g, '')); return Number.isFinite(v) ? v : NaN; };
const BudgetUI = {
  m: null, tab: 'now', chat: '', open1: new Set(),
  open(o = {}) {
    if (o.chat != null) { this.chat = o.chat; this.tab = 'turns'; }
    if (this.m && !this.m.done) { this.render(); return; }
    this.m = Modal.show({ title: '예산 패널', cls: 'wide', buttons: [{ label: '닫기', value: true }], html: '<div id="bud"></div>', onClose: () => (this.m = null) });
    this.render();
  },
  refresh: debounce(() => { if (BudgetUI.m && !BudgetUI.m.done && !BudgetUI.editing()) BudgetUI.render(); }, 250),
  editing() { const a = document.activeElement; return !!(a && this.m && this.m.body.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); },
  render() {
    if (!this.m) return; const box = this.m.body.querySelector('#bud'); const y = this.m.body.scrollTop;
    const tabs = [['now', '현황'], ['turns', '턴 내역'], ['stats', '통계'], ['cfg', '보정 · 설정 · 단가']];
    box.innerHTML = `<nav class="tabs" style="margin:-4px -4px 12px;border-radius:10px;overflow:hidden">${tabs.map(([k, l]) => `<button data-act="budTab" data-t="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>` + this['t_' + this.tab]();
    this.m.body.scrollTop = y;
  },
  // ── 현황
  t_now() {
    const b = Budget.state(), cfg = Budget.cfg, tot = Ledger.total(), today = Ledger.today(); const u = tot.usage; const cur = Chat ? Ledger.sum(S.ledger.filter((e) => e.chatId === S.ui.chatId)) : { cost: 0, n: 0 };
    const pct = Math.min(100, b.pct); const lv = b.level;
    const parts = S.ledger.reduce((a, e) => { a.in += e.parts.in; a.cw += e.parts.cw5 + e.parts.cw1h; a.cr += e.parts.cr; a.out += e.parts.out; return a; }, { in: 0, cw: 0, cr: 0, out: 0 });
    const hit = Ledger.cacheHit();
    const spentSince = Budget.spentSince();
    const row = (k, tok, cost) => `<tr><td>${k}</td><td>${fmtN(tok)}</td><td>${usd(cost)}</td><td>${fmtKRW(cost)}</td></tr>`;
    return `<div class="big">
      <div class="stat"><div class="k">남은 크레딧 (장부 기준)</div><div class="v ${lv === 'stop' ? 'err' : lv === 'warn' ? 'warn' : ''}">${fmtKRW(b.remaining)}</div><div class="s">${usd(b.remaining)}</div></div>
      <div class="stat"><div class="k">사용한 크레딧</div><div class="v">${fmtKRW(b.used)}</div><div class="s">${usd(b.used)} · 총 ${fmtKRW(b.creditUSD)} 중 ${b.pct.toFixed(1)}%</div></div>
      <div class="stat"><div class="k">오늘 사용</div><div class="v">${fmtKRW(today.cost)}</div><div class="s">${usd(today.cost)} · 호출 ${today.n}회</div></div>
      <div class="stat"><div class="k">이 대화 사용</div><div class="v">${fmtKRW(cur.cost)}</div><div class="s">${usd(cur.cost)} · 호출 ${cur.n}회</div></div>
    </div>
    <div class="meter" title="경고 ${cfg.warnPct}% · 중단 ${cfg.stopPct}%"><i class="${lv === 'stop' ? 'stop' : lv === 'warn' ? 'warn' : ''}" style="width:${pct}%"></i><u style="left:${cfg.warnPct}%"></u><u style="left:${cfg.stopPct}%"></u></div>
    <div class="xs muted" style="display:flex;justify-content:space-between"><span>0</span><span>경고 ${cfg.warnPct}% · 중단 ${cfg.stopPct}%</span><span>${fmtKRW(b.creditUSD)}</span></div>
    ${lv !== 'ok' ? `<div class="banner ${lv === 'stop' ? 'err' : 'warn'}" style="border-radius:10px;margin-top:10px">${lv === 'stop' ? '⛔ 예산 한도에 도달해 AI 호출이 막혀 있습니다. 보정 · 설정 탭에서 한도를 조정하거나 잔액을 보정하세요.' : '⚠ 경고 구간입니다. 남은 예산을 확인하세요.'}</div>` : ''}
    <div class="sect">전망</div>
    <div class="card flat sm">평균 한 턴 <b>${usd(b.avgTurn)}</b> (${fmtKRW(b.avgTurn)}) — 최근 20턴 기준${b.runway != null ? ` · 남은 예산으로 약 <b>${fmtN(b.runway)}턴</b> 더 가능` : ' · 아직 기록이 없습니다'}.<br>
      <span class="muted">장부 계산: 보정 기준점(${fmtDT(cfg.anchorTs)}) 잔액 ${usd(cfg.anchorUSD)} − 그 이후 지출 ${usd(spentSince)} = ${usd(b.remaining)}. 콘솔 잔액과 어긋나면 <a href="#" data-act="budTab" data-t="cfg">보정</a> 하세요.</span></div>
    <div class="sect">토큰 종류별 누적 (전체 ${fmtN(tot.n)}회 호출)</div>
    <div class="scrollx"><table class="tb"><thead><tr><th>종류</th><th>토큰</th><th>비용 (USD)</th><th>비용 (KRW)</th></tr></thead><tbody>
      ${row('입력 (캐시 안 된 새 토큰)', u.input, parts.in)}${row('캐시 쓰기 (5분 ' + fmtN(u.cw5) + ' · 1시간 ' + fmtN(u.cw1h) + ')', u.cw5 + u.cw1h, parts.cw)}${row('캐시 읽기', u.cacheRead, parts.cr)}${row('출력', u.output, parts.out)}
      <tr><td><b>합계</b></td><td><b>${fmtN(u.input + u.cw5 + u.cw1h + u.cacheRead + u.output)}</b></td><td><b>${usd(tot.cost)}</b></td><td><b>${fmtKRW(tot.cost)}</b></td></tr></tbody></table></div>
    <div class="sect">캐시 효과</div>
    <div class="card flat sm">입력 중 캐시에서 읽은 비율 <b>${(hit * 100).toFixed(0)}%</b> · 캐시 덕에 아낀 금액 약 <b class="ok">${usd(tot.saved)}</b> · 캐시 쓰기 할증으로 더 낸 금액 약 ${usd(tot.premium)} → 순이득 약 <b class="${tot.saved - tot.premium >= 0 ? 'ok' : 'err'}">${usd(tot.saved - tot.premium)}</b>
      ${hit < 0.3 && tot.n > 8 ? '<br><span class="warn">캐시 적중이 낮습니다. 5분 넘게 쉬었다 이어 쓰면 식어요 — 설정에서 캐시 시간을 1시간으로 바꾸면 쉬는 시간이 길어도 유지됩니다.</span>' : ''}</div>`;
  },
  // ── 턴 내역
  t_turns() {
    const chats = new Map(S.chats.map((c) => [c.id, c.title])); const list = Ledger.turns(120, this.chat || undefined);
    const sel = `<div class="inl" style="margin-bottom:8px"><select id="budChat" style="max-width:300px"><option value="">모든 대화</option>${S.chats.map((c) => `<option value="${c.id}" ${this.chat === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select><span class="grow"></span><button class="sm" data-act="budCsvCopy">CSV 복사</button><button class="sm" data-act="budCsvDl">CSV 내려받기</button></div>`;
    if (!list.length) return sel + '<div class="empty">아직 기록이 없습니다</div>';
    const sum = list.reduce((a, t) => { a.cost += t.cost; a.u = addUsage(a.u, t.usage); return a; }, { cost: 0, u: zeroUsage() });
    const rows = list.map((t) => {
      const w = t.usage.cw5 + t.usage.cw1h; const open = this.open1.has(t.turnId);
      let h = `<tr class="cl" data-act="budRow" data-id="${t.turnId}"><td class="l">${open ? '▾' : '▸'} ${fmtDT(t.ts)}</td><td class="l" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(t.label)}">${esc(t.label || '(없음)')}${t.partial ? ' <span class="tag warn">중단</span>' : ''}</td><td class="l">${esc((S.settings.models[t.model] || {}).label || t.model)}</td><td>${t.iters}</td><td>${fmtN(t.usage.input)}</td><td>${fmtN(w)}</td><td>${fmtN(t.usage.cacheRead)}</td><td>${fmtN(t.usage.output)}</td><td><b>${usd(t.cost)}</b></td><td>${fmtKRW(t.cost)}</td></tr>`;
      if (open) h += t.entries.map((e) => `<tr class="sub"><td class="l">${fmtDT(e.ts)} · ${e.iter}번째 호출${e.partial ? ' (중단)' : ''}</td><td class="l" colspan="2">${esc((chats.get(t.chatId) || '') + (e.tools.length ? ' · ' + e.tools.join(', ') : ''))}</td><td>${e.stop ? esc(e.stop) : ''}</td><td>${fmtN(e.usage.input)}</td><td>${fmtN(e.usage.cw5 + e.usage.cw1h)}</td><td>${fmtN(e.usage.cacheRead)}</td><td>${fmtN(e.usage.output)}</td><td>${usd(e.cost)}</td><td>${fmtKRW(e.cost)}</td></tr>`).join('');
      return h;
    }).join('');
    return sel + `<div class="scrollx"><table class="tb"><thead><tr><th class="l">시각</th><th class="l">요청</th><th class="l">모델</th><th>호출</th><th>입력</th><th>캐시 쓰기</th><th>캐시 읽기</th><th>출력</th><th>USD</th><th>KRW</th></tr></thead><tbody>${rows}<tr><td class="l" colspan="3"><b>표시된 ${list.length}턴 합계</b></td><td></td><td><b>${fmtN(sum.u.input)}</b></td><td><b>${fmtN(sum.u.cw5 + sum.u.cw1h)}</b></td><td><b>${fmtN(sum.u.cacheRead)}</b></td><td><b>${fmtN(sum.u.output)}</b></td><td><b>${usd(sum.cost)}</b></td><td><b>${fmtKRW(sum.cost)}</b></td></tr></tbody></table></div><div class="xs muted" style="margin-top:6px">행을 누르면 호출별(도구 루프 단계별) 내역이 펼쳐집니다. 입력 = 캐시되지 않은 새 토큰, 캐시 읽기는 단가의 1/10 수준.</div>`;
  },
  // ── 통계
  t_stats() {
    const days = Ledger.byDay(14), mods = Ledger.byModel(), chs = Ledger.byChat().slice(0, 10); const chats = new Map(S.chats.map((c) => [c.id, c.title]));
    const mx = Math.max(0.0001, ...days.map((d) => d.cost));
    return `<div class="sect">일별 (최근 14일)</div><div class="scrollx"><table class="tb"><thead><tr><th class="l">날짜</th><th>호출</th><th>입력+캐시</th><th>출력</th><th>USD</th><th>KRW</th><th class="l"></th></tr></thead><tbody>${days.map((d) => `<tr><td class="l">${d.day}</td><td>${d.n}</td><td>${fmtN(d.usage.input + d.usage.cacheRead + d.usage.cw5 + d.usage.cw1h)}</td><td>${fmtN(d.usage.output)}</td><td>${usd(d.cost)}</td><td>${fmtKRW(d.cost)}</td><td class="l"><span class="bar" style="width:${Math.round(d.cost / mx * 120)}px"></span></td></tr>`).join('') || '<tr><td colspan="7" class="muted">기록 없음</td></tr>'}</tbody></table></div>
      <div class="sect">모델별</div><div class="scrollx"><table class="tb"><thead><tr><th class="l">모델</th><th>호출</th><th>출력 토큰</th><th>USD</th><th>KRW</th></tr></thead><tbody>${mods.map((m) => `<tr><td class="l">${esc(m.model)}</td><td>${m.n}</td><td>${fmtN(m.usage.output)}</td><td>${usd(m.cost)}</td><td>${fmtKRW(m.cost)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">기록 없음</td></tr>'}</tbody></table></div>
      <div class="sect">대화별 (상위 10)</div><div class="scrollx"><table class="tb"><thead><tr><th class="l">대화</th><th>호출</th><th>USD</th><th>KRW</th></tr></thead><tbody>${chs.map((c) => `<tr class="cl" data-act="budChatGo" data-id="${c.chatId}"><td class="l">${esc(chats.get(c.chatId) || '(삭제된 대화)')}</td><td>${c.n}</td><td>${usd(c.cost)}</td><td>${fmtKRW(c.cost)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>'}</tbody></table></div>`;
  },
  // ── 보정 · 설정 · 단가
  t_cfg() {
    const b = Budget.cfg, log = (b.calibLog || []).slice().reverse(); const spent = Budget.spentSince(); const last = (b.calibLog || [])[(b.calibLog || []).length - 1];
    const f = (id, label, val, hint = '') => `<div class="frow"><label for="${id}">${label}</label><input type="text" inputmode="decimal" id="${id}" value="${esc(val)}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const M = S.settings.models;
    return `<div class="card"><b>남은 크레딧 보정</b><div class="sm muted" style="margin:4px 0 8px">Anthropic 에는 개인 계정의 잔액을 조회하는 API 가 없어서, 이 앱은 <b>기록(장부)</b>으로 계산합니다. 콘솔(Billing)에서 본 실제 잔액을 넣으면 그 시점부터 다시 맞춥니다.</div>
      <div class="inl"><input type="text" inputmode="decimal" id="calVal" placeholder="콘솔에서 본 잔액"><select id="calUnit" style="width:90px"><option value="USD">USD</option><option value="KRW">KRW</option></select><button class="primary" data-act="budCalib">보정</button></div>
      <div class="xs muted" style="margin-top:6px">현재 장부 값: ${usd(Budget.remaining())} (${fmtKRW(Budget.remaining())}) · 보정 이후 지출 ${usd(spent)}</div>
      ${log.length ? `<div class="scrollx" style="margin-top:8px;max-height:180px"><table class="tb"><thead><tr><th class="l">보정 시각</th><th>장부 예측</th><th>실제</th><th>오차</th></tr></thead><tbody>${log.map((l) => `<tr><td class="l">${fmtDT(l.ts)}</td><td>${usd(l.predicted)}</td><td>${usd(l.actual)}</td><td class="${Math.abs(l.drift) < 0.05 ? 'ok' : 'warn'}">${l.drift >= 0 ? '+' : ''}${usd(l.drift)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${last && last.spent > 0.5 && Math.abs(last.drift) / last.spent > 0.03 ? `<div class="banner warn" style="border-radius:8px;margin-top:8px">마지막 보정에서 지출 ${usd(last.spent)} 중 오차 ${usd(last.drift)} (${(last.drift / last.spent * 100).toFixed(1)}%). 단가 배율을 <b>${(Math.max(0.5, Math.min(2, (last.spent - last.drift) / last.spent)) * (b.costScale || 1)).toFixed(3)}</b> 로 맞추면 앞으로 더 정확해집니다. <button class="sm" data-act="budScale">배율 적용</button></div>` : ''}</div>
    <div class="card"><b>크레딧 · 한도</b>
      ${f('cfCredit', '총 크레딧 (KRW)', fmtN(b.creditKRW), '구독으로 받은 API 크레딧 총액')}${f('cfRate', '환율 (KRW/USD)', b.krwPerUSD, '원화 표시에만 쓰입니다. 콘솔은 USD 기준.')}
      ${f('cfWarn', '경고 (%)', b.warnPct)}${f('cfStop', '중단 (%)', b.stopPct, '이 사용률에 닿으면 AI 호출을 막습니다')}${f('cfRes', '예비금 (USD)', b.reserveUSD, '잔액이 이 밑으로 내려가면 호출을 막습니다')}${f('cfCap', '한 턴 비용 상한 (USD)', b.turnCapUSD, '도구를 연달아 쓰는 중 이 금액을 넘으면 멈춥니다')}${f('cfScale', '단가 배율', b.costScale || 1, '실제 청구와 장부가 계속 어긋날 때만 조정 (기본 1)')}
      <div class="inl" style="margin-top:8px"><button class="primary" data-act="budSave">저장</button><button class="sm" data-act="budReset" title="총 크레딧 전체가 남은 것으로 다시 시작">처음 상태로</button><span class="grow"></span><button class="sm danger" data-act="budClear">장부 전체 지우기</button></div>
      <div class="xs muted" style="margin-top:6px">총 크레딧·환율을 바꿔도 남은 금액은 그대로 유지됩니다.</div></div>
    <div class="card"><b>모델 단가 (USD / 100만 토큰)</b> <span class="xs muted">공식 가격표 ${PRICE_VERIFIED} 확인 · 고칠 수 있음</span>
      <div class="scrollx" style="margin-top:8px"><table class="tb"><thead><tr><th class="l">모델 ID</th><th>입력</th><th>출력</th><th>캐시 쓰기 5분</th><th>캐시 쓰기 1시간</th><th>캐시 읽기</th><th></th></tr></thead><tbody>${Object.entries(M).map(([id, p]) => `<tr data-model="${esc(id)}"><td class="l mono">${esc(id)}</td>${['in', 'out', 'cw5', 'cw1h', 'cr'].map((k) => `<td><input type="text" inputmode="decimal" data-k="${k}" value="${p[k]}" style="width:72px;min-height:30px;padding:2px 6px;text-align:right"></td>`).join('')}<td><button class="sm ghost" data-act="priceDel" data-id="${esc(id)}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="inl" style="margin-top:8px"><button class="sm" data-act="priceAdd">모델 추가</button><button class="sm" data-act="priceReset">기본값으로</button><span class="grow"></span><button class="primary sm" data-act="priceSave">단가 저장</button></div>
      <div class="xs muted" style="margin-top:6px">Haiku 는 프롬프트 10만 토큰을 넘으면 높은 단가가 자동 적용됩니다. 목록에 없는 모델은 가장 비싼 단가로 보수적으로 계산해요.</div></div>`;
  },
};
const getVal = (id) => (document.getElementById(id) || {}).value;
ACT.openBudget = () => BudgetUI.open();
ACT.budTab = (t, e) => { e && e.preventDefault && e.preventDefault(); BudgetUI.tab = t.dataset.t; BudgetUI.render(); };
ACT.budRow = (t) => { const id = t.dataset.id; if (BudgetUI.open1.has(id)) BudgetUI.open1.delete(id); else BudgetUI.open1.add(id); BudgetUI.render(); };
ACT.budChatGo = (t) => { BudgetUI.chat = t.dataset.id; BudgetUI.tab = 'turns'; BudgetUI.render(); };
document.addEventListener('change', (e) => { if (e.target && e.target.id === 'budChat') { BudgetUI.chat = e.target.value; BudgetUI.render(); } });
ACT.budCsvCopy = () => copyText(Ledger.csv());
ACT.budCsvDl = () => downloadText(`ertes-ledger-${dayKey(Date.now())}.csv`, Ledger.csv(), 'text/csv');
ACT.budCalib = async () => {
  let v = num(getVal('calVal')); if (!(v >= 0)) return UI.toast('잔액 숫자를 넣어 주세요'); const unit = getVal('calUnit'); const usdV = unit === 'KRW' ? v / Budget.cfg.krwPerUSD : v;
  const before = Budget.remaining(); const r = Budget.calibrateUSD(usdV); UI.toast(`보정 완료 — 장부 ${usd(before)} → 실제 ${usd(usdV)} (오차 ${usd(usdV - before)})`, 4500); BudgetUI.render();
};
ACT.budScale = () => { const b = Budget.cfg, last = b.calibLog[b.calibLog.length - 1]; if (!last) return; b.costScale = +(Math.max(0.5, Math.min(2, (last.spent - last.drift) / last.spent)) * (b.costScale || 1)).toFixed(4); saveSettings(); UI.toast('단가 배율 ' + b.costScale); BudgetUI.render(); };
ACT.budSave = () => {
  const b = Budget.cfg; const g = (id) => num(getVal(id)); const vals = { credit: g('cfCredit'), rate: g('cfRate'), warn: g('cfWarn'), stop: g('cfStop'), res: g('cfRes'), cap: g('cfCap'), scale: g('cfScale') };
  if (Object.values(vals).some((x) => !(x >= 0)) || !(vals.rate > 0) || !(vals.scale > 0)) return UI.toast('숫자를 확인하세요');
  if (vals.credit !== b.creditKRW || vals.rate !== b.krwPerUSD) Budget.setCredit(vals.credit, vals.rate);
  b.warnPct = vals.warn; b.stopPct = vals.stop; b.reserveUSD = vals.res; b.turnCapUSD = vals.cap; b.costScale = vals.scale; saveSettings(); UI.budget(); UI.toast('저장했습니다'); BudgetUI.render();
};
ACT.budReset = async () => { if (await dlg.confirm('총 크레딧 전체가 남아 있는 상태로 기준점을 다시 잡습니다. (장부 기록은 유지됩니다)', { ok: '다시 시작' })) { Budget.reset(); BudgetUI.render(); } };
ACT.budClear = async () => { if (await dlg.confirm('모든 비용 기록(장부)을 지웁니다. 되돌릴 수 없습니다.', { danger: true, ok: '지우기' })) { const rem = Budget.remaining(); await Ledger.clear(); Budget.cfg.anchorUSD = +rem.toFixed(4); Budget.cfg.anchorTs = Date.now(); saveSettings(); UI.budget(); BudgetUI.render(); } };
function readPrices() {
  const out = {}; $$('tr[data-model]', BudgetUI.m.body).forEach((tr) => { const id = tr.dataset.model; const old = S.settings.models[id] || {}; const p = { ...old }; for (const inp of $$('input[data-k]', tr)) { const v = num(inp.value); if (!(v >= 0)) throw new Error(`${id}: 숫자를 확인하세요`); p[inp.dataset.k] = v; } out[id] = p; }); return out;
}
ACT.priceSave = () => { try { S.settings.models = readPrices(); saveSettings(); UI.toast('단가 저장됨'); BudgetUI.render(); } catch (e) { UI.toast('⚠ ' + e.message); } };
ACT.priceDel = async (t) => { if (await dlg.confirm(`${t.dataset.id} 단가 행을 지울까요?`)) { delete S.settings.models[t.dataset.id]; saveSettings(); BudgetUI.render(); } };
ACT.priceAdd = async () => { const id = await dlg.prompt('모델 ID (예: claude-sonnet-5-5)', '', { title: '모델 추가' }); if (!id || !id.trim()) return; S.settings.models[id.trim()] = { label: id.trim(), in: 3, out: 15, cw5: 3.75, cw1h: 6, cr: 0.3, ctx: 200000 }; saveSettings(); BudgetUI.render(); UI.toast('기본값을 넣어 두었으니 단가를 확인하세요'); };
ACT.priceReset = async () => { if (await dlg.confirm('모델 단가를 기본값으로 되돌립니다.')) { S.settings.models = clone(DEFAULT_MODELS); saveSettings(); BudgetUI.render(); } };
