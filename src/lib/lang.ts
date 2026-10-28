// The interface language, read on the server from the "lang" cookie (see i18n.tsx).
export type Lang = "fr" | "en";
export const LANG_COOKIE = "lang";

export function readLang(value: string | undefined): Lang {
  return value === "en" ? "en" : "fr";
}
