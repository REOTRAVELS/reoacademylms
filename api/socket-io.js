import { createVercelServer } from '../server/src/services/vercelServer.js';

const server = await createVercelServer();

export default server;
