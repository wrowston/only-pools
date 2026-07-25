import fs from "node:fs/promises";
import path from "node:path";
import { createClerkClient } from "@clerk/backend";
import { expect, test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { runConvexFunction } from "./support/convex";

const authDirectory = path.join(__dirname, ".auth");
const ownerAuthFile = path.join(authDirectory, "owner.json");
const memberAuthFile = path.join(authDirectory, "member.json");

const owner = {
  email: "only-pools-owner+clerk_test@example.com",
  phone: "+15555550100",
  username: "only_pools_e2e_owner",
  firstName: "E2E",
  lastName: "Owner",
};
const member = {
  email: "only-pools-member+clerk_test@example.com",
  phone: "+15555550101",
  username: "only_pools_e2e_member",
  firstName: "E2E",
  lastName: "Member",
};

type TestUser = typeof owner;

async function findOrCreateTestUser(user: TestUser): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required for E2E tests");
  }

  const client = createClerkClient({ secretKey });
  const existing = await client.users.getUserList({
    emailAddress: [user.email],
  });
  if (existing.data[0]) {
    return existing.data[0].id;
  }

  const created = await client.users.createUser({
    emailAddress: [user.email],
    phoneNumber: [user.phone],
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    skipPasswordRequirement: true,
    skipLegalChecks: true,
  });
  return created.id;
}

async function authenticateAndEstablishParticipant(
  page: Parameters<typeof clerk.signIn>[0]["page"],
  emailAddress: string,
  storageStatePath: string,
): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress });
  await page.goto("/my-pools");
  await expect(
    page.getByRole("button", { name: "Create Pool" }),
  ).toBeVisible();
  await page.context().storageState({ path: storageStatePath });
}

setup.describe.configure({ mode: "serial" });

let ownerClerkUserId = "";

setup("provision verified test participants", async () => {
  await fs.mkdir(authDirectory, { recursive: true });
  await clerkSetup();
  ownerClerkUserId = await findOrCreateTestUser(owner);
  await findOrCreateTestUser(member);
});

setup("authenticate the Pool owner", async ({ page }) => {
  await authenticateAndEstablishParticipant(
    page,
    owner.email,
    ownerAuthFile,
  );
});

setup("authenticate the invited member", async ({ page }) => {
  await authenticateAndEstablishParticipant(
    page,
    member.email,
    memberAuthFile,
  );
});

setup("seed a deterministic available NFL slate", async () => {
  await runConvexFunction("seedDemo:seedDemoWorld", {
    ownerClerkUserId,
    reset: true,
    poolCount: 1,
    fakeUserCount: 1,
  });
});
