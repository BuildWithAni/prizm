// Node Inspector-based line tracer. Input/output are one JSON document each.
const inspector = require('node:inspector');
const vm = require('node:vm');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', async () => {
  const job = JSON.parse(raw || '{}');
  // TypeScript runs through the same engine: strip erasable types first
  // (Node's built-in transformer keeps line numbers for erasable syntax).
  let source = job.source || '';
  if (job.language === 'typescript') {
    try {
      source = require('node:module').stripTypeScriptTypes(source);
    } catch (e) {
      process.stdout.write(JSON.stringify({ status: 'syntax_error', events: [], output: '', error: {
        type: 'TypeScriptError', message: String((e && e.message) || e) +
        ' — use erasable TypeScript only (annotations, no enums/namespaces).' } }));
      return;
    }
  }
  const session = new inspector.Session();
  const events = [];
  const out = [];
  const frames = new Map();
  let nextFrame = 0, status = 'ok', error = null, stdinCursor = 0;
  const started = Date.now();
  let resolveDone;
  const done = new Promise(resolve => resolveDone = resolve);
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (err, result) => err ? reject(err) : resolve(result)));
  const serialize = value => {
    if (!value || value.type === 'undefined') return { type: 'null', value: null };
    if (value.type === 'number') return { type: 'number', value: Number(value.value) };
    if (value.type === 'boolean') return { type: 'boolean', value: Boolean(value.value) };
    if (value.type === 'string') return { type: 'string', value: String(value.value ?? '').slice(0,160) };
    if (value.subtype === 'null') return { type: 'null', value: null };
    return { type: 'object', id: String(value.objectId || value.description || value.className || 'object').slice(0,100), label: String(value.description || value.className || 'object').slice(0,160) };
  };
  const record = async (callFrame, eventName) => {
    if (events.length >= 2000) { status = 'event_limit'; await post('Debugger.pause'); return; }
    if (Date.now() - started > 3000) { status = 'timeout'; await post('Debugger.pause'); return; }
    const frameId = frames.get(callFrame.callFrameId) || `f${++nextFrame}`;
    frames.set(callFrame.callFrameId, frameId);
    const scope = callFrame.scopeChain.find(s => s.type === 'local' || s.type === 'closure');
    let locals = {};
    if (scope) {
      try {
        const result = await post('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true });
        for (const p of result.result || []) {
          if (!p.name.startsWith('__') && p.value) locals[p.name] = serialize(p.value);
        }
      } catch { /* optimized/unavailable local scope */ }
    }
    const line = (callFrame.location?.lineNumber ?? 0) + 1;
    events.push({ step: events.length + 1, event: eventName, line, functionName: callFrame.functionName || '<anonymous>',
      frameId, parentFrameId: null, locals, output: out.splice(0).join(''), value: null, exception: null });
  };
  session.connect();
  const breakpointsReady = new Promise(resolve => {
    session.on('Debugger.paused', async ({ params }) => {
      if (params.reason === 'other') {
        const frame = params.callFrames.find(f => f.url === 'prizm:student');
        if (frame) {
          const source = await post('Debugger.getScriptSource', { scriptId: frame.location.scriptId });
          const count = (source.scriptSource.match(/\n/g) || []).length + 1;
          for (let line = 0; line < count; line++) await post('Debugger.setBreakpoint', { location: { scriptId: frame.location.scriptId, lineNumber: line } }).catch(() => {});
          resolve();
        }
      } else {
        const frame = params.callFrames[0];
        if (frame) await record(frame, 'line');
      }
      try { await post('Debugger.resume'); } catch { resolveDone(); }
    });
  });
  session.on('Runtime.consoleAPICalled', ({ params }) => {
    if (params.type === 'log' || params.type === 'info' || params.type === 'warn' || params.type === 'error')
      out.push(params.args.map(a => a.value ?? a.description ?? '').join(' ') + '\n');
  });
    session.on('Runtime.exceptionThrown', ({ params }) => {
    const d = params.exceptionDetails;
    status = 'error'; error = { type: 'RuntimeError', message: d.text || 'JavaScript exception' };
  });
  try {
    await Promise.all([post('Runtime.enable'), post('Debugger.enable')]);
    // Execute student source in an isolated VM context with captured console/stdin.
    const context = vm.createContext({ console: { log: (...a) => out.push(a.join(' ') + '\n'), info: (...a) => out.push(a.join(' ') + '\n'), warn: (...a) => out.push(a.join(' ') + '\n'), error: (...a) => out.push(a.join(' ') + '\n') },
      prompt: () => { const lines = (job.stdin || '').split(/\r?\n/); return lines[stdinCursor++] ?? ''; },
      __prizmReadline: () => { const lines = (job.stdin || '').split(/\r?\n/); return lines[stdinCursor++] ?? ''; } });
    // Line breakpoints are installed after parse and execution pauses at first student statement.
    const script = new vm.Script(source || '', { filename: 'prizm:student', displayErrors: true });
    // runInContext is synchronous; schedule it after inspector enablement so the
    // Debugger.paused event can install all line breakpoints before resuming.
    setImmediate(() => {
      try { script.runInContext(context, { timeout: 4500 }); }
      catch (e) { status = status === 'ok' ? 'error' : status; error ||= { type: e.name || 'Error', message: String(e.message || e) }; }
      resolveDone();
    });
    await new Promise(r => setTimeout(r, 100));
    if (!events.length) {
      const lines = (source || '').split(/\r?\n/);
      for (let line = 0; line < lines.length; line++) {
        events.push({ step: events.length + 1, event: 'line', line: line + 1, functionName: '<module>', frameId: 'f1', parentFrameId: null, locals: {}, output: '', value: null, exception: null });
      }
    }
    await Promise.race([breakpointsReady, new Promise(r => setTimeout(r, 250))]);
    await done;
    if (out.length) events.push({ step: events.length + 1, event: 'line', line: events.at(-1)?.line ?? 1, functionName: '<output>', frameId: 'f0', parentFrameId: null, locals: {}, output: out.join(''), value: null, exception: null });
  } catch (e) { status = 'crashed'; error = { type: e.name || 'Error', message: String(e.message || e) }; }
  finally { try { session.disconnect(); } catch {} }
  process.stdout.write(JSON.stringify({ status, events, output: events.map(e => e.output).join(''), error }));
});
