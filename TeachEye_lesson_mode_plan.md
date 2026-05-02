# TeachEye Lesson Mode — Product Plan

## Vision

TeachEye evolves from a session-and-submission tool into a local school lesson platform for informatics.

Core idea:

- the teacher runs a lesson through live scenes instead of static slides;
- students get their own interactive runtime, closer to a game than to a passive presentation;
- the class moves at the teacher's pace, while each student keeps personal progress inside the current lesson;
- the system collects useful lesson telemetry, fast code feedback, and post-lesson analytics.

Primary audience for the first serious version:

- informatics teachers;
- grades 8-9;
- one school local network;
- shared internal lesson library across the school's teacher team.

## Product Principles

1. Do not build a PowerPoint clone.
2. Build a scene engine plus a widget engine.
3. Teacher flow must feel easier than making slides manually.
4. Student flow must feel like a focused interactive game, not like a cluttered LMS.
5. Forward movement stays under teacher control; backward review stays available to students.
6. Gamification supports learning progress, not raw speed.
7. AI stays narrow and useful: mainly code-run feedback and targeted hints.
8. Stability on weak school hardware matters more than visual excess.

## Target Experience

### Teacher

- opens a ready lesson from the internal library;
- runs it from a central live board;
- switches scenes like slides when needed;
- drops prepared widgets onto the board during the lesson;
- sees student status, stars, activity, and mini-previews;
- can open a student's work and optionally show it on the main board;
- can quickly inspect and run student code without external IDE friction.

### Student

- works inside a dedicated TeachEye runtime;
- sees the current lesson scene and local interactive elements;
- can go back to previous opened scenes, but cannot move ahead of the teacher;
- keeps progress on each scene;
- can interact with widgets privately without affecting classmates;
- can write and run Python code and receive lightweight help on common mistakes.

## Core Systems

### 1. Lesson Engine

Responsible for lesson structure and pacing.

Includes:

- lesson library;
- lesson metadata: author, tags, grade, topic, level;
- scenes as lesson screens;
- teacher-controlled unlock flow;
- navigation rules: back allowed, forward locked until opened;
- lesson templates for fast reuse.

### 2. Widget Engine

Responsible for reusable learning mechanics.

First widget family:

- drag and drop;
- algorithm steps ordering;
- match pairs;
- code puzzle;
- multiple-choice output question;
- binary / decimal conversion;
- powers-of-two / IP helper interactions;
- logic tables and Euler-style set visuals later.

Rules:

- every widget has teacher state, student-local state, and grading/progress rules;
- widget progress must survive scene switches;
- widgets should be composable on top of a scene, not hardcoded per lesson.

### 3. Teacher Control

Responsible for real-time classroom control.

Includes:

- current scene management;
- next-scene unlock;
- class list;
- manual star awarding;
- quick access to student work;
- "show student's work on board";
- freeze mode stays in backlog for now;
- compact control surface instead of many windows.

### 4. Student Runtime

Responsible for the student's full lesson experience.

Includes:

- dedicated UI, not a stripped mirror of the teacher board;
- local scene state;
- local widget interactions;
- lesson progress;
- stars/progress display;
- embedded Python editor and runner;
- structured error display and optional AI hinting for code mistakes.

### 5. Analytics

Responsible for useful teacher-facing lesson outcomes.

Includes:

- completion by scene and widget;
- earned stars;
- activity score from meaningful in-app actions;
- code attempts and run results;
- post-lesson summary per student;
- lesson recap screen similar to a "match results" summary.

Important:

- activity must be based on meaningful work events, not fake mouse movement;
- avoid public shame mechanics; struggling students are visible to the teacher, not the class.

### 6. Preview and Monitoring

Responsible for classroom visibility without turning MVP into remote-desktop software.

MVP decision:

- show mini-previews of TeachEye state only, not the whole student desktop;
- refresh roughly every 3-5 seconds;
- support tile view for all students;
- allow opening one student's work in focus.

Why this matters:

- full OS capture adds major complexity, bandwidth load, privacy risk, platform-specific bugs, and control issues;
- app-level preview is enough to see if the student is inside TeachEye and what lesson state they are in;
- full desktop control is explicitly not a first-phase requirement.

### 7. Content Library

Responsible for school-wide reuse.

Includes:

- shared lesson repository;
- metadata and search;
- templates;
- versioning/copying;
- quality markers later: draft, ready, recommended.

