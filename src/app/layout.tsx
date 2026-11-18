import type { Metadata, Viewport } from "next";
import { Lexend } from "next/font/google";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@/styles/app.css";
import { ExplorerProvider } from "@/context/ExplorerContext";
import { ProjectsProvider } from "@/context/ProjectsContext";
import { AppShell } from "@/components/layout/AppShell";
import { demoRepository } from "@/mock/buildDemoRepo";
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

const lexend = Lexend({ subsets: ["latin"], display: "swap", variable: "--cx-font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: understand any codebase`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["code explorer", "codebase analysis", "dependency graph", "architecture diagram", "impact analysis", "static analysis", "AI code assistant"],
  authors: [{ name: "laynierdev", url: "https://github.com/laynierdev" }],
  alternates: { canonical: "./" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: understand any codebase`,
    description: SITE_TAGLINE,
    url: "/",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` }],
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_TAGLINE, images: ["/brand/og-image.png"] },
};

export const viewport: Viewport = { themeColor: "#1f5fd6", width: "device-width", initialScale: 1 };

/** Structured data (schema.org) describing the application, for search engines. Built only from constants defined in code, never from user input. */
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any (web browser)",
  isAccessibleForFree: true,
  license: "https://opensource.org/licenses/MIT",
  codeRepository: REPO_URL,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  image: `${SITE_URL}/brand/og-image.png`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lexend.variable}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
        {/* The demo repository is analyzed on the server (build time), so the TypeScript parser never ships to the client's first load. */}
        <ExplorerProvider demo={demoRepository}>
          <ProjectsProvider>
            <AppShell>{children}</AppShell>
          </ProjectsProvider>
        </ExplorerProvider>
      </body>
    </html>
  );
}
