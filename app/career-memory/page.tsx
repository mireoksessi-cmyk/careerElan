"use client";
import AppContent from "@/components/job-layout/AppContent";

import Image from "next/image";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import MobileNav from "@/components/job-layout/MobileNav";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import CareerMemoryTemplatePreview from "@/components/resume/CareerMemoryTemplatePreview";
import CanonicalTemplatePicker from "@/components/canonicalGeneratePackage/CanonicalTemplatePicker";
import { ALL_TEMPLATE_CAPABILITIES } from "@/lib/resumeTemplates/registry/templateMetadata";
import { useToast } from "@/components/ui/ToastProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  COVER_LETTER_ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  RESUME_ALLOWED_EXTENSIONS,
  getLowercaseExtension,
  sanitizeStorageFileNameSegment,
} from "@/lib/documentAnalysis/uploadValidation";
import {
  MAX_UPLOADED_RESUMES,
  MAX_CREATED_RESUMES,
  MAX_COVER_LETTERS,
} from "@/lib/config/careerMemoryLimits";
const DRAFT_KEY = "career-memory-draft";
/*
  Phase 6I.6.8 - order follows the canonical resume's own semantic
  section order (PROFESSIONAL_ATS_SECTION_ORDER in
  lib/documentPreservation/professionalAtsAssembly/sectionLabels.ts:
  identity -> summary -> core_skills -> professional_experience ->
  education -> certifications_licenses -> projects -> ...), so the user
  fills out Career Memory in roughly the same sequence the information
  later appears on the resume. Certifications now comes before Projects
  and Education moves ahead of both (previously: Personal, Skills,
  Experience, Projects, Education, Languages, Certifications, Career
  Goals, Review). Languages has no canonical resume section (see
  manualResumeRuntimeMapper.ts's own header comment) so it stays grouped
  with the other supplementary, non-core-resume steps just before Career
  Goals. This is a pure UI/navigation reorder - the currentStep===N
  dispatch in renderStepForm() below was updated to match; no field
  names, DB columns, or persisted data shape changed.
*/
const steps = [
  {
    title: "Personal Information",
    description:
      "Required. Your contact information and professional summary used across every application.",
    required: true,
  },
  {
    title: "Skills",
    description:
      "Required. Technical skills, software, legal knowledge, customer service, and other professional abilities.",
    required: true,
  },
  {
    title: "Experience",
    description:
      "Required. Add work, volunteer, internship, co-op, or other relevant experience. Career Élan uses this to build stronger resume bullets.",
    required: true,
  },
  {
    title: "Education",
    description:
      "Optional. Schools, degrees, GPA, coursework, and academic achievements that strengthen your profile.",
    required: false,
  },
  {
    title: "Certifications",
    description:
      "Optional. Professional certifications, licenses, awards, and completed training.",
    required: false,
  },
  {
    title: "Projects",
    description:
      "Optional. School, personal, volunteer, or professional projects that showcase your experience.",
    required: false,
  },
  {
    title: "Languages",
    description:
      "Optional. Languages you speak and your proficiency level, such as English, French, or Korean.",
    required: false,
  },
  {
    title: "Career Goals",
    description:
      "Optional. Tell AI your target industry, preferred roles, locations, salary expectations, and long-term goals.",
    required: false,
  },
  {
    title: "Review & Templates",
    description:
      "Review your Career Memory and choose resume and cover letter styles.",
    required: false,
  },
];

const resumeTemplates = ["Classic",  "Professional",  "Creative"];
const coverLetterTemplates = ["Classic Letter", "Modern Letter", "Executive", "Government Style", "Minimal Letter"];
const themeColors = ["Blue", "Green", "Navy", "Black", "Gray"];
const fonts = ["Arial", "Calibri", "Helvetica", "Times New Roman", "Georgia"];
const textSizes = ["Small", "Standard", "Large"];
const tones = ["Formal", "Warm", "Confident", "Government", "Concise"];

type EducationItem = {
  school: string;
  program: string;
  startDate: string;
  endDate: string;
  gpa: string;
  coursework: string;
};

