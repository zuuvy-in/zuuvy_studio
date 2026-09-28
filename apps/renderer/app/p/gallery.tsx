"use client";

import { useState } from "react";
import { addToCartAction } from "@/app/cart/actions";

export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [at, setAt] = useState(0);
  const shown = images[Math.min(at, images.length - 1)];
  if (!shown) return <div className="zs-placeholder zs-product-img" aria-label={name} />;
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown} alt={name} className="zs-product-img" />
      {images.length > 1 && (
        <div className="zs-thumbs">
          {images.map((src, i) => (
            <button key={src + i} type="button" aria-pressed={i === at} aria-label={`Picture ${i + 1}`} onClick={() => setAt(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type PickerVariant = {
  id: string;
  options: Record<string, string>;
  price: number | null;
  mrp: number | null;
  inStock: boolean;
  backorders: boolean;
  stock: number | null;
  images: string[];
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Choose a combination — Colour, then Size, then Fit — and the price, stock
 * and pictures follow the variant it names; the group's own photos come after
 * the variant's. Values with nothing behind them are shown struck through.
 */
export function VariantPicker({
  name,
  options,
  variants,
  groupImages,
  initial,
  buy,
  back,
}: {
  name: string;
  options: { name: string; values: string[] }[];
  variants: PickerVariant[];
  groupImages: string[];
  initial: string | null;
  buy: "add_to_cart" | "buy_now" | "both";
  back: string;
}) {
  const start = variants.find((v) => v.id === initial) ?? variants.find((v) => v.inStock) ?? variants[0]!;
  const [chosen, setChosen] = useState<Record<string, string>>(start.options);
  const match = variants.find((v) => options.every((o) => v.options[o.name] === chosen[o.name])) ?? null;
  const exists = (optionName: string, value: string) =>
    variants.some((v) => v.options[optionName] === value && options.every((o) => o.name === optionName || !chosen[o.name] || v.options[o.name] === chosen[o.name]));
  const images = [...(match?.images ?? []), ...groupImages];
  const sellable = match && (match.inStock || match.backorders);

  return (
    <div className="zs-product-page">
      <Gallery key={match?.id ?? "none"} images={images} name={name} />
      <div>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}>{name}</h1>
        {match?.price != null && (
          <p className="zs-price" style={{ fontSize: "1.5rem" }}>
            {inr(match.price)}
            {match.mrp !== null && match.mrp > match.price && <s>{inr(match.mrp)}</s>}
          </p>
        )}
        <div className="zs-options">
          {options.map((o) => (
            <fieldset key={o.name}>
              <legend>
                {o.name}
                {chosen[o.name] && <span className="zs-muted">: {chosen[o.name]}</span>}
              </legend>
              <div className="zs-chips">
                {o.values.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="zs-chip"
                    aria-pressed={chosen[o.name] === value}
                    data-unavailable={!exists(o.name, value)}
                    onClick={() => setChosen((c) => ({ ...c, [o.name]: value }))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p style={{ fontWeight: 600 }} className={sellable ? "" : "zs-alert"}>
          {!match
            ? "That combination is not available."
            : !match.inStock
              ? match.backorders
                ? "Made to order — the shop confirms when it can deliver"
                : "Out of stock"
              : match.stock !== null && match.stock <= 10 && !match.backorders
                ? `Only ${match.stock} left`
                : "In stock"}
        </p>
        <form action={addToCartAction} className="zs-form">
          <input type="hidden" name="productId" value={match?.id ?? ""} />
          <input type="hidden" name="back" value={back} />
          <div className="zs-buy">
            <input name="quantity" type="number" min={1} max={match?.backorders ? 99 : Math.min(match?.stock ?? 99, 99)} defaultValue={1} aria-label="Quantity" />
            {buy !== "buy_now" && (
              <button type="submit" name="then" value="stay" className={`zs-btn ${buy === "both" ? "zs-btn-ghost" : "zs-btn-primary"}`} disabled={!sellable}>
                Add to cart
              </button>
            )}
            {buy !== "add_to_cart" && (
              <button type="submit" name="then" value="checkout" className="zs-btn zs-btn-primary" disabled={!sellable}>
                Buy now
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
