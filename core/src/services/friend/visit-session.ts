const accountTasks = require('../../app/account-task-runner');
const friendApi = require('./api');
const { runWithRequestClass } = require('../../utils/request-context');

/** 整次访问占用一个账号任务；嵌套调用沿用当前任务，避免重复加锁。 */
export function withFriendFarmVisit<T>(
    gid: number,
    operation: (reply: any) => Promise<T>,
    priority: 'low' | 'normal' = 'normal',
): Promise<T> {
    return accountTasks.submitAccountTask(`friend.session:${gid}`, async () => {
        const reply = await friendApi.enterFriendFarm(gid, priority);
        try {
            return await operation(reply);
        } finally {
            // 后台访问的收尾不能被低优先级让路丢掉，否则服务端还停留在好友农场。
            if (priority === 'low') {
                await runWithRequestClass('friend', () => friendApi.leaveFriendFarm(gid, 'normal'));
            } else {
                await friendApi.leaveFriendFarm(gid, 'normal');
            }
        }
    }, { priority: priority === 'low' ? 'maintenance' : 'scheduled' });
}
