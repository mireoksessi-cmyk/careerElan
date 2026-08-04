# DPE Known Limitations

Status: RC 기준, 이미 해결된 이슈(Blocker 1/2/3, Known Limitation #001, Skills Validation FAIL 등)는 포함하지 않는다. 여기 기록된 항목은 모두 코드 자체의 주석에서 정직하게 공개(disclosed)하고 있거나, 실제 실행 로그로 확인된, **현재도 유효한** 한계다.

## 1. Content Mapping 세밀도(granularity) 한계

**1.1 Bullet 단위 매핑은 Experience/Volunteer에만 적용된다.**
`lib/documentPreservation/contentMapping/resumeMapping.ts:24-36`
Education/Certifications/Projects/Skills/Languages/References는 항상 섹션 전체가 하나의 블록으로 치환된다. 원본 문서에서 항목별로 별도 박스였더라도 항목 단위로 재배치되지 않는다.

**1.2 리터럴 불릿 마커(`-`/`•`/`*`)가 없는 Experience/Volunteer 섹션은 섹션 블록으로 폴백한다.**
`lib/documentPreservation/contentMapping/resumeMapping.ts:118-155`
평서문 형태의 불릿(마커 없음)을 쓰는 DOCX/PDF는 불릿별 개별 배치가 아니라 섹션 전체가 한 블록으로 치환된다.

**1.3 생성된 유닛 수와 원본 Content Box 수가 다를 때 재분배/병합을 시도하지 않는다.**
`lib/documentPreservation/contentMapping/positionalPairing.ts:1-12`
초과분은 그대로 `unassignedUnits`로 남고, 어떤 항목끼리 합치거나 나눠야 하는지 추측하지 않는다.

**1.4 원본에 없는 섹션(Summary/Skills)을 AI가 생성하는 구조적 간극.**
`lib/documentPreservation/executionEngine/validation.ts:31-89` (allowlist: `DISCLOSED_OMITTABLE_SECTIONS = {"summary", "skills"}`)
원본 문서에 Summary 또는 Skills 섹션이 전혀 없어도 AI가 생성할 수 있으며, 이 경우 배치할 곳이 없다는 사실은 non-blocking 경고로만 남고 오류로 처리하지 않는다. 이 두 섹션 외의 모든 섹션(Experience/Education/Projects/Certifications/Volunteer/Languages/References)은 동일한 상황에서 여전히 Validation FAIL로 처리된다.

## 2. Resume Analysis 재구성 단계와의 간극 (실제 실행으로 확인됨)

**2.1 업로드 원본 파일과 `resumes.original_text`(재구성된 텍스트) 사이에 내용 불일치가 발생할 수 있다.**
RC 회귀 라운드(regtest1 조사)에서 실제 raw `mammoth.extractRawText()` 결과와 DB의 `resumes.original_text`를 직접 대조하여 확인됨: `lib/documentAnalysis/resumeAnalysisCore.ts`의 AI 재구성(reconstruct/extract/verify) 단계가 원본 파일에 없는 내용(예: Skills 섹션)을 합성해 넣을 수 있다. DPE는 항상 실제 원본 파일을 독립적으로 재파싱하므로 이 합성된 내용과 무관하게 정확하지만, Generate Package의 AI는 이 재구성된 텍스트를 프롬프트 입력으로 사용하기 때문에 "원본에 없는 섹션을 AI가 생성"하는 현상(1.4)의 근본 원인 중 하나가 된다. 이 재구성 단계 자체는 이번 RC 범위에서 수정 대상이 아니었다(범위 외).

## 3. Template Preservation Validation의 근사치(approximation)

**3.1 Content-Box-id 추적이 불가능해 정확 텍스트 매칭을 identity proxy로 사용한다.**
`lib/documentPreservation/executionEngine/validation.ts:352-407`
Renderer Adapter가 박스들을 렌더링 전에 평문으로 재조립하기 때문에, 렌더링된 요소를 원본 Content Box로 직접 추적할 방법이 없다. 텍스트가 우연히 같고 구조적 위치(ordinal)까지 같은 경우가 아니면 문제없지만, 이는 여전히 진짜 식별자가 아닌 근사치다.

**3.2 원본 문서를 측정할 수 없으면 Template Preservation/유사도 점수 전체가 스킵된다.**
`lib/documentPreservation/executionEngine/validation.ts:304-310, 670-673`
오류로 보고되지 않고 `skippedChecks`에만 기록되므로, 소비자가 이를 놓칠 수 있다.

## 4. 명시적으로 지원하지 않는 검사 항목

**4.1 `protected_content_omission`은 DPE 범위 밖이다.**
`lib/documentPreservation/executionEngine/validation.ts:614-617`
Protected Claims 텍스트 목록에 DPE가 접근할 수 없으므로, 레이아웃 재구성 과정에서 Protected Claim이 유실되어도 DPE 자체는 이를 잡지 못한다. `lib/generatePackage/shared.ts`의 `validateProtectedClaims`가 생성된 텍스트 자체에 대해서만 이미 별도로 검사한다 — 최종 레이아웃에 대한 이중 검증은 없다.

**4.2 측정 불가(unmeasurable) 상태는 항상 실패로 처리되며 "통과"로 간주되지 않는다.**
`lib/documentPreservation/executionEngine/overflowDetection.ts:9-22`
헤드리스 브라우저 측정 자체가 실패하면(예: 브라우저 실행 문제) 그 문서의 DPE 결과 전체가 막힌다 — 콘텐츠 문제가 아니어도 기술적 측정 실패가 곧 실패로 이어진다.

## 5. 문서 유형/소스별 적용 경계

**5.1 DPE는 업로드된 원본 파일이 있는 경우에만 동작한다.**
`lib/documentPreservation/runForApplication.ts:16-23, 91-99`
Career Memory(구조화된 필드)로부터 생성된 이력서는 원본 파일이 없으므로 DPE가 아예 적용되지 않으며(`status: "not_applicable"`), Generate Package가 생성한 일반 텍스트가 그대로 사용된다.

**5.2 Compression Retry는 실제 프로덕션 경로에서 실행되지 않는다.**
`lib/documentPreservation/executionEngine/retryEngine.ts:1-39, 101-105`, `runForApplication.ts:143-152`
`regeneratePackage` 콜백을 주입하는 실제 프로덕션 연결부가 없기 때문에, 오버플로우가 발생해도 "AI 출력을 압축해 재생성" 재시도는 현재 실행되지 않고 곧바로 Page Clone/Relayout 처리로 넘어간다.

## 6. 지오메트리/측정 근사치

**6.1 DOCX 페이지 지오메트리는 실제 원본이 아닌 일반화된 근사치(A4 @ 96dpi, 20mm 여백)다.**
`lib/documentPreservation/layoutAnalysis/docxGeometryRenderer.ts:1-16`
원본이 Letter 사이즈이거나 여백/방향이 다른 경우에도 A4 세로 기준으로 측정된다. mammoth API가 `<w:sectPr>`의 실제 페이지 설정을 노출하지 않기 때문이다.

**6.2 mammoth 출력 자체에는 좌표/폰트 메타데이터가 전혀 없다.**
`lib/documentPreservation/layoutAnalysis/docxLayoutAnalyzer.ts:19-31`
별도의 Playwright 재렌더링 패스가 없다면 DOCX 요소는 모든 지오메트리 필드가 null이다.

**6.3 DOCX Playwright 측정이 실패하면 조용히 단일 페이지·지오메트리 없음으로 폴백한다.**
`lib/documentPreservation/layoutAnalysis/docxLayoutAnalyzer.ts:164-200`
일시적인 브라우저 측정 실패가 다중 페이지 DOCX를 단일 페이지로 축소시킬 수 있다(오류로 던져지지 않음).

**6.4 DOCX는 border-style 구분선(divider) 검출을 지원하지 않는다.**
`lib/documentPreservation/layoutAnalysis/docxLayoutAnalyzer.ts:222-228`

**6.5 PDF 여백(margin) 추론은 명확한 정렬 패턴이 없으면 신뢰도가 낮은 min/max 폴백을 사용한다.**
`lib/documentPreservation/layoutAnalysis/pdfLayoutAnalyzer.ts:246-285`
이 경우 `confidence: "low"`로 명시적으로 표시된다.

**6.6 곡선/복합 클립 경로를 가진 PDF 이미지는 가시 영역이 추적되지 않는다.**
`lib/documentPreservation/layoutAnalysis/types.ts:44-54`
축(axis)에 정렬된 단순 사각형 클립만 지원한다.

**6.7 PDF 표(table) 검출은 의도적으로 보수적이다.**
`lib/documentPreservation/layoutAnalysis/pdfLayoutAnalyzer.ts:315-327`
날짜 정렬 불릿 목록 등 하나의 X좌표만 공유하는 패턴은 표로 인식되지 않는다(2개 이상 컬럼 정렬 필요).

## 7. Content Box / Template Region 분류 한계

**7.1 PDF Content Box 생성 시점에는 Background/Decoration/Divider/Border/Header/Footer 역할이 전혀 부여되지 않는다.**
`lib/documentPreservation/contentBox/pdfContentBoxGenerator.ts:20-33`
이후 `templateRegionClassifier.ts`가 별도 패스로 처리하며, Sidebar의 원래 페이지별 휴리스틱은 확인된 오탐 사례로 인해 완전히 폐기되었다.

**7.2 같은 줄 판정을 위한 수평 간격 임계값은 특정 fixture 기준으로 튜닝되었으며 임의의 PDF 전반에 검증되지 않았다.**
`lib/documentPreservation/contentBox/pdfContentBoxGenerator.ts:83-97`
정당하게 넓은 한 줄 간격(예: 제목 ... 우측 정렬 날짜)이 두 블록으로 잘못 분리될 수 있다.

**7.3 Header/Footer/페이지 번호 분류는 2페이지 이상에서만 가능하다.**
`lib/documentPreservation/contentBox/templateRegionClassifier.ts:26-31, 98-104`
단일 페이지 문서는 구조적으로 반복 패턴이 없어 이 분류가 원천적으로 불가능하다.

**7.4 배경(Background) 검출은 실제 벡터 채우기 추출이 아닌 추론(inference)이다.**
`lib/documentPreservation/contentBox/templateRegionClassifier.ts:459-507`
100% 정확도를 주장하지 않으며, 이미 non-editable로 분류된 박스에만 적용되어 편집 가능한 텍스트 박스에는 영향을 주지 않는다.

## 8. Page Clone / Relayout 추적성 한계

**8.1 Page Clone의 연속(continuation) 정보는 원본 Content-Box-id로 추적되지 않는다.**
`lib/documentPreservation/executionEngine/pageClone.ts:52-105`
페이지가 어디서 나뉘었는지는 알 수 있지만, 정확히 어떤 원본 Content Box의 내용이 이어지는지는 더 거친 단위(`data-dpe-section`)로만 알 수 있다.

**8.2 `template_aware` Page Clone 모드는 실제 데이터로 검증된 적이 없다.**
`lib/documentPreservation/executionEngine/pageClone.ts:10-21, 473-476`
지금까지 모든 실제 fixture는 Template 역할로 분류된 Content Box가 0개였으므로, 이 모드로 복제할 대상 자체가 없었다. 코드 경로는 존재하지만 실전 검증되지 않았다.

**8.3 Relayout은 좌표 재계산이 아닌 액션 단위의 권고(action-level guidance)에 그친다.**
`lib/documentPreservation/executionEngine/relayoutPlan.ts:12-18, 157-234`
Renderer가 CSS flow 기반이라 절대 좌표 재배치가 불가능하며, `merge_paragraphs`/`reduce_whitespace` 등은 추정치일 뿐 자동 적용되지 않는다.

**8.4 Renderer는 DPE가 지정한 UnbreakableGroup(분리 금지 그룹) 메타데이터를 실제로 참조하지 않는다.**
`lib/documentPreservation/executionEngine/relayoutPlan.ts:243-255, 274`
직무 제목/회사/불릿 그룹이 "페이지 경계에서 분리 금지"로 표시되어도, 실제 Renderer는 이 정보를 모르고 페이지 경계에서 분리할 수 있다 — DPE는 사후에 이를 감지해 보고할 뿐 사전에 막지는 못한다.

## 9. Retry Engine 제약

**9.1 Compression Retry는 최대 3회로 제한되며, 최선의(best-scoring) 시도를 채택하되 완전한 fit을 보장하지 않는다.**
`lib/documentPreservation/executionEngine/retryEngine.ts:1-39`
모든 재시도가 실패해도 가장 오버플로우가 적었던 시도를 채택해 반환한다 — 오버플로우가 완전히 해소되었다는 보장은 아니다.

---

이 문서는 RC 시점의 스냅샷이다. 새로운 한계가 발견되면 이미 해결된 항목을 제거하지 말고 이 문서에 추가하며, 해결된 항목은 발견 즉시 이 목록에서 제거한다.
