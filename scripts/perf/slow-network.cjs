// Measures pages on an emulated slow 3G phone (400 kbps, 400 ms round trip): bytes by type, load time, LCP,
// a repeat visit, and whether the page opens with the network cut. Run against a production build:
//   BASE=http://localhost:3000 node scripts/perf/slow-network.cjs > result.json
// Note: the repeat-visit figures do not throttle the service worker's own requests, so compare first visits.
/* eslint-disable no-console, @typescript-eslint/no-require-imports -- a plain Node script that prints its results. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const PAGES = ['/', '/search?q=rice', '/p/ofada-rice-5-kg-2ef5b0', '/store/ogun-harvest-farms', '/c/groceries'];
const NET = { offline: false, latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 };
(async () => {
  const browser = await chromium.launch();
  const out = [];
  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'allow' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NET);
    const bytes = {}; let reqs = 0;
    cdp.on('Network.loadingFinished', (e) => { const t = types[e.requestId] || 'other'; bytes[t] = (bytes[t] || 0) + e.encodedDataLength; reqs++; });
    const types = {};
    cdp.on('Network.responseReceived', (e) => { types[e.requestId] = e.type; });
    const run = async () => {
      for (const k of Object.keys(bytes)) delete bytes[k]; reqs = 0;
      const t0 = Date.now();
      await page.goto(BASE + path, { waitUntil: 'load', timeout: 180000 });
      const loadMs = Date.now() - t0;
      const lcp = await page.evaluate(() => new Promise((r) => { new PerformanceObserver((l) => { const e = l.getEntries(); r(Math.round(e[e.length - 1].startTime)); }).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => r(null), 3000); }));
      await page.waitForTimeout(1500);
      const total = Object.values(bytes).reduce((a, b) => a + b, 0);
      return { loadMs, lcpMs: lcp, totalKB: Math.round(total / 1024), byType: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)])), requests: reqs };
    };
    const first = await run();
    const repeat = await run();
    // Offline: drop the network and reload.
    await page.waitForTimeout(2000);
    await cdp.send('Network.emulateNetworkConditions', { ...NET, offline: true });
    await ctx.setOffline(true);
    let offline;
    try { await page.reload({ waitUntil: 'load', timeout: 20000 }); const txt = (await page.innerText('body')).slice(0, 80).replace(/\s+/g, ' '); offline = txt; } catch (e) { offline = 'FAILED: ' + e.message.split('\n')[0].slice(0, 60); }
    out.push({ path, first, repeat, offline });
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
