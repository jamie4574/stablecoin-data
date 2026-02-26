/**
 * scripts/fetch-and-publish.js
 *
 * Fetches top 50 stablecoins → writes data/coins.json
 *
 * WHY HARDCODED LAUNCH YEARS:
 * CoinGecko's genesis_date field is null for the majority of stablecoins,
 * even major ones like USDC, DAI, USDT. The ATL date fallback is also
 * unreliable (returns dates CoinGecko started tracking, not actual launch).
 * Since launch years are historical facts that never change, a curated map
 * is far more accurate than any API field.
 *
 * GROWTH METRIC:
 * Price change is meaningless for stablecoins (pegged to $1).
 * We use 6-month MARKET CAP change via /coins/{id}/market_chart?days=180.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT     = join(__dirname, '..');
const OUT_DIR  = join(ROOT, 'data');
const OUT_FILE = join(OUT_DIR, 'coins.json');

const API_KEY = process.env.COINGECKO_API_KEY;
const BASE    = 'https://api.coingecko.com/api/v3';
const DELAY   = 2500; // ms between calls — keeps us well under 30 req/min

if (!API_KEY) {
  console.error('ERROR: COINGECKO_API_KEY is not set.');
  process.exit(1);
}

// ─── Hardcoded launch years (CoinGecko genesis_date is null for most coins) ──
// Keyed by CoinGecko coin ID. Source: official announcements / whitepaper dates.
const LAUNCH_YEAR = {
  // Major USD stablecoins
  'tether':                   2014,  // Tether USDT — Oct 2014
  'usd-coin':                 2018,  // USDC — Sep 2018 (Circle/Coinbase)
  'dai':                      2017,  // DAI — Dec 2017 (MakerDAO)
  'usds':                     2024,  // USDS rebranded from DAI Aug 2024
  'ethena-usde':              2024,  // USDe — Feb 2024
  'usd1-wlfi':                2025,  // USD1 — Mar 2025
  'paypal-usd':               2023,  // PYUSD — Aug 2023
  'usdd':                     2022,  // USDD — May 2022
  'first-digital-usd':        2023,  // FDUSD — Jun 2023
  'true-usd':                 2018,  // TUSD — Mar 2018
  'ondo-us-dollar-yield':     2023,  // USDY — Aug 2023
  'gho':                      2023,  // GHO — Jul 2023
  'usual-usd':                2024,  // USD0 — 2024
  'agora-dollar':             2024,  // AUSD — 2024
  'frax':                     2020,  // FRAX — Dec 2020
  'frax-usd':                 2024,  // FRXUSD — 2024
  'gemini-dollar':            2018,  // GUSD — Sep 2018
  'gusd':                     2024,  // New GUSD token — different from Gemini Dollar
  'pax-dollar':               2018,  // USDP (formerly PAX) — Sep 2018
  'global-dollar':            2024,  // USDG — 2024 (Paxos)
  'liquity-usd':              2021,  // LUSD — Apr 2021
  'celo-dollar':              2020,  // cUSD — Apr 2020
  'celo-euro':                2021,  // cEUR — 2021
  'ampleforth':               2019,  // AMPL — Jun 2019
  'origin-dollar':            2020,  // OUSD — Sep 2020
  'busd':                     2019,  // BUSD — Sep 2019 (original)
  'binance-peg-busd':         2020,  // Binance-Peg BUSD — 2020
  'xsgd':                     2020,  // XSGD — Aug 2020
  'gyen':                     2021,  // GYEN — 2021
  'stasis-eurs':              2018,  // EURS — 2018
  'mountain-protocol-usdm':   2023,  // USDM — 2023
  'ripple-usd':               2024,  // RLUSD — Dec 2024
  'usd-plus':                 2022,  // USD+ — 2022
  'glo-dollar':               2022,  // USDGLO — 2022
  'alchemix-usd':             2021,  // alUSD — 2021
  'lisusd':                   2023,  // lisUSD — 2023
  'falcon-finance':           2025,  // Falcon USD — 2025
  'aegis-yusd':               2024,  // YUSD — 2024
  'eurite':                   2023,  // EURI — 2023
  'anchored-euro':            2022,  // AEUR — 2022
  'eur-coinvertible':         2023,  // EURCV — 2023
  'mnee-usd-stablecoin':      2024,  // MNEE — 2024
  'standx-dusd':              2024,  // DUSD — 2024
  'blackrock-usd-institutional-digital-liquidity-fund': 2024, // BUIDL — Mar 2024
  'crvusd':                   2023,  // crvUSD — May 2023
  'dola-usd':                 2022,  // DOLA — 2022
  'resolv-usr':               2024,  // USR — 2024
  'astherus-usdf':            2024,  // USDF — 2024
  'anzen-usdz':               2024,  // USDz — 2024
  'xdai':                     2018,  // xDAI — Oct 2018
  'kinesis-gold':             2019,  // KAU — 2019
  'tether-gold':              2020,  // XAUt — Jan 2020
  'pax-gold':                 2019,  // PAXG — Sep 2019
  'euro-coin':                2022,  // EURC — Jun 2022 (Circle)
  'ibc-bridged-usdc':         2023,  // Noble USDC — 2023
  'bfusd':                    2024,  // BFUSD — 2024
  'usdtb':                    2024,  // USDtb — Dec 2024
  'a7a5':                     2025,  // A7A5 — 2025
  'satoshi-stablecoin':       2024,  // SATUSD — 2024
  'cap-usd':                  2025,  // cUSD — 2025
  'avant-usd':                2024,  // avUSD — 2024
  'nusd-2':                   2025,  // NUSD — 2025
  'ylds':                     2025,  // YLDS — 2025
  'usda-2':                   2024,  // USDa — 2024
  'usda-3':                   2025,  // USDA — 2025
  'cash-4':                   2025,  // CASH — 2025
  'usx':                      2025,  // USX — 2025
  'pleasing-usd':             2025,  // PUSD — 2025
  'pleasing-gold':            2025,  // PGOLD — 2025
  'ring-usd':                 2025,  // USDR — 2025
  'precious-metals-usd':      2025,  // PMUSD — 2025
};

// ─── Issuer map — keyed by CoinGecko coin ID ─────────────────────────────────
const ISSUER_MAP = {
  'tether':                   'Tether',
  'usd-coin':                 'Circle',
  'ibc-bridged-usdc':         'Circle',
  'euro-coin':                'Circle',
  'usds':                     'Sky / MakerDAO',
  'dai':                      'Sky / MakerDAO',
  'ethena-usde':              'Ethena',
  'usdtb':                    'Ethena / BlackRock',
  'paypal-usd':               'PayPal / Paxos',
  'usd1-wlfi':                'World Liberty Fi',
  'usdd':                     'Tron DAO',
  'first-digital-usd':        'First Digital',
  'true-usd':                 'Archblock',
  'ondo-us-dollar-yield':     'Ondo Finance',
  'gho':                      'Aave',
  'usual-usd':                'Usual',
  'agora-dollar':             'Agora',
  'frax':                     'Frax Finance',
  'frax-usd':                 'Frax Finance',
  'gemini-dollar':            'Gemini',
  'gusd':                     'Gemini',
  'pax-dollar':               'Paxos',
  'global-dollar':            'Paxos',
  'pax-gold':                 'Paxos',
  'tether-gold':              'Tether',
  'liquity-usd':              'Liquity',
  'celo-dollar':              'Celo',
  'celo-euro':                'Celo',
  'ampleforth':               'Ampleforth',
  'origin-dollar':            'Origin Protocol',
  'busd':                     'Binance / Paxos',
  'binance-peg-busd':         'Binance / Paxos',
  'bfusd':                    'Binance',
  'xsgd':                     'StraitsX',
  'gyen':                     'GMO Trust',
  'stasis-eurs':              'Stasis',
  'mountain-protocol-usdm':   'Mountain Protocol',
  'ripple-usd':               'Ripple',
  'usd-plus':                 'Overnight Finance',
  'glo-dollar':               'Glo Foundation',
  'alchemix-usd':             'Alchemix',
  'lisusd':                   'Lista DAO',
  'falcon-finance':           'Falcon Finance',
  'aegis-yusd':               'Aegis',
  'eurite':                   'Membrane Finance',
  'anchored-euro':            'Anchored Coins',
  'eur-coinvertible':         'Société Générale',
  'mnee-usd-stablecoin':      'MNEE',
  'standx-dusd':              'StandX',
  'blackrock-usd-institutional-digital-liquidity-fund': 'BlackRock',
  'crvusd':                   'Curve Finance',
  'dola-usd':                 'Inverse Finance',
  'resolv-usr':               'Resolv Labs',
  'astherus-usdf':            'Astherus',
  'anzen-usdz':               'Anzen Finance',
  'xdai':                     'Gnosis',
  'kinesis-gold':             'Kinesis Money',
  'a7a5':                     'A7A5',
  'satoshi-stablecoin':       'Satoshi Labs',
  'cap-usd':                  'Cap Protocol',
  'avant-usd':                'Avant',
  'nusd-2':                   'Neutrl',
};

// ─── API helper with rate limit retry ────────────────────────────────────────
async function apiGet(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('x_cg_demo_api_key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = 15000 * attempt;
      console.warn(`    Rate limited — waiting ${wait/1000}s...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }
  throw new Error(`All retries failed: ${path}`);
}

// ─── 6-month market cap % growth ─────────────────────────────────────────────
async function getMcapGrowth(id) {
  try {
    const data = await apiGet(`/coins/${id}/market_chart`, {
      vs_currency: 'usd',
      days: '180',
    });
    await sleep(DELAY);
    const caps = data?.market_caps;
    if (!caps || caps.length < 10) return null;
    const oldest = caps[0][1];
    const newest = caps[caps.length - 1][1];
    if (!oldest || oldest === 0) return null;
    return Math.round(((newest - oldest) / oldest) * 100);
  } catch {
    await sleep(DELAY);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n════════════════════════════════════════');
  console.log('  Stablecoin Map — Data Refresh');
  console.log(`  ${new Date().toUTCString()}`);
  console.log('════════════════════════════════════════\n');

  // Step 1: Top 50 stablecoins by market cap
  console.log('Step 1/2  GET /coins/markets...');
  const markets = await apiGet('/coins/markets', {
    vs_currency: 'usd',
    category:    'stablecoins',
    order:       'market_cap_desc',
    per_page:    '50',
    page:        '1',
    sparkline:   'false',
    locale:      'en',
  });
  await sleep(DELAY);
  console.log(`          Got ${markets.length} coins\n`);

  // Step 2: Market cap growth for each coin (1 API call each)
  // At 2.5s per call × 50 coins = ~2 min total
  console.log('Step 2/2  Fetching 6-month market cap growth...');
  console.log('          ~2 minutes. Launch years from curated map (more accurate than API).\n');

  const nowYear = new Date().getFullYear();
  const coins = [];

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const ticker = m.symbol.toUpperCase();
    process.stdout.write(`  [${String(i+1).padStart(2)}/${markets.length}] ${ticker.padEnd(12)}`);

    const growth = await getMcapGrowth(m.id);
    const year   = LAUNCH_YEAR[m.id] || nowYear;

    const gStr = growth !== null ? `${growth >= 0 ? '+' : ''}${growth}%` : 'n/a';
    const yStr = LAUNCH_YEAR[m.id] ? String(year) : `${year} (unknown)`;
    process.stdout.write(`year:${yStr.padEnd(16)} mcap-growth:${gStr}\n`);

    coins.push({
      rank:   m.market_cap_rank || i + 1,
      name:   m.name,
      ticker,
      mcap:   parseFloat(((m.market_cap || 0) / 1e9).toFixed(4)),
      year,
      growth,
      issuer: ISSUER_MAP[m.id] || '—',
      image:  m.image || null,
      id:     m.id,
    });
  }

  // Write output
  const output = { generated_at: new Date().toISOString(), coin_count: coins.length, coins };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const withGrowth  = coins.filter(c => c.growth !== null).length;
  const unknownYear = coins.filter(c => !LAUNCH_YEAR[c.id]).length;
  console.log(`\n✓  Wrote ${coins.length} coins to data/coins.json`);
  console.log(`   Growth data: ${withGrowth}/${coins.length}`);
  if (unknownYear > 0) {
    console.log(`   ⚠ ${unknownYear} coins not in LAUNCH_YEAR map — add their IDs:`);
    coins.filter(c => !LAUNCH_YEAR[c.id]).forEach(c => console.log(`     '${c.id}': YEAR,  // ${c.name}`));
  } else {
    console.log(`   Launch years: all ${coins.length} coins mapped ✓`);
  }
  console.log();
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
