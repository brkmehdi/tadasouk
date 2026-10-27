"use client";

import { cover, displayName, type Product } from "@/lib/capture/session";

// Asks before removing a product from the tray, so a stray tap on ✕ loses nothing.
// A sheet over the bottom of the screen; recording keeps running behind it.
export default function ConfirmRemove({ p, onCancel, onConfirm }: { p: Product; onCancel: () => void; onConfirm: () => void }) {
  const img = cover(p);
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="confirm-remove-title">
      <button type="button" className="ui-scrim" aria-label="Annuler" onClick={onCancel} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] text-ink shadow-2xl">
        <div className="flex items-center gap-3 border-b border-black/10 px-5 py-4">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img.url} alt="" className="h-9 w-9 shrink-0 rounded object-contain ring-1 ring-black/10" />
          )}
          <div className="min-w-0">
            <p id="confirm-remove-title" className="text-sm font-medium">
              Supprimer ce produit ?
            </p>
            <p dir="auto" className="truncate text-xs text-ink-3">
              {displayName(p)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <button type="button" onClick={onCancel} className="ui-btn ui-btn-secondary h-11">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} className="ui-btn ui-btn-secondary h-11 font-semibold text-danger">
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
