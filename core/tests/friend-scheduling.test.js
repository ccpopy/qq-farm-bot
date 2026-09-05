const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { AccountTaskRunner } = require('../dist/app/account-task-runner');
const { buildFriendVisitPlan } = require('../dist/services/friend/visit-plan');

function loadModule(relativePath, mocks, clock = { now: 1000 }) {
    const filename = path.resolve(__dirname, '../dist', relativePath);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports,
        require: name => mocks[name] || {},
        process: { env: { FARM_ACCOUNT_ID: 'scheduling-test' } },
        Date: class extends Date { static now() { return clock.now; } },
    }, { filename });
    return module.exports;
}

function friendRuntime(count = 500) {
    const clock = { now: 1000 };
    const visited = [];
    const logs = [];
    const automation = { friend: true, friend_steal: true };
    const blacklist = [];
    const tasks = new AccountTaskRunner();
    let scans = 0;
    let date = '2026-09-05';
    let quiet = false;
    const friends = Array.from({ length: count }, (_, index) => ({
        gid: index + 1, plant: { steal_plant_num: 1 },
    }));
    const noop = () => {};
    const runtime = { clock, automation, blacklist, visited, logs, tasks, friends,
        scans: () => scans, setDate: value => { date = value; }, setQuiet: value => { quiet = value; },
        afterVisit: noop, wait: async () => {},
    };
    runtime.scheduler = loadModule('services/friend/scheduler.js', {
        'node:crypto': require('node:crypto'),
        'node:timers/promises': { setTimeout: (...args) => runtime.wait(...args) },
        '../../app/account-task-runner': { submitAccountTask: (...args) => tasks.submit(...args) },
        '../../config/config': { CONFIG: {} },
        '../../config/runtime-paths': { getDataFile: name => name },
        '../../utils/network': { getUserState: () => ({ gid: 999, accountId: 'test' }), networkEvents: { off: noop } },
        '../../utils/utils': {
            toNum: Number, getSystemDateKey: () => date,
            log: (_, message, meta) => logs.push({ message, ...meta }), logWarn: noop,
            randomDelay: async () => { clock.now += 650; },
        },
        '../../models/store': { isAutomationOn: key => !!automation[key], getFriendBlacklist: () => blacklist },
        '../scheduler': { createScheduler: () => ({ clearAll: noop }) },
        '../json-db': { readJsonFile: () => ({}), writeJsonFileAtomic: noop },
        '../warehouse': { sellAllFruits: async () => {} },
        './api': { getAllFriends: async () => { scans++; return friends; } },
        './gid-manager': { extractReplyFriends: reply => reply, clearAllInvalidKnownFriendGidCooldowns: noop },
        './visit-plan': { buildFriendVisitPlan },
        './visit-strategy': {
            visitFriend: async (target, totals, myGid, accountId, options) => {
                visited.push(target.gid);
                clock.now += 150;
                if (options.allowSteal) totals.steal++;
                await runtime.afterVisit(target, options);
                return { entered: true, acted: true };
            },
            inFriendQuietHours: () => quiet, cacheFriendsListFromReply: noop, clearFriendsListCache: noop,
        },
        './pet-cache': { getFriendDogState: () => 'unknown', flushFriendPetCacheNow: noop },
        './pet-sync': { stopFriendPetSyncTimer: noop },
    }, clock);
    return runtime;
}

