// Add initial log to debug
console.log('Starting scraper...');
// load environment variables for credentials
require('dotenv').config();

// Enhanced sentiment analysis setup
const natural = require('natural');
const emojiSentiment = require('emoji-sentiment');
const tokenizer = new natural.WordTokenizer();
const sentiment = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');

// Custom sentiment analyzer that handles emojis, slang and social media content
function analyzeSentiment(text, language = 'en') {
  if (!text) return { score: 0, comparative: 0, positive: [], negative: [], emojis: [] };
  
  // Process emojis
  const emojiResults = [];
  const extractedEmojis = [];
  const textWithoutEmojis = text.replace(/[\p{Emoji}]/gu, match => {
    extractedEmojis.push(match);
    const emojiData = emojiSentiment.find(e => e.emoji === match);
    if (emojiData) {
      emojiResults.push({ emoji: match, score: emojiData.sentiment });
      return ' '; // Replace emoji with space to maintain word boundaries
    }
    return match;
  });
  
  // Get emoji sentiment score
  const emojiScore = emojiResults.reduce((sum, emoji) => sum + emoji.score, 0);
  
  // Process text (language specific handling)
  let textScore, tokens, positive = [], negative = [];
  
  if (language === 'tr') {
    // Custom Turkish processing (limited, but better than nothing)
    const turkishPositive = ['güzel', 'harika', 'süper', 'iyi', 'seviyorum', 'hoş', 'mutlu', 'başarılı', 'teşekkür'];
    const turkishNegative = ['kötü', 'berbat', 'rezil', 'korkunç', 'nefret', 'üzgün', 'kızgın', 'sorun', 'problem'];
    
    tokens = tokenizer.tokenize(textWithoutEmojis.toLowerCase());
    let posCount = 0, negCount = 0;
    
    tokens.forEach(token => {
      if (turkishPositive.some(word => token.includes(word))) {
        positive.push(token);
        posCount++;
      } else if (turkishNegative.some(word => token.includes(word))) {
        negative.push(token);
        negCount--;
      }
    });
    
    textScore = posCount + negCount;
  } else {
    // English and other languages using AFINN
    tokens = tokenizer.tokenize(textWithoutEmojis);
    textScore = sentiment.getSentiment(tokens);
    
    // Extract positive and negative words
    tokens.forEach(token => {
      const wordSentiment = sentiment.getSentiment([token]);
      if (wordSentiment > 0) positive.push(token);
      else if (wordSentiment < 0) negative.push(token);
    });
  }
  
  // Social media specific adjustments
  const hasExclamation = text.includes('!');
  const hasAllCaps = /[A-Z]{3,}/.test(text);
  const intensifier = (hasExclamation ? 1.2 : 1) * (hasAllCaps ? 1.2 : 1);
  
  // Combined score with adjustments
  const combinedScore = (textScore + emojiScore * 0.5) * intensifier;
  const normalizedScore = Math.max(-5, Math.min(5, combinedScore)); // Limit to -5 to 5 range
  
  return {
    score: normalizedScore,
    comparative: tokens.length > 0 ? normalizedScore / tokens.length : 0,
    positive: positive,
    negative: negative,
    emojis: emojiResults,
    intensity: intensifier > 1 ? 'high' : 'normal'
  };
}

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
  .option('scrollDelay', { type: 'number', default: 500, describe: 'Delay in ms between scrolls (lower = faster scraping, but may miss tweets)' })
  .option('headless', { type: 'boolean', default: true, describe: 'Run browser in headless mode (invisible)' })
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
      headless: argv.headless, // Use the headless option from command line arguments
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
    console.log(`Browser launched in ${argv.headless ? 'headless' : 'visible'} mode`);
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
      await new Promise(resolve => setTimeout(resolve, 2000));
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
    // Check if redirected to x.com and adjust accordingly
    const currentUrl = await page.url();
    console.log('Current URL after loading:', currentUrl);
    if (currentUrl.includes('x.com')) {
      console.log('Detected redirect to x.com domain, adjusting selectors accordingly');
      // Wait a bit longer for the new domain to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

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
    try {
      // Try several possible tweet selectors with a longer timeout
      const possibleSelectors = [
        'article div[lang]',
        'article[data-testid="tweet"]',
        'div[data-testid="tweetText"]',
        'article',
        '[data-testid="cellInnerDiv"]',
        'div[data-testid="cellInnerDiv"]',
        '[data-testid="Tweet"]',
        'div.tweet'
      ];
      
      // Try each selector in order with a timeout
      let foundSelector = false;
      for (const selector of possibleSelectors) {
        try {
          console.log(`Trying selector: ${selector}`);
          await page.waitForSelector(selector, { timeout: 8000 });
          console.log(`Found tweets using selector: ${selector}`);
          foundSelector = true;
          break;
        } catch (err) {
          console.log(`Selector ${selector} not found, trying next...`);
        }
      }
      
      if (!foundSelector) {
        // If all specific selectors fail, check if we're on a page with any content
        console.log('All primary tweet selectors failed, trying fallback selectors...');
        await Promise.race([
          page.waitForSelector('section[aria-label]', { timeout: 8000 }),
          page.waitForSelector('div[aria-label="Timeline"]', { timeout: 8000 }),
          page.waitForSelector('main[role="main"]', { timeout: 8000 })
        ]);
      }

      // Wait a bit longer to ensure the page is properly loaded
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Take a screenshot to help debug what's on the page
      await page.screenshot({ path: 'debug-page.png', fullPage: true });
      console.log('Tweet elements may be present, starting collection anyway');
    } catch (err) {
      console.error('Could not find any tweet elements on the page. Current URL:', await page.url());
      console.error('Taking a screenshot for debugging...');
      await page.screenshot({ path: 'error-page.png', fullPage: true });
      
      // Record the HTML content for debugging
      const htmlContent = await page.content();
      fs.writeFileSync('error-page-content.html', htmlContent);
      
      // Instead of failing, let's continue and see if we can extract tweets with alternative methods
      console.log('Attempting to continue despite selector issues');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait a bit longer before continuing
    }

    // Try to detect and log any visible content on the page that might be tweets
    console.log('Performing emergency content detection...');
    try {
      const contentScan = await page.evaluate(() => {
        // Scan for any elements that could contain tweets
        const potentialContainers = [
          ...document.querySelectorAll('article'),
          ...document.querySelectorAll('[data-testid="tweet"]'),
          ...document.querySelectorAll('[data-testid="cellInnerDiv"]'),
          ...document.querySelectorAll('div[role="article"]'),
          ...document.querySelectorAll('div.tweet')
        ];
        
        // Count elements by type
        return {
          articles: document.querySelectorAll('article').length,
          divs: document.querySelectorAll('div').length,
          links: document.querySelectorAll('a').length,
          potentialTweets: potentialContainers.length,
          bodyText: document.body.innerText.substring(0, 200) // First 200 chars of body text
        };
      });
      
      console.log('Emergency content scan results:', contentScan);
    } catch (err) {
      console.error('Failed to perform emergency content scan:', err);
    }

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
        // mobile Twitter: extract tweet data with multiple fallback selectors
        newTweets = await page.$$eval('article, div[data-testid="tweet"], div.tweet', nodes => nodes.map(n => {
          // tweet text with fallbacks
          let content = '';
          const contentNode = n.querySelector('div[lang], div[data-testid="tweetText"], .tweet-text');
          
          if (contentNode) {
            content = contentNode.innerText.trim();
          }
          
          // Try multiple ways to get the username
          let username = '';
          // First try standard href method
          const anchors = Array.from(n.querySelectorAll('a[href^="/"]'));
          const profileLink = anchors.find(a => !a.getAttribute('href').includes('/status/'));
          if (profileLink) {
            username = profileLink.getAttribute('href').slice(1).split('?')[0];
          } 
          // Fallback to other selectors
          if (!username) {
            const usernameNode = n.querySelector('[data-testid="User-Name"] a[role="link"]') || 
                                 n.querySelector('.username') ||
                                 n.querySelector('span[data-testid="tweetAuthor"]');
            if (usernameNode) {
              const text = usernameNode.innerText.trim();
              if (text.startsWith('@')) {
                username = text.slice(1);
              } else {
                username = text;
              }
            }
          }
          
          // display name with fallbacks
          let displayName = '';
          const nameContainer = n.querySelector('[data-testid="User-Name"], .fullname, .name');
          if (nameContainer) {
            displayName = nameContainer.innerText.split('\n')[0].trim();
          }
          
          // time link and tweet URL/ID with multiple fallbacks
          let tweetUrl = '';
          let tweetId = '';
          let timestamp = '';
          
          // Try multiple ways to get the tweet URL
          const timeAnchor = n.querySelector('a[href*="/status/"]');
          if (timeAnchor) {
            const tweetPath = timeAnchor.getAttribute('href');
            tweetUrl = tweetPath ? `https://twitter.com${tweetPath}` : '';
            tweetId = tweetPath ? tweetPath.split('/status/')[1]?.split('?')[0] : '';
            
            const timeElem = timeAnchor.querySelector('time') || n.querySelector('time');
            timestamp = timeElem ? timeElem.getAttribute('datetime') : '';
          }
          
          // Alternative way to get tweet ID if the above failed
          if (!tweetId) {
            const statusAttribute = n.getAttribute('data-tweet-id') || 
                                   n.getAttribute('data-item-id') || 
                                   n.querySelector('[data-tweet-id]')?.getAttribute('data-tweet-id');
            if (statusAttribute) tweetId = statusAttribute;
          }
          
          // collect image media URLs with fallbacks
          const images = Array.from(
            n.querySelectorAll('img[src*="twimg.com/media"], img[src*="pbs.twimg.com/media"]')
          ).filter(img => !img.src.includes('profile_images'))
           .map(img => img.src);
          
          return { username, displayName, content, timestamp, tweetUrl, tweetId, images };
        }));
      } catch (err) {
        console.warn('Extraction error occurred:', err.message);
        console.log('Taking a failure screenshot for debugging');
        await page.screenshot({ path: `extraction-error-${Date.now()}.png`, fullPage: true });
        await new Promise(resolve => setTimeout(resolve, 3000)); // longer wait time
        continue;
      }
      // add only tweets with a valid tweetId, keying by tweetId
      newTweets.forEach(t => {
        if (t.tweetId && !tweetMap.has(t.tweetId)) {
          // Add sentiment analysis to each tweet
          if (t.content) {
            const sentimentResult = analyzeSentiment(t.content);
            t.sentiment = {
              score: sentimentResult.score,
              comparative: sentimentResult.comparative,
              positive: sentimentResult.positive,
              negative: sentimentResult.negative,
              emojis: sentimentResult.emojis
            };
          } else {
            // Default sentiment for tweets without text content
            t.sentiment = { score: 0, comparative: 0, positive: [], negative: [] };
          }
          tweetMap.set(t.tweetId, t);
        }
      });
      // scroll down to load more
      console.log('Scrolling down');
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      // delay to allow new tweets to load - configurable via scrollDelay parameter
      console.log(`Waiting ${argv.scrollDelay} ms`);
      await new Promise(r => setTimeout(r, argv.scrollDelay));
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
    
    // Try to take a screenshot of the page to help diagnose the issue
    try {
      // Make sure page is defined before trying to use it
      if (typeof page !== 'undefined' && page) {
        await page.screenshot({ path: 'error-state.png', fullPage: true });
        console.log('Saved error state screenshot to error-state.png');
        
        // Log the current page HTML for debugging
        const html = await page.content();
        fs.writeFileSync('error-page.html', html);
        console.log('Saved error page HTML to error-page.html');
        
        // Check what selectors are currently available on the page
        const selectorCheck = await page.evaluate(() => {
          const selectors = [
            'article', 
            'div[lang]',
            'article div[lang]',
            'div[data-testid="tweetText"]',
            'section[aria-label]',
            'div[aria-label="Timeline"]'
          ];
          
          return selectors.map(selector => {
            return {
              selector,
              count: document.querySelectorAll(selector).length
            };
          });
        });
        
        console.log('Available selectors on the page:', selectorCheck);
      } else {
        console.error('Page object not available for diagnostic capture');
      }
    } catch (screenshotError) {
      console.error('Failed to capture diagnostic information:', screenshotError);
    }
    
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