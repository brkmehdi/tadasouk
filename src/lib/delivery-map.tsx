// The delivery map, shared by the customer's tracking page and the back office: a soft grey
// outline of Morocco with its main cities, the route from the shop's city to the customer's
// drawn as an arc, and the parcel moving along it as far as its status. A delivery inside one
// city zooms in on an abstract street grid instead. Pure SVG with SMIL animations: no hook, no
// script, so it renders the same on the server and in the browser. The parent gives it a `key`
// that changes with the status, so the parcel's move plays again from the start. With reduced
// motion, a still copy shows the parcel and the route where they end.
// Colours: ink, ink-3 and the hairline grey for the map, brand for the route and the parcel, ok
// once delivered.

import { CITIES, findCity, type DeliveryKind, type ShipmentStatus } from "./delivery";

type Props = {
  from: string | null;
  to: string | null;
  kind: DeliveryKind;
  status: ShipmentStatus;
  seed: string; // tracking code or order id: names the SVG ids and picks the local street route
  lang?: "fr" | "en";
  bare?: boolean; // no frame of its own (inside a card)
  className?: string;
};

const INK = "rgba(26,26,26,.9)";
const INK3 = "rgba(26,26,26,.6)";
const LINE = "rgb(224,224,224)";
const LAND = "#f2f2f2"; // the soft grey (ink at 5% on white)
const BRAND = "rgb(0,116,212)";
const OK = "rgb(36,180,126)";

// How far along the route the parcel is, by status.
const PROGRESS: Record<ShipmentStatus, number> = { created: 0, picked_up: 0.14, in_transit: 0.6, delivered: 1, failed: 0.6 };

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A closed curve through the points (Catmull-Rom turned into cubic Béziers).
function smooth(pts: [number, number][]) {
  const n = pts.length;
  const p = (i: number) => pts[(i + n) % n];
  let d = `M${p(0)[0]},${p(0)[1]}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return `${d}Z`;
}

// A soft outline of the country, clockwise from Cape Spartel; the south runs off the canvas.
const COUNTRY = smooth([
  [218, 18], [238, 24], [262, 33], [292, 37], [322, 41], [336, 52], [338, 78], [342, 112], [312, 134],
  [262, 156], [222, 180], [178, 198], [146, 214], [118, 240], [96, 290], [-20, 290], [10, 262], [26, 249],
  [58, 226], [86, 210], [108, 188], [117, 163], [119, 135], [128, 113], [148, 88], [173, 77], [192, 65],
  [200, 57], [212, 38],
]);

// Which side of the dot each city's name goes, so the crowded north stays readable.
const SIDE: Record<string, "l" | "r" | "b"> = {
  Tanger: "l", Tétouan: "r", Oujda: "l", Kénitra: "l", Rabat: "l", Meknès: "b", Fès: "r",
  Casablanca: "l", "El Jadida": "l", Safi: "l", Marrakech: "r", Agadir: "l", Laâyoune: "r",
};

function Label({ x, y, side, children, strong }: { x: number; y: number; side: "l" | "r" | "b"; children: string; strong?: boolean }) {
  const off = strong ? 10 : 5.5;
  const props =
    side === "l" ? { x: x - off, y: y + 3, textAnchor: "end" as const } : side === "r" ? { x: x + off, y: y + 3, textAnchor: "start" as const } : { x, y: y + off + 7, textAnchor: "middle" as const };
  return (
    <text
      {...props}
      fontSize={strong ? 10 : 7.5}
      fontWeight={strong ? 600 : 400}
      fill={strong ? INK : INK3}
      stroke="#fff"
      strokeWidth={strong ? 3 : 2.4}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

// The parcel: a brand dot (ok with a tick once delivered) riding the route up to `p`. `still`
// puts it there at once, for reduced motion.
function Parcel({ route, p, status, still }: { route: string; p: number; status: ShipmentStatus; still?: boolean }) {
  const done = status === "delivered";
  const dur = still ? "0.001s" : p >= 1 ? "2.2s" : p > 0.3 ? "1.8s" : "1s";
  return (
    <g>
      <circle r="6.5" fill={done ? OK : BRAND} stroke="#fff" strokeWidth="2" />
      {done && <path d="m-2.6 0 1.7 1.7 3.5-3.6" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      <animateMotion dur={dur} fill="freeze" calcMode="spline" keyTimes="0;1" keyPoints={`0;${p}`} keySplines="0.45 0 0.2 1">
        <mpath href={`#${route}`} />
      </animateMotion>
    </g>
  );
}

