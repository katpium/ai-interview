import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-8 text-neutral-100">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">AI Interview</p>
          <h1 className="text-3xl font-semibold">Welcome</h1>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3">
          <p className="text-sm text-neutral-400">
            <strong className="text-neutral-200">Candidates:</strong> You need an invitation link from your recruiter to start the interview.
          </p>
          <p className="text-sm text-neutral-400">
            <strong className="text-neutral-200">Staff:</strong> Sign in to access the review panel and admin tools.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Staff Sign In
          </Link>
          <Link
            href="/interview"
            className="rounded-full border border-neutral-700 px-6 py-3 text-sm font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            I have an interview link
          </Link>
        </div>
      </div>
    </main>
  );
}
