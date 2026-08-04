# DPE Regression Fixture Freeze

Status: **FROZEN** as of the DPE Release Candidate (RC) 8/8 PASS confirmation.

## Freeze 대상

`fixtures/resumes/`, `fixtures/coverletters/`에 위치한 `docs/REGRESSION_MATRIX.md`의 8개 Regression Fixture 전체:

- `word-docx-resume.docx` (`word_docx`)
- `standard-pdf-resume.pdf` (`standard_pdf`)
- `canva-pdf-resume.pdf` (`canva_pdf`)
- `google-docs-resume.docx` (`google_docs_docx`)
- `pdf-cover-letter.pdf` (`pdf_cover_letter`)
- `regtest1-regulated-nurse-resume.docx` (`regtest1`)
- `regtest3-two-column-pdf.pdf` (`regtest3`)
- `regtest4-repeated-tokens-pdf.pdf` (`regtest4`)

## 원칙

- **Fixture는 RC의 기준선(baseline)이다.** 이 8개 파일이 만들어내는 실제 실행 결과(`docs/REGRESSION_MATRIX.md`의 기대 `dpe_status` 표)가 DPE가 "정상 동작한다"고 판단하는 유일한 실측 기준이다.

- **삭제 금지.** 위 8개 파일 중 어느 것도 삭제할 수 없다. 각 Fixture는 실제로 발생했던 특정 버그를 방지하기 위해 만들어졌으며(`docs/REGRESSION_MATRIX.md` §4), 삭제 시 그 버그에 대한 회귀 감시 능력이 영구히 사라진다.

- **이름 변경 금지.** 파일명, Fixture key(`word_docx`, `standard_pdf`, `canva_pdf`, `google_docs_docx`, `pdf_cover_letter`, `regtest1`, `regtest3`, `regtest4`), 계정 이메일 중 어느 것도 변경할 수 없다. 이름 변경은 스크립트/문서 간 참조 불일치를 유발하며, 결과 비교의 연속성을 깬다.

- **결과 변경 시 Regression으로 간주한다.** 어떤 Fixture든 `docs/REGRESSION_MATRIX.md`에 기록된 기대 `dpe_status`와 다른 실제 결과가 나오면, 그 자체로 Regression이다 — 원인이 아직 밝혀지지 않았어도 "실패"로 취급하고 `docs/REGRESSION_MATRIX.md` §7의 조사 절차를 따른다. 기대값보다 결과가 개선된 것처럼 보이는 경우도 예외 없이 조사 대상이다 (의도치 않은 부작용일 수 있다).

- **파일 내용 자체를 수정하는 것도 금지한다** (Fixture 문제가 실제 Root Cause로 확정된 예외적인 경우는 제외 — 이 경우 `docs/REGRESSION_MATRIX.md` §7의 절차를 따르고, 수정 사실과 사유를 이 문서 및 `docs/REGRESSION_MATRIX.md`에 함께 기록해야 한다).

- **새 Fixture는 별도 추가만 가능하다.** 새로운 버그를 방지하기 위한 새 Fixture가 필요하면, 기존 8개를 대체하거나 수정하지 않고 별도의 새 파일/새 key로 추가한다. 추가 시 `docs/REGRESSION_MATRIX.md`의 Fixture 목록, 목적, 방지 버그, 기대 결과 표를 함께 갱신해야 한다.

## Freeze 해제 조건

이 Freeze는 다음 경우에만 명시적으로 해제(즉, Fixture 파일 수정/삭제/이름 변경 허용)될 수 있다:

1. `docs/REGRESSION_MATRIX.md` §7 조사 절차를 통해 Root Cause가 **A. Fixture 문제**로 확정된 경우 — 해당 Fixture 파일만, 최소 범위로 수정.
2. 사용자가 명시적으로 Freeze 해제 및 특정 Fixture의 교체/제거를 지시한 경우.

그 외 어떤 이유로도(리팩터링, 코드 정리, 파일 구조 개선 등) Fixture를 건드리지 않는다.
