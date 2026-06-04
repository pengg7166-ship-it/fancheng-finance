const zlib = require('zlib');

function readZipEntry(buffer, targetPath) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compMethod = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
    const dataStart = offset + 30 + fileNameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    if (name.replace(/\\/g, '/') === targetPath.replace(/\\/g, '/')) {
      if (compMethod === 0) return data;
      if (compMethod === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip method ${compMethod} for ${name}`);
    }
    offset = dataStart + compSize;
  }
  return null;
}

function parseSharedStrings(xmlBuf) {
  const xml = xmlBuf.toString('utf8');
  const strings = [];
  const items = xml.match(/<x:si[\s\S]*?<\/x:si>/gi) || [];
  for (const item of items) {
    const parts = [...item.matchAll(/<x:t[^>]*>([\s\S]*?)<\/x:t>/gi)].map((m) =>
      m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    );
    strings.push(parts.join('').trim());
  }
  return strings;
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseSheetRows(xmlBuf, sharedStrings = []) {
  const xml = xmlBuf.toString('utf8');
  const rows = [];
  const rowBlocks = xml.match(/<x:row[\s\S]*?<\/x:row>/gi) || [];
  for (const block of rowBlocks) {
    const rowNum = block.match(/r="(\d+)"/)?.[1];
    const cells = {};
    const cellBlocks = block.match(/<x:c[\s\S]*?(?:\/>|<\/x:c>)/gi) || [];
    for (const cell of cellBlocks) {
      const ref = cell.match(/r="([A-Z]+)(\d+)"/i);
      if (!ref) continue;
      const col = ref[1].toUpperCase();
      const raw = cell.match(/<x:v>([\s\S]*?)<\/x:v>/i)?.[1];
      if (raw == null) continue;
      const isShared = /t="s"/.test(cell);
      cells[col] = isShared ? sharedStrings[parseInt(raw, 10)] || raw : raw;
    }
    if (Object.keys(cells).length) rows.push({ row: Number(rowNum), cells });
  }
  return rows;
}

function findLabelValue(rows, labels) {
  for (const row of rows) {
    for (const [col, val] of Object.entries(row.cells)) {
      const normalized = String(val).toLowerCase();
      if (labels.some((l) => normalized.includes(l.toLowerCase()))) {
        const nextCol = String.fromCharCode(col.charCodeAt(0) + 1);
        const value = row.cells[nextCol];
        if (value != null && !Number.isNaN(parseFloat(value))) {
          return { label: val, value: parseFloat(value), row: row.row };
        }
      }
    }
  }
  return null;
}

module.exports = {
  readZipEntry,
  parseSharedStrings,
  parseSheetRows,
  findLabelValue,
};
