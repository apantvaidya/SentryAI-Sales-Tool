import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DemoModeBanner } from "./DemoModeBanner";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slatepanel lg:grid lg:grid-cols-[248px_1fr]">
      {/* Dark navigation rail — Foundry / Blueprint style. */}
      <aside className="sticky top-0 z-30 hidden h-screen flex-col border-r border-rail-border bg-gradient-to-b from-rail-raised via-rail to-rail shadow-rail lg:flex">
        <Link
          href="/people"
          className="flex items-center gap-3 px-5 py-4"
          aria-label="Smart Sentry dashboard"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[0_0_18px_-2px_rgba(45,114,210,0.7)] ring-1 ring-white/15">
            <ShieldCheck size={19} />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-white">Smart Sentry</span>
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Prospecting OS
            </span>
          </span>
        </Link>

        <div className="mt-2 flex-1">
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
        {/* Slim top bar — persistent context header. */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/85 px-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] backdrop-blur-xl">
          <Link href="/people" className="flex items-center gap-2 lg:hidden" aria-label="Smart Sentry dashboard">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white">
              <ShieldCheck size={17} />
            </span>
            <span className="text-sm font-semibold text-ink">Smart Sentry</span>
          </Link>
          <div className="hidden items-center gap-2 text-sm text-slate-500 lg:flex">
            <span className="inline-flex h-2 w-2 rounded-full bg-sentry-500" />
            <span className="font-medium text-slate-600">Sales Intelligence Platform</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">v0.1</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-7">
          <DemoModeBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
