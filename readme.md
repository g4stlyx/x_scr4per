# HOW TO RUN
* x login info is needed in .env file: 
  * TWITTER_USER
  * TWITTER_PASS
* PORT (optional for the server port)

### using x_scraper.js as script

* using it with parameters:
  * --user=username (from:)
  * --query="keywords or phrase"
  * --since=YYYY-MM-DD
  * --until=YYYY-MM-DD
  * --tab=[latest|top|media] (defaults to latest/live)
  * --limit=N (max tweets)
  * --lang (default “tr”) filters by language code in the query.
  * --outfile (default “tweets.json”) controls where JSON is read/written.

* examples:
  * Latest Turkish tweets about “deprem”: node scrape_x.js --query=deprem --tab=latest --limit=200 --lang=tr
  * Top tweets from @elonmusk since April 1, 2025: node scrape_x.js --user=elonmusk --since=2025-04-01 --tab=top
  * node .\scrape_x.js --lang="en" --query="madrid" --tab="top" --limit=1000 --outfile="madrid_tweets.json"

* if you want "too much data" about something, paginate via date. example: 
  * node scrape_x.js --lang=en --query=madrid --tab=latest \
  --since=2025-04-01 --until=2025-04-10 --limit=500 \
  --outfile=madrid_1_10.json
  * node scrape_x.js --lang=en --query=madrid --tab=latest \
  --since=2025-04-10 --until=2025-04-20 --limit=500 \
  --outfile=madrid_10_20.json

### using it with a ui

run ``npm i | node server.js`` and go to ``http://localhost:3000``

<br><br>

# TODO

* ui
* sentiment analysis? based on some words/emojis
* bot detection? based on repetations
* user profiling/classifaction?

<br><br> 

# VERSIONS

### v1

* scrapes mobile.twitter.com/search?q=lang%3Atr&f=tweets and gets 1 page of tweets, stores them (overwrites) them into a json file
* uses login info from .env and cookies for auth

### v2

- Fixed display name and userId extraction using data-testid selectors
- Each tweet object now includes:
  - username, displayName, userId
  - content, timestamp
  - tweetUrl, tweetId
  - images (array of media URLs)
- Appends only new tweets into the JSON file without overwriting existing entries

### v3

* out and archieve folders for a cleaner structure/design
* language filter is now optional.
* parameters to filter & search better:
  * .option('lang', { type: 'string', describe: 'Language code to filter tweets (e.g. tr, en). If not provided, no language filter is applied.' })
  * .option('user', { type: 'string', describe: 'Filter tweets from a specific user (without @)' })
  * .option('query', { type: 'string', describe: 'Keyword or text to search for' })
  * .option('since', { type: 'string', describe: 'Start date (YYYY-MM-DD)' })
  * .option('until', { type: 'string', describe: 'End date (YYYY-MM-DD)' })
  * .option('tab', { choices: ['latest','top','media'], default: 'latest', describe: 'Search tab: latest, top, or media' })
  * .option('limit', { type: 'number', describe: 'Max number of tweets to scrape' })
  * .option('outfile', { type: 'string', default: 'tweets.json', describe: 'Path to output JSON file' })
  * .option('maxNoNew', { type: 'number', default: 3, describe: 'Number of empty scrolls to detect end of feed' })
* no more limits now (i only tested it upto 522 tweets)
* when ctrl+c, it now saves the tweets it fetched until the end before exiting the script.

### v4

* .option('scrollDelay', { type: 'number', default: 500, describe: 'Delay in ms between scrolls (lower = faster scraping)' })
* Performance improvements:
  * Reduced default wait time between scrolls from 2000ms to 500ms for faster scraping
  * Added configurable scrollDelay parameter to fine-tune scraping speed
  * Example usage: `node scrape_x.js --query="ai" --scrollDelay=300` for even faster scraping
  * Note: Using very low delay values (<200ms) might cause Twitter to load tweets inconsistently
* ex: node scrape_x.js --tab=latest --limit=1000 --lang=tr --scrollDelay=200 --maxNoNew=20 --outfile=out/2msec_test.json

### v5

* a nice ui and an nodeJS api is added.
  * pagination in ui.
* .option('headless', { type: 'boolean', default: true, describe: 'Run browser in headless mode (invisible)' })
  * now we dont have to see a literal browser scrolling down for tweets.

### v6 to go

* sentiment analysis, does not work too well. another package can be tried to use.
* the max tweet count seems approximately 900, x makes you stop scrolling down (getting posts) at some point.

### v7 to go
bot analysis, user profiling/classifaction?