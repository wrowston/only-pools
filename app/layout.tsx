import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBanner } from "@/components/StatusBanner";
import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

/* Satoshi ≈ Suisse: clean Swiss grotesque used like Firecrawl’s body face */
const satoshi = localFont({
  src: [
    {
      path: "../public/fonts/Satoshi-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/Satoshi-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/Satoshi-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-suisse",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Only Pools",
  description: "Private NFL prediction competitions for verified adults.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${satoshi.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans text-op-text">
        <ClerkProvider
          appearance={clerkAppearance}
          signInFallbackRedirectUrl={POST_AUTH_HOME}
          signUpFallbackRedirectUrl={POST_AUTH_HOME}
        >
          <ConvexClientProvider>
            <SiteHeader />
            <StatusBanner />
            <div id="main" className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
