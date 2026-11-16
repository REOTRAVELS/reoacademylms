import app from '../server/src/app.js';

export default function apiHandler(req, res) {
  const search = (req.url || '').split('?')[1] || '';
  const query = new URLSearchParams(search);
  const apiPath = query.get('__apiPath') || req.query?.__apiPath;

  if (
    typeof apiPath !== 'string'
    || !apiPath
    || apiPath.startsWith('/')
    || apiPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }

  query.delete('__apiPath');
  const remainingQuery = query.toString();
  req.url = `/api/${apiPath}${remainingQuery ? `?${remainingQuery}` : ''}`;
  return app(req, res);
}
