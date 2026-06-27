import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-white px-6 py-10">
      <div className="mx-auto grid min-h-[85vh] w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <section className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 to-blue-500 p-12 text-white md:flex">
          <div>
            <div className="inline-flex rounded-2xl bg-white p-4 shadow-lg">
              <Image src="/logo.png" alt="Career Élan" width={180} height={70} priority />
            </div>

            <h1 className="mt-14 text-5xl font-extrabold leading-tight">
              Your career,
              <br />
              organized by AI.
            </h1>

            <p className="mt-6 max-w-md text-lg leading-8 text-blue-100">
              Create tailored resumes, generate cover letters, analyze job
              postings, and track every application in one place.
            </p>
          </div>

          <p className="text-sm font-medium text-blue-100">
            One Profile. Every Application.
          </p>
        </section>

        <section className="flex items-center justify-center p-8 md:p-14">
          <div className="w-full max-w-md">
            <div className="mb-10 md:hidden">
              <Image src="/logo.png" alt="Career Élan" width={170} height={60} priority />
            </div>

            <h2 className="text-4xl font-extrabold text-gray-900">
              Welcome back
            </h2>

            <p className="mt-3 text-gray-500">
              Sign in to continue building your career.
            </p>

            <div className="mt-8 space-y-4">
              <button className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 px-5 py-3 font-semibold text-gray-700 transition hover:bg-gray-50">
                <img
                  src="https://www.google.com/favicon.ico"
                  alt="Google"
                  className="h-5 w-5"
                />
                Continue with Google
              </button>

              <button className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 px-5 py-3 font-semibold text-gray-700 transition hover:bg-gray-50">
                <img
                  src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/linkedin.svg"
                  alt="LinkedIn"
                  className="h-5 w-5"
                />
                Continue with LinkedIn
              </button>
            </div>

            <div className="my-8 flex items-center gap-4">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-sm font-medium text-gray-400">OR</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <form className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-gray-700">
                  Email
                </label>

                <div className="mt-2 flex items-center rounded-xl border border-gray-300 px-4 transition focus-within:border-blue-600">
                  <span className="mr-3 text-gray-400">✉️</span>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="w-full bg-transparent py-3 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700">
                  Password
                </label>

                <div className="mt-2 flex items-center rounded-xl border border-gray-300 px-4 transition focus-within:border-blue-600">
                  <span className="mr-3 text-gray-400">🔒</span>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    className="w-full bg-transparent py-3 outline-none"
                  />
                  <span className="ml-3 cursor-pointer text-gray-400">👁️</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-gray-600">
                  <input type="checkbox" className="h-4 w-4" />
                  Remember me
                </label>

                <a href="#" className="font-semibold text-blue-600">
                  Forgot password?
                </a>
              </div>

              <button
                type="button"
                className="w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white transition hover:bg-blue-700"
              >
                Log In
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-gray-500">
              Don&apos;t have an account?{" "}
              <a href="/signup" className="font-bold text-blue-600">
                Sign up
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}