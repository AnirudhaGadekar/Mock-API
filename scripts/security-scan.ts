import fs from 'fs';
import path from 'path';

const forbiddenPatterns = [
  /otp\s*=\s*['"]000000['"]/, // Static OTP assignment
  /redis\.eval/, // Redis eval usage
  /process\.env\..*SECRET\s*=\s*['"]/ // Hardcoded secrets
];

function scan(dir: string) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      scan(full);
    } else if (file.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf-8');
      forbiddenPatterns.forEach(pattern => {
        if (pattern.test(content)) {
          console.error(`❌ Forbidden pattern ${pattern} found in ${full}`);
          process.exit(1);
        }
      });
    }
  }
}

scan('src');
console.log('✅ Security scan passed.');
