import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-8 py-12">
      <section className="max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Brand size="sm" />
        </div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          404
        </p>
        <h1 className="mb-3 font-serif text-[32px] font-normal leading-[1.1] tracking-[-0.015em] text-ink">
          Sayfa bulunamadı
        </h1>
        <p className="mb-8 text-[14px] text-ink-3">
          Aradığın sayfa ya taşındı ya da hiç var olmadı. Biz bu ikincisine
          bahse girerdik.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link href="/dashboard">
            <Button variant="primary">Dashboard&apos;a dön</Button>
          </Link>
          <Link href="/">
            <Button>Ana sayfa</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
