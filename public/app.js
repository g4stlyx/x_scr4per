// X Scraper UI - Client Side JavaScript

// Global variables
let currentJobId = null;
let statusCheckInterval = null;
let tweetReloadInterval = null; // New variable for tracking tweet reload interval
let tweets = [];
let currentPage = 1;
let tweetsPerPage = 50;

// Variables for filtering tweets
let filterActive = false;
let filteredTweets = [];

// DOM ready
document.addEventListener('DOMContentLoaded', function() {
    // Form submission handler
    const scraperForm = document.getElementById('scraperForm');
    scraperForm.addEventListener('submit', startScraping);
    
    // Stop button handler
    document.getElementById('stopButton').addEventListener('click', stopScraping);
    
    // Tweet filter
    document.getElementById('tweetFilter').addEventListener('input', filterTweets);
    document.getElementById('clearFilter').addEventListener('click', clearFilter);
    
    // Download button
    document.getElementById('downloadBtn').addEventListener('click', downloadTweets);
    
    // Load existing jobs on page load
    loadJobs();
    
    // Add error handling for fetch operations
    window.addEventListener('error', function(e) {
        addConsoleMessage(`Global error: ${e.message}`, 'error');
    });
});

// Start scraping process
function startScraping(event) {
    event.preventDefault();
    
    // Collect form data
    const params = {
        user: document.getElementById('user').value.trim(),
        query: document.getElementById('query').value.trim(),
        since: document.getElementById('since').value,
        until: document.getElementById('until').value,
        tab: document.getElementById('tab').value,
        lang: document.getElementById('lang').value.trim(),
        limit: document.getElementById('limit').value ? parseInt(document.getElementById('limit').value) : null,
        maxNoNew: document.getElementById('maxNoNew').value ? parseInt(document.getElementById('maxNoNew').value) : 3,
        scrollDelay: document.getElementById('scrollDelay').value ? parseInt(document.getElementById('scrollDelay').value) : 500,
        headless: document.getElementById('headlessMode').checked // Add headless mode setting
    };
    
    // Basic validation
    if (!params.query && !params.user) {
        addConsoleMessage('Please provide either a search query or username.', 'error');
        return;
    }
    
    // Clear any existing intervals from previous jobs
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
    
    if (tweetReloadInterval) {
        clearInterval(tweetReloadInterval);
        tweetReloadInterval = null;
    }
    
    addConsoleMessage('Starting scraper...', 'info');
    if (!params.headless) {
        addConsoleMessage('Running in visible mode - a browser window will open.', 'info');
    } else {
        addConsoleMessage('Running in headless mode - browser will run invisibly.', 'info');
    }
    
    // Send the scraping request to the server
    fetch('/api/scrape', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        currentJobId = data.jobId;
        
        // Setup UI for active job
        document.getElementById('currentJobCard').style.display = 'block';
        document.getElementById('jobTitle').textContent = getJobTitle(params);
        document.getElementById('jobDetails').textContent = getJobDetails(params);
        document.getElementById('jobStatus').textContent = 'Running';
        document.getElementById('jobStatus').className = 'badge bg-primary status-running';
        document.getElementById('jobTime').textContent = `Start Time: ${new Date().toLocaleTimeString()}`;
        
        // Clear previous job data
        document.getElementById('tweetCounter').textContent = '0';
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('progressBar').textContent = '0%';
        tweets = [];
        updateTweetContainer(tweets);
        
        // Switch to console tab to show progress
        const consoleTab = document.querySelector('#console-tab');
        bootstrap.Tab.getOrCreateInstance(consoleTab).show();
        
        // Start periodic status checking
        if (statusCheckInterval) {
            clearInterval(statusCheckInterval);
        }
        
        statusCheckInterval = setInterval(() => {
            checkJobStatus(currentJobId);
        }, 2000);
        
        addConsoleMessage(`Started scraping job ID: ${currentJobId}`, 'success');
    })
    .catch(error => {
        addConsoleMessage(`Error starting scraper: ${error.message}`, 'error');
        console.error('Fetch error:', error);
    });
}

