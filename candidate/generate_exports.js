const fs = require('fs');
const path = require('path');

// Read input batch files
const batch1Path = path.resolve(__dirname, 'data/01_initial.json');
const batch2Path = path.resolve(__dirname, 'data/02_update.json');

const batch1 = JSON.parse(fs.readFileSync(batch1Path, 'utf8'));
const batch2 = JSON.parse(fs.readFileSync(batch2Path, 'utf8'));

// Build state map following DATA_CONTRACT rules
const recordsMap = new Map();

function ingest(batch) {
  const rev = Number(batch.revision) || 1;
  const bId = batch.batch_id;
  batch.records.forEach(r => {
    const key = r.source_type + ':' + r.source_id;
    const existing = recordsMap.get(key);
    if (!existing) {
      recordsMap.set(key, { ...r, revision: rev, batch_id: bId });
    } else if (rev > existing.revision) {
      recordsMap.set(key, { ...r, revision: rev, batch_id: bId });
    }
  });
}

ingest(batch1);
ingest(batch2);

console.log('Total ingested unique records:', recordsMap.size);

// Read app/data.js to extract PREGENERATED_ANALYSIS
const dataJs = fs.readFileSync(path.resolve(__dirname, 'app/data.js'), 'utf8');
const analysisMatch = dataJs.match(/window\.PREGENERATED_ANALYSIS\s*=\s*(\{[\s\S]*?\n\};)/);
let analysis = {};
if (analysisMatch) {
  try {
    const fn = new Function('return ' + analysisMatch[1].replace(/;\s*$/, ''));
    analysis = fn();
  } catch (e) {
    console.error('Error parsing analysis from data.js:', e);
  }
}

// Create exports directory
const exportDir = path.resolve(__dirname, 'exports');
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

// Ensure route subdirectories
const routes = [
  'sales_coaching',
  'deal_next_steps',
  'customer_followup',
  'vendor_partner',
  'internal_ops',
  'no_content',
  'needs_review'
];

routes.forEach(dir => {
  const p = path.join(exportDir, dir);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
});

function getPerson(rec) {
  if (rec.source_type === 'call') {
    return rec.payload && rec.payload.rep_name ? rec.payload.rep_name : 'Unknown Rep';
  }
  if (rec.source_type === 'meeting') {
    return rec.payload && rec.payload.organizer_email ? rec.payload.organizer_email : 'Unknown Organiser';
  }
  return 'Unknown';
}

function hasUsableTranscript(rec) {
  if (rec.source_type === 'call') {
    return Boolean(rec.payload && rec.payload.transcript && rec.payload.transcript.trim());
  }
  if (rec.source_type === 'meeting') {
    const tp = rec.transcript_payload;
    return Boolean(tp && Array.isArray(tp.turns) && tp.turns.length > 0);
  }
  return false;
}

const manifest = [];

recordsMap.forEach((rec) => {
  const ana = analysis[rec.source_id];
  let assignedRoutes = [];
  const usable = hasUsableTranscript(rec);

  if (ana && ana.route) {
    assignedRoutes = ana.route;
  } else {
    assignedRoutes = usable ? ['needs-review'] : ['no-content'];
  }

  const outputPaths = assignedRoutes.map(rt => 'exports/' + rt.replace(/-/g, '_') + '/' + rec.record_ref + '_' + rec.source_type + '.md');
  const reviewState = assignedRoutes.includes('needs-review') ? 'needs-review' : (assignedRoutes.includes('no-content') ? 'no-content' : 'resolved');
  const person = getPerson(rec);

  manifest.push({
    record_ref: rec.record_ref,
    source_type: rec.source_type,
    source_id: rec.source_id,
    revision: rec.revision,
    batch_id: rec.batch_id,
    person_or_organiser: person,
    has_usable_transcript: usable,
    routes: assignedRoutes,
    output_paths: outputPaths,
    review_state: reviewState,
    is_manual_override: false,
    analysis_freshness: ana ? 'fresh' : 'none'
  });

  // Write markdown content for each route destination
  const mdContent = `# ${rec.record_ref} — ${rec.source_type.toUpperCase()}
- **Source ID:** \`${rec.source_id}\`
- **Revision:** \`${rec.revision}\` (Batch: \`${rec.batch_id}\`)
- **Person / Organiser:** ${person}
- **Assigned Route(s):** ${assignedRoutes.join(', ')}
- **Review State:** ${reviewState}
- **Usable Transcript:** ${usable ? 'Yes' : 'No'}
- **Manual Override:** No

---

## Executive Summary
${ana && ana.summary ? ana.summary : (usable ? 'Transcript recorded, awaiting detailed analysis.' : 'No usable transcript content recorded.')}

## What Happened
${ana && ana.whatHappened ? ana.whatHappened : (usable ? 'Full transcript available in source payload.' : (rec.transcript_payload && rec.transcript_payload.unavailable_reason ? rec.transcript_payload.unavailable_reason : 'No conversation speech captured.'))}

${ana && ana.whyItMatters ? `## Why It Matters\n${ana.whyItMatters}\n` : ''}

## Evidence Citation
${ana && ana.evidence ? `> "${ana.evidence.quote}"\n\n**Citation:** ${ana.evidence.ref}` : (usable ? 'See full transcript in source record.' : 'N/A (no transcript available)')}

${ana && ana.notEstablished ? `## What Evidence Does Not Establish\n${ana.notEstablished}\n` : ''}

## Recommended Next Actions
${ana && ana.nextActions && ana.nextActions.length > 0 ? ana.nextActions.map(a => `- **${a.owner}:** ${a.action}`).join('\n') : '- No specific next steps established.'}
`;

  assignedRoutes.forEach(rt => {
    const dirName = rt.replace(/-/g, '_');
    const outFilePath = path.join(exportDir, dirName, rec.record_ref + '_' + rec.source_type + '.md');
    fs.writeFileSync(outFilePath, mdContent, 'utf8');
  });
});

// Write manifest.json
const manifestJsonContent = {
  exported_at: new Date().toISOString(),
  data_contract_version: "1.0",
  workspace: "SpendNest Sales Manager Workspace",
  total_records: manifest.length,
  records: manifest
};

fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify(manifestJsonContent, null, 2), 'utf8');

// Write manifest.csv
const csvHeader = [
  'record_ref',
  'source_type',
  'source_id',
  'revision',
  'batch_id',
  'person_or_organiser',
  'has_usable_transcript',
  'routes',
  'output_paths',
  'review_state',
  'is_manual_override',
  'analysis_freshness'
];

const csvRows = manifest.map(m => [
  m.record_ref,
  m.source_type,
  m.source_id,
  m.revision,
  m.batch_id,
  `"${m.person_or_organiser}"`,
  m.has_usable_transcript,
  `"${m.routes.join(';')}"`,
  `"${m.output_paths.join(';')}"`,
  m.review_state,
  m.is_manual_override,
  m.analysis_freshness
]);

fs.writeFileSync(
  path.join(exportDir, 'manifest.csv'),
  [csvHeader.join(','), ...csvRows.map(r => r.join(','))].join('\n'),
  'utf8'
);

console.log(`Successfully generated ${manifest.length} manifest records and corresponding Markdown files across 7 route folders in candidate/exports!`);
