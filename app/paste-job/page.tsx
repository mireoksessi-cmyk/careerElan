"use client";


import { exportDocx, exportPdf } from "@/lib/exportDocument";
import { exportPdfFromText } from "@/lib/brand/render/pdfDocumentExport";
import { exportDocxFromText } from "@/lib/brand/render/docxDocumentExport";
import { normalizeResumeTemplateId } from "@/lib/brand/render/templateId";
import A4DocumentPreview from "@/lib/brand/render/A4DocumentPreview";

import { useLogin } from "@/lib/auth/LoginManager";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import A4Preview from "../job-tracker/A4Preview";
import ResumePreviewRenderer from "@/components/resume/ResumePreviewRenderer";
import CoverLetterPreviewRenderer from "@/components/coverLetter/CoverLetterPreviewRenderer";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ActiveGeneration,
  clearActiveGeneration,
  createPoller,
  isGenerationActive,
  parseGenerateResponse,
  parseStatusResponse,
  readActiveGeneration,
  writeActiveGeneration,
  type GenerationPhase,
  type JobContext,
  type PollerHandle,
} from "@/lib/generatePackage/pollingClient";

/*
  Stale background-worker recovery thresholds (app/api/generate-package/
  route.ts is the server-side counterpart). Mirrors that route's own
  WORKER_STALE_THRESHOLD_MS (300s) plus a 10s buffer so this client-side
  trigger never fires before the server would actually honor a reclaim -
  an earlier trigger would just spend a request on a guaranteed 409 with
  nothing to show for it. GIVE_UP_GRACE_MS mirrors the server's own
  GIVE_UP_THRESHOLD_MS margin (90s past the retry) for the same reason:
  generation_worker_claimed_at becoming non-null only requires the worker
  to have *started* (its very first action), not finished, so 90s without
  it happening is a safe, well-justified "this didn't start" signal, not
  just "OpenAI is still thinking." GIVE_UP_GRACE_MS_AFTER_NETWORK_ERROR is
  shorter because a network failure on the retry itself is a distinct,
  already-uncertain condition - there is no successful re-enqueue to wait
  out here.
*/
const AUTO_RETRY_ELAPSED_THRESHOLD_SECONDS = 310;
const GIVE_UP_GRACE_MS = 90_000;
const GIVE_UP_GRACE_MS_AFTER_NETWORK_ERROR = 30_000;

type PasteMode = "url" | "description" | "file";

type PreviewType = "resume" | "coverLetter" | "emailDraft";
type SavedApplicationMaterial = {
  resume: {
    sourceType:
      | "career_memory"
      | "uploaded";
    id: string | null;
    name: string;
    text: string;
    resumeRow?: any;
    resumeTemplateId?: string | null;
  };

  coverLetter: {
    sourceType:
      | "upload"
      | "automatic";
    id: string | null;
    name: string;
    text: string;
    coverLetterRow?: any;
  };
};

/*
  "loading" until /api/resumes/selected resolves; "error" means the
  authoritative resolver could not resolve a valid selection (no
  selection made, unknown source, a deleted/foreign resume id, etc) -
  never silently substituted with a different resume, per Phase 2.
*/
type ResumeSelectionStatus = "loading" | "ready" | "error";

type SavedPreviewType =
  | "resume"
  | "coverLetter"
  | null;
type JobDetails = {
  description: string;
  responsibilities: string[];
  qualifications: string[];
  benefits: string[];
  salary: string;
  schedule: string;
  applyUrl: string;
};

type JobAnalysis = {
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  icon: string;
  match: string;
  keywordCount: number;
  requirementsMatched: number;
  keywords: string[];
  summary: string;
  jobDetails: JobDetails;
  jobContext: {
  country:
    | "Canada"
    | "Unknown";

  sector:
    | "private"
    | "provincial"
    | "municipal"
    | "federal"
    | "unknown";

  province: string;
  municipality: string;

  supportedByCareerElan: boolean;
  classificationReason: string;
};

requirements: {
  requirement: string;

  category:
    | "mandatory"
    | "preferred"
    | "legal_or_regulated";
}[];
};

type PackageAnalysis = {
  overallMatch: number;

  matchLevel:
    | "strong"
    | "moderate"
    | "low"
    | "critical_mismatch";

  keyChanges: {
    section: string;
    original: string;
    revised: string;
    reason: string;
  }[];

  mismatch: {
    summary: string;
    missingRequirements: string[];
    unsupportedClaims: string[];
  };

  matches: {
    strongMatches: string[];
    transferableSkills: string[];
  };

  recommendation: {
    summary: string;

    applyRecommendation:
      | "recommended"
      | "consider"
      | "not_recommended";

    nextSteps: string[];
  };

  verification: {
    jobContext: {
      country:
        | "Canada"
        | "Unknown";

      sector:
        | "private"
        | "provincial"
        | "municipal"
        | "federal"
        | "unknown";

      province: string;
      municipality: string;

      supportedByCareerElan: boolean;
      classificationReason: string;
    };

    requirements: {
      requirement: string;

      category:
        | "mandatory"
        | "preferred"
        | "legal_or_regulated";

      evidenceStatus:
        | "supported"
        | "partially_supported"
        | "not_supported";

      sourceEvidence: string;

      source:
        | "primary_resume"
        | "career_memory"
        | "none";

      regulated: boolean;
    }[];

    documentClaims: {
      document:
        | "resume"
        | "cover_letter"
        | "email";

      claim: string;

      category:
        | "experience"
        | "achievement"
        | "education"
        | "certification"
        | "licence"
        | "language"
        | "project"
        | "career_goal"
        | "work_authorization"
        | "citizenship"
        | "security_clearance"
        | "software"
        | "other";

      sourceEvidence: string;

      source:
        | "primary_resume"
        | "career_memory";
    }[];

    regulatedRole: {
      isRegulated: boolean;
      profession: string;
      jurisdiction: string;
      requiredLicence: string;
      licenceEvidence: string;

      licenceStatus:
        | "verified"
        | "missing"
        | "not_required"
        | "unclear";
    };

    bilingualRequirement: {
      level:
        | "mandatory"
        | "preferred"
        | "not_required"
        | "unclear";

      languages: string[];
      evidence: string;

      status:
        | "verified"
        | "partially_verified"
        | "missing"
        | "not_required";
    };
  };
};

type GeneratedPackage = {
  resume: string;
  coverLetter: string;
  emailDraft: string;
  packageAnalysis: PackageAnalysis | null;
};

/*
  GenerationPhase itself lives in lib/generatePackage/pollingClient.ts
  (imported above) so its duplicate-submit predicate, isGenerationActive(),
  can be unit-tested against the exact same type the component uses.
  Phase transitions: idle -> submitting (POST in flight) -> pending (202,
  polling /api/applications/[id]/status) -> succeeded | failed |
  poll_timeout. "poll_timeout" means only the browser gave up waiting -
  the backend job may still complete; it never implies "failed" (that
  only ever comes from the status endpoint itself reporting
  generation_status = 'failed').
*/
type GenerationErrorInfo = {
  code?: string;
  message: string;
};

/*
  Presentational labels only, one per real worker-reported stage
  (lib/generatePackage/shared.ts's GENERATION_STAGE_PROGRESS is the actual
  stage -> percentage source of truth; this map never invents a stage or a
  percentage of its own). Falls back to "queued" wording for a stage value
  the client doesn't recognize (e.g. an older/newer stage this build
  hasn't been updated for) rather than showing nothing.
*/
const STAGE_LABELS: Record<string, string> = {
  queued: "Your request has been received.",
  claimed: "The generation server has started your request.",
  loading_inputs: "Loading your resume and application details.",
  building_prompt: "Preparing your tailored writing plan.",
  generating: "AI is writing your resume and cover letter.",
  validating: "Validating the generated documents.",
  saving: "Saving your results.",
};

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Career Memory", href: "/career-memory", icon: "🧠" },
  { label: "Create Package", href: "/create-package", icon: "📦" },
  { label: "Find Jobs", href: "/find-jobs", icon: "🔍" },
  { label: "Paste Job", href: "/paste-job", icon: "📋" },
  { label: "Job Tracker", href: "/job-tracker", icon: "💼" },
  { label: "Analytics", href: "/analytics", icon: "📊" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

const emptyAnalysis: JobAnalysis = {
  title: "Job Posting",
  company: "Detected Company",
  location: "Canada",
  type: "Full-time",
  category: "General",
  icon: "💼",
  match: "--",
  keywordCount: 0,
  requirementsMatched: 0,
  keywords: [],
  summary:
    "Analyze a job posting to see the detected role, keywords, and match details.",

  jobDetails: {
    description: "",
    responsibilities: [],
    qualifications: [],
    benefits: [],
    salary: "",
    schedule: "",
    applyUrl: "",
  },

  jobContext: {
    country: "Unknown",
    sector: "unknown",
    province: "",
    municipality: "",
    supportedByCareerElan: false,
    classificationReason:
      "The job posting has not been analyzed yet.",
  },

  requirements: [],
};

function buildCareerMemoryResumeText(
  memory: any
): string {
  if (!memory) return "";

  const lines: string[] = [];

  function clean(value: unknown): string {
    return typeof value === "string"
      ? value.trim()
      : "";
  }

  function formatMonth(value?: string): string {
    if (!value) return "";

    const [year, month] = value.split("-");

    if (!year || !month) {
      return value;
    }

    return new Date(
      Number(year),
      Number(month) - 1,
      1
    ).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
    });
  }

  function formatExperienceDates(
    item: any
  ): string {
    const startDate =
      item.startDate ||
      item.start_date ||
      "";

    const endDate =
      item.endDate ||
      item.end_date ||
      "";

    const isCurrent =
      item.isCurrent ??
      item.is_current ??
      false;

    const start = formatMonth(startDate);

    const end = isCurrent
      ? "Present"
      : formatMonth(endDate);

    return [start, end]
      .filter(Boolean)
      .join(" – ");
  }

  function formatEducationDates(
    item: any
  ): string {
    return [
      formatMonth(
        item.startDate ||
          item.start_date ||
          ""
      ),
      formatMonth(
        item.endDate ||
          item.end_date ||
          ""
      ),
    ]
      .filter(Boolean)
      .join(" – ");
  }

  function addDescriptionBullets(
    description: unknown
  ) {
    if (
      typeof description !== "string" ||
      !description.trim()
    ) {
      return;
    }

    description
      .split(/\r?\n|•/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        lines.push(`• ${line}`);
      });
  }

  /*
  Header
*/

const fullName = [
  clean(memory.first_name),
  clean(memory.last_name),
]
  .filter(Boolean)
  .join(" ");

if (fullName) {
  lines.push(fullName);
}

if (clean(memory.headline)) {
  lines.push(clean(memory.headline));
}

const contact = [
  clean(memory.email),
  clean(memory.phone),
  clean(memory.location),
  clean(memory.linkedin),
]
  .filter(Boolean)
  .join(" · ");

if (contact) {
  lines.push(contact);
}

/*
  Professional Summary
  Dashboard처럼 제목은 항상 포함
*/

lines.push(
  "",
  "PROFESSIONAL SUMMARY"
);

if (clean(memory.summary)) {
  lines.push(clean(memory.summary));
}

/*
  Skills
  Dashboard처럼 제목은 항상 포함
*/

