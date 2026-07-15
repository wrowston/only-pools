import type { Doc } from "../_generated/dataModel";

/** Archived is a reversible overlay — absent/false means not archived. */
export function isPoolArchived(pool: Doc<"pools">): boolean {
  return pool.archived === true;
}
