"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import StudioLayout from "@/features/canvases/components/StudioLayout";

export default function CanvasPage() {
  const searchParams = useSearchParams();
  const isSharedLink = searchParams.get("shared") === "true";
  const [readOnly, setReadOnly] = useState(isSharedLink);

  // If accessed via shared link, check whether user is authenticated
  useEffect(() => {
    if (!isSharedLink) return;
    fetch("/api/auth/me")
      .then((res) => {
        // Authenticated users get full access even on shared links
        if (res.ok) setReadOnly(false);
      })
      .catch(() => {
        // Not authenticated — stay in read-only mode
      });
  }, [isSharedLink]);

  return <StudioLayout readOnly={readOnly} />;
}