const skills = Array.isArray(
  memory.skills
)
  ? memory.skills
      .map((item: unknown) =>
        clean(item)
      )
      .filter(Boolean)
  : String(memory.skills || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

lines.push("", "SKILLS");

skills.forEach((skill: string) => {
  lines.push(`• ${skill}`);
});

/*
  Experience
  Dashboard처럼 제목은 항상 포함
*/

lines.push("", "EXPERIENCE");

const workExperiences = Array.isArray(
  memory.experience
)
  ? memory.experience.filter(
      (item: any) =>
        clean(item?.company) ||
        clean(item?.jobTitle) ||
        clean(item?.job_title) ||
        clean(item?.description)
    )
  : [];

workExperiences.forEach(
  (item: any) => {
    const role =
      clean(item.jobTitle) ||
      clean(item.job_title);

    const employer = [
      clean(item.company),
      clean(item.location),
    ]
      .filter(Boolean)
      .join(" · ");

    const dates =
      formatExperienceDates(item);

    const titleLine = [
      role,
      dates,
    ]
      .filter(Boolean)
      .join(" | ");

    if (titleLine) {
      lines.push("", titleLine);
    }

    if (employer) {
      lines.push(employer);
    }

    addDescriptionBullets(
      item.description
    );
  }
);

/*
  Volunteer / Internship
  Dashboard Experience 내부 소제목과 동일
*/

const volunteerExperiences =
  Array.isArray(
    memory.volunteer_experience
  )
    ? memory.volunteer_experience.filter(
        (item: any) =>
          clean(item?.organization) ||
          clean(item?.role) ||
          clean(item?.location) ||
          item?.startDate ||
          item?.start_date ||
          item?.endDate ||
          item?.end_date ||
          clean(item?.description)
      )
    : [];

if (volunteerExperiences.length > 0) {
  lines.push(
    "",
    "VOLUNTEER / INTERNSHIP"
  );

  volunteerExperiences.forEach(
    (item: any) => {
      const role = clean(item.role);

      const organization = [
        clean(item.organization),
        clean(item.location),
      ]
        .filter(Boolean)
        .join(" · ");

      const dates =
        formatExperienceDates(item);

      const titleLine = [
        role,
        dates,
      ]
        .filter(Boolean)
        .join(" | ");

      if (titleLine) {
        lines.push("", titleLine);
      }

      if (organization) {
        lines.push(organization);
      }

      addDescriptionBullets(
        item.description
      );
    }
  );
}

/*
  Projects
  Dashboard처럼 name이 있어야 표시
*/

const projects = Array.isArray(
  memory.projects
)
  ? memory.projects.filter(
      (item: any) =>
        Boolean(item?.name?.trim?.())
    )
  : [];

if (projects.length > 0) {
  lines.push("", "PROJECTS");

  projects.forEach(
    (item: any) => {
      const heading = [
        clean(item.name),
        clean(item.dates),
      ]
        .filter(Boolean)
        .join(" | ");

      if (heading) {
        lines.push("", heading);
      }

      if (clean(item.role)) {
        lines.push(clean(item.role));
      }

      if (clean(item.description)) {
        lines.push(
          clean(item.description)
        );
      }
    }
  );
}

/*
  Education
*/

const education = Array.isArray(
  memory.education
)
  ? memory.education.filter(
      (item: any) =>
        clean(item?.school) ||
        clean(item?.program) ||
        clean(item?.degree) ||
        item?.startDate ||
        item?.start_date ||
        item?.endDate ||
        item?.end_date ||
        clean(item?.gpa) ||
        clean(item?.coursework)
    )
  : [];

if (education.length > 0) {
  lines.push("", "EDUCATION");

  education.forEach(
    (item: any) => {
      const program =
        clean(item.program) ||
        clean(item.degree);

      const dates =
        formatEducationDates(item);

      const heading = [
        program,
        dates,
      ]
        .filter(Boolean)
        .join(" | ");

      if (heading) {
        lines.push("", heading);
      }

      if (clean(item.school)) {
        lines.push(clean(item.school));
      }

      if (clean(item.gpa)) {
        lines.push(
          `GPA: ${clean(item.gpa)}`
        );
      }

      if (clean(item.coursework)) {
        lines.push(
          clean(item.coursework)
        );
      }
    }
  );
}

/*
  Languages
*/

const languages = Array.isArray(
  memory.languages
)
  ? memory.languages.filter(
      (item: any) =>
        typeof item === "string"
          ? Boolean(item.trim())
          : Boolean(
              item?.language?.trim?.()
            )
    )
  : [];

if (languages.length > 0) {
  lines.push("", "LANGUAGES");

  languages.forEach(
    (item: any) => {
      if (typeof item === "string") {
        lines.push(`• ${item.trim()}`);
        return;
      }

      const languageLine = [
        clean(item.language),
        clean(item.level) ||
          clean(item.proficiency),
      ]
        .filter(Boolean)
        .join(" — ");

      if (languageLine) {
        lines.push(`• ${languageLine}`);
      }
    }
  );
}

/*
  Certifications
  Dashboard처럼 name이 있어야 표시
*/

const certifications =
  Array.isArray(
    memory.certifications
  )
    ? memory.certifications.filter(
        (item: any) =>
          Boolean(item?.name?.trim?.())
      )
    : [];

if (certifications.length > 0) {
  lines.push(
    "",
    "CERTIFICATIONS"
  );

  certifications.forEach(
    (item: any) => {
      const heading = [
        clean(item.name),
        clean(item.date),
      ]
        .filter(Boolean)
        .join(" | ");

      if (heading) {
        lines.push("", heading);
      }

      if (clean(item.issuer)) {
        lines.push(clean(item.issuer));
      }

      if (clean(item.description)) {
        lines.push(
          clean(item.description)
        );
      }
    }
  );
}

/*
  Career Objective
*/

const targetRoles = Array.isArray(
  memory.target_roles
)
  ? memory.target_roles
      .map((role: unknown) =>
        clean(role)
      )
      .filter(Boolean)
  : clean(memory.target_roles)
    ? [clean(memory.target_roles)]
    : [];

const hasCareerObjective =
  targetRoles.length > 0 ||
  clean(memory.target_industry) ||
  clean(memory.target_location) ||
  clean(memory.salary_expectation) ||
  clean(memory.career_goal_summary);

if (hasCareerObjective) {
  lines.push(
    "",
    "CAREER OBJECTIVE"
  );

  if (targetRoles.length > 0) {
    lines.push(
      `Target Role: ${targetRoles.join(
        ", "
      )}`
    );
  }

  if (clean(memory.target_industry)) {
    lines.push(
      `Industry: ${clean(
        memory.target_industry
      )}`
    );
  }

  if (clean(memory.target_location)) {
    lines.push(
      `Preferred Location: ${clean(
        memory.target_location
      )}`
    );
  }

  if (
    clean(memory.salary_expectation)
  ) {
    lines.push(
      `Salary Expectation: ${clean(
        memory.salary_expectation
      )}`
    );
  }

  if (
    clean(memory.career_goal_summary)
  ) {
    lines.push(
      "",
      clean(
        memory.career_goal_summary
      )
    );
  }
}

return lines.join("\n").trim();
}

export default function PasteJobPage() {
  const { user, loading, hasResumeData } = useLogin();
  const [showResumeRequiredModal, setShowResumeRequiredModal] =
    useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    setShowResumeRequiredModal(!hasResumeData);
  }, [loading, user, hasResumeData]);

  /*
    The user's current Career Memory template selection - single source
    for every resume Preview/PDF/DOCX rendered on this page (Generate
    Package review AND Apply with Saved Resume), per
    lib/brand/render/templateId.ts. Fetched once per session rather than
    on every render/download - Career Memory changes are expected to be
    rare mid-session, and each Generate Package run already snapshots its
    own resume_template_id server-side onto the created application row
    regardless of this client-side value.
  */
  const [resumeTemplateId, setResumeTemplateId] = useState<string | null>(null);

  /*
    Resume tab only: "preview" shows the new DocumentIR-based, template-
    aware A4DocumentPreview (read-only); "edit" shows the original
    flat-text A4Preview with its per-page <textarea> editing. Cover
    Letter/Email keep their existing single A4Preview/textarea, no
    toggle - resume_text editing capability is fully preserved, just
    moved behind an explicit switch instead of being the only view.
  */
  const [resumeViewMode, setResumeViewMode] = useState<"preview" | "edit">("preview");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("career_memory")
      .select("resume_template")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setResumeTemplateId(normalizeResumeTemplateId(data?.resume_template));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const router = useRouter();
  const [activeMode, setActiveMode] = useState<PasteMode>("url");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis>(emptyAnalysis);
  /*
    applicationId identifies the persisted applications row for the
    currently analyzed job, once one exists - set from the server's
    response, never derived from company/job_title text. generationRequestId
    is generated once per newly analyzed job and reused across every
    "Generate Package" click for that same job, so accidental double-clicks
    or retries are idempotent on the server instead of creating duplicate
    rows or duplicate AI calls.
  */
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [generationRequestId, setGenerationRequestId] = useState<string | null>(null);
 const isSupportedJob =
  analysis?.jobContext
    ?.supportedByCareerElan === true;
  const [
  savedApplicationMaterial,
  setSavedApplicationMaterial,
] =
  useState<SavedApplicationMaterial | null>(
    null
  );

  const [
    resumeSelectionStatus,
    setResumeSelectionStatus,
  ] = useState<ResumeSelectionStatus>("loading");

