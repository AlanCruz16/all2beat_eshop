"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { ConvexError } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";
import { amountInputToCents, centsToAmountInput } from "@/lib/format";
import { MAX_PRODUCT_IMAGES, PRODUCT_SLUG_PATTERN } from "@/lib/products";
import {
  Field,
  INPUT_CLASS,
  signatureOf as signatureFrom,
  SubmitFeedback,
  useServerBackedState,
  useSubmit,
} from "../../adminForm";
import { SyncStatusBadge } from "../SyncStatusBadge";

type AdminProduct = NonNullable<
  FunctionReturnType<typeof api.products.getForAdmin>
>;

// An image the owner has uploaded but not yet saved: the blob is already in
// Convex storage (that is what the upload URL did), but the product doesn't
// reference it until Save writes `imageIds`. `previewUrl` is a local object URL
// because a signed storage URL only comes back with the next query.
type DraftImage = { storageId: Id<"_storage">; previewUrl: string | null };

// Every box on the form, as text — including the numeric ones, because a
// half-typed "4." is a state the field has to be able to hold, and coercing on
// every keystroke would fight the person typing. Parsing happens once, on save.
type Draft = {
  name: string;
  slug: string;
  description: string;
  price: string;
  compareAt: string;
  stock: string;
  sortOrder: string;
  active: boolean;
  images: DraftImage[];
};

function draftFrom(product: AdminProduct): Draft {
  return {
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: centsToAmountInput(product.priceCents),
    compareAt: centsToAmountInput(product.compareAtCents),
    stock: String(product.stock),
    sortOrder: String(product.sortOrder),
    active: product.active,
    images: product.images.map((image) => ({
      storageId: image.storageId,
      previewUrl: image.url,
    })),
  };
}

// What "the server record changed" is judged on (see `useServerBackedState`).
// The sync fields are deliberately absent: the sync engine writes them a moment
// after every save, and reseeding the form on that would throw away whatever
// the owner had started typing next.
function signatureOf(product: AdminProduct): string {
  return signatureFrom(
    product.name,
    product.slug,
    product.description,
    product.priceCents,
    product.compareAtCents,
    product.stock,
    product.sortOrder,
    product.active,
    product.images.map((image) => image.storageId),
  );
}

// The mirror's own status, and the only way out of `error` short of a fake
// edit. A failed product is unsellable, so this says that in full rather than
// leaving the badge to carry it.
function SyncPanel({ product }: { product: AdminProduct }) {
  const retrySync = useMutation(api.products.retrySync);
  const { state, submit } = useSubmit(() =>
    retrySync({ productId: product._id }),
  );

  return (
    <div
      className={`space-y-3 rounded border p-4 text-sm ${
        product.syncStatus === "error"
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
      role={product.syncStatus === "error" ? "alert" : undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">Stripe</h3>
        <SyncStatusBadge status={product.syncStatus} />
      </div>
      {product.syncStatus === "error" ? (
        <>
          <p className="text-red-800 dark:text-red-300">
            This product failed to sync to Stripe, so it can&apos;t be sold —
            checkout has no price to charge against. Fix the cause, then retry.
          </p>
          {product.syncError !== undefined && (
            <p className="font-mono text-xs text-red-800 dark:text-red-300">
              {product.syncError}
            </p>
          )}
        </>
      ) : (
        <p className="text-zinc-500">
          {product.syncStatus === "pending"
            ? "A sync is queued — this product can't be sold until it finishes."
            : "This product is mirrored to Stripe and can be sold."}
        </p>
      )}
      {/* Which edits re-mirror, said plainly, because a save that doesn't
          touch one of them deliberately leaves Stripe alone. */}
      <p className="text-xs text-zinc-500">
        Editing the name, description, price, slug, or active flag re-syncs this
        product. Stock, images, compare-at price, and sort order are ours alone
        — Stripe never sees them.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === "saving"}
          className="rounded border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
        >
          Retry sync
        </button>
        <SubmitFeedback state={state} savedLabel="Queued." />
      </div>
    </div>
  );
}

function ImageEditor({
  images,
  onChange,
}: {
  images: DraftImage[];
  onChange: (images: DraftImage[]) => void;
}) {
  const generateUploadUrl = useMutation(api.products.generateImageUploadUrl);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const url = await generateUploadUrl();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      onChange([
        ...images,
        { storageId, previewUrl: URL.createObjectURL(file) },
      ]);
    } catch (error) {
      console.error(error);
      setUploadError(
        error instanceof Error ? error.message : "Upload failed",
      );
    } finally {
      setUploading(false);
      // So re-picking the same file after a removal still fires `change`.
      if (fileInput.current !== null) {
        fileInput.current.value = "";
      }
    }
  }

  return (
    <div className="space-y-3">
      <span className="text-sm text-zinc-500">Images</span>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {images.map((image, index) => (
            <li key={image.storageId} className="space-y-1">
              <div className="relative size-24 overflow-hidden rounded border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                {image.previewUrl !== null && (
                  <Image
                    src={image.previewUrl}
                    alt=""
                    fill
                    sizes="96px"
                    // A just-uploaded blob's preview is a local object URL,
                    // which next/image can neither optimize nor fetch.
                    unoptimized={image.previewUrl.startsWith("blob:")}
                    className="object-cover"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                {index === 0 ? (
                  <span className="text-zinc-500">Main</span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onChange([
                        image,
                        ...images.filter((other) => other !== image),
                      ])
                    }
                    className="underline"
                  >
                    Make main
                  </button>
                )}
                <button
                  type="button"
                  // Drops the reference; the blob itself stays in storage. A
                  // product's images are cheap and a delete would break any
                  // page still holding the old signed URL.
                  onClick={() =>
                    onChange(images.filter((other) => other !== image))
                  }
                  className="underline"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        disabled={uploading || images.length >= MAX_PRODUCT_IMAGES}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            void upload(file);
          }
        }}
        className="block text-sm"
      />
      <p className="text-xs text-zinc-500">
        {images.length >= MAX_PRODUCT_IMAGES
          ? `That's the limit of ${MAX_PRODUCT_IMAGES} images — remove one to add another.`
          : "The first image is the one the storefront shows. New images are stored on upload but only attached when you save."}
      </p>
      {uploadError !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {uploadError}
        </p>
      )}
    </div>
  );
}

