import { catTint } from "../catcolor";
import Icon from "./Icon";

/** Friendly empty state: soft icon disc + title + optional hint/action. */
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center animate-fade-up">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-200/60 text-slate-400 dark:bg-slate-800/80 dark:text-slate-500">
        <Icon name={icon} size={28} />
      </div>
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {hint && <p className="mt-1 max-w-[260px] text-sm text-slate-400 dark:text-slate-500">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shimmer placeholder rows while a list loads. */
export function ListSkeleton({ rows = 4, height = 68 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height, animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

/** Animated success check: gradient disc pop + stroke draw. */
export function SuccessCheck({ size = 112 }: { size?: number }) {
  return (
    <div
      className="animate-pop-check flex items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 shadow-[0_16px_40px_-8px_rgb(16_185_129/0.45)]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path
          d="M20 6 9 17l-5-5"
          stroke="white"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 30,
            animation: "draw-check 0.4s 0.15s ease-out forwards",
          }}
        />
        <style>{`@keyframes draw-check { to { stroke-dashoffset: 0; } }`}</style>
      </svg>
    </div>
  );
}

/** Small inline spinner for busy buttons. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4.5 w-4.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: 18, height: 18 }}
      aria-label="Loading"
    />
  );
}

/** Full-screen centered loading state. */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand-500 border-t-transparent" />
    </div>
  );
}

const AVATAR_GRADIENTS = [
  "from-sky-400 to-blue-600",
  "from-emerald-400 to-teal-600",
  "from-violet-400 to-purple-600",
  "from-amber-400 to-orange-600",
  "from-rose-400 to-pink-600",
  "from-cyan-400 to-sky-600",
  "from-indigo-400 to-blue-700",
  "from-lime-400 to-green-600",
];

/** Item thumbnail: real photo if we have one, else a category-tinted icon.
 * Tech pages use round discs; admin pages use rounded-square tiles — pass
 * shape to match whichever surface you're on. */
export function ItemThumb({
  item,
  size = 44,
  shape = "circle",
}: {
  item: { image_data?: string | null; category?: string | null };
  size?: number;
  shape?: "circle" | "square";
}) {
  const rounding = shape === "circle" ? "rounded-full" : "rounded-lg";
  if (item.image_data) {
    return (
      <img
        src={item.image_data}
        alt=""
        className={`shrink-0 ${rounding} border border-slate-200/70 object-cover dark:border-slate-700`}
        style={{ width: size, height: size }}
      />
    );
  }
  const t = item.category
    ? catTint(item.category)
    : { tile: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", icon: "package" };
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${rounding} ${t.tile}`}
      style={{ width: size, height: size }}
    >
      <Icon name={t.icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

export function Avatar({ name, index = 0, size = 44 }: { name: string; index?: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-bold text-white ${AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}
