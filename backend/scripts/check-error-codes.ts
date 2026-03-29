#!/usr/bin/env ts-node
/**
 * CI check: every `new AppException('CODE')` call must reference a code
 * that exists in ERROR_CATALOG. Exits non-zero on violations.
 *
 * Run: ts-node scripts/check-error-codes.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ERROR_CATALOG } from '../src/common/errors/error-catalog';

const SRC_DIR = path.resolve(__dirname, '../src');
const VALID_CODES = new Set(Object.keys(ERROR_CATALOG));
const APP_EXCEPTION_RE = /new AppException\(\s*['"`]([A-Z_]+)['"`]/g;

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) return [full];
    return [];
  });
}

let violations = 0;

for (const file of walk(SRC_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  let match: RegExpExecArray | null;
  APP_EXCEPTION_RE.lastIndex = 0;
  while ((match = APP_EXCEPTION_RE.exec(content)) !== null) {
    const code = match[1];
    if (!VALID_CODES.has(code)) {
      const line = content.slice(0, match.index).split('\n').length;
      console.error(`[error-catalog] Unknown code "${code}" at ${path.relative(SRC_DIR, file)}:${line}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} violation(s). Add missing codes to src/common/errors/error-catalog.ts.`);
  process.exit(1);
} else {
  console.log(`[error-catalog] All AppException codes are valid (${VALID_CODES.size} catalog entries).`);
}
