import { createServer } from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import prisma from './config/database.js';
import { attachLiveClassRealtime } from './services/liveClassRealtime.js';

const server = createServer(app);
const io = attachLiveClassRealtime(server);
server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Cannot start REO Academy: port ${env.port} is already in use. `
      + 'Another server instance may already be running; stop it or choose a free PORT.',
    );
    process.exit(1);
  }
  throw error;
});

server.listen(env.port, () => {
  console.log(`REO Academy server running on port ${env.port}`);
});

let shutdownStarted = false;

const shutdown = (signal) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Received ${signal}; shutting down gracefully`);

  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  timeout.unref();

  io.close(async () => {
    clearTimeout(timeout);
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Database shutdown failed', disconnectError);
      process.exitCode = 1;
    }
    if (process.exitCode) process.exit(process.exitCode);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
