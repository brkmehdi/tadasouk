"use client";

// The merchant's own Instagram videos, in the video import: connect the account (Meta's login, see
// src/lib/server/instagram.ts), pick a video, or forget the account on this phone. The video itself
// is fetched and read by the import.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Insta =
  { state: "loading" | "off" | "error" } | { state: "on"; username: string; videos: { id: string; caption: string; thumbnail: string | null }[] };

export default function InstagramVideos({ onPick }: { onPick: (id: string) => void }) {
  const { t } = useT();
  const [insta, setInsta] = useState<Insta>({ state: "loading" });

  useEffect(() => {
    fetch("/api/instagram/videos")
      .then(async (res) => {
        if (res.status === 409) return setInsta({ state: "off" });
        const data = (await res.json()) as Extract<Insta, { state: "on" }>;
        setInsta(res.ok ? { state: "on", username: data.username, videos: data.videos } : { state: "error" });
      })
      .catch(() => setInsta({ state: "error" }));
  }, []);

  const disconnect = async () => {
    await fetch("/api/instagram/videos", { method: "DELETE" }).catch(() => {});
    setInsta({ state: "off" });
  };

  return (
    <section className="mt-8 border-t border-line pt-5" data-testid="instagram">
      <h2 className="text-sm font-semibold">{t("insta.title")}</h2>
      {insta.state === "loading" && <p className="mt-2 text-xs text-ink-3">…</p>}
      {insta.state === "error" && <p className="mt-2 text-xs text-ink-3">{t("insta.failed")}</p>}
      {insta.state === "off" && (
        <>
          <p className="mt-1 text-xs text-ink-3">{t("insta.intro")}</p>
          <button
            type="button"
            // A full page load: this route sends the browser on to Meta's login.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            onClick={() => window.location.assign("/api/instagram/connect")}
            className="ui-btn ui-btn-secondary mt-3 h-11 w-full"
          >
            {t("insta.connect")}
          </button>
        </>
      )}
      {insta.state === "on" && (
        <>
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-3">
            <span className="min-w-0 flex-1 truncate">@{insta.username}</span>
            <button type="button" onClick={disconnect} className="underline">
              {t("insta.disconnect")}
            </button>
          </p>
          {!insta.videos.length && <p className="mt-3 text-sm text-ink-2">{t("insta.none")}</p>}
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {insta.videos.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => onPick(v.id)}
                  className="block aspect-[9/16] w-full overflow-hidden rounded-md bg-soft"
                  aria-label={v.caption || t("insta.video")}
                >
                  {v.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
