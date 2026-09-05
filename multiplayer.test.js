import test from 'node:test';
import assert from 'node:assert/strict';
import { rankResults, scoreKeys } from './multiplayer.js';

const row = (id, extra={}) => ({id,...Object.fromEntries(scoreKeys.map(k=>[k,80])),wpm:130,submitted_at:'2026-09-05T10:00:00Z',...extra});
test('each score takes priority over all later tie-breakers',()=>{
  for (let i=0;i<scoreKeys.length;i++) {
    const a=row('a',{[scoreKeys[i]]:81,wpm:300,submitted_at:'2026-09-05T11:00:00Z'});
    const b=row('b',Object.fromEntries(scoreKeys.slice(i+1).map(k=>[k,100])));
    assert.equal(rankResults([b,a],{target_wpm:130,wpm_tiebreak:true})[0].id,'a');
  }
});
test('target distance wins, equal distance uses earliest submission',()=>{
  const rows=[row('fast',{wpm:200}),row('near',{wpm:125}),row('early',{wpm:135,submitted_at:'2026-09-05T09:59:00Z'})];
  assert.deepEqual(rankResults(rows,{target_wpm:130,wpm_tiebreak:true}).map(r=>r.id),['early','near','fast']);
  assert.deepEqual(rows.map(r=>r.id),['fast','near','early']);
});
test('disabled WPM tie-break uses timestamp; target is configurable',()=>{
  const rows=[row('a',{wpm:100,submitted_at:'2026-09-05T09:00:00Z'}),row('b',{wpm:180})];
  assert.equal(rankResults(rows,{target_wpm:180,wpm_tiebreak:true})[0].id,'b');
  assert.equal(rankResults(rows,{target_wpm:180,wpm_tiebreak:false})[0].id,'a');
});
