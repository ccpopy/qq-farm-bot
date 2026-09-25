const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const {
    MINI_PROGRAM_APP_IDS,
    TSDK_SHA256,
    TSDK_VERSION,
    TSDK_BUILDS,
    TsdkRuntime,
    resolveTsdkHostProfile,
} = require('../dist/utils/tsdk-runtime');

const EXPECTED_QQ_CREDENTIAL_BYTES = Buffer.from(
    "344e0d774812caf143fabc83bfe2fef9f863b450d5ee978e5c7b50dfa10f02df7b677d833d074325d4af1336e9b41af6e9eed9df6baa76780968668b8710e1696ad5ea9521daf61434d125b367f5ed14ab19a19eb0ff76f74c42e5fc81da1d4188d7614ed3b8",
    "hex",
);

test('TSDK selects the mini-program host profile by account platform', () => {
    assert.deepEqual(resolveTsdkHostProfile('qq'), {
        appId: MINI_PROGRAM_APP_IDS.qq,
        debugMode: 0,
        deviceText: 'windows;windows;windows 10.0;0;',
        platform: 'qq',
        userDataPath: 'qqfile://usr/',
    });
    assert.deepEqual(resolveTsdkHostProfile('wx'), {
        appId: MINI_PROGRAM_APP_IDS.wx,
        debugMode: 2,
        platform: 'wx',
    });
});

test('QQ virtual user paths stay inside the account TSDK directory', () => {
    const dataDir = path.join(os.tmpdir(), 'qq-farm-tsdk-path-test');
    const runtime = new TsdkRuntime({ dataDir, platform: 'qq' });

    assert.equal(runtime.resolveDataPath('qqfile://usr/state.bin'), path.join(dataDir, 'state.bin'));
    assert.throws(
        () => runtime.resolveDataPath('qqfile://usr/../../outside.bin'),
        /TSDK 文件路径越出账号目录/,
    );
});

test('bundled TSDK matches the audited official QQ build', () => {
    const wasmPath = path.join(__dirname, '..', 'src', 'utils', 'tsdk.wasm');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(wasmPath)).digest('hex');

    assert.equal(TSDK_VERSION, 'v3.9.0.1790160550');
    assert.equal(hash, TSDK_SHA256);
});

test('QQ host inputs reproduce the complete audited credential byte vector', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-tsdk-test-'));
    const originalHttpsGet = https.get;
    let runtime;
    try {
        // Initialization seeds server time synchronously; the delayed network refresh is irrelevant to this vector.
        https.get = () => ({ on() { return this; } });
        runtime = new TsdkRuntime({
            accountId: 'credential-vector',
            dataDir: path.join(tempRoot, 'data'),
            platform: 'qq',
        });
        await runtime.init();
        runtime.bindUser('tsdk-regression-openid');

        const encoded = runtime.getEncryptedInitInfo();
        const decoded = Buffer.from(encoded, 'base64');
        assert.equal(encoded.length, 136);
        assert.deepEqual(decoded, EXPECTED_QQ_CREDENTIAL_BYTES);

        const plaintext = Buffer.from('tsdk-transform-regression');
        const encrypted = runtime.transform(plaintext, false);
        assert.notDeepEqual(encrypted, plaintext);
        assert.deepEqual(runtime.transform(encrypted, true), plaintext);
    } finally {
        runtime?.destroy();
        https.get = originalHttpsGet;
        const resolvedRoot = path.resolve(tempRoot);
        const resolvedTemp = path.resolve(os.tmpdir());
        assert.ok(resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`));
        assert.ok(path.basename(resolvedRoot).startsWith('qq-farm-tsdk-test-'));
        fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
});

test('WeChat loads its audited WASM and reports unsupported host calls without user data', async () => {
    const build = TSDK_BUILDS.wx;
    assert.equal(build.version, 'v3.9.0.1790237209');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/utils', build.file))).digest('hex'), build.sha256);
    const originalGet = https.get;
    const originalRequest = https.request;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-tsdk-wx-'));
    let runtime;
    try {
        https.get = () => ({ on() { return this; } });
        https.request = () => ({ on() { return this; }, end() {} });
        runtime = new TsdkRuntime({ dataDir, platform: 'wx' });
        await runtime.init();
        runtime.bindUser('synthetic-wx-openid');
        assert.equal(runtime.getDiagnostics().version, build.version);
        const plaintext = Buffer.from('synthetic-wechat-protocol-vector');
        const ciphertext = runtime.transform(plaintext);
        assert.notDeepEqual(ciphertext, plaintext);
        assert.deepEqual(runtime.transform(ciphertext, true), plaintext);
        assert.equal(runtime.createImports().a.e(), 0);
        assert.equal(runtime.getDiagnostics().unsupportedAceVmCalls, 1);
        assert.ok(runtime.getDiagnostics().lastUnsupportedAceVmAt > 0);
        assert.ok(!JSON.stringify(runtime.getDiagnostics()).includes('synthetic-wx-openid'));
        const pkgAssets = require('../package.json').pkg.assets;
        assert.ok(pkgAssets.includes('src/utils/tsdk-wx.wasm'));
        assert.match(fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8'), /COPY[^\n]+tsdk-wx\.wasm/);
    } finally {
        runtime?.destroy();
        https.get = originalGet;
        https.request = originalRequest;
        assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(dataDir).startsWith('qq-farm-tsdk-wx-'));
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('compiled pkg layout resolves platform WASM assets from src', async () => {
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    const filename = path.resolve(__dirname, '../dist/utils/tsdk-runtime.js');
    const realRequire = createRequire(filename);
    const sandbox = {
        require: name => name === '../config/runtime-paths'
            ? { getResourcePath: (...parts) => path.resolve(__dirname, '../dist', ...parts) }
            : realRequire(name),
        module: { exports: {} }, exports: {}, __dirname: path.dirname(filename),
        Buffer, WebAssembly, process, console,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    const originalGet = https.get;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-tsdk-pkg-'));
    try {
        https.get = () => ({ on() { return this; } });
        for (const platform of ['qq', 'wx']) {
            const runtime = new sandbox.module.exports.TsdkRuntime({ dataDir, platform });
            try {
                await runtime.init();
                assert.equal(runtime.getDiagnostics().version, TSDK_BUILDS[platform].version);
            } finally { runtime.destroy(); }
        }
    } finally {
        https.get = originalGet;
        assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(dataDir).startsWith('qq-farm-tsdk-pkg-'));
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
