/**
 * scripts/fetch-and-publish.js
 *
 * Fetches top 50 stablecoins → writes data/coins.json
 *
 * Three API calls per coin:
 *   1. /coins/markets          → market cap, name, image, rank
 *   2. /coins/{id}/market_chart?days=180  → market cap history → 6-month % growth
 *      NOTE: price change is meaningless for stablecoins (pegged to $1).
 *      We measure MARKET CAP growth instead.
 *   3. /coins/{id}             → genesis_date → launch year for X axis
 *
 * Rate limit: Demo API = 30 req/min. We do 1 call per 2.5s = 24/min, safe.
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
const DELAY   = 2500; // ms between calls

if (!API_KEY) {
  console.error('ERROR: COINGECKO_API_KEY is not set.');
  process.exit(1);
}

// ─── Issuer map — keyed by REAL CoinGecko IDs from the live feed ─────────────
// Confirmed against: jamie4574.github.io/stablecoin-data/data/coins.json
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
  'stablr-usd':               'StablR',
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
  'usda-2':                   'Acre DAO',
  'satoshi-stablecoin':       'Satoshi Labs',
  'cap-usd':                  'Cap Protocol',
  'avant-usd':                'Avant',
  'nusd-2':                   'Neutrl',
};

// ─── API helper with retry on 429 ─────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('x_cg_demo_api_key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = 15000 * attempt;
      console.warn(`    Rate limited, waiting ${wait/1000}s...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }
  throw new Error(`Failed after retries: ${path}`);
}

// ─── 6-month market cap % growth ─────────────────────────────────────────────
async function getMcapGrowth(id) {
  try {
    const data = await apiGet(`/coins/${id}/market_chart`, {
      vs_currency: 'usd',
      days:        '180',
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

// ─── Launch year from genesis_date ───────────────────────────────────────────
async function getLaunchYear(id) {
  try {
    const d = await apiGet(`/coins/${id}`, {
      localization:   'false',
      tickers:        'false',
      market_data:    'true',   // need atl_date as fallback
      community_data: 'false',
      developer_data: 'false',
    });
    await sleep(DELAY);

    // Primary: genesis_date
    if (d?.genesis_date) {
      const y = parseInt(d.genesis_date.slice(0, 4));
      if (y >= 2009 && y <= 2030) return y;
    }
    // Fallback: earliest ATL date
    const atlDate = d?.market_data?.atl_date?.usd;
    if (atlDate) {
      const y = parseInt(atlDate.slice(0, 4));
      if (y >= 2009 && y <= 2030) return y;
    }
    return null;
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

  // Step 2: Enrich each coin (2 calls each: market_chart + coin detail)
  // At 2.5s per call × 2 calls × 50 coins = ~4 min total. Fine for a daily job.
  console.log('Step 2/2  Enriching coins (market cap growth + launch year)...');
  console.log('          ~4 minutes at safe rate limit. Hang tight.\n');

  const coins = [];
  const nowYear = new Date().getFullYear();

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const ticker = m.symbol.toUpperCase();
    process.stdout.write(`  [${String(i+1).padStart(2)}/${markets.length}] ${ticker.padEnd(12)}`);

    const growth = await getMcapGrowth(m.id);
    const year   = await getLaunchYear(m.id) || nowYear;

    const gStr = growth !== null ? `${growth >= 0 ? '+' : ''}${growth}%` : 'n/a';
    process.stdout.write(`year:${year}  mcap-growth:${gStr}\n`);

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

  const withGrowth = coins.filter(c => c.growth !== null).length;
  const withYear   = coins.filter(c => c.year !== nowYear).length;
  console.log(`\n✓  Wrote ${coins.length} coins to data/coins.json`);
  console.log(`   Growth data: ${withGrowth}/${coins.length}`);
  console.log(`   Year data:   ${withYear}/${coins.length}\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
