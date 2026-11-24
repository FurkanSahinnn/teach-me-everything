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
  type CSSProperties,
  type MouseEventHandler,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { TextLayerBuilder } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import type { PdfReaderView } from "@/lib/db/types";
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

type FitMode = PdfReaderView["fitMode"];

type Props = {
  blob: Blob;
  pick: (tr: string, en: string) => string;
  className?: string;
  onMouseUp?: MouseEventHandler<HTMLDivElement>;
  initialView: PdfReaderView | undefined;
  onViewChange: (view: PdfReaderView) => void;
};

export function PdfViewer({ blob, pick, className, onMouseUp, initialView, onViewChange }: Props) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const bindScrollRoot = useCallback((node: HTMLDivElement | null) => {
    scrollRootRef.current = node;
    setScrollRoot(node);
  }, []);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pagesRef = useRef<HTMLDivElement>(null);
  const jumpScrollTop = useRef<number | null>(null);
  const pendingPage = useRef<number | null>(null);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<PdfReaderView>(() => ({
    scale: initialView && Number.isFinite(initialView.scale) ? clamp(initialView.scale, MIN_SCALE, MAX_SCALE) : 1.4,
    fitMode: initialView?.fitMode === "width" || initialView?.fitMode === "page" ? initialView.fitMode : "manual",
    rotation: initialView && [0, 90, 180, 270].includes(initialView.rotation) ? initialView.rotation : 0,
    page: initialView?.page && Number.isSafeInteger(initialView.page) ? Math.max(1, initialView.page) : 1,
  }));
  const viewRef = useRef(view);
  const saveTimer = useRef<number | null>(null);
  const { rotation, fitMode } = view;
  const [fitScale, setFitScale] = useState<number | null>(null);
  const scale = fitMode === "manual" ? view.scale : fitScale ?? view.scale;
  const fitReady = fitMode === "manual" || fitScale !== null;
  const currentPage = view.page ?? 1;

  const flushView = useCallback(() => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    onViewChange(viewRef.current);
  }, [onViewChange]);

  const changeView = useCallback((patch: Partial<PdfReaderView>, defer = false) => {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    setView(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (defer) {
      saveTimer.current = window.setTimeout(flushView, 150);
    } else {
      saveTimer.current = null;
      onViewChange(next);
    }
  }, [flushView, onViewChange]);

  useEffect(() => flushView, [flushView]);

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
    let pdfDoc: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        setError(null);
        setPdf(null);
        setFirstPageNatural(null);
        setFitScale(null);
        const lastPage = viewRef.current.page ?? 1;
        pendingPage.current = lastPage > 1 ? lastPage : null;
        jumpScrollTop.current = null;

        const lib = await loadPdfjs();
        if (cancelled) return;

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

  // Re-apply fit mode whenever it (or the document / rotation / pane size)
  // changes. Manual mode opts out so explicit zoom presses don't get
  // immediately overwritten by a fit recalculation.
  const recalcFit = useCallback(() => {
    if (fitMode === "manual" || !firstPageNatural) return;
    const root = scrollRootRef.current;
    if (!root?.clientWidth || !root.clientHeight) return;
    const containerW = root.clientWidth;
    const containerH = root.clientHeight;
    // Account for horizontal padding (px-4 = 16px each side on the pages
    // wrapper) so the page actually fits with its margin instead of getting
    // clipped on the right.
    const usableW = Math.max(0, containerW - 32);
    const usableH = Math.max(0, containerH - 80);
    const rotated = rotation === 90 || rotation === 270;
    const w = rotated ? firstPageNatural.height : firstPageNatural.width;
    const h = rotated ? firstPageNatural.width : firstPageNatural.height;
    if (fitMode === "width") {
      setFitScale(clamp(usableW / w, MIN_SCALE, MAX_SCALE));
    } else if (fitMode === "page") {
      setFitScale(
        clamp(Math.min(usableW / w, usableH / h), MIN_SCALE, MAX_SCALE),
      );
    }
  }, [fitMode, firstPageNatural, rotation]);

  useEffect(() => {
    recalcFit();
  }, [recalcFit]);

  useEffect(() => {
    if (fitMode === "manual" || !scrollRoot) return;
    let timer: number;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(recalcFit, 100);
    });
    observer.observe(scrollRoot);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [fitMode, recalcFit, scrollRoot]);

  const scrollToPage = useCallback((page: number): boolean => {
    const root = scrollRootRef.current;
    const target = pageRefs.current[page - 1];
    // Placeholder heights can change the scroll target by several pages.
    if (!root?.clientHeight || !target || !pageRefs.current.every((item) => item?.hasAttribute("data-page-measured"))) {
      return false;
    }
    const viewportTop = root.getBoundingClientRect().top + root.clientTop;
    const top = root.scrollTop + target.getBoundingClientRect().top - viewportTop;
    root.scrollTo({ top, behavior: "instant" });
    jumpScrollTop.current = root.scrollTop;
    return true;
  }, []);

  useEffect(() => {
    const pages = pagesRef.current;
    if (!pdf || !scrollRoot || !pages || !fitReady) return;

    const restorePage = () => {
      const saved = pendingPage.current;
      if (saved === null) return;
      const page = Math.min(saved, pdf.numPages);
      if (!scrollToPage(page)) return;
      pendingPage.current = null;
      if (page !== viewRef.current.page) changeView({ page });
      observer.disconnect();
      resizeObserver.disconnect();
    };
    const observer = new MutationObserver(restorePage);
    const resizeObserver = new ResizeObserver(restorePage);
    observer.observe(pages, { subtree: true, attributes: true, attributeFilter: ["data-page-measured"] });
    resizeObserver.observe(scrollRoot);
    restorePage();
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [pdf, scrollRoot, fitReady, scrollToPage, changeView]);

  // Track which page is currently centred in the viewport so the toolbar
  // page indicator follows the user's scroll without us having to set up a
  // separate observer per page.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || !pageCount) return;

    let raf = 0;
    const recordPage = (page: number) => {
      if (page !== viewRef.current.page) changeView({ page });
    };
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { scrollTop, clientHeight, scrollHeight } = root;
        // Several short pages can be visible at the same scroll position.
        // Keep the explicitly requested page until the viewport scrolls again.
        if (clientHeight === 0 || jumpScrollTop.current === scrollTop) return;
        if (pendingPage.current !== null) return;
        jumpScrollTop.current = null;
        if (scrollTop <= 0) {
          recordPage(1);
          return;
        }
        if (scrollTop >= scrollHeight - clientHeight - 1) {
          recordPage(pageCount);
          return;
        }
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
        recordPage(bestPage);
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
    };
  }, [pageCount, changeView]);

  // Ctrl/Cmd + wheel zoom — same gesture every PDF reader uses. We listen
  // on the scroll root with passive:false so we can preventDefault() and
  // stop the browser from also scaling the whole tab.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    function onWheel(e: WheelEvent): void {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const fromScale = viewRef.current.fitMode === "manual" ? viewRef.current.scale : scale;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      changeView({ fitMode: "manual", scale: clamp(fromScale * factor, MIN_SCALE, MAX_SCALE) }, true);
    }
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [changeView, scale]);

  function jumpToPage(pageNum: number): void {
    pendingPage.current = scrollToPage(pageNum) ? null : pageNum;
    changeView({ page: pageNum });
  }

  function zoomIn(): void {
    changeView({ fitMode: "manual", scale: nextScaleStep(scale) });
  }
  function zoomOut(): void {
    changeView({ fitMode: "manual", scale: prevScaleStep(scale) });
  }
  function zoom100(): void {
    changeView({ fitMode: "manual", scale: 1 });
  }
  function rotate(): void {
    changeView({ rotation: (rotation + 90) % 360 });
  }

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col bg-paper-2", className)}
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
        onFitWidth={() => changeView({ fitMode: "width" })}
        onFitPage={() => changeView({ fitMode: "page" })}
        onRotate={rotate}
        disabled={!pdf}
        pick={pick}
      />

      <div
        ref={bindScrollRoot}
        data-pdf-scroll
        onMouseUp={onMouseUp}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
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

        {pdf ? (
          <div ref={pagesRef} className="flex flex-col items-center-safe gap-3 px-4 py-4">
            {Array.from({ length: pageCount }, (_, i) => (
              <PdfPageView
                key={i + 1}
                ref={(el) => {
                  pageRefs.current[i] = el;
                }}
                pdf={pdf}
                pageNumber={i + 1}
                scale={scale}
                rotation={rotation}
                scrollRoot={scrollRoot}
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
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const pageInput = pageDraft ?? String(currentPage);

  function commitJump(): void {
    if (pageDraft === null) return;
    const n = parseInt(pageDraft, 10);
    if (Number.isFinite(n)) {
      const clamped = clamp(n, 1, pageCount);
      onJump(clamped);
    }
    setPageDraft(null);
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
            onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
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
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  scrollRoot: HTMLElement | null;
  pick: (tr: string, en: string) => string;
};

const PdfPageView = forwardRef<HTMLDivElement, PdfPageProps>(function PdfPageView(
  { pdf, pageNumber, scale, rotation, scrollRoot, pick },
  forwardedRef,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => wrapperRef.current as HTMLDivElement);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerHostRef = useRef<HTMLDivElement>(null);

  // Cache the natural (scale=1) viewport so the placeholder reserves the
  // correct space before the page is actually rendered. Without this the
  // reader would jump as each page resolves its dimensions.
  // Undefined while measuring, null if PDF.js couldn't read the dimensions.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>();
  const [visible, setVisible] = useState(false);
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
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const v = page.getViewport({ scale: 1, rotation: 0 });
        setNatural({ width: v.width, height: v.height });
      } catch {
        if (!cancelled) setNatural(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !natural || !canvas) return;

    let cancelled = false;
    let task: RenderTask | undefined;
    setRendered(false);

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const deviceViewport = page.getViewport({ scale: scale * dpr, rotation });
        canvas.width = Math.floor(deviceViewport.width);
        canvas.height = Math.floor(deviceViewport.height);
        task = page.render({ canvas, viewport: deviceViewport });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // A failed or cancelled canvas render stays on its placeholder.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, natural, scale, rotation, pdf, pageNumber]);

  // Keep the selectable DOM stable while zoom and rotation redraw the canvas.
  // The builder owns native cross-page selection and the end-of-content marker.
  useEffect(() => {
    const host = textLayerHostRef.current;
    if (!visible || !host) return;

    let cancelled = false;
    let layer: TextLayerBuilder | undefined;
    void (async () => {
      try {
        // The PDF.js display module has already loaded by the time a page mounts.
        const [{ TextLayerBuilder }, page] = await Promise.all([
          import("pdfjs-dist/legacy/web/pdf_viewer.mjs"),
          pdf.getPage(pageNumber),
        ]);
        if (cancelled) return;
        layer = new TextLayerBuilder({ pdfPage: page });
        layer.div.style.setProperty("--user-unit", String(page.userUnit));
        await layer.render({
          viewport: page.getViewport({ scale: 1, rotation: 0 }),
          // Images are optional at runtime. This layer only needs text.
          images: undefined!,
        });
        if (!cancelled) host.append(layer.div);
      } catch {
        // The canvas can still display pages whose text layer fails.
      }
    })();

    return () => {
      cancelled = true;
      layer?.cancel();
      layer?.div.remove();
    };
  }, [visible, pdf, pageNumber]);

  return (
    <div
      ref={wrapperRef}
      data-page-number={pageNumber}
      data-page-measured={natural !== undefined ? "" : undefined}
      data-rotation={rotation}
      className="tme-pdf-page relative shrink-0 overflow-hidden rounded-md bg-white"
      style={{
        "--scale-factor": scale,
        width: viewport ? `${Math.floor(viewport.width)}px` : "min(640px, 100%)",
        height: viewport ? `${Math.floor(viewport.height)}px` : "800px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)",
      } as CSSProperties}
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
      <div ref={textLayerHostRef} />
    </div>
  );
});
