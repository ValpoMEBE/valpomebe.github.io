# Course Schedule Optimizer — User Guide

## Overview

The Course Schedule Optimizer generates conflict-free class schedules for the ME/BE department. You provide three input files, and the tool automatically computes the best arrangement of courses into available time slots.

**Priority**: The optimizer avoids student conflicts first (two courses in the same semester overlapping), then minimizes faculty inconveniences.

## Quick Start

1. Go to `/scheduler/` on the website
2. Click **"Load Sample Data"** to try it with example data
3. Click **"Generate Schedule"** to run the optimizer
4. Review the weekly grid, conflict report, and faculty loads

## Input Files

You need three CSV files:

### 1. Courses to Schedule

Your department's courses for the semester, with instructor assignments.

| Column | Description | Example |
|--------|-------------|---------|
| `course_code` | Course code as it appears in the catalog | `ME 352` |
| `instructor` | Last name of assigned instructor | `Smith` |
| `sections` | Number of sections to schedule | `1` or `2` |
| `is_lab` | Whether this is a lab section | `true` or `false` |
| `linked_to` | Course code of the linked lecture (labs only) | `ME 352` |

**Example:**
```csv
course_code,instructor,sections,is_lab,linked_to
ME 352,Smith,1,false,
ME 352L,Smith,1,true,ME 352
ME 311,Johnson,1,false,
```

**Notes:**
- Lab courses must have `is_lab` set to `true` and `linked_to` pointing to their lecture
- If a course has 2 sections, the tool creates two independent entries (§01, §02) that each need a slot
- The tool looks up the course code in `courses.yml` to determine which program/semester it belongs to

### 2. External Schedules

Frozen schedules from other departments (MATH, PHYS, CHEM, etc.). **You can upload multiple files** — one per department.

| Column | Description | Example |
|--------|-------------|---------|
| `course_code` | External course code | `MATH 132` |
| `day_pattern` | Meeting days | `MWF` or `TR` |
| `start_time` | Start time (24h) | `10:00` |
| `end_time` | End time (24h) | `10:50` |
| `section` | Section number | `01` |

**Day pattern codes:** M=Monday, T=Tuesday, W=Wednesday, R=Thursday, F=Friday

**Example:**
```csv
course_code,day_pattern,start_time,end_time,section
MATH 132,MWF,10:00,10:50,01
MATH 132,MWF,11:00,11:50,02
PHYS 141,MWF,09:00,09:50,01
```

These are treated as **hard constraints** — the optimizer will never place a department course at a time that conflicts with an external course in the same semester.

### 3. Time Slots

Available class and lab periods. Update this file each year if the university changes its schedule grid.

| Column | Description | Example |
|--------|-------------|---------|
| `slot_type` | `class` or `lab` | `class` |
| `day_pattern` | Meeting days | `MWF` |
| `start_time` | Start time (24h) | `08:00` |
| `end_time` | End time (24h) | `08:50` |

**Example:**
```csv
slot_type,day_pattern,start_time,end_time
class,MWF,08:00,08:50
class,TR,08:00,09:15
lab,TR,14:00,16:50
```

**Standard patterns:**
- MWF classes: 50 minutes with 10-minute passing periods
- TR classes: 75 minutes
- Labs: 2 hours 50 minutes

## Using the Results

### Weekly Grid

The main output is a weekly calendar showing all scheduled courses:

- **Color-coded** by instructor (each instructor gets a unique color)
- **Tags** on each block show year level (Fr/So/Jr/Sr) and program (ME/BE/GE)
- **Red border** = conflict detected
- **Dashed border, dimmed** = external course (frozen)
- **Teal border + lock icon** = locked by you

### Filter Dropdowns

- **Instructor**: Show only one instructor's courses
- **Year Level**: Show only Freshman, Sophomore, Junior, or Senior courses
- **Program**: Show only ME, BE Biomech, BE Bioelec, or BE Biomed courses

### Conflict Report

Shows:
- Total number of conflicts
- Student conflicts (same-semester courses overlapping)
- Instructor conflicts (same instructor, overlapping times)
- Unscheduled courses (couldn't find a valid slot)

### Faculty Load Summary

Table showing each instructor's:
- Credit hours
- Contact hours per week
- Number of distinct preps
- List of assigned courses

High loads are highlighted in red, low loads in blue.

## Lock & Re-Run

1. **Click any course block** on the grid to lock/unlock it
2. Locked courses (shown with teal border and lock icon) stay in their slot
3. Click **"Re-optimize"** to run the solver again with locked courses as fixed constraints
4. Useful for iterative refinement: lock the assignments you like, let the optimizer improve the rest

## Export

- **Export CSV**: Downloads a CSV with all scheduled department courses
- **Export Excel**: Downloads an Excel workbook with two sheets:
  - Sheet 1: Schedule (course, section, instructor, day pattern, times)
  - Sheet 2: Faculty Loads (credit hours, contact hours, preps)

## Troubleshooting

**"Could not load sample data"**: Make sure the dev server is running (`bundle exec jekyll serve`).

**Courses show as unscheduled**: The optimizer couldn't find any valid slot due to hard constraints. Try:
- Adding more time slots
- Checking if external schedules are blocking all options
- Reducing the number of sections

**Unexpected conflicts**: Verify that `courses.yml` correctly lists which semester each course belongs to for each program. The optimizer uses this to determine which courses students take concurrently.
