/* ╔══════════════════════════════════════════════════════════════╗
   ║  TRANSCRIPT PARSER                                          ║
   ║  Extracts course data from DataVU transcript PDFs           ║
   ║  using pdf.js (client-side only — no server upload)         ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Grade definitions ──────────────────────────────────────────
const GRADE_POINTS = {
  'A':  4.0, 'A-': 3.7,
  'B+': 3.3, 'B':  3.0, 'B-': 2.7,
  'C+': 2.3, 'C':  2.0, 'C-': 1.7,
  'D+': 1.3, 'D':  1.0, 'D-': 0.7,
  'F':  0.0
};
const NON_GPA_GRADES = ['TR', 'CR', 'W', 'U', ''];
const ALL_GRADES = Object.keys(GRADE_POINTS).concat(NON_GPA_GRADES);

// Regex to match a grade token (longest-first so A- matches before A)
// Trailing lookahead (?![+\-\w]) prevents matching "B" when "B+" follows
const GRADE_RE = /\b(A-|B\+|B-|C\+|C-|D\+|D-|TR|CR|A|B|C|D|F|W|U)(?![+\-\w])/;

// ── Configure pdf.js worker ────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── PDF text extraction ────────────────────────────────────────
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = reconstructLines(content.items);
    allLines.push(...lines);
  }
  return allLines;
}

/**
 * Reconstruct lines from pdf.js text items using y-coordinate grouping.
 * Items on the same row (within tolerance) are sorted by x and joined.
 */
function reconstructLines(items) {
  if (!items.length) return [];

  // Group items by y-coordinate (bucket by tolerance)
  const rows = {};
  const Y_TOLERANCE = 3;

  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
    const x = item.transform[4];
    if (!rows[y]) rows[y] = [];
    rows[y].push({ x, text: item.str });
  }

  // Sort rows by y descending (PDF coordinates are bottom-up)
  return Object.entries(rows)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, items]) =>
      items.sort((a, b) => a.x - b.x)
        .map(i => i.text)
        .join(' ')
    );
}

// ── Line parsing ───────────────────────────────────────────────
// Match course lines: starts with dept code (2-4 uppercase) + number (1-4 digits + optional letter)
const COURSE_LINE_RE = /^([A-Z]{2,4})\s+(\d{1,4}[A-Z]?)\s+(.+)/;

// Lines to skip (AP lines are exam scores, not real courses)
const SKIP_RE = /^(Course Title|Hrs |------|.*Totals:|Cumulative|Page \d|Valparaiso University|AP |^\s*$)/i;
const DATE_RE = /(\d{2}\/\d{2}\/\d{2})-(\d{2}\/\d{2}\/\d{2})/;

function parseTranscriptLines(lines) {
  const entries = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || SKIP_RE.test(line)) continue;

    const match = line.match(COURSE_LINE_RE);
    if (!match) continue;

    const dept = match[1];
    const num  = match[2];
    const rest = match[3];

    // Skip summary-type entries like "TR UND", "GE UND", "ME UND"
    if (num === 'UND') continue;

    // Extract grade — use the LAST grade token before the numeric columns
    // to avoid matching grade-like letters inside course titles (e.g. "Trigonometry and F")
    // IP courses have no numeric columns at all, so no grade to extract
    const numColIdx = rest.search(/\d+\.\d{2}/);
    let gradeMatch = null;
    let grade = '';
    if (numColIdx > 0) {
      const gradeArea = rest.slice(0, numColIdx);
      const gradeMatches = [...gradeArea.matchAll(new RegExp(GRADE_RE, 'g'))];
      gradeMatch = gradeMatches.length > 0 ? gradeMatches[gradeMatches.length - 1] : null;
      grade = gradeMatch ? gradeMatch[1] : '';
    }

    // Check for repeat flag (R after grade)
    const isRepeat = gradeMatch
      ? /\bR\b/.test(rest.slice(gradeMatch.index + gradeMatch[0].length, gradeMatch.index + gradeMatch[0].length + 4))
      : false;

    // Extract credits — first number is attempted hours, second is completed hours
    // For TR/CR grades, attempted=0 so use completed (second number) instead
    let credits = 0;
    const numbersInRest = rest.match(/\d+\.\d{2}/g);
    if (numbersInRest && numbersInRest.length >= 1) {
      if ((grade === 'TR' || grade === 'CR') && numbersInRest.length >= 2) {
        credits = parseFloat(numbersInRest[1]); // completed hours
      } else {
        credits = parseFloat(numbersInRest[0]); // attempted hours
      }
    }

    // Extract date range
    const dateMatch = rest.match(DATE_RE);
    let endDate = null;
    if (dateMatch) {
      const parts = dateMatch[2].split('/');
      endDate = new Date(2000 + parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    }

    // Extract title (text between number and grade/numbers area)
    let title = '';
    if (gradeMatch) {
      title = rest.slice(0, gradeMatch.index).trim();
    } else {
      // No grade found — take text before first number
      const numIdx = rest.search(/\d+\.\d{2}/);
      title = numIdx > 0 ? rest.slice(0, numIdx).trim() : rest.trim();
    }
    // Strip date range (e.g. "08/22/25-12/10/25") from title
    title = title.replace(DATE_RE, '').trim();

    entries.push({
      dept,
      num,
      code: dept + ' ' + num,
      title,
      grade,
      credits,
      isRepeat,
      endDate,
    });
  }

  return entries;
}

// ── Retake resolution ──────────────────────────────────────────
function resolveRetakes(entries) {
  // Group by course code
  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.code]) grouped[e.code] = [];
    grouped[e.code].push(e);
  }

  const resolved = [];
  for (const [code, attempts] of Object.entries(grouped)) {
    // Sort by end date descending (most recent first)
    attempts.sort((a, b) => (b.endDate || 0) - (a.endDate || 0));

    // Find best result: prefer passing grade, then most recent
    const passing = attempts.find(a =>
      a.grade && a.grade !== 'W' && a.grade !== 'F' && a.grade !== 'U'
    );

    // If only W grades exist, skip — student still needs this course
    const active = passing || attempts[0];
    if (active.grade === 'W') continue;

    resolved.push({
      code,
      active,
      attempts,
      hasRetakes: attempts.length > 1,
    });
  }

  return resolved;
}

// ── Determine course status ────────────────────────────────────
function getCourseStatus(grade) {
  if (!grade || grade === '') return 'no-grade';
  if (grade === 'TR' || grade === 'CR') return 'transfer';
  if (grade === 'U')  return 'no-grade';
  if (grade === 'F')  return 'failed';
  if (grade === 'D-') return 'completed'; // D- is technically passing
  return 'completed';
}

function isPassingGrade(grade) {
  return grade && grade !== 'W' && grade !== 'F' && grade !== 'U' && grade !== '';
}
