import type { Change, FieldChange } from "@zsite/core";
import { Badge, type Tone } from "./ui";

const KIND: Record<Change["kind"], [string, Tone]> = {
  meta: ["Changed", "gray"],
  theme: ["Changed", "violet"],
  nav: ["Changed", "gray"],
  footer: ["Changed", "gray"],
  "page-added": ["Added", "green"],
  "page-removed": ["Removed", "red"],
  "page-changed": ["Changed", "gray"],
  "section-added": ["Added", "green"],
  "section-removed": ["Removed", "red"],
  "section-changed": ["Edited", "blue"],
  "section-moved": ["Moved", "amber"],
};

function show(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 160);
  return String(v);
}

function isColour(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

function Value({ v }: { v: unknown }) {
  return (
    <span className="inline-flex items-center gap-1.5 break-words">
      {isColour(v) && <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-black/10" style={{ background: v }} />}
      {show(v)}
    </span>
  );
}

function Fields({ fields }: { fields: FieldChange[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {fields.slice(0, 8).map((f) => (
        <li key={f.field} className="grid grid-cols-[minmax(0,90px)_1fr] gap-2 text-xs">
          <span className="truncate font-mono text-slate-500">{f.field}</span>
          <span className="min-w-0">
            <span className="text-rose-700/80 line-through decoration-rose-300"><Value v={f.before} /></span>
            <span className="mx-1 text-slate-400">→</span>
            <span className="text-emerald-800"><Value v={f.after} /></span>
          </span>
        </li>
      ))}
      {fields.length > 8 && <li className="text-xs text-slate-400">and {fields.length - 8} more</li>}
    </ul>
  );
}

export function ChangeList({ changes, empty = "No differences." }: { changes: Change[]; empty?: string }) {
  if (!changes.length) return <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {changes.map((c, i) => {
        const [label, tone] = KIND[c.kind];
        return (
          <li key={i} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">{c.label}</p>
              <Badge tone={tone}>{label}</Badge>
            </div>
            {"fields" in c && c.fields.length > 0 && <Fields fields={c.fields} />}
          </li>
        );
      })}
    </ul>
  );
}
