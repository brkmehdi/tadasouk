"use client";

// Sign up and sign in. "Continuer avec Google", or one field that takes an email or a phone
// number: an email asks for a password, a phone number gets a code on WhatsApp (the merchant
// writes to Tadasouk first, so our answer with the code is free).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/browser";
import { displayPhone, looksLikePhone, phoneDigits } from "@/lib/phone";

type Step = "start" | "create" | "login" | "code" | "mail";

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";
const MIN_PASSWORD = 8;

function frenchError(message: string) {
  const m = message.toLowerCase();
  if (m.startsWith("password ") || m.includes("password should be")) return `Le mot de passe doit faire ${MIN_PASSWORD} caractères au moins.`;
  if (m.includes("invalid login credentials")) return "Email ou mot de passe incorrect.";
  if (m.includes("already registered")) return "Un compte existe déjà avec cet email. Connectez-vous.";
  if (m.includes("token") || m.includes("otp")) return "Code incorrect ou expiré.";
  if (m.includes("phone")) return "Ce numéro ne semble pas valide.";
  if (m.includes("signups not allowed")) return "Aucun compte avec ce numéro. Créez votre compte.";
  if (m.includes("security purposes") || m.includes("rate limit")) return "Attendez quelques secondes, puis réessayez.";
  if (m.includes("email not confirmed")) return "Confirmez d'abord votre email : ouvrez le lien reçu.";
  return "Ça n'a pas marché. Réessayez.";
}

export default function SignIn({ linkError }: { linkError: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? "Ce lien ne marche plus. Réessayez." : null);

  const isPhone = looksLikePhone(id);
  const digits = phoneDigits(id);
  const creating = step === "create";

  // No bounce to /app when a session exists: the page shows who is signed in, with
  // "Se déconnecter", so the merchant can switch accounts (connexion/page.tsx).

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(frenchError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const google = () =>
    run(async () => {
      const { error } = await supabase().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback?next=/app` },
      });
      if (error) throw error;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (isPhone) {
        const { error } = await supabase().auth.signInWithOtp({ phone: `+${digits}`, options: { shouldCreateUser: creating } });
        if (error) throw error;
        setStep("code");
        return;
      }
      const email = id.trim();
      if (creating) {
        if (password.length < MIN_PASSWORD) throw new Error(`password ${MIN_PASSWORD}`);
        const { data, error } = await supabase().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=/app` },
        });
        if (error) throw error;
        if (data.session) router.replace("/app");
        else setStep("mail");
        return;
      }
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/app");
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error } = await supabase().auth.verifyOtp({ phone: `+${digits}`, token: code.trim(), type: "sms" });
      if (error) throw error;
      router.replace("/app");
    });
  };

  const back = () => {
    setStep("start");
    setError(null);
    setPassword("");
    setCode("");
  };

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-6 pt-[18vh] text-ink">
      <div className="w-full max-w-sm">
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo, no resizing needed */}
          <img src="/brand/tadasouk-horizontal-color.svg" alt="Tadasouk" width={129} height={40} className="h-10 w-auto" />
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {step === "login" ? "Content de vous revoir." : "Filmez vos produits, votre boutique se construit toute seule."}
        </p>

        {step === "start" && (
          <div className="mt-8 flex flex-col gap-3">
            <button type="button" className="ui-btn ui-btn-secondary h-11 w-full" onClick={() => void google()} disabled={busy}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
              <img src="/brands/google.svg" alt="" width={18} height={18} className="h-[18px] w-[18px] shrink-0" />
              Continuer avec Google
            </button>
            <button type="button" className="ui-btn ui-btn-primary h-11 w-full" onClick={() => setStep("create")}>
              Créer mon compte
            </button>
            <button type="button" className="mt-2 text-sm font-medium text-brand" onClick={() => setStep("login")}>
              J&apos;ai déjà un compte
            </button>
          </div>
        )}

        {(step === "create" || step === "login") && (
          <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
            <div>
              <label className="ui-label" htmlFor="id">
                Email ou numéro de téléphone
              </label>
              <input
                id="id"
                className="ui-input"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="username"
                inputMode="email"
                placeholder="vous@exemple.ma ou 06 12 34 56 78"
                required
                autoFocus
              />
            </div>
            {id.trim() !== "" && !isPhone && (
              <div>
                <label className="ui-label" htmlFor="password">
                  Mot de passe
                </label>
                <input
                  id="password"
                  className="ui-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={creating ? "new-password" : "current-password"}
                  minLength={creating ? MIN_PASSWORD : undefined}
                  required
                />
                {creating && <p className="mt-1.5 text-xs text-ink-3">{MIN_PASSWORD} caractères au moins.</p>}
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" className="ui-btn ui-btn-primary h-11 w-full" disabled={busy || !id.trim()}>
              {isPhone ? "Recevoir mon code sur WhatsApp" : creating ? "Créer mon compte" : "Se connecter"}
            </button>
            <button type="button" className="text-sm font-medium text-brand" onClick={() => setStep(creating ? "login" : "create")}>
              {creating ? "J'ai déjà un compte" : "Créer un compte"}
            </button>
            <button type="button" className="text-sm text-ink-3" onClick={back}>
              Retour
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="mt-8 flex flex-col gap-4" onSubmit={verify}>
            <ol className="flex flex-col gap-4 text-sm">
              <li>
                <p className="font-medium">1. Écrivez à Tadasouk sur WhatsApp</p>
                <p className="mt-1 text-ink-3">Depuis le {displayPhone(digits)}. Nous vous répondons avec votre code.</p>
                {WHATSAPP ? (
                  <a
                    className="ui-btn ui-btn-secondary mt-2 h-11 w-full"
                    href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Mon code Tadasouk")}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Ouvrir WhatsApp
                  </a>
                ) : (
                  <p className="mt-2 text-ink-3">Le numéro WhatsApp de Tadasouk n&apos;est pas encore branché.</p>
                )}
              </li>
              <li>
                <label className="font-medium" htmlFor="code">
                  2. Tapez le code reçu
                </label>
                <input
                  id="code"
                  className="ui-input mt-2 text-center tracking-[0.3em] tabular-nums"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  required
                />
              </li>
            </ol>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" className="ui-btn ui-btn-primary h-11 w-full" disabled={busy || code.length < 6}>
              Valider
            </button>
            <button type="button" className="text-sm text-ink-3" onClick={back}>
              Changer de numéro
            </button>
          </form>
        )}

        {step === "mail" && (
          <div className="mt-8 text-sm">
            <p className="font-medium">Vérifiez votre boîte mail</p>
            <p className="mt-1 text-ink-3">Nous avons envoyé un lien à {id.trim()}. Ouvrez-le pour activer votre compte.</p>
            <button type="button" className="mt-6 text-sm text-ink-3" onClick={back}>
              Retour
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
