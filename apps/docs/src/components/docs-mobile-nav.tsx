"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { navGroups } from "@/lib/docs-navigation";

const allItems = navGroups.flatMap((g) => g.items);

function ExternalIcon() {
  return (
    <svg
      className="ml-1 inline-block h-3 w-3 opacity-50"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 3H9v5.5M9 3L3 9" />
    </svg>
  );
}

export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const currentPage = useMemo(() => {
    return (
      allItems.find((page) => !page.external && page.href === pathname) ??
      allItems[0]
    );
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open table of contents"
        className="lg:hidden sticky top-14 z-40 w-full px-6 py-3 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between focus:outline-none"
      >
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {currentPage.name}
        </div>
        <div className="w-8 h-8 flex items-center justify-center">
          <svg
            className="h-4 w-4 text-neutral-500 dark:text-neutral-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </div>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="overflow-y-auto p-6"
        showCloseButton={false}
      >
        <SheetTitle className="mb-6">Table of Contents</SheetTitle>
        <nav className="space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = !item.external && pathname === item.href;
                  const El = item.external ? "a" : Link;
                  return (
                    <li key={item.href}>
                      <El
                        href={item.href}
                        {...(item.external
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : { onClick: () => setOpen(false) })}
                        className={`text-sm block py-1.5 transition-colors ${
                          active
                            ? "text-neutral-900 dark:text-neutral-100 font-medium"
                            : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                        }`}
                      >
                        {item.name}
                        {item.external && <ExternalIcon />}
                      </El>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
