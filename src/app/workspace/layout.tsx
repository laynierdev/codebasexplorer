import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Browse a repository's file tree, read syntax-highlighted source with line numbers and ask the AI assistant questions that cite exact lines.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
