// Phone numbers as merchants type them in Morocco ("06 12 34 56 78", "+212 6…", "00212…"),
// turned into international digits without "+" ("212612345678"), the form wa.me and
// WhatsApp webhooks use. Supabase Auth takes the same digits with a leading "+".

export function phoneDigits(input: string) {
  const d = input.replace(/\D/g, "");
  if (/^0[5-7]\d{8}$/.test(d)) return "212" + d.slice(1);
  return d.replace(/^00/, "");
}

// Good enough to tell a phone number from an email in a single "email or phone" field.
export function looksLikePhone(input: string) {
  const t = input.trim();
  return !t.includes("@") && /^[+\d][\d\s().-]{6,}$/.test(t) && phoneDigits(t).length >= 9;
}

export function displayPhone(digits: string) {
  const m = digits.match(/^212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `+212 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : `+${digits}`;
}
