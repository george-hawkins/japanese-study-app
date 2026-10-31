// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge3 } from '../js/merge.js';
import { mergeSections3, emptySections } from '../js/markdown.js';

const K = ['corrections', 'maybe', 'done'];
const doc = (corrections = [], maybe = [], done = []) => ({ corrections, maybe, done });
const m = (b, l, r) => merge3(b, l, r, K);

test('no changes', () => {
  const b = doc(['a', 'b'], ['m'], ['d']);
  assert.deepEqual(m(b, b, b), b);
});

test('phone adds while laptop marks done', () => {
  const b = doc(['a', 'b']);
  const phone = doc(['new', 'a', 'b']);
  const laptop = doc(['b'], [], ['a']);
  assert.deepEqual(m(b, phone, laptop), doc(['new', 'b'], [], ['a']));
  assert.deepEqual(m(b, laptop, phone), doc(['new', 'b'], [], ['a']));
});

test('both add: both kept at the top, this device first', () => {
  const b = doc(['a']);
  assert.deepEqual(m(b, doc(['mine', 'a']), doc(['theirs', 'a'])), doc(['mine', 'theirs', 'a']));
});

test('deletion on one side wins over no change', () => {
  const b = doc(['a', 'b', 'c']);
  assert.deepEqual(m(b, doc(['a', 'b', 'c']), doc(['a', 'c'])), doc(['a', 'c']));
  assert.deepEqual(m(b, doc(['a', 'c']), doc(['a', 'b', 'c'])), doc(['a', 'c']));
});

test('edit here vs mark done there: nothing is lost', () => {
  const b = doc(['a', 'b']);
  assert.deepEqual(m(b, doc(['a2', 'b']), doc(['b'], [], ['a'])), doc(['a2', 'b'], [], ['a']));
});

test('delete vs move: the item is kept where it was moved', () => {
  const b = doc(['a', 'b']);
  assert.deepEqual(m(b, doc(['b']), doc(['b'], ['a'])), doc(['b'], ['a']));
});

test('moved differently on both sides: this device wins', () => {
  const b = doc(['a']);
  assert.deepEqual(m(b, doc([], ['a']), doc([], [], ['a'])), doc([], ['a'], []));
});

test('same change on both sides', () => {
  const b = doc(['a', 'b']);
  assert.deepEqual(m(b, doc(['b'], [], ['a']), doc(['b'], [], ['a'])), doc(['b'], [], ['a']));
});

test('moved items arrive at the top of their new list', () => {
  const b = doc(['a'], ['x', 'y'], ['old']);
  const local = doc([], ['x', 'y'], ['a', 'old']);
  const remote = doc(['a'], ['y'], ['x', 'old']);
  assert.deepEqual(m(b, local, remote), doc([], ['y'], ['a', 'x', 'old']));
});

test('remote reordering is kept', () => {
  const b = doc(['a', 'b', 'c']);
  assert.deepEqual(m(b, doc(['n', 'a', 'b', 'c']), doc(['c', 'a', 'b'])), doc(['n', 'c', 'a', 'b']));
});

test('empty base (first sync) combines both', () => {
  assert.deepEqual(m(doc(), doc(['a', 'b']), doc(['b', 'c'])), doc(['a', 'b', 'c']));
});

test('whitespace and empty rows are normalised', () => {
  const b = doc(['a']);
  assert.deepEqual(m(b, doc(['  a ', '', 'new  item']), doc(['a'])), doc(['new item', 'a']));
});

test('mergeSections3 keeps GitHub preamble and extra sections', () => {
  const remote = { ...emptySections(), preamble: '# Notes', extra: [{ title: 'Other', lines: ['x'] }], corrections: ['a'] };
  const local = { ...emptySections(), corrections: ['b', 'a'] };
  const base = { ...emptySections(), corrections: ['a'] };
  const r = mergeSections3(base, local, remote);
  assert.equal(r.preamble, '# Notes');
  assert.deepEqual(r.extra, remote.extra);
  assert.deepEqual(r.corrections, ['b', 'a']);
});
