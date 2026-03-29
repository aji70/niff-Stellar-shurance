#!/usr/bin/env ts-node
/**
 * Exports the error catalog as a JSON file for frontend i18n consumption.
 * Output: src/common/errors/error-catalog.json
 *
 * Run: ts-node scripts/export-error-catalog.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ERROR_CATALOG } from '../src/common/errors/error-catalog';

const OUT = path.resolve(__dirname, '../src/common/errors/error-catalog.json');

const output = Object.fromEntries(
  Object.entries(ERROR_CATALOG).map(([code, entry]) => [
    code,
    {
      httpStatus: entry.httpStatus,
      i18nKey: entry.i18nKey,
      description: entry.description,
      ...(entry.deprecated ? { deprecated: true, replacedBy: entry.replacedBy } : {}),
    },
  ]),
);

fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Exported ${Object.keys(output).length} error codes to ${OUT}`);
