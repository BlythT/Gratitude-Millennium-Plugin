// Replays the page's collected console messages (Console.enable) and prints Gratitude's only
// Usage: node cdp_console.mjs <webSocketDebuggerUrl from http://127.0.0.1:8080/json> (Steam in dev mode)
const ws = new WebSocket(process.argv[2]);
const lines = [];
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: 'document.readyState', returnByValue: true } }));
};
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Console.messageAdded') {
    const text = msg.params.message.text || '';
    if (text.includes('[Gratitude]')) lines.push(`${msg.params.message.level}: ${text.slice(0, 160)}`);
  }
  if (msg.id === 2) lines.push(`readyState: ${msg.result?.result?.value}`);
};
setTimeout(() => { console.log(lines.length ? lines.join('\n') : 'no Gratitude console messages'); ws.close(); process.exit(0); }, 1500);
