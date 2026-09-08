const assert = require('node:assert/strict');
const test = require('node:test');

function loadService(t, { settings, respond } = {}) {
    const servicePath = require.resolve('../dist/services/qq-login/service');
    const storePath = require.resolve('../dist/models/store');
    const axiosPath = require.resolve('axios');
    const saved = new Map([servicePath, storePath, axiosPath].map(path => [path, require.cache[path]]));
    const calls = [];
    require.cache[storePath] = { exports: { getLoginSettings: () => settings || {
        qqQrLogin: true,
        napCatEndpoint: 'http://napcat.test/',
        napCatSignature: 'test-signature',
    } } };
    require.cache[axiosPath] = { exports: { default: { post: async (url, body, options) => {
        calls.push({ url, body, options });
        return { data: await respond(url, body, options) };
    } } } };
    delete require.cache[servicePath];
    t.after(() => {
        for (const [path, entry] of saved) {
            if (entry) require.cache[path] = entry;
            else delete require.cache[path];
        }
    });
    return { service: require(servicePath), calls };
}

test('QQ QR login is disabled by default and requires both endpoint and signature', async (t) => {
    const settings = { qqQrLogin: false };
    const { service, calls } = loadService(t, { settings });
    await assert.rejects(service.createLoginTask(), /未开启/);
    settings.qqQrLogin = true;
    await assert.rejects(service.createLoginTask(), /接口地址和接口签名/);
    assert.equal(calls.length, 0);
});

test('QQ login proxies creation, status, miniapp code and cancellation using the configured signature', async (t) => {
    const { service, calls } = loadService(t, {
        respond: async url => url.endsWith('/code')
            ? { ok: true, code: 'test-miniapp-code' }
            : { ok: true, task: { id: 'task-1', status: 'waiting_scan', qrImage: 'data:image/png;base64,test', expiresAt: 123 } },
    });
    const task = await service.createLoginTask();
    assert.deepEqual(task, { taskId: 'task-1', status: 'waiting_scan', qrImage: 'data:image/png;base64,test', expiresAt: 123 });
    await service.queryLoginStatus(task.taskId);
    assert.equal(await service.getMiniappCode(task.taskId), 'test-miniapp-code');
    await service.cancelLoginTask(task.taskId);
    assert.deepEqual(calls.map(call => call.url), [
        'http://napcat.test/api/qq/login/qrcode',
        'http://napcat.test/api/qq/login/status',
        'http://napcat.test/api/qq/miniapp/code',
        'http://napcat.test/api/qq/logout',
    ]);
    assert.deepEqual(calls[1].body, { taskId: 'task-1', refresh: false });
    assert.deepEqual(calls[2].body, { taskId: 'task-1', appId: '1112386029' });
    assert.deepEqual(calls[3].body, { taskId: 'task-1' });
    for (const call of calls) {
        assert.equal(call.options.headers['X-API-Signature'], 'test-signature');
        assert.equal(call.options.timeout, 120000);
    }
});

test('QQ login rejects blank IDs, malformed responses and invalid signatures without returning codes', async (t) => {
    let response = { ok: false, code: 'INVALID_SIGNATURE' };
    const { service, calls } = loadService(t, { respond: async () => response });
    await assert.rejects(service.queryLoginStatus(''), /ID 不能为空/);
    await assert.rejects(service.getMiniappCode(' '), /ID 不能为空/);
    await assert.rejects(service.cancelLoginTask(''), /ID 不能为空/);
    assert.equal(calls.length, 0);
    await assert.rejects(service.createLoginTask(), /接口签名无效/);
    response = { ok: true, task: { id: 'task-1' } };
    await assert.rejects(service.createLoginTask(), /未返回登录二维码/);
    response = { ok: true };
    await assert.rejects(service.getMiniappCode('task-1'), /未返回小程序授权 Code/);
});

test('QQ login sanitizes connection failures and distinguishes a request timeout', async (t) => {
    let error = Object.assign(new Error('private request details'), { code: 'ECONNABORTED' });
    const { service } = loadService(t, { respond: async () => { throw error; } });
    await assert.rejects(service.createLoginTask(), /NapCat 接口请求超时/);
    error = new Error('private request details');
    await assert.rejects(service.createLoginTask(), /无法连接 NapCat 接口/);
});
