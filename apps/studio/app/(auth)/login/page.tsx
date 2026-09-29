import { landingQuery, parseLanding } from "@zsite/platform";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { loginAction } from "../actions";
import { LandingFields, type SearchParams, read } from "../landing-fields";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const p = parseLanding(read(await searchParams));
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-slate-500">Welcome back.</p>
      <ActionForm action={loginAction} className="space-y-4">
        <LandingFields params={p} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required defaultValue={p.email} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </div>
        <SubmitButton className="w-full" pending="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-slate-500">
        New here? <Link href={`/signup${landingQuery(p)}`} className="font-medium text-brand-600 hover:underline">Create an account</Link>
      </p>
    </Card>
  );
}
