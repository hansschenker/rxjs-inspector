# Observable Tagging Guide

## Why Tagging is Necessary

In **RxJS v7+**, all observables are instances of the same `Observable` class, and all operators are implemented as anonymous functions. This makes it impossible to automatically detect the names of source observables (like `from`, `of`, `interval`) through prototype inspection or stack trace analysis.

The **only reliable way** to give meaningful names to your observables is to **manually tag them** using the `tag()` operator.

## How to Use the Tag Operator

### Basic Usage

```typescript
import { from, map, filter } from 'rxjs';
import { tag } from './operators/tag';

// Tag the source observable with a descriptive name
const users$ = from(fetchUsers()).pipe(
  tag('users-from-api'),
  map(user => user.name),
  filter(name => name.length > 0)
);
```

### Dashboard Visualization

When you use tags, the RxJS Inspector dashboard will display the full operator chain with your custom names:

**Without tags:**
```
Observable #1 → pipe #2 → pipe #3
```

**With tags:**
```
users-from-api #1 → pipe #2 → pipe #3
```

This makes it **much easier** to understand which source observable each operator chain comes from, especially in complex applications with multiple observable streams.

## Best Practices

### 1. Tag All Source Observables

Tag every source observable to make debugging easier:

```typescript
// HTTP requests
const users$ = http.get('/api/users').pipe(
  tag('users-api')
);

// Timers
const ticker$ = interval(1000).pipe(
  tag('1s-ticker')
);

// Arrays
const numbers$ = from([1, 2, 3, 4, 5]).pipe(
  tag('numbers-array')
);

// Events
const clicks$ = fromEvent(button, 'click').pipe(
  tag('button-clicks')
);
```

### 2. Use Descriptive Names

Choose names that describe both the **source** and **purpose**:

```typescript
// Good: Describes what and why
tag('user-profile-http')
tag('search-input-keypress')
tag('cart-items-localstorage')

// Less helpful: Too generic
tag('data')
tag('stream')
tag('obs')
```

### 3. Tag at the Source

Place the `tag()` operator immediately after creating the observable:

```typescript
// ✅ Good: Tag at the source
const data$ = from(apiCall()).pipe(
  tag('api-data'),
  map(transform),
  filter(validate)
);

// ❌ Less helpful: Tag too late
const data$ = from(apiCall()).pipe(
  map(transform),
  tag('api-data'),  // Tag doesn't affect the source
  filter(validate)
);
```

### 4. Use Tags in Complex Applications

Tags are especially valuable when you have:

- Multiple HTTP endpoints
- Multiple event streams
- Flattening operators (mergeMap, switchMap, concatMap)
- Shared observables used in different contexts

```typescript
// Multiple API endpoints
const users$ = http.get('/api/users').pipe(tag('users-api'));
const posts$ = http.get('/api/posts').pipe(tag('posts-api'));
const comments$ = http.get('/api/comments').pipe(tag('comments-api'));

// Flattening - see which source triggers which nested stream
const userPosts$ = users$.pipe(
  tag('users-source'),
  mergeMap(user =>
    posts$.pipe(
      tag('posts-nested'),
      filter(post => post.userId === user.id)
    )
  )
);
```

## Running the Tagged Demo

Run the tagged demo to see how tags appear in the dashboard:

```bash
# Generate NDJSON with tagged observables
npm run demo:tagged

# Start the dashboard
npm run dashboard

# Open browser to http://localhost:3000
# Load rxjs-inspector-tagged.ndjson
```

## Operator Chain Visualization

The dashboard shows the **complete operator chain** for each observable, highlighting:

- **Source observable** (gray text) - The root of the chain
- **Intermediate operators** (gray text) - Transformations in the middle
- **Current operator** (bold purple text) - The observable being displayed

Example chain display:
```
users-from-api → map → filter #3
```

This tells you:
- The source is tagged as "users-from-api"
- There's a map operator
- There's a filter operator (ID #3, currently selected)

## Technical Details

### How Tags Work

The `tag()` operator stores a custom name on the observable object:

```typescript
export function tag<T>(name: string): OperatorFunction<T, T> {
  return (source: Observable<T>) => {
    (source as any).__rxjsInspectorTag = name;
    const tagged = new Observable<T>(subscriber => {
      return source.subscribe(subscriber);
    });
    (tagged as any).__rxjsInspectorTag = name;
    return tagged;
  };
}
```

The instrumentation checks for this tag first before trying other detection methods:

```typescript
function extractOperatorInfo(obs: Observable<any>) {
  // Priority 0: Check for manual tag
  const tag = obs.__rxjsInspectorTag;
  if (tag) {
    return { name: tag, parent: obs.source?.__rxjsInspectorId };
  }
  // ... fallback to other detection methods
}
```

### Why Stack Traces Don't Work

In RxJS v7+, operators are anonymous functions, and stack traces don't reliably show RxJS internal paths. The `from()`, `of()`, and `interval()` creation functions execute and return before subscription happens, so their stack frames are gone by the time we can instrument the observable.

This is why **manual tagging is the only reliable approach** for modern RxJS.

## Comparison with rxjs-spy

The `rxjs-inspector` tag operator is inspired by [rxjs-spy](https://github.com/cartant/rxjs-spy), which pioneered this approach for RxJS debugging.

**Key differences:**

| Feature | rxjs-spy | rxjs-inspector |
|---------|----------|----------------|
| Target RxJS version | v5/v6 (class-based) | v7+ (function-based) |
| Operator detection | Prototype inspection + tags | Tags only (required) |
| Dashboard | CLI-based | Web-based with visualization |
| NDJSON logging | No | Yes |
| Parent chain tracking | Via graph plugin | Built-in |

## Summary

- ✅ **Always tag source observables** for meaningful debugging
- ✅ Use **descriptive names** that indicate source and purpose
- ✅ Tag **immediately after creation** for best results
- ✅ View **operator chains** in the dashboard to understand data flow
- ✅ Tags are **essential** for RxJS v7+ debugging

Happy debugging! 🎉
