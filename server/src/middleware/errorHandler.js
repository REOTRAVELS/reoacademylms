import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const schemaErrorCodes = new Set(['P2021', 'P2022']);
const databaseUnavailableCodes = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017', 'P2024']);

const classifyError = (error) => {
  if (schemaErrorCodes.has(error.code)) return 'database_schema_mismatch';
  if (databaseUnavailableCodes.has(error.code)) return 'database_unavailable';
  if (error.code === 'P2034') return 'database_transaction_conflict';
  if (error.code === 'P2028') return 'database_transaction_error';
  if (error.status === 401) return 'authentication_error';
  if (error.status === 403) return 'authorization_error';
  if (error.status >= 400 && error.status < 500) return 'request_error';
  return 'unexpected_error';
};

const getSafeDatabaseDetails = (error) => {
  if (!error.meta || typeof error.meta !== 'object') return undefined;
  const details = {};
  for (const key of ['modelName', 'column', 'table', 'constraint']) {
    const value = error.meta[key];
    if (typeof value === 'string') details[key] = value;
  }
  return Object.keys(details).length ? details : undefined;
};

export const requestContext = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

export const errorHandler = (err, req, res, _next) => {
  const classification = classifyError(err);
  const requestId = req.requestId || randomUUID();
  const databaseDetails = getSafeDatabaseDetails(err);
  console.error(JSON.stringify({
    requestId,
    method: req.method,
    path: req.path,
    classification,
    status: err.status || (classification === 'database_unavailable' || classification === 'database_schema_mismatch' ? 503 : 500),
    errorName: typeof err.name === 'string' ? err.name : 'Error',
    ...(typeof err.code === 'string' ? { errorCode: err.code } : {}),
    ...(databaseDetails ? { database: databaseDetails } : {}),
  }));
  const status = err.status && err.status < 500 ? err.status : (
    classification === 'database_unavailable' || classification === 'database_schema_mismatch'
      ? 503
      : classification === 'database_transaction_conflict' ? 409 : 500
  );
  const message = classification === 'database_schema_mismatch'
    ? 'This feature is temporarily unavailable because the database schema is out of date. Please contact an administrator.'
    : classification === 'database_unavailable'
      ? 'The database is temporarily unavailable. Please try again shortly.'
      : classification === 'database_transaction_conflict'
        ? 'The data changed during this operation. Please retry the request.'
        : status >= 500
          ? 'The request could not be completed. Please try again or contact support.'
          : err.message || 'Internal server error';
  res.status(status).json({
    success: false,
    message: status >= 500 && env.nodeEnv === 'production' ? 'Internal server error' : message,
    requestId,
  });
};

export const notFound = (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};
