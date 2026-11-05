"use client";

import { useEffect } from "react";

// Registers /sw.js in production builds only; in dev it would serve stale bundles. A worker left
// on localhost by a production build is removed in dev: dev bundles keep their names when their
// code changes, so it would serve the old code ("sameName is not a function").
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }
    void navigator.serviceWorker.getRegistrations().then(async (workers) => {
      if (!workers.length) return;
      await Promise.all(workers.map((w) => w.unregister()));
      for (const key of await caches.keys()) await caches.delete(key);
      location.reload();
    });
  }, []);
  return null;
}
