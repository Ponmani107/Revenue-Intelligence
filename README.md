# SpendNest Revenue Intelligence Inbox — Submission README

**SpendNest Sales Manager Workspace**  
*Evaluation Date Scope: 21 August 2026 (Asia/Kolkata)*  
*Deliverables Package: Working App, Editable Source, Organised Exports with Manifest, 5-Slide Presentation, and Walkthrough Guide.*

---

## 1. How to Run the Application

The application is completely self-contained, offline-first, and requires **no external servers, no build tools, and no API keys**.

### Option A: Direct Browser Launch (Recommended)
Simply open `candidate/app/index.html` in any modern web browser (Google Chrome, Microsoft Edge, Mozilla Firefox, or Safari):
```bash
# Double-click candidate/app/index.html, or launch via command line:
start ./candidate/app/index.html    # Windows
open ./candidate/app/index.html     # macOS
xdg-open ./candidate/app/index.html # Linux
```

### Option B: Local HTTP Server (Optional)
If your environment restricts local `file://` URL features, start any lightweight local static server:
```bash
# Using Python 3:
cd candidate/app
python -m http.server 8080
# Then open http://localhost:8080 in your browser
```
```bash
# Or using Node.js:
npx serve candidate/app
```

> **Initial Application State:**  
> When `index.html` opens, it automatically loads both `01_initial.json` and `02_update.json` in post-update state so reviewers can immediately inspect all 44 records and the 21 August 2026 Manager Brief.  
> To test the raw sequential import from scratch, click the red **"Reset All Data"** button in the left sidebar and follow the 5-step Replay Sequence below.

---

## 2. How to Reproduce Each Replay Step (DATA_CONTRACT Compliance)

Navigate to the **Import & Replay** tab in the sidebar. The UI includes an automated step-by-step verification card and raw batch loaders.

| Step | Test Action | Expected & Observed Behaviour | Verification in App |
|:---|:---|:---|:---|
| **1. Initial Import** | Click **"Run"** on Step 1 (or load `01_initial.json`) | Exactly **44 unique records** ingested (30 calls, 14 meetings). **17 usable transcripts** detected. Missing or silent recordings (e.g. M08, M11) are clearly flagged as `no-content`. | Card shows green badge: `✓ 44 unique records loaded (17 usable transcripts)`. Total in app: 44. |
| **2. Repeat Import** | Click **"Run"** on Step 2 (imports `01_initial.json` in reversed order) | **Idempotent ingestion**: Key `(source_type, source_id)` deduplication ensures 0 duplicates are created. Activity counts and denominators do not inflate. | Green badge: `✓ Idempotent: 0 added, 44 skipped, total records remained 44`. |
| **3. Manual Correction** | Click **"Go to M07"** on Step 3 (or select M07 in Conversation Inbox) | Change M07's assigned route (e.g. click `Deal Next Steps`). The manual override flag is set to `true`, and the change is immediately visible in the Inbox, Dashboard, and Manifest table. | M07 displays yellow `Override` badge. Replay Step 3 records active override. |
| **4. Update Import** | Click **"Run"** on Step 4 (or load `02_update.json`) | Newer revision (`revision: 2`) updates existing record `M07` with its late-arriving transcript (28 turns). **Total record count stays strictly at 44** (no second conversation created). Analysis freshness is marked `stale (new revision)`. | M07 displays full transcript turns while preserving any route assigned in Step 3. |
| **5. Preserve Judgment** | Click **"Run"** on Step 5 (re-imports older `01_initial.json`, rev 1) | **Revision ordering rule**: Since `batchRev (1) < existing.revision (2)`, older payload is safely ignored. M07 retains its late transcript and the manager's manual route override survives intact. | Green badge: `✓ Older rev 1 ignored. M07 kept revision 2 + transcript + manual route`. |

---

## 3. Exports & Machine-Readable Manifest

All generated exports are stored in `candidate/exports/` and can also be downloaded directly from the application's **Exports & Manifest** tab as a standalone ZIP archive.

