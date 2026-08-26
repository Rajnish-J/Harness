"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Client boundary for next-themes.
 *
 * app/layout.tsx is an async server component and can't hold the provider
 * itself, so it lives here alongside the other root providers (see
 * components/chat/ChatSessionProvider.tsx for the same pattern).
 *
 * `attribute="class"` is what pairs with the `@custom-variant dark` in
 * app/globals.css — changing one without the other breaks every `dark:`
 * utility in the app.
 */
export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
