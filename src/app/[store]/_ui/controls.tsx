"use client";

// The store's buttons and small dialogs: the main button with its states (ready with the light
// running across it, busy with a spinner, done turning green with a check), the quantity
// picker, and the dialog that pops in on a computer and slides up on a phone.

import { useState } from "react";
import { CheckIcon, CloseIcon, MinusIcon, PlusIcon, TrashIcon } from "./icons";

export type PayState = "ready" | "idle" | "busy" | "done";

export function PayButton(props: {
  state: PayState;
  label: string;
  busyLabel?: string;
  doneLabel?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  id?: string;
}) {
  const { state } = props;
  return (
    <button
      id={props.id}
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={state === "busy" || state === "done"}
      aria-busy={state === "busy"}
      className={`shop-pay ${state === "ready" ? "shop-pay-ready" : ""} ${state === "done" ? "shop-pay-done" : ""} ${props.className ?? ""}`}
    >
      <span className="relative z-[1]">
        {state === "busy" ? (props.busyLabel ?? props.label) : state === "done" ? (props.doneLabel ?? props.label) : props.label}
      </span>
      {state === "busy" && <span className="shop-spin absolute end-4 top-1/2 z-[1] -mt-2.5" aria-hidden />}
      {state === "done" && <CheckIcon size={18} className="absolute end-4 top-1/2 z-[1] -mt-[9px]" />}
    </button>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true">
      <div className="ui-scrim" onClick={onClose} />
      <div className={`shop-dialog text-ink ${wide ? "md:w-[560px]" : "md:w-[356px]"}`}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Quantity of a line: − n +, then update or remove. `min` 1 hides "remove" (the product page).
export function QtyPicker(props: {
  name: string;
  image: string | null;
  qty: number;
  min?: number;
  onSave: (qty: number) => void;
  onClose: () => void;
}) {
  const min = props.min ?? 0;
  const [qty, setQty] = useState(props.qty);
  const [confirm, setConfirm] = useState(false);
  const set = (n: number) => setQty(Math.max(min, Math.min(99, n)));
  return (
    <Dialog
      onClose={props.onClose}
      title={
        <div className="flex items-center gap-3">
          {props.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.image} alt="" className="h-8 w-8 rounded bg-[#F3F3F5] object-contain" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">Modifier la quantité</p>
            <p className="truncate text-[12px] text-ink-3">{props.name}</p>
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-center gap-4 px-5 pt-6 pb-4">
        <button type="button" onClick={() => set(qty - 1)} disabled={qty <= min} aria-label="Moins" className="shop-round">
          <MinusIcon />
        </button>
        <input
          value={qty}
          inputMode="numeric"
          aria-label="Quantité"
          onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)}
          className="ui-input h-11 w-[92px] text-center tabular-nums"
        />
        <button type="button" onClick={() => set(qty + 1)} disabled={qty >= 99} aria-label="Plus" className="shop-round">
          <PlusIcon />
        </button>
      </div>
      <div className="flex gap-3 px-5 pb-5">
        {min === 0 && (
          <button
            type="button"
            onClick={() => (confirm ? props.onSave(0) : setConfirm(true))}
            className={`ui-btn ui-btn-secondary h-10 flex-1 ${confirm ? "text-danger" : ""}`}
          >
            {confirm ? "Confirmer" : "Retirer"}
            <TrashIcon size={12} />
          </button>
        )}
        <button type="button" onClick={() => props.onSave(qty)} className="ui-btn ui-btn-primary h-10 flex-1">
          Mettre à jour
        </button>
      </div>
    </Dialog>
  );
}
