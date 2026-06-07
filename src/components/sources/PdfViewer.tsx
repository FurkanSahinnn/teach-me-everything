"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCw,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils/cn";

// pdfjs-dist v5 dropped the empty-workerSrc fake-worker fallback. Importing
// the worker bundle as a side-effect registers it with GlobalWorkerOptions
// the same way pdf-worker.ts does for ingest. Both module imports are gated
// behind a dynamic import below so the viewer's bundle does not load on
// pages that never open the PDF mode.
type PdfjsLib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfjsLib> | null = null;

function loadPdfjs(): Promise<PdfjsLib> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      return lib;
    })();
  }
  return pdfjsPromise;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function nextScaleStep(current: number): number {
  for (const s of SCALE_STEPS) if (s > current + 0.001) return s;
  return MAX_SCALE;
}

function prevScaleStep(current: number): number {
  for (const s of [...SCALE_STEPS].reverse()) {
    if (s < current - 0.001) return s;
  }
  return MIN_SCALE;
}

type FitMode = "manual" | "width" | "page";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocument = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPage = any;

type Props = {
  blob: Blob;
  pick: (tr: string, en: string) => string;
  className?: string;
};

export function PdfViewer({ blob, pick, className }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [pdfjsLib, setPdfjsLib] = useState<PdfjsLib | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1.4);
  const [rotation, setRotation] = useState(0);
  const [fitMode, setFitMode] = useState<FitMode>("manual");
  const [currentPage, setCurrentPage] = useState(1);

  // First-page natural dimensions (at scale=1, rotation=0) — the toolbar's
  // fit-width / fit-page math derives from these, so we cache them once per
  // document load. Rotation is applied in the page renderer separately.
  const [firstPageNatural, setFirstPageNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Load pdfjs + open document.
  useEffect(() => {
    let cancelled = false;
    let pdfDoc: PdfDocument | null = null;

    void (async () => {
      try {
        setError(null);
        setPdf(null);
        setFirstPageNatural(null);
        setCurrentPage(1);

        const lib = await loadPdfjs();
        if (cancelled) return;
        setPdfjsLib(lib);

        const data = await blob.arrayBuffer();
        if (cancelled) return;

        const loadingTask = lib.getDocument({ data: new Uint8Array(data) });
        pdfDoc = await loadingTask.promise;
        if (cancelled || !pdfDoc) return;

        setPdf(pdfDoc);
        setPageCount(pdfDoc.numPages);
        pageRefs.current = new Array(pdfDoc.numPages).fill(null);

        const firstPage = await pdfDoc.getPage(1);
        if (cancelled) return;
        const v = firstPage.getViewport({ scale: 1, rotation: 0 });
        setFirstPageNatural({ width: v.width, height: v.height });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        pdfDoc?.destroy?.();
      } catch {
        // best-effort cleanup
      }
    };
  }, [blob]);

  // Re-apply fit mode whenever it (or the document / rotation / window size)
  // changes. Manual mode opts out so explicit zoom presses don't get
  // immediately overwritten by a fit recalculation.
  const recalcFit = useCallback(() => {
    if (fitMode === "manual" || !firstPageNatural) return;
    const root = scrollRootRef.current;
    const containerW = root?.clientWidth ?? wrapperRef.current?.clientWidth ?? 0;
    const containerH = root?.clientHeight ?? window.innerHeight;
    // Account for horizontal padding (px-4 = 16px each side on the pages
    // wrapper) so the page actually fits with its margin instead of getting
    // clipped on the right.
    const usableW = Math.max(0, containerW - 32);
    const usableH = Math.max(0, containerH - 80);
    const rotated = rotation === 90 || rotation === 270;
    const w = rotated ? firstPageNatural.height : firstPageNatural.width;
    const h = rotated ? firstPageNatural.width : firstPageNatural.height;
    if (fitMode === "width") {
      setScale(clamp(usableW / w, MIN_SCALE, MAX_SCALE));
    } else if (fitMode === "page") {
      setScale(
        clamp(Math.min(usableW / w, usableH / h), MIN_SCALE, MAX_SCALE),
      );
    }
  }, [fitMode, firstPageNatural, rotation]);

  useEffect(() => {
    recalcFit();
  }, [recalcFit]);

  useEffect(() => {
    if (fitMode === "manual") return;
    function onResize(): void {
      recalcFit();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitMode, recalcFit]);

  // Track which page is currently centred in the viewport so the toolbar
  // page indicator follows the user's scroll without us having to set up a
  // separate observer per page.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    let raf = 0;
    function onScroll(): void {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!root) return;
        const rootRect = root.getBoundingClientRect();
        const midY = rootRect.top + rootRect.height / 2;
        let bestPage = 1;
        let bestDistance = Infinity;
        for (let i = 0; i < pageRefs.current.length; i += 1) {
          const el = pageRefs.current[i];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const m = r.top + r.height / 2;
          const d = Math.abs(m - midY);
          if (d < bestDistance) {
            bestDistance = d;
            bestPage = i + 1;
          }
        }
        setCurrentPage(bestPage);
      });
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
    };
  }, [pageCount]);

  // Ctrl/Cmd + wheel zoom — same gesture every PDF reader uses. We listen
  // on the scroll root with passive:false so we can preventDefault() and
  // stop the browser from also scaling the whole tab.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    function onWheel(e: WheelEvent): void {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setFitMode("manual");
      setScale((s) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        return clamp(s * factor, MIN_SCALE, MAX_SCALE);
      });
    }
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  function jumpToPage(pageNum: number): void {
    const target = pageRefs.current[pageNum - 1];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function zoomIn(): void {
    setFitMode("manual");
    setScale((s) => nextScaleStep(s));
  }
  function zoomOut(): void {
    setFitMode("manual");
    setScale((s) => prevScaleStep(s));
  }
  function zoom100(): void {
    setFitMode("manual");
    setScale(1);
  }
  function rotate(): void {
    setRotation((r) => (r + 90) % 360);
  }

  return (
    <div
      ref={wrapperRef}
      className={cn("flex min-h-0 flex-col bg-paper-2", className)}
    >
      <Toolbar
        currentPage={currentPage}
        pageCount={pageCount}
        scale={scale}
        fitMode={fitMode}
        onPrev={() => jumpToPage(Math.max(1, currentPage - 1))}
        onNext={() => jumpToPage(Math.min(pageCount, currentPage + 1))}
        onJump={jumpToPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoom100={zoom100}
        onFitWidth={() => setFitMode("width")}
        onFitPage={() => setFitMode("page")}
        onRotate={rotate}
        disabled={!pdf}
        pick={pick}
      />

      <div
        ref={scrollRootRef}
        data-pdf-scroll
        className="flex-1 overflow-y-auto"
      >
        {error ? (
          <div className="m-4 flex items-start gap-2 rounded-md border border-err/40 bg-err/10 px-3 py-2.5 text-[13px] text-err">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">
                {pick("PDF açılamadı", "Failed to open PDF")}
              </div>
              <div className="mt-0.5 break-words text-[12px] text-err/90">
                {error}
              </div>
            </div>
          </div>
        ) : null}

        {!pdf && !error ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {pick("PDF açılıyor…", "Opening PDF…")}
          </div>
        ) : null}

        {pdf && pdfjsLib ? (
          <div className="flex flex-col items-center gap-3 px-4 py-4">
            {Array.from({ length: pageCount }, (_, i) => (
              <PdfPageView
                key={i + 1}
                ref={(el) => {
                  pageRefs.current[i] = el;
                }}
                pdf={pdf}
                pdfjsLib={pdfjsLib}
                pageNumber={i + 1}
                scale={scale}
                rotation={rotation}
                scrollRoot={scrollRootRef.current}
                pick={pick}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ToolbarProps = {
  currentPage: number;
  pageCount: number;
  scale: number;
  fitMode: FitMode;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoom100: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onRotate: () => void;
  disabled: boolean;
  pick: (tr: string, en: string) => string;
};

function Toolbar({
  currentPage,
  pageCount,
  scale,
  fitMode,
  onPrev,
  onNext,
  onJump,
  onZoomIn,
  onZoomOut,
  onZoom100,
  onFitWidth,
  onFitPage,
  onRotate,
  disabled,
  pick,
}: ToolbarProps) {
  const [pageInput, setPageInput] = useState<string>(String(currentPage));

  // Keep the input in sync with the scroll-tracked page. We don't replace
  // user-entered text mid-edit — only when the input is not focused.
  useEffect(() => {
    if (document.activeElement?.tagName !== "INPUT") {
      setPageInput(String(currentPage));
    }
  }, [currentPage]);

  function commitJump(): void {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) {
      const clamped = clamp(n, 1, pageCount);
      onJump(clamped);
      setPageInput(String(clamped));
    } else {
      setPageInput(String(currentPage));
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper px-3 py-1.5">
      <div className="flex items-center gap-1">
        <ToolbarButton
          onClick={onPrev}
          disabled={disabled || currentPage <= 1}
          ariaLabel={pick("Önceki sayfa", "Previous page")}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
        <div className="flex items-center gap-1 font-mono text-[12px] text-ink-2">
          <input
            type="text"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitJump();
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={disabled}
            aria-label={pick("Sayfa numarası", "Page number")}
            className="h-7 w-12 rounded border border-rule bg-paper text-center text-[12px] tabular-nums focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <span className="text-ink-4">/</span>
          <span className="tabular-nums">{pageCount || "—"}</span>
        </div>
        <ToolbarButton
          onClick={onNext}
          disabled={disabled || currentPage >= pageCount}
          ariaLabel={pick("Sonraki sayfa", "Next page")}
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton
          onClick={onZoomOut}
          disabled={disabled || scale <= MIN_SCALE + 0.01}
          ariaLabel={pick("Uzaklaştır", "Zoom out")}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
        <button
          type="button"
          onClick={onZoom100}
          disabled={disabled}
          aria-label={pick("100% (varsayılan)", "Reset to 100%")}
          className="h-7 min-w-[56px] rounded border border-rule bg-paper px-1.5 font-mono text-[11.5px] tabular-nums text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolbarButton
          onClick={onZoomIn}
          disabled={disabled || scale >= MAX_SCALE - 0.01}
          ariaLabel={pick("Yakınlaştır", "Zoom in")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>

        <span className="mx-1 h-5 w-px bg-rule-soft" aria-hidden />

        <button
          type="button"
          onClick={onFitWidth}
          disabled={disabled}
          aria-pressed={fitMode === "width"}
          className={cn(
            "h-7 rounded border px-2 text-[11.5px] font-medium transition-colors",
            fitMode === "width"
              ? "border-accent bg-accent-wash text-accent-ink"
              : "border-rule bg-paper text-ink-2 hover:border-rule-strong hover:bg-paper-2",
          )}
        >
          {pick("Geniş", "Width")}
        </button>
        <button
          type="button"
          onClick={onFitPage}
          disabled={disabled}
          aria-pressed={fitMode === "page"}
          className={cn(
            "h-7 rounded border px-2 text-[11.5px] font-medium transition-colors",
            fitMode === "page"
              ? "border-accent bg-accent-wash text-accent-ink"
              : "border-rule bg-paper text-ink-2 hover:border-rule-strong hover:bg-paper-2",
          )}
          title={pick("Sayfayı sığdır", "Fit page")}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>

        <span className="mx-1 h-5 w-px bg-rule-soft" aria-hidden />

        <ToolbarButton
          onClick={onRotate}
          disabled={disabled}
          ariaLabel={pick("Döndür", "Rotate")}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="grid h-7 w-7 place-items-center rounded border border-rule bg-paper text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

type PdfPageProps = {
  pdf: PdfDocument;
  pdfjsLib: PdfjsLib;
  pageNumber: number;
  scale: number;
  rotation: number;
  scrollRoot: HTMLElement | null;
  pick: (tr: string, en: string) => string;
};

const PdfPageView = forwardRef<HTMLDivElement, PdfPageProps>(function PdfPageView(
  { pdf, pdfjsLib, pageNumber, scale, rotation, scrollRoot, pick },
  forwardedRef,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => wrapperRef.current as HTMLDivElement);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  // Cache the natural (scale=1) viewport so the placeholder reserves the
  // correct space before the page is actually rendered. Without this the
  // reader would jump as each page resolves its dimensions.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  // Render token — bumped on every successful render. `scale|rotation`
  // changes invalidate the canvas, so the rendering effect compares its
  // captured token against the latest `renderTokenRef` and bails out if
  // a newer render has started.
  const renderTokenRef = useRef(0);
  const [rendered, setRendered] = useState(false);

  const viewport = useMemo(() => {
    if (!natural) return null;
    const rotated = rotation === 90 || rotation === 270;
    const w = (rotated ? natural.height : natural.width) * scale;
    const h = (rotated ? natural.width : natural.height) * scale;
    return { width: w, height: h };
  }, [natural, scale, rotation]);

  // Probe natural dimensions once per page+rotation. Pdfjs's getPage is
  // cheap and cached internally, so calling it a second time on rotation
  // change is fine.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page: PdfPage = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const v = page.getViewport({ scale: 1, rotation: 0 });
        setNatural({ width: v.width, height: v.height });
      } catch {
        // ignore; the placeholder will keep its fallback height
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  // Lazy mount: only render the canvas when the placeholder is within
  // ±800px of the scroll root viewport. Pages outside this band stay as
  // empty placeholders, keeping memory and CPU bounded for 100+ page docs.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            // Once a page becomes visible we keep it rendered — disconnecting
            // avoids re-firing this branch on every scroll. If we wanted to
            // free far-away pages we'd add a separate observer with a wider
            // root margin and call canvas.width=0 on un-intersect.
            observer.disconnect();
          }
        }
      },
      {
        root: scrollRoot,
        rootMargin: "800px 0px 800px 0px",
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Render canvas + textLayer whenever the page becomes visible OR when
  // scale/rotation change after the page has already been rendered.
  useEffect(() => {
    if (!visible || !natural) return;
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    if (!canvas || !textLayerDiv) return;

    const token = ++renderTokenRef.current;
    let cancelled = false;
    setRendered(false);

    void (async () => {
      try {
        const page: PdfPage = await pdf.getPage(pageNumber);
        if (cancelled || token !== renderTokenRef.current) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewportLogical = page.getViewport({ scale, rotation });
        const viewportDevice = page.getViewport({ scale: scale * dpr, rotation });

        canvas.style.width = `${Math.floor(viewportLogical.width)}px`;
        canvas.style.height = `${Math.floor(viewportLogical.height)}px`;
        canvas.width = Math.floor(viewportDevice.width);
        canvas.height = Math.floor(viewportDevice.height);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({
          canvasContext: ctx,
          viewport: viewportDevice,
        }).promise;
        if (cancelled || token !== renderTokenRef.current) return;

        // Reset the text layer container before re-rendering — pdfjs's
        // TextLayer appends spans, so a stale render would visually double
        // the text on every zoom.
        textLayerDiv.replaceChildren();
        textLayerDiv.style.width = `${Math.floor(viewportLogical.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewportLogical.height)}px`;
        textLayerDiv.style.setProperty("--scale-factor", String(scale));

        try {
          const textContent = await page.getTextContent();
          if (cancelled || token !== renderTokenRef.current) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const TextLayerCtor = (pdfjsLib as any).TextLayer;
          if (TextLayerCtor) {
            const tl = new TextLayerCtor({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport: viewportLogical,
            });
            await tl.render();
          }
          // pdfjs lays out text spans in PDF stream order, which often
          // doesn't match visual reading order — section numbers and
          // their titles, equations, footnote markers etc. land in
          // separate text items and end up scattered across the DOM.
          // Native browser selection follows DOM order, so dragging
          // across "1 Bu Dökümanda" leaves "1" out because it sits in
          // a non-adjacent span.
          //
          // Re-appending all leaf spans in (top, left) order collapses
          // DOM order to visual reading order, which is what selection
          // needs to behave intuitively. This drops pdfjs's marked-
          // content wrapper structure — acceptable here because the
          // textLayer is purely a selection overlay; accessibility for
          // the rendered page goes through other channels.
          //
          // The .endOfContent sentinel is re-appended LAST so the
          // .selecting toggle still clamps drag bounds at the bottom
          // of the page.
          const leafSpans: HTMLSpanElement[] = [];
          (function collect(node: Element): void {
            for (const child of Array.from(node.children)) {
              if (child instanceof HTMLSpanElement) {
                if (
                  child.children.length === 0 &&
                  (child.textContent ?? "").length > 0
                ) {
                  leafSpans.push(child);
                } else {
                  collect(child);
                }
              }
            }
          })(textLayerDiv);

          if (leafSpans.length > 1) {
            const measured = leafSpans.map((el) => {
              const r = el.getBoundingClientRect();
              return { el, top: r.top, left: r.left };
            });
            // 5px vertical tolerance treats spans on the same visual
            // line as siblings even when the baseline jitters by a
            // sub-pixel.
            const LINE_THRESHOLD = 5;
            measured.sort((a, b) => {
              if (Math.abs(a.top - b.top) < LINE_THRESHOLD) {
                return a.left - b.left;
              }
              return a.top - b.top;
            });
            textLayerDiv.replaceChildren();
            for (const { el } of measured) {
              textLayerDiv.appendChild(el);
            }
          }

          const eoc = document.createElement("div");
          eoc.className = "endOfContent";
          textLayerDiv.appendChild(eoc);
        } catch {
          // Text-layer failure is non-fatal — the canvas is already
          // visible; the user just loses text selection on that page.
        }

        if (!cancelled && token === renderTokenRef.current) setRendered(true);
      } catch {
        // Page render failures bubble up as a blank placeholder; we don't
        // crash the whole viewer over a single bad page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, natural, scale, rotation, pdf, pdfjsLib, pageNumber]);

  // Toggle the `.selecting` class on the textLayer while the user is
  // dragging a selection. Combined with the `.endOfContent` sentinel
  // appended after render, this clamps the selection so it stops at the
  // pointer position instead of bleeding to the bottom of the page.
  useEffect(() => {
    const tl = textLayerRef.current;
    if (!tl) return;
    function onDown(): void {
      tl?.classList.add("selecting");
    }
    function onUp(): void {
      tl?.classList.remove("selecting");
    }
    tl.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      tl.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      data-page-number={pageNumber}
      className="tme-pdf-page relative shrink-0 overflow-hidden rounded-md bg-white"
      style={{
        width: viewport ? `${Math.floor(viewport.width)}px` : "min(640px, 100%)",
        height: viewport ? `${Math.floor(viewport.height)}px` : "800px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      {!rendered ? (
        <div className="absolute inset-0 grid place-items-center bg-paper-2 text-[11px] text-ink-4">
          {visible ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <span className="font-mono">
              {pick(`Sayfa ${pageNumber}`, `Page ${pageNumber}`)}
            </span>
          )}
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: viewport ? `${Math.floor(viewport.width)}px` : "100%",
          height: viewport ? `${Math.floor(viewport.height)}px` : "100%",
        }}
      />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{
          position: "absolute",
          inset: 0,
          lineHeight: 1,
          color: "transparent",
        }}
      />
    </div>
  );
});
