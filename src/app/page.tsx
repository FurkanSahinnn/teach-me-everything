import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  FileText,
  Headphones,
  Library,
  LockKeyhole,
  Network,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Brand } from "@/components/shell/Brand";
import { FirstRunGate } from "@/components/setup/FirstRunGate";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const WORKFLOW = [
  {
    icon: FileText,
    title: "Kaynaklarını içeri al",
    body: "PDF, makale, not ve web kaynakları tek çalışma alanında toplanır. Her kaynak okuma, soru ve tekrar bağlamını korur.",
  },
  {
    icon: Brain,
    title: "Okurken aktif çalış",
    body: "Metni seç, bağlamlı soru sor, cevabı citation ile geri bağla. Pasif özet yerine hatırlamayı zorlayan akışlar kur.",
  },
  {
    icon: CalendarDays,
    title: "Ritmi koru",
    body: "Flashcard, quiz, araştırma ve çalışma planı aynı workspace içinde birbirini besler.",
  },
];

const CAPABILITIES = [
  ["Reader", "Seçili metin, highlight, citation ve bağlamlı soru"],
  ["Recall", "Flashcard, SM-2 hazırlığı, quiz ve Feynman oturumu"],
  ["Research", "Paper karşılaştırma, DOI/arXiv akışı ve BibTeX hedefi"],
  ["Plan", "Haftalık çalışma ritmi, milestone ve yeniden dengeleme"],
];

const PREVIEW_SOURCES = [
  { title: "Renormalization group notes", meta: "42 highlight · 18 kart", pct: 72 },
  { title: "Attention Is All You Need", meta: "15 sayfa · 6 zayıf konsept", pct: 88 },
  { title: "Molecular Biology chapter 7", meta: "31 highlight · quiz hazır", pct: 54 },
];

const STACK = [
  "Next.js 16",
  "TypeScript",
  "Tailwind v4",
  "Dexie / IndexedDB",
  "BYOK",
  "TR / EN",
];

export default function LandingPage() {
  return (
    <FirstRunGate>
      <LandingContent />
    </FirstRunGate>
  );
}

