import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import prisma from '../src/config/database.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

const accounts = [
  {
    name: 'admin',
    email: 'admin@reotravel.academy',
    firstName: 'Reo',
    lastName: 'Administrator',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  },
  {
    name: 'trainer',
    email: 'trainer@reotravel.academy',
    firstName: 'Ama',
    lastName: 'Trainer',
    role: 'TRAINER',
    status: 'ACTIVE',
  },
  {
    name: 'student',
    email: 'student@reotravel.academy',
    firstName: 'Kofi',
    lastName: 'Learner',
    role: 'STUDENT',
    status: 'ACTIVE',
  },
  {
    name: 'pending',
    email: 'pending@reotravel.academy',
    firstName: 'Pending',
    lastName: 'Student',
    role: 'STUDENT',
    status: 'PENDING',
  },
];

const getSeedPassword = (accountName, environment) => {
  const envKey = `SEED_${accountName.toUpperCase()}_PASSWORD`;
  const password = environment[envKey];

  if (typeof password !== 'string' || password.length < 12) {
    throw new Error(`Missing or weak ${envKey}. Set a password with at least 12 characters before running the seed script.`);
  }

  return password;
};

export async function ensureSeedUser(userModel, { email, password, firstName, lastName, roleId, status }) {
  const existing = await userModel.findUnique({ where: { email } });

  if (!existing) {
    return userModel.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        firstName,
        lastName,
        roleId,
        status,
      },
    });
  }

  const update = {};
  if (existing.firstName !== firstName) update.firstName = firstName;
  if (existing.lastName !== lastName) update.lastName = lastName;
  if (existing.roleId !== roleId) update.roleId = roleId;
  if (existing.status !== status) update.status = status;
  if (!(await verifyPassword(password, existing.passwordHash))) {
    update.passwordHash = await hashPassword(password);
  }

  return Object.keys(update).length
    ? userModel.update({ where: { email }, data: update })
    : existing;
}

async function ensureRelation(model, where, data) {
  const existing = await model.findUnique({ where });
  return existing ?? model.create({ data });
}

export async function ensureNamedRecord(model, { where, data }) {
  const existing = await model.findFirst({ where });
  return existing ?? model.create({ data });
}

