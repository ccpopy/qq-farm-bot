const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const test = require('node:test');
const { createWorkerManager } = require('../dist/runtime/worker-manager');
const { sanitizeMeta } = require('../dist/services/logger');

test('worker thread receives its own account environment before module initialization', () => {
    const created=[];
    class Thread extends EventEmitter {
        constructor(_script,options) { super();this.options=options;created.push(this); }
        postMessage() {}
        terminate() { this.emit('exit',0); }
    }
    const manager=createWorkerManager({
        WorkerThread:Thread, runtimeMode:'thread',processRef:{env:{FARM_ACCOUNT_ID:'inherited-wrong-account'}},
        workerScriptPath:'worker.js',mainEntryPath:'client.js',workers:{},globalLogs:[],
        log(){},addAccountLog(){},buildConfigSnapshotForAccount:()=>({}),normalizeStatusForPanel:x=>x,
        getOfflineAutoDeleteMs:()=>0,triggerOfflineReminder(){},addOrUpdateAccount(){},deleteAccount(){},
    });
    manager.startWorker({id:'first',name:'first',code:'test-only'});
    manager.startWorker({id:'second',name:'second',code:'test-only'});
    assert.deepEqual(created.map(w=>w.options.env.FARM_ACCOUNT_ID),['first','second']);
    assert.deepEqual(created.map(w=>w.options.workerData.accountId),['first','second']);
    created.forEach(w=>w.emit('exit',0));
});

test('stopping one account scheduler does not stop another account heartbeat', async () => {
    const scheduler=path.resolve(__dirname,'../dist/services/scheduler.js');
    const code=`const {parentPort,workerData}=require('node:worker_threads');const {createScheduler}=require(workerData.scheduler);
        const s=createScheduler('network');let ticks=0;
        s.setIntervalTask('heartbeat_interval',15,()=>parentPort.postMessage({tick:++ticks}));
        parentPort.on('message',()=>{s.clearAll();parentPort.postMessage({stopped:true});});`;
    const workers=[new Worker(code,{eval:true,workerData:{scheduler}}),new Worker(code,{eval:true,workerData:{scheduler}})];
    const next=(worker,predicate)=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('worker timed out')),3000);
        const listener=m=>{if(predicate(m)){clearTimeout(timer);worker.off('message',listener);resolve(m);}};
        worker.on('message',listener);
    });
    try {
        await Promise.all(workers.map(w=>next(w,m=>m.tick>=2)));
        const stopped=next(workers[0],m=>m.stopped);workers[0].postMessage('stop');await stopped;
        const continued=await next(workers[1],m=>m.tick>=4);
        assert.ok(continued.tick>=4);
    } finally { await Promise.all(workers.map(w=>w.terminate())); }
});

test('diagnostic status codes survive redaction, login credentials do not', () => {
    const value=sanitizeMeta({code:'private-login-code',authCode:'private',token:'private',disconnectCode:1006,errorCode:400,
        diagnostics:{pending:3,lastInboundAgeMs:65000,heartbeatMisses:3}});
    assert.equal(value.code,'[REDACTED]');assert.equal(value.authCode,'[REDACTED]');assert.equal(value.token,'[REDACTED]');
    assert.equal(value.disconnectCode,1006);assert.equal(value.errorCode,400);assert.equal(value.diagnostics.pending,3);
});
