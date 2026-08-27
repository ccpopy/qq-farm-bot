const assert = require('node:assert/strict');
const test = require('node:test');

const { TaskPerformanceAggregator } = require('../dist/app/task-performance-aggregator');

test('task performance metrics are grouped without high-cardinality numeric suffixes', () => {
    let now = 1000;
    const aggregator = new TaskPerformanceAggregator({ now: () => now });

    aggregator.record({
        name: 'friend.help:123456',
        priority: 'scheduled',
        outcome: 'success',
        waitMs: 12,
        runMs: 80,
        totalMs: 92,
        queueDepthAtSubmit: 3,
        queueDepthAtStart: 1,
        dedupeHits: 2,
        inline: false,
    });
    aggregator.record({
        name: 'friend.help:987654',
        priority: 'scheduled',
        outcome: 'error',
        waitMs: 30,
        runMs: 120,
        totalMs: 150,
        queueDepthAtSubmit: 5,
        queueDepthAtStart: 2,
        dedupeHits: 0,
        inline: false,
    });

    now = 2000;
    const snapshot = aggregator.drain();
    assert.equal(snapshot.taskCount, 2);
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0].name, 'friend.help:*');
    assert.deepEqual(snapshot.tasks[0].outcomes, { success: 1, error: 1, cancelled: 0 });
    assert.equal(snapshot.tasks[0].waitMs.sum, 42);
    assert.equal(snapshot.tasks[0].runMs.max, 120);
    assert.equal(snapshot.tasks[0].totalMs.count, 2);
    assert.equal(snapshot.tasks[0].dedupeHits, 2);
    assert.equal(snapshot.maxQueueDepth, 5);
    assert.equal(snapshot.windowStartedAt, 1000);
    assert.equal(snapshot.windowEndedAt, 2000);
    assert.equal(aggregator.drain(), null);
});
