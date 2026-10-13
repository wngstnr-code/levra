"use client";

import { useEffect } from "react";
import { ButtonLink, Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const m = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      glyph="!"
      tone="down"
      title={m.errorPage.title}
      body={m.errorPage.body}
      action={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset}>
            {m.errorPage.retry}
          </Button>
          <ButtonLink href="/markets">{m.errorPage.home}</ButtonLink>
        </div>
      }
    />
  );
}
