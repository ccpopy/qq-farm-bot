const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');
const fixtures = require('./fixtures/pet-diary-capture.json');
const { createPetDiaryService } = require('../dist/services/activity-center/pet-diary');
const root = new protobuf.Root().loadSync(path.resolve(__dirname,'../src/proto/activitypb.proto'), { keepCase: true });
root.loadSync(['solartermspb.proto','mallpb.proto'].map(name=>path.resolve(__dirname,'../src/proto',name)),{keepCase:true});
const types = Object.fromEntries(['PetDiaryOperateRequest','PetDiaryOperateReply','PetDiaryGetGroupReply','GetGroupRequest'].map(name => [name,root.lookupType(`gamepb.activitypb.${name}`)]));
for(const name of ['ClaimSolarTermsRequest','ClaimSolarTermsReply'])types[name]=root.lookupType(`gamepb.solartermspb.${name}`);
const object = (type, input) => type.toObject(type.decode(input), { longs: String, arrays: true, objects: true });
const encode = (type, input) => Buffer.from(type.encode(type.fromObject(input)).finish());
const capture = name => fixtures.find(f => f.file === name);
const decoded = name => types.PetDiaryOperateReply.decode(Buffer.from(capture(name).hex,'hex'));

test('pet requests match the official mini-program bytes', () => {
    for (const fixture of fixtures.filter(f => f.direction === 'send')) {
        assert.deepEqual(encode(types.PetDiaryOperateRequest,fixture.expected),Buffer.from(fixture.hex,'hex'),fixture.file);
    }
});

test('all captured pet reply fields match the official decoder, including shops and logs', () => {
    for (const fixture of fixtures.filter(f => f.direction === 'recv' && f.error === '0')) {
        assert.deepEqual(object(types.PetDiaryOperateReply,Buffer.from(fixture.hex,'hex')),fixture.expected,fixture.file);
    }
});

test('late-stage operations match independent official encoder vectors', () => {
    // These are synthetic vectors produced by the extracted official encoder,
    // separate from the real capture fixtures above.
    const vectors=require('./fixtures/pet-diary-official-vectors.json');
    for(const vector of vectors) {
        const {id,cmd,...fields}=vector.input;
        const localInput={activity_id:id,operate_type:cmd,...fields};
        const type=vector.direction==='send'?types.PetDiaryOperateRequest:types.PetDiaryOperateReply;
        const bytes=Buffer.from(vector.hex,'hex');
        assert.deepEqual(encode(type,localInput),bytes,vector.name);
        const actual=type.toObject(type.decode(bytes),{longs:String});
        assert.deepEqual(actual,localInput,vector.name);
    }
});

