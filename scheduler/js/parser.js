/* ╔══════════════════════════════════════════════════════════════╗
   ║  PARSER — CSV parsing for scheduler input files              ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Input files:                                                ║
   ║    1. Master Course CSV  — all courses (dept + external)     ║
   ║    2. Time Slots CSV     — Format/Days/Start/End             ║
   ║    3. Faculty Prefs CSV  — per-faculty time preferences      ║
   ║                                                              ║
   ║  Globals: parseCSVRows, parseMasterCSV, parseTimeslotsCSV,   ║
   ║    parseFacultyPrefsCSV, expandDayPattern, normalizeTime,    ║
   ║    timeToMinutes, minutesToTime, timesOverlap, codeToId,     ║
   ║    instructorKey                                             ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Generic CSV parser (handles quoted fields) ────────────────
function parseCSVRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = _splitCSVLine(lines[0]).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = _splitCSVLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// Split a single CSV line respecting double-quoted fields
function _splitCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── Resolve course code → ID ──────────────────────────────────
// "ME-355" → "ME_355", "GE-100L" → "GE_100" (labs bundle with lecture)
// "PHYS-141" → "PHYS_141"
function codeToId(code) {
  return code.replace(/-/g, '_').replace(/L$/, '');
}

// ── Normalize 12h-ish time to 24h "HH:MM" ────────────────────
// Rule: hour <= 6 → PM (add 12). hour >= 7 → AM as-is.
// Exception: 12:xx stays as 12.
function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const str = timeStr.trim();
  if (!str) return '';

  const parts = str.split(':');
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;

  if (isNaN(h)) return '';

  // If already in clear 24h (e.g., "13:20", "17:00"), keep as-is
  if (h > 12) {
    // already 24h
  } else if (h === 12) {
    // 12:xx stays as 12 (noon)
  } else if (h <= 6) {
    // 1:20 → 13:20, 2:30 → 14:30, 5:00 → 17:00
    h += 12;
  }
  // h >= 7 and h < 12 → AM, no change

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Expand day pattern to array of day indices ────────────────
// M=0, T=1, W=2, R=3, F=4
// Handles: "MWF", "TR", "MTWRF", "MW", "MTWF", "M", single days
function expandDayPattern(pattern) {
  if (!pattern) return [];
  const map = { M: 0, T: 1, W: 2, R: 3, F: 4 };
  const days = [];
  for (const ch of pattern.toUpperCase()) {
    if (map[ch] !== undefined) days.push(map[ch]);
  }
  return days;
}

// ── Instructor key for comparison ─────────────────────────────
// Creates a stable string key from an instructors array
function instructorKey(instructors) {
  if (!instructors || instructors.length === 0) return '';
  return instructors
    .filter(i => i.last && i.last.toLowerCase() !== 'staff')
    .map(i => `${i.last}${i.first ? '_' + i.first : ''}`)
    .sort()
    .join('+');
}

// ── Time utilities ────────────────────────────────────────────
function timeToMinutes(timeStr) {
  const norm = normalizeTime(timeStr);
  if (!norm) return 0;
  const [h, m] = norm.split(':').map(Number);
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

// ── Parse Master Course CSV ───────────────────────────────────
// Columns: Course, Section, Term, Instructor1_Last, Instructor1_First,
//   Instructor2_Last, Instructor2_First, Duration, Pair_Group, Days,
//   Start, End, Student_Credits, Faculty_Credits, Pct_Load, Mode, Alt_Weeks
//
// Returns { courses: [...], frozen: [...] }
//   courses[] — needs scheduling (Start/End empty)
//   frozen[]  — pre-scheduled (Start AND End filled)
function parseMasterCSV(text) {
  const rows = parseCSVRows(text);
  const courses = [];
  const frozen = [];

  for (const row of rows) {
    const code = row['Course'] || '';
    if (!code) continue;

    // Build instructors array
    const instructors = [];
    const i1Last = row['Instructor1_Last'] || '';
    const i1First = row['Instructor1_First'] || '';
    if (i1Last) {
      instructors.push({ last: i1Last, first: i1First });
    }
    const i2Last = row['Instructor2_Last'] || '';
    const i2First = row['Instructor2_First'] || '';
    if (i2Last) {
      instructors.push({ last: i2Last, first: i2First });
    }

    const section = row['Section'] || '01';
    const term = row['Term'] || '';
    const duration = row['Duration'] || '14 weeks';
    const pairGroup = row['Pair_Group'] || '';
    const dayPattern = row['Days'] || '';
    const mode = row['Mode'] || '';
    const altWeeks = (row['Alt_Weeks'] || '').toLowerCase() === 'yes';
    const studentCredits = parseFloat(row['Student_Credits']) || 0;
    const facultyCredits = parseFloat(row['Faculty_Credits']) || 0;
    const pctLoad = parseFloat(row['Pct_Load']) || 0;

    const tlcRaw = row['TLC'] || '';
    const tlc = tlcRaw ? parseFloat(tlcRaw) : null;
    const timePref = (row['Time_Pref'] || '').trim() || null;

    const isLab = /L$/.test(code);
    const linkedTo = isLab ? code.replace(/L$/, '') : '';
    const courseId = codeToId(code);

    const startRaw = row['Start'] || '';
    const endRaw = row['End'] || '';

    if (startRaw && endRaw) {
      // Frozen: pre-scheduled, not moved by optimizer
      frozen.push({
        code:           code,
        courseId:        courseId,
        section:        section,
        term:           term,
        instructors:    instructors,
        dayPattern:     dayPattern,
        startTime:      normalizeTime(startRaw),
        endTime:        normalizeTime(endRaw),
        days:           expandDayPattern(dayPattern),
        duration:       duration,
        mode:           mode,
        studentCredits: studentCredits,
        tlc:            tlc,
      });
    } else {
      // Needs scheduling
      courses.push({
        code:           code,
        courseId:        courseId,
        section:        section,
        term:           term,
        instructors:    instructors,
        duration:       duration,
        pairGroup:      pairGroup,
        dayPattern:     dayPattern,
        days:           expandDayPattern(dayPattern),
        mode:           mode,
        altWeeks:       altWeeks,
        studentCredits: studentCredits,
        facultyCredits: facultyCredits,
        pctLoad:        pctLoad,
        locked:         false,
        slotIndex:      null,
        isLab:          isLab,
        linkedTo:       linkedTo,
        tlc:            tlc,
        timePref:       timePref,
      });
    }
  }

  return { courses, frozen };
}

// ── Parse Time Slots CSV ──────────────────────────────────────
// Columns: Format, Days, Start, End
// Returns slots[] with { index, format, dayPattern, startTime, endTime, days }
function parseTimeslotsCSV(text) {
  const rows = parseCSVRows(text);
  const slots = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dayPattern = row['Days'] || '';
    slots.push({
      index:      i,
      format:     row['Format'] || '',
      dayPattern: dayPattern,
      startTime:  normalizeTime(row['Start'] || ''),
      endTime:    normalizeTime(row['End'] || ''),
      days:       expandDayPattern(dayPattern),
    });
  }

  return slots;
}

// ── Parse Faculty Preferences CSV ─────────────────────────────
// Columns: Faculty, Format, Day, Start, End, Preference
// Returns { preferences: Map<faculty, [{format, day, start, end, pref}]>,
//           specialRules: [{faculty, rule}] }
//
// When Format="special", Day/Start/End are empty and Preference holds rule text.
// Normal rows: Preference is a number -3 to +3.
function parseFacultyPrefsCSV(text) {
  const rows = parseCSVRows(text);
  const preferences = new Map();
  const specialRules = [];

  for (const row of rows) {
    const faculty = row['Faculty'] || '';
    if (!faculty) continue;

    const format = row['Format'] || '';

    if (format.toLowerCase() === 'special') {
      // Special rule — preference column holds free text
      specialRules.push({
        faculty: faculty,
        rule:    row['Preference'] || '',
      });
      continue;
    }

    // Normal preference entry
    const entry = {
      format: format,
      day:    row['Day'] || '',
      start:  normalizeTime(row['Start'] || ''),
      end:    normalizeTime(row['End'] || ''),
      pref:   parseInt(row['Preference'], 10) || 0,
    };

    if (!preferences.has(faculty)) {
      preferences.set(faculty, []);
    }
    preferences.get(faculty).push(entry);
  }

  return { preferences, specialRules };
}
