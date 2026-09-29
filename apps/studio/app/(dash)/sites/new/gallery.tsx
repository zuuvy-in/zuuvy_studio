"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon, buttonClass, cx } from "@/components/ui";
import { forkShowcaseAction } from "../actions";

export type GalleryItem = { id: string; title: string; category: string; description: string; cover: string | null; url: string; kind: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const KIND = { store: "Online store", landing: "Website", portfolio: "Portfolio" } as Record<string, string>;

/** Finished sites to start from: preview the real thing, then make a copy of your own. */
export function ShowcaseGallery({ items, businessName, domain }: { items: GalleryItem[]; businessName: string; domain: string }) {
  const [chosen, setChosen] = useState<GalleryItem | null>(null);
  const [name, setName] = useState(businessName);
  const [sub, setSub] = useState(slug(businessName));
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <div
            key={s.id}
            className={cx(
              "group overflow-hidden rounded-xl bg-white ring-1 transition-shadow hover:shadow-md",
              chosen?.id === s.id ? "ring-2 ring-brand-500" : "ring-slate-200",
            )}
          >
            <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
              {s.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.cover} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              ) : (
                <div className="grid h-full place-items-center bg-gradient-to-br from-slate-100 to-slate-200 font-display text-lg font-semibold text-slate-400">{s.title}</div>
              )}
              <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-xs">{s.category || KIND[s.kind]}</span>
            </div>
            <div className="p-4">
              <p className="font-medium text-slate-900">{s.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{s.description}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setChosen(s)} className={buttonClass("primary", "sm")}>Use this</button>
                <a href={s.url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                  Preview <Icon name="external" className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
      {chosen && (
        <div className="mt-6 rounded-xl bg-white p-5 ring-2 ring-brand-500">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-slate-900">Start from “{chosen.title}”</p>
              <p className="text-sm text-slate-600">
                You get a copy of your own — the sample name becomes {businessName}, and the builder opens ready to swap in your words and pictures.
              </p>
            </div>
            <button type="button" onClick={() => setChosen(null)} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
          </div>
          <ActionForm action={forkShowcaseAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="showcaseId" value={chosen.id} />
            <div>
              <label className="label" htmlFor="fork-name">Site name</label>
              <input id="fork-name" name="name" required className="field" value={name} onChange={(e) => { setName(e.target.value); setSub(slug(e.target.value)); }} />
            </div>
            <div>
              <label className="label" htmlFor="fork-sub">Address</label>
              <div className="flex rounded-lg ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand-500">
                <input id="fork-sub" name="subdomain" required className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none" value={sub} onChange={(e) => setSub(slug(e.target.value))} />
                <span className="rounded-r-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">.{domain}</span>
              </div>
            </div>
            {chosen.kind === "store" && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="products" value="1" defaultChecked className="mt-0.5" />
                <span>
                  <strong className="text-slate-900">Include the sample products</strong>
                  <br />
                  <span className="text-slate-600">So the shop looks full while you add your own; delete them any time under Products.</span>
                </span>
              </label>
            )}
            <div className="sm:col-span-2">
              <SubmitButton pending="Copying…">Create my site</SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
