"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";



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
  const [loginId, setLoginId] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
useEffect(() => {
  const params = new URLSearchParams(
    window.location.search
  );

  if (params.get("verified") === "true") {
    setAuthMode("login");
    setShowAuthModal(true);
    setMessage(
      "Account created successfully. Your email has been verified. You can now log in."
    );

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );
  }
}, []);

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
            redirectTo: `${window.location.origin}/auth/callback`,
            scopes: "public_profile",
          }
        : {
            redirectTo: `${window.location.origin}/auth/callback`,
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

  try {
    // 1. 사용자가 입력한 로그인 ID로 실제 이메일 찾기
    const { data: profileData, error: profileError } =
      await supabase
        .from("profiles")
        .select("email")
        .eq("login_id", loginEmail.trim())
        .maybeSingle();

    if (profileError || !profileData?.email) {
      setMessage("Invalid ID or password.");
      return;
    }

    // 2. Supabase 이메일 로그인
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: profileData.email,
        password: loginPassword,
      });

    if (authError) {
  console.error("AUTH LOGIN ERROR =", authError);

  if (
    authError.message
      .toLowerCase()
      .includes("email not confirmed")
  ) {
    setMessage(
      "Please verify your email before logging in."
    );
  } else {
    setMessage("Invalid ID or password.");
  }

  return;
}

if (!authData.user) {
  setMessage("Unable to load your account.");
  return;
}

    // 3. Career Memory 완료 여부 확인
    const { data: memory, error: memoryError } =
      await supabase
        .from("career_memory")
        .select("required_completed")
        .eq("user_id", authData.user.id)
        .maybeSingle();

    if (memoryError) {
      console.error(
        "CAREER MEMORY LOGIN CHECK ERROR =",
        memoryError
      );
    }

    // 4. 완료 여부에 따라 바로 분기
    if (memory?.required_completed === true) {
      router.replace("/dashboard");
    } else {
      router.replace("/career-memory");
    }

    router.refresh();
  } catch (error) {
    console.error("LOGIN ERROR =", error);

    setMessage(
      "Unable to sign in. Please try again."
    );
  } finally {
    setLoading(false);
  }
}

  async function handleEmailSignup() {
  const cleanFullName = fullName.trim();
  const cleanPhone = phone.trim();
  const cleanLoginId = loginId.trim();
  const cleanEmail = signupEmail.trim().toLowerCase();

  if (!cleanFullName) {
    setMessage("Please enter your full name.");
    return;
  }

  if (!cleanLoginId) {
    setMessage("Please create a login ID.");
    return;
  }

  if (!cleanEmail) {
    setMessage("Please enter your email.");
    return;
  }

  if (!signupPassword) {
    setMessage("Please create a password.");
    return;
  }

  setLoading(true);
  setMessage("");

  try {
    const { data, error } =
      await supabase.auth.signUp({
        email: cleanEmail,
        password: signupPassword,
        options: {
          data: {
            full_name: cleanFullName,
            phone: cleanPhone,
            login_id: cleanLoginId,
          },
          emailRedirectTo:
            `${window.location.origin}/auth/callback`,
        },
      });

    if (error) {
      console.error("SIGNUP ERROR =", error);

      if (
        error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        setMessage(
          "This login ID or email is already registered."
        );
        return;
      }

      setMessage(error.message);
      return;
    }

    if (!data.user) {
      setMessage(
        "Unable to create your account."
      );
      return;
    }

    if (data.session) {
  alert("Your account has been created successfully.");

  router.replace("/career-memory");
  router.refresh();
  return;
}

alert(
  "Your account has been created successfully. Please check your email and verify your account before logging in."
);

setMessage(
  "Verification email sent. Please verify your email to complete account creation."
);
  } catch (error) {
    console.error("SIGNUP ERROR =", error);

    setMessage(
      "Unable to create your account. Please try again."
    );
  } finally {
    setLoading(false);
  }
}

