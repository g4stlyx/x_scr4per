// X User Profiler - Twitter/X user analysis module
// Add initial log to debug
console.log('Starting user profiler...');

// Load required modules
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const natural = require('natural');
const stopwords = require('stopwords-iso');
const yargs = require('yargs/yargs');

// Parse CLI options for profiler parameters
const argv = yargs(process.argv.slice(2))
  .option('username', { 
    type: 'string',
    describe: 'Twitter/X username to analyze (without @)',
    demandOption: true 
  })
  .option('tab', { 
    choices: ['posts', 'with_replies', 'media', 'all'], 
    default: 'posts', 
    describe: 'Tab to analyze: posts, with_replies, media, or all'
  })
  .option('limit', { 
    type: 'number', 
    default: 200, 
    describe: 'Maximum number of tweets to analyze per tab' 
  })
  .option('outfile', { 
    type: 'string', 
    describe: 'Path to output JSON file',
    default: 'out/profile_analysis.json'
  })
  .option('minWordCount', {
    type: 'number',
    default: 2,
    describe: 'Minimum character length for words to count in analysis'
  })
  .option('language', {
    type: 'string',
    default: 'en',
    describe: 'Language code for stopwords filtering (en, tr, etc)'
  })
  .option('excludeStopWords', {
    type: 'boolean',
    default: true,
    describe: 'Exclude common stopwords from word frequency analysis'
  })
  .option('scrollDelay', {
    type: 'number',
    default: 800,
    describe: 'Delay in ms between scrolls when collecting tweets'
  })
  .option('headless', {
    type: 'boolean',
    default: true,
    describe: 'Run browser in headless mode'
  })
  .help()
  .argv;

// Cookie file path
const COOKIE_PATH = 'twitter_cookies.json';

// Resolve output file path to absolute
const OUTFILE = path.resolve(process.cwd(), argv.outfile);
console.log('Writing output to:', OUTFILE);

