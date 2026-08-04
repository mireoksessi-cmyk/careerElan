# Phase 5 Discovery Report

Status: **조사 전용 문서** — 이 문서는 어떤 구현도 승인하거나 지시하지 않는다. Phase 5의 실제 작업 범위/순서는 이 문서를 사용자와 함께 검토한 뒤 별도로 확정한다.

조사 방법: 코드를 직접 읽고(Read/Grep/Glob) 실제 코드 경로를 확인하는 정적 분석만 사용했다. 실제 브라우저 클릭이나 HTTP 호출은 하지 않았다(아래 "HTTP 정책" 참조) — 모든 판정은 실제 소스 코드 인용에 근거한다.

---

## 1. 현재 프로젝트 구조

```
app/                          Next.js 16 App Router 페이지 + API 라우트
  page.tsx                    랜딩 페이지 + 로그인/가입 모달 (실제 인증 로직 포함)
  login/page.tsx               /login - 홈 모달로 안내하는 얇은 리다이렉트 stub (의도된 설계)
  signup/page.tsx               /signup - 별도의 전체 가입 페이지 (272줄)
  auth/callback/route.ts       OAuth 콜백 처리
  dashboard/page.tsx           대시보드
  career-memory/page.tsx       Career Memory 입력 + Resume/Cover Letter 업로드
  paste-job/page.tsx           Job 입력 + Generate Package + Preview + Export (가장 큰 페이지)
  create-package/page.tsx      Create Package 진입/설명 페이지 (실제 생성 로직은 paste-job으로 위임)
  job-tracker/page.tsx         Job Tracker (지원 History)
  analytics/page.tsx           Analytics
  find-jobs/page.tsx           Find Jobs
  career-fairs/page.tsx        Career Fairs 목록
  settings/page.tsx            Settings
  cookies/, privacy/, terms/   법적 문서 페이지
  dev/brand-poc/, dev/dpe-measure/   내부 개발자 전용 진단 도구 (nav 미노출)
  api/                         26개 실제 route.ts (아래 §3 Flow에서 상세)
lib/
  generatePackage/             Generate Package 핵심 파이프라인 (generateCore.ts, shared.ts)
  documentPreservation/        DPE (RC 확정, Feature Freeze 상태)
  documentAnalysis/            Resume/Cover Letter 분석 파이프라인
  brand/                       DocumentIR 기반 렌더러 + PDF/DOCX Export
  careerFairs/                 Career Fair 수집/추천
  auth/LoginManager.tsx        전역 인증 상태 Context (실제 Supabase Auth 연동)
  resume-service.ts, resume-builder.ts   Resume 소스 해석 + Career Memory 텍스트 생성
  services/                    ai.ts, package.ts - 사용되지 않는 죽은 stub (§7 참조)
components/
  job-layout/                  Header, Sidebar, JobList, JobDetail, FilterBar, StatsCards 등
  resume/, coverLetter/        Preview 렌더러
  analytics/                   Analytics 위젯 (일부 미사용, §7 참조)
  careerFairs/, chatbot/, legal/, brand/
supabase/migrations/           DB 스키마 (RC까지 다수의 마이그레이션 적용됨)
fixtures/                      DPE Regression Fixture (8개, Freeze 상태)
docs/                          REGRESSION_MATRIX.md, FIXTURE_FREEZE.md, KNOWN_LIMITATIONS.md (이전 라운드 산출물)
```

## 2. 기존 UI 목록 (화면별 조사)

### Dashboard (`app/dashboard/page.tsx`)
1. **구현 여부**: Complete
2. **컴포넌트**: `components/job-layout/Sidebar.tsx`, `Header.tsx`, `components/resume/ResumePreviewRenderer.tsx`
3. **API**: `/api/career-fairs/recommend`, `/api/recommend-jobs`, `/api/generate-package/usage`
4. **백엔드 연결**: 실제 `career_memory`, `resumes`, `applications` 테이블 조회(`app/dashboard/page.tsx:1158,1210,1233,1264,1397,1452,1968`)
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음 확인
7. **미완성 기능**: 없음
8. **Phase 5 참고**: 특별한 조치 불필요로 보임

