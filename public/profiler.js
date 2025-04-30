// User Profiler Frontend Script

// Global variables for profile data
let currentProfileData = null;
let currentProfileId = null;
let profileStatusCheckInterval = null;

document.addEventListener('DOMContentLoaded', function() {
    // Form submission handler
    const profilerForm = document.getElementById('profilerForm');
    if (profilerForm) {
        profilerForm.addEventListener('submit', startProfiling);
    }

    // Stop button handler
    const stopProfilerButton = document.getElementById('stopProfilerButton');
    if (stopProfilerButton) {
        stopProfilerButton.addEventListener('click', stopProfiling);
    }

    // Tab selectors for word analysis and tweet samples
    const wordAnalysisTabSelector = document.getElementById('wordAnalysisTabSelector');
    if (wordAnalysisTabSelector) {
        wordAnalysisTabSelector.addEventListener('change', updateWordAnalysisView);
    }

    const tweetSampleTabSelector = document.getElementById('tweetSampleTabSelector');
    if (tweetSampleTabSelector) {
        tweetSampleTabSelector.addEventListener('change', updateTweetSamplesView);
    }

    // Download word analysis button
    const downloadWordAnalysisBtn = document.getElementById('downloadWordAnalysisBtn');
    if (downloadWordAnalysisBtn) {
        downloadWordAnalysisBtn.addEventListener('click', downloadWordAnalysis);
    }

    // Load previous profiles
    loadPreviousProfiles();
    
    // Setup navbar tab functionality
    setupTabNavigation();
});

// Set up tab navigation
function setupTabNavigation() {
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
            
            // Show the corresponding tab
            const tabId = this.getAttribute('href');
            if (tabId && tabId.startsWith('#')) {
                const tabPane = document.querySelector(tabId);
                if (tabPane) {
                    // Hide all tab panes
                    document.querySelectorAll('.container-fluid > .tab-pane').forEach(pane => {
                        pane.classList.remove('show', 'active');
                    });
                    
                    // Show the selected tab pane
                    tabPane.classList.add('show', 'active');
                }
            }
        });
    });
}

// Start profiling process
function startProfiling(event) {
    event.preventDefault();
    
    // Collect form data
    const username = document.getElementById('profileUsername').value.trim();
    if (!username) {
        addProfilerConsoleMessage('Please enter a valid username', 'error');
        return;
    }
    
    // Gather all parameters
    const params = {
        username: username,
        tab: document.getElementById('profileTab').value,
        limit: parseInt(document.getElementById('tweetLimit').value) || 100,
        minWordCount: parseInt(document.getElementById('minWordCount').value) || 2,
        language: document.getElementById('profilerLanguage').value,
        excludeStopWords: document.getElementById('excludeStopWords').checked,
        headless: document.getElementById('profileHeadlessMode').checked,
        scrollDelay: parseInt(document.getElementById('profileScrollDelay').value) || 800
    };
    
    // Custom output filename if provided
    const customFileName = document.getElementById('profileOutputFile').value.trim();
    if (customFileName) {
        params.outfile = `out/${customFileName.replace(/[^a-z0-9_-]/gi, '_')}.json`;
    } else {
        params.outfile = `out/profile_${username}_${Date.now()}.json`;
    }
    
    // Clear previous profile data
    currentProfileData = null;
    
    // Setup UI for active profile job
    document.getElementById('profileJobCard').style.display = 'block';
    document.getElementById('profileTitle').textContent = `Analyzing @${username}`;
    document.getElementById('profileDetails').textContent = `Tab: ${params.tab}, Limit: ${params.limit} tweets`;
    document.getElementById('profileStatus').textContent = 'Running';
    document.getElementById('profileProgressBar').style.width = '0%';
    document.getElementById('profileProgressBar').textContent = '0%';
    
    // Clear any existing interval
    if (profileStatusCheckInterval) {
        clearInterval(profileStatusCheckInterval);
    }
    
    // Show loading indicators in result tabs
    document.getElementById('profileInfoPlaceholder').style.display = 'block';
    document.getElementById('profileInfoContainer').style.display = 'none';
    document.getElementById('wordAnalysisPlaceholder').style.display = 'block';
    document.getElementById('wordAnalysisContainer').style.display = 'none';
    document.getElementById('tweetSamplesPlaceholder').style.display = 'block';
    
    // Switch to profiler console tab to show progress
    const consoleTab = document.querySelector('#profilerConsole-tab');
    bootstrap.Tab.getOrCreateInstance(consoleTab).show();
    
    // Send the profiling request to the server
    addProfilerConsoleMessage(`Starting user profiling for @${username}...`);
    
    fetch('/api/profile', {
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
        currentProfileId = data.profileId;
        
        // Start periodic status checking
        profileStatusCheckInterval = setInterval(() => {
            checkProfileStatus(currentProfileId);
        }, 2000);
        
        addProfilerConsoleMessage(`Profile analysis job started with ID: ${currentProfileId}`, 'success');
    })
    .catch(error => {
        addProfilerConsoleMessage(`Error starting profile analysis: ${error.message}`, 'error');
        document.getElementById('profileStatus').textContent = 'Error';
        document.getElementById('profileStatus').className = 'badge bg-danger';
    });
}

