/** Flat geometric warehouse illustration for entry screens — inline SVG,
 * no external assets. Soft shapes echo the brand blue/purple palette and
 * read correctly on both light and dark surfaces. */
export default function Illustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 210" fill="none" className={className} role="img" aria-label="Organized shop stock">
      {/* backdrop blob + floor shadow */}
      <ellipse cx="160" cy="112" rx="132" ry="86" className="fill-brand-100/70 dark:fill-brand-500/10" />
      <ellipse cx="160" cy="188" rx="96" ry="10" className="fill-slate-900/10 dark:fill-black/40" />

      {/* shelf unit */}
      <rect x="58" y="34" width="10" height="152" rx="4" className="fill-slate-700 dark:fill-slate-600" />
      <rect x="140" y="34" width="10" height="152" rx="4" className="fill-slate-700 dark:fill-slate-600" />
      <rect x="50" y="66" width="108" height="8" rx="4" className="fill-slate-600 dark:fill-slate-500" />
      <rect x="50" y="118" width="108" height="8" rx="4" className="fill-slate-600 dark:fill-slate-500" />

      {/* boxes on shelves */}
      <rect x="72" y="42" width="26" height="24" rx="4" fill="#4f63f0" />
      <rect x="104" y="48" width="22" height="18" rx="4" fill="#a074fb" />
      <rect x="70" y="94" width="24" height="24" rx="4" fill="#8b4df5" />
      <rect x="100" y="88" width="30" height="30" rx="4" fill="#3e64ee" />
      <path d="M100 96h30" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />

      {/* floor stack */}
      <rect x="176" y="120" width="52" height="46" rx="6" fill="#2946e2" />
      <path d="M176 136h52" stroke="#fff" strokeOpacity=".45" strokeWidth="4" strokeLinecap="round" />
      <rect x="188" y="76" width="40" height="40" rx="6" fill="#8b4df5" />
      <path d="M208 76v14" stroke="#fff" strokeOpacity=".5" strokeWidth="4" strokeLinecap="round" />
      <rect x="240" y="132" width="34" height="34" rx="6" fill="#638cf4" />

      {/* spool of wire */}
      <circle cx="262" cy="96" r="22" className="fill-slate-200 dark:fill-slate-700" />
      <circle cx="262" cy="96" r="13" fill="#f59e0b" />
      <circle cx="262" cy="96" r="5" className="fill-slate-200 dark:fill-slate-700" />
      <path d="M262 118c0 18-14 22-30 22" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" />

      {/* big check badge */}
      <circle cx="96" cy="152" r="26" className="fill-white dark:fill-slate-900" />
      <circle cx="96" cy="152" r="26" className="stroke-slate-900/5 dark:stroke-white/10" strokeWidth="2" />
      <circle cx="96" cy="152" r="19" fill="#10b981" />
      <path d="m87 152 6 6 12-12" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />

      {/* floating sparkles */}
      <circle cx="46" cy="52" r="4" fill="#a074fb" />
      <circle cx="286" cy="52" r="3" fill="#3e64ee" />
      <circle cx="300" cy="150" r="4" className="fill-slate-300 dark:fill-slate-600" />
      <path d="M164 22v10M159 27h10" stroke="#f59e0b" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
