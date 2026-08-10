/*
  Phase 6I.6.37 - Product Usage tab: adoption funnel, template
  distribution, Generate Package usage buckets. Aggregate-only,
  initial product analytics per Part J - not a BI platform.
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { listAllAuthUsers, startOfUtcMonth } from "./shared";

export type FunnelStep = { label: string; count: number; pctOfPrevious: number | null; pctOfRegistered: number };

export type ProductUsageMetrics = {
  funnel: FunnelStep[];
  templateDistribution: { templateId: string; count: number }[];
  generateUsageBuckets: { bucket: "0" | "1" | "2" | "3+"; count: number }[];
  averagePerActiveGenerator: number;
  applicationsByStatus: { status: string; count: number }[];
};

export async function getProductUsageMetrics(): Promise<ProductUsageMetrics> {
  const monthStart = startOfUtcMonth().toISOString();

  const [authUsers, { data: cmRows }, { data: resumeUserRows }, { data: analyzedJobRows }, { data: genRows }, { data: trackerRows }, { data: templateRows }, { data: statusRows }] =
    await Promise.all([
      listAllAuthUsers(),
      supabaseAdmin.from("career_memory").select("user_id").eq("required_completed", true),
      supabaseAdmin.from("resumes").select("user_id"),
      supabaseAdmin.from("applications").select("user_id").not("job_analysis", "is", null),
      supabaseAdmin.from("applications").select("user_id").not("generation_status", "is", null),
      supabaseAdmin.from("applications").select("user_id"),
      supabaseAdmin.from("applications").select("selected_template_id").not("selected_template_id", "is", null).gte("created_at", monthStart),
      supabaseAdmin.from("applications").select("status").not("status", "is", null),
    ]);

  const registered = authUsers.length;
  const careerMemoryUsers = new Set((cmRows ?? []).map((r) => r.user_id)).size;
  const resumeUsers = new Set((resumeUserRows ?? []).map((r) => r.user_id)).size;
  const analyzedUsers = new Set((analyzedJobRows ?? []).map((r) => r.user_id)).size;
  const generatedUsers = new Set((genRows ?? []).map((r) => r.user_id)).size;
  const trackerUsers = new Set((trackerRows ?? []).map((r) => r.user_id)).size;

  const steps: { label: string; count: number }[] = [
    { label: "Registered", count: registered },
    { label: "Career Memory Completed", count: careerMemoryUsers },
    { label: "Resume Uploaded", count: resumeUsers },
    { label: "Job Analyzed", count: analyzedUsers },
    { label: "Generate Package Used", count: generatedUsers },
    { label: "Application / Job Tracker Used", count: trackerUsers },
  ];

  const funnel: FunnelStep[] = steps.map((step, i) => ({
    label: step.label,
    count: step.count,
    pctOfPrevious: i === 0 ? null : steps[i - 1].count > 0 ? Math.round((step.count / steps[i - 1].count) * 1000) / 10 : 0,
    pctOfRegistered: registered > 0 ? Math.round((step.count / registered) * 1000) / 10 : 0,
  }));

  const templateCounts = new Map<string, number>();
  for (const row of templateRows ?? []) {
    const id = row.selected_template_id as string;
    templateCounts.set(id, (templateCounts.get(id) ?? 0) + 1);
  }
  const templateDistribution = Array.from(templateCounts.entries()).map(([templateId, count]) => ({ templateId, count }));

  // genRows above is all-time (for the funnel step); usage buckets need
  // THIS MONTH specifically, queried separately.
  const monthlyPerUser = new Map<string, number>();
  const { data: genThisMonthRows } = await supabaseAdmin
    .from("applications")
    .select("user_id")
    .not("generation_status", "is", null)
    .gte("created_at", monthStart);
  for (const row of genThisMonthRows ?? []) {
    monthlyPerUser.set(row.user_id, (monthlyPerUser.get(row.user_id) ?? 0) + 1);
  }

  let bucket0 = registered - monthlyPerUser.size;
  let bucket1 = 0;
  let bucket2 = 0;
  let bucket3Plus = 0;
  let totalGenerations = 0;
  for (const count of monthlyPerUser.values()) {
    totalGenerations += count;
    if (count === 1) bucket1++;
    else if (count === 2) bucket2++;
    else bucket3Plus++;
  }
  if (bucket0 < 0) bucket0 = 0;

  const statusCounts = new Map<string, number>();
  for (const row of statusRows ?? []) {
    const status = row.status as string;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  return {
    funnel,
    templateDistribution,
    generateUsageBuckets: [
      { bucket: "0", count: bucket0 },
      { bucket: "1", count: bucket1 },
      { bucket: "2", count: bucket2 },
      { bucket: "3+", count: bucket3Plus },
    ],
    averagePerActiveGenerator: monthlyPerUser.size > 0 ? Math.round((totalGenerations / monthlyPerUser.size) * 100) / 100 : 0,
    applicationsByStatus: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
  };
}