### Folder Structure
```
candidate/exports/
├── manifest.json            # Complete JSON manifest of all 44 records
├── manifest.csv             # CSV manifest for spreadsheet analysis
├── sales_coaching/          # 6 files (C01, C02, C05, C06, C09, C10)
├── deal_next_steps/         # 6 files (C03, C04, C08, M02, M03, M06)
├── customer_followup/       # 3 files (M04, M07, M09)
├── vendor_partner/          # 3 files (C07, M01, M02)
├── internal_ops/            # 1 file  (M10)
├── no_content/              # 26 files (B01-B20, M05, M08, M11-M14)
└── needs_review/            # Holding intake state (0 post-classification)
```

### Multi-Destination Preservation
When a conversation serves multiple commercial purposes, it is routed to multiple destinations without losing context:
- **Example: Record M02** (*Crestview Partners / SpendNest Discussion*) addresses both an overseas client referral partnership and a corporate deal for 40 virtual cards for Crestview itself.
- **Result:** Exported simultaneously to `candidate/exports/vendor_partner/M02_meeting.md` and `candidate/exports/deal_next_steps/M02_meeting.md`.
- **Manifest Tracking:** The `output_paths` field in both `manifest.json` and `manifest.csv` explicitly records `["exports/vendor_partner/M02_meeting.md", "exports/deal_next_steps/M02_meeting.md"]`.

---

## 4. Metric Definitions and Calculations

Every headline number in the dashboard has an explicit, verified denominator:

| Metric | Headline Value | Exact Denominator & Source Definition |
|:---|:---:|:---|
| **Selected Records** | **44** | Total unique `(source_type, source_id)` entities post-deduplication across both delivery batches. |
| **Phone Calls** | **30** | Records where `source_type === 'call'`. Discloses 20 short/unresponsive background dials (`B01`–`B20`) and 10 conversational calls (`C01`–`C10`). |
| **Meetings** | **14** | Records where `source_type === 'meeting'`. Discloses 8 meetings with speech text and 6 without usable audio. Organiser is tracked via `organizer_email` (note: organiser ≠ salesperson or attendee). |
| **Transcript Coverage** | **40.9%** (18 / 44) | **Denominator:** All 44 logical source records.<br>**Numerator:** Records with non-empty transcript text (calls: 10/30 = 33.3%, meetings: 8/14 = 57.1%). Pre-update coverage is 17/44 (38.6%). |
| **Connection Rate** | **36.7%** (11 / 30) | **Denominator:** 30 calls.<br>**Numerator:** Calls with source flag `is_connected === true` (11 calls: `B11`, `B14`, `C01`, `C02`, `C03`, `C05`, `C06`, `C07`, `C08`, `C09`, `C10`). Distinguished from full conversations (`is_conversation === true`, 9 calls / 30 = 30.0%). |
| **Needs Attention** | **0** (post-routing) | Count of records with unresolved review status (`review_state === 'needs-review'`). |

---

## 5. Division of AI and Runtime Operations

- **Pre-generated Content (`candidate/app/data.js`):**  
  Executive summaries, factual "what happened" narratives, exact quotation citations, "what the evidence does not establish" bounds, and initial route suggestions were prepared prior to runtime and embedded in `data.js`. The 21 August 2026 Manager Brief synthesizes this verified evidence.
- **Dynamic Runtime Computations (`candidate/app/app.js`):**  
  - Complete DATA_CONTRACT ingest and deduplication engine using Map data structures.
  - Idempotent repeat checking and revision ordering (`batchRev > existing.revision`).
  - Safe preservation of human manual route overrides across updates and re-imports.
  - Dynamic stale analysis flagging when new revisions arrive without refreshed AI inference.
  - Runtime filtering by Rep, Organiser, Source Type, Route, and search text.
  - Dynamic manifest compilation (`manifest.json`, `manifest.csv`) and standalone client-side ZIP archive generation.

