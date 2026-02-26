/**
 * scripts/fetch-and-publish.js
 *
 * Runs inside GitHub Actions. Uses the secret COINGECKO_API_KEY to call
 * CoinGecko, then writes clean JSON to data/coins.json.
 * GitHub Pages then serves that file at a public URL.
 * The HTML on Wix fetches from that public URL — the API key never
 * touches the browser.
 *
 * CoinGecko Demo API endpoints used:
 *
 *   GET /coins/markets
 *     ?vs_currency=usd
 *     &category=stablecoins
 *     &order=market_cap_desc
 *     &per_page=50
 *     &price_change_percentage=200d   ← closest to "6 months" on Demo plan
 *     &sparkline=false
 *   → market_cap, name, symbol, image (logo), market_cap_rank,
 *     price_change_percentage_200d_in_currency
 *
 *   GET /coins/{id}
 *     ?localization=false&tickers=false&market_data=false
 *   → genesis_date  (used to derive launch year for the X axis)
 */

import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_DIR   = join(ROOT, 'data');
const OUT_FILE  = join(OUT_DIR, 'coins.json');

const API_KEY = process.env.COINGECKO_API_KEY;
const BASE    = 'https://api.coingecko.com/api/v3';

if (!API_KEY) {
  console.error('ERROR: COINGECKO_API_KEY environment variable is not set.');
  process.exit(1);
}

// ─── Supplemental issuer names (CoinGecko has no dedicated issuer field) ─────
const ISSUER_MAP = {
  'tether':                                                    'Tether',
  'usd-coin':                                                  'Circle',
  'dai':                                                       'Sky/MakerDAO',
  'ethena-usde':                                               'Ethena',
  'paypal-usd':                                                'PayPal/Paxos',
  'blackrock-usd-institutional-digital-liquidity-fund':        'BlackRock',
  'usd1':                                                      'World Liberty Fi',
  'usdd':                                                      'Tron DAO',
  'first-digital-usd':                                         'First Digital',
  'true-usd':                                                  'Archblock',
  'ondo-us-dollar-yield':                                      'Ondo Finance',
  'gho':                                                       'Aave',
  'eurc':                                                      'Circle',
  'frax':                                                      'Frax Finance',
  'frax-usd':                                                  'Frax Finance',
  'gemini-dollar':                                             'Gemini',
  'pax-dollar':                                                'Paxos',
  'liquity-usd':                                               'Liquity',
  'celo-dollar':                                               'Celo',
  'celo-euro':                                                 'Celo',
  'ampleforth':                                                'Ampleforth',
  'origin-dollar':                                             'Origin',
  'busd':                                                      'Binance/Paxos',
  'xsgd':                                                      'StraitsX',
  'gyen':                                                      'GMO Trust',
  'eurs':                                                      'Stasis',
  'mountain-protocol-usdm':                                    'Mountain Protocol',
  'agora-dollar':                                              'Agora',
  'usual-usd':                                                 'Usual',
  'ripple-usd':                                                'Ripple',
  'usd-plus':                                                  'Overnight',
  'stasis-eurs':                                               'Stasis',
  'glo-dollar':                                                'Glo Foundation',
  'alchemix-usd':                                              'Alchemix',
  'sky-usd':                                                   'Sky/MakerDAO',
  'lisusd':                                                    'Lista',
  'falcon-usd':                                                'Falcon Finance',
  'global-dollar':                                             'Paxos',
  'aegis-yusd':                                                'Aegis',
  'blast-usd':                                                 'Blast',
  'eurite':                                                    'Membrane Finance',
  'stablr-usd':                                                'StablR',
  'anchored-euro':                                             'Anchored Coins',
  'eur-coinvertible':                                          'SG Forge',
  'mnee':                                                      'MNEE',
  'braziliandigitaltoken':                                     'Transfero',
  'usdk':                                                      'OKCoin',
  'hyperliquid-usd':                                           'Hyperliquid',
  'standx-dusd':                                               'StandX',
  'metamask-usd':                                              'MetaMask',
  'united-stables':                                            'United Stables',
};

