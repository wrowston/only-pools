/**
 * Next scrollLeft that centers a target inside a horizontal overflow container.
 *
 * Prefer this over Element.scrollIntoView — scrollIntoView also walks vertical
 * scroll ancestors and can yank pool chrome (Board / Standings chips) off-screen.
 */
export function centeredHorizontalScrollLeft(args: {
  containerScrollLeft: number;
  containerLeft: number;
  containerWidth: number;
  containerScrollWidth: number;
  targetLeft: number;
  targetWidth: number;
}): number {
  const offset =
    args.targetLeft -
    args.containerLeft -
    (args.containerWidth - args.targetWidth) / 2;
  const unclamped = args.containerScrollLeft + offset;
  const max = Math.max(0, args.containerScrollWidth - args.containerWidth);
  return Math.min(max, Math.max(0, unclamped));
}