// The whole route dashed in ink-3, the travelled part in brand, drawn in step with the parcel.
function Route({ id, d, p, still }: { id: string; d: string; p: number; still?: boolean }) {
  const dur = p >= 1 ? "2.2s" : p > 0.3 ? "1.8s" : "1s";
  return (
    <>
      <path id={id} d={d} pathLength={1} fill="none" stroke={INK3} strokeOpacity="0.6" strokeWidth="1.4" strokeDasharray="0.012 0.014" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} pathLength={1} fill="none" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${p} 1`}>
        {!still && <animate attributeName="stroke-dasharray" from="0 1" to={`${p} 1`} dur={dur} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.2 1" />}
      </path>
    </>
  );
}

// The moving part, twice: animated, and still for people who asked for less motion.
function Moving({ id, d, p, status }: { id: string; d: string; p: number; status: ShipmentStatus }) {
  return (
    <>
      <g className="motion-reduce:hidden">
        <Route id={`${id}-route`} d={d} p={p} />
        <Parcel route={`${id}-route`} p={p} status={status} />
      </g>
      <g className="hidden motion-reduce:inline">
        <Route id={`${id}-still`} d={d} p={p} still />
        <Parcel route={`${id}-still`} p={p} status={status} still />
      </g>
    </>
  );
}

// A city: the shop's is a solid ink dot, the customer's an ink ring.
function Pin({ x, y, filled }: { x: number; y: number; filled?: boolean }) {
  return <circle cx={x} cy={y} r="4.5" fill={filled ? INK : "#fff"} stroke={filled ? "#fff" : INK} strokeWidth={filled ? 1.5 : 2} />;
}

function CountryMap({ from, to, status, id }: { from: string | null; to: string | null; status: ShipmentStatus; id: string }) {
  const a = findCity(from);
  const b = findCity(to);
  const p = PROGRESS[status];
  let route: string | null = null;
  if (a && b && a !== b) {
    // An arc bowing out towards the north west (the sea side), a fifth of the distance deep.
    const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const sign = dy - dx > 0 ? -1 : 1;
    const cx = mx + sign * dy * 0.22;
    const cy = my - sign * dx * 0.22;
    route = `M${a.x},${a.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`;
  }
  return (
    <svg viewBox="0 0 345 270" className="block h-auto w-full" role="img" aria-label={[a?.name ?? from, b?.name ?? to].filter(Boolean).join(" → ")}>
      <rect width="345" height="270" fill="#fff" />
      <text x="60" y="140" fontSize="8" letterSpacing="2" fill={INK3} opacity="0.6" transform="rotate(-62 60 140)">
        OCÉAN ATLANTIQUE
      </text>
      <text x="300" y="20" fontSize="7" letterSpacing="1.5" fill={INK3} opacity="0.6" textAnchor="middle">
        MÉDITERRANÉE
      </text>
      <path d={COUNTRY} fill={LAND} stroke={LINE} strokeWidth="1" />

      {CITIES.filter((c) => c !== a && c !== b).map((c) => (
        <g key={c.name}>
          <circle cx={c.x} cy={c.y} r="2" fill={INK3} />
          <Label x={c.x} y={c.y} side={SIDE[c.name] ?? "r"}>
            {c.name}
          </Label>
        </g>
      ))}

      {a && <Pin x={a.x} y={a.y} filled />}
      {b && <Pin x={b.x} y={b.y} />}
      {a && (
        <Label x={a.x} y={a.y} side={SIDE[a.name] ?? "r"} strong>
          {a.name}
        </Label>
      )}
      {b && (
        <Label x={b.x} y={b.y} side={SIDE[b.name] ?? "r"} strong>
          {b.name}
        </Label>
      )}
      {route && <Moving id={id} d={route} p={p} status={status} />}
    </svg>
  );
}

// Inside one city: grey blocks, white streets, and the courier's way through them.
function CityMap({ city, status, seed, id, lang }: { city: string | null; status: ShipmentStatus; seed: string; id: string; lang: "fr" | "en" }) {
  const h = hash(seed);
  const p = PROGRESS[status];
  const X = [4, 60, 116, 172, 228, 284, 340];
  const Y = [6, 56, 106, 156, 206];
  const sx = X[1 + (h % 2)];
  const sy = Y[1];
  const ex = X[4 + ((h >> 6) % 2)];
  const ey = Y[2 + ((h >> 9) % 2)];
  const turn = X[3];
  const route = `M${sx},${sy} H${turn} V${ey} H${ex}`;
  const name = findCity(city)?.name ?? city ?? "";
  return (
    <svg viewBox="0 0 345 214" className="block h-auto w-full" role="img" aria-label={name}>
      <rect width="345" height="214" fill="#fff" />
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={i} x={8 + (i % 6) * 56} y={10 + Math.floor(i / 6) * 50} width="48" height="42" rx="4" fill={LAND} />
      ))}
      <Pin x={sx} y={sy} filled />
      <Pin x={ex} y={ey} />
      <Moving id={id} d={route} p={p} status={status} />
      <g transform="translate(10 10)">
        <rect width={Math.max(80, name.length * 6.4 + 56)} height="22" rx="6" fill="#fff" stroke={LINE} />
        <text x="9" y="14.5" fontSize="9.5" fontWeight="600" fill={INK}>
          {name}
          <tspan fontWeight="400" fill={INK3}>
            {lang === "fr" ? "  · en ville" : "  · in town"}
          </tspan>
        </text>
      </g>
    </svg>
  );
}

export function DeliveryMap({ from, to, kind, status, seed, lang = "fr", bare, className }: Props) {
  const id = `dm-${seed.replace(/[^A-Za-z0-9]/g, "")}`;
  return (
    <div className={`overflow-hidden ${bare ? "" : "ui-card rounded-xl"} ${className ?? ""}`}>
      {kind === "local" ? (
        <CityMap city={to ?? from} status={status} seed={seed} id={id} lang={lang} />
      ) : (
        <CountryMap from={from} to={to} status={status} id={id} />
      )}
    </div>
  );
}