// ─── API helper ───────────────────────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('x_cg_demo_api_key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CoinGecko ${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Extract launch year from coin detail ─────────────────────────────────────
function extractYear(detail) {
  if (detail?.genesis_date) {
    const y = parseInt(detail.genesis_date.substring(0, 4));
    if (y > 2000 && y <= 2030) return y;
  }
  // Fallback: use the all-time-low date as a proxy for earliest known activity
  if (detail?.market_data?.atl_date?.usd) {
    const y = parseInt(detail.market_data.atl_date.usd.substring(0, 4));
    if (y > 2000 && y <= 2030) return y;
  }
  return new Date().getFullYear();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Stablecoin Lifecycle Map — CoinGecko Data Fetch');
  console.log(`  ${new Date().toUTCString()}`);
  console.log('══════════════════════════════════════════════════\n');

  // ── Step 1: /coins/markets ────────────────────────────────────────────────
  console.log('Step 1/3  GET /coins/markets (stablecoins, top 50)…');
  const markets = await apiGet('/coins/markets', {
    vs_currency:             'usd',
    category:                'stablecoins',
    order:                   'market_cap_desc',
    per_page:                '50',
    page:                    '1',
    sparkline:               'false',
    price_change_percentage: '200d',
    locale:                  'en',
  });
  console.log(`          Got ${markets.length} coins.\n`);

  // ── Step 2: /coins/{id} for genesis dates ─────────────────────────────────
  console.log('Step 2/3  GET /coins/{id} for genesis dates…');
  const details = new Array(markets.length).fill(null);
  const BATCH   = 5;

  for (let i = 0; i < markets.length; i += BATCH) {
    const slice = markets.slice(i, i + BATCH);
    const labels = slice.map(c => c.symbol.toUpperCase()).join(', ');
    process.stdout.write(`          [${String(i + 1).padStart(2)}–${String(Math.min(i + BATCH, markets.length)).padStart(2)}/${markets.length}]  ${labels}\n`);

    const results = await Promise.allSettled(
      slice.map(c =>
        apiGet(`/coins/${c.id}`, {
          localization:    'false',
          tickers:         'false',
          market_data:     'false',
          community_data:  'false',
          developer_data:  'false',
        })
      )
    );

    results.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        details[i + j] = r.value;
      } else {
        console.warn(`          WARN: ${slice[j].id} — ${r.reason?.message}`);
      }
    });

    // Polite delay between batches (Demo plan: 30 req/min)
    if (i + BATCH < markets.length) await sleep(400);
  }

  // ── Step 3: Merge & write ─────────────────────────────────────────────────
  console.log('\nStep 3/3  Merging and writing data/coins.json…');

  const coins = markets.map((m, i) => {
    const detail = details[i];
    const year   = extractYear(detail);
    const growth = m.price_change_percentage_200d_in_currency;

    return {
      rank:   m.market_cap_rank || i + 1,
      name:   m.name,
      ticker: m.symbol.toUpperCase(),
      mcap:   parseFloat(((m.market_cap || 0) / 1e9).toFixed(4)),  // $B, 4dp
      year,
      growth: (growth !== null && growth !== undefined) ? Math.round(growth) : null,
      issuer: ISSUER_MAP[m.id] || '—',
      image:  m.image || null,
      id:     m.id,
    };
  });

  const output = {
    generated_at: new Date().toISOString(),
    coin_count:   coins.length,
    coins,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n✓  Wrote ${coins.length} coins to data/coins.json`);
  console.log(`   Top 3: ${coins.slice(0, 3).map(c => `${c.ticker} $${c.mcap}B`).join('  ·  ')}`);
  console.log(`   Timestamp: ${output.generated_at}\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
