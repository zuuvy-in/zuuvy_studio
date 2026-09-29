"use client";

import type { Plan } from "@zsite/platform";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { Message, Spinner, SubmitButton } from "./forms";
import { Icon, buttonClass, cx } from "./ui";

const SUGGESTIONS = [
  "A modern site for my bakery in Patna",
  "Make it feel more premium with a dark theme",
  "Add pictures to every section and make it lively with animation",
  "Add an FAQ about delivery, returns and payment on delivery",
  "Rewrite the home page copy to be warmer and more local",
  "Add a testimonials section and an About page",
];

type PlanFn = (form: FormData) => Promise<{ error?: string; plan?: Plan } | null>;

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-white p-4 text-sm ring-1 ring-ai-500/20">
      <p className="text-slate-800">{plan.summary}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {plan.pages.map((p) => (
          <div key={p.path}>
            <p className="font-semibold text-slate-900">
              {p.title} <span className="font-mono text-xs font-normal text-slate-400">{p.path}</span>
            </p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-600">
              {p.sections.map((sec, i) => (
                <li key={i}>{sec}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-slate-600 sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-slate-900">Look</dt>
        <dd>{plan.style.mood} · {plan.style.fonts} · motion {plan.style.motion}</dd>
        <dt className="font-medium text-slate-900">Colours</dt>
        <dd>{plan.style.colors}</dd>
        <dt className="font-medium text-slate-900">Pictures</dt>
        <dd>{plan.imagery}</dd>
      </dl>
      {plan.assumptions.length > 0 && (
        <div>
          <p className="font-medium text-slate-900">Assumed</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.questions.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="font-medium text-amber-900">Questions (optional — sensible defaults otherwise)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900">
            {plan.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ComposerBody({ disabled, accept, plan: planFn, initialPrompt = "" }: { disabled: boolean; accept: string; plan?: PlanFn; initialPrompt?: string }) {
  const { pending } = useFormStatus();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [files, setFiles] = useState<string[]>([]);
  const [showLinks, setShowLinks] = useState(false);
  const [planFirst, setPlanFirst] = useState(Boolean(planFn));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState("");
  const [planning, startPlanning] = useTransition();
  const busy = pending || planning;

  const makePlan = (form: HTMLFormElement | null) => {
    if (!form || !planFn) return;
    if (!form.reportValidity()) return;
    // Called directly, not as the form's action, so the chosen files stay in the form for the build.
    const fd = new FormData(form);
    setPlanError("");
    startPlanning(async () => {
      const r = await planFn(fd);
      if (r?.error) setPlanError(r.error);
      else if (r?.plan) setPlan(r.plan);
    });
  };

  return (
    <>
      <textarea
        name="prompt"
        required
        minLength={3}
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={disabled || busy}
        readOnly={Boolean(plan)}
        placeholder="One line is enough — “A modern site for my bakery in Patna” — or describe a change in detail"
        className="field resize-y text-[15px] leading-relaxed"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          if (planFirst && planFn && !plan) makePlan(e.currentTarget.form);
          else e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700", (disabled || busy) && "pointer-events-none opacity-50")}>
          <Icon name="plus" className="h-3.5 w-3.5" /> Attach files
          <input
            type="file"
            name="files"
            multiple
            accept={accept}
            className="sr-only"
            onChange={(e) => setFiles([...(e.currentTarget.files ?? [])].map((f) => f.name))}
          />
        </label>
        <button type="button" onClick={() => setShowLinks((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700">
          <Icon name="external" className="h-3.5 w-3.5" /> Reference websites
        </button>
        {planFn && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 font-medium text-slate-700 ring-1 ring-slate-200">
            <input type="checkbox" checked={planFirst} disabled={busy || Boolean(plan)} onChange={(e) => setPlanFirst(e.target.checked)} />
            Plan first
          </label>
        )}
        {files.length > 0 && <span className="text-slate-500">{files.join(", ")}</span>}
        <span className="text-slate-400">PDF, Word, Excel, CSV, text or screenshots — up to 5 files, 4.5 MB each</span>
      </div>
      {showLinks && (
        <textarea
          name="links"
          rows={2}
          disabled={disabled || busy}
          readOnly={Boolean(plan)}
          placeholder={"One address per line — the AI looks at them for layout, tone and colours\nhttps://example.com"}
          className="field mt-2 resize-y text-sm"
        />
      )}
      {plan && (
        <>
          <PlanCard plan={plan} />
          <input type="hidden" name="plan" value={JSON.stringify(plan)} />
          <textarea
            name="planNotes"
            rows={2}
            disabled={busy}
            placeholder="Answers or changes to the plan (optional) — “No stats section; our number is 98765 43210”"
            className="field mt-3 resize-y text-sm"
          />
        </>
      )}
      {planError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{planError}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!busy &&
          !plan &&
          SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => setPrompt(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
              {s}
            </button>
          ))}
        {planning && (
          <p className="flex items-center gap-2 text-sm text-ai-600">
            <Spinner /> The AI is planning — pages, sections and look. Usually under half a minute…
          </p>
        )}
        {pending && (
          <p className="flex items-center gap-2 text-sm text-ai-600">
            <Spinner /> The AI is building your site. This usually takes a minute or two…
          </p>
        )}
        <div className="ml-auto flex gap-2">
          {plan && !pending && (
            <button type="button" onClick={() => setPlan(null)} className={buttonClass("secondary")}>
              Start over
            </button>
          )}
          {planFirst && planFn && !plan ? (
            <button type="button" disabled={disabled || busy} onClick={(e) => makePlan(e.currentTarget.form)} className={buttonClass("primary")}>
              {planning ? <Spinner /> : <Icon name="sparkles" />} {planning ? "Planning…" : "Plan it"}
            </button>
          ) : (
            <SubmitButton pending="Building…">
              <Icon name="sparkles" /> {plan ? "Build this" : "Create version"}
            </SubmitButton>
          )}
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
  setupHint,
  title = "Describe a change",
  accept = "",
  plan,
  initialPrompt,
}: {
  /** What the box opens with — the landing page's request, or feedback gathered on the preview. */
  initialPrompt?: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** "Plan first": drafts a plan to approve before building. Without it the composer builds straight away. */
  plan?: PlanFn;
  siteId: string;
  baseNumber: number;
  aiReady: boolean;
  /** What to configure when the AI is not ready, for the provider in use. */
  setupHint?: string;
  title?: string;
  /** File types the composer takes as attachments. */
  accept?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="rounded-xl border border-ai-500/20 bg-gradient-to-b from-ai-50 to-white p-4 shadow-xs">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="base" value={baseNumber} />
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon name="sparkles" className="text-ai-600" /> {title}
        </p>
        <p className="text-xs text-slate-500">Based on v{baseNumber} · nothing goes live until you publish</p>
      </div>
      <ComposerBody disabled={!aiReady} accept={accept} plan={plan} initialPrompt={initialPrompt} />
      {!aiReady && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {setupHint ?? "AI editing is not configured."}
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
