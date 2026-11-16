import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'intake-access-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
const startDate = new Date(Date.now() + 60 * 60 * 1000);
const waitingEnrollment = {
  id: 'enrollment-1',
  studentId: student.id,
  programmeId: 'programme-1',
  programOfferingId: 'offering-1',
  intakeId: 'intake-1',
  status: 'ACTIVE',
  effectiveAt: new Date(Date.now() - 60 * 60 * 1000),
  endedAt: null,
  application: { status: 'APPROVED' },
  student,
  programOffering: {
    programmeId: 'programme-1',
    intakeId: 'intake-1',
    programme: { title: 'Travel Operations' },
    intake: {
      id: 'intake-1',
      gateNumber: 1,
      season: 'WINTER',
      year: 2027,
      academicStartDate: startDate,
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

const send = (server, path) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
  headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
});

test('future-Intake students receive only a waiting dashboard and are blocked from academic routes', async () => {
  let academicDashboardQueries = 0;
  let courseQueries = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async ({ where }) => {
      const startFilter = where.programOffering?.is?.intake?.is?.academicStartDate;
      const intakeStart = waitingEnrollment.programOffering.intake.academicStartDate;
      if (startFilter?.gt && intakeStart > startFilter.gt) return waitingEnrollment;
      if (startFilter?.lte && intakeStart <= startFilter.lte) return waitingEnrollment;
      return null;
    }),
    stubMethod(prisma.enrolment, 'findMany', async () => {
      academicDashboardQueries += 1;
      return [];
    }),
    stubMethod(prisma.course, 'findMany', async () => {
      courseQueries += 1;
      return [];
    }),
  ];
  let server;
  try {
    server = await startServer();

    const authResponse = await send(server, '/auth/me');
    assert.equal(authResponse.status, 200);
    const auth = (await authResponse.json()).data;
    assert.equal(auth.academicAccess, false);
    assert.equal(auth.intakeAccessState, 'WAITING');
    assert.equal(auth.intake.id, 'intake-1');

    const dashboardResponse = await send(server, '/dashboard/student');
    assert.equal(dashboardResponse.status, 200);
    const dashboard = (await dashboardResponse.json()).data;
    assert.equal(dashboard.accessState, 'WAITING_FOR_INTAKE');
    assert.deepEqual(Object.keys(dashboard).sort(), ['accessState', 'intake', 'serverNow']);
    assert.equal(dashboard.intake.programmeTitle, 'Travel Operations');

    const coursesResponse = await send(server, '/courses');
    assert.equal(coursesResponse.status, 403);
    const denied = await coursesResponse.json();
    assert.equal(denied.code, 'ACADEMIC_ACCESS_NOT_STARTED');
    assert.equal(denied.intake.id, 'intake-1');
    assert.equal(academicDashboardQueries, 0);
    assert.equal(courseQueries, 0);

    waitingEnrollment.programOffering.intake.academicStartDate = new Date(Date.now() - 1_000);
    const startedCourseResponse = await send(server, '/courses');
    assert.equal(startedCourseResponse.status, 200);
    assert.equal(courseQueries, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
