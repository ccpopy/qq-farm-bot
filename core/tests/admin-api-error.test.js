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

test('gateway rejections retain their raw business message, code and main mutation trace', () => {
    const response = responseHarness();
    const error = Object.assign(new Error('gamepb.itempb.ItemService.Use error: code=100001 库存不足'), {
        name: 'GatewayError',
        errorMessage: '库存不足',
        code: 100001,
    });
    handleApiError(response, error, { traceId: 'bag-use-protocol' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        ok: false,
        error: '库存不足',
        errorMessage: '库存不足',
        errorCode: 100001,
        traceId: 'bag-use-protocol',
    });
});

test('legacy string gateway errors are normalized while ordinary exceptions remain failures', () => {
    const response = responseHarness();
    handleApiError(response, 'gamepb.plantpb.PlantService.Fertilize 错误: code=100002 化肥不足');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.error, '化肥不足');
    handleApiError(response, new Error('unexpected database error code=100002'));
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.error, 'unexpected database error code=100002');
});
