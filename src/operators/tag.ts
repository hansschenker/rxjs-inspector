import { Observable, OperatorFunction } from 'rxjs';

/**
 * Tags an observable with a custom name for debugging purposes.
 * This name will appear in the RxJS Inspector dashboard.
 *
 * @example
 * ```ts
 * import { from } from 'rxjs';
 * import { tag } from './operators/tag';
 *
 * const users$ = from(fetchUsers()).pipe(
 *   tag('users-source')
 * );
 * ```
 */
export function tag<T>(name: string): OperatorFunction<T, T> {
  return (source: Observable<T>) => {
    // Tag the source observable directly
    (source as any).__rxjsInspectorTag = name;

    // Return a pass-through observable that preserves the tag
    const tagged = new Observable<T>(subscriber => {
      return source.subscribe(subscriber);
    });

    // Also tag the wrapper
    (tagged as any).__rxjsInspectorTag = name;

    return tagged;
  };
}

/**
 * Read the tag from an observable
 */
export function readTag(obs: any): string | undefined {
  return obs?.__rxjsInspectorTag;
}
