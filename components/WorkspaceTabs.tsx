import Link from "next/link";
import type { ComponentType } from "react";
import { BarChart3, FileText, LayoutDashboard, Mail, Search, Users } from "lucide-react";

type WorkspaceTabKey = "overview" | "candidates" | "contacts" | "crime-research" | "drafts" | "lead-graph";

const tabs: Array<{
  key: WorkspaceTabKey;
  label: string;
  hrefSuffix: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: "overview", label: "Overview", hrefSuffix: "", icon: LayoutDashboard },
  { key: "candidates", label: "Candidates", hrefSuffix: "/candidates", icon: Users },
  { key: "contacts", label: "Contacts", hrefSuffix: "/contacts", icon: Search },
  { key: "crime-research", label: "Crime Research", hrefSuffix: "/crime-research", icon: BarChart3 },
  { key: "drafts", label: "Drafts", hrefSuffix: "/drafts", icon: Mail },
  { key: "lead-graph", label: "Lead Graph", hrefSuffix: "/lead-graph", icon: FileText }
];

export function WorkspaceTabs({ prospectId, active }: { prospectId: string; active: WorkspaceTabKey }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-slate-300 bg-white p-1 shadow-soft" aria-label="Prospect workspace tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={`/prospects/${prospectId}${tab.hrefSuffix}`}
            className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
              isActive ? "bg-ink text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
            }`}
          >
            <Icon size={16} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
