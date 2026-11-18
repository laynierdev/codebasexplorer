import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Impact analysis",
  description: "See what could break when you change a file: confirmed dependents, tests and endpoints, clearly separated from inferred risks.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