### Resume 업로드 흐름 (`app/career-memory/page.tsx`)
1. **구현 여부**: Complete
2. **컴포넌트**: `components/resume/CareerMemoryTemplatePreview.tsx`, `DocxResumePreview.tsx`, `PdfResumePreview.tsx`
3. **API**: `/api/analyze-resume`, `/api/process-resume-design`
4. **백엔드 연결**: 실제 Storage 업로드 + `resumes` 테이블 insert + `lib/documentAnalysis/resumeAnalysisCore.ts` 실제 OpenAI 호출
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음 확인
8. **Phase 5 참고**: 다수의 `[RESUME_TRACE]` 태그 진단 로그가 프로덕션 코드에 남아있음 (§7 기술 부채 참조) — 제거/게이팅 검토 대상

### Cover Letter 흐름
1. **구현 여부**: Complete — 단, 독립된 최상위 페이지가 아니라 `app/career-memory/page.tsx` 내부에 통합되어 있음 (`handleCoverLetterUpload`, `app/career-memory/page.tsx:1618`, `cover_letters` 테이블 조작: `:1718,1782,1872,1894,1918`)
2. **컴포넌트**: `components/coverLetter/CoverLetterPreviewRenderer.tsx`, `PdfCoverLetterPreview.tsx`, `DocxCoverLetterPreview.tsx`, `CareerElanCoverLetterPreview.tsx`
3. **API**: `/api/analyze-cover-letter`, `/api/process-cover-letter-design`, `/api/cover-letters/[id]/preview-url`
4. **백엔드 연결**: 실제 `cover_letters` 테이블 + Storage
5. **Placeholder**: `app/create-package/page.tsx`에서 "cover letter"는 마케팅 카피 텍스트로만 등장(`:101,144,163`) — 실제 업로드 UI는 아님. 혼동 가능성이 있는 지점.
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음
8. **Phase 5 참고**: Cover Letter 업로드가 Career Memory 페이지에 묻혀 있어 발견성(discoverability)이 낮을 수 있음 — UX 개선 검토 대상 (구현은 하지 않음, 조사만)

### Job 입력 / Paste Job / Generate (`app/paste-job/page.tsx`, 2600줄+)
1. **구현 여부**: Complete
2. **컴포넌트**: 자체 대형 페이지, `exportPdfFromText`/`exportDocxFromText`(`lib/brand/render/`), `exportPdf`/`exportDocx`(`lib/exportDocument.ts`)
3. **API**: `/api/generate-package`(`:1233,1387`), `/api/generate-package/usage`(`:1568`), `/api/resumes/selected`(`:2088`)
4. **백엔드 연결**: 실제 `applications` 테이블 insert/update, 실제 OpenAI 호출(`lib/generatePackage/generateCore.ts`)
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음
8. **Phase 5 참고**: 다수의 raw `console.log` 진단 출력이 남아있음(§7)

### Export (PDF/DOCX 다운로드)
1. **구현 여부**: Complete
2. **컴포넌트/함수**: `lib/brand/render/pdfDocumentExport.ts`(`exportPdfFromText`), `lib/brand/render/docxDocumentExport.ts`(`exportDocxFromText`) — Resume(템플릿 인지, `resumeTemplateId` 전달)용. `lib/exportDocument.ts`(`exportPdf`/`exportDocx`) — Cover Letter/Email(템플릿 없는 평문)용. 두 경로가 공존하는 것은 중복이 아니라 **콘텐츠 종류에 따른 의도된 분기**(`app/paste-job/page.tsx:2562-2591`, `downloadPdf()`/`downloadDocx()`의 `if (selectedPreview === "resume")` 분기).
3. **API**: 없음 (클라이언트 사이드 export)
4. **백엔드 연결**: N/A (파일 생성은 클라이언트에서 수행)
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음
8. **Phase 5 참고**: 없음

### History (`app/job-tracker/page.tsx`)
1. **구현 여부**: Complete
2. **컴포넌트**: `app/job-tracker/A4Preview.tsx`
3. **API**: 없음(직접 Supabase 클라이언트 쿼리)
4. **백엔드 연결**: 실제 `applications` 테이블 조회(`:80,130,155,206,246,290`)
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음
8. **Phase 5 참고**: `console.log("DATA =", data)`(`:94-95`) 진단 출력 잔존(§7)

