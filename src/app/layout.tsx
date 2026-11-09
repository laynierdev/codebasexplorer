import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@/styles/app.css";
import { ExplorerProvider } from "@/context/ExplorerContext";
import { ProjectsProvider } from "@/context/ProjectsContext";
import { AppShell } from "@/components/layout/AppShell";
import { demoRepository } from "@/mock/buildDemoRepo";

const lexend = Lexend({ subsets: ["latin"], display: "swap", variable: "--cx-font-sans" });

export const metadata: Metadata = {
  title: { default: "CodebaseXplorer", template: "%s · CodebaseXplorer" },
  description: "Understand any codebase. Navigate with confidence.",
  applicationName: "CodebaseXplorer",
  openGraph: { title: "CodebaseXplorer", description: "Understand any codebase. Navigate with confidence.", images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lexend.variable}>
      <body>
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
