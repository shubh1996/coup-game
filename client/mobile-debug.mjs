import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/coup-debug', { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

// Exact iPhone 16 size as shown in DevTools
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});
const page = await ctx.newPage();

await page.goto('http://localhost:5173');
await page.waitForSelector('h1');

// Check for horizontal overflow
const overflow = await page.evaluate(() => {
  return {
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    rootScrollWidth: document.getElementById('root').scrollWidth,
    rootClientWidth: document.getElementById('root').clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  };
});
console.log('Overflow check:', JSON.stringify(overflow, null, 2));

await page.screenshot({ path: '/tmp/coup-debug/lobby.png', fullPage: false });
console.log('Screenshot taken');
await browser.close();
