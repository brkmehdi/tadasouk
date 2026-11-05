"use client";

// Back office: a menu like a shop's (home, products, sales, settings) with the red record button
// in the middle. The button opens the camera in the same tap (iOS needs the tap for the camera
// and the sound) over the menu; its exit button comes back here, where the filmed products are
// already saved as drafts.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CaptureScreen, { type CaptureApi } from "@/app/capture/CaptureScreen";
import SellMode from "@/app/capture/SellMode";
import type { Order } from "@/lib/catalog/orders";
import { toSessionProduct, type CatalogProduct } from "@/lib/catalog/types";
import { I18nProvider, useT, type Lang } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";
import CountMode from "./CountMode";
import VideoImport from "./VideoImport";
import Guide from "./Guide";
import HomeTab from "./HomeTab";
import type { PromoCode, ShippingMethod } from "@/lib/catalog/store-settings";
import ProductsTab from "./ProductsTab";
import SalesTab from "./SalesTab";
import { StoreAssistant } from "./StoreAssistant";
import SettingsTab from "./SettingsTab";
import SignOutButton from "../SignOutButton";
import { ToolPanel } from "./tools/Tools";
import type { ToolId } from "./tools/types";

export type Store = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  whatsapp: string | null;
  currency: string;
  published: boolean;
  cod_enabled: boolean;
  card_enabled: boolean;
  credit_enabled: boolean;
  tagline: string | null;
  hero_key: string | null;
  rib: string | null;
  marketplace_margin: number;
  marketplaces: Record<string, boolean>;
};

export type Tab = "home" | "products" | "sales" | "settings";

export type AiCredit = { pending: boolean; balance: number };

type Props = {
  store: Store;
  products: CatalogProduct[];
  orders: Order[];
  shipping: ShippingMethod[];
  promos: PromoCode[];
  ai: AiCredit;
  lang: Lang;
  instagram: string | null; // back from Meta's Instagram login: the video import opens again
};

export default function BackOffice(props: Props) {
  return (
    <I18nProvider initial={props.lang}>
      <Shell {...props} />
    </I18nProvider>
  );
}

function Shell({ store, products, orders, shipping, promos, ai, instagram: back }: Props) {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  const [camera, setCamera] = useState(false);
  const [selling, setSelling] = useState(false);
  const [counting, setCounting] = useState(false);
  const [importing, setImporting] = useState(!!back);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [instagram, setInstagram] = useState(back);
  const captureRef = useRef<CaptureApi>(null);

  // A reload must not open the import again.
  useEffect(() => {
    if (back) window.history.replaceState(null, "", "/app");
  }, [back]);

  const openCamera = () => {
    captureRef.current?.start(); // in this tap, before anything else
    setCamera(true);
  };
  const closeCamera = (saving: Promise<void>) => {
    setCamera(false);
    router.refresh();
    void saving.then(() => router.refresh());
  };

  const firstSteps = products.length === 0;

  return (
    <main className="min-h-dvh bg-white pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-ink">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 px-5 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold tracking-[-0.01em]">{store.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${store.published ? "bg-ok" : "bg-ink-3/50"}`} />
            {store.published ? t("header.online") : t("header.offline")}
          </p>
        </div>
        <a
          href={`/${store.slug}`}
          target="_blank"
          rel="noopener"
          aria-label={t("settings.viewStore")}
          className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-brand hover:bg-soft"
        >
          {t("settings.viewStore")}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
          </svg>
        </a>
        <div className="flex rounded-md bg-soft p-0.5 text-xs font-medium" role="group" aria-label={t("settings.language")}>
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`rounded px-2 py-1 uppercase ${lang === l ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <SignOutButton icon label={t("settings.signOut")} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-soft hover:text-ink" />
      </header>

      <div className="px-5">
        {tab === "home" && (
          <>
            <Guide products={products} onRecord={openCamera} />
            <HomeTab products={products} orders={orders.length} ai={ai} currency={store.currency} onTab={setTab} onTool={setTool} />
          </>
        )}
        {tab === "products" && <ProductsTab store={store} products={products} onCount={() => setCounting(true)} onVideo={() => setImporting(true)} />}
        {tab === "sales" && <SalesTab store={store} orders={orders} products={products} onCounterSale={() => setSelling(true)} />}
        {tab === "settings" && (
          <SettingsTab
            store={store}
            shipping={shipping}
            promos={promos}
            onSignOut={async () => {
              // Same route as the header button: this browser only, cookies cleared by the server.
              await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
              router.replace("/connexion");
              router.refresh();
            }}
          />
        )}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        aria-label="Menu"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center text-[11px] font-medium">
          <NavItem icon="home" label={t("nav.home")} active={tab === "home"} onClick={() => setTab("home")} />
          <NavItem icon="products" label={t("nav.products")} active={tab === "products"} onClick={() => setTab("products")} />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={openCamera}
              aria-label={t("nav.record")}
              className={`-mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-white ring-[3px] ring-ink/80 shadow-lg active:scale-95 ${
                firstSteps ? "guide-pulse" : ""
              }`}
            >
              <span className="h-[52px] w-[52px] rounded-full bg-red-500" />
            </button>
          </div>
          <NavItem icon="sales" label={t("nav.sales")} active={tab === "sales"} onClick={() => setTab("sales")} />
          <NavItem icon="settings" label={t("nav.settings")} active={tab === "settings"} onClick={() => setTab("settings")} />
        </div>
      </nav>

      {!camera && !selling && !counting && !importing && !tool && <StoreAssistant />}

      {tool && (
        <ToolPanel id={tool} store={store} products={products} orders={orders} onExit={() => setTool(null)} onChanged={() => router.refresh()} />
      )}

      {importing && (
        <div className="fixed inset-0 z-50">
          <VideoImport
            currency={store.currency}
            instagram={instagram}
            onExit={() => {
              setImporting(false);
              setInstagram(null);
            }}
            onAdd={(items) => {
              captureRef.current?.importProducts(items);
              // The products save in the background while their photos and prices arrive.
              for (const wait of [10_000, 30_000, 60_000]) setTimeout(() => router.refresh(), wait);
            }}
          />
        </div>
      )}

      {counting && (
        <div className="fixed inset-0 z-50">
          <CountMode products={products} onExit={() => setCounting(false)} onSaved={() => router.refresh()} />
        </div>
      )}

      {/* The camera stays mounted so the red button can start it inside its own tap. */}
      <div className={camera ? "fixed inset-0 z-50" : "hidden"}>
        <CaptureScreen ref={captureRef} storeId={store.id} onExit={closeCamera} />
      </div>

      {selling && (
        <div className="fixed inset-0 z-50">
          <SellMode
            products={products.map((p, i) => toSessionProduct(p, store.currency, i))}
            currency={store.currency}
            storeName={store.name}
            onExit={() => setSelling(false)}
            onSold={async (lines) => {
              // Lower the stock of the products that have one.
              const db = supabase();
              for (const l of lines) {
                const p = products.find((x) => x.id === l.productId);
                if (p?.stock != null) await db.from("products").update({ stock: Math.max(0, p.stock - l.qty) }).eq("id", p.id);
              }
              router.refresh();
            }}
          />
        </div>
      )}
    </main>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  products: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  sales: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
};

function NavItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-1 ${active ? "text-brand" : "text-ink-3"}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
        {ICONS[icon]}
      </svg>
      {label}
    </button>
  );
}
