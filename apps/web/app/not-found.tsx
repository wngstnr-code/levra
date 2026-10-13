"use client";

import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

export default function NotFound() {
  const m = useT();
  return <EmptyState glyph="?" title={m.errorPage.notFoundTitle} body={m.errorPage.notFoundBody} action={<ButtonLink href="/markets">{m.errorPage.home}</ButtonLink>} />;
}
