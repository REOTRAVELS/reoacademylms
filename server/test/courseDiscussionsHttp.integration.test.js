import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'course-discussions-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const users = {
  'student-a': { id: 'student-a', status: 'ACTIVE', firstName: 'Ana', lastName: 'Learner', role: { name: 'STUDENT' } },
  'student-b': { id: 'student-b', status: 'ACTIVE', firstName: 'Ben', lastName: 'Learner', role: { name: 'STUDENT' } },
  'student-c': { id: 'student-c', status: 'ACTIVE', firstName: 'Cam', lastName: 'Learner', role: { name: 'STUDENT' } },
  'tutor-a': { id: 'tutor-a', status: 'ACTIVE', firstName: 'Tara', lastName: 'Tutor', role: { name: 'TRAINER' } },
  'tutor-b': { id: 'tutor-b', status: 'ACTIVE', firstName: 'Theo', lastName: 'Tutor', role: { name: 'TRAINER' } },
  admin: { id: 'admin', status: 'ACTIVE', firstName: 'Ari', lastName: 'Admin', role: { name: 'SUPER_ADMIN' } },
};

const courseSeeds = {
  'course-a': {
    id: 'course-a',
    title: 'Travel Operations',
    programmeId: 'programme-a',
    status: 'PUBLISHED',
    cohorts: [{
      cohort: {
        id: 'cohort-a',
        programmeId: 'programme-a',
        intakeProgramOfferingId: 'offering-a',
        trainerIds: ['tutor-a'],
        studentIds: ['student-a', 'student-c'],
      },
    }],
  },
  'course-b': {
    id: 'course-b',
    title: 'Travel Agency Management',
    programmeId: 'programme-b',
    status: 'PUBLISHED',
    cohorts: [{
      cohort: {
        id: 'cohort-b',
        programmeId: 'programme-b',
        intakeProgramOfferingId: 'offering-b',
        trainerIds: ['tutor-b'],
        studentIds: ['student-b'],
      },
    }],
  },
};

const activeOfferings = {
  'student-a': ['offering-a'],
  'student-b': ['offering-b'],
  'student-c': ['offering-a'],
};

const offeringSeed = {
  'offering-a': {
    id: 'offering-a',
    programmeId: 'programme-a',
    intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
  },
  'offering-b': {
    id: 'offering-b',
    programmeId: 'programme-b',
    intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
  },
};

let currentUserId = '';
let postSequence = 0;
let reportSequence = 0;
let eventSequence = 0;
let posts;
let reports;
let events;
let sentNotifications;
let notificationDeliveries;

const copy = (value) => structuredClone(value);
const postAuthor = (authorId) => ({
  id: authorId,
  firstName: users[authorId]?.firstName,
  lastName: users[authorId]?.lastName,
  role: users[authorId]?.role,
});
const matchesPostWhere = (post, where) => {
  if (where.id && post.id !== where.id) return false;
  if (where.courseId && post.courseId !== where.courseId) return false;
  if (where.programmeId && post.programmeId !== where.programmeId) return false;
  if (where.programOfferingId?.in && !where.programOfferingId.in.includes(post.programOfferingId)) return false;
  if (where.programOfferingId && typeof where.programOfferingId === 'string'
    && post.programOfferingId !== where.programOfferingId) return false;
  if (Object.hasOwn(where, 'parentId') && post.parentId !== where.parentId) return false;
  if (where.type && post.type !== where.type) return false;
  if (where.deletedAt === null && post.deletedAt) return false;
  if (where.OR?.length && !where.OR.some((filter) => (
    post.title?.toLowerCase().includes(filter.title?.contains?.toLowerCase() || '\u0000')
    || post.body.toLowerCase().includes(filter.body?.contains?.toLowerCase() || '\u0000')
  ))) return false;
  return true;
};

const asPostResult = (post) => ({
  ...copy(post),
  author: postAuthor(post.authorId),
  _count: { replies: [...posts.values()].filter((item) => item.parentId === post.id && !item.deletedAt).length },
});

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

