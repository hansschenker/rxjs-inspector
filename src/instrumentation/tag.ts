// src/instrumentation/tag.ts
import { MonoTypeOperatorFunction, Observable } from 'rxjs';

// Symbol used by instrumentation to pick up human-friendly labels
export const INSPECTOR_LABEL = Symbol('rxjsInspectorLabel');

/**
 * Tag an observable with a human-readable label for visualization output.
 * The returned observable is a shallow wrapper over the source.
 */
export function tag<T>(label: string): MonoTypeOperatorFunction<T> {
  return (source) => {
    const tagged = new Observable<T>((subscriber) =>
      source.subscribe(subscriber),
    ) as any;

    tagged[INSPECTOR_LABEL] = label;
    // Preserve source reference so parent/child relationships still work
    tagged.source = source as any;

    return tagged;
  };
}
