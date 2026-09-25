import { WebSocketServer } from 'ws';

let wss = null;

export function attachWsServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // Prevent unhandled 'error' on WSS when the HTTP server fails to bind (EADDRINUSE)
  wss.on('error', (err) => {
    console.error('[ws] WebSocket server error:', err.message);
  });
  httpServer.on('error', (err) => {
    // Already handled by index.js listen error path; keep WSS from crashing process
    console.error('[ws] HTTP server error (shared with WS):', err.message);
  });
  wss.on('connection', (ws, req) => {
    // TODO: verify ?token= query param against device_token before allowing messages
    ws.on('error', () => {});
    try { ws.send(JSON.stringify({ type: 'connected' })); } catch { /* */ }
  });
  console.log('[ws] WebSocket server ready at /ws');
}

export function broadcast(event) {
  if (!wss) return;
  const msg = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch { /* */ }
    }
  }
}
