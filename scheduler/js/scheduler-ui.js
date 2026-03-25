/* ╔══════════════════════════════════════════════════════════════╗
   ║  SCHEDULER UI — Upload, grid, filters, reports, export      ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Depends on: parser.js, optimizer.js, COURSES global         ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── State ───────────────────────────────────────────────────────
let STATE = {
  courses:      null,  // parsed dept courses (need scheduling)
  frozen:       null,  // parsed frozen/external courses
  slots:        null,  // parsed time slots
  facultyPrefs: null,  // parsed faculty preferences (optional)
  result:       null,  // optimizer output
  activeDay:    0,     // which day tab is selected (0-4, or 'all')
  showExternals: false,
  selectedCourse: null, // for detail panel
};

const GRID_START_HOUR = 7;
const GRID_END_HOUR   = 18;
const PIXELS_PER_MIN  = 1.8;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const INSTRUCTOR_COLORS = new Map();
let colorIndex = 0;

function getInstructorColor(name) {
  if (!INSTRUCTOR_COLORS.has(name)) {
    INSTRUCTOR_COLORS.set(name, colorIndex % 12);
    colorIndex++;
  }
  return INSTRUCTOR_COLORS.get(name);
}

// ── Semester → year level label ─────────────────────────────────
const YEAR_LABELS = { 1: 'Fr', 2: 'So', 3: 'Jr', 4: 'Sr' };
const YEAR_TAG_CLASS = { 1: 'tag-fr', 2: 'tag-so', 3: 'tag-jr', 4: 'tag-sr' };

function getYearLevel(courseId) {
  const info = COURSES[courseId];
  if (!info || !info.semesters) return null;
  const sems = Object.values(info.semesters);
  if (sems.length === 0) return null;
  return semToYear(Math.min(...sems));
}

function getPrograms(courseId) {
  const info = COURSES[courseId];
  if (!info || !info.semesters) return [];
  return Object.keys(info.semesters);
}

function getProgramTag(prog) {
  if (prog.startsWith('BE')) return 'tag-be';
  if (prog === 'ME') return 'tag-me';
  return 'tag-ge';
}

function getProgramLabel(prog) {
  if (prog === 'ME') return 'ME';
  if (prog.startsWith('BE')) return 'BE';
  return 'GE';
}

// ── Get display name for instructor ─────────────────────────────
function getInstructorDisplay(course) {
  if (!course.instructors || course.instructors.length === 0) return 'TBD';
  const inst = course.instructors[0];
  if (inst.last === 'Staff') return 'Staff';
  return inst.last;
}

function getFullInstructorDisplay(course) {
  if (!course.instructors || course.instructors.length === 0) return 'TBD';
  return course.instructors.map(i => `${i.first} ${i.last}`).join(', ');
}

// ── Get slider weights from UI ──────────────────────────────────
function getWeights() {
  return {
    cohortConflict:         parseInt(document.getElementById('weight-cohort')?.value || '9', 10),
    facultyPref:            parseInt(document.getElementById('weight-faculty-pref')?.value || '8', 10),
    singleSectionAfternoon: parseInt(document.getElementById('weight-single-before230')?.value || '10', 10),
    backToBack:             parseInt(document.getElementById('weight-back-to-back')?.value || '6', 10),
    specialConstraints:     parseInt(document.getElementById('weight-special')?.value || '10', 10),
  };
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // File upload handlers
  document.getElementById('file-master').addEventListener('change', handleMasterUpload);
  document.getElementById('file-timeslots').addEventListener('change', handleTimeslotsUpload);
  const facInput = document.getElementById('file-preferences');
  if (facInput) facInput.addEventListener('change', handleFacultyUpload);

  // Buttons
  document.getElementById('btn-generate').addEventListener('click', runOptimizer);
  document.getElementById('btn-sample').addEventListener('click', loadSampleData);
  document.getElementById('btn-rerun').addEventListener('click', runOptimizer);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-xlsx').addEventListener('click', exportExcel);

  // Filters
  document.getElementById('filter-instructor').addEventListener('change', applyFilters);
  document.getElementById('filter-year').addEventListener('change', applyFilters);
  document.getElementById('filter-program').addEventListener('change', applyFilters);

  // Day tabs
  for (const tab of document.querySelectorAll('.day-tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      STATE.activeDay = tab.dataset.day === 'all' ? 'all' : parseInt(tab.dataset.day, 10);
      renderGrid();
      applyFilters();
    });
  }

  // Dept-only / All courses toggle
  document.getElementById('toggle-dept').addEventListener('click', () => {
    STATE.showExternals = false;
    document.getElementById('toggle-dept').classList.add('active');
    document.getElementById('toggle-all-courses').classList.remove('active');
    renderGrid();
    applyFilters();
  });
  document.getElementById('toggle-all-courses').addEventListener('click', () => {
    STATE.showExternals = true;
    document.getElementById('toggle-all-courses').classList.add('active');
    document.getElementById('toggle-dept').classList.remove('active');
    renderGrid();
    applyFilters();
  });

  // Weight slider value displays
  for (const slider of document.querySelectorAll('.weight-slider-group input[type="range"]')) {
    const display = slider.parentElement.querySelector('.slider-value');
    if (display) {
      slider.addEventListener('input', () => { display.textContent = slider.value; });
    }
  }

  // Close detail panel
  const closeBtn = document.getElementById('detail-close');
  if (closeBtn) closeBtn.addEventListener('click', closeDetailPanel);
});

// ── File upload handlers ────────────────────────────────────────
function handleMasterUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(text => {
    const parsed = parseMasterCSV(text);
    STATE.courses = parsed.courses;
    STATE.frozen  = parsed.frozen;
    const el = document.getElementById('status-master');
    const total = parsed.courses.length + parsed.frozen.length;
    el.textContent = `${file.name} — ${parsed.courses.length} to schedule, ${parsed.frozen.length} frozen (${total} total)`;
    el.classList.add('loaded');
    checkReady();
  });
}

function handleTimeslotsUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(text => {
    STATE.slots = parseTimeslotsCSV(text);
    const el = document.getElementById('status-timeslots');
    el.textContent = `${file.name} — ${STATE.slots.length} slots`;
    el.classList.add('loaded');
    checkReady();
  });
}

function handleFacultyUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(text => {
    STATE.facultyPrefs = parseFacultyPrefsCSV(text);
    const el = document.getElementById('status-preferences');
    const count = STATE.facultyPrefs.preferences.size;
    const rules = STATE.facultyPrefs.specialRules.length;
    el.textContent = `${file.name} — ${count} faculty, ${rules} special rules`;
    el.classList.add('loaded');
  });
}

function checkReady() {
  const ready = STATE.courses && STATE.slots;
  document.getElementById('btn-generate').disabled = !ready;
}

// ── Load sample data ────────────────────────────────────────────
async function loadSampleData() {
  const base = document.querySelector('meta[name="baseurl"]')?.content ||
               (location.pathname.startsWith('/dev') ? '/dev' : '');
  try {
    const [masterText, slotsText, facText] = await Promise.all([
      fetch(`${base}/scheduler/sample-data/master-courses.csv`).then(r => r.text()),
      fetch(`${base}/scheduler/sample-data/timeslots.csv`).then(r => r.text()),
      fetch(`${base}/scheduler/sample-data/faculty-preferences.csv`).then(r => r.text()),
    ]);

    const parsed = parseMasterCSV(masterText);
    STATE.courses = parsed.courses;
    STATE.frozen  = parsed.frozen;
    STATE.slots   = parseTimeslotsCSV(slotsText);
    STATE.facultyPrefs = parseFacultyPrefsCSV(facText);

    const total = parsed.courses.length + parsed.frozen.length;
    document.getElementById('status-master').textContent = `Sample — ${parsed.courses.length} to schedule, ${parsed.frozen.length} frozen (${total} total)`;
    document.getElementById('status-master').classList.add('loaded');
    document.getElementById('status-timeslots').textContent = `Sample — ${STATE.slots.length} slots`;
    document.getElementById('status-timeslots').classList.add('loaded');
    document.getElementById('status-preferences').textContent = `Sample — ${STATE.facultyPrefs.preferences.size} faculty, ${STATE.facultyPrefs.specialRules.length} rules`;
    document.getElementById('status-preferences').classList.add('loaded');

    checkReady();
  } catch (err) {
    console.error('Failed to load sample data:', err);
    alert('Could not load sample data. Make sure the dev server is running.');
  }
}

// ── Run optimizer ───────────────────────────────────────────────
function runOptimizer() {
  if (!STATE.courses || !STATE.slots) return;

  const weights = getWeights();
  const prefs = STATE.facultyPrefs || { preferences: new Map(), specialRules: [] };

  // Show a brief "working" state
  const btn = document.getElementById('btn-generate');
  const prevText = btn.textContent;
  btn.textContent = 'Optimizing...';
  btn.disabled = true;

  // Serialize the preferences Map for worker transfer
  const serializedPrefs = {
    preferences: prefs.preferences instanceof Map ? [...prefs.preferences.entries()] : [],
    specialRules: prefs.specialRules || [],
  };

  // Resolve worker script path (handle /dev/ baseurl)
  const basePath = document.querySelector('script[src*="scheduler-ui"]')?.src?.replace(/js\/scheduler-ui\.js.*/, 'js/') || '/scheduler/js/';
  const workerUrl = basePath + 'optimizer-worker.js';

  const worker = new Worker(workerUrl);

  worker.onmessage = function(e) {
    worker.terminate();

    if (e.data.type === 'error') {
      console.error('Optimizer CRASHED:', e.data.message, e.data.stack);
      btn.textContent = prevText;
      btn.disabled = false;
      alert('Optimizer error: ' + e.data.message);
      return;
    }

    const { result, elapsed } = e.data;
    STATE.result = result;
    console.log(`Optimizer: ${elapsed.toFixed(1)}ms, ${result.iterations} iterations, score=${result.score}`);

    btn.textContent = prevText;
    btn.disabled = false;

    // Show result sections
    document.getElementById('scheduler-results').hidden = false;
    document.getElementById('scheduler-conflicts').hidden = false;
    document.getElementById('scheduler-loads').hidden = false;

    // Populate instructor filter
    populateInstructorFilter();

    // Render everything
    renderGrid();
    renderAnalysis();
    renderLoads();
  };

  worker.onerror = function(err) {
    worker.terminate();
    console.error('Worker error:', err);
    btn.textContent = prevText;
    btn.disabled = false;
    alert('Optimizer worker error: ' + (err.message || 'Unknown error'));
  };

  // Post data to worker (COURSES global is needed for semester/conflict data)
  worker.postMessage({
    courses: STATE.courses,
    frozen: STATE.frozen || [],
    slots: STATE.slots,
    facultyPrefs: serializedPrefs,
    weights: weights,
    seed: null,
    coursesGlobal: typeof COURSES !== 'undefined' ? COURSES : {},
  });
}

