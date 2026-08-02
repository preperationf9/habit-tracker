const fs = require('fs');
const js = fs.readFileSync('script.js', 'utf8');

const checks = [
  ['Final state log removed', !js.includes("console.log('Final state'")],
  ['Loaded state log removed', !js.includes("console.log('Loaded state'")],
  ['Migrated state log removed', !js.includes("console.log('Migrated state'")],
  ['alarm scheduler tick error removed', !js.includes('alarm scheduler tick error')],
  ['Temporary console check removed', !js.includes('Temporary console check')],
  ['alarmLog helper present', js.includes('function alarmLog()')],
  ['storage persist error message', js.includes('[storage] failed to persist state after load')],
];

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ': ' + name);

// Count remaining console.log calls
const logs = js.match(/console\.log\(/g);
console.log('Remaining console.log count in script.js:', logs ? logs.length : 0);

