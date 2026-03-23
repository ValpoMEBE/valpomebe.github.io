/* ╔══════════════════════════════════════════════════════════════╗
   ║  SEMESTER PLANNER                                           ║
   ║  Optimizes remaining courses into future semesters,         ║
   ║  respecting prereqs, coreqs, offering semesters, and        ║
   ║  an 18-credit cap.                                          ║
   ╚══════════════════════════════════════════════════════════════╝ */

const MAX_CREDITS_PER_SEM = 18;
const MAX_SEMESTERS = 16; // allow up to 8 years (16 semesters) for scheduling

// ── Detect the student's next semester ───────────────────────
// Finds the latest term on the transcript and returns
// { startSem, season } for the next semester to plan.
function detectNextSemester(matched) {
  let latestDate = null;

  for (const m of matched) {
    const d = m.active?.endDate;
    if (!d) continue;
    if (!latestDate || d > latestDate) latestDate = d;
  }

  if (!latestDate) return 1;

  // Count distinct Fall/Spring terms, excluding transfer/CR courses
  // and bucketing summer courses (May–Aug) with Spring
  const terms = new Set();
  for (const m of matched) {
    const g = m.active?.grade;
    if (g === 'TR' || g === 'CR') continue; // transfers aren't real semesters
    const d = m.active?.endDate;
    if (!d) continue;
    const mo = d.getMonth(); // 0-indexed
    const yr = d.getFullYear();
    if (mo >= 8) {           // Sep–Dec → Fall
      terms.add(yr + '-Fall');
    } else {                 // Jan–Aug → Spring (includes summer)
      terms.add(yr + '-Spring');
    }
  }

  const semestersCompleted = terms.size;
  // Next semester is one after the count of completed semesters
  return semestersCompleted + 1;
}

// ── Build list of remaining courses from audit result ────────
function getRemainingCourses(auditResult, program) {
  const remaining = [];
  const { audit, groupCards } = auditResult;

  // Non-grouped remaining courses
  for (const c of audit) {
    if (c.status === 'remaining' && !c.isPlaceholder) {
      remaining.push({
        id: c.id,
        code: c.code,
        title: c.title,
        credits: c.credits || 0,
        prereqs: c.prereqs || [],
        coreqs: c.coreqs || [],
        offered: c.offered || null,
        isPlaceholder: false,
        defaultSem: c.semester,
      });
    }
  }

  // Grouped elective cards — add unfilled placeholder slots
  for (const gc of groupCards) {
    if (gc.groupStatus === 'filled') continue;
    const creditsNeeded = gc.totalCredits - gc.creditsFilled;
    if (creditsNeeded <= 0) continue;

    remaining.push({
      id: gc.key + '_plan',
      code: gc.label,
      title: gc.label,
      credits: creditsNeeded,
      prereqs: [],
      coreqs: [],
      offered: null,
      isPlaceholder: true,
      defaultSem: gc.semester,
    });
  }

  return remaining;
}

