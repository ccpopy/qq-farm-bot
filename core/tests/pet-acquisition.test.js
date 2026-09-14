const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');
const { messages } = require('./fixtures/dog-activation-capture.json');

const root = new protobuf.Root().loadSync(path.resolve(__dirname, '../src/proto/dogpb.proto'), { keepCase: true });
const names = ['GetDogInfoReply', 'ActivateDogRequest', 'ActivateDogReply', 'DeployDogRequest', 'DeployDogReply'];
const types = Object.fromEntries(names.map(name => [name, root.lookupType(`gamepb.dogpb.${name}`)]));
const fixture = file => messages.find(entry => entry.file === file);
const bytes = file => Buffer.from(fixture(file).hex, 'hex');
const encode = (name, value) => types[name].encode(types[name].fromObject(value)).finish();
const object = (name, value) => types[name].toObject(types[name].decode(value), { longs: String, arrays: true });

// Keep the service's historical outer-field aliases, but compare every decoded
// field with the independently extracted official decoder, not message lengths.
function officialFields(name, decoded) {
    if (name === 'GetDogInfoReply') {
        const { dogs, items, skill_usages, current_dog_id, protect_time, max_protect_time, ...rest } = decoded;
        return {
            ...rest,
            dog_list: dogs,
            food_list: items.map(({ duration, ...item }) => ({ ...item, ...(duration !== undefined ? { time: duration } : {}) })),
            skill_use_infos: skill_usages,
            ...(current_dog_id !== undefined ? { current_deployed_dog_id: current_dog_id } : {}),
            ...(protect_time !== undefined ? { food_last_sec: protect_time } : {}),
            ...(max_protect_time !== undefined ? { max_food_last_sec: max_protect_time } : {}),
        };
    }
    if (name === 'DeployDogReply') {
        const { dog_id, ...rest } = decoded;
        return { ...rest, ...(dog_id !== undefined ? { deployed_dog_id: dog_id } : {}) };
    }
    return decoded;
}

test('real activation, deployment and dog-list replies match every official decoded field', () => {
    for (const capture of messages) {
        const name = capture.method + (capture.direction === 'send' ? 'Request' : 'Reply');
        const wire = Buffer.from(capture.hex, 'hex');
        const decoded = object(name, wire);
        assert.deepEqual(officialFields(name, decoded), capture.expected, capture.file);
        if (capture.direction === 'send') assert.deepEqual(Buffer.from(encode(name, capture.expected)), wire, capture.file);
    }
});

function harness(t, { beforeFile = '000119-recv.bin', bagItems = [], bagOnly = false, activationError = '', activationReply, deployError = '' } = {}) {
    const gifts = require('../dist/services/dog-skill-gifts');
    const warehouse = require('../dist/services/warehouse');
    const network = require('../dist/utils/network');
    const proto = require('../dist/utils/proto');
    const calls = [];
    let dogBytes = bytes(beforeFile);
    if (bagOnly) {
        // Synthetic edge case matching the official bag-item fallback.
        const before = object('GetDogInfoReply', dogBytes);
        before.dogs.find(dog => dog.id === '90031').owned = false;
        dogBytes = encode('GetDogInfoReply', before);
    }
    t.mock.method(gifts, 'getDogInfo', async () => {
        calls.push('GetDogInfo');
        return types.GetDogInfoReply.decode(dogBytes);
    });
    t.mock.method(warehouse, 'getBag', async () => {
        calls.push('Bag');
        return { item_bag: { items: bagItems } };
    });
    t.mock.method(network, 'sendMsgAsync', async (service, method, body) => {
        calls.push(method);
        assert.equal(service, 'gamepb.dogpb.DogService');
        if (method === 'ActivateDog') {
            assert.deepEqual(Buffer.from(body), bytes('000144-send.bin'));
            if (activationError) throw new Error(activationError);
            return { body: activationReply === undefined ? bytes('000145-recv.bin') : encode('ActivateDogReply', activationReply) };
        }
        assert.equal(method, 'DeployDog'); // No activity claim, purchase or resource spend is allowed.
        assert.deepEqual(Buffer.from(body), bytes('000147-send.bin'));
        if (deployError) throw new Error(deployError);
        dogBytes = bytes('000151-recv.bin');
        return { body: bytes('000148-recv.bin') };
    });
    const savedTypes = { ...proto.types };
    Object.assign(proto.types, types);
    const modulePath = require.resolve('../dist/services/pets');
    const originalModule = require.cache[modulePath];
    delete require.cache[modulePath];
    t.after(() => {
        for (const name of names) {
            if (savedTypes[name]) proto.types[name] = savedTypes[name];
            else delete proto.types[name];
        }
        if (originalModule) require.cache[modulePath] = originalModule;
        else delete require.cache[modulePath];
    });
    return { pets: require(modulePath), calls };
}