async function resendConfirmationEmail() {
  const email = signupEmail.trim();

  if (!email) {
    setMessage("Please enter your email first.");
    return;
  }

  setLoading(true);
  setMessage("");

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  setLoading(false);

  if (error) {
    console.error("RESEND ERROR =", error);
    setMessage(error.message);
    return;
  }

  setMessage(
    "Verification email sent again. Please check your inbox and spam folder."
  );
}

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-white text-slate-950">
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-slate-50">
        <div className="pointer-events-none absolute -left-40 top-24 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-blue-300/40 blur-3xl" />

        <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
          <Image src="/logo.png" alt="Career Élan" width={180} height={76} priority className="h-auto w-[145px] sm:w-[176px]" />

          <nav className="hidden items-center gap-8 text-[13px] font-bold text-slate-800 md:flex">
            <a href="#features" className="transition hover:text-blue-600">Features</a>
            <a href="#how-it-works" className="transition hover:text-blue-600">How it Works</a>
            <a href="#examples" className="transition hover:text-blue-600">Examples</a>
            <a href="#pricing" className="transition hover:text-blue-600">Pricing</a>
            <a href="#faq" className="transition hover:text-blue-600">Resources⌄</a>
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

        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-8 px-5 pb-8 pt-3 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:px-10 xl:px-12">
          <div className="max-w-[520px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-100/90 px-4 py-2 text-xs font-extrabold text-blue-700 ring-1 ring-blue-200">
              ✦ AI-Powered Career Operating System
            </div>

            <h1 className="text-[44px] font-black leading-[0.98] tracking-[-0.05em] text-slate-950 sm:text-[56px] lg:text-[66px] xl:text-[72px]">
              Upload One Profile.
              <br />
              <span className="text-blue-600">Apply Everywhere.</span>
            </h1>

            <p className="mt-6 max-w-[500px] text-[15px] leading-7 text-slate-600">
              Career Élan is your AI career partner that tailors your resume, cover letter,
              and emails to every job automatically — so you never have to rewrite anything again.
            </p>

            <p className="mt-4 max-w-[500px] text-[15px] font-bold leading-7 text-slate-700">
              Upload one profile. Career Élan tailors every application for you.
            </p>

            <div className="mt-5 grid gap-3 text-sm font-bold text-slate-700">
              <span>✓ One profile for your entire career</span>
              <span>✓ AI tailors to any job description in seconds</span>
              <span>✓ ATS-optimized & recruiter-approved</span>
              <span>✓ Never rewrite your resume again</span>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="w-fit rounded-xl bg-blue-600 px-8 py-4 text-base font-black text-white shadow-xl shadow-blue-300 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Get Started 
              </button>
              <button
                type="button"
                onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                className="w-fit rounded-xl border border-slate-200 bg-white px-7 py-4 text-base font-black text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50"
              >
                See How It Works ◎
              </button>
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500"></p>
          </div>

          <div className="rounded-[1.7rem] border border-slate-200 bg-white/90 p-7 shadow-xl shadow-blue-100/70">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h3 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Your AI Application Package</h3>
              <span className="rounded-full bg-green-50 px-4 py-2 text-xs font-black text-green-700">ATS Match 96%</span>
            </div>
            <div className="space-y-4">
              <HeroPackageCard title="Optimized Resume" body="Tailored to the job description" detail="✓ Changes explained" icon={<MiniResume compact />} onClick={() => openAuth("signup")} />
              <HeroPackageCard title="Personalized Cover Letter" body="Custom letter that speaks to" detail="the hiring manager" icon={<MiniLetter />} onClick={() => openAuth("signup")} />
              <HeroPackageCard title="Professional Email Draft" body="Ready-to-send email draft" detail="for your application" icon={<IconBox icon="✉" />} onClick={() => openAuth("signup")} />
            </div>
            <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-center">
              <p className="text-sm font-black text-slate-800">🔒 One Profile. Unlimited Applications.</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">No rewriting. Just better applications.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto mb-3 flex max-w-[1440px] items-center gap-6 text-center text-xs font-black uppercase tracking-widest text-slate-500">
          <div className="h-px flex-1 bg-slate-200" />
          <span>Trusted by job seekers worldwide</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="mx-auto grid max-w-[1440px] gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-100 md:grid-cols-5">
          <Stat icon="▣" label="Applications Generated" value="25,000+" />
          <Stat icon="◎" label="Average ATS Match" value="92%" accent="text-green-600" />
          <Stat icon="◷" label="Average Time Saved" value="75%" accent="text-violet-600" highlight />
          <Stat icon="☆" label="User Satisfaction" value="4.9/5" accent="text-yellow-500" />
          <div className="text-center md:border-r md:border-slate-200 last:border-r-0">
            <p className="text-xl font-black text-yellow-400">★★★★★</p>
            <p className="mt-2 text-sm font-bold text-slate-700">Join our first users.</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">Help shape Career Élan.</p>
          </div>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] items-center gap-6 rounded-3xl bg-slate-50/70 p-5 md:grid-cols-3">
          <Benefit title="More Accurate" body="AI matches your profile with job requirements more accurately." badge="98% ATS Match" icon="◎" />
          <div className="rounded-[2rem] bg-blue-600 p-8 text-center text-white shadow-2xl shadow-blue-200 xl:p-9">
            <p className="mx-auto mb-3 w-fit rounded-full bg-white px-4 py-1.5 text-xs font-black text-blue-700">Most Loved Feature</p>
            <p className="text-base font-black">Save Average</p>
            <p className="mt-1 text-[64px] font-black leading-none xl:text-[72px]">75%</p>
            <p className="mt-1 text-lg font-black">Application Time</p>
            <p className="mt-4 text-yellow-300">★★★★★</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-blue-50">Save hours on every application. Focus on preparing for interviews, not rewriting documents.</p>
          </div>
          <Benefit title="Human-like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="Loved by recruiters" icon="♡" />
        </div>
      </section>

      <section id="examples" className="w-full bg-white px-5 pb-12 pt-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1.05fr_0.48fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-100">
            <h2 className="mb-5 text-center text-2xl font-black tracking-[-0.03em] text-slate-950">
              Career Élan Tailors Your Full Application Package
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <ResumePreview onClick={() => openAuth("signup")} />
              <CoverLetterPreview onClick={() => openAuth("signup")} />
              <EmailDraftPreview onClick={() => openAuth("signup")} />
            </div>
          </div>

          <aside className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-100">
            <OptimizationItem title="ATS Optimized" body="Formatted and written to pass ATS systems with a high match rate." badge="98%" />
            <OptimizationItem title="Human-Like Writing" body="Natural, professional, and persuasive writing that sounds like you." badge="98%" />
            <OptimizationItem title="Job-Specific Tailoring" body="Every document is customized to the job description and company culture." />
            <OptimizationItem title="Recruiter Approved" body="Designed to catch the eye of recruiters and hiring managers." />
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="mt-5 w-full rounded-2xl bg-blue-600 px-5 py-5 text-left text-white shadow-xl shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
            >
              <span className="block text-lg font-black">🔒 Create My Application Package</span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-blue-50">Preview available. Sign up to download your complete documents. →</span>
            </button>
            <p className="mt-3 text-center text-xs font-bold text-slate-500">Career Élan explains every optimization.</p>
          </aside>
        </div>
      </section>

      <section className="w-full bg-white px-5 py-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] items-center gap-6 rounded-3xl bg-slate-50/80 p-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="text-center">
            <p className="mx-auto mb-3 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">YOUR AI CAREER PARTNER</p>
            <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950">One Profile. Every Application.</h2>
            <div className="mt-7 flex flex-wrap justify-center gap-6 text-xs font-bold text-slate-600">
              <span>▣ Resume</span>
              <span>▣ Cover Letter</span>
              <span>✉ Email</span>
              <span>in LinkedIn</span>
              <span>▣ Portfolio</span>
              <span>▣ References</span>
            </div>
          </div>
          <div className="rounded-3xl border border-green-100 bg-green-50 p-6">
            <div className="flex gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-4xl">🧠</div>
              <div>
                <h3 className="text-xl font-black text-green-700">Career Memory</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">AI learns from your applications and gets better over time.</p>
                <ul className="mt-3 space-y-1 text-sm font-bold text-green-800">
                  <li>✓ Tracks what works</li>
                  <li>✓ Learns your preferences</li>
                  <li>✓ Improves your results</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="w-full bg-white px-5 py-8 sm:px-8 lg:px-10 xl:px-12">
        <h2 className="text-center text-2xl font-black text-slate-950">Why Career Élan is Different</h2>
        <div className="mx-auto mt-7 grid max-w-[1440px] gap-4 md:grid-cols-3 xl:grid-cols-6">
          <SmallFeature icon="💡" title="Explain WHY" body="See exactly why AI added or changed each section." />
          <SmallFeature icon="♙" title="AI Recruiter Simulation" body="Get AI feedback like a real recruiter before you apply." />
          <SmallFeature icon="🧠" title="Career Memory" body="AI learns from your applications and improves results." />
          <SmallFeature icon="🌐" title="Multi-Country Support" body="Tailored formats for Canada, US, UK, Australia & more." />
          <SmallFeature icon="🛡️" title="Human Score" body="We ensure your documents sound 100% natural." />
          <SmallFeature icon="🚀" title="Auto Apply (Coming Soon)" body="Apply to jobs automatically with one click." />
        </div>
      </section>

      <section id="how-it-works" className="w-full bg-white px-5 py-6 sm:px-8 lg:px-10 xl:px-12">
        <h2 className="text-center text-2xl font-black text-slate-950">How It Works</h2>
        <div className="mx-auto mt-7 grid max-w-[1440px] gap-4 md:grid-cols-4">
          <StepCard number="1" title="Upload Your Profile" body="Upload your resume once. AI builds your career profile." icon="⇧" />
          <StepCard number="2" title="Find or Paste Job URL" body="Search jobs inside Career Élan or paste any job URL from any website." icon="🔗" />
          <StepCard number="3" title="AI Analyzes & Tailors" body="AI analyzes the job and tailors your documents." icon="✦" />
          <StepCard number="4" title="Apply & Get Hired" body="Download or auto-apply and get more interviews." icon="✓" />
        </div>
      </section>

      <section className="w-full bg-white px-5 pt-4 sm:px-8 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-6 rounded-t-3xl bg-blue-600 p-8 text-white md:grid-cols-3">
          <div>
            <p className="text-sm font-black text-blue-100">Be Part of Something Big</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Join Our Launch Community!</h2>
            <p className="mt-3 text-sm leading-6 text-blue-50">We&apos;re building the future of job applications — and you can help shape it.</p>
            <button type="button" onClick={() => openAuth("signup")} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-black text-blue-700">Get Started →</button>
            <p className="mt-3 text-xs font-bold text-blue-100"> · Be among the first 100 users</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-6">
            <p className="text-4xl">👥</p>
            <p className="mt-4 text-xl font-black">Our First 100 Members</p>
            <p className="mt-2 text-sm leading-6 text-blue-50">Get early access, exclusive updates, and special perks.</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-6">
            <p className="text-xl font-black">Help Us Build the Best</p>
            <ul className="mt-4 space-y-2 text-sm font-bold text-blue-50">
              <li>✓ Share feedback that shapes our product</li>
              <li>✓ Get early access to new features</li>
              <li>✓ Become a founding member</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 px-6 py-10 text-white sm:px-10 lg:px-16 xl:px-20">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
          <div>
            <Image src="/logo.png" alt="Career Élan" width={190} height={74} className="h-auto w-[170px] rounded-md bg-white/95 p-1" />
            <p className="mt-4 text-sm text-slate-400">AI-powered career operating system.</p>
            <div className="mt-5 flex gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">in</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">𝕏</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">◎</span>
            </div>
          </div>
          <FooterGroup title="Product" items={["Features", "How It Works", "Examples", "Pricing"]} />
          <FooterGroup title="Company" items={["About Us", "Blog", "Careers", "Contact"]} />
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
    <Input
      value={fullName}
      onChange={setFullName}
      placeholder="Full name"
      icon="👤"
    />

    <Input
      value={phone}
      onChange={setPhone}
      placeholder="Phone number"
      icon="📞"
    />

    <Input
      value={loginId}
      onChange={setLoginId}
      placeholder="Create ID"
      icon="🆔"
      type="text"
    />

    <Input
      value={signupEmail}
      onChange={setSignupEmail}
      placeholder="Email address"
      icon="✉️"
      type="email"
    />

    <Input
      value={signupPassword}
      onChange={setSignupPassword}
      placeholder="Create password"
      icon="🔒"
      type="password"
    />

    <button
      type="button"
      onClick={handleEmailSignup}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700"
    >
      Create Account
    </button>

    <button
  type="button"
  onClick={resendConfirmationEmail}
  disabled={loading}
  className="w-full rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-600"
