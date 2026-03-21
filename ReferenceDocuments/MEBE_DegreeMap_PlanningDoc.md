# ME/BE Degree Map — Planning Document
**Valparaiso University | College of Engineering**
*Tool: Unified Interactive HTML Degree Flowchart*

---

## 1. Project Overview

A single self-contained HTML file that visualizes the four-year curriculum for both the **Mechanical Engineering (BSME)** and **Bioengineering (BSBE)** programs at Valparaiso University. Users can explore prerequisite chains, toggle between programs, switch BE tracks, filter by content tags, and click any course to illuminate its full dependency chain.

---

## 2. Data Sources Confirmed

| Source | Status | Notes |
|--------|--------|-------|
| BE Catalog Page | ✅ Retrieved | All required courses + 3 track lists |
| ME Catalog Page | ✅ Retrieved | All required courses + degree map |
| Spreadsheet (MEBE_Programs_Degree_Maps_2024_Update.xlsx) | ✅ Read | 4 sheets: ME, Biomech-BE, Bioelec-BE, Biomed-BE |
| Valpo Brand Colors | ✅ Retrieved | Primary + secondary palette |
| Individual Course Prereq Pages | ⚠️ Rate-limited | Will be populated from domain knowledge + catalog (see Section 5) |

---

## 3. Programs & Structure

### 3.1 Programs
- **BSME — Mechanical Engineering** (1 track, 126 credits)
- **BSBE — Bioengineering** (3 tracks, 126 credits each)
  - Biomechanical Track
  - Bioelectrical Track
  - Biomedical Track

### 3.2 Semester Layout (per program)
All four programs follow an 8-semester (4-year) layout:

| Semester | Year | Season |
|----------|------|--------|
| 1 | Freshman | Fall |
| 2 | Freshman | Spring |
| 3 | Sophomore | Fall |
| 4 | Sophomore | Spring |
| 5 | Junior | Fall |
| 6 | Junior | Spring |
| 7 | Senior | Fall |
| 8 | Senior | Spring |

---

## 4. Course Inventory

### 4.1 Shared Core (Appear in all 4 programs, same semester)

| Code | Title | Credits | Semester |
|------|-------|---------|----------|
| VUE 101 | Exploring Values | 4 | 1 |
| GE 100 | Fundamentals of Engineering | 2 | 1 |
| GE 100L | Fundamentals of Engineering Lab | 0 | 1 |
| XS 101 | Wellness and Stress | 1 | 1 |
| MATH 131 | Calculus I | 4 | 1 |
| PHYS 141 | Newtonian Mechanics | 3 | 1 |
| PHYS 141L | Experimental Physics I | 1 | 1 |
| VUE 102 | Finding Your Voice | 4 | 2 |
| GE 109 | Mechanics-Statics | 3 | 2 |
| MATH 132 | Calculus II | 4 | 2 |
| ME 102 | Computer Aided Design | 1 | 2 |
| ME 125 | Computer Prog/Mech Engineers & Bioengin | 1 | 2 |
| PHYS 142 | Electricity, Magnetism, & Waves | 3 | 2 |
| ECE 281 | Fundamentals of Electrical Engineering | 2.5 | 3 |
| MATH 253 | Calculus III | 4 | 3 |
| ME 209 | Mechanics-Dynamics | 3 | 3 |
| BIO 151 | Human Anatomy and Physiology I | 4 | 3 (BE only) |
| MATH 260 | Linear Systems and Matrices | 1 | 4 |
| MATH 270 | Ordinary Differential Equations | 3 | 4 |
| ME 261 | Analog Circuits Laboratory | 0.5 | 4 |
| STAT 240 | Statistical Analysis | 3 | 4 |
| BIO 152 | Human Anatomy and Physiology II | 4 | 4 (BE only) |
| ME 201 | WIC: Tech Writing | 1 | 4 (BE) / 3 (ME) |
| ME 333 | Mechanical Measurements Laboratory | 4 | 5 |
| ME 355 | System Modeling and Numerical Methods | 3 | 5 (ME) / varies (BE) |
| ME 252 | Materials Science | 2.5 | 6 |
| GE 311 | Financial Decisions in Engineering | 1.5 | 5 (BE) / 6 (ME) |
| GE 312 | Ethical Decisions in Engineering | 1.5 | 5 (BE) / 6 (ME) |
| GE 497 | Senior Design Project I | 3 | 7 |
| GE 498 | Senior Design Project II | 3 | 8 |
| ME 352 | Materials Science & Mechanics Laboratory | 0.5 | 7 (BE) / 5 (ME) |
| BE 317 / ME 317 | Sustainable Engineering | 2 | 5 |
| BE 415 | Biomaterials | 3 | 7 (BE only) |
| BE 340 | Bioelectricity | 3 | 6 (BE only) |
| BE 369 | Biomechanics | 3 | 6 (BE only) |
| BE 320 | Bioengineering Technologies Lab | 1 | 6 (BE only) |

