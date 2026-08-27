const assert = require('node:assert/strict');
const test = require('node:test');

test('friend pet synchronization submits the list and each friend visit to the account queue', async (t) => {
    const runner = require('../dist/app/account-task-runner');
    const store = require('../dist/models/store');
    const network = require('../dist/utils/network');
    const utils = require('../dist/utils/utils');
    const friendApi = require('../dist/services/friend/api');
    const gidManager = require('../dist/services/friend/gid-manager');
    const petCache = require('../dist/services/friend/pet-cache');
    const visitStrategy = require('../dist/services/friend/visit-strategy');
    const petSyncModulePath = require.resolve('../dist/services/friend/pet-sync');
    const originals = {
        submitAccountTask: runner.submitAccountTask,
        isAutomationOn: store.isAutomationOn,
        getFriendBlacklist: store.getFriendBlacklist,
        getUserState: network.getUserState,
        sleep: utils.sleep,
        log: utils.log,
        logWarn: utils.logWarn,
        getAllFriends: friendApi.getAllFriends,
        enterFriendFarm: friendApi.enterFriendFarm,
        leaveFriendFarm: friendApi.leaveFriendFarm,
        extractReplyFriends: gidManager.extractReplyFriends,
        getInvalidKnownFriendGidSet: gidManager.getInvalidKnownFriendGidSet,
        isFriendDogKnownToday: petCache.isFriendDogKnownToday,
        isFullSyncDoneToday: petCache.isFullSyncDoneToday,
        markFullSyncDone: petCache.markFullSyncDone,
        getFriendPetCacheStats: petCache.getFriendPetCacheStats,
        inFriendQuietHours: visitStrategy.inFriendQuietHours,
        handleFriendEnterError: visitStrategy.handleFriendEnterError,
    };
    t.after(() => {
        Object.assign(runner, { submitAccountTask: originals.submitAccountTask });
        Object.assign(store, {
            isAutomationOn: originals.isAutomationOn,
            getFriendBlacklist: originals.getFriendBlacklist,
        });
        Object.assign(network, { getUserState: originals.getUserState });
        Object.assign(utils, {
            sleep: originals.sleep,
            log: originals.log,
            logWarn: originals.logWarn,
        });
        Object.assign(friendApi, {
            getAllFriends: originals.getAllFriends,
            enterFriendFarm: originals.enterFriendFarm,
            leaveFriendFarm: originals.leaveFriendFarm,
        });
        Object.assign(gidManager, {
            extractReplyFriends: originals.extractReplyFriends,
            getInvalidKnownFriendGidSet: originals.getInvalidKnownFriendGidSet,
        });
        Object.assign(petCache, {
            isFriendDogKnownToday: originals.isFriendDogKnownToday,
            isFullSyncDoneToday: originals.isFullSyncDoneToday,
            markFullSyncDone: originals.markFullSyncDone,
            getFriendPetCacheStats: originals.getFriendPetCacheStats,
        });
        Object.assign(visitStrategy, {
            inFriendQuietHours: originals.inFriendQuietHours,
            handleFriendEnterError: originals.handleFriendEnterError,
        });
        delete require.cache[petSyncModulePath];
    });

    const submissions = [];
    const visits = [];
    runner.submitAccountTask = async (name, run, options) => {
        submissions.push({ name, options });
        return run();
    };
    store.isAutomationOn = () => true;
    store.getFriendBlacklist = () => [];
    network.getUserState = () => ({ gid: 99 });
    utils.sleep = async () => {};
    utils.log = () => {};
    utils.logWarn = () => {};
    friendApi.getAllFriends = async () => ({ game_friends: [
        { gid: 11, name: 'friend-11' },
        { gid: 12, name: 'friend-12' },
    ] });
    friendApi.enterFriendFarm = async (gid) => {
        visits.push(`enter:${gid}`);
        return {};
    };
    friendApi.leaveFriendFarm = async (gid) => {
        visits.push(`leave:${gid}`);
    };
    gidManager.extractReplyFriends = reply => reply.game_friends;
    gidManager.getInvalidKnownFriendGidSet = () => new Set();
    petCache.isFriendDogKnownToday = () => false;
    petCache.isFullSyncDoneToday = () => false;
    petCache.markFullSyncDone = () => {};
    petCache.getFriendPetCacheStats = () => ({ known: 2, protect: 0 });
    visitStrategy.inFriendQuietHours = () => false;
    visitStrategy.handleFriendEnterError = () => ({ handled: false, kind: '' });

    delete require.cache[petSyncModulePath];
    const { runFriendPetSync } = require(petSyncModulePath);
    const result = await runFriendPetSync();

    assert.equal(result.outcome, 'synced');
    assert.deepEqual(submissions.map(entry => entry.name), [
        'friend.pet-sync.list',
        'friend.pet-sync:11',
        'friend.pet-sync:12',
    ]);
    assert.deepEqual(submissions.map(entry => entry.options.priority), [
        'maintenance',
        'maintenance',
        'maintenance',
    ]);
    assert.deepEqual(visits, ['enter:11', 'leave:11', 'enter:12', 'leave:12']);
});
