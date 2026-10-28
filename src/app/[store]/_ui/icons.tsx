// Line icons for the store, drawn on a 16 px grid with the text colour.

type P = { size?: number; className?: string };
const svg = (path: React.ReactNode, { size = 16, className }: P, fill = false) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    {path}
  </svg>
);

export const SearchIcon = (p: P) => svg(<><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>, p);
export const BagIcon = (p: P) => svg(<><path d="M3 5.5h10l-.8 8H3.8z" /><path d="M5.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5" /></>, p);
export const CloseIcon = (p: P) => svg(<path d="m3.5 3.5 9 9m0-9-9 9" />, p);
export const MenuIcon = (p: P) => svg(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />, p);
export const BackIcon = (p: P) => svg(<path d="M13 8H3m4-4.5L2.5 8 7 12.5" />, p);
export const NextIcon = (p: P) => svg(<path d="M3 8h10M9 3.5 13.5 8 9 12.5" />, p);
export const ChevronDown = (p: P) => svg(<path d="m4 6 4 4 4-4" />, p);
export const PlusIcon = (p: P) => svg(<path d="M8 3v10M3 8h10" />, p);
export const MinusIcon = (p: P) => svg(<path d="M3 8h10" />, p);
export const CheckIcon = (p: P) => svg(<path d="m3 8.5 3 3 7-7" />, p);
export const TruckIcon = (p: P) => svg(<><path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5v2h-5" /><circle cx="4.5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /></>, p);
export const CashIcon = (p: P) => svg(<><rect x="1.5" y="4" width="13" height="8" rx="1.5" /><circle cx="8" cy="8" r="1.8" /></>, p);
export const ChatIcon = (p: P) => svg(<path d="M3 12.5 2 14.5l3-1a6 6 0 1 0-2-1z" />, p);
export const LockIcon = (p: P) => svg(<><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>, p);
export const UpRightIcon = (p: P) => svg(<path d="M5 11 11 5M6 5h5v5" />, p);
export const SlidersIcon = (p: P) => svg(<path d="M2.5 5h6m3 0h2M2.5 11h2m3 0h6M8.5 3.5v3M4.5 9.5v3" />, p);
export const TrashIcon = (p: P) => svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" />, p);
export const CircleCheck = (p: P) =>
  svg(<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.3 5.1-3.9 4.3a.7.7 0 0 1-1 0L4.7 8.7a.7.7 0 1 1 1-1l1.2 1.2 3.4-3.7a.7.7 0 0 1 1 .9z" />, p, true);
