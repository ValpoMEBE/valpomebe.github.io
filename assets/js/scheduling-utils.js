/* ╔══════════════════════════════════════════════════════════════╗
   ║  SCHEDULING UTILITIES                                        ║
   ║  Shared helpers for transcript planner and what-if planner.  ║
   ║  Requires SEMESTERS and COURSES_ARRAY globals.               ║
   ╚══════════════════════════════════════════════════════════════╝ */

const MAX_CREDITS_PER_SEM = 18;

// ── Count downstream dependents (critical-path priority) ─────
function computeDescendants(courses) {
  const idSet = new Set(courses.map(c => c.id));
  const children = {};

  for (const c of courses) {
    for (const entry of c.prereqs) {
      // Prereqs can be strings (AND) or arrays (OR groups)
      const pIds = Array.isArray(entry) ? entry : [entry];
      for (const p of pIds) {
        if (idSet.has(p)) {
          if (!children[p]) children[p] = [];
          children[p].push(c.id);
        }
      }
    }
  }

  const cache = {};
  function count(id) {
    if (cache[id] !== undefined) return cache[id];
    const kids = children[id] || [];
    let total = kids.length;
    for (const kid of kids) {
      total += count(kid);
    }
    cache[id] = total;
    return total;
  }

  const result = {};
  for (const c of courses) {
    result[c.id] = count(c.id);
  }
  return result;
}

