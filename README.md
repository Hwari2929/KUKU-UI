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
| `parts/60_agent.js` | 대화 저장, 턴 루프, 긴 대화 정리, 중단/오류 처리 |
| `parts/70_ui_core.js` ~ `76_modals.js` | 화면: 코어(모달·메뉴), 에디터, 사이드바(파일·검색·정보·동기화), 대화창, 예산 패널, 설정, 승인/충돌/기록 |
| `parts/90_boot.js` | 시작 |
| `ui/shell.html`, `ui/style.css` | HTML 골격과 스타일 |
| `skills/*.md` | 내장 스킬(장면·확장·정합·구상·캠페인·대사·요약). 리포의 `studio/skills/*.md` 로 덮어쓸 수 있음 |
| `test/` | 로직 테스트(`t_text`, `t_gh`, `t_llm`, `t_tools`, `t_agent`)와 jsdom 화면 테스트(`t_ui`) |
| `build.js`, `gen_skills.js` | 빌드 스크립트 |

## 빌드 · 테스트

```
node build.js            # ERTES-Studio.html 생성
node test/t_text.js      # 순수 로직 테스트들 (의존성 없음)
node test/t_gh.js && node test/t_llm.js && node test/t_tools.js && node test/t_agent.js
# 화면 테스트는 jsdom, fake-indexeddb 가 필요:  npm i jsdom fake-indexeddb  (test/t_ui.js 의 require 경로 참고)
```

## 메모

- 남은 크레딧은 공식 조회 API 가 없어 **장부 기준**으로 계산하고, 콘솔 잔액으로 보정합니다.
- 예산은 **달러(USD) 기준**(기본 총 크레딧 100달러)이고 원화는 보조 표시입니다(설정에서 끄기 가능). 환율은 첫 실행 때 한 번 받아 시각·출처와 함께 기록하고, 예산 패널 → 설정의 "지금 갱신"으로 다시 받습니다. 받기에 실패하면 마지막 값을 계속 쓰며 직접 입력도 됩니다.
- OpenRouter: 설정 → API → "프리셋: OpenRouter · Gemini 4 Argon" 버튼으로 주소·모델(`google/gemini-4-argon`)·단가가 채워집니다. OpenRouter 사용분은 응답의 실제 청구액으로 기록하고, Anthropic 남은 크레딧에서는 빼지 않습니다.
- 모델 단가는 `parts/00_util.js` 의 `DEFAULT_MODELS` (공식 가격표 2026-10-25 확인). 앱의 예산 패널에서 고칠 수 있습니다.
- AI 의 쓰기는 항상 승인 대기열을 거칩니다. 원본 설정 문서(`lore/인물/*.md` 등)는 쓰기 금지 규칙이 기본 적용됩니다.
