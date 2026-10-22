# Project conventions

- Target RxJS 7.8.2. Do not migrate to RxJS 8 or 9 without an explicit request.
- Use functions and closures, strong TypeScript types, and named domain functions. Do not add project classes or global RxJS patches.
- Keep definition separate from subscription execution; cancellation, time, and sharing must be explicit.
- Recording must not create extra subscriptions to application sources. History navigation must not rerun effects.
- Use the real RxJS operators in adapters. Label reconstructed state and missing evidence honestly.
- Preserve synchronous disposal and reentrant behavior. Verify changes with meaningful parity cases against the pinned RxJS version.
- Keep DOM rendering in the optional viewer entry point and use safe text rendering for trace payloads.
- Run npm run check, build the demo, and check npm pack before publishing repository changes.
- Keep the README contributor credit. Include `Co-Authored-By: GPT-6 Astra <noreply@openai.com>` in collaborative implementation commits.
- GitHub is authoritative. An npm registry publication requires an explicit user request.