// ── Populate instructor dropdown ────────────────────────────────
function populateInstructorFilter() {
  const select = document.getElementById('filter-instructor');
  const instructors = new Set();
  for (const item of STATE.result.scheduled) {
    if (!item.course.isExternal) {
      instructors.add(getInstructorKey(item.course) || getInstructorDisplay(item.course));
    }
  }
  select.innerHTML = '<option value="all">All</option>';
  for (const name of [...instructors].sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

// ── Overlap layout algorithm ────────────────────────────────────
function layoutOverlaps(entries) {
  if (entries.length === 0) return;
  entries.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const columns = [];
  for (const entry of entries) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      if (columns[c] <= entry.startMin) {
        entry.col = c;
        columns[c] = entry.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      entry.col = columns.length;
      columns.push(entry.endMin);
    }
  }

  const clusters = [];
  let clusterStart = 0;
  let clusterEnd = entries[0].endMin;

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, entries[i].endMin);
    } else {
      clusters.push({ from: clusterStart, to: i });
      clusterStart = i;
      clusterEnd = entries[i].endMin;
    }
  }
  clusters.push({ from: clusterStart, to: entries.length });

  for (const cluster of clusters) {
    let maxCol = 0;
    for (let i = cluster.from; i < cluster.to; i++) {
      maxCol = Math.max(maxCol, entries[i].col);
    }
    const totalCols = maxCol + 1;
    for (let i = cluster.from; i < cluster.to; i++) {
      entries[i].totalCols = totalCols;
    }
  }
}

