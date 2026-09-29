"use client";

import { type RefObject, useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/actions";
import type { Pick } from "./feedback-bridge";
import { Message, SubmitButton } from "./forms";
import { Icon, buttonClass, cx } from "./ui";

export type FeedbackTarget = {
  siteId: string;
  baseNumber: number;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  aiReady: boolean;
};

type Note = Pick & { id: string; comment: string };

const MAX_NOTES = 30;

/** The notes, as one request the AI can act on note by note. */
export function feedbackPrompt(notes: Note[], version: number): string {
  const head =
    `Revise the site using the owner's feedback, left by right-clicking parts of the preview of version ${version}. ` +
    "Each note names the page, the section (by id) and the element it is about. Do what each note asks, keep everything else as it is, " +
    "and say in your summary what you did for each note.";
  const lines = notes.map((n, i) => {
    const where = n.section === "header" || n.section === "footer" ? `the site ${n.section}` : n.section ? `section ${n.section} (${n.sectionType})` : "the page";
    return `${i + 1}. Page ${n.route} — ${where} — ${n.element}: ${n.comment.slice(0, 600)}`;
  });
  let out = `${head}\n\n${lines.join("\n")}`;
  if (out.length > 3990) out = `${out.slice(0, 3980)}…`;
  return out;
}

/**
 * Right-click anywhere in the preview to leave a note on that spot; the notes
 * collect here, survive a reload, and go to the AI together as the next version.
 */
export function FeedbackLayer({ target, frame }: { target: FeedbackTarget; frame: RefObject<HTMLIFrameElement | null> }) {
  const key = `zs-feedback:${target.siteId}:${target.baseNumber}`;
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<(Pick & { left: number; top: number }) | null>(null);
  const [comment, setComment] = useState("");
  const [state, formAction] = useActionState(target.action, null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(saved)) setNotes(saved.slice(0, MAX_NOTES));
    } catch {
      /* a private window, or nothing saved */
    }
  }, [key]);

  /** Every change to the notes goes through here, so a reload keeps them. */
  const update = (fn: (all: Note[]) => Note[]) =>
    setNotes((all) => {
      const next = fn(all).slice(0, MAX_NOTES);
      try {
        if (next.length) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
      } catch {
        /* storage unavailable: the notes still live on this page */
      }
      return next;
    });

  useEffect(() => {
    // The request failed: keep the notes for another try.
    if (state?.error && notes.length) {
      try {
        localStorage.setItem(key, JSON.stringify(notes));
      } catch {
        /* storage unavailable */
      }
    }
  }, [state, key, notes]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== location.origin || ev.data?.zsFeedback !== "pick" || ev.source !== frame.current?.contentWindow) return;
      const pick = ev.data.pick as Pick;
      const f = frame.current!;
      // The note opens where the click was, kept inside the preview.
      const left = Math.min(Math.max(f.offsetLeft + pick.x, 8), f.offsetLeft + f.clientWidth - 328);
      const top = Math.min(f.offsetTop + pick.y + 8, f.offsetTop + f.clientHeight - 200);
      setDraft({ ...pick, left, top });
      setComment("");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  const close = () => {
    setDraft(null);
    frame.current?.contentWindow?.postMessage({ zsFeedback: "clear" }, location.origin);
  };
  const save = () => {
    if (!draft || !comment.trim()) return;
    const { left: _l, top: _t, ...pick } = draft;
    update((n) => [...n, { ...pick, id: Math.random().toString(36).slice(2), comment: comment.trim() }]);
    close();
  };

  return (
    <>
      {draft && (
        <div className="absolute z-20 w-80 rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200" style={{ left: draft.left, top: draft.top }} role="dialog" aria-label="Add feedback">
          <p className="mb-1 text-xs text-slate-500">
            {draft.route} · {draft.sectionType ?? "page"} · <span className="text-slate-700">{draft.element}</span>
          </p>
          <textarea
            autoFocus
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") close();
            }}
            placeholder="What should change here?"
            className="field text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={close} className={buttonClass("ghost", "sm")}>Cancel</button>
            <button type="button" onClick={save} disabled={!comment.trim()} className={buttonClass("primary", "sm")}>Add note</button>
          </div>
        </div>
      )}
      <div className="self-stretch border-t border-slate-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Icon name="sparkles" className="text-ai-600" />
            {notes.length ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} for the next version` : "Right-click anything in the preview to leave a note on it."}
          </p>
          {notes.length > 0 && (
            <button type="button" onClick={() => update(() => [])} className="text-xs text-slate-500 hover:text-slate-800">Clear all</button>
          )}
        </div>
        {notes.length > 0 && (
          <>
            <ol className="mt-3 space-y-2">
              {notes.map((n, i) => (
                <li key={n.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-2.5 text-sm ring-1 ring-slate-200">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ai-600 text-[11px] font-semibold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-slate-500">{n.route} · {n.sectionType ?? "page"} · {n.element}</p>
                    <p className="text-slate-800">{n.comment}</p>
                  </div>
                  <button type="button" onClick={() => update((all) => all.filter((x) => x.id !== n.id))} aria-label="Remove note" className="text-slate-400 hover:text-rose-600">
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
            <form
              action={(fd) => {
                // Sent notes are done with: the page moves to the new version. If it fails they are saved again below.
                try {
                  localStorage.removeItem(key);
                } catch {
                  /* nothing saved */
                }
                formAction(fd);
              }}
              className="mt-3"
            >
              <input type="hidden" name="siteId" value={target.siteId} />
              <input type="hidden" name="base" value={target.baseNumber} />
              <input type="hidden" name="prompt" value={feedbackPrompt(notes, target.baseNumber)} />
              <SubmitButton pending="Making the next version…" className={cx(!target.aiReady && "pointer-events-none opacity-50")}>
                Send {notes.length} {notes.length === 1 ? "note" : "notes"} to the AI
              </SubmitButton>
              <Message state={state} />
            </form>
          </>
        )}
      </div>
    </>
  );
}
