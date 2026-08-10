import type { ReactNode } from "react";

export type CareerMemoryWorkItem = {
  company?: string;
  jobTitle?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
};

export type CareerMemoryVolunteerItem = {
  organization?: string;
  role?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
};

export type CareerMemoryEducationItem = {
  school?: string;
  program?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
  coursework?: string;
};

export type CareerMemoryLanguageItem = {
  language?: string;
  level?: string;
};

export type CareerMemoryCertificationItem = {
  name?: string;
  issuer?: string;
  date?: string;
  description?: string;
};

export type CareerMemoryProjectItem = {
  name?: string;
  role?: string;
  dates?: string;
  description?: string;
};

export type CareerMemoryPreviewData = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  headline?: string;
  summary?: string;
  skills?: string | string[];
  workExperience: CareerMemoryWorkItem[];
  volunteerExperience: CareerMemoryVolunteerItem[];
  education: CareerMemoryEducationItem[];
  languages: CareerMemoryLanguageItem[];
  certifications: CareerMemoryCertificationItem[];
  projects: CareerMemoryProjectItem[];
  targetRoles?: string;
  targetIndustry?: string;
  targetLocation?: string;
  salaryExpectation?: string;
  careerGoalSummary?: string;
  resumeTemplate?: string;
  themeColor?: string;
  font?: string;
  textSize?: string;
};

/*
  career_memory DB row -> CareerMemoryPreviewData adapter.

  Top-level DB columns are snake_case, but the array columns (experience,
  volunteer_experience, education, languages, certifications, projects) are
  stored exactly as the wizard's camelCase item shape (see persistMemory()
  in app/career-memory/page.tsx) - only a defensive snake_case fallback is
  needed for legacy rows, matching loadCareerMemory()'s own mapping.
*/
export function mapCareerMemoryRowToPreviewData(
  row: any
): CareerMemoryPreviewData {
  const mapDateFields = <
    T extends { startDate?: string; endDate?: string; isCurrent?: boolean }
  >(
    item: any
  ): T =>
    ({
      ...item,
      startDate: item?.startDate ?? item?.start_date ?? "",
      endDate: item?.endDate ?? item?.end_date ?? "",
      isCurrent: item?.isCurrent ?? item?.is_current ?? false,
    }) as T;

  return {
    firstName: row?.first_name ?? "",
    lastName: row?.last_name ?? "",
    email: row?.email ?? "",
    phone: row?.phone ?? "",
    location: row?.location ?? "",
    linkedin: row?.linkedin ?? "",
    headline: row?.headline ?? "",
    summary: row?.summary ?? "",
    skills: Array.isArray(row?.skills) ? row.skills : row?.skills ?? "",
    workExperience: Array.isArray(row?.experience)
      ? row.experience.map((item: any) => mapDateFields(item))
      : [],
    volunteerExperience: Array.isArray(row?.volunteer_experience)
      ? row.volunteer_experience.map((item: any) => mapDateFields(item))
      : [],
    education: Array.isArray(row?.education)
      ? row.education.map((item: any) => mapDateFields(item))
      : [],
    languages: Array.isArray(row?.languages) ? row.languages : [],
    certifications: Array.isArray(row?.certifications)
      ? row.certifications
      : [],
    projects: Array.isArray(row?.projects) ? row.projects : [],
    targetRoles: Array.isArray(row?.target_roles)
      ? row.target_roles.join(", ")
      : row?.target_roles ?? "",
    targetIndustry: row?.target_industry ?? "",
    targetLocation: row?.target_location ?? "",
    salaryExpectation: row?.salary_expectation ?? "",
    careerGoalSummary: row?.career_goal_summary ?? "",
    resumeTemplate: row?.resume_template ?? "Professional",
    themeColor: row?.theme ?? "Navy",
    font: row?.font ?? "Calibri",
    textSize: row?.text_size ?? "Standard",
  };
}

function formatMonth(value?: string) {
  if (!value) return "";

  const [year, month] = value.split("-");

  if (!year || !month) {
    return value;
  }

  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    "en-CA",
    {
      year: "numeric",
      month: "short",
    }
  );
}

function formatExperienceDates(item: {
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}) {
  const start = formatMonth(item.startDate);

  const end = item.isCurrent ? "Present" : formatMonth(item.endDate);

  return [start, end].filter(Boolean).join(" – ");
}

