# KUKU-UI — ERTES Studio 소스

[ERTES](https://github.com/Hwari2929/ERTES) 의 세계관 문서·ADV 스크립트 작업을 돕는 **단독 실행 HTML 도구(ERTES Studio)** 의 합치기 전 소스 리포입니다.
아이패드 브라우저에서 파일로 열어 쓰도록 만들었고, 대화(Anthropic API) · 문서 에디터 · GitHub 동기화 · 예산(크레딧) 패널을 한 화면에서 제공합니다.

`node build.js` 를 실행하면 `ERTES-Studio.html` 한 파일이 만들어집니다 (외부 의존성 없음, `file://` 에서 동작). 합본은 이 리포에 포함하지 않습니다.

## 구성

| 경로 | 내용 |
|---|---|
| `parts/00_util.js` | 공용 유틸, 기본 설정, 모델 단가표, 전역 상태 |
| `parts/10_store.js` | IndexedDB(→localStorage→메모리) 저장소, 가상 파일시스템, 스냅샷 |
| `parts/20_text.js` | 링크 색인, 구획 읽기, 검색, 한글 수 표기·장면·확장 문서 린트, diff/3-way 병합, 마크다운 |
| `parts/30_gh.js` | GitHub REST 동기화 (pull/병합/충돌, Git Data API 커밋·푸시) |
| `parts/40_llm.js` | Anthropic SSE 클라이언트(프롬프트 캐시), OpenAI 호환(형식상), 비용 계산, 장부, 예산 |
| `parts/45_skills.gen.js` | `skills/*.md` 에서 자동 생성 (직접 고치지 말 것) |
| `parts/50_tools.js` | 에이전트 도구(search/read_note/list_notes/write_note/edit_note/lint), 승인 대기열, 스킬, 시스템 프롬프트, 슬래시 명령 |
| `parts/55_self.js` | 자가개선: 브라우저 안에서 합본 만들기·문법 점검·미리보기 (`build.js` 와 같은 결과) |
| `parts/60_agent.js` | 대화 저장, 턴 루프, 긴 대화 정리, 중단/오류 처리 |
| `parts/70_ui_core.js` ~ `76_modals.js` | 화면: 코어(모달·메뉴), 에디터, 사이드바(파일·검색·정보·동기화), 대화창, 예산 패널, 설정, 승인/충돌/기록 |
| `parts/90_boot.js` | 시작 |
| `ui/shell.html`, `ui/style.css` | HTML 골격과 스타일 |
| `skills/*.md` | 내장 스킬(장면·확장·정합·구상·캠페인·대사·요약). 리포의 `studio/skills/*.md` 로 덮어쓸 수 있음 |
| `test/` | 로직 테스트(`t_text`, `t_gh`, `t_llm`, `t_tools`, `t_agent`, `t_batch`, `t_self`, `t_chat`)와 jsdom 화면 테스트(`t_ui`) |
| `build.js`, `gen_skills.js` | 빌드 스크립트 |
| `tools/batch-proxy-worker.js` | (선택) 배치 API 중계용 Cloudflare Worker — 합본에는 들어가지 않음 |

## 빌드 · 테스트

```
node build.js            # ERTES-Studio.html 생성
node test/t_text.js      # 순수 로직 테스트들 (의존성 없음)
node test/t_gh.js && node test/t_llm.js && node test/t_tools.js && node test/t_agent.js && node test/t_batch.js && node test/t_self.js && node test/t_chat.js
# 화면 테스트는 jsdom, fake-indexeddb 가 필요:  npm i jsdom fake-indexeddb  (test/t_ui.js 의 require 경로 참고)
```

## 메모

- 남은 크레딧은 공식 조회 API 가 없어 **장부 기준**으로 계산하고, 콘솔 잔액으로 보정합니다.
- 예산은 **달러(USD) 기준**(기본 총 크레딧 100달러)이고 원화는 보조 표시입니다(설정에서 끄기 가능). 환율은 첫 실행 때 한 번 받아 시각·출처와 함께 기록하고, 예산 패널 → 설정의 "지금 갱신"으로 다시 받습니다. 받기에 실패하면 마지막 값을 계속 쓰며 직접 입력도 됩니다.
- OpenRouter: 설정 → API → "프리셋: OpenRouter · Gemini 4 Argon" 버튼으로 주소·모델(`google/gemini-4-argon`)·단가가 채워집니다. OpenRouter 사용분은 응답의 실제 청구액으로 기록하고, Anthropic 남은 크레딧에서는 빼지 않습니다.
- 모델: Opus 5.5, Sonnet 5.5, 각각의 **배치** 버전, Haiku 5.5. 대화창 아래 모델 선택에서 "… 배치" 를 고르고 보내면 Message Batches API 로 접수됩니다(토큰 단가 50%, 보통 몇 분~몇 시간·최대 24시간). 도구·파일 색인 없이 한 번에 답하는 분석용이고, 접수 정보는 기기에 저장돼 앱을 닫았다 열어도 이어서 확인합니다. 끝나면 대화에 답이 붙고 장부에 반값으로 기록됩니다. 실패·만료는 "다시 보내기".
- **배치 모델은 프록시가 필요합니다.** Anthropic 서버가 Message Batches API(`/v1/messages/batches`)에만 브라우저 직접 호출(CORS)을 거부해서("Disallowed CORS origin"), 공식 주소로는 "네트워크 오류"가 납니다(일반 `/v1/messages` 는 정상). 설정 → API → **배치 프록시 주소**에 내 중계 주소를 넣으면 배치 요청만 그쪽으로 갑니다. 중계는 `tools/batch-proxy-worker.js` 를 Cloudflare Workers 에 붙여넣어 배포하면 됩니다(API 키는 저장하지 않고 헤더로 전달만 하며, `/v1/messages/batches` 경로만 통과). 프록시를 쓰지 않으면 배치 모델은 선택해도 접수되지 않고 이유를 안내합니다.
- **문서 안에서 찾기**: ⌘F(Windows 는 Ctrl+F)는 편집 화면과 미리보기 화면 모두에서 동작합니다. 편집 화면은 찾기/바꾸기, 미리보기 화면은 보이는 글자에서 찾아 칠해 주고(바꾸기는 편집 화면에서만) Enter/▲▼ 로 넘어갑니다. 단축키(⌘P·⌘F·⌘B·⌘J·⌘K)는 한글 입력 상태에서도 물리 글쇠 기준으로 동작합니다.
- **커밋·푸시 버튼**은 GitHub 토큰이 있고, 변경 목록에서 체크된(충돌 아님) 파일이 1개 이상일 때 켜집니다. 꺼져 있으면 버튼 아래에 이유가 표시됩니다.
- **질문·답변 고치기**: 보낸 질문과 받은 답에 ✎ 수정 / 🗑 삭제 버튼이 있고, 각 질문 끝에는 🗑 응답 삭제가 있습니다(도구 호출·결과 쌍은 함께 지워져 요청이 깨지지 않습니다). **↻ 다시 생성**은 마지막 질문을 같은 맥락·같은 입력으로 다시 보내 다른 답을 받고, 원래 답은 보관되어 ◀ 1/2 ▶ 로 넘겨 볼 수 있습니다(모델·노력을 바꾼 뒤 눌러도 됩니다). 마지막 질문에서만 다시 생성·넘겨 보기가 되고, 비용은 호출마다 장부에 따로 기록됩니다. 수정한 내용은 이후 대화의 맥락으로 쓰이며 이미 받은 다른 답이 다시 만들어지지는 않습니다. 배치 처리 중에는 그 대화를 고칠 수 없습니다.
- 노력 수준(추론 강도): 대화창의 "노력" 선택(자동/중간/높음/매우 높음) 또는 설정의 기본값. 자동은 아무것도 보내지 않아 모델 기본값(Claude 는 높음)을 따릅니다. Opus/Sonnet 은 `output_config.effort`, OpenRouter 는 `reasoning.effort` 로 전달하며 Haiku 에는 보내지 않습니다.
- OpenRouter 프리셋은 일반(`google/gemini-4-argon`)과 배치(`google/gemini-4-argon:batch`, 반값) 두 개입니다.
- **자가개선**: 상단의 "📚 설정집 / 🛠 자가개선" 스위치로 작업공간을 바꿉니다. 자가개선 모드에서는 이 리포(기본 `Hwari2929/KUKU-UI`)를 `studio-src/` 아래로 받아 AI 와 함께 소스를 고칩니다. 설정집 문서와는 완전히 분리되어 서로 보이지 않습니다.
  - 흐름: 동기화 탭에서 받기 → AI 에게 수정 요청 → 승인 대기열에서 확인 → **빌드 점검**(합본이 문법 오류 없이 만들어지는지)·**미리보기**(새 탭)·**HTML 받기** → 푸시 → **PR 만들기** → GitHub 에서 직접 병합.
  - 푸시는 작업 브랜치(기본 `self-improve`, 없으면 `main` 에서 따서 만듦)에만 합니다. `main` 에는 절대 직접 올리지 않으며, 병합은 사람이 PR 에서 합니다. 작업 브랜치가 꼬이면 "작업 브랜치 초기화"로 `main` 에 맞춥니다.
  - AI 는 `build_check` 도구로 스스로 합본 문법을 점검합니다. 자동 승인은 이 모드에서 무시되고, `.git/`·`.github/`·`node_modules/`·`parts/45_skills.gen.js`(생성물)·`ERTES-Studio.html` 등은 쓸 수 없습니다.
  - 브라우저에서는 `test/` 를 실행할 수 없습니다. 테스트는 PR 을 받아 로컬(또는 Claude Code)에서 `node test/…` 로 돌리세요. 미리보기 탭은 저장소가 분리되어 빈 상태로 열립니다.
  - 토큰은 Contents + Pull requests 쓰기 권한이 필요합니다. 설정 → 자가개선에서 리포·브랜치를 바꿉니다.
- 모델 단가는 `parts/00_util.js` 의 `DEFAULT_MODELS` (공식 가격표 2026-10-25 확인). 앱의 예산 패널에서 고칠 수 있습니다.
- AI 의 쓰기는 항상 승인 대기열을 거칩니다. 원본 설정 문서(`lore/인물/*.md` 등)는 쓰기 금지 규칙이 기본 적용됩니다.
