import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usePathname = vi.fn(() => "/guides");
const useLikelySignedIn = vi.fn(() => false);

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

vi.mock("@/lib/useLikelySignedIn", () => ({
  useLikelySignedIn: () => useLikelySignedIn(),
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => createElement("div", { "data-testid": "user-button" }),
}));

vi.mock("@/components/OperatorNavLink", () => ({
  OperatorNavLink: () =>
    createElement("a", { href: "/operator" }, "Incidents"),
}));

vi.mock("@/components/MyPoolsNavLink", () => ({
  MyPoolsNavLink: ({
    className,
    children = "My Pools",
  }: {
    className?: string;
    children?: React.ReactNode;
  }) => createElement("a", { href: "/my-pools", className }, children),
}));

vi.mock("@/components/BrandMark", () => ({
  BrandMark: () => createElement("span", { "data-testid": "brand-mark" }),
}));

import { SiteHeader } from "@/components/SiteHeader";

describe("SiteHeader mobile chrome", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/guides");
    useLikelySignedIn.mockReturnValue(false);
  });

  it("hides the home route chrome", () => {
    usePathname.mockReturnValue("/");
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "marketing" }),
    );
    expect(markup).toBe("");
  });

  it("keeps desktop links and collapses secondary nav behind a hamburger on mobile", () => {
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "marketing" }),
    );

    expect(markup).toContain('class="sr-only">Open navigation');
    expect(markup).toContain("hidden items-center gap-1.5 sm:gap-2 md:flex");
    expect(markup).toContain("flex items-center gap-1.5 md:hidden");
    expect(markup).toContain("Guides");
    expect(markup).toContain("Help &amp; feedback");
    expect(markup).toContain("Log in");
    expect(markup).toContain("Sign up");
  });

  it("keeps the signed-in user control outside the mobile menu", () => {
    useLikelySignedIn.mockReturnValue(true);
    usePathname.mockReturnValue("/my-pools");
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "app" }),
    );

    expect(markup).toContain('data-testid="user-button"');
    expect(markup).toContain("My Pools");
    expect(markup).toContain("Help &amp; feedback");
    expect(markup).not.toContain("Sign up");
  });
});
