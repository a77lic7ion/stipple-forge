const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PROJECTS = path.join(ROOT, 'projects');
console.log('ROOT:', ROOT);

const projectId = process.argv[2] || 'c20bcb1fc638';
const srcFile = 'source.png';
const src = path.join(PROJECTS, projectId, srcFile);
const out = path.join(PROJECTS, projectId, 'dots.json');

console.log('src:', src);
console.log('out:', out);

const proc = spawn('python3', [path.join(ROOT, 'worker', 'image_to_dots.py'), src, out, '50000'], { cwd: ROOT });
let stderr = '';
proc.stdout.on('data', d => console.log('stdout:', d.toString()));
proc.stderr.on('data', d => { stderr += d; console.log('stderr:', d.toString()); });
proc.on('close', code => {
  console.log('exit:', code);
  if (code !== 0) console.log('full stderr:', stderr);
  if (code === 0) {
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(out, 'utf-8'));
    console.log('dots written:', data.count, 'size:', fs.statSync(out).size, 'bytes');
  }
});
