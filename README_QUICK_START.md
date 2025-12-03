# RxJS Inspector - Quick Start

## Overview

**RxJS Inspector** is a comprehensive debugging and visualization tool for RxJS v7+ applications. It provides:

- 🔍 **Observable instrumentation** - Automatically tracks all observable subscriptions, emissions, and completions
- 📊 **Web dashboard** - Interactive visualization of operator chains and data flow
- 📝 **NDJSON logging** - Structured event logging for analysis
- 🏷️ **Observable tagging** - Name your observables for easier debugging
- 🔗 **Operator chain visualization** - See the complete data flow from source to subscriber

## Quick Start

### 1. Run a Demo

```bash
# Install dependencies
npm install

# Run a simple demo
npm run demo:simple

# Start the web dashboard
npm run dashboard

# Open http://localhost:3000 in your browser
# Load the rxjs-inspector.ndjson file
```

### 2. Use in Your Code

```typescript
import { from, map, filter } from 'rxjs';
import { createWriteStream } from 'node:fs';
import { installRxjsInstrumentation, notifications$ } from './instrumentation/core';
import { tag } from './operators/tag';

// Install the instrumentation
installRxjsInstrumentation();

// Log events to NDJSON file
const logFile = createWriteStream('my-app.ndjson');
notifications$.subscribe(evt => {
  logFile.write(JSON.stringify(evt) + '\n');
});

// Tag your observables for better debugging
const users$ = from(fetchUsers()).pipe(
  tag('users-api'),
  map(user => user.name),
  filter(name => name.length > 0)
);

users$.subscribe(console.log);
```

### 3. View in Dashboard

The dashboard displays:

- **Operator Chains** - Full chain from source → operators with parent tracking
- **Timeline** - When events occurred
- **Event Statistics** - Counts of subscriptions, values, completions, errors
- **Value Flow** - Actual values emitted by each observable

Example chain display:
```
users-api → map → filter #3
```

## Key Features

### Observable Tagging (Essential for RxJS v7+)

In RxJS v7+, all operators are anonymous functions, making automatic name detection impossible. **You must tag your observables** to see meaningful names:

```typescript
import { tag } from './operators/tag';

const data$ = http.get('/api/data').pipe(
  tag('api-data'),
  map(transform)
);
```

**See [TAGGING_GUIDE.md](./TAGGING_GUIDE.md) for best practices.**

### Operator Chain Visualization

The dashboard shows the complete operator chain with parent relationships:

```typescript
const source$ = from([1, 2, 3]).pipe(tag('numbers'));
const mapped$ = source$.pipe(map(x => x * 2));
const filtered$ = mapped$.pipe(filter(x => x > 2));
```

Dashboard display:
- `numbers #1` (source)
- `numbers → pipe #2` (map operator)
- `numbers → pipe → pipe #3` (filter operator)

### NDJSON Event Logging

All RxJS events are logged in NDJSON format:

```json
{"type":"observable-create","timestamp":1234567890,"observableId":1,"operatorInfo":{"name":"numbers"}}
{"type":"subscribe","timestamp":1234567891,"observableId":1,"subscriptionId":1}
{"type":"next","timestamp":1234567892,"observableId":1,"subscriptionId":1,"value":1}
{"type":"complete","timestamp":1234567893,"observableId":1,"subscriptionId":1}
```

## Available Scripts

```bash
# Demos
npm run demo:simple      # Basic map/filter example
npm run demo:advanced    # Complex operator chains
npm run demo:custom      # Custom operators
npm run demo:tagged      # Tagged observables

# Dashboard & Visualization
npm run dashboard        # Web dashboard on port 3000
npm run viz             # Terminal-based visualizer
npm run viz:html        # Generate standalone HTML report

# Development
npm run build           # Build the project
npm run test            # Run tests
```

## Documentation

- **[TAGGING_GUIDE.md](./TAGGING_GUIDE.md)** - How to tag observables and why it's essential
- **[OPERATOR_NAMES.md](./OPERATOR_NAMES.md)** - Technical details on operator name extraction
- **[README_TOOLS.md](./README_TOOLS.md)** - Visualization tools documentation

## Architecture

```
src/
├── instrumentation/
│   └── core.ts              # Observable.subscribe monkey-patching
├── operators/
│   └── tag.ts               # Observable tagging operator
├── web/
│   └── dashboard.ts         # Interactive web dashboard
├── tools/
│   ├── ndjson-visualizer.ts # Terminal visualization
│   └── ndjson-to-html.ts    # HTML report generator
└── example/
    ├── simple.ts            # Basic demo
    ├── tagged-demo.ts       # Tagged observables demo
    ├── advanced-demo.ts     # Complex chains
    └── custom-operators.ts  # Custom operator demo
```

## How It Works

1. **Instrumentation** - Monkey-patches `Observable.prototype.subscribe` to intercept all subscriptions
2. **Event Emission** - Emits structured events for every subscribe/next/error/complete/unsubscribe
3. **Parent Tracking** - Recursively assigns IDs to parent observables to build operator chains
4. **Tagging** - Stores custom names on observables via the `tag()` operator
5. **Visualization** - Web dashboard reads NDJSON files and builds interactive visualizations

## Comparison with rxjs-spy

Inspired by [rxjs-spy](https://github.com/cartant/rxjs-spy), but designed for modern RxJS:

| Feature | rxjs-spy | rxjs-inspector |
|---------|----------|----------------|
| RxJS version | v5/v6 | v7+ |
| Operator detection | Automatic | Manual tagging required |
| Dashboard | CLI | Web-based |
| NDJSON logging | No | Yes |
| Parent tracking | Via graph plugin | Built-in |

## Requirements

- Node.js 18+
- RxJS 7.x
- TypeScript 5.x

## License

MIT

## Next Steps

1. ✅ Run the demos: `npm run demo:simple` and `npm run dashboard`
2. ✅ Read [TAGGING_GUIDE.md](./TAGGING_GUIDE.md) to learn about observable tagging
3. ✅ Instrument your own application
4. ✅ View your operator chains in the dashboard

Happy debugging! 🎉
