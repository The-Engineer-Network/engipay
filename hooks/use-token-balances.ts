"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { TRACKED_TOKENS, ERC20_ABI } from "@/lib/tokens";

/**
 * Reads the balance of every tracked ERC20 in one multicall.
 * Returns a map of lowercased token address -> raw balance.
 */
export function useTokenBalances(address: Address | undefined) {
  const contracts = useMemo(
    () =>
      TRACKED_TOKENS.map((token) => ({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "balanceOf" as const,
        args: address ? ([address] as const) : undefined,
      })),
    [address]
  );

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: Boolean(address) && TRACKED_TOKENS.length > 0 },
  });

  const balances = useMemo(() => {
    const out: Record<string, bigint> = {};
    if (!data) return out;
    data.forEach((result, i) => {
      const token = TRACKED_TOKENS[i];
      if (!token) return;
      if (result.status === "success" && typeof result.result === "bigint") {
        out[token.address.toLowerCase()] = result.result;
      }
    });
    return out;
  }, [data]);

  return { balances, isLoading, refetch };
}
