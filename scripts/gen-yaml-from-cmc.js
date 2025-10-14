#!/usr/bin/env node
/**
 * Generate subgraph-<network>.yaml using:
 *  - CoinMarketCap Listings Latest (ONE call, limit=500)
 *  - Additional REQUIRED tokens (always included)
 *  - EVM-only (ERC-20) per selected network
 *  - Blockscout-compatible creation block lookup
 *
 * Rules:
 *  - --limit controls how many CMC (non-required) tokens to include.
 *  - All additionalTokens for the selected network are ALWAYS included.
 *  - If an additional token's startBlock cannot be resolved, include it with startBlock=0 (warn).
 */

import fs from "node:fs";
import path from "node:path";
import additionalTokens from "./gu-tokens.json" with { type: "json" };

// ===== Network config =====
const NETWORK_CONFIG = {
  mainnet: { chainId: 1, network: "mainnet", explorers: ["https://eth.blockscout.com"] },
  optimism: { chainId: 10, network: "optimism", explorers: ["https://optimism.blockscout.com"] },
  bsc: { chainId: 56, network: "bsc", explorers: ["https://bsc.blockscout.com"] },
  gnosis: { chainId: 100, network: "gnosis", explorers: ["https://gnosis.blockscout.com"] },
  polygon: { chainId: 137, network: "polygon", explorers: ["https://polygon.blockscout.com"] },
  "zksync-era": { chainId: 324, network: "zksync-era", explorers: ["https://zksync.blockscout.com"] },
  "polygon-zkevm": { chainId: 1101, network: "polygon-zkevm", explorers: ["https://polygon-zkevm.blockscout.com"] },
  base: { chainId: 8453, network: "base", explorers: ["https://base.blockscout.com"] },
  "arbitrum-one": { chainId: 42161, network: "arbitrum-one", explorers: ["https://arbitrum.blockscout.com"] },
  avalanche: { chainId: 43114, network: "avalanche", explorers: ["https://avax.blockscout.com"] },
  mantle: { chainId: 5000, network: "mantle", explorers: ["https://mantle.blockscout.com"] },
  linea: { chainId: 59144, network: "linea", explorers: ["https://linea.blockscout.com"] },

  // Extra/testnets you listed/used
  sepolia: { chainId: 11155111, network: "sepolia", explorers: ["https://eth-sepolia.blockscout.com"] },
  joc: { chainId: 81, network: "joc", explorers: ["https://explorer.japanopenchain.org"] },

  // Note: chainId 10081 is NOT configured (no explorer). Those additional tokens
  // will only be included when/if you add a network slug with chainId: 10081.
};

// CMC platform aliases per network slug
const CMC_PLATFORM_ALIASES = {
  mainnet: ["ethereum", "eth", "ethereum-mainnet"],
  optimism: ["optimism"],
  bsc: ["bnb-smart-chain", "binance-smart-chain", "bsc"],
  gnosis: ["gnosis", "xdai", "gno"],
  polygon: ["polygon", "matic", "polygon-pos"],
  "zksync-era": ["zksync", "zksync-era"],
  "polygon-zkevm": ["polygon-zkevm", "zkevm"],
  base: ["base"],
  "arbitrum-one": ["arbitrum", "arbitrum-one"],
  avalanche: ["avalanche", "avalanche-c-chain", "avax"],
  mantle: ["mantle"],
  linea: ["linea"],
  sepolia: ["sepolia", "ethereum-sepolia"],
  joc: ["japan-open-chain", "joc"]
};

