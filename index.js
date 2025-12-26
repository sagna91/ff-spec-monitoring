import { chromium } from "playwright";

const SPEC_PAGE = "https://freshforex.com/traders/trading/specification-forex/";
const API_URL = "https://freshforex.com/api/specification-param/";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_TOKEN = process.env.N8N_TOKEN;

if (!N8N_WEBHOOK_URL) throw new Error("Missing env N8N_WEBHOOK_URL");
if (!N8N_TOKEN) throw new Error("Missing env N8N_TOKEN");

const BASE_FORM = {
  symbol_group: "1",
  currency: "USD",
  leverage: "2000",
  lot: "1",
};

const ACCOUNTS = [
  { type_account: "1", account_type: "Classic" },
  { type_account: "2", account_type: "Market Pro" },
  { type_account: "3", account_type: "ECN" },
];

async function main() {
  const fetched_at = new Date().toISOString();
  const allRecords = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  // Открываем страницу, чтобы пройти CF в браузерном контексте
  await page.goto(SPEC_PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  for (const acc of ACCOUNTS) {
    const form = { ...BASE_FORM, type_account: acc.type_account };

    const resp = await page.request.post(API_URL, {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json, text/javascript, */*; q=0.01",
        referer: SPEC_PAGE,
      },
      form,
    });

    const status = resp.status();
    const text = await resp.text();

    console.log(`[${acc.account_type}] API status:`, status);

    if (status !== 200) {
      console.log(`[${acc.account_type}] non-200 body:`, text.slice(0, 300));
      continue;
    }
    if (text.trim().startsWith("<")) {
      console.log(`[${acc.account_type}] got HTML (CF?):`, text.slice(0, 300));
      continue;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log(`[${acc.account_type}] JSON parse error. Body:`, text.slice(0, 300));
      continue;
    }

    const keys = Object.keys(data || {});
    console.log(`[${acc.account_type}] keys:`, keys.slice(0, 10));

    let added = 0;
    for (const [symbol, v] of Object.entries(data || {})) {
      if (!v || typeof v !== "object") continue;
      if (v.spread === undefined || v.swap_long === undefined || v.swap_short === undefined) continue;

      allRecords.push({
        key: `${acc.account_type}||${symbol}`,
        fetched_at,
        account_type: acc.account_type,
        symbol,
        spread: v.spread,
        swap_long: v.swap_long,
        swap_short: v.swap_short,
        source: `${API_URL} (type_account=${acc.type_account})`,
      });
      added++;
    }

    console.log(`[${acc.account_type}] added records:`, added);
  }

  await browser.close();

  console.log("Webhook host:", new URL(N8N_WEBHOOK_URL).hostname);
  console.log("Records:", allRecords.length);

  const payload = {
    token: N8N_TOKEN,
    fetched_at,
    records: allRecords,
  };

  const r = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const out = await r.text();
  if (!r.ok) throw new Error(`Webhook error ${r.status}: ${out.slice(0, 500)}`);

  console.log(`OK: sent ${allRecords.length} records to n8n.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
