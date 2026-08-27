export {};

interface TaskPerformanceAggregatorOptions {
    now?: () => number;
}

interface LatencyHistogram {
    count: number;
    sum: number;
    max: number;
    buckets: number[];
}

interface TaskGroup {
    name: string;
    priority: string;
    inline: boolean;
    outcomes: {
        success: number;
        error: number;
        cancelled: number;
    };
    dedupeHits: number;
    maxQueueDepth: number;
    waitMs: LatencyHistogram;
    runMs: LatencyHistogram;
    totalMs: LatencyHistogram;
}

const LATENCY_BUCKETS_MS = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1000, 2000, 5000, 10000, 20000, 30000,
    60000, 120000, 300000,
];

function createHistogram(): LatencyHistogram {
    return {
        count: 0,
        sum: 0,
        max: 0,
        buckets: Array.from({ length: LATENCY_BUCKETS_MS.length + 1 }, () => 0),
    };
}

function recordHistogram(histogram: LatencyHistogram, input: unknown): void {
    const value = Math.max(0, Number(input) || 0);
    histogram.count += 1;
    histogram.sum += value;
    histogram.max = Math.max(histogram.max, value);
    const index = LATENCY_BUCKETS_MS.findIndex(limit => value <= limit);
    histogram.buckets[index < 0 ? LATENCY_BUCKETS_MS.length : index] += 1;
}

function normalizeTaskName(input: unknown): string {
    const name = String(input || '').trim() || 'unknown';
    return name.replace(/:\d{4,}(?=$|:)/g, ':*');
}

class TaskPerformanceAggregator {
    private readonly now: () => number;
    private readonly groups = new Map<string, TaskGroup>();
    private windowStartedAt: number;
    private taskCount = 0;
    private maxQueueDepth = 0;

    constructor(options: TaskPerformanceAggregatorOptions = {}) {
        this.now = options.now || Date.now;
        this.windowStartedAt = this.now();
    }

    record(metric: any): void {
        if (!metric || typeof metric !== 'object') return;
        const name = normalizeTaskName(metric.name);
        const priority = String(metric.priority || 'scheduled');
        const inline = metric.inline === true;
        const key = `${name}\u0000${priority}\u0000${inline ? '1' : '0'}`;
        let group = this.groups.get(key);
        if (!group) {
            group = {
                name,
                priority,
                inline,
                outcomes: { success: 0, error: 0, cancelled: 0 },
                dedupeHits: 0,
                maxQueueDepth: 0,
                waitMs: createHistogram(),
                runMs: createHistogram(),
                totalMs: createHistogram(),
            };
            this.groups.set(key, group);
        }

        const outcome = metric.outcome === 'error' || metric.outcome === 'cancelled'
            ? metric.outcome
            : 'success';
        group.outcomes[outcome] += 1;
        group.dedupeHits += Math.max(0, Number(metric.dedupeHits) || 0);
        const queueDepth = Math.max(
            0,
            Number(metric.queueDepthAtSubmit) || 0,
            Number(metric.queueDepthAtStart) || 0,
        );
        group.maxQueueDepth = Math.max(group.maxQueueDepth, queueDepth);
        this.maxQueueDepth = Math.max(this.maxQueueDepth, queueDepth);
        recordHistogram(group.waitMs, metric.waitMs);
        recordHistogram(group.runMs, metric.runMs);
        recordHistogram(group.totalMs, metric.totalMs);
        this.taskCount += 1;
    }

    snapshot(): any {
        return this.buildSnapshot(this.now());
    }

    drain(): any {
        const endedAt = this.now();
        const snapshot = this.buildSnapshot(endedAt);
        if (!snapshot) return null;
        this.groups.clear();
        this.taskCount = 0;
        this.maxQueueDepth = 0;
        this.windowStartedAt = endedAt;
        return snapshot;
    }

    private buildSnapshot(endedAt: number): any {
        if (this.taskCount === 0) return null;
        return {
            windowStartedAt: this.windowStartedAt,
            windowEndedAt: endedAt,
            taskCount: this.taskCount,
            maxQueueDepth: this.maxQueueDepth,
            latencyBucketBoundsMs: [...LATENCY_BUCKETS_MS],
            tasks: [...this.groups.values()]
                .map(group => ({
                    ...group,
                    outcomes: { ...group.outcomes },
                    waitMs: { ...group.waitMs, buckets: [...group.waitMs.buckets] },
                    runMs: { ...group.runMs, buckets: [...group.runMs.buckets] },
                    totalMs: { ...group.totalMs, buckets: [...group.totalMs.buckets] },
                }))
                .sort((left, right) => left.name.localeCompare(right.name)
                    || left.priority.localeCompare(right.priority)),
        };
    }
}

module.exports = {
    LATENCY_BUCKETS_MS,
    TaskPerformanceAggregator,
    normalizeTaskName,
};
