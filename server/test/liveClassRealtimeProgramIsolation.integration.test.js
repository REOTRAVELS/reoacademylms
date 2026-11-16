import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as createSocketClient } from 'socket.io-client';

process.env.JWT_SECRET ||= 'live-class-socket-program-isolation-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }, { env }, {
  attachLiveClassRealtime,
  revalidateLiveClassAccess,
}] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
  import('../src/config/env.js'),
  import('../src/services/liveClassRealtime.js'),
]);

const student = { id: 'student-a', status: 'ACTIVE', role: { name: 'STUDENT' } };

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const waitForAck = (socket, event, data) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 3000);
  socket.emit(event, data, (response) => {
    clearTimeout(timeout);
    resolve(response);
  });
});

test('Socket.IO join and interaction events reject another Program by class id', async () => {
  const enrollmentQueries = [];
  let studentEnrolled = true;
  const classes = new Map([
    ['class-a', {
      id: 'class-a', title: 'Program A class', roomName: 'room-a', courseId: 'course-a',
      cohortId: 'cohort-a', createdById: 'trainer-a', status: 'LIVE', startsAt: new Date(), durationMins: 60,
    }],
    ['class-b', {
      id: 'class-b', title: 'Program B class', roomName: 'room-b', courseId: 'course-b',
      cohortId: 'cohort-b', createdById: 'trainer-b', status: 'LIVE', startsAt: new Date(), durationMins: 60,
    }],
  ]);
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.liveClass, 'findUnique', async ({ where }) => classes.get(where.id) || null),
    stubMethod(prisma.enrolment, 'findFirst', async ({ where }) => {
      enrollmentQueries.push(where);
      return where.cohortId === 'cohort-a' && studentEnrolled ? { id: 'enrollment-a' } : null;
    }),
    stubMethod(prisma.liveClassInteraction, 'findMany', async () => []),
    stubMethod(prisma.liveClassInteraction, 'findUnique', async () => null),
    stubMethod(prisma.liveClassInteraction, 'updateMany', async () => ({ count: 0 })),
    stubMethod(prisma.liveClassPresence, 'findFirst', async () => null),
    stubMethod(prisma.liveClassPresence, 'create', async ({ data }) => ({ id: 'presence-a', ...data })),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      liveClassPresence: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: 'presence-a', ...data }),
      },
    })),
  ];
  const previousLiveKitConfig = {
    url: env.livekitUrl,
    key: env.livekitApiKey,
    secret: env.livekitApiSecret,
  };
  env.livekitUrl = undefined;
  env.livekitApiKey = undefined;
  env.livekitApiSecret = undefined;
  const httpServer = createServer(app);
  const ioServer = attachLiveClassRealtime(httpServer);
  let socket;
  let reconnectingSocket;

  try {
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    socket = createSocketClient(`http://127.0.0.1:${httpServer.address().port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    const foreignJoin = await waitForAck(socket, 'classroom:join', { liveClassId: 'class-b' });
    assert.equal(foreignJoin.success, false);

    const validJoin = await waitForAck(socket, 'classroom:join', { liveClassId: 'class-a' });
    assert.equal(validJoin.success, true);

    const foreignInteraction = await waitForAck(socket, 'classroom:interaction:create', {
      liveClassId: 'class-b',
      type: 'CHAT',
      payload: { text: 'Attempt to send into another Program.' },
      clientEventId: 'foreign-interaction',
    });
    assert.equal(foreignInteraction.success, false);
    assert.match(foreignInteraction.message, /join this live class|cannot join/i);
    assert.ok(enrollmentQueries.every((where) => (
      where.cohort.programme.intakeOfferings.some.programEnrollments.some.studentId === student.id
      && where.cohort.programme.intakeOfferings.some.programEnrollments.some.status === 'ACTIVE'
    )));

    let restrictedBroadcastReceived = false;
    socket.on('classroom:restricted-test', () => { restrictedBroadcastReceived = true; });
    studentEnrolled = false;
    await revalidateLiveClassAccess();
    ioServer.to('live-class:class-a').emit('classroom:restricted-test', { message: 'not for revoked students' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(socket.connected, false);
    assert.equal(restrictedBroadcastReceived, false);

    reconnectingSocket = createSocketClient(`http://127.0.0.1:${httpServer.address().port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
    });
    await new Promise((resolve, reject) => {
      reconnectingSocket.once('connect', resolve);
      reconnectingSocket.once('connect_error', reject);
    });
    const revokedRejoin = await waitForAck(reconnectingSocket, 'classroom:join', { liveClassId: 'class-a' });
    assert.equal(revokedRejoin.success, false);
    reconnectingSocket.disconnect();
  } finally {
    socket?.disconnect();
    reconnectingSocket?.disconnect();
    await new Promise((resolve) => ioServer.close(resolve));
    restores.reverse().forEach((restore) => restore());
    env.livekitUrl = previousLiveKitConfig.url;
    env.livekitApiKey = previousLiveKitConfig.key;
    env.livekitApiSecret = previousLiveKitConfig.secret;
  }
});
