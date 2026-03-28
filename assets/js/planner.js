/* ╔══════════════════════════════════════════════════════════════╗
   ║  WHAT-IF PLANNER                                             ║
   ║  Select programs and see a combined 4-year course plan.      ║
   ║  No transcript needed — purely curriculum-based.             ║
   ║                                                              ║
   ║  Requires: scheduling-utils.js, inject-courses.html globals  ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── All available programs ───────────────────────────────────
const PLANNER_PROGRAMS = {
  ME:            'Mechanical Engineering',
  BE_Biomech:    'BE – Biomechanical',
  BE_Bioelec:    'BE – Bioelectrical',
  BE_Biomed:     'BE – Biomedical',
  CE:            'Civil Engineering',
  CPE:           'Computer Engineering',
  EE:            'Electrical Engineering',
  ENE:           'Environmental Engineering',
  Physics_BS:    'Physics B.S.',
  Math_BS:       'Mathematics B.S.',
  CS_BS:         'Computer Science B.S.',
  Chemistry_BS:  'Chemistry B.S.',
  Music_BA:      'Music B.A.',
};

// ── State ────────────────────────────────────────────────────
let PLANNER_STATE = {
  primary: null,
  secondary: null,
  selectedMinors: [],
  ccEnabled: false,
  mergedPlan: null,
  selected: null, // selected course for detail panel
  // Rearrange mode
  rearrangeMode: false,
  rearrangedCourses: null,  // deep copy of mergedPlan.courses for editing
  semesterSlots: null,       // ordered slot array (supports summer)
  dragCourse: null,          // course ID currently being dragged
};

// ── Program Selection ────────────────────────────────────────

function selectPrimaryProgram(prog, btn) {
  // Toggle deselect if re-clicking the same program
  if (PLANNER_STATE.primary === prog) {
    PLANNER_STATE.primary = null;
    PLANNER_STATE.secondary = null;
    PLANNER_STATE.selectedMinors = [];
    if (btn) btn.classList.remove('active');
    hidePlan();
    return;
  }

  PLANNER_STATE.primary = prog;
  PLANNER_STATE.secondary = null;
  PLANNER_STATE.selectedMinors = [];

  // Update button active state (skip current btn to avoid remove+re-add in same frame)
  document.querySelectorAll('#primary-prog-btns .prog-btn').forEach(b => {
    if (b !== btn) b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');

  // Load curriculum for this program
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(prog, 2025);
  }

  // Show secondary row and populate
  const secRow = document.getElementById('secondary-row');
  if (secRow) {
    secRow.style.display = '';
    populateSecondaryButtons();
  }

  // Show minor/CC row and populate
  const minorRow = document.getElementById('minor-row');
  if (minorRow) {
    minorRow.style.display = '';
    populatePlannerMinorButtons();
  }
  const ccRow = document.getElementById('cc-row');
  if (ccRow) ccRow.style.display = '';

  // Reset CC toggle
  PLANNER_STATE.ccEnabled = false;
  const ccBtn = document.getElementById('cc-toggle-btn');
  if (ccBtn) ccBtn.classList.remove('active');

  generatePlan();
}

function hidePlan() {
  document.getElementById('secondary-row').style.display = 'none';
  document.getElementById('minor-row').style.display = 'none';
  const ccRow = document.getElementById('cc-row');
  if (ccRow) ccRow.style.display = 'none';
  document.getElementById('planner-stats').style.display = 'none';
  document.getElementById('planner-area').style.display = 'none';
  document.getElementById('planner-legend').style.display = 'none';
  document.getElementById('planner-warning').style.display = 'none';
  document.getElementById('planner-overflow').style.display = 'none';
  const reqPanel = document.getElementById('planner-req-panel');
  if (reqPanel) reqPanel.style.display = 'none';
  closePlannerPanel();
}

function populateSecondaryButtons() {
  const container = document.getElementById('secondary-prog-btns');
  if (!container) return;
  container.innerHTML = '';

  for (const [key, label] of Object.entries(PLANNER_PROGRAMS)) {
    if (key === PLANNER_STATE.primary) continue;
    // Skip generic BE tracks if primary is a BE track
    const primaryIsBE = PLANNER_STATE.primary && PLANNER_STATE.primary.startsWith('BE_');
    if (primaryIsBE && key.startsWith('BE_')) continue;

    const btn = document.createElement('button');
    btn.className = 'prog-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (PLANNER_STATE.secondary === key) {
        // Toggle off on reclick
        PLANNER_STATE.secondary = null;
        btn.classList.remove('active');
      } else {
        PLANNER_STATE.secondary = key;
        container.querySelectorAll('.prog-btn').forEach(b => {
          if (b !== btn) b.classList.remove('active');
        });
        btn.classList.add('active');
      }
      generatePlan();
    });
    container.appendChild(btn);
  }
}

function clearSecondaryProgram() {
  PLANNER_STATE.secondary = null;
  const container = document.getElementById('secondary-prog-btns');
  if (container) container.querySelectorAll('.prog-btn').forEach(b => b.classList.remove('active'));
  generatePlan();
}

function populatePlannerMinorButtons() {
  const container = document.getElementById('minor-btns');
  if (!container || typeof MINORS_DATA === 'undefined') return;
  container.innerHTML = '';

  for (const [key, minor] of Object.entries(MINORS_DATA)) {
    const btn = document.createElement('button');
    btn.className = 'prog-btn minor-toggle-btn';
    btn.textContent = minor.name;
    btn.dataset.minor = key;
    btn.addEventListener('click', () => {
      const idx = PLANNER_STATE.selectedMinors.indexOf(key);
      if (idx >= 0) {
        PLANNER_STATE.selectedMinors.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        PLANNER_STATE.selectedMinors.push(key);
        btn.classList.add('active');
      }
      generatePlan();
    });
    container.appendChild(btn);
  }
}

function togglePlannerCC() {
  PLANNER_STATE.ccEnabled = !PLANNER_STATE.ccEnabled;
  const btn = document.getElementById('cc-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', PLANNER_STATE.ccEnabled);
  }
  if (PLANNER_STATE.primary) generatePlan();
}

// ── Plan Generation ──────────────────────────────────────────

function generatePlan() {
  if (!PLANNER_STATE.primary) return;

  const primary = PLANNER_STATE.primary;
  const secondary = PLANNER_STATE.secondary;

  // Load primary curriculum
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(primary, 2025);
  }

  // Collect primary courses
  const primaryCourses = COURSES_ARRAY.filter(c =>
    c.semesters && c.semesters[primary]
  );

  // Load secondary curriculum if needed
  let secondaryCourses = [];
  if (secondary) {
    if (typeof applyCurriculum === 'function') {
      applyCurriculum(secondary, 2025);
    }
    secondaryCourses = COURSES_ARRAY.filter(c =>
      c.semesters && c.semesters[secondary]
    );
    // Restore primary curriculum
    if (typeof applyCurriculum === 'function') {
      applyCurriculum(primary, 2025);
    }
  }

  // Merge courses
  const merged = mergeCourses(primaryCourses, secondaryCourses, primary, secondary);

  // Add minor courses
  const minorCourses = collectMinorCourses(merged);

  // Add CC courses
  const ccCourses = collectCCCourses([...merged, ...minorCourses]);

  // Combine
  const allCourses = [...merged, ...minorCourses, ...ccCourses];

  // Resolve prereq conflicts and rebalance
  const resolved = resolvePrereqConflicts(allCourses);
  const rebalanced = rebalanceSemesters(resolved);

  // Compute stats
  const stats = computeStats(rebalanced, secondary);

  PLANNER_STATE.mergedPlan = { courses: rebalanced, stats };

  renderPlan(rebalanced, stats);
  evaluateRequirementsPanel();
}

function mergeCourses(primaryCourses, secondaryCourses, primary, secondary) {
  const allIds = new Set();
  const merged = [];

  for (const c of primaryCourses) {
    allIds.add(c.id);
    const inSecondary = secondary && c.semesters && c.semesters[secondary];
    merged.push({
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits || 0,
      tags: c.tags || [],
      prereqs: c.prereqs || [],
      coreqs: c.coreqs || [],
      offered: c.offered || null,
      desc: c.desc || '',
      isPlaceholder: c.isPlaceholder || false,
      origin: inSecondary ? 'shared' : 'primary',
      semester: inSecondary
        ? Math.min(c.semesters[primary], c.semesters[secondary])
        : c.semesters[primary],
    });
  }

  for (const c of secondaryCourses) {
    if (allIds.has(c.id)) continue;
    allIds.add(c.id);
    merged.push({
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits || 0,
      tags: c.tags || [],
      prereqs: c.prereqs || [],
      coreqs: c.coreqs || [],
      offered: c.offered || null,
      desc: c.desc || '',
      isPlaceholder: c.isPlaceholder || false,
      origin: 'secondary',
      semester: c.semesters[secondary],
    });
  }

  return merged;
}

function collectMinorCourses(mergedCourses) {
  if (!PLANNER_STATE.selectedMinors.length) return [];
  if (typeof MINORS_DATA === 'undefined') return [];

  const existingIds = new Set(mergedCourses.map(c => c.id));
  const existingCodes = new Set(mergedCourses.map(c => c.code));
  const minorCourses = [];

  for (const minorKey of PLANNER_STATE.selectedMinors) {
    const minor = MINORS_DATA[minorKey];
    if (!minor || !minor.requirements) continue;

    for (const req of minor.requirements) {
      if (!req.courses) continue;
      for (const courseCode of req.courses) {
        if (existingCodes.has(courseCode)) continue;
        // Find course in COURSES_ARRAY by code
        const course = COURSES_ARRAY.find(c => c.code === courseCode);
        if (!course || existingIds.has(course.id)) continue;
        existingIds.add(course.id);
        existingCodes.add(course.code);
        minorCourses.push({
          id: course.id,
          code: course.code,
          title: course.title,
          credits: course.credits || 0,
          tags: course.tags || [],
          prereqs: course.prereqs || [],
          coreqs: course.coreqs || [],
          offered: course.offered || null,
          desc: course.desc || '',
          isPlaceholder: course.isPlaceholder || false,
          origin: 'minor',
          semester: null, // will be placed by resolvePrereqConflicts
        });
      }
    }
  }

  return minorCourses;
}

function collectCCCourses(existingCourses) {
  if (!PLANNER_STATE.ccEnabled) return [];
  if (typeof CC_SCHOLAR_DATA === 'undefined' || !CC_SCHOLAR_DATA) return [];

  const existingIds = new Set(existingCourses.map(c => c.id));
  const existingCodes = new Set(existingCourses.map(c => c.code));
  const ccCourses = [];

  for (const req of (CC_SCHOLAR_DATA.requirements || [])) {
    if (!req.courses) continue;
    const limit = req.type === 'pick' ? (req.pick || 1) : req.courses.length;
    let added = 0;
    for (const courseCode of req.courses) {
      if (added >= limit) break;
      if (existingCodes.has(courseCode)) { added++; continue; }

      const course = COURSES_ARRAY.find(c => c.code === courseCode);
      if (!course) continue;
      if (existingIds.has(course.id)) { added++; continue; }

      existingIds.add(course.id);
      existingCodes.add(courseCode);
      ccCourses.push({
        id: course.id,
        code: course.code,
        title: course.title,
        credits: course.credits || 0,
        tags: course.tags || [],
        prereqs: course.prereqs || [],
        coreqs: course.coreqs || [],
        offered: course.offered || null,
        desc: course.desc || '',
        isPlaceholder: false,
        origin: 'cc',
        semester: null,
      });
      added++;
    }
  }

  return ccCourses;
}

// ── Prereq Conflict Resolution ───────────────────────────────

function resolvePrereqConflicts(courses) {
  const byId = {};
  for (const c of courses) byId[c.id] = c;
  const allIds = new Set(courses.map(c => c.id));

  // For courses without a semester (minor courses), assign based on prereqs
  // First pass: assign unplaced courses a tentative semester
  for (const c of courses) {
    if (c.semester) continue;
    // Find latest prereq semester
    let latestPrereq = 0;
    for (const entry of (c.prereqs || [])) {
      const pIds = Array.isArray(entry) ? entry : [entry];
      for (const p of pIds) {
        if (byId[p] && byId[p].semester) {
          latestPrereq = Math.max(latestPrereq, byId[p].semester);
        }
      }
    }
    c.semester = latestPrereq + 1;
    // Adjust for offering constraint
    if (c.offered && c.offered !== 'Both') {
      while (semSeason(c.semester) !== c.offered) {
        c.semester++;
      }
    }
  }

  // Iteratively fix ordering violations until stable
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    for (const c of courses) {
      for (const entry of (c.prereqs || [])) {
        const pIds = Array.isArray(entry) ? entry : [entry];
        // For OR groups, we only need one to be before us
        const satisfiedBefore = pIds.some(p => {
          if (!allIds.has(p)) return true; // not in plan = satisfied externally
          return byId[p] && byId[p].semester < c.semester;
        });
        if (!satisfiedBefore) {
          // Find the earliest prereq option's semester
          let minPrereqSem = Infinity;
          for (const p of pIds) {
            if (byId[p]) minPrereqSem = Math.min(minPrereqSem, byId[p].semester);
          }
          if (minPrereqSem < Infinity) {
            let newSem = minPrereqSem + 1;
            if (c.offered && c.offered !== 'Both') {
              while (semSeason(newSem) !== c.offered) newSem++;
            }
            if (newSem !== c.semester) {
              c.semester = newSem;
              changed = true;
            }
          }
        }
      }
    }
  }

  return courses;
}

// ── Semester Rebalancing ─────────────────────────────────────

function rebalanceSemesters(courses) {
  const byId = {};
  for (const c of courses) byId[c.id] = c;
  const allIds = new Set(courses.map(c => c.id));

  // Recompute semester credit totals
  function recalcCredits() {
    const sc = {};
    for (const c of courses) {
      sc[c.semester] = (sc[c.semester] || 0) + c.credits;
    }
    return sc;
  }

  // Check if moving a course to a later semester would violate any dependent's prereqs
  function canMoveTo(course, targetSem) {
    // Offering constraint
    if (course.offered && course.offered !== 'Both' && semSeason(targetSem) !== course.offered) {
      return false;
    }
    // Check no dependent course is in targetSem or earlier
    for (const other of courses) {
      if (other.id === course.id) continue;
      for (const entry of (other.prereqs || [])) {
        const pIds = Array.isArray(entry) ? entry : [entry];
        if (pIds.includes(course.id)) {
          // 'other' depends on 'course' — course must stay before other
          if (targetSem >= other.semester) return false;
        }
      }
    }
    return true;
  }

  // Multiple passes to handle cascading overloads
  for (let pass = 0; pass < 5; pass++) {
    const semCredits = recalcCredits();
    let anyMoved = false;

    const overloadedSems = Object.entries(semCredits)
      .filter(([_, cr]) => cr > MAX_CREDITS_PER_SEM)
      .map(([s]) => parseInt(s))
      .sort((a, b) => a - b);

    for (const sem of overloadedSems) {
      // Sort: placeholders first, then courses with fewer dependents
      const semCourses = courses
        .filter(c => c.semester === sem)
        .sort((a, b) => {
          if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? -1 : 1;
          return 0;
        });

      let currentCredits = semCredits[sem];
      for (const c of semCourses) {
        if (currentCredits <= MAX_CREDITS_PER_SEM) break;

        // Try moving to next few semesters
        for (let targetSem = sem + 1; targetSem <= sem + 4; targetSem++) {
          const targetCredits = semCredits[targetSem] || 0;
          if (targetCredits + c.credits > MAX_CREDITS_PER_SEM) continue;
          if (!canMoveTo(c, targetSem)) continue;

          c.semester = targetSem;
          semCredits[sem] -= c.credits;
          semCredits[targetSem] = targetCredits + c.credits;
          currentCredits -= c.credits;
          anyMoved = true;
          break;
        }
      }
    }

    if (!anyMoved) break;
  }

  return courses;
}

// ── Stats Computation ────────────────────────────────────────

function computeStats(courses, hasSecondary) {
  const sharedCourses = courses.filter(c => c.origin === 'shared');
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);
  const maxSem = Math.max(...courses.map(c => c.semester), 0);

  // Per-semester credits for overload warnings
  const semCredits = {};
  for (const c of courses) {
    semCredits[c.semester] = (semCredits[c.semester] || 0) + c.credits;
  }
  const overloaded = Object.entries(semCredits)
    .filter(([_, cr]) => cr > MAX_CREDITS_PER_SEM)
    .map(([sem, cr]) => ({ semester: parseInt(sem), credits: cr }));

  return {
    totalCredits,
    semesters: maxSem,
    sharedCount: sharedCourses.length,
    sharedCredits: sharedCourses.reduce((s, c) => s + c.credits, 0),
    overloaded,
    semCredits,
    hasSecondary: !!hasSecondary,
  };
}

// ── Rendering ────────────────────────────────────────────────

function renderPlan(courses, stats) {
  // Show containers
  document.getElementById('planner-stats').style.display = '';
  document.getElementById('planner-area').style.display = '';
  document.getElementById('planner-legend').style.display = '';

  // Stats
  document.getElementById('planner-total-credits').textContent = stats.totalCredits;
  document.getElementById('planner-semesters').textContent = stats.semesters;
  document.getElementById('planner-shared').textContent = stats.sharedCount;
  document.getElementById('planner-shared-credits').textContent = stats.sharedCredits;

  // Show/hide shared stats based on whether there's a secondary
  const sharedStatEls = document.querySelectorAll('#planner-shared, #planner-shared-credits');
  // The parent .planner-stat elements
  sharedStatEls.forEach(el => {
    el.closest('.planner-stat').style.display = stats.hasSecondary ? '' : 'none';
  });

  // Legend items
  const legendSec = document.getElementById('legend-secondary');
  if (legendSec) legendSec.style.display = stats.hasSecondary ? '' : 'none';
  const legendMinor = document.getElementById('legend-minor');
  if (legendMinor) legendMinor.style.display = PLANNER_STATE.selectedMinors.length ? '' : 'none';
  const legendCC = document.getElementById('legend-cc');
  if (legendCC) legendCC.style.display = PLANNER_STATE.ccEnabled ? '' : 'none';

  // Overload warning
  const warning = document.getElementById('planner-warning');
  if (stats.overloaded.length) {
    const semLabels = stats.overloaded.map(o => {
      const { year, season } = getSemLabel(o.semester);
      return season + ', ' + year + ' (' + o.credits + ' cr)';
    });
    warning.innerHTML = '&#9888; Overloaded semesters: ' + semLabels.join('; ');
    warning.style.display = '';
  } else {
    warning.style.display = 'none';
  }

  // Grid
  const grid = document.getElementById('planner-grid');
  grid.innerHTML = '';

  const maxSem = stats.semesters;

  for (let sem = 1; sem <= maxSem; sem++) {
    const semCourses = courses
      .filter(c => c.semester === sem)
      .sort((a, b) => {
        // Non-placeholders first, then by code
        if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
        return a.code.localeCompare(b.code);
      });

    if (!semCourses.length) continue;

    const { year, season } = getSemLabel(sem);
    const credits = stats.semCredits[sem] || 0;
    const isOverloaded = credits > MAX_CREDITS_PER_SEM;

    const col = document.createElement('div');
    col.className = 'sem-col';

    // Header
    const header = document.createElement('div');
    header.className = 'sem-header';
    header.innerHTML =
      '<div class="sem-year">' + year + '</div>' +
      '<div class="sem-name">' + season + ' &mdash; ' +
        '<span class="' + (isOverloaded ? 'credits-overloaded' : '') + '">' +
          credits + ' cr' +
        '</span>' +
      '</div>';
    col.appendChild(header);

    // Cards
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'sem-cards';

    for (const course of semCourses) {
      const card = document.createElement('div');
      card.className = 'planner-card origin-' + course.origin;
      card.dataset.id = course.id;
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => openPlannerPanel(course));

      // Tag color stripe
      const tag = (course.tags && course.tags[0]) ? course.tags[0] : null;
      const tagStyle = tag && TAGS[tag] ? TAGS[tag] : null;
      if (tagStyle) {
        card.style.borderLeftColor = tagStyle.bg;
      }

      card.innerHTML =
        '<div class="planner-card-top">' +
          '<span class="planner-code">' + course.code + '</span>' +
          '<span class="planner-origin-dot origin-dot-' + course.origin + '"></span>' +
        '</div>' +
        '<div class="planner-title">' + course.title + '</div>' +
        '<div class="planner-card-bottom">' +
          '<span class="planner-credits">' + course.credits + ' cr</span>' +
        '</div>';

      cardsWrap.appendChild(card);
    }

    col.appendChild(cardsWrap);
    grid.appendChild(col);
  }

  // Overflow — shouldn't happen often but just in case
  const overflow = document.getElementById('planner-overflow');
  const overflowList = document.getElementById('planner-overflow-list');
  const unplaced = courses.filter(c => !c.semester || c.semester < 1);
  if (unplaced.length) {
    overflow.style.display = '';
    overflowList.innerHTML = '';
    for (const c of unplaced) {
      const card = document.createElement('div');
      card.className = 'planner-card origin-' + c.origin;
      card.innerHTML =
        '<div class="planner-card-top"><span class="planner-code">' + c.code + '</span></div>' +
        '<div class="planner-title">' + c.title + '</div>' +
        '<div class="planner-card-bottom"><span class="planner-credits">' + c.credits + ' cr</span></div>';
      overflowList.appendChild(card);
    }
  } else {
    overflow.style.display = 'none';
  }
}

// ── Detail Panel ─────────────────────────────────────────────

function openPlannerPanel(course) {
  PLANNER_STATE.selected = course;

  // Highlight selected card
  document.querySelectorAll('.planner-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector('.planner-card[data-id="' + course.id + '"]');
  if (card) card.classList.add('selected');

  const panel = document.getElementById('planner-detail-panel');
  panel.classList.add('open');

  document.getElementById('planner-panel-code').textContent = course.code;
  document.getElementById('planner-panel-title').textContent = course.title;
  document.getElementById('planner-panel-credits').textContent = course.credits + ' credits';

  // Origin label
  const originLabels = {
    shared: 'Required by both programs',
    primary: 'Primary program only',
    secondary: 'Secondary program only',
    minor: 'Minor requirement',
    cc: 'Christ College Scholar',
  };
  document.getElementById('planner-panel-origin').textContent = originLabels[course.origin] || '';

  document.getElementById('planner-panel-desc').textContent = course.desc || 'No description available.';

  // Prereqs
  const prereqEl = document.getElementById('planner-panel-prereqs');
  prereqEl.innerHTML = '';
  if (course.prereqs && course.prereqs.length) {
    for (const entry of course.prereqs) {
      const pIds = Array.isArray(entry) ? entry : [entry];
      const labels = pIds.map(p => {
        const pc = COURSES[p];
        return pc ? pc.code : p;
      });
      const span = document.createElement('span');
      span.className = 'rel-chip';
      span.textContent = labels.join(' or ');
      prereqEl.appendChild(span);
    }
  } else {
    prereqEl.textContent = 'None';
  }

  // Coreqs
  const coreqEl = document.getElementById('planner-panel-coreqs');
  coreqEl.innerHTML = '';
  if (course.coreqs && course.coreqs.length) {
    for (const co of course.coreqs) {
      const cc = COURSES[co];
      const span = document.createElement('span');
      span.className = 'rel-chip';
      span.textContent = cc ? cc.code : co;
      coreqEl.appendChild(span);
    }
  } else {
    coreqEl.textContent = 'None';
  }
}

function closePlannerPanel() {
  PLANNER_STATE.selected = null;
  document.getElementById('planner-detail-panel').classList.remove('open');
  document.querySelectorAll('.planner-card').forEach(c => c.classList.remove('selected'));
}

// ── Click-off & keyboard ─────────────────────────────────────
document.getElementById('planner-area')?.addEventListener('click', ev => {
  if (ev.target.closest('.planner-card')) return;
  if (ev.target.closest('.add-semester-col')) return;
  if (ev.target.closest('.add-summer-btn')) return;
  if (PLANNER_STATE.selected) closePlannerPanel();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    if (PLANNER_STATE.rearrangeMode) { exitRearrangeMode(false); return; }
    if (PLANNER_STATE.selected) closePlannerPanel();
  }
});


// ╔══════════════════════════════════════════════════════════════╗
// ║  EXCEL EXPORT                                                ║
// ╚══════════════════════════════════════════════════════════════╝

function downloadPlanExcel() {
  if (!PLANNER_STATE.mergedPlan) return;
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Please reload the page.'); return; }

  const wb = XLSX.utils.book_new();
  const courses = PLANNER_STATE.mergedPlan.courses;
  const stats = PLANNER_STATE.mergedPlan.stats;

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
  const originColors = {
    shared:    { rgb: 'C6EFCE' },
    primary:   { rgb: 'FFF2CC' },
    secondary: { rgb: 'D6E4F0' },
    minor:     { rgb: 'E8D5F5' },
    cc:        { rgb: 'F5E6C8' },
  };

  // ── Build "Course Plan" sheet ──
  const rows = [];

  // Title row
  const primaryLabel = PLANNER_PROGRAMS[PLANNER_STATE.primary] || PLANNER_STATE.primary;
  let title = primaryLabel;
  if (PLANNER_STATE.secondary) {
    title += ' + ' + (PLANNER_PROGRAMS[PLANNER_STATE.secondary] || PLANNER_STATE.secondary);
  }
  rows.push([title + ' — Course Plan']);
  rows.push([
    'Total Credits: ' + stats.totalCredits,
    'Semesters: ' + stats.semesters,
    stats.hasSecondary ? 'Shared Courses: ' + stats.sharedCount : '',
  ]);
  rows.push([]); // blank row

  // Header row
  rows.push(['Semester', 'Code', 'Title', 'Credits', 'Origin']);
  const headerRowIdx = 3;

  // Group courses by semester
  const maxSem = stats.semesters;
  for (let sem = 1; sem <= maxSem; sem++) {
    const semCourses = courses
      .filter(c => c.semester === sem)
      .sort((a, b) => a.code.localeCompare(b.code));
    if (!semCourses.length) continue;

    const { year, season } = getSemLabel(sem);
    const semLabel = season + ', ' + year;
    const semCredits = stats.semCredits[sem] || 0;

    // Semester sub-header
    rows.push([semLabel + ' (' + semCredits + ' cr)', '', '', '', '']);

    for (const c of semCourses) {
      const originLabel = c.origin === 'shared' ? 'Shared' :
                          c.origin === 'primary' ? 'Primary' :
                          c.origin === 'secondary' ? 'Secondary' :
                          c.origin === 'minor' ? 'Minor' :
                          c.origin === 'cc' ? 'Christ College' : '';
      rows.push(['', c.code, c.title, c.credits, originLabel]);
    }
  }

  // Minors summary
  if (PLANNER_STATE.selectedMinors.length) {
    rows.push([]);
    rows.push(['Minors: ' + PLANNER_STATE.selectedMinors.map(k =>
      MINORS_DATA[k]?.name || k
    ).join(', ')]);
  }
  if (PLANNER_STATE.ccEnabled) {
    rows.push(['Christ College Scholar: Yes']);
  }

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 28 }, // Semester
    { wch: 14 }, // Code
    { wch: 38 }, // Title
    { wch: 8 },  // Credits
    { wch: 14 }, // Origin
  ];

  // Apply styles
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;

      // Title row
      if (R === 0) {
        ws[addr].s = { font: { bold: true, sz: 14 } };
      }
      // Header row
      else if (R === headerRowIdx) {
        ws[addr].s = headerStyle;
      }
      // Semester sub-header rows
      else if (C === 0 && ws[addr].v && typeof ws[addr].v === 'string' && ws[addr].v.includes(' cr)')) {
        ws[addr].s = semHeaderStyle;
      }
      // Course rows — color by origin
      else if (C === 4 && ws[addr].v) {
        const originKey = ws[addr].v.toLowerCase();
        const color = originColors[originKey];
        if (color) {
          // Apply color to the entire row
          for (let cc = 0; cc <= 4; cc++) {
            const rowAddr = XLSX.utils.encode_cell({ r: R, c: cc });
            if (ws[rowAddr]) {
              ws[rowAddr].s = { fill: { fgColor: color } };
            }
          }
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Course Plan');

  // ── Filename ──
  let fileName = primaryLabel.replace(/[^a-zA-Z0-9]/g, '') + '-Plan.xlsx';
  XLSX.writeFile(wb, fileName);
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  REARRANGE SCHEDULE MODE                                    ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Enter / Exit Rearrange Mode (uses shared rearrange-engine.js) ──

function plannerReRenderRearrange() {
  validateAllCourses(PLANNER_STATE.rearrangedCourses, PLANNER_STATE.semesterSlots, new Set());
  renderRearrangeGrid({
    courses: PLANNER_STATE.rearrangedCourses,
    slots: PLANNER_STATE.semesterSlots,
    completedIds: new Set(),
    gridEl: document.getElementById('planner-grid'),
    onDrop: (cid, sk) => {
      const c = PLANNER_STATE.rearrangedCourses.find(x => x.id === cid);
      if (c && c.slotKey !== sk) { c.slotKey = sk; plannerReRenderRearrange(); }
    },
    onCardClick: openPlannerPanel,
    onAddSemester: (type) => {
      if (appendSemesterOfType(PLANNER_STATE.semesterSlots, type)) plannerReRenderRearrange();
    },
    onInsertSummer: (key) => {
      if (insertSummerSlot(PLANNER_STATE.semesterSlots, key)) plannerReRenderRearrange();
    },
    onRemoveSemester: (slotKey) => {
      const inSlot = PLANNER_STATE.rearrangedCourses.filter(c => c.slotKey === slotKey);
      if (inSlot.length > 0) return;
      if (removeSemesterSlot(PLANNER_STATE.semesterSlots, slotKey)) plannerReRenderRearrange();
    },
    statsEls: {
      totalCredits: document.getElementById('planner-total-credits'),
      semesters: document.getElementById('planner-semesters'),
    },
  });
}

function enterRearrangeMode() {
  if (!PLANNER_STATE.mergedPlan) return;
  PLANNER_STATE.rearrangeMode = true;

  // Deep-copy courses
  PLANNER_STATE.rearrangedCourses = PLANNER_STATE.mergedPlan.courses.map(c => {
    const copy = Object.assign({}, c);
    copy.prereqs = c.prereqs ? c.prereqs.slice() : [];
    copy.coreqs = c.coreqs ? c.coreqs.slice() : [];
    copy.tags = c.tags ? c.tags.slice() : [];
    return copy;
  });

  // Build slot model from current numeric semesters
  const maxSem = PLANNER_STATE.mergedPlan.stats.semesters;
  PLANNER_STATE.semesterSlots = buildSlotsFromSemesters(maxSem);

  // Assign slotKey to each course based on its numeric semester
  const slots = PLANNER_STATE.semesterSlots;
  for (const c of PLANNER_STATE.rearrangedCourses) {
    const slot = slots.find(s => s.origSem === c.semester);
    c.slotKey = slot ? slot.key : slots[0]?.key || 'F1';
  }

  // UI updates
  document.getElementById('planner-area')?.classList.add('rearrange-mode');
  closePlannerPanel();

  // Disable program selection
  document.querySelectorAll('.planner-controls .prog-btn, .planner-controls .planner-clear-btn').forEach(b => {
    b.classList.add('disabled');
    b.dataset.origOnclick = b.getAttribute('onclick') || '';
    b.removeAttribute('onclick');
    b._origClickHandler = b.onclick;
    b.onclick = null;
  });

  // Swap legends
  const originLegend = document.getElementById('planner-legend');
  const validLegend = document.getElementById('planner-legend-validation');
  if (originLegend) originLegend.style.display = 'none';
  if (validLegend) validLegend.style.display = '';

  // Show rearrange controls
  const controls = document.getElementById('rearrange-controls');
  if (controls) controls.style.display = '';
  const toggleBtn = document.getElementById('rearrange-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = 'Exit Rearrange';
    toggleBtn.classList.add('active');
  }

  // Hide overload warning (validation replaces it)
  const warning = document.getElementById('planner-warning');
  if (warning) warning.style.display = 'none';

  plannerReRenderRearrange();
}

function exitRearrangeMode(save) {
  if (!PLANNER_STATE.rearrangeMode) return;

  if (save && PLANNER_STATE.rearrangedCourses && PLANNER_STATE.semesterSlots) {
    const slots = PLANNER_STATE.semesterSlots;
    const slotMap = {};
    for (const s of slots) slotMap[s.key] = s;

    for (const rc of PLANNER_STATE.rearrangedCourses) {
      const slot = slotMap[rc.slotKey];
      if (slot && slot.origSem) {
        rc.semester = slot.origSem;
      } else if (slot) {
        rc.semester = slot.order + 1;
      }
    }
    PLANNER_STATE.mergedPlan.courses = PLANNER_STATE.rearrangedCourses;
    PLANNER_STATE.mergedPlan.stats = computeStats(
      PLANNER_STATE.mergedPlan.courses,
      PLANNER_STATE.secondary !== null
    );
  }

  PLANNER_STATE.rearrangeMode = false;
  PLANNER_STATE.rearrangedCourses = null;
  PLANNER_STATE.semesterSlots = null;
  PLANNER_STATE.dragCourse = null;

  // UI cleanup
  document.getElementById('planner-area')?.classList.remove('rearrange-mode');

  // Re-enable program selection
  document.querySelectorAll('.planner-controls .prog-btn, .planner-controls .planner-clear-btn').forEach(b => {
    b.classList.remove('disabled');
    const orig = b.dataset.origOnclick;
    if (orig) b.setAttribute('onclick', orig);
    if (b._origClickHandler) b.onclick = b._origClickHandler;
  });

  // Swap legends back
  const originLegend = document.getElementById('planner-legend');
  const validLegend = document.getElementById('planner-legend-validation');
  if (originLegend) originLegend.style.display = '';
  if (validLegend) validLegend.style.display = 'none';

  // Hide rearrange controls
  const controls = document.getElementById('rearrange-controls');
  if (controls) controls.style.display = 'none';
  const toggleBtn = document.getElementById('rearrange-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = 'Rearrange Schedule';
    toggleBtn.classList.remove('active');
  }

  // Re-render normal plan
  if (PLANNER_STATE.mergedPlan) {
    renderPlan(PLANNER_STATE.mergedPlan.courses, PLANNER_STATE.mergedPlan.stats);
    evaluateRequirementsPanel();
  }
}

function toggleRearrangeMode() {
  if (PLANNER_STATE.rearrangeMode) {
    exitRearrangeMode(false);
  } else {
    enterRearrangeMode();
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  REQUIREMENTS PANEL                                         ║
// ║  Evaluates plan against program, minor, and CC requirements ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Build pool from plan courses (compatible with transcript-minor evaluators) ──

function buildPlannerPool(courses) {
  return courses.map(c => ({
    code: c.code,
    credits: c.credits,
    grade: null,
    status: 'planned',
  }));
}

// ── Evaluate major program requirements ──

function evaluateMajorReqs(program, planIds) {
  // Get all curriculum course IDs for this program
  const curriculumIds = COURSES_ARRAY
    .filter(c => c.semesters && c.semesters[program])
    .map(c => c.id);

  // Get elective group IDs for this program
  const groups = (typeof ELECTIVE_GROUPS !== 'undefined' && ELECTIVE_GROUPS[program]) || [];
  const groupedIds = new Set();
  for (const g of groups) {
    for (const id of g.ids) groupedIds.add(id);
  }

  // Required (non-grouped) courses
  const requiredIds = curriculumIds.filter(id => !groupedIds.has(id));
  const requiredResults = [];
  let metCount = 0;

  for (const id of requiredIds) {
    const course = COURSES[id];
    const met = planIds.has(id);
    if (met) metCount++;
    requiredResults.push({
      id,
      code: course ? course.code : id,
      title: course ? course.title : '',
      met,
    });
  }

  // Elective group summaries
  const groupResults = [];
  for (const g of groups) {
    // Skip Core I/II — they're always in the plan as required courses
    if (g.key === 'core1' || g.key === 'core2') continue;

    const slotsInPlan = g.ids.filter(id => planIds.has(id)).length;
    const totalSlots = g.ids.length;
    const totalCredits = g.ids.reduce((s, id) => {
      const c = COURSES[id];
      return s + (c ? c.credits : 3);
    }, 0);
    const filledCredits = g.ids
      .filter(id => planIds.has(id))
      .reduce((s, id) => {
        const c = COURSES[id];
        return s + (c ? c.credits : 3);
      }, 0);
    const met = slotsInPlan === totalSlots;
    if (met) metCount++;

    groupResults.push({
      key: g.key,
      label: g.label,
      slotsInPlan,
      totalSlots,
      filledCredits,
      totalCredits,
      met,
    });
  }

  const totalReqs = requiredResults.length + groupResults.length;

  return {
    program,
    label: PLANNER_PROGRAMS[program] || program,
    requiredCourses: requiredResults,
    electiveGroups: groupResults,
    metCount,
    totalReqs,
    allMet: metCount === totalReqs,
  };
}

// ── Evaluate minor requirements using shared evaluators ──

function evaluateMinorReqs(minorKey, pool) {
  const minorDef = MINORS_DATA[minorKey];
  if (!minorDef || !minorDef.requirements) return null;

  // computeMinorAudit is from transcript-minor.js
  if (typeof computeMinorAudit !== 'function') return null;

  return computeMinorAudit(pool, minorDef, new Set(), new Set());
}

// ── Evaluate CC Scholar requirements ──

function evaluateCCReqs(pool) {
  if (!CC_SCHOLAR_DATA || !CC_SCHOLAR_DATA.requirements) return null;
  if (typeof computeMinorAudit !== 'function') return null;

  // Adapt CC data to match minor definition format (min_credits, name without "Minor" suffix)
  const ccDef = Object.assign({}, CC_SCHOLAR_DATA);
  ccDef.min_credits = ccDef.min_credits || ccDef.min_credits_beyond_fy || 0;

  const result = computeMinorAudit(pool, ccDef, new Set(), new Set());
  // Fix title — createMinorCard appends " Minor", so strip it from the name
  result.name = 'Christ College Scholar';
  return result;
}

// ── Look up major_reqs by program ID (YAML keys are lowercase filenames) ──

function findMajorReqs(programId) {
  if (typeof MAJOR_REQS_DATA === 'undefined') return null;
  // Try direct key match first, then search by id field
  if (MAJOR_REQS_DATA[programId]) return MAJOR_REQS_DATA[programId];
  for (const val of Object.values(MAJOR_REQS_DATA)) {
    if (val.id === programId) return val;
  }
  return null;
}

// ── Main orchestrator ──

function evaluateRequirementsPanel() {
  const panel = document.getElementById('planner-req-panel');
  if (!panel) return;

  if (!PLANNER_STATE.mergedPlan || !PLANNER_STATE.primary) {
    panel.style.display = 'none';
    return;
  }

  const courses = PLANNER_STATE.mergedPlan.courses;
  const pool = buildPlannerPool(courses);

  const results = { majors: [], minors: [], cc: null };

  // Major programs
  for (const prog of [PLANNER_STATE.primary, PLANNER_STATE.secondary]) {
    if (!prog) continue;
    const majorDef = findMajorReqs(prog);
    if (majorDef && majorDef.requirements && typeof computeMinorAudit === 'function') {
      results.majors.push(computeMinorAudit(pool, majorDef, new Set(), new Set()));
    }
  }

  // Minors
  for (const minorKey of PLANNER_STATE.selectedMinors) {
    const minorResult = evaluateMinorReqs(minorKey, pool);
    if (minorResult) results.minors.push(minorResult);
  }

  // CC Scholar
  if (PLANNER_STATE.ccEnabled) {
    results.cc = evaluateCCReqs(pool);
  }

  renderRequirementsPanel(results);
}

// ── Rendering ──

function renderRequirementsPanel(results) {
  const panel = document.getElementById('planner-req-panel');
  const container = document.getElementById('planner-req-container');
  if (!panel || !container) return;

  container.innerHTML = '';
  let hasCards = false;

  // Major programs
  for (const m of results.majors) {
    container.appendChild(
      typeof createMinorCard === 'function' ? createMinorCard(m) : renderFallbackMinorCard(m)
    );
    hasCards = true;
  }

  // Minors
  for (const m of results.minors) {
    container.appendChild(
      typeof createMinorCard === 'function' ? createMinorCard(m) : renderFallbackMinorCard(m)
    );
    hasCards = true;
  }

  // CC Scholar
  if (results.cc) {
    container.appendChild(
      typeof createMinorCard === 'function' ? createMinorCard(results.cc) : renderFallbackMinorCard(results.cc)
    );
    hasCards = true;
  }

  panel.style.display = hasCards ? '' : 'none';
}

// ── Major program card (uses minor-audit-card DOM structure) ──

function renderMajorCard(majorResult) {
  const allMet = majorResult.allMet;
  const card = document.createElement('div');
  card.className = 'minor-audit-card' + (allMet ? ' minor-met' : '');

  // Header
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
    ? Math.min(100, Math.round((majorResult.metCount / majorResult.totalReqs) * 100))
    : 0;
  const progressWrap = document.createElement('div');
  progressWrap.className = 'minor-progress-wrap';
  const progressBar = document.createElement('div');
  progressBar.className = 'minor-progress-bar';
  progressBar.style.width = pct + '%';
  progressBar.classList.add(pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty');
  progressWrap.appendChild(progressBar);
  card.appendChild(progressWrap);

  // Missing required courses
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
    detail.innerHTML = '<span class="minor-need">Need: ' +
      missingCourses.map(c => c.code).join(', ') + '</span>';
    row.appendChild(detail);

    reqList.appendChild(row);
    card.appendChild(reqList);
  }

  // Elective groups as requirement rows
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
        detail.innerHTML = '<span class="minor-course-chip">' +
          g.slotsInPlan + '/' + g.totalSlots + ' slots (' + g.filledCredits + ' cr)</span>';
      } else {
        detail.innerHTML = '<span class="minor-course-chip">' +
          g.slotsInPlan + '/' + g.totalSlots + ' slots</span>' +
          '<span class="minor-need">' + (g.totalCredits - g.filledCredits) + ' cr needed</span>';
      }
      row.appendChild(detail);

      reqList.appendChild(row);
    }
  }

  return card;
}

// ── Fallback minor card (if createMinorCard not available) ──

function renderFallbackMinorCard(result) {
  const allMet = result.overallMet || result.requirements.every(r => r.met);
  const card = document.createElement('div');
  card.className = 'minor-audit-card' + (allMet ? ' minor-met' : '');

  // Header
  const header = document.createElement('div');
  header.className = 'minor-card-header';

  const statusIcon = document.createElement('span');
  statusIcon.className = 'minor-status-icon ' + (allMet ? 'met' : 'unmet');
  statusIcon.textContent = allMet ? '\u2713' : '\u25CB';
  header.appendChild(statusIcon);

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

  // Progress bar
  if (result.minCredits) {
    const pct = Math.min(100, Math.round((result.totalApplied / result.minCredits) * 100));
    const progressWrap = document.createElement('div');
    progressWrap.className = 'minor-progress-wrap';
    const progressBar = document.createElement('div');
    progressBar.className = 'minor-progress-bar';
    progressBar.style.width = pct + '%';
    progressBar.classList.add(pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty');
    progressWrap.appendChild(progressBar);
    card.appendChild(progressWrap);
  }

  // Requirements
  const reqList = document.createElement('div');
  reqList.className = 'minor-req-list';
  for (const req of result.requirements) {
    reqList.appendChild(
      typeof createReqRow === 'function' ? createReqRow(req) : renderFallbackReqRow(req)
    );
  }
  card.appendChild(reqList);

  // Above and beyond
  if (result.aboveAndBeyond) {
    const aab = result.aboveAndBeyond;
    const aabRow = document.createElement('div');
    aabRow.className = 'minor-aab-row ' + (aab.met ? 'met' : 'unmet');
    const aabIcon = document.createElement('span');
    aabIcon.className = 'minor-req-icon ' + (aab.met ? 'met' : 'unmet');
    aabIcon.textContent = aab.met ? '\u2713' : '\u2717';
    aabRow.appendChild(aabIcon);
    const aabText = document.createElement('span');
    aabText.className = 'minor-aab-text';
    aabText.textContent = aab.met
      ? 'Above & Beyond: ' + aab.course
      : 'Above & Beyond: need 1 course (200+, 3+ cr) not used for degree';
    aabRow.appendChild(aabText);
    card.appendChild(aabRow);
  }

  return card;
}

function renderFallbackReqRow(req) {
  const row = document.createElement('div');
  row.className = 'minor-req-row ' + (req.met ? 'met' : 'unmet');

  const icon = document.createElement('span');
  icon.className = 'minor-req-icon ' + (req.met ? 'met' : 'unmet');
  icon.textContent = req.met ? '\u2713' : '\u25CB';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'minor-req-label';
  label.textContent = req.label;
  row.appendChild(label);

  const detail = document.createElement('span');
  detail.className = 'minor-req-detail';
  if (req.filled && req.filled.length > 0) {
    detail.innerHTML = req.filled.map(f =>
      '<span class="minor-course-chip">' + f.code +
      ' (' + (f.credits > 0 ? f.credits + ' cr' : '- cr') + ')</span>'
    ).join(' ');
  }
  if (req.type === 'credits' && !req.met) {
    const remaining = Math.max(0, req.creditsNeeded - req.creditsApplied);
    detail.innerHTML += '<span class="minor-need">' + remaining + ' cr needed</span>';
  }
  if (req.type === 'required' && req.missing && req.missing.length > 0) {
    detail.innerHTML += '<span class="minor-need">Need: ' + req.missing.join(', ') + '</span>';
  }
  if (req.type === 'pick' && !req.met) {
    const remaining = (req.needed || 1) - req.filled.length;
    detail.innerHTML += '<span class="minor-need">' + remaining + ' more course(s) needed</span>';
  }
  row.appendChild(detail);

  return row;
}

