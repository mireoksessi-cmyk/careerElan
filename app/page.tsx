import Image from "next/image";

const features = [
  {
    title: "AI Resume Builder",
    description:
      "Generate tailored resumes in seconds for every job application.",
  },
  {
    title: "AI Cover Letter",
    description:
      "Create personalized cover letters that match each position.",
  },
  {
    title: "Job Analyzer",
    description:
      "Analyze job descriptions and discover missing skills instantly.",
  },
  {
    title: "Application Tracker",
    description:
      "Manage all your applications in one organized dashboard.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-100">

      {/* Navbar */}
      <nav className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white/80 px-10 py-5 backdrop-blur">

        <Image
          src="/logo.png"
          alt="Career Élan"
          width={160}
          height={55}
          priority
        />

        <div className="flex items-center gap-8 text-gray-700 font-medium">

          <a href="#" className="hover:text-blue-600 transition">
            Features
          </a>

          <a href="#" className="hover:text-blue-600 transition">
            Pricing
          </a>

          <a href="#" className="hover:text-blue-600 transition">
            About
          </a>

          <button className="rounded-lg border border-gray-300 px-5 py-2 hover:bg-gray-100 transition">
            Log In
          </button>

          <button className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 transition">
            Get Started
          </button>

        </div>

      </nav>

      {/* Hero */}

      <section className="mx-auto flex max-w-6xl flex-col items-center px-6 py-24 text-center">

        <Image
          src="/logo.png"
          alt="Career Élan"
          width={260}
          height={260}
          priority
        />

        <span className="mt-8 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
          AI-Powered Career Platform
        </span>

        <h1 className="mt-8 text-6xl font-extrabold leading-tight text-gray-900">
          One Profile.
          <br />
          Every Application.
        </h1>

        <p className="mt-8 max-w-3xl text-xl leading-9 text-gray-600">
          Build resumes, generate cover letters, analyze job descriptions,
          and track every application with AI — all in one platform.
        </p>

        <div className="mt-10 flex gap-5">

          <button className="rounded-xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white hover:bg-blue-700 transition">
            Get Started
          </button>

          <button className="rounded-xl border border-gray-300 px-8 py-4 text-lg font-semibold hover:bg-gray-100 transition">
            Learn More
          </button>

        </div>

      </section>

      {/* Features */}

      <section className="mx-auto max-w-7xl px-8 pb-24">

        <h2 className="mb-12 text-center text-4xl font-bold">
          Everything You Need
        </h2>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">

          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition hover:-translate-y-2 hover:shadow-xl"
            >
              <div className="mb-6 text-5xl">✨</div>

              <h3 className="text-2xl font-bold">
                {feature.title}
              </h3>

              <p className="mt-4 text-gray-600 leading-7">
                {feature.description}
              </p>
            </div>
          ))}

        </div>

      </section>

      {/* CTA */}

      <section className="bg-blue-600 py-24 text-center text-white">

        <h2 className="text-5xl font-bold">
          Ready to optimize your career?
        </h2>

        <p className="mx-auto mt-6 max-w-3xl text-xl opacity-90">
          Join Career Élan and let AI simplify your entire job application process.
        </p>

        <button className="mt-10 rounded-xl bg-white px-10 py-4 text-lg font-bold text-blue-600 hover:bg-gray-100 transition">
          Start Free
        </button>

      </section>

      {/* Footer */}

      <footer className="border-t bg-white py-8 text-center text-gray-500">
        © 2026 Career Élan. All rights reserved.
      </footer>

    </main>
  );
}