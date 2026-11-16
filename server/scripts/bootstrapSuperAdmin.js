import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';

const prompt = async (questions) => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answers = {};
    for (const [key, question] of Object.entries(questions)) {
      answers[key] = await new Promise((resolve) => rl.question(question, resolve));
    }
    return answers;
  } finally {
    rl.close();
  }
};

const readSecret = (label) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    reject(new Error('Run this command in an interactive terminal so secrets are not echoed.'));
    return;
  }

  const decoder = new StringDecoder('utf8');
  let value = '';
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();

  const finish = (error) => {
    stdin.off('data', onData);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
    if (error) reject(error);
    else resolve(value);
  };

  const onData = (chunk) => {
    for (const character of decoder.write(chunk)) {
      if (character === '\u0003') return finish(new Error('Bootstrap cancelled.'));
      if (character === '\r' || character === '\n') return finish();
      if (character === '\u007f' || character === '\b') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (character >= ' ') {
        value += character;
      }
    }
  };

  stdin.on('data', onData);
});

const main = async () => {
  const databaseUrl = await readSecret('Paste Neon direct connection URL (input hidden): ');
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('The database URL is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('The database URL must use PostgreSQL.');
  }
  if (parsedUrl.hostname.toLowerCase().includes('pooler')) {
    throw new Error('Use Neon’s direct, non-pooled connection URL.');
  }

  stdout.write(`Database host: ${parsedUrl.hostname}\n`);
  const { confirmation, email, firstName, lastName } = await prompt({
    confirmation: 'Type CREATE FIRST PRODUCTION SUPER ADMIN to continue: ',
    email: 'Admin email: ',
    firstName: 'First name: ',
    lastName: 'Last name: ',
  });
  if (confirmation !== 'CREATE FIRST PRODUCTION SUPER ADMIN') {
    throw new Error('Confirmation did not match; no changes were made.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  if (!firstName.trim() || !lastName.trim()) {
    throw new Error('First and last name are required.');
  }

  const password = await readSecret('New admin password (minimum 12 characters, input hidden): ');
  const passwordConfirmation = await readSecret('Confirm new admin password (input hidden): ');
  if (password.length < 12) throw new Error('The password must be at least 12 characters.');
  if (password !== passwordConfirmation) throw new Error('Passwords do not match.');

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const existingAdmin = await tx.user.findFirst({
        where: { role: { name: 'SUPER_ADMIN' } },
        select: { email: true },
      });
      if (existingAdmin) {
        throw new Error('A SUPER_ADMIN account already exists; bootstrap refused.');
      }

      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { email: true },
      });
      if (existingUser) throw new Error('That email already belongs to an account; no changes were made.');

      const role = await tx.role.upsert({
        where: { name: 'SUPER_ADMIN' },
        update: {},
        create: {
          name: 'SUPER_ADMIN',
          description: 'Full administrative access',
        },
      });
      return tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          status: 'ACTIVE',
          roleId: role.id,
        },
        select: { email: true },
      });
    });

    stdout.write(`Created active SUPER_ADMIN account for ${user.email}.\n`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error(error.message || 'Super-admin bootstrap failed.');
  process.exitCode = 1;
});
