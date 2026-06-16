"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { OutreachJob } from "@/lib/data/types";

function ItemIcon({ status }: { status: OutreachJob["items"][number]["status"] }) {
  if (status === "completed") return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (status === "failed") return <XCircle size={15} className="text-red-600" />;
  if (status === "running") return <Loader2 size={15} className="animate-spin text-sentry-700" />;
  return <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300" />;
}

export function BatchJobStatus({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<OutreachJob | null>(null);
  const refreshedOnComplete = useRef(false);

  useEffect(() => {
    let cancelled = false;
    refreshedOnComplete.current = false;

    async function poll() {
      try {
        const response = await fetch(`/api/outreach-jobs/${jobId}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as OutreachJob;
        if (cancelled) return;
        setJob(data);
        const done = data.items.every((item) => item.status === "completed" || item.status === "failed");
        if (done && !refreshedOnComplete.current) {
          refreshedOnComplete.current = true;
          router.refresh();
        }
      } catch {
        // Ignore transient poll failures; the next interval tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, router]);

  if (!job) {
    return (
      <div className="surface mb-6 p-5 text-sm text-slate-500">Loading batch progress…</div>
    );
  }

  const doneCount = job.items.filter((item) => item.status === "completed" || item.status === "failed").length;
  const allDone = doneCount === job.items.length;

  return (
    <div className="surface mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Generating Emails</h2>
          <p className="mt-1 text-sm text-slate-500">
            {allDone ? "Done." : "Running in the background — you can keep browsing."} {doneCount} of {job.items.length} complete.
          </p>
        </div>
        <Link href="/people" className="text-sm font-semibold text-sentry-700">
          Dismiss
        </Link>
      </div>
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {job.items.map((item) => (
          <div key={item.personId} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <ItemIcon status={item.status} />
            <Link href={`/people/${item.personId}`} className="truncate font-medium text-ink hover:underline">
              {item.name}
            </Link>
            {item.status === "failed" ? <span className="ml-auto shrink-0 text-xs text-red-600">Failed</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
