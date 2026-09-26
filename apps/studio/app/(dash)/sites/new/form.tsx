"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, cx } from "@/components/ui";
import { createSiteAction } from "../actions";

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

      <SubmitButton pending="Creating…">Create site</SubmitButton>
    </ActionForm>
  );
}
