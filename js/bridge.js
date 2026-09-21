// The screen's side of the bridge to Claude Code (the Judge). Only active when the page is
// served from the bridge itself (localhost) or given ?bridge=<url>. Pushes state after every
// change; polls for Judge commands.
export function connectBridge(host) {
  const params = new URLSearchParams(location.search);
  const base = params.get('bridge') || (['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin : null);
  if (!base) return null;
  let seq = -1, alive = false, pushTimer = null;

  const push = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => fetch(base + '/bridge/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(host.state) }).catch(() => {}), 150);
  };
  host.onChange(push);

  // Long-poll: the bridge answers as soon as a command arrives, or after 25 s. No timers to throttle.
  const poll = async () => {
    try {
      const r = await fetch(base + `/bridge/commands?after=${seq}&wait=${seq < 0 ? 0 : 25}`);
      const { commands, judge, seq: latest } = await r.json();
      if (seq < 0) seq = latest;                      // a fresh screen skips whatever was queued before it opened
      if (!alive) { alive = true; push(); }
      if (host.state.judge && host.state.judge.present !== judge) host.dispatch({ type: 'judge', present: judge });
      for (const c of commands) { seq = c.seq; await host.dispatch(c.action); }
      poll();
    } catch { alive = false; setTimeout(poll, 3000); }
  };
  poll();
  return { base };
}
