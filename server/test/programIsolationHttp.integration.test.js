import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'program-isolation-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const student = { id: 'student-a', status: 'ACTIVE', role: { name: 'STUDENT' } };
const activeEnrollment = {
  id: 'enrollment-a',
  studentId: student.id,
  programmeId: 'programme-a',
  programOfferingId: 'offering-a',
  intakeId: 'intake-a',
  status: 'ACTIVE',
  effectiveAt: new Date(Date.now() - 60_000),
  endedAt: null,
  applicationId: null,
  student,
  programOffering: {
    programmeId: 'programme-a',
    intakeId: 'intake-a',
    academicStartDate: new Date(Date.now() - 60_000),
    programme: { title: 'Program A' },
    intake: {
      id: 'intake-a',
      gateNumber: 1,
      season: 'WINTER',
      year: 2027,
      timezone: 'UTC',
    },
  },
};

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const startServer = async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const send = (server, path, { method = 'GET', body } = {}) => fetch(
  `http://127.0.0.1:${server.address().port}/api${path}`,
  {
    method,
    headers: {
      Cookie: `reoa_session=${signToken({ sub: student.id })}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
);

const assertActiveEnrollmentScope = (where) => {
  assert.equal(where.studentId, student.id);
  assert.equal(where.status, 'ACTIVE');
  assert.ok(where.effectiveAt.lte instanceof Date);
  assert.equal(where.student.is.status, 'ACTIVE');
  assert.equal(where.student.is.role.is.name, 'STUDENT');
  assert.ok(where.AND[0].OR[1].endedAt.gt instanceof Date);
  assert.equal(where.AND[1].OR[1].application.is.status, 'APPROVED');
};

test('active Program membership blocks unassigned and cross-Program API requests', async () => {
  let hasProgramEnrollment = false;
  const courseAccessQueries = [];
  let courseListQuery;
  let assignmentSubmissions = 0;
  let assessmentAttempts = 0;
  let lessonProgressWrites = 0;
  let liveClassEnrollmentQuery;
  let resourceListQuery;
  let announcementQuery;
  let notificationListQuery;
  let notificationCountQuery;
  let notificationUpdateQuery;
  let dashboardNotificationQuery;
  let dashboardEnrollmentQuery;
  let certificateListQuery;
  let certificateDownloadQuery;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => (
      hasProgramEnrollment
        ? activeEnrollment
        : null
    )),
    stubMethod(prisma.programEnrollment, 'findMany', async () => ([
      { programmeId: 'programme-a', programOfferingId: 'offering-a' },
    ])),
    stubMethod(prisma.course, 'findFirst', async (query) => {
      courseAccessQueries.push(query);
      return null;
    }),
    stubMethod(prisma.course, 'findMany', async (query) => {
      if (query.where.programmeId === 'programme-b') courseListQuery = query;
      return [];
    }),
    stubMethod(prisma.course, 'findUnique', async () => ({
      id: 'course-b',
      title: 'Foreign course',
      status: 'PUBLISHED',
      completionRequirements: '{}',
      modules: [],
      trainers: [],
      resources: [],
    })),
    stubMethod(prisma.lesson, 'findUnique', async () => ({
      id: 'lesson-b',
      isPublished: true,
      module: {
        courseId: 'course-b',
        course: {
          id: 'course-b',
          title: 'Foreign course',
          status: 'PUBLISHED',
          programmeId: 'programme-b',
          visibility: 'public',
          startDate: null,
          endDate: null,
          cohorts: [],
        },
      },
    })),
    stubMethod(prisma.lessonProgress, 'upsert', async () => {
      lessonProgressWrites += 1;
      return {};
    }),
    stubMethod(prisma.resource, 'findMany', async (query) => {
      resourceListQuery = query;
      return [];
    }),
    stubMethod(prisma.resource, 'findUnique', async () => ({
      id: 'resource-b',
      courseId: 'course-b',
      course: { id: 'course-b', status: 'PUBLISHED' },
      lesson: null,
      storagePath: 'not-accessed',
      originalName: 'foreign.pdf',
      mimeType: 'application/pdf',
    })),
    stubMethod(prisma.assessment, 'findUnique', async () => ({
      id: 'assessment-b',
      courseId: 'course-b',
      status: 'PUBLISHED',
      availableFrom: null,
      availableTo: null,
      questions: [],
    })),
    stubMethod(prisma.assessmentAttempt, 'findUnique', async () => ({
      id: 'attempt-b',
      studentId: student.id,
      assessment: { courseId: 'course-b' },
      submittedAt: new Date(),
    })),
    stubMethod(prisma.assessmentAttempt, 'create', async () => {
      assessmentAttempts += 1;
      return {};
    }),
    stubMethod(prisma.assignment, 'findUnique', async () => ({
      id: 'assignment-b',
      courseId: 'course-b',
      status: 'PUBLISHED',
      dueDate: null,
      lessonId: null,
    })),
    stubMethod(prisma.submission, 'create', async () => {
      assignmentSubmissions += 1;
      return {};
    }),
    stubMethod(prisma.liveClass, 'findUnique', async () => ({
      id: 'class-b',
      title: 'Foreign live class',
      roomName: 'room-b',
      courseId: 'course-b',
      cohortId: 'cohort-b',
      createdById: 'trainer-b',
      status: 'LIVE',
      startsAt: new Date(),
      durationMins: 60,
    })),
    stubMethod(prisma.enrolment, 'findFirst', async (query) => {
      liveClassEnrollmentQuery = query;
      return null;
    }),
    stubMethod(prisma.enrolment, 'findMany', async (query) => {
      if (query.where.studentId === student.id) {
        dashboardEnrollmentQuery = query;
        return [];
      }
      return [{ cohortId: 'cohort-a', cohort: { courses: [{ courseId: 'course-a' }] } }];
    }),
    stubMethod(prisma.announcement, 'findMany', async (query) => {
      announcementQuery = query;
      return [];
    }),
    stubMethod(prisma.notification, 'findMany', async (query) => {
      if (query.where.read === false) dashboardNotificationQuery = query;
      else notificationListQuery = query;
      return [];
    }),
    stubMethod(prisma.notification, 'count', async ({ where }) => {
      notificationCountQuery = where;
      return 0;
    }),
    stubMethod(prisma.notification, 'updateMany', async ({ where }) => {
      notificationUpdateQuery = where;
      return { count: 0 };
    }),
    stubMethod(prisma.assessment, 'findMany', async () => []),
    stubMethod(prisma.assessmentAttempt, 'findMany', async () => []),
    stubMethod(prisma.liveClass, 'findMany', async () => []),
    stubMethod(prisma.certificate, 'findMany', async (query) => {
      certificateListQuery = query;
      return [];
    }),
    stubMethod(prisma.certificate, 'findFirst', async (query) => {
      certificateDownloadQuery = query;
      return null;
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({})),
  ];
  let server;
  try {
    server = await startServer();

    const inaccessibleCourse = await send(server, '/courses/course-b');
    assert.equal(inaccessibleCourse.status, 403);
    assert.equal((await send(server, '/resources/resource-b/download')).status, 403);
    assert.equal((await send(server, '/assessments/assessment-b')).status, 403);
    assert.equal((await send(server, '/progress/me')).status, 403);
    assert.equal((await send(server, '/progress/access', {
      method: 'POST',
      body: { lessonId: 'lesson-b' },
    })).status, 403);
    assert.equal((await send(server, '/live-classes/class-b/join', { method: 'POST' })).status, 403);
    assert.equal((await send(server, '/notifications/announcements')).status, 403);
    assert.equal(courseAccessQueries.length, 0);

    hasProgramEnrollment = true;
    const courseList = await send(server, '/courses?programmeId=programme-b');
    assert.equal(courseList.status, 200);
    assert.equal(courseAccessQueries.length, 0);
    assert.equal(courseListQuery.where.programmeId, 'programme-b');
    assertActiveEnrollmentScope(
      courseListQuery.where.AND[0].OR[0].programme.is.intakeOfferings.some.programEnrollments.some,
    );

    const foreignCourse = await send(server, '/courses/course-b');
    assert.equal(foreignCourse.status, 404);
    assert.equal(courseAccessQueries.at(-1).where.id, 'course-b');
    assertActiveEnrollmentScope(
      courseAccessQueries.at(-1).where.AND[0].OR[0].cohorts.some.cohort.intakeProgramOffering.is.programEnrollments.some,
    );

    const foreignLesson = await send(server, '/courses/lessons/lesson-b');
    assert.equal(foreignLesson.status, 404);

    const foreignResourceList = await send(server, '/resources?courseId=course-b');
    assert.equal(foreignResourceList.status, 200);
    assert.equal(resourceListQuery.where.courseId, 'course-b');
    assert.ok(resourceListQuery.where.OR.some((filter) => filter.course?.AND));

    const foreignResourceDownload = await send(server, '/resources/resource-b/download');
    assert.equal(foreignResourceDownload.status, 404);

    const foreignAssessment = await send(server, '/assessments/assessment-b');
    assert.equal(foreignAssessment.status, 404);
    const foreignAssessmentAttempt = await send(server, '/assessments/assessment-b/attempts', { method: 'POST' });
    assert.equal(foreignAssessmentAttempt.status, 403);
    const foreignAttemptId = await send(server, '/assessments/attempts/attempt-b');
    assert.equal(foreignAttemptId.status, 404);

    const foreignAssignment = await send(server, '/courses/assignments/assignment-b/submit', {
      method: 'POST',
      body: { content: 'Attempt to submit to another Program.' },
    });
    assert.equal(foreignAssignment.status, 403);

    const foreignProgress = await send(server, '/progress/complete', {
      method: 'POST',
      body: { lessonId: 'lesson-b' },
    });
    assert.equal(foreignProgress.status, 404);
    const foreignProgressAccess = await send(server, '/progress/access', {
      method: 'POST',
      body: { lessonId: 'lesson-b' },
    });
    assert.equal(foreignProgressAccess.status, 404);

    const foreignLiveClass = await send(server, '/live-classes/class-b/join', { method: 'POST' });
    assert.equal(foreignLiveClass.status, 404);
    assertActiveEnrollmentScope(
      liveClassEnrollmentQuery.where.cohort.programme.intakeOfferings.some.programEnrollments.some,
    );
    assertActiveEnrollmentScope(
      liveClassEnrollmentQuery.where.cohort.intakeProgramOffering.is.programEnrollments.some,
    );

    const foreignAnnouncement = await send(server, '/notifications/announcements?courseId=course-b');
    assert.equal(foreignAnnouncement.status, 200);
    assert.equal(announcementQuery.where.courseId, 'course-b');
    assert.ok(announcementQuery.where.OR.every((filter) => !filter.courseId?.in?.includes('course-b')));

    const notifications = await send(server, '/notifications');
    assert.equal(notifications.status, 200);
    assert.equal(notificationListQuery.where.userId, student.id);
    assert.equal(notificationListQuery.where.audienceStatus, 'CLASSIFIED');
    assert.ok(notificationListQuery.where.OR.some((filter) => filter.isGlobal === true));
    assert.ok(notificationListQuery.where.OR.some((filter) => (
      filter.programmeId === 'programme-a' && filter.programOfferingId === null
    )));
    assert.ok(notificationListQuery.where.OR.some((filter) => (
      filter.programmeId === 'programme-a' && filter.programOfferingId === 'offering-a'
    )));
    assert.equal((await send(server, '/notifications/unread-count')).status, 200);
    assert.equal(notificationCountQuery.audienceStatus, 'CLASSIFIED');
    assert.ok(notificationCountQuery.OR.some((filter) => filter.programOfferingId === 'offering-a'));
    assert.equal((await send(server, '/notifications/cross-program-notification/read', { method: 'PUT' })).status, 200);
    assert.equal(notificationUpdateQuery.userId, student.id);
    assert.equal(notificationUpdateQuery.audienceStatus, 'CLASSIFIED');
    assert.ok(notificationUpdateQuery.OR.some((filter) => (
      filter.programmeId === 'programme-a' && filter.programOfferingId === 'offering-a'
    )));

    const studentDashboard = await send(server, '/dashboard/student');
    assert.equal(studentDashboard.status, 200);
    const dashboardCourseFilter = dashboardEnrollmentQuery.select.cohort.select.courses.where.course;
    assert.equal(dashboardCourseFilter.status, 'PUBLISHED');
    assertActiveEnrollmentScope(
      dashboardCourseFilter.AND[0].OR[0].programme.is.intakeOfferings.some.programEnrollments.some,
    );
    assert.equal(dashboardNotificationQuery.where.userId, student.id);
    assert.equal(dashboardNotificationQuery.where.audienceStatus, 'CLASSIFIED');
    assert.ok(dashboardNotificationQuery.where.OR.some((filter) => filter.isGlobal === true));
    assert.ok(dashboardNotificationQuery.where.OR.some((filter) => (
      filter.programmeId === 'programme-a' && filter.programOfferingId === 'offering-a'
    )));

    const certificates = await send(server, '/courses/certificates');
    assert.equal(certificates.status, 200);
    assert.equal(certificateListQuery.where.studentId, student.id);
    assert.ok(certificateListQuery.where.course.is.OR[0].programme.is);
    const certificateDownload = await send(
      server,
      '/courses/certificates/download/certificate-course-b-123.pdf',
    );
    assert.equal(certificateDownload.status, 404);
    assert.equal(certificateDownloadQuery.where.studentId, student.id);
    assert.ok(certificateDownloadQuery.where.course.is.OR[0].programme.is);

    assert.equal(assessmentAttempts, 0);
    assert.equal(assignmentSubmissions, 0);
    assert.equal(lessonProgressWrites, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
