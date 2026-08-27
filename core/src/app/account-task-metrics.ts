export type AccountTaskPriority = 'interactive' | 'event' | 'scheduled' | 'maintenance';

export interface AccountTaskMetric {
    name: string;
    priority: AccountTaskPriority;
    outcome: 'success' | 'error' | 'cancelled';
    queuedAt: number;
    startedAt: number;
    finishedAt: number;
    waitMs: number;
    runMs: number;
    totalMs: number;
    queueDepthAtSubmit: number;
    queueDepthAtStart: number;
    dedupeHits: number;
    inline: boolean;
}

export interface AccountTaskMetricSource {
    name: string;
    priority: AccountTaskPriority;
    queuedAt: number;
    queueDepthAtSubmit: number;
    queueDepthAtStart: number;
    dedupeHits: number;
}

export type AccountTaskMetricObserver = (metric: AccountTaskMetric) => void;

interface ScheduledTaskMetricInput {
    name: string;
    priority?: AccountTaskPriority;
    outcome?: AccountTaskMetric['outcome'];
    dueAt: number;
    startedAt: number;
    finishedAt: number;
}

export function createAccountTaskMetric(
    task: AccountTaskMetricSource,
    outcome: AccountTaskMetric['outcome'],
    startedAt: number,
    finishedAt: number,
    inline = false,
): AccountTaskMetric {
    const normalizedStart = Math.max(task.queuedAt, startedAt);
    const normalizedFinish = Math.max(normalizedStart, finishedAt);
    return {
        name: task.name,
        priority: task.priority,
        outcome,
        queuedAt: task.queuedAt,
        startedAt: normalizedStart,
        finishedAt: normalizedFinish,
        waitMs: normalizedStart - task.queuedAt,
        runMs: outcome === 'cancelled' ? 0 : normalizedFinish - normalizedStart,
        totalMs: normalizedFinish - task.queuedAt,
        queueDepthAtSubmit: task.queueDepthAtSubmit,
        queueDepthAtStart: task.queueDepthAtStart,
        dedupeHits: task.dedupeHits,
        inline,
    };
}

export function createScheduledTaskMetric(input: ScheduledTaskMetricInput): AccountTaskMetric {
    const startedAt = Math.max(0, Number(input.startedAt) || 0);
    const dueAt = Math.min(startedAt, Math.max(0, Number(input.dueAt) || startedAt));
    const metric = createAccountTaskMetric({
        name: String(input.name || '').trim() || 'scheduler.unknown',
        priority: input.priority || 'scheduled',
        queuedAt: dueAt,
        queueDepthAtSubmit: 0,
        queueDepthAtStart: 0,
        dedupeHits: 0,
    }, input.outcome || 'success', startedAt, input.finishedAt, true);
    if (metric.outcome === 'cancelled') {
        metric.runMs = metric.finishedAt - metric.startedAt;
    }
    return metric;
}