// Stop the current scraping job
function stopScraping() {
    if (!currentJobId) return;
    
    fetch(`/api/stop/${currentJobId}`, {
        method: 'POST'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        document.getElementById('jobStatus').textContent = 'Stopped';
        document.getElementById('jobStatus').className = 'badge bg-warning status-stopped';
        addConsoleMessage('Scraping job stopped by user', 'warning');
    })
    .catch(error => {
        addConsoleMessage(`Error stopping job: ${error.message}`, 'error');
        console.error('Fetch error:', error);
    });
}

// Check job status and update UI
function checkJobStatus(jobId) {
    fetch(`/api/status/${jobId}`)
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Update console with new output
        if (data.output && data.output.length > 0) {
            const consoleOutput = document.getElementById('consoleOutput');
            const currentLines = consoleOutput.querySelectorAll('.console-line').length;
            
            // Only add new lines
            for (let i = currentLines; i < data.output.length; i++) {
                const line = data.output[i];
                addConsoleMessage(line.text, line.isError ? 'error' : '');
                
                // Extract tweet count if available
                const countMatch = line.text.match(/collected so far: (\d+)/);
                if (countMatch && countMatch[1]) {
                    document.getElementById('tweetCounter').textContent = countMatch[1];
                    
                    // Update progress if we have a limit
                    if (data.params.limit) {
                        const progress = Math.min(100, Math.round((parseInt(countMatch[1]) / data.params.limit) * 100));
                        document.getElementById('progressBar').style.width = `${progress}%`;
                        document.getElementById('progressBar').textContent = `${progress}%`;
                    }
                    
                    // If we've collected more tweets than we currently have, refresh the data
                    const currentTweetCount = parseInt(countMatch[1]);
                    if (currentTweetCount > tweets.length) {
                        loadTweets(jobId);
                    }
                }
            }
        }
        
        // Check if job is completed
        if (data.status !== 'running') {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
            
            if (tweetReloadInterval) {
                clearInterval(tweetReloadInterval);
                tweetReloadInterval = null;
            }
            
            document.getElementById('jobStatus').textContent = capitalizeFirstLetter(data.status);
            document.getElementById('jobStatus').className = `badge status-${data.status}`;
            
            if (data.status === 'completed') {
                addConsoleMessage('Scraping job completed successfully', 'success');
                document.getElementById('progressBar').style.width = '100%';
                document.getElementById('progressBar').textContent = '100%';
                loadTweets(jobId);
            } else if (data.status === 'failed') {
                addConsoleMessage('Scraping job failed', 'error');
            }
            
            // Update job end time
            if (data.endTime) {
                const startTime = new Date(data.startTime).toLocaleTimeString();
                const endTime = new Date(data.endTime).toLocaleTimeString();
                document.getElementById('jobTime').textContent = `${startTime} - ${endTime}`;
            }
            
            // Refresh jobs list
            loadJobs();
        }
        
        // If there's no tweet data yet but the job is running, load any available tweets
        if (tweets.length === 0 && document.getElementById('tweetCounter').textContent !== '0') {
            loadTweets(jobId);
        }
        
        // Setup periodic tweet data refresh while job is running (if not already set)
        if (data.status === 'running' && !tweetReloadInterval) {
            tweetReloadInterval = setInterval(() => {
                loadTweets(jobId);
            }, 10000); // Refresh every 10 seconds
        }
    })
    .catch(error => {
        console.error('Error checking job status:', error);
        addConsoleMessage(`Error checking job status: ${error.message}`, 'error');
        // If we get multiple errors, stop the status checking
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
            
            if (tweetReloadInterval) {
                clearInterval(tweetReloadInterval);
                tweetReloadInterval = null;
            }
            
            addConsoleMessage('Connection to server lost. Please refresh the page.', 'error');
        }
    });
}