// Check profile job status
function checkProfileStatus(profileId) {
    if (!profileId) return;
    
    fetch(`/api/profile-status/${profileId}`)
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Update console with new output
        if (data.output && data.output.length > 0) {
            const consoleOutput = document.getElementById('profilerConsoleOutput');
            const currentLines = consoleOutput.querySelectorAll('.console-line').length;
            
            // Only add new lines
            for (let i = currentLines; i < data.output.length; i++) {
                const line = data.output[i];
                addProfilerConsoleMessage(line.text, line.isError ? 'error' : '');
                
                // Update progress based on output messages
                updateProgressFromConsoleOutput(line.text);
            }
        }
        
        // Update status badge
        document.getElementById('profileStatus').textContent = capitalizeFirstLetter(data.status);
        
        // Check if job is completed
        if (data.status !== 'running') {
            clearInterval(profileStatusCheckInterval);
            
            if (data.status === 'completed') {
                document.getElementById('profileStatus').className = 'badge bg-success';
                document.getElementById('profileProgressBar').style.width = '100%';
                document.getElementById('profileProgressBar').textContent = '100%';
                
                // Load profile data
                loadProfileData(profileId);
                
                // Refresh previous profiles list
                loadPreviousProfiles();
                
                addProfilerConsoleMessage('Profile analysis completed successfully', 'success');
            } else if (data.status === 'failed') {
                document.getElementById('profileStatus').className = 'badge bg-danger';
                addProfilerConsoleMessage('Profile analysis failed', 'error');
            } else if (data.status === 'stopped') {
                document.getElementById('profileStatus').className = 'badge bg-warning';
                addProfilerConsoleMessage('Profile analysis stopped by user', 'warning');
            }
        }
    })
    .catch(error => {
        addProfilerConsoleMessage(`Error checking profile status: ${error.message}`, 'error');
    });
}

// Update progress bar based on console output
function updateProgressFromConsoleOutput(text) {
    // Try to detect progress indicators from console messages
    if (text.includes('Extracted profile information')) {
        updateProfileProgress(10, 'Profile information extracted');
    } else if (text.includes('Navigating to posts tab')) {
        updateProfileProgress(20, 'Analyzing posts');
    } else if (text.includes('Navigating to with_replies tab')) {
        updateProfileProgress(50, 'Analyzing replies');
    } else if (text.includes('Navigating to media tab')) {
        updateProfileProgress(70, 'Analyzing media');
    } else if (text.includes('Word analysis for')) {
        updateProfileProgress(85, 'Processing word statistics');
    } else if (text.includes('User profile analysis saved')) {
        updateProfileProgress(95, 'Finalizing results');
    }
}

