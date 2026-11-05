"use client";

// The tools grid on the Home tab, and the full-screen panel of the open tool.

import { useT } from "@/lib/i18n";
import AdsStudio from "./AdsStudio";
import CreditBook from "./CreditBook";
import Marketplaces from "./Marketplaces";
import QrPay from "./QrPay";
import StockCamera from "./StockCamera";
import type { ToolId, ToolProps } from "./types";
import Visibility from "./Visibility";

const TOOLS: { id: ToolId; fr: [string, string]; en: [string, string]; icon: React.ReactNode }[] = [
  {
    id: "credit",
    fr: ["Carnet de crédit", "Qui doit quoi, rappels WhatsApp"],
    en: ["Credit book", "Who owes what, WhatsApp reminders"],
    icon: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6" />,
  },
  {
    id: "stockcam",
    fr: ["Caméra de stock", "Ventes et arrivages vus par la caméra"],
    en: ["Stock camera", "Sales and deliveries seen by the camera"],
    icon: (
      <>
        <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  {
    id: "qrpay",
    fr: ["Encaisser par carte", "QR code en boutique"],
    en: ["Take a card payment", "QR code in the shop"],
    icon: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />,
  },
  {
    id: "ads",
    fr: ["Publicités", "Facebook et Instagram"],
    en: ["Ads", "Facebook and Instagram"],
    icon: <path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />,
  },
  {
    id: "market",
    fr: ["Marketplaces", "Stock partagé avec marge"],
    en: ["Marketplaces", "Shared stock with a margin"],
    icon: <path d="M4 9 5.5 4h13L20 9M4 9h16M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M9 13h6" />,
  },
  {
    id: "seo",
    fr: ["Visibilité", "Google et assistants IA"],
    en: ["Visibility", "Google and AI assistants"],
    icon: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </>
    ),
  },
];

export function ToolsGrid({ onOpen }: { onOpen: (id: ToolId) => void }) {
  const { lang } = useT();
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">{lang === "fr" ? "Outils" : "Tools"}</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {TOOLS.map((tool) => {
          const [title, hint] = tool[lang];
          return (
            <button key={tool.id} type="button" onClick={() => onOpen(tool.id)} className="ui-card flex flex-col gap-2 p-3 text-start">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="text-ink-2"
                aria-hidden
              >
                {tool.icon}
              </svg>
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ToolPanel({ id, ...props }: ToolProps & { id: ToolId }) {
  const Tool = { credit: CreditBook, stockcam: StockCamera, qrpay: QrPay, ads: AdsStudio, market: Marketplaces, seo: Visibility }[id];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <Tool {...props} />
    </div>
  );
}
