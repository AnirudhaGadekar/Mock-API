import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(command: string) {
  return execSync(command, { stdio: 'pipe' }).toString();
}

function fail(message: string) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

console.log('🔎 Checking for circular dependencies...');
try {
  const madge = run('npx madge --circular src');
  if (madge.includes('circular dependencies found') || madge.includes('Circular dependencies')) {
    fail('Circular dependencies detected.');
  }
} catch (error) {
  fail('Error checking circular dependencies.');
}

console.log('🔎 Checking for unused dependencies...');
try {
  const depcheck = run('npx depcheck');
  if (!depcheck.includes('No depcheck issue')) {
    console.warn(depcheck);
  }
} catch (error) {
  console.warn('Depcheck found issues or failed to run');
}

console.log('🔎 Checking for console.log in source...');
function scanLogs(dir: string) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (full.includes('scripts')) continue; // Skip scripts directory
      scanLogs(full);
    } else if (file.endsWith('.ts') && !file.includes('seed') && !file.includes('test')) {
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes('console.log')) {
        fail(`console.log found in ${full}`);
      }
    }
  }
}
scanLogs('src');

console.log('🔎 Checking for TODO or FIXME...');
function scanTODO(dir: string) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (full.includes('scripts')) continue; // Skip scripts directory
      scanTODO(full);
    } else if (file.endsWith('.ts') && !file.includes('seed') && !file.includes('test')) {
      const content = fs.readFileSync(full, 'utf-8');
      if (/TODO|FIXME/.test(content)) {
        fail(`TODO or FIXME found in ${full}`);
      }
    }
  }
}
scanTODO('src');

console.log('✅ Static scan passed.');
