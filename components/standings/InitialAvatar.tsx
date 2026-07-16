const AVATAR_PALETTES = [
  "bg-op-heat-12 text-op-selected-fg",
  "bg-[#e8e4f3] text-[#4a4568]",
  "bg-[#e4f0ea] text-[#3d5c4a]",
  "bg-[#e4ebf3] text-[#45586b]",
  "bg-[#f0ebe4] text-[#5c5040]",
  "bg-op-control text-op-secondary",
] as const;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Initial circle — heat-tinted first palette for brand cohesion.
 */
export function InitialAvatar({ name }: { name: string }) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const palette = AVATAR_PALETTES[hashName(name) % AVATAR_PALETTES.length];

  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-xs font-medium ${palette}`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