// Update profile progress bar
function updateProfileProgress(percent, message) {
    const progressBar = document.getElementById('profileProgressBar');
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${percent}%`;
    
    if (message) {
        document.getElementById('profileDetails').textContent = message;
    }
}

// Stop ongoing profiling process
function stopProfiling() {
    if (!currentProfileId) return;
    
    fetch(`/api/stop-profile/${currentProfileId}`, {
        method: 'POST'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        document.getElementById('profileStatus').textContent = 'Stopped';
        document.getElementById('profileStatus').className = 'badge bg-warning';
        addProfilerConsoleMessage('Profile analysis stopped by user', 'warning');
    })
    .catch(error => {
        addProfilerConsoleMessage(`Error stopping profile analysis: ${error.message}`, 'error');
    });
}

// Load profile data
function loadProfileData(profileId) {
    fetch(`/api/profile-data/${profileId}`)
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Profile data received:', data); // Debug log of received data
        
        // Check if data structure is valid
        if (!data) {
            addProfilerConsoleMessage('Empty profile data received', 'error');
            return;
        }
        
        // Store profile data globally
        currentProfileData = data;
        
        // Update the profile summary tab
        updateProfileSummary(data);
        
        // Update word analysis tab
        updateWordAnalysisView();
        
        // Update tweet samples tab
        updateTweetSamplesView();
        
        // Switch to profile summary tab
        const summaryTab = document.querySelector('#profileSummary-tab');
        bootstrap.Tab.getOrCreateInstance(summaryTab).show();
        
        addProfilerConsoleMessage('Profile data loaded successfully', 'success');
    })
    .catch(error => {
        console.error('Error loading profile data:', error); // Debug error log
        addProfilerConsoleMessage(`Error loading profile data: ${error.message}`, 'error');
    });
}

// Update profile summary view
function updateProfileSummary(data) {
    console.log('Updating profile summary with data:', data); // Debug log
    
    // Hide placeholder and show container
    document.getElementById('profileInfoPlaceholder').style.display = 'none';
    document.getElementById('profileInfoContainer').style.display = 'block';
    
    try {
        // Update profile data
        document.getElementById('profileName').textContent = data.profile?.name || data.username || 'Unknown Name';
        document.getElementById('profileDisplayUsername').textContent = '@' + (data.username || 'unknown');
        
        // Profile image
        const profileImage = document.getElementById('profileImage');
        if (data.profile?.images?.profile_image) {
            profileImage.src = data.profile.images.profile_image;
        } else {
            profileImage.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
        }
        
        // Header image
        const headerImage = document.getElementById('profileHeaderImage');
        if (data.profile?.images?.header_image) {
            headerImage.src = data.profile.images.header_image;
            headerImage.classList.remove('default-header');
        } else {
            headerImage.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_1500x500.png';
            headerImage.classList.add('default-header');
        }
        
        // Bio
        const bioElement = document.getElementById('profileBio');
        if (data.profile?.bio) {
            bioElement.textContent = data.profile.bio;
        } else {
            bioElement.innerHTML = '<em class="text-muted">No bio provided</em>';
        }
        
        // Other profile data
        const locationElement = document.getElementById('profileLocation');
        if (data.profile?.location) {
            locationElement.style.display = 'inline-block';
            locationElement.querySelector('span').textContent = data.profile.location;
        } else {
            locationElement.style.display = 'none';
        }
        
        const websiteElement = document.getElementById('profileWebsite');
        if (data.profile?.website) {
            websiteElement.style.display = 'inline-block';
            websiteElement.querySelector('span').textContent = data.profile.website;
        } else {
            websiteElement.style.display = 'none';
        }
        
        const joinedElement = document.getElementById('profileJoined');
        if (data.profile?.joinDate) {
            joinedElement.style.display = 'inline-block';
            joinedElement.querySelector('span').textContent = `Joined ${data.profile.joinDate}`;
        } else {
            joinedElement.style.display = 'none';
        }
        
        // Followers/Following counts
        document.getElementById('profileFollowers').textContent = formatCount(data.stats?.followers || 0);
        document.getElementById('profileFollowing').textContent = formatCount(data.stats?.following || 0);
    } catch (error) {
        console.error('Error updating profile summary:', error);
        addProfilerConsoleMessage(`Error updating profile summary: ${error.message}`, 'error');
    }
}

// Helper function to format follower/following counts (e.g., 1.2K, 3.5M)
function formatCount(count) {
    if (!count && count !== 0) return '0';
    
    count = parseInt(count.toString().replace(/,/g, ''));
    
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    } else {
        return count.toString();
    }
}

// Update word analysis view based on selected tab
function updateWordAnalysisView() {
    if (!currentProfileData || !currentProfileData.wordAnalysis) {
        return;
    }
    
    // Get selected tab
    const selectedTab = document.getElementById('wordAnalysisTabSelector').value;
    const analysis = currentProfileData.wordAnalysis[selectedTab];
    
    // If the selected tab doesn't exist in the data, try to fall back to 'posts'
    if (!analysis) {
        if (currentProfileData.wordAnalysis.posts) {
            document.getElementById('wordAnalysisTabSelector').value = 'posts';
            updateWordAnalysisView();
        } else {
            // No valid data for any tab
            document.getElementById('wordAnalysisPlaceholder').style.display = 'block';
            document.getElementById('wordAnalysisContainer').style.display = 'none';
            addProfilerConsoleMessage(`No word analysis data for ${selectedTab} tab`, 'warning');
        }
        return;
    }
    
    // Hide placeholder and show container
    document.getElementById('wordAnalysisPlaceholder').style.display = 'none';
    document.getElementById('wordAnalysisContainer').style.display = 'block';
    
    // Update statistics
    document.getElementById('analyzedTweetsCount').textContent = analysis.analyzedTweets.toLocaleString();
    document.getElementById('totalWordsCount').textContent = analysis.totalWords.toLocaleString();
    document.getElementById('uniqueWordsCount').textContent = analysis.uniqueWords.toLocaleString();
    
    // Update word frequency table
    updateWordFrequencyTable(analysis.wordFrequency);
    
    // Create word cloud chart if Chart.js is available
    if (typeof Chart !== 'undefined') {
        createWordFrequencyChart(analysis.wordFrequency);
    }
}

// Update word frequency table
function updateWordFrequencyTable(wordFrequency) {
    const tableBody = document.querySelector('#wordFrequencyTable tbody');
    tableBody.innerHTML = '';
    
    // Convert to array and take top 100
    const wordEntries = Object.entries(wordFrequency)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 100);
    
    wordEntries.forEach((entry, index) => {
        const word = entry[0];
        const data = entry[1];
        
        const row = document.createElement('tr');
        row.className = 'word-frequency-row';
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${word}</td>
            <td>${data.count.toLocaleString()}</td>
            <td>${data.percentage}</td>
        `;
        
        tableBody.appendChild(row);
    });
}

