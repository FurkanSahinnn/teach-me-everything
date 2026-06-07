"use client";

import { NextIntlClientProvider } from "next-intl";
import { type ReactNode } from "react";
import { getMessages } from "@/i18n/messages";
import { usePrefs } from "@/stores/prefs";

export function IntlProvider({ children }: { children: ReactNode }) {
  const locale = usePrefs((s) => s.locale);
  const messages = getMessages(locale);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Istanbul"
    >
      {children}
    </NextIntlClientProvider>
  );
}

export function useLocalePick(): (tr: string, en: string) => string {
  const locale = usePrefs((s) => s.locale);
  return (tr, en) => (locale === "en" ? en : tr);
}
