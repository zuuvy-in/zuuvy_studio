"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { Message, Spinner, SubmitButton } from "./forms";
import { Icon, buttonClass, cx } from "./ui";

const SUGGESTIONS = [
  "Make it feel more premium with a dark theme",
  "Add an FAQ about delivery, returns and payment on delivery",
  "Rewrite the home page copy to be warmer and more local",
  "Add a testimonials section and an About page",
];

function ComposerBody({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <textarea
        name="prompt"
        required
        minLength={3}
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={disabled || pending}
        placeholder="Describe a change — “Show chargers first and add a section about same-day delivery in Patna”"
        className="field resize-y text-[15px] leading-relaxed"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!pending &&
          SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => setPrompt(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
              {s}
            </button>
          ))}
        {pending && (
          <p className="flex items-center gap-2 text-sm text-brand-700">
            <Spinner /> The AI is editing your site. This usually takes under a minute…
          </p>
        )}
        <div className="ml-auto">
          <SubmitButton pending="Working…">
            <Icon name="sparkles" /> Create version
          </SubmitButton>
        </div>
      </div>
    </>
  );
}

/** "Describe a change" → a new version based on `baseNumber`. */
export function Composer({
  action,
  siteId,
  baseNumber,
  aiReady,
  title = "Describe a change",
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  siteId: string;
  baseNumber: number;
  aiReady: boolean;
  title?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="rounded-xl border border-brand-100 bg-gradient-to-b from-brand-50/70 to-white p-4 shadow-xs">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="base" value={baseNumber} />
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon name="sparkles" className="text-brand-600" /> {title}
        </p>
        <p className="text-xs text-slate-500">Based on v{baseNumber} · nothing goes live until you publish</p>
      </div>
      <ComposerBody disabled={!aiReady} />
      {!aiReady && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          AI editing needs an API key: set <code className="font-mono">ANTHROPIC_API_KEY</code> in the environment and restart.
        </p>
      )}
      <Message state={state} />
    </form>
  );
}

export function PreviewFrame({ base, pages, title }: { base: string; pages: { path: string; title: string }[]; title: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [path, setPath] = useState("/");
  const src = `${base}${path === "/" ? "/" : path}`;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </div>
        <select value={path} onChange={(e) => setPath(e.target.value)} className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" aria-label="Page">
          {pages.map((p) => (
            <option key={p.path} value={p.path}>
              {p.title} ({p.path})
            </option>
          ))}
        </select>
        <div className="ml-auto flex rounded-md bg-white p-0.5 ring-1 ring-slate-200">
          {(["desktop", "mobile"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDevice(d)} className={cx("rounded px-2 py-1", device === d ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")} aria-label={d}>
              <Icon name={d === "desktop" ? "monitor" : "phone"} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <a href={src} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")} aria-label="Open preview in a new tab">
          <Icon name="external" className="h-3.5 w-3.5" />
        </a>
      </div>
      <div className="flex justify-center bg-slate-100">
        <iframe key={src} src={src} title={title} className={cx("h-[70vh] min-h-[480px] bg-white transition-all", device === "mobile" ? "my-4 w-[390px] rounded-lg shadow-lg ring-1 ring-slate-200" : "w-full")} />
      </div>
    </div>
  );
}
