// tools/findAttempts.js
const fs = require('fs');
const path = require('path');

function walk(dir, cb) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'node_modules' || d.name === '.git') return;
      walk(p, cb);
    } else if (d.isFile() && p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx')) {
      cb(p);
    }
  });
}

const root = process.cwd();
const hits = [];

walk(path.join(root, 'src'), (file) => {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  lines.forEach((ln, idx) => {
    if (/\battempts\b/.test(ln) || /\bmaxAttempts\b/.test(ln) || /\bfor\s*\(.*<\s*\d+/.test(ln)) {
      hits.push({ file, line: idx+1, code: ln.trim() });
    }
  });
});

console.log('Found', hits.length, 'matches\n');
hits.forEach(h => {
  console.log(`${h.file}:${h.line}  ${h.code}`);
});
