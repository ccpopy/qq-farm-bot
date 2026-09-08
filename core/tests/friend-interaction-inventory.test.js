const assert = require('node:assert/strict');
const test = require('node:test');

test('friend interaction inventory shares one bag and activity read and does not overlap them', async (t) => {
    const warehouse = require('../dist/services/warehouse');
    const windows = require('../dist/services/activity-windows');
    const modulePath = require.resolve('../dist/services/friend-interaction-items');
    const originalBag = warehouse.getBag;
    const originalContext = windows.getSellConditionContext;
    const originalModule = require.cache[modulePath];
    const calls = [];
    warehouse.getBag = async () => {
        calls.push('bag:start');
        await new Promise(resolve => setImmediate(resolve));
        calls.push('bag:end');
        return { item_bag: { items: [
            { id: 301101, uid: 1, count: 3 },
            { id: 5005, uid: 2, count: 2 },
            { id: 5003, uid: 3, count: 1 },
            { id: 301102, uid: 4, count: 4, locked: true },
        ] } };
    };
    windows.getSellConditionContext = async () => {
        calls.push('activity');
        assert.deepEqual(calls, ['bag:start', 'bag:end', 'activity']);
        return { nowSec: 0, activityWindows: new Map() };
    };
    delete require.cache[modulePath];
    t.after(() => {
        warehouse.getBag = originalBag;
        windows.getSellConditionContext = originalContext;
        if (originalModule) require.cache[modulePath] = originalModule;
        else delete require.cache[modulePath];
    });
    const result = await require(modulePath).getFriendInteractionItems();
    assert.deepEqual(calls, ['bag:start', 'bag:end', 'activity']);
    assert.deepEqual(result.items.map(item => [item.itemId, item.count, item.targetKind]), [
        ['301101', 3, 'land'],
        ['5005', 2, 'farm'],
    ]);
});
