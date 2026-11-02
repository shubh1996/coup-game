import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('/tmp/coup-shots', { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// --- Lobby ---
await page.goto('http://localhost:5173');
await page.waitForSelector('h1');
await page.screenshot({ path: '/tmp/coup-shots/01-lobby.png' });
console.log('Shot 1: lobby');

// --- Create room as Alice ---
await page.fill('input[placeholder="Your name"]', 'Alice');
await page.click('button.primary');
await page.waitForSelector('.room-id');
const roomId = await page.$eval('.room-id', el => el.textContent.trim());
console.log('Room created:', roomId);
await page.screenshot({ path: '/tmp/coup-shots/02-waiting-room.png' });
console.log('Shot 2: waiting room (Alice)');

// --- Second tab: Bob joins ---
const page2 = await ctx.newPage();
await page2.goto('http://localhost:5173');
await page2.waitForSelector('h1');
await page2.fill('input[placeholder="Your name"]', 'Bob');

// Enter room code
await page2.fill('input[placeholder="Room code"]', roomId);
await page2.locator('button:not(.primary)').last().click();
await page2.waitForSelector('.room-id');
console.log('Bob joined');
await page2.screenshot({ path: '/tmp/coup-shots/03-bob-waiting.png' });
console.log('Shot 3: Bob in waiting room');

// Refresh Alice's view
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/coup-shots/04-alice-sees-bob.png' });
console.log('Shot 4: Alice sees Bob');

// --- Start game ---
await page.click('button.primary');
await page.waitForSelector('.players-grid');
await page.screenshot({ path: '/tmp/coup-shots/05-game-started.png' });
console.log('Shot 5: game started (Alice view)');

await page2.waitForSelector('.players-grid');
await page2.screenshot({ path: '/tmp/coup-shots/06-bob-game-view.png' });
console.log('Shot 6: game started (Bob view)');

await browser.close();
console.log('Done — screenshots in /tmp/coup-shots/');