function EditForm({ product }: { product: AdminProduct }) {
  const save = useMutation(api.products.save);
  const [draft, setDraft] = useServerBackedState(
    draftFrom(product),
    signatureOf(product),
  );

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft({ ...draft, [key]: value });
  }

  const { state, submit } = useSubmit(async () => {
    const priceCents = amountInputToCents(draft.price);
    if (priceCents === null) {
      throw new ConvexError("Price must be an amount, like 4.99");
    }
    const compareAtCents = amountInputToCents(draft.compareAt);
    if (compareAtCents === null && draft.compareAt.trim() !== "") {
      throw new ConvexError("Compare-at price must be an amount, like 6.99");
    }
    const stock = Number(draft.stock);
    const sortOrder = Number(draft.sortOrder);
    if (!Number.isFinite(stock) || !Number.isFinite(sortOrder)) {
      throw new ConvexError("Stock and sort order must be numbers");
    }

    await save({
      productId: product._id,
      name: draft.name,
      slug: draft.slug,
      description: draft.description,
      priceCents,
      // Absent, not zero: an empty box means this product has no compare-at
      // price, and the mutation clears the stored one.
      compareAtCents: compareAtCents ?? undefined,
      imageIds: draft.images.map((image) => image.storageId),
      stock,
      sortOrder,
      active: draft.active,
    });
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Slug" hint={`Its storefront URL: /product/${draft.slug}`}>
          <input
            type="text"
            value={draft.slug}
            pattern={PRODUCT_SLUG_PATTERN}
            onChange={(event) => set("slug", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={draft.description}
          rows={5}
          onChange={(event) => set("description", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price (USD)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.price}
            onChange={(event) => set("price", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field
          label="Compare-at price (USD)"
          hint="Shown struck through beside the price. Leave empty for none."
        >
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.compareAt}
            onChange={(event) => set("compareAt", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Stock"
          // Absolute, not a delta (spec story 35) — the count in the box
          // becomes the count on the shelf.
          hint={
            product.stock === product.available
              ? "The exact count on hand — what you type replaces it."
              : `The exact count on hand — what you type replaces it. ${
                  product.stock - product.available
                } of the current ${product.stock} are held by checkouts in flight.`
          }
        >
          <input
            type="number"
            min="0"
            step="1"
            value={draft.stock}
            onChange={(event) => set("stock", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Sort order" hint="Lower numbers come first in the shop.">
          <input
            type="number"
            step="1"
            value={draft.sortOrder}
            onChange={(event) => set("sortOrder", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <ImageEditor
        images={draft.images}
        onChange={(images) => set("images", images)}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set("active", event.target.checked)}
        />
        <span>
          Active — an inactive product disappears from the storefront without
          being deleted.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.status === "saving"}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Save product
        </button>
        {/* Just "Saved." — whether this particular save re-mirrored to Stripe
            is the sync panel's to report, and claiming it here would be a lie
            on every stock correction. */}
        <SubmitFeedback state={state} savedLabel="Saved." />
      </div>
    </form>
  );
}

export function ProductEditor({ productId }: { productId: string }) {
  const product = useQuery(api.products.getForAdmin, { productId });

  if (product === undefined) {
    return <p className="text-sm text-zinc-500">Loading product…</p>;
  }

  if (product === null) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-zinc-500">No such product.</p>
        <Link href="/admin/products" className="text-sm underline">
          Back to products
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Link href="/admin/products" className="text-sm text-zinc-500 underline">
          ← Products
        </Link>
        <h2 className="text-lg font-medium">{product.name}</h2>
      </div>

      <SyncPanel product={product} />
      <EditForm product={product} />
    </section>
  );
}
