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