function harness({ cake = '0', stars = '450', failSnapshot = false, solarClaimable = false, petCapture = '000157-recv.bin', feedReply = '', storyReply = '' } = {}) {
    const group = { pet: decoded(petCapture).data, seeds: decoded('000276-recv.bin').data, shop: decoded('000318-recv.bin').data };
    const calls = [];
    let mutationCount = 0; let tail = Promise.resolve();
    const service = createPetDiaryService({
        types, getServerTimeSec: () => 1789010000,
        getBag: async () => [{id:'1028',count:cake},{id:'1029',count:stars}], getBagItems: x => x,
        int64String: x => String(x ?? '0'), int64Number: x => Number(x || 0),
        itemDto: x => ({id:String(x?.id || x?.item_id || '0'),count:String(x?.count || '0'),name:'item',image:''}),
        textContent: () => ({paragraphs:[]}), getCurrentSolarTerms: async () => ({terms:[{id:'301',startTime:'1789005600',endTime:'1790179199',canClaim:solarClaimable}]}),
        businessError: (code, message) => Object.assign(new Error(message),{code}),
        positiveDecimal: (v,_code,name) => { if (!/^[1-9]\d*$/.test(String(v))) throw new Error(`Invalid ${name}`); return String(v); },
        serializeMutation: fn => { const result=tail.then(fn,fn);tail=result.catch(()=>{});return result; },
        sendMsgAsync: async (_service, method, bytes) => {
            if (method === 'ClaimSolarTerms') {
                assert.equal(_service,'gamepb.solartermspb.SolarTermsService');
                assert.equal(String(types.ClaimSolarTermsRequest.decode(bytes).term_id),'301');
                mutationCount++;solarClaimable=false;
                return {body:Buffer.from(require('./fixtures/pet-solar-claim-capture.json').hex,'hex')};
            }
            if (method === 'GetGroup') {
                if (failSnapshot && mutationCount) throw new Error('offline');
                return {body:encode(types.PetDiaryGetGroupReply,{group:{head:{id:'2026090100'},children:Object.values(group)}})};
            }
            const req = object(types.PetDiaryOperateRequest,bytes);
            calls.push(req);
            if (req.operate_type === '7') return {body:encode(types.PetDiaryOperateReply,{activity_id:'2026090103',operate_type:7,data:group.shop})};
            mutationCount++;
            const selector = Object.keys(req).find(k=>k.startsWith('pet_')||k==='mega_event_claim_all'||k==='shop_buy');
            if (req.operate_type === '29' && feedReply) {
                group.pet = decoded(feedReply).data;
                cake = (BigInt(cake) - 700n).toString();
                stars = (BigInt(stars) + 100n).toString();
                return { body: Buffer.from(capture(feedReply).hex,'hex') };
            }
            if (req.operate_type === '32' && storyReply) {
                group.pet = decoded(storyReply).data;
                return { body: Buffer.from(capture(storyReply).hex,'hex') };
            }
            if (req.operate_type === '29') { cake='0'; group.pet.pet_treasure_hunt.nurture.growth = 700; }
            return {body:encode(types.PetDiaryOperateReply,{activity_id:req.activity_id,operate_type:req.operate_type,[selector]:{}})};
        },
    });
    return { service, calls, group, mutations: () => mutationCount };
}

test('snapshot reads never claim seeds, and expose real limits and balances', async () => {
    const h=harness(); const dto=await h.service.getPetDiary();
    assert.deepEqual(h.calls.map(c=>c.operate_type),['7']);
    assert.equal(dto.nurture.canFeed,false);
    assert.equal(dto.seeds.canClaim,false);
    assert.equal(dto.stories.length,9);
    assert.equal(dto.shop.length,13);
    assert.equal(dto.shop.find(g=>g.id==='61').remaining,'100');
    assert.equal(dto.shop.find(g=>g.id==='61').exchangeable,true);
    assert.equal(dto.shop.find(g=>g.id==='50').exchangeable,false);
});

test('insufficient cake, duplicate seeds and unknown actions never issue a mutation', async () => {
    const h=harness();
    await assert.rejects(h.service.operatePetDiary('feed'),/不足/);
    await assert.rejects(h.service.operatePetDiary('seeds'),/礼包/);
    await assert.rejects(h.service.operatePetDiary('constructor'),/未知/);
    assert.equal(h.mutations(),0);
});

test('serialized mutations reread resources to prevent double spending', async () => {
    const h=harness({cake:'700'});
    const results=await Promise.allSettled([h.service.operatePetDiary('feed'),h.service.operatePetDiary('feed')]);
    assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
    assert.equal(h.mutations(),1);
    assert.equal(results[0].value.snapshot.nurture.growth,700);
});

test('successful live feeding capture updates balances, growth and the unlocked story', async () => {
    const h = harness({ cake:'1409', feedReply:'001874-recv.bin' });
    const result = await h.service.operatePetDiary('feed');
    assert.deepEqual(result.costs.map(i=>[i.id,i.count]), [['1028','700']]);
    assert.deepEqual(result.rewards.map(i=>[i.id,i.count]), [['1029','100']]);
    assert.equal(result.snapshot.balances.find(i=>i.id==='1028').count,'709');
    assert.equal(result.snapshot.balances.find(i=>i.id==='1029').count,'550');
    assert.equal(result.snapshot.nurture.growth,700);
    assert.equal(result.snapshot.nurture.feedCount,1);
    assert.equal(result.snapshot.stories[0].unlocked,true);
    assert.equal(result.snapshot.stories[0].claimed,false);
    assert.ok(result.snapshot.stories[0].photo.endsWith('/img_s3PhotoWall_photo0.png'));
});

test('user-triggered live story claim capture provides the gift and prevents duplicate claims', async () => {
    const h = harness({ cake:'709', petCapture:'001874-recv.bin', storyReply:'001926-recv.bin' });
    const result = await h.service.operatePetDiary('story',{order:1});
    assert.deepEqual(result.rewards.map(i=>[i.id,i.count]), [['29004','1'],['20516','8'],['80014','1']]);
    assert.equal(result.snapshot.stories[0].claimed,true);
    assert.equal(result.snapshot.nurture.growth,700);
    await assert.rejects(h.service.operatePetDiary('story',{order:1}),/已领取/);
    assert.equal(h.mutations(),1);
});

test('paid charm refresh stays blocked even if a caller supplies diamond overrides', async () => {
    const h=harness();h.group.pet.pet_treasure_hunt.battle.charm_free_refresh_count=1;
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{allowDiamonds:true}),/钻石/);
    assert.equal(h.mutations(),0);
});

test('a successful action remains successful when its follow-up snapshot fails', async () => {
    const h=harness({cake:'700',failSnapshot:true});
    const result=await h.service.operatePetDiary('feed');
    assert.equal(h.mutations(),1);
    assert.equal(result.snapshot,null);
    assert.match(result.refreshError,/操作已成功/);
});

test('expired activity and locked stories cannot be mutated', async () => {
    const h=harness({cake:'700'});
    await assert.rejects(h.service.operatePetDiary('story',{order:1}),/尚未解锁/);
    h.group.pet.head.end_time=1789009999;
    await assert.rejects(h.service.operatePetDiary('feed'),/活动时间/);
    assert.equal(h.mutations(),0);
});

test('shop checks numeric purchase counts, combined costs, and diamond fallback before sending', async () => {
    const h=harness({stars:'20000'});
    const goods=h.group.shop.shop.goods.find(g=>String(g.id)==='61');
    goods.purchased_count=99;
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'2'}),/限购/);
    goods.purchased_count=0;
    goods.diamond_cost_count=30;
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/钻石/);
    goods.diamond_cost_count=0;
    goods.cost=[{id:'1004',count:'1'}];
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/钻石/);
    goods.cost=[{id:'1029',count:'15000'},{id:'1029',count:'15000'}];
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/余额不足/);
    assert.equal(h.mutations(),0);
});

test('pet activity is discoverable without loading any season details', () => {
    const {buildActivityGameplayBindings,resolveActivityGameplays}=require('../dist/services/activity-gameplay-registry');
    const result=resolveActivityGameplays(['2026090100','2026090102'],buildActivityGameplayBindings({}));
    assert.equal(result.gameplayKey,'pet');
    assert.equal(result.detailTarget,'pet');
});

test('permanent bichon appears in the pet catalog with the official skill', () => {
    const {PET_IDS,getPetSkillCatalog}=require('../dist/services/pets');
    assert.ok(PET_IDS.includes(90031));
    const skills=getPetSkillCatalog().skillsByPetId[90031];
    assert.equal(skills.find(s=>s.skillId===3001).name,'比熊润田');
});

test('solar gift uses the captured claim result and a second claim is blocked', async () => {
    const h=harness({solarClaimable:true});
    const result=await h.service.operatePetDiary('solar',{termId:'301'});
    assert.deepEqual(result.rewards.map(i=>({id:i.id,count:i.count})),[{id:'25995',count:'30'},{id:'1002',count:'200'}]);
    assert.equal(result.snapshot.solarTerms.terms[0].canClaim,false);
    await assert.rejects(h.service.operatePetDiary('solar',{termId:'301'}),/不可领取/);
    assert.equal(h.mutations(),1);
});

test('actual mall response distinguishes tickets, gold beans and diamonds', () => {
    const type=root.lookupType('gamepb.mallpb.GetMallListBySlotTypeResponse');
    const reply=object(type,Buffer.from(require('./fixtures/pet-mall-capture.json').hex,'hex'));
    const goods=id=>reply.goods_list.find(g=>g.goods_id===id);
    assert.deepEqual(goods(1044).price,{id:'1002',count:'25',mutant_types:[]});
    assert.deepEqual(goods(1050).price,{id:'1005',count:'150',mutant_types:[]});
    assert.deepEqual(goods(1045).price,{id:'1004',count:'25',mutant_types:[]});
    assert.deepEqual(goods(1044).reward_items.map(i=>[i.id,i.count]),[['29004','1'],['80001','2'],['80011','2']]);
});
