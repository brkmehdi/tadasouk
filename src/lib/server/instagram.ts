// The merchant's own Instagram videos, read with their permission. Meta's app SmallStore logs them in
// with Facebook Login for Business, configured for a user token (META_LOGIN_CONFIG_ID): Meta's other
// choice, a business system user, was given no Instagram account in our test. The token stays in a
// sealed cookie on that phone: no table, nothing kept on our side.
// The video bytes come through this Worker because Instagram's servers forbid a page to read them.

import { getCloudflareContext } from "@opennextjs/cloudflare";

const GRAPH = "https://graph.facebook.com/v23.0";
export const TOKEN_COOKIE = "ig_link";
export const STATE_COOKIE = "ig_state";
export const COOKIE_DAYS = 60;

export class NotLinkedError extends Error {
  constructor() {
    super("Instagram is not connected");
  }
}

function config() {
  const env = getCloudflareContext().env;
  return {
    appId: env.META_APP_ID,
    configId: env.META_LOGIN_CONFIG_ID,
    secret: () => {
      if (!env.META_APP_SECRET) throw new Error("META_APP_SECRET is not set");
      return env.META_APP_SECRET;
    },
  };
}

export const callbackUrl = (origin: string) => `${origin}/api/instagram/callback`;

export function loginUrl(origin: string, state: string) {
  const { appId, configId } = config();
  const q = new URLSearchParams({
    client_id: appId,
    config_id: configId,
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    override_default_response_type: "true",
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${q}`;
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `Instagram answered ${res.status}`);
  return data;
}

// The code becomes a user token, then a long-lived one (about 60 days): the short one lasts an hour.
export async function exchangeCode(code: string, origin: string) {
  const { appId, secret } = config();
  const short = await graph<{ access_token: string }>("oauth/access_token", "", {
    client_id: appId,
    client_secret: secret(),
    redirect_uri: callbackUrl(origin),
    code,
  });
  const long = await graph<{ access_token: string }>("oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: secret(),
    fb_exchange_token: short.access_token,
  });
  return long.access_token;
}

export type Account = { id: string; username: string };

// The Instagram account the merchant chose in Meta's login. The token names it (its instagram_basic
// permission lists the accounts it covers); failing that, the account linked to one of their Pages.
export async function findAccount(token: string): Promise<Account | null> {
  const { appId, secret } = config();
  const debug = await graph<{ data: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("debug_token", `${appId}|${secret()}`, {
    input_token: token,
  });
  const id = debug.data.granular_scopes?.find((s) => s.scope === "instagram_basic")?.target_ids?.[0];
  if (id) return graph<Account>(id, token, { fields: "id,username" });
  const pages = await graph<{ data: { instagram_business_account?: Account }[] }>("me/accounts", token, {
    fields: "instagram_business_account{id,username}",
  });
  const linked = pages.data.find((p) => p.instagram_business_account)?.instagram_business_account ?? null;
  if (!linked) console.error("instagram: no account in the token nor on its", pages.data.length, "Pages");
  return linked;
}

export type Video = {
  id: string;
  caption: string;
  thumbnail: string | null;
  at: string;
};

export async function listVideos(link: Link): Promise<Video[]> {
  const media = await graph<{
    data: {
      id: string;
      media_type: string;
      caption?: string;
      thumbnail_url?: string;
      timestamp: string;
    }[];
  }>(`${link.account!.id}/media`, link.token, {
    fields: "id,media_type,caption,thumbnail_url,timestamp",
    limit: "30",
  });
  return media.data
    .filter((m) => m.media_type === "VIDEO")
    .map((m) => ({
      id: m.id,
      caption: (m.caption ?? "").slice(0, 120),
      thumbnail: m.thumbnail_url ?? null,
      at: m.timestamp,
    }));
}

// The video file itself. The id is checked against the merchant's own account before anything is read.
export async function openVideo(link: Link, id: string) {
  const m = await graph<{
    media_url?: string;
    media_type: string;
    owner?: { id: string };
  }>(id, link.token, {
    fields: "media_url,media_type,owner",
  });
  if (m.media_type !== "VIDEO" || !m.media_url || m.owner?.id !== link.account!.id) return null;
  const res = await fetch(m.media_url);
  return res.ok && res.body ? res : null;
}

// --- The sealed cookie: AES-GCM with a key derived from the app secret, bound to the SmallStore user.

// `account` is null while it could not be found: the token is kept, so finding it later needs no new login.
export type Link = { user: string; token: string; account: Account | null };

async function key() {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(config().secret()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: new TextEncoder().encode("smallstore instagram link"),
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(link: Link) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(link))));
  return `${b64(iv)}.${b64(box)}`;
}

// The link of this user, or an error: a cookie made for another account on the same phone is ignored.
export async function unseal(cookie: string | undefined, user: string): Promise<Link> {
  const [iv, box] = (cookie ?? "").split(".");
  if (!iv || !box) throw new NotLinkedError();
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(box));
    const link = JSON.parse(new TextDecoder().decode(plain)) as Link;
    if (link.user !== user) throw new NotLinkedError();
    return link;
  } catch {
    throw new NotLinkedError();
  }
}
