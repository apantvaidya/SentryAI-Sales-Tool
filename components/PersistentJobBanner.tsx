"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BatchJobStatus, EMAIL_JOB_STORAGE_KEY } from "./BatchJobStatus";

function Banner() {
  const params = useSearchParams();
  const urlJobId = params.get("jobId");
  const [storedJobId, setStoredJobId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setStoredJobId(localStorage.getItem(EMAIL_JOB_STORAGE_KEY));
    } catch {}
  }, []);

  // Avoid hydration mismatch
  if (!mounted) return null;
  // The server component already renders BatchJobStatus when the URL has ?jobId
  if (urlJobId) return null;
  if (!storedJobId) return null;

  return (
    <BatchJobStatus
      jobId={storedJobId}
      onHide={() => setStoredJobId(null)}
    />
  );
}

export function PersistentJobBanner() {
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  );
}
