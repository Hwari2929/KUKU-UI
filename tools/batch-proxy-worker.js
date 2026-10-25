/* ERTES Studio — 배치 API 중계용 Cloudflare Worker (선택)
   왜 필요한가: Anthropic 은 Message Batches API(/v1/messages/batches)에만 브라우저 직접 호출(CORS)을 허용하지 않습니다.
   이 Worker 가 배치 요청만 api.anthropic.com 으로 그대로 전달하고, 브라우저가 읽을 수 있게 CORS 헤더를 붙입니다.
   - API 키는 저장하지 않고, 앱이 보낸 x-api-key 헤더를 그대로 전달만 합니다. (그래도 내 계정에 배포한 내 Worker 만 쓰세요.)
   - /v1/messages/batches 로 시작하는 경로만 전달합니다 (다른 경로는 404).
   - 선택: ALLOWED_ORIGIN 환경변수를 넣으면 그 Origin 만 허용합니다. file:// 로 여는 앱은 Origin 이 "null" 이라 비워 두거나 "null" 로 두세요.
   배포: Cloudflare 대시보드 → Workers & Pages → Create → Hello World → 이 코드를 붙여넣고 Deploy → 나온 주소를 앱 설정 → API → "배치 프록시 주소"에 입력. */
const CORS = (origin) => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access',
  'access-control-max-age': '600',
  vary: 'Origin',
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return new Response('forbidden origin', { status: 403 });
    const cors = CORS(env.ALLOWED_ORIGIN ? origin : '*');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/v1/messages/batches')) return new Response('not found', { status: 404, headers: cors });
    const fwd = new Headers();
    for (const h of ['content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta']) { const v = req.headers.get(h); if (v) fwd.set(h, v); }
    const res = await fetch('https://api.anthropic.com' + url.pathname + url.search, { method: req.method, headers: fwd, body: req.method === 'GET' ? undefined : req.body });
    const out = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