// Load tweets from a specific job
function loadTweets(jobId) {
    addConsoleMessage(`Loading tweets from job ${jobId}...`, 'info');
    fetch(`/api/tweets/${jobId}`)
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.tweets && data.tweets.length > 0) {
            // Store the entire array of tweets
            tweets = Array.isArray(data.tweets) ? data.tweets : [];
            currentPage = 1; // Reset to first page when loading new tweets
            
            // Debug log to help identify any parsing issues
            console.log(`Received data from server, tweets array length: ${tweets.length}`);
            console.log(`First tweet in array:`, tweets[0]);
            console.log(`Last tweet in array:`, tweets[tweets.length - 1]);
            
            // Force page number dropdown to reflect current selection
            const pageSizeSelect = document.getElementById('pageSize');
            if (pageSizeSelect) {
                tweetsPerPage = parseInt(pageSizeSelect.value);
            } else {
                // Default to 50 if no select element exists yet
                tweetsPerPage = 50;
            }
            
            // Ensure we have a valid tweets per page value
            if (isNaN(tweetsPerPage) || tweetsPerPage <= 0) {
                tweetsPerPage = 50;
            }
            
            // Update the counter to show the actual number of tweets loaded
            document.getElementById('tweetCounter').textContent = tweets.length;
            
            // Log accurate tweet count to help with debugging
            addConsoleMessage(`Successfully loaded ${tweets.length} tweets from JSON file.`, 'success');
            console.log(`Loaded ${tweets.length} tweets from server, displaying with ${tweetsPerPage} per page`);
            
            // Update the UI with loaded tweets
            updateTweetContainer(tweets);
            
            // Switch to tweets tab
            const resultsTab = document.querySelector('#results-tab');
            bootstrap.Tab.getOrCreateInstance(resultsTab).show();
        } else {
            addConsoleMessage('No tweets were returned from the server.', 'warning');
        }
    })
    .catch(error => {
        addConsoleMessage(`Error loading tweets: ${error.message}`, 'error');
        console.error('Fetch error:', error);
    });
}