// Create word frequency chart
function createWordFrequencyChart(wordFrequency) {
    const chartCanvas = document.getElementById('wordFrequencyChart');
    
    // Destroy existing chart if it exists
    if (chartCanvas._chart) {
        chartCanvas._chart.destroy();
    }
    
    // Take top 20 words
    const words = Object.entries(wordFrequency)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20);
    
    const labels = words.map(w => w[0]);
    const counts = words.map(w => w[1].count);
    
    // Generate colors based on count (gradient from light to dark purple)
    const colors = words.map((_, i) => {
        const opacity = 1 - (i / words.length) * 0.6;
        return `rgba(111, 66, 193, ${opacity})`;
    });
    
    const chart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Word Count',
                data: counts,
                backgroundColor: colors,
                borderColor: colors.map(color => color.replace('0.', '1.')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Frequency'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Words'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Most Frequently Used Words'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const word = context.label;
                            const count = context.raw;
                            const percentage = wordFrequency[word].percentage;
                            return `Count: ${count} (${percentage})`;
                        }
                    }
                }
            }
        }
    });
    
    // Save chart instance for later reference
    chartCanvas._chart = chart;
}

// Update tweet samples view
function updateTweetSamplesView() {
    if (!currentProfileData || !currentProfileData.tweets) {
        return;
    }
    
    // Get selected tab
    const selectedTab = document.getElementById('tweetSampleTabSelector').value;
    const tweets = currentProfileData.tweets[selectedTab];
    
    // If the selected tab doesn't have tweets, try to fall back to another tab
    if (!tweets || tweets.length === 0) {
        const availableTabs = Object.keys(currentProfileData.tweets).filter(tab => 
            currentProfileData.tweets[tab] && currentProfileData.tweets[tab].length > 0
        );
        
        if (availableTabs.length > 0) {
            document.getElementById('tweetSampleTabSelector').value = availableTabs[0];
            updateTweetSamplesView();
        } else {
            // No tweets in any tab
            document.getElementById('tweetSamplesPlaceholder').style.display = 'block';
            document.getElementById('tweetSamplesContainer').innerHTML = '';
            addProfilerConsoleMessage('No tweet samples available', 'warning');
        }
        return;
    }
    
    // Hide placeholder
    document.getElementById('tweetSamplesPlaceholder').style.display = 'none';
    
    // Update tweet sample container
    const container = document.getElementById('tweetSamplesContainer');
    container.innerHTML = '';
    
    // Display up to 20 tweets
    const tweetLimit = Math.min(tweets.length, 20);
    for (let i = 0; i < tweetLimit; i++) {
        const tweet = tweets[i];
        
        // Format date
        let formattedDate = 'Unknown date';
        if (tweet.timestamp) {
            const date = new Date(tweet.timestamp);
            formattedDate = date.toLocaleString();
        }
        
        // Create tweet sample element
        const tweetElement = document.createElement('div');
        tweetElement.className = 'tweet-sample';
        
        // Create tweet header
        const tweetHeader = document.createElement('div');
        tweetHeader.className = 'tweet-sample-header';
        tweetHeader.innerHTML = `
            <span>${formattedDate}</span>
            <span>ID: ${tweet.tweetId || 'Unknown'}</span>
        `;
        
        // Create tweet content
        const tweetContent = document.createElement('div');
        tweetContent.className = 'tweet-sample-content';
        tweetContent.textContent = tweet.content || '[No content]';
        
        // Add media indicators if available
        if (tweet.media && tweet.media.length > 0) {
            const mediaInfo = document.createElement('div');
            mediaInfo.className = 'mt-2 mb-2';
            mediaInfo.innerHTML = `<span class="badge bg-secondary">${tweet.media.length} media items</span>`;
            tweetContent.appendChild(mediaInfo);
        }
        
        // Create tweet footer with engagement data
        const tweetFooter = document.createElement('div');
        tweetFooter.className = 'tweet-sample-footer';
        
        // URL link to tweet
        const tweetLink = document.createElement('a');
        tweetLink.href = tweet.tweetUrl || '#';
        tweetLink.target = '_blank';
        tweetLink.textContent = 'View on X';
        
        // Engagement metrics
        const engagement = document.createElement('div');
        engagement.className = 'tweet-sample-engagement';
        
        if (tweet.engagement) {
            const eng = tweet.engagement;
            engagement.innerHTML = `
                <div class="engagement-item">
                    <i class="far fa-comment"></i> ${eng.replies || '0'}
                </div>
                <div class="engagement-item">
                    <i class="fas fa-retweet"></i> ${eng.retweets || '0'}
                </div>
                <div class="engagement-item">
                    <i class="far fa-heart"></i> ${eng.likes || '0'}
                </div>
            `;
        }
        
        tweetFooter.appendChild(tweetLink);
        tweetFooter.appendChild(engagement);
        
        // Assemble tweet
        tweetElement.appendChild(tweetHeader);
        tweetElement.appendChild(tweetContent);
        tweetElement.appendChild(tweetFooter);
        
        // Add to container
        container.appendChild(tweetElement);
    }
    
    // Show total count if there are more tweets
    if (tweets.length > tweetLimit) {
        const moreInfo = document.createElement('div');
        moreInfo.className = 'text-center text-muted mt-3';
        moreInfo.textContent = `Showing ${tweetLimit} of ${tweets.length} tweets`;
        container.appendChild(moreInfo);
    }
}

