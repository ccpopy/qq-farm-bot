const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const protobuf=require('protobufjs');
const root=new protobuf.Root().loadSync(['mallpb.proto','qqvippb.proto'].map(f=>path.resolve(__dirname,'../src/proto',f)),{keepCase:true});
const fixtures=require('./fixtures/autumn-live-capture.json');
const decode=(file,name)=>root.lookupType(name).decode(Buffer.from(fixtures.find(v=>v.file===file).hex,'hex'));
test('member and nonmember full replies decode actual entitlement and mall flags',()=>{
 const member=decode('000325-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 const nonmember=decode('000016-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 assert.equal(member.is_qq_vip,true);assert.equal(member.can_claim,false);
 assert.equal(member.claimed_today,true);assert.equal(member.mall_free_can_claim,true);
 assert.equal(Number(member.remaining_days),1562);
 assert.equal(nonmember.is_qq_vip,false);
 assert.ok(nonmember.reward_statuses.length>0);
 const mall=decode('000327-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 assert.deepEqual(mall.goods_list.map(g=>Number(g.goods_id)),[1053,1054,1055,1056]);
 assert.equal(mall.goods_list[0].is_available,true);
 assert.equal(Number(mall.goods_list[2].price.id),1901);
 assert.equal(Number(mall.goods_list[2].price.count),30);
 assert.equal(Number(mall.goods_list[2].reward_items[0].id),2121);
});

function harness({member=true,bag=[{id:1901,count:20},{id:1901,count:10}],bagFailure=false,refreshFailure=false,now=1790215551,slotType=4,mallFile='000327-recv.bin',diamond=7}={}){
 const bought=[];let reads=0;
 const mock=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
 mock('../dist/config/gameConfig',{getItemById:()=>({name:'item'}),getItemImageById:()=>''});
 mock('../dist/utils/utils',{toNum:v=>Number(v)||0,getServerTimeSec:()=>now});
 mock('../dist/services/qqvip',{refreshVipInfo:async()=>{},getQQVipRewardsStatus:async()=>({is_qq_vip:member,remaining_days:1562})});
 mock('../dist/services/warehouse',{getBag:async()=>{if(bagFailure)throw new Error('bag unavailable');return bag;},getBagItems:v=>v});
 mock('../dist/services/pay',{getDiamondBalance:async()=>diamond});
 mock('../dist/services/mystery-shop',{});
 mock('../dist/services/mall',{getMallListBySlotType:async slot=>{
  reads++;if(refreshFailure&&bought.length)throw new Error('offline');
  assert.equal(slot,slotType);return decode(mallFile,'gamepb.mallpb.GetMallListBySlotTypeResponse');
 },purchaseMallGoods:async (id,count)=>{bought.push({id,count});return {goods_id:id,success:true,reward_items:[]};}});
 const id=require.resolve('../dist/services/commerce');delete require.cache[id];
 return {service:require(id),bought};
}
test('nonmember may browse but backend rejects every SVIP purchase',async()=>{
 const h=harness({member:false});const list=await h.service.getMallCatalog(4);
 assert.equal(list.goods.length,4);assert.ok(list.goods.every(g=>!g.purchasable));
 for(const id of [1053,1054,1055,1056])await assert.rejects(h.service.purchaseMallProduct(id,1,4),e=>e.code==='GOODS_UNAVAILABLE');
 assert.equal(h.bought.length,0);
});
test('SVIP fragments aggregate, missing currencies are zero, unknown balances cannot spend',async()=>{
 const h=harness();const list=await h.service.getMallCatalog(4);
 assert.equal(list.goods.find(g=>g.id===1055).price.balance,30);
 assert.equal(list.goods.find(g=>g.id===1056).price.balance,0);
 const result=await h.service.purchaseMallProduct(1055,1,4);assert.equal(result.purchase.count,1);
 assert.deepEqual(h.bought,[{id:1055,count:1}]);
 const unknown=harness({bagFailure:true});await assert.rejects(unknown.service.purchaseMallProduct(1055,1,4),e=>e.code==='MALL_BALANCE_UNAVAILABLE');
 assert.equal(unknown.bought.length,0);
});
test('confirmed purchase survives a failed catalog refresh',async()=>{
 const h=harness({refreshFailure:true});const result=await h.service.purchaseMallProduct(1053,1,4);
 assert.equal(result.refreshRequired,true);assert.equal(h.bought.length,1);
});
test('purchase wire field 2 is success, never the quantity bought',()=>{
 const type=root.lookupType('gamepb.mallpb.PurchaseResponse');
 const reply=type.decode(Buffer.from('089d081001','hex'));
 assert.equal(Number(reply.goods_id),1053);assert.equal(reply.success,true);
 assert.equal(reply.count,undefined);
});

test('switched nonmember catalog contains the same goods with every availability flag false',()=>{
 const status=decode('001366-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 const member=decode('000327-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 const nonmember=decode('001376-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 assert.equal(status.is_qq_vip,false);
 assert.deepEqual(nonmember.goods_list.map(g=>Number(g.goods_id)),[1053,1054,1055,1056]);
 for(let i=0;i<member.goods_list.length;i++){
  assert.equal(nonmember.goods_list[i].is_available,false);
  assert.deepEqual(nonmember.goods_list[i].price,member.goods_list[i].price);
  assert.deepEqual(nonmember.goods_list[i].reward_items,member.goods_list[i].reward_items);
 }
});

test('new activity promotion uses captured 780 price only inside its server time window',async()=>{
 const options={slotType:1,mallFile:'001343-recv.bin',diamond:780};
 for(const [now,price,original]of [[1790179199,880,null],[1790179200,780,880],[1790783998,780,880],[1790783999,880,null]]){
  const h=harness({...options,now});const catalog=await h.service.getMallCatalog(1);
  const product=catalog.goods.find(g=>g.id===1060);
  assert.equal(product.price.count,price);assert.equal(product.originalPrice,original);
  assert.equal(product.discountEndTime,1790783999000);
  assert.equal(product.isDiscounted,original!==null);
  assert.equal(catalog.goods.find(g=>g.id===1043).price.count,488);
 }
 const h=harness({...options,now:1790215551});
 await h.service.purchaseMallProduct(1060,1,1,{id:1004,count:780});
 assert.deepEqual(h.bought,[{id:1060,count:1}]);
 const expired=harness({...options,now:1790783999,diamond:1000});
 await assert.rejects(expired.service.purchaseMallProduct(1060,1,1,{id:1004,count:780}),e=>e.code==='MALL_PRICE_CHANGED');
 assert.equal(expired.bought.length,0);
});