const [
  savedPreviewType,
  setSavedPreviewType,
] =
  useState<SavedPreviewType>(null);

  const [analyzed, setAnalyzed] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  /*
    generationPhase is the source of truth for the async flow; isGenerating
    is derived from it (submitting/pending only) so every existing
    isGenerating-driven disabled/label check below keeps working unchanged.
    poll_timeout deliberately does NOT count as isGenerating - the button
    re-enables so the user isn't stuck if the browser gives up waiting,
    and a genuine still-in-flight retry is safely rejected server-side
    (409 GENERATION_IN_PROGRESS) rather than by disabling the client.
  */
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>("idle");
  const isGenerating = isGenerationActive(generationPhase);
  const [generationErrorInfo, setGenerationErrorInfo] =
    useState<GenerationErrorInfo | null>(null);
  /*
    Real, worker-reported progress only - set from the status endpoint's
    stage/progress/elapsedSeconds fields (server-computed by
    resolveGenerationProgress(), the single place that stage->percentage
    mapping lives - see lib/generatePackage/shared.ts). Never advanced by a
    client-side timer: a stage/percentage here only ever changes because
    the worker actually reported reaching that stage.
  */
  const [progressInfo, setProgressInfo] = useState<{
    stage: string | null;
    progress: number;
    elapsedSeconds: number | null;
  } | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<PreviewType>("resume");
  const [showDefaultApplication, setShowDefaultApplication] = useState(false);

  /*
    Display-only hint for the lifetime Generate Package quota (Production
    only - enforced is false everywhere else, including local dev). Never
    used to decide whether to allow a click; the server always re-checks
    at generation time. Loaded once via a plain GET, no OpenAI call.
  */
  const [generatePackageQuota, setGeneratePackageQuota] = useState<{
    enforced: boolean;
    limit: number;
    used: number | null;
    remaining: number | null;
  } | null>(null);

  const [packageData, setPackageData] = useState<GeneratedPackage>({
  resume: "",
  coverLetter: "",
  emailDraft: "",
  packageAnalysis: null,
});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoAnalyzeStartedRef = useRef(false);

  /*
    Poll lifecycle: pollerRef holds the currently active poller (if any),
    so it can always be stopped - on unmount, on a new Generate click, on
    retry, or when the tracked applicationId changes - without ever
    leaving two pollers running at once. recoveryAttemptedRef guards the
    refresh-recovery effect to run at most once per page load.
  */
  const pollerRef = useRef<PollerHandle | null>(null);
  const recoveryAttemptedRef = useRef(false);

  /*
    Stale-worker recovery (app/api/generate-package/route.ts is the
    server-side counterpart): autoRetryAttemptedRef guards "exactly one
    automatic re-enqueue POST per generation attempt" - reset at the top of
    beginPolling() for each fresh attempt, and deliberately never persisted
    (a page refresh starting a new in-memory count is expected, matching
    this whole recovery mechanism's non-persistent design). giveUpTimerRef
    holds the scheduled "still stuck after the retry" check so it can be
    cancelled the moment this attempt resolves through any path -
    applySucceededResult()/applyFailedResult() below both clear it, so a
    normal success/failure occurring on its own (unrelated to this
    recovery) can never have a stray delayed check fire afterward and
    incorrectly override an already-resolved outcome.
  */
  const autoRetryAttemptedRef = useRef(false);
  const giveUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearGiveUpTimer() {
    if (giveUpTimerRef.current) {
      clearTimeout(giveUpTimerRef.current);
      giveUpTimerRef.current = null;
    }
  }

  function stopPolling() {
    if (pollerRef.current) {
      pollerRef.current.stop();
      pollerRef.current = null;
    }
  }

  /*
    Restores the "what job was this" panel (title/company/location/
    keywords/requirements/summary) from the status endpoint's job fields -
    present regardless of generation_status, so it's available whether the
    recovered attempt is still pending, succeeded, or failed. Only applied
    when the endpoint actually returned a usable jobAnalysis object;
    otherwise the existing analysis state (if any) is left untouched
    rather than being clobbered with an empty one.
  */
  function applyJobContext(context: JobContext) {
    if (context.jobAnalysis && typeof context.jobAnalysis === "object") {
      setAnalysis(context.jobAnalysis as JobAnalysis);
      setAnalyzed(true);
      return;
    }

    if (context.jobTitle || context.company) {
      setAnalysis((prev) => ({
        ...prev,
        title: context.jobTitle || prev.title,
        company: context.company || prev.company,
        location: context.location || prev.location,
      }));
      setAnalyzed(true);
    }
  }

  /*
    Applies a successful generation result (from either the initial POST's
    200 replay, the polling GET's "succeeded" state, or refresh recovery)
    identically in all three cases - one place defines what "a completed
    package" looks like on screen.
  */
  function applySucceededResult(
    result: {
      applicationId: string;
      resume: string;
      coverLetter: string;
      emailDraft: string;
      packageAnalysis: unknown;
    } & Partial<JobContext>
  ) {
    clearGiveUpTimer();
    setPackageData({
      resume: result.resume,
      coverLetter: result.coverLetter,
      emailDraft: result.emailDraft,
      packageAnalysis:
        (result.packageAnalysis as PackageAnalysis | null) || null,
    });
    setSelectedPreview("resume");
    setGenerated(true);
    setApplicationId(result.applicationId || null);
    setGenerationPhase("succeeded");
    setGenerationErrorInfo(null);
    setProgressInfo(null);
    setMessage("Your package is ready.");
    if (result.jobAnalysis !== undefined) {
      applyJobContext(result as JobContext);
    }
    clearActiveGeneration(window.sessionStorage);
  }

  function applyFailedResult(
    result: { code: string | null; message: string } & Partial<JobContext>
  ) {
    clearGiveUpTimer();
    setGenerationPhase("failed");
    setGenerationErrorInfo({
      code: result.code || undefined,
      message: result.message,
    });
    setProgressInfo(null);
    setMessage(result.message);
    if (result.jobAnalysis !== undefined) {
      applyJobContext(result as JobContext);
    }
    clearActiveGeneration(window.sessionStorage);
  }

  /*
    Begins polling GET /api/applications/{applicationId}/status for one
    generation attempt. persist=true (a freshly claimed attempt) writes
    the sessionStorage recovery entry; persist=false (refresh recovery,
    where the entry already exists) leaves it untouched until the attempt
    resolves.
  */
  /*
    Fire-and-forget, best-effort request that asks the server to finalize a
    generation attempt that never got claimed as failed (marks it
    generation_status='failed' and refunds its quota reservation - see
    app/api/generate-package/route.ts's GIVE_UP_THRESHOLD_MS branch).
    Deliberately does not stop polling or touch any UI state itself: by
    the time this is called, the caller has already done that. Whatever
    the server decides (finalize it, or discover it actually resolved by
    now and no-op), the poller already stopped is not affected either way
    - if the server response disagrees, the user's own next manual click
    is the recovery path, not another automatic attempt here.
  */
  async function requestGiveUpFinalize(
    currentApplicationId: string,
    currentGenerationRequestId: string
  ) {
    try {
      await fetch("/api/generate-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobAnalysis: analysis,
          jobDescription: getOriginalJobSnippet(),
          jobUrl: jobUrl.trim(),
          generationRequestId: currentGenerationRequestId,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      /*
        Best-effort only - the row may remain "pending" in this rare
        double-failure case until the user's next manual Generate Package
        click naturally reclaims/finalizes it through the same idempotent
        server logic.
      */
    }

    console.log(
      JSON.stringify({
        event: "automatic recovery timed out",
        applicationId: currentApplicationId,
      })
    );
  }

  /*
    Fires when a give-up timer expires - re-verifies against the live
    server state before ever treating this as a real failure. A worker
    that claimed late (e.g. right around when the retry's own re-enqueue
    landed) can still be genuinely mid-OpenAI-call when 90s have passed
    since the retry; showing a "could not start" popup purely because a
    client-side timer elapsed, without checking, would be wrong in that
    case even though nothing is actually broken. Only a fresh status read
    that still shows "queued" (never claimed, never progressed) is treated
    as confirmation the recovery genuinely failed - anything else (already
    claimed/progressing, already succeeded, already failed for some other
    reason, or an inconclusive/transient read) leaves the existing poller
    (still running) as the sole authority on this attempt's outcome.
  */
  async function resolveGiveUpCheck(
    currentApplicationId: string,
    currentGenerationRequestId: string
  ) {
    if (!pollerRef.current) return;

    let result: ReturnType<typeof parseStatusResponse>;

    try {
      const res = await fetch(
        `/api/applications/${currentApplicationId}/status`
      );
      const contentType = res.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      let data: unknown = null;

      if (isJson) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }

      result = parseStatusResponse(res.status, isJson && data !== null, data);
    } catch {
      /*
        Could not confirm the live state - never fail an attempt purely
        on an inability to check just now. The still-running poller
        remains the source of truth; this give-up window simply takes no
        action this time.
      */
      return;
    }

    // A newer resolution (or a manual retry) may have already stopped
    // polling while this status fetch was in flight.
    if (!pollerRef.current) return;

    if (result.kind === "succeeded") {
      stopPolling();
      applySucceededResult(result);
      return;
    }

    if (result.kind === "failed") {
      stopPolling();
      applyFailedResult(result);
      return;
    }

    if (result.kind === "pending" && result.stage === "queued") {
      stopPolling();
      applyFailedResult({
        code: "BACKGROUND_WORKER_NOT_STARTED",
        message:
          "Package generation could not start. No usage was deducted. Please try again.",
      });

      void requestGiveUpFinalize(currentApplicationId, currentGenerationRequestId);
      return;
    }

    /*
      Either still pending but past "queued" (claimed and genuinely
      progressing) or a transient/invalid/unauthorized read - never
      treated as a failure. Existing polling continues untouched.
    */
  }

  /*
    Scheduled ~90s (or ~30s after a network error on the retry itself)
    after a successful automatic re-enqueue, to catch the case where the
    retry's own worker invocation *also* never actually starts running.
    Cancelled the instant this attempt resolves through any path (see
    applySucceededResult()/applyFailedResult()'s clearGiveUpTimer() calls),
    so it can only ever fire while the poller for this exact attempt is
    still running with nothing having happened yet.
  */
  function scheduleGiveUpCheck(
    currentApplicationId: string,
    currentGenerationRequestId: string,
    delayMs: number
  ) {
    clearGiveUpTimer();

    giveUpTimerRef.current = setTimeout(() => {
      giveUpTimerRef.current = null;
      void resolveGiveUpCheck(currentApplicationId, currentGenerationRequestId);
    }, delayMs);
  }

  /*
    Attempts exactly one automatic re-enqueue of the existing, already-
    idempotent Generate Package POST route, reusing the same
    generationRequestId (never a new one) - the server's own atomic worker
    claim is what makes this safe even if the original invocation turns
    out to have actually started in the interim (see route.ts's
    generation_worker_claimed_at check).
  */
  async function performAutoRetry(
    currentApplicationId: string,
    currentGenerationRequestId: string
  ) {
    console.log(
      JSON.stringify({
        event: "automatic re-enqueue attempted",
        applicationId: currentApplicationId,
      })
    );

    try {
      const response = await fetch("/api/generate-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobAnalysis: analysis,
          jobDescription: getOriginalJobSnippet(),
          jobUrl: jobUrl.trim(),
          generationRequestId: currentGenerationRequestId,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      let data: unknown = null;

      if (isJson) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      }

      const result = parseGenerateResponse(
        response.status,
        isJson && data !== null,
        data
      );

      if (result.kind === "processing") {
        scheduleGiveUpCheck(
          currentApplicationId,
          currentGenerationRequestId,
          GIVE_UP_GRACE_MS
        );
        return;
      }

      if (result.kind === "succeeded") {
        stopPolling();
        applySucceededResult(result);
        return;
      }

      /*
        409 (already claimed, or the server itself already gave up and
        marked it failed - the next poll tick will reflect that either
        way) or any other error kind - never a second automatic attempt.
        Existing polling continues untouched; no give-up timer is armed
        since there was no successful re-enqueue to wait out.
      */
    } catch {
      scheduleGiveUpCheck(
        currentApplicationId,
        currentGenerationRequestId,
        GIVE_UP_GRACE_MS_AFTER_NETWORK_ERROR
      );
    }
  }

  /*
    Watches the live poll stream (already running every ~2.5s) for a job
    that has stayed at "queued" long enough that the server would honor a
    reclaim, and fires the one automatic retry exactly once per attempt.
  */
  function maybeAutoRetry(
    currentApplicationId: string,
    currentGenerationRequestId: string | null,
    status: { stage: string | null; elapsedSeconds: number | null }
  ) {
    if (autoRetryAttemptedRef.current) return;
    if (!currentGenerationRequestId) return;
    if (status.stage !== "queued") return;
    if (
      status.elapsedSeconds === null ||
      status.elapsedSeconds < AUTO_RETRY_ELAPSED_THRESHOLD_SECONDS
    ) {
      return;
    }

    autoRetryAttemptedRef.current = true;

    console.log(
      JSON.stringify({
        event: "stale queued job detected",
        applicationId: currentApplicationId,
      })
    );

    void performAutoRetry(currentApplicationId, currentGenerationRequestId);
  }

  function beginPolling(
    applicationId: string,
    /*
      null when recovering purely from a URL-provided applicationId (Job
      Tracker link, or a reopened tab after the sessionStorage entry was
      already lost) - the status endpoint only needs applicationId, and
      persist is always false in that case anyway, so there is nothing to
      write to sessionStorage.
    */
    generationRequestId: string | null,
    options: { persist: boolean; immediate: boolean }
  ) {
    stopPolling();
    clearGiveUpTimer();
    autoRetryAttemptedRef.current = false;

    if (options.persist && generationRequestId) {
      writeActiveGeneration(window.sessionStorage, {
        applicationId,
        generationRequestId,
        startedAt: Date.now(),
      });
    }

    setGenerationPhase("pending");
    setProgressInfo({ stage: "queued", progress: 10, elapsedSeconds: 0 });

    pollerRef.current = createPoller({
      applicationId,
      immediate: options.immediate,
      onPending: (result) => {
        applyJobContext(result);
        setProgressInfo({
          stage: result.stage,
          progress: result.progress,
          elapsedSeconds: result.elapsedSeconds,
        });
        maybeAutoRetry(applicationId, generationRequestId, {
          stage: result.stage,
          elapsedSeconds: result.elapsedSeconds,
        });
      },
      onSucceeded: (result) => {
        pollerRef.current = null;
        applySucceededResult(result);
      },
      onFailed: (result) => {
        pollerRef.current = null;
        applyFailedResult(result);
      },
      onInvalid: () => {
        pollerRef.current = null;
        clearActiveGeneration(window.sessionStorage);
        setGenerationPhase("idle");
        setProgressInfo(null);
      },
      onUnauthorized: () => {
        pollerRef.current = null;
        setGenerationPhase("failed");
        setGenerationErrorInfo({
          message: "Your session may have expired. Please sign in again.",
        });
      },
      onTimeout: () => {
        pollerRef.current = null;
        setGenerationPhase("poll_timeout");
        setMessage(
          "Your package is still being generated. Please try checking again shortly."
        );
      },
    });
  }

useEffect(() => {
  if (loading) return;
  if (!user) return;

  void loadSelectedApplicationMaterials();
}, [loading, user]);

useEffect(() => {
  if (loading) return;
  if (!user) return;

  let cancelled = false;

  (async () => {
    try {
      const res = await fetch("/api/generate-package/usage");

      if (!res.ok) return;

      const data = await res.json();

      if (!cancelled) {
        setGeneratePackageQuota({
          enforced: Boolean(data.enforced),
          limit: data.limit,
          used: data.used ?? null,
          remaining: data.remaining ?? null,
        });
      }
    } catch (error) {
      console.error(
        "GENERATE PACKAGE USAGE ERROR =",
        error
      );
    }
  })();

  return () => {
    cancelled = true;
  };
}, [loading, user]);

