import {
  CART_STORAGE_KEY,
  parseStoredCart,
  serializeCart,
  type CartLine,
} from "./cart";

// `localStorage` is an external store, not React state, so the cart is modelled
// as one and read through `useSyncExternalStore`. That is what makes hydration
// safe by construction: the server snapshot is always the empty, unhydrated
// cart, so server and client markup agree, and React swaps in the stored cart
// only after hydration — no effect writing state on mount.

export type CartSnapshot = {
  lines: CartLine[];
  // False until the stored cart has been read, so the UI can show a loading
  // state instead of flashing an empty cart the shopper hasn't got.
  hydrated: boolean;
};

// Both snapshots are referentially stable: `useSyncExternalStore` requires the
// snapshot to change identity only when the data actually changes.
const SERVER_SNAPSHOT: CartSnapshot = { lines: [], hydrated: false };

let snapshot: CartSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

// Every read and write is guarded: a browser with storage disabled or full
// (Safari private mode, quota exceeded) degrades to an in-memory cart for the
// session rather than throwing on the shopper.
function readStorage(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStorage(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(lines));
  } catch {
    // Ignored — the in-memory snapshot below is still updated.
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

// Fires when another tab edits the cart, keeping open tabs consistent.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== CART_STORAGE_KEY) {
    return;
  }
  snapshot = { lines: readStorage(), hydrated: true };
  emit();
}

export function subscribeToCart(listener: () => void): () => void {
  // Runs after hydration, which is exactly when the stored cart may first be
  // read without risking a server/client markup mismatch.
  if (!snapshot.hydrated) {
    snapshot = { lines: readStorage(), hydrated: true };
  }
  if (listeners.size === 0) {
    window.addEventListener("storage", handleStorageEvent);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // Only detach once nothing is listening — several components may subscribe
    // to this one store.
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

export function getCartSnapshot(): CartSnapshot {
  return snapshot;
}

export function getServerCartSnapshot(): CartSnapshot {
  return SERVER_SNAPSHOT;
}

export function updateCart(update: (lines: CartLine[]) => CartLine[]): void {
  snapshot = { lines: update(snapshot.lines), hydrated: true };
  writeStorage(snapshot.lines);
  emit();
}
