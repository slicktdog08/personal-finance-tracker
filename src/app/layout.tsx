import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { SyncNotice } from "@/components/SyncNotice";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getSession } from "@/server/auth/session";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Billing Tracker",
  description: "Personal monthly bill & transaction tracker",
};

// viewportFit: "cover" enables env(safe-area-inset-*) for the bottom sheet on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The nav links only to protected pages, so it would be dead weight on the login
  // and password-reset screens. Its absence is a UI convenience, not the access
  // control — that lives in the proxy and in requireSession().
  const session = await getSession();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {session && <Nav email={session.email ?? session.username} signOut={<SignOutButton />} />}
        {session && <SyncNotice />}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
