import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { IntlProvider } from "@/i18n/IntlProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { VaultSetupBoot } from "@/components/vault/VaultSetupBoot";
import { TrayMount } from "@/components/tray/TrayMount";
import { DeepLinkMount } from "@/components/tray/DeepLinkMount";
import { MenuMount } from "@/components/tray/MenuMount";
import { EventBridgeMount } from "@/components/tray/EventBridgeMount";
import { UpdateCheckMount } from "@/components/shell/UpdateCheckMount";
import { themeInitScript } from "@/lib/utils/theme-script";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Teach Me Everything",
    template: "%s · Teach Me Everything",
  },
  description:
    "Açık kaynak, yerel-öncelikli çalışma alanı. Kendi PDF'lerinle, makalelerinle ve notlarınla aktif öğrenmeye odaklı.",
  applicationName: "Teach Me Everything",
  authors: [{ name: "TME contributors" }],
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0E10" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${sourceSerif.variable} ${geist.variable} ${jetBrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-paper text-ink">
        <IntlProvider>
          <ToastProvider>
            {children}
            <VaultSetupBoot />
            <TrayMount />
            <DeepLinkMount />
            <MenuMount />
            <EventBridgeMount />
            <UpdateCheckMount />
          </ToastProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
