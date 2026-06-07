"use client";

import { useEffect } from "react";
import { Brand } from "@/components/shell/Brand";
import { Button } from "@/components/ui/Button";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error(error);
    }
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-8 py-12">
      <section className="max-w-lg text-center">
        <div className="mb-8 flex justify-center">
          <Brand size="sm" />
        </div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-err">
          Beklenmedik hata
        </p>
        <h1 className="mb-3 font-serif text-[28px] font-normal leading-[1.15] tracking-[-0.015em] text-ink">
          Bir şeyler ters gitti
        </h1>
        <p className="mb-4 text-[14px] text-ink-3">
          Bu işlem sırasında bir hata oluştu. Aşağıdaki detayları geliştirici
          konsolunda görebilirsin.
        </p>
        {error.digest ? (
          <p className="mb-8 font-mono text-[12px] text-ink-4">
            digest: {error.digest}
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-2">
          <Button variant="primary" onClick={() => reset()}>
            Tekrar dene
          </Button>
          <Button onClick={() => window.location.assign("/dashboard")}>
            Dashboard&apos;a dön
          </Button>
        </div>
      </section>
    </main>
  );
}