const send = (server, userId, path, { method = 'GET', body } = {}) => fetch(
  `http://127.0.0.1:${server.address().port}/api${path}`,
  {
    method,
    headers: {
      Cookie: `reoa_session=${signToken({ sub: userId })}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
);

const installMocks = () => {
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => {
      currentUserId = where.id;
      return users[where.id] || null;
    }),
    stubMethod(prisma.programEnrollment, 'findFirst', async ({ where }) => {
      const offeringId = activeOfferings[where.studentId]?.[0];
      return where.status === 'ACTIVE' && offeringId
        ? { id: `enrollment-${where.studentId}`, programmeId: offeringSeed[offeringId].programmeId, programOfferingId: offeringId }
        : null;
    }),
    stubMethod(prisma.programEnrollment, 'findMany', async ({ where }) => {
      if (typeof where.programOfferingId === 'string') {
        return Object.entries(activeOfferings)
          .filter(([studentId, ids]) => ids.includes(where.programOfferingId)
            && users[studentId]?.role.name === 'STUDENT'
            && courseSeeds['course-a'].cohorts.some(({ cohort }) => (
              cohort.intakeProgramOfferingId === where.programOfferingId
              && cohort.studentIds.includes(studentId)
            )))
          .map(([studentId]) => ({ studentId }));
      }
      const ids = where.programOfferingId?.in || [];
      return (activeOfferings[where.studentId] || [])
        .filter((id) => ids.includes(id) && offeringSeed[id]?.programmeId === where.programmeId)
        .map((programOfferingId) => ({ programOfferingId }));
    }),
    stubMethod(prisma.course, 'findUnique', async ({ where, select }) => {
      const course = courseSeeds[where.id];
      if (!course) return null;
      const requestedStudentId = select?.cohorts?.select?.cohort?.select?.enrolments?.where?.studentId;
      return {
        ...copy(course),
        cohorts: course.cohorts.map(({ cohort }) => ({
          cohort: {
            ...copy(cohort),
            trainers: cohort.trainerIds.map((trainerId) => ({ trainerId })),
            enrolments: cohort.studentIds.includes(requestedStudentId) ? [{ id: `enrolment-${requestedStudentId}` }] : [],
          },
        })),
      };
    }),
    stubMethod(prisma.course, 'findFirst', async ({ where }) => {
      const course = courseSeeds[where.id];
      const hasAssignedCohort = course?.cohorts.some(({ cohort }) => (
        cohort.studentIds.includes(currentUserId)
        && (activeOfferings[currentUserId] || []).includes(cohort.intakeProgramOfferingId)
      ));
      return hasAssignedCohort ? { id: where.id } : null;
    }),
    stubMethod(prisma.courseTrainer, 'findUnique', async ({ where }) => (
      ['tutor-a', 'tutor-b'].includes(where.courseId_trainerId.trainerId)
        && where.courseId_trainerId.courseId === 'course-a'
        ? { id: 'course-trainer-assignment' }
        : null
    )),
    stubMethod(prisma.intakeProgramOffering, 'findMany', async ({ where }) => (
      (where.id?.in || []).map((id) => offeringSeed[id]).filter(Boolean)
    )),
    stubMethod(prisma.lesson, 'findFirst', async ({ where }) => (
      where.module.courseId === 'course-a' && where.id === 'lesson-a' ? { id: 'lesson-a' } : null
    )),
    stubMethod(prisma.courseDiscussionPost, 'findUnique', async ({ where }) => {
      const post = posts.get(where.id);
      return post ? copy(post) : null;
    }),
    stubMethod(prisma.courseDiscussionPost, 'findFirst', async ({ where }) => {
      const post = posts.get(where.id);
      return post && matchesPostWhere(post, where) ? { id: post.id } : null;
    }),
    stubMethod(prisma.courseDiscussionPost, 'findMany', async ({ where, take, cursor, skip }) => {
      let items = [...posts.values()].filter((post) => matchesPostWhere(post, where));
      items.sort((a, b) => {
        if (where.parentId === null && a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned);
        const order = new Date(a.createdAt) - new Date(b.createdAt);
        return where.parentId === null ? -order : order;
      });
      if (cursor?.id) {
        const index = items.findIndex(({ id }) => id === cursor.id);
        items = index < 0 ? [] : items.slice(index + (skip || 0));
      }
      return items.slice(0, take).map(asPostResult);
    }),
    stubMethod(prisma.courseDiscussionPost, 'create', async ({ data }) => {
      postSequence += 1;
      const post = {
        id: `post-${postSequence}`,
        ...copy(data),
        isAnnouncement: data.isAnnouncement || false,
        isPinned: false,
        isLocked: false,
        isResolved: false,
        deletedAt: null,
        deletedById: null,
        moderationReason: null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      posts.set(post.id, post);
      return asPostResult(post);
    }),
    stubMethod(prisma.courseDiscussionPost, 'update', async ({ where, data }) => {
      const post = posts.get(where.id);
      if (!post) throw new Error('Missing post');
      Object.assign(post, copy(data), { updatedAt: new Date().toISOString() });
      return asPostResult(post);
    }),
    stubMethod(prisma.courseDiscussionReport, 'create', async ({ data }) => {
      if ([...reports.values()].some((report) => report.postId === data.postId && report.reporterId === data.reporterId)) {
        throw Object.assign(new Error('Unique report'), { code: 'P2002' });
      }
      reportSequence += 1;
      const report = { id: `report-${reportSequence}`, ...copy(data), status: 'OPEN', createdAt: new Date().toISOString() };
      reports.set(report.id, report);
      return copy(report);
    }),
    stubMethod(prisma.courseDiscussionReport, 'findUnique', async ({ where }) => copy(reports.get(where.id) || null)),
    stubMethod(prisma.courseDiscussionReport, 'findFirst', async ({ where }) => {
      const report = reports.get(where.id);
      return report ? { id: report.id } : null;
    }),
    stubMethod(prisma.courseDiscussionReport, 'findMany', async ({ where, take }) => {
      const items = [...reports.values()].filter((report) => (
        (where.status === undefined || report.status === where.status)
        && (!where.post?.courseId || posts.get(report.postId)?.courseId === where.post.courseId)
        && (!where.post?.programOfferingId?.in || where.post.programOfferingId.in.includes(posts.get(report.postId)?.programOfferingId))
      )).slice(0, take);
      return items.map((report) => ({
        ...copy(report),
        reporter: postAuthor(report.reporterId),
        reviewedBy: report.reviewedById ? postAuthor(report.reviewedById) : null,
        post: asPostResult(posts.get(report.postId)),
      }));
    }),
    stubMethod(prisma.courseDiscussionReport, 'update', async ({ where, data }) => {
      const report = reports.get(where.id);
      Object.assign(report, copy(data));
      return copy(report);
    }),
    stubMethod(prisma.courseDiscussionModeration, 'create', async ({ data }) => {
      eventSequence += 1;
      const event = { id: `event-${eventSequence}`, ...copy(data), createdAt: new Date().toISOString() };
      events.push(event);
      return copy(event);
    }),
    stubMethod(prisma.courseDiscussionModeration, 'findFirst', async ({ where }) => {
      const event = events.find(({ id }) => id === where.id);
      return event ? { id: event.id } : null;
    }),
    stubMethod(prisma.courseDiscussionModeration, 'findMany', async ({ where, take }) => (
      events.filter((event) => (
        !where.post?.courseId || posts.get(event.postId)?.courseId === where.post.courseId
      )).slice(0, take).map((event) => ({
        ...copy(event),
        actor: postAuthor(event.actorId),
        post: {
          ...copy(posts.get(event.postId)),
          course: { title: courseSeeds[posts.get(event.postId).courseId].title },
        },
        report: event.reportId ? copy(reports.get(event.reportId)) : null,
      }))
    )),
    stubMethod(prisma.notification, 'createMany', async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const notification of data) {
        if (skipDuplicates && sentNotifications.has(notification.sourceKey)) continue;
        sentNotifications.add(notification.sourceKey);
        notificationDeliveries.push(copy(notification));
        count += 1;
      }
      return { count };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({})),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
  ];
  return () => restores.reverse().forEach((restore) => restore());
};

test('discussion APIs enforce exact Program Offering scope, ownership, moderation, notifications, and history', async () => {
  currentUserId = '';
  postSequence = 0;
  reportSequence = 0;
  eventSequence = 0;
  posts = new Map();
  reports = new Map();
  events = [];
  sentNotifications = new Set();
  notificationDeliveries = [];
  posts.set('topic-a', {
    id: 'topic-a',
    courseId: 'course-a',
    programmeId: 'programme-a',
    programOfferingId: 'offering-a',
    lessonId: 'lesson-a',
    parentId: null,
    type: 'TOPIC',
    title: 'How do we plan accessible routes?',
    body: 'I would appreciate advice on checking accessibility.',
    isAnnouncement: false,
    isPinned: false,
    isLocked: false,
    isResolved: false,
    authorId: 'student-a',
    editedAt: null,
    deletedAt: null,
    deletedById: null,
    moderationReason: null,
    createdAt: new Date('2026-11-14T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-11-14T10:00:00.000Z').toISOString(),
  });
  const restore = installMocks();
  let server;
  try {
    server = await startServer();

    const listed = await send(server, 'student-a', '/course-discussions/courses/course-a/discussions?search=accessible');
    assert.equal(listed.status, 200);
    const listPayload = await listed.json();
    assert.equal(listPayload.data.items[0].id, 'topic-a');
    assert.deepEqual(listPayload.data.offerings.map(({ id }) => id), ['offering-a']);
    assert.equal((await send(server, 'student-a', '/course-discussions/posts/topic-a')).status, 200);

    const crossProgramList = await send(server, 'student-b', '/course-discussions/courses/course-a/discussions?search=accessible');
    assert.equal(crossProgramList.status, 404);
    assert.equal((await send(server, 'student-b', '/course-discussions/posts/topic-a')).status, 404);
    assert.equal((await send(server, 'student-b', '/course-discussions/posts/topic-a/replies')).status, 404);
    assert.equal((await send(server, 'student-b', '/course-discussions/posts/topic-a/report', {
      method: 'POST',
      body: { reason: 'SPAM' },
    })).status, 404);
    assert.equal((await send(server, 'student-a', '/course-discussions/courses/course-a/discussions', {
      method: 'POST',
      body: {
        title: 'Unpermitted announcement',
        body: 'A student cannot publish Tutor announcements.',
        programOfferingId: 'offering-a',
        isAnnouncement: true,
      },
    })).status, 403);

    const unauthorizedOffering = await send(server, 'student-a', '/course-discussions/courses/course-a/discussions?programOfferingId=offering-b');
    assert.equal(unauthorizedOffering.status, 400);

    const reply = await send(server, 'student-c', '/course-discussions/posts/topic-a/replies', {
      method: 'POST',
      body: { body: 'Check the route details with the provider.' },
    });
    assert.equal(reply.status, 201);
    const replyData = (await reply.json()).data;
    assert.equal(replyData.parentId, 'topic-a');
    assert.ok(sentNotifications.has(`discussion-reply:${replyData.id}:student-a`));

    const crossAuthorEdit = await send(server, 'student-c', '/course-discussions/posts/topic-a', {
      method: 'PATCH',
      body: { body: 'Trying to edit another learner’s post.' },
    });
    assert.equal(crossAuthorEdit.status, 403);
    assert.equal((await send(server, 'student-a', '/course-discussions/posts/topic-a', {
      method: 'PATCH',
      body: { title: 'How should I plan an accessible route?', body: 'Check with providers and validate each transfer.' },
    })).status, 200);
    const ownTopic = await send(server, 'student-a', '/course-discussions/courses/course-a/discussions', {
      method: 'POST',
      body: {
        title: 'Another route planning question',
        body: 'What should I ask local transport providers?',
        programOfferingId: 'offering-a',
      },
    });
    assert.equal(ownTopic.status, 201);
    const ownTopicId = (await ownTopic.json()).data.id;
    assert.equal((await send(server, 'student-a', `/course-discussions/posts/${ownTopicId}`, {
      method: 'DELETE',
    })).status, 200);
    assert.ok(posts.get(ownTopicId).deletedAt);
    assert.equal(posts.get(ownTopicId).body, 'What should I ask local transport providers?');

    const report = await send(server, 'student-c', '/course-discussions/posts/topic-a/report', {
      method: 'POST',
      body: { reason: 'OTHER', details: 'Please review this post.' },
    });
    assert.equal(report.status, 201);
    const reportId = (await report.json()).data.id;
    assert.equal((await send(server, 'student-c', '/course-discussions/posts/topic-a/report', {
      method: 'POST',
      body: { reason: 'OTHER' },
    })).status, 409);

    const tutorTopic = await send(server, 'tutor-a', '/course-discussions/courses/course-a/discussions', {
      method: 'POST',
      body: {
        title: 'Updated travel guidance',
        body: 'Please review the new official guidance before advising clients.',
        programOfferingId: 'offering-a',
        isAnnouncement: true,
      },
    });
    assert.equal(tutorTopic.status, 201);
    assert.ok([...sentNotifications].some((sourceKey) => sourceKey.startsWith('discussion-announcement:')));
    assert.ok(notificationDeliveries.every((notification) => (
      notification.programmeId === 'programme-a'
      && notification.programOfferingId === 'offering-a'
      && notification.userId !== 'student-b'
    )));
    const createdTutorTopic = (await tutorTopic.json()).data;
    const pagedTopics = await send(server, 'tutor-a', '/course-discussions/courses/course-a/discussions?limit=1');
    assert.equal(pagedTopics.status, 200);
    assert.ok((await pagedTopics.json()).data.nextCursor);

    const unauthorizedTutor = await send(server, 'tutor-b', '/course-discussions/courses/course-a/discussions');
    assert.equal(unauthorizedTutor.status, 403);

    assert.equal((await send(server, 'tutor-a', '/course-discussions/posts/topic-a/moderate', {
      method: 'POST',
      body: { action: 'PIN' },
    })).status, 200);
    assert.equal((await send(server, 'tutor-a', `/course-discussions/posts/${createdTutorTopic.id}/moderate`, {
      method: 'POST',
      body: { action: 'LOCK' },
    })).status, 200);
    assert.equal((await send(server, 'student-c', `/course-discussions/posts/${createdTutorTopic.id}/replies`, {
      method: 'POST',
      body: { body: 'Can I still reply?' },
    })).status, 409);
    assert.equal((await send(server, 'tutor-a', `/course-discussions/posts/${createdTutorTopic.id}/moderate`, {
      method: 'POST',
      body: { action: 'REMOVE', reason: 'Remove this inappropriate content.' },
    })).status, 200);
    assert.equal((await send(server, 'tutor-a', `/course-discussions/posts/${createdTutorTopic.id}/moderate`, {
      method: 'POST',
      body: { action: 'PIN' },
    })).status, 409);
    assert.equal((await send(server, 'tutor-a', `/course-discussions/posts/${createdTutorTopic.id}/moderate`, {
      method: 'POST',
      body: { action: 'RESTORE', reason: 'The content has been reviewed.' },
    })).status, 200);
    assert.equal((await send(server, 'tutor-a', '/course-discussions/posts/topic-a/moderate', {
      method: 'POST',
      body: { action: 'RESOLVE' },
    })).status, 200);

    const reports = await send(server, 'admin', '/course-discussions/moderation/reports?courseId=course-a');
    assert.equal(reports.status, 200);
    assert.equal((await reports.json()).data.items[0].id, reportId);
    const reviewed = await send(server, 'admin', `/course-discussions/moderation/reports/${reportId}`, {
      method: 'PATCH',
      body: { status: 'ACTIONED', removePost: true, reason: 'Contains private information.' },
    });
    assert.equal(reviewed.status, 200);
    assert.ok(posts.get('topic-a').deletedAt);
    assert.equal(posts.get('topic-a').body, 'Check with providers and validate each transfer.');
    assert.ok(events.some(({ action, actorId }) => action === 'REPORT_ACTIONED' && actorId === 'admin'));
    assert.ok(events.some(({ action, actorId }) => action === 'REMOVE' && actorId === 'admin'));

    const history = await send(server, 'tutor-a', '/course-discussions/moderation/history?courseId=course-a&programOfferingId=offering-a');
    assert.equal(history.status, 200);
    assert.ok((await history.json()).data.items.length >= 2);
    assert.equal((await send(server, 'student-a', '/course-discussions/moderation/history')).status, 403);
  } finally {
    if (server?.listening) await closeServer(server);
    restore();
  }
});
