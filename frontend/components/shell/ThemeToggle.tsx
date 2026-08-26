"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * Flips light <-> dark. There's no "system" entry by design: the app still
 * starts on the OS preference (defaultTheme="system"), and the first click
 * pins an explicit choice from wherever that landed.
 *
 * Which icon shows is decided in CSS off the `.dark` class rather than by a
 * `mounted` flag. The server can't know the resolved theme, so state would
 * cost a placeholder frame on every load — this renders identical markup on
 * both sides and lets next-themes' pre-hydration script settle it.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
    >
      <Sun className="dark:hidden" />
      <Moon className="not-dark:hidden" />
    </Button>
  );
}
