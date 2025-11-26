"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rxjs_1 = require("rxjs");
const node_fs_1 = require("node:fs");
const core_1 = require("../instrumentation/core");
// Install the RxJS Inspector monkey patch
(0, core_1.installRxjsInstrumentation)();
// NDJSON log file
const logFile = (0, node_fs_1.createWriteStream)('rxjs-inspector.ndjson', { flags: 'a' });
// Subscribe to all notification events and write them as NDJSON
core_1.notifications$.subscribe(evt => {
    logFile.write(JSON.stringify(evt) + '\n');
});
// Example pipeline under inspection
const result$ = (0, rxjs_1.from)([1, 2, 3, 4, 5, 6, 7, 8, 9]).pipe((0, rxjs_1.map)(n => n * 10), (0, rxjs_1.filter)(n => n > 40));
result$.subscribe({
    next: value => {
        console.log('RESULT', value);
    },
    complete: () => {
        console.log('RESULT complete');
        logFile.end();
    },
});
