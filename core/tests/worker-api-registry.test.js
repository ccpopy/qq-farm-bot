const assert = require('node:assert/strict');
const test = require('node:test');

const { createWorkerApiRegistry } = require('../dist/app/worker-api-registry');

function createRegistry() {
    return createWorkerApiRegistry({
        applyRuntimeConfigSnapshot: () => null,
        setAutomation: () => null,
        getDailyGiftOverview: async () => null,
        getSchedulers: () => null,
    });
}

test('worker API registry preserves the existing IPC method surface', () => {
    const registry = createRegistry();
    const expectedMethods = [
        'acceptCharityRedFlowerAgreement',
        'advanceWeatherResearch',
        'applyRuntimeConfigSnapshot',
        'buyFertilizer',
        'buyWeatherBottle',
        'checkAndBuyFertilizer',
        'claimBattlePassRewards',
        'claimCharityRedFlowerDailyGift',
        'claimCharityRedFlowerProgressReward',
        'claimCharityRedFlowerSeeds',
        'claimDogSkillGifts',
        'claimQingMeiDailySeed',
        'claimQixiBridgeRewards',
        'claimSolarTerm',
        'clearFriendsCache',
        'collectWeatherBottle',
        'continueQingMeiBrew',
        'delFriend',
        'deployDog',
        'doFarmOp',
        'doFriendOp',
        'donateCharityRedFlowerLove',
        'exchangeStarSandGoods',
        'exchangeWeatherCollectorBottle',
        'fertilizeOwnLand',
        'getActivityCenterSnapshot',
        'getActivityDirectorySnapshot',
        'getAnalytics',
        'getBag',
        'getBagSeeds',
        'getCurrentCharityRedFlowerActivity',
        'getCurrentQingMeiActivity',
        'getCurrentQixiActivity',
        'getCurrentSeasonEvent',
        'getCurrentSolarTerms',
        'getCurrentStarSandShop',
        'getCurrentStellarActivity',
        'getCurrentWeatherActivity',
        'getDailyGiftOverview',
        'getDiamondBalance',
        'getDogSkillGiftStatus',
        'getFriendInteractionItems',
        'getFriendLands',
        'getFriends',
        'getFriendsCache',
        'getIllustratedSnapshot',
        'getInteractRecords',
        'getLands',
        'getMallCatalog',
        'getMysteryShop',
        'getPetDiary',
        'getPetDiaryFriend',
        'getPetDiaryRecords',
        'getPetInfo',
        'getPetProtectLogs',
        'getSchedulers',
        'getSeeds',
        'getSelfInteractionItems',
        'getWeatherFriends',
        'giftQixiSachet',
        'lightConstellation',
        'lightWeatherResearch',
        'operatePetDiary',
        'purchaseMallProduct',
        'purchaseMysteryOffer',
        'scanWeatherFriends',
        'sellItems',
        'setAutomation',
        'setItemsLocked',
        'settleQingMeiBrew',
        'shareCharityRedFlower',
        'startQingMeiBrew',
        'summonWeatherRain',
        'useDogFood',
        'useFriendFarmInteractionItem',
        'useFriendInteractionItemBatch',
        'useItem',
        'useSelfInteractionItemBatch',
        'useWeatherCloudBottle',
        'useWeatherCollectorBottle',
        'useWeatherFrogBottle',
        'useWeatherSummonBottle',
        'withdrawDog',
    ];

    assert.deepEqual([...registry.keys()].sort(), expectedMethods);
});

test('only explicit local operations bypass account serialization', () => {
    const registry = createRegistry();
    const direct = [...registry]
        .filter(([, entry]) => entry.execution === 'direct')
        .map(([method]) => method)
        .sort();

    assert.deepEqual(direct, [
        'applyRuntimeConfigSnapshot',
        'getAnalytics',
        'getFriendsCache',
        'getSchedulers',
    ]);
    const selfQueued = [...registry]
        .filter(([, entry]) => entry.execution === 'self-queued')
        .map(([method]) => method)
        .sort();

    assert.deepEqual(selfQueued, [
        'getFriends',
        'getWeatherFriends',
        'scanWeatherFriends',
    ]);
    const freshReads = [...registry]
        .filter(([, entry]) => entry.execution === 'read-fresh')
        .map(([method]) => method)
        .sort();

    assert.deepEqual(freshReads, [
        'getBag',
        'getSeeds',
    ]);
    assert.equal(registry.get('getFriendLands').execution, 'queued');
    assert.equal(registry.get('getCurrentWeatherActivity').execution, 'queued');
});

test('pet diary IPC reaches the activity service through the account queue', async (t) => {
    const activity = require('../dist/services/activity-center/index');
    const { executeWorkerApiCall } = require('../dist/app/worker-api-dispatcher');
    const examples = [
        ['getPetDiary', []],
        ['getPetDiaryFriend', ['1001851355']],
        ['getPetDiaryRecords', ['plunder']],
        ['operatePetDiary', ['openTreasure', {}]],
    ];
    const calls = [];
    const queued = [];
    for (const [method] of examples) {
        t.mock.method(activity, method, (...args) => {
            calls.push([method, args]);
            return { method };
        });
    }
    const registry = createRegistry();
    for (const [method, args] of examples) {
        const response = await executeWorkerApiCall(method, args, registry, {
            isAccountReady: () => true,
            submitTask: async (name, run, options) => {
                queued.push([name, options.priority]);
                return run();
            },
        });
        assert.deepEqual(response, { result: { method }, error: null });
    }
    assert.deepEqual(calls, examples);
    assert.deepEqual(queued, examples.map(([method]) => [`api:${method}`, 'interactive']));
});
