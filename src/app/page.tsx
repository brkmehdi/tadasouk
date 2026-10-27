import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Hanout</h1>
        <p className="mt-2 text-neutral-400">Film your products and talk. Your shop builds itself.</p>
        <p className="mt-1 text-neutral-400" dir="rtl">
          صوّر السلعة ديالك و هضر، الحانوت كتبني راسها
        </p>
      </div>
      <Link
        href="/capture"
        className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/90"
        aria-label="Record"
      >
        <span className="h-24 w-24 rounded-full bg-red-500" />
      </Link>
    </main>
  );
}
