import { addToCartAction, setQuantityAction } from "./actions";

/** "Add to cart" (and "Buy now") for one product. Plain forms: they work before any script has loaded. */
export function AddToCart({
  productId,
  compact,
  buy = "add_to_cart",
  back = "/",
  max = null,
  disabled = false,
}: {
  productId: string;
  compact?: boolean;
  buy?: "add_to_cart" | "buy_now" | "both";
  back?: string;
  max?: number | null;
  disabled?: boolean;
}) {
  if (compact) {
    return (
      <form action={addToCartAction}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="zs-btn zs-btn-ghost zs-btn-sm">Add to cart</button>
      </form>
    );
  }
  return (
    <form action={addToCartAction} className="zs-form">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={back} />
      <div className="zs-buy">
        <label>
          <span className="zs-sr">Quantity</span>
          <input name="quantity" type="number" min={1} max={Math.min(max ?? 99, 99)} defaultValue={1} aria-label="Quantity" disabled={disabled} />
        </label>
        {buy !== "buy_now" && (
          <button type="submit" name="then" value="stay" className={`zs-btn ${buy === "both" ? "zs-btn-ghost" : "zs-btn-primary"}`} disabled={disabled}>
            Add to cart
          </button>
        )}
        {buy !== "add_to_cart" && (
          <button type="submit" name="then" value="checkout" className="zs-btn zs-btn-primary" disabled={disabled}>
            Buy now
          </button>
        )}
      </div>
    </form>
  );
}

export function QuantityControl({ productId, quantity, max, back }: { productId: string; quantity: number; max: number | null; back: string }) {
  return (
    <div className="zs-qty">
      <form action={setQuantityAction}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="quantity" value={quantity - 1} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" aria-label="One fewer">−</button>
      </form>
      <span aria-label="Quantity">{quantity}</span>
      <form action={setQuantityAction}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="quantity" value={quantity + 1} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" aria-label="One more" disabled={max !== null && quantity >= max}>+</button>
      </form>
      <form action={setQuantityAction}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="quantity" value={0} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="zs-link-button">Remove</button>
      </form>
    </div>
  );
}
