export {};

const { createModuleLogger } = require('../services/logger');

const activityWorkerLogger = createModuleLogger('activity-worker');

interface WorkerApiDefinition {
    execution: 'queued' | 'direct' | 'self-queued' | 'read-fresh';
    allowOffline: boolean;
    handle: (args: any[]) => Promise<any> | any;
}

interface WorkerApiDispatchOptions {
    isAccountReady: () => boolean;
    onStarted?: () => void;
    submitTask: (
        name: string,
        run: () => Promise<any> | any,
        options: { priority: 'interactive' },
    ) => Promise<any>;
}

interface WorkerApiError {
    message: string;
    code?: string | number;
    name?: string;
    activityStage?: string;
    activityTraceId?: string;
    serviceName?: string;
    methodName?: string;
    errorMessage?: string;
    clientSeq?: number;
}

interface WorkerApiCallResult {
    result: any;
    error: WorkerApiError | string | null;
}

function activityTraceIdFromArgs(args: any[]): string {
    for (let index = args.length - 1; index >= 0; index -= 1) {
        const value = String(args[index] || '').trim();
        if (/^(?:activity|charity)-[a-z0-9._-]{1,96}$/i.test(value)) return value;
    }
    return '';
}

function workerApiError(error: any, fallbackStage: string, traceId: string): WorkerApiError {
    const activityStage = String(error?.activityStage || (traceId ? fallbackStage : '')).trim();
    const activityTraceId = String(error?.activityTraceId || traceId).trim();
    return {
        message: String(error?.message || error || 'Worker API error'),
        code: error?.code,
        name: String(error?.name || 'Error'),
        ...(activityStage ? { activityStage } : {}),
        ...(activityTraceId ? { activityTraceId } : {}),
        ...(error?.serviceName ? { serviceName: String(error.serviceName) } : {}),
        ...(error?.methodName ? { methodName: String(error.methodName) } : {}),
        ...(error?.errorMessage ? { errorMessage: String(error.errorMessage) } : {}),
        ...(error?.clientSeq !== undefined && error?.clientSeq !== null
            ? { clientSeq: Number(error.clientSeq) || 0 }
            : {}),
    };
}

async function executeWorkerApiCall(
    method: any,
    args: any,
    registry: Map<string, WorkerApiDefinition>,
    options: WorkerApiDispatchOptions,
): Promise<WorkerApiCallResult> {
    const definition = registry.get(String(method || ''));
    if (!definition) return { result: null, error: 'Unknown method' };

    const callArgs = Array.isArray(args) ? args : [];
    const traceId = activityTraceIdFromArgs(callArgs);
    const receivedAt = Date.now();
    let startedAt = 0;
    let fallbackStage = 'worker.dispatch';
    try {
        if (!definition.allowOffline && !options.isAccountReady()) {
            throw new Error('账号未连接');
        }

        const run = () => {
            startedAt = Date.now();
            fallbackStage = 'worker.execute';
            options.onStarted?.();
            if (traceId) {
                activityWorkerLogger.info('活动 Worker 开始执行', {
                    event: 'activity_worker_chain',
                    stage: 'worker.execute',
                    traceId,
                    workerMethod: String(method || ''),
                    queueWaitMs: startedAt - receivedAt,
                });
            }
            return definition.handle(callArgs);
        };
        if (definition.execution === 'queued') fallbackStage = 'worker.queue';
        const result = definition.execution === 'queued'
            ? await options.submitTask(`api:${method}`, run, { priority: 'interactive' })
            : await run();
        if (traceId) {
            activityWorkerLogger.info('活动 Worker 执行完成', {
                event: 'activity_worker_chain',
                stage: 'worker.ready',
                traceId,
                workerMethod: String(method || ''),
                queueWaitMs: Math.max(0, (startedAt || Date.now()) - receivedAt),
                executionMs: startedAt ? Date.now() - startedAt : 0,
            });
        }
        return { result, error: null };
    } catch (error: any) {
        const payload = workerApiError(error, fallbackStage, traceId);
        if (traceId) {
            activityWorkerLogger.warn('活动 Worker 执行失败', {
                event: 'activity_worker_chain',
                stage: payload.activityStage || fallbackStage,
                traceId: payload.activityTraceId || traceId,
                workerMethod: String(method || ''),
                queueWaitMs: Math.max(0, (startedAt || Date.now()) - receivedAt),
                executionMs: startedAt ? Date.now() - startedAt : 0,
                resultKind: String(payload.code || payload.name || 'Error'),
                failureMessage: payload.message,
            });
        }
        return {
            result: null,
            error: payload,
        };
    }
}

module.exports = {
    executeWorkerApiCall,
};
