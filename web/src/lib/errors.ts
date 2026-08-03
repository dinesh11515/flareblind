
export function formatAppError(err: unknown): string {
  const e = err as {
    shortMessage?: string;
    message?: string;
    code?: string | number;
    reason?: string;
    details?: string;
    name?: string;
  };

  const raw =
    e.shortMessage ?? e.details ?? e.reason ?? e.message ?? String(err);

  if (
    e.name === "UserRejectedRequestError" ||
    /user rejected|ACTION_REJECTED|4001/i.test(raw)
  ) {
    return "Transaction rejected in wallet.";
  }
  if (/wrong network|network changed|unsupported chain|ChainNotConfigured/i.test(raw)) {
    return "Wrong network — switch to Coston2 (chain 114).";
  }
  if (
    /missing revert data|CALL_EXCEPTION|ContractFunctionExecutionError|Execution reverted/i.test(
      raw,
    )
  ) {
    return "Contract call failed. Check the pool address and that you’re on Coston2.";
  }
  if (/ENOTFOUND|Failed to fetch|NETWORK_ERROR|timeout|ECONNRESET|HttpRequestError/i.test(raw)) {
    return "RPC unreachable. Retry in a moment.";
  }
  if (/insufficient funds/i.test(raw)) {
    return "Not enough C2FLR for gas.";
  }

  if (raw.length > 180 || raw.includes("transaction={") || raw.includes("Request Arguments")) {
    return "Transaction failed. Check pool address, network, and balances.";
  }
  return raw;
}
