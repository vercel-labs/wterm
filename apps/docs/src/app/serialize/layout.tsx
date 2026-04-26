import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("serialize");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