// Update the tweet container with tweets
function updateTweetContainer(tweetsToDisplay) {
    const container = document.getElementById('tweetsContainer');
    
    if (!tweetsToDisplay || tweetsToDisplay.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No tweets available yet.</div>';
        document.getElementById('pagination').style.display = 'none';
        return;
    }
    
    // Log detailed information about the current state
    console.log(`updateTweetContainer called with ${tweetsToDisplay.length} tweets`);
    console.log(`Current page: ${currentPage}, tweets per page: ${tweetsPerPage}`);
    
    // Make sure tweetsPerPage is a valid number
    if (isNaN(tweetsPerPage) || tweetsPerPage <= 0) {
        console.warn("Invalid tweetsPerPage value, resetting to 50");
        tweetsPerPage = 50;
    }
    
    // Special case for "All" option
    if (tweetsPerPage >= 99999) {
        tweetsPerPage = tweetsToDisplay.length;
        console.log("Using 'All' option - setting tweets per page to:", tweetsPerPage);
    }
    
    // Calculate total pages - ensure we always have at least one page
    const totalPages = Math.max(1, Math.ceil(tweetsToDisplay.length / tweetsPerPage));
    console.log(`Total pages calculated: ${totalPages}`);
    
    // Ensure currentPage is in valid range
    if (currentPage > totalPages) {
        currentPage = totalPages;
    } else if (currentPage < 1) {
        currentPage = 1;
    }
    
    // Calculate start and end indices
    const startIndex = (currentPage - 1) * tweetsPerPage;
    const endIndex = Math.min(startIndex + tweetsPerPage, tweetsToDisplay.length);
    
    console.log(`Using start index: ${startIndex}, end index: ${endIndex}`);
    
    // Get current page tweets
    let currentPageTweets = tweetsToDisplay.slice(startIndex, endIndex);
    console.log(`Sliced ${currentPageTweets.length} tweets for current page display`);
    
    // Additional validation to ensure we're displaying the right data
    if (currentPageTweets.length === 0 && tweetsToDisplay.length > 0) {
        console.warn("No tweets to display on current page despite having tweets available");
        currentPage = 1; // Reset to first page
        const newStartIndex = 0;
        const newEndIndex = Math.min(tweetsPerPage, tweetsToDisplay.length);
        currentPageTweets = tweetsToDisplay.slice(newStartIndex, newEndIndex);
        console.log(`Reset to page 1, now showing tweets ${newStartIndex + 1} to ${newEndIndex}`);
    }
    
    container.innerHTML = '';
    
    // Display tweet count information with more details - FIXED to show correct total count
    const totalCount = filterActive ? filteredTweets.length : tweets.length;
    
    // Add refresh button to allow manual refresh of tweet data
    const refreshButtonHtml = currentJobId ? `
        <button id="refreshTweetsBtn" class="btn btn-sm btn-outline-primary ms-2" title="Refresh tweet data">
            <i class="fas fa-sync-alt"></i> Refresh Data
        </button>
    ` : '';
    
    container.innerHTML += `
        <div class="alert alert-info mb-3 d-flex justify-content-between align-items-center">
            <div>
                <strong>Showing tweets ${startIndex + 1} to ${endIndex} of ${totalCount} total</strong>
                <br><small class="text-muted">Page ${currentPage} of ${totalPages} • ${tweetsPerPage} tweets per page • ${totalCount} tweets in dataset</small>
            </div>
            <div>${refreshButtonHtml}</div>
        </div>
    `;
    
    // Add event listener to refresh button if it exists
    const refreshButton = document.getElementById('refreshTweetsBtn');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            if (currentJobId) {
                refreshButton.disabled = true;
                refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                loadTweets(currentJobId);
                setTimeout(() => {
                    refreshButton.disabled = false;
                    refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data';
                }, 2000);
            }
        });
    }
    
    // Create tweet cards
    currentPageTweets.forEach(tweet => {
        const tweetCard = document.createElement('div');
        tweetCard.className = 'card tweet-card p-3';
        
        // Create tweet header with user info
        const tweetHeader = document.createElement('div');
        tweetHeader.className = 'tweet-header';
        
        const userName = document.createElement('div');
        userName.className = 'tweet-username';
        userName.textContent = tweet.displayName || 'Unknown User';
        
        const userHandle = document.createElement('div');
        userHandle.className = 'tweet-handle';
        userHandle.textContent = tweet.username ? `@${tweet.username}` : '';
        
        tweetHeader.appendChild(userName);
        tweetHeader.appendChild(userHandle);
        
        // Create tweet content
        const tweetContent = document.createElement('div');
        tweetContent.className = 'tweet-content';
        tweetContent.textContent = tweet.content;
        
        // Create sentiment indicator if sentiment data exists
        if (tweet.sentiment) {
            const sentimentDiv = document.createElement('div');
            sentimentDiv.className = 'tweet-sentiment';
            
            // Determine sentiment class based on score
            let sentimentClass = 'neutral';
            let sentimentLabel = 'Neutral';
            
            if (tweet.sentiment.score > 0) {
                sentimentClass = 'positive';
                sentimentLabel = 'Positive';
            } else if (tweet.sentiment.score < 0) {
                sentimentClass = 'negative';
                sentimentLabel = 'Negative';
            }
            
            // Create emoji list if available
            let emojiDisplay = '';
            if (tweet.sentiment.emojis && tweet.sentiment.emojis.length > 0) {
                const emojiList = tweet.sentiment.emojis.map(e => e.emoji).join(' ');
                emojiDisplay = `<span class="sentiment-emojis" title="Emojis detected">${emojiList}</span>`;
            }
            
            // Create highlighted positive and negative word list
            let wordHighlights = '';
            if (tweet.sentiment.positive.length > 0 || tweet.sentiment.negative.length > 0) {
                const positiveWords = tweet.sentiment.positive.map(w => 
                    `<span class="word positive">${w}</span>`).join(' ');
                const negativeWords = tweet.sentiment.negative.map(w => 
                    `<span class="word negative">${w}</span>`).join(' ');
                    
                if (positiveWords || negativeWords) {
                    wordHighlights = `
                        <div class="sentiment-words small mt-1">
                            ${positiveWords ? `<div>Positive: ${positiveWords}</div>` : ''}
                            ${negativeWords ? `<div>Negative: ${negativeWords}</div>` : ''}
                        </div>
                    `;
                }
            }
            
            // Main sentiment display
            sentimentDiv.innerHTML = `
                <div class="d-flex align-items-center">
                    <span class="sentiment-badge ${sentimentClass}">${sentimentLabel}</span>
                    <span class="sentiment-score" title="Sentiment score: ${tweet.sentiment.score.toFixed(2)}">
                        Score: ${tweet.sentiment.score.toFixed(2)}
                    </span>
                    ${emojiDisplay}
                </div>
                ${wordHighlights}
            `;
            
            tweetContent.appendChild(sentimentDiv);
        }
        
        // Create tweet images if available
        let tweetImages = '';
        if (tweet.images && tweet.images.length > 0) {
            tweetImages = '<div class="tweet-images">';
            tweet.images.forEach(img => {
                tweetImages += `<img src="${img}" alt="Tweet media" class="tweet-image">`;
            });
            tweetImages += '</div>';
        }
        
        // Create tweet footer with timestamp and link
        const tweetFooter = document.createElement('div');
        tweetFooter.className = 'tweet-footer';
        
        let timestamp = 'Unknown time';
        if (tweet.timestamp) {
            const date = new Date(tweet.timestamp);
            timestamp = date.toLocaleString();
        }
        
        tweetFooter.innerHTML = `
            ${timestamp}
            ${tweet.tweetUrl ? `<a href="${tweet.tweetUrl}" target="_blank" class="ms-2">View on X</a>` : ''}
        `;
        
        // Assemble tweet card
        tweetCard.appendChild(tweetHeader);
        tweetCard.appendChild(tweetContent);
        if (tweetImages) {
            tweetCard.innerHTML += tweetImages;
        }
        tweetCard.appendChild(tweetFooter);
        
        container.appendChild(tweetCard);
    });
    
    // Always update pagination - the pagination function will handle hiding it if needed
    updatePagination(totalCount, totalPages);
}

