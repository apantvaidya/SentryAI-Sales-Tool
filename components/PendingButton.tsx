"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function PendingButton({
  children,
  pendingText,
  className,
  disabled,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending}>
      {pending ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {pendingText ?? "Running…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
