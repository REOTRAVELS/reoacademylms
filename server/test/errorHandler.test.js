import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, requestContext } from '../src/middleware/errorHandler.js';

const invokeErrorHandler = (error, request = { requestId: 'test-request-id', method: 'GET', path: '/api/courses' }) => {
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  let log;
  const originalError = console.error;
  console.error = (message) => { log = JSON.parse(message); };
  try {
    errorHandler(error, request, response, () => {});
  } finally {
    console.error = originalError;
  }
  return { response, log };
};

test('database schema errors are classified, correlated and safely logged', () => {
  const { response, log } = invokeErrorHandler({
    code: 'P2022',
    name: 'PrismaClientKnownRequestError',
    meta: { modelName: 'Course', column: 'Course.subtitle' },
    status: 500,
    message: 'The column Course.subtitle does not exist and a private token must not be logged.',
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.message, 'This feature is temporarily unavailable because the database schema is out of date. Please contact an administrator.');
  assert.equal(response.body.requestId, 'test-request-id');
  assert.equal(log.classification, 'database_schema_mismatch');
  assert.deepEqual(log.database, { modelName: 'Course', column: 'Course.subtitle' });
  assert.doesNotMatch(JSON.stringify(log), /private token|does not exist/i);
});

test('database connectivity failures are distinguished from schema errors', () => {
  const { response, log } = invokeErrorHandler({ code: 'P1001', name: 'PrismaClientInitializationError' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.message, 'The database is temporarily unavailable. Please try again shortly.');
  assert.equal(log.classification, 'database_unavailable');
});

test('transaction conflicts are classified and can be retried', () => {
  const { response, log } = invokeErrorHandler({ code: 'P2034', name: 'PrismaClientKnownRequestError' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.message, 'The data changed during this operation. Please retry the request.');
  assert.equal(log.classification, 'database_transaction_conflict');
});

test('unexpected server errors do not expose internal messages or secrets in development', () => {
  const { response, log } = invokeErrorHandler(Object.assign(new Error('private database connection detail and token'), { status: 500 }));
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.message, 'The request could not be completed. Please try again or contact support.');
  assert.equal(log.classification, 'unexpected_error');
  assert.doesNotMatch(JSON.stringify(log), /private database|token/i);
});

test('client errors retain their useful validation message', () => {
  const { response, log } = invokeErrorHandler(Object.assign(new Error('Select a course and cohort'), { status: 400 }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, 'Select a course and cohort');
  assert.equal(log.classification, 'request_error');
});

test('request context creates a correlation id and response header', () => {
  const request = {};
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  let nextCalled = false;
  requestContext(request, response, () => { nextCalled = true; });
  assert.match(request.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['X-Request-ID'], request.requestId);
  assert.equal(nextCalled, true);
});
