# DPE Regression Matrix

Status: Release Candidate (RC) — last verified 8/8 PASS via real HTTP end-to-end run.

## 1. Regression Suite 개요

Document Preservation Engine(DPE)은 Generate Package가 생성한 텍스트를 사용자가 업로드한 원본 이력서/커버레터 파일(PDF/DOCX)의 실제 레이아웃에 재배치하는 서브시스템이다 (`lib/documentPreservation/`). 이 회귀 스위트는 실제 `/api/generate-package` HTTP 엔드포인트를 통해 실제 OpenAI 호출 + 실제 DPE 파이프라인(Layout Analysis → Content Box Generation → Content Mapping → Replacement → Measurement → Overflow Detection → Validation → DB Save)을 end-to-end로 검증한다. Mock이나 스텁이 아닌 실제 실행 결과(`generation_status`, `dpe_status`, `dpe_reason`)를 기준으로 판정한다.

8개 Fixture는 이 엔진이 이전에 실제로 겪었던, 실제 evidence로 확인된 버그들을 각각 방지하기 위해 설계되었다 — 임의의 샘플이 아니라 특정 회귀를 감시하는 목적 기반(purpose-built) 테스트 집합이다.

## 2. 8개 Fixture 목록

| # | Key | 파일 | 계정(local) | Template |
|---|---|---|---|---|
| 1 | `word_docx` | word-docx-resume.docx | dpe-e2e-word-docx@example.com | classic |
| 2 | `standard_pdf` | standard-pdf-resume.pdf | dpe-e2e-standard-pdf@example.com | professional |
| 3 | `canva_pdf` | canva-pdf-resume.pdf | dpe-e2e-canva-pdf@example.com | creative |
| 4 | `google_docs_docx` | google-docs-resume.docx | dpe-e2e-google-docs@example.com | modern |
| 5 | `pdf_cover_letter` | pdf-cover-letter.pdf (+ word-docx-resume.docx) | dpe-e2e-cover-letter@example.com | classic |
| 6 | `regtest1` | regtest1-regulated-nurse-resume.docx | dpe-regtest-rn@example.com | classic |
| 7 | `regtest3` | regtest3-two-column-pdf.pdf | dpe-regtest3-2col@example.com | classic |
| 8 | `regtest4` | regtest4-repeated-tokens-pdf.pdf | dpe-regtest4-repeat@example.com | classic |

파일은 `fixtures/resumes/`, `fixtures/coverletters/`에 위치한다. 실행 스크립트는 `fixtures/scripts/seedE2E.mts`(계정/파일 시딩), `fixtures/scripts/runE2E.mts` / `runSingle.mts`(원본 5종 실행)이다. regtest1/3/4는 별도의 임시 러너로 실행되어 왔으며 공유 인프라 파일(`runE2E.mts`)에는 아직 편입되어 있지 않다 — 향후 정식으로 편입 시 이 문서를 갱신할 것.

## 3. Fixture 목적 및 4. 방지하는 버그

| Fixture | 목적 | 방지하는 버그 |
|---|---|---|
| `word_docx` | MS Word로 작성된 단일 컬럼 DOCX의 기준선(baseline) 보존 | DOCX Content Box Generation/Mapping/Replacement 파이프라인 전반의 기준 회귀 |
| `standard_pdf` | 단일 컬럼 PDF의 기준선 보존 (geometry 기반 라인/블록 클러스터링) | PDF 라인/블록 클러스터링(`groupIntoLines`/`groupLinesIntoBlocks`) 기준 회귀 |
| `canva_pdf` | 사이드바형 다단(多段) PDF의 헤딩+본문 번들링, Skills 들여쓰기 처리 | 헤딩-바디 번들 오분류로 인한 텍스트 유실(Phase5 Gate Blocker 3(c)); 갭 기반 컬럼 검사 도입 시 정상적인 Skills 들여쓰기를 오검출하는 회귀 |
| `google_docs_docx` | Google Docs로 export된 DOCX(Word와 다른 마크업 특성)의 Summary 매핑 | Summary Mapping 누락(원본에 Summary 섹션이 없을 때 AI가 생성한 Summary가 배치될 곳이 없어 Validation이 부당하게 FAIL하던 문제, Task A 근본 수정) |
| `pdf_cover_letter` | Cover Letter 문서 타입 전용 경로(섹션 헤딩이 없는 본문형 문서) | Cover Letter 전용 role 분류(`cover_letter_body` 기본값) 및 Cover Letter DPE 경로 회귀 |
| `regtest1` | 면허/자격이 필요한 규제 직군(Regulated Role) 이력서 + 원본에 없는 Skills 섹션 | (a) `missingLegalRequirement`가 비규제 직군에도 잘못 발생하던 문제(Blocker 1); (b) AI가 원본에 없는 Skills 섹션을 생성했을 때 Validation이 부당하게 FAIL하던 문제(RC 라운드에서 근본 수정) |
| `regtest3` | 실제 2단(2-column) PDF의 컬럼 간 역할(role) 분리 | Known Limitation #001: 컬럼 경계를 넘어 역할이 잘못 상속되는 문제(Contact→Summary, Experience 단편→Education/Certification 오분류) |
| `regtest4` | 여러 섹션/페이지에 걸쳐 동일한 텍스트 토큰이 반복되는 PDF | Box-level Template Preservation Validation의 정확 텍스트 매칭이 서로 다른 위치의 동일 텍스트를 같은 박스로 오인해 발생하던 `unexpected_template_mutation` 오탐(Blocker 3, composite identity key 도입으로 수정) |