### Settings (`app/settings/page.tsx`)
1. **구현 여부**: **Partial** — 계정/비밀번호 변경은 Complete, 알림 설정은 명시적으로 비활성화된 Placeholder
2. **컴포넌트**: `components/job-layout/Header.tsx`, `Sidebar.tsx`
3. **API**: 없음(직접 Supabase 쿼리 + Auth)
4. **백엔드 연결**: 실제 `profiles` 테이블
5. **Placeholder**: **"Coming soon" 배지 2개, 정확히 `app/settings/page.tsx:506`(Email Notifications), `:541`(Marketing Emails)**. 두 토글 모두 `disabled` 속성이 있는 `<input type="checkbox">`이며(`:517-518, 552-553`), 상단에 명시적 안내 문구가 있음(`:488-492`): "These preferences are saved, but Career Élan doesn't send automated emails yet." — 값은 `profiles` 테이블에 저장되지만 실제 이메일 발송 기능은 없다고 스스로 고지하는 정직한 stub. 실제 발송 로직 없음은 의도된 설계이며 버그가 아님(이전 라운드에서 이미 검증됨).
6. **Mock 데이터**: 없음(체크박스 상태 자체는 실제 DB 값)
7. **미완성 기능**: 이메일 발송 인프라 자체가 없음 — 토글은 UI로서 완성되어 있으나 기능적으로는 미구현
8. **Phase 5 참고**: 이메일 발송(알림/마케팅)을 실제로 구현할지, 이 Placeholder를 계속 유지할지는 Phase 5 범위 결정 사항

### Billing
1. **구현 여부**: **Missing** — 앱 전체에서 billing/subscription/payment/stripe/checkout 페이지나 API 라우트가 전혀 존재하지 않음(전체 `app/`, `lib/` 재귀 검색으로 확인)
2. **컴포넌트**: 없음. 단, **`components/job-layout/Sidebar.tsx:109-127`에 실제 "Upgrade to Pro" 카드가 있고, 그 안의 `<button>` 요소(`:124-126`)는 `onClick` 핸들러가 전혀 없는 순수 장식용 버튼**. 사용자가 클릭해도 아무 일도 일어나지 않음.
3. **API**: 없음
4. **백엔드 연결**: 없음
5. **Placeholder**: 위 Upgrade 버튼이 곧 Placeholder임(텍스트: "Unlock unlimited AI features and faster package generation.")
6. **Mock 데이터**: N/A
7. **미완성 기능**: Billing 전체
8. **Phase 5 참고**: Billing을 이번 Phase에서 구현할지 여부, 구현한다면 그 전까지 이 Upgrade 버튼을 숨길지/비활성 상태로 명확히 표시할지 결정 필요

### Authentication
1. **구현 여부**: Complete
2. **컴포넌트**: `app/page.tsx`(로그인/가입 모달, 실제 `signInWithPassword`(`:257`), `signUp`(`:362`) 호출), `app/signup/page.tsx`(272줄, 전체 가입 페이지), `app/login/page.tsx`(19줄, 홈 모달로 안내하는 의도된 리다이렉트 stub), `lib/auth/LoginManager.tsx`(전역 세션 Context, 실제 `supabase.auth.getSession()`/`onAuthStateChange` + `profiles`/`career_memory`/`resumes`/`cover_letters` 4개 테이블 동시 조회)
3. **API**: `/api/auth/consent-intent`, `/api/login-by-id`, `app/auth/callback/route.ts`(OAuth)
4. **백엔드 연결**: 실제 Supabase Auth
5. **Placeholder**: 없음
6. **Mock 데이터**: 없음
7. **미완성 기능**: 없음
8. **Phase 5 참고**: 없음

### Navigation (`components/job-layout/Sidebar.tsx`)
1. **구현 여부**: Complete (Billing 버튼 제외)
2. **실제 링크**: Dashboard(`/dashboard`), Career Memory(`/career-memory`), Find Jobs(`/find-jobs`), Create Package(`/create-package`), Job Tracker(`/job-tracker`), Analytics(`/analytics`), Settings(`/settings`) — 7개 전부 `app/` 아래 실제 라우트로 존재함(`components/job-layout/Sidebar.tsx:5-13`)
3. **주의**: `/paste-job`과 `/career-fairs`는 사이드바 nav에 없지만 Dashboard/Find Jobs/Create Package/`JobDetail.tsx`에서 링크로 연결되어 있어 고아 라우트(orphaned route)는 아님
4. **백엔드 연결**: N/A
5. **Placeholder**: Upgrade 버튼(위 Billing 참조)
6. **Mock 데이터**: N/A
7. **미완성 기능**: 없음
8. **Phase 5 참고**: 없음

