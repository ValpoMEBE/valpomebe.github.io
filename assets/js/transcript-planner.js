/* ╔══════════════════════════════════════════════════════════════╗
   ║  SEMESTER PLANNER                                           ║
   ║  Optimizes remaining courses into future semesters,         ║
   ║  respecting prereqs, coreqs, offering semesters, and        ║
   ║  an 18-credit cap.                                          ║
   ║                                                              ║
   ║  Requires: scheduling-utils.js (loaded before this file)    ║
   ║    Provides: MAX_CREDITS_PER_SEM, computeDescendants,       ║
   ║    buildCoreqClusters, isOfferedIn, getSemLabel,             ║
   ║    computeCriticalPath                                       ║
   ╚══════════════════════════════════════════════════════════════╝ */

const MAX_SEMESTERS = 16; // allow up to 8 years (16 semesters) for scheduling

// Placeholder tier classification for smart scheduling
const TECH_ELEC_KEYS = new Set(['me_elec', 'be_elec']);
const GENED_KEYS = new Set(['me_humssrs', 'be_humsstheo', 'me_wl', 'be_wl', 'theo',
                            'me_prof', 'core1', 'core2']);

function getPlaceholderGroupKey(course) {
  if (course.groupKey) return course.groupKey;
  // Strip _plan or _plan_N suffix
  return course.id.replace(/_plan(_\d+)?$/, '');
}

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

    // Split into individual 3-credit slots for better spreading
    const slotSize = 3;
    const numSlots = Math.ceil(creditsNeeded / slotSize);
    for (let i = 0; i < numSlots; i++) {
      const slotCredits = Math.min(slotSize, creditsNeeded - i * slotSize);
      remaining.push({
        id: gc.key + '_plan_' + i,
        code: gc.label,
        title: gc.label,
        credits: slotCredits,
        prereqs: [],
        coreqs: [],
        offered: null,
        isPlaceholder: true,
        defaultSem: gc.semester,
        groupKey: gc.key,
      });
    }
  }

  return remaining;
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

    // Helper: check if a single prereq ID is satisfied (completed or placed earlier)
    function isPrereqSatisfied(p) {
      if (completedIds.has(p)) return true;
      if (placed[p] !== undefined && placed[p] < sem) return true;
      // If prereq course isn't in this program's map, treat as satisfied
      const prereqCourse = COURSES_ARRAY.find(x => x.id === p);
      if (prereqCourse && (!prereqCourse.semesters || !prereqCourse.semesters[program])) return true;
      return false;
    }

    // All prereqs for all members must be satisfied
    // Prereqs can be strings (AND) or arrays (OR groups — any one satisfies)
    const allPrereqsMet = cluster.every(c =>
      (c.prereqs || []).every(entry => {
        if (Array.isArray(entry)) return entry.some(p => isPrereqSatisfied(p));
        return isPrereqSatisfied(entry);
      })
    );
    if (!allPrereqsMet) return false;

    // Check coreq constraint: any coreq not in this cluster must already be done
    // Coreqs can be strings (AND) or arrays (OR groups — any one satisfies)
    const clusterIds = new Set(cluster.map(c => c.id));
    function isCoreqSatisfied(co) {
      return clusterIds.has(co) || completedIds.has(co) || (placed[co] !== undefined && placed[co] <= sem);
    }
    const externalCoreqsMet = cluster.every(c =>
      (c.coreqs || []).every(entry => {
        if (Array.isArray(entry)) return entry.some(co => isCoreqSatisfied(co));
        return isCoreqSatisfied(entry);
      })
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

  // Pass 2: Smart placeholder scheduling with tiers and spreading

  // 2a: Classify placeholder clusters into tech electives vs gen-ed
  const techElecClusters = [];
  const genedClusters = [];
  for (const cluster of placeholderClusters) {
    const key = getPlaceholderGroupKey(cluster[0]);
    if (TECH_ELEC_KEYS.has(key)) {
      techElecClusters.push(cluster);
    } else {
      genedClusters.push(cluster);
    }
  }

  // 2b: Place tech electives with spreading (skip sophomore year unless no choice)
  const techEligibleSems = [];
  const techFallbackSems = []; // sophomore semesters as last resort
  for (let sem = startSem; sem <= endSem; sem++) {
    if (sem >= 3 && sem <= 4) {
      techFallbackSems.push(sem);
    } else {
      techEligibleSems.push(sem);
    }
  }

  let techIdx = 0;
  for (const cluster of techElecClusters) {
    const credits = cluster.reduce((s, c) => s + c.credits, 0);
    let placedOk = false;

    // Try preferred semesters first (round-robin for spreading)
    for (let attempt = 0; attempt < techEligibleSems.length; attempt++) {
      const sem = techEligibleSems[(techIdx + attempt) % techEligibleSems.length];
      if (!isClusterEligible(cluster, sem)) continue;
      semCredits[sem] = semCredits[sem] || 0;
      if (semCredits[sem] + credits <= MAX_CREDITS_PER_SEM) {
        for (const c of cluster) placed[c.id] = sem;
        semCredits[sem] += credits;
        placedOk = true;
        techIdx++;
        break;
      }
    }

    // Fallback: try sophomore semesters as last resort
    if (!placedOk) {
      for (const sem of techFallbackSems) {
        if (!isClusterEligible(cluster, sem)) continue;
        semCredits[sem] = semCredits[sem] || 0;
        if (semCredits[sem] + credits <= MAX_CREDITS_PER_SEM) {
          for (const c of cluster) placed[c.id] = sem;
          semCredits[sem] += credits;
          placedOk = true;
          break;
        }
      }
    }
  }

  // 2c: Place gen-ed placeholders with anti-clustering
  // Prefer spreading gen-eds across semesters, but don't extend beyond 4 years
  // Expected last semester: 8 for normal 4-year plan, or extend if starting late
  const gradSem = startSem <= 8 ? 8 : startSem + 2;
  const genedPerSem = {};
  for (const cluster of genedClusters) {
    const credits = cluster.reduce((s, c) => s + c.credits, 0);

    // Build candidate semesters, preferring those within graduation timeline
    const candidates = [];
    for (let sem = startSem; sem <= endSem; sem++) {
      if (!isClusterEligible(cluster, sem)) continue;
      semCredits[sem] = semCredits[sem] || 0;
      if (semCredits[sem] + credits <= MAX_CREDITS_PER_SEM) {
        candidates.push(sem);
      }
    }
    // Sort: avoid stacking gen-eds, but prefer staying within graduation timeline
    candidates.sort((a, b) => {
      // Strongly prefer semesters within expected graduation
      const beyondA = a > gradSem ? 1 : 0;
      const beyondB = b > gradSem ? 1 : 0;
      if (beyondA !== beyondB) return beyondA - beyondB;
      // Within timeline: prefer fewer gen-eds (anti-cluster)
      const ga = genedPerSem[a] || 0;
      const gb = genedPerSem[b] || 0;
      if (ga !== gb) return ga - gb;
      // Tiebreak: earliest semester
      return a - b;
    });

    if (candidates.length > 0) {
      const sem = candidates[0];
      for (const c of cluster) placed[c.id] = sem;
      semCredits[sem] += credits;
      genedPerSem[sem] = (genedPerSem[sem] || 0) + 1;
    }
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
