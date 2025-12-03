import express from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationEvent } from '../instrumentation/types.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static assets
app.use(express.static('public'));

// API: Get list of available NDJSON files
app.get('/api/files', (req, res) => {
  try {
    const files = readdirSync('.')
      .filter(f => f.endsWith('.ndjson'))
      .map(f => ({
        name: f,
        size: statSync(f).size,
        modified: statSync(f).mtime,
      }));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// API: Get events from a specific file
app.get('/api/events/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename.endsWith('.ndjson')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const content = readFileSync(filename, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const events = lines.map(line => JSON.parse(line) as NotificationEvent);

    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// API: Get statistics for a file
app.get('/api/stats/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename.endsWith('.ndjson')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const content = readFileSync(filename, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const events = lines.map(line => JSON.parse(line) as NotificationEvent);

    const stats = {
      totalEvents: events.length,
      observables: new Set(events.map(e => e.observableId)).size,
      subscriptions: new Set(
        events.filter(e => 'subscriptionId' in e).map(e => ('subscriptionId' in e ? e.subscriptionId : 0))
      ).size,
      eventTypes: events.reduce((acc, evt) => {
        acc[evt.type] = (acc[evt.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      timeRange: {
        start: events[0]?.timestamp || 0,
        end: events[events.length - 1]?.timestamp || 0,
        duration: (events[events.length - 1]?.timestamp || 0) - (events[0]?.timestamp || 0),
      },
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate stats' });
  }
});

// Serve the dashboard HTML
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RxJS Inspector Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
    }

    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }

    h1 {
      font-size: 2.5em;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
    }

    .subtitle {
      color: #666;
      font-size: 1.1em;
    }

    .controls {
      background: white;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }

    select, button {
      padding: 12px 20px;
      font-size: 1em;
      border: 2px solid #667eea;
      border-radius: 8px;
      margin-right: 10px;
      cursor: pointer;
    }

    select {
      background: white;
      min-width: 250px;
    }

    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      font-weight: bold;
      transition: transform 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }

    .card h2 {
      color: #333;
      margin-bottom: 15px;
      font-size: 1.3em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .stat-value {
      font-size: 3em;
      font-weight: bold;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .stat-label {
      color: #666;
      text-transform: uppercase;
      font-size: 0.9em;
      letter-spacing: 1px;
      margin-top: 5px;
    }

    .timeline {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }

    .timeline-events {
      max-height: 600px;
      overflow-y: auto;
      margin-top: 15px;
    }

    .event {
      display: flex;
      gap: 15px;
      padding: 12px;
      border-left: 4px solid #667eea;
      background: #f8f9fa;
      margin-bottom: 10px;
      border-radius: 6px;
      align-items: center;
      transition: transform 0.2s;
    }

    .event:hover {
      transform: translateX(5px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .event-time {
      font-family: 'Courier New', monospace;
      color: #667eea;
      font-weight: bold;
      min-width: 80px;
    }

    .event-icon {
      font-size: 1.5em;
      min-width: 30px;
      text-align: center;
    }

    .event-details {
      flex: 1;
    }

    .event-type {
      font-weight: bold;
      color: #333;
    }

    .event-value {
      background: #e3f2fd;
      padding: 4px 10px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      color: #1976d2;
      margin-left: 10px;
    }

    .observables-grid {
      display: grid;
      gap: 15px;
      margin-top: 15px;
    }

    .observable-card {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      border-radius: 8px;
      transition: transform 0.2s;
    }

    .observable-card:hover {
      transform: translateX(5px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .observable-title {
      color: #667eea;
      font-weight: bold;
      font-size: 1.2em;
      margin-bottom: 10px;
    }

    .observable-meta {
      display: flex;
      gap: 20px;
      color: #666;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .values {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .value-badge {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 500;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 1.2em;
    }

    .error {
      background: #ffebee;
      color: #c62828;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #c62828;
    }

    .chart-container {
      margin-top: 20px;
      height: 300px;
    }

    .event-type-chart {
      display: grid;
      gap: 10px;
    }

    .event-type-bar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .event-type-label {
      min-width: 150px;
      font-weight: 500;
    }

    .bar-container {
      flex: 1;
      background: #f0f0f0;
      border-radius: 4px;
      overflow: hidden;
      height: 30px;
      position: relative;
    }

    .bar-fill {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100%;
      transition: width 0.5s ease;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 10px;
      color: white;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔭 RxJS Inspector Dashboard</h1>
      <p class="subtitle">Real-time Observable Chain Visualization</p>
    </div>

    <div class="controls">
      <select id="fileSelect">
        <option value="">Select a log file...</option>
      </select>
      <button onclick="loadFile()">Load</button>
      <button onclick="refreshFiles()">Refresh Files</button>
    </div>

    <div id="content"></div>
  </div>

  <script>
    let currentEvents = [];

    // Load file list on page load
    refreshFiles();

    async function refreshFiles() {
      try {
        const res = await fetch('/api/files');
        const files = await res.json();

        const select = document.getElementById('fileSelect');
        select.innerHTML = '<option value="">Select a log file...</option>';

        files.forEach(file => {
          const option = document.createElement('option');
          option.value = file.name;
          option.textContent = \`\${file.name} (\${formatBytes(file.size)})\`;
          select.appendChild(option);
        });
      } catch (err) {
        showError('Failed to load file list');
      }
    }

    async function loadFile() {
      const filename = document.getElementById('fileSelect').value;
      if (!filename) return;

      showLoading();

      try {
        const [eventsRes, statsRes] = await Promise.all([
          fetch(\`/api/events/\${filename}\`),
          fetch(\`/api/stats/\${filename}\`)
        ]);

        currentEvents = await eventsRes.json();
        const stats = await statsRes.json();

        renderDashboard(stats);
      } catch (err) {
        showError('Failed to load file data');
      }
    }

    function renderDashboard(stats) {
      const content = document.getElementById('content');

      content.innerHTML = \`
        <div class="grid">
          <div class="card">
            <h2>📊 Total Events</h2>
            <div class="stat-value">\${stats.totalEvents}</div>
            <div class="stat-label">Events Captured</div>
          </div>
          <div class="card">
            <h2>🔭 Observables</h2>
            <div class="stat-value">\${stats.observables}</div>
            <div class="stat-label">Operator Chains</div>
          </div>
          <div class="card">
            <h2>🔗 Subscriptions</h2>
            <div class="stat-value">\${stats.subscriptions}</div>
            <div class="stat-label">Active Subscriptions</div>
          </div>
          <div class="card">
            <h2>⏱️ Duration</h2>
            <div class="stat-value">\${stats.timeRange.duration}ms</div>
            <div class="stat-label">Total Runtime</div>
          </div>
        </div>

        <div class="card">
          <h2>📈 Event Type Distribution</h2>
          <div class="event-type-chart">
            \${renderEventTypeChart(stats.eventTypes, stats.totalEvents)}
          </div>
        </div>

        <div class="card">
          <h2>🎯 Operator Chains</h2>
          <div class="observables-grid">
            \${renderObservables()}
          </div>
        </div>

        <div class="timeline">
          <h2>📅 Event Timeline</h2>
          <div class="timeline-events">
            \${renderTimeline()}
          </div>
        </div>
      \`;
    }

    function renderEventTypeChart(eventTypes, total) {
      return Object.entries(eventTypes)
        .map(([type, count]) => {
          const percentage = (count / total * 100).toFixed(1);
          const icon = getEventIcon(type);
          return \`
            <div class="event-type-bar">
              <span class="event-type-label">\${icon} \${type}</span>
              <div class="bar-container">
                <div class="bar-fill" style="width: \${percentage}%">
                  \${count}
                </div>
              </div>
            </div>
          \`;
        })
        .join('');
    }

    function extractOperatorName(operatorInfo) {
      if (!operatorInfo) return 'Unknown';

      let name = operatorInfo.name || 'Unknown';

      // If it's a generic name, try to extract from stack trace
      if ((name === 'Observable' || name === 'Function') && operatorInfo.stackTrace) {
        const stack = operatorInfo.stackTrace;

        // Look for RxJS operators (handles both src/internal/operators and dist/operators paths)
        const rxjsMatch = stack.match(/rxjs[\\\\/](?:src[\\\\/]internal[\\\\/])?operators[\\\\/](\\w+)\\.(?:ts|js)/);
        if (rxjsMatch) {
          return rxjsMatch[1];
        }

        // Look for creation operators (of, from, interval, etc.)
        const creationMatch = stack.match(/from ['"]rxjs['"].*?\\n.*?at (\\w+)/);
        if (creationMatch) {
          return creationMatch[1];
        }

        // Look for custom operators or source observables
        const lines = stack.split('\\n');
        for (const line of lines) {
          // Check for RxJS source observables (of, from, interval, etc.) in rxjs/src/internal/observable/
          const sourceMatch = line.match(/rxjs[\\\\/]src[\\\\/]internal[\\\\/]observable[\\\\/](\\w+)\\.ts/);
          if (sourceMatch) {
            return sourceMatch[1];
          }

          // Check for custom operators
          if (line.includes('custom-operators.ts')) {
            const customMatch = line.match(/at (\\w+)/);
            if (customMatch && !['Object', 'Module', 'exports'].includes(customMatch[1])) {
              return customMatch[1];
            }
          }

          // Check for map, filter, tap, etc.
          const opMatch = line.match(/[\\\\/](map|filter|tap|scan|mergeMap|switchMap|debounce|take|skip)\\.ts/);
          if (opMatch) {
            return opMatch[1];
          }
        }

        // Check if it's from 'of', 'from', 'interval', etc.
        const fromMatch = stack.match(/\\bat (of|from|interval|timer|range)\\b/i);
        if (fromMatch) {
          return fromMatch[1];
        }
      }

      return name;
    }

    function renderObservables() {
      const observables = new Map();

      currentEvents.forEach(evt => {
        if (!observables.has(evt.observableId)) {
          const operatorName = extractOperatorName(evt.operatorInfo);
          const parent = evt.operatorInfo?.parent;

          observables.set(evt.observableId, {
            id: evt.observableId,
            name: operatorName,
            parent: parent,
            events: [],
            values: []
          });
        }

        const obs = observables.get(evt.observableId);
        obs.events.push(evt);

        if (evt.type === 'next' && 'value' in evt) {
          obs.values.push(evt.value);
        }
      });

      // Build chain visualization: find root and build chain
      function buildChain(obsId) {
        const chain = [];
        let current = observables.get(obsId);
        const visited = new Set();

        // Walk up to find the root
        while (current && !visited.has(current.id)) {
          visited.add(current.id);
          chain.unshift(current);
          current = current.parent ? observables.get(current.parent) : null;
        }

        return chain;
      }

      return Array.from(observables.values())
        .map(obs => {
          const chain = buildChain(obs.id);
          let chainDisplay;

          if (chain.length > 1) {
            // Show full chain with source highlighted
            chainDisplay = chain.map((op, idx) => {
              const isCurrent = op.id === obs.id;
              const style = isCurrent ? 'font-weight: bold; color: #7c3aed;' : 'color: #666;';
              return \`<span style="\${style}">\${op.name}</span>\`;
            }).join(' → ');
          } else {
            // No parent chain, just show operator name
            chainDisplay = \`<span style="font-weight: bold; color: #7c3aed;">\${obs.name}</span>\`;
          }

          return \`
          <div class="observable-card">
            <div class="observable-title">\${chainDisplay} #\${obs.id}</div>
            <div class="observable-meta">
              <span>📊 \${obs.events.length} events</span>
              <span>📤 \${obs.values.length} values</span>
            </div>
            <div class="values">
              \${obs.values.slice(0, 15).map(v =>
                \`<span class="value-badge">\${JSON.stringify(v)}</span>\`
              ).join('')}
              \${obs.values.length > 15 ? \`<span class="value-badge">+\${obs.values.length - 15} more</span>\` : ''}
            </div>
          </div>
        \`;
        })
        .join('');
    }

    function renderTimeline() {
      const startTime = currentEvents[0]?.timestamp || 0;

      return currentEvents.slice(0, 100)
        .map(evt => {
          const relTime = evt.timestamp - startTime;
          const icon = getEventIcon(evt.type);
          const value = 'value' in evt ?
            \`<span class="event-value">\${JSON.stringify(evt.value)}</span>\` : '';

          return \`
            <div class="event">
              <div class="event-time">\${relTime}ms</div>
              <div class="event-icon">\${icon}</div>
              <div class="event-details">
                <span class="event-type">\${evt.type}</span>
                <span style="color: #666;">Observable #\${evt.observableId}</span>
                \${'subscriptionId' in evt ? \`<span style="color: #666;">Sub #\${evt.subscriptionId}</span>\` : ''}
                \${value}
              </div>
            </div>
          \`;
        })
        .join('');
    }

    function getEventIcon(type) {
      const icons = {
        'observable-create': '🔨',
        'subscribe': '🔗',
        'next': '📤',
        'complete': '✅',
        'error': '❌',
        'unsubscribe': '🔌'
      };
      return icons[type] || '📋';
    }

    function showLoading() {
      document.getElementById('content').innerHTML =
        '<div class="loading">Loading...</div>';
    }

    function showError(message) {
      document.getElementById('content').innerHTML =
        \`<div class="error">❌ \${message}</div>\`;
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       🔭 RxJS Inspector Dashboard Server                  ║
╚════════════════════════════════════════════════════════════╝

🚀 Server running at: http://localhost:${PORT}

📂 Watching for .ndjson files in current directory
🌐 Open your browser to view the dashboard

Press Ctrl+C to stop the server
  `);
});
