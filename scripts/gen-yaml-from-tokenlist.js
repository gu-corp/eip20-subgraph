#!/usr/bin/env node
/**
 * Generate subgraph-<network>.yaml from a token list for a given network.
 * - Filters tokens by chainId mapped from a network slug
 * - Resolves contract creation block via Blockscout-compatible API
 * - Writes subgraph YAML for EIP-20 Transfer handler
 *
 * Usage:
 *   node generate-subgraph.mjs --network mainnet
 *   node generate-subgraph.mjs -n sepolia
 *   node generate-subgraph.mjs -n japanopenchain --out custom.yaml
 */

const TOKENLIST_URL =
  "https://raw.githubusercontent.com/x-gate-project/x-swap-token-list/main/tokenlist.json";

// Node 18+ provides global fetch
import fs from "node:fs";
import path from "node:path";

// ===== Config: network → chainId + explorers =====
// network: The Graph "network" slug
// explorers: Blockscout-style base URLs (no trailing slash)
const NETWORK_CONFIG = {
  // Common L1/L2
  mainnet: {
    chainId: 1,
    network: "mainnet",
    explorers: ["https://eth.blockscout.com"],
  },
  optimism: {
    chainId: 10,
    network: "optimism",
    explorers: ["https://optimism.blockscout.com"],
  },
  bsc: {
    chainId: 56,
    network: "bsc",
    explorers: ["https://bsc.blockscout.com"],
  },
  gnosis: {
    chainId: 100,
    network: "gnosis",
    explorers: ["https://gnosis.blockscout.com"],
  },
  polygon: {
    chainId: 137,
    network: "polygon",
    explorers: ["https://polygon.blockscout.com"],
  },
  "zksync-era": {
    chainId: 324,
    network: "zksync-era",
    explorers: ["https://zksync.blockscout.com"],
  },
  "polygon-zkevm": {
    chainId: 1101,
    network: "polygon-zkevm",
    explorers: ["https://polygon-zkevm.blockscout.com"],
  },
  base: {
    chainId: 8453,
    network: "base",
    explorers: ["https://base.blockscout.com"],
  },
  "arbitrum-one": {
    chainId: 42161,
    network: "arbitrum-one",
    explorers: ["https://arbitrum.blockscout.com"],
  },
  avalanche: {
    chainId: 43114,
    network: "avalanche",
    explorers: ["https://avax.blockscout.com"],
  },
  mantle: {
    chainId: 5000,
    network: "mantle",
    explorers: ["https://mantle.blockscout.com"],
  },
  linea: {
    chainId: 59144,
    network: "linea",
    explorers: ["https://linea.blockscout.com"],
  },

  // Requested additions
  sepolia: {
    chainId: 11155111,
    network: "sepolia",
    explorers: ["https://eth-sepolia.blockscout.com"],
  },
  joc: {
    chainId: 81,
    network: "joc",
    explorers: ["https://explorer.japanopenchain.org"],
  },
};

