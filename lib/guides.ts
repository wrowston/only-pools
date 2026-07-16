export const GUIDE_CATEGORIES = [
  "Get started",
  "Run a Pool",
  "Play in a Pool",
  "Reference",
  "FAQ",
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export type Guide = {
  slug: string;
  title: string;
  summary: string;
  category: GuideCategory;
  audience: "Everyone" | "Pool Owners and Admins" | "Pool Participants";
  headings: readonly string[];
  keywords: readonly string[];
};

export const guides = [
  {
    slug: "getting-started",
    title: "Getting Started and Choosing a Pool Type",
    summary:
      "Learn the Only Pools basics, choose Survivor or Confidence, and find your next step.",
    category: "Get started",
    audience: "Everyone",
    headings: ["Choose a Pool type", "If you run a Pool", "If you play in a Pool"],
    keywords: ["quick start", "owner", "member", "navigation"],
  },
  {
    slug: "create-a-pool",
    title: "Create a Pool and Reuse a Template",
    summary:
      "Choose a Pool Season, type, Start Week, Pick Lock mode, or reuse a prior Pool setup.",
    category: "Run a Pool",
    audience: "Pool Owners and Admins",
    headings: ["Create from scratch", "Create from a template", "Returning Participant Invites"],
    keywords: ["setup", "season", "start week", "game kickoff", "weekly cutoff"],
  },
  {
    slug: "invites-and-joining",
    title: "Invite People and Join a Pool",
    summary:
      "Create, share, rotate, and accept ordinary or Returning Participant Invites.",
    category: "Run a Pool",
    audience: "Everyone",
    headings: ["Create or retrieve an invite", "Rotate an invite", "Accept an invite"],
    keywords: ["invitation link", "join", "returning participant", "expiration"],
  },
  {
    slug: "members-roles-and-ownership",
    title: "Manage Members, Roles, and Ownership",
    summary:
      "Understand Pool Owner, Pool Admin, and Pool Member permissions and manage membership safely.",
    category: "Run a Pool",
    audience: "Pool Owners and Admins",
    headings: ["Pool roles", "Promote or demote an Admin", "Transfer ownership", "Leave a Pool"],
    keywords: ["remove", "reinstate", "permissions", "member contact details"],
  },
  {
    slug: "archive-audit-and-reports",
    title: "Archive, Restore, Review the Audit, and Report Abuse",
    summary:
      "Manage a Pool's read-only archive state, review administrative events, and send a private report.",
    category: "Run a Pool",
    audience: "Pool Owners and Admins",
    headings: ["Archive or restore a Pool", "Pool Audit", "Abuse Report"],
    keywords: ["read-only", "administrative events", "private report"],
  },
  {
    slug: "week-board-picks-and-locks",
    title: "Use the Week Board: Autosave, Hidden Picks, and Pick Locks",
    summary:
      "Navigate Pool Weeks, understand save status, and know when picks become locked or visible.",
    category: "Play in a Pool",
    audience: "Pool Participants",
    headings: ["Change weeks", "Autosave", "Pick Locks", "Hidden Picks"],
    keywords: ["saving", "saved", "kickoff", "weekly cutoff", "pick visibility"],
  },
  {
    slug: "survivor-picks",
    title: "Make Survivor Picks",
    summary:
      "Choose one eligible NFL team per week, avoid reusing teams, and understand elimination.",
    category: "Play in a Pool",
    audience: "Pool Participants",
    headings: ["Make or change a pick", "One-use rule", "Provisional picks", "Elimination"],
    keywords: ["alive", "used team", "no pick", "canceled game", "no-contest advance"],
  },
  {
    slug: "confidence-picks",
    title: "Make Confidence Picks",
    summary:
      "Predict every required winner, assign unique confidence values, and set the weekly tiebreaker.",
    category: "Play in a Pool",
    audience: "Pool Participants",
    headings: ["Pick winners", "Assign confidence values", "Weekly Tiebreaker Prediction", "Automatic picks"],
    keywords: ["pick sheet", "default ranking", "omission", "home team", "points"],
  },
  {
    slug: "standings-and-results",
    title: "Understand Standings and Results",
    summary:
      "Read weekly and season standings, pick outcomes, projected scores, and verified results.",
    category: "Play in a Pool",
    audience: "Everyone",
    headings: ["Survivor standings", "Confidence standings", "Projected and verified results"],
    keywords: ["rank", "weekly standing", "season standing", "correction", "winner"],
  },
  {
    slug: "pool-rules-and-lifecycle",
    title: "Pool Rules and Lifecycle",
    summary:
      "Reference Pool types, rules, Pick Locks, scoring, and Active, Completed, or Archived states.",
    category: "Reference",
    audience: "Everyone",
    headings: ["Pool Ruleset", "Pick Lock modes", "Scoring", "Pool lifecycle"],
    keywords: ["active", "completed", "archived", "survivor rules", "confidence rules"],
  },
  {
    slug: "accounts-verification-and-privacy",
    title: "Accounts, Eligibility, Verification, and Privacy",
    summary:
      "Understand eligibility, verified contact details, Step-up Verification, and who can see your information.",
    category: "Reference",
    audience: "Everyone",
    headings: ["Eligibility", "Email and phone verification", "Step-up Verification", "Privacy"],
    keywords: ["18", "contact visibility", "who can see my phone", "profile", "identity"],
  },
  {
    slug: "faq",
    title: "Frequently Asked Questions",
    summary:
      "Find quick answers about joining, saving picks, locks, scoring, roles, privacy, and archived Pools.",
    category: "FAQ",
    audience: "Everyone",
    headings: ["Joining", "Picks and locks", "Scoring", "Pool management", "Accounts and privacy"],
    keywords: ["help", "troubleshooting", "questions", "invite unavailable", "save failed"],
  },
] as const satisfies readonly Guide[];

export type GuideSlug = (typeof guides)[number]["slug"];

const SEARCH_STOP_WORDS = new Set(["a", "an", "and", "can", "do", "i", "is", "my", "of", "the", "to", "who"]);

function searchableText(guide: Guide): string {
  return [
    guide.title,
    guide.summary,
    ...guide.headings,
    ...guide.keywords,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function searchGuides(query: string): Guide[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...guides];

  const terms = normalizedQuery
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && !SEARCH_STOP_WORDS.has(term));
  if (terms.length === 0) return [...guides];

  return guides
    .map((guide, index) => {
      const title = guide.title.toLocaleLowerCase();
      const summary = guide.summary.toLocaleLowerCase();
      const text = searchableText(guide);
      const score = terms.reduce((total, term) => {
        if (!text.includes(term)) return total;
        if (title.includes(term)) return total + 4;
        if (summary.includes(term)) return total + 2;
        return total + 1;
      }, text.includes(normalizedQuery) ? 6 : 0);
      return { guide, index, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.guide);
}
