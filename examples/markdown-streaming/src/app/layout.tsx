import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "wterm — Markdown Streaming Example",
  description: "Stream LLM output into a terminal with @wterm/markdown",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          height: "100vh",
          background: "#1a1a2e",
        }}
      >
        {children}
      </body>
    </html>
  );
}
