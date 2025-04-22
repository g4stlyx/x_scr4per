// Add initial log to debug
console.log('Starting scraper...');
// load environment variables for credentials
require('dotenv').config();
// parse CLI options for search parameters
const argv = require('yargs/yargs')(process.argv.slice(2))
  .option('user', { type: 'string', describe: 'Filter tweets from a specific user (without @)' })
  .option('query', { type: 'string', describe: 'Keyword or text to search for' })
  .option('since', { type: 'string', describe: 'Start date (YYYY-MM-DD)' })
  .option('until', { type: 'string', describe: 'End date (YYYY-MM-DD)' })
  .option('tab', { choices: ['latest','top','media'], default: 'latest', describe: 'Search tab: latest, top, or media' })
  .option('limit', { type: 'number', describe: 'Max number of tweets to scrape' })
  .option('lang', { type: 'string', describe: 'Language code to filter tweets (e.g. tr, en). If not provided, no language filter is applied.' })
  .option('outfile', { type: 'string', default: 'tweets.json', describe: 'Path to output JSON file' })
  .option('maxNoNew', { type: 'number', default: 3, describe: 'Number of empty scrolls to detect end of feed' })
  .help()
  .argv;
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const readline = require('readline');
// path to stored session cookies
const COOKIE_PATH = 'twitter_cookies.json';
// resolve output file path to absolute
const OUTFILE = path.resolve(process.cwd(), argv.outfile);
console.log('Writing output to:', OUTFILE);
// ensure output directory exists
const outDir = path.dirname(OUTFILE);
if (outDir && outDir !== '.' && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

// collect tweets as objects and dedupe via Map
let tweetMap = new Map();
// listen for keypress (q or Ctrl+C) to save progress
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
}
process.stdin.on('keypress', (str, key) => {
  if ((key.ctrl && key.name === 'c') || str === 'q') {
    console.log('Quit key pressed, saving progress...');
    saveAndExit();
  }
});

// helper to flush current tweetMap to OUTFILE
function flushPartial(message) {
  try {
    const partial = Array.from(tweetMap.values());
    let existing = [];
    if (fs.existsSync(OUTFILE)) {
      existing = JSON.parse(fs.readFileSync(OUTFILE, 'utf8'));
    }
    // append only new tweets by tweetId
    const newItems = partial.filter(t => !existing.some(e => e.tweetId === t.tweetId));
    const merged = existing.concat(newItems);
    fs.writeFileSync(OUTFILE, JSON.stringify(merged, null, 2));
    console.log(`${message || 'Flushed'} ${newItems.length} new tweets; total ${merged.length} tweets saved to ${OUTFILE}`);
  } catch (e) {
    console.error('Error flushing tweets:', e.message);
  }
}

// handler to save tweets during shutdown signals
function saveAndExit() {
  console.log('\nInterrupted! Saving fetched tweets...');
  flushPartial('Saved');
  process.exit(0);
}

// catch various termination signals
process.on('SIGINT', saveAndExit);
process.on('SIGTERM', saveAndExit);
process.on('SIGBREAK', saveAndExit);

// catch process exit to save any partial tweets
process.on('exit', () => {
  try {
    if (tweetMap && tweetMap.size > 0) {
      console.log('Process exiting, saving partial tweets...');
      flushPartial('Exit flush');
    }
  } catch (e) {
    // avoid errors on exit
  }
});

