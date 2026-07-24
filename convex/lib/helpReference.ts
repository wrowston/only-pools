/** Opaque, non-enumerating Help intake reference (e.g. OP-A1B2C3…). */

const REFERENCE_PREFIX = "OP-";
const REFERENCE_BYTE_LENGTH = 12;

export function generateHelpReference(): string {
  const bytes = new Uint8Array(REFERENCE_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${REFERENCE_PREFIX}${hex.toUpperCase()}`;
}

/** True when the string looks like an opaque OP- reference (not sequential). */
export function isOpaqueHelpReference(reference: string): boolean {
  return /^OP-[0-9A-F]{24}$/.test(reference);
}