// ===== CLI =====
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { network: undefined, out: undefined, explorer: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--network" || a === "-n") out.network = String(args[++i]).trim();
    else if (a === "--out" || a === "-o") out.out = String(args[++i]).trim();
    else if (a === "--explorer")
      out.explorer = String(args[++i]).trim(); // optional override
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: node generate-subgraph.mjs --network <slug> [--out subgraph-<slug>.yaml] [--explorer <base-url>]`
      );
      process.exit(0);
    }
  }
  if (!out.network) {
    console.error(
      "Error: --network <slug> is required (e.g., mainnet, sepolia, joc)."
    );
    process.exit(1);
  }
  return out;
}

// ===== Utils =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeName(nameOrSymbol, fallback) {
  const s = (nameOrSymbol ?? "").trim();
  if (!s) return fallback;
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 64);
}

function renderSubgraphYaml(entries) {
  const header = `specVersion: 0.0.5
description: EIP-20
repository: https://github.com/gu-corp/eip20-subgraph
schema:
  file: ./schema.graphql
templates:
  - kind: ethereum/contract
    name: EIP20
    network: ${entries[0].network}
    source:
      abi: IERC20
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.6
      language: wasm/assemblyscript
      entities:
        - ERC20Contract
      abis:
        - name: IERC20
          file: ./node_modules/@openzeppelin/contracts/build/contracts/IERC20Metadata.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
      file: ./src/mapping.ts
dataSources:
`;
  const ds = entries
    .map(
      (e) => `  - kind: ethereum/contract
    name: ${e.name}
    network: ${e.network}
    source:
      address: "${e.address}"
      abi: IERC20
      startBlock: ${e.startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.6
      language: wasm/assemblyscript
      entities:
        - ERC20Contract
      abis:
        - name: IERC20
          file: ./node_modules/@openzeppelin/contracts/build/contracts/IERC20Metadata.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleTransfer
      file: ./src/mapping.ts`
    )
    .join("\n");

  return `${header}${ds}\n`;
}

/**
 * Resolve the creation block for a contract address using a Blockscout-compatible API.
 * 1) Try module=contract&action=getcontractcreation
 * 2) Fallback to module=account&action=txlist (first tx, asc)
 */
async function fetchCreationBlock(address, explorers) {
  let lastErr;
  for (const base of explorers) {
    // (1) Preferred: getcontractcreation
    try {
      const url = `${base}/api?module=contract&action=getcontractcreation&contractaddresses=${address}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const ok =
        j &&
        (j.status === "1" || j.ok === true) &&
        Array.isArray(j.result) &&
        j.result.length > 0;
      if (ok) {
        const bn = Number(j.result[0]?.blockNumber);
        if (!Number.isNaN(bn) && bn > 0) return bn;
      }
    } catch (e) {
      lastErr = e;
    }

    // (2) Fallback: earliest tx
    try {
      const url = `${base}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (Array.isArray(j.result) && j.result.length > 0) {
        const bn = Number(j.result[0].blockNumber);
        if (!Number.isNaN(bn) && bn > 0) return bn;
      }
    } catch (e) {
      lastErr = e;
    }

    await sleep(150);
  }
  throw new Error(
    `Failed to resolve creation block for ${address}. Last error: ${lastErr?.message || String(lastErr)}`
  );
}

// ===== Main =====
(async () => {
  const { network: networkSlug, out, explorer } = parseArgs();

  const cfg = NETWORK_CONFIG[networkSlug];
  if (!cfg) {
    console.error(
      `Unknown network "${networkSlug}". Please add it to NETWORK_CONFIG with a chainId and explorer list.`
    );
    process.exit(1);
  }

  const explorers = explorer ? [explorer] : cfg.explorers;

  // 1) Fetch token list
  const tokenListRes = await fetch(TOKENLIST_URL);
  if (!tokenListRes.ok) {
    console.error(`Failed to fetch token list: HTTP ${tokenListRes.status}`);
    process.exit(1);
  }
  const tokenList = await tokenListRes.json();

  // 2) Filter by chainId
  const tokens = (tokenList.tokens || []).filter(
    (t) => Number(t.chainId) === cfg.chainId
  );
  if (!tokens.length) {
    console.error(
      `No tokens found for chainId ${cfg.chainId} (${networkSlug}) in the token list.`
    );
    process.exit(1);
  }

  console.log(
    `Found ${tokens.length} token(s) on ${networkSlug} (chainId=${cfg.chainId}). Resolving creation blocks...`
  );

  // 3) Resolve startBlock per token
  const results = [];
  for (const t of tokens) {
    const address = String(t.address).trim();
    const symbol = t.symbol ?? "";
    const name = t.name ?? symbol ?? address;
    const dsName = sanitizeName(symbol || name, address.slice(0, 10));

    try {
      const startBlock = await fetchCreationBlock(address, explorers);
      results.push({ name: dsName, network: cfg.network, address, startBlock });
      console.log(`✔ ${dsName} (${address}) startBlock=${startBlock}`);
    } catch (e) {
      console.warn(`⚠ Skipping ${dsName} (${address}): ${e?.message || e}`);
    }

    // gentle rate limit
    await sleep(120);
  }

  if (!results.length) {
    console.error("No tokens produced a startBlock. Exiting.");
    process.exit(1);
  }

  // 4) Sort & write YAML
  results.sort((a, b) => a.name.localeCompare(b.name));
  const yaml = renderSubgraphYaml(results);
  const defaultOut = `subgraph-${networkSlug}.yaml`;
  const outPath = path.resolve(process.cwd(), out ?? defaultOut);
  fs.writeFileSync(outPath, yaml, "utf8");
  console.log(`\n✅ Wrote: ${outPath}`);

  // 5) Copy to subgraph.yaml
  fs.copyFileSync(outPath, path.resolve(process.cwd(), "subgraph.yaml"));
  console.log(`\n✅ Copied: ${path.resolve(process.cwd(), "subgraph.yaml")}`);
})().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
