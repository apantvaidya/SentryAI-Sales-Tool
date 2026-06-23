import { isDemoMode } from "@/lib/ai/client";
import { AlertCircle } from "lucide-react";

export function DemoModeBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/40 px-4 py-3 text-sm text-amber-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-500">
        <AlertCircle size={18} />
      </span>
      <p>
        <span className="font-bold">Demo mode active.</span> Add `OPENAI_API_KEY` to use live AI generation; placeholder integrations are intentionally disabled.
      </p>
    </div>
  );
}
