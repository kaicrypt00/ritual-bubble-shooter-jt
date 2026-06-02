export const CONTRACT_ADDRESS = "0xbBD569bA30890950a028be0c4B05Eb37D6e031d0" as const;

export const CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "string", name: "username", type: "string" },
      { indexed: false, internalType: "uint256", name: "score", type: "uint256" },
    ],
    name: "GameSubmitted",
    type: "event",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "best",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "board",
    outputs: [
      { internalType: "address", name: "wallet", type: "address" },
      { internalType: "string", name: "username", type: "string" },
      { internalType: "uint256", name: "score", type: "uint256" },
      { internalType: "uint256", name: "shots", type: "uint256" },
      { internalType: "uint256", name: "bursts", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "count",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getLeaderboard",
    outputs: [
      {
        components: [
          { internalType: "address", name: "wallet", type: "address" },
          { internalType: "string", name: "username", type: "string" },
          { internalType: "uint256", name: "score", type: "uint256" },
          { internalType: "uint256", name: "shots", type: "uint256" },
          { internalType: "uint256", name: "bursts", type: "uint256" },
        ],
        internalType: "struct RitualBubbleShooter.Entry[20]",
        name: "",
        type: "tuple[20]",
      },
      { internalType: "uint8", name: "", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "username", type: "string" },
      { internalType: "uint256", name: "score", type: "uint256" },
      { internalType: "uint256", name: "shots", type: "uint256" },
      { internalType: "uint256", name: "bursts", type: "uint256" },
    ],
    name: "submitGame",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
