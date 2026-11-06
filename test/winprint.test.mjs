/**
 * The Windows handoff: from the DS40 queue's own paper (read with
 * PowerShell, parsed here) to which page is sent, on which paper size.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parsePaper, handoffFor } = createRequire(import.meta.url)('../electron/winprint.js');

const out = (cur) => ['SIZE (5x3.5)|500|350|256', 'SIZE (6x4)|413|615|257', 'SIZE (6x8)|615|826|258', cur].join('\r\n');

test('parses the paper list and the Printing Preferences paper', () => {
  const p = parsePaper(out('DEFAULT (6x4)|413|615|257|True'));
  assert.equal(p.sizes.length, 3);
  assert.deepEqual(p.sizes[1], { name: '(6x4)', widthIn: 4.13, heightIn: 6.15, kind: 257 });
  assert.deepEqual(p.current, { name: '(6x4)', widthIn: 4.13, heightIn: 6.15, kind: 257, landscape: true });
  assert.equal(p.error, undefined);
  const bad = parsePaper('ERR Printer not found: X', 'stderr');
  assert.equal(bad.current, null);
  assert.match(bad.error, /not found/);
});

test('paper defined tall → the portrait frame, on exactly that paper, portrait job', () => {
  const h = handoffFor({ name: '(6x4)', widthIn: 4.13, heightIn: 6.15, landscape: true }, 'DS40');
  assert.equal(h.shape, 'frame');
  assert.deepEqual(h.paper, { w: 4.13, h: 6.15 });
  assert.match(h.why, /defined tall.*Landscape, but every job is sent portrait/);
});

test('paper defined wide → the sheet as is, on exactly that paper', () => {
  const h = handoffFor({ name: 'PC 6x4', widthIn: 6.15, heightIn: 4.13, landscape: false }, 'DS40');
  assert.equal(h.shape, 'sheet');
  assert.deepEqual(h.paper, { w: 6.15, h: 4.13 });
});

test('no paper, or not a 6x4 paper → the portrait frame on 4 x 6 in, and says why', () => {
  for (const [c, re] of [[null, /no answer/], [{ name: 'A4', widthIn: 8.27, heightIn: 11.69 }, /A4 8.27 x 11.69/]]) {
    const h = handoffFor(c, 'DS40');
    assert.equal(h.shape, 'frame');
    assert.deepEqual(h.paper, { w: 4, h: 6 });
    assert.match(h.why, re);
  }
});
