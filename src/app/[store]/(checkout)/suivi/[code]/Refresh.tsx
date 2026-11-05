"use client";

// Reads the tracking page again every 8 s while the parcel travels, so a step the seller marks
// shows up on the customer's phone without a reload.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
