import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy | Career Élan",
  description:
    "Learn how Career Élan collects, uses, and protects your information — including how your resume and job data are processed by AI to generate career materials.",
};

const LAST_UPDATED = "July 26, 2026";

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <p>
        Career Élan (&ldquo;<strong>Career Élan</strong>,&rdquo;
        &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo;
        or &ldquo;<strong>our</strong>&rdquo;) provides an AI-powered career
        platform, including resume generation, cover letter generation,
        email drafting, ATS analysis, and related career tools (the
        &ldquo;<strong>Service</strong>&rdquo;). This Privacy Policy explains
        what information we collect, how we use it, who we share it with,
        and the choices you have.
      </p>

      <p>
        By creating an account or using the Service, you agree to the
        collection and use of information as described in this Privacy
        Policy. If you do not agree, please do not use the Service.
      </p>

      <hr />

      <h2>1. Information We Collect</h2>
      <p>We collect the following categories of information:</p>

      <h3>1.1 Account Information</h3>
      <p>
        When you create an account, we collect your name, email address,
        and password (stored in hashed form, never in plain text), or — if
        you sign in with Google or Facebook — the basic profile information
        those providers share with us (typically name, email address, and
        profile picture).
      </p>

      <h3>1.2 Career Information You Provide</h3>
      <p>
        To generate resumes, cover letters, email drafts, and ATS analysis,
        we collect the information you choose to give us, which may
        include:
      </p>
      <ul>
        <li>
          Work history, education, skills, and career preferences
          (&ldquo;<strong>Career Memory</strong>&rdquo;)
        </li>
        <li>Resumes and cover letters you upload</li>
        <li>Job descriptions and job posting URLs you submit for analysis</li>
        <li>Any other career-related content you enter into the Service</li>
      </ul>
      <p>
        This information can include personal details you choose to include
        in your career materials (for example, your name, contact details,
        and employment history). You control what you submit — please avoid
        including sensitive information (such as government ID numbers,
        health information, or financial account numbers) that is not
        necessary for the Service to function.
      </p>

      <h3>1.3 Usage Information</h3>
      <p>
        We automatically collect limited technical information when you use
        the Service, such as your IP address, browser type, device
        information, pages visited, and timestamps of activity. This helps
        us operate, secure, and improve the Service.
      </p>

      <h3>1.4 Cookies</h3>
      <p>
        We use cookies and similar technologies for authentication, session
        management, and security. See our{" "}
        <Link href="/cookies">Cookie Policy</Link> for details.
      </p>

      <h3>1.5 Subscription and Billing Information (If Applicable)</h3>
      <p>
        Career Élan does not currently charge for access to the Service,
        and we do not currently collect or process payment information. If
        we introduce a paid subscription plan in the future, a third-party
        payment processor will collect and process your payment details
        (such as card information) directly —{" "}
        <strong>
          Career Élan will not store your full payment card number
        </strong>{" "}
        — and we will update this section before any billing information is
        collected.
      </p>

      <hr />

      <h2>2. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>
          Provide, operate, and maintain the Service, including generating
          your requested resumes, cover letters, email drafts, and ATS
          analysis
        </li>
        <li>Create and manage your account</li>
        <li>
          Process subscription payments and manage billing, if and when
          paid plans are introduced
        </li>
        <li>
          Communicate with you about your account, updates, or support
          requests
        </li>
        <li>
          Monitor, secure, and improve the Service, including detecting and
          preventing fraud or abuse
        </li>
        <li>Comply with legal obligations</li>
      </ul>
      <p>
        We do not use your career information to make employment, hiring,
        or immigration decisions — those decisions are made by third
        parties (such as employers) outside of the Service.
      </p>

      <hr />

      <h2>3. AI Processing and Third-Party AI Providers</h2>
      <p>
        Career Élan uses artificial intelligence, provided by trusted
        third-party AI providers (currently OpenAI), to generate the
        resumes, cover letters, email drafts, and ATS analysis you request.
      </p>
      <p>
        To generate this content, the relevant information you submit —
        such as your resume text, Career Memory details, and the job
        description you are applying to —{" "}
        <strong>
          may be securely transmitted to our AI provider solely for the
          purpose of generating the content you requested.
        </strong>
      </p>
      <p>Important points about this processing:</p>
      <ul>
        <li>
          We select AI providers that we believe apply reasonable data
          protection standards, but{" "}
          <strong>
            their processing of your data is governed by their own terms of
            service and privacy policies
          </strong>
          , which we encourage you to review.
        </li>
        <li>
          We do not control, and cannot guarantee, how a third-party AI
          provider internally handles, retains, or uses data submitted
          through their API, beyond what their own published policies
          state.
        </li>
        <li>
          AI-generated output is produced algorithmically and may contain
          errors, omissions, or inaccuracies. See our{" "}
          <Link href="/terms">Terms of Service</Link> for important
          disclaimers about AI-generated content.
        </li>
      </ul>

      <hr />

      <h2>4. Authentication Providers</h2>
      <p>
        If you choose to sign in using Google or Facebook, those providers
        will share limited profile information with us (such as your name,
        email address, and profile picture) so we can create and
        authenticate your account. We do not receive your password for
        those services. Your use of Google or Facebook sign-in is also
        subject to those providers&rsquo; own privacy policies.
      </p>
      <p>
        We use Supabase to provide authentication and database
        infrastructure. Supabase processes your account and career
        information on our behalf, under contractual terms that limit its
        use of your data to providing services to us.
      </p>

      <hr />

      <h2>5. How We Share Your Information</h2>
      <p>
        <strong>We do not sell your personal information.</strong>
      </p>
      <p>We share information only in the following circumstances:</p>
      <ul>
        <li>
          <strong>Service providers</strong>: with vendors who help us
          operate the Service, such as our AI provider (for generating
          content you request) and our authentication and database
          provider (Supabase) — each solely to perform services on our
          behalf. If we introduce paid plans, this will also include a
          payment processor, solely for billing purposes.
        </li>
        <li>
          <strong>Legal requirements</strong>: if required to comply with a
          legal obligation, court order, or governmental request, or to
          protect the rights, property, or safety of Career Élan, our
          users, or others.
        </li>
        <li>
          <strong>Business transfers</strong>: if Career Élan is involved
          in a merger, acquisition, or sale of assets, your information may
          be transferred as part of that transaction, subject to this
          Privacy Policy or a policy that offers materially similar
          protections.
        </li>
        <li>
          <strong>With your consent</strong>: for any other purpose
          disclosed to you at the time you provide the information, or
          with your consent.
        </li>
      </ul>

      <hr />

      <h2>6. Data Retention</h2>
      <p>
        We retain your account and career information for as long as your
        account is active, or as needed to provide the Service. If you
        delete your account, we delete or anonymize your personal
        information within a reasonable period, except where we are
        required to retain certain records (such as billing records, if
        applicable) for legal, accounting, or fraud-prevention purposes.
      </p>

      <hr />

      <h2>7. Account Deletion</h2>
      <p>
        You can delete your account at any time from your account
        settings. Deleting your account removes your Career Memory,
        uploaded documents, and generated content associated with your
        account from our active systems, subject to the retention
        exceptions described in Section 6. Deletion is permanent and
        cannot be undone — please download or save anything you wish to
        keep before deleting your account.
      </p>

      <hr />

      <h2>8. Your Rights and Choices</h2>
      <p>Depending on your location, you may have rights to:</p>
      <ul>
        <li>Access the personal information we hold about you</li>
        <li>Correct inaccurate information</li>
        <li>Request deletion of your information</li>
        <li>Object to or restrict certain processing</li>
        <li>Request a copy of your information in a portable format</li>
      </ul>
      <p>
        You can exercise most of these rights directly from your account
        settings (editing your Career Memory, uploaded documents, or
        deleting your account). For anything else, contact us at{" "}
        <strong>careerelanhq@gmail.com</strong>.
      </p>

      <hr />

      <h2>9. Data Security</h2>
      <p>
        We use reasonable administrative, technical, and organizational
        measures designed to protect your information, including encrypted
        transmission (HTTPS) and access controls on our systems. However,{" "}
        <strong>no method of transmission or storage is 100% secure</strong>
        , and we cannot guarantee absolute security. We do not claim any
        specific security certification (such as SOC 2 or ISO 27001) unless
        separately stated in writing.
      </p>

      <hr />

      <h2>10. Children&rsquo;s Privacy</h2>
      <p>
        The Service is not directed to individuals under the age of 16, and
        we do not knowingly collect personal information from children
        under 16. If you believe a child has provided us with personal
        information, please contact us so we can delete it.
      </p>

      <hr />

      <h2>11. International Data Transfers</h2>
      <p>
        Career Élan and our service providers may process and store
        information in countries other than your own, including Canada and
        the United States. By using the Service, you understand that your
        information may be transferred to and processed in such countries,
        which may have different data protection laws than your country of
        residence.
      </p>

      <hr />

      <h2>12. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make
        material changes, we will notify you by updating the &ldquo;Last
        Updated&rdquo; date above, and where appropriate, through the
        Service or by email. Your continued use of the Service after a
        change becomes effective constitutes acceptance of the updated
        Privacy Policy.
      </p>

      <hr />

      <h2>13. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy or how we handle
        your information, contact us at:
      </p>
      <p>
        <strong>Email:</strong> careerelanhq@gmail.com
        <br />
        <strong>Career Élan</strong>
      </p>
    </LegalLayout>
  );
}
