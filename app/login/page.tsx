export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-bold">Login</h1>
        <p className="mt-2 text-slate-500">
          Please log in from the homepage modal.
        </p>
        <a
          href="/"
          className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-3 font-bold text-white"
        >
          Go to Home
        </a>
      </div>
    </main>
  );
}