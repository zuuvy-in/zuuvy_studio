import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { signupAction } from "../actions";

export const metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-slate-500">Your website is a few minutes away.</p>
      <ActionForm action={signupAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="businessName">Business name</label>
          <input id="businessName" name="businessName" required className="field" placeholder="Pooja Communications" />
        </div>
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" autoComplete="name" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
          <p className="help">At least 8 characters.</p>
        </div>
        <SubmitButton className="w-full" pending="Creating…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-slate-500">
        Have an account? <Link href="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}
