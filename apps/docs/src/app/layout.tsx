import { Footer } from "@vercel/geistdocs/footer";
import { Navbar } from "@vercel/geistdocs/navbar";
import { config } from "@/lib/geistdocs/config";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import type { Metadata, Viewport } from "next";
import { DocsChat, DocsChatProvider } from "@/components/docs-chat";
import { DocsProvider } from "@/components/geistdocs-provider";
import "./globals.css";

export const viewport: Viewport = { viewportFit: "cover" };

export const metadata: Metadata = {
  metadataBase: new URL("https://wterm.dev"),
  title: {
    default: "wterm | Terminal Emulator for the Web",
    template: "%s | wterm",
  },
  description:
    "A terminal emulator for the web. Renders to the DOM, powered by Zig/WASM.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://wterm.dev",
    siteName: "wterm",
    title: "wterm | Terminal Emulator for the Web",
    description:
      "A terminal emulator for the web. Renders to the DOM, powered by Zig/WASM.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "wterm" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "wterm | Terminal Emulator for the Web",
    description:
      "A terminal emulator for the web. Renders to the DOM, powered by Zig/WASM.",
    images: ["/og"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
    >
      <body>
        <DocsProvider>
          <DocsChatProvider>
            <Navbar config={config} />
            {children}
            <Footer />
            <DocsChat />
          </DocsChatProvider>
        </DocsProvider>
      </body>
    </html>
  );
}
