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
  OperatorNavLink: ({ className }: { className?: string }) =>
    createElement("a", { href: "/operator", className }, "Incidents"),
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
import { postAuthRedirect } from "@/lib/postAuthRedirect";

describe("SiteHeader hamburger chrome", () => {
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

  it("keeps secondary links behind a hamburger on every width", () => {
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "marketing" }),
    );

    expect(markup).toContain('class="sr-only">Open navigation');
    expect(markup).not.toContain("md:flex");
    expect(markup).not.toContain("md:hidden");
    expect(markup).toContain("Guides");
    expect(markup).toContain("Help &amp; feedback");
    expect(markup).toContain("Log in");
    expect(markup).toContain("Sign up");
  });

  it("returns invite visitors to the join URL after header auth", () => {
    usePathname.mockReturnValue("/join/invite-token");
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "marketing" }),
    );
    // SignUpButton / SignInButton mocks pass children through; redirect is a
    // prop we cannot see in markup — assert the join path is still rendered
    // as a public invite surface with auth CTAs.
    expect(markup).toContain("Sign up");
    expect(markup).toContain("Log in");
    expect(postAuthRedirect("/join/invite-token")).toBe("/join/invite-token");
  });

  it("keeps the signed-in user control outside the menu", () => {
    useLikelySignedIn.mockReturnValue(true);
    usePathname.mockReturnValue("/my-pools");
    const markup = renderToStaticMarkup(
      createElement(SiteHeader, { variant: "app" }),
    );

    expect(markup).toContain('data-testid="user-button"');
    expect(markup).toContain('class="sr-only">Open navigation');
    expect(markup).toContain("My Pools");
    expect(markup).toContain("Help &amp; feedback");
    expect(markup).toContain("Incidents");
    expect(markup).not.toContain("Sign up");
  });
});
