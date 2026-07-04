// validate-local.js
const fs = require('fs');
const dicomParser = require('dicom-parser');

const path = process.argv[2] || 'file.dcm';
if (!fs.existsSync(path)) {
  console.error('File not found:', path);
  process.exit(1);
}
const buf = fs.readFileSync(path);
const uint8 = new Uint8Array(buf);
try {
  const ds = dicomParser.parseDicom(uint8);
  console.log('== PARSE OK ==');
  console.log('Modality (0008,0060):', ds.string('x00080060') || '(missing)');
  console.log('SOP Class UID (0008,0016):', ds.string('x00080016') || '(missing)');
  console.log('Transfer Syntax (0002,0010):', ds.string('x00020010') || '(missing)');
  const marker = buf.slice(128, 132).toString('utf8');
  console.log('DICM marker at 128:', marker === 'DICM' ? 'yes' : `no (${marker})`);
} catch (err) {
  console.error('PARSE ERROR:', err.message);
}



// node validate-local.js /Users/lahieuphong/Downloads/SR_1.2.156.14702.1.1000.16.0.20200311113603875_Hello.json