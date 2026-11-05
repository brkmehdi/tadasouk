"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { COPY, DEMO_SLUG, type Lang } from "./copy";
import "./landing.css";

// ---- language: French by default; ?lang=en or the saved choice switch it (no setState in effects)
const KEY = "tadasouk-lang";
let current: Lang | null = null;
const listeners = new Set<() => void>();

function readInitial(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "en" || q === "fr") return q;
    const saved = window.localStorage.getItem(KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // storage blocked: stay in French
  }
  return "fr";
}
function getLang(): Lang {
  if (current === null) current = readInitial();
  return current;
}
function setLang(l: Lang) {
  current = l;
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Brand files from the owner's logo kit (public/brand). Horizontal logo: 1487.64 x 462.
const LOGO_RATIO = 1487.64 / 462;

function Logo({ variant, height }: { variant: "color" | "reversed" | "white"; height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/brand/tadasouk-horizontal-${variant}.svg`} alt="Tadasouk" width={Math.round(height * LOGO_RATIO)} height={height} />
  );
}

export default function Landing() {
  const lang = useSyncExternalStore(subscribe, getLang, () => "fr" as Lang);
  const c = COPY[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="tdk">
      <a className="tdk-skip" href="#contenu">
        {lang === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>

      <header className="tdk-top">
        <div className="tdk-wrap tdk-top-in">
          <Link href="/" className="tdk-brand" aria-label="Tadasouk">
            <Logo variant="color" height={40} />
          </Link>
          <nav className="tdk-nav" aria-label={c.nav.label}>
            <a href="#comment">{c.nav.how}</a>
            <a href="#fonctions">{c.nav.features}</a>
            <a href="#maroc">{c.nav.morocco}</a>
            <a href="#questions">{c.nav.faq}</a>
          </nav>
          <div className="tdk-top-actions">
            <div className="tdk-lang" role="group" aria-label={c.langLabel}>
              {(["fr", "en"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Link href="/connexion" className="tdk-signin">
              {c.signIn}
            </Link>
            <Link href="/connexion" className="tdk-btn tdk-btn-primary tdk-btn-sm">
              {c.open}
            </Link>
          </div>
        </div>
      </header>

      <main id="contenu">
        {/* ---- hero */}
        <section className="tdk-hero">
          <div className="tdk-wrap tdk-hero-in">
            <div className="tdk-hero-text">
              <p className="tdk-eyebrow">{c.hero.eyebrow}</p>
              <h1>{c.hero.h1}</h1>
              <p className="tdk-darija" dir="rtl" lang="ar-MA">
                صوّر السلعة ديالك و هضر، الحانوت كتبني راسها
              </p>
              <p className="tdk-lead">{c.hero.sub}</p>
              <div className="tdk-ctas">
                <Link href="/connexion" className="tdk-btn tdk-btn-primary">
                  {c.open}
                </Link>
                <Link href={`/${DEMO_SLUG}`} className="tdk-btn tdk-btn-outline">
                  {c.hero.demo}
                </Link>
              </div>
              <p className="tdk-note">{c.hero.note}</p>
            </div>

            <div className="tdk-hero-visual">
              {/* A real frame from a seller's video, with the capture screen's controls drawn on top. */}
              <div className="tdk-phone">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing/hero-foundation.webp" alt={c.hero.phoneAlt} width={360} height={640} fetchPriority="high" />
                <span className="tdk-ui-rec" aria-hidden="true">
                  <span className="tdk-ui-rec-dot" />
                  REC
                </span>
                <span className="tdk-ui-ask" aria-hidden="true">
                  {c.hero.ask}
                </span>
                <span className="tdk-ui-shutter" aria-hidden="true">
                  <span />
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- how it works */}
        <section className="tdk-sec tdk-alt" id="comment" aria-labelledby="h-comment">
          <div className="tdk-wrap">
            <h2 id="h-comment">{c.how.h2}</h2>
            <p className="tdk-intro">{c.how.intro}</p>
            <ol className="tdk-steps">
              {c.how.steps.map((s, i) => (
                <li key={s.t}>
                  <div className="tdk-step-img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.img} alt={s.alt} width={360} height={450} loading="lazy" decoding="async" />
                  </div>
                  <div className="tdk-step-body">
                    <span className="tdk-step-n">{i + 1}</span>
                    <h3>{s.t}</h3>
                    <p>{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="tdk-credit">{c.how.credit}</p>
          </div>
        </section>

        {/* ---- features */}
        <section className="tdk-sec" id="fonctions" aria-labelledby="h-fonctions">
          <div className="tdk-wrap">
            <h2 id="h-fonctions">{c.features.h2}</h2>
            <p className="tdk-intro">{c.features.intro}</p>
            <ul className="tdk-cards">
              {c.features.items.map((f) => (
                <li key={f.t} className="tdk-card">
                  <h3>{f.t}</h3>
                  <p>{f.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- Morocco */}
        <section className="tdk-sec tdk-alt" id="maroc" aria-labelledby="h-maroc">
          <div className="tdk-wrap">
            <h2 id="h-maroc">{c.morocco.h2}</h2>
            <p className="tdk-intro">{c.morocco.intro}</p>
            <ul className="tdk-ma">
              {c.morocco.items.map((m) => (
                <li key={m.t}>
                  <h3>{m.t}</h3>
                  <p>{m.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- Meta models */}
        <section className="tdk-band" id="meta" aria-labelledby="h-meta">
          <div className="tdk-wrap">
            <h2 id="h-meta">{c.meta.h2}</h2>
            <p className="tdk-intro">{c.meta.intro}</p>
            <ul className="tdk-models">
              {c.meta.models.map((m) => (
                <li key={m.name}>
                  <h3>{m.name}</h3>
                  <p>{m.d}</p>
                </li>
              ))}
            </ul>
            <p className="tdk-band-note">{c.meta.note}</p>
          </div>
        </section>

        {/* ---- start */}
        <section className="tdk-sec" id="demarrer" aria-labelledby="h-demarrer">
          <div className="tdk-wrap">
            <h2 id="h-demarrer">{c.start.h2}</h2>
            <ol className="tdk-start">
              {c.start.steps.map((s, i) => (
                <li key={s.t}>
                  <span className="tdk-start-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---- FAQ */}
        <section className="tdk-sec tdk-alt" id="questions" aria-labelledby="h-questions">
          <div className="tdk-wrap tdk-narrow">
            <h2 id="h-questions">{c.faq.h2}</h2>
            <div className="tdk-faq">
              {c.faq.items.map((f) => (
                <details key={f.q}>
                  <summary>
                    <h3>{f.q}</h3>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---- closing call */}
        <section className="tdk-close" aria-labelledby="h-close">
          <div className="tdk-wrap tdk-close-in">
            <h2 id="h-close">{c.close.h2}</h2>
            <p>{c.close.sub}</p>
            <Link href="/connexion" className="tdk-btn tdk-btn-white">
              {c.open}
            </Link>
          </div>
        </section>
      </main>

      <footer className="tdk-foot">
        <div className="tdk-wrap tdk-foot-in">
          <div>
            <Logo variant="reversed" height={38} />
            <p>{c.footer.tagline}</p>
          </div>
          <ul>
            <li>
              <Link href="/connexion">{c.open}</Link>
            </li>
            <li>
              <Link href="/connexion">{c.signIn}</Link>
            </li>
            <li>
              <Link href={`/${DEMO_SLUG}`}>{c.footer.demo}</Link>
            </li>
            <li>
              <Link href="/confidentialite">{c.footer.privacy}</Link>
            </li>
          </ul>
        </div>
        <div className="tdk-wrap tdk-foot-small">
          <p>{c.footer.hackathon}</p>
          <p>© 2026 Tadasouk. {c.footer.rights}</p>
        </div>
      </footer>
    </div>
  );
}
