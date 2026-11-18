import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Architecture",
  description: "Interactive architecture graph derived from imports: modules, layers, external systems and drill-down to files.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
