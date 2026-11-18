import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Generate grounded developer documentation (overview, architecture, API, flows, onboarding) from a repository and export it as Markdown.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
