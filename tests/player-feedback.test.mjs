import test from 'node:test';
import assert from 'node:assert/strict';
import { countedScore, createFeedbackTimeline, confettiParticles } from '../public/player-feedback.mjs';

test('score counts from previous total to exact new half-point total without overshoot', () => {
  for (const [from,to] of [[0,7],[8,11.5],[10.5,11],[100,107.5],[2,2]]) {
    assert.equal(countedScore(from,to,0),from);
    assert.equal(countedScore(from,to,1600),to);
    assert.equal(countedScore(from,to,9000),to);
    let previous=from;
    for(let t=0;t<=1600;t+=16) {
      const value=countedScore(from,to,t);
      assert.ok(value>=previous && value<=to);
      assert.equal(value*2,Math.round(value*2));
      previous=value;
    }
  }
});

test('effects do not restart on player updates or result DOM rebuilds, but reset for next round', () => {
  const timeline=createFeedbackTimeline();
  timeline.setScope('session:round1');
  assert.equal(timeline.start('score:P1',100),100);
  assert.equal(timeline.start('score:P1',900),100);
  assert.equal(timeline.start('success:P1',200),200);
  timeline.setScope('session:round1');
  assert.equal(timeline.start('success:P1',1200),200);
  assert.equal(timeline.start('score:P2',1200),1200);
  timeline.setScope('session:round2');
  assert.equal(timeline.start('score:P1',1500),1500);
});

test('confetti is finite and stays sized for a 640px player zone', () => {
  const particles=confettiParticles();
  assert.equal(particles.length,36);
  for(const p of particles) {
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.rotation));
    assert.ok(Math.abs(p.x)<300 && p.y<=0 && p.y>-300);
    assert.ok(p.delay>=0 && p.delay<2200-1800);
    assert.match(p.color,/^#[a-f0-9]{6}$/i);
  }
});