### 4.2 ME-Only Required Courses

| Code | Title | Credits | Semester |
|------|-------|---------|----------|
| CHEM 115 | Essentials of Chemistry | 4 | 3 |
| ME 215 | Mechanics of Materials | 3 | 4 |
| ME 251 | Introduction to Manufacturing | 1 | 3 |
| ME 270 | Thermodynamics I | 3 | 4 |
| ME 317 | Sustainable Engineering | 2 | 5 |
| ME 333 | Mech. Measurements Lab | 4 | 5 |
| ME 351 | Manufacturing Processes | 3 | 6 |
| ME 354 | Mechanical Systems Laboratory | 0.5 | 6 |
| ME 363 | Machine Design I | 3 | 5 |
| ME 364 | Vibrations | 2 | 6 |
| ME 372 | Heat Power Laboratory | 0.5 | 6 |
| ME 373 | Fluid Mechanics | 3 | 5 |
| ME 376 | Heat Transfer | 3 | 6 |
| ME 442 | Automatic Control | 3 | 7 |

### 4.3 BE Track-Specific Courses

**Biomechanical Track (Semesters 3–8 differences from base BE)**
| Code | Title | Credits | Semester |
|------|-------|---------|----------|
| CHEM 115 | Essentials of Chemistry | 4 | 3 |
| ME 215 | Mechanics of Materials | 3 | 4 |
| ME 270 | Thermodynamics | 3 | 6 |
| ME 373 | Fluid Mechanics | 3 | 7 |
| ME 376 | Heat Transfer | 3 | 8 |
| ME 442 | Automatic Control | 3 | 7 |

**Bioelectrical Track**
| Code | Title | Credits | Semester |
|------|-------|---------|----------|
| CHEM 115 | Essentials of Chemistry | 4 | 3 |
| ECE 221 | Digital Logic Design | 3 | 5 |
| ECE 251 | Engineering Programming I | 3 | 5 |
| ECE 322 | Embedded Microcontrollers | 3 | 7 |
| ECE 360 | Signals and Systems | 3 | List A |
| ECE 452 | Digital Signal Processing | 3 | 8 |

**Biomedical Track**
| Code | Title | Credits | Semester |
|------|-------|---------|----------|
| CHEM 121 | General Chemistry I | 4 | 3 |
| CHEM 122 | General Chemistry II | 4 | 4 |
| CHEM 221 | Organic Chemistry I | 4 | 5 |
| CHEM 222 | Organic Chemistry II | 4 | 6 |
| ME 270 | Thermodynamics I | 3 | List A |

### 4.4 Elective / Placeholder Slots

| Placeholder Label | Program | Semester | Credits |
|-------------------|---------|----------|---------|
| ME Technical Elective × 4 | ME | 6, 7, 8 | 3 each |
| Professional Elective | ME | 7 | 3 |
| World Language / Diversity Elective | Both | 8 | 3 |
| Humanities / Social Science / Theo Elective × 2 | Both | 7–8 | 3 each |
| THEO 100/200 – The Christian Tradition | Both | 6 | 3 |
| REL 100 – Religion and Society | ME (Sem 6), BE (gen-ed) | 6 | 3 |
| BE Technical Electives × 2–3 | BE | 6, 8 | varies |

---

## 5. Prerequisite Chain Map

These prerequisite chains are derived from the Valpo catalog + standard engineering curriculum conventions. They will be embedded as data in the HTML file. **A note on terminology:**
- **prereq** = must be completed *before*
- **coreq** = can be taken *concurrently*
- **unlocks** = courses this course enables (derived from prereq graph)

