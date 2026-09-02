import { createContext, useContext, useEffect, useState } from "react";

import type { CartLine, Item } from "./types";

interface CartState {
  lines: CartLine[];
  add: (item: Item, qty: string, from_location_id?: number | null) => void;
  updateQty: (itemId: number, qty: string) => void;
  updateSource: (itemId: number, from_location_id: number | null) => void;
  remove: (itemId: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartState>(null!);
const KEY = "shopstock_cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines]);

  const add = (item: Item, qty: string, from_location_id: number | null = null) =>
    setLines((ls) => {
      const existing = ls.find((l) => l.item.id === item.id);
      if (existing) {
        const sum = (parseFloat(existing.qty) + parseFloat(qty)).toString();
        return ls.map((l) => (l.item.id === item.id ? { ...l, qty: sum } : l));
      }
      return [...ls, { item, qty, from_location_id }];
    });

  const updateQty = (itemId: number, qty: string) =>
    setLines((ls) => ls.map((l) => (l.item.id === itemId ? { ...l, qty } : l)));

  const updateSource = (itemId: number, from_location_id: number | null) =>
    setLines((ls) => ls.map((l) => (l.item.id === itemId ? { ...l, from_location_id } : l)));

  const remove = (itemId: number) => setLines((ls) => ls.filter((l) => l.item.id !== itemId));
  const clear = () => setLines([]);

  return (
    <CartContext.Provider value={{ lines, add, updateQty, updateSource, remove, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
