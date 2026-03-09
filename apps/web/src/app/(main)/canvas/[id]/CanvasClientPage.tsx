"use client";

import { useEffect, useState } from "react";
import StudioLayout from "@/features/canvases/components/StudioLayout";

export default function CanvasClientPage({
  isSharedRequest,
}: {
  isSharedRequest: boolean;
}) {
  // undefined = auth check in-flight; true = read-only; false = full access
  const [readOnly, setReadOnly] = useState<boolean | undefined>(
    isSharedRequest ? undefined : false,
  );

  useEffect(() => {
    if (!isSharedRequest) return;
    fetch("/api/auth/me")
      .then((res) => setReadOnly(!res.ok))
      .catch(() => setReadOnly(true));
  }, [isSharedRequest]);

  if (readOnly === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return <StudioLayout readOnly={readOnly} />;
}
