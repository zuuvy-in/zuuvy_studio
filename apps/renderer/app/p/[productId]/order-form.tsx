"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type OrderState, placeOrderAction } from "../actions";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="zs-btn zs-btn-primary" disabled={disabled || pending}>
      {pending ? "Placing your order…" : "Place order — pay on delivery"}
    </button>
  );
}

export function OrderForm({ productId, max, inStock }: { productId: string; max: number | null; inStock: boolean }) {
  const [state, action] = useActionState<OrderState, FormData>(placeOrderAction, null);
  return (
    <form action={action} className="zs-form">
      <input type="hidden" name="productId" value={productId} />
      <label>
        Quantity
        <input name="quantity" type="number" min={1} max={Math.min(max ?? 99, 99)} defaultValue={1} required />
      </label>
      <label>
        Your name
        <input name="name" autoComplete="name" required />
      </label>
      <label>
        Mobile number
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" required />
      </label>
      <label>
        Delivery address
        <textarea name="address" rows={3} autoComplete="street-address" required />
      </label>
      <label>
        Note <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
        <input name="note" />
      </label>
      {state?.error && <p className="zs-alert" role="alert">{state.error}</p>}
      <Submit disabled={!inStock} />
      <p className="zs-muted" style={{ fontSize: "0.9rem", margin: 0 }}>
        The shop confirms your order before it is packed. You will get a page to follow it.
      </p>
    </form>
  );
}
