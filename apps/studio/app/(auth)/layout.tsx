export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(80%_60%_at_50%_0%,#e0e7ff,transparent)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">Z</div>
          <p className="text-sm font-medium text-slate-500">Zuuvy Sites</p>
        </div>
        {children}
      </div>
    </div>
  );
}
