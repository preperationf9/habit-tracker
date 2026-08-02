/* QA fix: gate alarm-scheduler hot-path console.log behind ALARM_DEBUG (alarmLog). */
const fs = require('fs');
const file = 'script.js';
let js = fs.readFileSync(file, 'utf8');

// Prefix patterns: `console.log(` -> `alarmLog(` for hot-path debug logs ONLY.
// Error-path logs, the "required" reschedule-parse log, audio-unlock once logs,
// and the notification-permission log are intentionally left untouched.
const patterns = [
  "console.log('[alarm-time] triggerDueAlarms-enter-ms'",
  "console.log('[alarm-check]'",
  "console.log('[alarm-skip]'",
  "console.log('[alarm-time] trigger'",
  "console.log('[alarm-time] skipped'",
  "console.log('[alarm-time] next exact scheduled'",
  "console.log('[alarm-time] timeout-fired-ms'",
  "console.log('[alarm-init]')",
  "console.log('[alarm-scheduler-started]')",
  "console.log('[alarm] recovered missed alarm'",
  "console.log('[alarm-tick]'",
  "console.log('[alarm] snooze scan'",
  "console.log('[alarm] snooze skipped",
  "console.log('[alarm] scan habit'",
  "console.log('[alarm] skipped",
  "console.log('[alarm] triggered",
];

let total = 0;
for (const p of patterns) {
  const count = js.split(p).length - 1;
  if (count === 0) {
    console.log('WARN pattern not found:', p);
    continue;
  }
  total += count;
  js = js.split(p).join(p.replace('console.log', 'alarmLog'));
}

fs.writeFileSync(file, js, 'utf8');
console.log('Replaced', total, 'console.log -> alarmLog calls');

// Verify none of the hot-path prefixes remain
let remaining = 0;
for (const p of patterns) {
  const c = js.split(p).length - 1;
  if (c > 0) {
    remaining += c;
    console.log('STILL PRESENT:', p, c);
  }
}
console.log('Remaining hot-path console.log prefixes:', remaining);

// Sanity: error-path + required logs still present as console.log
const keepers = [
  "console.log('[alarm-time] triggerDueAlarms error'",
  "console.log('[alarm-time] scheduleNextExactAlarm error'",
  "console.log('[reschedule-time-parse]'",
  "console.log('[alarm-audio] unlock attempt')",
  "console.log('[alarm-audio] unlock success')",
  "console.log('[alarm-audio] unlock failed'",
  "console.log('[alarm] notification permission status'",
];
for (const k of keepers) {
  console.log('KEEP', js.includes(k) ? 'OK' : 'MISSING!', k);
}

