import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import CaptureScreen from "./CaptureScreen";

export const metadata: Metadata = { title: "Record · Tadasouk" };

// The AI calls need an account (each one is charged to its AI credit).
export default async function CapturePage() {
  if (!(await currentUser())) redirect("/connexion");
  return <CaptureScreen />;
}
