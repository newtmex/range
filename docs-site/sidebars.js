// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Protocol",
      collapsed: false,
      items: [
        "protocol/overview",
        "protocol/how-it-works",
        "protocol/concentrated-liquidity",
        "protocol/rebalancing",
        "protocol/strategies",
        "protocol/fees",
        "protocol/oracle-and-twap",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: [
        "architecture/overview",
        "architecture/rebalancer-vault",
        "architecture/strategy",
        "architecture/dex-adapter",
        "architecture/vault-factory",
        "architecture/vault-lens",
        "architecture/libraries",
      ],
    },
    {
      type: "category",
      label: "Contract Reference",
      items: [
        "contracts/rebalancer-vault",
        "contracts/events",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/deposit-and-withdraw",
        "guides/integrate",
      ],
    },
    {
      type: "category",
      label: "Keeper Bot",
      items: [
        "keeper-bot/overview",
        "keeper-bot/configuration",
        "keeper-bot/operations",
      ],
    },
    "subgraph",
    "deployments",
    {
      type: "category",
      label: "Security",
      items: [
        "security/overview",
        "security/invariants",
      ],
    },
    {
      type: "category",
      label: "Developers",
      items: [
        "developers/local-setup",
        "developers/testing",
        "developers/deploy-and-upgrade",
      ],
    },
  ],
};

export default sidebars;
