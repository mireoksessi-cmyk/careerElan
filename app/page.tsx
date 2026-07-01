"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type AuthMode = "login" | "signup";

export default function HomePage() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  function openAuth(mode: AuthMode = "login") {
    setAuthMode(mode);
    setMessage("");
    setShowAuthModal(true);
  }

  async function signInWithProvider(provider: "google" | "linkedin_oidc" | "facebook") {
    setLoading(true);
    setMessage("");

    const options =
      provider === "facebook"
        ? {
            redirectTo: `${window.location.origin}/dashboard`,
            scopes: "public_profile",
          }
        : {
            redirectTo: `${window.location.origin}/dashboard`,
          };

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options,
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
  }

  async function handleEmailLogin() {
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  async function handleEmailSignup() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        data: {
          full_name: fullName,
          phone,
        },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    // Optional: if your Supabase project confirms emails manually, user may need to verify email first.
    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        full_name: fullName,
        phone,
        email: signupEmail,
        created_at: new Date().toISOString(),
      });
    }

    setMessage("Account created. Please check your email if confirmation is required.");
    setLoading(false);
  }

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-white text-slate-950">
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-slate-50">
        <div className="pointer-events-none absolute -left-40 top-24 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-blue-300/40 blur-3xl" />

        <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
          <Image src="/logo.png" alt="Career Élan" width={170} height={70} priority className="h-auto w-[145px] sm:w-[170px]" />

          <nav className="hidden items-center gap-8 text-[13px] font-bold text-slate-800 md:flex">
            <a href="#features" className="transition hover:text-blue-600">Features</a>
            <a href="#how-it-works" className="transition hover:text-blue-600">How it Works</a>
            <a href="#examples" className="transition hover:text-blue-600">Examples</a>
            <a href="#faq" className="transition hover:text-blue-600">FAQ</a>
          </nav>

          <div className="hidden items-center gap-4 md:flex">
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-extrabold text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              Get Started
            </button>
          </div>

          <button
            type="button"
            onClick={() => openAuth("signup")}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 md:hidden"
          >
            Start
          </button>
        </header>

        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-8 px-5 pb-9 pt-4 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:px-10 xl:px-12">
          <div className="max-w-[470px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-100/90 px-4 py-2 text-xs font-extrabold text-blue-700 ring-1 ring-blue-200">
              ✦ AI-Powered Job Application Platform
            </div>

            <h1 className="text-[46px] font-black leading-[0.94] tracking-[-0.05em] text-slate-950 sm:text-[58px] lg:text-[68px] xl:text-[76px]">
              Upload
              <br />
              Once.
              <br />
              <span className="text-blue-600">
                Apply
                <br />
                Anywhere.
              </span>
            </h1>

            <p className="mt-6 max-w-[430px] text-[15px] leading-7 text-slate-600">
              Paste a job URL and our AI instantly creates a tailored resume, cover letter,
              and email draft that match the job requirements — so you can apply faster
              and get more interviews.
            </p>

            <div className="mt-6 grid gap-3 text-sm font-bold text-slate-700">
              <span>✓ No manual rewriting</span>
              <span>✓ ATS-optimized</span>
              <span>✓ Humanized AI writing that sounds natural and human</span>
              <span>✓ Job-specific documents</span>
            </div>

            <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="w-fit rounded-xl bg-blue-600 px-8 py-4 text-base font-black text-white shadow-xl shadow-blue-300 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Get Started →
               </button>
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500">🔒 No credit card required</p>
          </div>

          <div id="how-it-works" className="grid gap-5 lg:grid-cols-[0.86fr_0.86fr_1.28fr]">
            <div className="flex min-h-[390px] flex-col rounded-[1.7rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100/70">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">1</div>
              <h3 className="text-lg font-black leading-tight">Paste Job URL</h3>
              <div className="mt-7 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs font-bold leading-5 text-slate-600 shadow-sm">
                🔗 linkedin.com/jobs/view/<br />1234567890
              </div>
              <p className="mt-5 text-center text-sm leading-6 text-slate-500">We extract the job details automatically.</p>
            </div>

            <div className="flex min-h-[390px] flex-col rounded-[1.7rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100/70">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">2</div>
              <h3 className="text-lg font-black leading-tight">AI Analyzes Job Posting</h3>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-inner">
                <p className="text-sm font-black">Marketing Coordinator</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Brighton Solutions Inc.<br />Toronto, ON · Full-time</p>
                <p className="mt-5 text-xs font-black">Key Requirements</p>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                  <li>✓ 2+ years of marketing experience</li>
                  <li>✓ SEO and content management</li>
                  <li>✓ Campaign planning and analytics</li>
                  <li>✓ Excellent written communication</li>
                </ul>
                <div className="mt-5 rounded-xl bg-green-50 px-3 py-3 text-center text-xs font-black text-green-700">
                  Match Potential: 92%
                </div>
              </div>
            </div>

            <div className="min-h-[390px] rounded-[1.7rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100/70">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">3</div>
              <h3 className="text-lg font-black leading-tight">AI Creates Your Tailored Package ✨</h3>
              <div className="mt-5 space-y-4">
                <button type="button" onClick={() => openAuth("signup")} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex gap-4">
                    <MiniResume />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black">Optimized Resume</p>
                        <span className="rounded-full bg-green-50 px-2 py-1 text-[10px] font-black text-green-700">ATS 98%</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">Full resume preview plus clear explanation of what was tailored.</p>
                    </div>
                  </div>
                </button>

                <button type="button" onClick={() => openAuth("signup")} className="flex w-full gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <IconBox icon="✎" />
                  <div>
                    <p className="font-black">Personalized Cover Letter</p>
                    <p className="mt-2 text-xs leading-5 text-slate-600">Custom letter that speaks directly to the job and company.</p>
                  </div>
                </button>

                <button type="button" onClick={() => openAuth("signup")} className="flex w-full gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <IconBox icon="✉" />
                  <div>
                    <p className="font-black">Email Draft</p>
                    <p className="mt-2 text-xs leading-5 text-slate-600">Professional email draft ready to send with your application.</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-6 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-100 md:grid-cols-4">
          <Stat icon="▣" label="Applications Generated" value="25,000+" />
          <Stat icon="◎" label="Average ATS Match" value="92%" accent="text-green-600" />
          <Stat icon="◷" label="Average Time Saved" value="75%" accent="text-violet-600" />
          <Stat icon="★" label="Average User Rating" value="4.9/5" accent="text-yellow-500" />
        </div>
      </section>

      <section className="w-full bg-white px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] items-center gap-6 rounded-3xl bg-slate-50/70 p-5 md:grid-cols-3">
          <Benefit title="More Accurate" body="AI matches your profile with job requirements more accurately." badge="98% ATS Match" icon="◎" />
          <div className="rounded-[2rem] bg-blue-600 p-10 text-center text-white shadow-2xl shadow-blue-200">
            <p className="mx-auto mb-4 w-fit rounded-full bg-white/15 px-4 py-2 text-xs font-black">Most Loved Feature</p>
            <p className="text-lg font-black">Save Average</p>
            <p className="mt-2 text-7xl font-black">75%</p>
            <p className="mt-2 text-xl font-black">Application Time</p>
            <p className="mt-5 text-yellow-300">★★★★★</p>
            <p className="mt-4 text-sm leading-6 text-blue-50">Save hours on every application. Focus on preparing for interviews, not rewriting documents.</p>
          </div>
          <Benefit title="Human-like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="Loved by recruiters" icon="♡" />
        </div>
      </section>

      <section id="examples" className="w-full bg-white px-5 pb-16 pt-10 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto max-w-[1440px] text-center">
          <Image src="/logo.png" alt="Career Élan" width={160} height={64} className="mx-auto mb-4 h-auto w-[145px]" />
          <p className="mx-auto mb-4 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100">YOUR AI APPLICATION PACKAGE</p>
          <h2 className="text-[34px] font-black leading-[1.05] tracking-[-0.04em] text-slate-950 sm:text-[48px] lg:text-[56px]">
            Upload One Resume.
            <br />
            <span className="text-blue-600">Apply to Unlimited Jobs.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-500">
            No rewriting. Just paste a job URL and let AI tailor everything for you.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-[1440px] gap-6 lg:grid-cols-[1.05fr_0.82fr_0.75fr]">
          <div className="space-y-4">
            <ResumePreview />
            <CoverLetterPreview />
            <EmailDraftPreview />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-100">
            <DocumentFeature
              icon="▣"
              title="Optimized Resume"
              badge="ATS 98%"
              items={[
                "Highlights relevant experience and achievements",
                "Includes job-specific keywords",
                "ATS-friendly formatting",
                "Humanized writing — sounds natural and professional",
                "Ready to download and submit",
              ]}
              button="View Full Resume"
              onClick={() => openAuth("signup")}
            />
            <div className="my-6 h-px bg-slate-200" />
            <DocumentFeature
              icon="✎"
              title="Personalized Cover Letter"
              items={[
                "Custom letter tailored to the job and company",
                "Highlights your relevant skills and experience",
                "Professional tone that makes you stand out",
                "Addresses key requirements from the job posting",
              ]}
              button="View Full Cover Letter"
              onClick={() => openAuth("signup")}
            />
            <div className="my-6 h-px bg-slate-200" />
            <DocumentFeature
              icon="✉"
              title="Email Draft"
              items={[
                "Professional email ready to send",
                "Personalized and attention-grabbing",
                "Increases your chances of getting a response",
                "Proper follow-up and etiquette",
              ]}
              button="View Full Email Draft"
              onClick={() => openAuth("signup")}
            />
          </div>

          <aside className="rounded-3xl border border-slate-200 bg-slate-50/80 p-7 shadow-xl shadow-slate-100">
            <div className="flex items-start gap-4">
              <IconBox icon="☆" />
              <div>
                <h3 className="text-xl font-black leading-tight">Your Complete Application Package</h3>
                <p className="mt-4 text-sm leading-6 text-slate-600">Everything you need to apply with confidence and stand out from other candidates.</p>
              </div>
            </div>
            <div className="mt-10 space-y-7">
              <PackageItem icon="▣" title="Optimized Resume" body="ATS Score: 98%" />
              <PackageItem icon="✎" title="Personalized Cover Letter" body="Tailored to the job" />
              <PackageItem icon="✉" title="Professional Email Draft" body="Ready to send" />
            </div>
            <div className="mt-10 rounded-2xl border border-green-200 bg-green-50 p-6">
              <p className="text-sm font-black text-slate-900">Match Potential</p>
              <p className="mt-1 text-4xl font-black text-green-700">92%</p>
              <p className="mt-3 text-sm leading-6 text-green-800">Great match! Your experience aligns well with this position.</p>
              <div className="mt-5 h-2 rounded-full bg-green-100">
                <div className="h-2 w-[92%] rounded-full bg-green-600" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="mt-8 w-full rounded-xl bg-blue-600 px-5 py-4 text-base font-black text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              Get Your Full Package 🔒
            </button>
            <p className="mt-4 text-center text-sm leading-6 text-slate-500">Sign up to download your documents and start applying.</p>
          </aside>
        </div>
      </section>

      <section id="faq" className="w-full bg-slate-50 px-6 py-10 sm:px-10 lg:px-16 xl:px-20">
        <h2 className="text-center text-2xl font-black text-slate-950">Frequently Asked Questions</h2>
        <div className="mx-auto mt-6 grid max-w-7xl gap-6 md:grid-cols-[1.3fr_1fr]">
          <div className="space-y-2">
            {[
              "How does Career Élan work?",
              "Is my data secure and private?",
              "Can I edit the AI-generated documents?",
              "What types of jobs does it work for?",
              "Do I need a credit card to start?",
            ].map((q) => (
              <button key={q} type="button" className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3 text-left text-sm font-black text-slate-800 shadow-sm">
                {q}<span>⌄</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-blue-50 text-5xl">🛡️</div>
            <div>
              <p className="text-xl font-black text-slate-950">Your data is 100% secure</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">We use secure authentication and never sell or share your career data.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 px-6 py-10 text-white sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
          <div>
            <Image src="/logo.png" alt="Career Élan" width={170} height={60} className="h-auto w-[150px] rounded-md bg-white/95 p-1" />
            <p className="mt-4 text-sm text-slate-400">AI-powered job application platform.</p>
            <div className="mt-5 flex gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">in</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">𝕏</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">f</span>
            </div>
          </div>
          <FooterGroup title="Product" items={["Features", "How it Works", "Examples", "FAQ"]} />
          <FooterGroup title="Company" items={["About", "Blog", "Careers", "Contact"]} />
          <FooterGroup title="Legal" items={["Privacy Policy", "Terms of Service", "Cookie Policy"]} />
        </div>
        <p className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-6 text-center text-sm text-slate-500">© 2026 Career Élan. All rights reserved.</p>
      </footer>

      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-6 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-950">{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
                <p className="mt-2 text-sm font-medium text-slate-500">{authMode === "login" ? "Continue building smarter applications." : "Start with one profile. Apply everywhere."}</p>
              </div>
              <button type="button" onClick={() => setShowAuthModal(false)} className="text-2xl leading-none text-slate-400 transition hover:text-slate-700">×</button>
            </div>

            <div className="space-y-3">
              <button type="button" onClick={() => signInWithProvider("google")} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50">G Continue with Google</button>
              <button type="button" onClick={() => signInWithProvider("linkedin_oidc")} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"><span className="flex h-5 w-5 items-center justify-center rounded bg-blue-700 text-xs font-black text-white">in</span> Continue with LinkedIn</button>
              <button type="button" onClick={() => signInWithProvider("facebook")} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">f</span> Continue with Facebook</button>
            </div>

            <div className="my-6 flex items-center gap-4"><div className="h-px flex-1 bg-slate-200" /><span className="text-sm font-bold text-slate-400">or</span><div className="h-px flex-1 bg-slate-200" /></div>

            {authMode === "signup" ? (
              <form className="space-y-4">
                <Input value={fullName} onChange={setFullName} placeholder="Full name" icon="👤" />
                <Input value={phone} onChange={setPhone} placeholder="Phone number" icon="📞" />
                <Input value={signupEmail} onChange={setSignupEmail} placeholder="Email address" icon="✉️" type="email" />
                <Input value={signupPassword} onChange={setSignupPassword} placeholder="Create password" icon="🔒" type="password" />
                <button type="button" onClick={handleEmailSignup} disabled={loading} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700">Create Account</button>
              </form>
            ) : (
              <form className="space-y-4">
                <Input value={loginEmail} onChange={setLoginEmail} placeholder="Email address" icon="✉️" type="email" />
                <Input value={loginPassword} onChange={setLoginPassword} placeholder="Password" icon="🔒" type="password" />
                <button type="button" onClick={handleEmailLogin} disabled={loading} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700">Continue</button>
              </form>
            )}

            {message && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">{message}</p>}

            <p className="mt-6 text-center text-sm text-slate-500">
              {authMode === "login" ? "No account? " : "Already have an account? "}
              <button type="button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")} className="font-black text-blue-600">
                {authMode === "login" ? "Sign up" : "Log in"}
              </button>
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, icon, accent = "text-blue-600" }: { label: string; value: string; icon?: string; accent?: string }) {
  return <div className="text-center md:border-r md:border-slate-200 last:border-r-0"><p className={`text-3xl font-black ${accent}`}>{icon && <span className="mr-3 text-2xl">{icon}</span>}{value}</p><p className="mt-2 text-sm font-bold text-slate-700">{label}</p></div>;
}

