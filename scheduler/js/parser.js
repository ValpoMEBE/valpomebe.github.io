/* ╔══════════════════════════════════════════════════════════════╗
   ║  PARSER — CSV parsing for scheduler input files              ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Exports: parseCoursesCSV, parseExternalCSV, parseTimeslotsCSV
   ║  All parsers are modular — swap individual functions when    ║
   ║  the input format changes.                                   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Generic CSV parser ──────────────────────────────────────────
function parseCSVRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim());
    if (vals.length < headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j]; });
    rows.push(row);
  }
  return rows;
}

// ── Resolve course code → courses.yml ID ─────────────────────
// "ME 352" → "ME_352", "GE 100L" → "GE_100" (labs bundle)
function codeToId(code) {
  return code.replace(/\s+/g, '_').replace(/L$/, '');
}

// ── Parse "Courses to Schedule" CSV ─────────────────────────────
// Expected columns: course_code, instructor, sections, is_lab, linked_to
function parseCoursesCSV(text) {
  const rows = parseCSVRows(text);
  const courses = [];

  for (const row of rows) {
    const code = row.course_code || '';
    if (!code) continue;

    const numSections = parseInt(row.sections, 10) || 1;
    const isLab = (row.is_lab || '').toLowerCase() === 'true';
    const linkedTo = row.linked_to || '';

    for (let s = 1; s <= numSections; s++) {
      const sectionId = String(s).padStart(2, '0');
      courses.push({
        code:       code,
        courseId:    codeToId(code),
        instructor: row.instructor || 'TBD',
        section:    sectionId,
        isLab:      isLab,
        linkedTo:   linkedTo,
        locked:     false,
        slotIndex:  null,  // assigned by optimizer
      });
    }
  }

  return courses;
}

// ── Parse "External Schedule" CSV ───────────────────────────────
// Expected columns: course_code, day_pattern, start_time, end_time, section
function parseExternalCSV(text) {
  const rows = parseCSVRows(text);
  const externals = [];

  for (const row of rows) {
    const code = row.course_code || '';
    if (!code) continue;

    externals.push({
      code:       code,
      courseId:    codeToId(code),
      dayPattern: row.day_pattern || '',
      startTime:  row.start_time || '',
      endTime:    row.end_time || '',
      section:    row.section || '01',
    });
  }

  return externals;
}

// ── Parse "Time Slots" CSV ──────────────────────────────────────
// Expected columns: slot_type, day_pattern, start_time, end_time
function parseTimeslotsCSV(text) {
  const rows = parseCSVRows(text);
  const slots = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    slots.push({
      index:      i,
      type:       (row.slot_type || 'class').toLowerCase(),
      dayPattern: row.day_pattern || '',
      startTime:  row.start_time || '',
      endTime:    row.end_time || '',
      days:       expandDayPattern(row.day_pattern || ''),
    });
  }

  return slots;
}

// ── Expand day pattern to array of day indices ──────────────────
// M=0, T=1, W=2, R=3, F=4
function expandDayPattern(pattern) {
  const map = { M: 0, T: 1, W: 2, R: 3, F: 4 };
  const days = [];
  for (const ch of pattern.toUpperCase()) {
    if (map[ch] !== undefined) days.push(map[ch]);
  }
  return days;
}

// ── Time utilities ──────────────────────────────────────────────
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Check if two time ranges overlap on any shared day
function timesOverlap(days1, start1, end1, days2, start2, end2) {
  const sharedDays = days1.filter(d => days2.includes(d));
  if (sharedDays.length === 0) return false;
  const s1 = timeToMinutes(start1), e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2), e2 = timeToMinutes(end2);
  return s1 < e2 && s2 < e1;
}
