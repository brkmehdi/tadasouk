// A "Se déconnecter" button for any page, server or client: a plain form posting to
// /api/auth/signout, which ends the session and opens the sign-in page. With `icon`, it shows a
// door-and-arrow icon and keeps the words for screen readers and the tooltip.

export default function SignOutButton({ label = "Se déconnecter", className = "", icon = false }: { label?: string; className?: string; icon?: boolean }) {
  return (
    <form action="/api/auth/signout" method="post" className="contents">
      <button
        type="submit"
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        className={className || "text-sm font-medium text-ink-2 underline underline-offset-2 hover:text-ink"}
      >
        {icon ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11" />
          </svg>
        ) : (
          label
        )}
      </button>
    </form>
  );
}
