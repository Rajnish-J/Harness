import type { Metadata } from "next";
import { Geist_Mono, Outfit, Ubuntu } from "next/font/google";
import { cookies } from "next/headers";

import ChatPresetProvider from "@/components/chat/ChatPresetProvider";
import ChatSessionProvider from "@/components/chat/ChatSessionProvider";
import AppHeader from "@/components/shell/AppHeader";
import AppSidebar from "@/components/shell/AppSidebar";
import ThemeProvider from "@/components/shell/ThemeProvider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

// Ubuntu is not a variable font, so every weight and style we use has to be
// listed here — anything missing gets synthesised by the browser instead.
const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
// Outfit is variable (100–900), so it needs no `weight`.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Harness",
  description: "An AI coding agent harness, built from scratch.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // components/ui/sidebar.tsx persists the open/closed state in this cookie.
  // Reading it here avoids a frame of the wrong state on reload. It also opts
  // every route into dynamic rendering, which is fine: nothing in this app is
  // meaningfully static — every page talks to Postgres or the Python harness.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ubuntu.variable} ${outfit.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-svh">
        <ThemeProvider>
          <ChatPresetProvider>
            <ChatSessionProvider>
              <SidebarProvider
                defaultOpen={defaultOpen}
                className="h-svh overflow-hidden"
              >
                <AppSidebar />
                <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <AppHeader />
                  <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                </SidebarInset>
              </SidebarProvider>
            </ChatSessionProvider>
          </ChatPresetProvider>
          {/* Inside ThemeProvider so toasts read the same `.dark` class as the
              rest of the app; outside the shell so nothing can clip them. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