### 5.1 Mathematics Chain
```
MATH 131 → MATH 132 → MATH 253 → MATH 260
                               → MATH 270 (also needs MATH 260 coreq)
```

### 5.2 Physics Chain
```
MATH 131 (coreq) → PHYS 141 / PHYS 141L
PHYS 141, MATH 132 → PHYS 142
```

### 5.3 Mechanics Chain
```
PHYS 141, MATH 132 → GE 109
GE 109, MATH 253 → ME 209
ME 209, MATH 270 → ME 215
GE 109, ME 209 → BE 369
ME 215 → ME 363
ME 215 → ME 373 (+ MATH 270)
ME 363 → ME 364
ME 363 → ME 442
```

### 5.4 Thermal/Fluids Chain
```
MATH 270, PHYS 142 → ME 270
ME 270 → ME 373 (Fluid Mechanics)
ME 373 → ME 376 (Heat Transfer)
ME 270, ME 373 → ME 372 (lab, coreq with ME 376)
```

### 5.5 Materials Chain
```
CHEM 115 (or 121) → ME 252
ME 252 → ME 352 (lab, coreq)
ME 252 → ME 215
ME 252 → BE 415
CHEM 121 → CHEM 122 → CHEM 221 → CHEM 222 (Biomedical track)
```

### 5.6 Electrical / Controls Chain
```
PHYS 142 → ECE 281
ECE 281 → ME 261 (lab, coreq)
ECE 281, MATH 270 → ME 355
ME 355, MATH 270 → ME 442
ECE 281 → ECE 221 (Bioelectrical)
ECE 221, ME 125 → ECE 251 (Bioelectrical)
ECE 251 → ECE 322 (Bioelectrical)
ECE 281, MATH 270 → ECE 360 (Bioelectrical)
ECE 360 → ECE 452 (Bioelectrical)
```

### 5.7 Biology Chain (BE only)
```
[no prereq] → BIO 151
BIO 151 → BIO 152
BIO 151/152 → BE 340 (Bioelectricity)
BIO 151/152 → BE 369 (Biomechanics)
BE 340, BE 369 → BE 415 (Biomaterials)
```

### 5.8 Design Chain
```
GE 100 → ME 102 → GE 497 → GE 498
ME 102, ME 215, ME 209 → ME 363
ME 363 → ME 364 (Vibrations / Machine Design II domain)
GE 497 → GE 498
GE 311, GE 312 (coreq recommended before capstone)
BE 210 → GE 497 (BE design intro)
```

### 5.9 Systems & Computation
```
ME 125 → ME 355 (coreq/partial)
MATH 270, ME 125 → ME 355
ME 355 → ME 442
ECE 281, ME 125 → ECE 251
```

### 5.10 Lab Courses (coreqs)
```
ME 261 coreq: ECE 281
ME 352 coreq: ME 252
ME 354 coreq: ME 363 or ME 376
ME 372 coreq: ME 376
ME 333L coreq: ME 333
BE 320 coreq: BE 340 or BE 369
```

---

## 6. Proposed Tag System

Tags will be color-coded chips on each course card. A user can click a tag in the filter bar to highlight only courses with that tag and their prerequisite/successor chains.

