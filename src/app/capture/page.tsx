import type { Metadata } from "next";
import CaptureScreen from "./CaptureScreen";

export const metadata: Metadata = { title: "Record · Hanout" };

export default function CapturePage() {
  return <CaptureScreen />;
}
