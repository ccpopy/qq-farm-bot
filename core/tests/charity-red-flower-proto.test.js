const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

async function loadRoot() {
    const root = new protobuf.Root();
    await root.load([
        path.join(__dirname, '../src/proto/activitypb.proto'),
        path.join(__dirname, '../src/proto/corepb.proto'),
    ], { keepCase: true });
    return root;
}

test('charity red flower requests reproduce the capture-verified selectors', async () => {
    const root = await loadRoot();
    const Request = root.lookupType('gamepb.activitypb.CharityRedFlowerOperateRequest');
    const encode = payload => Buffer.from(Request.encode(Request.create({
        activity_id: '2026090901',
        ...payload,
    })).finish()).toString('hex');

    assert.equal(encode({ operate_type: 35, claim_seed: {} }), '0895e38ec6071023b20800');
    assert.equal(encode({ operate_type: 36, donate_love: {} }), '0895e38ec6071024ba0800');
    assert.equal(encode({ operate_type: 37, claim_progress_reward: { target: 30 } }), '0895e38ec6071025c20802081e');
    assert.equal(encode({ operate_type: 38, send_public_fund: {} }), '0895e38ec6071026ca0800');
    assert.equal(encode({ operate_type: 39, agreement: { accepted: true } }), '0895e38ec6071027d208020801');
});

test('charity red flower share reproduces the capture-verified share selector', async () => {
    const root = await loadRoot();
    await root.load(path.join(__dirname, '../src/proto/sharepb.proto'), { keepCase: true });
    const Request = root.lookupType('gamepb.sharepb.ReportShareRequest');
    const encoded = Buffer.from(Request.encode(Request.create({
        field_1: 15,
        field_4: 1501,
    })).finish()).toString('hex');

    assert.equal(encoded, '080f20dd0b');
});

test('charity red flower reward replies decode the verified result selectors', async () => {
    const root = await loadRoot();
    const Reply = root.lookupType('gamepb.activitypb.ActivityOperateReply');
    const seedReply = Reply.decode(Buffer.from(
        '0895e38ec6071023ba08180a160893a3011006188092b8c398feffffff01309a153801',
        'hex',
    ));
    const fundReply = Reply.decode(Buffer.from(
        '0895e38ec6071026d208590801121251514e43323639394d5732303236303930311a160881f1041002188092b8c398feffffff0130a3153801222c32303236303930315f63665f6634363830383363386365323761666139323730363466393236643533643462',
        'hex',
    ));
    const progressReply = Reply.decode(Buffer.from(
        '0895e38ec6071025ca080a081e1206088df1041001',
        'hex',
    ));
    const agreementReply = Reply.decode(Buffer.from(
        '0895e38ec6071027da08020801',
        'hex',
    ));

    assert.equal(Number(seedReply.charity_seed_result.reward.id), 20883);
    assert.equal(Number(seedReply.charity_seed_result.reward.count), 6);
    assert.equal(Number(fundReply.charity_public_fund_result.status), 1);
    assert.equal(Number(fundReply.charity_public_fund_result.reward.id), 80001);
    assert.equal(Number(fundReply.charity_public_fund_result.reward.count), 2);
    assert.equal(fundReply.charity_public_fund_result.order_id, 'QQNC2699MW20260901');
    assert.equal(fundReply.charity_public_fund_result.token, '20260901_cf_f468083c8ce27afa927064f926d53d4b');
    assert.equal(Number(progressReply.charity_progress_reward_result.target), 30);
    assert.equal(Number(progressReply.charity_progress_reward_result.reward.id), 80013);
    assert.equal(Number(progressReply.charity_progress_reward_result.reward.count), 1);
    assert.equal(agreementReply.charity_agreement_result.accepted, true);
});

test('charity state keeps the capture-observed status codes without guessing new semantics', () => {
    const {
        CHARITY_RED_FLOWER_ACTIVITY_ID,
        charityRedFlowerDto,
        findActivityData,
    } = require('../dist/services/activity-center/charity-state');
    const entries = [{
        activity: { activity_id: '2026090900' },
        children: [{
            activity: {
                activity_id: '2026090901',
                group_id: '2026090900',
                name: '公益小红花',
                begin_time: 1788192000,
                end_time: 1788969599,
            },
            charity_red_flower: {
                love_item_id: 1040,
                love_balance: 22,
                donated_love: 0,
                global_donated_love: 46958859,
                global_target_love: 1000000000,
                seed_reward_status: 1,
                seed_reward: { item_id: 20883, count: 6 },
                settlement_required_love: 20,
                end_time: 1788969599,
                daily_reward_status: 0,
                flow_status: 2,
                agreement_status: 0,
                daily_reward: { item_id: 80001, count: 2 },
            },
        }],
    }];

    const entry = findActivityData(entries, CHARITY_RED_FLOWER_ACTIVITY_ID);
    const dto = charityRedFlowerDto(entry, 1788252059);

    assert.equal(dto.activityId, '2026090901');
    assert.equal(dto.loveBalance, '22');
    assert.equal(dto.seedReward.statusCode, '1');
    assert.equal(dto.seedReward.claimable, false);
    assert.equal(dto.seedReward.claimed, false);
    assert.equal(dto.flowStatus, '2');
    assert.equal(dto.agreementStatus, '0');
    assert.equal(dto.actions.acceptAgreement.enabled, true);
    assert.equal(dto.actions.share.enabled, false);
    assert.equal(dto.actions.claimDailyGift.enabled, false);
});

