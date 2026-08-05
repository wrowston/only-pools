import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  findPoolGameForTeam,
  lockGame,
  verifySelectedTeamWin,
} from "./support/convex";

const ownerAuthFile = path.join(__dirname, ".auth/owner.json");
const memberAuthFile = path.join(__dirname, ".auth/member.json");

test("create → invite → pick → lock → score → standings", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const ownerContext = await browser.newContext({
    storageState: ownerAuthFile,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const memberContext = await browser.newContext({
    storageState: memberAuthFile,
  });
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const poolName = `Seed · E2E Critical Path ${Date.now()}`;

  try {
    let inviteUrl = "";
    let poolId = "";
    let selectedTeamAbbreviation = "";

    await test.step("the owner creates an active Survivor Pool", async () => {
      await ownerPage.goto("/my-pools");
      await ownerPage.getByRole("button", { name: "Create Pool" }).click();

      const dialog = ownerPage.getByRole("dialog", { name: "Create Pool" });
      await dialog.getByPlaceholder("Name your pool").fill(poolName);
      await dialog.getByRole("button", { name: "Continue" }).click();
      await dialog.locator("select").selectOption({ label: "Week 5" });
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(
        dialog.getByRole("radio", { name: "Game Kickoff Lock" }),
      ).toBeChecked();
      await dialog
        .getByRole("button", { name: "Create Active Pool" })
        .click();

      await expect(
        ownerPage.getByRole("heading", { name: "Pool created" }),
      ).toBeVisible();
    });

    await test.step("the owner shares the invite", async () => {
      await ownerPage.getByRole("button", { name: "Copy link" }).click();
      await expect(
        ownerPage.getByRole("button", { name: "Copied" }),
      ).toBeVisible();
      inviteUrl = await ownerPage.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(inviteUrl).toMatch(/\/join\/[^/]+$/);

      await ownerPage
        .getByRole("button", { name: "View pool / Make picks" })
        .click();
      await expect(ownerPage).toHaveURL(/\/pools\/[^/?]+$/);
      const match = new URL(ownerPage.url()).pathname.match(
        /^\/pools\/([^/]+)$/,
      );
      expect(match).not.toBeNull();
      poolId = match![1]!;
    });

    await test.step("a second verified participant accepts the invite", async () => {
      await memberPage.goto(inviteUrl);
      await expect(
        memberPage.getByRole("heading", { name: `Join ${poolName}` }),
      ).toBeVisible();
      await memberPage.getByRole("checkbox").check();
      await memberPage.getByRole("button", { name: "Accept invite" }).click();
      await expect(memberPage).toHaveURL(`/pools/${poolId}`);
      await expect(
        memberPage.getByRole("heading", { name: "Week Board" }),
      ).toBeVisible();
    });

    await test.step("the owner saves a pick that stays hidden from the member", async () => {
      const slate = ownerPage.locator(
        'section[aria-labelledby="slate-heading"]',
      );
      const availableTeam = slate
        .locator('button[aria-pressed="false"]:not([disabled])')
        .first();
      const accessibleName = await availableTeam.getAttribute("aria-label");
      expect(accessibleName).toBeTruthy();
      selectedTeamAbbreviation = accessibleName!.split(",")[0]!.trim();
      const selectedTeam = slate.getByRole("button", {
        name: new RegExp(`^${selectedTeamAbbreviation}(?:,|$)`),
      });

      await availableTeam.click();
      await expect(selectedTeam).toHaveAttribute("aria-pressed", "true");
      await expect(
        ownerPage.locator('[data-save-trust="saved"]'),
      ).toBeVisible();
      await expect(
        ownerPage.locator('[data-toast-tone="success"]'),
      ).toBeVisible();
      await expect(ownerPage.getByText("Pick saved")).toBeVisible();

      await memberPage.reload();
      const ownerPickState = memberPage
        .locator('section[aria-labelledby="participants-heading"] li')
        .filter({ hasText: "E2E Owner" });
      await expect(ownerPickState).toContainText("Pick saved · Hidden");
      await expect(ownerPickState).not.toContainText(
        selectedTeamAbbreviation,
      );
    });

    const game = await findPoolGameForTeam(
      poolId,
      selectedTeamAbbreviation,
    );

    await test.step("kickoff irreversibly locks and reveals the pick", async () => {
      await lockGame(game.gameId);
      await ownerPage.reload();

      await expect(
        ownerPage.getByText("Locked · your pick is visible to the pool"),
      ).toBeVisible();
      const lockedPick = ownerPage.getByRole("button", {
        name: new RegExp(
          `^${selectedTeamAbbreviation}, selected, locked`,
        ),
      });
      await expect(lockedPick).toBeDisabled();

      await memberPage.reload();
      const revealedOwnerPick = memberPage
        .locator('section[aria-labelledby="participants-heading"] li')
        .filter({ hasText: "E2E Owner" });
      await expect(revealedOwnerPick).toContainText(
        selectedTeamAbbreviation,
      );
      await expect(revealedOwnerPick).not.toContainText("Hidden");
    });

    await test.step("a verified final result scores the pick and standings", async () => {
      await verifySelectedTeamWin(game, selectedTeamAbbreviation);
      await ownerPage.goto(`/pools/${poolId}/standings`);

      await expect(
        ownerPage.getByRole("heading", { name: "Standings", exact: true }),
      ).toBeVisible();
      await expect(
        ownerPage.getByLabel(
          new RegExp(`${selectedTeamAbbreviation}, pick won`, "i"),
        ).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(ownerPage.getByText(/Survivor · \d+ Alive/)).toBeVisible();

      const standingsGrid = ownerPage.getByRole("table");
      const stickyOverlay = await standingsGrid.evaluate((table) => {
        const scrollContainer = table.parentElement;
        const playerHeader = table.querySelector("thead th:first-child");
        const statusHeader = table.querySelector("thead th:last-child");
        const viewerBadge = Array.from(
          table.querySelectorAll("tbody span"),
        ).find(
          (element) => element.textContent?.trim().toLowerCase() === "you",
        );
        const viewerRow = viewerBadge?.closest("tr");
        const playerCell = viewerRow?.querySelector("td:first-child");
        const statusCell = viewerRow?.querySelector("td:last-child");
        if (
          !scrollContainer ||
          !playerHeader ||
          !statusHeader ||
          !playerCell ||
          !statusCell
        ) {
          throw new Error("Standings sticky columns are missing");
        }

        const maxScrollLeft = Math.max(
          0,
          scrollContainer.scrollWidth - scrollContainer.clientWidth,
        );
        scrollContainer.scrollLeft = Math.min(40, maxScrollLeft / 2);
        const playerRect = playerHeader.getBoundingClientRect();
        const statusRect = statusHeader.getBoundingClientRect();
        const weekHeaders = Array.from(
          table.querySelectorAll("thead th:not(:last-child)"),
        ).filter((header) => header !== playerHeader);
        const hasWeekUnderPlayer = weekHeaders.some((header) => {
          const rect = header.getBoundingClientRect();
          return rect.left < playerRect.right && rect.right > playerRect.left;
        });
        const hasWeekUnderStatus = weekHeaders.some((header) => {
          const rect = header.getBoundingClientRect();
          return rect.left < statusRect.right && rect.right > statusRect.left;
        });

        const isOpaque = (color: string) => {
          const alpha = color.match(
            /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/,
          )?.[1];
          return alpha === undefined || Number(alpha) === 1;
        };
        const hasVisibleOpaqueBackground = (element: Element) =>
          [getComputedStyle(element), getComputedStyle(element, "::before")].some(
            (style) =>
              isOpaque(style.backgroundColor) &&
              Number(style.opacity) > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none",
          );

        return {
          scrolled: scrollContainer.scrollLeft > 0,
          hasWeekUnderPlayer,
          hasWeekUnderStatus,
          playerHeaderIsOpaque: hasVisibleOpaqueBackground(playerHeader),
          playerCellIsOpaque: hasVisibleOpaqueBackground(playerCell),
          headerIsOpaque: hasVisibleOpaqueBackground(statusHeader),
          cellIsOpaque: hasVisibleOpaqueBackground(statusCell),
        };
      });

      expect(stickyOverlay).toEqual({
        scrolled: true,
        hasWeekUnderPlayer: true,
        hasWeekUnderStatus: true,
        playerHeaderIsOpaque: true,
        playerCellIsOpaque: true,
        headerIsOpaque: true,
        cellIsOpaque: true,
      });
    });
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
