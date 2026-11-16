import { createServer } from 'node:http';
import { attachLiveClassRealtime } from './liveClassRealtime.js';
import { createRealtimeRedis } from './realtimeRedis.js';

export const createVercelServer = async (requestHandler) => {
  const server = createServer(requestHandler);
  const { adapter, client } = await createRealtimeRedis();
  attachLiveClassRealtime(server, { adapter, redisClient: client });
  return server;
};
