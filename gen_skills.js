// skills/*.md → parts/45_skills.gen.js (내장 스킬 문자열 묶음)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'skills'); const out = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) out[f.replace(/\.md$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(__dirname, 'parts', '45_skills.gen.js'), '/* 자동 생성 — skills/*.md 에서 만들어짐. 직접 고치지 마세요. */\nconst DEFAULT_SKILLS = ' + JSON.stringify(out, null, 1) + ';\n');
console.log('skills:', Object.keys(out).join(', '));
