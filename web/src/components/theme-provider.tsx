"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Thin client wrapper so the (server) root layout can mount next-themes.
// next-themes flips the `.dark` class on <html>, which is what globals.css's
// `@custom-variant dark` and `.dark { ... }` variable block key off of.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
