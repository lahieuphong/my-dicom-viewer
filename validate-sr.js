const fs = require('fs');

function validateSR(sr) {
  const issues = [];

  if (!sr || typeof sr !== 'object') {
    issues.push('Not an object');
    return issues;
  }
  if (sr.type !== 'StructuredReport') issues.push('type !== StructuredReport');
  if (!sr.studyUID) issues.push('missing studyUID');
  if (!sr.generatedAt || isNaN(Date.parse(sr.generatedAt))) issues.push('invalid generatedAt');

  if (!Array.isArray(sr.measurements)) {
    issues.push('measurements must be an array');
    return issues;
  }

  sr.measurements.forEach((m, i) => {
    const prefix = `measurement[${i}]`;
    if (!m.annotationUID) issues.push(`${prefix}: missing annotationUID`);
    if (!m.toolName) issues.push(`${prefix}: missing toolName`);
    const coords = m.coordinates;
    if (!coords) {
      issues.push(`${prefix}: missing coordinates`);
    } else {
      const world = coords.world;
      if (!Array.isArray(world) || world.length === 0) {
        issues.push(`${prefix}: coordinates.world empty`);
      } else if (!Array.isArray(world[0]) || world[0].length < 2) {
        issues.push(`${prefix}: coordinates.world points should be [x,y(,z)]`);
      }
    }
    if (!m.referencedSOPInstanceUID && !m.referencedImageId && !m.metadata?.referencedImageId) {
      issues.push(`${prefix}: missing referencedImageId or referencedSOPInstanceUID`);
    }
    const v = m.values || {};
    if (v.unit && v.unit.toLowerCase().includes('px')) {
      issues.push(`${prefix}: unit is in pixels ("px"). Consider converting to mm`);
    }
  });

  return issues;
}

// --- Main execution ---

const inputPath = process.argv[2];
const outputPath = process.argv[3]; // Optional output file path

if (!inputPath) {
  console.error('Usage: node validate-sr.js path/to/file.json [output.txt]');
  process.exit(1);
}

try {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const obj = JSON.parse(raw);
  const issues = validateSR(obj);

  // Prepare result text
  let outputText = '';

  if (issues.length === 0) {
    outputText += '✅ SR passed basic validation\n';
  } else {
    outputText += '❗ Found issues:\n' + issues.map(i => ` - ${i}`).join('\n') + '\n';
  }

  // Thêm phần in ra info về measurements cho sếp tin tưởng
  const meas = obj.measurements || [];
  outputText += `\nTotal measurements: ${meas.length}\n\n`;

  if (meas.length > 0) {
    outputText += 'Measurements detail:\n';
    meas.forEach((m, i) => {
      outputText += `measurement[${i}]:\n`;
      outputText += `  annotationUID: ${m.annotationUID ?? 'N/A'}\n`;
      outputText += `  toolName: ${m.toolName ?? 'N/A'}\n`;
      outputText += `  finding: ${m.finding ?? ''}\n`;
      outputText += `  imageIndex: ${m.imageIndex ?? 'N/A'}\n`;

      outputText += `  values:\n`;
      if (m.values && Object.keys(m.values).length > 0) {
        for (const [key, val] of Object.entries(m.values)) {
          outputText += `    ${key}: ${val}\n`;
        }
      } else {
        outputText += `    (none)\n`;
      }

      outputText += `  coordinates:\n`;
      if (m.coordinates && Object.keys(m.coordinates).length > 0) {
        for (const [key, val] of Object.entries(m.coordinates)) {
          outputText += `    ${key}: ${JSON.stringify(val)}\n`;
        }
      } else {
        outputText += `    (none)\n`;
      }

      outputText += `  referencedSOPInstanceUID: ${m.referencedSOPInstanceUID ?? 'N/A'}\n`;
      outputText += `  frameOfReferenceUID: ${m.frameOfReferenceUID ?? 'N/A'}\n\n`;
    });
  } else {
    outputText += '(No measurements found)\n';
  }

  // Output to console
  console.log(outputText.trim());

  // Optional: write to file if specified
  if (outputPath) {
    fs.writeFileSync(outputPath, outputText, 'utf8');
  }
} catch (err) {
  console.error('Error reading or parsing file:', err.message);
  process.exit(1);
}

/*
=== Giải thích ===
- Phần validateSR() giữ nguyên logic kiểm tra các trường quan trọng của SR.
- Phần main thêm:
   + In tổng số measurements có trong JSON.
   + In toàn bộ measurements với chi tiết từng trường, format rõ ràng.
   + Nếu có lỗi thì in danh sách lỗi chi tiết.
- Mục đích: giúp người đọc dễ dàng nhìn thấy nội dung data và lỗi nếu có, chứ không chỉ biết pass/fail.
*/



// CHẠY CODE KIỂM TRA CÁC PHẦN TỪ ĐỂ GỬI VỀ SR
// node validate-sr.js /Users/lahieuphong/Downloads/SR_1.2.156.14702.1.1000.16.0.20200311113603875.json validator_result.txt