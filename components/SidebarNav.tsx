"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookUser, ChevronRight, Database, Radar, Target, Workflow, type LucideIcon } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

type NavSection = {
  heading: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Workspace",
    items: [
      {
        href: "/people",
        label: "People Directory",
        icon: BookUser,
        match: (p) => p === "/people" || p.startsWith("/people/")
      },
      {
        href: "/lead-discovery",
        label: "Lead Discovery",
        icon: Radar,
        match: (p) => p.startsWith("/lead-discovery")
      },
      {
        href: "/imports",
        label: "Imports",
        icon: Database,
        match: (p) => p.startsWith("/imports")
      },
      {
        href: "/campaigns",
        label: "Campaigns",
        icon: Target,
        match: (p) => p.startsWith("/campaigns")
      }
    ]
  },
  {
    heading: "Analysis",
    items: [
      {
        href: "/legacy-visualization",
        label: "Visualization",
        icon: Workflow,
        match: (p) => p.startsWith("/legacy-visualization")
      }
    ]
  }
];

export function SidebarNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Primary navigation">
      {NAV_SECTIONS.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {section.heading}
          </p>
          {section.items.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-rail-hover text-white ring-1 ring-inset ring-white/10"
                    : "text-slate-400 hover:bg-rail-raised hover:text-white"
                }`}
              >
                <Icon
                  size={17}
                  className={active ? "text-brand-300" : "text-slate-500 group-hover:text-slate-300"}
                />
                <span className="flex-1">{label}</span>
                <ChevronRight
                  size={15}
                  className={active ? "text-slate-400" : "text-slate-600 group-hover:text-slate-400"}
                />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
