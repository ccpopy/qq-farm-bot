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
