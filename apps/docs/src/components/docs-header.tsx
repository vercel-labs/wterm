"use client";

import { LogoIconVercel } from "@vercel/geistdocs/assets/logos/logo-icon-vercel";
import { Button } from "@vercel/geistdocs/components/button";
import { ThemeSwitcher } from "@vercel/geistdocs/components/theme-switcher";
import { SearchButton } from "@vercel/geistdocs/controls";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DocsChatTrigger } from "@/components/docs-chat";
import { config } from "@/lib/geistdocs/config";

const links = (config.nav ?? []).filter((item) => "href" in item);
const github = "https://github.com/vercel-labs/wterm";

export function DocsHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width >= 1024) setMenuOpen(false);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node))
        setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      ref={headerRef}
      className="wterm-header sticky top-0 z-40 bg-background-200 shadow-[0_1px_0_0_var(--ds-gray-alpha-400)]"
      data-wterm-header
    >
      <div className="mx-auto flex h-16 max-w-[1448px] items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-6">
          <div className="flex shrink-0 items-center gap-3">
            <a
              href="https://vercel.com/oss"
              aria-label="Vercel Open Source"
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
            >
              <LogoIconVercel size={22} />
            </a>
            <span aria-hidden="true" className="text-2xl text-gray-700">
              /
            </span>
            <Link href="/" className="text-lg font-medium text-gray-1000">
              wterm
            </Link>
          </div>
          <nav
            aria-label="Primary navigation"
            className="wterm-header-desktop items-center gap-5"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="text-sm text-gray-900 hover:text-gray-1000"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-header-actions>
          <div className="wterm-header-desktop">
            <SearchButton className="w-[150px]" />
          </div>
          <DocsChatTrigger />
          <div className="wterm-header-desktop">
            <Button asChild variant="ghost" size="icon-sm">
              <a
                href={github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub repository"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
            </Button>
          </div>
          <div className="wterm-header-mobile">
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              ref={menuTriggerRef}
              onClick={() => setMenuOpen((previous) => !previous)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="wterm-header-menu"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M4 8h16M4 16h16" />
              </svg>
            </Button>
            <div
              id="wterm-header-menu"
              hidden={!menuOpen}
              className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-b border-gray-alpha-400 bg-background-200 shadow-lg"
            >
              <div className="flex flex-col gap-6 p-6">
                <div data-header-menu-search>
                  <SearchButton
                    className="min-h-11 w-full"
                    onClick={() => setMenuOpen(false)}
                  />
                </div>
                <nav
                  aria-label="Mobile primary navigation"
                  className="flex flex-col gap-4"
                >
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="text-gray-1000"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <a
                    href={github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-1000"
                  >
                    GitHub
                  </a>
                </nav>
                <ThemeSwitcher />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
