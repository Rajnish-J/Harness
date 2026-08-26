import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";

import ChatPresetProvider from "@/components/chat/ChatPresetProvider";
import ChatSessionProvider from "@/components/chat/ChatSessionProvider";
import AppHeader from "@/components/shell/AppHeader";
import AppSidebar from "@/components/shell/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-svh">
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
      </body>
    </html>
  );
}
