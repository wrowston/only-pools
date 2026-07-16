/**
 * Clerk appearance — Firecrawl heat orange primary, hairline borders, Satoshi.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#fa5d19",
    colorText: "#262626",
    colorTextSecondary: "#262626a3",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#262626",
    colorNeutral: "#262626",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-suisse), ui-sans-serif, system-ui, sans-serif",
    fontFamilyButtons: "var(--font-suisse), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    card: "shadow-[0_1px_2px_rgba(0,0,0,0.04)] border border-[#ededed] rounded-[16px]",
    headerTitle: "font-medium tracking-tight",
    formButtonPrimary:
      "bg-[#fa5d19] hover:bg-[#e55416] text-white shadow-none rounded-[10px] text-[13px] font-medium",
    socialButtonsBlockButton:
      "border border-[#ededed] rounded-[10px] text-[13px] font-medium",
    formFieldInput: "rounded-[8px] border-[#ededed]",
    footerActionLink: "text-[#fa5d19] hover:text-[#e55416]",
  },
} as const;
