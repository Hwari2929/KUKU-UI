// 사용: node build.js [출력경로]  → 단독 실행 HTML 한 파일 생성
const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
const W = __dirname;
cp.execFileSync(process.execPath, [path.join(W, 'gen_skills.js')], { stdio: 'inherit' });
const order = ['00_util', '10_store', '20_text', '30_gh', '40_llm', '45_skills.gen', '50_tools', '60_agent', '65_batch', '70_ui_core', '71_editor', '72_sidebar', '73_chat', '74_budget', '75_settings', '76_modals', '90_boot'];
const js = order.map((n) => `/* ── ${n} ── */\n` + fs.readFileSync(path.join(W, 'parts', n + '.js'), 'utf8')).join('\n;\n');
try { new vm.Script(js, { filename: 'bundle.js' }); } catch (e) { console.error('문법 오류:', e.message); process.exit(1); }
const css = fs.readFileSync(path.join(W, 'ui', 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(W, 'ui', 'shell.html'), 'utf8');
html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));
const out = process.argv[2] || path.join(W, 'ERTES-Studio.html');
fs.writeFileSync(out, html);
console.log(`생성: ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)}KB, JS ${(Buffer.byteLength(js) / 1024).toFixed(0)}KB)`);
