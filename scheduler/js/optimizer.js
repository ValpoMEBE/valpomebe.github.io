/* ╔══════════════════════════════════════════════════════════════╗
   ║  OPTIMIZER — Constraint Satisfaction Scheduler               ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Uses backtracking with forward checking to assign courses   ║
   ║  to time slots while respecting hard constraints and         ║
   ║  minimizing weighted soft constraint violations.             ║
   ║                                                              ║
   ║  Depends on: parser.js (expandDayPattern, timesOverlap,      ║
   ║              timeToMinutes, minutesToTime, instructorKey)     ║
   ║              COURSES global (injected by layout from YAML)   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Solver limits ─────────────────────────────────────────────
const MAX_ITERATIONS = 200000;
const STALE_LIMIT    = 30000;

// ── Build semester conflict map from COURSES global ───────────
// Returns Map<string, Set<string>> where key = "PROGRAM:SEM"
// and value = set of courseIds in that program-semester.
function buildSemesterMap() {
  const map = new Map();
  for (const c of Object.values(COURSES)) {
    if (!c.semesters) continue;
    for (const [prog, sem] of Object.entries(c.semesters)) {
      const key = `${prog}:${sem}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(c.id);
    }
  }
  return map;
}

// ── Build conflict graph (courseId → Set<courseId>) ────────────
// Two courseIds conflict if they share any program-semester.
function buildConflictGraph(semesterMap) {
  const graph = new Map();
  for (const [, courseIds] of semesterMap) {
    const ids = [...courseIds];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!graph.has(ids[i])) graph.set(ids[i], new Set());
        if (!graph.has(ids[j])) graph.set(ids[j], new Set());
        graph.get(ids[i]).add(ids[j]);
        graph.get(ids[j]).add(ids[i]);
      }
    }
  }
  return graph;
}

// ── Year level from semester number ───────────────────────────
function semToYear(sem) {
  if (sem <= 2) return 1;
  if (sem <= 4) return 2;
  if (sem <= 6) return 3;
  return 4;
}

// ── Get course metadata from COURSES global ───────────────────
function getCourseInfo(courseId) {
  return COURSES[courseId] || null;
}

// ── Instructor key for a course (primary instructor) ──────────
// Returns "LastName" or "LastName_F" for faculty pref matching.
function getInstructorKey(course) {
  if (!course.instructors || course.instructors.length === 0) return '';
  const primary = course.instructors[0];
  if (!primary.last || primary.last.toLowerCase() === 'staff') return '';
  if (primary.first) {
    return `${primary.last}_${primary.first.charAt(0)}`;
  }
  return primary.last;
}

// ── Get all non-Staff instructor keys for a course ────────────
function getAllInstructorKeys(course) {
  if (!course.instructors) return [];
  return course.instructors
    .filter(i => i.last && i.last.toLowerCase() !== 'staff')
    .map(i => {
      if (i.first) return `${i.last}_${i.first.charAt(0)}`;
      return i.last;
    });
}

// ── Match faculty key against preferences Map ─────────────────
// Tries exact match first ("Sestito_L"), then last-name-only ("Sestito").
function findFacultyPrefs(facultyKey, preferencesMap) {
  if (!facultyKey) return null;
  if (preferencesMap.has(facultyKey)) return preferencesMap.get(facultyKey);
  // Try last-name only
  const lastName = facultyKey.split('_')[0];
  if (preferencesMap.has(lastName)) return preferencesMap.get(lastName);
  return null;
}

// ── Match a single slot against a faculty preference entry ────
// Returns the preference value or 0 if no match.
function matchFacultyPref(course, slot, preferencesMap) {
  const key = getInstructorKey(course);
  const prefs = findFacultyPrefs(key, preferencesMap);
  if (!prefs) return 0;

  const slotStart = timeToMinutes(slot.startTime);

  for (const p of prefs) {
    // Format must match
    if (p.format && p.format !== slot.format) continue;
    // Day must match (single day letter)
    if (p.day) {
      const prefDays = expandDayPattern(p.day);
      const hasMatchingDay = prefDays.some(d => slot.days.includes(d));
      if (!hasMatchingDay) continue;
    }
    // Start time must match
    if (p.start) {
      const prefStart = timeToMinutes(p.start);
      if (prefStart !== slotStart) continue;
    }
    return p.pref;
  }
  return 0;
}

// ── Parse special rules from free-text into structured data ───
// Recognizes:
//   "Prohibited from teaching at same time as <FacultyKey>"
//   "Prefers not to teach back-to-back"
function parseSpecialRules(specialRules) {
  const prohibitedPairs = [];  // [{facultyA, facultyB}]
  const noBackToBack = [];     // [facultyKey]

  for (const sr of specialRules) {
    const rule = sr.rule || '';
    const faculty = sr.faculty || '';

    // "Prohibited from teaching at same time as Doe_J"
    const prohibMatch = rule.match(/prohibited\s+from\s+teaching\s+at\s+same\s+time\s+as\s+(\S+)/i);
    if (prohibMatch) {
      prohibitedPairs.push({ facultyA: faculty, facultyB: prohibMatch[1] });
      continue;
    }

    // "Prefers not to teach back-to-back"
    if (/prefers?\s+not\s+to\s+teach\s+back[- ]?to[- ]?back/i.test(rule)) {
      noBackToBack.push(faculty);
      continue;
    }
  }

  return { prohibitedPairs, noBackToBack };
}

// ── Check if a faculty key matches a course's instructors ─────
// key like "Sestito_L" matches instructor {last:"Sestito", first:"Luke"}
function facultyKeyMatchesCourse(facKey, course) {
  if (!course.instructors) return false;
  for (const inst of course.instructors) {
    if (!inst.last || inst.last.toLowerCase() === 'staff') continue;
    // Exact key match
    if (inst.first) {
      const full = `${inst.last}_${inst.first.charAt(0)}`;
      if (full === facKey) return true;
    }
    // Last-name-only match
    if (inst.last === facKey) return true;
    // Also handle facKey being "Last_X" matching inst.last == "Last"
    const parts = facKey.split('_');
    if (parts[0] === inst.last) {
      if (!parts[1]) return true;
      if (inst.first && inst.first.charAt(0).toUpperCase() === parts[1].toUpperCase()) return true;
    }
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════
//  MAIN OPTIMIZER
// ═══════════════════════════════════════════════════════════════

function optimizeSchedule(courses, frozen, slots, facultyPrefs, weights) {
  const semesterMap   = buildSemesterMap();
  const conflictGraph = buildConflictGraph(semesterMap);

  const preferences  = (facultyPrefs && facultyPrefs.preferences) || new Map();
  const specialRules = (facultyPrefs && facultyPrefs.specialRules) || [];
  const parsedRules  = parseSpecialRules(specialRules);

  // Default weights
  const W = {
    cohortConflict:        (weights && weights.cohortConflict)        || 5,
    facultyPref:           (weights && weights.facultyPref)           || 5,
    singleSectionAfternoon:(weights && weights.singleSectionAfternoon)|| 5,
    backToBack:            (weights && weights.backToBack)            || 5,
    specialConstraints:    (weights && weights.specialConstraints)    || 5,
  };

  // ── Pre-compute frozen course time info ─────────────────────
  const frozenTimes = frozen.map(f => ({
    ...f,
    days:     f.days || expandDayPattern(f.dayPattern),
    startMin: timeToMinutes(f.startTime),
    endMin:   timeToMinutes(f.endTime),
    isExternal: true,
  }));

  // ── Build slot lookup by format ─────────────────────────────
  const slotsByFormat = new Map();
  for (const s of slots) {
    const fmt = s.format || '';
    if (!slotsByFormat.has(fmt)) slotsByFormat.set(fmt, []);
    slotsByFormat.get(fmt).push(s);
  }

  // ── Pre-compute: which courses are single-section required ──
  const sectionCounts = new Map(); // courseId → count of sections
  for (const c of courses) {
    const cid = c.courseId;
    sectionCounts.set(cid, (sectionCounts.get(cid) || 0) + 1);
  }

  // ── Pre-compute pair groups ─────────────────────────────────
  const pairGroupMap = new Map(); // pairGroup → [course indices in toAssign]
  // Built after sorting below

  // ── Faculty prohibited slot sets (pref = -3) ────────────────
  // Map<facultyKey, Set<slotIndex>>
  const prohibitedSlots = new Map();
  for (const [faculty, prefs] of preferences) {
    for (const p of prefs) {
      if (p.pref !== -3) continue;
      // Find all slots matching this prohibition
      for (const s of slots) {
        if (p.format && p.format !== s.format) continue;
        if (p.day) {
          const prefDays = expandDayPattern(p.day);
          if (!prefDays.some(d => s.days.includes(d))) continue;
        }
        if (p.start && timeToMinutes(p.start) !== timeToMinutes(s.startTime)) continue;
        if (!prohibitedSlots.has(faculty)) prohibitedSlots.set(faculty, new Set());
        prohibitedSlots.get(faculty).add(s.index);
      }
    }
  }

  // ── Separate locked vs to-assign ────────────────────────────
  const toAssign = courses.filter(c => !c.locked);
  const locked   = courses.filter(c => c.locked);

  // ── Sort by most constrained first ──────────────────────────
  toAssign.sort((a, b) => {
    // Courses with fewer compatible slots go first
    const aSlots = (slotsByFormat.get(a.mode) || []).length;
    const bSlots = (slotsByFormat.get(b.mode) || []).length;
    if (aSlots !== bSlots) return aSlots - bSlots;
    // Then by more conflict graph edges
    const aConf = (conflictGraph.get(a.courseId) || new Set()).size;
    const bConf = (conflictGraph.get(b.courseId) || new Set()).size;
    return bConf - aConf;
  });

  // Build pair group index (after sorting)
  for (let i = 0; i < toAssign.length; i++) {
    const pg = toAssign[i].pairGroup;
    if (!pg) continue;
    if (!pairGroupMap.has(pg)) pairGroupMap.set(pg, []);
    pairGroupMap.get(pg).push(i);
  }

  // ── Build linked-section map (pair group + same section = must share slot) ─
  // Maps toAssign index → partner toAssign index (bidirectional)
  const linkedSectionPartner = new Map();
  for (const [, indices] of pairGroupMap) {
    // Group by section within this pair group
    const bySection = new Map();
    for (const idx of indices) {
      const sec = toAssign[idx].section;
      if (!bySection.has(sec)) bySection.set(sec, []);
      bySection.get(sec).push(idx);
    }
    // For each section with exactly 2 courses, link them
    for (const [, sectionIndices] of bySection) {
      if (sectionIndices.length === 2) {
        linkedSectionPartner.set(sectionIndices[0], sectionIndices[1]);
        linkedSectionPartner.set(sectionIndices[1], sectionIndices[0]);
      }
      // For >2 courses with same section in same pair group, chain them all
      if (sectionIndices.length > 2) {
        for (let i = 0; i < sectionIndices.length; i++) {
          for (let j = i + 1; j < sectionIndices.length; j++) {
            // Store only the first partner (primary link)
            if (!linkedSectionPartner.has(sectionIndices[i])) {
              linkedSectionPartner.set(sectionIndices[i], sectionIndices[j]);
            }
            if (!linkedSectionPartner.has(sectionIndices[j])) {
              linkedSectionPartner.set(sectionIndices[j], sectionIndices[i]);
            }
          }
        }
      }
    }
  }

  // ── Build compatible slots per course and sort by pref ──────
  // compatSlots[i] = array of slot indices sorted by faculty preference (best first)
  const compatSlots = toAssign.map(course => {
    const fmt = course.mode || '';
    const available = slotsByFormat.get(fmt) || [];
    // Score each slot by faculty preference (higher = better)
    const scored = available.map(s => ({
      slotIdx: s.index,
      prefScore: matchFacultyPref(course, s, preferences),
    }));
    // Sort: highest preference first (try preferred slots first for faster convergence)
    scored.sort((a, b) => b.prefScore - a.prefScore);
    return scored.map(s => s.slotIdx);
  });

  // ── Slot index → slot object lookup ─────────────────────────
  const slotLookup = new Map();
  for (const s of slots) {
    slotLookup.set(s.index, s);
  }

  // ── Assignment state ────────────────────────────────────────
  const assignment = new Array(toAssign.length).fill(null);
  let bestAssignment = null;
  let bestScore = Infinity;
  let iterations = 0;
  let itersSinceImproved = 0;

  // ── Helper: get slot for an assigned course ─────────────────
  function getSlot(idx) {
    if (assignment[idx] === null) return null;
    return slotLookup.get(assignment[idx]) || null;
  }

  function getSlotByIndex(slotIdx) {
    return slotLookup.get(slotIdx) || null;
  }

  // ── HARD CONSTRAINT CHECK ───────────────────────────────────
  function isValid(courseIdx, slotIdx) {
    const course = toAssign[courseIdx];
    const slot = getSlotByIndex(slotIdx);
    if (!slot) return false;

    // H6. Mode matching — course mode must match slot format
    if (course.mode && slot.format && course.mode !== slot.format) return false;

    const courseDays = slot.days;
    const courseStart = slot.startTime;
    const courseEnd   = slot.endTime;

    const courseInstructors = getAllInstructorKeys(course);

    // H1. Instructor not double-booked (check all instructors, "Staff" exempt)
    // Exception: pair-group partners (7-week courses) can share a slot with the same instructor
    if (courseInstructors.length > 0) {
      // Check against already-assigned dept courses
      for (let i = 0; i < courseIdx; i++) {
        if (assignment[i] === null) continue;
        const other = toAssign[i];
        // Skip pair-group partners — 7-week courses don't actually meet at the same time
        if (course.pairGroup && other.pairGroup && course.pairGroup === other.pairGroup) continue;
        const otherSlot = getSlot(i);
        if (!otherSlot) continue;

        const otherKeys = getAllInstructorKeys(other);
        // Check if any instructor overlaps
        const shared = courseInstructors.some(k => otherKeys.includes(k));
        if (!shared) continue;

        if (timesOverlap(courseDays, courseStart, courseEnd,
                         otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
          return false;
        }
      }

      // Check against locked dept courses
      for (const lk of locked) {
        // Skip pair-group partners
        if (course.pairGroup && lk.pairGroup && course.pairGroup === lk.pairGroup) continue;
        const lkSlot = getSlotByIndex(lk.slotIndex);
        if (!lkSlot) continue;
        const lkKeys = getAllInstructorKeys(lk);
        const shared = courseInstructors.some(k => lkKeys.includes(k));
        if (!shared) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
          return false;
        }
      }

      // Check against frozen (external) courses
      for (const f of frozenTimes) {
        const fKeys = getAllInstructorKeys(f);
        const shared = courseInstructors.some(k => fKeys.includes(k));
        if (!shared) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         f.days, f.startTime, f.endTime)) {
          return false;
        }
      }
    }

    // H3. Sections of same course don't overlap
    // (unless altWeeks — alternating week labs CAN share a slot)
    if (!course.altWeeks) {
      for (let i = 0; i < courseIdx; i++) {
        if (assignment[i] === null) continue;
        const other = toAssign[i];
        if (other.courseId !== course.courseId) continue;
        if (other.altWeeks) continue; // alt-week partner can share
        const otherSlot = getSlot(i);
        if (!otherSlot) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
          return false;
        }
      }
      // Also check locked same-course sections
      for (const lk of locked) {
        if (lk.courseId !== course.courseId) continue;
        if (lk.altWeeks) continue;
        const lkSlot = getSlotByIndex(lk.slotIndex);
        if (!lkSlot) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
          return false;
        }
      }
    }

    // H7. Linked-section constraint: paired courses with same section must share slot
    if (linkedSectionPartner.has(courseIdx)) {
      const partnerIdx = linkedSectionPartner.get(courseIdx);
      if (assignment[partnerIdx] !== null && assignment[partnerIdx] !== slotIdx) {
        return false; // Partner already assigned to a different slot
      }
    }

    // H4. Faculty prohibited slots (pref = -3)
    for (const instKey of courseInstructors) {
      const prohibited = findProhibitedSlots(instKey);
      if (prohibited && prohibited.has(slotIdx)) return false;
    }

    // H5. Special rules: "Prohibited from teaching at same time as X"
    for (const pair of parsedRules.prohibitedPairs) {
      const courseMatchesA = facultyKeyMatchesCourse(pair.facultyA, course);
      const courseMatchesB = facultyKeyMatchesCourse(pair.facultyB, course);
      if (!courseMatchesA && !courseMatchesB) continue;

      const otherFacKey = courseMatchesA ? pair.facultyB : pair.facultyA;

      // Check all assigned courses for the other faculty
      for (let i = 0; i < courseIdx; i++) {
        if (assignment[i] === null) continue;
        const other = toAssign[i];
        if (!facultyKeyMatchesCourse(otherFacKey, other)) continue;
        const otherSlot = getSlot(i);
        if (!otherSlot) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
          return false;
        }
      }
      // Check locked
      for (const lk of locked) {
        if (!facultyKeyMatchesCourse(otherFacKey, lk)) continue;
        const lkSlot = getSlotByIndex(lk.slotIndex);
        if (!lkSlot) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
          return false;
        }
      }
      // Check frozen
      for (const f of frozenTimes) {
        if (!facultyKeyMatchesCourse(otherFacKey, f)) continue;
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         f.days, f.startTime, f.endTime)) {
          return false;
        }
      }
    }

    return true;
  }

  // Helper to look up prohibited slots for a faculty key
  function findProhibitedSlots(instKey) {
    if (prohibitedSlots.has(instKey)) return prohibitedSlots.get(instKey);
    const lastName = instKey.split('_')[0];
    if (prohibitedSlots.has(lastName)) return prohibitedSlots.get(lastName);
    return null;
  }


  // ── SOFT CONSTRAINT SCORING (lower = better) ────────────────
  function scoreAssignment() {
    let score = 0;
    const allAssigned = collectAllAssigned();

    // S1. Cohort conflict: courses in same program-semester overlap
    score += scoreCohortConflicts(allAssigned);

    // S2. Faculty preference penalties
    score += scoreFacultyPrefs(allAssigned);

    // S3. Single-section afternoon penalty
    score += scoreSingleSectionAfternoon(allAssigned);

    // S4. Back-to-back same course
    score += scoreBackToBack(allAssigned);

    // S5. 7-week pair mismatch
    score += scorePairGroups();

    // S6. Lab-lecture same day
    score += scoreLabLectureSameDay(allAssigned);

    return score;
  }

  // Collect all assigned items (toAssign with slots + locked with slots + frozen)
  function collectAllAssigned() {
    const result = [];
    for (let i = 0; i < toAssign.length; i++) {
      if (assignment[i] === null) continue;
      const s = getSlot(i);
      if (!s) continue;
      result.push({ course: toAssign[i], slot: s, isFrozen: false });
    }
    for (const lk of locked) {
      const s = getSlotByIndex(lk.slotIndex);
      if (!s) continue;
      result.push({ course: lk, slot: s, isFrozen: false });
    }
    for (const f of frozenTimes) {
      result.push({
        course: f,
        slot: { days: f.days, startTime: f.startTime, endTime: f.endTime, format: f.mode || '' },
        isFrozen: true,
      });
    }
    return result;
  }

  // S1: Cohort conflict scoring
  function scoreCohortConflicts(allAssigned) {
    let penalty = 0;
    for (let i = 0; i < allAssigned.length; i++) {
      for (let j = i + 1; j < allAssigned.length; j++) {
        const a = allAssigned[i], b = allAssigned[j];
        if (a.course.courseId === b.course.courseId) continue;

        const conflicts = conflictGraph.get(a.course.courseId);
        if (!conflicts || !conflicts.has(b.course.courseId)) continue;

        if (!timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                          b.slot.days, b.slot.startTime, b.slot.endTime)) continue;

        // Find the highest-severity overlap across shared program-semesters
        const aInfo = getCourseInfo(a.course.courseId);
        const bInfo = getCourseInfo(b.course.courseId);
        if (!aInfo || !bInfo || !aInfo.semesters || !bInfo.semesters) {
          penalty += W.cohortConflict * 10;
          continue;
        }

        // Check if either course is an elective (only penalize Jr/Sr)
        const aIsElective = aInfo.isPlaceholder || /ELEC/.test(a.course.courseId);
        const bIsElective = bInfo.isPlaceholder || /ELEC/.test(b.course.courseId);
        const eitherElective = aIsElective || bIsElective;

        // Check if either course is single-section (amplified penalty)
        const aCount = sectionCounts.get(a.course.courseId) || 1;
        const bCount = sectionCounts.get(b.course.courseId) || 1;
        const singleSectionMultiplier = (aCount === 1 || bCount === 1) ? 1.5 : 1;

        let maxPenalty = 0;
        for (const [prog, sem] of Object.entries(aInfo.semesters)) {
          if (bInfo.semesters[prog] !== sem) continue;
          const year = semToYear(sem);
          // Elective courses only penalize against Jr/Sr cohorts
          if (eitherElective && year < 3) continue;
          let yearWeight;
          switch (year) {
            case 4: yearWeight = W.cohortConflict * 12; break;
            case 3: yearWeight = W.cohortConflict * 10; break;
            case 2: yearWeight = W.cohortConflict * 8;  break;
            default: yearWeight = W.cohortConflict * 6; break;
          }
          // Amplify if either course has only 1 section (students can't avoid it)
          yearWeight = Math.round(yearWeight * singleSectionMultiplier);
          if (yearWeight > maxPenalty) maxPenalty = yearWeight;
        }
        penalty += maxPenalty;
      }
    }
    return penalty;
  }

  // S2: Faculty preference penalty
  function scoreFacultyPrefs(allAssigned) {
    let penalty = 0;
    for (const a of allAssigned) {
      if (a.isFrozen) continue;
      const pref = matchFacultyPref(a.course, a.slot, preferences);
      // Negative prefs add penalty (pref=-2 → penalty = W×3×2)
      if (pref < 0) {
        penalty += W.facultyPref * 3 * Math.abs(pref);
      }
      // Positive prefs reduce penalty (bonus)
      if (pref > 0) {
        penalty -= W.facultyPref * pref;
      }
    }
    return penalty;
  }

  // S3: Single-section afternoon penalty
  function scoreSingleSectionAfternoon(allAssigned) {
    let penalty = 0;
    const AFTERNOON_CUTOFF = timeToMinutes('14:30');
    for (const a of allAssigned) {
      if (a.isFrozen) continue;
      const cid = a.course.courseId;
      const info = getCourseInfo(cid);
      if (!info) continue;
      // Must be a required course (not placeholder/elective) with only 1 section
      if (info.isPlaceholder) continue;
      const count = sectionCounts.get(cid) || 1;
      if (count > 1) continue;
      const startMin = timeToMinutes(a.slot.startTime);
      if (startMin >= AFTERNOON_CUTOFF) {
        penalty += W.singleSectionAfternoon * 8;
      }
    }
    return penalty;
  }

  // S4: Back-to-back same course
  function scoreBackToBack(allAssigned) {
    let penalty = 0;
    // Group by instructor
    const byInstructor = new Map();
    for (const a of allAssigned) {
      if (a.isFrozen) continue;
      const key = getInstructorKey(a.course);
      if (!key) continue;
      if (!byInstructor.has(key)) byInstructor.set(key, []);
      byInstructor.get(key).push(a);
    }

    const noB2BSet = new Set(parsedRules.noBackToBack);

    for (const [instKey, items] of byInstructor) {
      // Find pairs of same courseId
      const byCourseId = new Map();
      for (const a of items) {
        const cid = a.course.courseId;
        if (!byCourseId.has(cid)) byCourseId.set(cid, []);
        byCourseId.get(cid).push(a);
      }

      const prefersNoB2B = noB2BSet.has(instKey) ||
                           noB2BSet.has(instKey.split('_')[0]);

      for (const [, sections] of byCourseId) {
        if (sections.length < 2) continue;
        // Check all pairs for back-to-back
        for (let i = 0; i < sections.length; i++) {
          for (let j = i + 1; j < sections.length; j++) {
            const a = sections[i], b = sections[j];
            const isB2B = areBackToBack(a.slot, b.slot);
            if (prefersNoB2B) {
              // Inverted: penalty if back-to-back, bonus if not
              if (isB2B) {
                penalty += W.backToBack * 2;
              } else {
                penalty -= W.backToBack * 2;
              }
            } else {
              // Normal: bonus if back-to-back, penalty if not
              if (isB2B) {
                penalty -= W.backToBack * 2;
              } else {
                penalty += W.backToBack * 2;
              }
            }
          }
        }
      }
    }
    return penalty;
  }

  // Check if two slots are back-to-back (on any shared day, <=15 min gap)
  function areBackToBack(slotA, slotB) {
    const sharedDays = slotA.days.filter(d => slotB.days.includes(d));
    if (sharedDays.length === 0) return false;
    const endA   = timeToMinutes(slotA.endTime);
    const startB = timeToMinutes(slotB.startTime);
    const endB   = timeToMinutes(slotB.endTime);
    const startA = timeToMinutes(slotA.startTime);
    // A then B, or B then A
    return (startB - endA >= 0 && startB - endA <= 15) ||
           (startA - endB >= 0 && startA - endB <= 15);
  }

  // S5: 7-week pair mismatch
  function scorePairGroups() {
    let penalty = 0;
    for (const [, indices] of pairGroupMap) {
      if (indices.length < 2) continue;
      // All courses in the pair group should have the same slot
      const firstSlotIdx = assignment[indices[0]];
      for (let k = 1; k < indices.length; k++) {
        const thisSlotIdx = assignment[indices[k]];
        if (firstSlotIdx === null || thisSlotIdx === null) {
          penalty += W.specialConstraints * 15;
        } else if (firstSlotIdx !== thisSlotIdx) {
          penalty += W.specialConstraints * 15;
        }
      }
    }
    return penalty;
  }

  // S6: Lab-lecture same day (minor penalty)
  function scoreLabLectureSameDay(allAssigned) {
    let penalty = 0;
    for (const a of allAssigned) {
      if (!a.course.linkedTo) continue;
      // Find the linked lecture
      const lecture = allAssigned.find(x =>
        x.course.code === a.course.linkedTo && !x.isFrozen
      );
      if (!lecture) continue;
      const sharedDays = a.slot.days.filter(d => lecture.slot.days.includes(d));
      if (sharedDays.length > 0) {
        penalty += W.specialConstraints * 1;
      }
    }
    return penalty;
  }


  // ── BACKTRACKING SOLVER ─────────────────────────────────────
  function solve(idx) {
    iterations++;
    itersSinceImproved++;
    if (iterations > MAX_ITERATIONS) return;
    if (itersSinceImproved > STALE_LIMIT && bestScore < Infinity) return;

    if (idx === toAssign.length) {
      const score = scoreAssignment();
      if (score < bestScore) {
        bestScore = score;
        bestAssignment = [...assignment];
        itersSinceImproved = 0;
      }
      if (score <= 0) return; // Perfect or better — stop early
      return;
    }

    const slotsForCourse = compatSlots[idx];

    for (let s = 0; s < slotsForCourse.length; s++) {
      const slotIdx = slotsForCourse[s];
      if (!isValid(idx, slotIdx)) continue;
      assignment[idx] = slotIdx;

      solve(idx + 1);
      if (bestScore <= 0) return;
      if (iterations > MAX_ITERATIONS) return;
      if (itersSinceImproved > STALE_LIMIT && bestScore < Infinity) return;

      assignment[idx] = null;
    }

    // If no slot works, skip this course and continue
    if (assignment[idx] === null) {
      solve(idx + 1);
    }
  }


  // ── RUN SOLVER ──────────────────────────────────────────────
  solve(0);

  // Apply best assignment
  if (bestAssignment) {
    for (let i = 0; i < toAssign.length; i++) {
      toAssign[i].slotIndex = bestAssignment[i];
    }
  }

  // ── BUILD RESULT ────────────────────────────────────────────
  const scheduled   = [];
  const unscheduled = [];

  // Dept courses (locked + assigned)
  for (const course of courses) {
    if (course.slotIndex === null && !course.locked) {
      unscheduled.push(course);
      continue;
    }
    const slot = getSlotByIndex(course.slotIndex);
    if (!slot) {
      unscheduled.push(course);
      continue;
    }
    scheduled.push({
      course,
      slot,
      info: getCourseInfo(course.courseId),
    });
  }

  // Frozen (external) courses
  for (const f of frozen) {
    scheduled.push({
      course: {
        ...f,
        isExternal: true,
        locked:     true,
      },
      slot: {
        dayPattern: f.dayPattern,
        startTime:  f.startTime,
        endTime:    f.endTime,
        days:       f.days || expandDayPattern(f.dayPattern),
        format:     f.mode || '',
      },
      info: getCourseInfo(f.courseId),
    });
  }

  // ── BUILD CONSTRAINT REPORT ─────────────────────────────────
  const constraintReport = buildConstraintReport(scheduled, conflictGraph, semesterMap);

  // ── BUILD STUDENT ANALYSIS ──────────────────────────────────
  const studentAnalysis = buildStudentAnalysis(scheduled, semesterMap);

  // ── DETECT CONFLICTS (legacy list) ──────────────────────────
  const conflicts = detectConflicts(scheduled, conflictGraph);

  return {
    scheduled,
    unscheduled,
    conflicts,
    score:      bestScore === Infinity ? -1 : bestScore,
    iterations,
    constraintReport,
    studentAnalysis,
  };
}


// ═══════════════════════════════════════════════════════════════
//  CONSTRAINT REPORT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildConstraintReport(scheduled, conflictGraph, semesterMap) {
  const report = {
    cohortConflicts:          [],
    facultyPrefScore:         0,
    facultyPrefMax:           0,
    singleSectionViolations:  [],
    backToBackPairs:          [],
    specialRuleViolations:    [],
    hardViolations:           [],
  };

  // ── Cohort conflicts ────────────────────────────────────────
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i], b = scheduled[j];
      if (a.course.courseId === b.course.courseId) continue;

      const conflicts = conflictGraph.get(a.course.courseId);
      if (!conflicts || !conflicts.has(b.course.courseId)) continue;

      if (!timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                        b.slot.days, b.slot.startTime, b.slot.endTime)) continue;

      const aInfo = a.info || getCourseInfo(a.course.courseId);
      const bInfo = b.info || getCourseInfo(b.course.courseId);
      if (!aInfo || !bInfo || !aInfo.semesters || !bInfo.semesters) continue;

      for (const [prog, sem] of Object.entries(aInfo.semesters)) {
        if (bInfo.semesters[prog] !== sem) continue;
        const year = semToYear(sem);
        let severity;
        switch (year) {
          case 4: severity = 'critical'; break;
          case 3: severity = 'high';     break;
          case 2: severity = 'medium';   break;
          default: severity = 'low';     break;
        }
        report.cohortConflicts.push({
          courseA:  a.course.code,
          courseB:  b.course.code,
          program: prog,
          semester: sem,
          severity,
        });
      }
    }
  }

  // ── Faculty preference score ────────────────────────────────
  // (computed externally when preferences are available)

  // ── Single-section afternoon ────────────────────────────────
  const AFTERNOON_CUTOFF = timeToMinutes('14:30');
  const sectionCounts = new Map();
  for (const item of scheduled) {
    if (item.course.isExternal) continue;
    const cid = item.course.courseId;
    sectionCounts.set(cid, (sectionCounts.get(cid) || 0) + 1);
  }
  for (const item of scheduled) {
    if (item.course.isExternal) continue;
    const cid = item.course.courseId;
    const info = item.info || getCourseInfo(cid);
    if (!info || info.isPlaceholder) continue;
    if ((sectionCounts.get(cid) || 1) > 1) continue;
    if (timeToMinutes(item.slot.startTime) >= AFTERNOON_CUTOFF) {
      report.singleSectionViolations.push({
        course: item.course.code,
        time:   item.slot.startTime,
      });
    }
  }

  // ── Hard violations: instructor double-booking ──────────────
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i], b = scheduled[j];
      const aKeys = getAllInstructorKeys(a.course);
      const bKeys = getAllInstructorKeys(b.course);
      if (aKeys.length === 0 || bKeys.length === 0) continue;
      const shared = aKeys.some(k => bKeys.includes(k));
      if (!shared) continue;
      if (timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                        b.slot.days, b.slot.startTime, b.slot.endTime)) {
        report.hardViolations.push({
          type: 'instructor_double_booked',
          courses: [a.course.code, b.course.code],
          instructor: aKeys.find(k => bKeys.includes(k)),
        });
      }
    }
  }

  return report;
}


// ═══════════════════════════════════════════════════════════════
//  STUDENT ANALYSIS BUILDER
// ═══════════════════════════════════════════════════════════════

function buildStudentAnalysis(scheduled, semesterMap) {
  const cohorts = [];

  for (const [key, courseIds] of semesterMap) {
    const [program, semStr] = key.split(':');
    const semester = parseInt(semStr, 10);
    const year = semToYear(semester);

    // Find scheduled items for courses in this cohort
    const cohortCourses = [];
    const cohortConflicts = [];

    for (const cid of courseIds) {
      const items = scheduled.filter(s => s.course.courseId === cid);
      for (const item of items) {
        cohortCourses.push({
          code:  item.course.code,
          courseId: cid,
          slot:  `${item.slot.dayPattern || ''} ${item.slot.startTime}-${item.slot.endTime}`,
        });
      }
    }

    // Find overlaps within this cohort
    const cohortScheduled = scheduled.filter(s => courseIds.has(s.course.courseId));
    for (let i = 0; i < cohortScheduled.length; i++) {
      for (let j = i + 1; j < cohortScheduled.length; j++) {
        const a = cohortScheduled[i], b = cohortScheduled[j];
        if (a.course.courseId === b.course.courseId) continue;
        if (timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                          b.slot.days, b.slot.startTime, b.slot.endTime)) {
          cohortConflicts.push({
            courseA: a.course.code,
            courseB: b.course.code,
          });
        }
      }
    }

    cohorts.push({
      program,
      semester,
      year,
      courses:   cohortCourses,
      conflicts: cohortConflicts,
    });
  }

  return { cohorts };
}


// ═══════════════════════════════════════════════════════════════
//  CONFLICT DETECTION (legacy format)
// ═══════════════════════════════════════════════════════════════

function detectConflicts(scheduled, conflictGraph) {
  const conflicts = [];

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i], b = scheduled[j];

      // Skip same course (different sections)
      if (a.course.courseId === b.course.courseId) continue;
      // Skip two externals
      if (a.course.isExternal && b.course.isExternal) continue;

      const overlaps = timesOverlap(
        a.slot.days, a.slot.startTime, a.slot.endTime,
        b.slot.days, b.slot.startTime, b.slot.endTime
      );
      if (!overlaps) continue;

      // Instructor conflict
      const aKeys = getAllInstructorKeys(a.course);
      const bKeys = getAllInstructorKeys(b.course);
      const sharedInst = aKeys.find(k => bKeys.includes(k));
      if (sharedInst) {
        conflicts.push({
          type: 'instructor',
          courses:    [a.course.code, b.course.code],
          sections:   [a.course.section, b.course.section],
          instructor: sharedInst,
          detail:     `${sharedInst} teaches ${a.course.code} and ${b.course.code} at overlapping times`,
        });
      }

      // Student conflict (same semester)
      const aConflicts = conflictGraph.get(a.course.courseId);
      if (aConflicts && aConflicts.has(b.course.courseId)) {
        const aInfo = a.info, bInfo = b.info;
        const sharedSemesters = [];
        if (aInfo && bInfo && aInfo.semesters && bInfo.semesters) {
          for (const [prog, sem] of Object.entries(aInfo.semesters)) {
            if (bInfo.semesters[prog] === sem) {
              sharedSemesters.push(`${prog} Sem ${sem}`);
            }
          }
        }
        conflicts.push({
          type: 'student',
          courses:  [a.course.code, b.course.code],
          sections: [a.course.section, b.course.section],
          detail:   `${a.course.code} and ${b.course.code} overlap — both required in ${sharedSemesters.join(', ')}`,
        });
      }
    }
  }

  return conflicts;
}


// ═══════════════════════════════════════════════════════════════
//  FACULTY LOADS
// ═══════════════════════════════════════════════════════════════

function computeFacultyLoads(scheduled) {
  const loads = new Map();

  for (const item of scheduled) {
    if (item.course.isExternal) continue;

    // Use primary instructor name
    const instKey = getInstructorKey(item.course);
    const name = instKey || (item.course.instructors && item.course.instructors[0]
      ? item.course.instructors[0].last
      : 'Unknown');

    if (!loads.has(name)) {
      loads.set(name, {
        instructor:   name,
        credits:      0,
        tlc:          0,
        contactHours: 0,
        preps:        new Set(),
        courses:      [],
        pctLoad:      0,
      });
    }
    const load = loads.get(name);

    // Use facultyCredits from the course (not info.credits)
    const fc = item.course.facultyCredits || 0;
    load.credits += fc;

    // TLC: use explicit tlc field if set, otherwise default to studentCredits
    const tlcValue = (item.course.tlc != null) ? item.course.tlc : (item.course.studentCredits || 0);
    load.tlc += tlcValue;

    // Accumulate pctLoad if available
    if (item.course.pctLoad) {
      load.pctLoad += item.course.pctLoad;
    }

    // Contact hours = scheduled hours per week
    const duration = timeToMinutes(item.slot.endTime) - timeToMinutes(item.slot.startTime);
    const daysPerWeek = (item.slot.days || []).length;
    load.contactHours += (duration * daysPerWeek) / 60;

    // Preps: lab shares prep with lecture
    const baseCode = (item.course.code || '').replace(/L$/, '');
    load.preps.add(baseCode);
    load.courses.push((item.course.code || '') + '-' + (item.course.section || '01'));
  }

  return [...loads.values()].map(l => ({
    ...l,
    preps:   l.preps.size,
    courses: l.courses,
  }));
}
