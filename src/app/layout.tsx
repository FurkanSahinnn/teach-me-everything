import type { Metadata } from "next";
import { IntlProvider } from "@/i18n/IntlProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { VaultSetupBoot } from "@/components/vault/VaultSetupBoot";
import { TrayMount } from "@/components/mounts/TrayMount";
import { DeepLinkMount } from "@/components/mounts/DeepLinkMount";
import { MenuMount } from "@/components/mounts/MenuMount";
import { EventBridgeMount } from "@/components/mounts/EventBridgeMount";
import { UpdateCheckMount } from "@/components/mounts/UpdateCheckMount";
import { themeInitScript } from "@/lib/utils/theme-script";
import "./globals.css";

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
      className="h-full antialiased"
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
