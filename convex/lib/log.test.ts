import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  errorMessage,
  redactProviderUrl,
  sanitizeLogFields,
  shouldLog,
  type LogLevel,
} from "./log";

describe("server log helpers", () => {
  const prevLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (prevLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prevLevel;
  });

  it("defaults to info threshold", () => {
    delete process.env.LOG_LEVEL;
    expect(shouldLog("debug")).toBe(false);
    expect(shouldLog("info")).toBe(true);
    expect(shouldLog("warn")).toBe(true);
  });

  it("honors LOG_LEVEL=debug", () => {
    expect(shouldLog("debug", { LOG_LEVEL: "debug" })).toBe(true);
    expect(shouldLog("info", { LOG_LEVEL: "error" })).toBe(false);
  });

  it("redacts sensitive field names", () => {
    expect(
      sanitizeLogFields({
        poolId: "pools_1",
        credentialSecret: "secret-token",
        selectedTeamId: "teams_1",
        attemptCount: 2,
      }),
    ).toEqual({
      poolId: "pools_1",
      credentialSecret: "[redacted]",
      selectedTeamId: "[redacted]",
      attemptCount: 2,
    });
  });

  it("redacts TheSportsDB API keys in URLs", () => {
    expect(
      redactProviderUrl(
        "https://www.thesportsdb.com/api/v1/json/PAID_KEY/lookupevent.php?id=1",
      ),
    ).toBe(
      "https://www.thesportsdb.com/api/v1/json/[redacted]/lookupevent.php?id=1",
    );
  });

  it("emits single-line JSON without sensitive values", () => {
    const lines: Array<{ level: LogLevel; line: string }> = [];
    const log = createLogger(
      "test.scope",
      { component: "unit" },
      {
        env: { LOG_LEVEL: "info" },
        nowMs: () => 1_700_000_000_000,
        write: (level, line) => lines.push({ level, line }),
      },
    );

    log.info("invite_created", {
      poolId: "pools_abc",
      credentialSecret: "must-not-appear",
    });
    log.debug("skipped_at_info", { ok: true });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe("info");
    const parsed = JSON.parse(lines[0]!.line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      scope: "test.scope",
      msg: "invite_created",
      atMs: 1_700_000_000_000,
      component: "unit",
      poolId: "pools_abc",
      credentialSecret: "[redacted]",
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-appear");
  });

  it("formats unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(null)).toBe("unknown_error");
  });
});
