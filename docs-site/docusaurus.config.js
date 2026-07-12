// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Range",
  tagline: "Automated concentrated-liquidity rebalancing for the Mezo DEX",
  favicon: "img/favicon.ico",

  url: "https://your-docs-domain.example",
  baseUrl: "/",

  organizationName: "MananSinghal123",
  projectName: "mezo-rebalance",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          editUrl:
            "https://github.com/MananSinghal123/mezo-rebalance/tree/main/docs-site/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: "img/social-card.png",
      colorMode: {
        defaultMode: "light",
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: "Range",
        logo: {
          alt: "Range",
          src: "img/logo.svg",
        },
        items: [
          {
            type: "docSidebar",
            sidebarId: "docsSidebar",
            position: "left",
            label: "Docs",
          },
          {
            href: "https://github.com/MananSinghal123/mezo-rebalance",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              { label: "Introduction", to: "/" },
              { label: "Architecture", to: "/architecture/overview" },
              { label: "Contract Reference", to: "/contracts/rebalancer-vault" },
            ],
          },
          {
            title: "Protocol",
            items: [
              { label: "Deployments", to: "/deployments" },
              { label: "Security", to: "/security/overview" },
            ],
          },
          {
            title: "More",
            items: [
              {
                label: "GitHub",
                href: "https://github.com/MananSinghal123/mezo-rebalance",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Range. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ["solidity", "bash", "json"],
      },
    }),
};

export default config;
