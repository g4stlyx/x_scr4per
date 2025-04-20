# scr4pe_x
* x login info is needed in .env file: TWITTER_USER and TWITTER_PASS

* some resources to use:
  * https://pypi.org/project/twint/
  * https://nitter.net/search?q=lang%3Atr&f=tweets

## todo

* user-based, text-based, date-based search. (and combination of these)
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
* it only scrapes ~100 tweets per run, this should change. (i dont think there are limits for reading posts, so it shouldnt be a problem)
* user-based, text-base, date-based, tab-based(latest, popular, media etc.) search options
