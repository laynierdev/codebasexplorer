"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function QuickSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}&mode=text`);
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Quick code search" className="d-flex quick-search">
      <label htmlFor="quick-search" className="visually-hidden">
        Search the repository
      </label>
      <input
        id="quick-search"
        className="form-control form-control-sm"
        placeholder="Search code…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}
