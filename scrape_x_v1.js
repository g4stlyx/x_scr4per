// Add initial log to debug
console.log('Starting scraper...');
// load environment variables for credentials
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
// path to stored session cookies
const COOKIE_PATH = 'twitter_cookies.json';

const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

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

    // set up search for Turkish tweets
    const query = encodeURIComponent('lang:tr');
    // use Twitter mobile site for anonymous access
    const url = `https://mobile.twitter.com/search?q=${query}&src=typed_query&f=live`;
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

    // collect tweets
    const tweets = new Set();
    let iterations = 0;
    while (tweets.size < 100 && iterations < 20) {
      console.log(`Iteration ${iterations + 1}, tweets collected so far: ${tweets.size}`);
      let newTweets = [];
      try {
        // mobile Twitter: extract text from article div[lang]
        newTweets = await page.$$eval('article div[lang]', nodes => nodes.map(n => n.innerText));
      } catch (err) {
        console.warn('Detached frame detected, retrying scroll...', err.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      newTweets.forEach(t => tweets.add(t));
      // scroll down to load more
      console.log('Scrolling down');
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      // delay 2 seconds to allow new tweets to load
      console.log('Waiting 2 seconds');
      await new Promise(resolve => setTimeout(resolve, 2000));
      iterations++;
    }

    // save to file
    const resultArray = Array.from(tweets).slice(0, 100);
    fs.writeFileSync('turkish_tweets.json', JSON.stringify(resultArray, null, 2));
    console.log(`Saved ${resultArray.length} tweets to turkish_tweets.json`);

    await browser.close();
  } catch (error) {
    console.error('Error in scraper:', error);
    process.exit(1);
  }
})();

// catch any unhandled errors
process.on('unhandledRejection', error => {
  console.error('UnhandledPromiseRejection:', error);
  process.exit(1);
});