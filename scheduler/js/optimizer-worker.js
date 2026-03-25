/* ╔══════════════════════════════════════════════════════════════╗
   ║  OPTIMIZER WEB WORKER                                       ║
   ║  Runs optimizeSchedule() and computeSuggestions() off the   ║
   ║  main thread so the UI stays responsive. Loads parser.js +  ║
   ║  optimizer.js, receives COURSES + inputs via postMessage,   ║
   ║  posts result back.                                         ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Load dependencies into worker scope ─────────────────────
// importScripts is synchronous in workers — order matters.
importScripts('parser.js', 'optimizer.js');

// ── Helper: reconstruct Maps from serialized prefs ──────────
function deserializePrefs(facultyPrefs) {
  let prefs = { preferences: new Map(), specialRules: [] };
  if (facultyPrefs) {
    if (Array.isArray(facultyPrefs.preferences)) {
      prefs.preferences = new Map(facultyPrefs.preferences);
    } else if (facultyPrefs.preferences instanceof Map) {
      prefs.preferences = facultyPrefs.preferences;
    }
    prefs.specialRules = facultyPrefs.specialRules || [];
  }
  return prefs;
}

// ── Listen for messages ─────────────────────────────────────
self.onmessage = function(e) {
  const msgType = e.data.type || 'optimize';

  // ── Full optimization run ───────────────────────────────
  if (msgType === 'optimize') {
    const { courses, frozen, slots, facultyPrefs, weights, seed, coursesGlobal } = e.data;
    self.COURSES = coursesGlobal;
    const prefs = deserializePrefs(facultyPrefs);

    try {
      const t0 = performance.now();
      const result = optimizeSchedule(courses, frozen || [], slots, prefs, weights, seed);
      const elapsed = performance.now() - t0;

      self.postMessage({
        type: 'result',
        result: result,
        elapsed: elapsed,
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err.message,
        stack: err.stack,
      });
    }
  }

  // ── Suggestion search (UniTime-style) ───────────────────
  if (msgType === 'suggestions') {
    const { scheduled, frozen, slots, facultyPrefs, weights,
            targetCourseKey, maxDepth, timeoutMs, coursesGlobal } = e.data;
    self.COURSES = coursesGlobal;
    const prefs = deserializePrefs(facultyPrefs);

    try {
      const t0 = performance.now();
      const suggestions = computeSuggestions(
        scheduled, frozen || [], slots, prefs, weights,
        targetCourseKey, maxDepth || 2, timeoutMs || 500
      );
      const elapsed = performance.now() - t0;

      self.postMessage({
        type: 'suggestions',
        suggestions: suggestions,
        elapsed: elapsed,
      });
    } catch (err) {
      self.postMessage({
        type: 'suggestions-error',
        message: err.message,
        stack: err.stack,
      });
    }
  }
};