function LandingContent() {
  return (
    <main className="min-h-[100dvh] overflow-hidden bg-paper text-ink">
      <div className="pointer-events-none fixed inset-0 opacity-[0.035] grain" />

      <nav className="sticky top-0 z-20 border-b border-rule-soft bg-paper/82 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex items-center">
            <Brand size="sm" />
          </Link>
          <div className="hidden items-center gap-6 text-[13px] text-ink-3 md:flex">
            <a href="#workflow" className="transition-colors hover:text-ink">
              Akış
            </a>
            <a href="#reader" className="transition-colors hover:text-ink">
              Reader
            </a>
            <a href="#stack" className="transition-colors hover:text-ink">
              Stack
            </a>
          </div>
          <div className="grow" />
          <Link href="/dashboard" className="hidden sm:block">
            <Button size="sm" variant="ghost">
              Uygulamaya gir
            </Button>
          </Link>
          <Link href="/setup/1">
            <Button size="sm" variant="accent">
              Kuruluma başla
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </Link>
        </div>
      </nav>

      <section className="relative mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1240px] grid-cols-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-16">
        <div className="max-w-[680px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-rule bg-paper-2 px-3 py-1.5 text-[12px] text-ink-3 shadow-[var(--shadow-soft)]">
            <LockKeyhole className="h-3.5 w-3.5 text-accent" aria-hidden />
            Yerel öncelikli · BYOK · açık kaynak
          </div>
          <h1 className="mt-6 text-balance text-[clamp(42px,7vw,82px)] font-semibold leading-[0.98] tracking-[-0.035em] text-ink">
            Akademik çalışmayı tek bir koyu masada topla.
          </h1>
          <p className="mt-6 max-w-[62ch] text-[16px] leading-7 text-ink-2 sm:text-[18px]">
            Teach Me Everything; PDF, makale ve notlarını okuma, soru sorma,
            aktif recall, zihin haritası, araştırma ve çalışma planına bağlayan
            yerel öncelikli bir öğrenme workspace&apos;i.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/setup/1">
              <Button size="lg" variant="accent" className="w-full sm:w-auto">
                Workspace kur
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" className="w-full sm:w-auto">
                Demo dashboard
              </Button>
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-3 border-t border-rule-soft pt-5 text-[12px] text-ink-3 sm:max-w-[520px]">
            <Stat value="12" label="öğrenme ekranı" />
            <Stat value="3" label="tema modu" />
            <Stat value="%100" label="local-first hedef" />
          </div>
        </div>

        <ProductPreview />
      </section>

      <section id="workflow" className="border-t border-rule-soft px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1240px]">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="eyebrow">Çalışma döngüsü</p>
              <h2 className="mt-3 max-w-[14ch] text-[34px] font-semibold leading-tight tracking-[-0.025em] sm:text-[44px]">
                Okuma ile hatırlama aynı yerde.
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {WORKFLOW.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-5 shadow-[var(--shadow-soft)]"
                >
                  <item.icon className="h-5 w-5 text-accent" aria-hidden />
                  <h3 className="mt-5 text-[16px] font-semibold text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-6 text-ink-3">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="reader" className="border-t border-rule-soft px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <ReaderPanel />
          <div className="self-center">
            <p className="eyebrow">Reader + recall</p>
            <h2 className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.025em] sm:text-[44px]">
              Sepia okuma modu, koyu çalışma masasına bağlı.
            </h2>
            <p className="mt-5 max-w-[58ch] text-[15px] leading-7 text-ink-2">
              Reader ekranı kaynak metni, seçili bağlamı ve AI yanıtını ayrı
              dünyalar gibi değil, aynı akademik not defterinin parçaları gibi
              işler. Dashboard koyu ve net kalırken uzun okuma için sepia mod
              güçlü bir ikinci ritim sağlar.
            </p>
            <div className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CAPABILITIES.map(([title, body]) => (
                <div key={title} className="border-t border-rule-soft py-3">
                  <div className="text-[13px] font-semibold text-ink">{title}</div>
                  <div className="mt-1 text-[12.5px] leading-5 text-ink-3">
                    {body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="stack" className="border-t border-rule-soft px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Teknik zemin</p>
            <h2 className="mt-3 max-w-[18ch] text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[40px]">
              Açık, yerel, özelleştirilebilir.
            </h2>
          </div>
          <div className="flex max-w-[720px] flex-wrap gap-2">
            {STACK.map((item) => (
              <span
                key={item}
                className="rounded-[10px] border border-rule bg-paper-2 px-3 py-2 font-mono text-[12px] text-ink-2"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-rule-soft px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Brand size="sm" />
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              MIT · 2026
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/dashboard" className="transition-colors hover:text-ink">
              Dashboard
            </Link>
            <Link href="/settings" className="transition-colors hover:text-ink">
              Settings
            </Link>
            <Link href="/setup/1" className="transition-colors hover:text-ink">
              Setup
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-[16px] font-semibold text-ink">{value}</div>
      <div className="mt-1 leading-5">{label}</div>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[32px] bg-accent-wash/45 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-[24px] border border-rule bg-paper-2 shadow-[var(--shadow-deep)]">
        <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-accent" aria-hidden />
            <span className="text-[13px] font-medium">QFT workspace</span>
          </div>
          <span className="rounded-full border border-rule bg-paper px-2.5 py-1 font-mono text-[11px] text-ink-3">
            bugün · 4 oturum
          </span>
        </div>
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="border-b border-rule-soft p-4 lg:border-b-0 lg:border-r">
            <div className="rounded-[18px] border border-rule bg-paper p-4">
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <BookOpen className="h-4 w-4 text-accent" aria-hidden />
                Reader focus
              </div>
              <h3 className="mt-4 font-serif text-[24px] leading-tight text-ink">
                §4.2 Renormalizasyon grubu
              </h3>
              <p className="mt-4 font-serif text-[15px] leading-7 text-ink-2">
                Wilsonian çerçevede,
                <mark className="mx-1 rounded bg-accent-wash px-1 text-accent-ink">
                  yüksek enerji modlarının entegre edilmesi
                </mark>
                çıplak bağlaşımlar üzerinde bir akış indükler.
              </p>
              <div className="mt-5 rounded-[14px] border border-accent-soft bg-accent-wash p-3 text-[12.5px] leading-5 text-accent-ink">
                &ldquo;Yüksek enerji modları&rdquo; seçili bağlamdan soruldu.
              </div>
            </div>
          </div>
          <div className="p-4">
            <div className="grid gap-3">
              <MiniMetric icon={Brain} label="Review queue" value="28 kart" />
              <MiniMetric icon={Search} label="Research" value="6 paper" />
              <MiniMetric icon={Network} label="Mind map" value="42 node" />
              <MiniMetric icon={Headphones} label="Podcast" value="18 dk" />
            </div>
            <div className="mt-4 rounded-[18px] border border-rule bg-paper p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold">Recent sources</span>
                <Sparkles className="h-4 w-4 text-accent" aria-hidden />
              </div>
              <div className="space-y-3">
                {PREVIEW_SOURCES.map((source) => (
                  <div key={source.title}>
                    <div className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="truncate font-medium text-ink">
                        {source.title}
                      </span>
                      <span className="font-mono text-ink-4">%{source.pct}</span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-ink-4">{source.meta}</div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-3">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${source.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-[14px] border border-rule bg-paper px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <Icon className="h-4 w-4 text-accent" aria-hidden />
        {label}
      </div>
      <span className="font-mono text-[12px] text-ink">{value}</span>
    </div>
  );
}

function ReaderPanel() {
  return (
    <div className="rounded-[24px] border border-rule bg-paper-2 p-3 shadow-[var(--shadow-medium)]">
      <div
        className={cn(
          "rounded-[18px] border border-[#C9B68F] bg-[#F6EAD2] p-5 text-[#2E1F0E]",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
        )}
      >
        <div className="flex items-center justify-between border-b border-[#D6C4A0] pb-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6B4F30]">
            Sepia reader
          </div>
          <div className="font-mono text-[11px] text-[#8E7651]">§4.2</div>
        </div>
        <div className="grid grid-cols-1 gap-5 pt-5 md:grid-cols-[1fr_240px]">
          <article className="font-serif">
            <h3 className="text-[27px] font-semibold leading-tight">
              Bağlamdan kopmadan soru sor.
            </h3>
            <p className="mt-4 text-[16px] leading-8 text-[#4A331A]">
              Bir kavramı seçtiğinde soru yalnızca kelimeyi değil, kaynak,
              bölüm ve çevresindeki argümanı da taşır. Cevap okuduğun metnin
              içine geri bağlanır.
            </p>
            <blockquote className="mt-5 border-l-2 border-[#B86A2B] pl-4 text-[15px] italic leading-7 text-[#5C2E08]">
              &ldquo;Sabit noktalar faz geçişlerine karşılık gelir ve evrensellik
              sınıflarını belirler.&rdquo;
            </blockquote>
          </article>
          <aside className="rounded-[14px] border border-[#D6C4A0] bg-[#EFDFC0] p-3">
            <div className="text-[12px] font-semibold">AI notu</div>
            <p className="mt-2 text-[12.5px] leading-5 text-[#6B4F30]">
              Bu kavram için 3 flashcard ve 1 açık uçlu quiz önerildi.
            </p>
            <div className="mt-4 grid gap-2">
              <div className="rounded-[10px] bg-[#F6EAD2] px-3 py-2 text-[12px]">
                Flashcard&apos;a dönüştür
              </div>
              <div className="rounded-[10px] bg-[#F6EAD2] px-3 py-2 text-[12px]">
                Citation&apos;ı aç
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
