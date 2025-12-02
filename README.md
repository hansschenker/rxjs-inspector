# RxJS Inspector

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](.)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Instrumentation, logging, and visualization toolkit for RxJS observable chains. Debug reactive programming flows with ease.

## Features

- 🔍 **Operator-Aware Inspection** - Tracks operator chains and parent-child relationships
- 📊 **Multiple Visualization Formats** - Tree, flat, timeline, and marble diagram views
- 🌊 **Real-Time Streaming** - SSE server for live visualization dashboards
- 📝 **NDJSON Logging** - File-based logging for post-mortem analysis
- 📈 **Smart Analytics** - Detects memory leaks, errors, and performance issues
- 🔒 **Recursion Safe** - Internal observables are automatically excluded
- ⚙️ **Configurable** - Sampling rate, value redaction, enable/disable

## Installation

```bash
npm install rxjs-inspector
```

## Quick Start

### 1. Install Instrumentation

```typescript
import { installRxjsInstrumentation, notifications$ } from 'rxjs-inspector';
import { of } from 'rxjs';
import { map, filter } from 'rxjs/operators';

// Install instrumentation (monkey-patches Observable.prototype.subscribe)
installRxjsInstrumentation();

// Subscribe to the event stream
notifications$.subscribe(event => {
  console.log(event);
});

// Now all RxJS observables are instrumented
of(1, 2, 3)
  .pipe(
    map(x => x * 2),
    filter(x => x > 2)
  )
  .subscribe(x => console.log('Result:', x));
```

### 2. Configure Instrumentation (Optional)

```typescript
import { configureInstrumentation } from 'rxjs-inspector';

configureInstrumentation({
  enabled: true,           // Enable/disable instrumentation
  sampleRate: 1,          // 0-1, percentage of next events to capture (1 = 100%)
  excludeValues: false,   // When true, replaces values with '<redacted>'
});
```

### 3. Log to File (Node.js)

```typescript
import { startNdjsonLogger } from 'rxjs-inspector/node';

// Logs all events to rxjs-inspector.ndjson
startNdjsonLogger();
```

## CLI Tools

### Analyze Logs

```bash
# View operator chain tree
npx rxjs-inspector rxjs-inspector.ndjson tree

# Flat chronological view
npx rxjs-inspector rxjs-inspector.ndjson flat

# Timeline with marble diagrams
npx rxjs-inspector rxjs-inspector.ndjson timeline
```

### Get Analytics & Warnings

```bash
npx rxjs-inspector-summarize rxjs-inspector.ndjson
```

Output:
```
=== Run 1 ===
Observable 1:
  subscriptions:    1
  events:           8
  next:             3
  complete:         1
  warnings:
    - ⚠ multiple subscriptions (2) – consider share()/shareReplay()
```

### Real-Time Visualization Server

```bash
# Start SSE server on port 3000
npx rxjs-inspector-server

# Or specify port
PORT=8080 npx rxjs-inspector-server
```

Then connect from your app:
```typescript
// Browser or Node.js
const eventSource = new EventSource('http://localhost:3000/events');
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(event);
};
```

## Event Types

All events have this structure:

```typescript
type NotificationEvent =
  | { type: 'observable-create'; timestamp: number; observableId: number; operatorInfo?: OperatorInfo }
  | { type: 'subscribe'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'next'; timestamp: number; observableId: number; subscriptionId: number; value: unknown }
  | { type: 'error'; timestamp: number; observableId: number; subscriptionId: number; error: unknown }
  | { type: 'complete'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'unsubscribe'; timestamp: number; observableId: number; subscriptionId: number };

interface OperatorInfo {
  name: string;        // Operator name (e.g., 'MapOperator', 'FilterOperator')
  parent?: number;     // Parent observable ID
  stackTrace?: string; // Stack trace of where observable was created
}
```

## Advanced Usage

### Using with Testing

```typescript
import { recordEvents } from 'rxjs-inspector/testing';
import { of } from 'rxjs';
import { map } from 'rxjs/operators';

test('observable emits values', async () => {
  const events = await recordEvents(
    of(1, 2, 3).pipe(map(x => x * 2))
  );

  const nextEvents = events.filter(e => e.type === 'next');
  expect(nextEvents).toHaveLength(6); // 3 from 'of', 3 from 'map'
});
```

### Filtering Events

```typescript
import { notifications$ } from 'rxjs-inspector';
import { filter } from 'rxjs/operators';

// Only capture errors
notifications$
  .pipe(filter(e => e.type === 'error'))
  .subscribe(error => {
    console.error('Observable error:', error);
  });

// Track specific observable
const targetObservableId = 5;
notifications$
  .pipe(filter(e => e.observableId === targetObservableId))
  .subscribe(event => {
    console.log('Observable 5 event:', event);
  });
```

