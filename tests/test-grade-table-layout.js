import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/css/showcase.css', 'utf8');
const stickyHeaderRule = css.match(/\.grade-table\s+thead\s*\{([^}]+)\}/);

assert.ok(stickyHeaderRule, 'Grade table sticky header rule must exist');
assert.match(stickyHeaderRule[1], /position:\s*sticky/);
assert.match(stickyHeaderRule[1], /top:\s*0(?:px)?\s*;/);
assert.doesNotMatch(stickyHeaderRule[1], /top:\s*[1-9]\d*px/);

console.log('✓ Grade table header no longer overlaps the first course row');
