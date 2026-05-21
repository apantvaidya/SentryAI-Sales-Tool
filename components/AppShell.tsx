import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DemoModeBanner } from "./DemoModeBanner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-sentry-900 text-white">
              <ShieldCheck size={20} />
            </span>
            <span>
              <span className="block text-base font-bold text-ink">Smart Sentry</span>
              <span className="block text-xs font-medium text-slate-500">Sales intelligence</span>
            </span>
          </Link>
          <Link href="/prospects/new" className="button-primary">
            New Prospect
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-6">
        <DemoModeBanner />
        {children}
      </div>
    </main>
  );
}
