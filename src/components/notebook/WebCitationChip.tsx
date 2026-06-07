"use client";

import { Globe } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import type { WebCitation } from "@/lib/ai/web-search/types";

// Google s2 favicon proxy keeps the chip working under tight `connect-src`
// CSP — every favicon comes from a single origin we already whitelist. The
// `sz=32` query asks for a 2x asset so the chip stays crisp on HiDPI.
export function googleFaviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const host = parsed.hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(
      host,
    )}`;
  } catch {
    return null;
  }
}

/**
 * Trims a URL down to a chip-friendly domain. Strips `www.` and any path so
 * "https://www.example.com/x/y" surfaces as "example.com". Falls back to
 * the raw input string when URL parsing fails — happens for malformed
 * citations adapters occasionally pass through, where showing the raw
 * value beats showing nothing.
 */
export function citationDomainLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    return host || url;
  } catch {
    return url;
  }
}

type Props = {
  citation: WebCitation;
  onActivate: (citation: WebCitation) => void;
  /** Number shown inside the chip (1-based). Optional — when omitted the
   * chip renders only the favicon + domain (used in the message-tail list). */
  index?: number;
  className?: string;
};

export function WebCitationChip({
  citation,
  onActivate,
  index,
  className,
}: Props) {
  const domain = useMemo(
    () => citationDomainLabel(citation.result.url),
    [citation.result.url],
  );
  const favicon = useMemo(
    () => citation.result.faviconUrl ?? googleFaviconUrl(citation.result.url),
    [citation.result.faviconUrl, citation.result.url],
  );

  return (
    <button
      type="button"
      onClick={() => onActivate(citation)}
      title={`${citation.result.title} · ${domain}`}
      data-testid="web-citation-chip"
      data-citation-url={citation.result.url}
      className={cn(
        "mx-0.5 inline-flex items-baseline gap-1 rounded-[6px] border border-accent-soft bg-accent-wash px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-accent-ink",
        "transition-all duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[var(--shadow-soft)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      {favicon ? (
        // Favicons are decorative — assistive tech reads the title attribute
        // on the chip itself, so the <img> is `alt=""` and `aria-hidden`.
        <img
          src={favicon}
          alt=""
          aria-hidden
          width={12}
          height={12}
          className="h-3 w-3 rounded-[2px] self-center"
          loading="lazy"
        />
      ) : (
        <Globe aria-hidden className="h-3 w-3 text-accent-ink self-center" />
      )}
      {typeof index === "number" && (
        <span aria-hidden className="tabular-nums">
          {index}
        </span>
      )}
      <span className="normal-case tracking-normal">{domain}</span>
    </button>
  );
}
