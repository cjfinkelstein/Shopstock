import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../api";
import { useCart } from "../../cart";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import QtyPad from "../../components/QtyPad";
import Sheet from "../../components/Sheet";
import { Empty, ItemThumb, ListSkeleton } from "../../components/ui";
import { useToast } from "../../toast";
import type { Item, TxnPage } from "../../types";

// Pulls in the barcode-decoding library (~300kB) -- only fetched once someone taps Scan.
const BarcodeScanner = lazy(() => import("../../components/BarcodeScanner"));

/** The central Find experience: search + browse. In cart mode (?cart=1) every
 * tapped result opens a qty pad and drops straight into the cart. */
export default function Search() {
  const navigate = useNavigate();
  const cart = useCart();
  const toast = useToast();
  const [params] = useSearchParams();
  const cartMode = params.get("cart") === "1";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [recents, setRecents] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [addItem, setAddItem] = useState<Item | null>(null);
  const [scanning, setScanning] = useState(false);

  const browsing = search === "" && category === "";

  useEffect(() => {
    api<string[]>("/items/categories").then(setCategories).catch(() => {});
  }, []);

  // Recently used = my last transactions, first sighting of each item.
  useEffect(() => {
    api<TxnPage>("/transactions?mine=true&page_size=25")
      .then((page) => {
        const seen = new Set<number>();
        const out: { id: number; name: string }[] = [];
        for (const t of page.items) {
          if (seen.has(t.item_id)) continue;
          seen.add(t.item_id);
          out.push({ id: t.item_id, name: t.item_name ?? t.item_sku ?? `#${t.item_id}` });
          if (out.length === 6) break;
        }
        setRecents(out);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api<Item[]>(
        `/items?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&in_stock=true`,
      )
        .then((data) => {
          setItems(data);
          if (search === "" && category === "") setAllItems(data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [search, category]);

  const itemById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of allItems) counts[i.category] = (counts[i.category] ?? 0) + 1;
    return counts;
  }, [allItems]);

  /** Cart mode adds in place; normal mode opens the item sheet. */
  const openItem = (item: Item) => {
    if (cartMode) setAddItem(item);
    else navigate(`/item/${item.id}`);
  };

  const openRecent = (id: number) => {
    const item = itemById.get(id);
    if (cartMode && item) setAddItem(item);
    else navigate(`/item/${id}`);
  };

  const handleScanned = async (code: string) => {
    setScanning(false);
    try {
      const matches = await api<Item[]>(`/items?search=${encodeURIComponent(code)}`);
      const exact = matches.find((i) => i.barcode === code);
      if (exact) {
        openItem(exact);
        return;
      }
    } catch {
      // fall through to plain-text search below
    }
    toast("error", `No item found for barcode ${code}`);
    setSearch(code);
  };

  const activeTint = category ? catTint(category) : null;
  const showCartBar = cartMode && cart.lines.length > 0;

  return (
    <div className={`space-y-4 animate-fade-up ${showCartBar ? "pb-20" : ""}`}>
      <header>
        {cartMode ? (
          <p className="page-eyebrow flex items-center gap-1.5 text-brand-600 dark:text-brand-400">
            <Icon name="cart" size={12} strokeWidth={2.6} />
            Adding to cart
          </p>
        ) : (
          <p className="page-eyebrow">Find material</p>
        )}
        <h1 className="page-title mt-1">Find</h1>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            className="input pl-11 pr-12"
            aria-label="Search name or SKU"
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        <button
          className="btn-secondary !min-h-[48px] shrink-0 px-3.5"
          onClick={() => setScanning(true)}
          aria-label="Scan barcode"
        >
          <Icon name="scan" size={20} />
        </button>
      </div>

      {browsing ? (
        <>
          {recents.length > 0 && (
            <section>
              <h2 className="section-title">
                <Icon name="history" size={14} />
                Recently used
              </h2>
              <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                {recents.map((r) => {
                  const item = itemById.get(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => openRecent(r.id)}
                      className="card-interactive flex w-[108px] shrink-0 flex-col items-start gap-2.5 p-3"
                    >
                      {item ? (
                        <ItemThumb item={item} />
                      ) : (
                        <span className="icon-disc bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                          <Icon name="package" size={20} />
                        </span>
                      )}
                      <span className="line-clamp-2 text-left text-[12.5px] font-semibold leading-snug">
                        {r.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="section-title">
              <Icon name="layers" size={14} />
              Browse categories
            </h2>
            {categories.length === 0 ? (
              <ListSkeleton rows={4} height={72} />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {categories.map((c) => {
                  const t = catTint(c);
                  const n = catCounts[c];
                  return (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className="card-interactive flex min-h-[68px] items-center gap-3 p-3.5"
                    >
                      <span className={`icon-disc ${t.tile}`}>
                        <Icon name={t.icon} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{c}</span>
                        {n != null && (
                          <span className="block text-[12px] text-slate-400 tabular-nums dark:text-slate-500">
                            {n} item{n === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {category && activeTint && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCategory("")}
                className="chip chip-active shrink-0"
                aria-label={`Clear category filter: ${category}`}
              >
                <Icon name={activeTint.icon} size={14} />
                {category}
                <Icon name="x" size={14} strokeWidth={2.5} />
              </button>
              {!loading && (
                <span className="text-[13px] font-semibold text-slate-400 tabular-nums dark:text-slate-500">
                  {items.length} result{items.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}

          <div className="space-y-2.5">
            {items.map((i) => {
              return (
                <button
                  key={i.id}
                  onClick={() => openItem(i)}
                  className="card-interactive flex w-full items-center gap-3 p-3.5"
                >
                  <ItemThumb item={i} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{i.name}</span>
                    <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                      {i.sku} · {i.category}
                    </span>
                  </span>
                  {cartMode ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                      <Icon name="plus" size={16} strokeWidth={2.5} />
                    </span>
                  ) : (
                    <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                  )}
                </button>
              );
            })}
            {loading && items.length === 0 && <ListSkeleton rows={4} />}
            {!loading && items.length === 0 && (
              <Empty
                icon="search"
                title="Nothing matches"
                hint="Try a different name, SKU, or category."
              />
            )}
          </div>
        </>
      )}

      {showCartBar && createPortal(
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 px-4">
          <div className="mx-auto max-w-lg md:max-w-2xl lg:max-w-3xl">
            <button
              onClick={() => navigate("/cart")}
              className="btn-primary min-h-[54px] w-full text-[16px]"
            >
              <Icon name="cart" size={19} />
              Review cart ({cart.lines.length})
            </button>
          </div>
        </div>,
        document.body,
      )}

      {addItem && (
        <Sheet
          title={addItem.name}
          subtitle={`${addItem.sku} · ${addItem.category}`}
          onClose={() => setAddItem(null)}
        >
          <QtyPad
            unit={addItem.unit}
            confirmLabel="Add to cart"
            onConfirm={(q) => {
              cart.add(addItem, q);
              toast("success", `Added ${addItem.name}`);
              setAddItem(null);
            }}
          />
        </Sheet>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onDetected={handleScanned} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </div>
  );
}
