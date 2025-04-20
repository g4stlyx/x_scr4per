# scrape_x

https://pypi.org/project/twint/
https://nitter.net/search?q=lang%3Atr&f=tweets

# v1

scrapes mobile.twitter.com/search?q=lang%3Atr&f=tweets and gets 1 page of tweets, stores them (overwrites) them into a json file
uses login info from .env and cookies for auth

# v2

username, display name, timestamp, userid, postid, post link, image links info for each tweet
appending new tweets into the json file instead of overwriting

# v3