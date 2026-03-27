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
    populateMinorButtons();
  }
  const ccRow = document.getElementById('cc-row');
  if (ccRow) ccRow.style.display = '';

  // Clear secondary selection UI
  const clearBtn = document.getElementById('clear-secondary-btn');
  if (clearBtn) clearBtn.style.display = 'none';

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
      PLANNER_STATE.secondary = key;
      container.querySelectorAll('.prog-btn').forEach(b => {
        if (b !== btn) b.classList.remove('active');
      });
      btn.classList.add('active');
      const clearBtn = document.getElementById('clear-secondary-btn');
      if (clearBtn) clearBtn.style.display = '';
      generatePlan();
    });
    container.appendChild(btn);
  }
}

function clearSecondaryProgram() {
  PLANNER_STATE.secondary = null;
  const container = document.getElementById('secondary-prog-btns');
  if (container) container.querySelectorAll('.prog-btn').forEach(b => b.classList.remove('active'));
  const clearBtn = document.getElementById('clear-secondary-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  generatePlan();
}

function populateMinorButtons() {
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

function toggleCC() {
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
// ║  REARRANGE SCHEDULE MODE                                    ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Validation ──────────────────────────────────────────────

function validateCourse(course, allCourses, slots) {
  const byId = {};
  for (const c of allCourses) byId[c.id] = c;
  const allIds = new Set(allCourses.map(c => c.id));

  const courseSlot = slots.find(s => s.key === course.slotKey);
  if (!courseSlot) return { status: 'valid', issues: [] };
  const courseOrder = courseSlot.order;
  const courseSeason = courseSlot.season;

  const issues = [];
  let hasError = false;
  let hasWarning = false;

  // Check prereqs
  for (const entry of (course.prereqs || [])) {
    const pIds = Array.isArray(entry) ? entry : [entry];
    // For OR groups, at least one must be in an earlier slot
    const satisfied = pIds.some(p => {
      if (!allIds.has(p)) return true; // not in plan = externally satisfied
      const pCourse = byId[p];
      if (!pCourse) return true;
      const pSlot = slots.find(s => s.key === pCourse.slotKey);
      return pSlot && pSlot.order < courseOrder;
    });
    if (!satisfied) {
      hasError = true;
      const codes = pIds.map(p => byId[p]?.code || p).join(' or ');
      issues.push('Prereq not met: ' + codes + ' must be earlier');
    }
  }

  // Check coreqs
  for (const coId of (course.coreqs || [])) {
    if (!allIds.has(coId)) continue;
    const coCourse = byId[coId];
    if (!coCourse) continue;
    const coSlot = slots.find(s => s.key === coCourse.slotKey);
    if (!coSlot || coSlot.order > courseOrder) {
      hasError = true;
      issues.push('Coreq not met: ' + (coCourse.code || coId) + ' must be same or earlier semester');
    }
  }

  // Check offering
  if (courseSeason === 'Summer') {
    // Summer: warn unless explicitly offered
    hasWarning = true;
    issues.push('Summer offering not guaranteed');
  } else if (!isOfferedIn(course, courseSeason)) {
    hasWarning = true;
    const offeredIn = course.offered || 'unknown';
    issues.push('Typically offered in ' + offeredIn + ' only');
  }

  if (hasError) return { status: 'error', issues };
  if (hasWarning) return { status: 'warning', issues };
  return { status: 'valid', issues: [] };
}

function validateAllCourses() {
  const courses = PLANNER_STATE.rearrangedCourses;
  const slots = PLANNER_STATE.semesterSlots;
  if (!courses || !slots) return;
  for (const c of courses) {
    c._validation = validateCourse(c, courses, slots);
  }
}

// ── Enter / Exit ────────────────────────────────────────────

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

  // Validate
  validateAllCourses();

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

  renderRearrangeGrid();
}

function exitRearrangeMode(save) {
  if (!PLANNER_STATE.rearrangeMode) return;

  if (save && PLANNER_STATE.rearrangedCourses && PLANNER_STATE.semesterSlots) {
    // Apply rearranged positions back to mergedPlan
    const slots = PLANNER_STATE.semesterSlots;
    const slotMap = {};
    for (const s of slots) slotMap[s.key] = s;

    for (const rc of PLANNER_STATE.rearrangedCourses) {
      const slot = slotMap[rc.slotKey];
      if (slot && slot.origSem) {
        rc.semester = slot.origSem;
      } else if (slot) {
        // User-added semester: assign a new numeric semester
        rc.semester = slot.order + 1;
      }
    }
    // Update mergedPlan with rearranged courses
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
  }
}

function toggleRearrangeMode() {
  if (PLANNER_STATE.rearrangeMode) {
    exitRearrangeMode(false); // cancel by default; use buttons for save
  } else {
    enterRearrangeMode();
  }
}

// ── Rearrange Grid Renderer ─────────────────────────────────

function renderRearrangeGrid() {
  const courses = PLANNER_STATE.rearrangedCourses;
  const slots = PLANNER_STATE.semesterSlots;
  if (!courses || !slots) return;

  const grid = document.getElementById('planner-grid');
  grid.innerHTML = '';

  // Compute per-slot credits
  const slotCredits = {};
  for (const s of slots) slotCredits[s.key] = 0;
  for (const c of courses) {
    if (slotCredits[c.slotKey] !== undefined) {
      slotCredits[c.slotKey] += c.credits;
    }
  }

  // Update stats banner with current totals
  const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
  document.getElementById('planner-total-credits').textContent = totalCredits;
  document.getElementById('planner-semesters').textContent = slots.length;

  for (const slot of slots) {
    const slotCourses = courses
      .filter(c => c.slotKey === slot.key)
      .sort((a, b) => {
        if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
        return a.code.localeCompare(b.code);
      });

    const credits = slotCredits[slot.key] || 0;
    const isOverloaded = credits > MAX_CREDITS_PER_SEM;

    const col = document.createElement('div');
    col.className = 'sem-col';
    col.dataset.slotKey = slot.key;

    // Header
    const header = document.createElement('div');
    header.className = 'sem-header';
    let headerHTML =
      '<div class="sem-year">' + slot.yearLabel + '</div>' +
      '<div class="sem-name">' + slot.season + ' &mdash; ' +
        '<span class="' + (isOverloaded ? 'credits-overloaded' : '') + '">' +
          credits + ' cr' +
        '</span>' +
      '</div>';

    // Remove button for user-added empty semesters
    if (slot.userAdded && slotCourses.length === 0) {
      headerHTML += '<button class="remove-semester-btn" onclick="removeSemester(\'' +
        slot.key + '\')" title="Remove this semester">&times;</button>';
    }
    header.innerHTML = headerHTML;

    // Add Summer button on Spring semesters
    if (slot.season === 'Spring') {
      const nextSlot = slots[slots.indexOf(slot) + 1];
      const hasSummer = nextSlot && nextSlot.season === 'Summer';
      if (!hasSummer) {
        const summerBtn = document.createElement('button');
        summerBtn.className = 'add-summer-btn';
        summerBtn.textContent = '+ Summer';
        summerBtn.title = 'Add summer term after this Spring';
        summerBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          insertSummer(slot.key);
        });
        header.appendChild(summerBtn);
      }
    }

    col.appendChild(header);

    // Drop zone (cards container)
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'sem-cards';
    cardsWrap.dataset.slotKey = slot.key;

    // Drag-and-drop events on the drop zone
    cardsWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardsWrap.classList.add('drop-target');
    });
    cardsWrap.addEventListener('dragleave', (e) => {
      // Only remove if leaving the container itself
      if (!cardsWrap.contains(e.relatedTarget)) {
        cardsWrap.classList.remove('drop-target');
      }
    });
    cardsWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      cardsWrap.classList.remove('drop-target');
      const courseId = e.dataTransfer.getData('text/plain');
      if (courseId) handleDrop(courseId, slot.key);
    });

    // Render cards
    for (const course of slotCourses) {
      const card = createRearrangeCard(course);
      cardsWrap.appendChild(card);
    }

    col.appendChild(cardsWrap);
    grid.appendChild(col);
  }

  // Add-semester column at the end
  const addCol = document.createElement('div');
  addCol.className = 'sem-col add-semester-col';
  addCol.innerHTML =
    '<div class="add-semester-inner">' +
      '<span class="add-semester-icon">+</span>' +
      '<div class="add-semester-options">' +
        '<button onclick="addSemester(\'Fall\')">+ Fall</button>' +
        '<button onclick="addSemester(\'Spring\')">+ Spring</button>' +
        '<button onclick="addSemester(\'Summer\')">+ Summer</button>' +
      '</div>' +
    '</div>';
  grid.appendChild(addCol);
}

