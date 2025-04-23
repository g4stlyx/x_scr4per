const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs');

// Try different ports if default is in use
const port = process.env.PORT || 3000;
const maxPortAttempts = 10;  // Try up to 10 ports

// Create the output directory immediately to ensure it exists
const outputDir = path.join(__dirname, 'out');
if (!fs.existsSync(outputDir)) {
  console.log('Creating output directory:', outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store active scraper processes
const activeScrapers = {};

// Endpoint to start a scraping process
app.post('/api/scrape', (req, res) => {
  const params = req.body;
  const jobId = Date.now().toString();
  
  // Build args array from parameters
  const args = ['x_scr4per.js'];
  
  if (params.user) args.push(`--user=${params.user}`);
  if (params.query) args.push(`--query=${params.query}`);
  if (params.since) args.push(`--since=${params.since}`);
  if (params.until) args.push(`--until=${params.until}`);
  if (params.tab) args.push(`--tab=${params.tab}`);
  if (params.limit) args.push(`--limit=${params.limit}`);
  if (params.lang) args.push(`--lang=${params.lang}`);
  
  // Use a unique file name for each job based on the job ID
  const outfile = `out/${jobId}_tweets.json`;
  args.push(`--outfile=${outfile}`);
  
  if (params.maxNoNew) args.push(`--maxNoNew=${params.maxNoNew}`);
  if (params.scrollDelay) args.push(`--scrollDelay=${params.scrollDelay}`);
  
  // By default, run in headless mode (no visible browser)
  // Only show browser if specifically requested
  const runHeadless = params.headless !== false;
  args.push(`--headless=${runHeadless}`);

  console.log('Starting scraper with args:', args);

  try {
    // Spawn the scraper as a child process
    const scraper = spawn('node', args);
    activeScrapers[jobId] = { 
      process: scraper, 
      output: [],
      params: params,
      outfile: outfile,
      startTime: new Date().toISOString(),
      status: 'running'
    };

    // Collect output from the scraper
    scraper.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Scraper ${jobId} output:`, output);
      activeScrapers[jobId].output.push({
        time: new Date().toISOString(),
        text: output
      });
    });

    scraper.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(`Scraper ${jobId} error:`, error);
      activeScrapers[jobId].output.push({
        time: new Date().toISOString(),
        text: `ERROR: ${error}`,
        isError: true
      });
    });

    scraper.on('close', (code) => {
      console.log(`Scraper ${jobId} exited with code ${code}`);
      activeScrapers[jobId].status = code === 0 ? 'completed' : 'failed';
      activeScrapers[jobId].endTime = new Date().toISOString();
    });

    // Respond with the job ID
    res.json({ jobId });
  } catch (error) {
    console.error('Failed to start scraper process:', error);
    res.status(500).json({ error: 'Failed to start scraper process' });
  }
});

// Endpoint to get status of a specific job
app.get('/api/status/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (activeScrapers[jobId]) {
    res.json({
      jobId,
      status: activeScrapers[jobId].status,
      params: activeScrapers[jobId].params,
      startTime: activeScrapers[jobId].startTime,
      endTime: activeScrapers[jobId].endTime || null,
      output: activeScrapers[jobId].output,
    });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Endpoint to stop a scraper job
app.post('/api/stop/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (activeScrapers[jobId] && activeScrapers[jobId].process) {
    activeScrapers[jobId].process.kill();
    activeScrapers[jobId].status = 'stopped';
    activeScrapers[jobId].endTime = new Date().toISOString();
    res.json({ status: 'stopped' });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Endpoint to get a list of all jobs
app.get('/api/jobs', (req, res) => {
  const jobs = Object.keys(activeScrapers).map(jobId => ({
    jobId,
    status: activeScrapers[jobId].status,
    startTime: activeScrapers[jobId].startTime,
    endTime: activeScrapers[jobId].endTime || null,
    params: activeScrapers[jobId].params
  }));
  res.json(jobs);
});

// Endpoint to get the tweets collected by a job
app.get('/api/tweets/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (!activeScrapers[jobId]) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const filePath = path.join(__dirname, activeScrapers[jobId].outfile);
  if (fs.existsSync(filePath)) {
    try {
      console.log(`Reading tweets from file: ${filePath}`);
      const data = fs.readFileSync(filePath, 'utf8');
      
      try {
        const tweets = JSON.parse(data);
        console.log(`Successfully parsed ${tweets.length} tweets from ${filePath}`);
        
        // Validate tweet data structure
        if (!Array.isArray(tweets)) {
          console.error('Tweet data is not an array:', typeof tweets);
          return res.status(500).json({ 
            error: 'Tweet data format error', 
            details: 'Expected an array but received ' + typeof tweets 
          });
        }
        
        res.json({ tweets });
      } catch (parseError) {
        console.error(`Failed to parse JSON from tweets file: ${parseError.message}`);
        return res.status(500).json({ 
          error: 'Failed to parse tweets file', 
          details: parseError.message 
        });
      }
    } catch (error) {
      console.error(`Failed to read tweets file: ${error.message}`);
      res.status(500).json({ error: 'Failed to read tweets file', details: error.message });
    }
  } else {
    console.error(`Tweets file not found: ${filePath}`);
    res.status(404).json({ error: 'Tweets file not found' });
  }
});

// Endpoint to download the tweets JSON file
app.get('/api/download/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (!activeScrapers[jobId]) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const filePath = path.join(__dirname, activeScrapers[jobId].outfile);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Tweets file not found' });
  }
});

// Function to try starting the server on different ports
function startServer(portToTry, attempt = 1) {
  const server = app.listen(portToTry, () => {
    console.log(`X Scraper UI server running at http://localhost:${portToTry}`);
    
    // Create the output directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'out'))) {
      fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    }
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (attempt < maxPortAttempts) {
        console.log(`Port ${portToTry} is in use, trying port ${portToTry + 1}...`);
        startServer(portToTry + 1, attempt + 1);
      } else {
        console.error(`Failed to find an available port after ${maxPortAttempts} attempts.`);
        process.exit(1);
      }
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
  
  return server;
}

// Start the server with automatic port finding
startServer(port);