### High-Volume Streams

For observables that emit frequently, use sampling:

```typescript
import { configureInstrumentation } from 'rxjs-inspector';

// Only capture 10% of next events
configureInstrumentation({
  sampleRate: 0.1
});
```

### Uninstalling Instrumentation

```typescript
import { uninstallRxjsInstrumentation } from 'rxjs-inspector';

// Restore original Observable.prototype.subscribe
uninstallRxjsInstrumentation();

// Can reinstall later if needed
installRxjsInstrumentation();
```

## Visualization Examples

### Tree View (Operator Chain)

```
Operator Chain:

Observable 1 (Observable)
  Observable 2 (MapOperator)
    Observable 3 (FilterOperator)
      Observable 4 (TakeOperator)
```

### Timeline View (Marble Diagram)

```
obs 1: -1-2-3|
obs 2: -2-4-6|
obs 3: ---4-6|
```

### Flat View

```
[1638360000000] observable-create #1 (Observable)
[1638360000001] observable-create #2 (MapOperator)
[1638360000002] subscribe obs=2 sub=1
[1638360000003] next obs=1 sub=1 value=1
[1638360000004] next obs=2 sub=1 value=2
[1638360000005] complete obs=2 sub=1
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  RxJS Application Code                                  │
│  (uses standard RxJS observables)                       │
└───────────────────┬─────────────────────────────────────┘
                    │
                    │ Observable.prototype.subscribe
                    │ (monkey-patched)
                    ▼
┌─────────────────────────────────────────────────────────┐
│  Instrumentation Core                                   │
│  - Intercepts all subscribe/next/error/complete/unsub   │
│  - Extracts operator metadata                           │
│  - Emits NotificationEvents to notifications$           │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┬──────────────┐
        ▼                       ▼              ▼
┌───────────────┐    ┌──────────────────┐  ┌──────────────┐
│ NDJSON Logger │    │  Web SSE Server  │  │ Test Helpers │
│ (file output) │    │  (real-time)     │  │              │
└───────────────┘    └──────────────────┘  └──────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│  CLI Tools                                            │
│  - print-log (tree/flat/timeline views)              │
│  - summarize-log (analytics & warnings)              │
└───────────────────────────────────────────────────────┘
```

## How It Works

1. **Installation**: `installRxjsInstrumentation()` monkey-patches `Observable.prototype.subscribe`
2. **Interception**: Every observable subscription is intercepted
3. **Event Emission**: Events are emitted to the `notifications$` observable
4. **Recursion Prevention**: Internal observables (like `notifications$`) are automatically excluded using a Symbol flag
5. **Consumption**: Events can be logged, streamed, or analyzed in real-time

## Performance Considerations

- **Minimal Overhead**: Only active during development/debugging
- **Sampling**: Configure `sampleRate` for high-volume streams
- **Value Redaction**: Use `excludeValues: true` to skip capturing large payloads
- **Disable in Production**: Use `enabled: false` or don't install in production builds

## Troubleshooting

### "Maximum call stack size exceeded"

This means infinite recursion occurred. This has been fixed in recent versions, but if you encounter it:

1. Make sure you're using the latest version
2. Don't instrument the `notifications$` observable itself
3. Check for circular observable references in your code

### Tests failing after instrumentation

Make sure to uninstall instrumentation in test teardown:

```typescript
afterEach(() => {
  uninstallRxjsInstrumentation();
});
```

### Events not appearing

Check that instrumentation is installed and enabled:

```typescript
import { configureInstrumentation } from 'rxjs-inspector';

configureInstrumentation({ enabled: true });
```

## API Reference

### Core Functions

- `installRxjsInstrumentation()` - Install global instrumentation
- `uninstallRxjsInstrumentation()` - Remove instrumentation
- `configureInstrumentation(config)` - Configure behavior
- `notifications$` - Observable stream of all events

### Node.js Functions

- `startNdjsonLogger(filename?)` - Start file logging

### Testing Functions

- `recordEvents(observable)` - Capture all events from an observable execution

### Visualization Functions

- `printLog(events, options)` - Print events in various formats
- `eventsToMarbleDiagram(events, observableId)` - Generate ASCII marble diagram
- `eventsToTimelineMermaid(events)` - Generate Mermaid timeline

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT © [Your Name]

## Changelog

### v0.1.0

- ✅ Initial release
- ✅ Operator-aware inspection
- ✅ Recursion prevention
- ✅ Multiple visualization formats
- ✅ CLI tools
- ✅ Real-time SSE server

## Credits

Built with:
- [RxJS](https://rxjs.dev/) - Reactive Extensions for JavaScript
- [Express](https://expressjs.com/) - Web server framework
- [Vitest](https://vitest.dev/) - Testing framework
- [tsup](https://tsup.egoist.dev/) - TypeScript bundler
