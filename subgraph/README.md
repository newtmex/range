# Rebalancer Vault subgraph (Goldsky)

A Goldsky [instant (low-code) subgraph](https://docs.goldsky.com/subgraphs/guides/create-a-low-code-subgraph)
that indexes the vault events the frontend needs (`Rebalanced`, `FeesCollected`,
`IdleDeployed`, `Deposit`, `Withdraw`) across all three vaults in one deployment.

The frontend (`frontend/src/hooks/useVaultEvents.ts`) queries this subgraph over
GraphQL instead of scanning `eth_getLogs` range-by-range.

## Files

- `abi/RebalancerVault.json` — event-only ABI the indexer maps.
- `rebalancer-vault.config.json` — instant-subgraph config (ABIs, chain, instances).

## Deploy

```bash
# one-time
npm i -g @goldskycom/cli    # or: curl https://goldsky.com/install | sh
goldsky login

# from this directory
goldsky subgraph deploy rebalancer-vault/1.0.0 --from-abi rebalancer-vault.config.json
```

Goldsky generates the schema/mappings and returns a query endpoint. Put it in the
frontend env (see below).

## Before deploying — set these correctly

- **`startBlock`** (per instance): these are the vaults' actual deployment blocks
  on Mezo testnet, found by binary-searching `eth_getCode`:
  - tight `0x9b29…8594` → `13461897`
  - medium `0x3f92…c1A` → `13461898`
  - wide `0x4b19…3a3b` → `13461899`

  (Chain id 31611 is NOT a block number — an earlier placeholder used it by
  mistake, which Goldsky rejected with "block must exist on the network".)
- **`chain`**: `mezo-testnet` is a placeholder slug. Confirm the exact slug Goldsky
  uses for Mezo testnet (chain id 31611) — Goldsky supports custom EVM chains, and
  the slug may need to be registered/confirmed with them. For mainnet (31612) add
  matching instances with the mainnet vault addresses and a separate deploy
  (`rebalancer-vault-mainnet/1.0.0`).

## Query shape (verified against the deployed schema)

Entity query names are the pluralized, lower-first event names: `rebalanceds`,
`feesCollecteds`, `deposits`, `withdraws`, `idleDeployeds`.

Goldsky-generated fields (confirmed via GraphQL introspection):
- `id`, `contractId_` (source vault address), the event params (e.g.
  `newTickLower`, `newLiquidity`, `fee0`), plus metadata `block_number`,
  `timestamp_`, `transactionHash_`.

Per-vault filtering gotcha: filtering `contractId_` directly
(`where: { contractId_: "0x…" }`) fails because The Graph treats a trailing `_`
as nested-filter syntax and looks for a non-existent `contractId` relation. Use
the exact-match list operator instead:

```graphql
rebalanceds(where: { contractId__in: ["0x…"] }, orderBy: block_number, orderDirection: desc) {
  newTickLower newTickUpper newLiquidity block_number timestamp_ transactionHash_
}
```

Introspect field names yourself with:

```bash
curl -s -X POST "$ENDPOINT" -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"Rebalanced\"){ fields { name } } }"}'
```