// ── Render weekly grid ──────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('weekly-grid');
  grid.innerHTML = '';

  const singleDay = STATE.activeDay !== 'all';
  const daysToShow = singleDay ? [STATE.activeDay] : [0, 1, 2, 3, 4];

  grid.classList.toggle('single-day', singleDay);
  grid.style.gridTemplateColumns = singleDay ? '70px 1fr' : '60px repeat(5, 1fr)';

  // Header row
  const cornerHeader = document.createElement('div');
  cornerHeader.className = 'grid-header';
  cornerHeader.textContent = 'Time';
  grid.appendChild(cornerHeader);

  for (const d of daysToShow) {
    const dh = document.createElement('div');
    dh.className = 'grid-header';
    dh.textContent = singleDay ? DAY_NAMES[d] : DAY_SHORT[d];
    grid.appendChild(dh);
  }

  // Time column
  const timeCol = document.createElement('div');
  timeCol.className = 'grid-time-col';
  const totalMinutes = (GRID_END_HOUR - GRID_START_HOUR) * 60;
  const pxPerMin = singleDay ? 2.5 : PIXELS_PER_MIN;
  const colHeight = totalMinutes * pxPerMin;

  for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
    const label = document.createElement('div');
    label.className = 'grid-time';
    label.style.position = 'absolute';
    label.style.top = `${(h - GRID_START_HOUR) * 60 * pxPerMin}px`;
    const hour12 = h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? 'PM' : 'AM';
    label.textContent = `${hour12}:00 ${ampm}`;
    timeCol.appendChild(label);
  }
  timeCol.style.position = 'relative';
  timeCol.style.height = `${colHeight}px`;
  grid.appendChild(timeCol);

  // Conflict set
  const conflictSet = new Set();
  if (STATE.result) {
    for (const c of STATE.result.conflicts) {
      if (c.courses) {
        for (let i = 0; i < c.courses.length; i++) {
          conflictSet.add(`${c.courses[i]}-${c.sections ? c.sections[i] : ''}`);
        }
      }
    }
  }

  // Day columns
  for (const d of daysToShow) {
    const col = document.createElement('div');
    col.className = 'grid-day-col';
    col.style.position = 'relative';
    col.style.height = `${colHeight}px`;

    for (let h = GRID_START_HOUR; h <= GRID_END_HOUR; h++) {
      const line = document.createElement('div');
      line.className = `grid-line${h !== GRID_START_HOUR ? ' hour' : ''}`;
      line.style.top = `${(h - GRID_START_HOUR) * 60 * pxPerMin}px`;
      col.appendChild(line);
    }
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
      const line = document.createElement('div');
      line.className = 'grid-line';
      line.style.top = `${((h - GRID_START_HOUR) * 60 + 30) * pxPerMin}px`;
      col.appendChild(line);
    }

    if (STATE.result) {
      const dayEntries = [];
      for (const item of STATE.result.scheduled) {
        if (!item.slot || !item.slot.days) continue;
        if (!item.slot.days.includes(d)) continue;
        if (!STATE.showExternals && item.course.isExternal) continue;

        const startMin = timeToMinutes(item.slot.startTime) - GRID_START_HOUR * 60;
        const endMin   = timeToMinutes(item.slot.endTime) - GRID_START_HOUR * 60;
        if (startMin < 0 || endMin <= startMin) continue;
        dayEntries.push({ item, startMin, endMin, col: 0, totalCols: 1 });
      }

      layoutOverlaps(dayEntries);

      const GAP = 2;
      for (const entry of dayEntries) {
        const block = createCourseBlock(entry.item, conflictSet);
        const height = (entry.endMin - entry.startMin) * pxPerMin;

        block.style.top    = `${entry.startMin * pxPerMin}px`;
        block.style.height = `${height}px`;

        const colWidth = 100 / entry.totalCols;
        block.style.left  = `calc(${entry.col * colWidth}% + ${GAP}px)`;
        block.style.width = `calc(${colWidth}% - ${GAP * 2}px)`;

        col.appendChild(block);
      }
    }

    grid.appendChild(col);
  }
}

