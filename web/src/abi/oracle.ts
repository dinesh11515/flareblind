export const oracleAbi = [
  {
    type: "function",
    name: "latestPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "timestamp", type: "uint256" },
    ],
  },
] as const;