>
  Resend Verification Email
</button>
  </form>
) : (
  <form className="space-y-4">
    <Input
      value={loginEmail}
      onChange={setLoginEmail}
      placeholder="ID"
      icon="🆔"
      type="text"
    />

    <Input
      value={loginPassword}
      onChange={setLoginPassword}
      placeholder="Password"
      icon="🔒"
      type="password"
    />

    <button
      type="button"
      onClick={handleEmailLogin}
      disabled={loading}
      className="w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white transition hover:bg-blue-700"
    >
      Continue
    </button>
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

function Stat({ label, value, icon, accent = "text-blue-600", highlight = false }: { label: string; value: string; icon?: string; accent?: string; highlight?: boolean }) {
  return (
    <div className={`text-center md:border-r md:border-slate-200 last:border-r-0 ${highlight ? "rounded-2xl bg-blue-600 py-2 text-white md:border-r-0" : ""}`}>
      <p className={`text-3xl font-black ${highlight ? "text-white" : accent}`}>{icon && <span className="mr-3 text-2xl">{icon}</span>}{value}</p>
      <p className={`mt-2 text-sm font-bold ${highlight ? "text-blue-50" : "text-slate-700"}`}>{label}</p>
    </div>
  );
}

function Benefit({ title, body, badge, icon }: { title: string; body: string; badge: string; icon: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">{icon}</div><p className="text-xl font-black text-slate-950">{title}</p><p className="mt-4 text-sm leading-6 text-slate-600">{body}</p><p className="mt-6 w-fit rounded-full bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">{badge}</p></div>;
}

function HeroPackageCard({ title, body, detail, icon, onClick }: { title: string; body: string; detail: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-5 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-black text-slate-950">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{body}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{detail}</p>
      </div>
      <span className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">Preview</span>
      <span className="font-black text-blue-700">›</span>
    </button>
  );
}

function IconBox({ icon }: { icon: string }) {
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-black text-blue-600">{icon}</div>;
}

function MiniResume({ compact = false }: { compact?: boolean }) {
  return <div className={`${compact ? "h-20 w-16" : "h-28 w-20"} shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400`}><p className="font-black text-slate-700">ALEX CARTER</p><p className="text-blue-600">Marketing Coordinator</p><br /><p className="font-black">Summary</p><p>Results-driven professional...</p><br /><p className="font-black">Experience</p><p>Brighton Solutions Inc.</p><div className="mt-2 space-y-1"><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /></div></div>;
}

function MiniLetter() {
  return <div className="h-20 w-16 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[5px] leading-tight text-slate-400"><p className="font-black text-blue-600">LETTER</p><br /><div className="space-y-1"><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /><div className="h-px bg-slate-300" /></div></div>;
}

function ResumePreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[10px] leading-4 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3"><p className="font-black text-slate-950">AI-Optimized Resume</p><span className="rounded-full bg-green-50 px-3 py-1 text-[10px] font-black text-green-700">ATS Match 98%</span></div>
      <div className="mt-4">
        <p className="text-2xl font-black leading-none text-slate-950">ALEX CARTER</p>
        <p className="mt-1 font-black text-blue-600">Marketing Coordinator</p>
        <p className="mt-2 text-[8px] text-slate-500">Toronto, ON · alexcarter@email.com · (416) 555-9876 · linkedin.com/in/alexcarter</p>
        <hr className="my-3" />
        <p className="font-black text-slate-900">PROFESSIONAL SUMMARY</p>
        <p className="mt-1">Marketing professional with 4+ years of experience in digital marketing, campaign management, content strategy, SEO, paid media, CRM automation, and conversion-focused communications.</p>
        <p className="mt-3 font-black text-slate-900">CORE COMPETENCIES</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
          <p>• Digital Marketing</p><p>• Email Marketing</p><p>• Campaign Management</p><p>• Marketing Automation</p><p>• Content Strategy</p><p>• Data Analysis & Reporting</p><p>• SEO / SEM</p><p>• Google Analytics</p>
        </div>
        <p className="mt-3 font-black text-slate-900">PROFESSIONAL EXPERIENCE</p>
        <div className="mt-1 flex justify-between"><p className="font-black">Marketing Coordinator | Brighton Solutions Inc.</p><p>Jan 2021 – Present</p></div>
        <ul className="mt-1 list-disc pl-4"><li>Managed end-to-end digital marketing campaigns across multiple channels.</li><li>Increased website traffic by 40% and lead generation by 35% within 6 months.</li><li>Collaborated with sales team to create targeted content and email sequences.</li></ul>
        <div className="mt-2 flex justify-between"><p className="font-black">Marketing Assistant | CreativeWay Agency</p><p>May 2020 – Dec 2020</p></div>
        <ul className="mt-1 list-disc pl-4"><li>Assisted in planning and executing social media and SEO strategies.</li><li>Created content calendars and optimized copy for landing pages.</li><li>Tracked KPIs and prepared performance reports using Google Analytics.</li></ul>
        <p className="mt-3 font-black text-slate-900">EDUCATION</p>
        <div className="mt-1 flex justify-between"><p>Bachelor of Business Administration<br />University of Toronto · Toronto, ON</p><p>2016 – 2020</p></div>
        <p className="mt-3 font-black text-slate-900">SKILLS</p>
        <div className="mt-1 flex flex-wrap gap-1">{["Digital Marketing", "SEO", "Google Analytics", "Google Ads", "Meta Ads", "Content Strategy", "Email Marketing", "Marketing Automation", "Data Analysis", "Copywriting", "CRM", "Excel", "PowerPoint", "Canva"].map((s) => <span key={s} className="rounded bg-slate-100 px-2 py-1 text-[8px]">{s}</span>)}</div>
      </div>
      <PreviewLock label="Unlock full resume" />
    </button>
  );
}

function CoverLetterPreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[11px] leading-5 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="font-black text-slate-950">Personalized Cover Letter</p>
      <p className="mt-5">Dear Hiring Manager,</p>
      <p className="mt-3">I am excited to apply for the Marketing Coordinator position at Brighton Solutions Inc.</p>
      <p className="mt-3">With over 4 years of experience in digital marketing and campaign management, I have developed a strong ability to create data-driven strategies that drive engagement and deliver measurable results.</p>
      <p className="mt-3">In my current role at Brighton Solutions, I successfully increased website traffic by 60% and lead generation by 40% through targeted content and performance-driven campaigns.</p>
      <p className="mt-3">I am particularly drawn to Brighton Solutions because of your commitment to innovation and your focus on delivering exceptional results for clients.</p>
      <p className="mt-3">I look forward to the opportunity to contribute to your team.</p>
      <p className="mt-3">Sincerely,<br />Alex Carter</p>
      <PreviewLock label="Unlock full letter" />
    </button>
  );
}

function EmailDraftPreview({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left text-[11px] leading-5 text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="font-black text-slate-950">Professional Email Draft</p>
      <p className="mt-5">To: hiring.manager@brightonsolutions.com</p>
      <p>Subject: Application for Marketing Coordinator Position</p>
      <hr className="my-4" />
      <p>Hi Hiring Manager,</p>
      <p className="mt-3">I hope this email finds you well. I am very interested in the Marketing Coordinator position at Brighton Solutions Inc. and would love the opportunity to contribute to your team.</p>
      <p className="mt-3">I have attached my resume and cover letter for your review.</p>
      <p className="mt-3">My experience in digital marketing, content strategy, and campaign management aligns well with the requirements of this role.</p>
      <p className="mt-3">Thank you for your time and consideration. I look forward to the possibility of discussing how I can contribute to Brighton Solutions.</p>
      <p className="mt-3">Best regards,<br />Alex Carter</p>
      <PreviewLock label="Unlock full email" />
    </button>
  );
}

