/* ╔══════════════════════════════════════════════════════════════╗
   ║  SCHEDULER UI — Upload, grid rendering, filters, export      ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Depends on: parser.js, optimizer.js, COURSES global         ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── State ───────────────────────────────────────────────────────
let STATE = {
  deptCourses:  null,  // parsed from courses CSV
  externals:    null,  // parsed from external CSVs (combined)
  slots:        null,  // parsed from timeslots CSV
  result:       null,  // optimizer output
  activeDay:    0,     // which day tab is selected (0-4, or 'all')
  showExternals: false, // dept-only vs all courses
};

const GRID_START_HOUR = 7;   // 7:00 AM
const GRID_END_HOUR   = 18;  // 6:00 PM
const PIXELS_PER_MIN  = 1.8; // vertical scale

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const INSTRUCTOR_COLORS = new Map();
let colorIndex = 0;

function getInstructorColor(name) {
  if (!INSTRUCTOR_COLORS.has(name)) {
    INSTRUCTOR_COLORS.set(name, colorIndex % 8);
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
  const minSem = Math.min(...sems);
  return semToYear(minSem);
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

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // File upload handlers
  document.getElementById('file-courses').addEventListener('change', handleCoursesUpload);
  document.getElementById('file-externals').addEventListener('change', handleExternalsUpload);
  document.getElementById('file-timeslots').addEventListener('change', handleTimeslotsUpload);

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
});

// ── File upload handlers ────────────────────────────────────────
function handleCoursesUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(text => {
    STATE.deptCourses = parseCoursesCSV(text);
    const el = document.getElementById('status-courses');
    el.textContent = `${file.name} — ${STATE.deptCourses.length} course-sections`;
    el.classList.add('loaded');
    checkReady();
  });
}

function handleExternalsUpload(e) {
  const files = e.target.files;
  if (!files.length) return;
  STATE.externals = [];
  let loaded = 0;
  for (const file of files) {
    file.text().then(text => {
      STATE.externals.push(...parseExternalCSV(text));
      loaded++;
      if (loaded === files.length) {
        const el = document.getElementById('status-externals');
        el.textContent = `${files.length} file(s) — ${STATE.externals.length} external sections`;
        el.classList.add('loaded');
        checkReady();
      }
    });
  }
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

function checkReady() {
  const ready = STATE.deptCourses && STATE.externals && STATE.slots;
  document.getElementById('btn-generate').disabled = !ready;
}

// ── Load sample data ────────────────────────────────────────────
async function loadSampleData() {
  const base = document.querySelector('meta[name="baseurl"]')?.content ||
               (location.pathname.startsWith('/dev') ? '/dev' : '');
  try {
    const [coursesText, mathText, physText, slotsText] = await Promise.all([
      fetch(`${base}/scheduler/sample-data/courses-to-schedule.csv`).then(r => r.text()),
      fetch(`${base}/scheduler/sample-data/external-math.csv`).then(r => r.text()),
      fetch(`${base}/scheduler/sample-data/external-physics.csv`).then(r => r.text()),
      fetch(`${base}/scheduler/sample-data/timeslots.csv`).then(r => r.text()),
    ]);

    STATE.deptCourses = parseCoursesCSV(coursesText);
    STATE.externals   = [...parseExternalCSV(mathText), ...parseExternalCSV(physText)];
    STATE.slots       = parseTimeslotsCSV(slotsText);

    document.getElementById('status-courses').textContent = `Sample — ${STATE.deptCourses.length} course-sections`;
    document.getElementById('status-courses').classList.add('loaded');
    document.getElementById('status-externals').textContent = `Sample — ${STATE.externals.length} external sections`;
    document.getElementById('status-externals').classList.add('loaded');
    document.getElementById('status-timeslots').textContent = `Sample — ${STATE.slots.length} slots`;
    document.getElementById('status-timeslots').classList.add('loaded');

    checkReady();
  } catch (err) {
    console.error('Failed to load sample data:', err);
    alert('Could not load sample data. Make sure the dev server is running.');
  }
}

// ── Run optimizer ───────────────────────────────────────────────
function runOptimizer() {
  if (!STATE.deptCourses || !STATE.externals || !STATE.slots) return;

  const t0 = performance.now();
  STATE.result = optimizeSchedule(STATE.deptCourses, STATE.externals, STATE.slots);
  const dt = (performance.now() - t0).toFixed(1);

  console.log(`Optimizer: ${dt}ms, ${STATE.result.iterations} iterations, score=${STATE.result.score}`);

  // Show result sections
  document.getElementById('scheduler-results').hidden = false;
  document.getElementById('scheduler-conflicts').hidden = false;
  document.getElementById('scheduler-loads').hidden = false;

  // Populate instructor filter
  populateInstructorFilter();

  // Render
  renderGrid();
  renderConflicts();
  renderLoads();
}

// ── Populate instructor dropdown ────────────────────────────────
function populateInstructorFilter() {
  const select = document.getElementById('filter-instructor');
  const instructors = new Set();
  for (const item of STATE.result.scheduled) {
    if (!item.course.isExternal) instructors.add(item.course.instructor);
  }
  select.innerHTML = '<option value="all">All</option>';
  for (const name of [...instructors].sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

// ── Render weekly grid ──────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('weekly-grid');
  grid.innerHTML = '';

  const singleDay = STATE.activeDay !== 'all';
  const daysToShow = singleDay ? [STATE.activeDay] : [0, 1, 2, 3, 4];

  // Set grid mode
  grid.classList.toggle('single-day', singleDay);
  if (!singleDay) {
    grid.style.gridTemplateColumns = `60px repeat(5, 1fr)`;
  } else {
    grid.style.gridTemplateColumns = `70px 1fr`;
  }

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
      for (let i = 0; i < c.courses.length; i++) {
        conflictSet.add(`${c.courses[i]}-${c.sections[i]}`);
      }
    }
  }

  // Day columns
  for (const d of daysToShow) {
    const col = document.createElement('div');
    col.className = 'grid-day-col';
    col.style.position = 'relative';
    col.style.height = `${colHeight}px`;

    // Hour grid lines
    for (let h = GRID_START_HOUR; h <= GRID_END_HOUR; h++) {
      const line = document.createElement('div');
      line.className = `grid-line${h !== GRID_START_HOUR ? ' hour' : ''}`;
      line.style.top = `${(h - GRID_START_HOUR) * 60 * pxPerMin}px`;
      col.appendChild(line);
    }
    // Half-hour lines
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
      const line = document.createElement('div');
      line.className = 'grid-line';
      line.style.top = `${((h - GRID_START_HOUR) * 60 + 30) * pxPerMin}px`;
      col.appendChild(line);
    }

    // Place course blocks
    if (STATE.result) {
      for (const item of STATE.result.scheduled) {
        if (!item.slot.days.includes(d)) continue;

        // Dept-only toggle: skip externals if showExternals is false
        if (!STATE.showExternals && item.course.isExternal) continue;

        const block = createCourseBlock(item, conflictSet);
        const startMin = timeToMinutes(item.slot.startTime) - GRID_START_HOUR * 60;
        const endMin   = timeToMinutes(item.slot.endTime) - GRID_START_HOUR * 60;
        const height   = (endMin - startMin) * pxPerMin;

        block.style.top    = `${startMin * pxPerMin}px`;
        block.style.height = `${height}px`;

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
  const colorClass = `color-${getInstructorColor(c.instructor)}`;
  block.className = `course-block ${colorClass}`;

  if (c.isExternal) block.classList.add('external');
  if (c.locked && !c.isExternal) block.classList.add('locked');

  const key = `${c.code}-${c.section}`;
  if (conflictSet.has(key)) block.classList.add('conflict');

  // Data attributes for filtering
  const year = getYearLevel(c.courseId);
  const progs = getPrograms(c.courseId);
  block.dataset.instructor = c.instructor;
  block.dataset.year = year || '';
  block.dataset.programs = progs.join(',');
  block.dataset.code = c.code;
  block.dataset.section = c.section;

  // Content
  block.innerHTML = `
    <div class="block-code">${c.code} §${c.section}</div>
    <div class="block-instructor">${c.instructor}</div>
    <div class="block-time">${item.slot.startTime}–${item.slot.endTime}</div>
    <div class="block-tags">
      ${year ? `<span class="block-tag ${YEAR_TAG_CLASS[year]}">${YEAR_LABELS[year]}</span>` : ''}
      ${[...new Set(progs.map(getProgramLabel))].map(label =>
        `<span class="block-tag ${getProgramTag(progs.find(p => getProgramLabel(p) === label))}">${label}</span>`
      ).join('')}
    </div>
  `;

  // Click to lock/unlock (not external)
  if (!c.isExternal) {
    block.addEventListener('click', () => toggleLock(c, block));
  }

  return block;
}

// ── Toggle lock on a course ─────────────────────────────────────
function toggleLock(course, blockEl) {
  course.locked = !course.locked;
  blockEl.classList.toggle('locked', course.locked);
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
      // Always show external courses regardless of instructor filter
      if (!block.classList.contains('external')) visible = false;
    }

    if (year !== 'all' && block.dataset.year !== year) {
      if (!block.classList.contains('external')) visible = false;
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

// ── Render conflict report ──────────────────────────────────────
function renderConflicts() {
  const result = STATE.result;
  const summaryEl = document.getElementById('conflict-summary');
  const listEl    = document.getElementById('conflict-list');

  const studentConflicts    = result.conflicts.filter(c => c.type === 'student');
  const instructorConflicts = result.conflicts.filter(c => c.type === 'instructor');

  // Summary stats
  summaryEl.innerHTML = `
    <div class="conflict-stat ${result.conflicts.length === 0 ? 'good' : 'bad'}">
      ${result.conflicts.length === 0 ? 'No conflicts' : `${result.conflicts.length} conflict(s)`}
    </div>
    <div class="conflict-stat ${studentConflicts.length === 0 ? 'good' : 'bad'}">
      ${studentConflicts.length} student conflict(s)
    </div>
    <div class="conflict-stat ${instructorConflicts.length === 0 ? 'good' : 'bad'}">
      ${instructorConflicts.length} instructor conflict(s)
    </div>
    <div class="conflict-stat ${result.unscheduled.length === 0 ? 'good' : 'warn'}">
      ${result.unscheduled.length} unscheduled course(s)
    </div>
    <div class="conflict-stat good">
      Score: ${result.score} (${result.iterations.toLocaleString()} iterations)
    </div>
  `;

  // Conflict cards
  listEl.innerHTML = '';

  if (result.unscheduled.length > 0) {
    for (const c of result.unscheduled) {
      const card = document.createElement('div');
      card.className = 'conflict-card';
      card.innerHTML = `
        <div class="conflict-type">Unscheduled</div>
        <div class="conflict-detail">${c.code} §${c.section} (${c.instructor}) — could not be placed in any available slot</div>
        <div class="conflict-reason">All valid time slots are blocked by hard constraints.</div>
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

// ── Render faculty loads ────────────────────────────────────────
function renderLoads() {
  const loads = computeFacultyLoads(STATE.result.scheduled);
  const tbody = document.getElementById('load-tbody');
  tbody.innerHTML = '';

  const avgCredits = loads.reduce((s, l) => s + l.credits, 0) / (loads.length || 1);

  for (const load of loads.sort((a, b) => b.credits - a.credits)) {
    const tr = document.createElement('tr');
    const creditClass = load.credits > avgCredits * 1.3 ? 'load-high' :
                        load.credits < avgCredits * 0.7 ? 'load-low' : '';
    tr.innerHTML = `
      <td>${load.instructor}</td>
      <td class="${creditClass}">${load.credits}</td>
      <td>${load.contactHours.toFixed(1)}</td>
      <td>${load.preps}</td>
      <td style="font-family: var(--font-mono); font-size: .7rem;">${load.courses.join(', ')}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Export CSV ──────────────────────────────────────────────────
function exportCSV() {
  if (!STATE.result) return;

  const rows = [['Course', 'Section', 'Instructor', 'Day Pattern', 'Start', 'End', 'Is Lab', 'Credits']];

  for (const item of STATE.result.scheduled) {
    if (item.course.isExternal) continue;
    const info = item.info;
    rows.push([
      item.course.code,
      item.course.section,
      item.course.instructor,
      item.slot.dayPattern,
      item.slot.startTime,
      item.slot.endTime,
      item.course.isLab ? 'Yes' : 'No',
      info ? info.credits : '',
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
    const info = item.info;
    data.push({
      'Course':       item.course.code,
      'Section':      item.course.section,
      'Instructor':   item.course.instructor,
      'Day Pattern':  item.slot.dayPattern,
      'Start':        item.slot.startTime,
      'End':          item.slot.endTime,
      'Is Lab':       item.course.isLab ? 'Yes' : 'No',
      'Credits':      info ? info.credits : '',
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
