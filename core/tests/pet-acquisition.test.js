const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

const root = new protobuf.Root().loadSync(path.resolve(__dirname, '../src/proto/dogpb.proto'), { keepCase: true });
const names = ['GetDogInfoReply', 'DeployDogRequest', 'DeployDogReply'];
const types = Object.fromEntries(names.map(name => [name, root.lookupType(`gamepb.dogpb.${name}`)]));
const decodeDog = value => types.GetDogInfoReply.decode(types.GetDogInfoReply.encode(types.GetDogInfoReply.fromObject(value)).finish());

function harness(t, { adult = true, granted = false, owned = false, failActivity = false, failClaim = false, delayOwnership = false } = {}) {
    const gifts = require('../dist/services/dog-skill-gifts');
    const diary = require('../dist/services/activity-center/pet-diary-runtime');
    const warehouse = require('../dist/services/warehouse');
    const network = require('../dist/utils/network');
    const proto = require('../dist/utils/proto');
    const calls = [];
    let active = 90003;
    let pendingOwnership = granted && !owned;
    t.mock.method(gifts, 'getDogInfo', async () => {
        calls.push('GetDogInfo');
        const reply = decodeDog({ current_dog_id: active, dogs: [{ id: 90003, owned: 1 }, { id: 90031, status: 1, owned: owned ? 1 : 0 }] });
        if (pendingOwnership) { owned = true; pendingOwnership = false; }
        return reply;
    });
    t.mock.method(diary, 'getPetDiaryDogStatus', async () => {
        calls.push('GetGroup');
        if (failActivity) throw new Error('activity unavailable');
        return { adult, granted, claimable: adult && !granted };
    });
    t.mock.method(diary, 'operatePetDiary', async (action) => {
        calls.push(action);
        assert.equal(action, 'claimDog');
        if (failClaim) throw new Error('claim failed');
        granted = true;
        if (!delayOwnership) owned = true;
        return { action };
    });
    t.mock.method(warehouse, 'getBag', async () => {
        calls.push('Bag');
        return { item_bag: { items: [] } };
    });
    t.mock.method(network, 'sendMsgAsync', async (service, method, body) => {
        calls.push(method);
        assert.equal(service, 'gamepb.dogpb.DogService');
        assert.equal(method, 'DeployDog');
        active = Number(types.DeployDogRequest.decode(body).dog_id);
        assert.ok(active === 90003 || (active === 90031 && owned));
        return { body: types.DeployDogReply.encode(types.DeployDogReply.fromObject({ dog_id: active })).finish() };
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

test('adult bichon is available for activation while a catalog read never claims or deploys it', async (t) => {
    const { pets, calls } = harness(t);
    const snapshot = await pets.getPetInfo();
    const dog = snapshot.dogs.find(dog => dog.id === 90031);
    assert.equal(dog.owned, false);
    assert.equal(dog.claimable, true);
    assert.equal(dog.active, false);
    assert.equal(snapshot.activeDogId, 90003);
    assert.deepEqual(calls, ['GetDogInfo', 'GetGroup', 'Bag']);
});

test('one activation claims the adult bichon, verifies ownership and deploys it', async (t) => {
    const { pets, calls } = harness(t);
    const snapshot = await pets.deployDog(90031);
    assert.equal(snapshot.activeDogId, 90031);
    assert.equal(snapshot.dogs.find(dog => dog.id === 90031).owned, true);
    assert.equal(snapshot.dogs.find(dog => dog.id === 90031).claimable, false);
    assert.deepEqual(calls, ['GetDogInfo', 'GetGroup', 'claimDog', 'GetDogInfo', 'DeployDog', 'GetDogInfo', 'Bag']);
    await pets.deployDog(90031);
    assert.equal(calls.filter(call => call === 'claimDog').length, 1);
});

test('an already granted bichon refreshes the pet list without repeating acquisition', async (t) => {
    const { pets, calls } = harness(t, { granted: true });
    const snapshot = await pets.getPetInfo();
    assert.equal(snapshot.dogs.find(dog => dog.id === 90031).owned, true);
    assert.deepEqual(calls, ['GetDogInfo', 'GetGroup', 'GetDogInfo', 'Bag']);
    await pets.deployDog(90031);
    assert.equal(calls.includes('claimDog'), false);
});

test('an infant bichon stays locked and cannot issue an acquisition or deploy request', async (t) => {
    const { pets, calls } = harness(t, { adult: false });
    assert.equal((await pets.getPetInfo()).dogs.find(dog => dog.id === 90031).claimable, false);
    await assert.rejects(pets.deployDog(90031), /尚未成年/);
    assert.equal(calls.includes('claimDog'), false);
    assert.equal(calls.includes('DeployDog'), false);
});

test('claim failure or missing ownership confirmation never changes the current guard dog', async (t) => {
    for (const option of [{ failClaim: true }, { delayOwnership: true }]) {
        await t.test(JSON.stringify(option), async (child) => {
            const { pets, calls } = harness(child, option);
            await assert.rejects(pets.deployDog(90031), /claim failed|尚未同步/);
            assert.equal(calls.includes('DeployDog'), false);
        });
    }
});

test('unavailable activity data does not break existing pets or grant a locked pet', async (t) => {
    const { pets, calls } = harness(t, { failActivity: true });
    const snapshot = await pets.getPetInfo();
    assert.equal(snapshot.activeDogId, 90003);
    assert.equal(snapshot.dogs.find(dog => dog.id === 90031).claimable, false);
    await assert.rejects(pets.deployDog(90002), /未获得/);
    assert.equal(calls.includes('claimDog'), false);
    assert.equal((await pets.deployDog(90003)).activeDogId, 90003);
});

test('an owned bichon works after the activity ends without reading activity data', async (t) => {
    const { pets, calls } = harness(t, { owned: true, failActivity: true });
    assert.equal((await pets.getPetInfo()).dogs.find(dog => dog.id === 90031).owned, true);
    assert.equal((await pets.deployDog(90031)).activeDogId, 90031);
    assert.equal(calls.includes('GetGroup'), false);
    assert.equal(calls.includes('claimDog'), false);
});