// ── Create a course block element ───────────────────────────────
function createCourseBlock(item, conflictSet) {
  const block = document.createElement('div');
  const c = item.course;
  const instrName = getInstructorDisplay(c);
  const colorClass = `color-${getInstructorColor(instrName) % 12}`;
  block.className = `course-block ${colorClass}`;

  if (c.isExternal) block.classList.add('external');
  if (c.locked && !c.isExternal) block.classList.add('locked');

  const key = `${c.code}-${c.section}`;
  if (conflictSet.has(key)) block.classList.add('conflict');

  // Data attributes for filtering
  const year = getYearLevel(c.courseId);
  const progs = getPrograms(c.courseId);
  block.dataset.instructor = (typeof getInstructorKey === 'function' ? getInstructorKey(c) : null) || instrName;
  block.dataset.year = year || '';
  block.dataset.programs = progs.join(',');
  block.dataset.code = c.code;
  block.dataset.section = c.section;

  // Content
  block.innerHTML = `
    <div class="block-code">${c.code} §${c.section}</div>
    <div class="block-instructor">${instrName}</div>
    <div class="block-time">${item.slot.startTime}–${item.slot.endTime}</div>
    <div class="block-tags">
      ${year ? `<span class="block-tag ${YEAR_TAG_CLASS[year]}">${YEAR_LABELS[year]}</span>` : ''}
      ${[...new Set(progs.map(getProgramLabel))].map(label =>
        `<span class="block-tag ${getProgramTag(progs.find(p => getProgramLabel(p) === label))}">${label}</span>`
      ).join('')}
    </div>
  `;

  // Click to open detail panel (not external)
  if (!c.isExternal) {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailPanel(item);
    });
  }

  return block;
}

// ── Course detail panel (UniTime-style suggestion search) ───────
function openDetailPanel(item) {
  STATE.selectedCourse = item;
  const panel = document.getElementById('course-detail-panel');
  if (!panel) return;

  const c = item.course;
  const instrDisplay = getFullInstructorDisplay(c);
  const year = getYearLevel(c.courseId);
  const yearLabel = year ? YEAR_LABELS[year] : '—';

  panel.querySelector('.detail-course-code').textContent = `${c.code} §${c.section}`;
  panel.querySelector('.detail-instructor').textContent = instrDisplay;
  panel.querySelector('.detail-current-time').textContent = `${item.slot.startTime} – ${item.slot.endTime} (${item.slot.dayPattern || ''})`;
  panel.querySelector('.detail-mode').textContent = c.mode || '—';
  panel.querySelector('.detail-year').textContent = yearLabel;
  panel.querySelector('.detail-credits').textContent = `${c.studentCredits || '—'} student / ${c.facultyCredits || '—'} faculty`;

  // Lock/unlock button
  const lockBtn = panel.querySelector('.detail-lock-btn');
  lockBtn.textContent = c.locked ? 'Unlock' : 'Lock';
  lockBtn.onclick = () => {
    c.locked = !c.locked;
    lockBtn.textContent = c.locked ? 'Unlock' : 'Lock';
    renderGrid();
    applyFilters();
  };

  // Suggestion list — show spinner while worker computes
  const altList = panel.querySelector('.detail-alternatives');
  altList.innerHTML = '<div class="suggestion-spinner">Computing suggestions...</div>';

  panel.classList.add('open');

  // ── Send suggestion request to worker ─────────────────────
  const targetKey = `${c.code}:${c.section}`;
  const weights = getWeights();
  const prefs = STATE.facultyPrefs || { preferences: new Map(), specialRules: [] };

  const serializedPrefs = {
    preferences: prefs.preferences instanceof Map ? [...prefs.preferences.entries()] : [],
    specialRules: prefs.specialRules || [],
  };

  const basePath = document.querySelector('script[src*="scheduler-ui"]')?.src?.replace(/js\/scheduler-ui\.js.*/, 'js/') || '/scheduler/js/';
  const workerUrl = basePath + 'optimizer-worker.js';
  const worker = new Worker(workerUrl);

  worker.onmessage = function(e) {
    worker.terminate();

    if (e.data.type === 'suggestions-error') {
      console.error('Suggestion search error:', e.data.message);
      altList.innerHTML = '<div class="move-option" style="color: var(--light-gray);">Error computing suggestions</div>';
      return;
    }

    if (e.data.type === 'suggestions') {
      console.log(`Suggestions: ${e.data.suggestions.length} found in ${e.data.elapsed.toFixed(1)}ms`);
      renderSuggestions(altList, e.data.suggestions, item);
    }
  };

  worker.onerror = function(err) {
    worker.terminate();
    console.error('Suggestion worker error:', err);
    altList.innerHTML = '<div class="move-option" style="color: var(--light-gray);">Error computing suggestions</div>';
  };

  worker.postMessage({
    type: 'suggestions',
    scheduled: STATE.result.scheduled,
    frozen: STATE.frozen || [],
    slots: STATE.slots,
    facultyPrefs: serializedPrefs,
    weights: weights,
    targetCourseKey: targetKey,
    maxDepth: 2,
    timeoutMs: 1000,
    coursesGlobal: typeof COURSES !== 'undefined' ? COURSES : {},
  });
}

