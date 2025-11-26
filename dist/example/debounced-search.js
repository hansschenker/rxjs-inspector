"use strict";
// Conceptual debounced search example for rxjs-inspector.
// This is not wired to a real UI, but shows the kind of pipeline
// you might want to inspect.
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchResult$ = void 0;
const rxjs_1 = require("rxjs");
const rxjs_2 = require("rxjs");
const core_1 = require("../instrumentation/core");
(0, core_1.installRxjsInstrumentation)();
// Mock search input and API
const searchInput$ = (0, rxjs_2.of)('r', 'rx', 'rxjs', 'rxjs error');
function searchApi(query) {
    // In a real app, this would be an HTTP request.
    return (0, rxjs_2.of)({
        total: 1,
        items: [`Result for ${query}`],
    });
}
exports.searchResult$ = searchInput$.pipe((0, rxjs_1.debounceTime)(300), (0, rxjs_1.distinctUntilChanged)(), (0, rxjs_1.switchMap)(query => searchApi(query)));
// For now, just subscribe and log notifications to console
core_1.notifications$.subscribe(evt => {
    // In a real tool, this would go to a file or visualization layer.
    console.log('[INSTR]', evt);
});
exports.searchResult$.subscribe(result => {
    console.log('SEARCH RESULT', result);
});
