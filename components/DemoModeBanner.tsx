import { isDemoMode } from "@/lib/ai/client";

export function DemoModeBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Demo mode is active. Add `OPENAI_API_KEY` to use live AI generation; placeholder integrations are intentionally disabled.
    </div>
  );
}
