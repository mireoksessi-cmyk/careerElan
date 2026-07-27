import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service | Career Élan",
  description:
    "Read the terms governing your use of Career Élan's AI-powered resume, cover letter, and career tools, including important disclaimers about AI-generated content.",
};

const LAST_UPDATED = "July 26, 2026";

export default function TermsOfServicePage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service (&ldquo;<strong>Terms</strong>&rdquo;) govern
        your access to and use of Career Élan (the &ldquo;
        <strong>Service</strong>&rdquo;), operated by Career Élan
        (&ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo;
        or &ldquo;<strong>our</strong>&rdquo;). By creating an account or
        otherwise using the Service, you agree to be bound by these Terms.
        If you do not agree, do not use the Service.
      </p>

      <hr />

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Career Élan, you confirm that you have read,
        understood, and agree to be bound by these Terms and our{" "}
        <Link href="/privacy">Privacy Policy</Link>, which is incorporated
        by reference. We may update these Terms from time to time as
        described in Section 16.
      </p>

      <hr />

      <h2>2. Description of the Service</h2>
      <p>
        Career Élan is an AI-powered career platform that currently offers
        tools including AI resume generation, AI cover letter generation,
        AI email drafting, ATS (Applicant Tracking System) analysis, Career
        Memory (a profile of your career information), resume and cover
        letter uploads, job posting and job description analysis, and
        related AI-assisted recommendations. We may introduce, modify, or
        remove features at any time, including future tools such as
        auto-apply, recruiter simulation, or interview preparation.
      </p>

      <hr />

      <h2>3. Eligibility</h2>
      <p>
        You must be at least 16 years old to use the Service. By using the
        Service, you represent that you meet this requirement and that you
        have the legal capacity to enter into these Terms.
      </p>

      <hr />

      <h2>4. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your
        account credentials and for all activity that occurs under your
        account. You agree to provide accurate information when creating
        your account and to keep it up to date. Notify us immediately if
        you become aware of unauthorized use of your account.
      </p>

      <hr />

      <h2>5. AI-Generated Content — Important Disclaimers</h2>
      <p>
        This section is central to your use of the Service. Please read it
        carefully.
      </p>

      <h3>5.1 AI Output Is Assistance, Not Advice or Guarantee</h3>
      <p>
        Resumes, cover letters, email drafts, ATS analysis, and any other
        content generated using artificial intelligence through the
        Service (&ldquo;<strong>AI-Generated Content</strong>&rdquo;) are
        provided as <strong>drafting assistance only</strong>.
        AI-Generated Content is produced algorithmically based on the
        information you provide and may contain errors, omissions,
        inaccuracies, or content that does not reflect your actual
        experience or qualifications.
      </p>

      <h3>5.2 You Are Solely Responsible for Review</h3>
      <p>
        <strong>
          You are solely responsible for reviewing, editing, verifying,
          and approving every piece of AI-Generated Content before using,
          submitting, sending, or relying on it in any way
        </strong>{" "}
        — including before submitting it to an employer, recruiter, or any
        third party. You are responsible for verifying the factual
        accuracy of all information in AI-Generated Content, including
        your own work history, dates, titles, skills, and qualifications.
        Career Élan does not verify the accuracy of AI-Generated Content on
        your behalf.
      </p>

      <h3>5.3 No Guaranteed Outcomes</h3>
      <p>
        Career Élan does <strong>not</strong> guarantee, promise, or
        represent that use of the Service — including AI-Generated
        Content, ATS Analysis, or any other feature — will result in:
      </p>
      <ul>
        <li>An interview</li>
        <li>A job offer</li>
        <li>Employment of any kind</li>
        <li>Visa approval or any immigration outcome</li>
        <li>A salary increase or improved compensation</li>
        <li>A specific ATS score or improved ATS performance</li>
        <li>A response from any recruiter or employer</li>
      </ul>
      <p>
        Outcomes depend on factors entirely outside our control, including
        the decisions of employers, recruiters, government agencies, and
        other third parties. Any specific numbers, scores, or estimates
        shown in the Service (including ATS Analysis scores) are
        illustrative estimates only and are not a guarantee of how any
        actual system or person will evaluate your materials.
      </p>

      <hr />

      <h2>6. Your Responsibilities</h2>
      <p>By using the Service, you agree that you will:</p>
      <ul>
        <li>
          Provide accurate information about your own background, work
          history, and qualifications, and{" "}
          <strong>
            not submit false, misleading, fraudulent, or fabricated
            employment information
          </strong>
          , whether for use in AI-Generated Content or otherwise
        </li>
        <li>
          Use AI-Generated Content only after your own independent review
          and verification
        </li>
        <li>
          Comply with all applicable laws in your use of the Service and
          any AI-Generated Content
        </li>
        <li>
          Not use the Service to create content intended to deceive an
          employer, government agency, or other third party about your
          identity, qualifications, or work history
        </li>
      </ul>

      <hr />

      <h2>7. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          Use the Service for any unlawful purpose or in violation of
          these Terms
        </li>
        <li>
          Attempt to interfere with, disrupt, or gain unauthorized access
          to the Service, its systems, or other users&rsquo; accounts
        </li>
        <li>
          Reverse engineer, decompile, or attempt to extract the source
          code of the Service, except where permitted by law
        </li>
        <li>
          Use automated means (bots, scrapers) to access the Service
          without our prior written consent
        </li>
        <li>
          Upload or submit content that is unlawful, infringing,
          defamatory, or that violates the rights of any third party
        </li>
        <li>
          Resell, sublicense, or commercially exploit the Service without
          our prior written consent
        </li>
      </ul>
      <p>
        We may investigate suspected violations of this section and take
        appropriate action, including under Section 10.
      </p>

      <hr />

      <h2>8. Subscription Plans and Billing</h2>
      <p>
        The Service is currently available without charge, subject to
        usage limits described within the Service itself (for example,
        limits on the number of AI-generated packages available to an
        account). We do not currently process payments.
      </p>
      <p>
        <strong>
          If we introduce a paid subscription plan in the future
        </strong>
        , this section will govern it: by subscribing, you will agree to
        pay the applicable fees as described at the time of purchase;
        subscriptions may renew automatically unless canceled before the
        renewal date, in accordance with the billing terms presented to
        you at checkout; fees will generally be non-refundable except as
        required by law or as separately stated in a refund policy we
        publish at that time; and we may change subscription pricing
        prospectively, with reasonable notice to existing subscribers.
      </p>

      <hr />

      <h2>9. Intellectual Property</h2>

      <h3>9.1 Our Property</h3>
      <p>
        The Service, including its software, design, text, graphics, and
        underlying technology (excluding your own content), is owned by
        Career Élan or our licensors and is protected by intellectual
        property laws. These Terms do not grant you any right to use our
        trademarks, logos, or branding without our prior written consent.
      </p>

      <h3>9.2 Your Content</h3>
      <p>
        You retain ownership of the information and content you submit to
        the Service (such as your resume text, Career Memory, and uploaded
        documents) (&ldquo;<strong>Your Content</strong>&rdquo;). By
        submitting Your Content, you grant Career Élan a limited,
        non-exclusive, worldwide license to use, process, and transmit
        Your Content solely as necessary to operate and provide the
        Service to you, including transmitting relevant portions to our AI
        providers to generate the content you request.
      </p>

      <h3>9.3 AI-Generated Content</h3>
      <p>
        Subject to your compliance with these Terms, and subject to the
        underlying rights of our AI providers and any third-party content
        incorporated during generation, you may use AI-Generated Content
        produced for you through the Service for your personal,
        non-commercial career and job-search purposes.
      </p>

      <hr />

      <h2>10. Suspension and Termination</h2>
      <p>
        We may suspend or terminate your access to the Service, with or
        without notice, if we reasonably believe you have violated these
        Terms, misused the Service, submitted fraudulent or abusive
        content, or engaged in conduct that harms Career Élan, other
        users, or third parties. You may stop using the Service and delete
        your account at any time, as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <hr />

      <h2>11. Changes to the Service</h2>
      <p>
        We may change, suspend, or discontinue any feature or aspect of
        the Service, temporarily or permanently, at any time, with or
        without notice. We are not liable to you or any third party for
        any such change, suspension, or discontinuation.
      </p>

      <hr />

      <h2>12. Disclaimer of Warranties</h2>
      <p>
        <strong>
          THE SERVICE, INCLUDING ALL AI-GENERATED CONTENT, IS PROVIDED
          &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
          WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY
        </strong>
        , including but not limited to implied warranties of
        merchantability, fitness for a particular purpose,
        non-infringement, and accuracy. We do not warrant that the Service
        will be uninterrupted, error-free, or secure, or that
        AI-Generated Content will be accurate, complete, or suitable for
        your particular purpose.
      </p>

      <hr />

      <h2>13. Limitation of Liability</h2>
      <p>
        <strong>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, CAREER ÉLAN
          AND ITS OFFICERS, EMPLOYEES, AND SERVICE PROVIDERS SHALL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES
        </strong>
        , or any loss of profits, revenue, data, or opportunities
        (including lost employment or business opportunities), arising
        out of or related to your use of, or inability to use, the
        Service — including any reliance on AI-Generated Content — even if
        we have been advised of the possibility of such damages.
      </p>
      <p>
        <strong>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL
          AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO
          THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE GREATER OF (A)
          THE AMOUNT YOU PAID TO CAREER ÉLAN IN THE TWELVE (12) MONTHS
          PRECEDING THE CLAIM, OR (B) CAD $100.
        </strong>
      </p>
      <p>
        Some jurisdictions do not allow the exclusion or limitation of
        certain damages, so some of the above limitations may not apply to
        you.
      </p>

      <hr />

      <h2>14. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless Career Élan and
        its officers, employees, and service providers from and against
        any claims, liabilities, damages, losses, and expenses (including
        reasonable legal fees) arising out of or related to: (a) your use
        of the Service; (b) your submission or use of AI-Generated
        Content, including any failure to review or verify it before use;
        (c) your violation of these Terms; or (d) your violation of any
        applicable law or the rights of any third party.
      </p>

      <hr />

      <h2>15. Governing Law and Dispute Resolution</h2>
      <p>
        These Terms are governed by the laws of{" "}
        <strong>
          the Province of Ontario, Canada, and the applicable federal laws
          of Canada
        </strong>
        , without regard to conflict of law principles. Any dispute
        arising out of these Terms or the Service shall be resolved
        exclusively in the courts of that jurisdiction.
      </p>

      <hr />

      <h2>16. Changes to These Terms</h2>
      <p>
        We may revise these Terms from time to time. If we make material
        changes, we will notify you by updating the &ldquo;Last
        Updated&rdquo; date above, and where appropriate, through the
        Service or by email. Your continued use of the Service after a
        change becomes effective constitutes your acceptance of the
        revised Terms.
      </p>

      <hr />

      <h2>17. Miscellaneous</h2>
      <p>
        If any provision of these Terms is found unenforceable, the
        remaining provisions will remain in full force and effect. Our
        failure to enforce any right or provision of these Terms will not
        be considered a waiver of that right or provision. You may not
        assign or transfer these Terms, or any rights or obligations under
        them, without our prior written consent; we may assign these Terms
        without restriction, including in connection with a merger,
        acquisition, or sale of assets. These Terms, together with our{" "}
        <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/cookies">Cookie Policy</Link>, constitute the entire
        agreement between you and Career Élan regarding the Service.
      </p>

      <hr />

      <h2>18. Contact Us</h2>
      <p>If you have questions about these Terms, contact us at:</p>
      <p>
        <strong>Email:</strong> careerelanhq@gmail.com
        <br />
        <strong>Career Élan</strong>
      </p>
    </LegalLayout>
  );
}
