// Run with: node tests/mobile.cjs (requires playwright in NODE_PATH).
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/autopulse\//, '') || 'index.html';
      const file = path.join(root, name);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const url = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}/autopulse/`;
  try {
    for (const [width, height, top, bottom] of [[320,568,0,0], [375,667,0,0], [390,844,47,34], [360,640,24,24], [375,600,0,34]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: `:root { --safe-top: ${top}px; --safe-bottom: ${bottom}px; }` });
      async function check(step) {
        await page.locator('[data-action="onboard-next"]').waitFor();
        const metrics = await page.evaluate(() => {
          const body = document.querySelector('.onboard-body');
          const button = document.querySelector('[data-action="onboard-next"]').getBoundingClientRect();
          return { bottom: button.bottom, height: button.height, overflow: body.scrollHeight - body.clientHeight, pageOverflow: document.documentElement.scrollHeight - innerHeight, widthOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(metrics.bottom <= height - bottom, `${width}x${height} step ${step}: button unsafe ${JSON.stringify(metrics)}`);
        assert(metrics.height >= 44);
        assert(metrics.overflow <= 1 && metrics.pageOverflow <= 1 && metrics.widthOverflow <= 1, `${width}x${height} step ${step}: overflow ${JSON.stringify(metrics)}`);
      }
      await check(1);
      await page.click('[data-action="onboard-next"]'); await check(2);
      await page.fill('#ob-make', 'Lada'); await page.fill('#ob-model', 'Vesta');
      await page.click('[data-action="onboard-next"]'); await check(3);
      await page.fill('#ob-mileage', '86400');
      await page.click('[data-action="onboard-next"]'); await check(4);
      await page.click('[data-action="onboard-next"]');
      const nav = await page.locator('.bottom-nav').boundingBox();
      assert(nav.y + nav.height <= height + 1);
      const safePadding = await page.locator('.screen').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
      assert(safePadding >= nav.height);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.vehicle-title').waitFor();
      assert.equal(await page.locator('.vehicle-title').innerText(), 'Lada Vesta');
      console.log(`PASS ${width}x${height}: four steps, safe areas, navigation, offline reload`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
