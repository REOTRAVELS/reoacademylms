import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureGeneratedOrdinaryClasses } from '../src/services/cohortTimetable.js';

test('program offering timetable generation is idempotent and batches new sessions', async () => {
  const generatedClasses = [];
  const batches = [];
  const database = {
    cohort: {
      findMany: async () => [{
        id: 'cohort-1',
        name: 'Winter cohort',
        schedule: 'Fri 18:00-19:00',
        status: 'ACTIVE',
        intakeProgramOffering: {
          schedule: 'Mon 09:00-10:00',
          academicStartDate: null,
          academicEndDate: null,
          status: 'ACTIVE',
          intake: { timezone: 'UTC', status: 'ACTIVE' },
        },
        courses: [{
          courseId: 'course-1',
          course: { id: 'course-1', title: 'Customer Relations', trainers: [] },
        }],
        trainers: [],
      }],
    },
    liveClass: {
      findMany: async () => generatedClasses,
      updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        batches.push(data);
        generatedClasses.push(...data.map((liveClass) => ({
          ...liveClass,
          id: `class-${generatedClasses.length + 1}`,
          status: 'SCHEDULED',
        })));
        return { count: data.length };
      },
    },
    user: {
      findFirst: async () => ({ id: 'admin-1' }),
    },
  };

  await ensureGeneratedOrdinaryClasses(database, 'cohort-1');
  await ensureGeneratedOrdinaryClasses(database, 'cohort-1');

  assert.equal(batches.length, 1);
  assert.ok(batches[0].length > 0);
  assert.ok(batches[0].every(({ cohortId, courseId }) => cohortId === 'cohort-1' && courseId === 'course-1'));
  assert.ok(batches[0].every(({ description }) => description.includes('Mon 09:00-10:00')));
  assert.equal(generatedClasses.length, batches[0].length);
});