function formatEducationDates(item: { startDate?: string; endDate?: string }) {
  return [formatMonth(item.startDate), formatMonth(item.endDate)]
    .filter(Boolean)
    .join(" – ");
}

function ResumeSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 text-sm leading-6 text-slate-700">
      <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-[0.16em] text-slate-950">
        {title}
      </h2>
      {children}
    </section>
  );
}

function splitSkills(skills?: string | string[]) {
  return (Array.isArray(skills) ? skills : (skills || "").split(","))
    .map((skill) => String(skill).trim())
    .filter(Boolean);
}

export default function CareerMemoryTemplatePreview({
  data,
}: {
  data: CareerMemoryPreviewData;
}) {
  const template = data.resumeTemplate;
  const accent =
    data.themeColor === "Blue"
      ? "#2563eb"
      : data.themeColor === "Green"
      ? "#16a34a"
      : data.themeColor === "Black"
      ? "#111827"
      : data.themeColor === "Gray"
      ? "#6b7280"
      : "#1e3a8a"; // Navy
  const resumeScale =
    data.textSize === "Small" ? 0.9 : data.textSize === "Large" ? 1.1 : 1;

  if (template === "Professional") {
    return (
      <div
        className="mx-auto max-w-[820px] bg-white shadow-xl"
        style={{
          fontFamily: data.font,
          zoom: resumeScale,
        }}
      >
        <div
          className="border-b-4 px-10 py-9"
          style={{
            borderColor: accent,
          }}
        >
          <h1 className="break-words text-4xl font-black leading-tight text-slate-950">
            {data.firstName || "First"} {data.lastName || "Last"}
          </h1>

          {data.headline && (
            <p className="mt-3 break-words text-lg font-semibold text-slate-600">
              {data.headline}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-slate-500">
            {data.location && <span>{data.location}</span>}

            {data.email && (
              <>
                {data.location && <span>•</span>}
                <span className="break-all">{data.email}</span>
              </>
            )}

            {data.phone && (
              <>
                {(data.location || data.email) && <span>•</span>}
                <span>{data.phone}</span>
              </>
            )}

            {data.linkedin && (
              <>
                {(data.location || data.email || data.phone) && (
                  <span>•</span>
                )}
                <span className="break-all">{data.linkedin}</span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-10 px-10 py-8">
          <aside
            className="min-w-0 border-r pr-8"
            style={{
              borderColor: accent,
            }}
          >
            <ResumeSection title="Skills">
              <div className="space-y-2">
                {splitSkills(data.skills).map((skill, index) => (
                  <p key={index} className="break-words">
                    • {skill}
                  </p>
                ))}
              </div>
            </ResumeSection>

            {data.languages.some((item) => item.language?.trim()) && (
              <ResumeSection title="Languages">
                {data.languages
                  .filter((item) => item.language)
                  .map((item, index) => (
                    <div key={index} className="mb-3">
                      <p className="break-words font-medium">
                        {item.language}
                      </p>

                      <p className="text-sm text-slate-500">{item.level}</p>
                    </div>
                  ))}
              </ResumeSection>
            )}

            {data.certifications.some((item) => item.name?.trim()) && (
              <ResumeSection title="Certifications">
                {data.certifications
                  .filter((item) => item.name)
                  .map((item, index) => (
                    <div key={index} className="mb-4">
                      <h3 className="break-words font-bold">{item.name}</h3>

                      {item.date && (
                        <p className="text-sm text-slate-500">{item.date}</p>
                      )}

                      <p className="break-words text-slate-500">
                        {item.issuer}
                      </p>

                      {item.description && (
                        <p className="mt-2 break-words">
                          {item.description}
                        </p>
                      )}
                    </div>
                  ))}
              </ResumeSection>
            )}
          </aside>

          <div className="min-w-0">
            <ResumeSection title="Professional Summary">
              <p className="break-words">{data.summary}</p>
            </ResumeSection>

            <ResumeSection title="Experience">
              {data.workExperience
                .filter((item) => item.company || item.jobTitle)
                .map((item, index) => (
                  <div key={index} className="mb-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <h3 className="break-words font-bold">
                        {item.jobTitle}
                      </h3>

                      <span className="shrink-0 text-sm text-slate-500">
                        {formatExperienceDates(item)}
                      </span>
                    </div>

                    <p className="mb-2 break-words text-slate-500">
                      {item.company}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>

                    <ul className="list-disc space-y-2 pl-6">
                      {String(item.description || "")
                        .split(/\r?\n|•/)
                        .filter(Boolean)
                        .map((line, lineIndex) => (
                          <li key={lineIndex} className="break-words">
                            {line.trim()}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}

              {data.volunteerExperience.some(
                (item) => item.organization || item.role || item.description
              ) && (
                <div className="mt-7">
                  <h3 className="mb-5 text-sm font-black uppercase tracking-[0.12em] text-slate-950">
                    Volunteer / Internship
                  </h3>

                  {data.volunteerExperience
                    .filter(
                      (item) =>
                        item.organization || item.role || item.description
                    )
                    .map((item, index) => (
                      <div key={index} className="mb-6">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <h3 className="break-words font-bold">
                            {item.role}
                          </h3>

                          <span className="shrink-0 text-sm text-slate-500">
                            {formatExperienceDates(item)}
                          </span>
                        </div>

                        <p className="mb-2 break-words text-slate-500">
                          {item.organization}
                          {item.location ? ` · ${item.location}` : ""}
                        </p>

                        <ul className="list-disc space-y-2 pl-6">
                          {String(item.description || "")
                            .split(/\r?\n|•/)
                            .filter(Boolean)
                            .map((line, lineIndex) => (
                              <li key={lineIndex} className="break-words">
                                {line.trim()}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </ResumeSection>

            {data.projects.some((item) => item.name?.trim()) && (
              <ResumeSection title="Projects">
                {data.projects
                  .filter((item) => item.name)
                  .map((item, index) => (
                    <div key={index} className="mb-5">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <h3 className="break-words font-bold">{item.name}</h3>

                        <span className="shrink-0 text-sm text-slate-500">
                          {item.dates}
                        </span>
                      </div>

                      <p className="break-words text-slate-500">
                        {item.role}
                      </p>

                      <p className="mt-2 break-words">{item.description}</p>
                    </div>
                  ))}
              </ResumeSection>
            )}

            {data.education.some((item) => item.school || item.program) && (
              <ResumeSection title="Education">
                {data.education.map((item, index) => (
                  <div key={index} className="mb-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <h3 className="break-words font-bold">
                        {item.program}
                      </h3>

                      <span className="shrink-0 text-sm text-slate-500">
                        {formatEducationDates(item)}
                      </span>
                    </div>

                    <p className="break-words">{item.school}</p>

                    {item.gpa && (
                      <p className="mt-1 text-sm text-slate-500">
                        GPA / Honours: {item.gpa}
                      </p>
                    )}

                    {item.coursework && (
                      <p className="mt-2 break-words text-sm">
                        {item.coursework}
                      </p>
                    )}
                  </div>
                ))}
              </ResumeSection>
            )}

            {(data.targetRoles ||
              data.targetIndustry ||
              data.targetLocation ||
              data.salaryExpectation ||
              data.careerGoalSummary) && (
              <ResumeSection title="Career Objective">
                {data.targetRoles && (
                  <p className="mb-2 break-words">
                    <strong>Target Role:</strong> {data.targetRoles}
                  </p>
                )}

                {data.targetIndustry && (
                  <p className="mb-2 break-words">
                    <strong>Industry:</strong> {data.targetIndustry}
                  </p>
                )}

                {data.targetLocation && (
                  <p className="mb-2 break-words">
                    <strong>Preferred Location:</strong> {data.targetLocation}
                  </p>
                )}

                {data.salaryExpectation && (
                  <p className="mb-2 break-words">
                    <strong>Salary Expectation:</strong>{" "}
                    {data.salaryExpectation}
                  </p>
                )}

                {data.careerGoalSummary && (
                  <p className="mt-3 break-words">{data.careerGoalSummary}</p>
                )}
              </ResumeSection>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (template === "Creative") {
    return (
      <div
        className="mx-auto max-w-[760px] bg-white shadow-xl"
        style={{
          fontFamily: data.font,
          zoom: resumeScale,
        }}
      >
        <div
          className="p-10 text-white"
          style={{
            backgroundColor: accent,
          }}
        >
          <h1 className="text-5xl font-black">
            {data.firstName} {data.lastName}
          </h1>

          <p className="mt-3">
            {data.location} • {data.email} • {data.phone}
          </p>
        </div>

        <div className="p-10">
          <ResumeSection title="Profile">
            <p>{data.summary}</p>
          </ResumeSection>

          <ResumeSection title="Skills">
            <div className="mt-3 flex flex-wrap gap-2">
              {splitSkills(data.skills).map((skill, index) => (
                <span
                  key={index}
                  className="rounded-full px-3 py-1 text-sm font-medium"
                  style={{
                    backgroundColor: `${accent}20`,
                    color: accent,
                  }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </ResumeSection>

          <ResumeSection title="Experience">
            {data.workExperience
              .filter((item) => item.company || item.jobTitle)
              .map((item, index) => (
                <div
                  key={index}
                  className="mb-8 border-l-4 pl-5"
                  style={{
                    borderColor: accent,
                  }}
                >
                  <div className="flex justify-between">
                    <h3 className="text-lg font-bold">{item.jobTitle}</h3>

                    {formatExperienceDates(item)}
                  </div>

                  <p className="mb-2 text-slate-500">{item.company}</p>

                  <ul className="list-disc space-y-2 pl-6">
                    {String(item.description || "")
                      .split(/\r?\n|•/)
                      .filter(Boolean)
                      .map((line, lineIndex) => (
                        <li key={lineIndex}>{line.trim()}</li>
                      ))}
                  </ul>
                </div>
              ))}
          </ResumeSection>

          {data.projects.some((item) => item.name?.trim()) && (
            <ResumeSection title="Projects">
              {data.projects
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-5">
                    <div className="flex justify-between">
                      <h3 className="font-bold">{item.name}</h3>

                      <span>{item.dates}</span>
                    </div>

                    <p className="text-slate-500">{item.role}</p>

                    <p className="mt-2">{item.description}</p>
                  </div>
                ))}
            </ResumeSection>
          )}

          {data.education.some((item) => item.school || item.program) && (
            <ResumeSection title="Education">
              {data.education.map((item, index) => (
                <div key={index} className="mb-4">
                  <h3 className="font-bold">{item.program}</h3>

                  <p>{item.school}</p>

                  <p className="text-sm text-slate-500">
                    {formatEducationDates(item)}
                  </p>

                  {item.gpa && (
                    <p className="mt-1 text-sm text-slate-500">
                      GPA / Honours: {item.gpa}
                    </p>
                  )}

                  {item.coursework && (
                    <p className="mt-2 text-sm">{item.coursework}</p>
                  )}
                </div>
              ))}
            </ResumeSection>
          )}

          {data.languages.some((item) => item.language?.trim()) && (
            <ResumeSection title="Languages">
              {data.languages
                .filter((item) => item.language)
                .map((item, index) => (
                  <div key={index} className="mb-2 flex justify-between">
                    <span className="font-medium">{item.language}</span>

                    <span className="text-slate-500">{item.level}</span>
                  </div>
                ))}
            </ResumeSection>
          )}

          {data.certifications.some((item) => item.name?.trim()) && (
            <ResumeSection title="Certifications">
              {data.certifications
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-4">
                    <div className="flex justify-between">
                      <h3 className="font-bold">{item.name}</h3>

                      <span>{item.date}</span>
                    </div>

                    <p className="text-slate-500">{item.issuer}</p>

                    {item.description && (
                      <p className="mt-2">{item.description}</p>
                    )}
                  </div>
                ))}
            </ResumeSection>
          )}

          {(data.targetRoles ||
            data.targetIndustry ||
            data.targetLocation ||
            data.salaryExpectation ||
            data.careerGoalSummary) && (
            <ResumeSection title="Career Objective">
              <p className="mb-2">
                <strong>Target Role:</strong> {data.targetRoles}
              </p>

              <p className="mb-2">
                <strong>Industry:</strong> {data.targetIndustry}
              </p>

              <p className="mb-2">
                <strong>Preferred Location:</strong> {data.targetLocation}
              </p>

              <p className="mb-2">
                <strong>Salary Expectation:</strong> {data.salaryExpectation}
              </p>

              {data.careerGoalSummary && (
                <p className="mt-3">{data.careerGoalSummary}</p>
              )}
            </ResumeSection>
          )}
        </div>
      </div>
    );
  }

  if (template === "Modern") {
    const ModernSection = ({
      title,
      children,
    }: {
      title: string;
      children: ReactNode;
    }) => (
      <section className="mt-7 text-sm leading-6 text-slate-700">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: accent }}
          />
          {title}
        </h2>
        {children}
      </section>
    );

    return (
      <div
        className="mx-auto min-h-[960px] w-full max-w-[760px] bg-white shadow-xl"
        style={{
          fontFamily: data.font,
          zoom: resumeScale,
        }}
      >
        <div
          className="px-8 py-9 text-white sm:px-10"
          style={{ backgroundColor: accent }}
        >
          <h1 className="break-words text-3xl font-bold tracking-tight sm:text-4xl">
            {data.firstName || "First"} {data.lastName || "Last"}
          </h1>

          {data.headline && (
            <p className="mt-2 break-words text-base font-medium text-white/90">
              {data.headline}
            </p>
          )}

          <p className="mt-3 break-words text-sm text-white/80">
            {data.location || "Location"} ·{" "}
            {data.email || "email@example.com"} · {data.phone || "Phone"} ·{" "}
            {data.linkedin || "LinkedIn "}
          </p>
        </div>

        <div className="px-8 py-8 sm:px-10">
          <ModernSection title="Professional Summary">
            <p>
              {data.summary || "Your professional summary will appear here."}
            </p>
          </ModernSection>

          <ModernSection title="Skills">
            <div className="mt-3 flex flex-wrap gap-2">
              {splitSkills(data.skills).map((skill, index) => (
                <span
                  key={index}
                  className="rounded-md border px-3 py-1 text-sm font-medium"
                  style={{ borderColor: accent, color: accent }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </ModernSection>

          <ModernSection title="Experience">
            {data.workExperience
              .filter(
                (item) => item.company || item.jobTitle || item.description
              )
              .map((item, index) => (
                <div key={`work-${index}`} className="mb-5">
                  <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                    <p className="font-bold text-slate-950">
                      {item.jobTitle || "Role Title"}
                    </p>

                    <p className="text-sm text-slate-500">
                      {formatExperienceDates(item) || "Dates"}
                    </p>
                  </div>

                  <p className="font-semibold" style={{ color: accent }}>
                    {item.company || "Company Name"}
                    {item.location ? ` · ${item.location}` : ""}
                  </p>

                  <ul className="mt-2 list-disc space-y-2 pl-6">
                    {(
                      item.description || "Experience details will appear here."
                    )
                      .split(/\r?\n|•/)
                      .filter((line) => line.trim())
                      .map((line, lineIndex) => (
                        <li key={lineIndex}>{line.trim()}</li>
                      ))}
                  </ul>
                </div>
              ))}

            {data.volunteerExperience
              .filter(
                (item) => item.organization || item.role || item.description
              )
              .map((item, index) => (
                <div key={`vol-${index}`} className="mb-5">
                  <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                    <p className="font-bold text-slate-950">
                      {item.role || "Volunteer / Internship "}
                    </p>

                    <p className="text-sm text-slate-500">
                      {formatExperienceDates(item) || "Dates"}
                    </p>
                  </div>

                  <p className="font-semibold" style={{ color: accent }}>
                    {item.organization || "Organization"}
                  </p>

                  <ul className="mt-2 list-disc space-y-2 pl-6">
                    {(
                      item.description || "Experience details will appear here."
                    )
                      .split(/\r?\n|•/)
                      .filter((line) => line.trim())
                      .map((line, lineIndex) => (
                        <li key={lineIndex}>{line.trim()}</li>
                      ))}
                  </ul>
                </div>
              ))}
          </ModernSection>

          {data.projects.some((item) => item.name?.trim()) && (
            <ModernSection title="Projects">
              {data.projects
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-5">
                    <div className="flex justify-between">
                      <h3 className="font-bold">{item.name}</h3>

                      <span>{item.dates}</span>
                    </div>

                    <p className="text-slate-500">{item.role}</p>

                    <p className="mt-2">{item.description}</p>
                  </div>
                ))}
            </ModernSection>
          )}

          {data.education.some((item) => item.school || item.program) && (
            <ModernSection title="Education">
              {data.education
                .filter((item) => item.school || item.program)
                .map((item, index) => (
                  <div key={index} className="mb-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                      <p className="font-bold text-slate-950">
                        {item.program}
                      </p>

                      <p className="text-sm text-slate-500">
                        {formatEducationDates(item) || "Dates"}
                      </p>
                    </div>

                    <p className="font-semibold" style={{ color: accent }}>
                      {item.school}
                    </p>

                    {item.gpa && (
                      <p className="mt-1 text-sm text-slate-600">
                        GPA / Honours: {item.gpa}
                      </p>
                    )}

                    {item.coursework && (
                      <p className="mt-1 text-slate-600">{item.coursework}</p>
                    )}
                  </div>
                ))}
            </ModernSection>
          )}

          {data.languages.some((item) => item.language?.trim()) && (
            <ModernSection title="Languages">
              {data.languages
                .filter((item) => item.language)
                .map((item, index) => (
                  <div key={index} className="mb-2 flex justify-between">
                    <span className="font-medium">{item.language}</span>

                    <span className="text-slate-500">{item.level}</span>
                  </div>
                ))}
            </ModernSection>
          )}

          {data.certifications.some((item) => item.name?.trim()) && (
            <ModernSection title="Certifications">
              {data.certifications
                .filter((item) => item.name)
                .map((item, index) => (
                  <div key={index} className="mb-4">
                    <div className="flex justify-between">
                      <h3 className="font-bold">{item.name}</h3>

                      <span>{item.date}</span>
                    </div>

                    <p className="text-slate-500">{item.issuer}</p>

                    {item.description && (
                      <p className="mt-2">{item.description}</p>
                    )}
                  </div>
                ))}
            </ModernSection>
          )}

          {(data.targetRoles ||
            data.targetIndustry ||
            data.targetLocation ||
            data.salaryExpectation ||
            data.careerGoalSummary) && (
            <ModernSection title="Career Objective">
              {data.targetRoles && (
                <p className="mb-2">
                  <strong>Target Role:</strong> {data.targetRoles}
                </p>
              )}

              {data.targetIndustry && (
                <p className="mb-2">
                  <strong>Industry:</strong> {data.targetIndustry}
                </p>
              )}

              {data.targetLocation && (
                <p className="mb-2">
                  <strong>Preferred Location:</strong> {data.targetLocation}
                </p>
              )}

              {data.salaryExpectation && (
                <p className="mb-2">
                  <strong>Salary:</strong> {data.salaryExpectation}
                </p>
              )}

              {data.careerGoalSummary && (
                <p className="mt-3">{data.careerGoalSummary}</p>
              )}
            </ModernSection>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto min-h-[960px] w-full max-w-[760px] bg-white p-8 shadow-xl sm:p-10"
      style={{
        fontFamily: data.font,
        zoom: resumeScale,
      }}
    >
      <div
        className="border-b-4 pb-5"
        style={{
          borderColor: accent,
        }}
      >
        <h1 className="break-words text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          {data.firstName || "First"} {data.lastName || "Last"}
        </h1>

        <p className="mt-3 break-words text-sm text-slate-500">
          {data.location || "Location"} · {data.email || "email@example.com"}{" "}
          · {data.phone || "Phone"} · {data.linkedin || "LinkedIn "}
        </p>
      </div>

      <ResumeSection title="Professional Summary">
        <p>{data.summary || "Your professional summary will appear here."}</p>
      </ResumeSection>

      <ResumeSection title="Skills">
        <div className="mt-3 flex flex-wrap gap-2">
          {splitSkills(data.skills).map((skill, index) => (
            <span
              key={index}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium"
            >
              {skill}
            </span>
          ))}
        </div>
      </ResumeSection>

      <ResumeSection title="Experience">
        {data.workExperience
          .filter((item) => item.company || item.jobTitle || item.description)
          .map((item, index) => (
            <div key={`work-${index}`} className="mb-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <p className="font-black text-slate-950">
                  {item.jobTitle || "Role Title"}
                </p>

                <p className="text-sm text-slate-500">
                  {formatExperienceDates(item) || "Dates"}
                </p>
              </div>

              <p className="font-bold text-slate-700">
                {item.company || "Company Name"}
                {item.location ? ` · ${item.location}` : ""}
              </p>

              <ul className="mt-2 list-disc space-y-2 pl-6">
                {(item.description || "Experience details will appear here.")
                  .split(/\r?\n|•/)
                  .filter((line) => line.trim())
                  .map((line, lineIndex) => (
                    <li key={lineIndex}>{line.trim()}</li>
                  ))}
              </ul>
            </div>
          ))}

        {data.volunteerExperience
          .filter(
            (item) => item.organization || item.role || item.description
          )
          .map((item, index) => (
            <div key={`vol-${index}`} className="mb-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                <p className="font-black text-slate-950">
                  {item.role || "Volunteer / Internship "}
                </p>

                <p className="text-sm text-slate-500">
                  {formatExperienceDates(item) || "Dates"}
                </p>
              </div>

              <p className="font-bold text-slate-700">
                {item.organization || "Organization"}
              </p>

              <ul className="mt-2 list-disc space-y-2 pl-6">
                {(item.description || "Experience details will appear here.")
                  .split(/\r?\n|•/)
                  .filter((line) => line.trim())
                  .map((line, lineIndex) => (
                    <li key={lineIndex}>{line.trim()}</li>
                  ))}
              </ul>
            </div>
          ))}
      </ResumeSection>

      {data.projects.some((item) => item.name?.trim()) && (
        <ResumeSection title="Projects">
          {data.projects
            .filter((item) => item.name)
            .map((item, index) => (
              <div key={index} className="mb-5">
                <div className="flex justify-between">
                  <h3 className="font-bold">{item.name}</h3>

                  <span>{item.dates}</span>
                </div>

                <p className="text-slate-500">{item.role}</p>

                <p className="mt-2">{item.description}</p>
              </div>
            ))}
        </ResumeSection>
      )}

      {data.education.some((item) => item.school || item.program) && (
        <ResumeSection title="Education">
          {data.education
            .filter((item) => item.school || item.program)
            .map((item, index) => (
              <div key={index} className="mb-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                  <p className="font-black text-slate-950">{item.program}</p>

                  <p className="text-sm text-slate-500">
                    {formatExperienceDates(item) || "Dates"}
                  </p>
                </div>

                <p className="font-bold text-slate-700">{item.school}</p>

                {item.gpa && (
                  <p className="mt-1 text-sm text-slate-600">
                    GPA / Honours: {item.gpa}
                  </p>
                )}

                {item.coursework && (
                  <p className="mt-1 text-slate-600">{item.coursework}</p>
                )}
              </div>
            ))}
        </ResumeSection>
      )}

      {data.languages.some((item) => item.language?.trim()) && (
        <ResumeSection title="Languages">
          {data.languages
            .filter((item) => item.language)
            .map((item, index) => (
              <div key={index} className="mb-2 flex justify-between">
                <span className="font-medium">{item.language}</span>

                <span className="text-slate-500">{item.level}</span>
              </div>
            ))}
        </ResumeSection>
      )}

      {data.certifications.some((item) => item.name?.trim()) && (
        <ResumeSection title="Certifications">
          {data.certifications
            .filter((item) => item.name)
            .map((item, index) => (
              <div key={index} className="mb-4">
                <div className="flex justify-between">
                  <h3 className="font-bold">{item.name}</h3>

                  <span>{item.date}</span>
                </div>

                <p className="text-slate-500">{item.issuer}</p>

                {item.description && (
                  <p className="mt-2">{item.description}</p>
                )}
              </div>
            ))}
        </ResumeSection>
      )}

      {(data.targetRoles ||
        data.targetIndustry ||
        data.targetLocation ||
        data.salaryExpectation ||
        data.careerGoalSummary) && (
        <ResumeSection title="Career Objective">
          {data.targetRoles && (
            <p className="mb-2">
              <strong>Target Role:</strong> {data.targetRoles}
            </p>
          )}

          {data.targetIndustry && (
            <p className="mb-2">
              <strong>Industry:</strong> {data.targetIndustry}
            </p>
          )}

          {data.targetLocation && (
            <p className="mb-2">
              <strong>Preferred Location:</strong> {data.targetLocation}
            </p>
          )}

          {data.salaryExpectation && (
            <p className="mb-2">
              <strong>Salary:</strong> {data.salaryExpectation}
            </p>
          )}

          {data.careerGoalSummary && (
            <p className="mt-3">{data.careerGoalSummary}</p>
          )}
        </ResumeSection>
      )}
    </div>
  );
}
