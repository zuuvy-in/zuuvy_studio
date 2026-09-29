import { verifyEmail } from "@zsite/platform";
import Link from "next/link";
import { StudioLockup } from "@/components/logo";
import { Card, Icon, buttonClass } from "@/components/ui";
import { currentSession } from "@/lib/session";

export const metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

/** Where the link in the verification email lands. Works signed in or not. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = await verifyEmail(typeof token === "string" ? token : "");
  const session = await currentSession();
  const ok = "userId" in result;
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(80%_60%_at_50%_0%,#dde3ef,transparent)] px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <StudioLockup height={36} className="mb-8 text-brand-600" />
        <Card className="p-6">
          <div className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full ${ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            <Icon name={ok ? "check" : "shield"} />
          </div>
          <h1 className="text-lg font-semibold">{ok ? "Email confirmed" : "We could not confirm that link"}</h1>
          <p className="mt-2 text-sm text-slate-600">{ok ? "Thank you. You can publish your site whenever it is ready." : result.error}</p>
          <Link href={session ? "/sites" : "/login"} className={`${buttonClass()} mt-5 w-full justify-center`}>
            {session ? "Back to my sites" : "Sign in"}
          </Link>
        </Card>
      </div>
    </div>
  );
}
