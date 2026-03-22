/* ╔══════════════════════════════════════════════════════════════╗
   ║  TRANSCRIPT AUDIT ENGINE                                    ║
   ║  Cross-references parsed transcript data against            ║
   ║  courses.yml and renders the audit results.                 ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── State ──────────────────────────────────────────────────────
let AUDIT_STATE = {
  program: 'ME',
  file: null,
  // Stored after parsing so we can re-audit on program change
  lastMatched: null,
  lastUnmatched: null,
  lastCodeIndex: null,
};

// ── Course code aliases (transcript → courses.yml id) ──────────
const CODE_ALIASES = {
  'CORE 110':  'VUE_101',
  'CORE 115':  'VUE_102',
  'CORE 120':  'VUE_101',  // fallback
  'GE 100L':   'GE_100',   // lab bundled with GE 100
  'PHYS 141L': 'PHYS_141', // lab bundled
  'PHYS 142L': 'PHYS_142', // lab bundled
  'CHEM 121L': 'CHEM_121', // lab bundled
  'CHEM 122L': 'CHEM_122',
  'CHEM 221L': 'CHEM_221',
  'CHEM 222L': 'CHEM_222',
};

// ── Elective group definitions ─────────────────────────────────
// Each group maps placeholder IDs → a combined card with tally
const ELECTIVE_GROUPS = {
  ME: [
    {
      key: 'me_elec',
      label: 'ME Electives',
      ids: ['ME_ELEC_1', 'ME_ELEC_2', 'ME_ELEC_3', 'ME_ELEC_4'],
      totalCredits: 12,
      approvedLists: ['me_electives'],
      blanketDepts: [], checkWorldLang: false,
    },
    {
      key: 'me_humssrs',
      label: 'Hum / SS / RS',
      ids: ['ME_HUM_1', 'ME_HUM_2'],
      totalCredits: 6,
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC'],
    },
  ],
  BE_Biomech: [
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S5_BM', 'BE_ELEC_S6_BM', 'BE_ELEC_S7_BM', 'BE_ELEC_S8_1', 'BE_ELEC_S8_2', 'BE_ELEC_S8_3'],
      totalCredits: 18,
      approvedLists: ['be_electives'],
      blanketDepts: [],
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      totalCredits: 6,
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC'],
    },
  ],
  BE_Bioelec: [
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S5_BD', 'BE_ELEC_S6_BE', 'BE_ELEC_S7_BE', 'BE_ELEC_S8_1', 'BE_ELEC_S8_2', 'BE_ELEC_S8_3'],
      totalCredits: 18,
      approvedLists: ['be_electives'],
      blanketDepts: [],
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      totalCredits: 6,
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC'],
    },
  ],
  BE_Biomed: [
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S5_BD', 'BE_ListA_BD_S6', 'BE_ELEC_S7_BD', 'BE_ELEC_S8_1', 'BE_ELEC_S8_2', 'BE_ELEC_S8_3'],
      totalCredits: 18,
      approvedLists: ['be_electives'],
      blanketDepts: [],
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      totalCredits: 6,
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC'],
    },
  ],
};

// ── Build lookup index from COURSES_ARRAY ──────────────────────
function buildCodeIndex() {
  const index = {};
  for (const c of COURSES_ARRAY) {
    const normalized = c.code.replace(/\s+/g, '_').replace(/\//g, '_');
    index[c.code.toUpperCase()] = c.id;
    index[normalized.toUpperCase()] = c.id;

    // Handle "BE/ME 317" — also index as "BE 317" and "ME 317"
    if (c.code.includes('/')) {
      const parts = c.code.split('/');
      const num = parts[parts.length - 1].match(/\d+[A-Z]?$/);
      if (num) {
        for (const part of parts) {
          const dept = part.replace(/\s*\d+[A-Z]?$/, '').trim();
          if (dept) index[(dept + ' ' + num[0]).toUpperCase()] = c.id;
        }
      }
    }
  }

  // Add manual aliases
  for (const [code, id] of Object.entries(CODE_ALIASES)) {
    index[code.toUpperCase()] = id;
  }

  return index;
}

// ── Build approved-code sets from ELECTIVE_DATA ────────────────
function buildApprovedSet(listKeys) {
  const codes = new Set();
  for (const key of listKeys) {
    const list = ELECTIVE_DATA[key];
    if (!list) continue;
    for (const item of list) {
      codes.add(item.code.toUpperCase());
    }
  }
  return codes;
}

const WL_DEPTS = ['CHIN', 'FREN', 'GER', 'SPAN', 'JAPN', 'ARAB', 'LAT', 'GRK'];

function isApprovedElective(code, approvedSet, blanketDepts, checkWorldLang) {
  const upper = code.toUpperCase();
  if (approvedSet.has(upper)) return true;

  const parts = upper.split(/\s+/);
  if (parts.length < 2) return false;

  // Blanket department match
  if (blanketDepts.includes(parts[0])) {
    // Special case: PHIL except 145
    if (parts[0] === 'PHIL' && parts[1] === '145') return false;
    return true;
  }

  // World language: any 102+ level (only when explicitly requested)
  if (checkWorldLang && WL_DEPTS.includes(parts[0]) && parseInt(parts[1]) >= 102) {
    return true;
  }

  return false;
}

// ── Match transcript courses to degree requirements ────────────
function matchCourses(resolvedCourses, codeIndex) {
  const matched = [];
  const unmatched = [];

  for (const rc of resolvedCourses) {
    const key = rc.code.toUpperCase();
    const normalizedKey = key.replace(/\s+/g, '_');
    const id = codeIndex[key] || codeIndex[normalizedKey];

    if (id && COURSES[id]) {
      matched.push({ ...rc, courseId: id, courseData: COURSES[id] });
    } else {
      unmatched.push(rc);
    }
  }

  return { matched, unmatched };
}

// ── Compute audit results ──────────────────────────────────────
function computeAudit(matched, program, codeIndex, unmatched) {
  const required = COURSES_ARRAY.filter(c => c.semesters && c.semesters[program]);

  const completedIds = new Set();
  const courseGrades = {};
  const courseStatuses = {};

  for (const m of matched) {
    const status = getCourseStatus(m.active.grade);
    if (status === 'completed' || status === 'transfer') {
      completedIds.add(m.courseId);
    }
    courseGrades[m.courseId] = m.active.grade;
    courseStatuses[m.courseId] = status;
  }

  // Determine which IDs belong to elective groups
  const groups = ELECTIVE_GROUPS[program] || [];
  const groupedIds = new Set();
  for (const g of groups) {
    for (const id of g.ids) groupedIds.add(id);
  }

  // ── Phase 1: Fill grouped elective cards FIRST ───────────────
  // Groups get priority so they can claim courses before single placeholders
  const usedForGroups = new Set(); // track transcript courses used for group filling
  const groupCards = [];

  for (const g of groups) {
    const approvedSet = buildApprovedSet(g.approvedLists);
    const filledCourses = [];
    let creditsFilled = 0;

    // Check matched courses that aren't already used for required slots
    for (const m of matched) {
      if (usedForGroups.has(m.code) || completedIds.has(m.courseId)) continue;
      const status = getCourseStatus(m.active.grade);
      if (status !== 'completed' && status !== 'transfer') continue;

      if (isApprovedElective(m.code, approvedSet, g.blanketDepts, g.checkWorldLang)) {
        filledCourses.push({ code: m.code, grade: m.active.grade, credits: m.active.credits || 3 });
        creditsFilled += m.active.credits || 3;
        usedForGroups.add(m.code);
        if (creditsFilled >= g.totalCredits) break;
      }
    }

    // Also scan unmatched courses (not in courses.yml but on approved lists)
    if (creditsFilled < g.totalCredits && unmatched) {
      for (const u of unmatched) {
        if (usedForGroups.has(u.code) || completedIds.has('unmatched:' + u.code)) continue;
        const status = getCourseStatus(u.active.grade);
        if (status !== 'completed' && status !== 'transfer') continue;

        if (isApprovedElective(u.code, approvedSet, g.blanketDepts, g.checkWorldLang)) {
          filledCourses.push({ code: u.code, grade: u.active.grade, credits: u.active.credits || 3 });
          creditsFilled += u.active.credits || 3;
          usedForGroups.add(u.code);
          if (creditsFilled >= g.totalCredits) break;
        }
      }
    }

    // Determine the earliest semester for this group's placeholders
    let earliestSem = 99;
    for (const id of g.ids) {
      const course = COURSES[id];
      if (course && course.semesters && course.semesters[program]) {
        earliestSem = Math.min(earliestSem, course.semesters[program]);
      }
    }

    const groupStatus = creditsFilled >= g.totalCredits ? 'filled'
                       : creditsFilled > 0 ? 'partial' : 'empty';

    groupCards.push({
      isGroupCard: true,
      key: g.key,
      label: g.label,
      totalCredits: g.totalCredits,
      creditsFilled,
      filledCourses,
      groupStatus,
      semester: earliestSem,
    });
  }

  // ── Phase 2: Build audit list for non-grouped courses ─────────
  const audit = [];
  for (const course of required) {
    if (groupedIds.has(course.id)) continue; // handled by group cards

    let status = 'remaining';
    let grade = null;
    let filledBy = null;

    if (courseStatuses[course.id]) {
      status = courseStatuses[course.id];
      grade = courseGrades[course.id];
    }

    // For non-grouped placeholder slots, try to fill from matched
    if (course.isPlaceholder && status === 'remaining' && course.eligible) {
      const filled = tryFillElective(course, matched, completedIds, codeIndex);
      if (filled) {
        status = filled.status;
        grade = filled.grade;
        filledBy = filled.filledBy;
        completedIds.add(course.id);
      }
    }

    // For non-grouped placeholders, try unmatched courses against approved lists
    if (course.isPlaceholder && status === 'remaining') {
      const filled = tryFillFromUnmatched(course, program, unmatched || [], completedIds, usedForGroups);
      if (filled) {
        status = filled.status;
        grade = filled.grade;
        filledBy = filled.filledBy;
        completedIds.add(course.id);
        usedForGroups.add(filled.filledBy); // also filter from unmatched display
      }
    }

    audit.push({
      ...course,
      status,
      grade,
      filledBy,
      semester: course.semesters[program],
    });
  }

  return { audit, groupCards, usedForGroups };
}

// ── Try to fill placeholder from matched (eligible list) ───────
function tryFillElective(placeholder, matched, completedIds, codeIndex) {
  if (!placeholder.eligible) return null;

  const eligibleCodes = placeholder.eligible.map(e => {
    const m = e.match(/^([A-Z]{2,4}\s+\d{1,4}[A-Z]?)/);
    return m ? m[1].toUpperCase() : null;
  }).filter(Boolean);

  for (const m of matched) {
    if (completedIds.has(m.courseId)) continue;
    const status = getCourseStatus(m.active.grade);
    if (status !== 'completed' && status !== 'transfer') continue;

    if (eligibleCodes.includes(m.code.toUpperCase())) {
      completedIds.add(m.courseId);
      return { status, grade: m.active.grade, filledBy: m.code };
    }
  }
  return null;
}

// ── Try to fill non-grouped placeholder from approved lists ────
// Scans unmatched transcript courses (not in courses.yml) against approved lists
function tryFillFromUnmatched(course, program, unmatchedList, completedIds, usedForGroups) {
  const slotMapping = {
    'THEO_GE': { lists: ['theology'], blanketDepts: [], checkWorldLang: false },
    'ME_PROF': { lists: ['professional_electives'], blanketDepts: ['ACC', 'ASTR', 'BIO', 'BLAW', 'FIN', 'MGT', 'MKT'], checkWorldLang: false },
    'ME_WL':   { lists: ['world_languages', 'cultural_diversity'], blanketDepts: [], checkWorldLang: true },
    'BE_WL':   { lists: ['world_languages', 'cultural_diversity'], blanketDepts: [], checkWorldLang: true },
  };

  const mapping = slotMapping[course.id];
  if (!mapping) return null;

  const approvedSet = buildApprovedSet(mapping.lists);

  for (const u of unmatchedList) {
    if (completedIds.has('unmatched:' + u.code)) continue;
    if (usedForGroups && usedForGroups.has(u.code)) continue;
    const status = getCourseStatus(u.active.grade);
    if (status !== 'completed' && status !== 'transfer') continue;

    if (isApprovedElective(u.code, approvedSet, mapping.blanketDepts, mapping.checkWorldLang)) {
      completedIds.add('unmatched:' + u.code);
      return { status, grade: u.active.grade, filledBy: u.code };
    }
  }
  return null;
}

// ── Compute summary statistics ─────────────────────────────────
function computeSummary(auditResult, matched) {
  const { audit, groupCards } = auditResult;
  let creditsDone = 0;
  let creditsTotal = 0;

  // Non-grouped courses
  for (const c of audit) {
    creditsTotal += c.credits || 0;
    if (c.status === 'completed' || c.status === 'transfer') {
      creditsDone += c.credits || 0;
    }
  }

  // Grouped elective cards
  for (const g of groupCards) {
    creditsTotal += g.totalCredits;
    creditsDone += Math.min(g.creditsFilled, g.totalCredits);
  }

  // GPA from graded courses (exclude TR, W, U, no-grade)
  let gpaPoints = 0;
  let gpaHours = 0;
  for (const m of matched) {
    const g = m.active.grade;
    if (GRADE_POINTS[g] !== undefined) {
      const credits = m.active.credits || m.courseData?.credits || 0;
      gpaPoints += GRADE_POINTS[g] * credits;
      gpaHours += credits;
    }
  }

  const gpa = gpaHours > 0 ? (gpaPoints / gpaHours).toFixed(4) : null;
  const pct = creditsTotal > 0 ? Math.round((creditsDone / creditsTotal) * 100) : 0;

  return { creditsDone, creditsRemaining: creditsTotal - creditsDone, creditsTotal, gpa, pct };
}

// ── Rendering ──────────────────────────────────────────────────
function renderAudit(auditResult, unmatched, summary) {
  const { audit, groupCards, usedForGroups } = auditResult;

  const resultsEl = document.getElementById('results-section');
  const uploadEl = document.getElementById('upload-section');
  uploadEl.style.display = 'none';
  resultsEl.style.display = '';

  // Summary bar
  document.getElementById('stat-completed').textContent = summary.creditsDone;
  document.getElementById('stat-remaining').textContent = summary.creditsRemaining;
  document.getElementById('stat-gpa').textContent = summary.gpa || '--';
  document.getElementById('stat-pct').textContent = summary.pct + '%';
  document.getElementById('progress-bar').style.width = summary.pct + '%';

  // Semester grid
  const grid = document.getElementById('audit-grid');
  grid.innerHTML = '';

  for (const sem of SEMESTERS) {
    const courses = audit
      .filter(c => c.semester === sem.s)
      .sort((a, b) => (a.isPlaceholder ? 1 : 0) - (b.isPlaceholder ? 1 : 0));

    const semGroupCards = groupCards.filter(g => g.semester === sem.s);

    if (!courses.length && !semGroupCards.length) continue;

    const col = document.createElement('div');
    col.className = 'sem-col';

    // Semester header
    const header = document.createElement('div');
    header.className = 'sem-header';
    header.innerHTML =
      '<div class="sem-year">' + sem.year + '</div>' +
      '<div class="sem-name">' + sem.season + '</div>';
    col.appendChild(header);

    // Cards
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'sem-cards';

    for (const course of courses) {
      cardsWrap.appendChild(createAuditCard(course));
    }

    // Grouped elective cards
    for (const gc of semGroupCards) {
      cardsWrap.appendChild(createGroupCard(gc));
    }

    col.appendChild(cardsWrap);
    grid.appendChild(col);
  }

  // Apply zoom
  applyZoom();

  // Unmatched courses (exclude ones used for elective groups)
  const remainingUnmatched = usedForGroups
    ? unmatched.filter(u => !usedForGroups.has(u.code))
    : unmatched;
  renderUnmatched(remainingUnmatched);
}

function createAuditCard(course) {
  const card = document.createElement('div');
  card.className = 'audit-card status-' + course.status;

  // Status icon
  const statusIcon = {
    'completed': '&#10003;',
    'transfer':  '&#8644;',
    'failed':    '&#10007;',
    'remaining': '',
    'no-grade':  '',
  }[course.status] || '';

  // Grade badge
  const gradeBadge = course.grade
    ? '<span class="grade-badge grade-' + gradeClass(course.grade) + '">' + course.grade + '</span>'
    : '';

  // If filled by a different course, show that
  const displayCode = course.filledBy || course.code;

  // Tags
  const tags = (course.tags || []).map(t => {
    const tag = TAGS[t];
    if (!tag) return '';
    return '<span class="audit-tag" style="background:' + tag.bg + ';color:' + tag.fg + '">' + tag.label + '</span>';
  }).join('');

  card.innerHTML =
    '<div class="audit-card-top">' +
      '<span class="audit-code">' + displayCode + '</span>' +
      gradeBadge +
    '</div>' +
    '<div class="audit-title">' + course.title + '</div>' +
    '<div class="audit-card-bottom">' +
      '<span class="audit-credits">' + (course.credits || '?') + ' cr</span>' +
      (statusIcon ? '<span class="audit-status-icon">' + statusIcon + '</span>' : '') +
    '</div>' +
    (tags ? '<div class="audit-tags">' + tags + '</div>' : '');

  return card;
}

function createGroupCard(gc) {
  const card = document.createElement('div');
  card.className = 'elective-group-card group-' + gc.groupStatus;

  const pct = gc.totalCredits > 0
    ? Math.min(100, Math.round((gc.creditsFilled / gc.totalCredits) * 100))
    : 0;

  let coursesHtml = '';
  for (const fc of gc.filledCourses) {
    const badge = '<span class="grade-badge grade-' + gradeClass(fc.grade) + '">' + fc.grade + '</span>';
    coursesHtml +=
      '<div class="group-course-item">' +
        '<span class="group-course-code">' + fc.code + '</span>' +
        badge +
        '<span>' + fc.credits + ' cr</span>' +
      '</div>';
  }

  card.innerHTML =
    '<div class="group-header">' +
      '<span class="group-name">' + gc.label + '</span>' +
      '<span class="group-tally">' + gc.creditsFilled + ' / ' + gc.totalCredits + ' cr</span>' +
    '</div>' +
    '<div class="group-progress-wrap">' +
      '<div class="group-progress-bar" style="width:' + pct + '%"></div>' +
    '</div>' +
    (coursesHtml ? '<div class="group-courses">' + coursesHtml + '</div>' : '');

  return card;
}

function gradeClass(grade) {
  if (!grade) return '';
  const pts = GRADE_POINTS[grade];
  if (pts === undefined) return grade.toLowerCase();
  if (pts >= 3.7) return 'a';
  if (pts >= 2.7) return 'b';
  if (pts >= 1.7) return 'c';
  if (pts >= 0.7) return 'd';
  return 'f';
}

function renderUnmatched(unmatched) {
  const section = document.getElementById('unmatched-section');
  const list = document.getElementById('unmatched-list');

  if (!unmatched.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = '';

  for (const u of unmatched) {
    const item = document.createElement('div');
    item.className = 'unmatched-item';

    const gradeBadge = u.active.grade
      ? '<span class="grade-badge grade-' + gradeClass(u.active.grade) + '">' + u.active.grade + '</span>'
      : '';

    item.innerHTML =
      '<span class="unmatched-code">' + u.code + '</span>' +
      '<span class="unmatched-title">' + (u.active.title || '') + '</span>' +
      gradeBadge +
      '<span class="unmatched-credits">' + (u.active.credits || 0) + ' cr</span>';

    list.appendChild(item);
  }
}

// ── Zoom controls ──────────────────────────────────────────────
let zoomLevel = 1.3;
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;

function applyZoom() {
  const area = document.getElementById('audit-area');
  if (area) area.style.zoom = zoomLevel;
  const label = document.getElementById('zoom-level');
  if (label) label.textContent = Math.round((zoomLevel / 1.3) * 100) + '%';
}

function zoomIn() {
  zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(1));
  applyZoom();
}

function zoomOut() {
  zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(1));
  applyZoom();
}

// ── UI interaction handlers ────────────────────────────────────
function selectProgram(prog, btn) {
  AUDIT_STATE.program = prog;
  document.querySelectorAll('.prog-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const trackSel = document.getElementById('track-selector');
  if (prog === 'BE') {
    trackSel.classList.add('visible');
    AUDIT_STATE.program = 'BE_Biomech';
  } else {
    trackSel.classList.remove('visible');
  }
  rerunAudit();
}

function selectTrack(track, btn) {
  AUDIT_STATE.program = track;
  document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  rerunAudit();
}

// ── File handling ──────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const parseBtn = document.getElementById('parse-btn');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    setFile(file);
  } else {
    showError('Please upload a PDF file.');
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  AUDIT_STATE.file = file;
  document.getElementById('file-info').style.display = '';
  document.getElementById('file-name').textContent = file.name;
  dropZone.style.display = 'none';
  parseBtn.disabled = false;
  hideError();
}

function clearFile() {
  AUDIT_STATE.file = null;
  document.getElementById('file-info').style.display = 'none';
  dropZone.style.display = '';
  parseBtn.disabled = true;
  fileInput.value = '';
}

function showError(msg) {
  const el = document.getElementById('parse-error');
  el.textContent = msg;
  el.style.display = '';
}

function hideError() {
  document.getElementById('parse-error').style.display = 'none';
}

// ── Main parse action ──────────────────────────────────────────
async function parseTranscript() {
  if (!AUDIT_STATE.file) return;

  parseBtn.disabled = true;
  parseBtn.textContent = 'Parsing...';
  hideError();

  try {
    // 1. Extract text from PDF
    const lines = await extractTextFromPDF(AUDIT_STATE.file);

    // 2. Parse course entries
    const entries = parseTranscriptLines(lines);
    if (!entries.length) {
      showError('No courses found in this PDF. Make sure it is a DataVU transcript.');
      parseBtn.disabled = false;
      parseBtn.textContent = 'Parse Transcript';
      return;
    }

    // 3. Resolve retakes (W-only courses are excluded)
    const resolved = resolveRetakes(entries);

    // 4. Match against degree requirements
    const codeIndex = buildCodeIndex();
    const { matched, unmatched } = matchCourses(resolved, codeIndex);

    // Store for re-auditing on program change
    AUDIT_STATE.lastMatched = matched;
    AUDIT_STATE.lastUnmatched = unmatched;
    AUDIT_STATE.lastCodeIndex = codeIndex;

    // 5. Compute audit and render
    runAudit(matched, unmatched, codeIndex);

  } catch (err) {
    console.error('Transcript parsing error:', err);
    showError('Error reading PDF: ' + err.message);
  }

  parseBtn.disabled = false;
  parseBtn.textContent = 'Parse Transcript';
}

// ── Run / rerun audit with current program ─────────────────────
function runAudit(matched, unmatched, codeIndex) {
  const auditResult = computeAudit(matched, AUDIT_STATE.program, codeIndex, unmatched);
  const summary = computeSummary(auditResult, matched);
  renderAudit(auditResult, unmatched, summary);
}

function rerunAudit() {
  if (!AUDIT_STATE.lastMatched) return; // no parsed data yet
  runAudit(AUDIT_STATE.lastMatched, AUDIT_STATE.lastUnmatched, AUDIT_STATE.lastCodeIndex);
}

function resetAudit() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('upload-section').style.display = '';
  AUDIT_STATE.lastMatched = null;
  AUDIT_STATE.lastUnmatched = null;
  AUDIT_STATE.lastCodeIndex = null;
  clearFile();
}

// ── Init zoom on load ──────────────────────────────────────────
applyZoom();
