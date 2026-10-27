"use client";

import { useEffect } from "react";

// Registers /sw.js in production builds only; in dev it would serve stale bundles.
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
