import { StudioLockup } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(80%_60%_at_50%_0%,#dde3ef,transparent)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <StudioLockup height={36} className="text-brand-600" />
          <p className="mt-2 text-sm text-slate-500">Websites, built by describing them</p>
        </div>
        {children}
      </div>
    </div>
  );
}
