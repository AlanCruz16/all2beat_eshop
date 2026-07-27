"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  addLine,
  cartItemCount,
  removeLine,
  setLineQty,
  type CartLine,
} from "@/lib/cart";
import {
  getCartSnapshot,
  getServerCartSnapshot,
  subscribeToCart,
  updateCart,
} from "@/lib/cart-storage";

type CartContextValue = {
  lines: CartLine[];
  itemCount: number;
  // False during the server render and the hydrating client render, true once
  // the stored cart has been read. Consumers show a loading state until then,
  // rather than flashing an empty cart the shopper hasn't got.
  hydrated: boolean;
  add: (slug: string, qty: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

// One subscription to the localStorage-backed cart store for the whole tree;
// context fans the result out to the nav badge, product pages, and /cart.
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { lines, hydrated } = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    getServerCartSnapshot,
  );

  const add = useCallback((slug: string, qty: number) => {
    updateCart((current) => addLine(current, slug, qty));
  }, []);

  const setQty = useCallback((slug: string, qty: number) => {
    updateCart((current) => setLineQty(current, slug, qty));
  }, []);

  const remove = useCallback((slug: string) => {
    updateCart((current) => removeLine(current, slug));
  }, []);

  const clear = useCallback(() => {
    updateCart(() => []);
  }, []);

  const value = useMemo(
    () => ({
      lines,
      itemCount: cartItemCount(lines),
      hydrated,
      add,
      setQty,
      remove,
      clear,
    }),
    [lines, hydrated, add, setQty, remove, clear],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (context === null) {
    throw new Error("useCart must be used inside <CartProvider>");
  }
  return context;
}