function createRearrangeCard(course) {
  const card = document.createElement('div');
  const v = course._validation || { status: 'valid', issues: [] };

  card.className = 'planner-card validation-' + v.status;
  card.dataset.id = course.id;
  card.draggable = true;

  // Status icon
  const icon = v.status === 'valid' ? '✓' : v.status === 'warning' ? '⚠' : '✕';
  const iconClass = 'validation-icon validation-icon-' + v.status;

  card.innerHTML =
    '<div class="planner-card-top">' +
      '<span class="planner-code">' + course.code + '</span>' +
      '<span class="' + iconClass + '">' + icon + '</span>' +
    '</div>' +
    '<div class="planner-title">' + course.title + '</div>' +
    '<div class="planner-card-bottom">' +
      '<span class="planner-credits">' + course.credits + ' cr</span>' +
    '</div>';

  // Tooltip for issues
  if (v.issues.length) {
    card.title = v.issues.join('\n');
  }

  // Click to open detail panel
  card.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    openPlannerPanel(course);
  });

  // Drag events
  card.addEventListener('dragstart', (e) => {
    PLANNER_STATE.dragCourse = course.id;
    e.dataTransfer.setData('text/plain', course.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
    // Highlight all drop zones
    requestAnimationFrame(() => {
      document.querySelectorAll('.sem-cards').forEach(z => z.classList.add('drop-zone-active'));
    });
  });
  card.addEventListener('dragend', () => {
    PLANNER_STATE.dragCourse = null;
    card.classList.remove('dragging');
    document.querySelectorAll('.sem-cards').forEach(z => {
      z.classList.remove('drop-zone-active', 'drop-target');
    });
  });

  return card;
}