### Analytics / Find Jobs / Create Package (간단 조사)
- **Analytics**(`app/analytics/page.tsx`): Complete. 실제 `applications` 테이블 기반(`loadApplications()`), 크로스탭 동기화까지 구현(storage 이벤트 리스너, `:33-59`). `components/analytics/AnalyticsStats.tsx`, `StatusChart.tsx`, `TopSkills.tsx`, `MissingSkills.tsx`, `AiSummary.tsx` 5개만 실제 import됨 — `WeeklyChart.tsx`, `ATSChart.tsx`, `BestResume.tsx` 3개는 어디에서도 import되지 않는 죽은 컴포넌트(§7).
- **Find Jobs**(`app/find-jobs/page.tsx`): 이전 라운드에서 실제 Career Fair/Job 추천 기능으로 완성됨(코드 존재 확인, 상세 재검증은 이번 조사 범위상 생략).
- **Create Package**(`app/create-package/page.tsx`): 실제 생성 로직 없음 — Paste Job으로 안내하는 소개/설명 페이지 역할. Complete(설계상 의도된 역할).

## 3. 기존 Flow (전체 트레이스, 코드 기반 확인)

| 단계 | 상태 | 근거 |
|---|---|---|
| 1. Login | Complete | `app/page.tsx:257` 실제 `signInWithPassword`; 성공 시 `lib/auth/LoginManager.tsx`가 세션 감지 후 `/dashboard`로 진행 가능 |
| 2. Resume 업로드 | Complete | `app/career-memory/page.tsx` → `/api/analyze-resume`(실제 route 존재) → `lib/documentAnalysis/resumeAnalysisCore.ts`(실제 OpenAI 3회 호출) |
| 3. Job 입력 | Complete | `app/paste-job/page.tsx` → `/api/analyze-job`, `/api/analyze-job-url`(둘 다 실제 route 존재) |
| 4. Generate | Complete | `app/paste-job/page.tsx:1233,1387` → `/api/generate-package`(실제 route) → `lib/generatePackage/generateCore.ts`(`runPackageGeneration`) |
| 5. Validation | Complete | `lib/generatePackage/shared.ts`의 Protected Claims/Business Logic 검증 + `lib/documentPreservation/executionEngine/validation.ts`의 DPE Validation(RC 8/8 PASS로 확정됨) |
| 6. Preview | Complete | `components/resume/ResumePreviewRenderer.tsx`, `components/coverLetter/CoverLetterPreviewRenderer.tsx`, `lib/brand/render/DocumentRenderer.tsx` |
| 7. Export | Complete | 위 §2 Export 항목 참조 — 두 개의 의도된 export 경로 모두 실제로 wiring됨 |
| 8. History | Complete | `app/job-tracker/page.tsx`가 실제 `applications` 테이블에서 완료된 패키지를 조회 |

**Broken Flow: 발견되지 않음.** 프론트엔드가 참조하는 모든 API 경로에 대해 실제 `app/api/.../route.ts` 파일이 존재함을 확인했다. 유일한 실제 미완성 지점은 화면 내부의 기능 단위(Billing 버튼, 알림 이메일)이며, 이들은 전체 Flow 자체를 끊지 않는다.

## 4. 완성된 기능

- 인증(로그인/가입/OAuth/세션 관리)
- Resume/Cover Letter 업로드 + 실제 AI 분석
- Job 설명 입력(텍스트/URL) + 분석
- Generate Package(실제 OpenAI + DPE 파이프라인, RC 8/8 PASS)
- Protected Claims/Business Logic Validation
- Preview(Resume/Cover Letter, 4개 템플릿: Classic/Professional/Creative/Modern)
- PDF/DOCX Export(템플릿 인지 Resume + 평문 Cover Letter/Email)
- Job Tracker(History)
- Analytics(실 데이터 기반, 크로스탭 동기화 포함)
- Career Fairs 검색/추천
- Settings의 계정/비밀번호 변경, Delete Account

