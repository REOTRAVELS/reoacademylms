import { z } from 'zod';

export const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    req.validated = parsed;
    next();
  } catch (err) {
    const errors = err.issues?.map((e) => ({ path: e.path.join('.'), message: e.message })) || [];
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
};