// ── Drag-and-Drop Handler ───────────────────────────────────

function handleDrop(courseId, targetSlotKey) {
  const courses = PLANNER_STATE.rearrangedCourses;
  if (!courses) return;

  const course = courses.find(c => c.id === courseId);
  if (!course) return;
  if (course.slotKey === targetSlotKey) return; // no change

  course.slotKey = targetSlotKey;

  // Re-validate and re-render
  validateAllCourses();
  renderRearrangeGrid();
}

// ── Semester Management ─────────────────────────────────────

function addSemester(type) {
  const slots = PLANNER_STATE.semesterSlots;
  if (!slots) return;
  const key = appendSemesterOfType(slots, type);
  if (key) renderRearrangeGrid();
}

function insertSummer(afterSpringKey) {
  const slots = PLANNER_STATE.semesterSlots;
  if (!slots) return;
  const key = insertSummerSlot(slots, afterSpringKey);
  if (key) renderRearrangeGrid();
}

function removeSemester(slotKey) {
  const slots = PLANNER_STATE.semesterSlots;
  const courses = PLANNER_STATE.rearrangedCourses;
  if (!slots || !courses) return;

  // Check if any courses are in this slot
  const inSlot = courses.filter(c => c.slotKey === slotKey);
  if (inSlot.length > 0) return; // can't remove non-empty semester

  if (removeSemesterSlot(slots, slotKey)) {
    renderRearrangeGrid();
  }
}
