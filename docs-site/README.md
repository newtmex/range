# Rebalancer Vault — Documentation Site

Professional protocol documentation built with [Docusaurus](https://docusaurus.io/).

## Structure

```
docs-site/
├── docs/                     ← all documentation content (Markdown)
│   ├── intro.md              ← landing page
│   ├── protocol/             ← how the protocol works (concepts)
│   ├── architecture/         ← contract-by-contract architecture
│   ├── contracts/            ← function + event reference
│   ├── guides/               ← user & integrator guides
│   ├── keeper-bot/           ← keeper operations
│   ├── security/             ← threat model + invariants
│   ├── developers/           ← setup, testing, deploy/upgrade
│   ├── subgraph.md
│   └── deployments.md
├── docusaurus.config.js      ← site config
├── sidebars.js               ← navigation
└── src/css/custom.css        ← theme
```

## Develop

```bash
npm install
npm run start      # local dev server with hot reload
```

## Build

```bash
npm run build      # static site into build/
npm run serve      # preview the production build
```

## Maintenance

Keep documentation close to the code:

- **Contract reference / events** — update `docs/contracts/` when public functions or
  events in `src/` change. Consider generating these from NatSpec with `forge doc`.
- **Deployments** — `docs/deployments.md` mirrors the root `README.md`; ideally generate
  both from `broadcast/*/run-latest.json`.
- **Invariants** — `docs/security/invariants.md` summarizes `PROPERTIES.md` (the source
  of truth).
- **Link checking** — `npm run lint:links` (requires [lychee](https://github.com/lycheeverse/lychee)).

Wire `npm run build` into CI so broken links or references fail the build.
