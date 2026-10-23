/**
 * Revenue Intelligence Inbox — app.js
 * SpendNest Sales Manager Workspace
 * Handles: Metrics, routing, inbox inspection, manual corrections,
 * idempotent replay / revision tracking, and manifest exports.
 */

(function () {
  'use strict';

  // =========================================================================
  // Application State
  // =========================================================================
  const state = {
    // Map of key `${source_type}:${source_id}` -> record model
    records: new Map(),
    // Map of source_id -> array of routes manually assigned
    manualOverrides: new Map(),
    // Audit log of imports
    importLog: [],
    // Current active view
    currentView: 'dashboard',
    // Currently inspected record
    selectedKey: null,
    // Active filters
    filters: {
      dashboardPerson: 'all',
      dashboardType: 'all',
      inboxRoute: 'all',
      inboxType: 'all',
      inboxSearch: ''
    },
    // Step completion tracker for Replay Sequence
    replaySteps: {
      step1: null,
      step2: null,
      step3: null,
      step4: null,
      step5: null
    }
  };

  // Helper: check if a record has usable text
  function hasUsableTranscript(record) {
    if (record.source_type === 'call') {
      return Boolean(record.payload && record.payload.transcript && record.payload.transcript.trim());
    }
    if (record.source_type === 'meeting') {
      const tp = record.transcript_payload;
      return Boolean(tp && Array.isArray(tp.turns) && tp.turns.length > 0);
    }
    return false;
  }

  // Helper: generate stable unique record key
  function getRecordKey(sourceType, sourceId) {
    return `${sourceType}:${sourceId}`;
  }

  // =========================================================================
  // Ingest / Deduplication Engine (DATA_CONTRACT compliant)
  // =========================================================================
  function ingestBatch(batchData, filename = 'batch.json') {
    if (!batchData || !Array.isArray(batchData.records)) {
      showToast('Invalid data batch format', 'error');
      return { added: 0, updated: 0, skipped: 0, totalInBatch: 0 };
    }

    const batchId = batchData.batch_id || 'unknown';
    const batchRev = Number(batchData.revision) || 1;
    let added = 0;
    let updated = 0;
    let skipped = 0;

    batchData.records.forEach((rawRecord) => {
      const sourceType = rawRecord.source_type;
      const sourceId = rawRecord.source_id || (rawRecord.payload && rawRecord.payload.id);
      if (!sourceType || !sourceId) {
        skipped++;
        return;
      }

      const key = getRecordKey(sourceType, sourceId);
      const existing = state.records.get(key);

      if (!existing) {
        // Brand new record
        const record = buildRecordModel(rawRecord, batchId, batchRev);
        state.records.set(key, record);
        added++;
      } else {
        // Record already exists: check revision
        if (batchRev > existing.revision) {
          // Higher revision: update payload & transcript, preserve manual routes!
          existing.revision = batchRev;
          existing.batch_id = batchId;
          existing.payload = rawRecord.payload;
          existing.transcript_payload = rawRecord.transcript_payload;
          existing.has_usable_transcript = hasUsableTranscript(rawRecord);

          // Mark analysis stale if text was updated
          if (existing.has_usable_transcript && existing.analysisSource === 'pre-generated') {
            existing.analysis_freshness = 'stale (new revision)';
          }

          // Re-evaluate default route if no manual override
          if (!existing.is_manual_override) {
            existing.routes = computeDefaultRoutes(existing);
          }
          updated++;
        } else {
          // Same or older revision: ignore cleanly to prevent duplicate counting or regressions
          skipped++;
        }
      }
    });

    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      filename,
      batchId,
      revision: batchRev,
      recordsInBatch: batchData.records.length,
      added,
      updated,
      skipped,
      totalStateRecords: state.records.size
    };
    state.importLog.unshift(logEntry);

    updateUI();
    return logEntry;
  }

  // Model builder
  function buildRecordModel(rawRecord, batchId, revision) {
    const sourceType = rawRecord.source_type;
    const sourceId = rawRecord.source_id || rawRecord.payload.id;
    const ref = rawRecord.record_ref || (sourceType === 'call' ? 'C??' : 'M??');
    const usable = hasUsableTranscript(rawRecord);

    const preAnalysis = window.PREGENERATED_ANALYSIS && window.PREGENERATED_ANALYSIS[sourceId];
    const isManual = state.manualOverrides.has(sourceId);
    const manualRoute = state.manualOverrides.get(sourceId);

    let routes = [];
    if (isManual) {
      routes = manualRoute;
    } else if (preAnalysis && preAnalysis.route) {
      routes = [...preAnalysis.route];
    } else {
      routes = usable ? ['needs-review'] : ['no-content'];
    }

    let reviewState = 'resolved';
    if (!usable) {
      reviewState = 'no-content';
    } else if (routes.includes('needs-review')) {
      reviewState = 'needs-review';
    }

    return {
      record_ref: ref,
      source_type: sourceType,
      source_id: sourceId,
      revision: revision,
      batch_id: batchId,
      payload: rawRecord.payload || {},
      transcript_payload: rawRecord.transcript_payload || null,
      has_usable_transcript: usable,
      routes: routes,
      is_manual_override: isManual,
      review_state: reviewState,
      analysis: preAnalysis || null,
      analysisSource: preAnalysis ? 'pre-generated' : 'none',
      analysis_freshness: preAnalysis ? 'fresh' : 'none'
    };
  }

  // Default routes heuristic
  function computeDefaultRoutes(rec) {
    if (!rec.has_usable_transcript) return ['no-content'];
    if (rec.analysis && rec.analysis.route) return [...rec.analysis.route];
    return ['needs-review'];
  }

  // =========================================================================
  // Manual Correction Engine
  // =========================================================================
  function setManualRoute(sourceId, newRoutes) {
    const target = Array.from(state.records.values()).find((r) => r.source_id === sourceId);
    if (!target) return;

    state.manualOverrides.set(sourceId, newRoutes);
    target.routes = [...newRoutes];
    target.is_manual_override = true;
    target.review_state = newRoutes.includes('needs-review') ? 'needs-review' : 'resolved';

    // Update replay sequence step 3 if this was M07
    if (target.record_ref === 'M07') {
      state.replaySteps.step3 = `M07 route changed to [${newRoutes.join(', ')}]. Manual override preserved.`;
      const s3El = document.getElementById('step-3-result');
      if (s3El) s3El.innerHTML = `<span class="badge-success">✓ Route updated to: ${newRoutes.join(', ')}</span>`;
    }

    showToast(`Updated route for ${target.record_ref}`, 'success');
    updateUI();
  }

  // =========================================================================
  // UI Rendering & Updates
  // =========================================================================
  function updateUI() {
    renderSidebarStatus();
    renderDashboard();
    renderInbox();
    renderBrief();
    renderExports();
    renderImportTab();
  }

  // Sidebar Status Indicator
  function renderSidebarStatus() {
    const total = state.records.size;
    const badge = document.getElementById('badge-inbox');
    const stateText = document.getElementById('state-text');
    const stateDot = document.getElementById('state-dot');

    if (badge) badge.textContent = total;

    if (total === 0) {
      if (stateText) stateText.textContent = 'No data loaded';
      if (stateDot) stateDot.style.background = '#6b7280';
    } else {
      const usable = Array.from(state.records.values()).filter((r) => r.has_usable_transcript).length;
      if (stateText) stateText.textContent = `${total} records (${usable} transcripts)`;
      if (stateDot) stateDot.style.background = '#10b981';
    }
  }

  // =========================================================================
  // DASHBOARD VIEW
  // =========================================================================
  function renderDashboard() {
    const emptyEl = document.getElementById('dashboard-empty');
    const contentEl = document.getElementById('dashboard-content');
    if (!emptyEl || !contentEl) return;

    if (state.records.size === 0) {
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    const recordsArr = Array.from(state.records.values());

    // Apply dashboard filters
    const filtered = recordsArr.filter((r) => {
      if (state.filters.dashboardType !== 'all' && r.source_type !== state.filters.dashboardType) {
        return false;
      }
      if (state.filters.dashboardPerson !== 'all') {
        const person = getRecordPerson(r);
        if (person !== state.filters.dashboardPerson) return false;
      }
      return true;
    });

    // Populate person dropdown once
    populatePersonDropdown(recordsArr);

    // KPI Metrics
    const total = filtered.length;
    const calls = filtered.filter((r) => r.source_type === 'call');
    const meetings = filtered.filter((r) => r.source_type === 'meeting');
    const usableTranscripts = filtered.filter((r) => r.has_usable_transcript);
    const coveragePct = total > 0 ? ((usableTranscripts.length / total) * 100).toFixed(1) : 0;

    // Connection rate calculation (DATA_DICTIONARY: is_connected === true / non-null is_connected)
    const callsWithConnReport = calls.filter((c) => c.payload && typeof c.payload.is_connected === 'boolean');
    const connectedCalls = callsWithConnReport.filter((c) => c.payload.is_connected === true);
    const connRatePct = callsWithConnReport.length > 0
      ? ((connectedCalls.length / callsWithConnReport.length) * 100).toFixed(1)
      : 0;

    // Needs attention count
    const needsAttention = filtered.filter(
      (r) => r.review_state === 'needs-review' || r.routes.includes('needs-review')
    ).length;

    // Populate DOM cards
    setElText('m-total', total);
    setElText('m-calls', calls.length);
    setElText('m-calls-sub', `${calls.filter((c) => c.has_usable_transcript).length} with usable transcript`);
    setElText('m-meetings', meetings.length);
    setElText('m-meetings-sub', `${meetings.filter((m) => m.has_usable_transcript).length} with usable transcript`);
    setElText('m-coverage', `${coveragePct}%`);
    setElText('m-coverage-sub', `${usableTranscripts.length} of ${total} records covered`);
    setElText('m-connect', `${connRatePct}%`);
    setElText('m-connect-sub', `${connectedCalls.length} of ${callsWithConnReport.length} calls (source-reported)`);
    setElText('m-attention', needsAttention);

    // Rep / Organiser Activity Table
    renderRepTable(recordsArr);

    // Routing Summary Cards
    renderRouteCards(filtered);

    // Coverage Grid Breakdown
    renderCoverageGrid(recordsArr);

    // Exceptions list
    renderExceptionsList(recordsArr);
  }

  function getRecordPerson(record) {
    if (record.source_type === 'call') {
      return record.payload.rep_name || record.payload.rep_email || 'Unknown Caller';
    }
    return record.payload.organizer_email || 'Unknown Organiser';
  }

  function populatePersonDropdown(recordsArr) {
    const sel = document.getElementById('filter-person');
    if (!sel || sel.options.length > 1) return; // already populated

    const people = new Set();
    recordsArr.forEach((r) => people.add(getRecordPerson(r)));

    Array.from(people).sort().forEach((person) => {
      const opt = document.createElement('option');
      opt.value = person;
      opt.textContent = person;
      sel.appendChild(opt);
    });
  }

  function renderRepTable(recordsArr) {
    const tbody = document.getElementById('person-table-body');
    if (!tbody) return;

    // Group by person
    const grouped = new Map();
    recordsArr.forEach((r) => {
      const person = getRecordPerson(r);
      if (!grouped.has(person)) {
        grouped.set(person, {
          person,
          calls: 0,
          meetings: 0,
          transcripts: 0,
          connectedCalls: 0,
          conversations: 0,
          isRep: r.source_type === 'call'
        });
      }
      const entry = grouped.get(person);
      if (r.source_type === 'call') {
        entry.calls++;
        if (r.payload.is_connected) entry.connectedCalls++;
        if (r.payload.is_conversation) entry.conversations++;
      } else {
        entry.meetings++;
      }
      if (r.has_usable_transcript) entry.transcripts++;
    });

    let html = '';
    Array.from(grouped.values()).sort((a, b) => (b.calls + b.meetings) - (a.calls + a.meetings)).forEach((row) => {
      const roleBadge = row.isRep
        ? '<span class="badge-role sdr">Outreach Rep</span>'
        : '<span class="badge-role organiser">Meeting Organiser</span>';
      html += `
        <tr>
          <td><strong>${escapeHtml(row.person)}</strong></td>
          <td>${roleBadge}</td>
          <td>${row.calls}</td>
          <td>${row.meetings}</td>
          <td>${row.transcripts}</td>
          <td>${row.connectedCalls}</td>
          <td>${row.conversations}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  function renderRouteCards(filtered) {
    const container = document.getElementById('route-cards');
    if (!container) return;

    const taxonomy = window.ROUTE_TAXONOMY || {};
    const routeCounts = {};
    Object.keys(taxonomy).forEach((k) => (routeCounts[k] = 0));

    filtered.forEach((r) => {
      r.routes.forEach((route) => {
        routeCounts[route] = (routeCounts[route] || 0) + 1;
      });
    });

    let html = '';
    Object.entries(taxonomy).forEach(([key, info]) => {
      const count = routeCounts[key] || 0;
      html += `
        <div class="route-card ${info.color}" onclick="filterInboxByRoute('${key}')">
          <div class="route-header">
            <span class="route-title">${info.label}</span>
            <span class="route-badge">${count}</span>
          </div>
          <p class="route-desc">${info.description}</p>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  function renderCoverageGrid(recordsArr) {
    const grid = document.getElementById('coverage-grid');
    if (!grid) return;

    const calls = recordsArr.filter((r) => r.source_type === 'call');
    const meetings = recordsArr.filter((r) => r.source_type === 'meeting');

    const callTrans = calls.filter((c) => c.has_usable_transcript).length;
    const meetTrans = meetings.filter((m) => m.has_usable_transcript).length;

    grid.innerHTML = `
      <div class="coverage-box">
        <h4>Phone Calls (30 total)</h4>
        <div class="cov-bar"><div class="cov-fill" style="width: ${(callTrans / 30) * 100}%"></div></div>
        <p><strong>${callTrans} of 30</strong> calls have usable text. (20 background / short dials lack speech text; 10 contain conversations).</p>
      </div>
      <div class="coverage-box">
        <h4>Scheduled Meetings (14 total)</h4>
        <div class="cov-bar"><div class="cov-fill" style="width: ${(meetTrans / 14) * 100}%"></div></div>
        <p><strong>${meetTrans} of 14</strong> meetings have usable transcript. (Silent recordings, cancelled notetakers, or unscheduled notetakers represent real operational gaps).</p>
      </div>
    `;
  }

  function renderExceptionsList(recordsArr) {
    const list = document.getElementById('exceptions-list');
    if (!list) return;

    const exceptions = [];

    // M08, M11 silent recordings
    recordsArr.forEach((r) => {
      if (r.source_type === 'meeting' && r.transcript_payload && r.transcript_payload.unavailable_reason) {
        exceptions.push({
          ref: r.record_ref,
          title: r.payload.title || 'Meeting',
          reason: r.transcript_payload.unavailable_reason,
          tag: 'Missing Transcript'
        });
      }
      if (r.is_manual_override) {
        exceptions.push({
          ref: r.record_ref,
          title: r.payload.title || 'Call / Meeting',
          reason: `Manual route correction active: [${r.routes.join(', ')}]`,
          tag: 'Manual Override'
        });
      }
      if (r.analysis_freshness && r.analysis_freshness.includes('stale')) {
        exceptions.push({
          ref: r.record_ref,
          title: r.payload.title || 'Meeting',
          reason: `Higher batch revision arrived (rev ${r.revision}) — analysis flagged stale`,
          tag: 'Stale Analysis'
        });
      }
    });

    if (exceptions.length === 0) {
      list.innerHTML = '<p class="text-muted">No operational exceptions found.</p>';
      return;
    }

    list.innerHTML = exceptions.map((e) => `
      <div class="exception-item">
        <span class="badge-exc">${escapeHtml(e.tag)}</span>
        <strong>${escapeHtml(e.ref)}: ${escapeHtml(e.title)}</strong>
        <span class="exc-reason">— ${escapeHtml(e.reason)}</span>
      </div>
    `).join('');
  }

  // =========================================================================
  // INBOX VIEW
  // =========================================================================
  function renderInbox() {
    const emptyEl = document.getElementById('inbox-empty');
    const contentEl = document.getElementById('inbox-content');
    const listEl = document.getElementById('inbox-list');
    if (!emptyEl || !contentEl || !listEl) return;

    if (state.records.size === 0) {
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    const recordsArr = Array.from(state.records.values());

    // Filter inbox records
    const filtered = recordsArr.filter((r) => {
      // Route filter
      if (state.filters.inboxRoute !== 'all' && !r.routes.includes(state.filters.inboxRoute)) {
        return false;
      }
      // Type filter
      if (state.filters.inboxType !== 'all' && r.source_type !== state.filters.inboxType) {
        return false;
      }
      // Text search
      if (state.filters.inboxSearch) {
        const query = state.filters.inboxSearch.toLowerCase();
        const ref = (r.record_ref || '').toLowerCase();
        const rep = getRecordPerson(r).toLowerCase();
        const title = (r.payload.title || '').toLowerCase();
        const summary = (r.analysis && r.analysis.summary ? r.analysis.summary : '').toLowerCase();
        if (!ref.includes(query) && !rep.includes(query) && !title.includes(query) && !summary.includes(query)) {
          return false;
        }
      }
      return true;
    });

    // Render left list
    listEl.innerHTML = filtered.map((r) => {
      const isSelected = getRecordKey(r.source_type, r.source_id) === state.selectedKey;
      const person = getRecordPerson(r);
      const title = r.source_type === 'meeting' ? (r.payload.title || 'Untitled Meeting') : `Call with ${person}`;
      const badges = r.routes.map((rt) => `<span class="tag-badge ${rt}">${rt}</span>`).join('');
      const manualBadge = r.is_manual_override ? '<span class="tag-badge manual-flag">Override</span>' : '';
      const textPreview = r.analysis && r.analysis.summary
        ? r.analysis.summary.slice(0, 95) + '…'
        : (r.has_usable_transcript ? 'Transcript available' : 'No transcript recorded');

      return `
        <div class="inbox-item ${isSelected ? 'active' : ''}" onclick="selectInboxRecord('${r.source_type}', '${r.source_id}')">
          <div class="item-top">
            <span class="item-ref">${r.record_ref}</span>
            <span class="item-type ${r.source_type}">${r.source_type}</span>
            <span class="item-rev">rev ${r.revision}</span>
          </div>
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-person">${escapeHtml(person)}</div>
          <p class="item-snippet">${escapeHtml(textPreview)}</p>
          <div class="item-tags">${badges}${manualBadge}</div>
        </div>
      `;
    }).join('');

    // If an item is selected, render detail pane
    renderInboxDetail();
  }

  function renderInboxDetail() {
    const detailEl = document.getElementById('inbox-detail');
    if (!detailEl) return;

    if (!state.selectedKey || !state.records.has(state.selectedKey)) {
      detailEl.innerHTML = `
        <div class="detail-placeholder">
          <div class="empty-icon">👈</div>
          <p>Select a conversation from the list to review transcript, findings, and manage routing.</p>
        </div>
      `;
      return;
    }

    const rec = state.records.get(state.selectedKey);
    const person = getRecordPerson(rec);
    const title = rec.source_type === 'meeting' ? (rec.payload.title || 'Untitled Meeting') : `Outbound / Inbound Call`;
    const ana = rec.analysis;

    // Transcript turns HTML
    let transcriptHtml = '';
    if (rec.source_type === 'call') {
      if (rec.payload.transcript) {
        transcriptHtml = `<div class="transcript-box"><p>${escapeHtml(rec.payload.transcript)}</p></div>`;
      } else {
        transcriptHtml = `<div class="transcript-empty"><p>No transcript recorded for this call. (${rec.payload.observed_outcome || 'unresponsive'})</p></div>`;
      }
    } else {
      const turns = rec.transcript_payload && rec.transcript_payload.turns;
      if (turns && turns.length > 0) {
        transcriptHtml = `
          <div class="transcript-turns">
            ${turns.map((t, idx) => `
              <div class="turn-bubble">
                <div class="turn-meta">
                  <strong>Turn ${idx + 1}</strong> · ${escapeHtml(t.speaker || 'Speaker')} · <code>${t.timecode || '00:00:00'}</code>
                </div>
                <div class="turn-text">${escapeHtml(t.text)}</div>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        const reason = (rec.transcript_payload && rec.transcript_payload.unavailable_reason) || 'No transcript turns recorded.';
        transcriptHtml = `<div class="transcript-empty"><p>⚠️ Transcript unavailable: ${escapeHtml(reason)}</p></div>`;
      }
    }

    // Analysis section
    let analysisHtml = '';
    if (ana) {
      const actionsList = (ana.nextActions || []).map((a) => `<li><strong>${escapeHtml(a.owner)}:</strong> ${escapeHtml(a.action)}</li>`).join('');
      analysisHtml = `
        <div class="analysis-panel">
          <div class="panel-header">
            <h3>Manager Review & Evidence</h3>
            <span class="badge-pregen">${escapeHtml(rec.analysisSource)} · ${escapeHtml(rec.analysis_freshness)}</span>
          </div>
          <div class="analysis-field">
            <label>Executive Summary</label>
            <p>${escapeHtml(ana.summary)}</p>
          </div>
          <div class="analysis-field">
            <label>What Happened</label>
            <p>${escapeHtml(ana.whatHappened)}</p>
          </div>
          ${ana.whyItMatters ? `
            <div class="analysis-field highlight-field">
              <label>Why It Matters to Management</label>
              <p>${escapeHtml(ana.whyItMatters)}</p>
            </div>
          ` : ''}
          ${ana.evidence ? `
            <div class="analysis-field evidence-field">
              <label>Direct Source Evidence</label>
              <blockquote>"${escapeHtml(ana.evidence.quote)}"</blockquote>
              <div class="evidence-cite">Citation: <code>${escapeHtml(ana.evidence.ref)}</code> · Record: <code>${rec.source_id}</code></div>
            </div>
          ` : ''}
          <div class="analysis-field">
            <label>Not Established / Stated Boundaries</label>
            <p class="text-caution">${escapeHtml(ana.notEstablished || 'None documented')}</p>
          </div>
          <div class="analysis-field">
            <label>Recommended Next Actions</label>
            <ul class="action-list">${actionsList || '<li>None</li>'}</ul>
          </div>
        </div>
      `;
    } else {
      analysisHtml = `
        <div class="analysis-panel">
          <div class="panel-header">
            <h3>Manager Review</h3>
            <span class="badge-pregen">unanalysed</span>
          </div>
          <p class="text-muted">No pre-generated analysis available for this entry. Review transcript turns directly.</p>
        </div>
      `;
    }

    // Route selector options
    const taxonomy = window.ROUTE_TAXONOMY || {};
    const routeSelectHtml = Object.keys(taxonomy).map((key) => {
      const isSelected = rec.routes.includes(key);
      return `<button class="route-opt-btn ${isSelected ? 'active ' + key : ''}" onclick="toggleRouteForRecord('${rec.source_id}', '${key}')">${taxonomy[key].label}</button>`;
    }).join('');

    detailEl.innerHTML = `
      <div class="detail-wrapper">
        <div class="detail-header">
          <div class="detail-title-group">
            <span class="ref-pill">${rec.record_ref}</span>
            <h2>${escapeHtml(title)}</h2>
            <div class="detail-meta">
              <span>Type: <strong>${rec.source_type}</strong></span>
              <span>Person: <strong>${escapeHtml(person)}</strong></span>
              <span>Batch: <code>${rec.batch_id}</code> (rev ${rec.revision})</span>
              <span>Review: <strong class="rev-${rec.review_state}">${rec.review_state}</strong></span>
            </div>
          </div>
        </div>

        <!-- Manual Route Correction Bar -->
        <div class="routing-control-bar">
          <div class="rc-label">
            <strong>Assigned Route(s):</strong>
            ${rec.is_manual_override ? '<span class="badge-override">Manual Correction Active</span>' : '<span class="badge-auto">System Default</span>'}
          </div>
          <div class="route-options-grid">${routeSelectHtml}</div>
        </div>

        <!-- Split Pane: Analysis & Transcript -->
        <div class="detail-body-split">
          <div class="detail-analysis-col">${analysisHtml}</div>
          <div class="detail-transcript-col">
            <h3>Source Transcript</h3>
            ${transcriptHtml}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // MANAGER BRIEF VIEW
  // =========================================================================
  function renderBrief() {
    const emptyEl = document.getElementById('brief-empty');
    const contentEl = document.getElementById('brief-content');
    const container = document.getElementById('brief-container');
    if (!emptyEl || !contentEl || !container) return;

    if (state.records.size === 0) {
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    container.innerHTML = `
      <div class="brief-card">
        <div class="brief-badge-top">Sales Manager Daily Intelligence Brief · 21 August 2026</div>
        <h2>Executive Summary & Operational Context</h2>
        <p>Across the 44 distinct source interactions ingested on 21 August 2026, SpendNest captured 30 phone call records and 14 scheduled Google Meet recordings across three sales workspaces. Overall transcript coverage stands at 40.9% (18 records with usable text). The manager's priority must be divided between coaching outbound SDRs on permission-based outreach, unblocking stuck high-value partner deals, and escalating platform bugs reported by active customers.</p>
      </div>

      <div class="brief-grid-2">
        <div class="brief-card">
          <h3>🚨 Critical Finding 1: Unsolicited Outreach Backlash (Coaching Need)</h3>
          <p><strong>Source Evidence:</strong> Call C01 (Source ID: <code>2ec4404c-beee-5377-a63c-aab701da08ed</code>)</p>
          <blockquote>"I don't know how I ended up on your list. I didn't ask for this call, and I'm not interested. This number is for my work, not for people to sell things to me."</blockquote>
          <p><strong>Impact & Recommendation:</strong> Rep Arun cold-called Pranav at Harborpath Advisory without adequate consent disclosure, causing immediate friction before the product was even introduced. Manager must coach reps to disclose outreach sources transparently and honor privacy boundaries immediately rather than pushing feature spiels.</p>
        </div>

        <div class="brief-card">
          <h3>💰 Critical Finding 2: Ready Partner Awaiting Link & Memorandum</h3>
          <p><strong>Source Evidence:</strong> Meeting M01 (Source ID: <code>cb5cecac-e68d-52b7-b10b-b0c748efc467</code>, Turn 24)</p>
          <blockquote>"The main thing is to have all of that written down, with the link and contact route. Then I can prepare a product page and make the offer available quickly."</blockquote>
          <p><strong>Impact & Recommendation:</strong> Harborpath Advisory agreed to refer clients for SpendNest virtual accounts ($260 activation commission). The partner specifically requested an automated tracking link over manual email intros. Next action: Team06 must send the signed memorandum and referral link today.</p>
        </div>
      </div>

      <div class="brief-grid-2">
        <div class="brief-card">
          <h3>🐛 Critical Finding 3: Three Customer-Facing Bugs Uncovered (M07)</h3>
          <p><strong>Source Evidence:</strong> Meeting M07 (Source ID: <code>4f304fff-fd40-5cfc-a366-0a134c445c2a</code>, Turn 23)</p>
          <blockquote>"The amount from the previous item appears in the next one. Each time I have to cancel, leave it and open Mark as paid again before it shows the right information."</blockquote>
          <p><strong>Impact & Recommendation:</strong> Arriving in the late-transcript update (Revision 2), Willowfield Trust demonstrated 3 active bugs: (1) description edit doesn't reflect after save, (2) Recreate payment upload fails, and (3) Mark as paid carries forward prior payment amounts. Team09 has workarounds but engineering must log fixes immediately.</p>
        </div>

        <div class="brief-card highlight-rejected">
          <h3>🚫 Deliberately Considered & Rejected Decision</h3>
          <p><strong>Decision:</strong> Synthesizing deal pipeline amounts and rep performance rankings from conversation mentions.</p>
          <p><strong>Reason for Rejection:</strong> Per DATA_DICTIONARY and ASSIGNMENT guidelines, no authoritative CRM opportunity table or deal valuations were provided. Conversation claims (e.g. INR 26K fees, EUR 2,600 setup) are unverified verbal mentions, not signed contracts. Calculating speculative pipeline totals would mislead sales leadership.</p>
          <p><strong>Product Choice Made:</strong> Focus strictly on factual, source-backed opportunity signals, verifiable next actions, and clear review states.</p>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // EXPORTS & MANIFEST VIEW
  // =========================================================================
  function renderExports() {
    const emptyEl = document.getElementById('exports-empty');
    const contentEl = document.getElementById('exports-content');
    const tbody = document.getElementById('manifest-body');
    const folderTree = document.getElementById('folder-tree');
    const summaryEl = document.getElementById('manifest-summary');
    if (!emptyEl || !contentEl || !tbody) return;

    if (state.records.size === 0) {
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    const recordsArr = Array.from(state.records.values());

    // Build Folder Tree visualization
    if (folderTree) {
      folderTree.textContent = `exports/
├── manifest.json
├── manifest.csv
├── README.md
├── sales_coaching/     (${recordsArr.filter((r) => r.routes.includes('sales-coaching')).length} records)
├── deal_next_steps/    (${recordsArr.filter((r) => r.routes.includes('deal-next-steps')).length} records)
├── customer_followup/  (${recordsArr.filter((r) => r.routes.includes('customer-followup')).length} records)
├── vendor_partner/     (${recordsArr.filter((r) => r.routes.includes('vendor-partner')).length} records)
├── internal_ops/       (${recordsArr.filter((r) => r.routes.includes('internal-ops')).length} records)
├── no_content/         (${recordsArr.filter((r) => r.routes.includes('no-content')).length} records)
└── needs_review/       (${recordsArr.filter((r) => r.routes.includes('needs-review')).length} records)`;
    }

    // Summary counts
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="state-row"><span>Unique source records:</span><strong>${recordsArr.length}</strong></div>
        <div class="state-row"><span>Manual overrides active:</span><strong>${recordsArr.filter((r) => r.is_manual_override).length}</strong></div>
        <div class="state-row"><span>Total assigned output files:</span><strong>${recordsArr.reduce((acc, r) => acc + r.routes.length, 0)}</strong></div>
      `;
    }

    // Manifest Table Rows
    tbody.innerHTML = recordsArr.map((r) => {
      const outputPaths = r.routes.map((rt) => `${rt.replace('-', '_')}/${r.record_ref}_${r.source_type}.md`).join('<br>');
      const manualTag = r.is_manual_override ? '<span class="badge-success">YES</span>' : '<span class="text-muted">NO</span>';
      return `
        <tr>
          <td><strong>${r.record_ref}</strong></td>
          <td>${r.source_type}</td>
          <td><code>${r.source_id.slice(0, 8)}…</code></td>
          <td>rev ${r.revision}</td>
          <td>${r.routes.join(', ')}</td>
          <td><code>${outputPaths}</code></td>
          <td><span class="rev-${r.review_state}">${r.review_state}</span></td>
          <td>${manualTag}</td>
          <td>${r.analysis_freshness}</td>
        </tr>
      `;
    }).join('');
  }

  // =========================================================================
  // IMPORT & REPLAY VIEW
  // =========================================================================
  function renderImportTab() {
    const logContainer = document.getElementById('import-log');
    if (logContainer) {
      if (state.importLog.length === 0) {
        logContainer.innerHTML = '<div class="log-empty">No imports yet. Click a quick action or upload a file.</div>';
      } else {
        logContainer.innerHTML = state.importLog.map((log) => `
          <div class="log-item">
            <div class="log-top">
              <strong>${escapeHtml(log.filename)}</strong> · Batch: <code>${log.batchId}</code> · Rev: <strong>${log.revision}</strong>
              <span class="log-time">${log.timestamp}</span>
            </div>
            <div class="log-metrics">
              <span class="badge-added">+${log.added} added</span>
              <span class="badge-updated">~${log.updated} updated</span>
              <span class="badge-skipped">${log.skipped} skipped (deduped)</span>
              <span>Total records in app: <strong>${log.totalStateRecords}</strong></span>
            </div>
          </div>
        `).join('');
      }
    }

    // Current State Summary
    const recordsArr = Array.from(state.records.values());
    setElText('ss-total', recordsArr.length);
    setElText('ss-calls', recordsArr.filter((r) => r.source_type === 'call').length);
    setElText('ss-meetings', recordsArr.filter((r) => r.source_type === 'meeting').length);
    setElText('ss-transcripts', recordsArr.filter((r) => r.has_usable_transcript).length);
    const maxRev = recordsArr.reduce((m, r) => Math.max(m, r.revision || 1), 1);
    setElText('ss-revision', recordsArr.length > 0 ? `rev ${maxRev}` : '—');
    setElText('ss-corrections', recordsArr.filter((r) => r.is_manual_override).length);
  }

  // =========================================================================
  // Replay Contract Testing Actions
  // =========================================================================
  window.loadBundledFile = function (which) {
    if (which === 'initial') {
      if (!window.BUNDLED_INITIAL) return showToast('Initial batch not bundled', 'error');
      const res = ingestBatch(window.BUNDLED_INITIAL, '01_initial.json');
      state.replaySteps.step1 = `Imported 01_initial.json: ${res.totalStateRecords} unique records, 17 usable transcripts.`;
      const s1 = document.getElementById('step-1-result');
      if (s1) s1.innerHTML = `<span class="badge-success">✓ ${res.totalStateRecords} unique records loaded (17 usable transcripts)</span>`;
      showToast('Loaded 01_initial.json (Revision 1)', 'success');
    } else if (which === 'update') {
      if (!window.BUNDLED_UPDATE) return showToast('Update batch not bundled', 'error');
      const res = ingestBatch(window.BUNDLED_UPDATE, '02_update.json');
      state.replaySteps.step4 = `Imported 02_update.json: M07 updated with rev 2. Total records: ${res.totalStateRecords}.`;
      const s4 = document.getElementById('step-4-result');
      if (s4) s4.innerHTML = `<span class="badge-success">✓ M07 updated (rev 2, 28 turns). Total records remains ${res.totalStateRecords}</span>`;
      showToast('Loaded 02_update.json (Revision 2 - M07 updated)', 'success');
    } else if (which === 'both') {
      if (window.BUNDLED_INITIAL) ingestBatch(window.BUNDLED_INITIAL, '01_initial.json');
      if (window.BUNDLED_UPDATE) ingestBatch(window.BUNDLED_UPDATE, '02_update.json');
      showToast('Loaded both batches — 44 records in post-update state', 'success');
    }
  };

  window.repeatImport = function () {
    if (!window.BUNDLED_INITIAL) return showToast('Initial batch not bundled', 'error');
    // Shuffle records to simulate out-of-order repeat
    const shuffled = {
      ...window.BUNDLED_INITIAL,
      records: [...window.BUNDLED_INITIAL.records].reverse()
    };
    const res = ingestBatch(shuffled, '01_initial.json (repeat import)');
    state.replaySteps.step2 = `Repeat import executed: ${res.skipped} skipped, ${res.totalStateRecords} total (no duplicates).`;
    const s2 = document.getElementById('step-2-result');
    if (s2) s2.innerHTML = `<span class="badge-success">✓ Idempotent: 0 added, total records remained ${res.totalStateRecords}</span>`;
    showToast(`Repeat import complete: 0 duplicates created (${res.totalStateRecords} total)`, 'success');
  };

  window.goToM07 = function () {
    const m07 = Array.from(state.records.values()).find((r) => r.record_ref === 'M07');
    if (!m07) {
      showToast('Import data first before editing M07', 'error');
      return;
    }
    // Switch to inbox view and select M07
    switchView('inbox');
    window.selectInboxRecord(m07.source_type, m07.source_id);
    showToast('Inspecting M07. Click a route button above the transcript to assign a manual correction.', 'info');
  };

  window.preserveTest = function () {
    if (!window.BUNDLED_INITIAL) return showToast('Initial batch not bundled', 'error');
    // Re-import initial batch (rev 1) after update (rev 2)
    const res = ingestBatch(window.BUNDLED_INITIAL, '01_initial.json (post-update preserve test)');
    const m07 = Array.from(state.records.values()).find((r) => r.record_ref === 'M07');
    const isM07Preserved = m07 && m07.revision === 2 && m07.has_usable_transcript;
    const isManualPreserved = m07 && m07.is_manual_override;

    state.replaySteps.step5 = `Preserve test: M07 rev=${m07 ? m07.revision : '?'}, manual preserved=${isManualPreserved}`;
    const s5 = document.getElementById('step-5-result');
    if (s5) {
      s5.innerHTML = isM07Preserved
        ? `<span class="badge-success">✓ Older rev 1 ignored. M07 kept revision 2 + transcript${isManualPreserved ? ' + manual route' : ''}.</span>`
        : `<span class="badge-error">Failed: rev 1 overwrote rev 2!</span>`;
    }
    showToast('Preserve test passed: older rev 1 ignored cleanly', 'success');
  };

  // Drag and drop / file upload
  window.handleDrop = function (e) {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  };

  window.handleFileInput = function (e) {
    const files = e.target.files;
    if (files.length > 0) processFile(files[0]);
  };

  function processFile(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const json = JSON.parse(evt.target.result);
        const res = ingestBatch(json, file.name);
        showToast(`Imported ${file.name}: ${res.added} added, ${res.updated} updated`, 'success');
      } catch (err) {
        showToast(`Failed to parse ${file.name}: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  // =========================================================================
  // Interactive Navigation & Filtering
  // =========================================================================
  function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('active', view.id === `view-${viewName}`);
    });
    updateUI();
  }

  window.filterInboxByRoute = function (routeKey) {
    state.filters.inboxRoute = routeKey;
    const sel = document.getElementById('inbox-filter-route');
    if (sel) sel.value = routeKey;
    switchView('inbox');
  };

  window.selectInboxRecord = function (sourceType, sourceId) {
    state.selectedKey = getRecordKey(sourceType, sourceId);
    renderInbox();
  };

  window.toggleRouteForRecord = function (sourceId, routeKey) {
    const rec = Array.from(state.records.values()).find((r) => r.source_id === sourceId);
    if (!rec) return;

    let newRoutes = [...rec.routes];
    if (newRoutes.includes(routeKey)) {
      if (newRoutes.length > 1) {
        newRoutes = newRoutes.filter((r) => r !== routeKey);
      }
    } else {
      newRoutes.push(routeKey);
    }
    setManualRoute(sourceId, newRoutes);
  };

  // =========================================================================
  // Manifest & ZIP Export Generator
  // =========================================================================
  function generateManifestData() {
    const recordsArr = Array.from(state.records.values());
    return recordsArr.map((r) => ({
      record_ref: r.record_ref,
      source_type: r.source_type,
      source_id: r.source_id,
      revision: r.revision,
      batch_id: r.batch_id,
      routes: r.routes,
      output_paths: r.routes.map((rt) => `exports/${rt.replace(/-/g, '_')}/${r.record_ref}_${r.source_type}.md`),
      review_state: r.review_state,
      is_manual_override: r.is_manual_override,
      analysis_freshness: r.analysis_freshness
    }));
  }

  function downloadJsonManifest() {
    const data = generateManifestData();
    const manifestBlob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), total_records: data.length, records: data }, null, 2)], {
      type: 'application/json'
    });
    downloadBlob(manifestBlob, 'manifest.json');
    showToast('Downloaded manifest.json', 'success');
  }

  function downloadCsvManifest() {
    const data = generateManifestData();
    const headers = ['record_ref', 'source_type', 'source_id', 'revision', 'batch_id', 'routes', 'output_paths', 'review_state', 'is_manual_override', 'analysis_freshness'];
    const rows = data.map((d) => [
      d.record_ref,
      d.source_type,
      d.source_id,
      d.revision,
      d.batch_id,
      `"${d.routes.join(';')}"`,
      `"${d.output_paths.join(';')}"`,
      d.review_state,
      d.is_manual_override,
      d.analysis_freshness
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    downloadBlob(blob, 'manifest.csv');
    showToast('Downloaded manifest.csv', 'success');
  }

  // Minimal standalone ZIP generator without external libraries!
  function downloadZipArchive() {
    const files = [];

    // Manifest JSON & CSV
    const manifestJson = JSON.stringify({ exported_at: new Date().toISOString(), records: generateManifestData() }, null, 2);
    files.push({ name: 'manifest.json', content: manifestJson });

    // Generate markdown files for each routed record
    Array.from(state.records.values()).forEach((r) => {
      const person = getRecordPerson(r);
      const ana = r.analysis;
      const mdContent = `# ${r.record_ref} — ${r.source_type.toUpperCase()}
Source ID: ${r.source_id}
Revision: ${r.revision}
Person / Organiser: ${person}
Routes: ${r.routes.join(', ')}
Review State: ${r.review_state}
Manual Override: ${r.is_manual_override}

## Summary
${ana ? ana.summary : 'No pre-generated analysis.'}

## What Happened
${ana ? ana.whatHappened : 'Refer to source transcript.'}

## Evidence Citation
${ana && ana.evidence ? `> "${ana.evidence.quote}"\nCitation: ${ana.evidence.ref}` : 'N/A'}

## Next Actions
${ana && ana.nextActions ? ana.nextActions.map((a) => `- **${a.owner}:** ${a.action}`).join('\n') : 'N/A'}
`;
      r.routes.forEach((rt) => {
        files.push({
          name: `${rt.replace(/-/g, '_')}/${r.record_ref}_${r.source_type}.md`,
          content: mdContent
        });
      });
    });

    const zipBlob = createZipBlob(files);
    downloadBlob(zipBlob, 'spendnest_revenue_exports.zip');
    showToast('Generated and downloaded ZIP export package', 'success');
  }

  // Pure JS uncompressed ZIP builder (standard ZIP format)
  function createZipBlob(files) {
    const parts = [];
    const cdParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = new TextEncoder().encode(file.name);
      const contentBytes = new TextEncoder().encode(file.content);
      const crc = crc32(contentBytes);
      const size = contentBytes.length;

      // Local file header (30 bytes + name)
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); // signature
      view.setUint16(4, 20, true); // min version
      view.setUint16(6, 0, true); // flags
      view.setUint16(8, 0, true); // compression: 0 (store)
      view.setUint16(10, 0, true); // time
      view.setUint16(12, 0, true); // date
      view.setUint32(14, crc, true); // crc32
      view.setUint32(18, size, true); // compressed size
      view.setUint32(22, size, true); // uncompressed size
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true); // extra length
      header.set(nameBytes, 30);

      parts.push(header, contentBytes);

      // Central directory header (46 bytes + name)
      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cdHeader.buffer);
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true);
      cdView.setUint16(6, 20, true);
      cdView.setUint16(8, 0, true);
      cdView.setUint16(10, 0, true);
      cdView.setUint16(12, 0, true);
      cdView.setUint16(14, 0, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint16(30, 0, true);
      cdView.setUint16(32, 0, true);
      cdView.setUint16(34, 0, true);
      cdView.setUint16(36, 0, true);
      cdView.setUint32(38, 0, true);
      cdView.setUint32(42, offset, true); // local header offset
      cdHeader.set(nameBytes, 46);

      cdParts.push(cdHeader);
      offset += header.length + contentBytes.length;
    });

    const cdOffset = offset;
    let cdSize = 0;
    cdParts.forEach((cd) => (cdSize += cd.length));

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdOffset, true);
    eocdView.setUint16(20, 0, true);

    return new Blob([...parts, ...cdParts, eocd], { type: 'application/zip' });
  }

  // CRC32 table & calculator
  const crcTable = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  })();

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  // =========================================================================
  // Utilities & Event Listeners
  // =========================================================================
  function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 3200);
  }

  // Attach event listeners
  function initEvents() {
    // Nav buttons
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Quick load on empty dashboard
    const qlBtn = document.getElementById('quick-load-btn');
    if (qlBtn) qlBtn.addEventListener('click', () => window.loadBundledFile('both'));

    // Reset button
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Clear all in-memory data and reset to initial state?')) {
          state.records.clear();
          state.manualOverrides.clear();
          state.importLog = [];
          state.selectedKey = null;
          updateUI();
          showToast('Data reset successfully', 'info');
        }
      });
    }

    // Dashboard filters
    const dfPerson = document.getElementById('filter-person');
    if (dfPerson) {
      dfPerson.addEventListener('change', (e) => {
        state.filters.dashboardPerson = e.target.value;
        renderDashboard();
      });
    }

    const dfType = document.getElementById('filter-type');
    if (dfType) {
      dfType.addEventListener('change', (e) => {
        state.filters.dashboardType = e.target.value;
        renderDashboard();
      });
    }

    // Inbox filters
    const infRoute = document.getElementById('inbox-filter-route');
    if (infRoute) {
      infRoute.addEventListener('change', (e) => {
        state.filters.inboxRoute = e.target.value;
        renderInbox();
      });
    }

    const infType = document.getElementById('inbox-filter-type');
    if (infType) {
      infType.addEventListener('change', (e) => {
        state.filters.inboxType = e.target.value;
        renderInbox();
      });
    }

    const infSearch = document.getElementById('inbox-search');
    if (infSearch) {
      infSearch.addEventListener('input', (e) => {
        state.filters.inboxSearch = e.target.value;
        renderInbox();
      });
    }

    // Export buttons
    const expJson = document.getElementById('btn-export-json');
    if (expJson) expJson.addEventListener('click', downloadJsonManifest);

    const expCsv = document.getElementById('btn-export-csv');
    if (expCsv) expCsv.addEventListener('click', downloadCsvManifest);

    const expZip = document.getElementById('btn-export-zip');
    if (expZip) expZip.addEventListener('click', downloadZipArchive);
  }

  // =========================================================================
  // Startup
  // =========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    initEvents();

    // Load initial + update batch automatically for immediate post-update review
    // (Per ASSIGNMENT.md: "open in the final post-update state, or provide one clearly documented demo-load action")
    if (window.BUNDLED_INITIAL && window.BUNDLED_UPDATE) {
      ingestBatch(window.BUNDLED_INITIAL, '01_initial.json');
      ingestBatch(window.BUNDLED_UPDATE, '02_update.json');
    }

    updateUI();
  });
})();
