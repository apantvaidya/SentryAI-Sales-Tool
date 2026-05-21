import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProspectForm } from "@/components/ProspectForm";

export default function NewProspectPage() {
  return (
    <AppShell>
      <Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to dashboard
      </Link>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">New Prospect</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Generate Prospect Brief</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Use public, user-supplied context only for this MVP. External enrichment providers are represented as placeholders.
        </p>
      </div>
      <ProspectForm />
    </AppShell>
  );
}
