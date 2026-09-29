import { isLandingStart, landingQuery, parseLanding } from "@zsite/platform";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { signupAction } from "../actions";
import { LandingFields, type SearchParams, read } from "../landing-fields";

export const metadata = { title: "Create an account" };

const KIND = { landing: "website", portfolio: "portfolio", store: "online store" } as const;

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const p = parseLanding(read(await searchParams));
  const starting = isLandingStart(p);
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-slate-500">
        {starting ? `Your ${KIND[p.kind ?? "landing"]}${p.site ? ` “${p.site}”` : ""} is set up the moment you sign up.` : "Your website is a few minutes away."}
      </p>
      {p.prompt && (
        <p className="mb-5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
          <span className="block text-xs font-medium text-slate-500">You asked for</span>“{p.prompt}”
        </p>
      )}
      <ActionForm action={signupAction} className="space-y-4">
        <LandingFields params={p} />
        <div>
          <label className="label" htmlFor="businessName">Business name</label>
          <input id="businessName" name="businessName" required defaultValue={p.business} className="field" placeholder="Pooja Communications" />
        </div>
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" autoComplete="name" required defaultValue={p.name} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required defaultValue={p.email} className="field" />
          <p className="help">We send a link to confirm it; your site goes live once it is confirmed.</p>
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus={Boolean(p.email)} className="field" />
          <p className="help">At least 8 characters.</p>
        </div>
        <SubmitButton className="w-full" pending="Creating…">{starting ? "Create account and my site" : "Create account"}</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-slate-500">
        Have an account? <Link href={`/login${landingQuery(p)}`} className="font-medium text-brand-600 hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}
