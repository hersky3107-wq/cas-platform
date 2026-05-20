import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0f1e] px-6 text-white">
      <div className="flex max-w-md flex-col items-center text-center">
        <p className="text-xs font-medium uppercase tracking-[0.28em] text-cyan-300/85">
          AIMANI
        </p>
        <h1 className="mt-6 text-2xl font-semibold sm:text-3xl">404 — Page Not Found</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          Looks like this page got lost in the multiverse.
        </p>
        <Link
          href="/"
          className="mt-8 rounded-xl bg-cyan-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-cyan-500"
        >
          Back to Home
        </Link>
      </div>
    </main>
  )
}
