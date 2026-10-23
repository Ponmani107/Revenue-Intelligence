import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def create_presentation():
    prs = Presentation()
    # 16:9 Widescreen dimensions
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    blank_layout = prs.slide_layouts[6]

    # Color Palette
    C_DARK = RGBColor(15, 23, 42)       # Slate 900
    C_BLUE = RGBColor(37, 99, 235)      # Blue 600
    C_LIGHT = RGBColor(248, 250, 252)   # Slate 50
    C_CARD_BG = RGBColor(255, 255, 255) # White
    C_TEXT = RGBColor(30, 41, 59)       # Slate 800
    C_MUTED = RGBColor(100, 116, 139)   # Slate 500
    C_ACCENT = RGBColor(13, 148, 136)   # Teal 600
    C_AMBER = RGBColor(217, 119, 6)     # Amber 600
    C_BORDER = RGBColor(226, 232, 240)  # Slate 200

    def add_header(slide, title_text, subtitle_text, slide_num):
        # Header banner
        header_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(1.0))
        tf = header_box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
        
        p = tf.paragraphs[0]
        p.text = title_text
        p.font.size = Pt(22)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.font.name = "Arial"

        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(11)
        p2.font.color.rgb = C_MUTED
        p2.font.name = "Arial"

        # Badge / slide number
        num_box = slide.shapes.add_textbox(Inches(11.2), Inches(0.4), Inches(1.3), Inches(0.5))
        ntf = num_box.text_frame
        ntf.margin_right = 0
        np = ntf.paragraphs[0]
        np.alignment = PP_ALIGN.RIGHT
        np.text = f"SLIDE {slide_num} OF 5"
        np.font.size = Pt(10)
        np.font.bold = True
        np.font.color.rgb = C_BLUE
        np.font.name = "Arial"

        # Separator line
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.4), Inches(11.733), Inches(0.02))
        line.fill.solid()
        line.fill.fore_color.rgb = C_BORDER
        line.line.color.rgb = C_BORDER

    def add_card(slide, left, top, width, height, title, body_bullets, tag=None, tag_color=C_BLUE):
        # Background card shape
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
        card.fill.solid()
        card.fill.fore_color.rgb = C_CARD_BG
        card.line.color.rgb = C_BORDER
        card.line.width = Pt(1)

        # Content box
        tb = slide.shapes.add_textbox(Inches(left + 0.25), Inches(top + 0.2), Inches(width - 0.5), Inches(height - 0.4))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        # Title
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.font.name = "Arial"

        if tag:
            p_tag = tf.add_paragraph()
            p_tag.text = f"TAG: {tag.upper()}"
            p_tag.font.size = Pt(8.5)
            p_tag.font.bold = True
            p_tag.font.color.rgb = tag_color
            p_tag.font.name = "Arial"
            p_tag.space_after = Pt(4)

        # Bullets / Body
        for bullet in body_bullets:
            p_b = tf.add_paragraph()
            p_b.text = bullet
            p_b.font.size = Pt(9.5)
            p_b.font.color.rgb = C_TEXT
            p_b.font.name = "Arial"
            p_b.space_after = Pt(3)

    # -------------------------------------------------------------
    # SLIDE 1: Problem Solved & Main Findings
    # -------------------------------------------------------------
    s1 = prs.slides.add_slide(blank_layout)
    bg1 = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg1.fill.solid()
    bg1.fill.fore_color.rgb = C_LIGHT
    bg1.line.fill.background()

    add_header(s1, "1. Manager Problem Solved & Core Findings", 
               "SpendNest Revenue Intelligence Inbox · 21 August 2026 Manager Assessment", 1)

    add_card(s1, 0.8, 1.6, 5.7, 5.4, "The Manager Problem Addressed", [
        "• Incoming Data Chaos: 44 fragmented records (30 calls, 14 meetings) arrive across disparate phone/meeting systems with missing transcripts, asynchronous updates, and misaligned metadata.",
        "• The Operational Hazard: Stored labels are unreliable. For instance, cold-outreach calls are marked 'stored' without coaching notes; silent meetings hide cancellation details; late transcripts arrive hours after calls end.",
        "• Solution Built: An offline-first, idempotent workspace providing clean activity metrics, honest transcript coverage definitions, multi-destination routing, and evidence-grounded action plans.",
        "• Strict Verification: Discloses true denominators (30 calls with 10 conversations; 14 meetings with 8 transcripts post-update). Prohibits phantom pipeline revenue estimations."
    ], tag="Strategic Context", tag_color=C_BLUE)

    add_card(s1, 6.8, 1.6, 5.7, 5.4, "Three Grounded Source Findings", [
        "1. Cold Outreach Consent & Sourcing Resistance (Call C01):",
        "   - Passage: \"I don't know how I ended up on your list. I didn't ask for this call... Where did you find my details?\"",
        "   - System Impact: Influenced the Sales Coaching filter & coaching brief; flagged cold-outreach consent scripts for rep Arun.",
        "2. Referral Economics vs API Integration (Meeting M01):",
        "   - Passage: \"The activation payment is USD 260 when a referred company gets its account approved... It cannot depend on me manually writing every email. This needs to scale.\" (Partner A, turns 9 & 18)",
        "   - System Impact: Influenced Vendor/Partner route, prompting automated referral links over manual email introductions.",
        "3. Multi-Tenant Token Expiry Bug (Meeting M09, CS Session):",
        "   - Passage: \"It says the token has expired. This is the fresh message we just received.\" (Customer A, turn 9)",
        "   - System Impact: Routed to Customer Follow-up with urgent Engineering escalation priority to unblock Brookmint setup."
    ], tag="Evidence & Citations", tag_color=C_ACCENT)

    # -------------------------------------------------------------
    # SLIDE 2: Interface Choices & Deliberate Omissions
    # -------------------------------------------------------------
    s2 = prs.slides.add_slide(blank_layout)
    bg2 = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg2.fill.solid()
    bg2.fill.fore_color.rgb = C_LIGHT
    bg2.line.fill.background()

    add_header(s2, "2. Interface Design Choices & Deliberate Omissions", 
               "Maximizing Manager Utility through Transparent Signals and Honest Uncertainty", 2)

    add_card(s2, 0.8, 1.6, 5.7, 2.55, "Included: High-Signal Navigation", [
        "• Dedicated Views: Activity Dashboard, 2-Pane Conversation Inbox, 21 Aug Manager Brief, Exports & Manifest Inspector, Replay Tester.",
        "• Clear Distinctions: Distinct role separation between call reps (rep_name) and meeting organizers (organizer_email != salesperson/attendee).",
        "• Interactive Overrides: Instant route reassignment buttons with visual 'Override' badges and preserved manual state."
    ], tag="Included Features", tag_color=C_ACCENT)

    add_card(s2, 0.8, 4.4, 5.7, 2.6, "Included: Transparent Denominators", [
        "• Transcript Coverage: Clearly displayed as 18/44 (40.9%) post-update (calls: 10/30, meetings: 8/14). No hiding 26 unrecorded records.",
        "• Connection Rate: Factual 11/30 (36.7%) based strictly on source is_connected flag, separated from full conversations.",
        "• Freshness Tags: Stale badge displayed if an update replaces underlying text."
    ], tag="Metric Clarity", tag_color=C_BLUE)

    add_card(s2, 6.8, 1.6, 5.7, 5.4, "Deliberately Rejected Decision & Omissions", [
        "• REJECTED: Projected Pipeline Valuation & Rep Revenue Leaderboards",
        "  - What was considered: Extrapolating dollar deal values from transcript mentions (e.g., $260 partner bounty in M01 or software quotes in M02) to create a cumulative pipeline chart.",
        "  - Why deliberately rejected: DATA_CONTRACT and brief state no CRM opportunity table, win probability, or historical pipeline baseline exists. Fabricating contract values produces dangerous false precision and misdirects executive focus.",
        "  - Accepted Trade-off: Focus on verified operational milestones (contact reached, proposal requested, follow-up scheduled) with clear named owners.",
        "• OMITTED: Redundant Date Picker: All records occur on 21 August 2026. A calendar filter creates useless UI friction; replaced by Rep and Source Type filters.",
        "• OMITTED: Generic Summaries: Suppressed AI summarization on records without usable audio (marked explicitly as 'no-content')."
    ], tag="Rejected Alternative", tag_color=C_AMBER)

    # -------------------------------------------------------------
    # SLIDE 3: Routing Taxonomy, Folder Structure & Difficult Case
    # -------------------------------------------------------------
    s3 = prs.slides.add_slide(blank_layout)
    bg3 = s3.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg3.fill.solid()
    bg3.fill.fore_color.rgb = C_LIGHT
    bg3.line.fill.background()

    add_header(s3, "3. Routing Taxonomy, Folder Organization & Difficult Case", 
               "Multi-Destination Routing without Context Loss & Managing Ambiguity", 3)

    add_card(s3, 0.8, 1.6, 5.7, 2.55, "Seven Actionable Route Destinations", [
        "• sales_coaching (6 records): Cold objection handling, pitch technique.",
        "• deal_next_steps (6 records): Commercial qualification & proposals.",
        "• customer_followup (3 records): Support, migrations, bug resolution.",
        "• vendor_partner (3 records): Advisory partnerships & reseller agreements.",
        "• internal_ops (1 record): Internal billing workflow training (M10).",
        "• no_content (26 records): Short dials, voicemails, silent recordings.",
        "• needs_review (0 records post-classification; intake holding state)."
    ], tag="Taxonomy Design", tag_color=C_BLUE)

    add_card(s3, 0.8, 4.4, 5.7, 2.6, "Export Organization & Manifest", [
        "• Multi-Folder Preservation: Conversations serving multiple purposes (e.g. M02) export distinct markdown files to each folder without losing context.",
        "• Complete Machine-Readable Manifests: manifest.json and manifest.csv record source_id, revision, routes, file paths, and override status.",
        "• Standalone In-Browser ZIP: Pure JS ZIP generation downloads the full 45-file tree directly without external backend dependencies."
    ], tag="Export Architecture", tag_color=C_ACCENT)

    add_card(s3, 6.8, 1.6, 5.7, 5.4, "The Difficult Routing Case: Meeting M02", [
        "• Subject: Crestview Partners / SpendNest Discussion (Record M02)",
        "• The Routing Conflict: Is this a Vendor/Partner conversation or an active Sales Deal Next Steps conversation?",
        "  - Partner Dimension: Discussion focuses on referring overseas accounting clients and signing an advisory partnership memorandum.",
        "  - Direct Deal Dimension: Partner asks for a SpendNest corporate account for their own firm, specifically requesting a quote for 40 virtual cards.",
        "• Resolution & Trade-off:",
        "  - Single-category routing would discard critical commercial context (either the partnership or the 40-card deal).",
        "  - Resolution: Dual-routed to both 'vendor_partner' and 'deal_next_steps'.",
        "  - In the export folder tree, M02 exports cleanly to both exports/vendor_partner/M02_meeting.md and exports/deal_next_steps/M02_meeting.md.",
        "  - Reviewer can verify in Manifest table: output_paths contains both paths, preventing cross-team dropped balls."
    ], tag="Edge Case Breakdown", tag_color=C_AMBER)

    # -------------------------------------------------------------
    # SLIDE 4: Numbers Verification & Evidence Tracing
    # -------------------------------------------------------------
    s4 = prs.slides.add_slide(blank_layout)
    bg4 = s4.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg4.fill.solid()
    bg4.fill.fore_color.rgb = C_LIGHT
    bg4.line.fill.background()

    add_header(s4, "4. Number Verification & Analytical Evidence Tracing", 
               "Auditing Metrics Against Source Payloads and Grounding Conclusions", 4)

    add_card(s4, 0.8, 1.6, 5.7, 5.4, "Audit of Key Metrics & Calculations", [
        "• 44 Unique Source Records:",
        "  - Total raw records across both batches: 45 (44 in initial + 1 in update).",
        "  - Key (source_type, source_id) deduplication yields exactly 44 unique items.",
        "  - 30 Calls: 20 short/unresponsive dials (B01-B20) + 10 calls with transcripts (C01-C10).",
        "  - 14 Meetings: 8 with speech text (M01-M04, M06, M07, M09, M10) + 6 silent/cancelled (M05, M08, M11-M14).",
        "• Connection Rate Calculation:",
        "  - Source payload is_connected: 11 True (B11, B14, C01-C03, C05-C10) / 30 calls = 36.67%.",
        "  - Full conversations (is_conversation=True): 9 calls / 30 = 30.0%.",
        "• Usable Transcript Coverage:",
        "  - Initial batch: 17/44 (38.64%).",
        "  - Post-update batch: 18/44 (40.91%) after M07 transcript arrives.",
        "  - All denominators verified directly from JSON source payloads."
    ], tag="Mathematical Verification", tag_color=C_BLUE)

    add_card(s4, 6.8, 1.6, 5.7, 5.4, "Tracing Analytical Conclusions to Evidence", [
        "• Coaching Conclusion: Meera (Calls C05, C06, C08, C09, C10)",
        "  - Evidence: In Call C06 (Mr Nikhil), Meera opens with: \"I'll say at the start that this is a cold call. Could I take about forty seconds to explain the purpose?\"",
        "  - Manager Deduction: Strong, honest pitch discipline; however, prospects frequently state existing solutions (StoreHarbor, internal ERP). Coaching priority: pivot from feature listing to pain-point discovery.",
        "• Operational Risk Conclusion: Back-Office Billing (M10)",
        "  - Evidence: Trainer notes: \"Clearing the payment without checking that date can leave the next cycle wrong.\" (M10, turn 7).",
        "  - Manager Deduction: Wallet top-up alone does not fix frozen accounts; manual date synchronization is required.",
        "• Late Transcript Resolution (M07 - Revision 2)",
        "  - Initial state: No transcript. Update state: 28 turns arrive detailing Cedarwave Migration.",
        "  - Verification: Identity check preserved manual route; fresh text successfully displayed without duplicate record creation."
    ], tag="Source Evidence Tracing", tag_color=C_ACCENT)

    # -------------------------------------------------------------
    # SLIDE 5: Trade-offs, AI Usage, Limitations & Roadmap
    # -------------------------------------------------------------
    s5 = prs.slides.add_slide(blank_layout)
    bg5 = s5.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg5.fill.solid()
    bg5.fill.fore_color.rgb = C_LIGHT
    bg5.line.fill.background()

    add_header(s5, "5. Trade-offs, AI Usage, Limitations & Future Roadmap", 
               "Honest Evaluation of Architectural Choices and Next Iterations", 5)

    add_card(s5, 0.8, 1.6, 5.7, 2.55, "Architectural Trade-offs & Decisions", [
        "• Client-Side Standalone vs Server DB: Selected zero-install HTML/CSS/JS with in-memory Map store. Eliminates API key leakage, complex setup, and runtime failure; reviewers open index.html immediately in any modern browser.",
        "• Multi-Route Duplication vs Flattening: Exporting dual-assigned records into multiple folders ensures independent team visibility, accepting slight disk redundancy.",
        "• Idempotent Revision Logic: Revisions strictly compared; older revisions safely discarded without overwriting manual overrides."
    ], tag="Architecture", tag_color=C_BLUE)

    add_card(s5, 0.8, 4.4, 5.7, 2.6, "AI Disclosure & Runtime Division", [
        "• Pre-Generated Analysis: Analysis summaries, quotations, and next actions were pre-generated with AI assistance and stored in data.js.",
        "• Dynamic Runtime Operations: Deduplication, revision resolution, metric aggregation, route assignment, manual overrides, search, filtering, manifest compilation, and ZIP archiving all execute dynamically in pure JavaScript.",
        "• Stale Analysis Flagging: Dynamic flag warns managers when underlying transcripts change without refreshed AI analysis."
    ], tag="AI Usage Boundary", tag_color=C_ACCENT)

    add_card(s5, 6.8, 1.6, 5.7, 5.4, "Known Limitations & What to Build Next", [
        "• Known Limitations:",
        "  - Absence of CRM Account Directory: Cannot cross-reference caller numbers to CRM account histories or verified account values.",
        "  - In-Memory State: Refreshing the browser re-evaluates bundled batches; permanent cross-session storage would benefit from IndexedDB or server persistence.",
        "  - Single-Day Scope: All dataset activity falls on 21 August 2026. Trend-based forecasting requires multi-week time-series data.",
        "• Unfinished Work / Next Roadmap Items:",
        "  1. Live LLM Reprompting: Connect an optional private LLM gateway to dynamically regenerate summaries when late transcripts arrive (e.g. M07).",
        "  2. Webhook Ingestion Pipeline: Build a REST intake endpoint validating DATA_CONTRACT schemas for real-time telephony feeds.",
        "  3. Rep Coaching Workflow Tracker: Enable managers to leave timestamped audio coaching comments linked directly to transcript turns."
    ], tag="Roadmap & Limitations", tag_color=C_AMBER)

    output_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "presentation.pptx"))
    prs.save(output_path)
    print(f"Presentation saved successfully to: {output_path}")

if __name__ == "__main__":
    create_presentation()
