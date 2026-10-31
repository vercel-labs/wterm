import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";
import { pageMetadata } from "@/lib/page-metadata";

const docsPage = createDocsPage({
  config,
  source: geistdocsSource,
  metadata: ({ metadata, page }) => {
    const slug = page.slugs.join("/");
    return {
      ...metadata,
      ...pageMetadata(slug),
      ...(slug
        ? {}
        : { title: { absolute: "wterm | Terminal Emulator for the Web" } }),
    };
  },
  tableOfContentPopover: { enabled: false },
  renderTop: ({ data }) => <MobileDocsBar toc={data.toc} />,
});

export default docsPage.Page;
export const generateMetadata = docsPage.generateMetadata;
export const generateStaticParams = docsPage.generateStaticParams;
