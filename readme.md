# scr4pe_x
* x login info is needed in .env file: 
  * TWITTER_USER
  * TWITTER_PASS

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
  * Latest Turkish tweets about “deprem”: node scrape_x.js --query=deprem --tab=latest --limit=200
  * Top tweets from @elonmusk since April 1, 2025: node scrape_x.js --user=elonmusk --since=2025-04-01 --tab=top
  * node .\scrape_x.js --lang="en" --query="madrid" --tab="top" --limit=1000 --outfile="madrid_tweets.json"

* if you want "too much data" about something, paginate via date. example: 
  * node scrape_x.js --lang=en --query=madrid --tab=latest \
  --since=2025-04-01 --until=2025-04-10 --limit=500 \
  --outfile=madrid_1_10.json
  * node scrape_x.js --lang=en --query=madrid --tab=latest \
  --since=2025-04-10 --until=2025-04-20 --limit=500 \
  --outfile=madrid_10_20.json

## todo

* retweets scrape option on-off 
* maybe sentiment analysis based on some words/emojis
* maybe bot detection based on repetations

## v1

* scrapes mobile.twitter.com/search?q=lang%3Atr&f=tweets and gets 1 page of tweets, stores them (overwrites) them into a json file
* uses login info from .env and cookies for auth

## v2

- Fixed display name and userId extraction using data-testid selectors
- Each tweet object now includes:
  - username, displayName, userId
  - content, timestamp
  - tweetUrl, tweetId
  - images (array of media URLs)
- Appends only new tweets into the JSON file without overwriting existing entries

## v3

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
  * .option('lang', { type: 'string', default: 'tr', describe: 'Language code to filter tweets (e.g. tr, en)' })
  * .option('outfile', { type: 'string', default: 'tweets.json', describe: 'Path to output JSON file' })
  * .option('maxNoNew', { type: 'number', default: 3, describe: 'Number of empty scrolls to detect end of feed' })
* no more limits now (i only tested it upto 522 tweets)
* when ctrl+c, it now saves the tweets it fetched until the end before exiting the script.

## v4