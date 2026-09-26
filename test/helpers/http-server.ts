import type { Server } from 'node:http';

export const listen = (server: Server): Promise<string> => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not read test server address'));
    resolve(`http://127.0.0.1:${address.port}`);
  });
});

export const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.closeIdleConnections();
  server.close((error) => error ? reject(error) : resolve());
});