// ===== CLI =====
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    network: undefined,
    out: undefined,
    explorer: undefined,
    cmcKey: process.env.CMC_API_KEY || undefined,
    limitOut: 100, // number of CMC (non-required) tokens to add after required ones
    convert: "USD"
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--network" || a === "-n") out.network = String(args[++i]).trim();
    else if (a === "--out" || a === "-o") out.out = String(args[++i]).trim();
    else if (a === "--explorer") out.explorer = String(args[++i]).trim();
    else if (a === "--cmc-key") out.cmcKey = String(args[++i]).trim();
    else if (a === "--limit") out.limitOut = Number(args[++i]); // applies to CMC candidates only
    else if (a === "--convert") out.convert = String(args[++i]).trim();
    else if (a === "--help" || a === "-h") {
      console.log(
`Usage:
  node generate-subgraph.cmc.mjs --network <slug> --limit <N> [--out subgraph-<slug>.yaml] [--explorer <base-url>] [--cmc-key <KEY>] [--convert USD]

Notes:
  - Exactly ONE CMC call (limit=500).
  - All additionalTokens for the selected network are ALWAYS included (mandatory).
  - --limit controls how many EXTRA tokens from CMC are added after required ones.`
      );
      process.exit(0);
    }
  }
  if (!out.network) {
    console.error("Error: --network <slug> is required (e.g., mainnet, base, arbitrum-one).");
    process.exit(1);
  }
  if (!out.cmcKey) {
    console.error("Error: CMC API key is required (--cmc-key or CMC_API_KEY env).");
    process.exit(1);
  }
  if (!Number.isFinite(out.limitOut) || out.limitOut < 0) {
    console.warn("Warn: --limit must be a non-negative integer. Falling back to 100.");
    out.limitOut = 100;
  }
  return out;
}

// ===== Utils =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeStr = (s) => String(s || "").trim().toLowerCase();
const normalizeAddr = (s) => String(s || "").trim().toLowerCase();

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
  const ds = entries.map(
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
  ).join("\n");

  return `${header}${ds}\n`;
}

async function fetchCreationBlock(address, explorers) {
  let lastErr;
  for (const base of explorers) {
    // Preferred: getcontractcreation
    try {
      const url = `${base}/api?module=contract&action=getcontractcreation&contractaddresses=${address}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const ok = j && (j.status === "1" || j.ok === true) && Array.isArray(j.result) && j.result.length > 0;
      if (ok) {
        const bn = Number(j.result[0]?.blockNumber);
        if (!Number.isNaN(bn) && bn > 0) return bn;
      }
    } catch (e) { lastErr = e; }

    // Fallback: earliest tx
    try {
      const url = `${base}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (Array.isArray(j.result) && j.result.length > 0) {
        const bn = Number(j.result[0].blockNumber);
        if (!Number.isNaN(bn) && bn > 0) return bn;
      }
    } catch (e) { lastErr = e; }

    await sleep(150);
  }
  throw new Error(`Failed to resolve creation block for ${address}. Last error: ${lastErr?.message || String(lastErr)}`);
}

function networkMatchesPlatform(networkSlug, platformObj) {
  if (!platformObj) return false;
  const aliases = CMC_PLATFORM_ALIASES[networkSlug] || [];
  const slug = normalizeStr(platformObj.slug);
  const name = normalizeStr(platformObj.name);
  return aliases.some((a) => slug === a || name === a);
}