// Load previous profiles
function loadPreviousProfiles() {
    fetch('/api/previous-profiles')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (!data || !data.profiles || data.profiles.length === 0) {
            // No profiles found
            const tbody = document.querySelector('#previousProfilesTable tbody');
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No previous profiles found</td></tr>';
            return;
        }
        
        // Update profiles table
        updatePreviousProfilesTable(data.profiles);
    })
    .catch(error => {
        addProfilerConsoleMessage(`Error loading previous profiles: ${error.message}`, 'error');
    });
}

// Update previous profiles table
function updatePreviousProfilesTable(profiles) {
    const tbody = document.querySelector('#previousProfilesTable tbody');
    tbody.innerHTML = '';
    
    profiles.forEach(profile => {
        const row = document.createElement('tr');
        
        // Format date
        let formattedDate = 'Unknown';
        if (profile.date) {
            const date = new Date(profile.date);
            formattedDate = date.toLocaleString();
        }
        
        row.innerHTML = `
            <td>@${profile.username}</td>
            <td>${profile.analyzedTabs.join(', ')}</td>
            <td>${formattedDate}</td>
            <td>
                <button class="btn btn-sm btn-primary view-profile-btn" data-profile-id="${profile.id}">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-success download-profile-btn" data-profile-id="${profile.id}">
                    <i class="fas fa-download"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    // Add event listeners to buttons
    document.querySelectorAll('.view-profile-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const profileId = this.getAttribute('data-profile-id');
            loadProfileData(profileId);
        });
    });
    
    document.querySelectorAll('.download-profile-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const profileId = this.getAttribute('data-profile-id');
            downloadProfileData(profileId);
        });
    });
}

// Download word analysis
function downloadWordAnalysis() {
    if (!currentProfileData || !currentProfileData.wordAnalysis) {
        addProfilerConsoleMessage('No word analysis data available to download', 'error');
        return;
    }
    
    const selectedTab = document.getElementById('wordAnalysisTabSelector').value;
    const analysis = currentProfileData.wordAnalysis[selectedTab];
    
    if (!analysis) {
        addProfilerConsoleMessage(`No word analysis data for ${selectedTab} tab`, 'error');
        return;
    }
    
    // Create downloadable content
    const content = {
        username: currentProfileData.username,
        tab: selectedTab,
        analyzedTweets: analysis.analyzedTweets,
        totalWords: analysis.totalWords,
        uniqueWords: analysis.uniqueWords,
        wordFrequency: analysis.wordFrequency,
        exportDate: new Date().toISOString()
    };
    
    // Convert to JSON string
    const jsonString = JSON.stringify(content, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `word_analysis_${currentProfileData.username}_${selectedTab}.json`;
    
    // Download the file
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Download profile data
function downloadProfileData(profileId) {
    window.location.href = `/api/download-profile/${profileId}`;
}

// Utility function to add a message to the profiler console output
function addProfilerConsoleMessage(message, type = '') {
    const consoleOutput = document.getElementById('profilerConsoleOutput');
    if (!consoleOutput) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${type ? 'console-' + type : ''}`;
    line.textContent = message;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}