export type AnchorRect = { top: number; bottom: number; left: number; right: number };
export type Viewport = { width: number; height: number };
export type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "below" | "above";
};

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 6;
/** Below this much free space under the trigger, open above if that side has more room. */
const MIN_COMFORTABLE_HEIGHT = 320;

/** Fixed-position box for a popover anchored to a trigger, right-aligned and kept on screen. */
export function computePopoverPosition(
  anchor: AnchorRect,
  viewport: Viewport,
  desiredWidth: number,
  desiredHeight: number,
): PopoverPosition {
  const width = Math.min(desiredWidth, viewport.width - VIEWPORT_MARGIN * 2);
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, anchor.right - width),
    viewport.width - width - VIEWPORT_MARGIN,
  );
  const spaceBelow = viewport.height - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const below = spaceBelow >= Math.min(desiredHeight, MIN_COMFORTABLE_HEIGHT) || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(0, Math.min(desiredHeight, below ? spaceBelow : spaceAbove));
  const top = below ? anchor.bottom + ANCHOR_GAP : anchor.top - ANCHOR_GAP - maxHeight;
  return { top, left, width, maxHeight, placement: below ? "below" : "above" };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" (TR: "az önce", "5 dk önce", …). */
export function formatCatalogRelative(timestamp: number, locale: "tr" | "en", now: number = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return locale === "tr" ? "az önce" : "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return locale === "tr" ? `${minutes} dk önce` : `${minutes} min ago`;
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) return locale === "tr" ? `${hours} sa önce` : `${hours} h ago`;
  const days = Math.floor(delta / 86_400_000);
  return locale === "tr" ? `${days} gün önce` : `${days} d ago`;
}

/** Chat option labels are "Provider · model"; the picker shows the provider part. */
export function providerShortLabel(optionLabel: string): string {
  return optionLabel.split(" · ")[0] ?? optionLabel;
}
