export {};
/**
 * 公益小红花 - 领取种子、捐赠爱心与领取每日公益礼包。
 */

const { sendMsgAsync } = require('../../utils/network');
const { types } = require('../../utils/proto');
const { getServerTimeSec } = require('../../utils/utils');
const {
    int64String,
    int64Number,
    compareInt64,
    itemDto,
    bytesToText,
    textContent,
    businessError,
    activityWindowIsActive,
} = require('./shared');

const CHARITY_RED_FLOWER_GROUP_ID = '2026090900';
const CHARITY_RED_FLOWER_ACTIVITY_ID = '2026090901';
const CLAIM_CHARITY_SEED_OPERATE_TYPE = 35;
const DONATE_CHARITY_LOVE_OPERATE_TYPE = 36;
const CLAIM_CHARITY_DAILY_GIFT_OPERATE_TYPE = 38;

// snapshot 依赖本模块，写操作又要回传最新快照；延迟 require 打破循环依赖。
function getActivityCenterSnapshot() {
    return require('./snapshot').getActivityCenterSnapshot();
}

async function queryActivityListReply(): Promise<any> {
    const body = Buffer.from(types.ActivityListRequest.encode(types.ActivityListRequest.create({})).finish());
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.activitypb.ActivityService',
        'List',
        body,
    );
    return types.ActivityListReply.decode(replyBody);
}

function findActivityData(entries: any[], activityId: string): any | null {
    const queue = Array.isArray(entries) ? [...entries] : [];
    while (queue.length > 0) {
        const entry = queue.shift();
        if (int64String(entry?.activity?.activity_id) === activityId) return entry;
        if (Array.isArray(entry?.children)) queue.push(...entry.children);
    }
    return null;
}

function charityRedFlowerDto(entry: any) {
    const activity = entry?.activity || {};
    const state = entry?.charity_red_flower;
    if (!state) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '服务端未发现公益小红花活动状态');

    const serverTime = getServerTimeSec();
    const activityEndTime = int64Number(activity?.end_time);
    const stateEndTime = int64Number(state?.end_time);
    const endTime = stateEndTime > 0 ? stateEndTime : activityEndTime;
    const active = activityWindowIsActive({ begin_time: activity?.begin_time, end_time: endTime }, serverTime);
    const loveBalance = int64String(state?.love_balance);
    const donatedLove = int64String(state?.donated_love);
    const globalDonatedLove = int64String(state?.global_donated_love);
    const globalTargetLove = int64String(state?.global_target_love);
    const seedRewardStatus = int64String(state?.seed_reward_status);
    const publicFundStatus = int64String(state?.public_fund?.status);
    const dailyGiftClaimed = publicFundStatus !== '0'
        || int64String(state?.public_fund?.date) !== '0'
        || !!state?.public_fund?.order_id;
    const progressRewards = (Array.isArray(state?.progress_rewards) ? state.progress_rewards : []).map((reward: any) => {
        const target = int64String(reward?.target);
        return {
            target,
            reward: itemDto(reward?.reward),
            statusCode: int64String(reward?.status),
            reached: compareInt64(donatedLove, target) >= 0,
            claimSupported: false,
        };
    });
    const globalRewardTarget = int64String(state?.global_reward?.target) !== '0'
        ? int64String(state?.global_reward?.target)
        : globalTargetLove;

    return {
        groupId: CHARITY_RED_FLOWER_GROUP_ID,
        activityId: CHARITY_RED_FLOWER_ACTIVITY_ID,
        name: bytesToText(activity?.name) || '公益小红花',
        title: bytesToText(activity?.name) || '公益小红花',
        startTime: int64String(activity?.begin_time),
        endTime: String(endTime || 0),
        serverTime: String(serverTime),
        active,
        rules: textContent(activity?.extra),
        love: itemDto({ item_id: state?.love_item_id, count: loveBalance }),
        loveBalance,
        donatedLove,
        flowStatus: int64String(state?.flow_status),
        seedReward: {
            statusCode: seedRewardStatus,
            claimable: seedRewardStatus === '2',
            claimed: seedRewardStatus === '3',
            reward: itemDto(state?.seed_reward),
        },
        dailyGift: {
            statusCode: int64String(state?.daily_reward_status),
            claimed: dailyGiftClaimed,
            reward: itemDto(state?.daily_reward),
            publicFund: dailyGiftClaimed ? {
                date: int64String(state?.public_fund?.date),
                statusCode: publicFundStatus,
            } : null,
        },
        progressRewards,
        globalProgress: {
            donated: globalDonatedLove,
            target: globalTargetLove,
            reached: compareInt64(globalDonatedLove, globalTargetLove) >= 0,
            rewardTarget: globalRewardTarget,
            reward: itemDto(state?.global_reward?.reward),
        },
        settlement: {
            requiredLove: int64String(state?.settlement_required_love),
            eligible: compareInt64(donatedLove, state?.settlement_required_love) >= 0,
            reward: itemDto(state?.settlement_reward),
        },
        actions: {
            claimSeeds: {
                enabled: active && seedRewardStatus === '2',
                available: active && seedRewardStatus === '2',
                availabilityKnown: true,
            },
            donateLove: {
                enabled: active && compareInt64(loveBalance, '0') > 0,
                available: active && compareInt64(loveBalance, '0') > 0,
                availabilityKnown: true,
                count: int64Number(loveBalance),
            },
            claimDailyGift: {
                enabled: active && !dailyGiftClaimed,
                available: active && !dailyGiftClaimed,
                attemptable: active && !dailyGiftClaimed,
                availabilityKnown: false,
            },
        },
    };
}