---

## 6. Three Most Important Findings

### Finding 1: Cold Outreach Sourcing & Consent Resistance (Call C01)
- **Source Citation:** Call C01, rep Arun, prospect Pranav (Harborlight Advisory), duration 99s.  
  > *"I don't know how I ended up on your list. I didn't ask for this call, and I'm not interested... This number is for my work, not for people to sell things to me... Where did you find my details?"*
- **Exact Screen & Rule Influenced:**  
  Influenced the **Sales Coaching route filter** and the **21 August Manager Brief Coaching Priorities**. Flagged that Arun spent 40+ seconds defending the networking list source rather than addressing the prospect's operating pain or acknowledging the interruption gracefully. Resulted in a coaching rule to review cold sourcing scripts and compliance opt-out handling.

### Finding 2: Scalable Referral Links vs Manual Email Introductions (Meeting M01)
- **Source Citation:** Meeting M01, Team Member A with Partner A (Harborpath Advisory), turns 9, 17, and 18.  
  > *"The activation payment is USD 260 when a referred company gets its account approved by our compliance partners. The cards option also has an interchange revenue share..."* (turn 9)  
  > *"How do we track that? Is there a referral link, a code, or am I writing an introduction each time? ... It cannot depend on me manually writing every email. This needs to scale."* (turns 17–18)
- **Exact Screen & Rule Influenced:**  
  Influenced the **Vendor / Partner route** action items and the **Manager Brief Deal Tracker**. Highlighted an operational friction point where SpendNest's default manual email intro process threatens partner velocity; directly established a priority action for Sales Ops to provision unique partner referral URLs.

### Finding 3: Multi-Tenant Credential / Token Expiry Bug (Meeting M09)
- **Source Citation:** Meeting M09, Customer Success with Customer A (managing Northkite Equipment & Brookmint Holdings), turn 9.  
  > *"It says the token has expired. This is the fresh message we just received."* (turn 9)
- **Exact Screen & Rule Influenced:**  
  Influenced the **Customer Follow-up route**, the **Exceptions List banner**, and the **Manager Brief Escalation section**. Demonstrates that a repeat password reset token failure blocked the customer from completing their Brookmint Holdings workspace onboarding. Raised an urgent Engineering bug escalation rather than treating the interaction as a routine customer query.

---

## 7. One Deliberately Rejected Decision

- **Alternative Considered:**  
  Calculating automated "Projected Pipeline Value" (e.g. estimating contract values from verbal quotes such as the $260 partner bounty in M01 or software tier discussions in M02/C03) and ranking sales reps on an estimated revenue leaderboard.
- **Why Deliberately Rejected:**  
  The data contract and brief explicitly establish that no CRM opportunity table, win probability formula, historical baseline, or account directory is supplied. Synthesizing speculative currency values from conversational fragments produces dangerous false precision that misleads sales leadership.
- **Accepted Trade-off & Resulting Product Choice:**  
  We deliberately omitted speculative revenue charts. Instead, the dashboard presents verified, indisputable operational facts: call volumes, connection rates, verified conversation lengths, and transcript availability. Commercial opportunities are managed through qualifiable next steps with explicitly stated owners in the **Deal Next Steps** queue.

---

## 8. Approximate Hours Spent, Known Limitations, and Unfinished Work

- **Approximate Hours Spent:** ~7.5 hours total (Data exploration: 1.5h; Ingest/Replay engine & State Architecture: 2.0h; UI & Aesthetics: 2.0h; Verification, Exports, Slides & Documentation: 2.0h).
- **Known Limitations:**  
  1. *Single-Day Scope:* All source records occur on 21 August 2026; multi-week historical performance trends cannot be calculated without additional dates.  
  2. *In-Memory Architecture:* Replay state is held in JavaScript memory during the browser session. Hard browser page reloads re-initialize from bundled batches.
  3. *Static Meeting Organisers:* Meeting organizers are captured via email; the dataset provides no staff directory mapping organizers to CRM user IDs or attendee lists.
