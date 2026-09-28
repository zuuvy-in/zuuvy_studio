import type { Product } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { saveProductAction } from "./actions";

export function ProductForm({ product }: { product?: Product }) {
  return (
    <Card>
      <ActionForm action={saveProductAction} className="grid gap-4 p-5 sm:grid-cols-2">
        {product && <input type="hidden" name="id" value={product.id} />}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" required defaultValue={product?.name} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="description">Description</label>
          <textarea id="description" name="description" rows={3} defaultValue={product?.description} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="price">Price (₹)</label>
          <input id="price" name="price" type="number" step="0.01" min="0" required defaultValue={product?.price ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="mrp">MRP (₹) <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="mrp" name="mrp" type="number" step="0.01" min="0" defaultValue={product?.mrp ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <input id="category" name="category" defaultValue={product?.category ?? ""} className="field" placeholder="Chargers" />
        </div>
        <div>
          <label className="label" htmlFor="unit">Unit <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="unit" name="unit" defaultValue={product?.unit_label ?? ""} className="field" placeholder="per piece" />
        </div>
        <div>
          <label className="label" htmlFor="stock">Stock</label>
          <input id="stock" name="stock" type="number" step="1" min="0" defaultValue={product?.stock ?? ""} className="field" placeholder="Leave blank to not count" />
          <p className="help">Counted only for stores whose inventory is managed in Zuuvy Studio.</p>
        </div>
        <label className="flex items-center gap-2 self-center text-sm text-slate-700">
          <input type="checkbox" name="active" value="1" defaultChecked={product?.active ?? true} /> On sale
        </label>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="photos">Photos <span className="font-normal text-slate-400">(choose several at once — up to 12 in all)</span></label>
          {product && product.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {product.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src + i} src={src} alt="" title={i === 0 ? "Main picture" : `Picture ${i + 1}`} className={`h-16 w-16 rounded-md object-cover ring-1 ${i === 0 ? "ring-brand-500" : "ring-slate-200"}`} />
              ))}
            </div>
          )}
          <input id="photos" type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="images">Picture order <span className="font-normal text-slate-400">(one address per line; the first is the main picture — reorder or delete lines to change them)</span></label>
          <textarea id="images" name="images" rows={3} defaultValue={product?.images.join("\n")} className="field font-mono text-xs" />
          {product?.group_id && <p className="help">This product is a variant in a group; the group&apos;s own photos are shown after these.</p>}
        </div>
        <div className="sm:col-span-2">
          <SubmitButton pending="Saving…">{product ? "Save product" : "Add product"}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
