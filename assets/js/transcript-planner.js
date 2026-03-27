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
   ║  Requires: rearrange-engine.js (loaded before this file)    ║
   ║    Provides: validateAllCourses, renderRearrangeGrid,       ║
   ║    createRearrangeCard                                       ║
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
// Supports two modes:
//   1. Numeric semesters (initial auto-schedule): placed[id] = sem number
//   2. Slot-based (after rearrange save): placed[id] = slotKey, savedSlots holds model
function renderPlanner(remainingCourses, placed, semCredits, unplaced, startSem) {
  const grid = document.getElementById('planner-grid');
  grid.innerHTML = '';

  if (TP_STATE.savedSlots) {
    // Slot-based rendering (preserves summers)
    const slots = TP_STATE.savedSlots;
    for (const slot of slots) {
      const coursesInSlot = remainingCourses.filter(c => placed[c.id] === slot.key);
      if (!coursesInSlot.length) continue;

      const credits = semCredits[slot.key] || 0;
      renderPlannerColumn(grid, slot.yearLabel, slot.season, credits, coursesInSlot);
    }
  } else {
    // Numeric semester rendering (initial auto-schedule)
    let maxSem = startSem;
    for (const sem of Object.values(placed)) {
      if (sem > maxSem) maxSem = sem;
    }

    for (let sem = startSem; sem <= maxSem; sem++) {
      const coursesThisSem = remainingCourses.filter(c => placed[c.id] === sem);
      if (!coursesThisSem.length) continue;

      const { year, season } = getSemLabel(sem);
      const credits = semCredits[sem] || 0;
      renderPlannerColumn(grid, year, season, credits, coursesThisSem);
    }
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

function renderPlannerColumn(grid, yearLabel, season, credits, courses) {
  const col = document.createElement('div');
  col.className = 'sem-col';

  const header = document.createElement('div');
  header.className = 'sem-header';
  header.innerHTML =
    '<div class="sem-year">' + yearLabel + '</div>' +
    '<div class="sem-name">' + season + ' &mdash; ' + credits + ' cr</div>';
  col.appendChild(header);

  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'sem-cards';

  courses.sort((a, b) => {
    if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
    return a.code.localeCompare(b.code);
  });

  for (const course of courses) {
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

// ── Show / hide planner ──────────────────────────────────────
function showPlanner() {
  const program = AUDIT_STATE.program;
  const matched = AUDIT_STATE.lastMatched;
  const unmatched = AUDIT_STATE.lastUnmatched;
  const codeIndex = AUDIT_STATE.lastCodeIndex;

  if (!matched) return;

  // Reset state for fresh plan
  TP_STATE.restricted = false;
  TP_STATE.addedCourses = [];
  TP_STATE.savedSlots = null;
  TP_STATE.rearrangeMode = false;
  TP_STATE.rearrangedCourses = null;
  TP_STATE.semesterSlots = null;

  // Build plan (includes extras by default if selected in audit)
  rebuildPlan();

  if (!TP_STATE.remaining || !TP_STATE.remaining.length) return;

  setupTPExtras();

  // Ensure rearrange UI is reset
  const rearrangeControls = document.getElementById('tp-rearrange-controls');
  if (rearrangeControls) rearrangeControls.style.display = 'none';
  const legend = document.getElementById('tp-validation-legend');
  if (legend) legend.style.display = 'none';
  const toggleBtn = document.getElementById('tp-rearrange-btn');
  if (toggleBtn) { toggleBtn.textContent = 'Rearrange Schedule'; toggleBtn.classList.remove('active'); }

  document.getElementById('results-section').style.display = 'none';
  document.getElementById('planner-section').style.display = '';
  document.getElementById('planner-section').scrollIntoView({ behavior: 'smooth' });
}

function hidePlanner() {
  if (TP_STATE.rearrangeMode) exitTranscriptRearrange(false);
  document.getElementById('planner-section').style.display = 'none';
  document.getElementById('results-section').style.display = '';
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  TRANSCRIPT PLANNER STATE                                    ║
// ╚══════════════════════════════════════════════════════════════╝

let TP_STATE = {
  remaining: null,          // remaining courses array
  placed: null,             // courseId → slotKey or sem mapping
  semCredits: null,
  startSem: null,
  unplaced: null,
  savedSlots: null,         // slot model preserved after save (supports summers)
  // Rearrange
  rearrangeMode: false,
  rearrangedCourses: null,
  semesterSlots: null,
  // Include extras (double major, minors, CC) — ON by default
  restricted: false,        // when true, only main program courses
  addedCourses: [],         // manually added from catalog
};


// ╔══════════════════════════════════════════════════════════════╗
// ║  COMPLETED IDS HELPER                                        ║
// ╚══════════════════════════════════════════════════════════════╝

function buildCompletedIds() {
  const completedIds = new Set();
  const matched = AUDIT_STATE.lastMatched;
  if (!matched) return completedIds;

  // Courses in the program curriculum that are not remaining
  const program = AUDIT_STATE.program;
  for (const c of COURSES_ARRAY) {
    if (!c.semesters || !c.semesters[program]) continue;
    const isRemaining = TP_STATE.remaining && TP_STATE.remaining.some(r => r.id === c.id);
    if (!isRemaining) completedIds.add(c.id);
  }

  // Transcript-matched courses (covers cross-program prereqs)
  for (const m of matched) {
    if (m.active?.grade && isPassingGrade(m.active.grade)) {
      const course = COURSES_ARRAY.find(c => c.code === m.code);
      if (course) completedIds.add(course.id);
    }
  }

  return completedIds;
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  INCLUDE TOGGLES (Double Major, Minors, CC)                  ║
// ╚══════════════════════════════════════════════════════════════╝

function setupTPExtras() {
  // Show the restrict button only if there are extras to include
  const hasExtras = !!AUDIT_STATE.secondaryProgram ||
    (AUDIT_STATE.selectedMinors && AUDIT_STATE.selectedMinors.length > 0) ||
    AUDIT_STATE.ccEnabled;
  const extrasRow = document.getElementById('tp-extras');
  if (extrasRow) extrasRow.style.display = hasExtras ? '' : 'none';

  const btn = document.getElementById('tp-restrict-btn');
  if (btn) btn.classList.toggle('active', TP_STATE.restricted);
}

function toggleTPRestrict() {
  TP_STATE.restricted = !TP_STATE.restricted;
  const btn = document.getElementById('tp-restrict-btn');
  if (btn) btn.classList.toggle('active', TP_STATE.restricted);
  rebuildPlan();
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  REBUILD PLAN (after toggle changes)                         ║
// ╚══════════════════════════════════════════════════════════════╝

function rebuildPlan() {
  const program = AUDIT_STATE.program;
  const matched = AUDIT_STATE.lastMatched;
  const unmatched = AUDIT_STATE.lastUnmatched;
  const codeIndex = AUDIT_STATE.lastCodeIndex;
  if (!matched) return;

  // Base remaining from primary audit
  const auditResult = computeAudit(matched, program, codeIndex, unmatched);
  let remaining = getRemainingCourses(auditResult, program);

  const existingIds = new Set(remaining.map(c => c.id));
  const completedIds = buildCompletedIds();

  // Include extras (double major, minors, CC) unless restricted
  if (!TP_STATE.restricted) {

    // Secondary (double major) courses
    if (AUDIT_STATE.secondaryProgram) {
      const secProg = AUDIT_STATE.secondaryProgram;
      const secAudit = computeAudit(matched, secProg, codeIndex, unmatched);
      const secRemaining = getRemainingCourses(secAudit, secProg);
      for (const c of secRemaining) {
        if (!existingIds.has(c.id) && !completedIds.has(c.id)) {
          c.origin = 'secondary';
          remaining.push(c);
          existingIds.add(c.id);
        }
      }
    }

    // Minor courses
    // minors/*.yml uses course codes ("PHYS 141"), courses/*.yml uses IDs ("PHYS_141")
    const selectedMinors = AUDIT_STATE.selectedMinors || [];
    if (selectedMinors.length > 0 && typeof MINORS_DATA !== 'undefined') {
      for (const minorKey of selectedMinors) {
        const minor = MINORS_DATA[minorKey];
        if (!minor || !minor.requirements) continue;
        for (const req of minor.requirements) {
          const courseRefs = req.courses || [];
          for (const ref of courseRefs) {
            let c = COURSES_ARRAY.find(x => x.id === ref);
            if (!c) c = COURSES_ARRAY.find(x => x.code === ref);
            if (!c) continue;
            if (existingIds.has(c.id) || completedIds.has(c.id)) continue;
            remaining.push({
              id: c.id, code: c.code, title: c.title, credits: c.credits || 0,
              prereqs: c.prereqs || [], coreqs: c.coreqs || [], offered: c.offered || null,
              isPlaceholder: false, defaultSem: null, origin: 'minor',
            });
            existingIds.add(c.id);
          }
        }
      }
    }

    // Christ College courses
    // cc_scholar.yml uses course codes ("CC 110A"), courses.yml uses IDs ("CC_110A")
    if (AUDIT_STATE.ccEnabled && typeof CC_SCHOLAR_DATA !== 'undefined' && CC_SCHOLAR_DATA) {
      const ccReqs = CC_SCHOLAR_DATA.requirements || [];
      for (const req of ccReqs) {
        const courseRefs = req.courses || [];
        for (const ref of courseRefs) {
          let c = COURSES_ARRAY.find(x => x.id === ref);
          if (!c) c = COURSES_ARRAY.find(x => x.code === ref);
          if (!c) continue;
          if (existingIds.has(c.id) || completedIds.has(c.id)) continue;
          remaining.push({
            id: c.id, code: c.code, title: c.title, credits: c.credits || 0,
            prereqs: c.prereqs || [], coreqs: c.coreqs || [], offered: c.offered || null,
            isPlaceholder: false, defaultSem: null, origin: 'cc',
          });
          existingIds.add(c.id);
        }
      }
    }

  } // end if (!restricted)

  // Manually added courses
  for (const c of TP_STATE.addedCourses) {
    if (!existingIds.has(c.id) && !completedIds.has(c.id)) {
      remaining.push(c);
      existingIds.add(c.id);
    }
  }

  TP_STATE.remaining = remaining;
  TP_STATE.startSem = detectNextSemester(matched);
  TP_STATE.savedSlots = null; // clear saved slots when rebuilding from scratch

  const { placed, semCredits, unplaced } = scheduleCourses(remaining, TP_STATE.startSem, program, matched);
  TP_STATE.placed = placed;
  TP_STATE.semCredits = semCredits;
  TP_STATE.unplaced = unplaced;

  if (TP_STATE.rearrangeMode) {
    // Re-enter rearrange with new data, preserving positions where possible
    const oldSlots = TP_STATE.rearrangedCourses || [];
    const oldPositions = {};
    for (const c of oldSlots) {
      if (c.slotKey) oldPositions[c.id] = c.slotKey;
    }

    enterTranscriptRearrangeFromState(oldPositions);
  } else {
    renderPlanner(remaining, placed, semCredits, unplaced, TP_STATE.startSem);
  }
  evaluateTPRequirements();
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  REARRANGE MODE                                              ║
// ╚══════════════════════════════════════════════════════════════╝

function toggleTranscriptRearrange() {
  if (TP_STATE.rearrangeMode) {
    exitTranscriptRearrange(false);
  } else {
    enterTranscriptRearrange();
  }
}

function enterTranscriptRearrange() {
  enterTranscriptRearrangeFromState({});
}

function enterTranscriptRearrangeFromState(oldPositions) {
  if (!TP_STATE.remaining || !TP_STATE.placed) return;
  TP_STATE.rearrangeMode = true;

  // Deep-copy remaining courses
  const courses = TP_STATE.remaining.map(c => {
    const copy = Object.assign({}, c);
    copy.prereqs = c.prereqs ? c.prereqs.slice() : [];
    copy.coreqs = c.coreqs ? c.coreqs.slice() : [];
    return copy;
  });

  // Build slots — reuse saved slots (with summers) if available, else build fresh
  let slots;
  if (TP_STATE.savedSlots) {
    slots = TP_STATE.savedSlots.map(s => Object.assign({}, s));
  } else {
    let maxSem = TP_STATE.startSem;
    for (const sem of Object.values(TP_STATE.placed)) {
      if (typeof sem === 'number' && sem > maxSem) maxSem = sem;
    }
    if (maxSem < TP_STATE.startSem + 1) maxSem = TP_STATE.startSem + 1;
    slots = buildSlotsFromSemesters(maxSem);
  }

  // Assign slotKey: use old positions if available, else from placed
  const hasSavedSlots = !!TP_STATE.savedSlots;
  for (const c of courses) {
    if (oldPositions[c.id]) {
      const oldSlot = slots.find(s => s.key === oldPositions[c.id]);
      c.slotKey = oldSlot ? oldPositions[c.id] : null;
    }
    if (!c.slotKey) {
      const placement = TP_STATE.placed[c.id];
      if (placement !== undefined) {
        if (hasSavedSlots) {
          // Placement is a slotKey (e.g., 'F1', 'U1')
          const slot = slots.find(s => s.key === placement);
          c.slotKey = slot ? slot.key : slots[0]?.key || 'F1';
        } else {
          // Placement is a numeric semester
          const slot = slots.find(s => s.origSem === placement);
          c.slotKey = slot ? slot.key : slots[0]?.key || 'F1';
        }
      } else {
        c.slotKey = slots[0]?.key || 'F1';
      }
    }
  }

  TP_STATE.rearrangedCourses = courses;
  TP_STATE.semesterSlots = slots;

  // UI updates
  const area = document.querySelector('.planner-section .audit-grid');
  if (area) area.classList.add('rearrange-mode');

  const controls = document.getElementById('tp-rearrange-controls');
  if (controls) controls.style.display = '';

  const legend = document.getElementById('tp-validation-legend');
  if (legend) legend.style.display = '';

  const toggleBtn = document.getElementById('tp-rearrange-btn');
  if (toggleBtn) {
    toggleBtn.textContent = 'Exit Rearrange';
    toggleBtn.classList.add('active');
  }

  tpReRenderRearrange();
}

function exitTranscriptRearrange(save) {
  if (!TP_STATE.rearrangeMode) return;

  if (save && TP_STATE.rearrangedCourses && TP_STATE.semesterSlots) {
    // Preserve the full slot model so summers survive
    TP_STATE.savedSlots = TP_STATE.semesterSlots.slice();

    // Map courses by slotKey (preserves summer identity)
    const newPlaced = {};
    const newSemCredits = {};
    for (const rc of TP_STATE.rearrangedCourses) {
      newPlaced[rc.id] = rc.slotKey;
      newSemCredits[rc.slotKey] = (newSemCredits[rc.slotKey] || 0) + rc.credits;
    }
    TP_STATE.placed = newPlaced;
    TP_STATE.semCredits = newSemCredits;
    TP_STATE.unplaced = [];
  }

  TP_STATE.rearrangeMode = false;
  TP_STATE.rearrangedCourses = null;
  TP_STATE.semesterSlots = null;

  // UI cleanup
  const area = document.querySelector('.planner-section .audit-grid');
  if (area) area.classList.remove('rearrange-mode');

  const controls = document.getElementById('tp-rearrange-controls');
  if (controls) controls.style.display = 'none';

  const legend = document.getElementById('tp-validation-legend');
  if (legend) legend.style.display = 'none';

  const toggleBtn = document.getElementById('tp-rearrange-btn');
  if (toggleBtn) {
    toggleBtn.textContent = 'Rearrange Schedule';
    toggleBtn.classList.remove('active');
  }

  // Re-render static grid
  renderPlanner(TP_STATE.remaining, TP_STATE.placed, TP_STATE.semCredits, TP_STATE.unplaced, TP_STATE.startSem);
  evaluateTPRequirements();
}

function tpReRenderRearrange() {
  const completedIds = buildCompletedIds();
  validateAllCourses(TP_STATE.rearrangedCourses, TP_STATE.semesterSlots, completedIds);
  renderRearrangeGrid({
    courses: TP_STATE.rearrangedCourses,
    slots: TP_STATE.semesterSlots,
    completedIds: completedIds,
    gridEl: document.getElementById('planner-grid'),
    onDrop: (cid, sk) => {
      const c = TP_STATE.rearrangedCourses.find(x => x.id === cid);
      if (c && c.slotKey !== sk) { c.slotKey = sk; tpReRenderRearrange(); }
    },
    onCardClick: openTPDetailPanel,
    onAddSemester: (type) => {
      if (appendSemesterOfType(TP_STATE.semesterSlots, type)) tpReRenderRearrange();
    },
    onInsertSummer: (key) => {
      if (insertSummerSlot(TP_STATE.semesterSlots, key)) tpReRenderRearrange();
    },
    onRemoveSemester: (slotKey) => {
      const inSlot = TP_STATE.rearrangedCourses.filter(c => c.slotKey === slotKey);
      if (inSlot.length > 0) return;
      if (removeSemesterSlot(TP_STATE.semesterSlots, slotKey)) tpReRenderRearrange();
    },
    statsEls: null,
  });
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  DETAIL PANEL (for rearrange mode card clicks)               ║
// ╚══════════════════════════════════════════════════════════════╝

function openTPDetailPanel(course) {
  // Reuse audit panel if available, or just show a simple alert
  // For now, look for the audit detail panel
  const panel = document.getElementById('audit-detail');
  if (!panel) return;

  const c = COURSES_ARRAY.find(x => x.id === course.id) || course;
  const titleEl = panel.querySelector('.audit-panel-title');
  const codeEl = panel.querySelector('.audit-panel-code');
  const creditsEl = panel.querySelector('.audit-panel-credits');
  const descEl = panel.querySelector('.audit-panel-desc');

  if (titleEl) titleEl.textContent = c.title || course.title;
  if (codeEl) codeEl.textContent = c.code || course.code;
  if (creditsEl) creditsEl.textContent = (c.credits || course.credits) + ' credits';
  if (descEl) descEl.textContent = c.desc || '';

  // Prereqs
  const prereqList = panel.querySelector('.audit-panel-prereqs');
  if (prereqList) {
    prereqList.innerHTML = '';
    for (const entry of (c.prereqs || [])) {
      const ids = Array.isArray(entry) ? entry : [entry];
      const li = document.createElement('li');
      li.textContent = ids.map(p => {
        const pc = COURSES_ARRAY.find(x => x.id === p);
        return pc ? pc.code : p;
      }).join(' or ');
      prereqList.appendChild(li);
    }
  }

  // Coreqs
  const coreqList = panel.querySelector('.audit-panel-coreqs');
  if (coreqList) {
    coreqList.innerHTML = '';
    for (const coId of (c.coreqs || [])) {
      const li = document.createElement('li');
      const co = COURSES_ARRAY.find(x => x.id === coId);
      li.textContent = co ? co.code : coId;
      coreqList.appendChild(li);
    }
  }

  panel.classList.add('open');
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  ADD COURSE MODAL                                            ║
// ╚══════════════════════════════════════════════════════════════╝

function openAddCourseModal() {
  const modal = document.getElementById('tp-add-course-modal');
  if (!modal) return;
  modal.style.display = '';

  const input = document.getElementById('tp-course-search');
  if (input) { input.value = ''; input.focus(); }
  filterAddCourseResults();

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAddCourseModal();
  });
}

function closeAddCourseModal() {
  const modal = document.getElementById('tp-add-course-modal');
  if (modal) modal.style.display = 'none';
}

function filterAddCourseResults() {
  const input = document.getElementById('tp-course-search');
  const results = document.getElementById('tp-course-results');
  if (!input || !results) return;

  const query = input.value.trim().toLowerCase();
  results.innerHTML = '';

  if (query.length < 2) {
    results.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:.7rem;padding:.5rem;">Type at least 2 characters to search...</div>';
    return;
  }

  // Show already-planned courses with a label so the user knows
  const plannedIds = new Set((TP_STATE.remaining || []).map(c => c.id));
  const completedIds = buildCompletedIds();

  let count = 0;
  for (const c of COURSES_ARRAY) {
    if (c.isPlaceholder) continue;
    if (!c.code.toLowerCase().includes(query) && !c.title.toLowerCase().includes(query)) continue;

    const inPlan = plannedIds.has(c.id);
    const completed = completedIds.has(c.id);
    const statusLabel = completed ? ' <span class="tp-result-tag">✓ Completed</span>' :
                         inPlan ? ' <span class="tp-result-tag">In Plan</span>' : '';

    const item = document.createElement('div');
    item.className = 'tp-course-result' + (completed ? ' tp-result-completed' : '');
    item.innerHTML =
      '<div class="tp-course-result-info">' +
        '<span class="tp-course-result-code">' + c.code + statusLabel + '</span>' +
        '<span class="tp-course-result-title">' + c.title + '</span>' +
      '</div>' +
      '<span class="tp-course-result-credits">' + c.credits + ' cr</span>';
    if (!inPlan && !completed) {
      item.addEventListener('click', () => addCourseFromModal(c));
    } else {
      item.style.opacity = '.5';
      item.style.cursor = 'default';
    }
    results.appendChild(item);

    count++;
    if (count >= 30) break; // limit results
  }

  if (count === 0) {
    results.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:.7rem;padding:.5rem;">No matching courses found.</div>';
  }
}

function addCourseFromModal(course) {
  const newCourse = {
    id: course.id, code: course.code, title: course.title,
    credits: course.credits || 0,
    prereqs: course.prereqs || [], coreqs: course.coreqs || [],
    offered: course.offered || null,
    isPlaceholder: false, defaultSem: null, origin: 'manual',
  };
  TP_STATE.addedCourses.push(newCourse);
  closeAddCourseModal();
  rebuildPlan();
}

function addCustomCourse() {
  const codeInput = document.getElementById('tp-custom-code');
  const titleInput = document.getElementById('tp-custom-title');
  const creditsInput = document.getElementById('tp-custom-credits');
  if (!codeInput || !titleInput || !creditsInput) return;

  const code = codeInput.value.trim();
  if (!code) { codeInput.focus(); return; }

  const title = titleInput.value.trim() || code;
  const credits = parseFloat(creditsInput.value) || 3;

  // Generate a unique ID from the code
  const id = 'CUSTOM_' + code.replace(/\s+/g, '_').toUpperCase() + '_' + Date.now();

  const newCourse = {
    id, code, title, credits,
    prereqs: [], coreqs: [], offered: null,
    isPlaceholder: false, defaultSem: null, origin: 'manual',
  };
  TP_STATE.addedCourses.push(newCourse);

  // Clear fields
  codeInput.value = '';
  titleInput.value = '';
  creditsInput.value = '3';

  closeAddCourseModal();
  rebuildPlan();
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  EXCEL EXPORT                                                ║
// ╚══════════════════════════════════════════════════════════════╝

function downloadTranscriptPlanExcel() {
  if (!TP_STATE.remaining || !TP_STATE.placed) return;
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Please reload the page.'); return; }

  const wb = XLSX.utils.book_new();
  const courses = TP_STATE.remaining;
  const placed = TP_STATE.placed;

  // ── Styles ──
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '4A2F1A' } },
    alignment: { horizontal: 'center' },
  };
  const semHeaderStyle = {
    font: { bold: true, sz: 11 },
    fill: { fgColor: { rgb: 'F5B80A' } },
  };

  const rows = [];

  // Title
  const programLabel = typeof getProgramLabel === 'function'
    ? getProgramLabel(AUDIT_STATE.program)
    : AUDIT_STATE.program;
  let title = programLabel + ' — Remaining Course Plan';
  if (AUDIT_STATE.studentName) {
    const name = AUDIT_STATE.studentName;
    title = (name.firstName || '') + ' ' + (name.lastName || '') + ' — ' + title;
  }
  rows.push([title]);

  // Stats
  const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
  rows.push(['Remaining Credits: ' + totalCredits]);
  rows.push([]); // blank

  // Header
  rows.push(['Semester', 'Code', 'Title', 'Credits']);
  const headerRowIdx = 3;

  // Group by semester — handle slot-based or numeric placements
  if (TP_STATE.savedSlots) {
    for (const slot of TP_STATE.savedSlots) {
      const slotCourses = courses
        .filter(c => placed[c.id] === slot.key)
        .sort((a, b) => a.code.localeCompare(b.code));
      if (!slotCourses.length) continue;
      const credits = TP_STATE.semCredits[slot.key] || 0;
      rows.push([slot.season + ', ' + slot.yearLabel + ' (' + credits + ' cr)', '', '', '']);
      for (const c of slotCourses) rows.push(['', c.code, c.title, c.credits]);
    }
  } else {
    let maxSem = TP_STATE.startSem;
    for (const sem of Object.values(placed)) {
      if (typeof sem === 'number' && sem > maxSem) maxSem = sem;
    }
    for (let sem = TP_STATE.startSem; sem <= maxSem; sem++) {
      const semCourses = courses
        .filter(c => placed[c.id] === sem)
        .sort((a, b) => a.code.localeCompare(b.code));
      if (!semCourses.length) continue;
      const { year, season } = getSemLabel(sem);
      const credits = TP_STATE.semCredits[sem] || 0;
      rows.push([season + ', ' + year + ' (' + credits + ' cr)', '', '', '']);
      for (const c of semCourses) rows.push(['', c.code, c.title, c.credits]);
    }
  }

  // Unplaced
  if (TP_STATE.unplaced && TP_STATE.unplaced.length) {
    rows.push([]);
    rows.push(['Could Not Schedule']);
    for (const c of TP_STATE.unplaced) {
      rows.push(['', c.code, c.title, c.credits]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 28 }, { wch: 14 }, { wch: 38 }, { wch: 8 },
  ];

  // Styles
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      if (R === 0) ws[addr].s = { font: { bold: true, sz: 14 } };
      else if (R === headerRowIdx) ws[addr].s = headerStyle;
      else if (C === 0 && ws[addr].v && typeof ws[addr].v === 'string' && ws[addr].v.includes(' cr)'))
        ws[addr].s = semHeaderStyle;
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Remaining Plan');

  let fileName = 'Remaining-Plan.xlsx';
  if (AUDIT_STATE.studentName && AUDIT_STATE.studentName.lastName) {
    fileName = AUDIT_STATE.studentName.lastName.replace(/\s+/g, '') + '-Plan.xlsx';
  }
  XLSX.writeFile(wb, fileName);
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  ESCAPE KEY HANDLER                                          ║
// ╚══════════════════════════════════════════════════════════════╝

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    // Close add course modal
    const modal = document.getElementById('tp-add-course-modal');
    if (modal && modal.style.display !== 'none') {
      closeAddCourseModal();
      return;
    }
    // Exit rearrange mode
    if (TP_STATE.rearrangeMode) {
      exitTranscriptRearrange(false);
      return;
    }
  }
});


// ╔══════════════════════════════════════════════════════════════╗
// ║  REQUIREMENTS CHECK (Transcript Planner)                    ║
// ║  Evaluates minor/CC requirements against the planned courses║
// ╚══════════════════════════════════════════════════════════════╝

function evaluateTPRequirements() {
  const section = document.getElementById('tp-req-section');
  const container = document.getElementById('tp-req-container');
  if (!section || !container) return;

  // Build set of all course IDs: completed + planned
  const completedIds = buildCompletedIds();
  const remaining = TP_STATE.remaining || [];
  const planIds = new Set([...completedIds, ...remaining.map(c => c.id)]);

  // Build pool for minor/CC evaluation: completed courses + planned courses
  const pool = [];
  const seen = new Set();

  const matched = AUDIT_STATE.lastMatched || [];
  for (const m of matched) {
    const status = typeof getCourseStatus === 'function' ? getCourseStatus(m.active?.grade) : 'completed';
    if (status === 'failed') continue;
    const code = typeof applyDeptRenames === 'function' ? applyDeptRenames(m.code) : m.code;
    if (seen.has(code)) continue;
    seen.add(code);
    const isIP = !m.active?.grade;
    pool.push({
      code,
      credits: isIP ? 0 : (m.active?.credits || (m.courseData ? m.courseData.credits : 3)),
      grade: m.active?.grade || null,
      status,
    });
  }

  for (const c of remaining) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    pool.push({ code: c.code, credits: c.credits, grade: null, status: 'planned' });
  }

  container.innerHTML = '';
  let hasCards = false;

  // Primary major
  const primaryResult = evaluateTPMajorReqs(AUDIT_STATE.program, planIds);
  if (primaryResult) {
    container.appendChild(renderTPMajorCard(primaryResult));
    hasCards = true;
  }

  // Secondary major (double major)
  if (AUDIT_STATE.secondaryProgram && !TP_STATE.restricted) {
    const secResult = evaluateTPMajorReqs(AUDIT_STATE.secondaryProgram, planIds);
    if (secResult) {
      container.appendChild(renderTPMajorCard(secResult));
      hasCards = true;
    }
  }

  // Minors
  const selectedMinors = AUDIT_STATE.selectedMinors || [];
  if (selectedMinors.length > 0 && typeof computeMinorAudit === 'function' && typeof MINORS_DATA !== 'undefined') {
    for (const minorKey of selectedMinors) {
      const minorDef = MINORS_DATA[minorKey];
      if (!minorDef || !minorDef.requirements) continue;
      const result = computeMinorAudit(pool, minorDef, new Set(), new Set());
      container.appendChild(
        typeof createMinorCard === 'function' ? createMinorCard(result) : renderTPFallbackCard(result)
      );
      hasCards = true;
    }
  }

  // CC Scholar
  if (AUDIT_STATE.ccEnabled && typeof CC_SCHOLAR_DATA !== 'undefined' && CC_SCHOLAR_DATA && CC_SCHOLAR_DATA.requirements) {
    if (typeof computeMinorAudit === 'function') {
      const ccDef = Object.assign({}, CC_SCHOLAR_DATA);
      ccDef.min_credits = ccDef.min_credits || ccDef.min_credits_beyond_fy || 0;
      const result = computeMinorAudit(pool, ccDef, new Set(), new Set());
      result.name = 'Christ College Scholar';
      container.appendChild(
        typeof createMinorCard === 'function' ? createMinorCard(result) : renderTPFallbackCard(result)
      );
      hasCards = true;
    }
  }

  section.style.display = hasCards ? '' : 'none';
}

// ── Major requirements evaluation for transcript planner ──

function evaluateTPMajorReqs(program, planIds) {
  const curriculumIds = COURSES_ARRAY
    .filter(c => c.semesters && c.semesters[program])
    .map(c => c.id);

  const groups = (typeof ELECTIVE_GROUPS !== 'undefined' && ELECTIVE_GROUPS[program]) || [];
  const groupedIds = new Set();
  for (const g of groups) {
    for (const id of g.ids) groupedIds.add(id);
  }

  const requiredIds = curriculumIds.filter(id => !groupedIds.has(id));
  const requiredResults = [];
  let metCount = 0;

  for (const id of requiredIds) {
    const course = COURSES[id];
    const met = planIds.has(id);
    if (met) metCount++;
    requiredResults.push({ id, code: course ? course.code : id, title: course ? course.title : '', met });
  }

  const groupResults = [];
  for (const g of groups) {
    if (g.key === 'core1' || g.key === 'core2') continue;
    const slotsInPlan = g.ids.filter(id => planIds.has(id)).length;
    const totalSlots = g.ids.length;
    const totalCredits = g.ids.reduce((s, id) => { const c = COURSES[id]; return s + (c ? c.credits : 3); }, 0);
    const filledCredits = g.ids.filter(id => planIds.has(id)).reduce((s, id) => { const c = COURSES[id]; return s + (c ? c.credits : 3); }, 0);
    const met = slotsInPlan === totalSlots;
    if (met) metCount++;
    groupResults.push({ key: g.key, label: g.label, slotsInPlan, totalSlots, filledCredits, totalCredits, met });
  }

  const label = (typeof ALL_PROGRAMS !== 'undefined' && ALL_PROGRAMS[program]) || program;
  const totalReqs = requiredResults.length + groupResults.length;

  return {
    program, label, requiredCourses: requiredResults, electiveGroups: groupResults,
    metCount, totalReqs, allMet: metCount === totalReqs,
  };
}

// ── Render major card (same structure as planner.js renderMajorCard) ──

function renderTPMajorCard(majorResult) {
  const allMet = majorResult.allMet;
  const card = document.createElement('div');
  card.className = 'minor-audit-card' + (allMet ? ' minor-met' : '');

  const header = document.createElement('div');
  header.className = 'minor-card-header';
  const statusIcon = document.createElement('span');
  statusIcon.className = 'minor-status-icon ' + (allMet ? 'met' : 'unmet');
  statusIcon.textContent = allMet ? '\u2713' : '\u25CB';
  header.appendChild(statusIcon);
  const title = document.createElement('span');
  title.className = 'minor-card-title';
  title.textContent = majorResult.label;
  header.appendChild(title);
  const tally = document.createElement('span');
  tally.className = 'minor-card-tally';
  tally.textContent = majorResult.metCount + ' / ' + majorResult.totalReqs;
  header.appendChild(tally);
  card.appendChild(header);

  // Progress bar
  const pct = majorResult.totalReqs > 0
    ? Math.min(100, Math.round((majorResult.metCount / majorResult.totalReqs) * 100)) : 0;
  const progressWrap = document.createElement('div');
  progressWrap.className = 'minor-progress-wrap';
  const progressBar = document.createElement('div');
  progressBar.className = 'minor-progress-bar';
  progressBar.style.width = pct + '%';
  progressBar.classList.add(pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty');
  progressWrap.appendChild(progressBar);
  card.appendChild(progressWrap);

  // Missing courses
  const missingCourses = majorResult.requiredCourses.filter(c => !c.met);
  if (missingCourses.length > 0) {
    const reqList = document.createElement('div');
    reqList.className = 'minor-req-list';
    const row = document.createElement('div');
    row.className = 'minor-req-row unmet';
    const icon = document.createElement('span');
    icon.className = 'minor-req-icon unmet';
    icon.textContent = '\u25CB';
    row.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'minor-req-label';
    label.textContent = 'Missing Courses';
    row.appendChild(label);
    const detail = document.createElement('span');
    detail.className = 'minor-req-detail';
    detail.innerHTML = '<span class="minor-need">Need: ' + missingCourses.map(c => c.code).join(', ') + '</span>';
    row.appendChild(detail);
    reqList.appendChild(row);
    card.appendChild(reqList);
  }

  // Elective groups
  if (majorResult.electiveGroups.length > 0) {
    const reqList = card.querySelector('.minor-req-list') || (() => {
      const el = document.createElement('div');
      el.className = 'minor-req-list';
      card.appendChild(el);
      return el;
    })();
    for (const g of majorResult.electiveGroups) {
      const row = document.createElement('div');
      row.className = 'minor-req-row ' + (g.met ? 'met' : 'unmet');
      const icon = document.createElement('span');
      icon.className = 'minor-req-icon ' + (g.met ? 'met' : 'unmet');
      icon.textContent = g.met ? '\u2713' : '\u25CB';
      row.appendChild(icon);
      const label = document.createElement('span');
      label.className = 'minor-req-label';
      label.textContent = g.label;
      row.appendChild(label);
      const detail = document.createElement('span');
      detail.className = 'minor-req-detail';
      if (g.met) {
        detail.innerHTML = '<span class="minor-course-chip">' + g.slotsInPlan + '/' + g.totalSlots + ' slots (' + g.filledCredits + ' cr)</span>';
      } else {
        detail.innerHTML = '<span class="minor-course-chip">' + g.slotsInPlan + '/' + g.totalSlots + ' slots</span>' +
          '<span class="minor-need">' + (g.totalCredits - g.filledCredits) + ' cr needed</span>';
      }
      row.appendChild(detail);
      reqList.appendChild(row);
    }
  }

  return card;
}

function renderTPFallbackCard(result) {
  const allMet = result.overallMet || result.requirements.every(r => r.met);
  const card = document.createElement('div');
  card.className = 'minor-audit-card' + (allMet ? ' minor-met' : '');

  const header = document.createElement('div');
  header.className = 'minor-card-header';

  const icon = document.createElement('span');
  icon.className = 'minor-status-icon ' + (allMet ? 'met' : 'unmet');
  icon.textContent = allMet ? '\u2713' : '\u25CB';
  header.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'minor-card-title';
  title.textContent = result.name;
  header.appendChild(title);

  if (result.minCredits) {
    const tally = document.createElement('span');
    tally.className = 'minor-card-tally';
    tally.textContent = result.totalApplied + ' / ' + result.minCredits + ' cr';
    header.appendChild(tally);
  }
  card.appendChild(header);

  // Requirements
  const reqList = document.createElement('div');
  reqList.className = 'minor-req-list';
  for (const req of result.requirements) {
    const row = document.createElement('div');
    row.className = 'minor-req-row ' + (req.met ? 'met' : 'unmet');
    const rowIcon = document.createElement('span');
    rowIcon.className = 'minor-req-icon ' + (req.met ? 'met' : 'unmet');
    rowIcon.textContent = req.met ? '\u2713' : '\u25CB';
    row.appendChild(rowIcon);
    const label = document.createElement('span');
    label.className = 'minor-req-label';
    label.textContent = req.label;
    row.appendChild(label);
    reqList.appendChild(row);
  }
  card.appendChild(reqList);
  return card;
}
