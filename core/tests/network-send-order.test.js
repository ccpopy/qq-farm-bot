const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

function connectionHarness() {
    const filename = path.resolve(__dirname, '../dist/utils/network.js');
    const realRequire = createRequire(filename);
    const timers = new Map();
    let release;
    const encrypted = new Promise(resolve => { release = resolve; });
    const stubType = { create: value => value, encode: value => ({ finish: () => Buffer.from(JSON.stringify(value)) }), decode: bytes => JSON.parse(bytes.toString()) };
    const logs = [];
    const overrides = {
        ws: { OPEN: 1 },
        '../services/scheduler': { createScheduler: () => ({
            setTimeoutTask(key, ms, fn) { timers.set(key, setTimeout(fn, ms)); },
            clear(key) { clearTimeout(timers.get(key)); timers.delete(key); },
            clearAll() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
        }) },
        '../services/status': {}, '../services/stats': {}, '../services/ace': { stopAceRuntime() {} },
        './proto': { types: { GateMessage: stubType } },
        './utils': { toLong: Number, toNum: Number, log: (...args) => logs.push(args), logWarn: (...args) => logs.push(args) },
        './crypto-wasm': { encryptBuffer: async bytes => { await encrypted; return bytes; } },
    };
    const sandbox = { require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {}, Buffer, console, process, setTimeout, clearTimeout };
    const source = `${fs.readFileSync(filename, 'utf8')  }
        module.exports.testOnline = socket => {
            ws = socket;
            currentConnection = { id: 1, socket, phase: 'online', intentionalClose: false, finalized: false, loginInitialized: true };
        };
        module.exports.testDisconnect = details => finalizeConnection(currentConnection, details);
    `;
    vm.runInNewContext(source, sandbox, { filename });
    const network = sandbox.module.exports;
    const sent = [];
    network.testOnline({ readyState: 1, send: bytes => sent.push(JSON.parse(bytes.toString())), close() {} });
    return { network, sent, release, logs };
}

test('async encryption cannot put an empty request ahead of an earlier sequence', async () => {
    const h = connectionHarness();
    try {
        const first = h.network.sendMsgAsync('test', 'nonempty', Buffer.from([1]), { expectReply: false });
        const second = h.network.sendMsgAsync('test', 'empty', Buffer.alloc(0), { expectReply: false });
        await new Promise(resolve => setImmediate(resolve));
        h.release();
        await Promise.all([first, second]);
        assert.deepEqual(h.sent.map(frame => frame.meta.client_seq), [1, 2]);
        assert.deepEqual(h.sent.map(frame => frame.meta.method_name), ['nonempty', 'empty']);
    } finally { h.network.cleanup(); }
});

test('disconnect during encoding never sends a frame on a dead connection', async () => {
    const h = connectionHarness();
    const first = h.network.sendMsgAsync('test', 'nonempty', Buffer.from([1]), { expectReply: false });
    const rejection = assert.rejects(first, /发送失败|中断|未打开/);
    h.network.cleanup();
    h.release();
    await rejection;
    assert.equal(h.sent.length, 0);
});

test('disconnect diagnostics are captured before pending requests are cleared', async () => {
    const h = connectionHarness();
    let disconnected;
    h.network.networkEvents.on('disconnected', value => { disconnected=value; });
    const request=h.network.sendMsgAsync('test','awaiting-reply',Buffer.from([1]));
    const rejection=assert.rejects(request,/中断/);
    h.network.testDisconnect({source:'ws_close',code:1006,reason:'abnormal close'});
    h.release();await rejection;
    assert.equal(disconnected.code,1006);
    assert.equal(disconnected.diagnostics.pending,1);
    assert.match(disconnected.diagnostics.pendingRequests,/awaiting-reply/);
    assert.equal(h.network.getGatewayLoad().pending,0);
});