- **Unfinished Work / Next Roadmap:**  
  1. *Live LLM Reprompting:* An optional hook to trigger private LLM regeneration when late transcripts (e.g. M07) arrive.  
  2. *IndexedDB Persistent Cache:* Persisting manual route corrections and custom tags across browser reboots.  
  3. *Webhook Intake Endpoint:* A lightweight REST microservice to ingest telephony payloads conforming to DATA_CONTRACT schemas.

---

## 9. Submission Deliverables Summary

1. **Local Web App:** `candidate/app/index.html` (with `candidate/app/styles.css`, `app.js`, `data.js`).
2. **Organised Export Package:** `candidate/exports/` containing 7 category folders with 45 markdown files, `manifest.json`, and `manifest.csv`.
3. **Five Slides:** `candidate/presentation.pptx` (and browser-viewable `candidate/slides.html` / `presentation.pdf`).
4. **README:** `candidate/README.md` (this document).
5. **Screen Recording Walkthrough Guide:** Provided in Section 10 below for the 3-minute continuous narration video.

---

## 10. 3-Minute Screen Recording Narration Guide

Use this concise script while recording your continuous 3-minute screen capture:

- **0:00 – 0:45 | Overview & Manager Workflow (Dashboard & Brief):**  
  *Screen:* Open `candidate/app/index.html` on the **Dashboard** view.  
  *Narration:* "Welcome to the SpendNest Revenue Intelligence Inbox for August 21st, 2026. As a sales manager, my first need is clarity. Our dashboard displays 44 distinct source records across 30 calls and 14 meetings. We disclose our denominators honestly: our connection rate is 36.7% based on source telemetry, and transcript coverage is 40.9% post-update—we don't hide the 26 calls or meetings that have no audio. Filtering by rep Meera or Arun instantly breaks down conversations versus short dials. Clicking into our Manager Brief shows today's synthesized coaching priorities and deal next steps."

- **0:45 – 1:40 | The Difficult Routing Decision (Inbox & Meeting M02):**  
  *Screen:* Switch to the **Conversation Inbox** and select record `M02` (*Crestview Partners*).  
  *Narration:* "A difficult routing challenge is Meeting M02. It’s a hybrid conversation: Crestview discusses referring overseas accounting clients for partner commissions, but also asks for a SpendNest corporate account and 40 virtual cards for their own firm. Single routing would drop either the partnership or the active sales opportunity. Our system routes M02 to both Vendor/Partner and Deal Next Steps. In the detail pane, we see the exact transcript citations and next actions for both owners. In our Exports tab, M02 is exported into both folders without losing context."

- **1:40 – 2:50 | The Replay, Duplicate & Update Test (Import & Replay Tab):**  
  *Screen:* Navigate to **Import & Replay**. Click **"Reset All Data"**.  
  *Narration:* "Now let's demonstrate the required replay sequence.  
  1. First, we load `01_initial.json`. We see 44 unique records and 17 usable transcripts. Meeting M07 currently has no transcript.  
  2. Next, we repeat that exact import in shuffled order. Notice the total records remains strictly 44—zero duplicates, zero inflated activity counts.  
  3. Now, we simulate human judgment. We go to M07 in the Inbox and manually reassign its route to Deal Next Steps. The override badge appears.  
  4. Now we import `02_update.json`. M07's late transcript arrives with 28 turns. Notice our total record count is still 44, and our manual route assignment survived!  
  5. Finally, we run our preserve judgment test by re-importing the older initial batch. Because the update had revision 2 and the initial batch had revision 1, the older data is safely ignored, and our manual correction remains in effect."

- **2:50 – 3:00 | Conclusion & Exports:**  
  *Screen:* Switch to **Exports & Manifest**.  
  *Narration:* "Finally, all 44 records and assigned routes are reflected in our manifest table and exported across our 7 route folders, with JSON and CSV manifests and downloadable ZIP. Thank you."
