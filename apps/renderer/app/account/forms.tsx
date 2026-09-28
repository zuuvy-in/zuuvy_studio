"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type AccountState, passwordAction, profileAction, signInAction, signUpAction } from "./actions";

function Submit({ children, pending }: { children: React.ReactNode; pending: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className="zs-btn zs-btn-primary" disabled={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}

function Result({ state }: { state: AccountState }) {
  if (state?.error) return <p className="zs-alert" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="zs-ok" role="status">{state.ok}</p>;
  return null;
}

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, null);
  return (
    <form action={action} className="zs-form">
      <input type="hidden" name="next" value={next} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <Result state={state} />
      <Submit pending="Signing in…">Sign in</Submit>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUpAction, null);
  return (
    <form action={action} className="zs-form">
      <input type="hidden" name="next" value={next} />
      <label>
        Your name
        <input name="name" autoComplete="name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span>Mobile number <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <Result state={state} />
      <Submit pending="Creating your account…">Create account</Submit>
    </form>
  );
}

export function ProfileForm({ name, phone, address }: { name: string; phone: string; address: string }) {
  const [state, action] = useActionState(profileAction, null);
  return (
    <form action={action} className="zs-form">
      <label>
        Your name
        <input name="name" autoComplete="name" required defaultValue={name} />
      </label>
      <label>
        Mobile number
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={phone} />
      </label>
      <label>
        Delivery address
        <textarea name="address" rows={3} autoComplete="street-address" defaultValue={address} />
      </label>
      <Result state={state} />
      <Submit pending="Saving…">Save</Submit>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(passwordAction, null);
  return (
    <form action={action} className="zs-form">
      <label>
        Current password
        <input name="current" type="password" autoComplete="current-password" required />
      </label>
      <label>
        New password
        <input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <Result state={state} />
      <Submit pending="Changing…">Change password</Submit>
    </form>
  );
}
