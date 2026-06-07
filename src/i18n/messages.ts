import en from "../../messages/en.json";
import tr from "../../messages/tr.json";
import type { Locale } from "@/stores/prefs";

export type Messages = typeof en;

const MAP: Record<Locale, Messages> = { tr, en };

export function getMessages(locale: Locale): Messages {
  return MAP[locale] ?? MAP.tr;
}
