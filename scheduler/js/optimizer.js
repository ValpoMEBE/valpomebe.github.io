/* ╔══════════════════════════════════════════════════════════════╗
   ║  OPTIMIZER — IFS Constraint Satisfaction Scheduler           ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Uses Iterative Forward Search (IFS) with Conflict-Based    ║
   ║  Statistics (CBS) and Great Deluge to assign courses to      ║
   ║  time slots while respecting hard constraints and            ║
   ║  minimizing weighted soft constraint violations.             ║
   ║                                                              ║
   ║  Depends on: parser.js (expandDayPattern, timesOverlap,      ║
   ║              timeToMinutes, minutesToTime, instructorKey,     ║
   ║              normalizeTime)                                   ║
   ║              COURSES global (injected by layout from YAML)   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Seeded PRNG (Mulberry32) ────────────────────────────────
// Produces deterministic random numbers given a seed.
// Usage: const rng = mulberry32(42); rng() → 0.0–1.0
function mulberry32(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Build semester conflict map from COURSES global ───────────
// Returns Map<string, Set<string>> where key = "PROGRAM:SEM"
// and value = set of courseIds in that program-semester.
// Only includes ME/BE programs — these are the cohorts we schedule for.
// Other engineering programs (EE, CE, CPE, ENE) share some courses but
// their scheduling is not our responsibility.
const SCHEDULER_PROGRAMS = new Set(['me', 'be_biomech', 'be_bioelec', 'be_biomed']);

function buildSemesterMap() {
  const map = new Map();
  for (const c of Object.values(COURSES)) {
    if (!c.semesters) continue;
    for (const [prog, sem] of Object.entries(c.semesters)) {
      if (!SCHEDULER_PROGRAMS.has(prog)) continue;
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
//  CONFLICT-BASED STATISTICS (CBS)
// ═══════════════════════════════════════════════════════════════

class ConflictStatistics {
  constructor(ageing) {
    this.ageing = ageing;
    // Map: "courseIdx:slotIdx" → [{causingCourse, causingSlot, counter, iteration}]
    this.assignments = new Map();
    // Map: courseIdx → [{causingCourse, causingSlot, counter, iteration}]
    this.unassignedVariables = new Map();
  }

  _ageValue(counter, recordedIter, currentIter) {
    return counter * Math.pow(this.ageing, currentIter - recordedIter);
  }

  record(iteration, unassignedIdx, unassignedSlot, causingIdx, causingSlot) {
    // Record in assignments map: keyed by the assignment that was removed
    const aKey = `${unassignedIdx}:${unassignedSlot}`;
    if (!this.assignments.has(aKey)) this.assignments.set(aKey, []);
    const aList = this.assignments.get(aKey);
    // Check if we already have this causing pair
    const existing = aList.find(e => e.causingCourse === causingIdx && e.causingSlot === causingSlot);
    if (existing) {
      existing.counter++;
      existing.iteration = iteration;
    } else {
      aList.push({ causingCourse: causingIdx, causingSlot: causingSlot, counter: 1, iteration: iteration });
    }

    // Record in unassignedVariables map: keyed by the course that was unassigned
    if (!this.unassignedVariables.has(unassignedIdx)) this.unassignedVariables.set(unassignedIdx, []);
    const uList = this.unassignedVariables.get(unassignedIdx);
    const existingU = uList.find(e => e.causingCourse === causingIdx && e.causingSlot === causingSlot);
    if (existingU) {
      existingU.counter++;
      existingU.iteration = iteration;
    } else {
      uList.push({ causingCourse: causingIdx, causingSlot: causingSlot, counter: 1, iteration: iteration });
    }
  }

  countWeightedConflicts(iteration, courseIdx, slotIdx, assignment, findConflictsFn) {
    // For each course that would be unassigned if we assign (courseIdx, slotIdx):
    // look up how many times that course's current assignment was historically unassigned
    const conflicting = findConflictsFn(courseIdx, slotIdx);
    let total = 0;
    for (const cIdx of conflicting) {
      const cSlot = assignment[cIdx];
      if (cSlot === null) continue;
      const key = `${cIdx}:${cSlot}`;
      const records = this.assignments.get(key);
      if (!records) continue;
      for (const r of records) {
        total += this._ageValue(r.counter, r.iteration, iteration);
      }
    }
    return total;
  }

  countPotentialConflicts(iteration, courseIdx, slotIdx) {
    // How many times has (courseIdx, slotIdx) been unassigned in the past?
    const key = `${courseIdx}:${slotIdx}`;
    const records = this.assignments.get(key);
    if (!records) return 0;
    let total = 0;
    for (const r of records) {
      total += this._ageValue(r.counter, r.iteration, iteration);
    }
    return total;
  }
}


// ═══════════════════════════════════════════════════════════════
//  HARD CONSTRAINT FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// Helper to look up prohibited slots for a faculty key
function findProhibitedSlotsForKey(instKey, prohibitedSlots) {
  if (prohibitedSlots.has(instKey)) return prohibitedSlots.get(instKey);
  const lastName = instKey.split('_')[0];
  if (prohibitedSlots.has(lastName)) return prohibitedSlots.get(lastName);
  return null;
}

// Check all hard constraints for assigning courseIdx to slotIdx
function isValidAssignment(courseIdx, slotIdx, assignment, ctx) {
  const { toAssign, locked, frozenTimes, slotLookup, linkedSectionPartner,
          parsedRules, prohibitedSlots } = ctx;
  const course = toAssign[courseIdx];
  const slot = slotLookup.get(slotIdx);
  if (!slot) return false;

  // H6. Mode matching
  if (course.mode && slot.format && course.mode !== slot.format) return false;

  // H8. Day compatibility: slot days must be subset of course's allowed days
  if (course.days && course.days.length > 0 && slot.days && slot.days.length > 0) {
    if (!slot.days.every(d => course.days.includes(d))) return false;
  }

  const courseDays = slot.days;
  const courseStart = slot.startTime;
  const courseEnd = slot.endTime;
  const courseInstructors = getAllInstructorKeys(course);

  // H1. Instructor not double-booked (pair-group partners exempt)
  if (courseInstructors.length > 0) {
    for (let i = 0; i < toAssign.length; i++) {
      if (i === courseIdx) continue;
      if (assignment[i] === null) continue;
      const other = toAssign[i];
      if (course.pairGroup && other.pairGroup && course.pairGroup === other.pairGroup) continue;
      const otherSlot = slotLookup.get(assignment[i]);
      if (!otherSlot) continue;
      const otherKeys = getAllInstructorKeys(other);
      if (!courseInstructors.some(k => otherKeys.includes(k))) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
        return false;
      }
    }
    for (const lk of locked) {
      if (course.pairGroup && lk.pairGroup && course.pairGroup === lk.pairGroup) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      const lkKeys = getAllInstructorKeys(lk);
      if (!courseInstructors.some(k => lkKeys.includes(k))) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
    for (const f of frozenTimes) {
      const fKeys = getAllInstructorKeys(f);
      if (!courseInstructors.some(k => fKeys.includes(k))) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       f.days, f.startTime, f.endTime)) {
        return false;
      }
    }
  }

  // H3. Sections of same course don't overlap (altWeeks exempt)
  if (!course.altWeeks) {
    for (let i = 0; i < toAssign.length; i++) {
      if (i === courseIdx) continue;
      if (assignment[i] === null) continue;
      const other = toAssign[i];
      if (other.courseId !== course.courseId) continue;
      if (other.altWeeks) continue;
      const otherSlot = slotLookup.get(assignment[i]);
      if (!otherSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
        return false;
      }
    }
    for (const lk of locked) {
      if (lk.courseId !== course.courseId) continue;
      if (lk.altWeeks) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
  }

  // H7. Linked-section constraint
  if (linkedSectionPartner.has(courseIdx)) {
    const partnerIdx = linkedSectionPartner.get(courseIdx);
    if (assignment[partnerIdx] !== null && assignment[partnerIdx] !== slotIdx) {
      return false;
    }
  }

  // H4. Faculty prohibited slots (pref = -3)
  for (const instKey of courseInstructors) {
    const prohibited = findProhibitedSlotsForKey(instKey, prohibitedSlots);
    if (prohibited && prohibited.has(slotIdx)) return false;
  }

  // H5. Special rules: "Prohibited from teaching at same time as X"
  for (const pair of parsedRules.prohibitedPairs) {
    const courseMatchesA = facultyKeyMatchesCourse(pair.facultyA, course);
    const courseMatchesB = facultyKeyMatchesCourse(pair.facultyB, course);
    if (!courseMatchesA && !courseMatchesB) continue;
    const otherFacKey = courseMatchesA ? pair.facultyB : pair.facultyA;

    for (let i = 0; i < toAssign.length; i++) {
      if (i === courseIdx) continue;
      if (assignment[i] === null) continue;
      const other = toAssign[i];
      if (!facultyKeyMatchesCourse(otherFacKey, other)) continue;
      const otherSlot = slotLookup.get(assignment[i]);
      if (!otherSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
        return false;
      }
    }
    for (const lk of locked) {
      if (!facultyKeyMatchesCourse(otherFacKey, lk)) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
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

// Returns array of currently-assigned toAssign indices that conflict with placing courseIdx at slotIdx
function findConflicts(courseIdx, slotIdx, assignment, ctx) {
  const { toAssign, locked, frozenTimes, slotLookup, linkedSectionPartner, parsedRules } = ctx;
  const course = toAssign[courseIdx];
  const slot = slotLookup.get(slotIdx);
  if (!slot) return [];

  const conflicting = [];
  const courseDays = slot.days;
  const courseStart = slot.startTime;
  const courseEnd = slot.endTime;
  const courseInstructors = getAllInstructorKeys(course);

  for (let i = 0; i < toAssign.length; i++) {
    if (i === courseIdx) continue;
    if (assignment[i] === null) continue;
    const other = toAssign[i];
    const otherSlot = slotLookup.get(assignment[i]);
    if (!otherSlot) continue;

    let isConflict = false;

    // Same instructor AND overlapping time (unless pair-group partner)
    if (courseInstructors.length > 0 &&
        !(course.pairGroup && other.pairGroup && course.pairGroup === other.pairGroup)) {
      const otherKeys = getAllInstructorKeys(other);
      if (courseInstructors.some(k => otherKeys.includes(k))) {
        if (timesOverlap(courseDays, courseStart, courseEnd,
                         otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
          isConflict = true;
        }
      }
    }

    // Same courseId AND overlapping time (unless altWeeks)
    if (!isConflict && !course.altWeeks && !other.altWeeks &&
        other.courseId === course.courseId) {
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
        isConflict = true;
      }
    }

    // Special rule: prohibited from teaching at same time
    if (!isConflict) {
      for (const pair of parsedRules.prohibitedPairs) {
        const courseMatchesA = facultyKeyMatchesCourse(pair.facultyA, course);
        const courseMatchesB = facultyKeyMatchesCourse(pair.facultyB, course);
        if (!courseMatchesA && !courseMatchesB) continue;
        const otherFacKey = courseMatchesA ? pair.facultyB : pair.facultyA;
        if (facultyKeyMatchesCourse(otherFacKey, other)) {
          if (timesOverlap(courseDays, courseStart, courseEnd,
                           otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
            isConflict = true;
            break;
          }
        }
      }
    }

    // Linked-section partner assigned to different slot
    if (!isConflict && linkedSectionPartner.has(courseIdx)) {
      const partnerIdx = linkedSectionPartner.get(courseIdx);
      if (i === partnerIdx && assignment[i] !== slotIdx) {
        isConflict = true;
      }
    }

    if (isConflict) conflicting.push(i);
  }

  return conflicting;
}


// ═══════════════════════════════════════════════════════════════
//  SOFT CONSTRAINT SCORING
// ═══════════════════════════════════════════════════════════════

// Collect all assigned items (toAssign with slots + locked with slots + frozen)
function collectAllAssigned(assignment, toAssign, locked, frozenTimes, slotLookup) {
  const result = [];
  for (let i = 0; i < toAssign.length; i++) {
    if (assignment[i] === null) continue;
    const s = slotLookup.get(assignment[i]);
    if (!s) continue;
    result.push({ course: toAssign[i], slot: s, isFrozen: false });
  }
  for (const lk of locked) {
    const s = slotLookup.get(lk.slotIndex);
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

// Check if two slots are back-to-back (on any shared day, <=15 min gap)
function areBackToBack(slotA, slotB) {
  const sharedDays = slotA.days.filter(d => slotB.days.includes(d));
  if (sharedDays.length === 0) return false;
  const endA   = timeToMinutes(slotA.endTime);
  const startB = timeToMinutes(slotB.startTime);
  const endB   = timeToMinutes(slotB.endTime);
  const startA = timeToMinutes(slotA.startTime);
  return (startB - endA >= 0 && startB - endA <= 15) ||
         (startA - endB >= 0 && startA - endB <= 15);
}

// S1: Cohort conflict scoring
function scoreCohortConflicts(allAssigned, W, conflictGraph, sectionCounts) {
  let penalty = 0;
  for (let i = 0; i < allAssigned.length; i++) {
    for (let j = i + 1; j < allAssigned.length; j++) {
      const a = allAssigned[i], b = allAssigned[j];
      if (a.course.courseId === b.course.courseId) continue;

      const conflicts = conflictGraph.get(a.course.courseId);
      if (!conflicts || !conflicts.has(b.course.courseId)) continue;

      if (!timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                        b.slot.days, b.slot.startTime, b.slot.endTime)) continue;

      const aInfo = getCourseInfo(a.course.courseId);
      const bInfo = getCourseInfo(b.course.courseId);
      if (!aInfo || !bInfo || !aInfo.semesters || !bInfo.semesters) {
        penalty += W.cohortConflict * 10;
        continue;
      }

      const aIsElective = aInfo.isPlaceholder || /ELEC/.test(a.course.courseId);
      const bIsElective = bInfo.isPlaceholder || /ELEC/.test(b.course.courseId);
      const eitherElective = aIsElective || bIsElective;

      const aCount = sectionCounts.get(a.course.courseId) || 1;
      const bCount = sectionCounts.get(b.course.courseId) || 1;
      const singleSectionMultiplier = (aCount === 1 || bCount === 1) ? 1.5 : 1;

      let maxPenalty = 0;
      for (const [prog, sem] of Object.entries(aInfo.semesters)) {
        if (bInfo.semesters[prog] !== sem) continue;
        const year = semToYear(sem);
        if (eitherElective && year < 3) continue;
        let yearWeight;
        switch (year) {
          case 4: yearWeight = W.cohortConflict * 12; break;
          case 3: yearWeight = W.cohortConflict * 10; break;
          case 2: yearWeight = W.cohortConflict * 8;  break;
          default: yearWeight = W.cohortConflict * 6; break;
        }
        yearWeight = Math.round(yearWeight * singleSectionMultiplier);
        if (yearWeight > maxPenalty) maxPenalty = yearWeight;
      }
      penalty += maxPenalty;
    }
  }
  return penalty;
}

// S2: Faculty preference penalty
// Pref scale: -3 (prohibited, handled as hard constraint), -2 (strongly dislike),
// -1 (dislike), 0 (neutral), +1 (prefer), +2 (strongly prefer).
// Negative prefs penalize proportionally; positive prefs reward proportionally.
// Symmetric scaling so the optimizer balances likes and dislikes fairly.
function scoreFacultyPrefs(allAssigned, W, preferences) {
  let penalty = 0;
  for (const a of allAssigned) {
    if (a.isFrozen) continue;
    const pref = matchFacultyPref(a.course, a.slot, preferences);
    // Symmetric: each preference point = W.facultyPref penalty/reward
    penalty -= W.facultyPref * pref;
  }
  return penalty;
}

// S3: Single-section afternoon penalty
// Single-section required courses scheduled after 2:30 PM make it harder
// for students to fit them. Lighter penalty than before — UniTime uses
// graduated penalties rather than a cliff.
function scoreSingleSectionAfternoon(allAssigned, W, sectionCounts) {
  let penalty = 0;
  const LATE_AFTERNOON = timeToMinutes('14:30');  // 2:30 PM
  const EVENING = timeToMinutes('16:00');          // 4:00 PM
  for (const a of allAssigned) {
    if (a.isFrozen) continue;
    const cid = a.course.courseId;
    const info = getCourseInfo(cid);
    if (!info) continue;
    if (info.isPlaceholder) continue;
    const count = sectionCounts.get(cid) || 1;
    if (count > 1) continue;  // Multi-section courses: students have options
    const startMin = timeToMinutes(a.slot.startTime);
    if (startMin >= EVENING) {
      penalty += W.singleSectionAfternoon * 4;    // Strong: evening is bad
    } else if (startMin >= LATE_AFTERNOON) {
      penalty += W.singleSectionAfternoon * 2;    // Moderate: late afternoon is less ideal
    }
  }
  return penalty;
}

// S4: Back-to-back same course
function scoreBackToBack(allAssigned, W, parsedRules) {
  let penalty = 0;
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
      for (let i = 0; i < sections.length; i++) {
        for (let j = i + 1; j < sections.length; j++) {
          const a = sections[i], b = sections[j];
          const isB2B = areBackToBack(a.slot, b.slot);
          if (prefersNoB2B) {
            // Faculty explicitly prefers NOT back-to-back
            if (isB2B) penalty += W.backToBack * 3;
          } else {
            // Default: mildly prefer back-to-back same-course sections (convenient)
            if (isB2B) penalty -= W.backToBack * 1;
          }
        }
      }
    }
  }
  return penalty;
}

// S5: 7-week pair mismatch
function scorePairGroups(assignment, pairGroupMap, W) {
  let penalty = 0;
  for (const [, indices] of pairGroupMap) {
    if (indices.length < 2) continue;
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

// S6: Lab-lecture same day (mild penalty if lab shares a day with its lecture)
function scoreLabLectureSameDay(allAssigned, W) {
  let penalty = 0;
  for (const a of allAssigned) {
    if (!a.course.linkedTo) continue;
    // Match by code OR courseId (linkedTo may be in either format)
    const linkedCode = a.course.linkedTo;
    const linkedId = linkedCode.replace(/-/g, '_');
    const lecture = allAssigned.find(x =>
      !x.isFrozen && (x.course.code === linkedCode || x.course.courseId === linkedId)
    );
    if (!lecture) continue;
    const sharedDays = a.slot.days.filter(d => lecture.slot.days.includes(d));
    if (sharedDays.length > 0) {
      penalty += W.specialConstraints * 1;
    }
  }
  return penalty;
}

// S_timePref: Per-course time preference scoring
// S7: Time preference from CSV (morning/afternoon/before X/after X)
// Uses 12:30 PM (750 min) as morning/afternoon boundary.
function scoreTimePref(allAssigned, W) {
  let penalty = 0;
  const MIDDAY = 750;  // 12:30 PM
  for (const a of allAssigned) {
    if (a.isFrozen || !a.course.timePref) continue;
    const pref = a.course.timePref;
    const startMin = timeToMinutes(a.slot.startTime);
    if (pref === 'morning' && startMin >= MIDDAY) penalty += W.facultyPref * 3;
    if (pref === 'afternoon' && startMin < MIDDAY) penalty += W.facultyPref * 3;
    if (pref.startsWith('before ')) {
      const cutoff = timeToMinutes(normalizeTime(pref.slice(7)));
      if (startMin >= cutoff) penalty += W.facultyPref * 4;
    }
    if (pref.startsWith('after ')) {
      const cutoff = timeToMinutes(normalizeTime(pref.slice(6)));
      if (startMin < cutoff) penalty += W.facultyPref * 4;
    }
  }
  return penalty;
}

// Total score for an assignment (lower = better)
// If decompose=true, returns { total, breakdown } instead of a number.
function scoreAssignment(assignment, ctx, decompose) {
  const allAssigned = collectAllAssigned(assignment, ctx.toAssign, ctx.locked,
                                          ctx.frozenTimes, ctx.slotLookup);

  // Heavy penalty for unassigned courses (drives IFS to place everything)
  let unassignedPenalty = 0;
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] === null) unassignedPenalty++;
  }
  unassignedPenalty *= 100;  // Each unassigned course costs 100 points

  const cohort    = scoreCohortConflicts(allAssigned, ctx.W, ctx.conflictGraph, ctx.sectionCounts);
  const faculty   = scoreFacultyPrefs(allAssigned, ctx.W, ctx.preferences);
  const afternoon = scoreSingleSectionAfternoon(allAssigned, ctx.W, ctx.sectionCounts);
  const backToBack= scoreBackToBack(allAssigned, ctx.W, ctx.parsedRules);
  const pairs     = scorePairGroups(assignment, ctx.pairGroupMap, ctx.W);
  const labDay    = scoreLabLectureSameDay(allAssigned, ctx.W);
  const timePref  = scoreTimePref(allAssigned, ctx.W);

  const total = unassignedPenalty + cohort + faculty + afternoon + backToBack + pairs + labDay + timePref;

  if (decompose) {
    return {
      total,
      breakdown: { unassigned: unassignedPenalty, cohort, faculty, afternoon, backToBack, pairs, labDay, timePref },
    };
  }
  return total;
}

// Incremental: penalty contribution of one course
function courseScoreContribution(courseIdx, assignment, ctx) {
  const { toAssign, locked, frozenTimes, slotLookup, W, conflictGraph, sectionCounts,
          preferences, parsedRules, pairGroupMap } = ctx;
  if (assignment[courseIdx] === null) return 0;

  const course = toAssign[courseIdx];
  const slot = slotLookup.get(assignment[courseIdx]);
  if (!slot) return 0;

  let penalty = 0;
  const courseInfo = getCourseInfo(course.courseId);
  const thisEntry = { course, slot, isFrozen: false };

  // Collect all other assigned items for comparison
  const others = [];
  for (let i = 0; i < toAssign.length; i++) {
    if (i === courseIdx || assignment[i] === null) continue;
    const s = slotLookup.get(assignment[i]);
    if (!s) continue;
    others.push({ course: toAssign[i], slot: s, isFrozen: false });
  }
  for (const lk of locked) {
    const s = slotLookup.get(lk.slotIndex);
    if (!s) continue;
    others.push({ course: lk, slot: s, isFrozen: false });
  }
  for (const f of frozenTimes) {
    others.push({
      course: f,
      slot: { days: f.days, startTime: f.startTime, endTime: f.endTime, format: f.mode || '' },
      isFrozen: true,
    });
  }

  // S1 contribution: cohort conflicts involving this course
  const conflicts = conflictGraph.get(course.courseId);
  if (conflicts) {
    for (const other of others) {
      if (other.course.courseId === course.courseId) continue;
      if (!conflicts.has(other.course.courseId)) continue;
      if (!timesOverlap(slot.days, slot.startTime, slot.endTime,
                        other.slot.days, other.slot.startTime, other.slot.endTime)) continue;

      const aInfo = courseInfo;
      const bInfo = getCourseInfo(other.course.courseId);
      if (!aInfo || !bInfo || !aInfo.semesters || !bInfo.semesters) {
        penalty += W.cohortConflict * 10;
        continue;
      }

      const aIsElective = aInfo.isPlaceholder || /ELEC/.test(course.courseId);
      const bIsElective = bInfo.isPlaceholder || /ELEC/.test(other.course.courseId);
      const eitherElective = aIsElective || bIsElective;

      const aCount = sectionCounts.get(course.courseId) || 1;
      const bCount = sectionCounts.get(other.course.courseId) || 1;
      const singleSectionMultiplier = (aCount === 1 || bCount === 1) ? 1.5 : 1;

      let maxPenalty = 0;
      for (const [prog, sem] of Object.entries(aInfo.semesters)) {
        if (bInfo.semesters[prog] !== sem) continue;
        const year = semToYear(sem);
        if (eitherElective && year < 3) continue;
        let yearWeight;
        switch (year) {
          case 4: yearWeight = W.cohortConflict * 12; break;
          case 3: yearWeight = W.cohortConflict * 10; break;
          case 2: yearWeight = W.cohortConflict * 8;  break;
          default: yearWeight = W.cohortConflict * 6; break;
        }
        yearWeight = Math.round(yearWeight * singleSectionMultiplier);
        if (yearWeight > maxPenalty) maxPenalty = yearWeight;
      }
      penalty += maxPenalty;
    }
  }

  // S2 contribution: faculty pref for this course (symmetric)
  const facPref = matchFacultyPref(course, slot, preferences);
  penalty -= W.facultyPref * facPref;

  // S3 contribution: single-section afternoon (graduated)
  if (courseInfo && !courseInfo.isPlaceholder) {
    const count = sectionCounts.get(course.courseId) || 1;
    if (count === 1) {
      const startMin = timeToMinutes(slot.startTime);
      const EVENING = timeToMinutes('16:00');
      const LATE_AFTERNOON = timeToMinutes('14:30');
      if (startMin >= EVENING) {
        penalty += W.singleSectionAfternoon * 4;
      } else if (startMin >= LATE_AFTERNOON) {
        penalty += W.singleSectionAfternoon * 2;
      }
    }
  }

  // S4 contribution: back-to-back (only this course's sections)
  const instKey = getInstructorKey(course);
  if (instKey) {
    const noB2BSet = new Set(parsedRules.noBackToBack);
    const prefersNoB2B = noB2BSet.has(instKey) || noB2BSet.has(instKey.split('_')[0]);
    for (const other of others) {
      if (other.isFrozen) continue;
      if (other.course.courseId !== course.courseId) continue;
      const otherInstKey = getInstructorKey(other.course);
      if (otherInstKey !== instKey) continue;
      const isB2B = areBackToBack(slot, other.slot);
      if (prefersNoB2B) {
        if (isB2B) penalty += W.backToBack * 3;
      } else {
        if (isB2B) penalty -= W.backToBack * 1;
      }
    }
  }

  // S5 contribution: pair group
  if (course.pairGroup && pairGroupMap.has(course.pairGroup)) {
    const indices = pairGroupMap.get(course.pairGroup);
    for (const k of indices) {
      if (k === courseIdx) continue;
      if (assignment[k] === null || assignment[k] !== assignment[courseIdx]) {
        penalty += W.specialConstraints * 15;
      }
    }
  }

  // S6 contribution: lab-lecture same day
  if (course.linkedTo) {
    const linkedCode = course.linkedTo;
    const linkedId = linkedCode.replace(/-/g, '_');
    const lecture = others.find(x =>
      !x.isFrozen && (x.course.code === linkedCode || x.course.courseId === linkedId)
    );
    if (lecture) {
      const sharedDays = slot.days.filter(d => lecture.slot.days.includes(d));
      if (sharedDays.length > 0) {
        penalty += W.specialConstraints * 1;
      }
    }
  }

  // S7 contribution: per-course time preference
  if (course.timePref) {
    const startMin = timeToMinutes(slot.startTime);
    const MIDDAY = 750;
    const tp = course.timePref;
    if (tp === 'morning' && startMin >= MIDDAY) penalty += W.facultyPref * 3;
    if (tp === 'afternoon' && startMin < MIDDAY) penalty += W.facultyPref * 3;
    if (tp.startsWith('before ')) {
      const cutoff = timeToMinutes(normalizeTime(tp.slice(7)));
      if (startMin >= cutoff) penalty += W.facultyPref * 4;
    }
    if (tp.startsWith('after ')) {
      const cutoff = timeToMinutes(normalizeTime(tp.slice(6)));
      if (startMin < cutoff) penalty += W.facultyPref * 4;
    }
  }

  return penalty;
}

// Estimate soft penalty for placing courseIdx at slotIdx (quick heuristic for value selection)
function estimateValuePenalty(courseIdx, slotIdx, assignment, ctx) {
  const saved = assignment[courseIdx];
  assignment[courseIdx] = slotIdx;
  const contrib = courseScoreContribution(courseIdx, assignment, ctx);
  assignment[courseIdx] = saved;
  return contrib;
}


// ═══════════════════════════════════════════════════════════════
//  VARIABLE SELECTION
// ═══════════════════════════════════════════════════════════════

function countValidSlots(courseIdx, assignment, compatSlots, ctx) {
  let count = 0;
  for (const slotIdx of compatSlots[courseIdx]) {
    if (isValidAssignment(courseIdx, slotIdx, assignment, ctx)) count++;
  }
  return count;
}

function selectVariable(assignment, unassigned, toAssign, phase, ctx, compatSlots) {
  if (unassigned.size > 0) {
    // Construction: pick most constrained unassigned course
    let best = null, bestScore = Infinity;
    for (const idx of unassigned) {
      const validSlots = countValidSlots(idx, assignment, compatSlots, ctx);
      const conflicts = (ctx.conflictGraph.get(toAssign[idx].courseId) || new Set()).size;
      const score = validSlots * 1000 - conflicts;
      if (score < bestScore || (score === bestScore && ctx.random() < 0.5)) {
        bestScore = score;
        best = idx;
      }
    }
    return best;
  }

  // Improvement: pick random assigned course weighted by penalty contribution
  const assigned = [];
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] !== null) {
      const contrib = courseScoreContribution(i, assignment, ctx);
      assigned.push({ idx: i, weight: Math.max(1, contrib) });
    }
  }
  if (assigned.length === 0) return null;
  // Roulette wheel selection
  const totalWeight = assigned.reduce((s, a) => s + a.weight, 0);
  let r = ctx.random() * totalWeight;
  for (const a of assigned) {
    r -= a.weight;
    if (r <= 0) return a.idx;
  }
  return assigned[assigned.length - 1].idx;
}


// ═══════════════════════════════════════════════════════════════
//  VALUE SELECTION
// ═══════════════════════════════════════════════════════════════

function selectValue(courseIdx, assignment, compatSlotIndices, cbs, iteration, ctx, phase) {
  const { toAssign, slotLookup } = ctx;
  const course = toAssign[courseIdx];
  const candidates = [];

  for (const slotIdx of compatSlotIndices) {
    const slot = slotLookup.get(slotIdx);
    if (!slot) continue;
    if (course.mode && slot.format && course.mode !== slot.format) continue;

    // Hard constraint check against locked/frozen (things we can't unassign)
    if (!isValidAgainstFixed(courseIdx, slotIdx, ctx)) continue;

    // Count direct conflicts with currently-assigned toAssign courses
    const directConflicts = findConflicts(courseIdx, slotIdx, assignment, ctx);
    const nConflicts = directConflicts.length;

    // CBS scores (lightweight — just map lookups)
    const pConflicts = cbs.countPotentialConflicts(iteration, courseIdx, slotIdx);

    let score;
    if (phase <= 1) {
      // Construction: prioritize fewest conflicts + CBS, skip expensive penalty estimation
      score = ctx.params.weightConflicts * nConflicts
            + ctx.params.weightPotentialConflicts * pConflicts;
      // Add faculty pref as a cheap tiebreaker
      const pref = matchFacultyPref(course, slot, ctx.preferences);
      score -= pref * 0.1;
    } else {
      // Improvement: full scoring including CBS weighted conflicts and soft penalty
      const wConflicts = cbs.countWeightedConflicts(iteration, courseIdx, slotIdx, assignment,
        (ci, si) => findConflicts(ci, si, assignment, ctx));
      const valuePenalty = estimateValuePenalty(courseIdx, slotIdx, assignment, ctx);
      score = ctx.params.weightConflicts * nConflicts
            + ctx.params.weightWeightedConflicts * wConflicts
            + ctx.params.weightPotentialConflicts * pConflicts
            + ctx.params.weightValue * valuePenalty;
    }

    candidates.push({ slotIdx, score });
  }

  if (candidates.length === 0) return null;

  const minScore = Math.min(...candidates.map(c => c.score));
  const best = candidates.filter(c => c.score === minScore);
  return best[Math.floor(ctx.random() * best.length)].slotIdx;
}

// Check hard constraints against fixed items only (locked, frozen) — not other toAssign courses
function isValidAgainstFixed(courseIdx, slotIdx, ctx) {
  const { toAssign, locked, frozenTimes, slotLookup, linkedSectionPartner,
          parsedRules, prohibitedSlots } = ctx;
  const course = toAssign[courseIdx];
  const slot = slotLookup.get(slotIdx);
  if (!slot) return false;

  // H6. Mode matching
  if (course.mode && slot.format && course.mode !== slot.format) return false;

  // H8. Day compatibility: slot days must be subset of course's allowed days
  if (course.days && course.days.length > 0 && slot.days && slot.days.length > 0) {
    if (!slot.days.every(d => course.days.includes(d))) return false;
  }

  const courseDays = slot.days;
  const courseStart = slot.startTime;
  const courseEnd = slot.endTime;
  const courseInstructors = getAllInstructorKeys(course);

  // H1 against locked
  if (courseInstructors.length > 0) {
    for (const lk of locked) {
      if (course.pairGroup && lk.pairGroup && course.pairGroup === lk.pairGroup) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      const lkKeys = getAllInstructorKeys(lk);
      if (!courseInstructors.some(k => lkKeys.includes(k))) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
    for (const f of frozenTimes) {
      const fKeys = getAllInstructorKeys(f);
      if (!courseInstructors.some(k => fKeys.includes(k))) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       f.days, f.startTime, f.endTime)) {
        return false;
      }
    }
  }

  // H3 against locked same-course sections
  if (!course.altWeeks) {
    for (const lk of locked) {
      if (lk.courseId !== course.courseId) continue;
      if (lk.altWeeks) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
  }

  // H4. Faculty prohibited slots
  for (const instKey of courseInstructors) {
    const prohibited = findProhibitedSlotsForKey(instKey, prohibitedSlots);
    if (prohibited && prohibited.has(slotIdx)) return false;
  }

  // H5 against locked and frozen
  for (const pair of parsedRules.prohibitedPairs) {
    const courseMatchesA = facultyKeyMatchesCourse(pair.facultyA, course);
    const courseMatchesB = facultyKeyMatchesCourse(pair.facultyB, course);
    if (!courseMatchesA && !courseMatchesB) continue;
    const otherFacKey = courseMatchesA ? pair.facultyB : pair.facultyA;

    for (const lk of locked) {
      if (!facultyKeyMatchesCourse(otherFacKey, lk)) continue;
      const lkSlot = slotLookup.get(lk.slotIndex);
      if (!lkSlot) continue;
      if (timesOverlap(courseDays, courseStart, courseEnd,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }
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


// ═══════════════════════════════════════════════════════════════
//  IFS SOLVER
// ═══════════════════════════════════════════════════════════════

function ifsSolver(toAssign, compatSlots, ctx, params) {
  const n = toAssign.length;
  const assignment = new Array(n).fill(null);
  const unassigned = new Set();
  for (let i = 0; i < n; i++) unassigned.add(i);

  const cbs = new ConflictStatistics(params.cbsAgeing);

  // ════════════════════════════════════════════════════════════
  // PHASE 0: GREEDY CONSTRUCTION (no conflict unassignment)
  // Assign each course to its best conflict-free slot.
  // ════════════════════════════════════════════════════════════
  // Sort indices by most constrained first
  const sortedIndices = [...Array(n).keys()].sort((a, b) => {
    const aSlots = compatSlots[a].length;
    const bSlots = compatSlots[b].length;
    if (aSlots !== bSlots) return aSlots - bSlots;
    const aConf = (ctx.conflictGraph.get(toAssign[a].courseId) || new Set()).size;
    const bConf = (ctx.conflictGraph.get(toAssign[b].courseId) || new Set()).size;
    return bConf - aConf;
  });

  for (const idx of sortedIndices) {
    let bestSlot = null;
    let bestScore = Infinity;
    for (const slotIdx of compatSlots[idx]) {
      if (!isValidAgainstFixed(idx, slotIdx, ctx)) continue;
      // Check no conflicts with already-assigned courses
      const conflicts = findConflicts(idx, slotIdx, assignment, ctx);
      if (conflicts.length > 0) continue; // skip conflicting slots
      // Score by faculty pref (higher = better, so negate)
      const slot = ctx.slotLookup.get(slotIdx);
      const pref = slot ? matchFacultyPref(toAssign[idx], slot, ctx.preferences) : 0;
      const score = -pref;
      if (score < bestScore) { bestScore = score; bestSlot = slotIdx; }
    }
    if (bestSlot !== null) {
      assignment[idx] = bestSlot;
      unassigned.delete(idx);
    }
    // Also handle linked-section partner: force to same slot
    if (bestSlot !== null && ctx.linkedSectionPartner.has(idx)) {
      const partnerIdx = ctx.linkedSectionPartner.get(idx);
      if (assignment[partnerIdx] === null) {
        assignment[partnerIdx] = bestSlot;
        unassigned.delete(partnerIdx);
      }
    }
  }

  // Compute initial score
  let totalScore = scoreAssignment(assignment, ctx);
  let bestAssignment = [...assignment];
  let bestScore = totalScore;
  let idleCount = 0;

  // Great Deluge state
  let gdBound = Infinity;
  let gdIdleCount = 0;
  let gdResets = 0;

  // ════════════════════════════════════════════════════════════
  // PHASE 1: IFS — try to place remaining unassigned courses
  // Uses conflict unassignment: assign course, unassign conflicts,
  // accept only if net unassigned count decreases.
  // ════════════════════════════════════════════════════════════
  const ifsLimit = Math.min(params.constructionStaleLimit * 10, params.maxIterations / 4);
  for (let iter = 0; iter < ifsLimit && unassigned.size > 0; iter++) {
    // Pick most-constrained unassigned course
    let bestIdx = null, bestConstraint = -Infinity;
    for (const idx of unassigned) {
      const conf = (ctx.conflictGraph.get(toAssign[idx].courseId) || new Set()).size;
      if (conf > bestConstraint || (conf === bestConstraint && ctx.random() < 0.3)) {
        bestConstraint = conf;
        bestIdx = idx;
      }
    }
    if (bestIdx === null) break;

    // Find best slot (fewest conflicts, CBS-guided)
    let bestSlot = null, bestConflictCount = Infinity, bestCbsScore = Infinity;
    for (const slotIdx of compatSlots[bestIdx]) {
      if (!isValidAgainstFixed(bestIdx, slotIdx, ctx)) continue;
      const conflicts = findConflicts(bestIdx, slotIdx, assignment, ctx);
      const cbsScore = cbs.countPotentialConflicts(iter, bestIdx, slotIdx);
      // Prefer fewer conflicts, then lower CBS score
      if (conflicts.length < bestConflictCount ||
          (conflicts.length === bestConflictCount && cbsScore < bestCbsScore)) {
        bestConflictCount = conflicts.length;
        bestCbsScore = cbsScore;
        bestSlot = slotIdx;
      }
    }
    if (bestSlot === null) continue;

    // Only accept if we net-gain assigned courses (place 1, unassign ≤ 0)
    // or if we unassign just 1 to place 1 (swap)
    const conflicts = findConflicts(bestIdx, bestSlot, assignment, ctx);
    if (conflicts.length > 1) continue; // Too destructive

    // Unassign conflicts
    for (const c of conflicts) {
      cbs.record(iter, c, assignment[c], bestIdx, bestSlot);
      assignment[c] = null;
      unassigned.add(c);
    }

    // Assign
    assignment[bestIdx] = bestSlot;
    unassigned.delete(bestIdx);

    // Handle linked-section partner
    if (ctx.linkedSectionPartner.has(bestIdx)) {
      const partnerIdx = ctx.linkedSectionPartner.get(bestIdx);
      if (assignment[partnerIdx] === null) {
        assignment[partnerIdx] = bestSlot;
        unassigned.delete(partnerIdx);
      }
    }
  }

  // Recompute score after IFS phase
  totalScore = scoreAssignment(assignment, ctx);
  bestAssignment = [...assignment];
  bestScore = totalScore;

  // ════════════════════════════════════════════════════════════
  // PHASE 2: HILL CLIMBING — reassign courses to better slots
  // No conflict unassignment. Just move one course at a time.
  // Accept only if score improves or stays equal.
  // ════════════════════════════════════════════════════════════
  const hcStart = 0;
  let phase = 2;

  for (let iter = hcStart; iter < params.maxIterations; iter++) {
    if (phase === 2 && idleCount > params.hcMaxIdle) {
      phase = 3;
      gdBound = (bestScore > 0) ? bestScore * params.gdUpperBound : bestScore / params.gdUpperBound;
      gdIdleCount = 0;
      idleCount = 0;
    }

    // Pick a random assigned course (weighted by penalty contribution)
    const assignedIndices = [];
    for (let i = 0; i < n; i++) {
      if (assignment[i] !== null) assignedIndices.push(i);
    }
    if (assignedIndices.length === 0) break;
    const idx = assignedIndices[Math.floor(ctx.random() * assignedIndices.length)];

    // Try a random different valid slot (no conflict unassignment)
    const currentSlot = assignment[idx];
    const validSlots = compatSlots[idx].filter(s => {
      if (s === currentSlot) return false;
      if (!isValidAgainstFixed(idx, s, ctx)) return false;
      // Check no conflicts with other assigned courses
      const conflicts = findConflicts(idx, s, assignment, ctx);
      return conflicts.length === 0;
    });

    if (validSlots.length === 0) { idleCount++; continue; }

    // Pick best slot by CBS + faculty pref
    let bestNewSlot = validSlots[0], bestNewScore = Infinity;
    for (const s of validSlots) {
      const slot = ctx.slotLookup.get(s);
      const pref = slot ? matchFacultyPref(toAssign[idx], slot, ctx.preferences) : 0;
      const cbsP = cbs.countPotentialConflicts(iter, idx, s);
      const sc = cbsP - pref;
      if (sc < bestNewScore) { bestNewScore = sc; bestNewSlot = s; }
    }

    // Tentatively assign and score
    assignment[idx] = bestNewSlot;
    const newScore = scoreAssignment(assignment, ctx);

    let accept = false;
    if (phase === 2) {
      accept = (newScore <= totalScore);
    } else {
      // Great Deluge
      accept = (newScore <= gdBound);
      gdBound *= params.gdCoolRate;
      if (!accept) {
        gdIdleCount++;
        if (gdIdleCount > params.gdMaxIdle) {
          gdResets++;
          gdBound = Math.pow(params.gdUpperBound, 1 + gdResets) * (bestScore > 0 ? bestScore : 1);
          gdIdleCount = 0;
        }
      }
    }

    if (accept) {
      totalScore = newScore;
      idleCount = 0;
      if (totalScore < bestScore) {
        bestScore = totalScore;
        bestAssignment = [...assignment];
      }
    } else {
      assignment[idx] = currentSlot; // rollback
      idleCount++;
    }
  }

  // If we never got a complete assignment, use the current state
  if (!bestAssignment) {
    bestAssignment = [...assignment];
    bestScore = scoreAssignment(assignment, ctx);
  }

  // Get final score decomposition
  const finalDecomp = scoreAssignment(bestAssignment, ctx, true);

  return { assignment: bestAssignment, score: bestScore, breakdown: finalDecomp.breakdown, iterations: params.maxIterations };
}


// ═══════════════════════════════════════════════════════════════
//  MAIN OPTIMIZER
// ═══════════════════════════════════════════════════════════════

function optimizeSchedule(courses, frozen, slots, facultyPrefs, weights, seed) {
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
  const sectionCounts = new Map();
  for (const c of courses) {
    const cid = c.courseId;
    sectionCounts.set(cid, (sectionCounts.get(cid) || 0) + 1);
  }

  // ── Pre-compute pair groups ─────────────────────────────────
  const pairGroupMap = new Map();

  // ── Faculty prohibited slot sets (pref = -3) ────────────────
  const prohibitedSlots = new Map();
  for (const [faculty, prefs] of preferences) {
    for (const p of prefs) {
      if (p.pref !== -3) continue;
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
    const aSlots = (slotsByFormat.get(a.mode) || []).length;
    const bSlots = (slotsByFormat.get(b.mode) || []).length;
    if (aSlots !== bSlots) return aSlots - bSlots;
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

  // ── Build linked-section map ────────────────────────────────
  const linkedSectionPartner = new Map();
  for (const [, indices] of pairGroupMap) {
    const bySection = new Map();
    for (const idx of indices) {
      const sec = toAssign[idx].section;
      if (!bySection.has(sec)) bySection.set(sec, []);
      bySection.get(sec).push(idx);
    }
    for (const [, sectionIndices] of bySection) {
      if (sectionIndices.length === 2) {
        linkedSectionPartner.set(sectionIndices[0], sectionIndices[1]);
        linkedSectionPartner.set(sectionIndices[1], sectionIndices[0]);
      }
      if (sectionIndices.length > 2) {
        for (let i = 0; i < sectionIndices.length; i++) {
          for (let j = i + 1; j < sectionIndices.length; j++) {
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
  const compatSlots = toAssign.map(course => {
    const fmt = course.mode || '';
    let available = slotsByFormat.get(fmt) || [];
    // H8: Filter by day compatibility
    if (course.days && course.days.length > 0) {
      available = available.filter(s => s.days.every(d => course.days.includes(d)));
    }
    const scored = available.map(s => ({
      slotIdx: s.index,
      prefScore: matchFacultyPref(course, s, preferences),
    }));
    scored.sort((a, b) => b.prefScore - a.prefScore);
    return scored.map(s => s.slotIdx);
  });

  // ── Slot index → slot object lookup ─────────────────────────
  const slotLookup = new Map();
  for (const s of slots) {
    slotLookup.set(s.index, s);
  }

  // ── IFS parameters ──────────────────────────────────────────
  const params = {
    maxIterations: 200000,
    cbsAgeing: 0.99,
    weightConflicts: 1.0,
    weightWeightedConflicts: 1.0,
    weightPotentialConflicts: 0.001,
    weightValue: 1.0,
    hcMaxIdle: 20000,
    gdUpperBound: 1.05,
    gdLowerBound: 0.95,
    gdCoolRate: 0.99999,
    gdMaxIdle: 10000,
    constructionStaleLimit: 2000,
  };

  // ── Build context object ────────────────────────────────────
  const ctx = {
    toAssign,
    locked,
    frozenTimes,
    slots,
    slotLookup,
    linkedSectionPartner,
    parsedRules,
    prohibitedSlots,
    preferences,
    sectionCounts,
    conflictGraph,
    semesterMap,
    W,
    pairGroupMap,
    params,
    random: mulberry32(seed != null ? seed : Date.now()),
  };

  // ── Run IFS solver ──────────────────────────────────────────
  const result = ifsSolver(toAssign, compatSlots, ctx, params);

  // Apply the result assignment back to courses
  for (let i = 0; i < toAssign.length; i++) {
    toAssign[i].slotIndex = result.assignment[i];
  }

  // ── BUILD RESULT ────────────────────────────────────────────
  const scheduled   = [];
  const unscheduled = [];

  for (const course of courses) {
    if (course.slotIndex === null && !course.locked) {
      unscheduled.push(course);
      continue;
    }
    const slot = slotLookup.get(course.slotIndex);
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
    score:      result.score === Infinity ? -1 : result.score,
    breakdown:  result.breakdown || null,
    iterations: result.iterations,
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
      // Pair-group partners are exempt (7-week courses sharing a slot intentionally)
      if (a.course.pairGroup && b.course.pairGroup && a.course.pairGroup === b.course.pairGroup) continue;
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


// ═══════════════════════════════════════════════════════════════
//  SUGGESTION SEARCH (UniTime-style bounded-depth backtracking)
// ═══════════════════════════════════════════════════════════════
//
// Given an existing schedule and a target course to move, explores
// all valid alternative slots using depth-limited backtracking.
// At each depth level, displaced courses are recursively re-placed.
// Results are scored against the full objective function and ranked
// by perturbation count then score delta.
//
// Algorithm reference: UniTime NeighbourSelectionWithSuggestions.java
//   — IFS bounded-depth backtracking with conflict cascading

function computeSuggestions(scheduled, frozen, slots, facultyPrefs, weights, targetCourseKey, maxDepth, timeoutMs) {
  if (!maxDepth) maxDepth = 2;
  if (!timeoutMs) timeoutMs = 500;

  const semesterMap   = buildSemesterMap();
  const conflictGraph = buildConflictGraph(semesterMap);
  const preferences   = (facultyPrefs && facultyPrefs.preferences) || new Map();
  const specialRules  = (facultyPrefs && facultyPrefs.specialRules) || [];
  const parsedRules   = parseSpecialRules(specialRules);

  const W = {
    cohortConflict:        (weights && weights.cohortConflict)        || 5,
    facultyPref:           (weights && weights.facultyPref)           || 5,
    singleSectionAfternoon:(weights && weights.singleSectionAfternoon)|| 5,
    backToBack:            (weights && weights.backToBack)            || 5,
    specialConstraints:    (weights && weights.specialConstraints)    || 5,
  };

  // ── Rebuild toAssign + locked from scheduled items ──────────
  const toAssign = [];
  const lockedItems = [];
  for (const item of scheduled) {
    if (item.course.isExternal) {
      lockedItems.push(item.course);
      continue;
    }
    toAssign.push(item.course);
  }

  // ── Frozen course time info ─────────────────────────────────
  const frozenTimes = (frozen || []).map(f => ({
    ...f,
    days:     f.days || expandDayPattern(f.dayPattern),
    startMin: timeToMinutes(f.startTime),
    endMin:   timeToMinutes(f.endTime),
    isExternal: true,
  }));
  // Also include locked external courses from scheduled
  for (const lk of lockedItems) {
    frozenTimes.push({
      ...lk,
      days:     lk.days || expandDayPattern(lk.dayPattern || ''),
      startMin: timeToMinutes(lk.startTime || ''),
      endMin:   timeToMinutes(lk.endTime || ''),
      isExternal: true,
    });
  }

  // ── Build slot lookup ───────────────────────────────────────
  const slotLookup = new Map();
  for (const s of slots) slotLookup.set(s.index, s);

  // ── Section counts ──────────────────────────────────────────
  const sectionCounts = new Map();
  for (const c of toAssign) {
    sectionCounts.set(c.courseId, (sectionCounts.get(c.courseId) || 0) + 1);
  }

  // ── Pair groups ─────────────────────────────────────────────
  const pairGroupMap = new Map();
  for (let i = 0; i < toAssign.length; i++) {
    const pg = toAssign[i].pairGroup;
    if (!pg) continue;
    if (!pairGroupMap.has(pg)) pairGroupMap.set(pg, []);
    pairGroupMap.get(pg).push(i);
  }

  // ── Linked section partners ─────────────────────────────────
  const linkedSectionPartner = new Map();
  for (const [, indices] of pairGroupMap) {
    const bySection = new Map();
    for (const idx of indices) {
      const sec = toAssign[idx].section;
      if (!bySection.has(sec)) bySection.set(sec, []);
      bySection.get(sec).push(idx);
    }
    for (const [, sectionIndices] of bySection) {
      if (sectionIndices.length === 2) {
        linkedSectionPartner.set(sectionIndices[0], sectionIndices[1]);
        linkedSectionPartner.set(sectionIndices[1], sectionIndices[0]);
      }
    }
  }

  // ── Faculty prohibited slots ────────────────────────────────
  const prohibitedSlots = new Map();
  for (const [faculty, prefs] of preferences) {
    for (const p of prefs) {
      if (p.pref !== -3) continue;
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

  // ── Build context ───────────────────────────────────────────
  const ctx = {
    toAssign,
    locked: [],          // no locked toAssign items in suggestion mode
    frozenTimes,
    slots,
    slotLookup,
    linkedSectionPartner,
    parsedRules,
    prohibitedSlots,
    preferences,
    sectionCounts,
    conflictGraph,
    semesterMap,
    W,
    pairGroupMap,
    params: {},
    random: mulberry32(42),
  };

  // ── Build current assignment array ──────────────────────────
  const assignment = new Array(toAssign.length).fill(null);
  const slotMap = new Map();  // map by code:section → scheduled item
  for (const item of scheduled) {
    slotMap.set(`${item.course.code}:${item.course.section}`, item);
  }
  for (let i = 0; i < toAssign.length; i++) {
    const key = `${toAssign[i].code}:${toAssign[i].section}`;
    const item = slotMap.get(key);
    if (item && item.slot && item.slot.index != null) {
      assignment[i] = item.slot.index;
    }
  }

  // ── Find target course index ────────────────────────────────
  let targetIdx = -1;
  for (let i = 0; i < toAssign.length; i++) {
    const key = `${toAssign[i].code}:${toAssign[i].section}`;
    if (key === targetCourseKey) { targetIdx = i; break; }
  }
  if (targetIdx === -1) return [];

  // ── Pre-compute compatible slots per course ─────────────────
  const compatSlots = toAssign.map(course => {
    return slots.filter(s => {
      if (course.mode && s.format && course.mode !== s.format) return false;
      if (course.days && course.days.length > 0 && s.days && s.days.length > 0) {
        if (!s.days.every(d => course.days.includes(d))) return false;
      }
      return true;
    }).map(s => s.index);
  });

  // ── Compute baseline score ──────────────────────────────────
  const baseline = scoreAssignment(assignment, ctx, true);

  // ── Bounded-depth backtracking suggestion search ────────────
  const suggestions = [];
  const deadline = Date.now() + timeoutMs;

  // For each compatible slot for the TARGET course, run backtrack
  for (const candidateSlotIdx of compatSlots[targetIdx]) {
    if (candidateSlotIdx === assignment[targetIdx]) continue;
    if (Date.now() > deadline) break;

    // Check hard constraints against fixed items
    if (!isValidAgainstFixed(targetIdx, candidateSlotIdx, ctx)) continue;

    // Find what this move conflicts with
    const directConflicts = findConflicts(targetIdx, candidateSlotIdx, assignment, ctx);

    // Skip if any conflict is a locked course
    if (directConflicts.some(ci => toAssign[ci].locked)) continue;

    // ── Depth-0: free move (no conflicts) ───────────────────
    if (directConflicts.length === 0) {
      const origSlot = assignment[targetIdx];
      assignment[targetIdx] = candidateSlotIdx;
      const newScore = scoreAssignment(assignment, ctx, true);
      assignment[targetIdx] = origSlot;

      suggestions.push({
        targetSlot: slotLookup.get(candidateSlotIdx),
        scoreDelta: newScore.total - baseline.total,
        baselineScore: baseline.total,
        newScore: newScore.total,
        breakdownDelta: diffBreakdown(baseline.breakdown, newScore.breakdown),
        cascade: [],
        perturbationCount: 1,
        isFreeMove: true,
      });
      continue;
    }

    // ── Depth-1+: recursive conflict resolution ─────────────
    if (maxDepth < 1) continue;
    if (directConflicts.length > maxDepth) continue;

    // Save state, apply target move, unassign conflicts
    const origTargetSlot = assignment[targetIdx];
    const savedConflictSlots = new Map();
    for (const ci of directConflicts) {
      savedConflictSlots.set(ci, assignment[ci]);
      assignment[ci] = null;
    }
    assignment[targetIdx] = candidateSlotIdx;

    // Best resolution for this target slot
    let bestForSlot = null;

    // Recursive backtrack to resolve displaced courses
    const resolved = new Map();  // courseIdx → newSlotIdx
    resolved.set(targetIdx, candidateSlotIdx);

    backtrackResolve(
      assignment, ctx, compatSlots,
      [...directConflicts],  // pending conflicts to resolve
      resolved,
      maxDepth - 1,
      deadline,
      baseline,
      function onSolution(solAssignment, solResolved) {
        const score = scoreAssignment(solAssignment, ctx, true);
        if (!bestForSlot || score.total < bestForSlot.newScore) {
          // Build cascade list
          const cascade = [];
          for (const [ci, newSi] of solResolved) {
            if (ci === targetIdx) continue;
            const origSi = savedConflictSlots.get(ci);
            if (origSi == null) continue;
            cascade.push({
              courseIdx: ci,
              code: toAssign[ci].code,
              section: toAssign[ci].section,
              fromSlot: slotLookup.get(origSi),
              toSlot: slotLookup.get(newSi),
            });
          }
          bestForSlot = {
            targetSlot: slotLookup.get(candidateSlotIdx),
            scoreDelta: score.total - baseline.total,
            baselineScore: baseline.total,
            newScore: score.total,
            breakdownDelta: diffBreakdown(baseline.breakdown, score.breakdown),
            cascade: cascade,
            perturbationCount: 1 + cascade.length,
            isFreeMove: false,
          };
        }
      }
    );

    // Restore state
    assignment[targetIdx] = origTargetSlot;
    for (const [ci, si] of savedConflictSlots) {
      assignment[ci] = si;
    }

    if (bestForSlot) suggestions.push(bestForSlot);
  }

  // Sort: free moves first, then by perturbation count, then by score delta
  suggestions.sort((a, b) => {
    if (a.isFreeMove !== b.isFreeMove) return a.isFreeMove ? -1 : 1;
    if (a.perturbationCount !== b.perturbationCount) return a.perturbationCount - b.perturbationCount;
    return a.scoreDelta - b.scoreDelta;
  });

  return suggestions;
}

// ── Recursive backtrack for conflict resolution ───────────────
// Attempts to find valid placements for all pending (displaced) courses.
// Follows UniTime's backtrack() pattern: process each pending course,
// try each compatible slot, recurse if it causes further conflicts.
function backtrackResolve(assignment, ctx, compatSlots, pending, resolved, depth, deadline, baseline, onSolution) {
  // Base case: all conflicts resolved
  if (pending.length === 0) {
    onSolution(assignment, resolved);
    return;
  }

  if (depth < 0 || Date.now() > deadline) return;

  // Pick the first pending course to resolve
  const idx = pending[0];
  const remaining = pending.slice(1);

  for (const slotIdx of compatSlots[idx]) {
    if (Date.now() > deadline) return;
    if (slotIdx === resolved.get(idx)) continue;  // skip original slot it was in

    // Hard constraint check against fixed items
    if (!isValidAgainstFixed(idx, slotIdx, ctx)) continue;

    // Check for new conflicts this placement would create
    const newConflicts = findConflicts(idx, slotIdx, assignment, ctx);

    // Skip if any new conflict is already resolved (would undo previous work)
    if (newConflicts.some(ci => resolved.has(ci))) continue;

    // Skip if too many new conflicts for remaining depth
    if (newConflicts.length > depth) continue;

    // Skip if any new conflict is locked
    if (newConflicts.some(ci => ctx.toAssign[ci].locked)) continue;

    // Tentatively apply
    assignment[idx] = slotIdx;
    resolved.set(idx, slotIdx);
    const savedConflictSlots = new Map();
    for (const ci of newConflicts) {
      savedConflictSlots.set(ci, assignment[ci]);
      assignment[ci] = null;
    }

    // Recurse: remaining pending + any new conflicts
    const nextPending = [...remaining, ...newConflicts];
    backtrackResolve(assignment, ctx, compatSlots, nextPending, resolved, depth - 1, deadline, baseline, onSolution);

    // Backtrack
    resolved.delete(idx);
    assignment[idx] = null;
    for (const [ci, si] of savedConflictSlots) {
      assignment[ci] = si;
    }
  }
}

// ── Helper: compute per-constraint breakdown deltas ───────────
function diffBreakdown(base, updated) {
  const delta = {};
  for (const key of Object.keys(base)) {
    delta[key] = (updated[key] || 0) - (base[key] || 0);
  }
  return delta;
}
