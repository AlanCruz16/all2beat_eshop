import type { Metadata } from "next";
import { CartView } from "@/app/components/CartView";

export const metadata: Metadata = {
  title: "Cart — all2beat",
};

export default function CartPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold">Your cart</h1>
      <CartView />
    </div>
  );
}
