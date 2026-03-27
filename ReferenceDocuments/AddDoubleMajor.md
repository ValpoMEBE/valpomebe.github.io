# How to Add a New Double Major

This guide explains the steps needed to add a new major program to the Transcript Audit system so students can select it as a double major (or eventually as a primary program).

---

## Overview

Each major needs **3 things** to work in the transcript audit:

| Component | Location | Purpose |
|-----------|----------|---------|
| **Course definitions** | `_data/courses/<dept>.yml` | Defines every course (code, title, credits, prereqs, tags) |
| **Curriculum file** | `_data/curriculum/<program>.yml` | Maps course IDs → semester numbers (1–8) |
| **Elective groups** | `assets/js/transcript-audit.js` | Defines how grouped/elective slots are filled and matched |

Optional:
| Component | Location | Purpose |
|-----------|----------|---------|
| **Elective approval lists** | `_data/transcript/<list>.yml` | Lists of approved courses for elective categories |
| **Major requirements** | `_data/major_reqs/<program>.yml` | Only for complex programs (repeatable courses, tracks, applied credits) |

---

## Step-by-Step

### 1. Add Course Definitions

**File:** `_data/courses/<dept>.yml`

Each course entry needs:
```yaml
- id: MATH_331
  code: "MATH 331"
  title: "Real Analysis I"
  credits: 3
  tags: [math, upper]
  prereqs: [MATH_253]
  desc: "..."
```

For **placeholder/elective slots**, add entries like:
```yaml
- id: MATH_ELEC_1
  code: "Math Elective 1"
  title: "Math Elective"
  credits: 3
  isPlaceholder: true
  eligible: [MATH_331, MATH_341, MATH_351]
```

**Source:** All course info comes from `ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf`.

### 2. Create Curriculum File

**File:** `_data/curriculum/<program>.yml`

Maps each course ID to the semester it's typically taken (1 = Fall Year 1, 8 = Spring Year 4):
```yaml
MATH_131: 1
MATH_132: 2
MATH_253: 3
MATH_331: 5
MATH_ELEC_1: 6
MATH_ELEC_2: 7
```

Every course that should appear in the degree map or audit **must** be listed here.

### 3. Register the Program

**File:** `assets/js/transcript-audit.js`

Add the program to `ALL_PROGRAMS`:
```javascript
const ALL_PROGRAMS = {
  // ... existing ...
  Math_BS: 'Mathematics B.S.',
};
```

The key (e.g., `Math_BS`) must match the curriculum filename (without `.yml`).

### 4. Define Elective Groups

**File:** `assets/js/transcript-audit.js` — `ELECTIVE_GROUPS` object

Each program needs entries that define how grouped elective slots are filled from transcript courses. Example:

```javascript
ELECTIVE_GROUPS['Math_BS'] = [
  ...CORE_GROUPS,
  THEO_GROUP,
  {
    key: 'math_elec',
    label: 'Math Electives',
    ids: ['MATH_ELEC_1', 'MATH_ELEC_2', 'MATH_ELEC_3'],
    approvedLists: ['math_electives'],  // references ELECTIVE_DATA key
    blanketDepts: ['MATH'],             // any MATH course qualifies
    fixedCredits: 9,
  },
  {
    key: 'hum_ss',
    label: 'Humanities / Social Science',
    ids: ['MATH_HUM_1', 'MATH_SS_1'],
    approvedLists: ['humanities', 'social_sciences'],
    fixedCredits: 6,
  },
];
```

**Group properties:**
| Property | Required | Description |
|----------|----------|-------------|
| `key` | Yes | Unique identifier for this group |
| `label` | Yes | Display name in the audit UI |
| `ids` | Yes | Array of placeholder course IDs from courses.yml |
| `approvedLists` | No | Keys into `ELECTIVE_DATA` (YAML approval lists) |
| `blanketDepts` | No | Entire departments that qualify (e.g., `['MATH', 'DATA']`) |
| `matchCodes` | No | Exact course codes to match (e.g., `['MUS 499']`) |
| `fixedCredits` | No | Override total credits (use when placeholder credits are 0) |
| `showAll` | No | Show all matching courses, not just enough to fill (for repeatable courses) |
| `checkWorldLang` | No | Match world language courses |

### 5. Add Elective Approval Lists (if needed)

**File:** `_data/transcript/<listname>.yml`

If the program has elective categories with specific approved courses, create a YAML list:
```yaml
- MATH 331
- MATH 341
- MATH 351
- MATH 421
```

Then register it in `_layouts/transcript.html`:
```liquid
const ELECTIVE_DATA = {
  // ... existing ...
  math_electives: {{ site.data.transcript.math_electives | jsonify }},
};
```

### 6. Add Course Aliases (if needed)

**File:** `_data/aliases/course_aliases.yml`

If transcript codes differ from course IDs (lab bundling, old codes, honors substitutions):
```yaml
PHYS_151: PHYS_141    # Honors sub
PHYS_141L: PHYS_141   # Lab bundled with lecture
STAT_240: DATA_240     # Department rename
```

**File:** `_data/aliases/department_renames.yml`

For wholesale department renames:
```yaml
STAT: DATA
```

---

## Current Status

| Program | Courses | Curriculum | Elective Groups | Elective Lists | Status |
|---------|---------|------------|-----------------|----------------|--------|
| ME | Yes | Yes | Yes | Yes | **Full audit** |
| BE_Biomech | Yes | Yes | Yes | Yes | **Full audit** |
| BE_Bioelec | Yes | Yes | Yes | Yes | **Full audit** |
| BE_Biomed | Yes | Yes | Yes | Yes | **Full audit** |
| CE | Yes | Yes | Yes | Yes | **Full audit** |
| CPE | Yes | Yes | Yes | Yes | **Full audit** |
| EE | Yes | Yes | Yes | Yes | **Full audit** |
| ENE | Yes | Yes | Yes | Yes | **Full audit** |
| Physics_BS | Yes | Yes | Yes | No | **Full audit** — blanket PHYS/ASTR 200+ |
| Music_BA | Yes | Yes | Yes | No | **Full audit** |
| Math_BS | Yes | Yes | Yes | Yes | **Full audit** |
| CS_BS | Yes | Yes | Yes | Yes | **Full audit** |
| Chemistry_BS | Yes | Yes | Yes | Yes | **Full audit** |

---

## What's Needed from the Catalog

To fully add a new major, extract the following from `ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf`:

1. **Required courses** — the full 4-year course sequence
2. **Elective categories** — what types of electives exist (technical, free, humanities, etc.)
3. **Approved elective lists** — which specific courses are approved for each category
4. **Credit requirements** — total credits, per-category minimums
5. **Special rules** — lab bundling, course substitutions, repeatable courses

### Finding Program Info in the Catalog

Use Python to search:
```python
import fitz
doc = fitz.open('ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf')
for i in range(doc.page_count):
    if 'Mathematics, B.S.' in doc[i].get_text():
        print(f'Found on page {i+1}')
        break
```
