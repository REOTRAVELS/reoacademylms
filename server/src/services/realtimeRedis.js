import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { env } from '../config/env.js';

export const createRealtimeRedis = async () => {
  if (!env.redisUrl) throw new Error('REDIS_URL is required for Vercel classroom realtime');

  const publisher = createClient({ url: env.redisUrl });
  const subscriber = publisher.duplicate();
  publisher.on('error', (error) => console.error('Realtime Redis publisher error', error.message));
  subscriber.on('error', (error) => console.error('Realtime Redis subscriber error', error.message));
  await Promise.all([publisher.connect(), subscriber.connect()]);
  return {
    adapter: createAdapter(publisher, subscriber),
    client: publisher,
  };
};
