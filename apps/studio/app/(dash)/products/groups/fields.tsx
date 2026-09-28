import type { ProductGroup } from "@zsite/platform";

/** Name, description, photos and options of a group — shared by the new and edit forms. */
export function GroupFields({ group }: { group?: ProductGroup }) {
  return (
    <>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" required defaultValue={group?.name} className="field" placeholder="Linen shirt" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="description">Description</label>
        <textarea id="description" name="description" rows={3} defaultValue={group?.description} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="category">Category</label>
        <input id="category" name="category" defaultValue={group?.category ?? ""} className="field" placeholder="Shirts" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="options">Options <span className="font-normal text-slate-400">(one per line: name, then its values)</span></label>
        <textarea
          id="options"
          name="options"
          rows={3}
          defaultValue={group?.options.map((o) => `${o.name}: ${o.values.join(", ")}`).join("\n")}
          className="field font-mono text-sm"
          placeholder={"Colour: White, Sky blue, Olive\nSize: S, M, L, XL\nFit: Slim, Regular"}
        />
        <p className="help">Every combination can be one product: 3 colours × 4 sizes × 2 fits is 24 variants. Up to 4 options and 200 combinations.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="photos">Group photos <span className="font-normal text-slate-400">(shown after the chosen variant&apos;s own — a lifestyle shot, the fabric, a size chart)</span></label>
        {group && group.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {group.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src + i} src={src} alt="" className="h-16 w-16 rounded-md object-cover ring-1 ring-slate-200" />
            ))}
          </div>
        )}
        <input id="photos" type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" />
        {group && (
          <textarea name="images" rows={2} defaultValue={group.images.join("\n")} className="field mt-2 font-mono text-xs" aria-label="Group photo order" />
        )}
      </div>
    </>
  );
}