/*
  Recovery on page load, in priority order:

  1. URL ?applicationId=... (explicit navigation intent - a Job Tracker
     link, or a bookmarked/reopened link) - the DB is the source of truth
     here, not sessionStorage, so this works even in a brand-new tab where
     sessionStorage was never populated (tab close/reopen, a different
     browser/device that's still the same logged-in user, or the original
     sessionStorage entry having already expired/been cleared). Job
     analysis, generation state, and results are all reconstructed from
     one GET to the existing status endpoint - no new endpoint needed,
     since it already returns job context in every branch.
  2. sessionStorage's persisted active-generation entry (same-tab refresh
     recovery) - unchanged from before, and only attempted when no URL
     applicationId is present, so the two recovery paths never race.

  Runs once per page load, after auth resolves.
*/
useEffect(() => {
  if (loading) return;
  if (!user) return;
  if (recoveryAttemptedRef.current) return;
  recoveryAttemptedRef.current = true;

  const urlApplicationId = new URLSearchParams(
    window.location.search
  ).get("applicationId");

  if (urlApplicationId) {
    (async () => {
      try {
        const res = await fetch(
          `/api/applications/${urlApplicationId}/status`
        );
        const contentType = res.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        let data: unknown = null;

        if (isJson) {
          try {
            data = await res.json();
          } catch {
            data = null;
          }
        }

        const result = parseStatusResponse(
          res.status,
          isJson && data !== null,
          data
        );

        if (result.kind === "succeeded") {
          applySucceededResult(result);
          return;
        }

        if (result.kind === "failed") {
          setApplicationId(result.applicationId || urlApplicationId);
          applyFailedResult(result);
          return;
        }

        if (result.kind === "pending") {
          setApplicationId(result.applicationId || urlApplicationId);
          applyJobContext(result);
          setMessage(
            "Resuming a previously started application package generation..."
          );
          beginPolling(urlApplicationId, null, {
            persist: false,
            immediate: true,
          });
          return;
        }

        /*
          invalid (404/not owned)/unauthorized/transient - nothing safe
          to recover; leave the page in its normal empty state rather
          than showing an error for what may just be a stale/foreign link.
        */
      } catch (error) {
        console.error(
          "APPLICATION RECOVERY FETCH ERROR =",
          error
        );
      }
    })();

    return;
  }

  const stored: ActiveGeneration | null = readActiveGeneration(
    window.sessionStorage
  );

  if (!stored) return;

  setApplicationId(stored.applicationId);
  setGenerationRequestId(stored.generationRequestId);
  setMessage(
    "Resuming a previously started application package generation..."
  );

  beginPolling(stored.applicationId, stored.generationRequestId, {
    persist: false,
    immediate: true,
  });
}, [loading, user]);