function Benefit({ title, body, badge, icon }: { title: string; body: string; badge: string; icon: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">{icon}</div><p className="text-xl font-black text-slate-950">{title}</p><p className="mt-4 text-sm leading-6 text-slate-600">{body}</p><p className="mt-6 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">{badge}</p></div>;
}

function IconBox({ icon }: { icon: string }) {
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-black text-blue-600">{icon}</div>;
}

function MiniResume() {
  return <div className="h-28 w-20 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400"><p className="font-black text-slate-700">ALEX CARTER</p><p className="text-blue-600">Marketing Coordinator</p><br /><p className="font-black">Summary</p><p>Results-driven professional...</p><br /><p className="font-black">Experience</p><p>Brighton Solutions Inc.</p><div className="mt-2 space-y-1"><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /></div></div>;
}

function ResumePreview() {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-5 text-slate-700 shadow-lg shadow-slate-100"><div className="border-t-4 border-blue-600 pt-3"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xl font-black text-slate-950">ALEX CARTER</p><p className="font-black text-blue-600">Marketing Coordinator</p></div><div className="text-[10px] leading-5 text-slate-500"><p>Toronto, ON</p><p>alexcarter@email.com</p><p>linkedin.com/in/alexcarter</p></div></div><hr className="my-4" /><p className="font-black text-slate-900">PROFESSIONAL SUMMARY</p><p className="mt-2">Marketing professional with 4+ years of experience in digital marketing, campaign management, and content strategy. Proven track record of increasing brand engagement and driving measurable results through data-driven initiatives.</p><p className="mt-4 font-black text-slate-900">EXPERIENCE</p><div className="mt-2 flex justify-between gap-4"><div><p className="font-black">Marketing Specialist</p><p>Brighton Solutions Inc. · Toronto, ON</p></div><p className="shrink-0">Jan 2021 – Present</p></div><ul className="mt-2 list-disc pl-5"><li>Managed multi-channel marketing campaigns that increased engagement by 35%.</li><li>Developed data-driven strategies resulting in 25% growth in qualified leads.</li></ul></div></div>;
}

function CoverLetterPreview() {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-5 text-slate-700 shadow-lg shadow-slate-100"><p className="font-black text-blue-600">▣ PERSONALIZED COVER LETTER</p><div className="mt-3 flex justify-between text-[10px] text-slate-500"><span>Toronto, ON · alexcarter@email.com · (416) 555-9876</span><span>May 21, 2024</span></div><p className="mt-4">Dear Hiring Manager,</p><p className="mt-2">I am excited to apply for the Marketing Coordinator position at Brighton Solutions Inc. With over 4 years of experience in digital marketing and campaign management, I have developed a strong ability to create data-driven strategies that drive engagement and support business growth.</p><p className="mt-2">In my current role at BrightWave Digital, I successfully managed multi-channel campaigns that increased customer engagement by 35% and improved lead generation by 25%.</p><p className="mt-2">Thank you for your time and consideration.</p><p className="mt-2">Sincerely,<br />Alex Carter</p></div>;
}

function EmailDraftPreview() {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-xs leading-5 text-slate-700 shadow-lg shadow-slate-100"><div className="flex gap-2 bg-slate-900 px-4 py-2"><span className="h-3 w-3 rounded-full bg-red-400" /><span className="h-3 w-3 rounded-full bg-yellow-400" /><span className="h-3 w-3 rounded-full bg-green-400" /></div><div className="p-5"><p>To: hiring.manager@brightonsolutions.com</p><p>Subject: Application for Marketing Coordinator Position</p><hr className="my-3" /><p>Hi [Hiring Manager Name],</p><p className="mt-2">I hope this email finds you well. I am very interested in the Marketing Coordinator position at Brighton Solutions Inc. and would love the opportunity to contribute to your team.</p><p className="mt-2">I have attached my resume and cover letter for your review. My experience in digital marketing, content strategy, and campaign management aligns well with the requirements of this role.</p><p className="mt-2">Best regards,<br />Alex Carter</p></div></div>;
}

function DocumentFeature({ icon, title, badge, items, button, onClick }: { icon: string; title: string; badge?: string; items: string[]; button: string; onClick: () => void }) {
  return <div><div className="flex flex-wrap items-center gap-3"><IconBox icon={icon} /><p className="text-xl font-black text-slate-950">{title}</p>{badge && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700">{badge}</span>}</div><ul className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-600">{items.map((item) => <li key={item} className="flex gap-3"><span className="text-green-600">✓</span><span>{item}</span></li>)}</ul><button type="button" onClick={onClick} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700">→ {button} 🔒</button></div>;
}

function PackageItem({ icon, title, body }: { icon: string; title: string; body: string }) {
  return <div className="flex gap-4"><IconBox icon={icon} /><div><p className="font-black text-slate-950">{title}</p><p className="mt-1 text-sm text-slate-500">{body}</p></div></div>;
}

function Feature({ title, body }: { title: string; body: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl">✦</div><p className="text-lg font-black text-slate-950">{title}</p><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p><button type="button" className="mt-5 text-sm font-black text-blue-600">Learn more →</button></div>;
}

function FooterGroup({ title, items }: { title: string; items: string[] }) {
  return <div><p className="font-black">{title}</p><div className="mt-4 space-y-3 text-sm text-slate-400">{items.map((item) => <p key={item}>{item}</p>)}</div></div>;
}

function Input({ value, onChange, placeholder, icon, type = "text" }: { value: string; onChange: (value: string) => void; placeholder: string; icon: string; type?: string }) {
  return <div className="flex items-center rounded-xl border border-slate-300 px-4 transition focus-within:border-blue-600"><span className="mr-3 text-slate-400">{icon}</span><input value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} className="w-full bg-transparent py-3 outline-none" /></div>;
}
