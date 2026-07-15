import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { OperatorIncidentsPanel } from "@/components/OperatorIncidentsPanel";
import { StatusBanner } from "@/components/StatusBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Only Pools",
  description: "Only Pools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <ConvexClientProvider>
            <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <Link
                href="/"
                className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
              >
                Only Pools
              </Link>
              <div className="flex items-center gap-3">
                <Show when="signed-out">
                  <SignInButton />
                  <SignUpButton />
                </Show>
                <Show when="signed-in">
                  <Link
                    href="/my-pools"
                    className="text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300"
                  >
                    My Pools
                  </Link>
                  <UserButton />
                </Show>
              </div>
            </header>
            <StatusBanner />
            {children}
            <OperatorIncidentsPanel />
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}