## 5. 기대 결과 (Expected `dpe_status`)

| Fixture | 기대 `dpe_status` |
|---|---|
| `word_docx` | SUCCESS |
| `standard_pdf` | SUCCESS |
| `canva_pdf` | PARTIAL_SUCCESS |
| `google_docs_docx` | PARTIAL_SUCCESS |
| `pdf_cover_letter` | SUCCESS |
| `regtest1` | SUCCESS |
| `regtest3` | PARTIAL_SUCCESS |
| `regtest4` | SUCCESS |

PARTIAL_SUCCESS로 지정된 3개(`canva_pdf`, `google_docs_docx`, `regtest3`)는 다단/복잡 레이아웃 특성상 완전한 1:1 재현이 구조적으로 불가능한 지점이 있음을 이미 알고 있는 상태이며, 이는 결함이 아니라 이 엔진의 정직하게 공개된 한계다(`docs/KNOWN_LIMITATIONS.md` 참조). PARTIAL_SUCCESS도 정상 PASS로 간주한다 — FAIL/ERROR류 상태만 실패로 간주한다.

## 6. PASS 조건

특정 Fixture가 PASS로 판정되려면 다음을 모두 만족해야 한다:

1. HTTP `/api/generate-package` 호출이 202 + `applicationId`를 반환한다.
2. 폴링 결과 `generation_status = "succeeded"`이다 (`"failed"`가 아니다).
3. `dpe_status`가 위 5번 표의 그 Fixture 고유 기대값과 **정확히 일치**한다 (다른 값으로 바뀌는 것도 회귀로 간주 — 예상보다 "더 좋아 보이는" 값으로 바뀌어도 반드시 조사 대상).
4. Validation 단계에서 그 Fixture가 원래 방지하도록 설계된 버그의 재현 징후(예: `missing_content`/`broken_mapping` for Skills on regtest1, `unexpected_template_mutation` on regtest4)가 없다.

8개 Fixture 전체가 PASS일 때만 RC를 "8/8 PASS"로 확정한다.

## 7. 실패 시 조사 절차

1. **추측 금지 — 실제 로그만 사용.** 실패한 Fixture의 실제 `generation_status`, `dpe_status`, `dpe_reason`, HTTP status, 실패 단계를 DB(`applications` 테이블)와 dev 서버 로그에서 직접 확인한다.
2. **실패 단계를 특정한다**: Layout Analysis / Content Box Generation / Content Mapping / Replacement / Measurement / Overflow Detection / Validation / DB Save 중 어디서 실패했는지 실제 실행 증거로 확인한다.
3. **Root Cause를 다음 3가지 중 하나로 분류한다** (이 엔진의 검증된 방법론):
   - **A. Fixture 문제** — 원본 파일 자체가 잘못 설계됨 → Fixture 파일만 수정, 제품 코드는 건드리지 않는다.
   - **B. Validation 정책 문제** — 정상적인 AI 출력에 대해 Validation이 과도하게 엄격함 → 최소 범위의, 명시적으로 한정된 정책 예외만 추가한다 (전역 완화 금지).
   - **C. 기타 제품 버그** — 그 버그만 최소 범위로 수정한다.
4. **최소 수정 원칙**: 관련 없는 파일/리팩터링/아키텍처 변경/Prompt 변경 금지. 수정은 근본 원인이 위치한 정확한 지점에만 적용한다.
5. **전체 8개 Fixture 재실행**: 수정 후 반드시 8개 Fixture 전체를 실제 HTTP end-to-end로 재실행하여, 수정 대상이 아닌 나머지 Fixture들의 결과가 단 1건도 변경되지 않았음을 확인한다.
6. **문서 갱신**: 의도적으로 기대값(5번 표)이 변경된 경우에만 이 문서와 `docs/FIXTURE_FREEZE.md`를 함께 갱신한다 — 조용히 갱신하지 않는다.