// ── Group corequisites into clusters ─────────────────────────
function buildCoreqClusters(courses) {
  const idToCourse = {};
  for (const c of courses) idToCourse[c.id] = c;

  const visited = new Set();
  const clusters = [];

  for (const c of courses) {
    if (visited.has(c.id)) continue;

    // Gather all courses connected by coreqs
    const cluster = [];
    const queue = [c.id];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const course = idToCourse[id];
      if (!course) continue;
      cluster.push(course);
      for (const coId of course.coreqs) {
        if (idToCourse[coId] && !visited.has(coId)) {
          queue.push(coId);
        }
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

// ── Check if a course can be offered in a given season ───────
function isOfferedIn(course, season) {
  if (!course.offered) return true; // no restriction
  if (course.offered === 'Both') return true;
  return course.offered === season;
}

// ── Get year label for a semester number ─────────────────────
function getSemLabel(sem) {
  const semInfo = SEMESTERS.find(s => s.s === sem);
  if (semInfo) return { year: semInfo.year, season: semInfo.season };
  // Beyond semester 8: generate labels
  const season = sem % 2 === 1 ? 'Fall' : 'Spring';
  const yearNum = Math.ceil(sem / 2);
  const yearLabels = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
  const year = yearNum <= 4 ? yearLabels[yearNum - 1] + ' Year'
                            : 'Year ' + yearNum;
  return { year, season };
}

// ── Get season string for a semester number ──────────────────
function semSeason(sem) {
  return sem % 2 === 1 ? 'Fall' : 'Spring';
}

// ── Critical Path Computation ────────────────────────────────
// Finds the longest prerequisite chain among remaining courses,
// accounting for Fall/Spring offering constraints.
// Returns { chain: [courseIds], pathSemesters, endSemester }
// or null if no remaining courses.
function computeCriticalPath(remainingCourses, startSem) {
  if (!remainingCourses.length) return null;

  const idSet = new Set(remainingCourses.map(c => c.id));
  const byId = {};
  for (const c of remainingCourses) byId[c.id] = c;

  // Build parent map: childId → [parentIds that are also remaining]
  // For OR-prereqs, pick the remaining branch with worst (highest) EPS
  const parents = {};
  for (const c of remainingCourses) {
    parents[c.id] = [];
  }

  // First pass: collect all remaining prereq edges
  // We store raw prereq entries so we can resolve OR groups after EPS computation
  const rawPrereqs = {};
  for (const c of remainingCourses) {
    rawPrereqs[c.id] = [];
    for (const entry of (c.prereqs || [])) {
      const pIds = Array.isArray(entry) ? entry : [entry];
      const remainingOptions = pIds.filter(p => idSet.has(p));
      if (remainingOptions.length > 0) {
        rawPrereqs[c.id].push(remainingOptions);
      }
    }
  }

  // Compute EPS (earliest possible semester) for each remaining course
  const eps = {};
  const epsParent = {}; // tracks which parent determined each course's EPS

  function getEPS(id) {
    if (eps[id] !== undefined) return eps[id];
    // Prevent infinite loops in case of cycles
    eps[id] = Infinity;

    const course = byId[id];
    let maxParentEPS = -1;
    let bestParent = null;

    for (const orGroup of rawPrereqs[id]) {
      // For OR groups: the best option is the one with lowest EPS (easiest path)
      // But for critical path we want to know the worst case — we pick the
      // OR option the student would actually take (lowest EPS = best choice)
      let bestInGroup = null;
      let bestGroupEPS = Infinity;
      for (const p of orGroup) {
        const pEPS = getEPS(p);
        if (pEPS < bestGroupEPS) {
          bestGroupEPS = pEPS;
          bestInGroup = p;
        }
      }
      // This OR group contributes its best option's EPS as a constraint
      if (bestGroupEPS > maxParentEPS) {
        maxParentEPS = bestGroupEPS;
        bestParent = bestInGroup;
      }
    }

    // Earliest possible: semester after the latest prereq, or startSem if no prereqs
    let earliest = maxParentEPS >= 0 ? maxParentEPS + 1 : startSem;

    // Adjust for offering constraint (Fall-only, Spring-only)
    if (course.offered && course.offered !== 'Both') {
      const needed = course.offered; // 'Fall' or 'Spring'
      // Advance to next semester where this course is offered
      for (let tries = 0; tries < 20; tries++) {
        if (semSeason(earliest) === needed) break;
        earliest++;
      }
    }

    eps[id] = earliest;
    epsParent[id] = bestParent;
    return earliest;
  }

  for (const c of remainingCourses) getEPS(c.id);

  // Find the course with the highest EPS (excluding Infinity from cycles)
  let maxEPS = 0;
  let endId = null;
  for (const c of remainingCourses) {
    if (eps[c.id] !== Infinity && eps[c.id] > maxEPS) {
      maxEPS = eps[c.id];
      endId = c.id;
    }
  }

  if (!endId) return null;

  // Trace back the critical chain through epsParent,
  // including ALL remaining AND-prereqs of each chain course
  const chainSet = new Set();

  // Start from the end and trace back through the longest path
  let current = endId;
  const traceVisited = new Set();
  while (current && !traceVisited.has(current)) {
    traceVisited.add(current);
    chainSet.add(current);
    current = epsParent[current];
  }

  // Expand: for each course on the chain, also include any remaining
  // AND-prereqs that aren't already on the chain (they're also blockers)
  const expanded = new Set(chainSet);
  for (const id of chainSet) {
    for (const orGroup of rawPrereqs[id]) {
      // Only single-option groups are AND-prereqs
      // (OR-groups give the student a choice, so not all are required)
      if (orGroup.length === 1 && idSet.has(orGroup[0])) {
        expanded.add(orGroup[0]);
      }
    }
  }

  // Build ordered chain: sort by EPS so the display is sequential
  const chain = [...expanded].sort((a, b) => eps[a] - eps[b]);

  return {
    chain,
    pathSemesters: maxEPS - startSem + 1,
    endSemester: maxEPS,
    startSemester: startSem,
    eps, // expose for potential use (e.g., showing EPS per course)
  };
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  SEMESTER SLOT MODEL (Rearrange Mode)                      ║
// ║  Ordered slot arrays that support Summer terms and          ║
// ║  dynamic semester insertion. Used only in rearrange mode.  ║
// ╚══════════════════════════════════════════════════════════════╝

const YEAR_LABELS = ['Freshman Year', 'Sophomore Year', 'Junior Year', 'Senior Year'];

function _yearLabel(yearNum) {
  return yearNum <= 4 ? YEAR_LABELS[yearNum - 1] : 'Year ' + yearNum;
}

// Build an ordered slot array from numeric semesters 1..maxSem
function buildSlotsFromSemesters(maxSem) {
  const slots = [];
  for (let sem = 1; sem <= maxSem; sem++) {
    const season = sem % 2 === 1 ? 'Fall' : 'Spring';
    const yearNum = Math.ceil(sem / 2);
    slots.push({
      key: (season === 'Fall' ? 'F' : 'S') + yearNum,
      season: season,
      yearLabel: _yearLabel(yearNum),
      origSem: sem,       // maps back to the original numeric semester
      userAdded: false,    // core semesters can't be removed
      order: slots.length,
    });
  }
  return slots;
}

// Convert a slot key back to a display label
function slotToSemLabel(slot) {
  return { year: slot.yearLabel, season: slot.season };
}

// Insert a Summer slot after a given Spring slot key.
// Returns the new slot's key, or null if afterKey not found.
function insertSummerSlot(slots, afterKey) {
  const idx = slots.findIndex(s => s.key === afterKey);
  if (idx < 0) return null;
  const afterSlot = slots[idx];

  // Determine summer number from the Spring's year number
  const yearMatch = afterKey.match(/\d+/);
  const yearNum = yearMatch ? parseInt(yearMatch[0]) : 1;

  // Check if a summer already exists right after this Spring
  const nextSlot = slots[idx + 1];
  if (nextSlot && nextSlot.season === 'Summer' && nextSlot.key === 'U' + yearNum) {
    return null; // already exists
  }

  const newSlot = {
    key: 'U' + yearNum,
    season: 'Summer',
    yearLabel: 'After ' + _yearLabel(yearNum),
    origSem: null,
    userAdded: true,
    order: 0, // recomputed below
  };
  slots.splice(idx + 1, 0, newSlot);
  _recomputeOrder(slots);
  return newSlot.key;
}

// Append the next Fall or Spring semester to the end of the slot array.
// Returns the new slot's key.
function appendSemesterSlot(slots) {
  const last = slots[slots.length - 1];
  // Determine next season and year
  let nextSeason, yearNum;
  if (!last) {
    nextSeason = 'Fall'; yearNum = 1;
  } else if (last.season === 'Fall') {
    nextSeason = 'Spring';
    yearNum = parseInt(last.key.match(/\d+/)?.[0] || '1');
  } else {
    // Spring or Summer → next is Fall of next year
    nextSeason = 'Fall';
    yearNum = parseInt(last.key.match(/\d+/)?.[0] || '1') + 1;
  }

  const newSlot = {
    key: (nextSeason === 'Fall' ? 'F' : 'S') + yearNum,
    season: nextSeason,
    yearLabel: _yearLabel(yearNum),
    origSem: null,
    userAdded: true,
    order: slots.length,
  };
  slots.push(newSlot);
  return newSlot.key;
}

// Append a specific type of semester (Fall, Spring, or Summer).
// For Summer, appends after the last Spring. For Fall/Spring, appends to end.
function appendSemesterOfType(slots, type) {
  if (type === 'Summer') {
    // Find the last Spring slot and insert summer after it
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].season === 'Spring') {
        return insertSummerSlot(slots, slots[i].key);
      }
    }
    return null; // no Spring found
  }
  // Fall or Spring: append to end
  return appendSemesterSlot(slots);
}

// Remove a user-added slot if it has no courses assigned.
// Returns true if removed, false otherwise.
function removeSemesterSlot(slots, key) {
  const idx = slots.findIndex(s => s.key === key);
  if (idx < 0) return false;
  if (!slots[idx].userAdded) return false; // can't remove core semesters
  slots.splice(idx, 1);
  _recomputeOrder(slots);
  return true;
}

function _recomputeOrder(slots) {
  for (let i = 0; i < slots.length; i++) slots[i].order = i;
}