test('500 friends use one list scan while farm and manual tasks run between visits', async (t) => {
    const runtime = friendRuntime();
    const farmRuns = [];
    const pending = [];
    const slices = Array.from({ length: 500 }, () => {
        let started, release;
        const start = new Promise(resolve => { started = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        return { start, held, started, release };
    });
    runtime.afterVisit = async target => {
        if (target.gid > 1) assert.equal(farmRuns.at(-1), target.gid - 1);
        slices[target.gid - 1].started();
        await slices[target.gid - 1].held;
    };
    const scan = runtime.scheduler.checkFriends();
    for (const [index, slice] of slices.entries()) {
        await slice.start;
        // Submit from outside the active task so these jobs really enter the queue.
        pending.push(runtime.tasks.submit('farm', () => farmRuns.push(index + 1), { priority: 'scheduled' }));
        pending.push(runtime.tasks.submit('manual', () => {}, { priority: 'interactive' }));
        slice.release();
    }
    assert.equal(await scan, true);
    await Promise.all(pending);
    assert.equal(runtime.scans(), 1);
    assert.equal(new Set(runtime.visited).size, 500);
    assert.equal(farmRuns.length, 500);
    assert.equal(runtime.logs.filter(log => log.event === '好友巡查进度').length, 10);
    assert.ok(runtime.logs.at(-1).durationMs > 0);
    t.diagnostic('500 friends, one list scan; farm and manual tasks serviced between every visit (simulated)');
});

test('blacklist changes are checked again after a visit has waited in the account queue', async () => {
    const runtime = friendRuntime(4);
    runtime.afterVisit = target => {
        if (target.gid === 1) {
            void runtime.tasks.submit('blacklist', () => runtime.blacklist.push(2), { priority: 'interactive' });
        }
    };
    await runtime.scheduler.checkFriends();
    assert.deepEqual(runtime.visited, [1, 3, 4]);
});

for (const reason of ['stop', 'new day', 'quiet hours', 'friend disabled', 'operation disabled']) {
    test(`${reason} ends a running round; the next round starts with a fresh list`, async () => {
        const runtime = friendRuntime(4);
        runtime.afterVisit = () => {
            if (reason === 'stop') runtime.scheduler.stopFriendCheckLoop();
            if (reason === 'new day') runtime.setDate('2026-09-06');
            if (reason === 'quiet hours') runtime.setQuiet(true);
            if (reason === 'friend disabled') runtime.automation.friend = false;
            if (reason === 'operation disabled') runtime.automation.friend_steal = false;
        };
        await runtime.scheduler.checkFriends();
        assert.deepEqual(runtime.visited, [1]);
        runtime.afterVisit = () => {};
        runtime.setQuiet(false);
        runtime.automation.friend = true;
        runtime.automation.friend_steal = true;
        await runtime.scheduler.checkFriends();
        assert.equal(runtime.scans(), 2);
        assert.deepEqual(runtime.visited, [1, 1, 2, 3, 4]);
    });
}

test('gateway backoff retains the next friend and releases the account queue', async () => {
    const runtime = friendRuntime(4);
    let stalled = false;
    let farmRan = false;
    runtime.afterVisit = target => { if (target.gid === 1) stalled = true; };
    runtime.wait = async delay => {
        assert.equal(delay, 30000);
        assert.deepEqual(runtime.visited, [1]);
        await runtime.tasks.submit('farm', () => { farmRan = true; });
        stalled = false;
    };
    await runtime.scheduler.checkFriends({ nextVisitDeferMs: () => stalled ? 30000 : 0 });
    assert.equal(farmRan, true);
    assert.equal(runtime.scans(), 1);
    assert.deepEqual(runtime.visited, [1, 2, 3, 4]);
});

test('abort while a friend is queued prevents that visit from entering', async () => {
    const runtime = friendRuntime(4);
    const controller = new AbortController();
    runtime.afterVisit = target => {
        if (target.gid === 1) void runtime.tasks.submit('stop', () => controller.abort(), { priority: 'interactive' });
    };
    assert.equal(await runtime.scheduler.checkFriends({ signal: controller.signal }), false);
    assert.deepEqual(runtime.visited, [1]);
});

test('an exhausted help quota still allows stealing during the rest of the round', async () => {
    const runtime = friendRuntime(4);
    runtime.automation.friend_help = true;
    runtime.automation.friend_help_exp_limit = true;
    for (const friend of runtime.friends) friend.plant.dry_num = 1;
    const helpAllowed = [];
    runtime.afterVisit = (target, options) => {
        helpAllowed.push(options.allowHelp);
        if (target.gid === 1) runtime.scheduler.setCanGetHelpExp(false);
    };
    await runtime.scheduler.checkFriends();
    assert.deepEqual(helpAllowed, [true, false, false, false]);
    assert.deepEqual(runtime.visited, [1, 2, 3, 4]);
});

function visitSession(events, tasks = new AccountTaskRunner()) {
    return loadModule('services/friend/visit-session.js', {
        '../../app/account-task-runner': { submitAccountTask: (...args) => tasks.submit(...args) },
        './api': {
            enterFriendFarm: async gid => { events.push(`enter:${gid}`); return { gid }; },
            leaveFriendFarm: async (gid, priority) => { events.push(`leave:${gid}:${priority}`); },
        },
        '../../utils/request-context': { runWithRequestClass: (_, fn) => fn() },
    });
}

test('friend sessions serialize Enter/operation/Leave and release the queue after failure', async () => {
    const events = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const session = visitSession(events);
    const first = session.withFriendFarmVisit(1, async () => { await held; throw new Error('operation failed'); });
    const rejected = assert.rejects(first, /operation failed/);
    const second = session.withFriendFarmVisit(2, async reply => { events.push(`work:${reply.gid}`); }, 'low');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['enter:1']);
    release();
    await Promise.all([rejected, second]);
    assert.deepEqual(events, ['enter:1', 'leave:1:normal', 'enter:2', 'work:2', 'leave:2:normal']);
});

test('a queued visit followed by a session inside another account task does not deadlock', async () => {
    const tasks = new AccountTaskRunner();
    const events = [];
    const session = visitSession(events, tasks);
    const direct = session.withFriendFarmVisit(1, async () => {});
    const nested = tasks.submit('manual', () => session.withFriendFarmVisit(2, async () => {}), { priority: 'interactive' });
    await Promise.all([direct, nested]);
    assert.deepEqual(events, ['enter:2', 'leave:2:normal', 'enter:1', 'leave:1:normal']);
});

test('a failed Enter does not send Leave or block the next friend', async () => {
    const events = [];
    const tasks = new AccountTaskRunner();
    const session = loadModule('services/friend/visit-session.js', {
        '../../app/account-task-runner': { submitAccountTask: (...args) => tasks.submit(...args) },
        './api': {
            enterFriendFarm: async gid => { if (gid === 1) throw new Error('enter failed'); return { gid }; },
            leaveFriendFarm: async gid => { events.push(`leave:${gid}`); },
        },
    });
    await assert.rejects(session.withFriendFarmVisit(1, async () => { events.push('unexpected'); }), /enter failed/);
    assert.equal(await session.withFriendFarmVisit(2, async reply => reply.gid), 2);
    assert.deepEqual(events, ['leave:2']);
});