// Ensure output directory exists
const outDir = path.dirname(OUTFILE);
if (outDir && outDir !== '.' && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Initialize tokenizer for text analysis
const tokenizer = new natural.WordTokenizer();

// Get stopwords for the specified language (fallback to English if not available)
const getStopwords = (lang) => {
  const langCode = lang.toLowerCase();
  if (stopwords[langCode]) {
    return stopwords[langCode];
  }
  console.log(`Warning: Stopwords for language '${lang}' not found, using English stopwords`);
  return stopwords['en'];
};

// Regular expressions for text cleaning
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const MENTION_REGEX = /@\w+/g;
const HASHTAG_REGEX = /#\w+/g;
const SPECIAL_CHARS_REGEX = /[^\w\s]/g;

// Clean text for word frequency analysis
function cleanText(text, keepHashtags = false, keepMentions = false) {
  if (!text) return '';
  
  let cleanedText = text.toLowerCase();
  
  // Remove URLs
  cleanedText = cleanedText.replace(URL_REGEX, '');
  
  // Conditionally remove mentions and hashtags
  if (!keepMentions) {
    cleanedText = cleanedText.replace(MENTION_REGEX, '');
  }
  
  if (!keepHashtags) {
    cleanedText = cleanedText.replace(HASHTAG_REGEX, '');
  }
  
  // Remove special characters
  cleanedText = cleanedText.replace(SPECIAL_CHARS_REGEX, ' ');
  
  // Replace multiple spaces with single space
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
  
  return cleanedText;
}

// Analyze word frequency from tweets
function analyzeWordFrequency(tweets, minWordLength = 2, excludeStopWords = true, language = 'en') {
  const wordCounts = {};
  let totalWords = 0;
  let stopwordsList = [];
  
  // Get stopwords if needed
  if (excludeStopWords) {
    stopwordsList = getStopwords(language);
  }
  
  // Process each tweet
  tweets.forEach(tweet => {
    if (!tweet.content) return;
    
    // Clean and tokenize text
    const cleanedText = cleanText(tweet.content);
    const tokens = tokenizer.tokenize(cleanedText);
    
    // Count word occurrences
    tokens.forEach(word => {
      // Skip words that are too short
      if (word.length < minWordLength) return;
      
      // Skip stopwords if configured
      if (excludeStopWords && stopwordsList.includes(word)) return;
      
      totalWords++;
      
      if (wordCounts[word]) {
        wordCounts[word]++;
      } else {
        wordCounts[word] = 1;
      }
    });
  });
  
  // Convert to object with counts and percentages
  const wordFrequency = {};
  Object.keys(wordCounts).forEach(word => {
    const count = wordCounts[word];
    const percentage = ((count / totalWords) * 100).toFixed(2) + '%';
    wordFrequency[word] = { count, percentage };
  });
  
  return {
    analyzedTweets: tweets.length,
    totalWords,
    uniqueWords: Object.keys(wordCounts).length,
    wordFrequency
  };
}

// Main function to analyze a user profile
async function analyzeUserProfile() {
  // Get parameters
  const username = argv.username;
  const tabsToAnalyze = argv.tab === 'all' 
    ? ['posts', 'with_replies', 'media'] 
    : [argv.tab];
  const tweetLimit = argv.limit;
  const minWordCount = argv.minWordCount;
  const language = argv.language;
  const excludeStopWords = argv.excludeStopWords;
  const scrollDelay = argv.scrollDelay;
  
  console.log(`Starting user profile analysis for @${username}`);
  console.log(`Analyzing tabs: ${tabsToAnalyze.join(', ')}`);
  console.log(`Tweet limit per tab: ${tweetLimit}`);
  
  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: argv.headless,
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
  
  const page = await browser.newPage();
  console.log('Setting up browser...');
  
  // Set user agent for desktop experience
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  
  // Set extra HTTP headers
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9'
  });
  
  // Initialize result object
  const result = {
    username,
    analyzedAt: new Date().toISOString(),
    profile: {},
    stats: {},
    tweets: {},
    wordAnalysis: {}
  };
  
  // Check for saved cookies to avoid login
  let loggedIn = false;
  
  if (fs.existsSync(COOKIE_PATH)) {
    try {
      console.log('Loading saved cookies...');
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
      await page.setCookie(...cookies);
      loggedIn = true;
    } catch (e) {
      console.log('Error loading cookies:', e.message);
    }
  }
  
  try {
    // First navigate to the profile page
    console.log(`Navigating to user profile: @${username}`);
    await page.goto(`https://x.com/${username}`, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Wait for profile to load (using header element as indicator)
    console.log('Waiting for profile to load...');
    try {
      // Various selector attempts to detect profile header
      await Promise.race([
        page.waitForSelector('div[data-testid="primaryColumn"]', { timeout: 10000 }),
        page.waitForSelector('div[data-testid="UserName"]', { timeout: 10000 }),
        page.waitForSelector('a[href$="/photo"]', { timeout: 10000 }),
        page.waitForSelector('div[data-testid="UserProfileHeader_Items"]', { timeout: 10000 })
      ]);
      
      console.log('Profile loaded');
    } catch (err) {
      console.log('Could not detect standard profile elements, but continuing...');
      // Take a screenshot to debug
      await page.screenshot({ path: 'profile-debug.png' });
    }
    
    // Extract profile information with updated selectors based on latest X structure
    console.log('Extracting profile information...');
    result.profile = await page.evaluate(() => {
      const profile = {};
      
      // Helper function to safely extract text
      const getText = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : null;
      };
      
      // Helper function to extract text by test ID
      const getTextByTestId = (testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        return element ? element.textContent.trim() : null;
      };

      // Extract display name (not username) - using more precise selectors based on your HTML example
      profile.name = getText('div[data-testid="UserName"] div.r-1awozwy span.css-1jxf684 span.css-1jxf684') || 
                      getText('div.r-1vr29t4 span.css-1jxf684 span.css-1jxf684') ||
                      getText('div[data-testid="UserName"] div.css-175oi2r span.css-1jxf684:first-child') ||
                      getTextByTestId("UserName");
      
      // Extract username (handle) - specifically looking for the format "@username" and removing the @
      const usernameSelectors = [
        'div[data-testid="UserName"] div[dir="ltr"] span.css-1jxf684',
        'div.css-175oi2r.r-1wbh5a2 div[dir="ltr"] span.css-1jxf684',
        'div.css-1jxf684.r-dnmrzs.r-1udh08x.r-3s2u2q span.css-1jxf684'
      ];
      
      let username = null;
      for (const selector of usernameSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          username = element.textContent.trim();
          if (username.startsWith('@')) {
            username = username.substring(1);
          }
          break;
        }
      }
      
      profile.username = username;
      
      // Extract bio - using more specific selectors based on provided example
      const bioSelectors = [
        'div[data-testid="UserDescription"]',
        'div.css-146c3p1[data-testid="UserDescription"]',
        'div.css-175oi2r.r-1adg3ll.r-6gpygo div.css-146c3p1[data-testid="UserDescription"]'
      ];
      
      let bioContent = null;
      for (const selector of bioSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          bioContent = element.textContent.trim();
          break;
        }
      }
      
      if (!bioContent) {
        // Try the fallback method of looking directly for the specific CSS classes
        const bioElement = document.querySelector('div.css-146c3p1.r-bcqeeo.r-1ttztb7.r-qvutc0.r-37j5jr.r-a023e6.r-rjixqe.r-16dba41');
        if (bioElement) {
          bioContent = bioElement.textContent.trim();
        }
      }
      
      profile.bio = bioContent;
      
      // Location, website, join date, birth date - specialized selectors for international profiles
      const profileHeaderItems = document.querySelector('div[data-testid="UserProfileHeader_Items"]') || 
                                document.querySelector('div.css-146c3p1[data-testid="UserProfileHeader_Items"]');
      
      if (profileHeaderItems) {
        // Extract location - more precise selectors based on HTML structure
        const locationSpans = profileHeaderItems.querySelectorAll('span[role="presentation"]');
        for (const span of locationSpans) {
          // Check if it contains the location icon SVG
          if (span.querySelector('svg path[d*="M12 7c-1.93 0-3.5 1.57-3.5 3.5S10.07"]')) {
            const nextSibling = span.nextElementSibling;
            if (nextSibling) {
              profile.location = nextSibling.textContent.trim();
            }
          }
        }
        
        // Extract birth date - improved selectors for international profiles
        const birthDateSpans = profileHeaderItems.querySelectorAll('span[role="presentation"]');
        for (const span of birthDateSpans) {
          // Look for SVG with birthday cake icon path
          if (span.querySelector('svg path[d*="M8 10c0-2.21 1.79-4 4-4v2c-1.1"]')) {
            profile.birthDate = span.textContent.trim();
            if (!profile.birthDate && span.nextElementSibling) {
              profile.birthDate = span.nextElementSibling.textContent.trim();
            }
          }
        }
        
        // Extract join date - improved selectors for international profiles
        const joinDateSpans = profileHeaderItems.querySelectorAll('span[role="presentation"]');
        for (const span of joinDateSpans) {
          // Look for SVG with calendar icon path
          if (span.querySelector('svg path[d*="M7 4V3h2v1h6V3h2v1h1.5"]')) {
            profile.joinDate = span.textContent.trim();
            if (!profile.joinDate && span.nextElementSibling) {
              profile.joinDate = span.nextElementSibling.textContent.trim();
            }
          }
        }
        
        // Extract website if present
        const linkEls = profileHeaderItems.querySelectorAll('a[role="link"]');
        linkEls.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.includes('x.com/') && !href.includes('twitter.com/')) {
            profile.website = link.textContent.trim();
          }
        });
      }
      
      // Backup methods if primary methods fail
      if (!profile.location || !profile.birthDate || !profile.joinDate) {
        // Additional backup for join date and birth date
        const allSpans = document.querySelectorAll('span.css-1jxf684');
        for (const span of allSpans) {
          const text = span.textContent.trim();
          if (!profile.joinDate && (text.includes('Joined') || text.includes('katıldı'))) {
            profile.joinDate = text;
          } else if (!profile.birthDate && (text.includes('Born') || text.includes('Doğum'))) {
            profile.birthDate = text;
          }
        }
      }
      
      // Extract images (profile and banner)
      profile.images = {};
      
      // Profile image - specifically targeting the profile photo image inside the link with "/photo" href
      const profileImgEl = document.querySelector('a[href$="/photo"] img.css-9pa8cd') || 
                          document.querySelector('div[aria-label*="rofile"] img') ||  // For multiple languages
                          document.querySelector('a[href$="/photo"] img') ||
                          document.querySelector('div[data-testid="UserAvatar-Container"] img');
      
      if (profileImgEl && profileImgEl.src) {
        // Get the highest resolution version by replacing _normal or _200x200 with original
        profile.images.profile_image = profileImgEl.src
          .replace(/_normal\./, '.')
          .replace(/_x_small\./, '.')
          .replace(/_bigger\./, '.')
          .replace(/_200x200\./, '.')
          .replace(/_400x400\./, '.');
      }
      
      // Header/Banner image - explicitly searching for the banner image
      const headerImgEl = document.querySelector('a[href$="/header_photo"] img.css-9pa8cd') || 
                         document.querySelector('img[src*="profile_banners"]') ||
                         document.querySelector('div[style*="background-image"][style*="profile_banners"]');
      
      if (headerImgEl && headerImgEl.src) {
        profile.images.header_image = headerImgEl.src;
      } else {
        // Try to extract from background image style
        const bgElements = document.querySelectorAll('div[style*="background-image"]');
        for (const bgElement of bgElements) {
          const style = bgElement.getAttribute('style');
          const match = style && style.match(/url\(['"]?(https:\/\/pbs\.twimg\.com\/profile_banners\/[^'"]+)['"]?\)/);
          if (match && match[1]) {
            profile.images.header_image = match[1];
            break;
          }
        }
      }
      
      return profile;
    });
    
    console.log('Extracted profile information');
    
    // Extract follower/following stats with updated selectors
    console.log('Extracting follower stats...');
    result.stats = await page.evaluate(() => {
      const stats = {
        following: '0',
        followers: '0'
      };
      
      // First method: Look for specific links that contain the follower/following counts
      const profileStatLinks = document.querySelectorAll('a[href*="/following"], a[href*="/followers"], a[href*="/verified_followers"]');
      
      for (const link of profileStatLinks) {
        const href = link.getAttribute('href');
        // Find all spans inside the link
        const numericSpans = Array.from(link.querySelectorAll('span')).filter(span => {
          const text = span.textContent.trim();
          // Match numeric patterns, including those with K, M, B suffixes or language-specific formats (like "1 B")
          return /^\d+(?:[,.]\d+)?(?:\s*[KkMmBb])?$/.test(text);
        });
        
        // Use the first numeric span found
        if (numericSpans.length > 0) {
          const countText = numericSpans[0].textContent.trim();
          
          if (href.includes('/following')) {
            stats.following = countText;
          } else if (href.includes('/follower')) {
            stats.followers = countText;
          }
        }
      }
      
      // Second method: Look for spans with specific CSS classes that typically contain numbers
      if (stats.following === '0' || stats.followers === '0') {
        const allLinks = document.querySelectorAll('a[role="link"]');
        
        for (const link of allLinks) {
          const text = link.textContent.trim().toLowerCase();
          
          if (text.includes('following')) {
            // Extract number from text like "207 Following"
            const match = text.match(/(\d+(?:[,.]\d+)?(?:\s*[KkMmBb])?)\s*following/i);
            if (match && match[1]) {
              stats.following = match[1].trim();
            }
          } else if (text.includes('follower')) {
            // Extract number from text like "24 Followers"
            const match = text.match(/(\d+(?:[,.]\d+)?(?:\s*[KkMmBb])?)\s*follower/i);
            if (match && match[1]) {
              stats.followers = match[1].trim();
            }
          }
        }
      }
      
      return stats;
    });
    
    console.log(`User @${username} has ${result.stats.followers} followers and ${result.stats.following} following`);
    
    // For each tab, collect tweets and analyze
    for (const tab of tabsToAnalyze) {
      // Navigate to the appropriate tab URL
      const tabUrl = tab === 'posts' 
        ? `https://x.com/${username}`
        : `https://x.com/${username}/${tab}`;
      
      console.log(`Navigating to ${tab} tab: ${tabUrl}`);
      await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for tweets to load
      try {
        await Promise.race([
          page.waitForSelector('article', { timeout: 10000 }),
          page.waitForSelector('div[data-testid="tweet"]', { timeout: 10000 }),
          page.waitForSelector('div[data-testid="tweetText"]', { timeout: 10000 })
        ]);
        console.log(`${tab} tab loaded successfully`);
      } catch (err) {
        console.log(`Warning: Could not detect tweets on ${tab} tab`);
        await page.screenshot({ path: `${tab}-debug.png` });
        continue; // Skip to next tab
      }
      
      // Collect tweets from the tab
      console.log(`Collecting tweets from ${tab} tab (limit: ${tweetLimit})...`);
      const tweets = await collectTweets(page, tweetLimit, scrollDelay);
      console.log(`Collected ${tweets.length} tweets from the ${tab} tab`);
      
      // Store tweets in result object
      result.tweets[tab] = tweets;
      
      // Analyze word frequency
      console.log(`Word analysis for ${tab} tab...`);
      result.wordAnalysis[tab] = analyzeWordFrequency(
        tweets, 
        minWordCount,
        excludeStopWords,
        language
      );
      
      console.log(`Word analysis completed for ${tab} tab:`);
      console.log(`- ${result.wordAnalysis[tab].analyzedTweets} tweets analyzed`);
      console.log(`- ${result.wordAnalysis[tab].totalWords} total words`);
      console.log(`- ${result.wordAnalysis[tab].uniqueWords} unique words`);
    }
    
    // Write results to output file
    console.log(`Writing user profile analysis to ${OUTFILE}`);
    fs.writeFileSync(OUTFILE, JSON.stringify(result, null, 2));
    console.log('User profile analysis saved successfully!');
    
  } catch (error) {
    console.error('Error during profile analysis:', error);
    
    // Save partial results
    if (Object.keys(result.profile).length > 0 || Object.keys(result.tweets).length > 0) {
      console.log('Saving partial results due to error');
      fs.writeFileSync(OUTFILE, JSON.stringify({
        ...result,
        error: {
          message: error.message,
          stack: error.stack
        }
      }, null, 2));
    }
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

// Function to collect tweets from a page
async function collectTweets(page, limit, scrollDelay) {
  const tweets = [];
  const tweetIds = new Set(); // To avoid duplicates
  let previousHeight = 0;
  let noNewTweetsCount = 0;
  const maxNoNewTweets = 3; // Stop after 3 scrolls with no new tweets
  
  while (tweets.length < limit && noNewTweetsCount < maxNoNewTweets) {
    // Extract tweets from the page
    const newTweets = await page.evaluate(() => {
      const extractedTweets = [];
      
      // Various selectors for tweet containers
      const tweetElements = document.querySelectorAll('article, div[data-testid="tweet"]');
      
      tweetElements.forEach(article => {
        // Extract tweet content with fallbacks
        let content = '';
        const contentEl = article.querySelector('div[data-testid="tweetText"]') || 
                          article.querySelector('div[lang]');
        if (contentEl) {
          content = contentEl.innerText.trim();
        }
        
        // Extract tweet ID
        let tweetId = '';
        let tweetUrl = '';
        
        // Try multiple methods to get tweet ID/URL
        const statusLinks = Array.from(article.querySelectorAll('a'))
          .filter(a => a.href && a.href.includes('/status/'));
        
        if (statusLinks.length > 0) {
          const statusLink = statusLinks[0];
          tweetUrl = statusLink.href;
          
          const match = tweetUrl.match(/\/status\/(\d+)/);
          if (match) {
            tweetId = match[1];
          }
        }
        
        // Extract timestamp
        let timestamp = '';
        const timeEl = article.querySelector('time');
        if (timeEl) {
          timestamp = timeEl.getAttribute('datetime');
        }
        
        // Extract media (images, videos)
        const media = [];
        
        // Images
        const images = article.querySelectorAll('img[src*="media"]');
        images.forEach(img => {
          if (!img.src.includes('profile_images') && !img.src.includes('emoji')) {
            media.push({ type: 'image', url: img.src });
          }
        });
        
        // Videos
        const videos = article.querySelectorAll('video');
        videos.forEach(video => {
          if (video.poster) {
            media.push({ type: 'video', url: video.poster });
          }
        });
        
        // Extract engagement metrics with improved support for international formats
        const engagement = {};
        
        // Method 1: Look for specific spans containing engagement metrics
        const engagementButtons = article.querySelectorAll('div[role="button"]');
        for (const button of engagementButtons) {
          // Find spans that might contain numbers
          const spans = button.querySelectorAll('span');
          
          // Look for spans that contain only numbers (possibly with K, M, or B suffixes)
          // This includes formats like "1 B" (with space) common in some locales
          let metricValue = null;
          for (const span of spans) {
            const text = span.textContent.trim();
            // Match numbers with potential K/M/B suffix with or without space
            if (/^\d+(?:[,.]\d+)?(?:\s*[KkMmBb])?$/.test(text)) {
              metricValue = text;
              break;
            }
          }
          
          if (!metricValue) continue;
          
          // Check what type of engagement metric this is based on adjacent SVGs or aria-label
          const ariaLabel = button.getAttribute('aria-label') || '';
          const buttonText = button.textContent.toLowerCase();
          const svgPaths = Array.from(button.querySelectorAll('svg path')).map(path => path.getAttribute('d') || '');
          
          // Comment/Reply detection
          if (buttonText.includes('repl') || buttonText.includes('comment') || 
              ariaLabel.includes('repl') || ariaLabel.includes('comment') || 
              svgPaths.some(d => d.includes('M14.046 2.242l-4.148-.01h-.002c-4.374'))) {
            engagement.replies = metricValue;
          }
          // Retweet/Repost detection
          else if (buttonText.includes('retweet') || buttonText.includes('repost') || 
                  ariaLabel.includes('retweet') || ariaLabel.includes('repost') || 
                  svgPaths.some(d => d.includes('M23.77 15.67c-.292-.293-.767-.293-1.06 0l-2.22'))) {
            engagement.retweets = metricValue;
          }
          // Like detection
          else if (buttonText.includes('like') || buttonText.includes('fav') || 
                  ariaLabel.includes('like') || ariaLabel.includes('fav') || 
                  svgPaths.some(d => d.includes('M12 21.638h-.014C9.403 21.59 1.95'))) {
            engagement.likes = metricValue;
          }
          // View detection
          else if (buttonText.includes('view') || 
                  ariaLabel.includes('view') || 
                  svgPaths.some(d => d.includes('M8.75 21V3h2v18h-2zM18'))) {
            engagement.views = metricValue;
          }
        }
        
        // Method 2: If the above didn't work, look for groups that contain metrics
        if (!engagement.replies || !engagement.retweets || !engagement.likes) {
          const engagementGroups = article.querySelectorAll('[role="group"]');
          
          for (const group of engagementGroups) {
            const text = group.textContent.toLowerCase();
            let metricType = null;
            
            // Determine the type of metric
            if (text.includes('repl') || text.includes('comment')) {
              metricType = 'replies';
            } else if (text.includes('retweet') || text.includes('repost')) {
              metricType = 'retweets';
            } else if (text.includes('like') || text.includes('fav')) {
              metricType = 'likes';
            } else if (text.includes('view')) {
              metricType = 'views';
            }
            
            if (metricType && !engagement[metricType]) {
              // Extract the metric value using a regex that handles various number formats
              // This includes international formats (with spaces, dots, or commas)
              const match = text.match(/(\d+(?:[,.]\d+)?(?:\s*[KkMmBb])?)/);
              if (match && match[1]) {
                engagement[metricType] = match[1].trim();
              }
            }
          }
        }
        
        // Only add tweets with an ID and content
        if (tweetId) {
          extractedTweets.push({
            tweetId,
            tweetUrl,
            content,
            timestamp,
            media,
            engagement
          });
        }
      });
      
      return extractedTweets;
    });
    
    // Add new unique tweets to collection
    let addedCount = 0;
    
    for (const tweet of newTweets) {
      if (!tweetIds.has(tweet.tweetId)) {
        tweets.push(tweet);
        tweetIds.add(tweet.tweetId);
        addedCount++;
        
        // Break if we've reached the limit
        if (tweets.length >= limit) {
          break;
        }
      }
    }
    
    console.log(`Found ${newTweets.length} tweets, added ${addedCount} new ones (total: ${tweets.length}/${limit})`);
    
    // Check if we found any new tweets
    if (addedCount === 0) {
      noNewTweetsCount++;
      console.log(`No new tweets in this scroll (attempt ${noNewTweetsCount}/${maxNoNewTweets})`);
    } else {
      noNewTweetsCount = 0;
    }
    
    // Scroll down to load more tweets
    previousHeight = await page.evaluate('document.body.scrollHeight');
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    console.log(`Scrolled down, waiting ${scrollDelay}ms for new content to load...`);
    await new Promise(resolve => setTimeout(resolve, scrollDelay));
    
    // Check if page height increased (more content loaded)
    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === previousHeight) {
      noNewTweetsCount++;
      console.log(`Page height didn't change (attempt ${noNewTweetsCount}/${maxNoNewTweets})`);
    }
  }
  
  console.log(`Finished collecting tweets: ${tweets.length} tweets collected`);
  return tweets;
}

// Run the profile analysis
analyzeUserProfile()
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });