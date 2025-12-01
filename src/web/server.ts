const __filename = fileURLToPath(import.meta.url);
// src/web/server.ts
import express, { Request, Response } from 'express';
import { notifications$ } from '../instrumentation/core';
import { NotificationEvent } from '../instrumentation/types';

const app = express();
const clients = new Set<Response>();

app.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write('\n'); // kick-start the stream for some proxies

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

// src/web/server.ts (add below app.get('/events', ...) handler)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

// Place client.html in src/web/public/index.html (built or copied to dist/web/public)



notifications$.subscribe((event: NotificationEvent) => {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(
    `Rxjs-Inspector SSE server listening on http://localhost:${port}/events`,
  );
});