// ── Render suggestion cards ─────────────────────────────────────
function renderSuggestions(container, suggestions, item) {
  container.innerHTML = '';

  if (suggestions.length === 0) {
    container.innerHTML = '<div class="move-option" style="color: var(--light-gray);">No valid moves found</div>';
    return;
  }

  // Show up to 15 suggestions
  for (const sug of suggestions.slice(0, 15)) {
    const div = document.createElement('div');

    // Impact class
    let impactClass = 'impact-none';
    if (sug.cascade.length === 1) impactClass = 'impact-low';
    if (sug.cascade.length >= 2) impactClass = 'impact-high';

    div.className = `move-option${sug.isFreeMove ? ' best' : ''}`;

    // Score delta display
    const delta = sug.scoreDelta;
    let deltaClass = 'score-delta neutral';
    let deltaText = '0';
    if (delta < -0.5) { deltaClass = 'score-delta negative'; deltaText = delta.toFixed(1); }
    else if (delta > 0.5) { deltaClass = 'score-delta positive'; deltaText = '+' + delta.toFixed(1); }

    // Time display
    const slot = sug.targetSlot;
    const timeStr = `${slot.startTime} – ${slot.endTime}`;
    const dayStr = slot.dayPattern || '';

    // Build cascade HTML
    let cascadeHtml = '';
    if (sug.isFreeMove) {
      cascadeHtml = '<div class="cascade-summary free-move">No other courses affected</div>';
    } else {
      cascadeHtml = '<div class="cascade-list">';
      for (const c of sug.cascade) {
        const fromStr = c.fromSlot ? `${c.fromSlot.dayPattern || ''} ${c.fromSlot.startTime}` : '?';
        const toStr = c.toSlot ? `${c.toSlot.dayPattern || ''} ${c.toSlot.startTime}` : '?';
        cascadeHtml += `<div class="cascade-item">${c.code} §${c.section}: ${fromStr} → ${toStr}</div>`;
      }
      cascadeHtml += '</div>';
    }

    div.innerHTML = `
      <div class="move-header">
        <div class="move-time">${timeStr} <span style="opacity:.6">${dayStr}</span></div>
        <span class="${deltaClass}">${deltaText}</span>
      </div>
      <div class="move-impact">
        <span class="impact-indicator ${impactClass}">${sug.perturbationCount === 1 ? 'Free' : sug.perturbationCount + ' moves'}</span>
      </div>
      ${cascadeHtml}
    `;

    div.addEventListener('click', () => {
      applySuggestion(item, sug);
      closeDetailPanel();
    });

    container.appendChild(div);
  }
}