function PreviewLock({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-b from-white/10 via-white/80 to-white">
      <div className="absolute inset-x-5 bottom-16 border-t border-dashed border-blue-300" />
      <div className="absolute inset-x-0 bottom-6 text-center">
        <p className="text-xs font-semibold text-slate-500">Preview Only</p>
        <p className="mt-1 text-xs font-black text-blue-600">🔒 {label}</p>
      </div>
      <div className="absolute inset-x-5 top-10 h-20 rounded-2xl backdrop-blur-[3px]" />
    </div>
  );
}

function OptimizationItem({ title, body, badge }: { title: string; body: string; badge?: string }) {
  return (
    <div className="mb-7 flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">✓</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="font-black text-slate-950">{title}</p>
          {badge && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700">{badge}</span>}
        </div>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function SmallFeature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"><p className="text-3xl">{icon}</p><p className="mt-4 font-black text-slate-950">{title}</p><p className="mt-3 text-xs font-semibold leading-5 text-slate-600">{body}</p></div>;
}

function StepCard({ number, title, body, icon }: { number: string; title: string; body: string; icon: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-3xl text-blue-600">{icon}</div><p className="text-sm font-black text-blue-600">{number}</p><p className="font-black text-slate-950">{title}</p></div><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p></div>;
}

function FooterGroup({ title, items }: { title: string; items: string[] }) {
  return <div><p className="font-black">{title}</p><div className="mt-4 space-y-3 text-sm text-slate-400">{items.map((item) => <p key={item}>{item}</p>)}</div></div>;
}

function Input({ value, onChange, placeholder, icon, type = "text" }: { value: string; onChange: (value: string) => void; placeholder: string; icon: string; type?: string }) {
  return <div className="flex items-center rounded-xl border border-slate-300 px-4 transition focus-within:border-blue-600"><span className="mr-3 text-slate-400">{icon}</span><input value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} className="w-full bg-transparent py-3 outline-none" /></div>;
}
