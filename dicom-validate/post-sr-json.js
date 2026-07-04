// post-sr-json.js
import fs from 'fs';
import process from 'process';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node post-sr-json.js /path/to/file.json');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
let json = JSON.parse(raw);

// normalize patient fields
function normField(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v.Value && Array.isArray(v.Value) && v.Value.length) return v.Value[0];
  return null;
}
json.patientName = normField(json.patientName) ?? json.patientName ?? 'Unknown';
json.patientID = normField(json.patientID) ?? json.patientID ?? null;
json.patientBirthDate = normField(json.patientBirthDate) ?? null;
json.patientSex = normField(json.patientSex) ?? null;

console.log('Posting normalized JSON to server...');

const base = 'https://pacs-api.benhandientu.net:31588';
const url = `${base}/api/structured-report`;

const doPost = async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    console.log('status', res.status);
    const text = await res.text();
    try {
      console.log('body:', JSON.parse(text));
    } catch (e) {
      console.log('body raw:', text);
    }
  } catch (e) {
    console.error('POST failed:', e);
  }
};

doPost();


// NODE_TLS_REJECT_UNAUTHORIZED=0 node post-sr-json.js /Users/lahieuphong/Downloads/SR_1.2.156.14702.1.1000.16.0.20200311113603875_Hello.json