async function fetchCmcCandidates({ apiKey, networkSlug, convert = "USD" }) {
  if (!CMC_PLATFORM_ALIASES[networkSlug] || CMC_PLATFORM_ALIASES[networkSlug].length === 0) {
    console.warn(`⚠ Network "${networkSlug}" has no CMC platform mapping; no tokens will match.`);
    return [];
  }
  const url = new URL("https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest");
  url.searchParams.set("start", "1");
  url.searchParams.set("limit", "500"); // single call
  url.searchParams.set("convert", convert);

  const res = await fetch(url, { headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CMC HTTP ${res.status} ${text}`);
  }
  const j = await res.json();
  const arr = Array.isArray(j?.data) ? j.data : [];

  const filtered = [];
  for (const item of arr) {
    const platform = item.platform;
    if (platform?.token_address && networkMatchesPlatform(networkSlug, platform)) {
      filtered.push({
        address: String(platform.token_address).trim(),
        symbol: item.symbol,
        name: item.name
      });
    }
  }
  return filtered;
}

function getRequiredTokensForNetwork(chainId) {
  return additionalTokens.filter(t => Number(t.chainId) === Number(chainId))
    .map(t => ({ address: t.address, symbol: t.symbol, name: t.name, _required: true }));
}

(async () => {
  const { network: networkSlug, out, explorer, cmcKey, limitOut, convert } = parseArgs();

  const cfg = NETWORK_CONFIG[networkSlug];
  if (!cfg) {
    console.error(`Unknown network "${networkSlug}". Please add it to NETWORK_CONFIG with a chainId and explorer list.`);
    process.exit(1);
  }
  const explorers = explorer ? [explorer] : cfg.explorers;

  // 1) Build candidate list = required(additionalTokens) + CMC(500) filtered
  const required = getRequiredTokensForNetwork(cfg.chainId);
  const cmcCandidates = await fetchCmcCandidates({ apiKey: cmcKey, networkSlug, convert });

  // Deduplicate by address (required tokens take precedence)
  const seen = new Set(required.map(t => normalizeAddr(t.address)));
  const nonRequired = [];
  for (const t of cmcCandidates) {
    const key = normalizeAddr(t.address);
    if (!seen.has(key)) {
      nonRequired.push({ ...t, _required: false });
      seen.add(key);
    }
  }

  console.log(`Required tokens for ${networkSlug}: ${required.length}`);
  console.log(`CMC candidates for ${networkSlug}: ${nonRequired.length} (after dedupe)`);

  // 2) Resolve startBlock: required FIRST (always included; fallback startBlock=0), then CMC up to --limit
  const results = [];

  // Required tokens
  for (const t of required) {
    const address = String(t.address).trim();
    const dsName = sanitizeName(t.symbol || t.name || address, address.slice(0, 10));
    let startBlock = 0;
    try {
      startBlock = await fetchCreationBlock(address, explorers);
      console.log(`✔ Added required token ${dsName} (${address}) startBlock=${startBlock}`);
    } catch (e) {
      console.warn(`⚠ Required token ${dsName} (${address}) creation block lookup failed; using startBlock=0`);
    }
    results.push({ name: dsName, network: cfg.network, address, startBlock });
    await sleep(120);
  }

  // Non-required CMC tokens (stop when reaching --limit for this section)
  let added = 0;
  for (const t of nonRequired) {
    if (added >= limitOut) break;
    const address = String(t.address).trim();
    const dsName = sanitizeName(t.symbol || t.name || address, address.slice(0, 10));
    try {
      const startBlock = await fetchCreationBlock(address, explorers);
      results.push({ name: dsName, network: cfg.network, address, startBlock });
      added++;
      console.log(`✔ Added CMC ${dsName} (${address}) startBlock=${startBlock} (${added}/${limitOut})`);
    } catch (e) {
      console.warn(`⚠ Skip CMC ${dsName} (${address}): ${e?.message || e}`);
    }
    await sleep(120);
  }

  if (!results.length) {
    console.error("No tokens produced a startBlock. Exiting.");
    process.exit(1);
  }

  // 3) Sort & write YAML
  results.sort((a, b) => a.name.localeCompare(b.name));
  const yaml = renderSubgraphYaml(results);
  const defaultOut = `subgraph-${networkSlug}.yaml`;
  const outPath = path.resolve(process.cwd(), out ?? defaultOut);
  fs.writeFileSync(outPath, yaml, "utf8");
  console.log(`\n✅ Wrote: ${outPath}`);

  // 4) Copy to subgraph.yaml
  fs.copyFileSync(outPath, path.resolve(process.cwd(), "subgraph.yaml"));
  console.log(`\n✅ Copied: ${path.resolve(process.cwd(), "subgraph.yaml")}`);

  // 5) Info
  console.log(`\nSummary for ${networkSlug}:
  - Required tokens included: ${required.length}
  - CMC tokens included: ${added}/${limitOut}
  - Total dataSources: ${results.length}`);
})().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});