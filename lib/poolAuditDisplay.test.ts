import { describe, expect, it } from "vitest";
import {
  formatPoolAuditEvent,
  resolveAuditDisplayNames,
} from "./poolAuditDisplay";

describe("formatPoolAuditEvent", () => {
  it("formats admin_promoted with actor and affected names", () => {
    const formatted = formatPoolAuditEvent({
      action: "admin_promoted",
      actorDisplayName: "Alex",
      affectedDisplayName: "Blake",
      metadata: {
        priorRole: "member",
        resultingRole: "admin",
      },
    });
    expect(formatted.title).toBe("Admin promoted");
    expect(formatted.details[0]).toBe(
      "Alex promoted Blake from member to admin",
    );
  });

  it("includes removal reason when present", () => {
    const formatted = formatPoolAuditEvent({
      action: "member_removed",
      actorDisplayName: "Alex",
      affectedDisplayName: "Casey",
      metadata: {
        priorRole: "member",
        reason: "Inactive",
      },
    });
    expect(formatted.title).toBe("Member removed");
    expect(formatted.details).toEqual([
      "Alex removed Casey (member)",
      "Reason: Inactive",
    ]);
  });

  it("formats invite actions with readable grammar", () => {
    const formatted = formatPoolAuditEvent({
      action: "invite_created",
      actorDisplayName: "willrowston@gmail.com",
      metadata: null,
    });
    expect(formatted.details[0]).toBe(
      "willrowston@gmail.com created an invite",
    );
  });

  it("falls back when names are missing", () => {
    const formatted = formatPoolAuditEvent({
      action: "pool_archived",
      actorDisplayName: null,
      affectedDisplayName: null,
      metadata: { lifecycleStatus: "active" },
    });
    expect(formatted.title).toBe("Pool archived");
    expect(formatted.details[0]).toBe("A participant archived the pool");
    expect(formatted.details[1]).toBe("Lifecycle stayed active");
  });
});

describe("resolveAuditDisplayNames", () => {
  it("fills names from the members map when query fields are empty", () => {
    const names = resolveAuditDisplayNames(
      {
        action: "admin_demoted",
        actorParticipantId: "actor-1",
        actorDisplayName: null,
        affectedDisplayName: null,
        metadata: { affectedParticipantId: "target-1" },
      },
      new Map([
        ["actor-1", "Will"],
        ["target-1", "Blake"],
      ]),
    );
    expect(names).toEqual({
      actorDisplayName: "Will",
      affectedDisplayName: "Blake",
    });
  });
});
