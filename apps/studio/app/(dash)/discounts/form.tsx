import type { Discount } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveDiscountAction } from "./actions";

const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16) : "");

/** Every rule a discount can have, on one form. */
export function DiscountForm({
  discount,
  products,
  groups,
  categories,
}: {
  discount?: Discount;
  products: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  categories: string[];
}) {
  const scoped = (scope: string) => (discount?.scope === scope ? discount.scope_ids : []);
  return (
    <ActionForm action={saveDiscountAction} className="grid gap-5 p-5 sm:grid-cols-2">
      {discount && <input type="hidden" name="id" value={discount.id} />}
      <div>
        <label className="label" htmlFor="name">Name customers see</label>
        <input id="name" name="name" required defaultValue={discount?.name} className="field" placeholder="Diwali 10% off" />
      </div>
      <div>
        <label className="label" htmlFor="code">Code <span className="font-normal text-slate-400">(leave empty to apply automatically)</span></label>
        <input id="code" name="code" defaultValue={discount?.code ?? ""} className="field font-mono uppercase" placeholder="DIWALI10" />
      </div>
      <div>
        <label className="label" htmlFor="kind">Type</label>
        <select id="kind" name="kind" defaultValue={discount?.kind ?? "percent"} className="field">
          <option value="percent">Percentage off</option>
          <option value="fixed">Amount off (₹)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="value">How much</label>
        <input id="value" name="value" type="number" step="0.01" min="0" required defaultValue={discount?.value ?? ""} className="field" placeholder="10" />
      </div>

      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="label">Applies to</legend>
        <select name="scope" defaultValue={discount?.scope ?? "all"} className="field">
          <option value="all">Everything in the cart</option>
          <option value="categories">Some categories</option>
          <option value="groups">Some variant groups</option>
          <option value="products">Some products</option>
        </select>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-600">
            Categories (comma separated)
            <input name="categories" defaultValue={scoped("categories").join(", ")} className="field mt-1" list="categories" placeholder={categories.slice(0, 3).join(", ")} />
            <datalist id="categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-sm text-slate-600">
            Variant groups
            <select name="groupIds" multiple size={4} defaultValue={scoped("groups")} className="field mt-1">
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Products
            <select name="productIds" multiple size={4} defaultValue={scoped("products")} className="field mt-1">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="help">Only the list matching your choice above is used.</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="minSubtotal">Minimum spend on those items (₹)</label>
        <input id="minSubtotal" name="minSubtotal" type="number" step="0.01" min="0" defaultValue={discount?.min_subtotal ?? ""} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="minQuantity">Minimum number of those items</label>
        <input id="minQuantity" name="minQuantity" type="number" step="1" min="1" defaultValue={discount?.min_quantity ?? ""} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="maxAmount">At most (₹) <span className="font-normal text-slate-400">(caps a percentage)</span></label>
        <input id="maxAmount" name="maxAmount" type="number" step="0.01" min="0" defaultValue={discount?.max_amount ?? ""} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="usageLimit">Total uses <span className="font-normal text-slate-400">(empty = no limit)</span></label>
        <input id="usageLimit" name="usageLimit" type="number" step="1" min="1" defaultValue={discount?.usage_limit ?? ""} className="field" />
        {discount && <p className="help">Used {discount.used_count} times so far.</p>}
      </div>
      <div>
        <label className="label" htmlFor="startsAt">Starts</label>
        <input id="startsAt" name="startsAt" type="datetime-local" defaultValue={day(discount?.starts_at ?? null)} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="endsAt">Ends</label>
        <input id="endsAt" name="endsAt" type="datetime-local" defaultValue={day(discount?.ends_at ?? null)} className="field" />
      </div>
      <div className="space-y-2 text-sm text-slate-700 sm:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="oncePerCustomer" value="1" defaultChecked={discount?.once_per_customer} /> Once per customer (by account or phone number)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="firstOrderOnly" value="1" defaultChecked={discount?.first_order_only} /> First order only
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="stacks" value="1" defaultChecked={discount?.stacks} /> Combines with other offers
          <span className="text-slate-400">— otherwise the single best offer for the customer applies</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" value="1" defaultChecked={discount?.active ?? true} /> Running
        </label>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pending="Saving…">{discount ? "Save discount" : "Create discount"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