/*
  Cleanup on unmount: an in-flight poll must never call setState on an
  unmounted component (React warning at best, a stale-closure bug at
  worst) and must never keep hitting the status endpoint after the user
  has navigated away.
*/
useEffect(() => {
  return () => {
    stopPolling();
  };
}, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    const title = params.get("title");

    if (url) {
      setActiveMode("url");
      setJobUrl(url);
      setAnalyzed(false);
      setGenerated(false);
      setMessage("Analyzing this job posting automatically...");

      if (!autoAnalyzeStartedRef.current) {
        autoAnalyzeStartedRef.current = true;
        setTimeout(() => {
          void analyzeJob(url, "url", "Analysis completed automatically from Find Jobs.");
        }, 0);
      }
    }

    if (title) {
      setAnalysis((prev) => ({
        ...prev,
        title,
      }));
    }
  }, []);

  function getCurrentJobText() {
    if (activeMode === "url") return jobUrl.trim();
    if (activeMode === "description") return jobDescription.trim();
    if (activeMode === "file") return fileText.trim() || selectedFileName.trim();
    return "";
  }

  function normalizeStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  }

  function normalizeJobDetails(data: any, fallbackUrl = ""): JobDetails {
    const details = data?.jobDetails || {};

    return {
      description:
        details.description ||
        data?.about ||
        data?.description ||
        data?.summary ||
        "",
      responsibilities: normalizeStringArray(
        details.responsibilities || data?.responsibilities || data?.tasks
      ),
      qualifications: normalizeStringArray(
        details.qualifications || data?.qualifications || data?.requirements
      ),
      benefits: normalizeStringArray(details.benefits || data?.benefits),
      salary: details.salary || data?.salary || data?.wage || "",
      schedule: details.schedule || data?.schedule || data?.type || "",
      applyUrl: details.applyUrl || fallbackUrl || "",
    };
  }

  function buildGeneratedPackage(nextAnalysis: JobAnalysis): GeneratedPackage {
    const title = nextAnalysis.title || "this position";
    const company = nextAnalysis.company || "your company";
    const location = nextAnalysis.location || "Canada";
    const keywords =
      nextAnalysis.keywords?.length > 0
        ? nextAnalysis.keywords.join(", ")
        : "communication, organization, and attention to detail";

    return {
      resume: `Professional Summary

Detail-oriented candidate applying for ${title} at ${company}. Experienced in communication, organization, client support, document handling, and professional office tasks.

Relevant Skills
• ${nextAnalysis.keywords?.[0] || "Communication"}
• ${nextAnalysis.keywords?.[1] || "Organization"}
• ${nextAnalysis.keywords?.[2] || "Microsoft Office"}
• ${nextAnalysis.keywords?.[3] || "Client Service"}
• ${nextAnalysis.keywords?.[4] || "Attention to Detail"}

Target Role
${title}
${company}
${location}

Experience Highlights
• Supported client-facing communication and documentation.
• Organized files, records, and application materials.
• Managed administrative tasks with accuracy and professionalism.
• Demonstrated strong attention to detail and reliability.

ATS Keywords
${keywords}`,

      coverLetter: `Dear Hiring Manager,

I am writing to express my interest in the ${title} position at ${company}. After reviewing the job posting, I believe my background in administration, communication, document handling, and client support aligns well with the requirements of this role.

The posting emphasizes skills such as ${keywords}. These are areas where I can contribute through my experience, attention to detail, and ability to support professional office operations.

I am confident that my work ethic, communication skills, and willingness to learn would allow me to make a positive contribution to your team.

Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience can support ${company}.

Sincerely,
David Kwak`,

      emailDraft: `Subject: Application for ${title}

Dear Hiring Manager,

I hope you are doing well.

Please find attached my resume and cover letter for the ${title} position at ${company}. I am very interested in this opportunity and would appreciate the chance to be considered.

Thank you for your time and consideration.

Best regards,
David Kwak`,
packageAnalysis: null,
    };
    
  }

  async function analyzeJob(
    jobText: string,
    mode: PasteMode,
    successMessage = "Job posting analyzed successfully. Your application package is ready."
  ) {
    if (!jobText.trim()) {
      alert("Please add a job URL, job description, or upload a file first.");
      return;
    }

    setIsAnalyzing(true);
    setMessage("Analyzing job posting...");

    try {
      const isUrlMode = mode === "url";

      const res = await fetch(
        isUrlMode ? "/api/analyze-job-url" : "/api/analyze-job",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(isUrlMode ? { jobUrl: jobText } : { jobText }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to analyze job.");
      }

     const nextAnalysis: JobAnalysis = {
  title:
    data.title || "Job Posting",

  company:
    data.company ||
    "Detected Company",

  location:
    data.location || "Canada",

  type:
    data.type || "Full-time",

  category:
    data.category || "General",

  icon:
    data.icon || "💼",

  match:
    data.match || "--",

  keywordCount:
    typeof data.keywordCount ===
    "number"
      ? data.keywordCount
      : Array.isArray(data.keywords)
        ? data.keywords.length
        : 0,

  requirementsMatched:
    typeof data.requirementsMatched ===
    "number"
      ? data.requirementsMatched
      : 0,

  keywords:
    Array.isArray(data.keywords)
      ? data.keywords.filter(
          (
            item: unknown
          ): item is string =>
            typeof item ===
              "string" &&
            item.trim().length > 0
        )
      : [],

  summary:
    data.summary ||
    "Job posting analyzed successfully.",

  jobDetails:
    normalizeJobDetails(
      data,
      isUrlMode
        ? jobText
        : jobUrl.trim()
    ),

  jobContext: {
    country:
      data.jobContext?.country ===
      "Canada"
        ? "Canada"
        : "Unknown",

    sector: [
      "private",
      "provincial",
      "municipal",
      "federal",
      "unknown",
    ].includes(
      data.jobContext?.sector
    )
      ? data.jobContext.sector
      : "unknown",

    province:
      typeof data.jobContext
        ?.province === "string"
        ? data.jobContext.province
        : "",

    municipality:
      typeof data.jobContext
        ?.municipality === "string"
        ? data.jobContext
            .municipality
        : "",

    supportedByCareerElan:
      data.jobContext
        ?.supportedByCareerElan ===
      true,

    classificationReason:
      typeof data.jobContext
        ?.classificationReason ===
      "string"
        ? data.jobContext
            .classificationReason
        : "",
  },

  requirements:
    Array.isArray(
      data.requirements
    )
      ? data.requirements
          .filter(
            (item: unknown) =>
              Boolean(item) &&
              typeof item ===
                "object" &&
              typeof (
                item as {
                  requirement?: unknown;
                }
              ).requirement ===
                "string"
          )
          .map((item: any) => ({
            requirement:
              item.requirement.trim(),

            category:
              item.category ===
                "preferred" ||
              item.category ===
                "legal_or_regulated"
                ? item.category
                : "mandatory",
          }))
      : [],
};

      /*
        A newly analyzed job supersedes whatever generation attempt (if
        any) was previously being tracked for the old job - stop polling
        it and drop its recovery entry so a refresh doesn't try to
        resurrect a now-irrelevant attempt.
      */
      stopPolling();
      clearActiveGeneration(window.sessionStorage);
      setGenerationPhase("idle");
      setGenerationErrorInfo(null);

      setAnalysis(nextAnalysis);
    setAnalyzed(true);
    setGenerated(false);
    setApplicationId(null);
    setGenerationRequestId(crypto.randomUUID());
    setMessage(successMessage);
    } catch (error: any) {
      console.error(error);

      const failureMessage =
        error?.message ||
        "This website couldn't be analyzed automatically. Please paste the job description or upload a PDF, DOCX, or screenshot.";

      alert(failureMessage);

      /*
        A failed/invalid analysis (e.g. NOT_A_SPECIFIC_JOB_POSTING) must
        never leave a prior successful analysis's title/company/metrics on
        screen next to this new failure message - clear the whole
        "currently analyzed job" identity, matching the reset already done
        at the start of a fresh, successful analyzeJob() call above.
      */
      stopPolling();
      clearActiveGeneration(window.sessionStorage);
      setGenerationPhase("idle");
      setGenerationErrorInfo(null);

      setAnalysis(emptyAnalysis);
      setAnalyzed(false);
      setGenerated(false);
      setApplicationId(null);
      setGenerationRequestId(null);
      setMessage(failureMessage);
    } finally {
      setIsAnalyzing(false);
    }
  }

async function loadSelectedApplicationMaterials() {
  if (!user) {
    setSavedApplicationMaterial(null);
    setResumeSelectionStatus("error");
    return null;
  }

  setResumeSelectionStatus("loading");

  /*
    Authoritative resume resolution - the exact same
    resolveSelectedResume() function app/api/generate-package/route.ts
    calls, via /api/resumes/selected. Never falls back to a different
    resume or to Career Memory: any non-200 response means the current
    Dashboard selection is invalid (none made, unknown source, a
    deleted/foreign resume id, empty content, etc), and this function
    stops here rather than guessing.
  */
  let selectedResumeMaterial: SavedApplicationMaterial["resume"];

  try {
    const res = await fetch("/api/resumes/selected");
    const data = await res.json();

    if (!res.ok) {
      console.error("SELECTED RESUME RESOLUTION ERROR =", data?.error);
      setSavedApplicationMaterial(null);
      setResumeSelectionStatus("error");
      return null;
    }

    if (data.source === "uploaded") {
      selectedResumeMaterial = {
        sourceType: "uploaded",
        id: data.resumeId,
        name: data.selectedName,
        text: data.previewData?.original_text || "",
        resumeRow: data.previewData,
      };
    } else {
      selectedResumeMaterial = {
        sourceType: "career_memory",
        id: null,
        name: data.selectedName,
        text: buildCareerMemoryResumeText(data.previewData),
      };
    }
  } catch (fetchError) {
    console.error("SELECTED RESUME FETCH ERROR =", fetchError);
    setSavedApplicationMaterial(null);
    setResumeSelectionStatus("error");
    return null;
  }

  /*
    Cover letter selection is a separate concern from Phase 2's resume
    consistency goal - kept as its own direct, RLS-scoped query, unchanged
    in behavior from before.
  */
  const { data: memory } = await supabase
    .from("career_memory")
    .select("selected_cover_letter_id, resume_template")
    .eq("user_id", user.id)
    .maybeSingle();

  if (selectedResumeMaterial.sourceType === "career_memory") {
    selectedResumeMaterial.resumeTemplateId = normalizeResumeTemplateId(memory?.resume_template);
  }

  let selectedCover = null;

  if (memory?.selected_cover_letter_id) {
    const { data: coverRow } = await supabase
      .from("cover_letters")
      .select("*")
      .eq("id", memory.selected_cover_letter_id)
      .eq("user_id", user.id)
      .maybeSingle();

    selectedCover = coverRow;
  }

  const selectedCoverMaterial:
    SavedApplicationMaterial["coverLetter"] =
    selectedCover
      ? {
          sourceType: "upload",
          id: selectedCover.id,
          name:
            selectedCover.file_name ||
            "Selected Cover Letter",
          text:
            selectedCover.original_text ||
            "",
          coverLetterRow: selectedCover,
        }
      : {
          sourceType:
            "automatic",
          id: null,
          name:
            "Automatic Cover Letter",
          text:
            "No saved cover letter is selected. Career Élan will generate a new job-specific cover letter.",
        };

  const result:
    SavedApplicationMaterial = {
    resume:
      selectedResumeMaterial,
    coverLetter:
      selectedCoverMaterial,
  };

  setSavedApplicationMaterial(
    result
  );
  setResumeSelectionStatus("ready");

  return result;
}
  async function handleAnalyze() {
    const jobText = getCurrentJobText();

    await analyzeJob(
      jobText,
      activeMode,
      "Job posting analyzed successfully. Your application package has been refreshed."
    );
  }

  async function handleGeneratePackage() {
  if (!hasResumeData) {
    alert(
      "Please write your Career Memory or upload a resume before creating an application package."
    );
    setShowResumeRequiredModal(true);
    return;
  }

  if (!analyzed) {
    alert(
      "Please analyze the job posting first."
    );
    return;
  }

  if (resumeSelectionStatus !== "ready") {
    alert(
      "Please select a resume from Dashboard."
    );
    return;
  }

  if (!generationRequestId) {
    alert(
      "Please analyze the job posting first."
    );
    return;
  }

  /*
    Duplicate-click protection beyond the disabled button attribute (which
    a very fast double-click can race past before React re-renders):
    submitting/pending means an attempt for this same generationRequestId
    is already in flight or being polled - never send a second POST.
  */
  if (isGenerationActive(generationPhase)) {
    return;
  }

  // A retry after failure/timeout starts clean: drop any leftover poller
  // from a prior attempt before beginning this one.
  stopPolling();

  try {
    setGenerationPhase("submitting");
    setGenerationErrorInfo(null);
    setMessage("");

    /*
      Minimal job data only - the server resolves the caller's actual
      selected resume itself (resolveSelectedResume(), keyed off the
      authenticated session), so no resume/career_memory data is sent
      from here anymore.
    */
    const response = await fetch(
      "/api/generate-package",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          jobAnalysis: analysis,
          jobDescription:
            getOriginalJobSnippet(),
          jobUrl: jobUrl.trim(),
          generationRequestId,
        }),

        /*
          Only guards against the claim step itself never responding - the
          claim (auth, quota, resolve resume, insert/reclaim row, enqueue
          worker) is designed to complete in well under a second, so this
          is a generous backstop, not a normal-path timeout. It never
          cancels server-side work; the actual generation now runs in a
          background worker this request doesn't wait for at all.
        */
        signal: AbortSignal.timeout(20_000),
      }
    );

    const contentType =
      response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    let data: unknown = null;

    if (isJson) {
      try {
        data = await response.json();
      } catch (parseError) {
        console.error(
          "GENERATE PACKAGE RESPONSE PARSE ERROR =",
          response.status,
          parseError
        );
      }
    } else {
      console.error(
        "GENERATE PACKAGE NON-JSON RESPONSE =",
        response.status,
        contentType
      );
    }

    const result = parseGenerateResponse(
      response.status,
      isJson && data !== null,
      data
    );

    if (result.kind === "processing") {
      setMessage(
        "Your application package is being generated. This page will update automatically."
      );
      beginPolling(result.applicationId, result.generationRequestId, {
        persist: true,
        immediate: false,
      });
      return;
    }

    if (result.kind === "succeeded") {
      applySucceededResult(result);
      return;
    }

    if (result.kind === "quota_reached") {
      setGeneratePackageQuota({
        enforced: true,
        limit: result.limit,
        used: result.used,
        remaining: 0,
      });

      const limitError: Error & { code?: string } = new Error(
        "You have used all 3 Generate Package generations available for your account."
      );
      limitError.code = "GENERATE_PACKAGE_LIMIT_REACHED";
      throw limitError;
    }

    if (result.kind === "in_progress") {
      throw new Error(result.message);
    }

    throw new Error(result.message);
  } catch (error: any) {
    console.error(
      "PACKAGE GENERATION ERROR =",
      error
    );

    setGenerationPhase("idle");

    /*
      AbortSignal.timeout() rejects fetch with a "TimeoutError"; a manual
      controller.abort() would reject with "AbortError". Either is a
      client-side give-up on the claim step itself (not the background
      generation, which this request no longer waits for) - the same
      generationRequestId is still set, so a manual retry click safely
      becomes an idempotent replay/409/reclaim per the server's own logic,
      not a duplicate generation.
    */
    if (
      error?.code === "GENERATE_PACKAGE_LIMIT_REACHED"
    ) {
      alert(
        "Generate Package limit reached\n\nYou have used all 3 Generate Package generations available for your account."
      );
    } else if (
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
    ) {
      alert(
        "This is taking longer than expected. Please try again."
      );
    } else {
      alert(
        error?.message ||
          "Failed to generate package."
      );
    }
  }
}
  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);

    if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
      const text = await file.text();
      setFileText(text);
      setMessage("Ready to analyze your new job posting. Click Analyze Uploaded File to update the page.");
      return;
    }

    setFileText(file.name);
    setMessage(
      "Ready to analyze your new job posting. Click Analyze Uploaded File to update the page. For PDF/DOCX/image extraction, connect server-side parsing later."
    );
  }

  function copyPreviewText() {
    navigator.clipboard.writeText(packageData[selectedPreview]);
    setMessage("Copied to clipboard.");
  }

  function getSavedTextByKeys(source: unknown, keys: string[]): string {
    if (!source || typeof source !== "object") return "";

    const objectValue = source as Record<string, unknown>;

    for (const [key, value] of Object.entries(objectValue)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");

      if (
        keys.some((targetKey) =>
          normalizedKey.includes(targetKey.toLowerCase().replace(/[^a-z]/g, ""))
        ) &&
        typeof value === "string" &&
        value.trim().length > 0
      ) {
        return value.trim();
      }
    }

    for (const value of Object.values(objectValue)) {
      if (value && typeof value === "object") {
        const nested = getSavedTextByKeys(value, keys);
        if (nested) return nested;
      }
    }

    return "";
  }

  function isCompleteApplicationMaterial(text: string) {
    const cleaned = text.trim();

    if (cleaned.length < 80) return false;

    const incompletePhrases = [
      "upload resume",
      "add resume",
      "complete your resume",
      "no saved resume",
      "no resume",
      "no saved cover",
      "no cover letter",
      "placeholder",
      "example only",
      "draft only",
    ];

    return !incompletePhrases.some((phrase) =>
      cleaned.toLowerCase().includes(phrase)
    );
  }

  async function getSavedApplicationMaterials() {
  const materials =
    savedApplicationMaterial ||
    (await loadSelectedApplicationMaterials());

  if (!materials) {
    return {
      resume: "",
      coverLetter: "",
    };
  }

  return {
    resume:
      materials.resume.text,

    coverLetter:
      materials.coverLetter
        .sourceType === "upload"
        ? materials.coverLetter.text
        : "",
  };
}

   
  

  async function handleApplyNow() {
    const { resume, coverLetter } =
  await getSavedApplicationMaterials();
    const hasCompleteResume = isCompleteApplicationMaterial(resume);
    const hasCompleteCoverLetter = isCompleteApplicationMaterial(coverLetter);

    if (!hasCompleteResume && !hasCompleteCoverLetter) {
      const shouldGoToCareerMemory = window.confirm(
        "Your saved resume or cover letter is missing or incomplete. Go to Career Memory to complete it now?"
      );

      if (shouldGoToCareerMemory) {
        router.push("/career-memory");
      } else {
        setMessage(
          "Your saved application materials are missing or incomplete. Complete Career Memory before using this option."
        );
      }

      return;
    }

   setPackageData((prev) => ({
  resume:
    hasCompleteResume
      ? resume
      : prev.resume ||
        "No complete saved resume found.",

  coverLetter:
    hasCompleteCoverLetter
      ? coverLetter
      : prev.coverLetter ||
        "No complete saved cover letter found.",

  emailDraft:
    prev.emailDraft ||
    `Subject: Application for ${analysis.title}

Dear Hiring Manager,

I hope you are doing well.

I would like to apply for the ${analysis.title} position at ${analysis.company}. Please find my application materials attached.

Best regards,
David Kwak`,

  packageAnalysis: prev.packageAnalysis,
}));

    setSelectedPreview(hasCompleteResume ? "resume" : "coverLetter");
    setGenerated(true);
    setShowDefaultApplication(true);
    setMessage(
      hasCompleteResume && hasCompleteCoverLetter
        ? "Your saved resume and cover letter are ready. Preview, edit, save, or continue to the employer website."
        : "One complete saved application material was found. You can preview, edit, save, or continue to the employer website."
    );
  }

  function continueToApply() {
    const targetUrl = analysis.jobDetails.applyUrl || jobUrl.trim();

    if (!targetUrl) {
      alert("No employer apply link is available. Paste the job URL first.");
      return;
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }
  
async function downloadPdf() {
  if (selectedPreview === "resume") {
    await exportPdfFromText(
      packageData[selectedPreview],
      `${getFileBaseName()}_${selectedPreview}`,
      resumeTemplateId
    );
    return;
  }
  await exportPdf(
    packageData[selectedPreview],
    `${getFileBaseName()}_${selectedPreview}`
  );
}


async function downloadDocx() {
  if (selectedPreview === "resume") {
    await exportDocxFromText(
      packageData[selectedPreview],
      `${getFileBaseName()}_${selectedPreview}`,
      resumeTemplateId
    );
    return;
  }
  await exportDocx(
    packageData[selectedPreview],
    `${getFileBaseName()}_${selectedPreview}`
  );
}

  async function savePackage() {


  if (!user) return;

  const sharedFields = {
    job_url: jobUrl.trim(),

    job_description:
      getOriginalJobSnippet(),

    location: analysis.location,
    job_type: analysis.type,

    resume_text: packageData.resume,

    cover_letter_text:
      packageData.coverLetter,

    email_draft:
      packageData.emailDraft,

    job_analysis: analysis,

    ai_insight:
      packageData.packageAnalysis
        ? {
            mismatch:
              packageData.packageAnalysis
                .mismatch,

            matches:
              packageData.packageAnalysis
                .matches,

            recommendation:
              packageData.packageAnalysis
                .recommendation,
          }
        : null,

    updated_at:
      new Date().toISOString(),
  };

  /*
    applicationId-based, never company/job_title text matching - that could
    match zero, one, or several rows. If no row exists yet (e.g. "Apply with
    Saved Resume" was used without ever calling /api/generate-package),
    create one here and remember its id, same as the generate path does.
  */
  if (applicationId) {
    const { error } = await supabase
      .from("applications")
      .update(sharedFields)
      .eq("id", applicationId)
      .eq("user_id", user.id);

    if (error) {
      alert(error.message);
      return;
    }
  } else {
    /*
      No prior applicationId - this is the "Apply with Saved Resume" quick
      path (no AI generation ever ran for this job). resume_id/
      cover_letter_id come straight from savedApplicationMaterial, the same
      ownership-checked, no-fallback selection loadSelectedApplicationMaterials()
      already resolved - never re-derived, never substituted. status is a
      distinct value from "package_generated" (reserved for the AI path) so
      the two are never confused; generation_status/generation_model/
      prompt_version/job_description_normalized are deliberately omitted
      (left null) since no AI generation happened here.
    */
    const { data, error } = await supabase
      .from("applications")
      .insert({
        ...sharedFields,
        user_id: user.id,
        company: analysis.company,
        job_title: analysis.title,
        status: "saved",
        resume_id:
          savedApplicationMaterial?.resume.id ?? null,
        cover_letter_id:
          savedApplicationMaterial?.coverLetter.id ?? null,
        resume_template_id:
          savedApplicationMaterial?.resume.sourceType === "career_memory"
            ? normalizeResumeTemplateId(savedApplicationMaterial.resume.resumeTemplateId)
            : null,
        applied_date: new Date()
          .toISOString()
          .split("T")[0],
      })
      .select("id")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setApplicationId(data.id);
  }

  alert("Application package has been saved successfully!");

  setMessage("Application package saved to cloud.");
}

  function sanitizeFileName(value: string) {
    return value
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70)
      .toLowerCase();
  }

  function getFileBaseName() {
    const company = sanitizeFileName(analysis.company || "company");
    const title = sanitizeFileName(analysis.title || "job_application");
    return `${company}_${title}`;
  }

  function downloadTextFile(fileName: string, text: string, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSelected(extension: "docx" | "pdf" | "txt") {
    if (!generated) {
      alert("Generate the package first.");
      return;
    }

    const labelMap: Record<PreviewType, string> = {
      resume: "resume",
      coverLetter: "cover_letter",
      emailDraft: "email_draft",
    };

    const mimeMap = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      txt: "text/plain;charset=utf-8",
    };

    downloadTextFile(
      `${getFileBaseName()}_${labelMap[selectedPreview]}.${extension}`,
      packageData[selectedPreview],
      mimeMap[extension]
    );
  }

  function getPreviewLabel() {
    if (selectedPreview === "resume") return "Resume Preview";
    if (selectedPreview === "coverLetter") return "Cover Letter Preview";
    return "Email Draft Preview";
  }

  function getPreviewIcon() {
    if (selectedPreview === "resume") return "📄";
    if (selectedPreview === "coverLetter") return "✉️";
    return "📧";
  }

  function getOriginalJobSnippet() {
    if (analysis.jobDetails.description.trim()) return analysis.jobDetails.description.trim();
    if (jobDescription.trim()) return jobDescription.trim();
    if (fileText.trim() && fileText !== selectedFileName) return fileText.trim();
    return analysis.summary;
  }

  function hasJobDetails() {
    return (
      Boolean(analysis.jobDetails.description) ||
      analysis.jobDetails.responsibilities.length > 0 ||
      analysis.jobDetails.qualifications.length > 0 ||
      analysis.jobDetails.benefits.length > 0 ||
      Boolean(analysis.jobDetails.salary) ||
      Boolean(analysis.jobDetails.schedule)
    );
  }

  return (

    <>
      {showResumeRequiredModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-black text-slate-950">
              Add a resume first
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Create your Career Memory or upload a resume before using
              Paste Job. This helps us generate a tailored resume and
              cover letter for the job.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <a
                href="/career-memory"
                className="rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-blue-700"
              >
                Create or upload a resume
              </a>

              <button
                type="button"
                onClick={() => setShowResumeRequiredModal(false)}
                className="rounded-xl px-4 py-2 text-center text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {savedPreviewType && savedApplicationMaterial && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl bg-slate-100 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">
                  Saved Application Preview
                </p>

                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {savedPreviewType === "resume"
                    ? savedApplicationMaterial.resume.name
                    : savedApplicationMaterial.coverLetter.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSavedPreviewType(null)
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                aria-label="Close preview"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-8">
              {savedPreviewType === "resume" &&
              savedApplicationMaterial.resume.resumeRow ? (
                <ResumePreviewRenderer
                  resume={savedApplicationMaterial.resume.resumeRow}
                  fallbackText={savedApplicationMaterial.resume.text}
                />
              ) : savedPreviewType === "coverLetter" &&
                savedApplicationMaterial.coverLetter.coverLetterRow ? (
                <CoverLetterPreviewRenderer
                  coverLetter={savedApplicationMaterial.coverLetter.coverLetterRow}
                  fallbackText={savedApplicationMaterial.coverLetter.text}
                />
              ) : (
                <div className="mx-auto min-h-[900px] max-w-[794px] bg-white p-10 shadow">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-700">
                    {savedPreviewType === "resume"
                      ? savedApplicationMaterial.resume.text
                      : savedApplicationMaterial.coverLetter.text}
                  </pre>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex justify-end border-t border-slate-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setSavedPreviewType(null)
                }
                className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      
    <main className="min-h-screen bg-[#f6fbff] text-gray-900">
      <div className="flex min-h-screen">
        <aside className="w-60 border-r border-blue-100 bg-white px-5 py-6">
          <div className="flex items-center justify-between">
            <a href="/dashboard">
              <Image src="/logo.png" alt="Career Élan" width={120} height={45} />
            </a>
            <span className="text-gray-400">‹</span>
          </div>

          <p className="mt-8 text-xs font-bold uppercase tracking-wider text-gray-400">
            Overview
          </p>

          <nav className="mt-4 space-y-2">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  item.label === "Paste Job"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mt-16 rounded-2xl bg-blue-50 p-5 text-center">
            <div className="text-3xl">👑</div>
            <h3 className="mt-3 font-extrabold">Upgrade to Pro</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Unlock unlimited AI package generation.
            </p>
            <button className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
              Upgrade Now
            </button>
          </div>
        </aside>

        <section className="flex-1 px-8 py-6">
          <header className="mb-8 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-blue-600">
                Create Package › Paste Job URL or Description
              </div>
              <h1 className="mt-2 text-3xl font-extrabold">
                Paste Job URL or Description
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Paste a job URL, description, or upload a file. We’ll analyze it and generate your full package.
              </p>
            </div>

            <button
              onClick={() => router.back()}
              className="rounded-xl border border-blue-100 bg-white px-5 py-3 text-sm font-bold text-gray-600 shadow-sm hover:bg-blue-50"
            >
              ← Back to Results
            </button>
          </header>

          <div className="grid gap-6 xl:grid-cols-12">
            <section className="xl:col-span-8">
              <div className="rounded-2xl border border-blue-100 bg-white shadow-sm">
                <div className="grid grid-cols-3 border-b border-blue-100 bg-slate-50">
                  <button
                    onClick={() => setActiveMode("url")}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "url"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    🔗 Paste URL
                  </button>

                  <button
                    onClick={() => setActiveMode("description")}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "description"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    📄 Paste Description
                  </button>

                  <button
                    onClick={() => {
                      setActiveMode("file");
                      fileInputRef.current?.click();
                    }}
                    className={`px-5 py-4 text-sm font-extrabold ${
                      activeMode === "file"
                        ? "border-b-4 border-blue-600 bg-white text-blue-600"
                        : "text-gray-500 hover:bg-blue-50"
                    }`}
                  >
                    ☁️ Upload File
                  </button>
                </div>

                <div className="p-7">
                  {activeMode === "url" && (
                    <div>
                      <label className="text-sm font-bold">Job Posting URL</label>
                      <div className="mt-3 flex gap-3">
                        <input
                          value={jobUrl}
                          onChange={(e) => {
                            setJobUrl(e.target.value);
                            setMessage("New job detected. Click Analyze Job to update the page.");
                          }}
                          placeholder="https://www.linkedin.com/jobs/view/1234567890"
                          className="flex-1 rounded-xl border border-blue-100 px-5 py-3 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={handleAnalyze}
                          disabled={isAnalyzing}
                          className="rounded-xl bg-blue-600 px-7 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {isAnalyzing ? "Analyzing..." : "Analyze Job"}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeMode === "description" && (
                    <div>
                      <label className="text-sm font-bold">Full Job Description</label>
                      <textarea
                        rows={9}
                        value={jobDescription}
                        onChange={(e) => {
                          setJobDescription(e.target.value);
                          setMessage("Ready to analyze your new job posting. Click Analyze Job to update the page.");
                        }}
                        placeholder="Paste the full job description here..."
                        className="mt-3 w-full resize-none rounded-xl border border-blue-100 px-5 py-4 text-sm outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        className="mt-4 rounded-xl bg-blue-600 px-7 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {isAnalyzing ? "Analyzing..." : "Analyze Job"}
                      </button>
                    </div>
                  )}

                  {activeMode === "file" && (
                    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-10 text-center">
                      <div className="text-5xl">☁️</div>
                      <h3 className="mt-4 text-xl font-extrabold">
                        Upload a job posting
                      </h3>
                      <p className="mt-2 text-sm text-gray-500">
                        Upload TXT, PDF, DOCX, PNG, JPG, or JPEG.
                      </p>

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-6 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-700"
                      >
                        Choose File
                      </button>

                      {selectedFileName && (
                        <p className="mt-4 text-sm font-bold text-blue-600">
                          Attached: {selectedFileName}
                        </p>
                      )}

                      <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        className="mt-5 rounded-xl border border-blue-600 bg-white px-8 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                      >
                        {isAnalyzing ? "Analyzing..." : "Analyze Uploaded File"}
                      </button>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.pdf,.docx,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={handleFileUpload}
                  />

                  {message && (
                    <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                      {message}
                    </p>
                  )}
                </div>
              </div>

              <section className="mt-6 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-4xl">
                    {analysis.icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold">{analysis.title}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {analysis.company} · {analysis.location} · {analysis.type}
                    </p>
                    <p className="mt-1 text-xs font-bold text-blue-600">
                      {analysis.category}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-gray-100 p-5">
                    <div className="rounded-2xl border border-gray-100 p-5">
  <h3 className="text-3xl font-extrabold text-green-600">
    {generated ? analysis.match : "✨"}
  </h3>

  <p className="mt-1 text-sm font-semibold text-gray-500">
    {generated
      ? "ATS Match"
      : "Generate Full Package to see your ATS Match"}
  </p>
</div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h3 className="text-3xl font-extrabold text-blue-600">
                      {analysis.keywordCount}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Keywords Found</p>
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-5">
                    <h3 className="text-3xl font-extrabold text-purple-600">
                      {analysis.requirementsMatched}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">Requirements Matched</p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                  <h3 className="font-extrabold">Detected Job Summary</h3>
                  <p className="mt-2 text-sm leading-7 text-gray-600">
                    {analysis.summary}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {analysis.keywords.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6">
                  <h3 className="text-xl font-extrabold">Your Saved Application</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    We&apos;ll use your saved Career Memory materials. Generate a tailored package below if you want a stronger version for this specific job.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
  {/* 선택된 Resume */}
  <div className="rounded-2xl border border-gray-100 bg-white p-5">
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl">
        📄
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
          Selected Resume
        </p>

        <h4 className="mt-1 truncate font-extrabold">
          {resumeSelectionStatus === "loading"
            ? "Loading selected resume..."
            : resumeSelectionStatus === "error"
              ? "No resume selected"
              : savedApplicationMaterial?.resume.name ||
                "Loading selected resume..."}
        </h4>

        <p className="mt-2 text-sm leading-6 text-gray-500">
          {resumeSelectionStatus === "error"
            ? "Please select a resume from Dashboard."
            : savedApplicationMaterial?.resume.sourceType === "uploaded"
              ? "The uploaded resume selected on your Dashboard will be used."
              : "Your Career Memory Resume selected on the Dashboard will be used."}
        </p>

        <button
          type="button"
         disabled={
  resumeSelectionStatus !== "ready" ||
  !savedApplicationMaterial?.resume.text?.trim()
}
          onClick={() =>
            setSavedPreviewType("resume")
          }
          className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          👁 Preview
        </button>
      </div>
    </div>
  </div>

  {/* 선택된 Cover Letter */}
  <div className="rounded-2xl border border-gray-100 bg-white p-5">
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-2xl">
        ✉️
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-purple-600">
          Selected Cover Letter
        </p>

        <h4 className="mt-1 truncate font-extrabold">
          {savedApplicationMaterial?.coverLetter.name ||
            "Loading cover letter..."}
        </h4>

        <p className="mt-2 text-sm leading-6 text-gray-500">
          {savedApplicationMaterial?.coverLetter.sourceType === "upload"
            ? "The uploaded cover letter selected on your Dashboard will be used as a writing reference."
            : "No uploaded cover letter is selected. A new job-specific cover letter will be generated automatically."}
        </p>

        <button
          type="button"
          disabled={
  savedApplicationMaterial?.coverLetter.sourceType !==
    "upload" ||
  !savedApplicationMaterial?.coverLetter.text?.trim()
}
          onClick={() =>
            setSavedPreviewType("coverLetter")
          }
          className="mt-3 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          👁 Preview
        </button>
      </div>
    </div>
  </div>
   </div>
                    {analyzed &&
  analysis.jobContext.sector ===
    "federal" && (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-extrabold text-amber-800">
        Federal government
        applications are not
        currently supported.
      </p>

      <p className="mt-2 text-sm leading-6 text-amber-700">
        Career Élan currently
        supports Canadian
        private-sector,
        provincial-government,
        and municipal-government
        job postings.
      </p>
    </div>
  )}

  {analyzed &&
  analysis.jobContext
    .supportedByCareerElan ===
    false &&
  analysis.jobContext.sector !==
    "federal" && (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-extrabold text-amber-800">
        This posting is outside
        the currently supported
        scope.
      </p>

      <p className="mt-2 text-sm leading-6 text-amber-700">
        Career Élan could not
        confirm this as a Canadian
        private-sector,
        provincial-government, or
        municipal-government job
        posting.
      </p>

      {analysis.jobContext
        .classificationReason && (
        <p className="mt-2 text-xs leading-5 text-amber-700">
          {
            analysis.jobContext
              .classificationReason
          }
        </p>
      )}
    </div>
  )}

                  {showDefaultApplication && (
                    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm font-semibold text-blue-700">
                      Your saved application is ready. You can continue to the employer website or generate a stronger AI-tailored package first.
                    </div>
                  )}

                  <button
  type="button"
  onClick={handleGeneratePackage}
  disabled={
    !analyzed ||
    isGenerating ||
    !isSupportedJob ||
    resumeSelectionStatus !== "ready"
  }
  className="mt-6 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-purple-600 to-violet-700 px-6 py-5 text-left text-white shadow-sm transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
>
  <div className="flex min-w-0 items-center gap-4">
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/95 text-2xl text-purple-700">
      ✨
    </div>

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-extrabold">
          {generationPhase === "submitting"
            ? "Submitting Request..."
            : generationPhase === "pending"
              ? "Generating Package..."
              : generationPhase === "poll_timeout"
                ? "Still Generating..."
                : generated
                  ? "✅ Your package is ready"
                  : "Generate Full Package ✨"}
        </h3>

        <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white">
          {generationPhase === "succeeded" ? "100%" : "Recommended"}
        </span>
      </div>

      <p
        className={
          isGenerating || generationPhase === "poll_timeout"
            ? "mt-1 rounded-lg bg-white/95 px-2.5 py-1.5 text-sm font-semibold text-indigo-950"
            : "mt-1 text-sm font-semibold text-white/90"
        }
      >
        {isGenerating
          ? "Package generation usually takes about 1 to 2 minutes."
          : generationPhase === "poll_timeout"
            ? "Your package is still being generated. Please try checking again shortly."
            : "Generate a tailored resume, cover letter, and email draft so you’re ready to apply in minutes."}
      </p>

      {!isGenerating &&
      generationPhase !== "poll_timeout" &&
      generatePackageQuota?.enforced &&
      typeof generatePackageQuota.remaining === "number" ? (
        <p className="mt-1 text-xs font-bold text-white/80">
          {generatePackageQuota.remaining > 0
            ? `${generatePackageQuota.remaining} generation${
                generatePackageQuota.remaining === 1 ? "" : "s"
              } remaining`
            : "No generations remaining"}
        </p>
      ) : null}

      {generationPhase === "failed" && generationErrorInfo ? (
        <div className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-xs font-semibold text-white">
          {generationErrorInfo.message}
        </div>
      ) : null}

      {isGenerating || generationPhase === "poll_timeout" ? (
        <div className="mt-4">
          {(() => {
            const elapsed = progressInfo?.elapsedSeconds ?? 0;
            const isTakingLonger =
              generationPhase === "pending" && elapsed >= 90;
            const isVeryLong =
              generationPhase === "pending" && elapsed >= 120;
            const percent =
              generationPhase === "submitting"
                ? 5
                : (progressInfo?.progress ?? 10);
            const stageLabel =
              generationPhase === "submitting"
                ? "Submitting your request..."
                : generationPhase === "poll_timeout"
                  ? "Still processing on our servers..."
                  : STAGE_LABELS[progressInfo?.stage ?? "queued"];

            return (
              <>
                <div className="flex items-center justify-between gap-4 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-bold text-indigo-950">
                  <span>{stageLabel}</span>
                  <span>
                    {generationPhase === "poll_timeout"
                      ? ""
                      : `${percent}%`}
                  </span>
                </div>

                {/*
                  Real, worker-reported percentage width - never advanced by
                  a client-side timer (see progressInfo's own comment
                  above). The "generating" stage is the one long-running
                  step (the actual OpenAI call), so it additionally gets an
                  animated shimmer overlay layered on top of its real
                  55% width - otherwise the bar would look frozen for
                  however long that step actually takes, which is honest
                  about the percentage but not about "is this still
                  working."
                */}
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
                  <div
                    className={`h-full rounded-full bg-white transition-[width] duration-500 ${
                      progressInfo?.stage === "generating"
                        ? "animate-pulse"
                        : ""
                    }`}
                    style={{
                      width:
                        generationPhase === "poll_timeout"
                          ? "100%"
                          : `${percent}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-950">
                  <span>
                    {generationPhase === "poll_timeout"
                      ? "This is taking longer than usual"
                      : isVeryLong
                        ? "This is taking longer than usual. The server is still working."
                        : isTakingLonger
                          ? "This is taking a bit longer than expected."
                          : "Real-time stage from our servers"}
                  </span>

                  <span className="whitespace-nowrap">
                    {generationPhase === "poll_timeout"
                      ? "You can check back shortly"
                      : generationPhase === "pending"
                        ? `Elapsed: ${formatElapsed(elapsed)}`
                        : "Usually takes 1–3 minutes"}
                  </span>
                </div>

                {generationPhase === "pending" ? (
                  <p className="mt-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-950">
                    You can safely close this tab - generation continues on
                    our servers and your result will be here when you come
                    back.
                  </p>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
            Tailored to this job
          </span>

          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
            AI-optimized content
          </span>

          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
            Apply in minutes
          </span>
        </div>
      )}
    </div>
  </div>

  <span className="ml-4 shrink-0 text-3xl">
    ›
  </span>
</button>

                  <button
                    onClick={handleApplyNow}
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-blue-200 bg-white px-6 py-5 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
                        🛩️
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-extrabold text-gray-900">
                            Apply with Saved Resume
                          </h3>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-600">
                            Quick
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-gray-500">
                          Apply using your saved Career Memory resume and cover letter.
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl text-gray-500">›</span>
                  </button>

                  <button
                    onClick={continueToApply}
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-6 py-5 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl">
                        🌐
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold text-gray-900">
                          Apply on Employer Website ↗
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-gray-500">
                          Review the original job posting and complete your application on the employer's website.
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl text-gray-500">›</span>
                 </button>
                </div>
              </section>
            </section>

            {/* 오른쪽 위: 스크롤을 따라오지 않는 안내 카드 */}
            <aside className="self-start xl:col-span-4">
              <div className="rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <h2 className="text-2xl font-extrabold">
                  What happens next?
                </h2>

                <div className="mt-8 space-y-6">
                  {[
                    [
                      "1",
                      "Analyze the job posting",
                      "AI extracts role details, keywords, and requirements.",
                    ],
                    [
                      "2",
                      "Match with your profile",
                      "Career Élan checks how your background fits.",
                    ],
                    [
                      "3",
                      "Generate full package",
                      "AI creates a tailored resume, cover letter, and email draft.",
                    ],
                    [
                      "4",
                      "You’re ready to apply",
                      "Review, edit, and apply on the employer website in minutes.",
                    ],
                  ].map(([num, title, desc]) => (
                    <div
                      key={num}
                      className="flex gap-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                        {num}
                      </div>

                      <div>
                        <h3 className="font-extrabold">
                          {title}
                        </h3>

                        <p className="mt-1 text-sm leading-6 text-gray-500">
                          {desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 rounded-2xl bg-blue-50 p-5">
                  <h3 className="font-extrabold text-blue-700">
                    💡 Tip
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    A tailored application can help you apply faster and present a stronger profile.
                  </p>
                </div>
              </div>
            </aside>

            {/* 아래: 전체 12칸을 사용하는 Generated Package */}
            <section className="xl:col-span-12 rounded-2xl border border-blue-100 bg-white p-7 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold">Generated Application Package</h2>
                      {generated && (
                        <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">
                          AI-tailored
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Review the original job posting beside your AI-generated application materials.
                    </p>
                  </div>

                  {generated && (
                    <button
                      onClick={savePackage}
                      className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                    >
                      Save Package
                    </button>
                  )}
                </div>

                {!generated && (
                  <div className="mt-6 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-8 text-center">
                    <div className="text-4xl">✨</div>
                    <h3 className="mt-3 text-lg font-extrabold">Generate to unlock the preview workspace</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Your original job posting, tailored resume, cover letter, email draft, and download buttons will appear here.
                    </p>
                  </div>
                )}

                {generated && (
  <div className="mt-6 grid items-start gap-5 xl:grid-cols-12">
    {/* 왼쪽: 원본 채용공고 */}
    <aside className="xl:col-span-3">
      <div className="h-full rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
              📋
            </div>

            <div>
              <h3 className="font-extrabold">
                Original Job Posting
              </h3>

              <p className="text-xs font-semibold text-gray-400">
                Extracted from website
              </p>
            </div>
          </div>
        </div>

        <div className="max-h-[900px] overflow-y-auto p-5">
          <h4 className="text-lg font-extrabold">
            {analysis.title}
          </h4>

          <p className="mt-1 text-sm font-semibold text-gray-500">
            {analysis.company}
          </p>

          <p className="mt-1 text-xs text-gray-400">
            {analysis.location} · {analysis.type} ·{" "}
            {analysis.category}
          </p>

          {jobUrl && (
            <a
              href={
                analysis.jobDetails.applyUrl ||
                jobUrl
              }
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-xl border border-blue-100 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
            >
              View original posting ↗
            </a>
          )}

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <h5 className="text-sm font-extrabold">
              About the Role
            </h5>

            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-600">
              {getOriginalJobSnippet()}
            </p>
          </div>

          {hasJobDetails() && (
            <div className="mt-5 space-y-5">
              {analysis.jobDetails
                .responsibilities.length >
                0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Key Responsibilities
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.responsibilities.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {analysis.jobDetails
                .qualifications.length >
                0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Qualifications
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.qualifications.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {analysis.jobDetails.benefits
                .length > 0 && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <h5 className="text-sm font-extrabold">
                    Benefits
                  </h5>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {analysis.jobDetails.benefits.map(
                      (item) => (
                        <li
                          key={item}
                          className="flex gap-2"
                        >
                          <span className="font-bold text-green-600">
                            ✓
                          </span>

                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {(analysis.jobDetails.salary ||
                analysis.jobDetails
                  .schedule) && (
                <div className="grid gap-3">
                  {analysis.jobDetails
                    .salary && (
                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                      <h5 className="text-sm font-extrabold">
                        Salary / Wage
                      </h5>

                      <p className="mt-2 text-sm leading-6 text-gray-600">
                        {
                          analysis.jobDetails
                            .salary
                        }
                      </p>
                    </div>
                  )}

                  {analysis.jobDetails
                    .schedule && (
                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                      <h5 className="text-sm font-extrabold">
                        Schedule
                      </h5>

                      <p className="mt-2 text-sm leading-6 text-gray-600">
                        {
                          analysis.jobDetails
                            .schedule
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <h5 className="text-sm font-extrabold">
              Keywords Detected
            </h5>

            <div className="mt-3 flex flex-wrap gap-2">
              {(analysis.keywords.length >
              0
                ? analysis.keywords
                : [
                    "Communication",
                    "Organization",
                    "Attention to Detail",
                  ]
              ).map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>

    {/* 가운데: 생성된 Resume / Cover Letter / Email */}
    <section className="xl:col-span-5">
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-extrabold">
                Your Generated Application Package
              </h3>

              <span className="rounded-full bg-purple-50 px-3 py-1 text-[11px] font-bold text-purple-700">
                AI-tailored
              </span>
            </div>

            <p className="mt-1 text-xs font-semibold text-gray-400">
              Click Resume, Cover Letter, or
              Email Draft, then edit the
              content directly.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyPreviewText}
              className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
            >
              Copy
            </button>

            {selectedPreview ===
            "emailDraft" ? (
              <button
                onClick={() =>
                  downloadSelected("txt")
                }
                className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
              >
                Download TXT
              </button>
            ) : (
              <>
                <button
                  onClick={downloadDocx}
                  className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                >
                  Download DOCX
                </button>

                <button
                  onClick={downloadPdf}
                  className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                >
                  Download PDF
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid border-b border-gray-100 md:grid-cols-3">
          {[
            ["resume", "📄", "Resume"],
            [
              "coverLetter",
              "✉️",
              "Cover Letter",
            ],
            [
              "emailDraft",
              "📧",
              "Email Draft",
            ],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              onClick={() =>
                setSelectedPreview(
                  key as PreviewType
                )
              }
              className={`flex items-center gap-3 px-5 py-4 text-left transition ${
                selectedPreview === key
                  ? "bg-blue-50 text-blue-700"
                  : "bg-white text-gray-600 hover:bg-slate-50"
              }`}
            >
              <span className="text-2xl">
                {icon}
              </span>

              <div>
                <p className="font-extrabold">
                  {label}
                </p>

                <p className="text-xs font-semibold text-gray-400">
                  {selectedPreview === key
                    ? "Viewing and editing now"
                    : "Click to preview and edit"}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="h-[900px] overflow-y-auto bg-gray-100 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-2xl">
                {getPreviewIcon()}
              </div>

              <div>
                <h3 className="font-extrabold">
                  {getPreviewLabel()}
                </h3>

                <p className="text-xs font-semibold text-gray-400">
                  Tailored for{" "}
                  {analysis.title} at{" "}
                  {analysis.company}
                </p>
              </div>
            </div>

            {selectedPreview === "resume" && (
              <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setResumeViewMode("preview")}
                  className={`px-3 py-1.5 ${
                    resumeViewMode === "preview"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setResumeViewMode("edit")}
                  className={`px-3 py-1.5 ${
                    resumeViewMode === "edit"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {selectedPreview === "resume" && resumeViewMode === "preview" ? (
            <A4DocumentPreview
              text={packageData.resume}
              templateId={resumeTemplateId}
            />
          ) : selectedPreview ===
          "emailDraft" ? (
            <textarea
              value={
                packageData.emailDraft
              }
              onChange={(event) =>
                setPackageData(
                  (previous) => ({
                    ...previous,
                    emailDraft:
                      event.target.value,
                  })
                )
              }
              className="min-h-[520px] w-full resize-y rounded-2xl border border-gray-100 bg-slate-50 p-6 text-sm leading-7 text-gray-700 outline-none"
            />
          ) : (
            <div className="flex justify-center">
              <A4Preview
                text={
                  packageData[
                    selectedPreview
                  ]
                }
                onChange={(value) =>
                  setPackageData(
                    (previous) => ({
                      ...previous,
                      [selectedPreview]:
                        value,
                    })
                  )
                }
              />
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <button
              onClick={copyPreviewText}
              className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
            >
              Copy
            </button>

            {selectedPreview ===
            "emailDraft" ? (
              <button
                onClick={() =>
                  downloadSelected("txt")
                }
                className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 md:col-span-2"
              >
                Download Email Draft
              </button>
            ) : (
              <>
                <button
                  onClick={downloadDocx}
                  className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                >
                  Download DOCX
                </button>

                <button
                  onClick={downloadPdf}
                  className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
                >
                  Download PDF
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <button
          onClick={savePackage}
          className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
        >
          Save Package
        </button>

        <button
          onClick={continueToApply}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
        >
          Apply on Employer Website ↗
        </button>
      </div>
    </section>

    {/* 오른쪽: AI 분석 카드 */}
    <aside className="xl:col-span-4">
      <PackageAnalysisPanel
        analysis={
          packageData.packageAnalysis
        }
      />
    </aside>
  </div>
)}
              </section>
            
        </div>
        </section>
      </div>
    </main>
    </>
  
);
}
function PackageAnalysisPanel({
  analysis,
}: {
  analysis: PackageAnalysis | null;
}) {
  if (!analysis) {
    return (
      <div className="sticky top-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-extrabold">
          Package Analysis
        </h2>

        <p className="mt-3 text-sm leading-6 text-gray-500">
          AI analysis will appear here after the package is generated.
        </p>
      </div>
    );
  }

  const matchClass =
    analysis.matchLevel === "strong"
      ? "border-green-100 bg-green-50 text-green-700"
      : analysis.matchLevel === "moderate"
        ? "border-blue-100 bg-blue-50 text-blue-700"
        : analysis.matchLevel === "low"
          ? "border-amber-100 bg-amber-50 text-amber-700"
          : "border-red-100 bg-red-50 text-red-700";

  const scoreClass =
    analysis.overallMatch >= 85
      ? "text-green-600"
      : analysis.overallMatch >= 65
        ? "text-blue-600"
        : analysis.overallMatch >= 40
          ? "text-amber-600"
          : "text-red-600";

  const recommendationClass =
    analysis.recommendation
      .applyRecommendation ===
    "recommended"
      ? "border-green-100 bg-green-50 text-green-700"
      : analysis.recommendation
            .applyRecommendation ===
          "not_recommended"
        ? "border-red-100 bg-red-50 text-red-700"
        : "border-purple-100 bg-purple-50 text-purple-700";

  const recommendationLabel =
    analysis.recommendation
      .applyRecommendation ===
    "recommended"
      ? "Recommended"
      : analysis.recommendation
            .applyRecommendation ===
          "not_recommended"
        ? "Not Recommended"
        : "Consider Applying";

  return (
    <div className="sticky top-6 space-y-5">
      {/* Overall Match */}
      <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-blue-600">
          AI Package Analysis
        </p>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p
              className={`text-5xl font-black ${scoreClass}`}
            >
              {analysis.overallMatch}%
            </p>

            <p className="mt-1 text-sm font-bold text-gray-500">
              Overall Match
            </p>
          </div>

          <span
            className={`rounded-full border px-3 py-1 text-xs font-black capitalize ${matchClass}`}
          >
            {analysis.matchLevel.replaceAll(
              "_",
              " "
            )}
          </span>
        </div>
      </div>

      {/* Card 1: Key Changes */}
      <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-xl">
            ✦
          </div>

          <div>
            <h3 className="font-extrabold">
              Key Changes
            </h3>

            <p className="text-xs font-semibold text-gray-400">
              Where, how, and why the resume was changed
            </p>
          </div>
        </div>

        {analysis.keyChanges.length >
        0 ? (
          <div className="mt-4 space-y-4">
            {analysis.keyChanges
              .slice(0, 4)
              .map((change, index) => (
                <div
                  key={`${change.section}-${index}`}
                  className="rounded-xl bg-slate-50 p-4"
                >
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">
                    {change.section ||
                      "Resume Section"}
                  </p>

                  {change.original && (
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        Before
                      </p>

                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        {change.original}
                      </p>
                    </div>
                  )}

                  {change.revised && (
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        After
                      </p>

                      <p className="mt-1 text-xs font-semibold leading-5 text-gray-700">
                        {change.revised}
                      </p>
                    </div>
                  )}

                  {change.reason && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="text-xs leading-5 text-blue-700">
                        {change.reason}
                      </p>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-gray-400">
            No meaningful resume changes were returned.
          </p>
        )}
      </div>

      {/* Card 2: Mismatch */}
      <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xl text-red-600">
            !
          </div>

          <div>
            <h3 className="font-extrabold text-red-700">
              Mismatch & Missing Requirements
            </h3>

            <p className="text-xs font-semibold text-red-500">
              Important gaps that were not hidden
            </p>
          </div>
        </div>

        {analysis.mismatch.summary ? (
          <p className="mt-4 text-sm leading-6 text-red-700">
            {analysis.mismatch.summary}
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-red-400">
            No serious mismatch was identified.
          </p>
        )}

        {analysis.mismatch
          .missingRequirements.length >
          0 && (
          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-wide text-red-600">
              Missing Requirements
            </p>

            <div className="mt-3 space-y-2">
              {analysis.mismatch
                .missingRequirements
                .slice(0, 5)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-red-700"
                  >
                    <span className="font-black">
                      ×
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {analysis.mismatch
          .unsupportedClaims.length >
          0 && (
          <div className="mt-5 border-t border-red-200 pt-4">
            <p className="text-xs font-black uppercase tracking-wide text-amber-700">
              Claims Not Added
            </p>

            <p className="mt-1 text-xs leading-5 text-amber-700">
              These claims were excluded because the source material did not support them.
            </p>

            <div className="mt-3 space-y-2">
              {analysis.mismatch
                .unsupportedClaims
                .slice(0, 4)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-amber-800"
                  >
                    <span className="font-black">
                      •
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Card 3: Matches */}
      <div className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-xl text-green-600">
            ✓
          </div>

          <div>
            <h3 className="font-extrabold">
              Match Strengths
            </h3>

            <p className="text-xs font-semibold text-gray-400">
              Direct matches and realistic transferable skills
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-green-600">
            Strong Matches
          </p>

          {analysis.matches
            .strongMatches.length >
          0 ? (
            <div className="mt-3 space-y-2">
              {analysis.matches
                .strongMatches
                .slice(0, 5)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-green-700"
                  >
                    <span className="font-black text-green-600">
                      ✓
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-400">
              No strong direct matches were identified.
            </p>
          )}
        </div>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-xs font-black uppercase tracking-wide text-blue-600">
            Transferable Skills
          </p>

          {analysis.matches
            .transferableSkills.length >
          0 ? (
            <div className="mt-3 space-y-2">
              {analysis.matches
                .transferableSkills
                .slice(0, 4)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6 text-blue-700"
                  >
                    <span className="font-black text-blue-600">
                      ↗
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-400">
              No transferable skills were identified.
            </p>
          )}
        </div>
      </div>

      {/* Card 4: Recommendation */}
      <div
        className={`rounded-2xl border p-5 shadow-sm ${recommendationClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-extrabold">
              AI Recommendation
            </h3>

            <p className="mt-1 text-xs font-semibold opacity-80">
              Final application decision
            </p>
          </div>

          <span className="rounded-full border border-current/20 bg-white/60 px-3 py-1 text-[11px] font-black">
            {recommendationLabel}
          </span>
        </div>

        {analysis.recommendation
          .summary ? (
          <p className="mt-4 text-sm leading-6">
            {
              analysis.recommendation
                .summary
            }
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 opacity-70">
            No recommendation summary was returned.
          </p>
        )}

        {analysis.recommendation
          .nextSteps.length > 0 && (
          <div className="mt-4 border-t border-current/10 pt-4">
            <p className="text-xs font-black uppercase tracking-wide">
              Next Steps
            </p>

            <div className="mt-3 space-y-2">
              {analysis.recommendation
                .nextSteps
                .slice(0, 3)
                .map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex gap-2 text-sm leading-6"
                  >
                    <span className="font-black">
                      {index + 1}.
                    </span>

                    <span>{item}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisListCard({
  title,
  icon,
  items,
  emptyText,
  itemClassName,
  iconClassName,
}: {
  title: string;
  icon: string;
  items: string[];
  emptyText: string;
  itemClassName: string;
  iconClassName: string;
}) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
      <h3 className="font-extrabold">
        {title}
      </h3>

      <div className="mt-4 space-y-2">
        {items.length > 0 ? (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex gap-2 text-sm leading-6"
            >
              <span
                className={`font-black ${iconClassName}`}
              >
                {icon}
              </span>

              <span className={itemClassName}>
                {item}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-gray-400">
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
}