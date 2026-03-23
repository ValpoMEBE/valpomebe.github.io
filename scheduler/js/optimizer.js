/* ╔══════════════════════════════════════════════════════════════╗
   ║  OPTIMIZER — Constraint Satisfaction Scheduler               ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Uses backtracking with forward checking to assign courses   ║
   ║  to time slots while respecting hard constraints and         ║
   ║  minimizing soft constraint violations.                      ║
   ║                                                              ║
   ║  Depends on: parser.js (expandDayPattern, timesOverlap, etc) ║
   ║              COURSES global (injected by layout from YAML)   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Soft constraint weights ─────────────────────────────────────
const WEIGHTS = {
  STUDENT_CONFLICT:  100,  // same program-semester overlap
  LAB_LECTURE_SAME_DAY: 5, // lab on same day as its lecture
  INSTRUCTOR_BACK_TO_BACK: 2, // 3+ consecutive without break
};

// ── Build semester conflict map from courses.yml ────────────────
// Returns Map<string, Set<string>> where key = "PROGRAM:SEM" and
// value = set of courseIds that share that program-semester.
function buildSemesterMap() {
  const map = new Map();
  for (const c of Object.values(COURSES)) {
    if (c.isPlaceholder) continue;
    if (!c.semesters) continue;
    for (const [prog, sem] of Object.entries(c.semesters)) {
      const key = `${prog}:${sem}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(c.id);
    }
  }
  return map;
}

// ── Determine which courses conflict (same semester for any program) ──
// Returns Map<string, Set<string>> courseId → set of conflicting courseIds
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

// ── Get year level from semester number ─────────────────────────
function semToYear(sem) {
  if (sem <= 2) return 1; // Freshman
  if (sem <= 4) return 2; // Sophomore
  if (sem <= 6) return 3; // Junior
  return 4;               // Senior
}

// ── Get course metadata from courses.yml ────────────────────────
function getCourseInfo(courseId) {
  return COURSES[courseId] || null;
}

// ── Main optimizer ──────────────────────────────────────────────
function optimizeSchedule(deptCourses, externals, slots) {
  const semesterMap = buildSemesterMap();
  const conflictGraph = buildConflictGraph(semesterMap);

  // Separate lab and class slots
  const classSlots = slots.filter(s => s.type === 'class');
  const labSlots   = slots.filter(s => s.type === 'lab');

  // Pre-compute external schedule time info for conflict checking
  const externalTimes = externals.map(ext => ({
    ...ext,
    days: expandDayPattern(ext.dayPattern),
    startMin: timeToMinutes(ext.startTime),
    endMin:   timeToMinutes(ext.endTime),
  }));

  // Build map: courseId → list of external schedules for same-semester courses
  const externalConflicts = new Map();
  for (const ext of externalTimes) {
    const extInfo = getCourseInfo(ext.courseId);
    if (!extInfo || !extInfo.semesters) continue;
    // For every program-semester this external course is in,
    // find all dept courses in the same program-semester
    for (const [prog, sem] of Object.entries(extInfo.semesters)) {
      const key = `${prog}:${sem}`;
      const peers = semesterMap.get(key);
      if (!peers) continue;
      for (const peerId of peers) {
        if (!externalConflicts.has(peerId)) externalConflicts.set(peerId, []);
        externalConflicts.get(peerId).push(ext);
      }
    }
  }

  // Courses to assign (exclude locked ones from the search)
  const toAssign = deptCourses.filter(c => !c.locked);
  const locked   = deptCourses.filter(c => c.locked);

  // Order by most constrained first
  toAssign.sort((a, b) => {
    const aConflicts = (conflictGraph.get(a.courseId) || new Set()).size;
    const bConflicts = (conflictGraph.get(b.courseId) || new Set()).size;
    return bConflicts - aConflicts;
  });

  // Build assignment: array parallel to toAssign, each value is a slot index or null
  const assignment = new Array(toAssign.length).fill(null);

  // Best solution tracking
  let bestAssignment = null;
  let bestScore = Infinity;
  let iterations = 0;
  let itersSinceImproved = 0;
  const MAX_ITERATIONS = 200000;
  const STALE_LIMIT = 50000; // stop if no improvement in this many iterations

  // ── Check hard constraints for a candidate assignment ─────────
  function isValid(courseIdx, slotIdx) {
    const course = toAssign[courseIdx];
    const slot = course.isLab ? labSlots[slotIdx] : classSlots[slotIdx];
    if (!slot) return false;

    // 1. Instructor overlap with already-assigned dept courses
    for (let i = 0; i < courseIdx; i++) {
      if (assignment[i] === null) continue;
      const other = toAssign[i];
      if (other.instructor !== course.instructor) continue;
      const otherSlot = other.isLab ? labSlots[assignment[i]] : classSlots[assignment[i]];
      if (timesOverlap(slot.days, slot.startTime, slot.endTime,
                       otherSlot.days, otherSlot.startTime, otherSlot.endTime)) {
        return false;
      }
    }

    // Also check against locked courses
    for (const lk of locked) {
      if (lk.instructor !== course.instructor) continue;
      const lkSlot = lk.isLab ? labSlots[lk.slotIndex] : classSlots[lk.slotIndex];
      if (!lkSlot) continue;
      if (timesOverlap(slot.days, slot.startTime, slot.endTime,
                       lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
        return false;
      }
    }

    // 2. Lab cannot overlap with its linked lecture
    if (course.linkedTo) {
      const lectureCode = course.linkedTo;
      // Check assigned dept courses
      for (let i = 0; i < courseIdx; i++) {
        if (assignment[i] === null) continue;
        if (toAssign[i].code === lectureCode) {
          const lecSlot = toAssign[i].isLab ? labSlots[assignment[i]] : classSlots[assignment[i]];
          if (timesOverlap(slot.days, slot.startTime, slot.endTime,
                           lecSlot.days, lecSlot.startTime, lecSlot.endTime)) {
            return false;
          }
        }
      }
      // Check locked
      for (const lk of locked) {
        if (lk.code === lectureCode) {
          const lkSlot = lk.isLab ? labSlots[lk.slotIndex] : classSlots[lk.slotIndex];
          if (!lkSlot) continue;
          if (timesOverlap(slot.days, slot.startTime, slot.endTime,
                           lkSlot.days, lkSlot.startTime, lkSlot.endTime)) {
            return false;
          }
        }
      }
    }

    // 3. Check hard external conflicts: same-semester external at same time
    const extConflicts = externalConflicts.get(course.courseId) || [];
    for (const ext of extConflicts) {
      if (timesOverlap(slot.days, slot.startTime, slot.endTime,
                       ext.days, ext.startTime, ext.endTime)) {
        return false; // Hard constraint: external same-semester overlap
      }
    }

    return true;
  }

  // ── Score a complete assignment (lower = better) ──────────────
  function scoreAssignment() {
    let score = 0;
    const allAssigned = getAllAssigned();

    // Student conflicts between dept courses
    for (let i = 0; i < allAssigned.length; i++) {
      for (let j = i + 1; j < allAssigned.length; j++) {
        const a = allAssigned[i], b = allAssigned[j];
        if (a.course.courseId === b.course.courseId) continue; // different sections of same course
        const conflicts = conflictGraph.get(a.course.courseId);
        if (conflicts && conflicts.has(b.course.courseId)) {
          if (timesOverlap(a.slot.days, a.slot.startTime, a.slot.endTime,
                           b.slot.days, b.slot.startTime, b.slot.endTime)) {
            score += WEIGHTS.STUDENT_CONFLICT;
          }
        }
      }
    }

    // Lab on same day as lecture
    for (const a of allAssigned) {
      if (!a.course.linkedTo) continue;
      const lecture = allAssigned.find(x => x.course.code === a.course.linkedTo);
      if (!lecture) continue;
      const sharedDays = a.slot.days.filter(d => lecture.slot.days.includes(d));
      if (sharedDays.length > 0) {
        score += WEIGHTS.LAB_LECTURE_SAME_DAY;
      }
    }

    // Instructor back-to-back (3+ consecutive)
    const byInstructor = new Map();
    for (const a of allAssigned) {
      const key = a.course.instructor;
      if (!byInstructor.has(key)) byInstructor.set(key, []);
      byInstructor.get(key).push(a);
    }
    for (const [, courses] of byInstructor) {
      // For each day, check consecutive blocks
      for (let day = 0; day < 5; day++) {
        const onDay = courses
          .filter(c => c.slot.days.includes(day))
          .sort((a, b) => timeToMinutes(a.slot.startTime) - timeToMinutes(b.slot.startTime));
        if (onDay.length < 3) continue;
        let consecutive = 1;
        for (let i = 1; i < onDay.length; i++) {
          const prevEnd = timeToMinutes(onDay[i - 1].slot.endTime);
          const currStart = timeToMinutes(onDay[i].slot.startTime);
          if (currStart - prevEnd <= 15) {
            consecutive++;
            if (consecutive >= 3) score += WEIGHTS.INSTRUCTOR_BACK_TO_BACK;
          } else {
            consecutive = 1;
          }
        }
      }
    }

    return score;
  }

  // ── Collect all assigned courses (toAssign + locked) with slot info ──
  function getAllAssigned() {
    const result = [];
    for (let i = 0; i < toAssign.length; i++) {
      if (assignment[i] === null) continue;
      const c = toAssign[i];
      const slot = c.isLab ? labSlots[assignment[i]] : classSlots[assignment[i]];
      result.push({ course: c, slot });
    }
    for (const lk of locked) {
      const slot = lk.isLab ? labSlots[lk.slotIndex] : classSlots[lk.slotIndex];
      if (slot) result.push({ course: lk, slot });
    }
    return result;
  }

  // ── Backtracking solver ───────────────────────────────────────
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
      if (score === 0) return; // Perfect — stop early
      return;
    }

    const course = toAssign[idx];
    const availableSlots = course.isLab ? labSlots : classSlots;

    for (let s = 0; s < availableSlots.length; s++) {
      if (!isValid(idx, s)) continue;
      assignment[idx] = s;

      solve(idx + 1);
      if (bestScore === 0) return; // Perfect found
      if (itersSinceImproved > STALE_LIMIT && bestScore < Infinity) return;

      assignment[idx] = null;
    }

    // If no slot works, leave null and continue (will produce an incomplete schedule)
    if (assignment[idx] === null) {
      solve(idx + 1);
    }
  }

  // ── Run the solver ────────────────────────────────────────────
  solve(0);

  // Apply best assignment
  if (bestAssignment) {
    for (let i = 0; i < toAssign.length; i++) {
      toAssign[i].slotIndex = bestAssignment[i];
    }
  }

  // Build result
  const result = {
    scheduled: [],
    unscheduled: [],
    conflicts: [],
    score: bestScore,
    iterations: iterations,
  };

  // Collect all scheduled items with their slot info
  for (const course of deptCourses) {
    if (course.slotIndex === null && !course.locked) {
      result.unscheduled.push(course);
      continue;
    }
    const slotPool = course.isLab ? labSlots : classSlots;
    const slot = slotPool[course.slotIndex];
    if (!slot) {
      result.unscheduled.push(course);
      continue;
    }
    result.scheduled.push({
      course,
      slot,
      info: getCourseInfo(course.courseId),
    });
  }

  // Add external courses to scheduled (marked as external)
  for (const ext of externals) {
    result.scheduled.push({
      course: {
        code:       ext.code,
        courseId:    ext.courseId,
        instructor: 'External',
        section:    ext.section,
        isLab:      ext.code.endsWith('L'),
        linkedTo:   '',
        locked:     true,
        isExternal: true,
      },
      slot: {
        dayPattern: ext.dayPattern,
        startTime:  ext.startTime,
        endTime:    ext.endTime,
        days:       expandDayPattern(ext.dayPattern),
      },
      info: getCourseInfo(ext.courseId),
    });
  }

  // Detect remaining conflicts for the report
  result.conflicts = detectConflicts(result.scheduled, conflictGraph);

  return result;
}

// ── Detect all conflicts in the final schedule ──────────────────
function detectConflicts(scheduled, conflictGraph) {
  const conflicts = [];

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i], b = scheduled[j];

      // Skip same course (different sections) — students only take one section
      if (a.course.courseId === b.course.courseId) continue;

      // Skip conflicts between two external courses — they're fixed, not actionable
      if (a.course.isExternal && b.course.isExternal) continue;

      // Check time overlap
      const overlaps = timesOverlap(
        a.slot.days, a.slot.startTime, a.slot.endTime,
        b.slot.days, b.slot.startTime, b.slot.endTime
      );
      if (!overlaps) continue;

      // Instructor conflict
      if (a.course.instructor === b.course.instructor &&
          a.course.instructor !== 'External') {
        conflicts.push({
          type: 'instructor',
          courses: [a.course.code, b.course.code],
          sections: [a.course.section, b.course.section],
          instructor: a.course.instructor,
          detail: `${a.course.instructor} teaches ${a.course.code} and ${b.course.code} at overlapping times`,
        });
      }

      // Student conflict (same semester)
      const aConflicts = conflictGraph.get(a.course.courseId);
      if (aConflicts && aConflicts.has(b.course.courseId)) {
        // Find which program-semesters they share
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
          courses: [a.course.code, b.course.code],
          sections: [a.course.section, b.course.section],
          detail: `${a.course.code} and ${b.course.code} overlap — both required in ${sharedSemesters.join(', ')}`,
        });
      }
    }
  }

  return conflicts;
}

// ── Compute faculty loads ───────────────────────────────────────
function computeFacultyLoads(scheduled) {
  const loads = new Map();

  for (const item of scheduled) {
    if (item.course.isExternal) continue;
    const name = item.course.instructor;
    if (!loads.has(name)) {
      loads.set(name, {
        instructor: name,
        credits: 0,
        contactHours: 0,
        preps: new Set(),
        courses: [],
      });
    }
    const load = loads.get(name);
    const info = item.info;
    if (info) load.credits += info.credits || 0;

    // Contact hours = scheduled hours per week
    const duration = timeToMinutes(item.slot.endTime) - timeToMinutes(item.slot.startTime);
    const daysPerWeek = item.slot.days.length;
    load.contactHours += (duration * daysPerWeek) / 60;

    load.preps.add(item.course.code.replace(/L$/, '')); // Lab shares prep with lecture
    load.courses.push(item.course.code + '-' + item.course.section);
  }

  return [...loads.values()].map(l => ({
    ...l,
    preps: l.preps.size,
    courses: l.courses,
  }));
}
