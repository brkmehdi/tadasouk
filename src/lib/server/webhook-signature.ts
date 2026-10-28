// Standard Webhooks signatures (https://www.standardwebhooks.com/), used by Supabase Auth hooks.
// The sender signs "{webhook-id}.{webhook-timestamp}.{body}" with HMAC-SHA256 and a secret
// written "v1,whsec_<base64>"; `webhook-signature` lists one or more "v1,<base64>" values.

const TOLERANCE_S = 5 * 60;

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStandardWebhook(headers: Headers, body: string, secret: string) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secret.replace(/^v1,whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const expected = bytesToBase64(mac);
  return signatures.split(" ").some((s) => {
    const [version, sig] = s.split(",");
    return version === "v1" && !!sig && sameString(sig, expected);
  });
}