## 5. 부분 구현 기능

- **Settings 알림(Email/Marketing)**: UI+DB 저장은 완성, 실제 이메일 발송 기능 없음(명시적 "Coming soon" 고지)
- **Cover Letter 업로드**: 기능적으로 완성이지만 Career Memory 페이지에 통합되어 있어 독립적 발견성이 낮음

## 6. 미구현 기능

- **Billing/Subscription/Payment**: 페이지, API, DB 스키마 전부 없음. Sidebar에 미작동 "Upgrade" 버튼만 존재.
- **실제 이메일 발송 인프라**: Settings의 알림 토글이 저장하는 값을 소비하는 발송 로직 없음.

## 7. 기술 부채

### TODO/FIXME/XXX/Deprecated
전체 `app/`, `lib/`, `components/`에서 **0건** — 정적 마커 형태의 기술 부채는 없음.

### 죽은 코드 (Unused/Dead)
- `lib/services/package.ts`의 `generatePackage()` — `console.log`만 하고 `null` 반환. 전체 코드베이스에서 import 0건.
- `lib/services/ai.ts`의 `askAI()` — `console.log`만 하고 `""` 반환. import 0건.
- `components/analytics/WeeklyChart.tsx`, `ATSChart.tsx`, `BestResume.tsx` — 어느 페이지에서도 import되지 않음(Analytics 페이지는 5개 컴포넌트만 실제 사용).

### 프로덕션 코드에 남은 console.log
대표 사례(전체 목록은 아니며, 실제 소스에서 유사 패턴이 다수 확인됨):
- `app/settings/page.tsx:98-100` — `console.log("user.id =", user.id)` 등 raw 디버그 출력
- `app/job-tracker/page.tsx:94-95` — `console.log("DATA =", data)`, `console.log("ERROR =", error)`
- `app/career-memory/page.tsx` 다수 — `[RESUME_TRACE]` 태그가 붙은 것은 의도된 구조적 진단 로그로 보이나(`:1277,1298,1316,1324,1337,1373,1409,1433,1535,1543,1548,1555,1563`), `"SAVE CLICKED"`(`:809`), `"CAREER MEMORY DATA ="`(`:777`) 등은 raw 디버그 출력
- `app/dashboard/page.tsx:1542` — `console.log("❌ NO USER")` 등
- `app/page.tsx:246-247` — `console.log("LOOKUP STATUS =", ...)`, `console.log("LOOKUP DATA =", ...)`
- `lib/resume-builder.ts:203-204` — **실제 프로덕션 경로**(`buildResumeFromCareerMemory`, career_memory 소스 이력서 생성 시마다 실행)에서 생성된 이력서 전체 텍스트를 서버 로그에 출력(`console.log("===== AI RESUME BUILDER =====")`, `console.log(resume)`)
- `app/api/generate-package/route.ts`, `app/api/analyze-job-url/route.ts`, `app/auth/callback/route.ts` 등 API 라우트에도 다수의 `console.log` 존재(구조화된 것과 raw 혼재)

### Hardcoded 값
- Sidebar의 "Upgrade to Pro" 카드 문구(§6 Billing 참조) — 기능이 없는 상태에서 문구만 고정 노출

### Mock 데이터
`fixtures/`, `__tests__` 외 실제 프로덕션 코드 경로에서 하드코딩된 mock 데이터 배열/객체는 발견되지 않음(`compressionRetry.ts:24`의 "mock" 언급은 실제로는 "이것은 mock이 아니다"라는 주석 문구였음 — 오탐).

### Dead Route
프로덕션 nav에서 도달 불가능한 라우트는 없음(`/paste-job`, `/career-fairs`도 다른 페이지에서 링크됨). `app/dev/brand-poc/page.tsx`, `app/dev/dpe-measure/page.tsx`는 nav에 없는 내부 개발자 도구 라우트로, 이번 조사에서는 이들에 인증 게이트가 있는지 확인하지 못했다(Phase 5 작업 목록에 조사 항목으로 남김).

## 8. Phase 5 작업 목록 (우선순위)

