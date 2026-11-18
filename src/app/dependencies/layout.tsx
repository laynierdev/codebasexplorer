import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dependencies",
  description: "Explore file, module and package dependencies and detect circular dependencies in a codebase.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
