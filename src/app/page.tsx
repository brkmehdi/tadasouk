import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-white px-6 text-center text-ink">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">SmallStore</h1>
        <p className="mt-2 text-ink-3">Filmez vos produits et parlez. Votre boutique se construit toute seule.</p>
        <p className="mt-1 text-ink-3" dir="rtl">
          صوّر السلعة ديالك و هضر، الحانوت كتبني راسها
        </p>
      </div>
      <Link
        href="/capture"
        className="flex h-16 w-16 items-center justify-center rounded-full ring-[3px] ring-ink/80"
        aria-label="Filmer"
      >
        <span className="h-[52px] w-[52px] rounded-full bg-red-500" />
      </Link>
    </main>
  );
}
