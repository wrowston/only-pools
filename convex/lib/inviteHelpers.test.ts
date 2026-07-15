import { describe, expect, it } from "vitest";
import {
  blockDurationAfterAttempts,
  evaluateThrottle,
  INVITE_UNAVAILABLE,
} from "./inviteThrottle";
import {
  earliestStartWeekKickoffMs,
  isAdmissionClosed,
  resolveAdmissionClosedAtMs,
} from "./membershipCutoff";
import {
  hashInviteCredential,
  inviteUrlFromToken,
  parseInviteToken,
} from "./inviteCrypto";

describe("membershipCutoff", () => {
  it("picks the earliest Start Week kickoff", () => {
    expect(
      earliestStartWeekKickoffMs([
        { scheduledKickoffMs: 200 },
        { scheduledKickoffMs: 100 },
        { scheduledKickoffMs: 150 },
      ]),
    ).toBe(100);
  });

  it("latches admission once kickoff is reached", () => {
    expect(
      isAdmissionClosed({
        nowMs: 100,
        admissionClosedAtMs: undefined,
        earliestKickoffMs: 100,
      }),
    ).toBe(true);
    expect(
      resolveAdmissionClosedAtMs({
        nowMs: 100,
        admissionClosedAtMs: undefined,
        earliestKickoffMs: 100,
      }),
    ).toBe(100);
  });

  it("keeps latched cutoff after kickoff is rescheduled later", () => {
    expect(
      isAdmissionClosed({
        nowMs: 50,
        admissionClosedAtMs: 100,
        earliestKickoffMs: 500,
      }),
    ).toBe(true);
    expect(
      resolveAdmissionClosedAtMs({
        nowMs: 50,
        admissionClosedAtMs: 100,
        earliestKickoffMs: 500,
      }),
    ).toBe(100);
  });

  it("stays open before earliest kickoff when not latched", () => {
    expect(
      isAdmissionClosed({
        nowMs: 50,
        admissionClosedAtMs: undefined,
        earliestKickoffMs: 100,
      }),
    ).toBe(false);
  });
});

describe("inviteThrottle", () => {
  it("exports a generic unavailable message", () => {
    expect(INVITE_UNAVAILABLE).toBe("Invite unavailable");
  });

  it("applies progressive block durations", () => {
    expect(blockDurationAfterAttempts(1)).toBe(0);
    expect(blockDurationAfterAttempts(2)).toBe(0);
    expect(blockDurationAfterAttempts(3)).toBe(30_000);
    expect(blockDurationAfterAttempts(5)).toBe(120_000);
    expect(blockDurationAfterAttempts(8)).toBe(900_000);
  });

  it("increments attempts and sets block after threshold", () => {
    const first = evaluateThrottle(null, 1_000);
    expect(first.blocked).toBe(false);
    expect(first.next.attemptCount).toBe(1);

    let state = first.next;
    state = evaluateThrottle(state, 1_100).next;
    const third = evaluateThrottle(state, 1_200);
    expect(third.next.attemptCount).toBe(3);
    expect(third.next.blockedUntilMs).toBe(1_200 + 30_000);

    const whileBlocked = evaluateThrottle(third.next, 1_300);
    expect(whileBlocked.blocked).toBe(true);
  });
});

describe("inviteCrypto", () => {
  it("hashes deterministically and builds join URLs", async () => {
    const a = await hashInviteCredential("secret-token");
    const b = await hashInviteCredential("secret-token");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(inviteUrlFromToken("abc")).toBe("/join/abc");
    expect(parseInviteToken("/join/abc")).toBe("abc");
    expect(parseInviteToken("abc")).toBe("abc");
  });
});