test('the real pre-activation bichon is owned and can activate without changing the current guard', async (t) => {
    const { pets, calls } = harness(t);
    const snapshot = await pets.getPetInfo();
    const dog = snapshot.dogs.find(dog => dog.id === 90031);
    assert.equal(dog.owned, true);
    assert.equal(dog.activated, false);
    assert.equal(dog.canActivate, true);
    assert.equal(dog.active, false);
    assert.equal(snapshot.activeDogId, 90003);
    assert.equal(snapshot.dogs.filter(dog => dog.owned).length, 2);
    assert.deepEqual(calls, ['GetDogInfo', 'Bag']);
});

test('one click replays ActivateDog then DeployDog and the real final pet-list reply', async (t) => {
    const { pets, calls } = harness(t);
    const snapshot = await pets.deployDog(90031);
    const dog = snapshot.dogs.find(dog => dog.id === 90031);
    assert.equal(snapshot.activeDogId, 90031);
    assert.equal(dog.owned, true);
    assert.equal(dog.activated, true);
    assert.equal(dog.canActivate, false);
    assert.equal(dog.active, true);
    assert.deepEqual(calls, ['GetDogInfo', 'ActivateDog', 'DeployDog', 'GetDogInfo', 'Bag']);
    await pets.deployDog(90031);
    assert.equal(calls.filter(call => call === 'ActivateDog').length, 1);
});

test('the real withdrawn bichon remains owned after the consumed owned flag disappears', async (t) => {
    const { pets, calls } = harness(t, { beforeFile: '000160-recv.bin' });
    const dog = (await pets.getPetInfo()).dogs.find(dog => dog.id === 90031);
    assert.equal(dog.owned, true);
    assert.equal(dog.activated, true);
    assert.equal(dog.active, false);
    assert.equal(dog.canActivate, false);
    assert.equal((await pets.deployDog(90031)).activeDogId, 90031);
    assert.equal(calls.includes('ActivateDog'), false);
});

test('a bag pet item allows activation just like the official client, without claiming the activity again', async (t) => {
    const { pets, calls } = harness(t, { bagOnly: true, bagItems: [{ id: 90031, count: 1 }] });
    assert.equal((await pets.getPetInfo()).dogs.find(dog => dog.id === 90031).canActivate, true);
    assert.equal((await pets.deployDog(90031)).activeDogId, 90031);
    assert.equal(calls.filter(call => call === 'ActivateDog').length, 1);
});

test('unowned pets stay locked and never trigger activation, purchases or deployment', async (t) => {
    const { pets, calls } = harness(t, { bagOnly: true });
    const dog = (await pets.getPetInfo()).dogs.find(dog => dog.id === 90031);
    assert.equal(dog.owned, false);
    assert.equal(dog.canActivate, false);
    await assert.rejects(pets.deployDog(90031), /未获得/);
    await assert.rejects(pets.deployDog(90002), /未获得/);
    await assert.rejects(pets.deployDog(1028), /未获得/);
    assert.ok(calls.every(call => ['GetDogInfo', 'Bag'].includes(call)));
});

test('failed or mismatched activation replies do not attempt to deploy a pet', async (t) => {
    for (const option of [{ activationError: 'activation rejected' }, { activationReply: {} }, { activationReply: { dog: { id: 90031, activated: false } } }, { activationReply: { dog: { id: 90021, activated: true } } }]) {
        await t.test(JSON.stringify(option), async (child) => {
            const { pets, calls } = harness(child, option);
            await assert.rejects(pets.deployDog(90031), /activation rejected|未确认成功/);
            assert.equal(calls.includes('DeployDog'), false);
        });
    }
});

test('a deployment rejection after activation is surfaced instead of claiming success', async (t) => {
    const { pets, calls } = harness(t, { deployError: 'deploy rejected' });
    await assert.rejects(pets.deployDog(90031), /deploy rejected/);
    assert.deepEqual(calls, ['GetDogInfo', 'ActivateDog', 'DeployDog']);
});
