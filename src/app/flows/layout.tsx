import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Execution flows",
  description: "Follow how a request travels through the code: call chains from each endpoint, every step linked to source and labelled verified or inferred.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