async function seedFixtures(tx, { admin, trainer, student }) {
  const programme = await ensureNamedRecord(tx.programme, {
    where: { slug: 'travel-operations-foundation' },
    data: {
      title: 'Travel Operations Foundation',
      slug: 'travel-operations-foundation',
      description: 'Foundational training for travel operations staff.',
      status: 'ACTIVE',
      startDate: new Date('2026-01-10'),
      endDate: new Date('2027-12-20'),
    },
  });

  const cohortA = await ensureNamedRecord(tx.cohort, {
    where: { name: 'Cohort 2026-A', programmeId: programme.id },
    data: {
      name: 'Cohort 2026-A',
      programmeId: programme.id,
      status: 'COMPLETED',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-08-01'),
      schedule: 'Monday and Wednesday, 09:00-11:00',
    },
  });
  const cohortB = await ensureNamedRecord(tx.cohort, {
    where: { name: 'Cohort 2026-B', programmeId: programme.id },
    data: {
      name: 'Cohort 2026-B',
      programmeId: programme.id,
      status: 'ACTIVE',
      startDate: new Date('2026-11-01'),
      endDate: new Date('2027-02-28'),
      schedule: 'Tuesday and Thursday, 13:00-15:00',
    },
  });

  await ensureRelation(tx.enrolment, {
    studentId_cohortId: { studentId: student.id, cohortId: cohortA.id },
  }, { studentId: student.id, cohortId: cohortA.id });
  await ensureRelation(tx.enrolment, {
    studentId_cohortId: { studentId: student.id, cohortId: cohortB.id },
  }, { studentId: student.id, cohortId: cohortB.id });
  await ensureRelation(tx.cohortTrainer, {
    cohortId_trainerId: { cohortId: cohortA.id, trainerId: trainer.id },
  }, { cohortId: cohortA.id, trainerId: trainer.id });
  await ensureRelation(tx.cohortTrainer, {
    cohortId_trainerId: { cohortId: cohortB.id, trainerId: trainer.id },
  }, { cohortId: cohortB.id, trainerId: trainer.id });

  const course = await ensureNamedRecord(tx.course, {
    where: { slug: 'introduction-to-travel-operations' },
    data: {
      title: 'Introduction to Travel Operations',
      slug: 'introduction-to-travel-operations',
      description: 'Core concepts of travel operations.',
      programmeId: programme.id,
      status: 'PUBLISHED',
    },
  });

  await ensureRelation(tx.cohortCourse, {
    cohortId_courseId: { cohortId: cohortA.id, courseId: course.id },
  }, { cohortId: cohortA.id, courseId: course.id });
  await ensureRelation(tx.cohortCourse, {
    cohortId_courseId: { cohortId: cohortB.id, courseId: course.id },
  }, { cohortId: cohortB.id, courseId: course.id });
  await ensureRelation(tx.courseTrainer, {
    courseId_trainerId: { courseId: course.id, trainerId: trainer.id },
  }, { courseId: course.id, trainerId: trainer.id });

  const module = await ensureNamedRecord(tx.module, {
    where: { courseId: course.id, title: 'Module 1: Basics' },
    data: { courseId: course.id, title: 'Module 1: Basics', position: 0 },
  });
  await ensureNamedRecord(tx.lesson, {
    where: { moduleId: module.id, title: 'Lesson 1: Welcome' },
    data: {
      moduleId: module.id,
      title: 'Lesson 1: Welcome',
      type: 'TEXT',
      content: JSON.stringify([
        { type: 'rich_text', content: 'Welcome to the course and the travel operations profession.' },
        { type: 'summary', content: 'You will learn the core principles of planning and supporting travel.' },
      ]),
      isPublished: true,
      position: 0,
    },
  });

  const assessment = await ensureNamedRecord(tx.assessment, {
    where: { courseId: course.id, title: 'Module 1 Quiz' },
    data: {
      courseId: course.id,
      title: 'Module 1 Quiz',
      status: 'PUBLISHED',
      attemptLimit: 2,
    },
  });
  const questions = [
    {
      assessmentId: assessment.id,
      type: 'MULTIPLE_CHOICE',
      prompt: 'What is the primary goal of travel operations?',
      points: 1,
      position: 0,
      options: ['Profit', 'Customer satisfaction', 'Speed', 'Cost'],
      correctAnswer: 'Customer satisfaction',
    },
    {
      assessmentId: assessment.id,
      type: 'TRUE_FALSE',
      prompt: 'Travel agents need IATA accreditation.',
      points: 1,
      position: 1,
      options: ['True', 'False'],
      correctAnswer: 'True',
    },
  ];

  for (const question of questions) {
    await ensureNamedRecord(tx.question, {
      where: { assessmentId: assessment.id, position: question.position },
      data: question,
    });
  }

  await ensureNamedRecord(tx.liveClass, {
    where: { roomName: 'reo-development-travel-operations-2027-a' },
    data: {
      courseId: course.id,
      cohortId: cohortB.id,
      createdById: trainer.id,
      title: 'Travel Operations Foundations',
      description: 'Development session for the active travel operations cohort.',
      roomName: 'reo-development-travel-operations-2027-a',
      startsAt: new Date('2027-01-15T10:00:00.000Z'),
      durationMins: 60,
      status: 'SCHEDULED',
    },
  });

  return { admin, trainer, student, programme, cohortA, cohortB, course };
}

export async function seed(prismaClient = prisma, environment = process.env) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Development seed data cannot be run when NODE_ENV is production.');
  }

  const passwords = Object.fromEntries(
    accounts.map(({ name }) => [name, getSeedPassword(name, environment)]),
  );

  return prismaClient.$transaction(async (tx) => {
    const roleDefinitions = [
      { name: 'SUPER_ADMIN', description: 'Full administrative control' },
      { name: 'TRAINER', description: 'Instructor / trainer' },
      { name: 'STUDENT', description: 'Learner' },
    ];
    const roles = {};

    for (const role of roleDefinitions) {
      roles[role.name] = await tx.role.findUnique({ where: { name: role.name } })
        ?? await tx.role.create({ data: role });
    }

    const users = {};
    for (const account of accounts) {
      users[account.name] = await ensureSeedUser(tx.user, {
        ...account,
        password: passwords[account.name],
        roleId: roles[account.role].id,
      });
    }

    await seedFixtures(tx, users);
    return users;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => {
      console.log('Seed complete: 4 development accounts and learning fixtures are ready.');
      console.log('Login credentials are configured through the SEED_*_PASSWORD environment variables.');
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
