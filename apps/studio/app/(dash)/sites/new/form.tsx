"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, cx } from "@/components/ui";
import { createSiteAction, importSiteAction } from "../actions";

type T = { id: string; name: string; kind: string; description: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const SWATCH: Record<string, string> = {
  store: "from-blue-500 to-amber-400",
  landing: "from-violet-500 to-emerald-400",
  portfolio: "from-stone-800 to-orange-600",
};

export function NewSiteForm({ templates, businessName, domain }: { templates: T[]; businessName: string; domain: string }) {
  const [template, setTemplate] = useState(templates[0]!.id);
  const [name, setName] = useState(businessName);
  const [sub, setSub] = useState(slug(businessName));
  const [touched, setTouched] = useState(false);

  return (
    <ActionForm action={createSiteAction} className="space-y-6">
      <fieldset>
        <legend className="label">Template</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <label key={t.id} className={cx("cursor-pointer rounded-xl border bg-white p-3 shadow-xs transition", template === t.id ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-slate-300")}>
              <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} className="sr-only" />
              <div className={cx("mb-3 h-24 rounded-lg bg-gradient-to-br", SWATCH[t.kind])} />
              <p className="text-sm font-semibold text-slate-900">{t.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
            </label>
          ))}
        </div>
      </fieldset>

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Site name</label>
          <input id="name" name="name" required className="field" value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSub(slug(e.target.value)); }} />
        </div>
        <div>
          <label className="label" htmlFor="subdomain">Address</label>
          <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
            <input id="subdomain" name="subdomain" required className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none" value={sub} onChange={(e) => { setTouched(true); setSub(slug(e.target.value)); }} />
            <span className="pr-3 text-sm text-slate-500">.{domain}</span>
          </div>
          <p className="help">You can connect your own domain later.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tagline">One line about the business <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="tagline" name="tagline" className="field" placeholder="Genuine mobile accessories, delivered across Patna" />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <p className="text-sm font-semibold text-slate-900">Your brand <span className="font-normal text-slate-400">(optional)</span></p>
          <p className="text-xs text-slate-500">Anything you set here is fixed — the AI designs around it and never changes it. Skip it and the AI picks colours that suit you; you can set them later in the site's brand kit.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="logo">Logo</label>
            <input id="logo" type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm" />
          </div>
          {(["primary", "accent"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 self-end rounded-lg border border-slate-200 p-2 text-sm">
              <input type="checkbox" name={`set_${k}`} value="1" />
              <input type="color" name={`color_${k}`} defaultValue={k === "primary" ? "#4f46e5" : "#f59e0b"} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${k} colour`} />
              <span className="text-slate-700">{k === "primary" ? "Main brand colour" : "Accent colour"}</span>
            </label>
          ))}
        </div>
      </Card>

      <SubmitButton pending="Creating…">Create site</SubmitButton>
    </ActionForm>
  );
}

/** Bring an exported site (or one version's source files) in as a new site. */
export function ImportSiteForm({ domain }: { domain: string }) {
  const [sub, setSub] = useState("");
  return (
    <ActionForm action={importSiteAction} className="grid gap-4 p-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="archive">Exported site (.zip)</label>
        <input id="archive" type="file" name="archive" accept=".zip,application/zip" required className="block w-full text-sm" />
        <p className="help">A site export (every version, content and pictures come across) or one version's exported source.</p>
      </div>
      <div>
        <label className="label" htmlFor="imp-name">Site name</label>
        <input id="imp-name" name="name" required className="field" onChange={(e) => setSub(slug(e.target.value))} />
      </div>
      <div>
        <label className="label" htmlFor="imp-sub">Address</label>
        <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <input id="imp-sub" name="subdomain" required value={sub} onChange={(e) => setSub(slug(e.target.value))} className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none" />
          <span className="pr-3 text-sm text-slate-500">.{domain}</span>
        </div>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pending="Importing…" variant="secondary">Import site</SubmitButton>
      </div>
    </ActionForm>
  );
}
