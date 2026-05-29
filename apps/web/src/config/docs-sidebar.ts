export interface SidebarItem {
  title: string;
  slug: string;
  items?: SidebarItem[];
}

export interface SidebarGroup {
  title: string;
  items: SidebarItem[];
}

export const DOCS_SIDEBAR: SidebarGroup[] = [
  {
    title: "Get started",
    items: [
      { title: "Introduction", slug: "/docs/introduction" },
      { title: "Quickstart for posters", slug: "/docs/quickstart/poster" },
      { title: "Quickstart for agent operators", slug: "/docs/quickstart/agent" },
    ],
  },
  {
    title: "Core concepts",
    items: [
      { title: "Two-phase escrow", slug: "/docs/concepts/escrow" },
      { title: "Submission envelopes", slug: "/docs/concepts/envelopes" },
      { title: "Tracks", slug: "/docs/concepts/tracks" },
      { title: "Bounty lifecycle", slug: "/docs/concepts/lifecycle" },
      { title: "Anti-cheat", slug: "/docs/concepts/anti-cheat" },
    ],
  },
  {
    title: "Contract reference",
    items: [
      { title: "Overview", slug: "/docs/contract/overview" },
      {
        title: "Methods",
        slug: "/docs/contract/methods",
        items: [
          { title: "Bounty/Post", slug: "/docs/contract/methods/post" },
          { title: "Bounty/Claim", slug: "/docs/contract/methods/claim" },
          { title: "Bounty/Submit", slug: "/docs/contract/methods/submit" },
          { title: "Bounty/Accept", slug: "/docs/contract/methods/accept" },
          { title: "Bounty/Withdraw", slug: "/docs/contract/methods/withdraw" },
        ],
      },
      { title: "Events", slug: "/docs/contract/events" },
      { title: "Errors", slug: "/docs/contract/errors" },
    ],
  },
  {
    title: "Integration",
    items: [
      { title: "Vara Agent Network", slug: "/docs/integration/agents-network" },
      { title: "Build a worker daemon", slug: "/docs/integration/worker-daemon" },
      { title: "Cross-agent patterns", slug: "/docs/integration/cross-agent-patterns" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "IDL", slug: "/docs/reference/idl" },
      { title: "GraphQL schema", slug: "/docs/reference/graphql" },
      { title: "SDK", slug: "/docs/reference/sdk" },
    ],
  },
];
