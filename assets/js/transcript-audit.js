/* ╔══════════════════════════════════════════════════════════════╗
   ║  TRANSCRIPT AUDIT ENGINE                                    ║
   ║  Cross-references parsed transcript data against            ║
   ║  courses.yml and renders the audit results.                 ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── State ──────────────────────────────────────────────────────
let AUDIT_STATE = {
  program: 'ME',
  catalogYear: 2022,
  file: null,
  selectedMinors: [],
  // Stored after parsing so we can re-audit on program change
  lastMatched: null,
  lastUnmatched: null,
  lastCodeIndex: null,
  lastEntries: null, // raw parsed entries for CSV export
};

// ── Course code aliases ──────────────────────────────────────────
// Now data-driven: COURSE_ALIASES, DEPT_RENAMES, WL_DEPTS injected
// from _data/aliases/*.yml via _layouts/transcript.html.
// Build a lookup object from the COURSE_ALIASES array for fast access.
const CODE_ALIASES = (() => {
  const map = {};
  if (typeof COURSE_ALIASES !== 'undefined' && Array.isArray(COURSE_ALIASES)) {
    for (const a of COURSE_ALIASES) map[a.from] = a.to;
  }
  return map;
})();

// ── Elective group definitions ─────────────────────────────────
// Each group maps placeholder IDs → a combined card with tally.
// totalCredits is computed at runtime from the courses that exist
// in the active program, so it stays correct automatically.
// Core I/II group definitions shared across all programs
const CORE_GROUPS = [
  {
    key: 'core1',
    label: 'Core I',
    ids: ['CORE_1_SLOT'],
    approvedLists: ['core1'],
    blanketDepts: [],
    maxCourses: 3,
    fixedSemester: 1,
    fixedCredits: 4,
    showAll: true,  // show all matching courses (multi-section Core)
  },
  {
    key: 'core2',
    label: 'Core II',
    ids: ['CORE_2_SLOT'],
    approvedLists: ['core2'],
    blanketDepts: [],
    maxCourses: 3,
    fixedSemester: 2,
    fixedCredits: 4,
    showAll: true,
  },
];

const THEO_GROUP = {
  key: 'theo',
  label: 'Theology / Religion',
  ids: ['THEO_GE'],
  approvedLists: ['theology'],
  blanketDepts: [],
  maxCourses: 1,
};

const ELECTIVE_GROUPS = {
  ME: [
    ...CORE_GROUPS,
    THEO_GROUP,
    {
      key: 'me_elec',
      label: 'ME Electives',
      ids: ['ME_ELEC_1', 'ME_ELEC_2', 'ME_ELEC_3', 'ME_ELEC_4'],
      approvedLists: ['me_electives'],
      blanketDepts: [], checkWorldLang: false,
    },
    {
      key: 'me_wl',
      label: 'WL / Diversity',
      ids: ['ME_WL'],
      approvedLists: ['world_languages', 'cultural_diversity'],
      blanketDepts: ['AAA'],
      checkWorldLang: true,
      maxCourses: 1,
    },
    {
      key: 'me_prof',
      label: 'Prof. Elective',
      ids: ['ME_PROF'],
      approvedLists: ['professional_electives'],
      blanketDepts: ['ACC', 'ASTR', 'BIO', 'BLAW', 'FIN', 'MGT', 'MKT'],
      checkWorldLang: false,
      maxCourses: 1,
    },
    {
      key: 'me_humssrs',
      label: 'Hum / SS / RS',
      ids: ['ME_HUM_1', 'ME_HUM_2'],
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC', 'CC'],
    },
  ],
  BE_Biomech: [
    ...CORE_GROUPS,
    THEO_GROUP,
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S5_BM', 'BE_ELEC_S8_1'],
      approvedLists: ['be_electives_biomech'],
      blanketDepts: [],
    },
    {
      key: 'be_wl',
      label: 'WL / Diversity',
      ids: ['BE_WL'],
      approvedLists: ['world_languages', 'cultural_diversity'],
      blanketDepts: ['AAA'],
      checkWorldLang: true,
      maxCourses: 1,
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC', 'CC'],
    },
  ],
  BE_Bioelec: [
    ...CORE_GROUPS,
    THEO_GROUP,
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S7_BE', 'BE_ELEC_S8_1'],
      approvedLists: ['be_electives_bioelec'],
      blanketDepts: [],
    },
    {
      key: 'be_wl',
      label: 'WL / Diversity',
      ids: ['BE_WL'],
      approvedLists: ['world_languages', 'cultural_diversity'],
      blanketDepts: ['AAA'],
      checkWorldLang: true,
      maxCourses: 1,
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC', 'CC'],
    },
  ],
  BE_Biomed: [
    ...CORE_GROUPS,
    THEO_GROUP,
    {
      key: 'be_elec',
      label: 'BE Electives',
      ids: ['BE_ELEC_S4_BD', 'BE_ELEC_S7_BD', 'BE_ELEC_S8_1'],
      approvedLists: ['be_electives_biomed'],
      blanketDepts: [],
    },
    {
      key: 'be_wl',
      label: 'WL / Diversity',
      ids: ['BE_WL'],
      approvedLists: ['world_languages', 'cultural_diversity'],
      blanketDepts: ['AAA'],
      checkWorldLang: true,
      maxCourses: 1,
    },
    {
      key: 'be_humsstheo',
      label: 'Hum / SS / Theo',
      ids: ['BE_HUM_1', 'BE_HUM_2'],
      approvedLists: ['humanities', 'social_sciences'],
      blanketDepts: ['HIST', 'PHIL', 'ECON', 'POLS', 'SOC', 'CC'],
    },
  ],
};

// ── Detect catalog year from transcript entries ─────────────────
// Uses the earliest non-transfer course date to infer when the student started.
function detectCatalogYear(entries) {
  let earliestDate = null;
  for (const e of entries) {
    // Skip transfer/AP credits (grade TR or CR with no real semester)
    if (e.grade === 'TR' || e.grade === 'CR') continue;
    if (!e.endDate) continue;
    const d = new Date(e.endDate);
    if (isNaN(d)) continue;
    if (!earliestDate || d < earliestDate) earliestDate = d;
  }
  if (!earliestDate) return null;
  // Academic year: Fall starts in Aug. If earliest date is Aug-Dec, catalog year = that year.
  // If Jan-Jul, catalog year = previous year (they started the prior fall).
  const month = earliestDate.getMonth(); // 0-indexed
  const year = earliestDate.getFullYear();
  return month >= 7 ? year : year - 1; // Aug(7)+ = current year, before Aug = prior year
}

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

  // Add course code aliases (data-driven from _data/aliases/course_aliases.yml)
  for (const [code, id] of Object.entries(CODE_ALIASES)) {
    index[code.toUpperCase()] = id;
  }

  // Apply department renames (data-driven from _data/aliases/department_renames.yml)
  // e.g. STAT → DATA: any "STAT XXX" code maps to the same course as "DATA XXX"
  if (typeof DEPT_RENAMES !== 'undefined' && Array.isArray(DEPT_RENAMES)) {
    for (const rename of DEPT_RENAMES) {
      const oldPrefix = rename.old.toUpperCase() + ' ';
      const newPrefix = rename.new.toUpperCase() + ' ';
      for (const [key, id] of Object.entries(index)) {
        if (key.startsWith(newPrefix)) {
          const oldKey = oldPrefix + key.slice(newPrefix.length);
          if (!index[oldKey]) index[oldKey] = id;
        }
      }
    }
  }

  // Apply CAPS blanket substitutions (data-driven aliases)
  if (typeof CAPS_DATA !== 'undefined' && Array.isArray(CAPS_DATA)) {
    for (const cap of CAPS_DATA) {
      const fromCode = cap.from.toUpperCase();
      const toId = cap.to.replace(/\s+/g, '_').toUpperCase();
      if (!index[fromCode] && index[toId]) {
        index[fromCode] = index[toId];
      }
    }
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

// WL_DEPTS is now injected from _data/aliases/world_languages.yml via the layout

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
  // VUE_101/VUE_102 are handled by Core I/II group cards — exclude from required list
  const coreGroupIds = new Set(['VUE_101', 'VUE_102', 'THEO_GE']);
  const required = COURSES_ARRAY
    .filter(c => c.semesters && c.semesters[program])
    .filter(c => !coreGroupIds.has(c.id));

  const completedIds = new Set();
  const courseGrades = {};
  const courseStatuses = {};
  const courseFilledBy = {}; // track original transcript code for aliased courses

  // Only mark required courses as completed — non-required matched courses
  // (e.g., BE 415 in ME program) stay available for elective group filling.
  const requiredIds = new Set(required.map(c => c.id));
  const STATUS_PRIORITY = { completed: 3, transfer: 2, 'no-grade': 1, failed: 0 };
  for (const m of matched) {
    const status = getCourseStatus(m.active.grade);
    if ((status === 'completed' || status === 'transfer') && requiredIds.has(m.courseId)) {
      completedIds.add(m.courseId);
    }
    // Don't let a lab alias (no grade) overwrite a real grade
    const existing = STATUS_PRIORITY[courseStatuses[m.courseId]] || -1;
    const incoming = STATUS_PRIORITY[status] || -1;
    if (incoming > existing) {
      courseGrades[m.courseId] = m.active.grade;
      courseStatuses[m.courseId] = status;
      // Track filledBy when transcript code differs from course ID (aliased/CC courses)
      const normalizedCode = m.code.replace(/\s+/g, '_').toUpperCase();
      if (normalizedCode !== m.courseId) {
        courseFilledBy[m.courseId] = m.code;
      }
    }
  }

  // Determine which IDs belong to elective groups
  const groups = ELECTIVE_GROUPS[program] || [];
  const groupedIds = new Set();
  for (const g of groups) {
    for (const id of g.ids) groupedIds.add(id);
  }

  // ── Phase 1: Fill grouped elective cards FIRST ───────────────
  // Groups get priority so they can claim courses before single placeholders
  const usedForGroups = new Set(); // track transcript course codes for display filtering
  const usedRefs = new Set();     // track by object reference (handles repeatable courses)
  const groupCards = [];

  for (const g of groups) {
    const approvedSet = buildApprovedSet(g.approvedLists);
    const filledCourses = [];
    let creditsFilled = 0;

    // Compute totalCredits and semester from courses that exist in this program
    // fixedSemester/fixedCredits override for groups not tied to curriculum placeholders (Core I/II)
    let earliestSem = g.fixedSemester || 99;
    let latestSem = g.fixedSemester || 0;
    let totalCredits = g.fixedCredits || 0;
    if (!g.fixedCredits) {
      for (const id of g.ids) {
        const course = COURSES[id];
        if (course && course.semesters && course.semesters[program]) {
          earliestSem = Math.min(earliestSem, course.semesters[program]);
          latestSem = Math.max(latestSem, course.semesters[program]);
          totalCredits += course.credits || 0;
        }
      }
    }

    // Build sorted candidate list: matched + unmatched, sorted by cross-eligibility
    // (most specific courses — fewest alternative slots — fill first)
    const candidates = [];
    for (const m of matched) {
      // Allow CAPS-consumed courses to also fill elective groups: if the transcript
      // code differs from the courseId, the course was aliased to fill a required slot
      // but its original identity may qualify as an elective too.
      // EXCEPT: if the aliased course fills a required degree slot (CODE_ALIASES like
      // CC 215 → THEO_GE), block it from groups to prevent double-counting.
      const isAliased = m.code.replace(/\s+/g, '_').toUpperCase() !== m.courseId;
      if (usedRefs.has(m) || (completedIds.has(m.courseId) && !isAliased)) continue;
      if (isAliased && requiredIds.has(m.courseId)) continue;
      const status = getCourseStatus(m.active.grade);
      if (status === 'failed') continue;
      if (!isApprovedElective(m.code, approvedSet, g.blanketDepts, g.checkWorldLang)) continue;
      const cr = m.active.credits || (m.courseData && m.courseData.credits) || 0;
      candidates.push({ code: m.code, grade: m.active.grade, credits: cr, source: 'matched', ref: m });
    }
    if (unmatched) {
      for (const u of unmatched) {
        if (usedRefs.has(u) || completedIds.has('unmatched:' + u.code)) continue;
        const status = getCourseStatus(u.active.grade);
        if (status === 'failed') continue;
        if (!isApprovedElective(u.code, approvedSet, g.blanketDepts, g.checkWorldLang)) continue;
        candidates.push({ code: u.code, grade: u.active.grade, credits: u.active.credits || 0, source: 'unmatched', ref: u });
      }
    }
    // Sort: 0-credit courses last, then by cross-eligibility (most specific → least)
    candidates.sort((a, b) =>
      (a.credits > 0 ? 0 : 1) - (b.credits > 0 ? 0 : 1) ||
      countEligibleSlots(a.code, groups, program) - countEligibleSlots(b.code, groups, program)
    );

    for (const c of candidates) {
      if (usedRefs.has(c.ref)) continue; // may have been claimed by earlier iteration
      filledCourses.push({ code: c.code, grade: c.grade, credits: c.credits });
      creditsFilled += c.credits;
      if (!g.showAll) {
        usedRefs.add(c.ref);      // only lock for non-Core groups; Core courses can double-count
      }
      usedForGroups.add(c.code); // always filter from unmatched display
      if (!g.showAll) {
        if (c.source === 'unmatched') completedIds.add('unmatched:' + c.code);
      }
      if (!g.showAll) {
        const creditCourseCount = filledCourses.filter(fc => fc.credits > 0).length;
        if (g.maxCourses && creditCourseCount >= g.maxCourses) break;
        if (creditsFilled >= totalCredits) break;
      }
    }

    const allIP = filledCourses.length > 0 && filledCourses.every(c => !c.grade);
    const anyIP = filledCourses.some(c => !c.grade);
    const groupStatus = allIP ? 'ip'
                       : creditsFilled >= totalCredits ? (anyIP ? 'ip' : 'filled')
                       : creditsFilled > 0 ? 'partial' : 'empty';

    groupCards.push({
      isGroupCard: true,
      key: g.key,
      label: g.label,
      totalCredits,
      creditsFilled,
      filledCourses,
      groupStatus,
      showAll: g.showAll || false,
      semester: g.ids.length > 1 ? latestSem : earliestSem,
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
      if (courseFilledBy[course.id]) filledBy = courseFilledBy[course.id];
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

  // ── Phase 2b: CAPS fallback — fill remaining reqs via substitution ──
  // CAPS entries say "course X counts as course Y". The student may have X on
  // their transcript matched to its own catalog entry, but the program requires Y.
  // We look for ANY matched transcript course whose original code matches the
  // CAPS "from" code, regardless of whether it already filled another slot.
  if (typeof CAPS_DATA !== 'undefined' && Array.isArray(CAPS_DATA)) {
    for (const entry of audit) {
      if (entry.status !== 'remaining') continue;

      for (const cap of CAPS_DATA) {
        const toId = cap.to.replace(/\s+/g, '_').toUpperCase();
        if (toId !== entry.id) continue;

        // Look for a matched OR unmatched transcript course with the "from" code
        const fromNorm = cap.from.toUpperCase();
        const allCourses = [...matched, ...(unmatched || [])];
        for (const m of allCourses) {
          if (m.code.toUpperCase() !== fromNorm) continue;
          const st = getCourseStatus(m.active.grade);
          if (st !== 'completed' && st !== 'transfer') continue;

          entry.status = st;
          entry.grade = m.active.grade;
          entry.filledBy = m.code + ' (CAPS)';
          break;
        }
        if (entry.status !== 'remaining') break;
      }
    }
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
    if (status === 'failed') continue;

    if (eligibleCodes.includes(m.code.toUpperCase())) {
      completedIds.add(m.courseId);
      return { status: status === 'no-grade' ? 'ip' : status, grade: m.active.grade, filledBy: m.code };
    }
  }
  return null;
}

// ── Slot mappings for single-placeholder fills ─────────────────
const SLOT_MAPPING = {
  'THEO_GE': { lists: ['theology'], blanketDepts: [], checkWorldLang: false },
};

// ── Cross-eligibility: count how many groups + single slots a course qualifies for ──
function countEligibleSlots(code, groups, program) {
  let count = 0;
  for (const g of groups) {
    const approved = buildApprovedSet(g.approvedLists);
    if (isApprovedElective(code, approved, g.blanketDepts || [], g.checkWorldLang)) count++;
  }
  for (const [slotId, mapping] of Object.entries(SLOT_MAPPING)) {
    const approved = buildApprovedSet(mapping.lists);
    if (isApprovedElective(code, approved, mapping.blanketDepts, mapping.checkWorldLang)) count++;
  }
  return count;
}

// ── Try to fill non-grouped placeholder from approved lists ────
// Scans unmatched transcript courses (not in courses.yml) against approved lists
function tryFillFromUnmatched(course, program, unmatchedList, completedIds, usedForGroups) {
  const mapping = SLOT_MAPPING[course.id];
  if (!mapping) return null;

  const approvedSet = buildApprovedSet(mapping.lists);

  for (const u of unmatchedList) {
    if (completedIds.has('unmatched:' + u.code)) continue;
    if (usedForGroups && usedForGroups.has(u.code)) continue;
    const status = getCourseStatus(u.active.grade);
    if (status === 'failed') continue;

    if (isApprovedElective(u.code, approvedSet, mapping.blanketDepts, mapping.checkWorldLang)) {
      completedIds.add('unmatched:' + u.code);
      return { status: status === 'no-grade' ? 'ip' : status, grade: u.active.grade, filledBy: u.code };
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

  // Show "Plan Remaining Semesters" button if there are remaining credits
  const planBtn = document.getElementById('plan-btn');
  if (planBtn) {
    planBtn.style.display = summary.creditsRemaining > 0 ? '' : 'none';
  }

  // Show "Download CSV" button
  const csvBtn = document.getElementById('csv-btn');
  if (csvBtn) {
    csvBtn.style.display = AUDIT_STATE.lastEntries ? '' : 'none';
  }

  // Show "Download Audit Summary" Excel button
  const excelBtn = document.getElementById('excel-btn');
  if (excelBtn) {
    excelBtn.style.display = AUDIT_STATE.lastAuditResult ? '' : 'none';
  }

  // Unmatched courses (exclude ones used for elective groups)
  const remainingUnmatched = usedForGroups
    ? unmatched.filter(u => !usedForGroups.has(u.code))
    : unmatched;
  renderUnmatched(remainingUnmatched);
}

function createAuditCard(course) {
  const card = document.createElement('div');
  card.className = 'audit-card status-' + course.status;
  card.dataset.id = course.id;
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => selectAuditCourse(course.id));

  // Status icon
  const statusIcon = {
    'completed': '&#10003;',
    'transfer':  '&#8644;',
    'failed':    '&#10007;',
    'remaining': '',
    'no-grade':  '',
  }[course.status] || '';

  // Grade badge — show TR/CR / IP when no letter grade
  let gradeBadge;
  if (course.status === 'transfer') {
    const trLabel = course.grade === 'CR' ? 'CR' : 'TR';
    gradeBadge = '<span class="grade-badge grade-tr">' + trLabel + '</span>';
  } else if (course.status === 'no-grade') {
    gradeBadge = '<span class="grade-badge grade-ip">IP</span>';
  } else if (course.grade) {
    gradeBadge = '<span class="grade-badge grade-' + gradeClass(course.grade) + '">' + course.grade + '</span>';
  } else {
    gradeBadge = '';
  }

  // If filled by a different course, show that
  const displayCode = course.filledBy || course.code;

  card.innerHTML =
    '<div class="audit-card-top">' +
      '<span class="audit-code">' + displayCode + '</span>' +
      gradeBadge +
    '</div>' +
    '<div class="audit-title">' + course.title + '</div>' +
    '<div class="audit-card-bottom">' +
      '<span class="audit-credits">' + (course.status === 'no-grade' ? '- cr' : (course.credits || '?') + ' cr') + '</span>' +
      (statusIcon ? '<span class="audit-status-icon">' + statusIcon + '</span>' : '') +
    '</div>';

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
    const status = getCourseStatus(fc.grade);
    let badge;
    if (status === 'transfer') {
      const trLabel = fc.grade === 'CR' ? 'CR' : 'TR';
      badge = '<span class="grade-badge grade-tr">' + trLabel + '</span>';
    } else if (!fc.grade) {
      badge = '<span class="grade-badge grade-ip">IP</span>';
    } else {
      badge = '<span class="grade-badge grade-' + gradeClass(fc.grade) + '">' + fc.grade + '</span>';
    }
    const crLabel = !fc.grade ? '- cr' : fc.credits + ' cr';
    coursesHtml +=
      '<div class="group-course-item">' +
        '<span class="group-course-code">' + fc.code + '</span>' +
        badge +
        '<span>' + crLabel + '</span>' +
      '</div>';
  }

  card.innerHTML =
    '<div class="group-header">' +
      '<span class="group-name">' + gc.label + '</span>' +
      '<span class="group-tally">' + (gc.showAll ? gc.creditsFilled + ' cr' : gc.creditsFilled + ' / ' + gc.totalCredits + ' cr') + '</span>' +
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

function unmatchedSemesterLabel(endDate) {
  if (!endDate) return 'Other';
  const m = endDate.getMonth(); // 0-indexed
  const y = endDate.getFullYear();
  if (m <= 4)       return 'Spring ' + y;
  else if (m <= 6)  return 'Summer ' + y;
  else              return 'Fall ' + y;
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

    // Grade badge: transfer → TR/CR, in-progress (no grade) → IP, otherwise letter grade
    const status = getCourseStatus(u.active.grade);
    let gradeBadge;
    if (status === 'transfer') {
      const trLabel = u.active.grade === 'CR' ? 'CR' : 'TR';
      gradeBadge = '<span class="grade-badge grade-tr">' + trLabel + '</span>';
    } else if (!u.active.grade) {
      gradeBadge = '<span class="grade-badge grade-ip">IP</span>';
    } else {
      gradeBadge = '<span class="grade-badge grade-' + gradeClass(u.active.grade) + '">' + u.active.grade + '</span>';
    }

    // Credits: show "-" for in-progress with no credit value
    const crLabel = (!u.active.grade && !u.active.credits) ? '-' : (u.active.credits || 0);

    // Semester tag
    const semLabel = unmatchedSemesterLabel(u.active.endDate);
    const semTag = semLabel !== 'Other'
      ? '<span class="unmatched-sem-tag">' + semLabel + '</span>'
      : '';

    item.innerHTML =
      '<div class="unmatched-top">' +
        '<span class="unmatched-code">' + u.code + '</span>' +
        '<span class="unmatched-title">' + (u.active.title || '') + '</span>' +
      '</div>' +
      '<div class="unmatched-meta">' +
        gradeBadge +
        '<span class="unmatched-credits">' + crLabel + ' cr</span>' +
        semTag +
      '</div>';

    list.appendChild(item);
  }
}

// ── Build unlock index ──────────────────────────────────────────
const UNLOCKS = {};
for (const c of Object.values(COURSES)) {
  if (!UNLOCKS[c.id]) UNLOCKS[c.id] = [];
  for (const pid of (c.prereqs || [])) {
    if (!UNLOCKS[pid]) UNLOCKS[pid] = [];
    if (!UNLOCKS[pid].includes(c.id)) UNLOCKS[pid].push(c.id);
  }
  for (const cid of (c.coreqs || [])) {
    if (!UNLOCKS[cid]) UNLOCKS[cid] = [];
    if (!UNLOCKS[cid].includes(c.id)) UNLOCKS[cid].push(c.id);
  }
}

// ── Course selection & arrows ──────────────────────────────────
let auditSelected = null;

function selectAuditCourse(id) {
  if (auditSelected === id) { clearAuditSelection(); return; }
  auditSelected = id;

  const course = COURSES[id];
  if (!course) return;

  const prog    = AUDIT_STATE.program;
  const prereqs = new Set(course.prereqs || []);
  const coreqs  = new Set(course.coreqs  || []);
  const unlocks = new Set(
    (UNLOCKS[id] || []).filter(x => COURSES[x] && COURSES[x].semesters && COURSES[x].semesters[prog])
  );

  document.querySelectorAll('.audit-card[data-id]').forEach(el => {
    const cid = el.dataset.id;
    el.classList.remove('state-selected','state-prereq','state-coreq','state-unlocked','state-dimmed');
    if      (cid === id)         el.classList.add('state-selected');
    else if (prereqs.has(cid))   el.classList.add('state-prereq');
    else if (coreqs.has(cid))    el.classList.add('state-coreq');
    else if (unlocks.has(cid))   el.classList.add('state-unlocked');
    else                         el.classList.add('state-dimmed');
  });

  // Dim group cards too
  document.querySelectorAll('.elective-group-card').forEach(el => {
    el.style.opacity = '0.08';
  });

  drawAuditArrows();
  highlightAuditArrows(id, prereqs, coreqs, unlocks);
  openAuditPanel(course, prereqs, coreqs, unlocks);
}

function clearAuditSelection() {
  auditSelected = null;
  document.querySelectorAll('.audit-card[data-id]').forEach(el =>
    el.classList.remove('state-selected','state-prereq','state-coreq','state-unlocked','state-dimmed')
  );
  document.querySelectorAll('.elective-group-card').forEach(el => {
    el.style.opacity = '';
  });
  const svg = document.getElementById('audit-arrow-svg');
  if (svg) svg.querySelectorAll('path').forEach(p => p.remove());
  const panel = document.getElementById('audit-detail-panel');
  if (panel) panel.classList.remove('open');
}

function openAuditPanel(course, prereqs, coreqs, unlocks) {
  document.getElementById('audit-panel-code').textContent    = course.code;
  document.getElementById('audit-panel-title').textContent   = course.title;
  document.getElementById('audit-panel-credits').textContent = course.credits + ' credits';
  document.getElementById('audit-panel-desc').textContent    = course.desc || '';

  function renderPills(ids, cssClass, elId) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const prog = AUDIT_STATE.program;
    const arr = [...ids].filter(id => COURSES[id] && COURSES[id].semesters && COURSES[id].semesters[prog]);
    if (!arr.length) { el.innerHTML = '<span class="audit-none-label">none</span>'; return; }
    arr.forEach(id => {
      const rc = COURSES[id];
      const sp = document.createElement('span');
      sp.className = 'audit-rel-pill ' + cssClass;
      sp.textContent = rc.code;
      sp.title = rc.title;
      sp.onclick = () => selectAuditCourse(id);
      el.appendChild(sp);
    });
  }

  renderPills(prereqs, 'audit-prereq-pill', 'audit-panel-prereqs');
  renderPills(coreqs,  'audit-coreq-pill',  'audit-panel-coreqs');
  renderPills(unlocks, 'audit-unlock-pill',  'audit-panel-unlocked');

  const eligibleEl = document.getElementById('audit-panel-eligible');
  if (course.isPlaceholder && course.eligible && course.eligible.length) {
    eligibleEl.innerHTML =
      '<h5>Eligible Courses</h5>' +
      '<div class="audit-eligible-list">' +
        course.eligible.map(e => '<div class="audit-eligible-item">' + e + '</div>').join('') +
      '</div>';
  } else {
    eligibleEl.innerHTML = '';
  }

  document.getElementById('audit-detail-panel').classList.add('open');
}

function drawAuditArrows() {
  const svg = document.getElementById('audit-arrow-svg');
  if (!svg) return;
  svg.querySelectorAll('path').forEach(p => p.remove());

  const prog = AUDIT_STATE.program;
  const area = document.getElementById('audit-area');
  const areaRect = area.getBoundingClientRect();
  const z = zoomLevel;

  function cardPos(id) {
    const el = document.querySelector('.audit-card[data-id="' + id + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cx: (r.left - areaRect.left + r.width  / 2) / z,
      cy: (r.top  - areaRect.top  + r.height / 2) / z,
      rx: (r.right  - areaRect.left) / z,
      lx: (r.left   - areaRect.left) / z,
      ty: (r.top    - areaRect.top)  / z,
      by: (r.bottom - areaRect.top)  / z,
    };
  }

  const drawn = new Set();

  for (const course of Object.values(COURSES)) {
    if (!course.semesters || !course.semesters[prog]) continue;
    const toPos = cardPos(course.id);
    if (!toPos) continue;

    for (const pid of (course.prereqs || [])) {
      if (!COURSES[pid] || !COURSES[pid].semesters || !COURSES[pid].semesters[prog]) continue;
      const key = pid + '->' + course.id;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const fromPos = cardPos(pid);
      if (!fromPos) continue;
      svg.appendChild(makeAuditPath(fromPos, toPos, false, pid, course.id));
    }

    for (const cid of (course.coreqs || [])) {
      if (!COURSES[cid] || !COURSES[cid].semesters || !COURSES[cid].semesters[prog]) continue;
      const key = 'co:' + [cid, course.id].sort().join('-');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const fromPos = cardPos(cid);
      if (!fromPos) continue;
      svg.appendChild(makeAuditPath(fromPos, toPos, true, cid, course.id));
    }
  }
}

function makeAuditPath(from, to, isCoreq, fromId, toId) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.classList.add(isCoreq ? 'arrow-coreq' : 'arrow-prereq');
  p.dataset.from = fromId;
  p.dataset.to   = toId;
  p.dataset.type = isCoreq ? 'coreq' : 'prereq';

  const sameCol = Math.abs(from.cx - to.cx) < 100;
  let d;

  if (sameCol) {
    const bulge = Math.max(from.rx, to.rx) + 38;
    d = 'M ' + from.rx + ' ' + from.cy + ' C ' + bulge + ' ' + from.cy + ' ' + bulge + ' ' + to.cy + ' ' + to.rx + ' ' + to.cy;
  } else if (from.cx < to.cx) {
    const dx = to.cx - from.cx;
    d = 'M ' + from.rx + ' ' + from.cy + ' C ' + (from.rx + dx * 0.4) + ' ' + from.cy + ' ' + (to.lx - dx * 0.4) + ' ' + to.cy + ' ' + to.lx + ' ' + to.cy;
  } else {
    const dx = from.cx - to.cx;
    d = 'M ' + from.lx + ' ' + from.cy + ' C ' + (from.lx - dx * 0.4) + ' ' + from.cy + ' ' + (to.rx + dx * 0.4) + ' ' + to.cy + ' ' + to.rx + ' ' + to.cy;
  }

  p.setAttribute('d', d);
  p.setAttribute('marker-end', isCoreq ? 'url(#aCo)' : 'url(#aPre)');
  return p;
}

function highlightAuditArrows(selId, prereqs, coreqs, unlocks) {
  document.querySelectorAll('#audit-arrow-svg path').forEach(p => {
    const f  = p.dataset.from;
    const t  = p.dataset.to;
    const ty = p.dataset.type;
    p.classList.remove('hi-prereq','hi-unlocked','hi-coreq','fade');

    if (ty === 'prereq') {
      if (t === selId && prereqs.has(f)) {
        p.classList.add('hi-prereq');  p.setAttribute('marker-end','url(#aPreHi)');
      } else if (f === selId && unlocks.has(t)) {
        p.classList.add('hi-unlocked'); p.setAttribute('marker-end','url(#aUnHi)');
      } else {
        p.classList.add('fade');        p.setAttribute('marker-end','url(#aPre)');
      }
    } else {
      if ((f === selId && (coreqs.has(t) || unlocks.has(t))) ||
          (t === selId && (coreqs.has(f) || prereqs.has(f)))) {
        p.classList.add('hi-coreq');   p.setAttribute('marker-end','url(#aCoHi)');
      } else {
        p.classList.add('fade');        p.setAttribute('marker-end','url(#aCo)');
      }
    }
  });
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
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(AUDIT_STATE.program, AUDIT_STATE.catalogYear);
  }
  rerunAudit();
}

function selectTrack(track, btn) {
  AUDIT_STATE.program = track;
  document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(AUDIT_STATE.program, AUDIT_STATE.catalogYear);
  }
  rerunAudit();
}

function selectCatalogYear(year) {
  AUDIT_STATE.catalogYear = year;
  // Re-apply curriculum for the active program with the new catalog year
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(AUDIT_STATE.program, year);
  }
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
  if (file && (file.type === 'application/pdf' || file.name.endsWith('.csv'))) {
    setFile(file);
  } else {
    showError('Please upload a PDF or CSV file.');
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
    let entries;

    if (AUDIT_STATE.file.name.endsWith('.csv')) {
      // Parse CSV file
      entries = await parseCSVTranscript(AUDIT_STATE.file);
    } else {
      // 1. Extract text from PDF
      const lines = await extractTextFromPDF(AUDIT_STATE.file);
      // 2. Parse course entries
      entries = parseTranscriptLines(lines);
    }

    if (!entries.length) {
      showError('No courses found. Make sure it is a DataVU transcript or valid CSV.');
      parseBtn.disabled = false;
      parseBtn.textContent = 'Parse Transcript';
      return;
    }

    // 3. Resolve retakes (W-only courses are excluded)
    const resolved = resolveRetakes(entries);

    // 3b. Auto-detect catalog year from earliest non-transfer course
    const detectedYear = detectCatalogYear(entries);
    if (detectedYear) {
      AUDIT_STATE.catalogYear = detectedYear;
      const sel = document.getElementById('catalog-year-select');
      if (sel) {
        sel.value = String(detectedYear);
        const autoLabel = document.getElementById('catalog-year-auto');
        if (autoLabel) autoLabel.style.display = 'inline';
      }
      // Apply the detected catalog year curriculum
      if (typeof applyCurriculum === 'function') {
        applyCurriculum(AUDIT_STATE.program, detectedYear);
      }
    }

    // 4. Match against degree requirements
    const codeIndex = buildCodeIndex();
    const { matched, unmatched } = matchCourses(resolved, codeIndex);

    // Store for re-auditing on program change
    AUDIT_STATE.lastMatched = matched;
    AUDIT_STATE.lastUnmatched = unmatched;
    AUDIT_STATE.lastCodeIndex = codeIndex;
    AUDIT_STATE.lastEntries = entries;

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
  AUDIT_STATE.lastAuditResult = auditResult;
  renderAudit(auditResult, unmatched, summary);

  // Re-run minor audits if any are selected
  if (typeof rerunMinors === 'function') rerunMinors();
}

function rerunAudit() {
  if (!AUDIT_STATE.lastMatched) return; // no parsed data yet
  runAudit(AUDIT_STATE.lastMatched, AUDIT_STATE.lastUnmatched, AUDIT_STATE.lastCodeIndex);
}

async function loadExampleTranscript() {
  const url = (typeof SITE_BASEURL !== 'undefined' ? SITE_BASEURL : '') + '/assets/example-transcript.csv';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Could not load example transcript');
    const blob = await resp.blob();
    const file = new File([blob], 'example-transcript.csv', { type: 'text/csv' });
    setFile(file);
    // Auto-select ME for this example
    selectProgram('ME', document.querySelectorAll('.prog-btn')[0]);
    parseTranscript();
  } catch (err) {
    showError('Could not load example: ' + err.message);
  }
}

function downloadCSV() {
  if (!AUDIT_STATE.lastEntries) return;
  const csv = exportTranscriptCSV(AUDIT_STATE.lastEntries);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transcript.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Excel Audit Summary Export ────────────────────────────────────
// Uses xlsx-js-style (drop-in SheetJS replacement with cell styling)

function getProgramLabel(program) {
  const labels = {
    'ME': 'Mechanical Engineering',
    'BE_Biomech': 'Bioengineering - Biomechanical',
    'BE_Bioelec': 'Bioengineering - Bioelectrical',
    'BE_Biomed': 'Bioengineering - Biomedical',
    'CE': 'Civil Engineering',
    'CPE': 'Computer Engineering',
    'EE': 'Electrical Engineering',
    'ENE': 'Environmental Engineering',
  };
  return labels[program] || program;
}

// Sanitize sheet name: Excel forbids \ / * ? : [ ] and max 31 chars
function sanitizeSheetName(name) {
  return name.replace(/[\\/*?:\[\]]/g, '-').substring(0, 31);
}

function mapAuditStatus(status) {
  const map = {
    'completed': 'Fulfilled',
    'transfer': 'Fulfilled',
    'no-grade': 'In Progress',
    'ip': 'In Progress',
    'failed': 'Unfulfilled',
    'remaining': 'Unfulfilled',
  };
  return map[status] || status;
}

function mapGroupStatus(groupStatus) {
  const map = {
    'filled': 'Fulfilled',
    'partial': 'Partially Fulfilled',
    'ip': 'In Progress',
    'empty': 'Unfulfilled',
  };
  return map[groupStatus] || groupStatus;
}

function getCourseStatusForExport(grade) {
  if (!grade) return 'ip';
  const g = grade.toUpperCase();
  if (g === 'F') return 'failed';
  if (g === 'W') return 'withdrawn';
  return 'completed';
}

// Cell style presets
const EXCEL_STYLES = {
  header: {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '4A2F1A' } },    // Valpo brown
    alignment: { horizontal: 'center' },
  },
  fulfilled: {
    fill: { fgColor: { rgb: 'C6EFCE' } },     // green bg
    font: { color: { rgb: '006100' } },
  },
  inProgress: {
    fill: { fgColor: { rgb: 'FFEB9C' } },     // yellow bg
    font: { color: { rgb: '9C6500' } },
  },
  partiallyFulfilled: {
    fill: { fgColor: { rgb: 'FFF2CC' } },     // light yellow bg
    font: { color: { rgb: '9C6500' } },
  },
  unfulfilled: {
    fill: { fgColor: { rgb: 'FFC7CE' } },     // red bg
    font: { color: { rgb: '9C0006' } },
  },
  sectionHeader: {
    font: { bold: true, sz: 12 },
    fill: { fgColor: { rgb: 'D9D9D9' } },
  },
};

function getStatusStyle(statusText) {
  switch (statusText) {
    case 'Fulfilled':           return EXCEL_STYLES.fulfilled;
    case 'In Progress':         return EXCEL_STYLES.inProgress;
    case 'Partially Fulfilled': return EXCEL_STYLES.partiallyFulfilled;
    case 'Unfulfilled':         return EXCEL_STYLES.unfulfilled;
    default:                    return {};
  }
}

// Apply styles to a worksheet after it's created from aoa
function applySheetStyles(ws, rows) {
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Style header row
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = EXCEL_STYLES.header;
  }

  // Style status column + in-progress course cells
  for (let r = 1; r <= range.e.r; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // "Extra Classes" section header
    if (row[0] === 'Extra Classes') {
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) ws[addr].s = EXCEL_STYLES.sectionHeader;
      }
      continue;
    }

    // Status cell (column C / index 2)
    const statusText = row[2];
    if (statusText) {
      const addr = XLSX.utils.encode_cell({ r, c: 2 });
      if (ws[addr]) ws[addr].s = getStatusStyle(statusText);
    }

    // In-progress course cells get yellow highlight
    for (let c = 3; c < row.length; c++) {
      const val = row[c];
      if (typeof val === 'string' && val.startsWith('(In-Progress)')) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) ws[addr].s = EXCEL_STYLES.inProgress;
      }
    }
  }
}

function buildMajorSheetData(auditResult, unmatched) {
  const { audit, groupCards, usedForGroups } = auditResult;
  const rows = [];

  // Header row
  rows.push(['Requirement', 'Credits', 'Status']);

  // Sort audit entries by semester
  const sorted = [...audit].sort((a, b) => (a.semester || 99) - (b.semester || 99));

  for (const c of sorted) {
    const status = mapAuditStatus(c.status);
    const row = [c.code + ' - ' + c.title, c.credits || '', status];

    if (c.status === 'completed' || c.status === 'transfer') {
      const display = c.filledBy || c.code;
      const gradeStr = c.grade ? ' (' + c.grade + ')' : '';
      row.push(display + gradeStr);
    } else if (c.status === 'no-grade' || c.status === 'ip') {
      const display = c.filledBy || c.code;
      row.push('(In-Progress) ' + display);
    }

    rows.push(row);
  }

  // Grouped elective/Core cards
  for (const gc of groupCards) {
    const status = mapGroupStatus(gc.groupStatus);
    const row = [gc.label + ' (' + gc.totalCredits + ' cr)', gc.totalCredits, status];

    for (const fc of gc.filledCourses) {
      const fcStatus = getCourseStatusForExport(fc.grade);
      if (fcStatus === 'failed') continue;
      const prefix = !fc.grade ? '(In-Progress) ' : '';
      const gradeStr = fc.grade ? ' (' + fc.grade + ')' : '';
      const crStr = ' (' + (fc.credits ? fc.credits + ' cr' : '? cr') + ')';
      row.push(prefix + fc.code + gradeStr + crStr);
    }

    rows.push(row);
  }

  // Extra/unmatched courses section
  const remaining = usedForGroups
    ? (unmatched || []).filter(u => !usedForGroups.has(u.code))
    : (unmatched || []);

  if (remaining.length > 0) {
    rows.push([]);
    rows.push(['Extra Classes', '', '']);
    for (const u of remaining) {
      const status = getCourseStatusForExport(u.active.grade);
      if (status === 'failed') continue;
      const prefix = !u.active.grade ? '(In-Progress) ' : '';
      const gradeStr = u.active.grade ? ' (' + u.active.grade + ')' : '';
      const credits = u.active.credits || '?';
      rows.push([u.code + ' - ' + (u.active.title || ''), credits, '', prefix + u.code + gradeStr]);
    }
  }

  return rows;
}

function buildMinorSheetData(minorResult) {
  const rows = [];
  rows.push(['Requirement', 'Status', 'Fulfilling Courses']);

  for (const req of minorResult.requirements) {
    const status = req.met ? 'Fulfilled' : (req.creditsApplied > 0 ? 'Partially Fulfilled' : 'Unfulfilled');
    const row = [req.label, status];

    for (const fc of req.filled) {
      const fcStatus = getCourseStatusForExport(fc.grade);
      if (fcStatus === 'failed') continue;
      const prefix = !fc.grade ? '(In-Progress) ' : '';
      const gradeStr = fc.grade ? ' (' + fc.grade + ')' : '';
      const crStr = ' (' + (fc.credits ? fc.credits + ' cr' : '? cr') + ')';
      row.push(prefix + fc.code + gradeStr + crStr);
    }

    rows.push(row);
  }

  // Above & Beyond row
  const aab = minorResult.aboveAndBeyond;
  rows.push([
    'Above & Beyond',
    aab.met ? 'Fulfilled' : 'Unfulfilled',
    aab.course || ''
  ]);

  // Overall summary
  rows.push([]);
  rows.push([
    'Overall',
    minorResult.overallMet ? 'COMPLETE' : 'INCOMPLETE',
    minorResult.totalApplied + '/' + minorResult.minCredits + ' credits'
  ]);

  return rows;
}

// Compute max columns needed, then set widths for all of them
function setColWidths(ws, rows) {
  let maxCols = 0;
  for (const row of rows) maxCols = Math.max(maxCols, row.length);
  const cols = [{ wch: 42 }, { wch: 8 }, { wch: 20 }];
  for (let i = 3; i < maxCols; i++) cols.push({ wch: 24 });
  ws['!cols'] = cols;
}

function downloadAuditExcel() {
  if (!AUDIT_STATE.lastAuditResult) return;
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Please reload the page.'); return; }

  const wb = XLSX.utils.book_new();

  // ── Major tab ──
  const programLabel = getProgramLabel(AUDIT_STATE.program);
  const majorData = buildMajorSheetData(AUDIT_STATE.lastAuditResult, AUDIT_STATE.lastUnmatched);
  const majorWs = XLSX.utils.aoa_to_sheet(majorData);
  setColWidths(majorWs, majorData);
  applySheetStyles(majorWs, majorData);
  XLSX.utils.book_append_sheet(wb, majorWs, sanitizeSheetName('Major - ' + programLabel));

  // ── Minor tabs ──
  const selected = AUDIT_STATE.selectedMinors || [];
  if (selected.length > 0 && typeof computeAllMinors === 'function') {
    const auditResult = computeAudit(
      AUDIT_STATE.lastMatched,
      AUDIT_STATE.program,
      AUDIT_STATE.lastCodeIndex,
      AUDIT_STATE.lastUnmatched
    );
    const minorResults = computeAllMinors(
      AUDIT_STATE.lastMatched,
      AUDIT_STATE.lastUnmatched,
      auditResult,
      selected,
      AUDIT_STATE.program
    );
    for (const mr of minorResults) {
      const minorData = buildMinorSheetData(mr);
      const minorWs = XLSX.utils.aoa_to_sheet(minorData);
      setColWidths(minorWs, minorData);
      applySheetStyles(minorWs, minorData);
      XLSX.utils.book_append_sheet(wb, minorWs, sanitizeSheetName('Minor - ' + mr.name));
    }
  }

  XLSX.writeFile(wb, 'audit-summary.xlsx');
}

function resetAudit() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('upload-section').style.display = '';
  const plannerSection = document.getElementById('planner-section');
  if (plannerSection) plannerSection.style.display = 'none';
  AUDIT_STATE.lastMatched = null;
  AUDIT_STATE.lastUnmatched = null;
  AUDIT_STATE.lastCodeIndex = null;
  AUDIT_STATE.lastEntries = null;
  AUDIT_STATE.lastAuditResult = null;
  clearFile();
}

// ── Click-off & keyboard to clear selection ────────────────────
document.getElementById('audit-area')?.addEventListener('click', ev => {
  if (ev.target.closest('.audit-card')) return;
  if (auditSelected) clearAuditSelection();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && auditSelected) clearAuditSelection();
});

// ── Init zoom on load ──────────────────────────────────────────
applyZoom();
