import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../src/config/database.js';
import { canAccessCourse, studentCourseAccessWhere } from '../src/utils/courseAccess.js';

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

test('student course access is scoped to an active Program and availability dates', async () => {
  const now = new Date('2027-01-15T12:00:00.000Z');
  const where = studentCourseAccessWhere('student-1', now);
  const enrollmentWhere = where.AND[0].OR[0].programme.is.intakeOfferings.some.programEnrollments.some;
  assert.equal(where.status, 'PUBLISHED');
  assert.deepEqual(
    where.AND[0].OR[1].cohorts.some.cohort.programme.intakeOfferings.some.programEnrollments.some,
    enrollmentWhere,
  );
  const cohortOffering = where.AND[0].OR[1].cohorts.some.cohort.intakeProgramOffering.is;
  assert.deepEqual(cohortOffering.programEnrollments.some, enrollmentWhere);
  assert.deepEqual(cohortOffering.intake, { is: { academicStartDate: { lte: now } } });
  assert.equal(enrollmentWhere.studentId, 'student-1');
  assert.equal(enrollmentWhere.status, 'ACTIVE');
  assert.deepEqual(enrollmentWhere.effectiveAt, { lte: now });
  assert.deepEqual(enrollmentWhere.AND, [
    { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
    { OR: [{ applicationId: null }, { application: { is: { status: 'APPROVED' } } }] },
  ]);
  assert.deepEqual(
    where.AND[0].OR[0].programme.is.intakeOfferings.some.intake,
    { is: { academicStartDate: { lte: now } } },
  );
  assert.deepEqual(where.AND[0].OR[1].cohorts.some.cohort.enrolments.some, {
    studentId: 'student-1',
  });
  assert.deepEqual(where.AND[1], { OR: [{ startDate: null }, { startDate: { lte: now } }] });
  assert.deepEqual(where.AND[2], { OR: [{ endDate: null }, { endDate: { gte: now } }] });

  let query;
  const restore = stubMethod(prisma.course, 'findFirst', async ({ where: filter }) => {
    query = filter;
    return { id: 'course-1' };
  });
  try {
    assert.equal(await canAccessCourse('course-1', {
      id: 'student-1',
      role: { name: 'STUDENT' },
    }, now), true);
    assert.equal(query.id, 'course-1');
    assert.equal(query.visibility, undefined);
    assert.deepEqual(query.AND[0], where.AND[0]);
    assert.ok(query.AND[1].OR[1].startDate.lte instanceof Date);
    assert.ok(query.AND[2].OR[1].endDate.gte instanceof Date);
  } finally {
    restore();
  }
});