async function getCurrentCharityRedFlowerActivity() {
    const reply = await queryActivityListReply();
    const entry = findActivityData(reply?.activities, CHARITY_RED_FLOWER_ACTIVITY_ID);
    return entry?.charity_red_flower ? charityRedFlowerDto(entry) : null;
}

async function operateCharityRedFlower(operateType: number, selector: Record<string, unknown>) {
    const request = types.CharityRedFlowerOperateRequest.create({
        activity_id: CHARITY_RED_FLOWER_ACTIVITY_ID,
        operate_type: operateType,
        ...selector,
    });
    const body = Buffer.from(types.CharityRedFlowerOperateRequest.encode(request).finish());
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.activitypb.ActivityService',
        'Operate',
        body,
    );
    const reply = types.ActivityOperateReply.decode(replyBody);
    if (int64String(reply?.activity_id) !== CHARITY_RED_FLOWER_ACTIVITY_ID) {
        throw businessError('CHARITY_RED_FLOWER_RESPONSE_INVALID', '公益小红花回包的活动 ID 不匹配');
    }
    if (int64String(reply?.operate_type) !== String(operateType)) {
        throw businessError('CHARITY_RED_FLOWER_RESPONSE_INVALID', '公益小红花回包的操作类型不匹配');
    }
    return reply;
}

async function claimCharityRedFlowerSeeds() {
    const activity = await getCurrentCharityRedFlowerActivity();
    if (!activity) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');
    if (!activity.actions.claimSeeds.enabled) {
        throw businessError('CHARITY_SEEDS_UNAVAILABLE', '当前没有可领取的小红花种子');
    }

    const reply = await operateCharityRedFlower(CLAIM_CHARITY_SEED_OPERATE_TYPE, { claim_seed: {} });
    const reward = reply?.charity_seed_result?.reward;
    const rewards = reward ? [itemDto(reward)] : (Array.isArray(reply?.rewards) ? reply.rewards : []).map(itemDto);
    return {
        rewards,
        message: '小红花种子领取成功',
        snapshot: await getActivityCenterSnapshot(),
    };
}

async function donateCharityRedFlowerLove() {
    const activity = await getCurrentCharityRedFlowerActivity();
    if (!activity) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');
    if (!activity.actions.donateLove.enabled) {
        throw businessError('INSUFFICIENT_CHARITY_LOVE', '当前没有可捐赠的爱心');
    }

    const reply = await operateCharityRedFlower(DONATE_CHARITY_LOVE_OPERATE_TYPE, { donate_love: {} });
    const donated = int64String(reply?.charity_donate_result?.donated);
    const donatedCount = donated !== '0' ? donated : activity.loveBalance;
    return {
        donated: donatedCount,
        globalDonated: int64String(reply?.charity_donate_result?.global_donated),
        message: `已捐赠全部 ${donatedCount} 份爱心`,
        snapshot: await getActivityCenterSnapshot(),
    };
}

async function claimCharityRedFlowerDailyGift() {
    const activity = await getCurrentCharityRedFlowerActivity();
    if (!activity) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');
    if (activity.dailyGift.claimed) {
        throw businessError('CHARITY_DAILY_GIFT_UNAVAILABLE', '今日公益礼包已经领取');
    }
    if (!activity.active) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');

    const reply = await operateCharityRedFlower(CLAIM_CHARITY_DAILY_GIFT_OPERATE_TYPE, { send_public_fund: {} });
    const reward = reply?.charity_public_fund_result?.reward;
    const rewards = reward ? [itemDto(reward)] : (Array.isArray(reply?.rewards) ? reply.rewards : []).map(itemDto);
    return {
        rewards,
        publicFund: {
            statusCode: int64String(reply?.charity_public_fund_result?.status),
        },
        message: '今日公益礼包领取成功',
        snapshot: await getActivityCenterSnapshot(),
    };
}

module.exports = {
    getCurrentCharityRedFlowerActivity,
    claimCharityRedFlowerSeeds,
    donateCharityRedFlowerLove,
    claimCharityRedFlowerDailyGift,
};
