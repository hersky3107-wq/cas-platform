# 동반자 (Donbanja) — AI 생활 동반자

어르신을 위한 따뜻한 AI 생활 동반자. 안부·말벗, 건강·병원, 이야기, 오늘의 뇌 운동,
날씨, 소식, 문서/사진 읽기 등을 큰 글씨·읽어주기(TTS)·음성 입력으로 제공합니다.

이 폴더는 **동반자 앱만** 담은 독립 실행형(standalone) Next.js 프로젝트입니다.
(제주 도민 모드·기타 모듈은 포함하지 않습니다.)

## 실행 방법

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000 → /care 로 이동
```

프로덕션 빌드:

```bash
npm run build
npm run start
```

타입 체크:

```bash
npm run typecheck
```

## 환경 변수 (`.env.example` 참고)

| 변수 | 용도 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude — 모든 AI 기능(안부/말벗, 증상 안내, 이야기, 브레인, 소식) |
| `PERPLEXITY_API_KEY` | Perplexity — 실제 출처 기반 사실 확인(소식, 증상, 지금 문 연 곳) |
| `KPX_SERVICE_KEY` | data.go.kr 건강보험심사평가원 — 병원/약국 정보 조회 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL — 콘텐츠 캐시(이야기 등) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role 키 (서버 전용) |

일부 기능(날씨)은 키가 필요 없습니다. Supabase가 없으면 이야기/브레인/소식 캐시만
비활성화되고 나머지는 정상 동작합니다. 복지 매칭은 테이블에 데이터가 있어야 합니다.

## Supabase (DB 스키마)

동반자가 사용하는 Supabase 테이블 4개에 대한 SQL 마이그레이션이
`supabase/migrations/` 에 포함되어 있습니다. Supabase SQL Editor에서 001 → 004 순으로
실행하세요. 자세한 내용은 [`supabase/README.md`](supabase/README.md) 를 참고하세요.

| 테이블 | 용도 |
| --- | --- |
| `care_tale` | 이야기 · 좋은 말 (일별 AI 캐시) |
| `care_news` | 오늘의 소식 (일별 AI 캐시) |
| `care_brain` | 오늘의 뇌 운동 (일별 AI 캐시) |
| `care_welfare_services` | 복지·지원금 매칭 카탈로그 (오프라인 적재 필요) |

## 구조

```
app/
  layout.tsx           # 최소 루트 레이아웃
  page.tsx             # / → /care 리다이렉트
  globals.css          # Tailwind v4 엔트리
  care/                # 동반자 화면들 (홈, 안부, 병원, 이야기, 오늘, 소식, 사진 등)
  api/care/            # 동반자 API 라우트 (Claude/Perplexity/HIRA/Supabase)
lib/
  care/                # 도메인 로직 (거주지, 복지, HIRA, 날씨, Perplexity 검색)
  supabase/server.ts   # 서버 전용 Supabase 관리 클라이언트
supabase/
  migrations/          # CREATE TABLE + RLS (001–004)
  README.md            # 테이블 설명 · 적용 방법
```

`main` 진입점은 `/care` 입니다.
