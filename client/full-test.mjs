import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/coup-full', { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const phone = { width: 393, height: 852, isMobile: true, hasTouch: true };

const errors = [];

async function newPage(label) {
  const ctx = await browser.newContext({ ...phone });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${label}] PAGE ERROR: ${e.message}`));
  return page;
}

// Alice
const alice = await newPage('Alice');
await alice.goto('http://localhost:5173');
await alice.waitForSelector('h1');
await alice.fill('input[placeholder="Your name"]', 'Alice');
await alice.click('button.primary');
await alice.waitForSelector('.room-id');
const roomId = await alice.$eval('.room-id', el => el.textContent.trim());
console.log('Room:', roomId);
await alice.screenshot({ path: '/tmp/coup-full/01-alice-lobby.png' });

// Bob
const bob = await newPage('Bob');
await bob.goto('http://localhost:5173');
await bob.fill('input[placeholder="Your name"]', 'Bob');
await bob.fill('input[placeholder="Room code"]', roomId);
await bob.locator('button:not(.primary)').last().click();
await bob.waitForSelector('.room-id');

// Start
await alice.waitForTimeout(500);
await alice.click('button.primary');
await alice.waitForSelector('.players-grid');
await bob.waitForSelector('.players-grid');
await alice.screenshot({ path: '/tmp/coup-full/02-alice-turn.png' });
await bob.screenshot({ path: '/tmp/coup-full/03-bob-waiting.png' });

// Alice takes income
await alice.click('text=Income');
await alice.waitForTimeout(500);
await alice.screenshot({ path: '/tmp/coup-full/04-after-income.png' });

// Bob's turn - foreign aid, Alice passes
await bob.click('text=Foreign Aid');
await bob.waitForTimeout(300);
await alice.screenshot({ path: '/tmp/coup-full/05-alice-react-to-foreign-aid.png' });
await alice.click('text=Pass');
await alice.waitForTimeout(500);
await bob.screenshot({ path: '/tmp/coup-full/06-after-foreign-aid.png' });

// Alice's turn - try exchange (Ambassador)
await alice.waitForTimeout(300);
const exchangeBtn = alice.locator('text=Exchange');
await exchangeBtn.click();
await alice.waitForTimeout(300);
await bob.screenshot({ path: '/tmp/coup-full/07-bob-react-to-exchange.png' });
await alice.screenshot({ path: '/tmp/coup-full/08-alice-waiting-reactions.png' });

// Bob passes on exchange
await bob.click('text=Pass');
await alice.waitForTimeout(500);
await alice.screenshot({ path: '/tmp/coup-full/09-alice-exchange-panel.png' });

console.log('Console errors:', errors.length ? errors : 'none');
await browser.close();
console.log('Done');