(async () => {
  try {
    console.log('Launching browser with stealth plugin...');
    const browser = await puppeteer.launch({
      headless: false,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized'
      ],
      defaultViewport: null,
      timeout: 30000
    });
    console.log('Browser launched');
    const page = await browser.newPage();
    console.log('Page object created');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    console.log('Setting extra HTTP headers');
    await page.setExtraHTTPHeaders({
      'accept-language': 'tr-TR,tr;q=0.9'
    });
    console.log('User agent set');
    // use a mobile user‑agent to target mobile.twitter.com without emulation
    console.log('Setting mobile user-agent');
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1');
    console.log('Mobile user-agent set');

    // reuse saved cookies to skip login if available
    if (fs.existsSync(COOKIE_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
      await page.setCookie(...cookies);
      console.log('Loaded cookies, skipping login');
    } else {
      // perform login using credentials from .env
      console.log('Navigating to login page...');
      await page.goto('https://mobile.twitter.com/login', { waitUntil: 'domcontentloaded' });
      // DEBUG: capture login page and list all input fields
      console.log('Debug: saving screenshot of login page');
      await page.screenshot({ path: 'login-debug.png', fullPage: true });
      const debugInputs = await page.$$eval('input', els =>
        els.map(e => ({ type: e.type, name: e.name, autocomplete: e.autocomplete }))
      );
      console.log('Debug: found input elements:', debugInputs);

      console.log('Filling username and submitting...');
      await page.waitForSelector('input[name="text"], input[autocomplete="username"]', { timeout: 15000 });
      await page.type('input[name="text"], input[autocomplete="username"]', USER, { delay: 100 });
      await page.keyboard.press('Enter');
      console.log('Username submitted, inspecting password prompt...');
      // allow time for password form to load
      await page.waitForTimeout(2000);
      // DEBUG: capture password page and list input fields
      console.log('Debug: saving screenshot of password page');
      await page.screenshot({ path: 'login-pass-debug.png', fullPage: true });
      const passInputs = await page.$$eval('input', els =>
        els.map(e => ({ type: e.type, name: e.name, autocomplete: e.autocomplete }))
      );
      console.log('Debug: found password stage inputs:', passInputs);
      // wait for the actual password input
      await page.waitForSelector('input[name="password"]', { timeout: 15000 });

      console.log('Filling password and submitting...');
      await page.type('input[name="password"]', PASS, { delay: 100 });
      await page.keyboard.press('Enter');
      // wait for navigation to main page after login
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      console.log('Login successful');
      console.log('Performing login and saving session');
      // after login success:
      const sessionCookies = await page.cookies();
      fs.writeFileSync(COOKIE_PATH, JSON.stringify(sessionCookies, null, 2));
      console.log('Saved cookies to', COOKIE_PATH);
    }

    // build search query parts
    const parts = [];
    if (argv.lang) parts.push(`lang:${argv.lang}`);
    if (argv.user) parts.push(`from:${argv.user}`);
    if (argv.query) parts.push(argv.query);
    if (argv.since) parts.push(`since:${argv.since}`);
    if (argv.until) parts.push(`until:${argv.until}`);
    const searchQuery = encodeURIComponent(parts.join(' '));
    // map tab to f param
    const fMap = { latest: 'live', top: 'tweets', media: 'image' };
    const fParam = fMap[argv.tab] || 'live';

    // construct dynamic URL based on CLI options
    const url = `https://mobile.twitter.com/search?q=${searchQuery}&src=typed_query&f=${fParam}`;
    console.log('Navigating to URL:', url);
    await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
    console.log('Page loaded');
    // dismiss cookie banner if present
    console.log('Checking for cookie consent banner...');
    try {
      await page.waitForSelector('div[role="dialog"] button', { timeout: 5000 });
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => /Accept all/i.test(b.innerText));
        if (acceptBtn) acceptBtn.click();
      });
      console.log('Cookie banner dismissed');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('No cookie banner detected');
    }
    // wait for first mobile tweet to render before scraping
    console.log('Waiting for first tweet to load...');
    const initialSelector = 'article div[lang]';
    await page.waitForSelector(initialSelector, { timeout: 15000 });
    console.log('First tweet loaded, starting collection');

    const maxTweets = argv.limit || Infinity;
    // scroll until limit reached or end of feed
    let iter = 0;
    let endOfFeedCount = 0;
    const maxEndOfFeed = argv.maxNoNew;
    let lastHeight = await page.evaluate(() => document.body.scrollHeight);
    while (tweetMap.size < maxTweets && endOfFeedCount < maxEndOfFeed) {
      console.log(`Scroll iteration ${++iter}, collected so far: ${tweetMap.size}`);
      let newTweets = [];
      try {
        // mobile Twitter: extract tweet data (content, user, display name, timestamp)
        newTweets = await page.$$eval('article', nodes => nodes.map(n => {
          // tweet text
          const contentNode = n.querySelector('div[lang]');
          const content = contentNode ? contentNode.innerText.trim() : '';
          // user profile link (slug username)
          const anchors = Array.from(n.querySelectorAll('a[href^="/"]'));
          const profileLink = anchors.find(a => !a.getAttribute('href').includes('/status/'));
          const username = profileLink ? profileLink.getAttribute('href').slice(1).split('?')[0] : '';
          // display name from User-Name container
          let displayName = '';
          const nameContainer = n.querySelector('[data-testid="User-Name"]');
          if (nameContainer) {
            // take only the first line (actual name) before handle/time
            displayName = nameContainer.innerText.split('\n')[0].trim();
          }
          // userId from avatar container's data-testid
          let userId = '';
          const avatar = n.querySelector('div[data-testid^="UserAvatar-Container-"]');
          if (avatar) {
            const attr = avatar.getAttribute('data-testid');
            userId = attr.replace('UserAvatar-Container-', '');
          }
          // time link and tweet URL/ID
          const timeAnchor = n.querySelector('a[href*="/status/"]');
          const tweetPath = timeAnchor ? timeAnchor.getAttribute('href') : '';
          const tweetUrl = tweetPath ? `https://mobile.twitter.com${tweetPath}` : '';
          const tweetId = tweetPath ? tweetPath.split('/status/')[1].split('?')[0] : '';
          const timeElem = n.querySelector('time');
          const timestamp = timeElem ? timeElem.getAttribute('datetime') : '';
          // collect image media URLs
          const images = Array.from(n.querySelectorAll('img'))
            .filter(img => img.src.includes('twimg.com/media'))
            .map(img => img.src);
          return { username, displayName, userId, content, timestamp, tweetUrl, tweetId, images };
        }));
      } catch (err) {
        console.warn('Detached frame detected, retrying scroll...', err.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      // add only tweets with a valid tweetId, keying by tweetId
      newTweets.forEach(t => {
        if (t.tweetId && !tweetMap.has(t.tweetId)) {
          tweetMap.set(t.tweetId, t);
        }
      });
      // scroll down to load more
      console.log('Scrolling down');
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      // delay to allow new tweets to load
      console.log('Waiting 2 seconds');
      await new Promise(r => setTimeout(r, 2000));
      // detect end of feed by comparing scrollHeight
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) {
        endOfFeedCount++;
      } else {
        endOfFeedCount = 0;
        lastHeight = newHeight;
      }
      // flush partial results on each scroll
      flushPartial('Scroll flush');
    }

    // if limit not reached, notify end of feed
    if (argv.limit && tweetMap.size < argv.limit) {
      console.warn(`Reached end of feed after collecting ${tweetMap.size}/${argv.limit} tweets.`);
    }
    // finalize scraped list according to limit
    let scraped = Array.from(tweetMap.values());
    if (argv.limit) scraped = scraped.slice(0, argv.limit);
    // merge with existing file using tweetId
    let existing = [];
    if (fs.existsSync(OUTFILE)) {
      existing = JSON.parse(fs.readFileSync(OUTFILE, 'utf8'));
    }
    const newItems = scraped.filter(t => !existing.some(e => e.tweetId === t.tweetId));
    const merged = existing.concat(newItems);
    fs.writeFileSync(OUTFILE, JSON.stringify(merged, null, 2));
    console.log(`Appended ${newItems.length} new tweets; total is ${merged.length}`);

    await browser.close();
  } catch (error) {
    console.error('Error in scraper:', error);
    flushPartial('Error flush');
    process.exit(1);
  } finally {
    flushPartial('Final flush');
  }
})();

// catch any unhandled errors
process.on('unhandledRejection', error => {
  console.error('UnhandledPromiseRejection:', error);
  flushPartial('Unhandled rejection flush');
  process.exit(1);
});