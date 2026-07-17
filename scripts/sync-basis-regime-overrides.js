/**
 * Build basis-regime-overrides.csv from ag-basis-label-review.csv (skip_oi_proxy + user_confirm=yes)
 *
 * Usage: FANCHENG_DATA_DRIVE=E node scripts/sync-basis-regime-overrides.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { getOverridesPath, loadOverrides } = require('../services/basis-regime-overrides');

const dryRun = process.argv.includes('--dry-run');

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function main() {
  const reviewPath = path.join(getDataDir(), 'history', 'labels', 'ag-basis-label-review.csv');
  if (!fs.existsSync(reviewPath)) {
    console.error('Missing', reviewPath);
    process.exit(1);
  }

  const lines = fs.readFileSync(reviewPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = {
    sessionDate: header.indexOf('sessionDate'),
    suggestedRegime: header.indexOf('suggestedRegime'),
    user_confirm: header.indexOf('user_confirm'),
    notes: header.indexOf('notes'),
  };

  const outPath = getOverridesPath();
  const existing = fs.existsSync(outPath)
    ? fs.readFileSync(outPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(1)
    : [];
  const existingKeys = new Set(
    existing.map((line) => {
      const [d, id] = line.split(',');
      return `${d}|${id}`;
    }),
  );

  const newLines = [];
  const now = new Date().toISOString();
  let fromReview = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const sessionDate = String(cols[idx.sessionDate] || '').slice(0, 10);
    const suggested = String(cols[idx.suggestedRegime] || '').trim();
    const confirm = String(cols[idx.user_confirm] || '').trim().toLowerCase();
    const notes = String(cols[idx.notes] || '').replace(/,/g, ';').slice(0, 200);
    if (suggested !== 'skip_oi_proxy') continue;
    if (confirm && confirm !== 'yes') continue;
    const key = `${sessionDate}|ag`;
    if (existingKeys.has(key)) continue;
    fromReview += 1;
    newLines.push([sessionDate, 'ag', 'skip_oi_proxy', notes, confirm || 'yes', now].join(','));
    existingKeys.add(key);
  }

  console.log(JSON.stringify({
    reviewPath,
    outPath,
    newRows: newLines.length,
    dryRun,
    totalSkipOiProxy: existing.length + newLines.length,
  }, null, 2));

  if (dryRun || !newLines.length) return;

  const headerLine = 'sessionDate,instrumentId,overrideRegime,notes,user_confirm,mergedAt';
  const body = existing.length
    ? fs.readFileSync(outPath, 'utf8').trimEnd() + '\n' + newLines.join('\n') + '\n'
    : `${headerLine}\n${newLines.join('\n')}\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  loadOverrides(true);
  console.log('Wrote', outPath, 'added', fromReview);
}

main();