| Tag | Color (Valpo palette) | Description |
|-----|----------------------|-------------|
| **Math** | Gold (#F5B80A) | Calculus, ODE, Linear Algebra, Statistics |
| **Physics** | Light Blue (#6BC9C9) | PHYS courses |
| **Mechanics** | Brown (#5C3000) | Statics, Dynamics, Mechanics of Materials, Fluids, Machine Design |
| **Thermal/Fluids** | Orange (#C76917) | Thermodynamics, Fluid Mechanics, Heat Transfer |
| **Materials** | Teal (#006354) | Materials Science, Biomaterials, Chemistry |
| **Electrical** | Magenta (#A80087) | ECE courses, Circuits, Controls, Signal Processing |
| **Biology** | Light Blue (#6BC9C9) darker variant | BIO courses, Anatomy |
| **Computing** | Dark Brown (#331A00) | Programming, Numerical Methods, CAD |
| **Design** | Yellow (#FFE300) on brown | GE 100, ME 102, ME 363, GE 497/498, BE 210 |
| **Lab** | Light Gray (#DAD9D6) | All lab sections (L suffix or standalone lab courses) |
| **Systems** | Teal (#006354) | ME 355, ME 442, ECE 360, ECE 322 |
| **Professional** | Gold gradient | GE 311, GE 312, ME 201, ME 317, BE 317 |
| **Gen Ed** | White/outlined | VUE, XS, REL, THEO, elective placeholders |

*Note: A course can carry multiple tags (e.g., ME 333 is both Lab and Measurement/Systems).*

---

## 7. UI/UX Design Plan

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  HEADER: Valpo Logo + "ME/BE Degree Map"                │
│  Program Toggle: [ME] [BE ▾ Biomech | Bioelec | Biomed] │
├─────────────────────────────────────────────────────────┤
│  TAG FILTER BAR: [All] [Math] [Design] [Lab] [Mech]...  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  FLOWCHART AREA (horizontally scrollable)               │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐               │
│  │ Sem 1│  │ Sem 2│  │ Sem 3│  │ Sem 4│  ...           │
│  │  Y1F │  │  Y1S │  │  Y2F │  │  Y2S │               │
│  └──────┘  └──────┘  └──────┘  └──────┘               │
│                                                         │
│  SVG arrows drawn between cards (prereq edges)          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  COURSE DETAIL PANEL (appears on click, slides up)      │
│  Course name | Credits | Tags                           │
│  Prereqs: [list]  Co-reqs: [list]  Unlocks: [list]      │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Course Cards

Each course is a rectangular card showing:
- Course code (bold, large)
- Short title (truncated)
- Credit hours (badge, top-right)
- Tag chips (small, color-coded, bottom)
- Shared indicator (icon if course appears in multiple programs)

**States:**
- **Default**: Normal appearance
- **Highlighted (selected)**: Gold border, full opacity, slightly elevated
- **Prereq of selected**: Teal/blue tint border
- **Coreq of selected**: Orange border
- **Unlocked by selected**: Light highlight
- **Dimmed**: All non-related courses drop to ~20% opacity when a course is selected
- **Tag-filtered active**: Courses matching tag at full opacity; others dimmed

### 7.3 Prerequisite Arrows

- SVG lines drawn between cards
- Arrow direction: left → right (earlier → later semester)
- **prereq arrows**: solid dark brown lines with arrowheads
- **coreq arrows**: dashed orange lines
- On hover/selection: arrows animate (pulse/glow)
- Arrows hidden when no course is selected to reduce clutter; shown on click or always-on toggle

### 7.4 Interactions

| Action | Result |
|--------|--------|
| Click course card | Highlight prereqs (teal), coreqs (orange), unlocked (gold); dim all others; open detail panel |
| Click same card again | Deselect, return to default |
| Click tag chip (filter bar) | Show only courses with that tag + their connections |
| Click [All] tag | Reset filters |
| Toggle ME ↔ BE | Swap course grid; shared courses persist in same columns |
| Select BE track | Replace track-specific courses; shared BE core stays visible |
| Hover arrow | Tooltip showing "X is a prereq of Y" |
| Click elective placeholder | Show description of what counts for that slot |

### 7.5 Scrolling & Responsiveness

- The 8-semester flowchart will be **horizontally scrollable** on smaller screens
- Minimum card width: 140px; Semester column min-width: 160px
- The header, tag filter bar, and detail panel are **sticky**
- On mobile: columns may stack 2-per-row (Sem 1+2, 3+4, etc.) with a scroll-down flow

---

## 8. Visual Design / Branding

### 8.1 Color Application

| Element | Color |
|---------|-------|
| Page background | Dark Brown `#331A00` |
| Header bar | Brown `#5C3000` |
| Semester column headers | Gold `#F5B80A` text on Brown |
| Course card background | Off-white / light parchment `#F9F3E8` |
| Course card border (default) | Light Gray `#DAD9D6` |
| Selected card border | Gold `#FFE300` |
| Prereq highlight border | Teal `#006354` |
| Coreq highlight border | Orange `#C76917` |
| Unlocked highlight border | Light Blue `#6BC9C9` |
| Dimmed card | `opacity: 0.2` |
| Arrow color (prereq) | Brown `#5C3000` |
| Arrow color (coreq) | Orange `#C76917` |
| Tag chips | Per tag color table (Section 6) |
| Program toggle (active) | Gold `#F5B80A` on Brown |
| Program toggle (inactive) | Muted Brown |
| Detail panel background | White with Gold top border |

### 8.2 Typography

- **Display / Headers**: Playfair Display (serif — refined, academic)
- **Body / Course titles**: Source Sans 3 (clean, legible at small sizes)
- **Code labels (course codes)**: IBM Plex Mono (technical, distinctive)
- All fonts loaded via Google Fonts CDN

### 8.3 Elective Placeholders

Placeholder cards use a **dashed border** and italic text to visually distinguish them from required courses. They carry appropriate tags and appear in the correct semester slots.

---

## 9. Technical Architecture

### 9.1 File Structure

Single self-contained `.html` file:
```
index.html
  ├── <head>
  │    ├── Google Fonts
  │    └── <style> (all CSS, CSS custom properties for Valpo palette)
  └── <body>
       ├── Header + program/track toggles
       ├── Tag filter bar
       ├── #flowchart-container (position: relative)
       │    ├── Semester columns (CSS grid)
       │    │    └── Course cards (.course-card)
       │    └── <svg id="arrows"> (absolute overlay, pointer-events: none)
       ├── #detail-panel (fixed/sticky bottom drawer)
       └── <script>
            ├── COURSE_DATA[] — all course objects
            ├── PREREQ_MAP{} — prereq/coreq/unlocks per course
            ├── PROGRAM_MAP{} — which courses appear in which semesters by program/track
            ├── TAG_MAP{} — tag assignments per course
            ├── renderProgram(program, track) — DOM render
            ├── drawArrows() — SVG arrow calculation
            ├── selectCourse(id) — highlight logic
            ├── filterByTag(tag) — tag filtering logic
            └── Event listeners
```

### 9.2 Data Model

Each course object:
```javascript
{
  id: "ME_209",
  code: "ME 209",
  title: "Mechanics-Dynamics",
  credits: 3,
  tags: ["mechanics"],
  prereqs: ["GE_109", "MATH_253"],
  coreqs: [],
  programs: {
    ME: { semester: 3 },
    BE_Biomech: { semester: 3 },
    BE_Bioelec: { semester: 3 },
    BE_Biomed: { semester: 3 }
  },
  isElective: false,
  description: "..."
}
```

### 9.3 Arrow Rendering

Arrows are SVG `<path>` elements drawn using `getBoundingClientRect()` after each render. Bezier curves will be used for cleaner visual flow. Arrows are grouped by type (prereq / coreq) and toggled as a layer.

### 9.4 Performance Considerations

- Arrow recalculation is debounced on window resize
- DOM updates use `requestAnimationFrame` for smooth transitions
- CSS `will-change: opacity, transform` on cards for smooth dim/highlight transitions
- No external libraries required (vanilla JS + CSS)

---

## 10. Questions / Items Needing Confirmation Before Build

These are items I'm not 100% certain of from the catalog and spreadsheet data, and I'd like your input before implementing:

1. **GE 100L** — The spreadsheet lists this as "Credits: 0" alongside GE 100. Is this a true zero-credit lab that runs concurrently, or should it be merged with GE 100 on the visual display?

2. **ME 333 / ME 333L** — Same situation: listed separately at 4cr + 0cr. Display as one card or two?

3. **BE 210 — The Bioengineering Design Process** — This appears in the catalog course list for BE but is *not* in any of the four spreadsheet tracks. Should it appear in the degree map? If so, which semester?

4. **ME 215 placement in BE Biomechanical** — The spreadsheet places it in Semester 4. Is this correct? The ME program also places it in Semester 4, consistent.

5. **Track-specific electives (List A/B)** — For the Bioelectrical track, List A includes ME 355 *or* ECE 360. Should these appear as a single "Choose one from List A" placeholder card, or as two cards the user can toggle between?

6. **REL 100 vs. THEO 100/200** — ME uses REL 100 (semester 6), BE tracks use THEO 100 or THEO 200 depending on track. Should these display as distinct courses (with their actual names) or as a unified "Religion/Theology" placeholder?

7. **Arrows always on or toggle?** — Would you prefer prerequisite arrows to always be visible (cluttered but informative at a glance), or only appear when a course is clicked/hovered?

8. **"Choose one from List B or C" placeholders** — These appear in semesters 5–8 for ME and BE. Should I show these as generic labeled placeholders (e.g., "ME Technical Elective") or try to enumerate the full elective list as individual cards that are marked as optional?

9. **Shared course coloring** — When viewing BE, courses that also appear in ME (like MATH, PHYS, GE, ME prefix cores) could be visually marked as "shared." Would you like a subtle indicator on shared courses (e.g., a small dual-program icon)?

10. **BE 210 and STAT 240 for BE** — The spreadsheet shows STAT 240 in Semester 4 for all BE tracks. The catalog lists it as a BE requirement. Confirmed?

---

## 11. Proposed Tag Assignments Per Course

| Course | Tags |
|--------|------|
| MATH 131–132, 253, 260, 270 | Math |
| STAT 240 | Math |
| PHYS 141, 141L, 142 | Physics |
| GE 100, GE 100L | Design, Gen Ed |
| GE 109 | Mechanics |
| GE 311 | Professional |
| GE 312 | Professional |
| GE 497, GE 498 | Design, Capstone |
| VUE 101, VUE 102 | Gen Ed |
| XS 101 | Gen Ed |
| REL 100, THEO 100/200 | Gen Ed |
| ME 102 | Design, Computing |
| ME 125 | Computing |
| ME 201 | Professional, Writing |
| ME 209 | Mechanics |
| ME 215 | Mechanics, Materials |
| ME 251 | Design, Manufacturing |
| ME 252 | Materials |
| ME 261 | Electrical, Lab |
| ME 270 | Thermal/Fluids |
| ME 317 / BE 317 | Professional, Sustainability |
| ME 333, ME 333L | Lab, Measurement |
| ME 351 | Manufacturing |
| ME 352 | Materials, Lab |
| ME 354 | Lab, Mechanics |
| ME 355 | Systems, Computing |
| ME 363 | Design, Mechanics |
| ME 364 | Mechanics, Systems |
| ME 372 | Lab, Thermal/Fluids |
| ME 373 | Thermal/Fluids |
| ME 376 | Thermal/Fluids |
| ME 442 | Systems, Electrical |
| ECE 281 | Electrical |
| ECE 221 | Electrical, Computing |
| ECE 251 | Electrical, Computing |
| ECE 322 | Electrical, Systems |
| ECE 360 | Electrical, Systems |
| ECE 452 | Electrical, Systems |
| BIO 151, BIO 152 | Biology |
| CHEM 115, 121, 122 | Materials, Chemistry |
| CHEM 221, 222 | Materials, Chemistry |
| BE 210 | Design |
| BE 320 | Lab, Biology |
| BE 340 | Electrical, Biology |
| BE 369 | Mechanics, Biology |
| BE 415 | Materials, Biology |

---

## 12. Build Phases

### Phase 1 — Data + Static Render
- Define complete `COURSE_DATA` and `PREREQ_MAP` in JavaScript
- Render all 8 semester columns with course cards for ME program
- Apply Valpo branding (colors, fonts)

### Phase 2 — Program/Track Toggle
- Add BE Biomechanical, Bioelectrical, Biomedical layouts
- Shared courses remain in same column positions
- Track toggle swaps track-specific courses with smooth transitions

### Phase 3 — Prerequisite Arrows
- SVG overlay with bezier curves
- Toggle: always-on vs. on-click
- Arrow type distinction (prereq vs. coreq)

### Phase 4 — Click Interactions
- Course selection → highlight prereqs, coreqs, unlocked
- Dim unrelated courses
- Slide-up detail panel

### Phase 5 — Tag Filtering
- Tag filter bar
- Click to filter + highlight chain

### Phase 6 — Polish & Elective Placeholders
- Elective placeholder cards (dashed style)
- Mobile responsiveness
- Accessibility (keyboard navigation, ARIA labels)
- Final Valpo branding refinement

---

## 13. Open Questions for You

Before I begin coding, please confirm or answer the following:

1. Should prerequisite arrows be **always visible** or only **on hover/click**?
2. For zero-credit lab sections (GE 100L, ME 333L) — **merge into parent card** or show as separate mini-card?
3. **BE 210** — include it, and if so, what semester? (The catalog lists it as required but the spreadsheet omits it.)
4. Is the **THEO vs. REL** distinction important to show separately, or unify as a gen-ed placeholder?
5. Elective slots: **generic placeholders** (e.g., "Technical Elective 1") or **expandable lists** of eligible courses?
