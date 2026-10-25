// 순수 로직 파트를 vm 컨텍스트에 이어 붙여 로드하는 테스트 하네스
const fs = require('fs'), vm = require('vm'), path = require('path');
const W = path.join(__dirname, '..');
module.exports = function load(parts, extra = {}, names = '') {
  const ctx = vm.createContext({ console, atob: globalThis.atob, btoa: globalThis.btoa, ReadableStream, Uint8Array, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, AbortController, structuredClone, Map, Set, Uint32Array, Promise, JSON, Date, Math, Number, String, Array, Object, RegExp, Error, document: undefined, ...extra });
  let code = parts.map((p) => fs.readFileSync(path.join(W, 'parts', p), 'utf8')).join('\n;\n');
  // const/let 최상위 선언을 컨텍스트 밖에서도 읽도록 노출
  code += '\n;globalThis.__exp = { S, UI, FS, DB, IDX, Snap, lintText, findNumerals, fixNumerals, diffOps, diffHTML, diffStat, merge3, resolveSegs, lcsPairs, outlineOf, sectionOf, searchNotes, resolveName, parseLinks, linksOf, backlinksOf, renderMd, canWrite, matchRule, estTokens, normPath, titleOf, ensureIndex, deepMerge, DEFAULT_SETTINGS, fmtUSD, fmtN, lintSummary, lintReport' + (names ? ', ' + names : '') + ' };';
  vm.runInContext(code, ctx, { filename: 'bundle.js' });
  return ctx.__exp;
};
