import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@/styles/app.css";
import { ExplorerProvider } from "@/context/ExplorerContext";
import { AppShell } from "@/components/layout/AppShell";

const lexend = Lexend({ subsets: ["latin"], display: "swap", variable: "--cx-font-sans" });

export const metadata: Metadata = {
  title: "CodebaseXplorer",
  description: "Understand any codebase. Navigate with confidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lexend.variable}>
      <body>
        <ExplorerProvider>
          <AppShell>{children}</AppShell>
        </ExplorerProvider>
      </body>
    </html>
  );
}
