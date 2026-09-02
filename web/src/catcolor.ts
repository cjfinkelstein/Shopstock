/** Deterministic color identity per item category — gives lists visual texture
 * and makes categories recognizable at a glance. Class strings are literal so
 * Tailwind's scanner keeps them. */

export interface CatTint {
  /** icon-tile surface + icon color */
  tile: string;
  /** small text badge */
  badge: string;
  /** icon name that suits the trade category */
  icon: string;
}

const TINTS: CatTint[] = [
  { tile: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400", badge: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", icon: "zap" },
  { tile: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400", badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", icon: "package" },
  { tile: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400", badge: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", icon: "layers" },
  { tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", icon: "wrench" },
  { tile: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400", badge: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", icon: "tag" },
  { tile: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400", badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300", icon: "settings" },
  { tile: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400", badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300", icon: "clipboard-list" },
  { tile: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400", badge: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300", icon: "store" },
];

/** Well-known electrical categories get a curated icon; others hash into the set. */
const KNOWN: Record<string, Partial<CatTint> & { i: number }> = {
  wire: { i: 0, icon: "zap" },
  conduit: { i: 5, icon: "layers" },
  boxes: { i: 1, icon: "package" },
  devices: { i: 2, icon: "settings" },
  breakers: { i: 3, icon: "shield-check" },
  grounding: { i: 7, icon: "wrench" },
  fittings: { i: 6, icon: "wrench" },
  consumables: { i: 4, icon: "tag" },
};

export function catTint(category: string): CatTint {
  const key = category.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return { ...TINTS[known.i], ...(known.icon ? { icon: known.icon } : {}) };
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}