// ── Apply a suggestion (target + cascade moves) ─────────────────
function applySuggestion(item, suggestion) {
  // Apply target course move
  item.slot = suggestion.targetSlot;
  item.course.slotIndex = suggestion.targetSlot.index;

  // Apply cascade moves
  for (const cascadeMove of suggestion.cascade) {
    // Find the scheduled item matching this cascade entry
    const scheduled = STATE.result.scheduled.find(s =>
      s.course.code === cascadeMove.code && s.course.section === cascadeMove.section
    );
    if (scheduled && cascadeMove.toSlot) {
      scheduled.slot = cascadeMove.toSlot;
      scheduled.course.slotIndex = cascadeMove.toSlot.index;
    }
  }

  // Re-detect conflicts
  if (STATE.result) {
    const semesterMap = buildSemesterMap();
    const conflictGraph = buildConflictGraph(semesterMap);
    STATE.result.conflicts = detectConflicts(STATE.result.scheduled, conflictGraph);
    STATE.result.constraintReport = buildConstraintReport(STATE.result.scheduled, conflictGraph, semesterMap);
    STATE.result.studentAnalysis = buildStudentAnalysis(STATE.result.scheduled, semesterMap);
  }

  // Flash affected courses
  const affectedCodes = new Set([`${item.course.code}-${item.course.section}`]);
  for (const c of suggestion.cascade) {
    affectedCodes.add(`${c.code}-${c.section}`);
  }

  renderGrid();
  applyFilters();
  renderAnalysis();
  renderLoads();

  // Add flash animation to affected blocks
  requestAnimationFrame(() => {
    for (const block of document.querySelectorAll('.course-block')) {
      const blockKey = `${block.dataset.code}-${block.dataset.section}`;
      if (affectedCodes.has(blockKey)) {
        block.classList.add('flash');
        block.addEventListener('animationend', () => block.classList.remove('flash'), { once: true });
      }
    }
  });
}

function closeDetailPanel() {
  const panel = document.getElementById('course-detail-panel');
  if (panel) panel.classList.remove('open');
  STATE.selectedCourse = null;
}

// ── Apply filter dropdowns ──────────────────────────────────────
function applyFilters() {
  const instructor = document.getElementById('filter-instructor').value;
  const year       = document.getElementById('filter-year').value;
  const program    = document.getElementById('filter-program').value;

  const blocks = document.querySelectorAll('.course-block');
  for (const block of blocks) {
    let visible = true;

    if (instructor !== 'all' && block.dataset.instructor !== instructor) {
      if (!block.classList.contains('external')) visible = false;
    }

    if (year !== 'all') {
      const yearValues = year.split(',');
      if (!yearValues.includes(block.dataset.year) && !block.classList.contains('external')) {
        visible = false;
      }
    }

    if (program !== 'all') {
      const progs = block.dataset.programs.split(',');
      if (!progs.includes(program) && !block.classList.contains('external')) {
        visible = false;
      }
    }

    block.classList.toggle('filtered-out', !visible);
  }
}

