import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Cookie Policy | Career Élan",
  description:
    "See what cookies Career Élan uses to keep your account signed in and secure, and how to manage them in your browser.",
};

const LAST_UPDATED = "July 26, 2026";

export default function CookiePolicyPage() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Cookie Policy explains how Career Élan (&ldquo;
        <strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or
        &ldquo;<strong>our</strong>&rdquo;) uses cookies and similar
        technologies when you use our website and Service. This policy
        should be read alongside our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <hr />

      <h2>1. What Are Cookies?</h2>
      <p>
        Cookies are small text files stored on your device by your
        browser. They allow a website to recognize your device and
        remember certain information about your visit, such as whether
        you&rsquo;re signed in.
      </p>

      <hr />

      <h2>2. Cookies We Use</h2>
      <p>
        We use a limited set of cookies, all of which are necessary for
        the Service to function securely. We do not currently use
        advertising cookies, and we do not currently use third-party
        analytics or tracking cookies. If that changes, we will update
        this policy.
      </p>

      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Authentication cookies</strong>
            </td>
            <td>
              Keep you signed in to your Career Élan account so you
              don&rsquo;t have to log in on every page.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Session cookies</strong>
            </td>
            <td>
              Maintain your active session state while you use the
              Service; these are typically deleted when you close your
              browser or sign out.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Security cookies</strong>
            </td>
            <td>
              Help us detect and prevent fraudulent activity, unauthorized
              access, and other security risks.
            </td>
          </tr>
          <tr>
            <td>
              <strong>OAuth cookies</strong>
            </td>
            <td>
              Set temporarily during the sign-in process when you choose
              &ldquo;Continue with Google&rdquo; or &ldquo;Continue with
              Facebook,&rdquo; to securely complete the authentication
              handshake with those providers. These are short-lived and
              used only to complete sign-in.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        These cookies are set either directly by Career Élan or by our
        authentication infrastructure provider (Supabase), and — during
        sign-in only — by Google or Facebook as part of their own OAuth
        process, subject to their respective privacy policies.
      </p>

      <hr />

      <h2>3. Why We Don&rsquo;t Ask for Cookie Consent on Every Visit</h2>
      <p>
        The cookies described above are strictly necessary for the
        Service to function — primarily keeping you securely signed in.
        We do not use cookies for advertising or non-essential tracking,
        so we do not currently display a cookie consent banner. If we
        introduce optional cookies (such as analytics) in the future, we
        will update this policy and provide appropriate consent controls
        at that time.
      </p>

      <hr />

      <h2>4. Managing Cookies</h2>
      <p>
        Most browsers let you view, manage, and delete cookies through
        their settings. Because the cookies we use are necessary for
        signing in and keeping your account secure,{" "}
        <strong>
          blocking or deleting them may prevent you from signing in or
          using parts of the Service properly
        </strong>
        .
      </p>
      <p>
        You can typically manage cookies through your browser&rsquo;s
        settings:
      </p>
      <ul>
        <li>
          <strong>Chrome:</strong> Settings → Privacy and security →
          Cookies and other site data
        </li>
        <li>
          <strong>Safari:</strong> Preferences → Privacy → Manage Website
          Data
        </li>
        <li>
          <strong>Firefox:</strong> Settings → Privacy &amp; Security →
          Cookies and Site Data
        </li>
        <li>
          <strong>Edge:</strong> Settings → Cookies and site permissions
        </li>
      </ul>

      <hr />

      <h2>5. Changes to This Policy</h2>
      <p>
        We may update this Cookie Policy from time to time, particularly
        if we add new categories of cookies. We will update the
        &ldquo;Last Updated&rdquo; date above when we do.
      </p>

      <hr />

      <h2>6. Contact Us</h2>
      <p>If you have questions about our use of cookies, contact us at:</p>
      <p>
        <strong>Email:</strong> careerelanhq@gmail.com
      </p>
    </LegalLayout>
  );
}
