import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .eq("status", "Applied")
      .lt("followup_email_count", 2)
      .lte("applied_date", sevenDaysAgo.toISOString());

    if (error) throw error;

    if (!applications?.length) {
      return Response.json({
        success: true,
        emailsSent: 0,
      });
    }

    for (const application of applications) {
      const {
        data: { user },
      } = await supabase.auth.admin.getUserById(
        application.user_id
      );

      if (!user?.email) continue;

      // 하루에 한 번만 발송
      const today = new Date().toISOString().slice(0, 10);

      const lastSent = application.last_followup_email_at
        ? new Date(application.last_followup_email_at)
            .toISOString()
            .slice(0, 10)
        : null;

      if (lastSent === today) continue;

      // 최대 2번까지만 발송
      if (application.followup_email_count >= 2) continue;

      await resend.emails.send({
        from: "Career Élan <onboarding@resend.dev>",
        to: user.email,
        subject: "Career Élan - Follow-up Reminder",
        html: `
          <h2>Follow-up Reminder</h2>

          <p>Hello,</p>

          <p>
            It has been <strong>7 days</strong> since you applied for the
            <strong>${application.job_title}</strong> position at
            <strong>${application.company}</strong>.
          </p>

          <p>
            If you haven't received a response yet,
            consider sending a polite follow-up email today.
          </p>

          <p>Thanks,</p>

          <p><strong>Career Élan</strong></p>
        `,
      });

      await supabase
        .from("applications")
        .update({
          followup_email_count:
            application.followup_email_count + 1,
          last_followup_email_at:
            new Date().toISOString(),
        })
        .eq("id", application.id);
    }

    return Response.json({
      success: true,
      emailsSent: applications.length,
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      {
        success: false,
        error: String(error),
      },
      {
        status: 500,
      }
    );
  }
}