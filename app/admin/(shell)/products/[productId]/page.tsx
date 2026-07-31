import { ProductEditor } from "./ProductEditor";

// The id is passed through as a plain string, like the order page:
// `products.getForAdmin` normalizes it and returns null for anything that isn't
// a real product, so a hand-typed URL lands on "No such product" rather than an
// argument-validation error.
export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductEditor productId={productId} />;
}
