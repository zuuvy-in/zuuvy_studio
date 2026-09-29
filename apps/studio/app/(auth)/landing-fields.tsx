import { LANDING_KEYS, type LandingParams } from "@zsite/platform";

/** Carries what the landing page's form sent through this form, untouched. */
export function LandingFields({ params }: { params: LandingParams }) {
  return (
    <>
      {LANDING_KEYS.filter((k) => params[k] && !["business", "name", "email"].includes(k)).map((k) => (
        <input key={k} type="hidden" name={`l_${k}`} value={String(params[k])} />
      ))}
    </>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const read = (q: Record<string, string | string[] | undefined>) => (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
