import Link from "next/link";
import { BarChart3, Network, Plus, ShieldCheck, Users } from "lucide-react";
import { DemoModeBanner } from "./DemoModeBanner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slatepanel">
      <header className="sticky top-0 z-20 border-b border-slate-300/80 bg-white/90 shadow-apple-control backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3" aria-label="Smart Sentry dashboard">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1d1d1f] text-white shadow-md ring-1 ring-black/10">
              <ShieldCheck size={21} />
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold text-ink">Smart Sentry</span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Prospecting OS</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            <Link href="/" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white/80 hover:text-ink">
              <BarChart3 size={16} />
              Pipeline
            </Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white/80 hover:text-ink">
              <Users size={16} />
              Workspaces
            </Link>
            <Link href="/legacy-visualization" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white/80 hover:text-ink">
              <Network size={16} />
              Visualization
            </Link>
          </nav>
          <Link href="/prospects/new" className="button-primary">
            <Plus size={17} />
            New Prospect
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-7">
        <DemoModeBanner />
        {children}
      </div>
    </main>
  );
}
