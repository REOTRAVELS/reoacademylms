import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'admin-dashboard-select-test-secret';
process.env.DATABASE_URL ||= '******localhost:5432/test';

const [{ adminDashboard, trainerDashboard, studentDashboard }, { default: prisma }] = await Promise.all([
  import('../src/controllers/dashboardController.js'),
  import('../src/config/database.js'),
]);

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const createResponse = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const assertActiveEnrollmentScope = (where) => {
  assert.equal(where.studentId, 'student-1');
  assert.equal(where.status, 'ACTIVE');
  assert.ok(where.effectiveAt.lte instanceof Date);
  assert.equal(where.student.is.status, 'ACTIVE');
  assert.equal(where.student.is.role.is.name, 'STUDENT');
  assert.equal(where.AND[1].OR[1].application.is.status, 'APPROVED');
  assert.ok(where.AND[0].OR[1].endedAt.gt instanceof Date);
};

test('admin dashboard selects only public actor names for recent audit events', async () => {
  let auditQuery;
  const restores = [
    stubMethod(prisma.user, 'count', async () => 0),
    stubMethod(prisma.programme, 'count', async () => 0),
    stubMethod(prisma.intake, 'count', async () => 0),
    stubMethod(prisma.enrolment, 'count', async () => 0),
    stubMethod(prisma.assessment, 'count', async () => 0),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 0),
    stubMethod(prisma.assessmentAttempt, 'findMany', async () => []),
    stubMethod(prisma.course, 'count', async () => 0),
    stubMethod(prisma.liveClass, 'count', async () => 0),
    stubMethod(prisma.user, 'findMany', async () => []),
    stubMethod(prisma.auditLog, 'findMany', async (query) => {
      auditQuery = query;
      return [{
        id: 'audit-1',
        action: 'LOGIN',
        entity: 'User',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        actor: { firstName: 'Test', lastName: 'Admin' },
      }];
    }),
  ];
  const response = createResponse();
  try {
    await adminDashboard({}, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(auditQuery.select, {
      id: true,
      action: true,
      entity: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
    });
    assert.equal(response.body.data.recentAudit[0].actor, 'Test Admin');
    assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|resetToken/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('admin dashboard reports course lifecycle and future scheduled live-class counts', async () => {
  const courseQueries = [];
  let liveClassQuery;
  const restores = [
    stubMethod(prisma.user, 'count', async () => 0),
    stubMethod(prisma.programme, 'count', async () => 0),
    stubMethod(prisma.intake, 'count', async () => 1),
    stubMethod(prisma.enrolment, 'count', async () => 0),
    stubMethod(prisma.assessment, 'count', async (query) => (
      query?.where?.type === 'EXAMINATION' ? 1 : 2
    )),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 5),
    stubMethod(prisma.assessmentAttempt, 'findMany', async () => [{
      id: 'exam-attempt-1',
      startedAt: new Date('2026-01-03T00:00:00.000Z'),
      submittedAt: new Date('2026-01-03T01:00:00.000Z'),
      score: 8,
      maxScore: 10,
      status: 'GRADED',
      student: { firstName: 'Test', lastName: 'Student' },
      assessment: { id: 'exam-1', title: 'Final exam', resultsReleased: false },
    }]),
    stubMethod(prisma.course, 'count', async (query) => {
      courseQueries.push(query);
      return query?.where?.status === 'PUBLISHED' ? 3 : query?.where?.status === 'DRAFT' ? 4 : 7;
    }),
    stubMethod(prisma.liveClass, 'count', async (query) => {
      liveClassQuery = query;
      return 5;
    }),
    stubMethod(prisma.user, 'findMany', async () => []),
    stubMethod(prisma.auditLog, 'findMany', async () => []),
  ];
  const response = createResponse();
  try {
    await adminDashboard({}, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.stats, {
      totalStudents: 0,
      activeStudents: 0,
      pendingRegistrations: 0,
      totalTrainers: 0,
      activeProgrammes: 0,
      activeIntakes: 1,
      totalEnrolments: 0,
      totalCourses: 7,
      publishedCourses: 3,
      draftCourses: 4,
      publishedAssessments: 2,
      publishedExaminations: 1,
      examinationAttempts: 5,
      upcomingLiveClasses: 5,
    });
    assert.equal(response.body.data.recentExaminationAttempts[0].assessment.title, 'Final exam');
    assert.ok(courseQueries.some((query) => query?.where?.status === 'PUBLISHED'));
    assert.ok(courseQueries.some((query) => query?.where?.status === 'DRAFT'));
    assert.equal(liveClassQuery.where.status, 'SCHEDULED');
    assert.ok(liveClassQuery.where.startsAt.gte instanceof Date);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('student dashboard only selects fields used by its learning overview', async () => {
  let enrolmentQuery;
  let attemptQuery;
  let assessmentQuery;
  let liveClassQuery;
  let notificationQuery;
  const assessmentCandidates = [
    { id: 'exhausted', attemptLimit: 1, attempts: [{ id: 'attempt-1' }], course: { title: 'Course' } },
    { id: 'available', attemptLimit: 2, attempts: [{ id: 'attempt-2' }], course: { title: 'Course' } },
  ];
  const restores = [
    stubMethod(prisma.enrolment, 'findMany', async (query) => {
      enrolmentQuery = query;
      return [];
    }),
    stubMethod(prisma.assessmentAttempt, 'findMany', async (query) => {
      attemptQuery = query;
      return [{
        id: 'exam-attempt-1',
        startedAt: new Date('2026-01-03T00:00:00.000Z'),
        submittedAt: new Date('2026-01-03T01:00:00.000Z'),
        score: 9,
        maxScore: 10,
        status: 'GRADED',
        assessment: { title: 'Final exam', type: 'EXAMINATION', resultsReleased: false },
      }];
    }),
    stubMethod(prisma.assessment, 'findMany', async (query) => {
      assessmentQuery = query;
      return assessmentCandidates;
    }),
    stubMethod(prisma.liveClass, 'findMany', async (query) => {
      liveClassQuery = query;
      return [];
    }),
    stubMethod(prisma.notification, 'findMany', async (query) => {
      notificationQuery = query;
      return [];
    }),
  ];
  const response = createResponse();
  try {
    await studentDashboard({
      user: { id: 'student-1' },
      activeProgramEnrollment: { programmeId: 'programme-1', programOfferingId: 'offering-1' },
    }, response);
    assert.equal(response.statusCode, 200);
    const dashboardCourseWhere = enrolmentQuery.select.cohort.select.courses.where.course;
    assert.deepEqual(enrolmentQuery.select, {
      id: true,
      cohort: {
        select: {
          name: true,
          courses: {
            where: { course: dashboardCourseWhere },
            select: {
              course: { select: { id: true, title: true, description: true, status: true } },
            },
          },
        },
      },
    });
    assert.equal(dashboardCourseWhere.status, 'PUBLISHED');
    assertActiveEnrollmentScope(
      dashboardCourseWhere.AND[0].OR[0].programme.is.intakeOfferings.some.programEnrollments.some,
    );
    assert.ok(
      dashboardCourseWhere.AND[0].OR[0].programme.is.intakeOfferings.some.intake.is.academicStartDate.lte
        instanceof Date,
    );
    assertActiveEnrollmentScope(
      dashboardCourseWhere.AND[0].OR[0].cohorts.some.cohort.intakeProgramOffering.is.programEnrollments.some,
    );
    assert.deepEqual(
      dashboardCourseWhere.AND[0].OR[1].cohorts.some.cohort.enrolments.some,
      { studentId: 'student-1' },
    );
    assertActiveEnrollmentScope(
      dashboardCourseWhere.AND[0].OR[1].cohorts.some.cohort.intakeProgramOffering.is.programEnrollments.some,
    );
    assert.ok(dashboardCourseWhere.AND[1].OR[1].startDate.lte instanceof Date);
    assert.ok(dashboardCourseWhere.AND[2].OR[1].endDate.gte instanceof Date);
    assert.deepEqual(attemptQuery.select, {
      id: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      maxScore: true,
      status: true,
      resultsReleasedAt: true,
      assessment: {
        select: {
          title: true,
          type: true,
          resultsReleased: true,
          programOfferingId: true,
        },
      },
    });
    assert.equal(assessmentQuery.where.status, 'PUBLISHED');
    const courseAccess = assessmentQuery.where.course;
    assert.equal(courseAccess.status, 'PUBLISHED');
    assertActiveEnrollmentScope(
      courseAccess.AND[0].OR[0].programme.is.intakeOfferings.some.programEnrollments.some,
    );
    assertActiveEnrollmentScope(
      courseAccess.AND[0].OR[0].cohorts.some.cohort.intakeProgramOffering.is.programEnrollments.some,
    );
    assert.deepEqual(
      courseAccess.AND[0].OR[1].cohorts.some.cohort.enrolments.some,
      { studentId: 'student-1' },
    );
    assertActiveEnrollmentScope(
      courseAccess.AND[0].OR[1].cohorts.some.cohort.intakeProgramOffering.is.programEnrollments.some,
    );
    assert.ok(courseAccess.AND[1].OR[1].startDate.lte instanceof Date);
    assert.ok(courseAccess.AND[2].OR[1].endDate.gte instanceof Date);
    assertActiveEnrollmentScope(
      liveClassQuery.where.cohort.programme.intakeOfferings.some.programEnrollments.some,
    );
    assertActiveEnrollmentScope(
      liveClassQuery.where.cohort.intakeProgramOffering.is.programEnrollments.some,
    );
    assert.ok(
      liveClassQuery.where.cohort.intakeProgramOffering.is.intake.is.academicStartDate.lte
        instanceof Date,
    );
    assert.deepEqual(liveClassQuery.where.cohort.enrolments.some, { studentId: 'student-1' });
    assert.deepEqual(assessmentQuery.select.attempts, {
      where: { studentId: 'student-1' },
      select: { id: true },
    });
    assert.deepEqual(notificationQuery.where.audienceStatus, 'CLASSIFIED');
    assert.deepEqual(notificationQuery.where.OR, [
      { isGlobal: true },
      { isGlobal: false, programmeId: 'programme-1', programOfferingId: null },
      { isGlobal: false, programmeId: 'programme-1', programOfferingId: 'offering-1' },
    ]);
    assert.equal(assessmentQuery.select.attemptLimit, true);
    assert.deepEqual(response.body.data.upcomingAssessments.map(({ id }) => id), ['available']);
    assert.equal(response.body.data.attempts[0].score, null);
    assert.equal(response.body.data.attempts[0].maxScore, null);
    assert.equal(response.body.data.attempts[0].resultsPending, true);
    assert.equal('attempts' in response.body.data.upcomingAssessments[0], false);
    assert.equal(response.body.data.upcomingLiveClasses.length, 0);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('trainer dashboard includes cohorts assigned through their courses', async () => {
  let courseQuery;
  let cohortQuery;
  let learnerQuery;
  let completedLessonQuery;
  let totalLessonQuery;
  let assessmentActivityQuery;
  let liveClassQuery;
  const restores = [
    stubMethod(prisma.course, 'findMany', async (query) => {
      courseQuery = query;
      return [];
    }),
    stubMethod(prisma.cohort, 'findMany', async (query) => {
      cohortQuery = query;
      return [{ id: 'cohort-1', name: 'Cohort', status: 'ACTIVE', _count: { enrolments: 3 } }];
    }),
    stubMethod(prisma.user, 'count', async (query) => {
      learnerQuery = query;
      return 3;
    }),
    stubMethod(prisma.lessonProgress, 'count', async (query) => {
      completedLessonQuery = query;
      return 7;
    }),
    stubMethod(prisma.lesson, 'count', async (query) => {
      totalLessonQuery = query;
      return 10;
    }),
    stubMethod(prisma.assessmentAttempt, 'count', async (query) => {
      assessmentActivityQuery = query;
      return 4;
    }),
    stubMethod(prisma.liveClass, 'findMany', async (query) => {
      liveClassQuery = query;
      return [{ id: 'class-1', title: 'Upcoming', startsAt: new Date() }];
    }),
    stubMethod(prisma.liveClass, 'count', async () => 6),
  ];
  const response = createResponse();
  try {
    await trainerDashboard({ user: { id: 'trainer-1' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(courseQuery.select, { id: true, title: true, description: true, status: true });
    assert.deepEqual(cohortQuery.select, {
      id: true,
      name: true,
      status: true,
      programme: { select: { title: true } },
      _count: { select: { enrolments: true } },
    });
    assert.deepEqual(learnerQuery.where.enrolments.some.cohort, cohortQuery.where);
    assert.equal(learnerQuery.where.role.name, 'STUDENT');
    assert.deepEqual(completedLessonQuery.where.lesson.module.course, courseQuery.where);
    assert.deepEqual(totalLessonQuery.where.module.course, courseQuery.where);
    assert.deepEqual(assessmentActivityQuery.where.assessment.course, courseQuery.where);
    assert.deepEqual(liveClassQuery.where.OR, [
      { createdById: 'trainer-1' },
      { course: { trainers: { some: { trainerId: 'trainer-1' } } } },
      { cohort: { trainers: { some: { trainerId: 'trainer-1' } } } },
    ]);
    assert.deepEqual(response.body.data.metrics, {
      learnerCount: 3,
      completedLessons: 7,
      totalLessons: 10,
      assessmentAttempts: 4,
      upcomingLiveClassCount: 6,
    });
    assert.equal(response.body.data.upcomingLiveClasses.length, 1);
    assert.deepEqual(cohortQuery.where.OR, [
      { trainers: { some: { trainerId: 'trainer-1' } } },
      { courses: { some: { course: { trainers: { some: { trainerId: 'trainer-1' } } } } } },
    ]);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
