import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/coup-mobile', { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

// iPhone 14 viewport
const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctx = await browser.newContext({ ...phone });
const page = await ctx.newPage();

await page.goto('http://localhost:5173');
await page.waitForSelector('h1');
await page.screenshot({ path: '/tmp/coup-mobile/01-lobby.png', fullPage: true });

// Create room
await page.fill('input[placeholder="Your name"]', 'Alice');
await page.click('button.primary');
await page.waitForSelector('.room-id');
const roomId = await page.$eval('.room-id', el => el.textContent.trim());
await page.screenshot({ path: '/tmp/coup-mobile/02-waiting.png', fullPage: true });

// Second player joins
const ctx2 = await browser.newContext({ ...phone });
const page2 = await ctx2.newPage();
await page2.goto('http://localhost:5173');
await page2.fill('input[placeholder="Your name"]', 'Bob');
await page2.fill('input[placeholder="Room code"]', roomId);
await page2.locator('button:not(.primary)').last().click();
await page2.waitForSelector('.room-id');

// Start game
await page.waitForTimeout(500);
await page.click('button.primary');
await page.waitForSelector('.players-grid');
await page.screenshot({ path: '/tmp/coup-mobile/03-game-alice.png', fullPage: true });
await page2.waitForSelector('.players-grid');
await page2.screenshot({ path: '/tmp/coup-mobile/04-game-bob.png', fullPage: true });

await browser.close();
console.log('Done');