type WorkItem = {
  company: string;
  jobTitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

type VolunteerItem = {
  organization: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

type LanguageItem = {
  language: string;
  level: string;
};
type CertificationItem = { name: string; issuer: string; date: string; description: string };
type ProjectItem = { name: string; role: string; dates: string; description: string };

type CareerMemoryData = {
  firstName: string; lastName: string; email: string; phone: string; location: string; linkedin: string; headline: string; summary: string;
  education: EducationItem[]; workExperience: WorkItem[]; volunteerExperience: VolunteerItem[]; skills: string; languages: LanguageItem[]; certifications: CertificationItem[]; projects: ProjectItem[];
  targetRoles: string; targetIndustry: string; targetLocation: string; salaryExpectation: string; careerGoalSummary: string;
  uploadedResumeName: string; uploadedResumeText: string; resumeSource: "uploaded" | "built";
  resumeTemplate: string; coverLetterTemplate: string; themeColor: string; font: string; textSize: string; coverLetterTone: string; applySameStyleToCoverLetter: boolean;
  uploadedCoverLetterName: string;
 uploadedCoverLetterText: string;
 coverLetterSource: "uploaded" | "generated";
 recipient: string;
company: string;
jobTitle: string;
greeting: string;
body: string;
closing: string;
signature: string;
};

const emptyEducation: EducationItem = {
  school: "",
  program: "",
  startDate: "",
  endDate: "",
  gpa: "",
  coursework: "",
};
const languageLevels = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Fluent",
  "Native",
] as const;

const emptyWork: WorkItem = {
  company: "",
  jobTitle: "",
  location: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  description: "",
};

const emptyVolunteer: VolunteerItem = {
  organization: "",
  role: "",
  location: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  description: "",
};

const emptyLanguage: LanguageItem = {
  language: "",
  level: "",
};
const emptyCertification = { name: "", issuer: "", date: "", description: "" };
const emptyProject = { name: "", role: "", dates: "", description: "" };

const defaultMemoryData: CareerMemoryData = {
  firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "", headline: "", summary: "",
  education: [emptyEducation], workExperience: [emptyWork], volunteerExperience: [emptyVolunteer], skills: "", languages: [emptyLanguage], certifications: [emptyCertification], projects: [emptyProject],
  targetRoles: "", targetIndustry: "", targetLocation: "", salaryExpectation: "", careerGoalSummary: "",
  uploadedResumeName: "", uploadedResumeText: "", resumeSource: "built",
  resumeTemplate: "Professional", coverLetterTemplate: "Classic Letter", themeColor: "Navy", font: "Calibri", textSize: "Standard", coverLetterTone: "Formal", applySameStyleToCoverLetter: true,
  uploadedCoverLetterName: "",
  uploadedCoverLetterText: "",
  coverLetterSource: "generated",
  recipient: "",
company: "",
jobTitle: "",
greeting: "",
body: "",
closing: "",
signature: "",
};

type ImportStage = "idle" | "uploaded" | "parsing" | "parsed" | "preview";
type UploadedResumeKind = "none" | "pdf" | "txt" | "docx" | "other";

export default function CareerMemoryPage() {
  const { user, loading, refresh } = useLogin();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<
    "start" | "import" | "importCoverLetter" | "build"
  >("start");
  const [currentStep, setCurrentStep] = useState(0);
  const [memoryData, setMemoryData] = useState<CareerMemoryData>(defaultMemoryData);
  const [coverLetterUploadProgress, setCoverLetterUploadProgress] =
  useState(0);
 const [resumeUploadError, setResumeUploadError] = useState("");
 const [coverLetterUploadError, setCoverLetterUploadError] =
  useState("");
const [isResumeDragging, setIsResumeDragging] = useState(false);
const [isCoverLetterDragging, setIsCoverLetterDragging] = useState(false);
  const [coverLetterImportStage, setCoverLetterImportStage] =
  useState<
    "idle" | "uploaded" | "parsing" | "parsed"
  >("idle");
  const [coverLetterPreview, setCoverLetterPreview] =
  useState(false);
  const [coverLetterImportMessage, setCoverLetterImportMessage] =
  useState("");
  const [importMessage, setImportMessage] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");
  const [importStage, setImportStage] = useState<ImportStage>("idle");
  const [uploadedResumeUrl, setUploadedResumeUrl] = useState("");
  const [uploadedResumeKind, setUploadedResumeKind] = useState<UploadedResumeKind>("none");

  /*
    Phase 6I.2 - the hard gate (spec section 13/14): forward navigation
    to Dashboard is blocked, in-place, whenever a canonical profile
    exists but has no default_template_id yet - whether that profile
    was just created this session or is a pre-existing one from before
    this phase shipped. templateGateTemplates/templateGateError are
    only populated while templateGateBlocking is true.
  */
  const [templateGateBlocking, setTemplateGateBlocking] = useState(false);
  const [templateGateTemplates, setTemplateGateTemplates] = useState<Array<{ id: string; name: string; description: string; previewAsset: string }>>([]);
  const [templateGateSaving, setTemplateGateSaving] = useState(false);
  const [templateGateError, setTemplateGateError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    checkAndBlockOnTemplateGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /*
    Phase 6I.3 (spec section 5) - once a canonical profile has a
    resolved default_template_id, the Full Resume Preview below must
    show the Canonical Runtime rendered through that template instead
    of the legacy per-source preview (uploaded-file iframe or the
    field-built CareerMemoryTemplatePreview), regardless of which
    source the resume originally came from - canonical content/design
    is now the single source of truth once it exists. "legacy" (no
    canonical profile at all) keeps today's behavior completely
    unchanged; "selection-required" is a defensive fallback (the
    Phase 6I.2 hard gate above should already prevent a user from
    reaching this deep into the page in that state, but the preview
    itself must never silently fall back to a legacy render or an
    arbitrary template if it somehow happens).
  */
  const [canonicalPreviewStatus, setCanonicalPreviewStatus] = useState<"loading" | "legacy" | "selection-required" | "canonical">("loading");
  const [canonicalPreviewTemplateId, setCanonicalPreviewTemplateId] = useState<string | null>(null);
  /*
    Phase 6I.6.39 bugfix - captured from import-resume's own response
    right after THIS upload's import (see runInlineCanonicalFlow below),
    then threaded onto the uploaded-resume preview iframe src exactly
    like manualCanonicalVersionId already is for the Manual flow (see
    that state's own comment). Without it, the preview route falls back
    to career_memory.selected_resume_id (a column Dashboard's picker
    owns, not this upload flow), so a user who had previously selected
    an older resume via Dashboard would see THAT resume's content here
    immediately after uploading a brand new one.
  */
  const [canonicalPreviewVersionId, setCanonicalPreviewVersionId] = useState<string | null>(null);

  /*
    Large canonical preview loading state, shared by the canonical preview
    (renderCanonicalResumePreview) and the Step 9 right-hand preview. Keyed by
    the resolved iframe src rather than by template id: the same templateId is
    re-requested with a canonicalVersionId once one exists, which re-navigates
    an already-loaded iframe back to a blank document, and an id-keyed
    "loaded" mark would then reveal that blank frame. An unknown src is simply
    not loaded yet, so a changed src falls back to the static placeholder by
    itself - no effect, no reset logic. Same reasoning as
    CanonicalTemplatePicker's card-level state, deliberately kept local rather
    than extracted into a shared helper.
  */
  const [largePreviewStatusBySrc, setLargePreviewStatusBySrc] = useState<Record<string, "loaded" | "failed">>({});
  function markLargePreview(src: string, status: "loaded" | "failed") {
    setLargePreviewStatusBySrc((current) => (current[src] === status ? current : { ...current, [src]: status }));
  }
  function templatePreviewAsset(templateId: string | null) {
    return ALL_TEMPLATE_CAPABILITIES.find((template) => template.id === templateId)?.previewAsset ?? null;
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch("/api/internal/canonical-career-memory/resolve-template")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.kind === "canonical") {
          setCanonicalPreviewTemplateId(data.templateId);
          setCanonicalPreviewStatus("canonical");
        } else if (data?.kind === "selection-required") {
          setCanonicalPreviewStatus("selection-required");
        } else {
          setCanonicalPreviewStatus("legacy");
        }
      })
      .catch(() => {
        if (!cancelled) setCanonicalPreviewStatus("legacy");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  /*
    Phase 6I.4/6I.5 - the inline "choose your resume design" step on the
    Career Memory completion screen itself (spec: the 4 cards render
    right under "Resume analyzed successfully," not a Dashboard-only
    follow-up). "not-applicable" now covers only the ONE case the picker
    must NOT appear: the canonical feature flags are off (matches the
    config check every other canonical UI surface already uses - keeps
    Production, where these flags are off by default, on the exact
    pre-6I.4 behavior). "import-error"/"save-error" keep the Continue
    buttons disabled per spec section 7 ("If persistence fails: keep
    buttons disabled") - there is deliberately no client-only bypass.

    Phase 6I.5 fix - this function used to treat "a default template is
    already set" as proof that THIS resumeId was already imported, and
    returned immediately without ever calling import-resume. That was
    the confirmed root cause of the "wrong resume shown after a new
    upload" bug: a returning user's existing default_template_id has
    nothing to do with whether the CURRENT upload's content has been
    added to their canonical profile. Every analyzed upload now always
    calls import-resume (identity is resolved server-side by content
    hash - see canonicalResumeImportService.ts - so a truly redundant
    re-upload is still a safe no-op, never a duplicate version). An
    existing default template is applied AUTOMATICALLY to the resume
    that import just made current/latest (spec section 8: "existing
    default template does not skip B import... left preview of B
    immediately uses [the existing default]"), while still letting the
    user change it via the picker, which always stays visible now.
  */
  const [inlineTemplateStatus, setInlineTemplateStatus] = useState<"checking" | "not-applicable" | "importing" | "import-error" | "selecting" | "saving" | "ready">("checking");
  const [inlineTemplates, setInlineTemplates] = useState<Array<{ id: string; name: string; description: string; previewAsset: string }>>([]);
  const [inlineSelectedTemplateId, setInlineSelectedTemplateId] = useState<string | null>(null);
  const [inlineTemplateError, setInlineTemplateError] = useState<string | null>(null);
  /*
    True ONLY once the user has clicked a card for THIS resume (set in
    selectInlineTemplate on a successful PUT) - deliberately separate
    from inlineTemplateStatus===`"ready`", which also becomes true when
    a returning users existing account-level default is auto-applied
    for preview convenience (see the Returning-user branch below) with
    no click for this resume at all. Completion gating below reads this
    flag, never the status, so an auto-applied default can never
    silently satisfy choose-a-template-first.
  */
  const [inlineTemplateExplicitlySelected, setInlineTemplateExplicitlySelected] = useState(false);

  /*
    Edit Content, for a resume that arrived by upload.

    An imported resume was previously read-only: the parser's answer was
    the only answer, and a wrong employer or a missed language could not
    be corrected anywhere. This opens the SAME 1-8 sections the typed
    flow uses - renderStepForm() below is reused verbatim, not copied -
    over the current canonical version's own content.

    The draft lives in memoryData while the workspace is open, which is
    what makes reuse possible at all. uploadedEditRestore holds whatever
    was in memoryData beforehand so Cancel can put it back exactly;
    nothing is written until Save, and Save is one request.
  */
  const [uploadedEditOpen, setUploadedEditOpen] = useState(false);
  const [uploadedEditStep, setUploadedEditStep] = useState(0);
  const [uploadedEditStatus, setUploadedEditStatus] = useState<"idle" | "loading" | "ready" | "saving" | "error">("idle");
  const [uploadedEditError, setUploadedEditError] = useState<string | null>(null);
  const [uploadedEditRestore, setUploadedEditRestore] = useState<typeof memoryData | null>(null);
  const [uploadedEditPreviewHtml, setUploadedEditPreviewHtml] = useState<string>("");

  /*
    The draft in the shape the canonical mapper speaks, built from the
    same memoryData the forms bind to. Kept as a function rather than
    derived state so it always reflects the latest keystroke without an
    effect having to chase it.
  */
  function uploadedEditDraft() {
    return {
      firstName: memoryData.firstName,
      lastName: memoryData.lastName,
      email: memoryData.email,
      phone: memoryData.phone,
      location: memoryData.location,
      linkedin: memoryData.linkedin,
      headline: memoryData.headline,
      summary: memoryData.summary,
      skills: (memoryData.skills ?? "").split(",").map((skill: string) => skill.trim()).filter(Boolean),
      experience: memoryData.workExperience ?? [],
      volunteerExperience: memoryData.volunteerExperience ?? [],
      education: memoryData.education ?? [],
      certifications: memoryData.certifications ?? [],
      projects: memoryData.projects ?? [],
      languages: memoryData.languages ?? [],
    };
  }

  async function openUploadedEdit() {
    setUploadedEditOpen(true);
    setUploadedEditStatus("loading");
    setUploadedEditError(null);
    setUploadedEditStep(0);
    try {
      const res = await fetch("/api/internal/canonical-career-memory/import-manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "prefill" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || "Could not load your resume for editing.");
      const draft = data.draft ?? {};
      setUploadedEditRestore(memoryData);
      setMemoryData((current: typeof memoryData) => ({
        ...current,
        firstName: draft.firstName ?? "",
        lastName: draft.lastName ?? "",
        email: draft.email ?? "",
        phone: draft.phone ?? "",
        location: draft.location ?? "",
        linkedin: draft.linkedin ?? "",
        headline: draft.headline ?? "",
        summary: draft.summary ?? "",
        skills: Array.isArray(draft.skills) ? draft.skills.join(", ") : "",
        workExperience: draft.experience ?? [],
        volunteerExperience: draft.volunteerExperience ?? [],
        education: draft.education ?? [],
        certifications: draft.certifications ?? [],
        projects: draft.projects ?? [],
        languages: draft.languages ?? [],
      }));
      setUploadedEditStatus("ready");
    } catch (error) {
      setUploadedEditError(error instanceof Error ? error.message : "Could not load your resume for editing.");
      setUploadedEditStatus("error");
    }
  }

  /* Cancel restores the pre-edit values and writes nothing. */
  function cancelUploadedEdit() {
    if (uploadedEditRestore) setMemoryData(uploadedEditRestore);
    setUploadedEditRestore(null);
    setUploadedEditOpen(false);
    setUploadedEditStatus("idle");
    setUploadedEditError(null);
    setUploadedEditPreviewHtml("");
  }

  async function saveUploadedEdit() {
    setUploadedEditStatus("saving");
    setUploadedEditError(null);
    try {
      const res = await fetch("/api/internal/canonical-career-memory/import-manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "user-confirmed",
          draft: uploadedEditDraft(),
          /* The user's own Career Goals, carried across so a content save
             cannot silently clear a step the resume never spoke for. */
          careerGoals: {
            /* Stored as one comma-separated field in the editor, sent as
               the array the career_memory column holds. */
            targetRoles: (memoryData.targetRoles ?? "").split(",").map((role: string) => role.trim()).filter(Boolean),
            targetIndustry: memoryData.targetIndustry ?? null,
            targetLocation: memoryData.targetLocation ?? null,
            salaryExpectation: memoryData.salaryExpectation ?? null,
            careerGoalSummary: memoryData.careerGoalSummary ?? null,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || "Could not save your changes.");
      /*
        Authority has moved, so the preview has to move with it. The
        uploaded-success preview pins its request and its iframe key to
        canonicalPreviewVersionId; leaving that pointing at the version the
        edit came from meant both strings stayed identical, React never
        remounted the frame, and the user was shown the document fetched
        before they typed - their save was correct and invisible.

        Adopting the id the save itself returned repoints it at the new
        version, which changes the src and the key together and is what
        makes the frame refetch. It is the version pointer alone: no field
        is inspected, so this behaves the same whichever of the 1-8
        sections was edited, and the selected template is untouched.
      */
      if (data?.versionId) setCanonicalPreviewVersionId(data.versionId);
      /* The draft is now the saved state, so there is nothing to restore
         back to. */
      setUploadedEditRestore(null);
      setUploadedEditOpen(false);
      setUploadedEditStatus("idle");
      setUploadedEditPreviewHtml("");
      toast.success("Changes saved.");
    } catch (error) {
      /* The draft stays in memoryData and the workspace stays open, so a
         failed save can be retried without retyping anything. */
      setUploadedEditError(error instanceof Error ? error.message : "Could not save your changes.");
      setUploadedEditStatus("ready");
    }
  }

  /*
    Preview of the UNSAVED draft. POSTs the draft and renders the returned
    document through srcdoc - the saved-state GET would show the old
    resume, which is precisely the wrong thing while someone is editing.
    Debounced so typing does not launch a render per keystroke; still no
    database write of any kind.
  */
  useEffect(() => {
    if (!uploadedEditOpen || uploadedEditStatus !== "ready" || !inlineSelectedTemplateId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/internal/canonical-career-memory/manual-preview?templateId=${inlineSelectedTemplateId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft: uploadedEditDraft() }),
        });
        const html = res.ok ? await res.text() : "";
        if (!cancelled) setUploadedEditPreviewHtml(html);
      } catch {
        if (!cancelled) setUploadedEditPreviewHtml("");
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedEditOpen, uploadedEditStatus, inlineSelectedTemplateId, memoryData]);

  async function loadInlineTemplateList() {
    const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
    const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
    setInlineTemplates(templatesData.templates ?? []);
  }

  /*
    Called once, right after analysis succeeds (see
    applyResumeAnalysisResult's two call sites) - resumeId is the row
    just created/analyzed in THIS upload.
  */
  async function runInlineCanonicalFlow(resumeId: string) {
    setInlineTemplateStatus("checking");
    setInlineTemplateError(null);
    setInlineSelectedTemplateId(null);
    setInlineTemplateExplicitlySelected(false);
    setCanonicalPreviewVersionId(null);
    /*
      Phase 6I.6.39 bugfix - the mount-only resolve-template effect above
      (line ~306) can leave canonicalPreviewStatus="canonical" with an
      OLDER resume's canonicalPreviewTemplateId from before this upload
      (it only re-runs when user changes, never on a new upload). If
      this flow then hits the not-applicable/import-error/catch branch
      below without resetting them, renderLiveResumePreviewContent()'s
      canonicalPreviewStatus==="canonical" check still fires with the
      stale templateId and a null versionId, and the preview route falls
      back server-side to career_memory.selected_resume_id - showing
      whatever resume Dashboard had selected before, not this upload.
      Resetting to "loading" here is safe: renderLiveResumePreviewContent
      falls through "loading" straight to the just-uploaded original-file
      preview (isUploadedResumePreview), never a stale canonical one.
    */
    setCanonicalPreviewStatus("loading");
    setCanonicalPreviewTemplateId(null);
    try {
      const configRes = await fetch("/api/internal/canonical-generate-package/config");
      const configData = configRes.ok ? await configRes.json() : { templateSelectorEnabled: false };
      /*
        Only templateSelectorEnabled gates template selection/preview -
        matches Dashboards own identical check (app/dashboard/page.tsx:
        `"if (!configData.templateSelectorEnabled) return;`"), which never
        requires generateEnabled either. Template choice and Generate
        Package eligibility are independent product surfaces (none of
        the routes this flow calls - import-resume, templates, resume-
        preview, template-preference - read generateEnabled server-side
        at all); requiring it here was an accidental coupling that hid
        all 4 template cards behind Generate Packages own canary flag,
        even with templateSelectorEnabled=true.
      */
      if (!configData.templateSelectorEnabled) {
        setInlineTemplateStatus("not-applicable");
        setUploadProgress(100);
        return;
      }

      // Always attempt import for THIS resume - server-side identity
      // (content hash) decides whether it's a no-op replay or a new
      // canonical version, never client UI state.
      setInlineTemplateStatus("importing");
      const importRes = await fetch("/api/internal/canonical-career-memory/import-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId }),
      });
      const importData = await importRes.json().catch(() => null);
      if (!importRes.ok) {
        setInlineTemplateError(importData?.error?.message || "Could not prepare this resume for canonical templates.");
        setInlineTemplateStatus("import-error");
        setUploadProgress(100);
        return;
      }
      setCanonicalPreviewVersionId(importData?.versionId || null);

      // Phase 6I.5 - refresh preview identity explicitly right after a
      // successful import, instead of relying on the mount-only
      // resolve-template effect above (spec section 4: "Do not rely on
      // a mount-only effect"). This is what makes the LEFT preview show
      // THIS upload's content, not a stale earlier one.
      await loadInlineTemplateList();

      const prefRes = await fetch("/api/internal/canonical-career-memory/template-preference");
      const prefData = prefRes.ok ? await prefRes.json() : { defaultTemplateId: null };
      if (prefData.defaultTemplateId) {
        // Returning user: auto-apply their existing default to the
        // resume that just became current - they may still change it.
        setInlineSelectedTemplateId(prefData.defaultTemplateId);
        setCanonicalPreviewTemplateId(prefData.defaultTemplateId);
        setCanonicalPreviewStatus("canonical");
        setInlineTemplateStatus("ready");
        setUploadProgress(100);
      } else {
        // First-time canonical user - no default to fall back to, a
        // real selection is required before Continue unlocks.
        setCanonicalPreviewStatus("selection-required");
        setInlineTemplateStatus("selecting");
        setUploadProgress(100);
      }
    } catch {
      setInlineTemplateError("Could not prepare this resume for canonical templates.");
      setInlineTemplateStatus("import-error");
      setUploadProgress(100);
    }
  }

  async function selectInlineTemplate(templateId: string) {
    setInlineTemplateStatus("saving");
    setInlineTemplateError(null);
    try {
      const res = await fetch("/api/internal/canonical-career-memory/template-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInlineTemplateError(data?.error?.message || "Could not save your template selection.");
        setInlineTemplateStatus("selecting");
        return;
      }
      setInlineSelectedTemplateId(data.defaultTemplateId);
      setInlineTemplateStatus("ready");
      setInlineTemplateExplicitlySelected(true);
      // Keep the existing Phase 6I.3 Career Memory preview state in
      // sync immediately, so "Continue to Preview" (renderFullResumePreview)
      // shows the just-selected canonical template without waiting for
      // its own mount-only effect to re-run.
      setCanonicalPreviewTemplateId(data.defaultTemplateId);
      setCanonicalPreviewStatus("canonical");
    } catch {
      setInlineTemplateError("Could not save your template selection.");
      setInlineTemplateStatus("selecting");
    }
  }

  /*
    Gates on an EXPLICIT selection for THIS resume, not merely
    inlineTemplateStatus==="ready" - a returning users existing
    account-level default gets auto-applied for preview convenience
    (see the Returning-user branch in runInlineCanonicalFlow above)
    without the user ever clicking a card for this resume, and that
    auto-applied preview must not silently satisfy "choose a template".
  */
  const inlineTemplateBlocksContinue = inlineTemplateStatus !== "not-applicable" && !inlineTemplateExplicitlySelected;

  /*
    DPE Phase2 loading-transition task - the post-upload result screen
    (renderInlineWorkspace, with the Live Resume Preview + 4 template
    cards) must not reveal itself until BOTH resume analysis AND
    template-picker resolution have finished. importStage flips to
    "parsed" the moment analysis succeeds, well before
    runInlineCanonicalFlow (fired right alongside it) has resolved
    inlineTemplateStatus out of its two in-flight states - revealing the
    workspace at that point let the LEFT panel fall through to the raw/
    original-file preview (renderLiveResumePreviewContent has no
    explicit "loading" branch, so canonicalPreviewStatus==="loading"
    silently matches the same fallback as no canonical support at all)
    while the RIGHT panel was still showing "Preparing...". Gating on
    NOT "checking"/"importing" (rather than an explicit allow-list of
    terminal states) means every real exit path of runInlineCanonicalFlow
    - not-applicable, import-error, selecting, ready, and the saving
    state reached only after ready - counts as ready without needing to
    be enumerated here, and the condition can never get permanently
    stuck since the surrounding try/catch guarantees one of those
    terminal states is always eventually reached.
  */
  const isResumeImportResultReady = importStage === "parsed" && inlineTemplateStatus !== "checking" && inlineTemplateStatus !== "importing";

  /*
    Phase 6I.6.8 - Manual ("build" mode) Step 9 template selection. A
    dedicated state/flow, deliberately NOT sharing canonicalPreviewStatus/
    canonicalPreviewTemplateId (the mount-only effect above) or the
    upload flow's inlineTemplate* state - both of those can legitimately
    reflect an UNRELATED resume (e.g. a prior upload) which must never
    become the implicit preview/selection for a Manual entry (this is
    the exact wrong-resume-fallback risk this round's own root-cause
    audit identified). manualPreviousVersionSource distinguishes three
    cases returned by import-manual: "none" (brand new profile - nothing
    to preselect), "manual" (re-entering Step 9 for a Manual resume that
    was already saved once - restore its own persisted selection), and
    "uploaded" (this user's ONE career_profiles row currently holds an
    UPLOADED resume's canonical version - a Manual save is about to
    replace it, but the uploaded resume's default_template_id must NOT
    be silently inherited; the user must choose again).
  */
  const [manualTemplateStatus, setManualTemplateStatus] = useState<"idle" | "not-applicable" | "importing" | "import-error" | "selecting" | "saving-template" | "ready">("idle");
  const [manualTemplates, setManualTemplates] = useState<Array<{ id: string; name: string; description: string; previewAsset: string }>>([]);
  const [manualSelectedTemplateId, setManualSelectedTemplateId] = useState<string | null>(null);
  /*
    Phase Step9-gate - true ONLY once the user has clicked a card for
    THIS manual Step 9 flow (set in selectManualTemplate on a
    successful PUT), mirroring inlineTemplateExplicitlySelected's exact
    rationale above: a restored/auto-applied previous default
    (manualSelectedTemplateId set from runManualCanonicalFlow's own
    previousVersionSource==="manual" branch) must never silently count
    as a fresh confirmation. Reset to false at the start of every
    runManualCanonicalFlow() call (i.e. every time Step 9 is entered).
  */
  const [manualTemplateExplicitlySelected, setManualTemplateExplicitlySelected] = useState(false);
  const [manualTemplateError, setManualTemplateError] = useState<string | null>(null);
  const [manualPreviousVersionSource, setManualPreviousVersionSource] = useState<"none" | "manual" | "uploaded" | null>(null);
  /*
    Phase 6I.6.9 - this Manual entry's OWN canonical_resume_version_id,
    from import-manual's own response. Passed as an explicit
    `canonicalVersionId` override on every resume-preview request this
    Step 9 makes, so the preview can never fall through to
    career_memory.selected_resume_type/selected_resume_id (Dashboard-
    only, never written by this wizard, and can point at a completely
    different resume) - see resolveCanonicalResumeContext.ts's own
    header comment on SessionModeInput.versionId for the full trace.
  */
  const [manualCanonicalVersionId, setManualCanonicalVersionId] = useState<string | null>(null);

  async function runManualCanonicalFlow() {
    setManualTemplateStatus("importing");
    setManualTemplateError(null);
    setManualTemplateExplicitlySelected(false);
    try {
      // Same canary/feature-flag gate the uploaded-resume flow's own
      // runInlineCanonicalFlow() already checks - a Manual resume must
      // not attempt canonical import/persistence for a user the Stage 1
      // canary hasn't been enabled for. "not-applicable" falls back to
      // the pre-existing legacy Step 9 review (renderFullResumePreview()),
      // matching this user's behavior before this round shipped.
      const configRes = await fetch("/api/internal/canonical-generate-package/config");
      const configData = configRes.ok ? await configRes.json() : { generateEnabled: false, templateSelectorEnabled: false };
      if (!configData.generateEnabled || !configData.templateSelectorEnabled) {
        setManualTemplateStatus("not-applicable");
        return;
      }

      /*
        Step 9 reads the PERSISTED career_memory row - import-manual is a
        bodyless POST, so the server re-reads the database and never sees
        the form state the user is looking at. Reaching Step 9 through the
        Steps sidebar calls setCurrentStep() alone, with no save in
        between, so a person who edits Personal Information and jumps
        straight here was previewing whatever was saved BEFORE that edit:
        the four template cards showed a different name and history than
        the form directly above them.

        Persisting here rather than at each navigation control is what
        makes the guarantee hold for every route into this step - the Next
        button, the sidebar, and any future entry point alike. The effect
        that calls this flow depends on [mode, currentStep] only, and
        persistMemory() sets neither, so this cannot re-trigger itself.

        A failed save must stop the import: continuing would rebuild the
        canonical version from the same stale row this exists to avoid.
        persistMemory() has already surfaced its own toast in that case.
      */
      const saved = await persistMemory();
      if (!saved) {
        setManualTemplateError("Could not save your Career Memory before preparing templates. Please try again.");
        setManualTemplateStatus("import-error");
        return;
      }

      const importRes = await fetch("/api/internal/canonical-career-memory/import-manual", { method: "POST" });
      const importData = await importRes.json().catch(() => null);
      if (!importRes.ok) {
        setManualTemplateError(importData?.error?.message || "Could not prepare your resume for canonical templates.");
        setManualTemplateStatus("import-error");
        return;
      }
      setManualPreviousVersionSource(importData.previousVersionSource ?? "none");
      setManualCanonicalVersionId(importData.versionId ?? null);

      const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
      const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
      setManualTemplates(templatesData.templates ?? []);

      if (importData.previousVersionSource === "manual") {
        // Re-entering Step 9 for a Manual resume that already has a
        // persisted template - restore it, do not force a reselect.
        const prefRes = await fetch("/api/internal/canonical-career-memory/template-preference");
        const prefData = prefRes.ok ? await prefRes.json() : { defaultTemplateId: null };
        setManualSelectedTemplateId(prefData.defaultTemplateId ?? null);
        setManualTemplateStatus(prefData.defaultTemplateId ? "ready" : "selecting");
      } else {
        // "none" (brand new profile) or "uploaded" (an existing default
        // came from a DIFFERENT, uploaded resume) - never implicitly
        // selected for a Manual entry; the user must choose explicitly.
        setManualSelectedTemplateId(null);
        setManualTemplateStatus("selecting");
      }
    } catch {
      setManualTemplateError("Could not prepare your resume for canonical templates.");
      setManualTemplateStatus("import-error");
    }
  }

  async function selectManualTemplate(templateId: string) {
    setManualTemplateStatus("saving-template");
    setManualTemplateError(null);
    try {
      const res = await fetch("/api/internal/canonical-career-memory/template-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setManualTemplateError(data?.error?.message || "Could not save your template selection.");
        setManualTemplateStatus("selecting");
        return;
      }
      setManualSelectedTemplateId(data.defaultTemplateId);
      setManualPreviousVersionSource("manual");
      setManualTemplateStatus("ready");
      setManualTemplateExplicitlySelected(true);
    } catch {
      setManualTemplateError("Could not save your template selection.");
      setManualTemplateStatus("selecting");
    }
  }

  useEffect(() => {
    if (mode !== "build") return;
    if (currentStep !== steps.length - 1) return;
    if (!canUseService()) return;
    runManualCanonicalFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentStep]);

  const manualCanonicalSelectionRequired = manualTemplateStatus !== "not-applicable" && manualTemplateStatus !== "idle";
  /*
    Phase Step9-gate - gates on an EXPLICIT selection made during THIS
    visit to Step 9, mirroring inlineTemplateBlocksContinue exactly (see
    its own header comment above): a restored/auto-applied previous
    default must never silently satisfy "choose a template".
  */
  const manualTemplateBlocksContinue = manualCanonicalSelectionRequired && !(manualTemplateStatus === "ready" && manualTemplateExplicitlySelected);
  const manualSaveDisabled =
    mode === "build" &&
    currentStep === steps.length - 1 &&
    (!canUseService() || manualTemplateBlocksContinue);

  /*
    Revokes the previous object URL whenever a new file is uploaded (the
    cleanup below runs before the effect re-fires) and on unmount - object
    URLs are otherwise never released and leak for the life of the tab.
  */
  useEffect(() => {
    return () => {
      if (uploadedResumeUrl) {
        URL.revokeObjectURL(uploadedResumeUrl);
      }
    };
  }, [uploadedResumeUrl]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverLetterInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedCoverLetterUrl, setUploadedCoverLetterUrl] = useState("");
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [coverLetterSaved, setCoverLetterSaved] = useState(false);
  const [uploadedCoverLetterKind, setUploadedCoverLetterKind] =
  useState<UploadedResumeKind>("none");

  /*
    Same object-URL cleanup as uploadedResumeUrl above (lines ~231-237) -
    revokes on every new cover letter upload and on unmount, so the blob
    URL created for the "review before saving" step doesn't leak for the
    life of the tab.
  */
  useEffect(() => {
    return () => {
      if (uploadedCoverLetterUrl) {
        URL.revokeObjectURL(uploadedCoverLetterUrl);
      }
    };
  }, [uploadedCoverLetterUrl]);

  
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  // Cancels an in-flight Resume analysis-status poll loop when
  // resetResumeImport() runs (e.g. the user starts a different upload) -
  // does not touch the background job itself, only stops the client from
  // scheduling another poll tick.
  const resumePollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [isUnlocked, setIsUnlocked] = useState(false);
 const [profileStrength, setProfileStrength] = useState(0);
  const progress = Math.round(((currentStep + 1) / steps.length) * 100);
  const isReviewStep = mode === "build" && currentStep === steps.length - 1;
async function loadCareerMemory() {
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("career_memory")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
  return null;
}
   
setProfileStrength(data.profile_strength ?? 0);
  setMemoryData((prev) => ({
  ...prev,

  firstName: data.first_name ?? "",
  lastName: data.last_name ?? "",
  email: data.email ?? "",
  phone: data.phone ?? "",
  location: data.location ?? "",

  linkedin: data.linkedin ?? "",
  headline: data.headline ?? "",
  summary: data.summary ?? "",

  targetRoles: (data.target_roles || []).join(", "),
  targetIndustry: data.target_industry ?? "",
  targetLocation: data.target_location ?? "",
  salaryExpectation: data.salary_expectation ?? "",
  careerGoalSummary: data.career_goal_summary ?? "",

  skills: (data.skills || []).join(", "),

  education:
  data.education?.length
    ? data.education.map((item: any) => ({
        ...emptyEducation,
        ...item,
        startDate:
          item.startDate ??
          item.start_date ??
          "",
        endDate:
          item.endDate ??
          item.end_date ??
          "",
      }))
    : [{ ...emptyEducation }],

workExperience:
  data.experience?.length
    ? data.experience.map((item: any) => ({
        ...emptyWork,
        ...item,
        startDate:
          item.startDate ??
          item.start_date ??
          "",
        endDate:
          item.endDate ??
          item.end_date ??
          "",
        isCurrent:
          item.isCurrent ??
          item.is_current ??
          false,
      }))
    : [{ ...emptyWork }],

volunteerExperience:
  data.volunteer_experience?.length
    ? data.volunteer_experience.map(
        (item: any) => ({
          ...emptyVolunteer,
          ...item,
          startDate:
            item.startDate ??
            item.start_date ??
            "",
          endDate:
            item.endDate ??
            item.end_date ??
            "",
          isCurrent:
            item.isCurrent ??
            item.is_current ??
            false,
        })
      )
    : [{ ...emptyVolunteer }],

languages:
  data.languages?.length
    ? data.languages.map((item: any) => ({
        ...emptyLanguage,
        ...item,
      }))
    : [{ ...emptyLanguage }],

  certifications:
    data.certifications?.length
      ? data.certifications
      : [emptyCertification],

  projects:
    data.projects?.length
      ? data.projects
      : [emptyProject],

  resumeTemplate:
    data.resume_template ?? "Professional",

  coverLetterTemplate:
    data.cover_template ?? "Classic Letter",

  themeColor:
    data.theme ?? "Navy",

  font:
    data.font ?? "Calibri",

  textSize:
  data.text_size ?? "Standard",

  coverLetterTone:
    data.tone ?? "Formal",
}));

setIsUnlocked(
  data.required_completed ?? false
);

return data;
}

  useEffect(() => {
    return () => {
      if (uploadedResumeUrl) URL.revokeObjectURL(uploadedResumeUrl);
    };
  }, [uploadedResumeUrl]);
  useEffect(() => {
  if (!user) {
    return;
  }

  async function initializeCareerMemory() {
    /*
      1. 먼저 Supabase의 공식 저장 데이터를 불러온다.
    */
    await loadCareerMemory();

    /*
      2. 그다음 브라우저 draft가 있으면
         작성 중이던 값을 복원한다.
    */
    const draft =
      localStorage.getItem(
        DRAFT_KEY
      );

    if (!draft) {
      return;
    }

    try {
      const parsedDraft =
        JSON.parse(
          draft
        ) as Partial<CareerMemoryData>;

      setMemoryData(
        (prev) => ({
          ...prev,
          ...parsedDraft,
        })
      );
    } catch (error) {
      console.error(
        "CAREER MEMORY DRAFT PARSE ERROR =",
        error
      );

      /*
        깨진 draft가 계속 문제를 일으키지 않도록 삭제한다.
      */
      localStorage.removeItem(
        DRAFT_KEY
      );
    }
  }

  initializeCareerMemory();
}, [user]);

  function updateMemory(
  field: keyof CareerMemoryData,
  value: string | boolean
) {
  setMemoryData(prev => {
    const updated = {
      ...prev,
      [field]: value,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

 function updateArrayItem<T extends object>(
  section: keyof CareerMemoryData,
  index: number,
  field: keyof T,
  value: string | boolean
) {
  setMemoryData((prev) => {
    const items = [
      ...(prev[section] as T[]),
    ];

    items[index] = {
      ...items[index],
      [field]: value,
    };

    const updated = {
      ...prev,
      [section]: items,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

  function addItem(
  section: keyof CareerMemoryData,
  emptyItem: object
) {
  setMemoryData((prev) => {
    const updated = {
      ...prev,

      [section]: [
        ...(prev[section] as object[]),
        { ...emptyItem },
      ],
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

 function removeItem(
  section: keyof CareerMemoryData,
  index: number
) {
  setMemoryData((prev) => {
    const items = [
      ...(prev[section] as object[]),
    ];

    /*
      최소 1개 입력 칸은 유지한다.
    */
    if (items.length === 1) {
      return prev;
    }

    items.splice(
      index,
      1
    );

    const updated = {
      ...prev,
      [section]: items,
    };

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(updated)
    );

    return updated;
  });
}

  function hasPersonalInfo() {
    return Boolean((memoryData.firstName.trim() || memoryData.lastName.trim()) && memoryData.email.trim());
  }

  function hasWorkExperience() {
    return memoryData.workExperience.some((x) => x.company?.trim() || x.jobTitle?.trim() || x.description?.trim());
  }

  function hasVolunteerExperience() {
    return memoryData.volunteerExperience.some((x) => x.organization?.trim() || x.role?.trim() || x.description?.trim());
  }

  function hasExperience() {
    return hasWorkExperience() || hasVolunteerExperience();
  }

  function hasSkills() {
  if (Array.isArray(memoryData.skills)) {
    return memoryData.skills.length > 0;
  }

  return Boolean(memoryData.skills?.trim());
  }

  function requiredCompletedCount() {
    return [hasPersonalInfo(), hasExperience(), hasSkills()].filter(Boolean).length;
  }

  function canUseService() {
    return requiredCompletedCount() === 3;
  }

  function memoryStrength() {
  let score = 0;

  // 1. Personal Information: 15%
  if (hasPersonalInfo()) {
    score += 15;
  }

  // 2. Education: 10%
 if (
  memoryData.education.some(
    (item) =>
      item.school?.trim() ||
      item.program?.trim() ||
      item.startDate?.trim() ||
      item.endDate?.trim() ||
      item.gpa?.trim() ||
      item.coursework?.trim()
  )
) {
  score += 10;
}

  // 3. Experience: 20%
  if (hasExperience()) {
    score += 20;
  }

  // 4. Skills: 15%
  if (hasSkills()) {
    score += 15;
  }

  // 5. Languages: 10%
  if (
    memoryData.languages.some(
      (item) =>
        item.language?.trim() ||
        item.level?.trim()
    )
  ) {
    score += 10;
  }

  // 6. Certifications: 10%
  if (
    memoryData.certifications.some(
      (item) =>
        item.name?.trim() ||
        item.issuer?.trim() ||
        item.date?.trim() ||
        item.description?.trim()
    )
  ) {
    score += 10;
  }

  // 7. Projects: 10%
  if (
    memoryData.projects.some(
      (item) =>
        item.name?.trim() ||
        item.role?.trim() ||
        item.dates?.trim() ||
        item.description?.trim()
    )
  ) {
    score += 10;
  }

  // 8. Career Goals: 10%
  if (
    memoryData.targetRoles?.trim() ||
    memoryData.targetIndustry?.trim() ||
    memoryData.targetLocation?.trim() ||
    memoryData.salaryExpectation?.trim() ||
    memoryData.careerGoalSummary?.trim()
  ) {
    score += 10;
  }

  return Math.min(score, 100);
}

  const strength = profileStrength;
  const requiredCount = requiredCompletedCount();
  
  async function persistMemory() {
  if (!user) {
    toast.error("We couldn't load your account. Please refresh the page and try again.");
    return;
  }

  const { data, error } = await supabase
  .from("career_memory")
  .upsert(
    {
      user_id: user.id,

      first_name: memoryData.firstName,
      last_name: memoryData.lastName,
      email: memoryData.email,
      phone: memoryData.phone,
      location: memoryData.location,

      linkedin: memoryData.linkedin,
      headline: memoryData.headline,
      summary: memoryData.summary,

      target_roles: memoryData.targetRoles
        ? memoryData.targetRoles.split(",").map((x) => x.trim())
        : [],

      target_industry: memoryData.targetIndustry,
      target_location: memoryData.targetLocation,
      salary_expectation: memoryData.salaryExpectation,
      career_goal_summary: memoryData.careerGoalSummary,

      skills: Array.isArray(memoryData.skills)
        ? memoryData.skills
        : (memoryData.skills || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),

      education: memoryData.education,

    experience: memoryData.workExperience,

volunteer_experience:
  memoryData.volunteerExperience,

      languages: memoryData.languages,
      certifications: memoryData.certifications,
      projects: memoryData.projects,

      resume_template: memoryData.resumeTemplate,
      cover_template: memoryData.coverLetterTemplate,
      theme: memoryData.themeColor,
      font: memoryData.font,
      text_size: memoryData.textSize,
      tone: memoryData.coverLetterTone,
      resume_name: "Career Memory Resume",
      profile_strength: memoryStrength(),
      required_completed:
  hasPersonalInfo() &&
  hasExperience() &&
  hasSkills(),
    },
    {
      onConflict: "user_id",
    }
  )
  .select();

if (error) {
  console.error("CAREER MEMORY SAVE ERROR =", error);
  toast.error(error.message);
  return false;
}

/*
  공식 저장에 성공했으므로
  브라우저 임시 draft를 삭제한다.
*/
localStorage.removeItem(
  DRAFT_KEY
);

const newStrength =
  memoryStrength();

setProfileStrength(
  newStrength
);

setIsUnlocked(
  hasPersonalInfo() &&
  hasExperience() &&
  hasSkills()
);

return true;
  }
  async function saveMemory() {
  console.log("SAVE CLICKED");

  await persistMemory();

  toast.success("Career Memory saved.");
}

  /*
    Phase 6I.2 hard gate (spec section 13/14) - shared by two call
    sites: proactively on mount (so an EXISTING user with a canonical
    profile and no default_template_id sees the blocking prompt "next
    time they enter Career Memory," per section 14, without needing to
    click anything first) and inside continueToDashboard (so a brand
    new import can't slip past the same check via a faster click).
    Returns true when blocking was triggered - callers use that to
    decide whether to proceed with whatever they were about to do.
    Legacy-only users (no canonical profile at all) are unaffected -
    templateGateBlocking simply never becomes true for them.
  */
  async function checkAndBlockOnTemplateGate(): Promise<boolean> {
    try {
      const prefRes = await fetch("/api/internal/canonical-career-memory/template-preference");
      if (prefRes.ok) {
        const prefData = await prefRes.json();
        if (!prefData.defaultTemplateId) {
          const profileRes = await fetch("/api/internal/canonical-career-memory/profile");
          if (profileRes.status !== 404) {
            const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
            const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
            const templateGateCandidates = templatesData.templates ?? [];
            // Fail-safe: a non-OK response or an empty template list must
            // never open the blocking gate with nothing selectable in it -
            // fall through to the existing non-blocking return instead.
            if (templatesRes.ok && templateGateCandidates.length > 0) {
              setTemplateGateTemplates(templateGateCandidates);
              setTemplateGateError(null);
              setTemplateGateBlocking(true);
              return true;
            }
          }
        }
      }
    } catch {
      // Best-effort gate check - a network hiccup here must not trap
      // the user; treat it as "not blocking" rather than an
      // inconclusive block.
    }
    return false;
  }

  async function continueToDashboard() {
  /*
    Phase Step9-gate Part D/L - defense-in-depth, never relying solely
    on the disabled buttons above. Gate 1 re-checks the exact same
    required-section completeness the buttons already gate on. Gate 2
    is scoped to the Manual Step 9 review screen only (isReviewStep) -
    the same explicit-selection requirement selectManualTemplate/
    manualTemplateBlocksContinue already enforce visually, enforced
    again here so a raw call to this function can never bypass it.
  */
  if (!canUseService()) {
    return;
  }
  if (isReviewStep && manualTemplateBlocksContinue) {
    return;
  }
  const saved = await persistMemory();

  if (!saved) {
    return;
  }

  if (await checkAndBlockOnTemplateGate()) {
    return;
  }

  /*
    Dashboard reads resumes/coverLetters/careerMemory from the shared
    useLogin() context (lib/auth/LoginManager.tsx), which only fetches on
    initial mount and on auth state changes - never on navigation. Without
    this, the just-saved/uploaded data doesn't appear until a manual
    browser refresh remounts that context from scratch. Awaited so the
    context already holds fresh data before Dashboard's own component
    mounts and reads it.
  */
  await refresh();
  router.replace("/dashboard");
}

/*
  Uploaded-resume completion only (mode === "import" && importStage === "parsed").
  Deliberately NOT continueToDashboard(): that handler opens with
  `if (!canUseService()) return`, which requires Personal Information, Experience
  AND Skills. An uploaded resume populates none of them -
  applyResumeAnalysisResult() sets only uploadedResumeName/uploadedResumeText/
  resumeSource - so on this screen that gate returned before persistMemory() ever
  ran, making the button a silent no-op with nothing saved and no message.

  The gates are omitted here rather than removed there, because
  continueToDashboard() has four other call sites (the required-sections banner,
  StartScreen, the manual build CTA and renderFullResumePreview) whose policy must
  not change. Manual/direct resumes keep the required-section requirement in full.

  Safe to persist partially: persistMemory() has no completeness precondition and
  records `required_completed` honestly, which is the flag the rest of the product
  (auth/callback routing, find-jobs) still gates on. The template requirement is
  NOT relaxed - the button stays disabled by inlineTemplateBlocksContinue until a
  template has been explicitly selected and its preference PUT has succeeded.
*/
async function saveImportedResumeAndContinue() {
  const saved = await persistMemory();

  if (!saved) {
    return;
  }

  await refresh();
  router.replace("/dashboard");
}

async function confirmTemplateGateAndContinue(templateId: string) {
  setTemplateGateSaving(true);
  setTemplateGateError(null);
  try {
    const res = await fetch("/api/internal/canonical-career-memory/template-preference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setTemplateGateError(data?.error?.message || "Could not save your template selection.");
      return;
    }
    setTemplateGateBlocking(false);
    await refresh();
    router.replace("/dashboard");
  } catch {
    setTemplateGateError("Could not save your template selection.");
  } finally {
    setTemplateGateSaving(false);
  }
}
function continueUploadedDashboard() {
  router.replace("/dashboard");
}
 function handleProtectedNav(item: string) {
  const allowedBeforeUnlock = [
    "Career Memory",
    "Find Jobs",
    "Settings",
  ];

  const pathMap: Record<string, string> = {
    Dashboard: "/dashboard",
    "Career Memory": "/career-memory",
    "Find Jobs": "/find-jobs",
    "Generate Package": "/create-package",
    "Job Tracker": "/job-tracker",
    Analytics: "/analytics",
    Settings: "/settings",
  };

  const path = pathMap[item];

  if (!path) {
    return;
  }

  // Career Memory는 현재 페이지라 이동 안 함
  if (item === "Career Memory") {
    return;
  }




  router.push(path);
}

  async function handleSaveAndContinue() {
  const saved = await persistMemory();

  if (!saved) {
    return;
  }

  if (currentStep < steps.length - 1) {
    setCurrentStep((prev) => prev + 1);
    return;
  }

  /*
    Phase 6I.6.8 Part D - server/save-boundary enforcement, never relying
    solely on the disabled button below. A Manual resume must have an
    explicit canonical template selection (manualSelectedTemplateId,
    itself only ever set from a successful template-preference PUT,
    which validates the id against the real registry server-side -
    see selectManualTemplate()/lib/careerMemory/services/
    canonicalTemplatePreferenceService.ts's validateTemplateId() call)
    before "Finish Memory" may complete.
  */
  if (mode === "build" && !canUseService()) {
    return;
  }

  if (mode === "build" && manualTemplateBlocksContinue) {
    return;
  }

  await refresh();
  router.replace("/dashboard");
}

  function guessFileKind(file: File): UploadedResumeKind {
    const lowerName = file.name.toLowerCase();
    if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
    if (file.type === "text/plain" || lowerName.endsWith(".txt")) return "txt";
    if (lowerName.endsWith(".docx")) return "docx";
    return "other";
  }

  function parseTxtResume(text: string, fileName: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
    const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";
    const firstLine = lines[0] || fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
    const nameParts = firstLine.split(/\s+/).filter(Boolean);
    const skillsLine = lines.find((line) => /skills?/i.test(line)) || "";
    const experienceLine = lines.find((line) => /experience|employment|work/i.test(line)) || "";
    const educationLine = lines.find((line) => /education|college|university|school|seneca/i.test(line)) || "";

    setMemoryData((prev) => ({
  ...prev,

  firstName:
    prev.firstName || nameParts[0] || "",

  lastName:
    prev.lastName ||
    nameParts.slice(1).join(" ") ||
    "",

  email:
    prev.email || email,

  phone:
    prev.phone || phone,

  headline:
    prev.headline ||
    lines.find(
      (line) =>
        !line.includes("@") &&
        line.length < 60 &&
        line !== firstLine
    ) ||
    "",

  summary:
    prev.summary ||
    lines
      .slice(1, 5)
      .join(" ")
      .slice(0, 700),

  workExperience:
    prev.workExperience.some(
      (x) =>
        x.company ||
        x.jobTitle ||
        x.description
    )
      ? prev.workExperience
      : [
          {
            company: "",
            jobTitle:
              experienceLine ||
              "Experience from uploaded resume",
            location: "",
            startDate: "",
            endDate: "",
            isCurrent: false,
            description: text.slice(0, 900),
          },
        ],

  education:
    prev.education.some(
      (x) =>
        x.school ||
        x.program
    )
      ? prev.education
      : [
          {
            school: educationLine,
            program: "",
            startDate: "",
            endDate: "",
            gpa: "",
            coursework: "",
          },
        ],

  skills:
    prev.skills ||
    skillsLine
      .replace(/skills?:?/i, "")
      .trim() ||
    "Extracted from uploaded resume. Review and edit your skills before continuing.",

  uploadedResumeText: text,
}));
  }

  async function computeFileContentHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function processResumeFile(file: File) {
  setResumeUploadError("");

  /*
    Real backend milestones written by runResumeAnalysis's own setStage()
    calls (lib/documentAnalysis/resumeAnalysisCore.ts) - surfaced via the
    analysis-status route's `stage` field. Maps each real stage to a
    percentage strictly between the client's pre-dispatch value (45, set
    right before the /api/analyze-resume fetch) and the terminal 100 set
    on success, so the progress bar reflects genuine backend progress
    during the multi-minute AI analysis instead of freezing at a single
    value for the whole wait.

    Declared here, at the very top of processResumeFile(), rather than
    further down near pollResumeAnalysisStatus() - the accepted===true
    path below returns before ever reaching a later declaration site, and
    since this is a const, that early return would leave it permanently
    uninitialized (TDZ) for pollResumeAnalysisStatus()'s own closure,
    which executes asynchronously afterward and throws ReferenceError the
    first time it reads RESUME_STAGE_PROGRESS[statusResult.stage] on a
    real (non-terminal) analysis-status poll response.
  */
  const RESUME_STAGE_PROGRESS: Record<string, number> = {
    downloading_file: 52,
    extracting_text: 62,
    reconstructing_text: 74,
    extracting_fields: 86,
    verifying: 95,
  };

  // Client-side check is UX-only (Part AD) - the same rules are
  // authoritatively re-enforced server-side in resumeAnalysisCore.ts via
  // this same shared module, including a real magic-byte signature check
  // this client check cannot perform.
  const extension = getLowercaseExtension(file.name);

  /*
    Temporary product policy: NEW resume uploads are PDF-only. This is a
    UI-level gate, deliberately not a parser or server change - every DOCX
    code path (mammoth, docxLayoutAnalyzer, docxGeometryRenderer,
    process-resume-design's DOCX branch, canonical DOCX analysis) stays
    exactly as it is, so already-stored preview_mode="docx_html" resumes keep
    rendering, DOCX export keeps working, and Cover Letter DOCX is untouched.
    Only the creation of NEW DOCX resume rows stops here.

    Placed at the top of processResumeFile(), which is the single choke point
    both the file picker (handleResumeUpload) and drag/drop (handleResumeDrop)
    call, and ahead of every side effect - no Storage write, no resumes row,
    no /api/process-resume-design call, no canonical import, so mammoth and
    Chromium are never reached for a rejected file.

    The file input deliberately still accepts .docx: filtering it out of the
    picker would leave the user with a greyed-out file and no explanation,
    and would not cover drag/drop at all. Letting the selection through and
    rejecting it here is what makes the reason visible.
  */
  if (extension === "docx") {
    setResumeUploadError("Please upload your resume as a PDF file.");
    return;
  }

  if (!extension || !RESUME_ALLOWED_EXTENSIONS.includes(extension as any)) {
    setResumeUploadError(
      "Unsupported file type. Please upload your resume as a PDF file."
    );
    return;
  }

  if (file.size === 0) {
    setResumeUploadError(
      "This file is empty. Please upload a valid resume file."
    );
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    setResumeUploadError(
      "This file is larger than 10MB. Please upload a smaller resume."
    );
    return;
  }

  function resetResumeImport() {
    if (uploadProgressTimerRef.current) {
      clearInterval(uploadProgressTimerRef.current);
      uploadProgressTimerRef.current = null;
    }

    if (resumePollTimeoutRef.current) {
      clearTimeout(resumePollTimeoutRef.current);
      resumePollTimeoutRef.current = null;
    }

    setImportStage("idle");
    setImportMessage("");
    setUploadProgress(0);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function applyResumeAnalysisResult(uploadedFile: File, data: any) {
    setMemoryData((prev) => ({
      ...prev,
      uploadedResumeName: uploadedFile.name,
      uploadedResumeText: data?.originalText || "",
      resumeSource: "uploaded",
    }));

    // Analysis itself is fully done here, but the post-upload screen
    // must not reveal until runInlineCanonicalFlow (fired right after
    // this) also resolves - so this caps progress at 95, matching the
    // real backend "verifying" milestone, rather than jumping straight
    // to 100. Math.max guards against a real backend stage value that
    // already reached (or exceeded) 95 via the polling path.
    setUploadProgress((prev) => Math.max(prev, 95));
    setImportStage("parsed");
    setImportMessage("Resume analyzed successfully.");
  }

if (!user) {
  resetResumeImport();
  setResumeUploadError(
    "Please sign in before uploading your resume."
  );
  return;
}

  let storagePath = "";
  let insertedResumeId = "";
  // [RESUME_TRACE] instrumentation-only - Resume upload path fetch timing marker.
  let resumeFetchStartTime: number | null = null;

  try {
    /*
      1. 파일 확인
    */
    setImportStage("parsing");
    setImportMessage("Checking your file");
    setUploadProgress(10);

    const contentHash = await computeFileContentHash(file);

    /*
      2. 중복 및 3개 제한 확인

      Duplicate detection is a client-side pre-check for fast, specific
      feedback ("you've already uploaded this") - the actual guarantee
      against a race (two uploads of the same file, or a 4th resume,
      submitted at nearly the same time) is the DB-level unique index on
      (user_id, content_hash) and the upload-limit trigger, both added in
      supabase/migrations/20260724125129_resumes_content_hash_and_limits.sql.
      The saveError handling below after the insert is what actually
      enforces this under a race; this pre-check only avoids the wasted
      storage upload in the common, non-racing case.
    */
    setImportMessage("Checking your resume limit");
    setUploadProgress(20);

    const { data: existingResumes, error: countError } =
      await supabase
        .from("resumes")
        .select("id, content_hash")
        .eq("user_id", user.id)
        .eq("source_type", "uploaded");

    if (countError) {
      console.error(
        "RESUME COUNT ERROR =",
        countError
      );

      resetResumeImport();
setResumeUploadError(
  `We could not check your existing resumes: ${countError.message}`
);
return;
    }

    const duplicateResume = (existingResumes || []).find(
      (resume: any) =>
        resume.content_hash && resume.content_hash === contentHash
    );

    if (duplicateResume) {
      resetResumeImport();

      setResumeUploadError(
        "You've already uploaded this resume. Delete it first if you want to re-upload it."
      );

      return;
    }

    const uploadedCount = (existingResumes || []).length;

    if (uploadedCount >= MAX_UPLOADED_RESUMES) {
      resetResumeImport();

      setResumeUploadError(
  `You can upload up to ${MAX_UPLOADED_RESUMES} resumes. Delete an existing resume before uploading another one.`
);

      return;
    }

    /*
      3. Supabase Storage 업로드
    */
    setImportMessage("Uploading to secure storage");
    setUploadProgress(30);

    /*
      Part O - the storage key never carries the raw, attacker-controlled
      filename: sanitizeStorageFileNameSegment() strips path separators/
      control characters and caps length. The friendly original filename is
      still stored verbatim in the resumes.file_name column for display.
      Part H - explicit contentType derived from the validated extension,
      not the browser-supplied (spoofable) file.type, so files are served
      back later with a type that matches what was actually validated.
    */
    storagePath = `${user.id}/${Date.now()}-${sanitizeStorageFileNameSegment(file.name, extension)}`;

    const { error: uploadError } =
      await supabase.storage
        .from("resumes")
        .upload(storagePath, file, {
          upsert: false,
          contentType:
            extension === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

    if (uploadError) {
      console.error(
        "RESUME STORAGE ERROR =",
        uploadError
      );

      resetResumeImport();
      setResumeUploadError(uploadError.message);
      return;
    }

    /*
      "Review your resume before saving" 원본 preview에 필요한 kind/URL
      배선 - 원본 파일이 확보되는 즉시 설정하며, 분석 완료 여부와는 무관하다.
    */
    setUploadedResumeKind(guessFileKind(file));
    setUploadedResumeUrl(URL.createObjectURL(file));

    /*
      4. resumes 테이블에 새 이력서 추가 (분석 시작 전)

      Inserted with analysis_status='pending' before analysis runs, so a
      row already exists (for Dashboard-immediate-refresh and the
      content-hash duplicate check) even though the call below awaits
      analysis synchronously in the same request - see
      app/api/analyze-resume/route.ts's own docstring for why analysis
      itself runs in-process rather than a separate worker.
    */
    setImportMessage("Saving to your account");
    setUploadProgress(40);

    const {
      data: resumeData,
      error: saveError,
    } = await supabase
      .from("resumes")
      .insert({
        user_id: user.id,
        source_type: "uploaded",
        file_name: file.name,
        storage_path: storagePath,
        content_hash: contentHash,
        is_default: uploadedCount === 0,
        conversion_status: "pending",
        analysis_status: "pending",
      })
      .select();

    if (saveError) {
      console.error(
        "RESUME DATABASE SAVE ERROR =",
        saveError
      );

      await supabase.storage
        .from("resumes")
        .remove([storagePath]);

      resetResumeImport();

      /*
        RESUME_LIMIT_REACHED comes from the DB trigger
        (enforce_resume_upload_limit) - the race-safe backstop for the
        count check above. code 23505 on this table's insert can only be
        the content_hash unique index (no other unique constraint exists
        on resumes) - the race-safe backstop for the duplicate check
        above.
      */
      const raceMessage = saveError.message?.includes(
        "RESUME_LIMIT_REACHED"
      )
        ? `You can upload up to ${MAX_UPLOADED_RESUMES} resumes. Delete an existing resume before uploading another one.`
        : saveError.code === "23505"
          ? "You've already uploaded this resume. Delete it first if you want to re-upload it."
          : `Your resume could not be saved: ${saveError.message}`;

      setResumeUploadError(raceMessage);
      return;
    }

    insertedResumeId = resumeData?.[0]?.id || "";

    if (!insertedResumeId) {
      await supabase.storage.from("resumes").remove([storagePath]);
      resetResumeImport();
      setResumeUploadError(
        "Your resume was saved, but could not be found afterward. Please try again."
      );
      return;
    }

    /*
      원본 디자인 보존 프리뷰 처리 (best-effort, 업로드 완료를 막지 않음) -
      AI 텍스트 분석과 완전히 독립된 파이프라인이므로 분석 완료를 기다리지
      않고 바로 실행한다. keepalive: true - 페이지 이동에도 요청이 살아남게
      한다 (기존과 동일한 이유).
    */
    fetch("/api/process-resume-design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeId: insertedResumeId }),
      keepalive: true,
    }).catch((designError) => {
      console.error(
        "PROCESS RESUME DESIGN REQUEST ERROR =",
        designError
      );
    });

    /*
      5. 분석 접수 - /api/analyze-resume는 인증/소유권 확인 후 신뢰
      가능한 Background Function(analyze-resume-background, Netlify가
      공식적으로 202 즉시 응답 + 최대 15분 실행을 보장)에 위임하고 빠르게
      응답한다. 실제 텍스트 추출/OpenAI 호출은 여전히
      lib/documentAnalysis/resumeAnalysisCore.ts(runResumeAnalysis, 무수정)가
      수행하며, 이 요청의 실행 위치와 수명만 바뀐다.
    */
    setImportMessage("Extracting text and analyzing with AI");
    setUploadProgress(45);

    // [RESUME_TRACE] instrumentation-only.
    resumeFetchStartTime = performance.now();
    console.log("[RESUME_TRACE] ANALYZE_RESUME_FETCH_START", {
      resumeId: insertedResumeId,
      storagePath,
      performanceNow: resumeFetchStartTime,
      dateNow: Date.now(),
    });

    const analyzeResponse = await fetch("/api/analyze-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeId: insertedResumeId }),
    });

    // [RESUME_TRACE] instrumentation-only.
    {
      const resolvedAt = performance.now();
      const headerEntries: Record<string, string> = {};
      analyzeResponse.headers.forEach((value, key) => {
        headerEntries[key] = value;
      });

      console.log("[RESUME_TRACE] ANALYZE_RESUME_FETCH_RESOLVED", {
        performanceNow: resolvedAt,
        elapsedMs: resumeFetchStartTime !== null ? resolvedAt - resumeFetchStartTime : null,
        status: analyzeResponse.status,
        statusText: analyzeResponse.statusText,
        ok: analyzeResponse.ok,
        redirected: analyzeResponse.redirected,
        type: analyzeResponse.type,
        url: analyzeResponse.url,
        headers: headerEntries,
      });
    }

    let analyzeResult: any;

    try {
      /*
        Part AI - this used to also log the full raw response body
        ([RESUME_TRACE] ANALYZE_RESUME_RAW_RESPONSE) to the browser
        console. On the idempotent-replay-succeeded branch that raw body
        is the entire parsed resume (name/email/phone/work history/
        education/skills) - removed; only non-content metadata is traced.
      */
      analyzeResult = await analyzeResponse.json();

      console.log("[RESUME_TRACE] ANALYZE_RESUME_JSON_OK", {
        performanceNow: performance.now(),
      });
    } catch (jsonError) {
      /*
        접수 요청 자체가 비정상 응답(예: HTML 에러 페이지)을 반환했다 -
        이 요청은 이제 인증/소유권 확인과 디스패치만 수행하는 짧은
        요청이므로, 실제로 백그라운드 작업이 이미 시작되었는지 알 수
        없다. 애매한 상태에서 Storage/DB를 삭제하면 이미 진행 중일 수
        있는 분석 결과를 잃을 수 있으므로 삭제하지 않는다 - 사용자는
        재시도할 수 있고, 서버는 재시도 시 analysis_status를 다시 확인해
        멱등하게 처리한다.
      */
      console.log("[RESUME_TRACE] ANALYZE_RESUME_JSON_ERROR", {
        name: jsonError instanceof Error ? jsonError.name : undefined,
        message: jsonError instanceof Error ? jsonError.message : String(jsonError),
        stack: jsonError instanceof Error ? jsonError.stack : undefined,
      });

      console.error(
        "RESUME ANALYSIS JSON ERROR =",
        jsonError
      );

      resetResumeImport();

      setResumeUploadError(
        "We couldn't confirm the analysis request. Please check back in a moment or try again."
      );

      return;
    }

    // 즉시 succeeded로 재확인된 경우 (예: 재시도 요청) - 기존 동기 버전과
    // 동일한 성공 처리.
    if (analyzeResponse.ok && analyzeResult.success === true && analyzeResult.data) {
      applyResumeAnalysisResult(file, analyzeResult.data);
      runInlineCanonicalFlow(insertedResumeId);
      return;
    }

    // 서버가 이미 terminal failed 상태를 확인하고 반환한 경우 (accepted가
    // 아님 = 새로 디스패치하지 않고 기존에 기록된 진짜 실패를 그대로
    // 재전달한 것) - 기존 delete+error 정책을 그대로 적용한다.
    if (
      analyzeResult.accepted !== true &&
      analyzeResult.success === false &&
      analyzeResult.code
    ) {
      // [RESUME_TRACE] instrumentation-only.
      console.log("[RESUME_TRACE] ANALYZE_RESUME_RESPONSE_FAILED", {
        status: analyzeResponse.status,
        ok: analyzeResponse.ok,
        parsedSuccess: analyzeResult?.success,
        message: analyzeResult?.message,
        parsedObject: analyzeResult,
      });

      console.error(
        "RESUME ANALYSIS FAILED =",
        analyzeResult
      );

      await cleanupFailedResume("response_failed");

      resetResumeImport();

      setResumeUploadError(
        analyzeResult.message || "Failed to analyze resume."
      );

      return;
    }

    // 정상 접수됨 (202, pending 또는 processing) - polling 시작.
    if (analyzeResult.accepted === true) {
      pollResumeAnalysisStatus(insertedResumeId, Date.now());
      return;
    }

    /*
      위 세 경우 중 어디에도 명확히 해당하지 않는 응답 - 401/404/500/502
      등 접수 자체가 애매하게 실패한 상태. terminal failed로 확정되지
      않았으므로 삭제하지 않는다.
    */
    // [RESUME_TRACE] instrumentation-only.
    console.log("[RESUME_TRACE] ANALYZE_RESUME_RESPONSE_FAILED", {
      status: analyzeResponse.status,
      ok: analyzeResponse.ok,
      parsedSuccess: analyzeResult?.success,
      message: analyzeResult?.message,
      parsedObject: analyzeResult,
    });

    console.error(
      "RESUME ANALYSIS REQUEST FAILED =",
      analyzeResult
    );

    resetResumeImport();

    setResumeUploadError(
      analyzeResult?.message || "Failed to analyze resume. Please try again."
    );
  } catch (error) {
    /*
      접수 요청 자체가 네트워크 오류 등으로 완전히 실패했다 - 위
      JSON parse error 분기와 동일한 이유로 삭제하지 않는다.
    */
    // [RESUME_TRACE] instrumentation-only.
    console.log("[RESUME_TRACE] ANALYZE_RESUME_FETCH_EXCEPTION", {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      performanceNow: performance.now(),
      elapsedSinceFetchStartMs:
        resumeFetchStartTime !== null ? performance.now() - resumeFetchStartTime : null,
    });

    console.error(
      "RESUME UPLOAD ERROR =",
      error
    );

    resetResumeImport();

    setResumeUploadError(
      "We couldn't reach the analysis server. Please check back in a moment or try again."
    );
  }

  /*
    /api/resumes/[id]/analysis-status를 주기적으로 확인한다. 서버가 이미
    수행 중인(또는 곧 수행할) runResumeAnalysis의 결과만 읽으며, 분석/
    디자인 생성 자체의 순서나 내용은 전혀 바꾸지 않는다.
  */
  async function pollResumeAnalysisStatus(resumeId: string, pollStartedAt: number) {
    const RESUME_POLL_INTERVAL_MS = 2000;
    const RESUME_POLL_MAX_MS = 5 * 60 * 1000;

    resumePollTimeoutRef.current = setTimeout(async () => {
      if (Date.now() - pollStartedAt > RESUME_POLL_MAX_MS) {
        /*
          Polling 최대 대기시간 도달 - 서버의 백그라운드 작업은 계속
          완료될 수 있으므로 Storage/DB를 삭제하지 않는다.
        */
        resumePollTimeoutRef.current = null;
        resetResumeImport();
        setResumeUploadError(
          "This is taking longer than expected. Please check back in a moment."
        );
        return;
      }

      let statusResponse: Response;

      try {
        statusResponse = await fetch(`/api/resumes/${resumeId}/analysis-status`);
      } catch (networkError) {
        // 일시적 네트워크 오류 - 삭제하지 않고 다음 tick에 재시도.
        pollResumeAnalysisStatus(resumeId, pollStartedAt);
        return;
      }

      let statusResult: any;

      try {
        statusResult = await statusResponse.json();
      } catch (jsonError) {
        // 일시적 파싱 오류 - 삭제하지 않고 다음 tick에 재시도.
        pollResumeAnalysisStatus(resumeId, pollStartedAt);
        return;
      }

      if (!statusResponse.ok) {
        resumePollTimeoutRef.current = null;
        resetResumeImport();
        setResumeUploadError(
          statusResult?.error ||
            "The resume could not be found. Please try uploading again."
        );
        return;
      }

      if (statusResult.status === "succeeded") {
        resumePollTimeoutRef.current = null;
        applyResumeAnalysisResult(file, statusResult.data);
        runInlineCanonicalFlow(resumeId);
        return;
      }

      if (statusResult.status === "failed") {
        // 서버가 명시적으로 terminal failed 상태를 기록함 - 기존
        // delete+error 정책을 그대로 적용한다.
        resumePollTimeoutRef.current = null;
        await cleanupFailedResume("response_failed");
        resetResumeImport();
        setResumeUploadError(
          statusResult.message || "Failed to analyze resume."
        );
        return;
      }

      // pending/processing - real stage milestone, if any, bumps the
      // progress bar (never regresses); then keeps polling.
      const stageValue = statusResult.stage ? RESUME_STAGE_PROGRESS[statusResult.stage] : undefined;
      if (stageValue) {
        setUploadProgress((prev) => Math.max(prev, stageValue));
      }
      pollResumeAnalysisStatus(resumeId, pollStartedAt);
    }, RESUME_POLL_INTERVAL_MS);
  }

  // [RESUME_TRACE] instrumentation-only - shared by every branch that
  // confirms a genuine terminal analysis failure (not an ambiguous
  // request/network/parse error). Same Storage-then-DB order and same
  // calls the previous synchronous version used.
  async function cleanupFailedResume(reason: string) {
    console.log("[RESUME_TRACE] ANALYZE_RESUME_CLEANUP_START", {
      resumeId: insertedResumeId,
      storagePath,
      reason,
    });

    {
      const storageDeleteStart = performance.now();
      console.log("[RESUME_TRACE] RESUME_STORAGE_DELETE_START", {
        resumeId: insertedResumeId,
        storagePath,
      });
      await supabase.storage.from("resumes").remove([storagePath]);
      console.log("[RESUME_TRACE] RESUME_STORAGE_DELETE_DONE", {
        elapsedMs: performance.now() - storageDeleteStart,
      });
    }

    {
      const dbDeleteStart = performance.now();
      console.log("[RESUME_TRACE] RESUME_DB_DELETE_START", {
        resumeId: insertedResumeId,
      });
      await supabase
        .from("resumes")
        .delete()
        .eq("id", insertedResumeId)
        .eq("user_id", user.id);
      console.log("[RESUME_TRACE] RESUME_DB_DELETE_DONE", {
        elapsedMs: performance.now() - dbDeleteStart,
      });
    }
  }
}
async function handleResumeUpload(
  event: ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  await processResumeFile(file);
}

function handleResumeDragOver(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(true);
}

function handleResumeDragLeave(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(false);
}

async function handleResumeDrop(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsResumeDragging(false);

  const file = event.dataTransfer.files?.[0];

  if (!file) {
    setResumeUploadError(
      "No file was detected. Please try dropping your resume again."
    );
    return;
  }

  await processResumeFile(file);
}
  async function handleCoverLetterUpload(
  event: ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) return;

  await processCoverLetterFile(file);
}

function handleCoverLetterDragOver(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsCoverLetterDragging(true);
}

function handleCoverLetterDragLeave(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsCoverLetterDragging(false);
}

async function handleCoverLetterDrop(
  event: React.DragEvent<HTMLDivElement>
) {
  event.preventDefault();
  event.stopPropagation();

  setIsCoverLetterDragging(false);

  const file = event.dataTransfer.files?.[0];

  if (!file) {
    setCoverLetterUploadError(
      "No file was detected. Please try dropping your cover letter again."
    );
    return;
  }

  await processCoverLetterFile(file);
}

async function processCoverLetterFile(file: File) {
setCoverLetterUploadError("");

  /*
    Phase 6I.6.32 - this function previously had NO validation of any kind
    (no extension check, no size check), unlike processResumeFile. Mirrors
    the same UX-only client check used for resumes; server-side
    coverLetterAnalysisCore.ts is authoritative.
  */
  const coverLetterExtension = getLowercaseExtension(file.name);

  if (
    !coverLetterExtension ||
    !COVER_LETTER_ALLOWED_EXTENSIONS.includes(coverLetterExtension as any)
  ) {
    setCoverLetterUploadError(
      "Unsupported file type. Please upload a PDF, DOCX, or TXT cover letter."
    );
    return;
  }

  if (file.size === 0) {
    setCoverLetterUploadError(
      "This file is empty. Please upload a valid cover letter file."
    );
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    setCoverLetterUploadError(
      "This file is larger than 10MB. Please upload a smaller cover letter."
    );
    return;
  }

  function resetCoverLetterImport() {
    setCoverLetterImportStage("idle");
    setCoverLetterImportMessage("");
    setCoverLetterUploadProgress(0);

    if (coverLetterInputRef.current) {
      coverLetterInputRef.current.value = "";
    }
  }

  function applyCoverLetterAnalysisResult(uploadedFile: File, data: any) {
    setUploadedCoverLetterKind(guessFileKind(uploadedFile));
    setUploadedCoverLetterUrl(URL.createObjectURL(uploadedFile));

    setMemoryData((prev) => ({
      ...prev,
      uploadedCoverLetterName: uploadedFile.name,
      uploadedCoverLetterText: data?.originalText || "",
      coverLetterSource: "uploaded",
      recipient: data?.recipient || "",
      company: data?.company || "",
      jobTitle: data?.jobTitle || "",
      greeting: data?.greeting || "",
      body: data?.body || "",
      closing: data?.closing || "",
      signature: data?.signature || "",
      coverLetterTone: data?.tone || prev.coverLetterTone,
    }));

    setCoverLetterUploadProgress(100);
    setCoverLetterUploadError("");
    setCoverLetterImportStage("parsed");
    setCoverLetterImportMessage("Cover Letter analyzed successfully.");
  }

  if (!user) {
  resetCoverLetterImport();
  setCoverLetterUploadError(
    "Please sign in before uploading a cover letter."
  );
  return;
}

  let storagePath = "";
  let insertedCoverLetterId = "";

  try {
    setCoverLetterImportStage("parsing");
    setCoverLetterImportMessage("Checking your file");
    setCoverLetterUploadProgress(10);

    const { count, error: countError } =
      await supabase
        .from("cover_letters")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("user_id", user.id);

    if (countError) {
      console.error(
        "COVER LETTER COUNT ERROR =",
        countError
      );

      resetCoverLetterImport();
setCoverLetterUploadError(
  `We could not check your existing cover letters: ${countError.message}`
);
return;
    }

    if ((count ?? 0) >= MAX_COVER_LETTERS) {
      resetCoverLetterImport();

      setCoverLetterUploadError(
  `You can upload up to ${MAX_COVER_LETTERS} cover letters. Delete an existing cover letter before uploading another one.`
);

      return;
    }

    storagePath = `${user.id}/${Date.now()}-${sanitizeStorageFileNameSegment(file.name, coverLetterExtension)}`;

    const { error: uploadError } =
      await supabase.storage
        .from("cover-letters")
        .upload(storagePath, file, {
          upsert: false,
          contentType:
            coverLetterExtension === "pdf"
              ? "application/pdf"
              : coverLetterExtension === "docx"
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "text/plain",
        });

    if (uploadError) {
      console.error(
        "COVER LETTER STORAGE ERROR =",
        uploadError
      );

      resetCoverLetterImport();
      setCoverLetterUploadError(uploadError.message);
      return;
    }

    /*
      resumes 테이블에 새 Cover Letter 추가 (분석 시작 전) - Resume 업로드
      흐름(processResumeFile)과 동일한 이유로 분석 전에 row를 먼저 만든다.
    */
    setCoverLetterImportStage("parsing");
    setCoverLetterImportMessage("Saving to your account");
    setCoverLetterUploadProgress(20);

    const {
      data: coverLetterData,
      error: saveError,
    } =
      await supabase
        .from("cover_letters")
        .insert({
          user_id: user.id,
          file_name: file.name,
          storage_path: storagePath,

          // 기본값 로직은 기존대로 유지
          is_default: true,

          // 원본 디자인 보존 프리뷰 파이프라인의 시작 상태 - 이력서와
          // 동일하게 "pending"에서 시작해 /api/process-cover-letter-design가
          // 비동기로 처리한다.
          conversion_status: "pending",
          analysis_status: "pending",
        })
        .select();

    if (saveError) {
  console.error(
    "COVER LETTER DATABASE ERROR =",
    saveError
  );

  await supabase.storage
    .from("cover-letters")
    .remove([storagePath]);

  resetCoverLetterImport();

  setCoverLetterUploadError(
    `Your cover letter could not be saved: ${saveError.message}`
  );

  return;
}

    insertedCoverLetterId = coverLetterData?.[0]?.id || "";

    if (!insertedCoverLetterId) {
      await supabase.storage.from("cover-letters").remove([storagePath]);
      resetCoverLetterImport();
      setCoverLetterUploadError(
        "Your cover letter was saved, but could not be found afterward. Please try again."
      );
      return;
    }

    /*
      원본 디자인 보존 프리뷰 처리 (best-effort, 업로드 완료를 막지 않음) -
      AI 텍스트 분석과 독립적이므로 분석 완료를 기다리지 않고 바로 실행한다.
    */
    fetch("/api/process-cover-letter-design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetterId: insertedCoverLetterId }),
      keepalive: true,
    }).catch((designError) => {
      console.error(
        "PROCESS COVER LETTER DESIGN REQUEST ERROR =",
        designError
      );
    });

    /*
      분석 실행 - Next.js Route 런타임에서 동기적으로 실행하고 최종
      결과를 한 번에 응답받는다.
    */
    setCoverLetterImportMessage(
      "Career Élan is analyzing your cover letter..."
    );
    setCoverLetterUploadProgress(45);

    const analyzeResponse = await fetch("/api/analyze-cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetterId: insertedCoverLetterId }),
    });

    let analyzeResult: any;

    try {
      analyzeResult = await analyzeResponse.json();
    } catch (jsonError) {
      console.error(
        "COVER LETTER ANALYSIS JSON ERROR =",
        jsonError
      );

      await supabase.storage.from("cover-letters").remove([storagePath]);
      await supabase
        .from("cover_letters")
        .delete()
        .eq("id", insertedCoverLetterId)
        .eq("user_id", user.id);

      resetCoverLetterImport();

      setCoverLetterUploadError(
        "The cover letter analysis server returned an invalid response. Please try again."
      );

      return;
    }

    if (!analyzeResponse.ok || !analyzeResult.success) {
      console.error(
        "COVER LETTER ANALYSIS FAILED =",
        analyzeResult
      );

      await supabase.storage.from("cover-letters").remove([storagePath]);
      await supabase
        .from("cover_letters")
        .delete()
        .eq("id", insertedCoverLetterId)
        .eq("user_id", user.id);

      resetCoverLetterImport();

      setCoverLetterUploadError(
        analyzeResult.message ||
          "Failed to analyze cover letter. Please try again."
      );

      return;
    }

    applyCoverLetterAnalysisResult(file, analyzeResult.data);
  } catch (error) {
    console.error(
      "COVER LETTER UPLOAD ERROR =",
      error
    );

    if (insertedCoverLetterId) {
      await supabase
        .from("cover_letters")
        .delete()
        .eq("id", insertedCoverLetterId)
        .eq("user_id", user.id);
    }

    if (storagePath) {
      const { error: cleanupError } =
        await supabase.storage
          .from("cover-letters")
          .remove([storagePath]);

      if (cleanupError) {
        console.error(
          "COVER LETTER FINAL CLEANUP ERROR =",
          cleanupError
        );
      }
    }

    resetCoverLetterImport();

    setCoverLetterUploadError(
  error instanceof Error
    ? error.message
    : "Failed to analyze cover letter. Please try again."
);
  }
}


  function getThemeClass() {
    if (memoryData.themeColor === "Green") return "border-green-600 text-green-700";
    if (memoryData.themeColor === "Blue") return "border-blue-600 text-blue-700";
    if (memoryData.themeColor === "Black") return "border-black text-black";
    if (memoryData.themeColor === "Gray") return "border-gray-500 text-gray-700";
    return "border-slate-800 text-slate-800";
  }

  function continueToImportPreview() {
  setImportStage("preview");
}

  /*
    Cover Letter has no canonical-template concept, so it must not go
    through continueToDashboard()'s checkAndBlockOnTemplateGate() -
    that gate exists to make sure a RESUME template default is chosen
    (Resume satisfies it as a side effect of its own mandatory
    selectInlineTemplate() step before ever reaching this point), and
    tripping it here stranded Cover-Letter-only saves on the "One more
    step before Dashboard" modal instead of navigating (see the
    forensic audit this fix is based on). refresh() is still awaited
    before navigating, same as continueToDashboard() does, so
    LoginManager's coverLetters state is fresh before Dashboard mounts.
  */
  async function saveCoverLetterAndContinue() {
    const saved = await persistMemory();
    if (!saved) {
      return;
    }
    toast.success("Cover Letter saved.");
    await refresh();
    router.replace("/dashboard");
  }

  function renderResumePreview() {
    return (
      <div
  className={`mt-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${getThemeClass()}`}
  style={{
  fontFamily: memoryData.font,
  zoom:
    memoryData.textSize === "Small"
      ? 0.9
      : memoryData.textSize === "Large"
      ? 1.1
      : 1,
}}
>
        <div className="border-b pb-4">
          <h3 className="text-2xl font-extrabold">{memoryData.firstName || "First"} {memoryData.lastName || "Last"}</h3>
          <p className="mt-1 text-sm text-gray-600">{memoryData.email || "email@example.com"} · {memoryData.phone || "Phone"} · {memoryData.location || "Location"}</p>
          {memoryData.headline.trim() && (
         <p className="mt-2 font-bold">
          {memoryData.headline}
        </p>
  )}
        </div>
       <div className="mt-5 space-y-5">
          <div><h4 className="font-extrabold">Summary</h4><p className="mt-2 text-sm leading-6 text-gray-600">{memoryData.summary || "Your professional summary will appear here."}</p></div>
          <div><h4 className="font-extrabold">Skills</h4><p className="mt-2 text-sm leading-6 text-gray-600">{memoryData.skills || "Excel, Communication, Customer Service, Organization"}</p></div>
          <div><h4 className="font-extrabold">Experience</h4><p className="mt-2 text-sm font-bold">{memoryData.workExperience[0]?.jobTitle || memoryData.volunteerExperience[0]?.role || "Job / Volunteer Title"}</p><p className="text-sm text-gray-600">{memoryData.workExperience[0]?.company || memoryData.volunteerExperience[0]?.organization || "Company / Organization"}</p><p className="mt-1 text-sm text-gray-600">{memoryData.workExperience[0]?.description || memoryData.volunteerExperience[0]?.description || "Experience bullets will appear here."}</p></div>
          <div><h4 className="font-extrabold">Education</h4><p className="mt-2 text-sm font-bold">{memoryData.education[0]?.program || "Program / Degree"}</p><p className="text-sm text-gray-600">{memoryData.education[0]?.school || "School Name"}</p></div>
        </div>
      </div>
    );
  }

  function renderUploadedOriginalPreview() {
    if (!uploadedResumeUrl && !memoryData.uploadedResumeText) {
      return <div className="flex min-h-[900px] items-center justify-center rounded-2xl bg-white text-center text-sm font-semibold text-slate-500">Upload a resume to preview the original file.</div>;
    }
    if (uploadedResumeKind === "pdf" && uploadedResumeUrl) {
      return <iframe src={`${uploadedResumeUrl}#toolbar=1&navpanes=0&view=FitH`} title="Uploaded resume preview" className="h-[900px] w-full rounded-2xl border border-slate-200 bg-white" />;
    }
    if (uploadedResumeKind === "txt") {
      return <pre className="min-h-[900px] whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-10 text-sm leading-7 text-slate-800 shadow-xl">{memoryData.uploadedResumeText || "TXT resume preview is empty."}</pre>;
    }
    if (uploadedResumeKind === "docx") {
      return (
        <div className="flex min-h-[900px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xl">
          <div><p className="text-5xl">📄</p><h3 className="mt-5 text-2xl font-black text-slate-950">DOCX uploaded</h3><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Browser preview for DOCX is not available in this page yet. Convert DOCX to PDF on the backend or extract its text before showing the full resume.</p><p className="mt-4 text-sm font-bold text-blue-600">{memoryData.uploadedResumeName}</p></div>
        </div>
      );
    }
    return <div className="flex min-h-[900px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xl"><div><p className="text-5xl">⚠️</p><h3 className="mt-5 text-2xl font-black text-slate-950">Preview not available</h3><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Please upload a PDF, DOCX, or TXT resume.</p></div></div>;
  }

  /*
    이력서의 renderUploadedOriginalPreview()와 동일한 패턴/동작을 그대로
    이식한 커버레터 버전 - PDF/TXT는 방금 업로드한 파일의 로컬 blob URL로
    실제 렌더링하고, DOCX는 이력서와 똑같이 "미리보기 준비 중" 플레이스홀더를
    보여준다(이력서도 이 단계에서는 DOCX 원본을 렌더링하지 않으므로, 여기서
    더 잘 보여주면 오히려 이력서 동작을 "초과"하게 된다).
  */
  function renderUploadedCoverLetterOriginalPreview() {
    if (!uploadedCoverLetterUrl && !memoryData.uploadedCoverLetterText) {
      return <div className="flex min-h-[900px] items-center justify-center rounded-2xl bg-white text-center text-sm font-semibold text-slate-500">Upload a cover letter to preview the original file.</div>;
    }
    if (uploadedCoverLetterKind === "pdf" && uploadedCoverLetterUrl) {
      return <iframe src={`${uploadedCoverLetterUrl}#toolbar=1&navpanes=0&view=FitH`} title="Uploaded cover letter preview" className="h-[900px] w-full rounded-2xl border border-slate-200 bg-white" />;
    }
    if (uploadedCoverLetterKind === "txt") {
      return <pre className="min-h-[900px] whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-10 text-sm leading-7 text-slate-800 shadow-xl">{memoryData.uploadedCoverLetterText || "TXT cover letter preview is empty."}</pre>;
    }
    if (uploadedCoverLetterKind === "docx" && uploadedCoverLetterUrl) {
      return (
        <UploadedCoverLetterDocxPreview
          fileUrl={uploadedCoverLetterUrl}
          fileName={memoryData.uploadedCoverLetterName}
        />
      );
    }
    return <div className="flex min-h-[900px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xl"><div><p className="text-5xl">⚠️</p><h3 className="mt-5 text-2xl font-black text-slate-950">Preview not available</h3><p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Please upload a PDF, DOCX, or TXT cover letter.</p></div></div>;
  }

  function renderBuiltCoverLetterPreview() {
  return (
    <div className="rounded-2xl bg-white p-10 shadow">

      <p>{memoryData.greeting}</p>

      <div className="mt-8 whitespace-pre-wrap">
        {memoryData.body}
      </div>

      <div className="mt-10">
        <p>{memoryData.closing}</p>

        <p className="mt-5 font-bold">
          {memoryData.signature}
        </p>
      </div>

    </div>
  );
}

  /*
    이력서의 renderFullResumePreview()가 resumeSource==="uploaded"일 때
    renderUploadedOriginalPreview()로 분기하는 것과 동일한 패턴 - 업로드한
    커버레터는 원본 파일 미리보기로, Career Memory 필드로 직접 작성한
    커버레터는 기존 필드 기반 미리보기(renderBuiltCoverLetterPreview)로
    그대로 유지한다.
  */
  function renderCoverLetterPreview() {
    if (memoryData.coverLetterSource === "uploaded") {
      return renderUploadedCoverLetterOriginalPreview();
    }

    return renderBuiltCoverLetterPreview();
  }

  function renderBuiltResumePreview() {
    return <CareerMemoryTemplatePreview data={memoryData} />;
  }

  function renderCanonicalResumePreview() {
    /*
      Static underlay while the live render is in flight - see
      largePreviewStatusBySrc above. src, key and request are unchanged.
    */
    const previewSrc = `/api/internal/canonical-career-memory/resume-preview?templateId=${canonicalPreviewTemplateId}&format=html${canonicalPreviewVersionId ? `&canonicalVersionId=${canonicalPreviewVersionId}` : ""}`;
    const previewStatus = largePreviewStatusBySrc[previewSrc];
    const placeholderAsset = templatePreviewAsset(canonicalPreviewTemplateId);
    return (
      <div className="max-h-[900px] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
        <div className="relative h-[820px] w-full overflow-hidden rounded-xl">
          {placeholderAsset && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={placeholderAsset} alt="Resume template preview" className="absolute inset-0 h-full w-full object-contain" />
          )}
          <iframe
            key={`${canonicalPreviewTemplateId}:${canonicalPreviewVersionId ?? ""}`}
            src={previewSrc}
            title="Canonical resume preview"
            onLoad={() => markLargePreview(previewSrc, "loaded")}
            onError={() => markLargePreview(previewSrc, "failed")}
            className={`relative h-[820px] w-full rounded-xl border border-slate-200 bg-white transition-opacity duration-300 ${previewStatus === "loaded" ? "opacity-100" : "opacity-0"}`}
          />
          {previewStatus === "failed" && (
            <span className="absolute bottom-2 left-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs font-semibold text-white">Preview unavailable</span>
          )}
        </div>
      </div>
    );
  }

  function renderTemplateSelectionRequiredNotice() {
    return (
      <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 p-10 text-center">
        <div>
          <p className="text-5xl">🎨</p>
          <h3 className="mt-5 text-2xl font-black text-slate-950">Choose a resume template first</h3>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">Your canonical profile is ready, but no default template has been selected yet. Continue to Dashboard to choose one.</p>
        </div>
      </div>
    );
  }

  /*
    Phase 6I.5 - extracted out of renderFullResumePreview() so the new
    side-by-side workspace's LEFT panel (renderInlineWorkspace()) and
    the later full-screen review step share the EXACT same preview
    logic instead of a second copy (spec section 6: "Do not duplicate
    rendering logic"). One behavior change from the pre-6I.5 version:
    "selection-required" now falls through to the uploaded original
    file preview when one exists, instead of a blocking notice - the
    side-by-side workspace's LEFT panel must show the real original
    resume before a template is chosen (spec sections 6/12), not a
    "choose a template" message sitting where the preview belongs. The
    notice is kept only for the one case with no original file to fall
    back to (a resume built from Career Memory fields directly).
  */
  function renderLiveResumePreviewContent() {
    const isUploadedResumePreview = memoryData.resumeSource === "uploaded" && (uploadedResumeUrl || memoryData.uploadedResumeText || uploadedResumeKind !== "none");
    if (canonicalPreviewStatus === "canonical") {
      return renderCanonicalResumePreview();
    }
    if (canonicalPreviewStatus === "selection-required" && !isUploadedResumePreview) {
      return renderTemplateSelectionRequiredNotice();
    }
    /*
      Template/Font/Style selection only applies to a resume built from
      Career Memory fields (renderBuiltResumePreview) - it has no effect
      on an uploaded resume's own preview (renderUploadedOriginalPreview
      always shows the original file/text as-is), so showing those
      controls next to an uploaded-resume review was misleading. The
      sidebar itself is skipped for that case rather than left empty.
      This whole legacy branch is unchanged for "legacy" (no canonical
      profile) and while canonicalPreviewStatus is still "loading".
    */
    if (isUploadedResumePreview) {
      return (
        <div className="max-h-[900px] min-w-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
          {renderUploadedOriginalPreview()}
        </div>
      );
    }
    return (
      <div className="grid gap-6 2xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-5 2xl:block 2xl:space-y-3">
          <p className="text-sm font-black text-slate-900 sm:col-span-5 2xl:col-span-1">Template</p>
          {resumeTemplates.map((template) => (
            <button key={template} onClick={() => updateMemory("resumeTemplate", template)} className={`w-full rounded-xl px-4 py-3 text-left text-sm font-bold ${memoryData.resumeTemplate === template ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-blue-50"}`}>{template}</button>
          ))}
          <div className="pt-3 text-xs font-semibold leading-5 text-slate-500 sm:col-span-5 2xl:col-span-1">Style: {memoryData.themeColor} · {memoryData.font} · {memoryData.textSize}</div>
        </aside>
        <div className="max-h-[900px] min-w-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
          {renderBuiltResumePreview()}
        </div>
      </div>
    );
  }

  function renderFullResumePreview() {
    return (
      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-black uppercase tracking-wide text-blue-600">Full Resume Preview</p><h2 className="mt-1 text-3xl font-black text-slate-950">Review your resume before saving</h2></div>
          <div className="flex gap-3"><button onClick={() => (mode === "import" ? setImportStage("parsed") : setCurrentStep(7))} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">Back</button><button onClick={() => { persistMemory(); continueToDashboard(); }} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Save & Continue</button></div>
        </div>
        {renderLiveResumePreviewContent()}
      </div>
    );
  }

  /*
    Phase 6I.6.8 - Manual ("build" mode) Step 9's own template review,
    deliberately separate from renderFullResumePreview()/
    renderLiveResumePreviewContent() above (those stay exactly as they
    were for the uploaded-resume flow's own final preview screen - see
    the manualTemplateStatus state's own header comment for why sharing
    canonicalPreviewStatus/canonicalPreviewTemplateId here would risk
    showing an unrelated resume). Exactly ONE canonical resume preview
    iframe renders at a time (only once a template is selected); no
    legacy CareerMemoryTemplatePreview/3-item list ever renders for a
    Manual resume that has real canonical content.
  */
  function renderManualTemplateReview() {
    /*
      Phase Step9-gate Part E/F - required sections incomplete. Must
      show ONLY the four static canonical template examples, never any
      user-data preview (current/uploaded/canonical/built-from-fields).
      Checked first, unconditionally, ahead of every other
      manualTemplateStatus branch below - so a stale status left over
      from an earlier complete visit can never leak a real preview
      here. No canonical import is triggered for this branch (the
      mount effect above already skips runManualCanonicalFlow() while
      canUseService() is false) - ALL_TEMPLATE_CAPABILITIES is pure
      static registry data, and no livePreviewUrl is passed to
      CanonicalTemplatePicker, so it falls back to each template's own
      previewAsset (the four approved static SVGs).
    */
    if (!canUseService()) {
      return (
        <div className="mt-6">
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">Choose a resume template</p>
          <h3 className="mt-1 text-xl font-black text-slate-950">Required</h3>
          <p className="mt-2 text-sm text-slate-600">Recommended: choose the template that best fits your experience and target roles. Complete Personal Information, Experience, and Skills above to preview your own resume in each design - for now, here are the four available templates.</p>
          <div className="mt-4">
            <CanonicalTemplatePicker
              templates={ALL_TEMPLATE_CAPABILITIES}
              selectedTemplateId={null}
              onSelect={() => {}}
              disabled
            />
          </div>
        </div>
      );
    }
    if (manualTemplateStatus === "not-applicable") {
      // Canonical templates are not enabled for this user (Stage 1
      // canary off) - fall back to the exact pre-existing legacy Step 9
      // preview content, unchanged.
      return <div className="mt-6">{renderLiveResumePreviewContent()}</div>;
    }
    if (manualTemplateStatus === "idle" || manualTemplateStatus === "importing") {
      return (
        <div className="mt-6 flex min-h-[300px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-sm font-semibold text-slate-500">Preparing your resume for template selection…</p>
        </div>
      );
    }
    if (manualTemplateStatus === "import-error") {
      return (
        <div className="mt-6 flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-10 text-center">
          <p className="text-sm font-semibold text-red-700">{manualTemplateError || "Could not prepare your resume for canonical templates."}</p>
          <button onClick={() => runManualCanonicalFlow()} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white">Try again</button>
        </div>
      );
    }

    /*
      No allowPlaceholder here. This preview is only reachable once
      runManualCanonicalFlow() has succeeded, i.e. the resume being shown is
      the user's own completed Career Memory - and previewOnlyCompletion's
      placeholder pass fills every EMPTY section with a neutral stand-in
      entry, so a user who entered no education/projects/certifications was
      shown EDUCATION, PROJECTS and CERTIFICATIONS headings over content they
      never wrote. For a resume that already has real content the honest
      rendering is the real one: a section with no data stays absent.

      The flag itself is untouched and still serves the surface it was built
      for - the zero-data template browsing below uses genericSkeleton, and
      the uploaded-resume previews never passed it in the first place.
    */
    const manualLargePreviewSrc = `/api/internal/canonical-career-memory/resume-preview?templateId=${manualSelectedTemplateId}&format=html${manualCanonicalVersionId ? `&canonicalVersionId=${manualCanonicalVersionId}` : ""}`;
    const manualLargePreviewAsset = templatePreviewAsset(manualSelectedTemplateId);

    return (
      <div className="mt-6 flex flex-col gap-6">
        <div className="min-w-0">
          {manualSelectedTemplateId ? (
            <div className="max-h-[900px] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6">
              {/*
                Static underlay while the live render is in flight - see
                largePreviewStatusBySrc above. Because the status is keyed by
                src, picking another template immediately shows THAT template's
                static asset and keeps the new iframe hidden until its own
                document loads. src, key and request are unchanged.
              */}
              <div className="relative h-[320px] w-full overflow-hidden rounded-xl sm:h-[820px]">
                {/*
                  Dropped once the live document has loaded, not merely covered
                  by it. The two layers do not line up: the underlay is a
                  fixed-ratio asset drawn with object-contain, so it is scaled
                  and CENTRED in this box, while the live page is a fixed-width
                  document sitting flush left. Their designs therefore land at
                  different x positions - measured 308-498px for the underlay
                  against 25-286px for the live render at this width - and any
                  moment the iframe is not fully opaque shows both, which reads
                  as a second detached accent rail beside the real one.

                  Keying on the same loaded status the iframe already uses means
                  a failed render still keeps its placeholder, which is the
                  whole reason the underlay exists.
                */}
                {manualLargePreviewAsset && largePreviewStatusBySrc[manualLargePreviewSrc] !== "loaded" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={manualLargePreviewAsset} alt="Resume template preview" className="absolute inset-0 h-full w-full object-contain" />
                )}
                <iframe
                  key={manualSelectedTemplateId}
                  src={manualLargePreviewSrc}
                  title="Canonical resume preview"
                  onLoad={() => markLargePreview(manualLargePreviewSrc, "loaded")}
                  onError={() => markLargePreview(manualLargePreviewSrc, "failed")}
                  className={`relative h-[320px] w-full rounded-xl border border-slate-200 bg-white transition-opacity duration-300 sm:h-[820px] ${largePreviewStatusBySrc[manualLargePreviewSrc] === "loaded" ? "opacity-100" : "opacity-0"}`}
                />
                {largePreviewStatusBySrc[manualLargePreviewSrc] === "failed" && (
                  <span className="absolute bottom-2 left-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs font-semibold text-white">Preview unavailable</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[500px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <p className="text-sm font-semibold text-slate-500">Select a template to preview your resume.</p>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">Choose a template</p>
          <h3 className="mt-1 text-xl font-black text-slate-950">Pick the design for your resume</h3>
          <p className="mt-2 text-sm text-slate-600">Required. Select one of the four resume designs below - this is the same template lineup used for uploaded resumes.</p>
          {manualTemplateError && <p className="mt-3 text-sm font-semibold text-red-600">{manualTemplateError}</p>}
          <div className="mt-4">
            <div className="mx-auto w-full max-w-[576px]">
              <CanonicalTemplatePicker
                templates={manualTemplates as any}
                selectedTemplateId={manualSelectedTemplateId as any}
                onSelect={(templateId) => selectManualTemplate(templateId)}
                disabled={manualTemplateStatus === "saving-template"}
                /* Same rule as the large preview above: these cards show the
                   user's own resume in each design, so they must not gain
                   sections the user never entered. */
                livePreviewUrl={(templateId) => `/api/internal/canonical-career-memory/resume-preview?templateId=${templateId}&format=html&variant=thumbnail${manualCanonicalVersionId ? `&canonicalVersionId=${manualCanonicalVersionId}` : ""}`}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /*
    Phase 6I.5 - the Career Memory side-by-side template workspace (spec
    Part B). Renders as soon as analysis finishes (importStage ===
    "parsed"), replacing the old flow where the picker and the full
    preview lived on two mutually-exclusive screens (see this phase's
    own investigation report for why that was the root cause of Problem
    B). LEFT = renderLiveResumePreviewContent() (original file before a
    template is chosen, canonical+template render immediately after -
    spec section 6), RIGHT = the existing inline CanonicalTemplatePicker,
    unchanged. Clicking a template calls the EXISTING selectInlineTemplate,
    which already PUTs template-preference and syncs canonicalPreviewStatus/
    canonicalPreviewTemplateId - no new API, no AI, no quota, no new
    Resume Version (spec section 6/11).
  */
  /*
    The editing workspace. Deliberately replaces the whole uploaded-success
    view rather than unfolding beneath it: eight sections of forms crammed
    under a resume preview is not a place anyone can work.

    renderStepForm() is the SAME function the typed flow renders, driven by
    the same currentStep it already reads, so every field, validation and
    add/remove control behaves identically in both modes. Nothing here is a
    second copy of those forms.
  */
  function renderUploadedEditWorkspace() {
    const contentSteps = steps.slice(0, 8);
    return (
      <div className="mt-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-blue-600">Edit Content</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Correct anything the import got wrong</h2>
            <p className="mt-2 text-sm text-slate-500">Your changes are not saved until you choose Save Changes.</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={cancelUploadedEdit} disabled={uploadedEditStatus === "saving"} className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-600 disabled:opacity-60">Back</button>
            <button type="button" onClick={saveUploadedEdit} disabled={uploadedEditStatus !== "ready"} className="rounded-xl bg-blue-600 px-6 py-3 font-black text-white disabled:opacity-60">
              {uploadedEditStatus === "saving" ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {uploadedEditError && <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{uploadedEditError}</p>}
        {uploadedEditStatus === "loading" && <p className="text-sm font-semibold text-slate-500">Loading your resume...</p>}

        {(uploadedEditStatus === "ready" || uploadedEditStatus === "saving") && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
            <div className="min-w-0 rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {contentSteps.map((step, index) => (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => { setUploadedEditStep(index); setCurrentStep(index); }}
                    className={`rounded-xl px-4 py-2 text-sm font-bold ${uploadedEditStep === index ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-blue-50"}`}
                  >
                    {index + 1}. {step.title}
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <h3 className="text-xl font-black text-slate-950">{contentSteps[uploadedEditStep]?.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{contentSteps[uploadedEditStep]?.description}</p>
                {renderStepForm()}
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-sm font-black uppercase tracking-wide text-blue-600">Live Preview</p>
              <p className="mt-1 text-sm text-slate-500">Showing your unsaved changes.</p>
              <div className="mt-3 max-h-[900px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4">
                {uploadedEditPreviewHtml ? (
                  <iframe srcDoc={uploadedEditPreviewHtml} title="Unsaved resume preview" className="h-[760px] w-full rounded-xl border border-slate-200 bg-white" />
                ) : (
                  <div className="flex h-[760px] items-center justify-center text-sm font-semibold text-slate-500">Building preview...</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderInlineWorkspace() {
    if (uploadedEditOpen) return renderUploadedEditWorkspace();
    return (
      <>
        <div className="mt-8 flex flex-col gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-blue-600">Live Resume Preview</p>
                <p className="mt-1 text-sm text-slate-500">{inlineSelectedTemplateId ? "Selected template applied immediately." : "Your original resume, until you choose a design."}</p>
              </div>
              {/* Optional. An upload that needs no correction never has to
                  come through here. */}
              <button type="button" onClick={openUploadedEdit} className="rounded-xl border border-blue-600 px-5 py-2.5 font-bold text-blue-600">Edit Content</button>
            </div>
            <div className="mt-3 max-h-[360px] overflow-auto sm:max-h-none sm:overflow-visible">{renderLiveResumePreviewContent()}</div>
          </div>

          <div className="min-w-0 rounded-2xl border border-blue-100 bg-white p-6">
            <p className="text-sm font-black uppercase tracking-wide text-blue-600">Choose your design</p>
            <p className="mt-1 text-sm text-slate-500">Select exactly one template. This becomes your default design everywhere until you change it.</p>

            {(inlineTemplateStatus === "checking" || inlineTemplateStatus === "importing") && (
              <p className="mt-4 text-sm font-semibold text-slate-500">Preparing your resume for canonical templates...</p>
            )}

            {inlineTemplateStatus === "import-error" && (
              <p className="mt-4 text-sm font-semibold text-red-600">{inlineTemplateError}</p>
            )}

            {inlineTemplateStatus === "not-applicable" && (
              <p className="mt-4 text-sm text-slate-500">Canonical templates aren&apos;t available right now. You can still continue.</p>
            )}

            {(inlineTemplateStatus === "selecting" || inlineTemplateStatus === "saving" || inlineTemplateStatus === "ready") && (
              <div className="mt-4">
                {inlineTemplateError && <p className="mb-3 text-sm font-semibold text-red-600">{inlineTemplateError}</p>}
                <div className="mx-auto w-full max-w-[576px]">
                  <CanonicalTemplatePicker
                    templates={inlineTemplates as any}
                    selectedTemplateId={inlineSelectedTemplateId as any}
                    onSelect={(templateId) => selectInlineTemplate(templateId)}
                    disabled={inlineTemplateStatus === "saving"}
                    livePreviewUrl={(templateId) => `/api/internal/canonical-career-memory/resume-preview?templateId=${templateId}&format=html&variant=thumbnail&genericSkeleton=1`}
                  />
                </div>
                {inlineSelectedTemplateId ? (
                  <p className="mt-4 text-sm font-bold text-slate-900">
                    Applied template: <span className="text-blue-600">{inlineTemplates.find((t) => t.id === inlineSelectedTemplateId)?.name ?? inlineSelectedTemplateId}</span>
                  </p>
                ) : (
                  <p className="mt-4 text-sm font-semibold text-slate-500">Choose a template to continue.</p>
                )}
                {inlineSelectedTemplateId && !inlineTemplateExplicitlySelected && (
                  <p className="mt-1 text-xs text-slate-500">Click a template above to confirm it for this resume and continue.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {importMessage && (
          <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
            {importMessage}
          </p>
        )}

        {resumeUploadError && (
          <div role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-5 py-4">
            <p className="font-black text-red-700">Resume upload failed</p>
            <p className="mt-1 text-sm leading-6 text-red-600">{resumeUploadError}</p>
            <button type="button" onClick={() => setResumeUploadError("")} className="mt-3 text-sm font-bold text-red-700 underline">Dismiss</button>
          </div>
        )}

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={continueToImportPreview}
            disabled={importStage !== "parsed" || inlineTemplateBlocksContinue}
            className={`rounded-xl border px-6 py-3 font-bold ${
              importStage === "parsed" && !inlineTemplateBlocksContinue
                ? "border-blue-600 text-blue-600"
                : "cursor-not-allowed border-slate-200 text-slate-400"
            }`}
          >
            Continue to Preview →
          </button>

          <button
            type="button"
            onClick={saveImportedResumeAndContinue}
            disabled={inlineTemplateBlocksContinue}
            className={`rounded-xl px-6 py-3 font-bold text-white ${inlineTemplateBlocksContinue ? "cursor-not-allowed bg-slate-300" : "bg-blue-600"}`}
          >
            Save and Continue to Dashboard
          </button>
        </div>
      </>
    );
  }

  function renderRequiredBanner() {
  const unlocked = canUseService();
  /*
    Phase Step9-gate Part C/K - this banner's button is the global
    Continue-to-Dashboard call to action (rendered above every step,
    not only Step 9). Once required sections are complete, add the
    Manual Step 9 explicit-template-selection requirement as a second
    gate - only relevant while actually on that review screen.
  */
  const templateSelectionPending = isReviewStep && manualTemplateBlocksContinue;
  const dashboardDisabled = !unlocked || templateSelectionPending;

  return (
    <Card padding="sm" className="mb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-blue-600">
            Career Memory Unlock
          </p>

          <h2 className="mt-1 text-xl font-black text-slate-950">
            Required sections: {requiredCount}/3
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Complete Personal Information, Experience, and Skills to unlock
            Dashboard and application features.
          </p>
        </div>

        <button
          type="button"
         onClick={continueToDashboard}
          disabled={dashboardDisabled}
          className={`rounded-xl px-5 py-3 font-bold transition ${
            !dashboardDisabled
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-slate-100 text-slate-400"
          }`}
        >
          {!unlocked
            ? `Complete Required Sections (${requiredCount}/3)`
            : templateSelectionPending
            ? "Select a Template to Continue"
            : "Continue to Dashboard →"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <RequiredStatus
          done={hasPersonalInfo()}
          title="Personal Information"
        />

        <RequiredStatus
          done={hasExperience()}
          title="Experience"
        />

        <RequiredStatus
          done={hasSkills()}
          title="Skills"
        />
      </div>
    </Card>
  );
}

  function renderStepForm() {
    if (currentStep === 0) return (
      <div className="mt-6 grid gap-3 sm:gap-5 md:grid-cols-2"><Input placeholder="First Name" value={memoryData.firstName} onChange={(v) => updateMemory("firstName", v)} /><Input placeholder="Last Name" value={memoryData.lastName} onChange={(v) => updateMemory("lastName", v)} /><Input placeholder="Email" value={memoryData.email} onChange={(v) => updateMemory("email", v)} /><Input placeholder="Phone" value={memoryData.phone} onChange={(v) => updateMemory("phone", v)} /><Input placeholder="Location" value={memoryData.location} onChange={(v) => updateMemory("location", v)} /><Input placeholder="LinkedIn (optional)" value={memoryData.linkedin} onChange={(v) => updateMemory("linkedin", v)} /><Textarea rows={5} placeholder="Career Summary" value={memoryData.summary} onChange={(v) => updateMemory("summary", v)} className="md:col-span-2" /></div>
    );
    if  (currentStep === 3) {
  return (
    <ArraySection
      title="Education"
      items={memoryData.education}
      section="education"
      emptyItem={emptyEducation}
      addLabel="+ Add Education"
      removeItem={removeItem}
      addItem={addItem}
      render={(item, index) => (
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            placeholder="School Name"
            value={item.school}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "school",
                value
              )
            }
          />

          <Input
            placeholder="Program / Degree"
            value={item.program}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "program",
                value
              )
            }
          />

          <MonthInput
            label="Start Date"
            value={item.startDate || ""}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "startDate",
                value
              )
            }
          />

          <MonthInput
            label="End Date"
            value={item.endDate || ""}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "endDate",
                value
              )
            }
          />

          <Input
            placeholder="GPA / Honours (Optional)"
            value={item.gpa}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "gpa",
                value
              )
            }
            className="md:col-span-2"
          />

          <Textarea
            rows={4}
            placeholder="Relevant coursework, awards, academic achievements..."
            value={item.coursework}
            onChange={(value) =>
              updateArrayItem<EducationItem>(
                "education",
                index,
                "coursework",
                value
              )
            }
            className="md:col-span-2"
          />
        </div>
      )}
    />
  );
}
   if (currentStep === 2) {
  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
        <h3 className="font-black text-slate-950">
          Experience
        </h3>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Add work, volunteer, internship, co-op, or other relevant
          experience.
        </p>
      </div>

      <ArraySection
        title="Work Experience"
        items={memoryData.workExperience}
        section="workExperience"
        emptyItem={emptyWork}
        addLabel="+ Add Work Experience"
        removeItem={removeItem}
        addItem={addItem}
        render={(item, index) => (
          <div className="grid gap-5 md:grid-cols-2">
            <Input
              placeholder="Company Name"
              value={item.company}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "company",
                  value
                )
              }
            />

            <Input
              placeholder="Job Title"
              value={item.jobTitle}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "jobTitle",
                  value
                )
              }
            />

            <Input
              placeholder="Location (Optional)"
              value={item.location || ""}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "location",
                  value
                )
              }
              className="md:col-span-2"
            />

            <MonthInput
              label="Start Date"
              value={item.startDate || ""}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "startDate",
                  value
                )
              }
            />

            <MonthInput
              label="End Date"
              value={item.endDate || ""}
              disabled={item.isCurrent}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "endDate",
                  value
                )
              }
            />

            <div className="md:col-span-2">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Are you currently working here?
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "isCurrent",
                      true
                    );

                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "endDate",
                      ""
                    );
                  }}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  Yes, currently working
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateArrayItem<WorkItem>(
                      "workExperience",
                      index,
                      "isCurrent",
                      false
                    )
                  }
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    !item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  No, previously worked
                </button>
              </div>
            </div>

            <Textarea
              rows={5}
              placeholder="Responsibilities, achievements, tools used, numbers/results..."
              value={item.description}
              onChange={(value) =>
                updateArrayItem<WorkItem>(
                  "workExperience",
                  index,
                  "description",
                  value
                )
              }
              className="md:col-span-2"
            />
          </div>
        )}
      />

      <ArraySection
        title="Volunteer / Internship / Other Experience"
        items={memoryData.volunteerExperience}
        section="volunteerExperience"
        emptyItem={emptyVolunteer}
        addLabel="+ Add Volunteer / Other Experience"
        removeItem={removeItem}
        addItem={addItem}
        render={(item, index) => (
          <div className="grid gap-5 md:grid-cols-2">
            <Input
              placeholder="Organization / Program Name"
              value={item.organization}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "organization",
                  value
                )
              }
            />

            <Input
              placeholder="Role / Experience Type"
              value={item.role}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "role",
                  value
                )
              }
            />

            <Input
              placeholder="Location (Optional)"
              value={item.location || ""}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "location",
                  value
                )
              }
              className="md:col-span-2"
            />

            <MonthInput
              label="Start Date"
              value={item.startDate || ""}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "startDate",
                  value
                )
              }
            />

            <MonthInput
              label="End Date"
              value={item.endDate || ""}
              disabled={item.isCurrent}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "endDate",
                  value
                )
              }
            />

            <div className="md:col-span-2">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Are you currently volunteering or participating here?
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "isCurrent",
                      true
                    );

                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "endDate",
                      ""
                    );
                  }}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  Yes, currently active
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateArrayItem<VolunteerItem>(
                      "volunteerExperience",
                      index,
                      "isCurrent",
                      false
                    )
                  }
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    !item.isCurrent
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  No, previously participated
                </button>
              </div>
            </div>

            <Textarea
              rows={5}
              placeholder="Duties, events, leadership, internship tasks, impact..."
              value={item.description}
              onChange={(value) =>
                updateArrayItem<VolunteerItem>(
                  "volunteerExperience",
                  index,
                  "description",
                  value
                )
              }
              className="md:col-span-2"
            />
          </div>
        )}
      />
    </div>
  );
}
    if (currentStep === 1) return <div className="mt-6"><Textarea rows={8} placeholder="Add skills separated by commas. Example: Excel, Outlook, Client Service, Legal Research, Data Entry..." value={memoryData.skills} onChange={(v) => updateMemory("skills", v)} className="w-full" /></div>;
   if (currentStep === 6) {
  return (
    <ArraySection
      title="Language"
      items={memoryData.languages}
      section="languages"
      emptyItem={emptyLanguage}
      addLabel="+ Add Language"
      removeItem={removeItem}
      addItem={addItem}
      render={(item, index) => (
        <div className="space-y-5">
          <Input
            placeholder="Language"
            value={item.language}
            onChange={(value) =>
              updateArrayItem<LanguageItem>(
                "languages",
                index,
                "language",
                value
              )
            }
          />

          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700">
              Proficiency Level
            </p>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {languageLevels.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() =>
                    updateArrayItem<LanguageItem>(
                      "languages",
                      index,
                      "level",
                      level
                    )
                  }
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    item.level === level
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    />
  );
}
    if (currentStep === 4) return <ArraySection title="Certification" items={memoryData.certifications} section="certifications" emptyItem={emptyCertification} addLabel="+ Add Certification" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Certification / Award Name" value={item.name} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "name", v)} /><Input placeholder="Issuer / Organization" value={item.issuer} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "issuer", v)} /><Input placeholder="Date" value={item.date} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "date", v)} className="md:col-span-2" /><Textarea rows={4} placeholder="Description or details..." value={item.description} onChange={(v) => updateArrayItem<CertificationItem>("certifications", index, "description", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 5) return <ArraySection title="Project" items={memoryData.projects} section="projects" emptyItem={emptyProject} addLabel="+ Add Project" removeItem={removeItem} addItem={addItem} render={(item, index) => <div className="grid gap-5 md:grid-cols-2"><Input placeholder="Project Name" value={item.name} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "name", v)} /><Input placeholder="Role / Your Contribution" value={item.role} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "role", v)} /><Input placeholder="Dates" value={item.dates} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "dates", v)} className="md:col-span-2" /><Textarea rows={5} placeholder="Describe the project, tools used, result, and impact..." value={item.description} onChange={(v) => updateArrayItem<ProjectItem>("projects", index, "description", v)} className="md:col-span-2" /></div>} />;
    if (currentStep === 7) return <div className="mt-6 grid gap-5 md:grid-cols-2"><Input placeholder="Target Roles" value={memoryData.targetRoles} onChange={(v) => updateMemory("targetRoles", v)} /><Input placeholder="Target Industry" value={memoryData.targetIndustry} onChange={(v) => updateMemory("targetIndustry", v)} /><Input placeholder="Preferred Location" value={memoryData.targetLocation} onChange={(v) => updateMemory("targetLocation", v)} /><Input placeholder="Salary Expectation" value={memoryData.salaryExpectation} onChange={(v) => updateMemory("salaryExpectation", v)} /><Textarea rows={6} placeholder="Describe your short-term and long-term career goals..." value={memoryData.careerGoalSummary} onChange={(v) => updateMemory("careerGoalSummary", v)} className="md:col-span-2" /></div>;
    return <div><div className="mt-6 rounded-2xl bg-blue-50 p-5"><h3 className="font-extrabold">Career Memory Review</h3><p className="mt-2 text-sm text-slate-600">Source: {memoryData.resumeSource === "uploaded" ? "Uploaded Resume" : "Built From Scratch"}</p>{memoryData.uploadedResumeName && <p className="mt-1 text-sm font-bold text-blue-700">Uploaded: {memoryData.uploadedResumeName}</p>}<p className="mt-3 text-sm font-semibold text-slate-600">Required sections: {requiredCount}/3 · Overall strength: {memoryStrength()}%</p></div>{renderManualTemplateReview()}</div>;
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f6fbff] text-slate-900">
       {coverLetterPreview && (
  <div className="fixed inset-0 z-50 overflow-auto bg-white p-10">

    <button
      onClick={() => setCoverLetterPreview(false)}
      className="mb-6 rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600"
    >
      ← Back
    </button>

    <h1 className="mb-8 text-3xl font-black">
      Cover Letter Preview
    </h1>

    {renderCoverLetterPreview()}

  </div>
)}
      <MobileNav active="Career Memory" />

      <div className="flex flex-1 flex-col md:flex-row">
  <aside className="hidden border-r border-blue-100 bg-white px-5 py-6 md:block md:w-60">
  <div className="flex items-center justify-between">
    <a href="/dashboard">
      <Image
        src="/logo.png"
        alt="Career Élan"
        width={120}
        height={45}
      />
    </a>

    <span className="text-slate-400">‹</span>
  </div>

    <p className="mt-8 text-xs font-bold uppercase tracking-wider text-slate-400">
      Overview
    </p>

    <nav className="mt-4 space-y-2">
      {[
        "Dashboard",
        "Career Memory",
        "Find Jobs",
        "Generate Package",
        "Job Tracker",
        "Analytics",
        "Settings",
      ].map((item) => {
        const isLocked = false;

        const icon =
          item === "Dashboard"
            ? "🏠"
            : item === "Career Memory"
            ? "🧠"
            : item === "Find Jobs"
            ? "🔍"
            : item === "Generate Package"
            ? "📦"
            : item === "Job Tracker"
            ? "💼"
            : item === "Analytics"
            ? "📊"
            : "⚙️";

        return (
          <button
            key={item}
            type="button"
            onClick={() => handleProtectedNav(item)}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
  item === "Career Memory"
    ? "bg-blue-600 text-white"
    : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
}`}
          >
            <span>{icon}</span>

            <span className="flex-1">{item}</span>

           
          </button>
        );
      })}
    </nav>
  </aside>

        <section className="min-w-0 flex-1">
          <AppContent>
          {mode === "start" ? (
            <StartScreen
  strength={profileStrength}
  requiredCount={requiredCount}
  canUseService={canUseService()}
            onImport={() => setMode("import")}
            onImportCoverLetter={() => setMode("importCoverLetter")}
            isUnlocked={isUnlocked}
            onBuild={() => setMode("build")}
            onContinue={continueToDashboard}
          />
          ) : (
            <>
              <header className="mb-8 flex items-center justify-between">
  <div>
    <h1 className="text-3xl font-extrabold">
      Career Memory
    </h1>

    <p className="mt-1 text-sm text-slate-500">
      Your career database. AI uses this information to create
      company-specific application packages.
    </p>
  </div>

  {/*
    Hidden on the two upload-completion screens only. Each already ends in its
    own "Save and Continue to Dashboard" button that persists before
    navigating (continueToDashboard() and saveCoverLetterAndContinue(), both
    via persistMemory()), so a second save affordance in the header was a
    redundant, competing call to action. Every other mode - build, and either
    import flow before its result is ready - keeps this header button exactly
    as it was; saveMemory itself is untouched and still used here.
  */}
  {!(
    (mode === "import" && importStage === "parsed") ||
    (mode === "importCoverLetter" && coverLetterImportStage === "parsed")
  ) && (
    <Button
      variant="primary"
      onClick={saveMemory}
      disabled={mode === "import" && importStage === "parsed" && inlineTemplateBlocksContinue}
      title={mode === "import" && importStage === "parsed" && inlineTemplateBlocksContinue ? "Choose a template for your resume before saving." : undefined}
    >
      Save Memory
    </Button>
  )}
</header>

{renderRequiredBanner()}

{templateGateBlocking && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
      <p className="text-sm font-black uppercase tracking-wide text-blue-600">Choose your resume template</p>
      <h2 className="mt-1 text-xl font-black text-slate-950">One more step before Dashboard</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Pick one of the 4 Canonical Templates. This becomes your default design everywhere until you change it.
      </p>
      {templateGateError && <p className="mt-3 text-xs font-semibold text-red-600">{templateGateError}</p>}
      <div className="mt-4">
        <CanonicalTemplatePicker
          templates={templateGateTemplates as any}
          selectedTemplateId={null}
          onSelect={(templateId) => confirmTemplateGateAndContinue(templateId)}
          disabled={templateGateSaving}
          livePreviewUrl={(templateId) => `/api/internal/canonical-career-memory/resume-preview?templateId=${templateId}&format=html&variant=thumbnail`}
        />
      </div>
    </div>
  </div>
)}

{mode === "import" && (
  <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
    <button
      type="button"
      onClick={() => {
        setMode("start");
        setImportStage("idle");
      }}
      className="mb-6 font-bold text-blue-600"
    >
      ← Back
    </button>

    {importStage === "preview" ? (
      renderFullResumePreview()
    ) : importStage === "parsed" && !isResumeImportResultReady ? (
      /*
        DPE Phase2 loading-transition task - analysis finished
        (importStage is already "parsed") but the template picker has
        not resolved yet - keep the branded loading panel visible
        (with truthful "preparing" copy, never repeating the analyzing
        message) instead of revealing renderInlineWorkspace(), so the
        raw/original preview can never flash ahead of the template
        picker being ready.
      */
      <ParsingStatus
        stage="parsed"
        requiredCount={requiredCount}
        progress={uploadProgress}
        phase="preparing"
      />
    ) : importStage === "parsed" ? (
      renderInlineWorkspace()
    ) : (
      <>
        <h2 className="text-3xl font-extrabold">
          Import Resume
        </h2>

        <p className="mt-3 text-slate-500">
          Upload your existing resume. Career Élan will extract your
          information and build your Career Memory.
        </p>

       <input
  ref={fileInputRef}
  type="file"
  accept=".pdf,.docx"
  className="hidden"
  onChange={handleResumeUpload}
/>

       <div
  onDragOver={handleResumeDragOver}
  onDragEnter={handleResumeDragOver}
  onDragLeave={handleResumeDragLeave}
  onDrop={handleResumeDrop}
  className={`mt-8 rounded-2xl border-2 border-dashed p-16 text-center transition ${
    isResumeDragging
      ? "border-blue-600 bg-blue-100 shadow-lg"
      : "border-blue-200 bg-blue-50"
  }`}
>
  <div className="text-6xl">
    {isResumeDragging ? "⬇️" : "📄"}
  </div>

  <h3 className="mt-5 text-xl font-bold">
    {isResumeDragging
      ? "Drop your resume now"
      : "Drop your resume here"}
  </h3>

  <p className="mt-2 text-sm text-slate-500">
    PDF · Maximum 10MB
  </p>

  <button
    type="button"
    onClick={() => fileInputRef.current?.click()}
    className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
  >
    Browse Files
  </button>
</div>

        {importStage !== "idle" && (
          <ParsingStatus
            stage={importStage}
            requiredCount={requiredCount}
            progress={uploadProgress}
          />
        )}

        {importMessage && (
          <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
            {importMessage}
          </p>
        )}

         {resumeUploadError && (
  <div
    role="alert"
    className="mt-5 rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-center"
  >
    <p className="font-black text-red-700">
      Resume upload failed
    </p>

    <p className="mt-1 text-sm leading-6 text-red-600">
      {resumeUploadError}
    </p>

    <button
      type="button"
      onClick={() => setResumeUploadError("")}
      className="mt-3 text-sm font-bold text-red-700 underline"
    >
      Dismiss
    </button>
  </div>
)}
      </>
    )}
  </div>
)}

{mode === "importCoverLetter" && (
  <div className="rounded-2xl border border-blue-100 bg-white p-10 shadow-sm">
    <button
      type="button"
      onClick={() => {
        setMode("start");
        setCoverLetterImportStage("idle");
      }}
      className="mb-6 font-bold text-blue-600"
    >
      ← Back
    </button>

    <h2 className="text-3xl font-extrabold">
      Import Cover Letter
    </h2>

    <p className="mt-3 text-slate-500">
      Upload your existing cover letter. Career Élan will save it so
      you can reuse or tailor it for every job you apply to.
    </p>

    <input
      ref={coverLetterInputRef}
      type="file"
      accept=".pdf,.docx,.txt"
      className="hidden"
      onChange={handleCoverLetterUpload}
    />

    <div
      onDragOver={handleCoverLetterDragOver}
      onDragEnter={handleCoverLetterDragOver}
      onDragLeave={handleCoverLetterDragLeave}
      onDrop={handleCoverLetterDrop}
      className={`mt-8 rounded-2xl border-2 border-dashed p-16 text-center transition ${
        isCoverLetterDragging
          ? "border-purple-600 bg-purple-100 shadow-lg"
          : "border-purple-200 bg-purple-50"
      }`}
    >
      <div className="text-6xl">
        {isCoverLetterDragging ? "⬇️" : "✉️"}
      </div>

      <h3 className="mt-5 text-xl font-bold">
        {isCoverLetterDragging
          ? "Drop your cover letter now"
          : "Drop your cover letter here"}
      </h3>

      <p className="mt-2 text-sm text-slate-500">
        PDF, DOCX, or TXT · Maximum 10MB
      </p>

      <button
        type="button"
        onClick={() => coverLetterInputRef.current?.click()}
        className="mt-6 rounded-xl bg-purple-600 px-6 py-3 font-bold text-white"
      >
        Browse Files
      </button>
    </div>

    {coverLetterImportStage !== "idle" && (
      <ParsingStatus
        stage={coverLetterImportStage}
        requiredCount={requiredCount}
        progress={coverLetterUploadProgress}
        type="coverLetter"
      />
    )}

    {coverLetterImportMessage && (
      <p className="mt-5 rounded-xl bg-purple-50 px-4 py-3 text-sm font-bold text-purple-700">
        {coverLetterImportMessage}
      </p>
    )}

    {coverLetterUploadError && (
      <div
        role="alert"
        className="mt-5 rounded-xl border border-red-300 bg-red-50 px-5 py-4"
      >
        <p className="font-black text-red-700">
          Cover Letter upload failed
        </p>

        <p className="mt-1 text-sm leading-6 text-red-600">
          {coverLetterUploadError}
        </p>

        <button
          type="button"
          onClick={() => setCoverLetterUploadError("")}
          className="mt-3 text-sm font-bold text-red-700 underline"
        >
          Dismiss
        </button>
      </div>
    )}

    {coverLetterImportStage === "parsed" && (
      <div className="mt-8 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setCoverLetterPreview(true)}
          className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600"
        >
          Preview
        </button>

        <button
          type="button"
          onClick={saveCoverLetterAndContinue}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white"
        >
          Save and Continue to Dashboard
        </button>
      </div>
    )}
  </div>
)}

{mode === "build" && (
  <>
    <Card padding="md" className="mb-8">
      <button
        type="button"
        onClick={() => setMode("start")}
        className="mb-4 font-bold text-blue-600"
      >
        ← Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            Profile Progress
          </h2>

          <p className="text-sm text-slate-500">
            Step {currentStep + 1} of {steps.length} ·{" "}
            {steps[currentStep].title}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-bold text-green-700">
            Recommended {requiredCount}/3
          </span>

          <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
            {progress}% Complete
          </span>
        </div>
      </div>

      <div className="mt-5 h-3 rounded-full bg-slate-100">
        <div
          className="h-3 rounded-full bg-blue-600"
          style={{ width: `${progress}%` }}
        />
      </div>
    </Card>

    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 xl:col-span-3">
      <Card padding="sm">
        <h2 className="text-lg font-bold">
          Steps
        </h2>

        <div className="mt-5 space-y-2">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => setCurrentStep(index)}
              className={`w-full rounded-xl px-4 py-3 text-left transition ${
                index === currentStep
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-blue-50"
              }`}
            >
              <p className="flex items-center justify-between text-sm font-bold">
                <span>
                  {index + 1}. {step.title}
                </span>

                {step.required && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      index === currentStep
                        ? "bg-white/15 text-white"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    Recommended
                  </span>
                )}
              </p>

              <p
                className={`mt-1 text-xs leading-5 ${
                  index === currentStep
                    ? "text-blue-100"
                    : "text-slate-400"
                }`}
              >
                {step.description}
              </p>
            </button>
          ))}
        </div>
      </Card>
      </aside>

      <section
        className={`col-span-12 space-y-6 ${
          isReviewStep
            ? "xl:col-span-9"
            : "xl:col-span-6"
        }`}
      >
        <Card padding="sm" className="sm:p-6">
          <h2 className="text-xl font-bold">
            {steps[currentStep].title}
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {steps[currentStep].description}
          </p>

          {renderStepForm()}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={continueToDashboard}
              className="rounded-xl border border-blue-600 px-6 py-3 font-bold text-blue-600"
            >
              Continue to Dashboard
            </button>

            <button
              type="button"
              onClick={handleSaveAndContinue}
              disabled={manualSaveDisabled}
              title={manualSaveDisabled ? (!canUseService() ? "Complete the required sections above before finishing." : "Select a resume template above before finishing.") : undefined}
              className={`rounded-xl px-6 py-3 font-bold text-white ${manualSaveDisabled ? "cursor-not-allowed bg-slate-300" : "bg-blue-600"}`}
            >
              {currentStep === steps.length - 1
                ? "Finish Memory"
                : "Save & Continue →"}
            </button>
          </div>
        </Card>
      </section>

      {!isReviewStep && (
        <aside className="col-span-12 space-y-6 xl:col-span-3">
          <Card padding="sm">
            <h2 className="text-lg font-bold">
              Memory Strength
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              More complete information creates better AI results.
            </p>

            <div className="mt-5 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${strength}%` }}
              />
            </div>

            <p className="mt-3 text-sm font-bold text-blue-600">
              {strength}% Overall · Recommended {requiredCount}/3
            </p>
          </Card>

          <Card padding="sm">
            <h2 className="text-lg font-bold">
              Recommended Information
            </h2>

            <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
              <RequiredLine
                done={hasPersonalInfo()}
                text="Personal Information"
              />

              <RequiredLine
                done={hasExperience()}
                text="Experience"
              />

              <RequiredLine
                done={hasSkills()}
                text="Skills"
              />
            </div>
          </Card>

          <Card padding="sm">
            <h2 className="text-lg font-bold">
              Selected Style
            </h2>

            <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
              <p>📄 {memoryData.resumeTemplate}</p>
              <p>✉️ {memoryData.coverLetterTemplate}</p>
              <p>🎨 {memoryData.themeColor}</p>
              <p>🔤 {memoryData.font}</p>
              <p>🔎 {memoryData.textSize}</p>
            </div>
          </Card>

          <Card padding="sm">
            <h2 className="text-lg font-bold">
              This Memory Powers
            </h2>

            <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
              <p>📦 Application Packages</p>
              <p>📄 Resume Generation</p>
              <p>✉️ Cover Letter Generation</p>
              <p>🎯 Job URL Analysis</p>
            </div>
          </Card>
        </aside>
      )}
    </div>
  </>
)}

            </>
          )}
          </AppContent>
        </section>
      </div>
      <CareerElanFooter />
    </main>
  );
}