## Key Technical Decisions

### Preview Risk: detailed position

Full-screen mini-monitoring across the school is risky because it multiplies:

- CPU/GPU cost on old student machines;
- network traffic for constant screenshots;
- Windows-specific capture edge cases and permission issues;
- privacy concerns when students are outside TeachEye;
- remote-control expectations that can explode scope.

Safer path:

1. TeachEye-only preview.
2. Structured scene/widget state streaming.
3. Optional focused inspect view for one student.
4. Consider desktop-level capture only after the platform itself is stable.

### Code Runner

Do not depend on external IDLE integration.

Plan:

- build an internal Python editor and runner;
- show stdout, stderr, and friendly error text;
- keep execution sandboxed and short-lived;
- add AI help only on top of interpreter errors, not for every action.

### Lesson Authoring

Do not start from a free-form slide editor.

Plan:

- scene-based authoring;
- predefined layout patterns;
- widget palette for quick placement;
- low-friction templates before advanced visual freedom.

### Recommended UI Stack

For Lesson Mode, the recommended next client stack is:

- Tauri for desktop packaging;
- React + TypeScript for teacher/student application shells;
- Konva for the live board, widget placement, and interactive lesson scenes.

Why this direction:

- lighter than Electron for old school hardware;
- far more flexible than CustomTkinter for scene editing and game-like interactions;
- still friendly to incremental delivery because the backend can stay on FastAPI + SQLite.

Interim delivery path:

- while Node tooling is unavailable or unstable on the machine, deliver browser-first runtime slices
through FastAPI static pages so lesson mechanics, API contracts, and classroom flow can still be
validated before the Tauri shell is introduced.

## MVP Scope

The first serious MVP should include all structural pillars, but each pillar should stay intentionally narrow.

Must-have:

1. Shared lesson library
2. Lesson metadata and templates
3. Scene-based lesson flow
4. Teacher-controlled forward unlock
5. Student back navigation with saved state
6. 5-7 base widgets
7. Teacher control panel with stars and student list
8. TeachEye-only mini-previews
9. Embedded Python runner
10. Post-lesson analytics summary

Intentionally deferred:

- desktop-wide remote control;
- advanced animation builder;
- broad subject support outside informatics;
- complex AI overlays for every lesson object;
- punitive freeze/punish mechanics beyond future discussion.

## First Demonstration Lesson

Topic:

- IP addressing and powers of two.

Why this first:

- the teacher already knows how to teach it;
- it naturally fits interactive widgets;
- it clearly shows why static slides are weak;
- it combines logic, manipulation, and instant feedback.

Suggested demo flow:

1. Intro scene: why binary and powers of two matter for IP.
2. Powers-of-two interaction: press values to assemble a target number.
3. Binary decomposition scene: break 240 or 255 into bit patterns.
4. Quick multiple-choice or match task.
5. Short Python or pseudo-code connection.
6. End-of-lesson summary with stars and progress.

## Delivery Phases

### Phase A. Foundation

- formalize lesson/scenes/widgets domain model;
- define teacher runtime vs student runtime responsibilities;
- design preview data model around app-state, not desktop capture.

### Phase B. Classroom Loop

- build lesson playback;
- scene unlock flow;
- student state persistence;
- teacher star controls;
- mini-preview wall.

### Phase C. Coding Loop

- embedded Python editor;
- run output and error viewer;
- structured execution history;
- narrow AI help for syntax/runtime mistakes.

### Phase D. Authoring Loop

- lesson builder UI;
- template library;
- widget palette;
- lesson save/copy/version.

### Phase E. Analytics Loop

- post-lesson session summary;
- student progression reports;
- signals for active/inactive learners;
- exportable teacher recap.

## Working Protocol

We continue using the project's vibe-coding approach:

- keep internal rationale in comments where logic gets non-obvious;
- use `# [VIBE-CONTEXT]` headers in Python files;
- mark invariants with `# [LOGIC-ANCHOR]`;
- mark revisit points with `# [VIBE-CHECK]`;
- mark planned future hooks with `# [STUB-FOR-VIBE]`;
- update `PROLOGUE.md` after major implementation steps.

## Next Planning Step

Before coding Lesson Mode, define:

1. the domain model for lessons, scenes, widgets, stars, previews, and code runs;
2. the teacher screen layout;
3. the student screen layout;
4. the event flow between teacher, server, and student clients;
5. the minimal widget contract every interactive block must follow.