// Update pagination controls
function updatePagination(totalItems, totalPages) {
    const paginationElement = document.getElementById('pagination');
    
    console.log(`updatePagination called: ${totalItems} items, ${totalPages} pages`);
    
    // Always show pagination controls as long as we have tweets
    // Only hide if we truly have no tweets or just one tweet
    if (totalItems <= 1) {
        paginationElement.style.display = 'none';
        return;
    }
    
    // Clear any existing pagination and ensure it's visible
    paginationElement.style.display = 'flex';
    paginationElement.innerHTML = '';
    
    // Create pagination UI
    const paginationNav = document.createElement('nav');
    paginationNav.setAttribute('aria-label', 'Tweet pagination');
    paginationNav.style.display = 'block';
    paginationNav.style.width = '100%';
    
    const pageList = document.createElement('ul');
    pageList.className = 'pagination';
    
    // Previous button
    const prevItem = document.createElement('li');
    prevItem.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    
    const prevLink = document.createElement('a');
    prevLink.className = 'page-link';
    prevLink.href = '#';
    prevLink.textContent = 'Previous';
    prevLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        }
    });
    
    prevItem.appendChild(prevLink);
    pageList.appendChild(prevItem);
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // Adjust start page if needed
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // First page link if needed
    if (startPage > 1) {
        const firstItem = document.createElement('li');
        firstItem.className = 'page-item';
        
        const firstLink = document.createElement('a');
        firstLink.className = 'page-link';
        firstLink.href = '#';
        firstLink.textContent = '1';
        firstLink.addEventListener('click', (e) => {
            e.preventDefault();
            currentPage = 1;
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        });
        
        firstItem.appendChild(firstLink);
        pageList.appendChild(firstItem);
        
        if (startPage > 2) {
            const ellipsisItem = document.createElement('li');
            ellipsisItem.className = 'page-item disabled';
            ellipsisItem.innerHTML = '<span class="page-link">...</span>';
            pageList.appendChild(ellipsisItem);
        }
    }
    
    // Page number buttons
    for (let i = startPage; i <= endPage; i++) {
        const pageItem = document.createElement('li');
        pageItem.className = `page-item ${i === currentPage ? 'active' : ''}`;
        
        const pageLink = document.createElement('a');
        pageLink.className = 'page-link';
        pageLink.href = '#';
        pageLink.textContent = i;
        pageLink.addEventListener('click', (e) => {
            e.preventDefault();
            currentPage = i;
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        });
        
        pageItem.appendChild(pageLink);
        pageList.appendChild(pageItem);
    }
    
    // Last page link if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsisItem = document.createElement('li');
            ellipsisItem.className = 'page-item disabled';
            ellipsisItem.innerHTML = '<span class="page-link">...</span>';
            pageList.appendChild(ellipsisItem);
        }
        
        const lastItem = document.createElement('li');
        lastItem.className = 'page-item';
        
        const lastLink = document.createElement('a');
        lastLink.className = 'page-link';
        lastLink.href = '#';
        lastLink.textContent = totalPages;
        lastLink.addEventListener('click', (e) => {
            e.preventDefault();
            currentPage = totalPages;
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        });
        
        lastItem.appendChild(lastLink);
        pageList.appendChild(lastItem);
    }
    
    // Next button
    const nextItem = document.createElement('li');
    nextItem.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    
    const nextLink = document.createElement('a');
    nextLink.className = 'page-link';
    nextLink.href = '#';
    nextLink.textContent = 'Next';
    nextLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage < totalPages) {
            currentPage++;
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        }
    });
    
    nextItem.appendChild(nextLink);
    pageList.appendChild(nextItem);
    
    paginationNav.appendChild(pageList);
    
    // Create a container div for better layout
    const paginationContainer = document.createElement('div');
    paginationContainer.className = 'pagination-container d-flex justify-content-between align-items-center w-100';
    paginationContainer.appendChild(paginationNav);
    
    // Add page size selector
    const pageSizeSelector = document.createElement('div');
    pageSizeSelector.className = 'ms-3 d-flex align-items-center';
    pageSizeSelector.innerHTML = `
        <label for="pageSize" class="me-2">Tweets per page:</label>
        <select id="pageSize" class="form-select form-select-sm" style="width: auto;">
            <option value="10" ${tweetsPerPage === 10 ? 'selected' : ''}>10</option>
            <option value="25" ${tweetsPerPage === 25 ? 'selected' : ''}>25</option>
            <option value="50" ${tweetsPerPage === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${tweetsPerPage === 100 ? 'selected' : ''}>100</option>
            <option value="200" ${tweetsPerPage === 200 ? 'selected' : ''}>200</option>
            <option value="500" ${tweetsPerPage === 500 ? 'selected' : ''}>500</option>
            <option value="1000" ${tweetsPerPage === 1000 ? 'selected' : ''}>1000</option>
            <option value="99999" ${tweetsPerPage === 99999 ? 'selected' : ''}>All</option>
        </select>
    `;
    
    paginationContainer.appendChild(pageSizeSelector);
    paginationElement.appendChild(paginationContainer);
    
    // Add event listener to page size selector
    document.getElementById('pageSize').addEventListener('change', function() {
        const newPageSize = parseInt(this.value);
        if (newPageSize !== tweetsPerPage) {
            console.log(`Changing page size from ${tweetsPerPage} to ${newPageSize}`);
            tweetsPerPage = newPageSize;
            currentPage = 1; // Reset to first page when changing page size
            updateTweetContainer(filterActive ? filteredTweets : tweets);
        }
    });
    
    // Add a console message to verify pagination is being updated
    console.log(`Pagination updated: ${totalPages} pages. Currently showing page ${currentPage} with ${tweetsPerPage} tweets per page`);
}

