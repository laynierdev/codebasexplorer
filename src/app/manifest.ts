import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodebaseXplorer",
    short_name: "CodebaseXplorer",
    description: "Understand any codebase. Navigate with confidence.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8fa",
    theme_color: "#1f5fd6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
