import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReminderSchedule,
  formatReminderTime,
  getNotificationCapability,
  urlBase64ToUint8Array,
} from './pushNotifications';
import {
  DAY_UNLOCK_INTERVAL_MS,
  completeLessonDay,
  createInitialProgress,
} from './curriculumEngine';

test('urlBase64ToUint8Array decodes base64url VAPID strings cleanly', () => {
  // "SGVsbG8" -> "Hello"
  const bytes = urlBase64ToUint8Array('SGVsbG8');
  assert.deepEqual(Array.from(bytes), [72, 101, 108, 108, 111]);
});

test('getNotificationCapability detects iOS non-standalone, denied, unsupported, and supported states', () => {
  assert.equal(
    getNotificationCapability({
      hasNotificationApi: false,
      hasServiceWorker: true,
      permission: 'unsupported',
      isIOS: true,
      isStandalone: false,
    }),
    'ios-needs-install'
  );

  assert.equal(
    getNotificationCapability({
      hasNotificationApi: true,
      hasServiceWorker: true,
      permission: 'denied',
      isIOS: false,
      isStandalone: false,
    }),
    'denied'
  );

  assert.equal(
    getNotificationCapability({
      hasNotificationApi: false,
      hasServiceWorker: false,
      permission: 'unsupported',
      isIOS: false,
      isStandalone: false,
    }),
    'unsupported'
  );

  assert.equal(
    getNotificationCapability({
      hasNotificationApi: true,
      hasServiceWorker: true,
      permission: 'default',
      isIOS: true,
      isStandalone: true,
    }),
    'supported'
  );
});

test('computeReminderSchedule returns null before Day 1 is completed', () => {
  const progress = createInitialProgress();
  assert.equal(computeReminderSchedule(progress, 1, 1_700_000_000_000), null);
});

test('computeReminderSchedule schedules future reminder during 24h lock and fires once when unlocked', () => {
  const t0 = 1_700_000_000_000;
  const completedDay1 = completeLessonDay(createInitialProgress(), 1, t0);

  // 1 hour after Day 1 completion -> locked for 23h
  const futureSchedule = computeReminderSchedule(completedDay1, 1, t0 + 3_600_000);
  assert.ok(futureSchedule);
  assert.equal(futureSchedule.targetDay, 2);
  assert.equal(futureSchedule.shouldScheduleFuture, true);
  assert.equal(futureSchedule.shouldFireNow, false);
  assert.equal(futureSchedule.unlockAtMs, t0 + DAY_UNLOCK_INTERVAL_MS);
  assert.equal(futureSchedule.delayMs, DAY_UNLOCK_INTERVAL_MS - 3_600_000);

  // 24h + 1s later -> should fire immediately
  const readySchedule = computeReminderSchedule(
    completedDay1,
    1,
    t0 + DAY_UNLOCK_INTERVAL_MS + 1000
  );
  assert.ok(readySchedule);
  assert.equal(readySchedule.targetDay, 2);
  assert.equal(readySchedule.shouldFireNow, true);

  // Already notified for Day 2 -> deduplicated
  const deduped = computeReminderSchedule(
    completedDay1,
    2,
    t0 + DAY_UNLOCK_INTERVAL_MS + 5000
  );
  assert.ok(deduped);
  assert.equal(deduped.shouldFireNow, false);
});

test('computeReminderSchedule uses weekly review copy when Day 7 unlocks', () => {
  const t0 = 1_700_000_000_000;
  const day6Completed = {
    ...createInitialProgress(),
    unlockedDay: 6,
    completedDays: [1, 2, 3, 4, 5, 6],
    lastCompletedAt: t0,
  };
  const schedule = computeReminderSchedule(day6Completed, 6, t0 + 1000);
  assert.ok(schedule);
  assert.equal(schedule.targetDay, 7);
  assert.equal(schedule.isWeeklyReview, true);
  assert.match(schedule.title, /Еженедельный срез/);
});

test('formatReminderTime formats HH:MM string', () => {
  const formatted = formatReminderTime(Date.UTC(2026, 10, 19, 12, 30, 0));
  assert.match(formatted, /^\d{2}:\d{2}$/);
});
