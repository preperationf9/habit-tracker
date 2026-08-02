const fs = require('fs');
const js = fs.readFileSync('script.js', 'utf8');

const lines = js.split('\n');
lines.forEach((line, i) => {
  if (/console\.(log|warn|error)\(/.test(line)) {
    console.log((i + 1) + ': ' + line.trim());
  }
});

// Verify alarmLog gates alarm console output
const alarmLogCount = (js.match(/alarmLog\(/g) || []).length;
console.log('\nalarmLog call count:', alarmLogCount);
console.log('console.log in alarm tick contexts:', (js.match(/console\.log\('\[alarm/g) || []).length);

