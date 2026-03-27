/* ╔══════════════════════════════════════════════════════════════╗
   ║  SHARED REARRANGE ENGINE                                     ║
   ║  Generic drag-and-drop grid with validation for both         ║
   ║  the What-If Planner and the Transcript Planner.             ║
   ║                                                              ║
   ║  Requires: scheduling-utils.js (loaded before this file)     ║
   ║    Provides: buildSlotsFromSemesters, insertSummerSlot,      ║
   ║    appendSemesterOfType, removeSemesterSlot, isOfferedIn,    ║
   ║    getSemLabel, MAX_CREDITS_PER_SEM                          ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Validation ──────────────────────────────────────────────

/**
 * Validate a single course against its prereqs, coreqs, and offering.
 * @param {Object} course - course with slotKey, prereqs, coreqs, offered
 * @param {Object[]} allCourses - all courses in the rearrange set
 * @param {Object[]} slots - ordered slot array
 * @param {Set} completedIds - IDs of courses already completed (always satisfied)
 * @returns {{ status: 'valid'|'warning'|'error', issues: string[] }}
 */
function validateCourse(course, allCourses, slots, completedIds) {
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
    const satisfied = pIds.some(p => {
      if (completedIds.has(p)) return true;           // already passed
      if (!allIds.has(p)) return true;                // not in plan = externally satisfied
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
    if (completedIds.has(coId)) continue;             // already passed
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

/**
 * Validate all courses and store result as course._validation.
 * @param {Object[]} courses
 * @param {Object[]} slots
 * @param {Set} completedIds
 */
function validateAllCourses(courses, slots, completedIds) {
  if (!courses || !slots) return;
  for (const c of courses) {
    c._validation = validateCourse(c, courses, slots, completedIds);
  }
}

// ── Rearrange Grid Renderer ─────────────────────────────────

/**
 * Render the rearrange grid with drag-and-drop, validation colors, and semester management.
 * @param {Object} config
 * @param {Object[]} config.courses - courses with slotKey, _validation
 * @param {Object[]} config.slots - ordered slot array
 * @param {Set} config.completedIds - completed course IDs
 * @param {HTMLElement} config.gridEl - DOM element to render into
 * @param {Function} config.onDrop - callback(courseId, slotKey) after drop
 * @param {Function} config.onCardClick - callback(course) for detail panel
 * @param {Function} config.onAddSemester - callback(type) for 'Fall'|'Spring'|'Summer'
 * @param {Function} config.onInsertSummer - callback(afterSpringKey)
 * @param {Function} config.onRemoveSemester - callback(slotKey)
 * @param {Object} [config.statsEls] - { totalCredits, semesters } DOM refs to update
 */
function renderRearrangeGrid(config) {
  const { courses, slots, gridEl, onDrop, onCardClick,
          onAddSemester, onInsertSummer, onRemoveSemester, statsEls } = config;
  if (!courses || !slots || !gridEl) return;

  gridEl.innerHTML = '';

  // Compute per-slot credits
  const slotCredits = {};
  for (const s of slots) slotCredits[s.key] = 0;
  for (const c of courses) {
    if (slotCredits[c.slotKey] !== undefined) {
      slotCredits[c.slotKey] += c.credits;
    }
  }

  // Update stats elements if provided
  if (statsEls) {
    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    if (statsEls.totalCredits) statsEls.totalCredits.textContent = totalCredits;
    if (statsEls.semesters) statsEls.semesters.textContent = slots.length;
  }

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
    if (slot.userAdded && slotCourses.length === 0 && onRemoveSemester) {
      headerHTML += '<button class="remove-semester-btn" title="Remove this semester">&times;</button>';
    }
    header.innerHTML = headerHTML;

    // Wire up remove button
    const removeBtn = header.querySelector('.remove-semester-btn');
    if (removeBtn && onRemoveSemester) {
      removeBtn.addEventListener('click', () => onRemoveSemester(slot.key));
    }

    // Add Summer button on Spring semesters
    if (slot.season === 'Spring' && onInsertSummer) {
      const nextSlot = slots[slots.indexOf(slot) + 1];
      const hasSummer = nextSlot && nextSlot.season === 'Summer';
      if (!hasSummer) {
        const summerBtn = document.createElement('button');
        summerBtn.className = 'add-summer-btn';
        summerBtn.textContent = '+ Summer';
        summerBtn.title = 'Add summer term after this Spring';
        summerBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onInsertSummer(slot.key);
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
      if (!cardsWrap.contains(e.relatedTarget)) {
        cardsWrap.classList.remove('drop-target');
      }
    });
    cardsWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      cardsWrap.classList.remove('drop-target');
      const courseId = e.dataTransfer.getData('text/plain');
      if (courseId && onDrop) onDrop(courseId, slot.key);
    });

    // Render cards
    for (const course of slotCourses) {
      const card = createRearrangeCard(course, onCardClick);
      cardsWrap.appendChild(card);
    }

    col.appendChild(cardsWrap);
    gridEl.appendChild(col);
  }

  // Add-semester column at the end
  if (onAddSemester) {
    const addCol = document.createElement('div');
    addCol.className = 'sem-col add-semester-col';

    const inner = document.createElement('div');
    inner.className = 'add-semester-inner';
    inner.innerHTML =
      '<span class="add-semester-icon">+</span>' +
      '<div class="add-semester-options"></div>';

    const options = inner.querySelector('.add-semester-options');
    for (const type of ['Fall', 'Spring', 'Summer']) {
      const btn = document.createElement('button');
      btn.textContent = '+ ' + type;
      btn.addEventListener('click', () => onAddSemester(type));
      options.appendChild(btn);
    }

    addCol.appendChild(inner);
    gridEl.appendChild(addCol);
  }
}

/**
 * Create a draggable card with validation colors, icon, and tooltip.
 * @param {Object} course
 * @param {Function} onCardClick - callback(course) for detail panel
 * @returns {HTMLElement}
 */
function createRearrangeCard(course, onCardClick) {
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
  if (onCardClick) {
    card.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      onCardClick(course);
    });
  }

  // Drag events
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', course.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
    requestAnimationFrame(() => {
      document.querySelectorAll('.sem-cards').forEach(z => z.classList.add('drop-zone-active'));
    });
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.sem-cards').forEach(z => {
      z.classList.remove('drop-zone-active', 'drop-target');
    });
  });

  return card;
}
