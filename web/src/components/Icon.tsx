/** Inline SVG icon set (Lucide-style 24x24 stroke paths, ISC-licensed shapes).
 * Self-contained — no icon font, no external requests. */

const PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  camera:
    "M14.5 4h-5L7.7 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.7l-1.8-2ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35",
  truck:
    "M14 17H5V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v11Zm0 0h5.5a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.22-.62l-2.68-3.4a1 1 0 0 0-.78-.38H14M7.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9.5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  history: "M3 12a9 9 0 1 0 2.6-6.3L3 8m0-5v5h5M12 7v5l3.5 2",
  cart: "M2.5 3h2l2.5 12.5a1.6 1.6 0 0 0 1.6 1.3h8.9a1.6 1.6 0 0 0 1.57-1.28L21 8H6M9.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  "chevron-right": "m9 18 6-6-6-6",
  "chevron-down": "m6 9 6 6 6-6",
  "arrow-left": "M19 12H5m7 7-7-7 7-7",
  "arrow-right": "M5 12h14m-7-7 7 7-7 7",
  "arrow-swap": "M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4",
  printer:
    "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-4h12v7H6v-7Z",
  package:
    "m7.5 4.3 9 5.2M2.7 7l9.3 5.4L21.3 7M12 22V12.4M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
  briefcase:
    "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-8 0h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4Z",
  chart: "M3 3v16a2 2 0 0 0 2 2h16M7 14l4-4 4 3 5-6",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2Z",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m13-16a4 4 0 0 1 0 8m5 8v-2a4 4 0 0 0-3-3.87M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  "alert-triangle": "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6m4-6v6",
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  store:
    "M3 9.5 5 4h14l2 5.5M3 9.5V11a2.5 2.5 0 0 0 5 0V9.5m-5 0h5m0 0V11a2.5 2.5 0 0 0 5 0V9.5m-5 0h5m0 0V11a2.5 2.5 0 0 0 5 0V9.5m-5 0h5M5 13v8h14v-8m-9 8v-5h4v5",
  zap: "M13 2 3 14h8l-1 8 11-13h-8l0.5-7Z",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2m20 0v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6m20 0-3.4-6.8A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.2L2 12",
  tag: "M12 2H2v10l9.3 9.3a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8L12 2ZM7 7h.01",
  "file-text": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M9 13h6m-6 4h6",
  layers: "m12 2 10 6-10 6L2 8l10-6Zm-10 12 10 6 10-6",
  keypad: "M5 6h.01M12 6h.01M19 6h.01M5 12h.01M12 12h.01M19 12h.01M5 18h.01M12 18h.01M19 18h.01",
  backspace:
    "M21 5H9a2 2 0 0 0-1.5.7L2.6 11a1.5 1.5 0 0 0 0 2L7.5 18.3A2 2 0 0 0 9 19h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9 4 5 5m0-5-5 5",
  refresh: "M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6",
  "dollar-sign": "M12 2v20M17 5.5H9.7a3 3 0 0 0 0 6h4.6a3 3 0 0 1 0 6H6.5",
  "shield-check": "M12 22c6-2.5 8-6.5 8-11V5l-8-3-8 3v6c0 4.5 2 8.5 8 11Zm-3-10 2.2 2.2L15.5 10",
  "clipboard-list":
    "M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Zm7 2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 7h4m-4 4h4m-8-4h.01M8 16h.01",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 3-10 6L2 7",
  lock: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a5 5 0 0 1 10 0v4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z",
  wrench:
    "M14.7 6.3a4.5 4.5 0 0 0 6 6l-8.4 8.4a2.1 2.1 0 0 1-3-3l8.4-8.4a4.5 4.5 0 0 0-6-6l3 3-4.2 1.2L9.3 6.3l1.2-4.2 3 3Z",
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm1-15h-2v6l5.2 3.1 1-1.6-4.2-2.5V7Z",
  "map-pin": "M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
};

export type IconName = keyof typeof PATHS;

interface Props {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  filled?: boolean;
}

export default function Icon({ name, size = 22, strokeWidth = 2, className = "", filled = false }: Props) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
