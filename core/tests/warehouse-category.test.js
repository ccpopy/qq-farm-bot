const assert = require('node:assert/strict');
const test = require('node:test');

test('bag details distinguish ordinary fruit, mutant fruit and seeds while preserving UID stacks', async (t) => {
    const { loadProto, types } = require('../dist/utils/proto');
    await loadProto();
    const { getItemsByType } = require('../dist/config/gameConfig');
    const network = require('../dist/utils/network');
    const windows = require('../dist/services/activity-windows');
    const warehousePath = require.resolve('../dist/services/warehouse');
    const original = { send: network.sendMsgAsync, context: windows.getSellConditionContext, module: require.cache[warehousePath] };
    const source = [5, 17, 6].map((type, index) => ({
        id: getItemsByType(type)[0].id,
        count: index + 1,
        uid: index + 100,
    }));
    network.sendMsgAsync = async (_service, method) => {
        assert.equal(method, 'Bag');
        return { body: types.BagReply.encode(types.BagReply.create({ item_bag: { items: source } })).finish() };
    };
    windows.getSellConditionContext = async () => ({ nowSec: 0, activityWindows: new Map() });
    delete require.cache[warehousePath];
    t.after(() => {
        network.sendMsgAsync = original.send;
        windows.getSellConditionContext = original.context;
        if (original.module) require.cache[warehousePath] = original.module;
        else delete require.cache[warehousePath];
    });
    const result = await require(warehousePath).getBagDetail();
    assert.deepEqual(result.items.map(item => [item.itemType, item.category, item.uid, item.count]), [
        [6, 'fruit', 102, 3],
        [17, 'mutant', 101, 2],
        [5, 'seed', 100, 1],
    ]);
    assert.equal(result.originalItems.length, 3);
});
