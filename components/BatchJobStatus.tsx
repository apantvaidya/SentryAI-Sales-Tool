"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cancelEmailGenerationJob } from "@/app/actions";
import type { OutreachJob } from "@/lib/data/types";

export const EMAIL_JOB_STORAGE_KEY = "sentry_email_job_id";

function ItemIcon({ status }: { status: OutreachJob["items"][number]["status"] }) {
  if (status === "completed") return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (status === "failed") return <XCircle size={15} className="text-red-600" />;
  if (status === "canceled") return <Ban size={15} className="text-slate-500" />;
  if (status === "running") return <Loader2 size={15} className="animate-spin text-sentry-700" />;
  return <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300" />;
}

function isDoneStatus(status: OutreachJob["items"][number]["status"]) {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function BatchJobStatus({ jobId, onHide }: { jobId: string; onHide?: () => void }) {
  const router = useRouter();
  const [job, setJob] = useState<OutreachJob | null>(null);
  const [isCanceling, startCancelTransition] = useTransition();
  const refreshedOnComplete = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(EMAIL_JOB_STORAGE_KEY, jobId);
    } catch {}
  }, [jobId]);

  useEffect(() => {
    let stopped = false;
    refreshedOnComplete.current = false;

    async function poll() {
      try {
        const response = await fetch(`/api/outreach-jobs/${jobId}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const data = (await response.json()) as OutreachJob;
        if (stopped) return;
        setJob(data);
        const done = data.items.every((item) => isDoneStatus(item.status));
        if (done && !refreshedOnComplete.current) {
          refreshedOnComplete.current = true;
          try {
            localStorage.removeItem(EMAIL_JOB_STORAGE_KEY);
          } catch {}
          router.refresh();
        }
      } catch {
        // Ignore transient poll failures; the next interval tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [jobId, router]);

  function handleDismiss() {
    try {
      localStorage.removeItem(EMAIL_JOB_STORAGE_KEY);
    } catch {}
    if (onHide) {
      onHide();
    } else {
      router.push("/people");
    }
  }

  function handleCancel() {
    if (!window.confirm("Cancel this email generation job? The current email may finish, but pending emails will be skipped.")) return;
    startCancelTransition(async () => {
      await cancelEmailGenerationJob(jobId);
      const response = await fetch(`/api/outreach-jobs/${jobId}`, { cache: "no-store" });
      if (response.ok) setJob((await response.json()) as OutreachJob);
      router.refresh();
    });
  }

  if (!job) {
    return <div className="surface mb-6 p-5 text-sm text-slate-500">Loading batch progress...</div>;
  }

  const completedCount = job.items.filter((item) => item.status === "completed").length;
  const failedCount = job.items.filter((item) => item.status === "failed").length;
  const canceledCount = job.items.filter((item) => item.status === "canceled").length;
  const runningCount = job.items.filter((item) => item.status === "running").length;
  const doneCount = completedCount + failedCount + canceledCount;
  const allDone = doneCount === job.items.length;
  const canceled = Boolean(job.canceledAt);
  const progress = job.items.length > 0 ? Math.round((doneCount / job.items.length) * 100) : 0;

  return (
    <div className="surface mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">{canceled ? "Email Generation Canceled" : "Generating Emails"}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {allDone
              ? "Done."
              : canceled
                ? "Cancel requested. Finishing any email already in progress."
                : "Running in the background - you can keep browsing."}{" "}
            {doneCount} of {job.items.length} finished.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!allDone && !canceled ? (
            <button
              type="button"
              onClick={handleCancel}
              className="button-secondary text-red-700 hover:bg-red-50"
              disabled={isCanceling}
            >
              <Ban size={15} />
              {isCanceling ? "Canceling..." : "Cancel"}
            </button>
          ) : null}
          <button type="button" onClick={handleDismiss} className="text-sm font-semibold text-sentry-700 hover:underline">
            Dismiss
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-sentry-700 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>{progress}% complete</span>
          <span>{completedCount} completed</span>
          <span>{runningCount} running</span>
          <span>{failedCount} failed</span>
          <span>{canceledCount} canceled</span>
        </div>
      </div>

      <div className="mt-4 grid max-h-96 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
        {job.items.map((item) => (
          <div key={item.personId} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <ItemIcon status={item.status} />
            <Link href={`/people/${item.personId}`} className="truncate font-medium text-ink hover:underline">
              {item.name}
            </Link>
            {item.status === "failed" ? (
              <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-red-600" title={item.errorMessage || "Failed"}>
                {item.errorMessage || "Failed"}
              </span>
            ) : null}
            {item.status === "canceled" ? <span className="ml-auto shrink-0 text-xs text-slate-500">Canceled</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
