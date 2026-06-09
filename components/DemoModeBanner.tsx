import { isDemoMode } from "@/lib/ai/client";
import { AlertCircle } from "lucide-react";

export function DemoModeBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="mb-5 flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50">
        <AlertCircle size={17} />
      </span>
      <p>
        <span className="font-bold">Demo mode active.</span> Add `OPENAI_API_KEY` to use live AI generation; placeholder integrations are intentionally disabled.
      </p>
    </div>
  );
}
