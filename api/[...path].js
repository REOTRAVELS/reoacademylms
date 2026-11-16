import app from '../server/src/app.js';
import { createVercelServer } from '../server/src/services/vercelServer.js';

const server = await createVercelServer(app);

export default server;
