export const PROVIDER_RESET_AFTER = 8;

// Mutable object so all importers share the same reference
export const networkState = { failures: 0 };

export const vaultState = {};

export function initState(watched) {
  vaultState[watched.vault] = {
    consecutiveFailures: 0,
    totalRebalances:     0,
    totalIdleDeploys:    0,
    lastRebalanceAt:     0,
    lastIdleDeployAt:    0,
    nextAttemptAt:       0,
    lastSwapCheckBlock:  0,
  };
}
