const assert = require('node:assert/strict');
const test = require('node:test');

const { handleApiError } = require('../dist/controllers/admin/middleware');

function responseHarness() {
    return {
        statusCode: 200,
        body: null,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
    };
}

test('hard API failures include the mutation trace id', () => {
    const response = responseHarness();
    handleApiError(response, new Error('response serialization failed'), { traceId: 'bag-use-1' });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
        ok: false,
        error: 'response serialization failed',
        traceId: 'bag-use-1',
    });
});

test('soft worker timeouts keep HTTP 200 and include the mutation trace id', () => {
    const response = responseHarness();
    handleApiError(response, new Error('API Timeout'), { traceId: 'bag-sell-1' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: false,
        error: 'API Timeout',
        traceId: 'bag-sell-1',
    });
});
