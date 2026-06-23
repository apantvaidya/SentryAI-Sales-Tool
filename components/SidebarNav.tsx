"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ContactRound, FileText, Network, type LucideIcon } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/people",
    label: "People",
    icon: ContactRound,
    match: (p) => p === "/people" || p.startsWith("/people/")
  },
  {
    href: "/queries",
    label: "Queries",
    icon: FileText,
    match: (p) => p.startsWith("/queries")
  },
  {
    href: "/legacy-visualization",
    label: "Visualization",
    icon: Network,
    match: (p) => p.startsWith("/legacy-visualization")
  }
];

export function SidebarNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Primary navigation">
      <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Workspace
      </p>
      {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-gradient-to-r from-brand-500/25 to-brand-500/5 text-white ring-1 ring-inset ring-brand-400/30 shadow-[0_0_20px_-6px_rgba(45,114,210,0.7)]"
                : "text-slate-300 hover:bg-rail-raised hover:text-white"
            }`}
          >
            {active ? (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-400 shadow-[0_0_10px_rgba(45,114,210,0.9)]" />
            ) : null}
            <Icon size={17} className={active ? "text-brand-300" : "text-slate-400 group-hover:text-slate-200"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
