const fs = require('fs');
const path = require('path');
const { readZipEntry, parseSharedStrings, parseSheetRows } = require('../services/xlsx-lite');

const buf = fs.readFileSync(path.join(__dirname, 'boj-sample.xlsx'));
const shared = parseSharedStrings(readZipEntry(buf, 'xl/sharedStrings.xml'));
const rows = parseSheetRows(readZipEntry(buf, 'xl/worksheets/sheet1.xml'), shared);
console.log(shared);
console.log(rows);
