/**
 * The pages a site has outside its tree — sign in, the account, the cart, the
 * thank-you — share one frame, set by `commerce.pages`, so they look like the
 * rest of the site rather than a form bolted onto it.
 */
import type { ReactNode } from "react";
import type { SystemPages } from "@zsite/core";

export function SystemFrame({ pages, children, wide }: { pages: SystemPages; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`zs-sys zs-sys-${pages.frame}`}>
      <div className={`zs-container zs-page${wide ? "" : " zs-sys-narrow"}`}>{children}</div>
    </div>
  );
}

/** Sign in and sign up, laid out as the site's design chose. */
export function AuthLayout({ pages, signIn, signUp }: { pages: SystemPages; signIn: ReactNode; signUp: ReactNode }) {
  const a = pages.auth;
  const intro = (
    <header className="zs-sys-head">
      <h1>{a.heading ?? "Your account"}</h1>
      <p className="zs-lede">{a.intro ?? "Sign in to check out faster and follow your orders."}</p>
    </header>
  );
  const up = (
    <section className="zs-sys-panel">
      <h2>{a.signUpHeading ?? "New here? Create an account"}</h2>
      {a.perks.length > 0 && (
        <ul className="zs-sys-perks">
          {a.perks.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {signUp}
    </section>
  );
  const into = (
    <section className="zs-sys-panel">
      <h2>{a.signInHeading ?? "Sign in"}</h2>
      {signIn}
    </section>
  );
  if (a.layout === "image" && a.image) {
    return (
      <div className="zs-auth zs-auth-image">
        <img src={a.image} alt="" className="zs-auth-picture" />
        <div>
          {intro}
          <div className="zs-auth-stack">
            {into}
            {up}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`zs-auth zs-auth-${a.layout === "image" ? "split" : a.layout}`}>
      {intro}
      <div className="zs-auth-grid">
        {into}
        {up}
      </div>
    </div>
  );
}

/** "{name}" in a heading the AI wrote becomes the customer's first name. */
export function greet(template: string | undefined, name: string, fallback: string): string {
  return (template ?? fallback).replace(/\{name\}/g, name);
}