// ── Count downstream dependents (critical-path priority) ─────
function computeDescendants(courses) {
  const idSet = new Set(courses.map(c => c.id));
  const children = {};

  for (const c of courses) {
    for (const p of c.prereqs) {
      if (idSet.has(p)) {
        if (!children[p]) children[p] = [];
        children[p].push(c.id);
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

// ── Main scheduling algorithm ────────────────────────────────
function scheduleCourses(remainingCourses, startSem, program, matched) {
  const completedIds = new Set();

  // Include already-completed courses as satisfied prereqs
  for (const c of COURSES_ARRAY) {
    if (!c.semesters || !c.semesters[program]) continue;
    const isRemaining = remainingCourses.some(r => r.id === c.id);
    if (!isRemaining) {
      completedIds.add(c.id);
    }
  }

  // Also include transcript-matched courses (covers prereqs outside the program map,
  // e.g. CHEM_115 satisfied by CHEM_121 for BE_Biomed students)
  if (matched) {
    for (const m of matched) {
      if (m.active?.grade && isPassingGrade(m.active.grade)) {
        // Find the course ID by code match
        const course = COURSES_ARRAY.find(c => c.code === m.code);
        if (course) completedIds.add(course.id);
      }
    }
  }

  const descendants = computeDescendants(remainingCourses);
  const clusters = buildCoreqClusters(remainingCourses);

  // Track which clusters are placed
  const placed = {};       // courseId → semester number
  const semCredits = {};   // sem → total credits
  const totalRemaining = remainingCourses.length;

  // Schedule up to MAX_SEMESTERS from start, or until all placed
  const endSem = startSem + MAX_SEMESTERS - 1;

  // Helper: check if a cluster is eligible for a given semester
  function isClusterEligible(cluster, sem) {
    const season = sem % 2 === 1 ? 'Fall' : 'Spring';

    // Skip if any member already placed
    if (cluster.some(c => placed[c.id] !== undefined)) return false;

    // All members must be offerable this season
    if (!cluster.every(c => isOfferedIn(c, season))) return false;

    // All prereqs for all members must be satisfied
    const allPrereqsMet = cluster.every(c =>
      c.prereqs.every(p => {
        if (completedIds.has(p)) return true;
        if (placed[p] !== undefined && placed[p] < sem) return true;
        // If prereq course isn't in this program's map, treat as satisfied
        const prereqCourse = COURSES_ARRAY.find(x => x.id === p);
        if (prereqCourse && (!prereqCourse.semesters || !prereqCourse.semesters[program])) return true;
        return false;
      })
    );
    if (!allPrereqsMet) return false;

    // Check coreq constraint: any coreq not in this cluster must already be done
    const clusterIds = new Set(cluster.map(c => c.id));
    const externalCoreqsMet = cluster.every(c =>
      c.coreqs.every(co =>
        clusterIds.has(co) || completedIds.has(co) || (placed[co] !== undefined && placed[co] <= sem)
      )
    );
    return externalCoreqsMet;
  }

  // Separate clusters into required (non-placeholder) and placeholder
  const requiredClusters = clusters.filter(cl => cl.some(c => !c.isPlaceholder));
  const placeholderClusters = clusters.filter(cl => cl.every(c => c.isPlaceholder));

  // Pass 1: Schedule required courses first
  for (let sem = startSem; sem <= endSem; sem++) {
    semCredits[sem] = semCredits[sem] || 0;

    const eligibleClusters = [];
    for (const cluster of requiredClusters) {
      if (!isClusterEligible(cluster, sem)) continue;

      const clusterCredits = cluster.reduce((sum, c) => sum + c.credits, 0);
      const maxDescendants = Math.max(...cluster.map(c => descendants[c.id] || 0));
      const isConstrained = cluster.some(c => c.offered !== null);

      eligibleClusters.push({
        cluster,
        credits: clusterCredits,
        priority: (isConstrained ? 2000 : 0) + 1000 + maxDescendants,
      });
    }

    eligibleClusters.sort((a, b) => b.priority - a.priority);

    for (const { cluster, credits } of eligibleClusters) {
      if (semCredits[sem] + credits <= MAX_CREDITS_PER_SEM) {
        for (const c of cluster) placed[c.id] = sem;
        semCredits[sem] += credits;
      }
    }

    // Early exit if all required courses are placed
    if (requiredClusters.every(cl => cl.some(c => placed[c.id] !== undefined))) break;
  }

  // Pass 2: Backfill placeholder/elective courses into remaining capacity
  for (let sem = startSem; sem <= endSem; sem++) {
    semCredits[sem] = semCredits[sem] || 0;

    const eligibleClusters = [];
    for (const cluster of placeholderClusters) {
      if (!isClusterEligible(cluster, sem)) continue;
      const clusterCredits = cluster.reduce((sum, c) => sum + c.credits, 0);
      eligibleClusters.push({ cluster, credits: clusterCredits });
    }

    for (const { cluster, credits } of eligibleClusters) {
      if (semCredits[sem] + credits <= MAX_CREDITS_PER_SEM) {
        for (const c of cluster) placed[c.id] = sem;
        semCredits[sem] += credits;
      }
    }

    if (Object.keys(placed).length >= totalRemaining) break;
  }

  // Collect unplaced courses
  const unplaced = [];
  for (const cluster of clusters) {
    for (const c of cluster) {
      if (placed[c.id] === undefined) {
        unplaced.push(c);
      }
    }
  }

  return { placed, semCredits, unplaced };
}

// ── Render the planner grid ──────────────────────────────────
function renderPlanner(remainingCourses, placed, semCredits, unplaced, startSem) {
  const grid = document.getElementById('planner-grid');
  grid.innerHTML = '';

  // Find the max semester used
  let maxSem = startSem;
  for (const sem of Object.values(placed)) {
    if (sem > maxSem) maxSem = sem;
  }

  for (let sem = startSem; sem <= maxSem; sem++) {
    const coursesThisSem = remainingCourses.filter(c => placed[c.id] === sem);
    if (!coursesThisSem.length) continue;

    const { year, season } = getSemLabel(sem);
    const credits = semCredits[sem] || 0;

    const col = document.createElement('div');
    col.className = 'sem-col';

    // Header
    const header = document.createElement('div');
    header.className = 'sem-header';
    header.innerHTML =
      '<div class="sem-year">' + year + '</div>' +
      '<div class="sem-name">' + season + ' &mdash; ' + credits + ' cr</div>';
    col.appendChild(header);

    // Cards
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'sem-cards';

    // Sort: constrained first, then by code
    coursesThisSem.sort((a, b) => {
      if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
      return a.code.localeCompare(b.code);
    });

    for (const course of coursesThisSem) {
      const card = document.createElement('div');
      card.className = 'audit-card status-remaining';
      card.innerHTML =
        '<div class="audit-card-top">' +
          '<span class="audit-code">' + course.code + '</span>' +
        '</div>' +
        '<div class="audit-title">' + course.title + '</div>' +
        '<div class="audit-card-bottom">' +
          '<span class="audit-credits">' + course.credits + ' cr</span>' +
        '</div>';
      cardsWrap.appendChild(card);
    }

    col.appendChild(cardsWrap);
    grid.appendChild(col);
  }

  // Overflow section
  const overflowSection = document.getElementById('planner-overflow');
  if (unplaced.length > 0) {
    overflowSection.style.display = '';
    const list = document.getElementById('planner-overflow-list');
    list.innerHTML = '';
    for (const c of unplaced) {
      const card = document.createElement('div');
      card.className = 'audit-card status-remaining';
      card.innerHTML =
        '<div class="audit-card-top">' +
          '<span class="audit-code">' + c.code + '</span>' +
        '</div>' +
        '<div class="audit-title">' + c.title + '</div>' +
        '<div class="audit-card-bottom">' +
          '<span class="audit-credits">' + c.credits + ' cr</span>' +
        '</div>';
      list.appendChild(card);
    }
  } else {
    overflowSection.style.display = 'none';
  }
}

// ── Show / hide planner ──────────────────────────────────────
function showPlanner() {
  const program = AUDIT_STATE.program;
  const matched = AUDIT_STATE.lastMatched;
  const unmatched = AUDIT_STATE.lastUnmatched;
  const codeIndex = AUDIT_STATE.lastCodeIndex;

  if (!matched) return;

  // Recompute audit to get fresh remaining courses
  const auditResult = computeAudit(matched, program, codeIndex, unmatched);
  const remaining = getRemainingCourses(auditResult, program);

  if (!remaining.length) return;

  const startSem = detectNextSemester(matched);
  const { placed, semCredits, unplaced } = scheduleCourses(remaining, startSem, program, matched);

  renderPlanner(remaining, placed, semCredits, unplaced, startSem);

  document.getElementById('results-section').style.display = 'none';
  document.getElementById('planner-section').style.display = '';
  document.getElementById('planner-section').scrollIntoView({ behavior: 'smooth' });
}

function hidePlanner() {
  document.getElementById('planner-section').style.display = 'none';
  document.getElementById('results-section').style.display = '';
}
