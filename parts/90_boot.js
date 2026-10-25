/* ═══════════ 90 · 시작 ═══════════ */
if (typeof window.requestAnimationFrame !== 'function') window.requestAnimationFrame = (f) => setTimeout(f, 16);
async function boot() {
  const t0 = Date.now();
  try {
    await DB.init(); await loadSettings(); await FS.load(); await Snap.load(); await Ledger.load(); await Chats.load(); await Batch.load();
    S.ui.open = (S.ui.open || []).filter((p) => FS.has(p)); if (S.ui.cur && !FS.has(S.ui.cur)) S.ui.cur = S.ui.open[0] || null;
    mount(); applyTheme(); applyLayout(); initSplitter();
    Ed.init(); Chat.init(); Side.render(); renderTop();
    if (innerWidth < 980 && S.ui.sideOpen && S.ui.cur) { S.ui.sideOpen = false; applyLayout(); }   // 좁은 화면은 사이드바를 접은 채 시작
    const flush = () => { try { FS.flushNow(); saveSettings.flush && saveSettings.flush(); saveUi.flush && saveUi.flush(); } catch (e) {} };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else if (Batch.pending().length) Batch.tick().catch(() => {}); });
    window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver/.test(e.message)) UI.toast('⚠ ' + e.message, 5000); });
    window.addEventListener('unhandledrejection', (e) => { const m = e && e.reason && (e.reason.message || String(e.reason)); if (m) UI.toast('⚠ ' + m, 5000); });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if (DB.kind !== 'indexeddb') UI.toast(`⚠ 저장소: ${DB.kind} (IndexedDB 불가) — 설정 → 데이터에서 백업을 자주 내보내세요`, 7000);
    else if (!FS.paths().length) { S.ui.sideTab = 'sync'; S.ui.sideOpen = true; applyLayout(); Side.render(); }
    if (!S.secrets.apiKey && S.settings.provider === 'anthropic') setTimeout(() => UI.toast('설정(⚙) → API 에서 Anthropic API 키를 넣어 주세요', 6000), 600);
    if (Batch.pending().length) { Batch.arm(); setTimeout(() => Batch.tick().catch(() => {}), 1500); }   // 앱을 닫아 둔 사이 끝난 배치 확인
    FX.firstRun().catch(() => {});   // 환율 기록이 없으면(첫 실행) 한 번만 받아 기록 — 실패해도 조용히 기본값 사용
    window.__ready = Date.now() - t0;
  } catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('afterbegin', `<div style="position:fixed;inset:0;z-index:999;background:#fff;color:#222;padding:24px;font:15px/1.6 system-ui;overflow:auto"><h2>시작하지 못했습니다</h2><pre style="white-space:pre-wrap">${esc(e && e.stack || e)}</pre><p>저장소: ${esc(DB.kind)} ${esc(DB.lastError)}</p><button onclick="location.reload()">다시 시도</button></div>`);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