// ── Render analysis (constraint report + student conflicts) ─────
function renderAnalysis() {
  const result = STATE.result;

  // ── Summary stats ──
  const summaryEl = document.getElementById('conflict-summary');
  if (summaryEl) {
    const studentConflicts    = result.conflicts.filter(c => c.type === 'student');
    const instructorConflicts = result.conflicts.filter(c => c.type === 'instructor');

    summaryEl.innerHTML = `
      <div class="conflict-stat ${result.conflicts.length === 0 ? 'good' : 'bad'}">
        ${result.conflicts.length === 0 ? 'No conflicts' : `${result.conflicts.length} conflict(s)`}
      </div>
      <div class="conflict-stat ${studentConflicts.length === 0 ? 'good' : 'bad'}">
        ${studentConflicts.length} student
      </div>
      <div class="conflict-stat ${instructorConflicts.length === 0 ? 'good' : 'bad'}">
        ${instructorConflicts.length} instructor
      </div>
      <div class="conflict-stat ${result.unscheduled.length === 0 ? 'good' : 'warn'}">
        ${result.unscheduled.length} unscheduled
      </div>
      <div class="conflict-stat good">
        Score: ${result.score} <span style="opacity:.6">(${result.iterations.toLocaleString()} iter)</span>
      </div>
    `;
  }

  // ── Constraint satisfaction report ──
  const reportEl = document.getElementById('constraint-cards');
  if (reportEl && result.constraintReport) {
    const cr = result.constraintReport;
    const prefPct = cr.facultyPrefMax > 0
      ? Math.round((cr.facultyPrefScore / cr.facultyPrefMax) * 100)
      : 100;

    reportEl.innerHTML = `
      <div class="constraint-card ${cr.cohortConflicts.length === 0 ? 'satisfied' : 'violated'}">
        <div class="constraint-header">
          <span class="constraint-name">Cohort Conflict Avoidance</span>
          <span class="constraint-score">${cr.cohortConflicts.length === 0 ? 'All clear' : `${cr.cohortConflicts.length} conflict(s)`}</span>
        </div>
        ${cr.cohortConflicts.length > 0 ? `
          <div class="constraint-violations">
            ${cr.cohortConflicts.slice(0, 5).map(c =>
              `<div class="violation-item">${c.courseA} / ${c.courseB} — ${c.program} Sem ${c.semester}</div>`
            ).join('')}
            ${cr.cohortConflicts.length > 5 ? `<div class="violation-item" style="opacity:.6">+ ${cr.cohortConflicts.length - 5} more</div>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="constraint-card ${prefPct >= 80 ? 'satisfied' : prefPct >= 50 ? 'partial' : 'violated'}">
        <div class="constraint-header">
          <span class="constraint-name">Faculty Preference Honoring</span>
          <span class="constraint-score">${prefPct}%</span>
        </div>
      </div>

      <div class="constraint-card ${cr.singleSectionViolations.length === 0 ? 'satisfied' : 'violated'}">
        <div class="constraint-header">
          <span class="constraint-name">Single-Section Before 2:30 PM</span>
          <span class="constraint-score">${cr.singleSectionViolations.length === 0 ? 'All clear' : `${cr.singleSectionViolations.length} violation(s)`}</span>
        </div>
        ${cr.singleSectionViolations.length > 0 ? `
          <div class="constraint-violations">
            ${cr.singleSectionViolations.map(v =>
              `<div class="violation-item">${v.course} scheduled at ${v.time}</div>`
            ).join('')}
          </div>
        ` : ''}
      </div>

      <div class="constraint-card satisfied">
        <div class="constraint-header">
          <span class="constraint-name">Back-to-Back Same-Course Sections</span>
          <span class="constraint-score">${cr.backToBackPairs.filter(p => p.status === 'achieved').length}/${cr.backToBackPairs.length} achieved</span>
        </div>
      </div>

      <div class="constraint-card ${cr.specialRuleViolations.length === 0 ? 'satisfied' : 'violated'}">
        <div class="constraint-header">
          <span class="constraint-name">Special Faculty Constraints</span>
          <span class="constraint-score">${cr.specialRuleViolations.length === 0 ? 'All met' : `${cr.specialRuleViolations.length} violation(s)`}</span>
        </div>
        ${cr.specialRuleViolations.length > 0 ? `
          <div class="constraint-violations">
            ${cr.specialRuleViolations.map(v =>
              `<div class="violation-item">${v.detail}</div>`
            ).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Student conflict analysis ──
  const studentEl = document.getElementById('cohort-grid');
  if (studentEl && result.studentAnalysis) {
    const cohorts = result.studentAnalysis.cohorts || [];
    // Sort: senior first, then by conflict count
    cohorts.sort((a, b) => b.year - a.year || b.conflicts.length - a.conflicts.length);

    studentEl.innerHTML = cohorts.map(cohort => {
      const yearLabel = YEAR_LABELS[cohort.year] || '?';
      const hasConflicts = cohort.conflicts.length > 0;
      return `
        <div class="cohort-card ${hasConflicts ? 'has-conflicts' : 'no-conflicts'}">
          <div class="cohort-header">
            <span class="cohort-year-badge tag-${yearLabel.toLowerCase()}">${yearLabel}</span>
            <span class="cohort-name">${cohort.program} Semester ${cohort.semester}</span>
            <span class="cohort-status">${hasConflicts ? `${cohort.conflicts.length} conflict(s)` : 'Clear'}</span>
          </div>
          <div class="cohort-courses">
            ${cohort.courses.map(c => {
              const label = typeof c === 'string' ? c.replace(/_/g, ' ') : (c.code || c.courseId || '').replace(/_/g, ' ');
              return `<span class="cohort-course-tag">${label}</span>`;
            }).join('')}
          </div>
          ${hasConflicts ? `
            <div class="cohort-conflicts">
              ${cohort.conflicts.map(c => {
                const a = typeof c.courseA === 'string' ? c.courseA.replace(/_/g, ' ') : (c.courseA?.code || c.courseA || '');
                const b = typeof c.courseB === 'string' ? c.courseB.replace(/_/g, ' ') : (c.courseB?.code || c.courseB || '');
                return `<div class="cohort-conflict-item">${a} overlaps ${b}</div>`;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // ── Conflict list (unscheduled + individual conflicts) ──
  const listEl = document.getElementById('conflict-list');
  if (listEl) {
    listEl.innerHTML = '';

    if (result.unscheduled.length > 0) {
      for (const c of result.unscheduled) {
        const card = document.createElement('div');
        card.className = 'conflict-card';
        const instrName = getInstructorDisplay(c);
        card.innerHTML = `
          <div class="conflict-type">Unscheduled</div>
          <div class="conflict-detail">${c.code} §${c.section} (${instrName}) — could not be placed</div>
          <div class="conflict-reason">All valid time slots blocked by hard constraints.</div>
        `;
        listEl.appendChild(card);
      }
    }

    for (const conflict of result.conflicts) {
      const card = document.createElement('div');
      card.className = 'conflict-card';
      card.innerHTML = `
        <div class="conflict-type">${conflict.type === 'student' ? 'Student Conflict' : 'Instructor Conflict'}</div>
        <div class="conflict-detail">${conflict.detail}</div>
        ${conflict.instructor ? `<div class="conflict-reason">Instructor: ${conflict.instructor}</div>` : ''}
      `;
      listEl.appendChild(card);
    }

    if (result.conflicts.length === 0 && result.unscheduled.length === 0) {
      listEl.innerHTML = '<p style="color: var(--light-blue); font-size: .85rem;">All courses scheduled without conflicts.</p>';
    }
  }
}

// ── Render faculty loads ────────────────────────────────────────
function renderLoads() {
  const loads = computeFacultyLoads(STATE.result.scheduled);
  const tbody = document.getElementById('load-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const avgCredits = loads.reduce((s, l) => s + l.credits, 0) / (loads.length || 1);

  for (const load of loads.sort((a, b) => b.credits - a.credits)) {
    const tr = document.createElement('tr');
    const creditClass = load.credits > avgCredits * 1.3 ? 'load-high' :
                        load.credits < avgCredits * 0.7 ? 'load-low' : '';

    // Compute preference satisfaction for this instructor
    let prefPct = '—';
    if (STATE.facultyPrefs && STATE.result) {
      const instrItems = STATE.result.scheduled.filter(item =>
        !item.course.isExternal && (getInstructorKey(item.course) || getInstructorDisplay(item.course)) === load.instructor
      );
      let totalPref = 0, maxPref = 0;
      for (const item of instrItems) {
        const pVal = matchFacultyPrefForSlot(item.course, item.slot);
        totalPref += Math.max(0, pVal);
        maxPref += 3; // max possible per slot
      }
      prefPct = maxPref > 0 ? `${Math.round((totalPref / maxPref) * 100)}%` : '—';
    }

    const balanceIcon = load.credits > avgCredits * 1.3 ? '&#9650;' :
                        load.credits < avgCredits * 0.7 ? '&#9660;' : '&#9644;';
    const balanceClass = load.credits > avgCredits * 1.3 ? 'load-high' :
                         load.credits < avgCredits * 0.7 ? 'load-low' : '';

    tr.innerHTML = `
      <td>${load.instructor}</td>
      <td class="${creditClass}">${load.credits}</td>
      <td>${(load.tlc || 0).toFixed(1)}</td>
      <td>${load.contactHours.toFixed(1)}</td>
      <td>${load.preps}</td>
      <td style="font-family: var(--font-mono); font-size: .65rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis;">${load.courses.join(', ')}</td>
      <td>${prefPct}</td>
      <td class="${balanceClass}">${balanceIcon}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Export CSV ──────────────────────────────────────────────────
function exportCSV() {
  if (!STATE.result) return;

  const rows = [['Course', 'Section', 'Instructor', 'Day Pattern', 'Start', 'End', 'Mode', 'Student Credits', 'Faculty Credits', 'Duration']];

  for (const item of STATE.result.scheduled) {
    if (item.course.isExternal) continue;
    rows.push([
      item.course.code,
      item.course.section,
      getFullInstructorDisplay(item.course),
      item.slot.dayPattern,
      item.slot.startTime,
      item.slot.endTime,
      item.course.mode || '',
      item.course.studentCredits || '',
      item.course.facultyCredits || '',
      item.course.duration || '',
    ]);
  }

  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'schedule.csv', 'text/csv');
}

// ── Export Excel ────────────────────────────────────────────────
function exportExcel() {
  if (!STATE.result || typeof XLSX === 'undefined') {
    alert('Excel export requires SheetJS library.');
    return;
  }

  const data = [];
  for (const item of STATE.result.scheduled) {
    if (item.course.isExternal) continue;
    data.push({
      'Course':          item.course.code,
      'Section':         item.course.section,
      'Instructor':      getFullInstructorDisplay(item.course),
      'Day Pattern':     item.slot.dayPattern,
      'Start':           item.slot.startTime,
      'End':             item.slot.endTime,
      'Mode':            item.course.mode || '',
      'Student Credits': item.course.studentCredits || '',
      'Faculty Credits': item.course.facultyCredits || '',
      'Duration':        item.course.duration || '',
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

  // Faculty loads sheet
  const loads = computeFacultyLoads(STATE.result.scheduled);
  const loadData = loads.map(l => ({
    'Instructor':       l.instructor,
    'Credit Hours':     l.credits,
    'Contact Hrs/Week': l.contactHours.toFixed(1),
    'Preps':            l.preps,
    'Courses':          l.courses.join(', '),
  }));
  const ws2 = XLSX.utils.json_to_sheet(loadData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Faculty Loads');

  // Constraint report sheet
  if (STATE.result.constraintReport) {
    const cr = STATE.result.constraintReport;
    const reportData = [
      { 'Constraint': 'Cohort Conflicts', 'Count': cr.cohortConflicts.length, 'Status': cr.cohortConflicts.length === 0 ? 'Met' : 'Violated' },
      { 'Constraint': 'Faculty Pref %', 'Count': cr.facultyPrefMax > 0 ? Math.round((cr.facultyPrefScore / cr.facultyPrefMax) * 100) : 100, 'Status': 'Score' },
      { 'Constraint': 'Single-Section Afternoon', 'Count': cr.singleSectionViolations.length, 'Status': cr.singleSectionViolations.length === 0 ? 'Met' : 'Violated' },
      { 'Constraint': 'Special Rules', 'Count': cr.specialRuleViolations.length, 'Status': cr.specialRuleViolations.length === 0 ? 'Met' : 'Violated' },
    ];
    const ws3 = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Constraint Report');
  }

  XLSX.writeFile(wb, 'schedule.xlsx');
}

// ── Download helper ─────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