test('charity public fund becomes available only after enough love was donated', () => {
    const { charityRedFlowerDto } = require('../dist/services/activity-center/charity-state');
    const base = {
        activity: {
            activity_id: '2026090901',
            begin_time: 1788192000,
            end_time: 1788969599,
        },
        charity_red_flower: {
            donated_love: 22,
            settlement_required_love: 20,
            end_time: 1788969599,
            agreement_status: 1,
        },
    };
    const available = charityRedFlowerDto(base, 1788252059);
    assert.equal(available.actions.acceptAgreement.enabled, false);
    assert.equal(available.actions.share.enabled, true);
    assert.equal(available.actions.claimDailyGift.enabled, true);

    base.charity_red_flower.public_fund = { date: 20260901, status: 1, order_id: 'order' };
    const claimed = charityRedFlowerDto(base, 1788252059);
    assert.equal(claimed.dailyGift.claimed, true);
    assert.equal(claimed.actions.claimDailyGift.enabled, false);
});

test('charity progress reward distinguishes reached, claimable, and claimed states', () => {
    const { charityRedFlowerDto } = require('../dist/services/activity-center/charity-state');
    const base = {
        activity: {
            activity_id: '2026090901',
            begin_time: 1788192000,
            end_time: 1788969599,
        },
        charity_red_flower: {
            donated_love: 31,
            end_time: 1788969599,
            progress_rewards: [
                { target: 30, reward: { item_id: 80013, count: 1 }, status: 1 },
                { target: 60, reward: { item_id: 1002, count: 50 } },
            ],
        },
    };

    const beforeClaim = charityRedFlowerDto(base, 1788252059);
    assert.equal(beforeClaim.progressRewards[0].reached, true);
    assert.equal(beforeClaim.progressRewards[0].claimable, true);
    assert.equal(beforeClaim.progressRewards[0].claimed, false);
    assert.equal(beforeClaim.actions.claimProgressReward.enabled, true);

    base.charity_red_flower.progress_rewards[0].claimed = true;
    const afterClaim = charityRedFlowerDto(base, 1788252059);
    assert.equal(afterClaim.progressRewards[0].claimable, false);
    assert.equal(afterClaim.progressRewards[0].claimed, true);
    assert.equal(afterClaim.actions.claimProgressReward.enabled, false);
});

test('charity task summary matches the three small-red-flower seed tasks in the capture', () => {
    const { charitySeedTaskSummary } = require('../dist/services/activity-center/charity-state');
    const taskInfoReply = {
        task_info: {
            tasks: [
                {
                    id: 101040,
                    progress: 130,
                    total_progress: 132,
                    is_unlocked: true,
                    desc: '等级提升至132级',
                    task_type: 1,
                },
                {
                    id: 200017,
                    progress: 1,
                    total_progress: 1,
                    is_claimed: true,
                    is_unlocked: true,
                    desc: '采摘1次果实',
                    task_type: 2,
                    group: 2,
                    cond_type: 17,
                    extra_rewards: [{ id: 20883, count: 6 }],
                },
                {
                    id: 200018,
                    progress: 1,
                    total_progress: 1,
                    is_claimed: true,
                    is_unlocked: true,
                    desc: '在1个好友农场进行互动',
                    task_type: 2,
                    group: 3,
                    cond_type: 18,
                    extra_rewards: [{ id: 20883, count: 6 }],
                },
                {
                    id: 200016,
                    progress: 1,
                    total_progress: 1,
                    is_claimed: true,
                    is_unlocked: true,
                    desc: '每日登录游戏',
                    task_type: 2,
                    group: 1,
                    cond_type: 16,
                    extra_rewards: [{ id: 20883, count: 6 }],
                },
            ],
        },
    };

    const summary = charitySeedTaskSummary(taskInfoReply);

    assert.equal(summary.totalCount, 3);
    assert.equal(summary.completedCount, 3);
    assert.equal(summary.claimedCount, 3);
    assert.equal(summary.claimableCount, 0);
    assert.deepEqual(summary.tasks.map(task => task.id), ['200016', '200017', '200018']);
    assert.deepEqual(summary.tasks.map(task => task.seedReward.count), ['6', '6', '6']);
});

test('charity inventory and lands distinguish seeds, growing flowers, and harvestable flowers', () => {
    const {
        charityInventory,
        charityRedFlowerLandSummary,
    } = require('../dist/services/activity-center/charity-state');
    const inventory = charityInventory({
        item_bag: {
            items: [
                { id: 1040, count: 22 },
                { id: 20883, count: 12 },
                { id: 20883, count: 6 },
            ],
        },
    });
    const lands = charityRedFlowerLandSummary({
        lands: [
            { id: 1, plant: { id: 1020090, phases: [{ phase: 6, begin_time: 900 }] } },
            {
                id: 2,
                plant: {
                    id: 1020883,
                    season: 1,
                    phases: [{ phase: 1, begin_time: 900 }, { phase: 6, begin_time: 1200 }],
                },
            },
            {
                id: 3,
                plant: {
                    id: 1020883,
                    season: 1,
                    phases: [{ phase: 1, begin_time: 800 }, { phase: 6, begin_time: 950 }],
                },
            },
        ],
    }, 1000);

    assert.equal(inventory.seed.count, '18');
    assert.equal(inventory.love.count, '22');
    assert.equal(lands.total, 2);
    assert.equal(lands.growing, 1);
    assert.equal(lands.harvestable, 1);
    assert.equal(lands.dead, 0);
    assert.deepEqual(lands.landIds, ['2', '3']);
    assert.deepEqual(lands.details.map(land => land.status), ['growing', 'harvestable']);
});
