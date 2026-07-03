"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is only known after mount (it depends on localStorage /
  // system preference), so EVERYTHING that renders into the DOM -- the icon
  // and the aria-label -- must be theme-independent until mounted. Otherwise
  // the server render (theme unknown) and the hydrated client render (theme
  // from localStorage) disagree and React reports a hydration mismatch.
  // suppressHydrationWarning on <html> only covers <html> itself, not this
  // button. (onClick is fine: event handlers aren't part of the HTML.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {!mounted ? (
        <SunIcon className="size-4 opacity-0" />
      ) : isDark ? (
        <SunIcon className="size-4" />
      ) : (
        <MoonIcon className="size-4" />
      )}
    </Button>
  );
}
