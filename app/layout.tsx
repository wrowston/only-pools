import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { POST_AUTH_HOME } from "@/lib/authRoutes";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { siteUrl } from "@/lib/siteUrl";
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
  metadataBase: new URL(siteUrl()),
  title: "Only Pools",
  description: "Private NFL prediction competitions for verified adults.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Only Pools",
    title: "Only Pools — NFL pools without the busywork",
    description:
      "Create a private NFL Survivor or Confidence pool, invite your people, and follow every pick and standing in one place.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Only Pools — NFL pools without the busywork",
    description:
      "Create a private NFL Survivor or Confidence pool, invite your people, and follow every pick and standing in one place.",
  },
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
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
