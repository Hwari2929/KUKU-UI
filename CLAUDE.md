# CLAUDE.md — KUKU-UI

## 이 리포는
ERTES 프로젝트(Obsidian 방식 세계관 문서 + ADV 캠페인 스크립트)의 집필·설정 작업을 돕는 **단독 실행 HTML 도구 "ERTES Studio"** 의 소스입니다.
브라우저(아이패드 포함)에서 `file://` 로 열리는 HTML 한 파일로 빌드되며, 서버가 없습니다. 기능은 대화(Anthropic API 직접 호출), 문서 에디터, GitHub 동기화, 예산(크레딧) 추적입니다.
작업 대상 문서 리포는 https://github.com/Hwari2929/ERTES 이고, 이 리포에는 도구의 코드만 있습니다.

## 구조
- `parts/` — 번호 순서대로 이어 붙여 한 스크립트가 되는 조각들. 앞 번호가 뒤 번호의 의존 대상입니다 (00 유틸 → 10 저장소 → 20 텍스트 → 30 GitHub → 40 LLM/예산 → 50 도구 → 55 자가개선 → 60 에이전트 → 65 배치 → 70~76 화면 → 90 시작).
- `ui/` — `shell.html`(골격), `style.css`.
- `skills/*.md` — 내장 스킬. `gen_skills.js` 가 `parts/45_skills.gen.js` 를 생성합니다 (생성물은 직접 고치지 않음).
- `test/` — `t_text`, `t_gh`, `t_llm`, `t_tools`, `t_agent`, `t_batch`, `t_self`, `t_chat` 는 Node 만으로 실행. `t_ui` 는 jsdom + fake-indexeddb 필요.
- `build.js` — 조각을 합쳐 `ERTES-Studio.html` 생성 (합본은 커밋하지 않음).

## 작업 규칙
- 외부 라이브러리·CDN을 쓰지 않습니다. 합본은 의존성 없는 단독 파일이어야 합니다.
- 바꾼 뒤에는 `node build.js` 로 문법 오류가 없는지 확인하고 관련 `test/` 를 돌립니다.
- 모델 단가는 `parts/00_util.js` 의 `DEFAULT_MODELS` 가 기준입니다. 가격을 바꿀 때는 공식 가격표를 확인하고 확인 날짜(`PRICE_VERIFIED`)도 갱신합니다.
- 남은 크레딧은 조회 API 가 없어 장부(`Ledger`) 기준 계산 + 사용자 보정 방식입니다. 이 구조를 유지합니다.
- 프롬프트 캐시를 깨지 않도록, 시스템 프롬프트에 시간·날짜·대기열처럼 자주 변하는 값을 넣지 않습니다. 캐시 중단점은 최대 4개입니다.
- AI 의 파일 쓰기는 항상 승인 대기열(`Pending`)을 거치고, 쓰기 허용/금지 규칙(`canWrite`)을 우회하지 않습니다.
- 자가개선 모드(`studio-src/`)는 설정집 작업공간과 섞이지 않게 `wsNow()`/`inWs()` 로 걸러 씁니다. 푸시는 작업 브랜치에만 하고 `main` 에는 직접 올리지 않으며(`GH.push` 가 거부), `SelfBuild.build()` 는 `build.js` 와 바이트 단위로 같은 결과를 내야 합니다(`t_self` 가 검증). `build.js` 의 order 를 바꾸면 이 점도 같이 확인합니다.
- 배치(`/v1/messages/batches`)는 Anthropic 이 브라우저 CORS 를 거부하므로 `batchBase`(프록시) 없이는 동작하지 않습니다. 이 사실을 가리지 말고 오류 문구로 알립니다. 대화 메시지의 `vers`/`vi`(다시 생성 보관본)는 보이는 쪽을 `null` 로 두는 규칙이며 `Chats.*` 함수로만 바꿉니다(`t_chat` 참고).
- 사용자 대면 문구는 한국어로 씁니다.
- 아이패드(하드웨어 키보드) 사용이 기본입니다. 네이티브 `alert/confirm/prompt` 대신 `dlg` 모달을 쓰고, 입력창은 한글 IME 조합 중(`isComposing`/`keyCode 229`) Enter 를 가로채지 않습니다.
