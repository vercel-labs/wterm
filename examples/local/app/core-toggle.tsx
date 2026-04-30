"use client";

import { usePathname, useRouter } from "next/navigation";

export function CoreToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname === "/ghostty" ? "ghostty" : "builtin";

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-white/3 px-4 py-2">
      <span className="text-xs tracking-wide text-white/40">Core</span>
      <div className="flex overflow-hidden rounded-md border border-white/10">
        <button
          onClick={() => router.push("/")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            active === "builtin"
              ? "bg-white/10 text-white"
              : "text-white/40 hover:bg-white/5"
          }`}
        >
          Built-in
        </button>
        <button
          onClick={() => router.push("/ghostty")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            active === "ghostty"
              ? "bg-white/10 text-white"
              : "text-white/40 hover:bg-white/5"
          }`}
        >
          Ghostty
        </button>
      </div>
    </div>
  );
}