/*
  Cover letter DOCX preview. Browsers cannot render a .docx in an <iframe>
  the way they render a PDF, which is why this branch previously showed a
  "preview is not available in this page yet" card. docx-preview (already a
  dependency, already used the same way by components/resume/
  DocxResumePreview.tsx's Original View) renders the real file client-side,
  so nothing about the upload or the conversion changes: the source here is
  the object URL applyCoverLetterAnalysisResult() already created from the
  file the user just picked, so there is no second upload, no re-conversion,
  no mammoth call and no API request - a blob: fetch reads memory the page
  already holds.

  Deliberately NOT reusing DocxResumePreview itself: that component is bound
  to a persisted resume row (resume.id, resume.extracted_layout.html) and
  fetches /api/resumes/[id]/preview-url, none of which a just-uploaded cover
  letter has at this point in the flow. Reusing its docx-preview pattern
  locally is what keeps this a one-file UI change instead of a new endpoint.

  A render failure keeps the uploaded cover letter exactly as it is and falls
  back to the same informational card this branch showed before - it never
  clears the upload or touches any state.
*/
function UploadedCoverLetterDocxPreview({
  fileUrl,
  fileName,
}: {
  fileUrl: string;
  fileName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    if (!container || !fileUrl) return;

    container.innerHTML = "";
    setStatus("loading");

    (async () => {
      try {
        const fileRes = await fetch(fileUrl);

        if (!fileRes.ok) {
          throw new Error("DOWNLOAD_FAILED");
        }

        const blob = await fileRes.blob();

        // Dynamic import keeps docx-preview (a browser-only library) out of
        // any server-evaluated module graph, exactly as DocxResumePreview does.
        const docxPreview = await import("docx-preview");

        if (cancelled) return;

        await docxPreview.renderAsync(blob, container, undefined, {
          // Images as data URLs rather than blob object URLs, so there is
          // nothing left to revoke when this unmounts.
          useBase64URL: true,
        });

        if (cancelled) return;

        setStatus("success");
      } catch (error) {
        if (cancelled) return;

        // Never surface the raw error - fall back to the informational card.
        console.error("COVER LETTER DOCX PREVIEW RENDER ERROR =", error);
        container.innerHTML = "";
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  return (
    <div className="min-h-[900px] overflow-auto rounded-2xl border border-slate-200 bg-white p-10 shadow-xl">
      {status !== "success" && (
        <div className="flex min-h-[820px] items-center justify-center text-center">
          <div>
            <p className="text-5xl">📄</p>
            <h3 className="mt-5 text-2xl font-black text-slate-950">
              {status === "loading" ? "Preparing preview…" : "DOCX uploaded"}
            </h3>
            {status === "error" && (
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                This cover letter was uploaded successfully, but its preview could not be displayed here.
              </p>
            )}
            <p className="mt-4 text-sm font-bold text-blue-600">{fileName}</p>
          </div>
        </div>
      )}

      <div ref={containerRef} className="docx-preview text-sm leading-7" />
    </div>
  );
}

function StartScreen({
  strength,
  requiredCount,
  canUseService,
  isUnlocked,
  onImport,
  onImportCoverLetter,
  onBuild,
  onContinue,
}: {
  strength: number;
requiredCount: number;

canUseService: boolean;
  isUnlocked: boolean;
  onImport: () => void;
  onImportCoverLetter: () => void;
  onBuild: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-8 flex items-start justify-between gap-6"><div><h1 className="text-4xl font-black tracking-tight text-slate-950">Build Your Career Memory ✨</h1><p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">Complete the required sections first. Then Career Élan can create resumes, cover letters, and job application packages from your profile.</p></div><div className="hidden text-sm text-slate-500 lg:block">Need help?⌄</div></div>
      <div className="mb-6 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-black uppercase tracking-wide text-blue-600">CREATE RESUME</p><h2 className="mt-1 text-2xl font-black text-slate-950">Required sections: {requiredCount}/3</h2><p className="mt-2 text-sm leading-6 text-slate-500">Personal Information, Experience, and Skills are enough to start. Optional sections can be completed later.</p></div><button onClick={onContinue} className="rounded-xl bg-blue-600 px-6 py-4 font-black text-white">Continue  →</button></div></div>
      <div className="space-y-6">
  {/* Import Resume */}
  <button
    type="button"
    onClick={onImport}
    className="w-full rounded-3xl border-2 border-blue-600 bg-blue-600 p-8 text-left text-white shadow-lg shadow-blue-100 transition hover:-translate-y-1 hover:bg-blue-700 hover:shadow-xl"
  >
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-4xl">
          ☁️
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black">
                Import Your Resume ✨
            </h2>

            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">
              Upload up to {MAX_UPLOADED_RESUMES} resumes
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">
            Save time by uploading your existing resume. Career Élan instantly converts it into your complete Career Memory.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-white">
            <p>✓ Work Experience</p>
            <p>✓ Skills</p>
            <p>✓ Education</p>
            <p>✓ Projects</p>
            <p>✓ Certifications</p>
            <p>✓ Achievements</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl bg-white px-7 py-4 text-center font-black text-blue-600">
        Upload Resume
      </div>
    </div>
  </button>

  {/* Cover Letter - navigates to a dedicated upload page (mode
      "importCoverLetter"), exactly like Import Your Resume above, rather
      than opening the OS file picker directly. The whole card is a
      single <button> (no nested interactive elements), so there is
      structurally only one thing that can ever fire a navigation - never
      a double-trigger between an inner button and the card itself. */}
  <button
    type="button"
    onClick={onImportCoverLetter}
    className="w-full rounded-3xl border border-purple-400 bg-gradient-to-r from-purple-200 to-violet-200 p-6 text-left shadow-md transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2"
  >
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-purple-50 text-4xl">
          ✉️
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black">
              Cover Letter
            </h2>

            <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
              Optional
            </span>

            <span className="rounded-full bg-purple-600 px-3 py-1 text-xs font-bold text-white">
              Upload up to {MAX_COVER_LETTERS} cover letters
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Upload your existing cover letter, or let Career Élan create a tailored one for every job you apply to.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
            <p>✓ Use in Generate Package</p>
            <p>✨ Tailored automatically</p>
            <p>📝 Edit and reuse anytime</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border-2 border-purple-300 bg-purple-50 px-7 py-4 text-center font-black text-purple-700">
        Upload Cover Letter
      </div>
    </div>
  </button>

  {/* No Resume */}
  <button
    type="button"
    onClick={onBuild}
    className="w-full rounded-3xl border border-blue-100 bg-white p-8 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
  >
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-4xl">
          ✎
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black">
              Create Resume
            </h2>

            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">
              Create up to {MAX_CREATED_RESUMES} resume
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Create a professional resume in minutes. Career Élan generate personalized application packages instantly.
          </p>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
            <p>✓ Build step-by-step</p>
            <p>✓ Save and continue anytime</p>
            <p>✓ Complete optional sections later</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-blue-600 px-7 py-4 text-center font-black text-blue-600">
        Start Building
      </div>
    </div>
  </button>
</div>

      {/*
        Minimum-requirements info card - explains why Generate Package
        needs a Resume before it can be used, without changing any actual
        eligibility/gating logic (that lives elsewhere, e.g. canUseService()
        and the Generate Package flow itself). Deliberately styled like the
        neutral informational cards below (blue border, white background,
        checkmark icon) rather than the red/alarming style used for actual
        error states elsewhere on this page, since having zero resumes yet
        is the normal starting state, not a problem.
      */}
      <div className="mt-8 rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-3xl">
            ✅
          </div>

          <div>
            <h3 className="text-lg font-black text-slate-950">
              Ready to create tailored packages?
            </h3>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              To create tailored resumes, cover letters, and email drafts,
              add at least one resume by uploading an existing resume or
              creating one. Uploading a cover letter is optional—Career
              Élan can generate one automatically for each job.
            </p>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
              <p>✓ Resume required (upload or create)</p>
              <p>✉️ Cover Letter optional</p>
              <p>🚫 No resume yet = Generate Package unavailable</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-blue-100 bg-white p-6 shadow-sm"><h3 className="text-center text-lg font-black text-slate-950">What happens after this?</h3><div className="mt-6 grid gap-5 lg:grid-cols-4"><FlowStep number="1" icon="⇧" title="Add Required Info" body="Personal information, experience, and skills." /><FlowStep number="2" icon="🧠" title="Career Memory Learns You" body="AI organizes your career information." /><FlowStep number="3" icon="🔗" title="Find or Paste Any Job URL" body="Search jobs inside Career Élan or Paste any job URL you want to apply to" /><FlowStep number="4" icon="📄 ✉️" title="Get Your Tailored Package" body="Resume, cover letter, and email ready in seconds." /></div></div><div className="mt-6 grid gap-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm lg:grid-cols-4"><TrustItem icon="🛡️" title="Built for job seekers" body="in Canada" /><TrustItem icon="🔒" title="Your privacy" body="is our priority" /><TrustItem icon="👥" title="Join professionals" body="getting more interviews" /><TrustItem icon="☆" title="AI-Powered" body="Human-Focused. Results-Driven." /></div>
    </div>
  );
}

function ParsingStatus({
  stage,
  requiredCount,
  progress,
  type = "resume",
  phase,
}: {
  stage: ImportStage;
  requiredCount: number;
  progress: number;
  type?: "resume" | "coverLetter";
  /*
    DPE Phase2 loading-transition task - optional override of the
    stage-derived phase, used only by the resume-import bridging screen
    (importStage==="parsed" but the template picker has not resolved
    yet). Omitted by every other caller (Cover Letter import, and the
    resume flow's own pre-"parsed" render), which keeps their existing
    two-state (analyzing/done) behavior byte-for-byte unchanged.
    "preparing" keeps the spinner (work is still genuinely in flight)
    but swaps in truthful copy - analysis itself already succeeded, so
    repeating "analyzing your resume" would be a lie; the 6 milestone
    Steps below are already real analysis outcomes, so they show done.
  */
  phase?: "analyzing" | "preparing" | "done";
}) {
  const effectivePhase = phase ?? (stage === "parsing" ? "analyzing" : "done");
  const spinning = effectivePhase !== "done";
  const stepsDone = effectivePhase !== "analyzing";
  return (
    <div className="mt-6 rounded-3xl border border-blue-100 bg-white p-8 shadow-sm">

      <div className="flex flex-col items-center">

        {spinning ? (
          <div className="h-24 w-24 rounded-full border-[8px] border-blue-200 border-t-blue-600 animate-spin" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-5xl">
            ✓
          </div>
        )}

        <h2 className="mt-8 text-3xl font-extrabold text-slate-900">
          {effectivePhase === "analyzing"
  ? (type === "resume"
      ? "Career Élan is analyzing your resume"
      : "Career Élan is analyzing your cover letter")
  : effectivePhase === "preparing"
  ? "Preparing your resume templates"
  : (type === "resume"
      ? "Resume analyzed successfully"
      : "Cover Letter analyzed successfully")}
        </h2>
        <p className="mt-3 text-2xl font-bold text-blue-600">
           {progress}%
        </p>
        <p className="mt-3 text-center text-slate-500 max-w-xl">
          {effectivePhase === "analyzing"
  ? (type === "resume"
      ? "Extracting your experience, education, skills and building your Career Memory."
      : "Extracting your cover letter and identifying its sections.")
  : effectivePhase === "preparing"
  ? "Setting up your design options before showing your Career Memory."
  : (type === "resume"
      ? "Your Career Memory has been created successfully."
      : "Your cover letter has been imported successfully.")}
        </p>

        <div className="mt-10 w-full max-w-xl space-y-4">

          <Step
            done={stepsDone}
            title="Reading document"
          />

          <Step
            done={stepsDone}
            title="Extracting text"
          />

          <Step
            loading={!stepsDone}
            done={stepsDone}
            title="Understanding experience"
          />

          <Step
            done={stepsDone}
            title="Identifying skills"
          />

          <Step
            done={stepsDone}
            title="Parsing education"
          />

          <Step
            done={stepsDone}
            title="Building Career Memory"
          />

        </div>

      </div>
    </div>
  );
}
function RequiredStatus({ done, title }: { done: boolean; title: string }) { return <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${done ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{done ? "✓" : "○"} {title}</div>; }
function RequiredLine({ done, text }: { done: boolean; text: string }) { return <p className={done ? "text-green-700" : "text-slate-500"}>{done ? "✓" : "○"} {text}</p>; }
function FlowStep({ number, icon, title, body }: { number: string; icon: string; title: string; body: string }) { return <div className="relative rounded-2xl bg-white p-4"><div className="absolute -top-3 left-0 flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-xs font-black text-white">{number}</div><div className="flex gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-white text-3xl text-blue-600">{icon}</div><div className="min-w-0"><p className="font-black text-slate-950">{title}</p><p className="mt-2 text-xs leading-5 text-slate-500">{body}</p></div></div></div>; }
function TrustItem({ icon, title, body }: { icon: string; title: string; body: string }) { return <div className="flex items-center gap-4 border-slate-100 px-3 lg:border-r last:border-r-0"><div className="text-3xl text-blue-600">{icon}</div><div className="min-w-0"><p className="text-sm font-bold text-slate-700">{title}</p><p className="text-sm text-slate-500">{body}</p></div></div>; }
function Select({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: string[] }) { return <div><label className="text-sm font-bold text-slate-600">{label}<select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100">{items.map((item) => <option key={item}>{item}</option>)}</select></label></div>; }
function Input({ placeholder, value, onChange, className = "" }: { placeholder: string; value: string; onChange: (value: string) => void; className?: string }) { return <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${className}`} />; }
function Textarea({ placeholder, value, onChange, rows, className = "" }: { placeholder: string; value: string; onChange: (value: string) => void; rows: number; className?: string }) { return <textarea aria-label={placeholder} rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${className}`} />; }
function MonthInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </span>

      <input
        type="month"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  );
}
function ArraySection<T extends object>({ title, items, section, emptyItem, addLabel, removeItem, addItem, render }: { title: string; items: T[]; section: keyof CareerMemoryData; emptyItem: object; addLabel: string; removeItem: (section: keyof CareerMemoryData, index: number) => void; addItem: (section: keyof CareerMemoryData, emptyItem: object) => void; render: (item: T, index: number) => ReactNode }) { return <div className="mt-6 space-y-5">{items.map((item, index) => <div key={index} className="rounded-2xl border border-slate-100 bg-slate-50 p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{title} #{index + 1}</h3><button onClick={() => removeItem(section, index)} className="text-sm font-bold text-red-500">Remove</button></div>{render(item, index)}</div>)}<button onClick={() => addItem(section, emptyItem)} className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600">{addLabel}</button></div>; }
function Step({
  title,
  done,
  loading,
}: {
  title: string;
  done?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4">

      {done ? (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white">
          ✓
        </div>
      ) : loading ? (
        <div className="h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300">
          ○
        </div>
      )}

      <span className="font-semibold">{title}</span>

    </div>
  );
}
