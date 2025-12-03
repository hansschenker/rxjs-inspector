// src/web/server.ts

import path from 'node:path';
import express, { Request, Response } from 'express';
import { Subscription } from 'rxjs';
// import { fileURLToPath } from 'node:url';
import { notifications$ } from '../instrumentation/core';
import { NotificationEvent } from '../instrumentation/types';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);


// Use CommonJS __filename and __dirname for compatibility with non-ESM modules
// If using CommonJS, these are available globally.
declare const __filename: string;
declare const __dirname: string;



const app = express();
const clients = new Set<Response>();
let notificationSub: Subscription | null = null;

// SSE endpoint for real-time events
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


// Serve the client HTML directly
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// Static files from public directory

app.use(express.static(path.join(__dirname, 'public')));

// Subscribe to notifications and broadcast to all SSE clients
notificationSub = notifications$.subscribe((event: NotificationEvent) => {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
});

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`RxJS Inspector server running at http://localhost:${port}`);
  console.log(`  - Dashboard: http://localhost:${port}/`);
  console.log(`  - SSE stream: http://localhost:${port}/events`);
});

// Graceful shutdown
function shutdown(): void {
  console.log('\nShutting down RxJS Inspector server...');
  
  // Close all SSE connections
  for (const client of clients) {
    client.end();
  }
  clients.clear();
  
  // Unsubscribe from notifications
  notificationSub?.unsubscribe();
  
  // Close the HTTP server
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
