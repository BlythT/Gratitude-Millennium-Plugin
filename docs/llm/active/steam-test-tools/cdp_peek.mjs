// Read only: prints a page's readyState, text length and any Gratitude sync overlay.
// Usage: node cdp_peek.mjs <webSocketDebuggerUrl from http://127.0.0.1:8080/json> (Steam in dev mode)
const ws = new WebSocket(process.argv[2]);
const expression = `(() => {
  const overlay = [...document.querySelectorAll('div')].find((el) => (el.textContent || '').startsWith('Gratitude:'));
  return JSON.stringify({
    readyState: document.readyState,
    bodyTextLength: document.body ? document.body.innerText.length : -1,
    overlayText: overlay ? overlay.textContent.slice(0, 120) : null,
    hasApplicationConfig: !!document.querySelector('#application_config'),
  });
})()`;
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.id === 1) { console.log(msg.result?.result?.value ?? JSON.stringify(msg)); ws.close(); } };
ws.onerror = (e) => { console.log('ws error', e.message); process.exit(1); };
setTimeout(() => { console.log('timeout'); process.exit(1); }, 5000);
