import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaleMarker, staleDecision } from './stale-controller.mjs';

const day = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T00:00:00Z');

test('stale marker timestamps are parsed safely', () => {
  assert.equal(parseStaleMarker('hello'), null);
  assert.equal(parseStaleMarker('<!-- thanhnguyxnagent:stale-marked-at:bad -->'), null);
  assert.equal(parseStaleMarker('<!-- thanhnguyxnagent:stale-marked-at:2026-11-01T00:00:00.000Z -->').toISOString(), '2026-11-01T00:00:00.000Z');
});

test('inactive items are marked after the configured inactivity window', () => {
  assert.equal(staleDecision({ updated_at: new Date(now.getTime() - 13 * day).toISOString(), labels: [] }, null, now), 'active');
  assert.equal(staleDecision({ updated_at: new Date(now.getTime() - 14 * day).toISOString(), labels: [] }, null, now), 'mark');
});

test('items with exempt labels are never stale-closed', () => {
  assert.equal(staleDecision({ updated_at: new Date(now.getTime() - 40 * day).toISOString(), labels: [{name:'keep-me'}] }, null, now), 'exempt');
  assert.equal(staleDecision({ updated_at: new Date(now.getTime() - 40 * day).toISOString(), labels: [{name:'needs-review'}] }, new Date(now.getTime() - 8 * day), now), 'exempt');
});

test('activity after stale marking clears the stale state', () => {
  const marker = new Date(now.getTime() - 6 * day);
  const item = { updated_at: new Date(now.getTime() - day).toISOString(), labels: [{name:'stale'}] };
  assert.equal(staleDecision(item, marker, now), 'reactivated');
});

test('an unchanged stale item closes only after its additional grace window', () => {
  const marker = new Date(now.getTime() - 4 * day);
  assert.equal(staleDecision({ updated_at: marker.toISOString(), labels: [{name:'stale'}] }, marker, now), 'wait');
  const expired = new Date(now.getTime() - 5 * day);
  assert.equal(staleDecision({ updated_at: expired.toISOString(), labels: [{name:'stale'}] }, expired, now), 'close');
});

test('stale marker bot updates do not reactivate an item inside timestamp tolerance', () => {
  const marker = new Date(now.getTime() - 2 * day);
  const updatedAt = new Date(marker.getTime() + 2 * 60 * 1000).toISOString();
  assert.equal(staleDecision({ updated_at: updatedAt, labels: [{name:'stale'}] }, marker, now, {daysBeforeStale:14,daysBeforeClose:5,activityTimestampToleranceMinutes:5}), 'wait');
});

test('draft PRs and locked issues are exempt from stale handling', () => {
  const old = {updated_at:new Date(now.getTime()-40*day).toISOString(),labels:[]};
  assert.equal(staleDecision({...old,draft:true},null,now),'exempt');
  assert.equal(staleDecision({...old,locked:true},null,now),'exempt');
});
