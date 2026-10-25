/* ═══════════ 55 · 자가개선: 브라우저 안에서 합본 만들기 · 문법 점검 · 미리보기 ═══════════
   build.js 와 같은 일을 한다(조각을 order 순서로 이어 붙이고, 스킬 묶음을 만들고, shell.html 에 끼워 넣기).
   읽는 곳은 studio-src/ 의 파일이며, 아직 승인하지 않은 AI 초안(Pending)도 그 위에 얹어서 본다. */
const SelfBuild = {
  read(rel) { const v = Pending.view(SELF_PREFIX + rel); return v == null ? null : v; },
  // build.js 안의 `const order = [...]` 를 읽는다 → 조각을 새로 추가해도 build.js 만 고치면 따라온다
  order() {
    const b = this.read('build.js'); if (b == null) throw new Error('build.js 가 없음 — 자가개선 모드에서 먼저 받기(pull)를 하세요.');
    const m = b.match(/const order = \[([^\]]*)\]/); if (!m) throw new Error('build.js 에서 order 목록을 찾지 못함');
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  },
  // gen_skills.js 와 같은 결과 (skills/*.md → DEFAULT_SKILLS)
  skillsGen() {
    const names = new Set(); const pre = SELF_PREFIX + 'skills/';
    for (const p of [...FS.allPaths(), ...S.pending.map((x) => x.path)]) if (p.startsWith(pre) && p.endsWith('.md') && !p.slice(pre.length).includes('/') && Pending.view(p) != null) names.add(p.slice(pre.length));
    const out = {}; for (const f of [...names].sort()) out[f.replace(/\.md$/, '')] = String(Pending.view(pre + f)).replace(/\r\n/g, '\n');
    return '/* 자동 생성 — skills/*.md 에서 만들어짐. 직접 고치지 마세요. */\nconst DEFAULT_SKILLS = ' + JSON.stringify(out, null, 1) + ';\n';
  },
  build() {
    let order; try { order = this.order(); } catch (e) { return { ok: false, error: e.message }; }
    const texts = [], missing = [];
    for (const n of order) { const t = n === '45_skills.gen' ? this.skillsGen() : this.read('parts/' + n + '.js'); if (t == null) { missing.push(n + '.js'); texts.push(''); } else texts.push(t); }
    if (missing.length) return { ok: false, error: `build.js 의 order 에 있지만 파일이 없음: ${missing.join(', ')}` };
    const js = order.map((n, i) => `/* ── ${n} ── */\n` + texts[i]).join('\n;\n');
    try { new Function(js); }
    catch (e) {
      const bad = []; order.forEach((n, i) => { try { new Function(texts[i]); } catch (e2) { bad.push(`parts/${n}.js — ${e2.message}`); } });
      return { ok: false, error: bad.length ? bad.join('\n') : `조각 하나씩은 문제가 없지만 합치면 오류: ${e.message} (같은 이름의 const/함수를 두 조각에서 선언했는지 확인)` };
    }
    const css = this.read('ui/style.css'), shell = this.read('ui/shell.html');
    if (css == null || shell == null) return { ok: false, error: 'ui/style.css 또는 ui/shell.html 이 없음' };
    if (!shell.includes('/*__CSS__*/') || !shell.includes('/*__JS__*/')) return { ok: false, error: 'shell.html 에 /*__CSS__*/ 또는 /*__JS__*/ 자리표시가 없음' };
    const html = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));
    const enc = new TextEncoder();
    return { ok: true, html, bytes: enc.encode(html).length, jsBytes: enc.encode(js).length, order };
  },
  // 눌렀을 때 바로 새 탭으로 연다 (비동기 작업을 끼우면 아이패드 사파리가 팝업을 막는다). 저장소는 이 앱과 분리되므로 새 앱은 빈 상태로 열린다.
  preview() {
    const r = this.build(); if (!r.ok) return r;
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
    const w = window.open(url, '_blank'); if (!w) return { ok: false, error: '새 탭이 막혔습니다. 주소창의 팝업 허용을 켜거나 "HTML 받기"를 쓰세요.' };
    setTimeout(() => URL.revokeObjectURL(url), 600000); return r;
  },
};
