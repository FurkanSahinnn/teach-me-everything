"use client";

import {
  Brain,
  ChevronDown,
  Compass,
  Lightbulb,
  ScrollText,
  ShieldQuestion,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import {
  CitationChip,
  type CitationTone,
} from "@/components/notebook/CitationChip";
import { useLocalePick } from "@/i18n/IntlProvider";
import { scoreGrounding } from "@/lib/article-analysis/citation-verify";
import type {
  AnalysisCitation,
  AnalysisClaim,
  ArticleAnalysisPayload,
  ArticleAnalysisRecord,
  CitationVerification,
} from "@/lib/article-analysis/types";
import { cn } from "@/lib/utils/cn";

type Props = {
  analysis: ArticleAnalysisRecord;
};

type PickFn = (tr: string, en: string) => string;

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card variant="default" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex items-center gap-2 font-serif text-[16px] font-medium text-ink">
          <span className="text-ink-3 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
            {icon}
          </span>
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-3 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-5 border-t border-rule-soft px-4 py-4">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

function FieldBlock({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="text-[11px] font-mono uppercase tracking-[0.06em] text-ink-4">
          {label}
        </h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

// Inline "model judgment" affordance, mirroring the fiveCs "· model" tag, for
// whole sections that are the model's assessment rather than paper-cited fact.
function ModelTag({ pick }: { pick: PickFn }) {
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-[0.04em] text-accent-ink"
      title={pick(
        "Model değerlendirmesi (kaynak doğrulaması değil).",
        "Model assessment (not a source-verified fact).",
      )}
    >
      · {pick("model", "model")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Grounding-aware claim rendering
// ---------------------------------------------------------------------------

function GeneralBadge({ pick }: { pick: PickFn }) {
  return (
    <Chip
      variant="muted"
      size="sm"
      className="gap-1 border-dashed text-[10px] uppercase tracking-[0.04em]"
      title={pick(
        "Bu ifade kaynakta değil; modelin genel bilgisinden geliyor.",
        "Not in the paper — drawn from the model's general knowledge.",
      )}
    >
      <Brain className="h-2.5 w-2.5" aria-hidden />
      {pick("model bilgisi", "general knowledge")}
    </Chip>
  );
}

// Legacy analyses (generated before quote verification existed) carry no
// verdict; fall back to chunkId presence so they don't all read as fabricated.
function verdictOf(c: AnalysisCitation): CitationVerification {
  return c.verification ?? (c.chunkId ? "exact" : "unverified");
}

const VERDICT_TONE: Record<CitationVerification, CitationTone> = {
  exact: "default",
  fuzzy: "approx",
  unverified: "unverified",
};

function verdictTitle(v: CitationVerification, pick: PickFn): string {
  switch (v) {
    case "exact":
      return pick(
        "Bu alıntı makalede birebir bulundu. Pasaja gitmek için tıkla.",
        "Found verbatim in the paper. Click to jump to the passage.",
      );
    case "fuzzy":
      return pick(
        "Yaklaşık eşleşme — modelin alıntısı makaledeki metinden biraz farklı. Pasaja gitmek için tıkla.",
        "Approximate match — the model's quote differs slightly from the paper. Click to jump to the passage.",
      );
    case "unverified":
      return pick(
        "Bu alıntı makalede bulunamadı. Kaynak metni olarak değil, model ifadesi olarak değerlendir.",
        "This quote could not be found in the paper. Treat it as model prose, not source text.",
      );
  }
}

function CitationChips({
  citations,
  pick,
  onJump,
}: {
  citations: AnalysisCitation[];
  pick: PickFn;
  onJump: (chunkId: string) => void;
}) {
  return (
    <>
      {citations.map((c, i) => {
        const verdict = verdictOf(c);
        const active = Boolean(c.chunkId) && verdict !== "unverified";
        const display =
          c.quote.length > 56 ? `${c.quote.slice(0, 56)}…` : c.quote;
        return (
          <span key={i} title={verdictTitle(verdict, pick)}>
            <CitationChip
              ref={display}
              active={active}
              tone={VERDICT_TONE[verdict]}
              onActivate={() => {
                if (c.chunkId) onJump(c.chunkId);
              }}
            />
          </span>
        );
      })}
    </>
  );
}

// A source-tagged claim that cites nothing at all promises paper backing and
// delivers none — the same failure as an unverifiable quote, so it gets the
// same visible caution rather than rendering as a bare bullet.
function UncitedBadge({ pick }: { pick: PickFn }) {
  return (
    <Chip
      variant="muted"
      size="sm"
      className="gap-1 border-dashed border-warn/40 bg-warn/10 text-[10px] uppercase tracking-[0.04em] text-warn"
      title={pick(
        "Kaynağa dayandığı belirtildi ama alıntı verilmedi.",
        "Tagged as source-grounded but carries no quote.",
      )}
    >
      <ShieldQuestion className="h-2.5 w-2.5" aria-hidden />
      {pick("alıntısız", "uncited")}
    </Chip>
  );
}

function ClaimList({
  claims,
  pick,
  onJump,
}: {
  claims: AnalysisClaim[];
  pick: PickFn;
  onJump: (chunkId: string) => void;
}) {
  if (claims.length === 0) {
    return (
      <p className="text-[12px] italic text-ink-4">
        {pick("(boş)", "(empty)")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {claims.map((claim, i) => (
        <li key={i} className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <span
              className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-4"
              aria-hidden
            />
            <p className="text-[13px] leading-relaxed text-ink-2">
              {claim.text}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-3">
            {claim.grounding === "general" ? <GeneralBadge pick={pick} /> : null}
            {claim.grounding === "source" ? (
              claim.citations && claim.citations.length > 0 ? (
                <CitationChips
                  citations={claim.citations}
                  pick={pick}
                  onJump={onJump}
                />
              ) : (
                <UncitedBadge pick={pick} />
              )
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Layer 1 — Orientation
// ---------------------------------------------------------------------------

function OrientationLayer({
  payload,
  pick,
}: {
  payload: ArticleAnalysisPayload;
  pick: PickFn;
}) {
  const { ataGlance: g, fiveCs } = payload;
  const rows: { label: string; value?: string | undefined }[] = [
    { label: pick("Tür", "Type"), value: g.paperType },
    { label: pick("Alan", "Field"), value: g.field },
    { label: pick("Alt alan", "Subfield"), value: g.subfield },
    { label: pick("Yazarlar", "Authors"), value: g.authors },
    { label: pick("Yer/Yıl", "Venue/Year"), value: g.venueYear },
    { label: pick("Amaç", "Purpose"), value: g.purpose },
    { label: pick("Yöntem türü", "Methodology"), value: g.methodologyType },
    { label: pick("Veri/Örneklem", "Data/Sample"), value: g.dataSample },
    { label: pick("Ana bulgu", "Headline finding"), value: g.headlineFinding },
    { label: pick("Olgunluk", "Maturity"), value: g.maturity },
  ];
  const cs: { label: string; value: string; model?: boolean }[] = [
    { label: pick("Kategori", "Category"), value: fiveCs.category },
    { label: pick("Bağlam", "Context"), value: fiveCs.context },
    { label: pick("Doğruluk", "Correctness"), value: fiveCs.correctness, model: true },
    { label: pick("Katkılar", "Contributions"), value: fiveCs.contributions },
    { label: pick("Anlaşılırlık", "Clarity"), value: fiveCs.clarity, model: true },
  ];
  return (
    <>
      {payload.tldr ? (
        <FieldBlock label={pick("Özet (TL;DR)", "TL;DR")}>
          <p className="text-[13.5px] leading-relaxed text-ink">
            {payload.tldr}
          </p>
        </FieldBlock>
      ) : null}
      <FieldBlock label={pick("Bir bakışta", "At a glance")}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {rows
            .filter((r) => r.value && r.value.trim().length > 0)
            .map((r) => (
              <div key={r.label} className="flex gap-2 text-[12.5px]">
                <span className="shrink-0 font-medium text-ink-3">
                  {r.label}:
                </span>
                <span className="text-ink-2">{r.value}</span>
              </div>
            ))}
        </div>
      </FieldBlock>
      <FieldBlock label={pick("5 C", "5 C's")}>
        <div className="flex flex-col gap-2">
          {cs
            .filter((c) => c.value && c.value.trim().length > 0)
            .map((c) => (
              <div
                key={c.label}
                className="rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.04em] text-ink-4">
                  {c.label}
                  {c.model ? (
                    <span
                      className="text-accent-ink"
                      title={pick(
                        "Model değerlendirmesi (kaynak doğrulaması değil).",
                        "Model assessment (not a source-verified fact).",
                      )}
                    >
                      ·{pick(" model", " model")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
                  {c.value}
                </p>
              </div>
            ))}
        </div>
      </FieldBlock>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layer 2 — Understanding
// ---------------------------------------------------------------------------

function UnderstandingLayer({
  payload,
  pick,
  onJump,
}: {
  payload: ArticleAnalysisPayload;
  pick: PickFn;
  onJump: (chunkId: string) => void;
}) {
  return (
    <>
      {payload.keyIdea ? (
        <FieldBlock label={pick("Anahtar fikir", "Key idea")}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {payload.keyIdea}
          </p>
        </FieldBlock>
      ) : null}
      <FieldBlock label={pick("Problem & motivasyon", "Problem & motivation")}>
        <ClaimList claims={payload.problemMotivation} pick={pick} onJump={onJump} />
      </FieldBlock>
      <FieldBlock label={pick("Önceki iş & boşluk", "Prior work & gap")}>
        <ClaimList claims={payload.priorWorkGap} pick={pick} onJump={onJump} />
      </FieldBlock>
      <FieldBlock label={pick("Katkılar", "Contributions")}>
        <ClaimList claims={payload.contributions} pick={pick} onJump={onJump} />
      </FieldBlock>
      {payload.methodWalkthrough.length > 0 ? (
        <FieldBlock label={pick("Yöntem adım adım", "Method walkthrough")}>
          <ol className="flex flex-col gap-3">
            {payload.methodWalkthrough.map((m, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper-3 font-mono text-[11px] text-ink-3">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    {m.step}
                  </p>
                  {m.why ? (
                    <p className="text-[12px] italic leading-relaxed text-ink-4">
                      {pick("Neden: ", "Why: ")}
                      {m.why}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </FieldBlock>
      ) : null}
      <FieldBlock label={pick("Nasıl çözüyor", "How it solves")}>
        <ClaimList claims={payload.howItSolves} pick={pick} onJump={onJump} />
      </FieldBlock>
      <FieldBlock label={pick("Ana sonuçlar", "Key results")}>
        <ClaimList claims={payload.keyResults} pick={pick} onJump={onJump} />
      </FieldBlock>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layer 3 — Critique
// ---------------------------------------------------------------------------

function CritiqueLayer({
  payload,
  pick,
  onJump,
}: {
  payload: ArticleAnalysisPayload;
  pick: PickFn;
  onJump: (chunkId: string) => void;
}) {
  const c = payload.critique;
  const axes: { label: string; value: string }[] = [
    { label: pick("Sağlamlık", "Soundness"), value: c.soundness },
    { label: pick("Özgünlük", "Novelty"), value: c.novelty },
    { label: pick("Önem", "Significance"), value: c.significance },
    { label: pick("Anlaşılırlık", "Clarity"), value: c.clarity },
  ];
  return (
    <>
      <FieldBlock
        label={pick("Hakem değerlendirmesi", "Reviewer assessment")}
        aside={<ModelTag pick={pick} />}
      >
        <div className="flex flex-col gap-2">
          {axes
            .filter((a) => a.value && a.value.trim().length > 0)
            .map((a) => (
              <div key={a.label} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-mono uppercase tracking-[0.04em] text-ink-4">
                  {a.label}
                </span>
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  {a.value}
                </p>
              </div>
            ))}
        </div>
      </FieldBlock>
      {c.weakestLink ? (
        <div className="rounded-[10px] border border-warn/30 bg-warn/10 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.06em] text-warn">
            <ShieldQuestion className="h-3 w-3" aria-hidden />
            {pick("En zayıf halka", "Weakest link")}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            {c.weakestLink}
          </p>
        </div>
      ) : null}
      <FieldBlock
        label={pick("Varsayımlar & sınırlamalar", "Assumptions & limitations")}
      >
        <ClaimList
          claims={payload.assumptionsLimitations}
          pick={pick}
          onJump={onJump}
        />
      </FieldBlock>
      {payload.reproducibility ? (
        <FieldBlock label={pick("Tekrarlanabilirlik", "Reproducibility")}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {payload.reproducibility}
          </p>
        </FieldBlock>
      ) : null}
      {payload.soWhat ? (
        <FieldBlock label={pick("Ne anlama geliyor", "So what")}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {payload.soWhat}
          </p>
        </FieldBlock>
      ) : null}
      {payload.questionsToAsk.length > 0 ? (
        <FieldBlock
          label={pick("Sorulacak sorular", "Questions to ask")}
          aside={<GeneralBadge pick={pick} />}
        >
          <ul className="flex flex-col gap-1.5">
            {payload.questionsToAsk.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-4"
                  aria-hidden
                />
                <p className="text-[13px] leading-relaxed text-ink-2">{q}</p>
              </li>
            ))}
          </ul>
        </FieldBlock>
      ) : null}
      {payload.whatToReadNext.length > 0 ? (
        <FieldBlock
          label={pick("Sırada ne okumalı", "What to read next")}
          aside={<GeneralBadge pick={pick} />}
        >
          <ul className="flex flex-col gap-2">
            {payload.whatToReadNext.map((r, i) => (
              <li
                key={i}
                className="rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2"
              >
                <p className="text-[12.5px] font-medium text-ink">{r.title}</p>
                {r.why ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-4">
                    {r.why}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </FieldBlock>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

function GlossaryTable({
  payload,
  pick,
}: {
  payload: ArticleAnalysisPayload;
  pick: PickFn;
}) {
  if (payload.glossary.length === 0) {
    return (
      <p className="text-[12px] italic text-ink-4">
        {pick("(sözlük boş)", "(glossary empty)")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-rule-soft text-left text-[11px] font-mono uppercase tracking-[0.04em] text-ink-4">
            <th className="py-1.5 pr-3 font-medium">{pick("Terim", "Term")}</th>
            <th className="py-1.5 pr-3 font-medium">TR</th>
            <th className="py-1.5 font-medium">EN</th>
          </tr>
        </thead>
        <tbody>
          {payload.glossary.map((t, i) => (
            <tr key={i} className="border-b border-rule-soft/60 align-top">
              <td className="py-2 pr-3 font-medium text-ink">
                {t.term}
                {t.symbol ? (
                  <span className="ml-1 font-mono text-[11px] text-ink-4">
                    {t.symbol}
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3 leading-relaxed text-ink-2">{t.tr}</td>
              <td className="py-2 leading-relaxed text-ink-2">{t.en}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grounding score — how much of this analysis is actually backed by the paper
// ---------------------------------------------------------------------------

// Every claim array that carries grounding tags. Keep in sync with the payload
// shape; `methodWalkthrough` is excluded (MethodStep has no grounding field).
function groundedClaimLists(p: ArticleAnalysisPayload): AnalysisClaim[][] {
  return [
    p.problemMotivation,
    p.priorWorkGap,
    p.contributions,
    p.howItSolves,
    p.keyResults,
    p.assumptionsLimitations,
  ];
}

function GroundingSummary({
  payload,
  pick,
}: {
  payload: ArticleAnalysisPayload;
  pick: PickFn;
}) {
  const score = useMemo(
    () => scoreGrounding(groundedClaimLists(payload)),
    [payload],
  );
  if (score.sourceClaims === 0) return null;

  const pct = Math.round((score.verifiedClaims / score.sourceClaims) * 100);
  // Three bands: mostly-verified reads as ok, a partially-verified analysis as
  // a caution, and a mostly-unverifiable one as an error the reader must know
  // about before trusting a single quote on the page.
  const tone =
    pct >= 80
      ? { border: "border-ok/30", bg: "bg-ok/10", text: "text-ok" }
      : pct >= 50
        ? { border: "border-warn/30", bg: "bg-warn/10", text: "text-warn" }
        : { border: "border-err/30", bg: "bg-err/10", text: "text-err" };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border px-3 py-2 text-[12px]",
        tone.border,
        tone.bg,
      )}
    >
      <span className={cn("font-medium", tone.text)}>
        {pick(
          `Kaynak doğrulaması: ${score.verifiedClaims}/${score.sourceClaims} ifade (%${pct})`,
          `Source-verified: ${score.verifiedClaims}/${score.sourceClaims} claims (${pct}%)`,
        )}
      </span>
      <span className="font-mono text-[11px] text-ink-4">
        {pick(
          `${score.exact} birebir · ${score.fuzzy} yaklaşık · ${score.unverified} bulunamadı`,
          `${score.exact} exact · ${score.fuzzy} approx · ${score.unverified} not found`,
        )}
      </span>
      <span className="w-full text-[11.5px] leading-relaxed text-ink-4">
        {pick(
          "Her alıntı makale metnine karşı denetlendi. Bulunamayan alıntılar modelin ifadesidir, makalenin değil.",
          "Every quote was checked against the paper's text. Quotes marked not found are the model's wording, not the paper's.",
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function AnalysisDetailView({ analysis }: Props) {
  const pick = useLocalePick();
  const router = useRouter();
  const payload = analysis.payload;

  // Source citations deep-link to the exact chunk in the reader, which scrolls
  // it into view and pulses it (`?chunk=`). A chip that promised a jump and
  // landed on page 1 made the grounding feel decorative.
  const onJump = (chunkId: string): void => {
    router.push(
      `/w/${analysis.workspaceId}/read/${analysis.sourceId}?chunk=${encodeURIComponent(chunkId)}`,
    );
  };

  if (!payload) {
    return (
      <p className="text-[13px] text-ink-3">
        {pick("Bu analizde henüz içerik yok.", "This analysis has no content yet.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {analysis.status === "draft" && analysis.fallbackReason ? (
        <div className="rounded-[10px] border border-warn/30 bg-warn/10 px-3 py-2.5 text-[12.5px] text-ink-2">
          <span className="font-medium text-warn">
            {pick("Kısmi sonuç", "Partial result")}
          </span>{" "}
          {pick(
            "Bazı aşamalar tamamlanamadı; aşağıdaki içerik eksik olabilir.",
            "Some stages didn't complete; the content below may be incomplete.",
          )}
          <span className="mt-0.5 block font-mono text-[11px] text-ink-4">
            {analysis.fallbackReason}
          </span>
        </div>
      ) : null}

      <GroundingSummary payload={payload} pick={pick} />

      <Section
        title={pick("1 · Yönlendirme", "1 · Orientation")}
        icon={<Compass />}
        defaultOpen
      >
        <OrientationLayer payload={payload} pick={pick} />
      </Section>

      <Section
        title={pick("2 · Anlama", "2 · Understanding")}
        icon={<Lightbulb />}
        defaultOpen={false}
      >
        <UnderstandingLayer payload={payload} pick={pick} onJump={onJump} />
      </Section>

      <Section
        title={pick("3 · Eleştiri", "3 · Critique")}
        icon={<ShieldQuestion />}
        defaultOpen={false}
      >
        <CritiqueLayer payload={payload} pick={pick} onJump={onJump} />
      </Section>

      <Section
        title={pick("Terim sözlüğü", "Glossary")}
        icon={<ScrollText />}
        defaultOpen
      >
        <GlossaryTable payload={payload} pick={pick} />
      </Section>
    </div>
  );
}