// Filter tweets based on search input
function filterTweets() {
    const filterText = document.getElementById('tweetFilter').value.toLowerCase();
    
    if (!filterText) {
        filterActive = false;
        currentPage = 1; // Reset to first page when clearing filter
        updateTweetContainer(tweets);
        return;
    }
    
    filterActive = true;
    filteredTweets = tweets.filter(tweet => {
        return (
            (tweet.content && tweet.content.toLowerCase().includes(filterText)) ||
            (tweet.username && tweet.username.toLowerCase().includes(filterText)) ||
            (tweet.displayName && tweet.displayName.toLowerCase().includes(filterText))
        );
    });
    
    currentPage = 1; // Reset to first page when applying new filter
    updateTweetContainer(filteredTweets);
}

// Clear tweet filter
function clearFilter() {
    document.getElementById('tweetFilter').value = '';
    filterActive = false;
    currentPage = 1; // Reset to first page when clearing filter
    updateTweetContainer(tweets);
}

// Download tweets as JSON
function downloadTweets() {
    if (!currentJobId) return;
    
    // Create a direct link to download endpoint
    const downloadLink = document.createElement('a');
    downloadLink.href = `/api/download/${currentJobId}`;
    downloadLink.download = `tweets_${currentJobId}.json`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

// Load existing jobs
function loadJobs() {
    fetch('/api/jobs')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(jobs => {
        const jobsTable = document.getElementById('jobsTable');
        jobsTable.innerHTML = '';
        
        if (jobs.length === 0) {
            jobsTable.innerHTML = '<tr><td colspan="6" class="text-center">No jobs found</td></tr>';
            return;
        }
        
        jobs.forEach(job => {
            const row = document.createElement('tr');
            
            // Job ID
            const idCell = document.createElement('td');
            idCell.textContent = job.jobId.substring(job.jobId.length - 6); // show last 6 digits for brevity
            row.appendChild(idCell);
            
            // Parameters
            const paramsCell = document.createElement('td');
            paramsCell.textContent = getJobTitle(job.params);
            row.appendChild(paramsCell);
            
            // Start Time
            const startCell = document.createElement('td');
            startCell.textContent = new Date(job.startTime).toLocaleString();
            row.appendChild(startCell);
            
            // End Time
            const endCell = document.createElement('td');
            endCell.textContent = job.endTime ? new Date(job.endTime).toLocaleString() : '-';
            row.appendChild(endCell);
            
            // Status
            const statusCell = document.createElement('td');
            const statusBadge = document.createElement('span');
            statusBadge.className = `badge status-${job.status}`;
            statusBadge.textContent = capitalizeFirstLetter(job.status);
            statusCell.appendChild(statusBadge);
            row.appendChild(statusCell);
            
            // Actions
            const actionsCell = document.createElement('td');
            
            // View button
            const viewButton = document.createElement('button');
            viewButton.className = 'btn btn-sm btn-primary me-2';
            viewButton.innerHTML = '<i class="fas fa-eye"></i>';
            viewButton.title = 'View tweets';
            viewButton.addEventListener('click', () => {
                currentJobId = job.jobId;
                loadTweets(job.jobId);
                
                // Update current job display
                document.getElementById('currentJobCard').style.display = 'block';
                document.getElementById('jobTitle').textContent = getJobTitle(job.params);
                document.getElementById('jobDetails').textContent = getJobDetails(job.params);
                document.getElementById('jobStatus').textContent = capitalizeFirstLetter(job.status);
                document.getElementById('jobStatus').className = `badge status-${job.status}`;
                
                // Update time display
                if (job.endTime) {
                    const startTime = new Date(job.startTime).toLocaleString();
                    const endTime = new Date(job.endTime).toLocaleString();
                    document.getElementById('jobTime').textContent = `${startTime} - ${endTime}`;
                } else {
                    document.getElementById('jobTime').textContent = `Start Time: ${new Date(job.startTime).toLocaleString()}`;
                }
            });
            actionsCell.appendChild(viewButton);
            
            // Download button
            const downloadButton = document.createElement('button');
            downloadButton.className = 'btn btn-sm btn-success';
            downloadButton.innerHTML = '<i class="fas fa-download"></i>';
            downloadButton.title = 'Download tweets';
            downloadButton.addEventListener('click', () => {
                const downloadLink = document.createElement('a');
                downloadLink.href = `/api/download/${job.jobId}`;
                downloadLink.download = `tweets_${job.jobId}.json`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
            actionsCell.appendChild(downloadButton);
            
            row.appendChild(actionsCell);
            
            jobsTable.appendChild(row);
        });
    })
    .catch(error => {
        console.error('Error loading jobs:', error);
        addConsoleMessage(`Error loading jobs: ${error.message}`, 'error');
    });
}

// Utility function to add a message to the console output
function addConsoleMessage(message, type = '') {
    const consoleOutput = document.getElementById('consoleOutput');
    const line = document.createElement('div');
    line.className = `console-line ${type ? 'console-' + type : ''}`;
    line.textContent = message;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Helper function to generate a job title from parameters
function getJobTitle(params) {
    if (params.user && params.query) {
        return `@${params.user} + "${params.query}"`;
    } else if (params.user) {
        return `@${params.user}'s tweets`;
    } else if (params.query) {
        return `Search: "${params.query}"`;
    } else {
        return 'X Scraping Job';
    }
}

// Helper function to generate detailed job description
function getJobDetails(params) {
    let details = [];
    
    if (params.lang) details.push(`Lang: ${params.lang}`);
    if (params.tab) details.push(`Tab: ${params.tab}`);
    if (params.since || params.until) {
        const dateRange = [];
        if (params.since) dateRange.push(params.since);
        dateRange.push('to');
        if (params.until) dateRange.push(params.until);
        else dateRange.push('now');
        details.push(`Date: ${dateRange.join(' ')}`);
    }
    if (params.limit) details.push(`Limit: ${params.limit} tweets`);
    
    return details.join(' • ');
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}