| 우선순위 | 항목 | 근거 |
|---|---|---|
| High | Billing 방향 결정 — 구현할지, Sidebar Upgrade 버튼을 숨기거나 "Coming soon"으로 명확히 표시할지 | 현재 클릭해도 반응 없는 버튼이 실제 사용자에게 노출되어 있음(`components/job-layout/Sidebar.tsx:124-126`) |
| High | `lib/resume-builder.ts:203-204`의 사용자 이력서 전체 텍스트 콘솔 출력 제거/게이팅 검토 | 실제 프로덕션 경로에서 매 생성마다 발생하는 잠재적 개인정보 로그 노출 |
| Medium | `app/dev/brand-poc`, `app/dev/dpe-measure`의 인증 게이트 여부 확인 | 내부 도구가 인증 없이 공개 접근 가능한지 불확실 |
| Medium | Settings 알림 이메일 발송 기능 구현 여부 결정 | 현재 "Coming soon" 상태 유지 vs 실제 구현 |
| Medium | raw `console.log` 디버그 출력 정리(구조화된 `[RESUME_TRACE]`류는 유지, `"SAVE CLICKED"`류는 정리) | 로그 노이즈 및 잠재적 정보 노출 |
| Low | `lib/services/package.ts`, `lib/services/ai.ts` 죽은 stub 제거 | 사용되지 않는 레거시 코드 |
| Low | `components/analytics/WeeklyChart.tsx`, `ATSChart.tsx`, `BestResume.tsx` 사용 여부 결정(Analytics에 통합할지 삭제할지) | 완성되어 있으나 어디에도 연결되지 않은 컴포넌트 |
| Low | Cover Letter 업로드 UX 발견성 개선 검토 | 기능은 완성되어 있으나 Career Memory 페이지에 묻혀 있음 |

## 9. 예상 작업 순서

1. Billing 방향 결정(구현 여부) — 다른 항목보다 먼저 결정해야 Sidebar UI 처리 방향이 정해짐
2. 보안/개인정보 관련 항목(resume-builder.ts 콘솔 출력, dev 도구 인증 게이트) 우선 처리
3. Settings 알림 기능 방향 결정
4. 나머지 기술 부채(죽은 코드, console.log 정리, Analytics 미사용 컴포넌트) 정리
5. UX 개선(Cover Letter 발견성 등)은 마지막

이 순서는 조사 결과에 근거한 제안일 뿐이며, 실제 Phase 5 착수 시 사용자와 재확인이 필요하다.

## 10. 예상 위험 요소

- **DPE Feature Freeze와의 충돌**: Phase 5 작업이 `lib/documentPreservation/`, Validation, Protected Claims, Prompt에 손대지 않도록 계속 주의해야 함(이번 조사에서는 해당 파일들을 전혀 수정하지 않았음).
- **Regression Fixture Freeze와의 충돌**: 새 기능이 Generate Package 경로를 조금이라도 바꾸면 `docs/REGRESSION_MATRIX.md`의 8개 Fixture를 재검증해야 함.
- **console.log 제거 시 실제 디버깅 능력 손실 위험**: `[RESUME_TRACE]`류처럼 실제로 유용한 구조화 로그와 raw 디버그 출력을 구분하지 못하고 한꺼번에 제거하면 향후 문제 진단이 어려워질 수 있음 — 개별 검토 필요.
- **Billing 구현 시 범위 급증 위험**: 결제 연동은 이 프로젝트에 처음 도입되는 완전히 새로운 도메인(PCI 컴플라이언스, Webhook, 구독 상태 동기화 등)이라 다른 항목보다 훨씬 큰 작업량이 될 수 있음.
- **dev 전용 페이지의 실제 노출 범위 미확인**: 인증 게이트 여부를 이번 조사에서 확인하지 못했으므로, 실제로는 이미 보안 문제가 존재할 수도 있음 — Phase 5 착수 전 우선 확인 권장.

---

## HTTP 호출 정책 준수

이 조사는 **HTTP 호출 0회**로 완료되었다. 모든 화면/Flow/API 연결 상태는 프론트엔드 코드와 `app/api/` 실제 파일을 대조하는 정적 코드 읽기만으로 충분히 확인 가능했으며, 실제 Resume 실행이 필요한 모호한 지점이 발견되지 않았다.
