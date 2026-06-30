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
      <section className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-blue-50 to-slate-50">
        <div className="pointer-events-none absolute -left-40 top-24 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-blue-300/40 blur-3xl" />

        <header className="relative z-10 flex w-full items-center justify-between px-6 py-6 sm:px-10 lg:px-16 xl:px-20">
          <Image src="/logo.png" alt="Career Élan" width={190} height={70} priority />

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex">
            <a href="#features" className="transition hover:text-blue-600">Features</a>
            <a href="#how-it-works" className="transition hover:text-blue-600">How it Works</a>
            <a href="#examples" className="transition hover:text-blue-600">Examples</a>
            <a href="#faq" className="transition hover:text-blue-600">FAQ</a>
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="rounded-2xl bg-blue-600 px-6 py-3 font-extrabold text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              Get Started for Free
            </button>
          </nav>
        </header>

        <div className="relative z-10 grid w-full items-center gap-12 px-6 pb-16 pt-10 sm:px-10 lg:grid-cols-[0.8fr_1.2fr] lg:px-16 xl:px-20">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-blue-100/80 px-4 py-2 text-sm font-extrabold text-blue-700 ring-1 ring-blue-200">
              ✦ AI-Powered Job Application Platform
            </div>

            <h1 className="text-5xl font-black leading-[0.98] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Upload Once.
              <br />
              <span className="bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
                Apply Anywhere.
              </span>
            </h1>

            <p className="mt-8 max-w-xl text-lg leading-9 text-slate-600">
              Paste a job URL and our AI instantly creates a tailored resume, cover letter,
              and email draft that match the job requirements — so you can apply faster
              and get more interviews.
            </p>

            <div className="mt-8 grid gap-4 text-sm font-bold text-slate-700">
              <span>✓ No manual rewriting</span>
              <span>✓ ATS-optimized</span>
              <span>✓ Job-specific documents</span>
            </div>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="rounded-2xl bg-blue-600 px-9 py-4 text-lg font-black text-white shadow-2xl shadow-blue-300 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Get Started for Free →
              </button>
              <p className="text-sm font-semibold text-slate-500">🔒 No credit card required</p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.9fr_0.75fr_1.15fr]">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">1</div>
              <h3 className="text-lg font-black">Paste Job URL</h3>
              <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600">
                linkedin.com/jobs/view/1234567890 🔗
              </div>
              <p className="mt-5 text-center text-sm text-slate-500">We extract the job details automatically.</p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">2</div>
              <h3 className="text-lg font-black">AI Analyzes Job Posting</h3>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-black">Marketing Coordinator</p>
                <p className="mt-1 text-xs text-slate-500">Brighton Solutions Inc. · Toronto, ON · Full-time</p>
                <p className="mt-5 text-xs font-black">Key Requirements</p>
                <ul className="mt-3 space-y-2 text-xs text-slate-600">
                  <li>✓ 2+ years of marketing experience</li>
                  <li>✓ SEO and content management</li>
                  <li>✓ Campaign planning and analytics</li>
                  <li>✓ Excellent written communication</li>
                </ul>
                <div className="mt-5 rounded-full bg-green-50 px-3 py-2 text-center text-xs font-black text-green-700">
                  Match Potential: 92%
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-blue-100">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-black text-white">3</div>
              <h3 className="text-lg font-black">AI Creates Your Tailored Package ✨</h3>
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex gap-4">
                    <div className="h-28 w-20 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400">
                      <p className="font-black text-slate-700">Alex Carter</p>
                      <p>Marketing Coordinator</p>
                      <br />
                      <p>Professional Summary</p>
                      <p>Results-driven marketing professional...</p>
                      <br />
                      <p>Experience</p>
                      <p>Brighton Solutions Inc.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-black">Optimized Resume</p>
                        <span className="rounded-full bg-green-50 px-2 py-1 text-[10px] font-black text-green-700">ATS 98%</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">Full resume preview plus clear explanation of what was tailored.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-black">Personalized Cover Letter</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">Custom letter that speaks directly to the job and company.</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-black">Email Draft</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">Professional email draft ready to send with your application.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-6 py-12 sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-4">
          <Stat label="Applications Generated" value="25,000+" />
          <Stat label="Average ATS Match" value="92%" />
          <Stat label="Average Time Saved" value="75%" />
          <Stat label="Average User Rating" value="4.9/5" />
        </div>
      </section>

      <section className="w-full bg-white px-6 py-10 sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl items-center gap-6 md:grid-cols-3">
          <Benefit title="More Accurate" body="AI matches your profile with job requirements more accurately." badge="98% ATS Match" />
          <div className="rounded-[2rem] bg-blue-600 p-10 text-center text-white shadow-2xl shadow-blue-200">
            <p className="mx-auto mb-4 w-fit rounded-full bg-white/15 px-4 py-2 text-xs font-black">Most Loved Feature</p>
            <p className="text-lg font-black">Save Average</p>
            <p className="mt-2 text-7xl font-black">75%</p>
            <p className="mt-2 text-xl font-black">Application Time</p>
            <p className="mt-5 text-yellow-300">★★★★★</p>
            <p className="mt-4 text-sm leading-6 text-blue-50">Save hours on every application. Focus on preparing for interviews, not rewriting documents.</p>
          </div>
          <Benefit title="Human-like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="Loved by recruiters" />
        </div>
      </section>

      <section id="features" className="w-full bg-slate-50 px-6 py-16 sm:px-10 lg:px-16 xl:px-20">
        <h2 className="text-center text-3xl font-black text-slate-950">6 Powerful Features to Land Your Dream Job</h2>
        <div className="mx-auto mt-10 grid max-w-7xl gap-5 md:grid-cols-3">
          <Feature title="AI Resume Builder" body="Create ATS-optimized resumes tailored to each job description." />
          <Feature title="AI Cover Letter" body="Generate personalized cover letters that show your value and fit." />
          <Feature title="Email Draft Generator" body="Get professional email drafts ready to send to hiring managers." />
          <Feature title="Job Analyzer" body="Analyze any job posting and get match score, key skills, and missing keywords." />
          <Feature title="Application Tracker" body="Track all your applications in one place and never miss a follow-up." />
          <Feature title="Follow-up Assistant" body="AI helps you write follow-up emails that get replies." />
        </div>
      </section>

      <section id="examples" className="w-full bg-white px-6 py-16 sm:px-10 lg:px-16 xl:px-20">
        <h2 className="text-center text-3xl font-black text-slate-950">See the AI-Powered Results</h2>
        <div className="mx-auto mt-10 grid max-w-5xl gap-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
            <p className="text-lg font-black text-slate-900">Alex Carter</p>
            <p className="font-bold text-blue-600">Marketing Coordinator</p>
            <hr className="my-4" />
            <p className="font-black text-slate-800">Professional Summary</p>
            <p className="mt-2">Marketing professional with 4+ years of experience in digital marketing, campaign management, and content strategy.</p>
            <p className="mt-4 font-black text-slate-800">Experience</p>
            <p className="mt-2">Brighton Solutions Inc. · Toronto, ON</p>
            <ul className="mt-2 list-disc pl-5">
              <li>Managed campaigns across multiple channels.</li>
              <li>Improved engagement through data-driven strategies.</li>
              <li>Reported insights using analytics tools.</li>
            </ul>
          </div>
          <div>
            <p className="text-2xl font-black text-slate-950">AI-Optimized Resume <span className="rounded-full bg-green-50 px-3 py-1 text-sm text-green-700">ATS Match 96%</span></p>
            <ul className="mt-6 space-y-4 text-sm font-semibold text-slate-600">
              <li>✓ Highlights relevant experience and achievements</li>
              <li>✓ Includes job-specific keywords</li>
              <li>✓ Clean, professional format that passes ATS</li>
              <li>✓ Ready to download and submit</li>
            </ul>
            <button type="button" onClick={() => openAuth("signup")} className="mt-8 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 font-black text-blue-700">Preview Full Resume →</button>
          </div>
        </div>
      </section>

      <section id="faq" className="w-full bg-slate-50 px-6 py-16 sm:px-10 lg:px-16 xl:px-20">
        <h2 className="text-center text-3xl font-black text-slate-950">Frequently Asked Questions</h2>
        <div className="mx-auto mt-10 grid max-w-6xl gap-6 md:grid-cols-[1fr_0.45fr]">
          <div className="space-y-3">
            {[
              "How does Career Élan work?",
              "Is my data secure and private?",
              "Can I edit the AI-generated documents?",
              "What types of jobs does it work for?",
              "Do I need a credit card to start?",
            ].map((q) => (
              <button key={q} type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left font-black text-slate-800">
                {q}<span>⌄</span>
              </button>
            ))}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-4xl">🛡️</p>
            <p className="mt-5 text-xl font-black text-slate-950">Your data is 100% secure</p>
            <p className="mt-4 text-sm leading-6 text-slate-600">We use secure authentication and never sell or share your career data.</p>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 px-6 py-12 text-white sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
          <div>
            <Image src="/logo.png" alt="Career Élan" width={170} height={60} />
            <p className="mt-4 text-sm text-slate-400">AI-powered job application platform.</p>
          </div>
          <FooterGroup title="Product" items={["Features", "How it Works", "Examples", "FAQ"]} />
          <FooterGroup title="Company" items={["About", "Blog", "Careers", "Contact"]} />
          <FooterGroup title="Legal" items={["Privacy Policy", "Terms of Service", "Cookie Policy"]} />
        </div>
        <p className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-sm text-slate-500">© 2026 Career Élan. All rights reserved.</p>
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

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="text-center"><p className="text-3xl font-black text-blue-600">{value}</p><p className="mt-2 text-sm font-bold text-slate-500">{label}</p></div>;
}

function Benefit({ title, body, badge }: { title: string; body: string; badge: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><p className="text-xl font-black text-slate-950">{title}</p><p className="mt-4 text-sm leading-6 text-slate-600">{body}</p><p className="mt-6 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">{badge}</p></div>;
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