export function canOfferDevelopmentCleanActivation(
  deploymentKind: string | undefined,
): boolean {
  return deploymentKind === "development";
}
