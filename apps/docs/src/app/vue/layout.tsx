import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("vue");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
