import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DemoModeBanner } from "./DemoModeBanner";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children, badge = "PEOPLE" }: { children: React.ReactNode; badge?: string }) {
  return (
    <div className="min-h-screen bg-slatepanel lg:grid lg:grid-cols-[248px_1fr]">
      {/* Deep near-black navigation rail — Foundry template. */}
      <aside className="sticky top-0 z-30 hidden h-screen flex-col border-r border-rail-border bg-rail shadow-rail lg:flex">
        <Link
          href="/people"
          className="flex items-center gap-3 px-5 py-5"
          aria-label="Smart Sentry dashboard"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white ring-1 ring-white/15">
            <ShieldCheck size={19} />
          </span>
          <span className="leading-tight">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Foundry
            </span>
            <span className="block text-[15px] font-semibold text-white">Smart Sentry</span>
          </span>
        </Link>

        <div className="mx-3 mb-5 rounded-xl border border-rail-border bg-rail-raised px-4 py-3.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <ShieldCheck size={12} className="text-slate-500" />
            Operations Workspace
          </p>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Separate lead generation, imports, and campaign management into distinct operating surfaces.
          </p>
        </div>

        <div className="flex-1">
          <SidebarNav />
        </div>

        <div className="border-t border-rail-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rail-raised text-xs font-semibold text-slate-200 ring-1 ring-white/10">
              SS
            </span>
            <div className="leading-tight">
              <span className="block text-xs font-semibold text-slate-200">Sales Intelligence</span>
              <span className="block text-[11px] text-slate-500">Internal workspace</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/* Platform context header. */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/85 px-6 backdrop-blur-xl">
          <Link href="/people" className="flex items-center gap-2 lg:hidden" aria-label="Smart Sentry dashboard">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck size={17} />
            </span>
            <span className="text-sm font-semibold text-ink">Smart Sentry</span>
          </Link>
          <div className="hidden flex-col leading-tight lg:flex">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Smart Sentry Platform
            </span>
            <span className="text-sm text-slate-500">
              Operational workflows for people discovery, campaign prep, and export.
            </span>
          </div>
          {badge ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {badge}
            </span>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 py-8">
          <DemoModeBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
