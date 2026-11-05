// AES-GCM for the few secrets the database keeps (the Tchentchen keys saved by the Connect page).
// The encryption key comes from a Cloudflare secret, so the database only ever holds
// "v1.<iv>.<ciphertext>". The label is bound to the ciphertext: a value sealed as the test key
// cannot be opened as the live key. Server only.

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Any long random string works as the secret (`openssl rand -hex 32`): it is hashed to a 256-bit key.
async function aesKey(secret: string) {
  if (secret.length < 32) throw new Error("The encryption secret is too short (32 characters at least).");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(plain: string, secret: string, label: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(label) }, await aesKey(secret), enc.encode(plain));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(data))}`;
}

export async function unseal(sealed: string, secret: string, label: string) {
  const [v, iv, data] = sealed.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("Not a sealed value.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(label) }, await aesKey(secret), fromB64url(data));
  return new TextDecoder().decode(plain);
}
