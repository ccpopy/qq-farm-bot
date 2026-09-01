export {};
/**
 * 公益小红花 - 领取种子、捐赠爱心与领取每日公益礼包。
 */

const { sendMsgAsync } = require('../../utils/network');
const { types } = require('../../utils/proto');
const { getTaskInfo } = require('../task');
const { getBag } = require('../warehouse');
const { getAllLands } = require('../farm/api');
const { checkCanShare, reportActivityShare } = require('../share');
const {
    int64String,
    itemDto,
    businessError,
} = require('./shared');
const {
    CHARITY_RED_FLOWER_ACTIVITY_ID,
    findActivityData,
    charityRedFlowerDto,
    charitySeedTaskSummary,
    charityInventory,
    charityRedFlowerLandSummary,
} = require('./charity-state');
const CLAIM_CHARITY_SEED_OPERATE_TYPE = 35;
const DONATE_CHARITY_LOVE_OPERATE_TYPE = 36;
const CLAIM_CHARITY_PROGRESS_REWARD_OPERATE_TYPE = 37;
const CLAIM_CHARITY_DAILY_GIFT_OPERATE_TYPE = 38;
const ACCEPT_CHARITY_AGREEMENT_OPERATE_TYPE = 39;
const CHARITY_SHARE_SOURCE = 15;
const CHARITY_SHARE_SCENE = 1501;

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

async function getCurrentCharityRedFlowerActivity() {
    const reply = await queryActivityListReply();
    const entry = findActivityData(reply?.activities, CHARITY_RED_FLOWER_ACTIVITY_ID);
    if (!entry?.charity_red_flower) return null;

    const activity = charityRedFlowerDto(entry);
    const supplementalErrors: Record<string, string> = {};
    let taskSummary: any = null;
    let inventory: any = null;
    let lands: any = null;

    // 网关请求必须串行；补充查询失败不应遮蔽已经成功读取的活动主状态。
    try {
        taskSummary = charitySeedTaskSummary(await getTaskInfo());
    } catch (error: any) {
        supplementalErrors.tasks = String(error?.message || error || '任务读取失败');
    }
    try {
        lands = charityRedFlowerLandSummary(await getAllLands(), Number(activity.serverTime));
    } catch (error: any) {
        supplementalErrors.lands = String(error?.message || error || '土地读取失败');
    }
    try {
        inventory = charityInventory(await getBag());
    } catch (error: any) {
        supplementalErrors.inventory = String(error?.message || error || '背包读取失败');
    }

    return {
        ...activity,
        taskSummary,
        inventory,
        lands,
        supplementalErrors,
    };
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

async function shareCharityRedFlower() {
    const activity = await getCurrentCharityRedFlowerActivity();
    if (!activity || !activity.active) {
        throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');
    }
    if (!activity.actions.share.enabled) {
        throw businessError('CHARITY_SHARE_UNAVAILABLE', '请先完成公益平台授权，再进行每日分享');
    }

    // 实机顺序：CheckCanShare -> 平台分享 -> ReportShare(15, 1501)。
    // Web 端没有平台分享面板，因此复用现有分享上报能力，并等待正式回包。
    const shareStatus = await checkCanShare();
    if (!shareStatus?.can_share) {
        throw businessError('CHARITY_SHARE_UNAVAILABLE', '当前分享入口不可用');
    }
    await reportActivityShare(CHARITY_SHARE_SOURCE, CHARITY_SHARE_SCENE);
    return {
        message: '小红花每日分享已上报，请以活动内种子到账状态为准',
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

async function claimCharityRedFlowerProgressReward(targetInput: any) {
    const target = String(targetInput ?? '').trim();
    if (!/^[1-9]\d*$/.test(target)) {
        throw businessError('INVALID_CHARITY_PROGRESS_TARGET', '爱心进度档位必须是正十进制整数');
    }

    const activity = await getCurrentCharityRedFlowerActivity();
    if (!activity) throw businessError('CHARITY_RED_FLOWER_UNAVAILABLE', '公益小红花活动暂未开放或已经结束');
    const progressReward = activity.progressRewards.find((reward: any) => reward.target === target);
    if (!progressReward) {
        throw businessError('INVALID_CHARITY_PROGRESS_TARGET', '未找到对应的爱心进度奖励');
    }
    if (!progressReward.claimable) {
        throw businessError(
            'CHARITY_PROGRESS_REWARD_UNAVAILABLE',
            progressReward.claimed ? '该爱心进度奖励已经领取' : '该爱心进度奖励尚未达到领取条件',
        );
    }

    const reply = await operateCharityRedFlower(CLAIM_CHARITY_PROGRESS_REWARD_OPERATE_TYPE, {
        claim_progress_reward: { target },
    });
    const result = reply?.charity_progress_reward_result;
    if (int64String(result?.target) !== target) {
        throw businessError('CHARITY_RED_FLOWER_RESPONSE_INVALID', '爱心进度奖励回包的档位不匹配');
    }
    const reward = result?.reward;
    const rewards = reward ? [itemDto(reward)] : (Array.isArray(reply?.rewards) ? reply.rewards : []).map(itemDto);
    return {
        target,
        rewards,
        message: `${target} 爱心进度奖励领取成功`,
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
        message: '公益金已送出，今日公益礼包领取成功',
        snapshot: await getActivityCenterSnapshot(),
    };
}

async function acceptCharityRedFlowerAgreement() {
    // 实机确认：关闭授权弹窗不会发请求；勾选并确认后发送操作 39，
    // selector 138 的 accepted=true，回包 selector 139 同样返回 true。
    const reply = await operateCharityRedFlower(ACCEPT_CHARITY_AGREEMENT_OPERATE_TYPE, {
        agreement: { accepted: true },
    });
    if (reply?.charity_agreement_result?.accepted !== true) {
        throw businessError('CHARITY_AGREEMENT_REJECTED', '公益平台没有确认本次授权');
    }
    return {
        accepted: true,
        message: '公益平台授权已完成，活动状态已刷新',
        snapshot: await getActivityCenterSnapshot(),
    };
}

module.exports = {
    getCurrentCharityRedFlowerActivity,
    acceptCharityRedFlowerAgreement,
    claimCharityRedFlowerSeeds,
    shareCharityRedFlower,
    donateCharityRedFlowerLove,
    claimCharityRedFlowerProgressReward,
    claimCharityRedFlowerDailyGift,
};
