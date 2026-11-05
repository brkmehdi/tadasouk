// Platform owner: every account, its store, its AI use; activate waiting accounts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminUser, listAccounts } from "@/lib/server/admin";
import Accounts from "./Accounts";

export const metadata: Metadata = { title: "Admin · Tadasouk", robots: { index: false } };

export default async function AdminPage() {
  if (!(await adminUser())) notFound();
  const accounts = await listAccounts();
  return <Accounts accounts={accounts.map((a) => ({ ...a, created_at: new Date(a.created_at).toISOString() }))} />;
}
