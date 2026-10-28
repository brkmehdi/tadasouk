// Platform owner: the raw videos of every filming session, to watch or download.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminUser, listCaptures } from "@/lib/server/admin";
import Videos from "./Videos";

export const metadata: Metadata = { title: "Vidéos · Admin · SmallStore", robots: { index: false } };

export default async function VideosPage() {
  if (!(await adminUser())) notFound();
  return <Videos captures={await listCaptures()} />;
}
