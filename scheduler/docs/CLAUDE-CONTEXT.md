# Course Schedule Optimizer — Claude Context

Use this document when starting a new Claude session to work on the scheduler tool.

## What This Tool Does

A client-side course scheduling optimizer for the Valpo ME/BE department. The user uploads CSV files (courses to schedule, external frozen schedules, time slots), and the tool automatically computes an optimal schedule using constraint satisfaction. Runs entirely in the browser — no server.

## Architecture

```
_pages/scheduler.html              → Jekyll page, permalink: /scheduler/
_layouts/scheduler.html            → Injects COURSES from courses.yml, loads JS
_includes/scheduler/
  upload-panel.html                → File upload UI (3 CSV inputs + sample data button)
  results-grid.html                → Weekly grid + filter dropdowns + export buttons
  conflict-report.html             → Conflict summary + detail cards
  load-summary.html                → Faculty load table
scheduler/
  js/
    parser.js                      → CSV parsers: parseCoursesCSV, parseExternalCSV, parseTimeslotsCSV
    optimizer.js                   → CSP solver: optimizeSchedule(), detectConflicts(), computeFacultyLoads()
    scheduler-ui.js                → DOM manipulation, event handlers, grid rendering, export
  css/
    scheduler.css                  → All styles (uses site's CSS custom properties)
  sample-data/                     → Example CSVs for testing
  docs/                            → This file + USER-GUIDE.md
```

## Data Flow

1. `_layouts/scheduler.html` uses Liquid to inject `courses.yml` as `COURSES` global (same pattern as degree-map)
2. User uploads 3 CSV files → parsed by `parser.js` into JS objects
3. `scheduler-ui.js` calls `optimizeSchedule()` from `optimizer.js`
4. Optimizer builds a conflict graph from `COURSES` (which courses share a program-semester)
5. Backtracking solver assigns each department course to a time slot
6. Results rendered as weekly grid + conflict report + faculty loads

## Key Data Structures

### From courses.yml (injected as COURSES global)
```js
COURSES["ME_352"] = {
  id: "ME_352", code: "ME 352", title: "Machine Design",
  credits: 3, semesters: { ME: 5, BE_Biomech: 5 }, ...
}
```

### Parsed from user CSV
```js
// Department course (from parseCoursesCSV)
{ code: "ME 352", courseId: "ME_352", instructor: "Smith",
  section: "01", isLab: false, linkedTo: "", locked: false, slotIndex: null }

// External schedule (from parseExternalCSV)
{ code: "MATH 132", courseId: "MATH_132", dayPattern: "MWF",
  startTime: "10:00", endTime: "10:50", section: "01" }

// Time slot (from parseTimeslotsCSV)
{ index: 0, type: "class", dayPattern: "MWF",
  startTime: "08:00", endTime: "08:50", days: [0, 2, 4] }
```

### Optimizer output
```js
{
  scheduled: [{ course, slot, info }],  // placed courses with slot + courses.yml info
  unscheduled: [course],                 // couldn't be placed
  conflicts: [{ type, courses, detail }], // remaining conflicts
  score: 0,                              // lower = better (0 = perfect)
  iterations: 1234                       // solver iterations used
}
```

## Optimizer Algorithm

**Constraint Satisfaction with Backtracking**

Hard constraints (must satisfy):
- No instructor teaches two courses at the same time
- Labs only go in lab-type slots, classes in class-type slots
- Each course-section gets exactly one slot
- Lab and its linked lecture cannot overlap
- No overlap with external schedules for same-semester courses

Soft constraints (minimize, weighted):
- Student conflicts: same program-semester courses overlapping (weight: 100)
- Lab on same day as lecture (weight: 5)
- Instructor 3+ back-to-back without break (weight: 2)

**Process**: Courses are ordered by most constrained first (most same-semester peers). Backtracking tries all valid slots for each course, scores complete assignments, keeps the best. Stops early if a perfect (score=0) solution is found. Max 500K iterations.

## How to Modify

### Change the CSV format
Edit the specific parser function in `parser.js`. Each parser (`parseCoursesCSV`, `parseExternalCSV`, `parseTimeslotsCSV`) is independent — changing one doesn't affect the others. The generic `parseCSVRows()` handles the actual CSV splitting.

### Add new constraints
In `optimizer.js`:
- Hard constraints → add checks in `isValid()` function
- Soft constraints → add scoring in `scoreAssignment()` function and add a weight to `WEIGHTS`

### Change the grid display
In `scheduler-ui.js`:
- `renderGrid()` builds the weekly calendar
- `createCourseBlock()` creates individual course block elements
- `applyFilters()` handles the filter dropdowns
- Constants `GRID_START_HOUR`, `GRID_END_HOUR`, `PIXELS_PER_MIN` control the grid dimensions

### Add new filter dropdowns
1. Add `<select>` element in `_includes/scheduler/results-grid.html`
2. Add event listener in `scheduler-ui.js` DOMContentLoaded
3. Add filter logic in `applyFilters()` using `block.dataset.*`

## Dev Server

```bash
bundle exec jekyll serve --config _config.yml,_config.dev.yml
# Navigate to localhost:4000/dev/scheduler/
```

**Gotcha**: The `baseurl` in dev is `/dev`. The sample data fetch URLs account for this by checking `location.pathname`.

## Dependencies

- **COURSES global** — injected by layout from `_data/courses/*.yml`
- **SheetJS (xlsx)** — loaded from CDN for Excel export
- **No other dependencies** — vanilla JS, no npm, no build tools

## CSS

Uses the site's CSS custom properties (`--gold`, `--teal`, `--brown`, `--dark-brown`, `--parchment`, `--font-display`, `--font-body`, `--font-mono`). All scheduler-specific styles are in `scheduler/css/scheduler.css`.

## Testing

No test framework. Verify manually:
1. Load sample data → Generate → check grid shows courses without overlaps
2. Check filter dropdowns work
3. Lock a course → Re-optimize → locked course stays put
4. Export CSV/Excel → verify contents
5. Check browser console for errors
