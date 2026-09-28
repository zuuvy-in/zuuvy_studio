"use client";

import type { CheckoutField } from "@zsite/platform";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type CheckoutState, placeOrderAction } from "@/app/cart/actions";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Submit({ total }: { total: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="zs-btn zs-btn-primary" disabled={pending}>
      {pending ? "Placing your order…" : `Place order — ${inr(total)}, pay on delivery`}
    </button>
  );
}

function Field({ f }: { f: CheckoutField }) {
  const name = `x_${f.name}`;
  if (f.type === "checkbox") {
    return (
      <label className="zs-check">
        <input type="checkbox" name={name} value="1" required={f.required} /> {f.label}
      </label>
    );
  }
  return (
    <label>
      <span>{f.label} {!f.required && <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>}</span>
      {f.type === "select" ? (
        <select name={name} required={f.required} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea name={name} rows={3} required={f.required} />
      ) : (
        <input name={name} type={f.type === "date" ? "date" : "text"} required={f.required} />
      )}
      {f.help && <small style={{ fontWeight: 400, opacity: 0.7 }}>{f.help}</small>}
    </label>
  );
}

/** One page or three steps — the store's design decides; the fields are the same either way. */
export function CheckoutForm({
  layout,
  askNote,
  reassurance,
  total,
  fields,
  defaults,
}: {
  layout: "single" | "steps";
  askNote: boolean;
  reassurance: string | null;
  total: number;
  fields: CheckoutField[];
  defaults: { name: string; phone: string; address: string };
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(placeOrderAction, null);
  const steps = layout === "steps";
  const legend = (n: number, text: string) => (
    <legend>
      {steps && <span className="zs-step-no">{n}</span>}
      {text}
    </legend>
  );
  return (
    <form action={action} className="zs-form">
      <fieldset className="zs-fieldset">
        {legend(1, "Contact")}
        <label>
          Your name
          <input name="name" autoComplete="name" required defaultValue={defaults.name} />
        </label>
        <label>
          Mobile number
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" required defaultValue={defaults.phone} />
        </label>
      </fieldset>
      <fieldset className="zs-fieldset">
        {legend(2, "Delivery")}
        <label>
          Delivery address
          <textarea name="address" rows={3} autoComplete="street-address" required defaultValue={defaults.address} />
        </label>
        {askNote && (
          <label>
            <span>Note for the shop <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></span>
            <input name="note" placeholder="Landmark, delivery time…" />
          </label>
        )}
        {fields.map((f) => (
          <Field key={f.name} f={f} />
        ))}
      </fieldset>
      <fieldset className="zs-fieldset">
        {legend(3, "Payment")}
        <p style={{ margin: 0 }}>Cash on delivery. The shop confirms your order before it is packed.</p>
      </fieldset>
      {state?.error && (
        <p className="zs-alert" role="alert">
          {state.error}
        </p>
      )}
      <Submit total={total} />
      {reassurance && <p className="zs-reassure">{reassurance}</p>}
    </form>
  );
}
