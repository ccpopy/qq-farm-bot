const assert = require('node:assert/strict');
const test = require('node:test');

function loadPlantingWithFertilizerStubs(t, options = {}) {
    const store = require('../dist/models/store');
    const farmApi = require('../dist/services/farm/api');
    const landAnalysis = require('../dist/services/farm/land-analysis');
    const plantingModulePath = require.resolve('../dist/services/farm/planting');
    const originals = {
        getAutomation: store.getAutomation,
        getAllLands: farmApi.getAllLands,
        fertilize: farmApi.fertilize,
        fertilizeOrganicLoop: farmApi.fertilizeOrganicLoop,
        normalizeFertilizerLandTypes: landAnalysis.normalizeFertilizerLandTypes,
        formatFertilizerLandTypes: landAnalysis.formatFertilizerLandTypes,
        filterLandIdsByTypes: landAnalysis.filterLandIdsByTypes,
        getLandTypeByLevel: landAnalysis.getLandTypeByLevel,
        getFastMatureLands: landAnalysis.getFastMatureLands,
    };

    const reads = [...(options.reads || [])];
    const calls = { reads: 0, normalTargets: [], organicTargets: [] };
    store.getAutomation = () => ({
        fertilizer: 'smart',
        fertilizer_land_types: options.landTypes || [...landAnalysis.ALL_FERTILIZER_LAND_TYPES],
        fertilizer_smart_seconds: 300,
    });
    farmApi.getAllLands = async () => {
        const next = reads[calls.reads++];
        if (next instanceof Error) throw next;
        return next;
    };
    farmApi.fertilize = async (targets) => {
        calls.normalTargets.push([...targets]);
        return options.normalFertilized || 0;
    };
    farmApi.fertilizeOrganicLoop = async (targets) => {
        calls.organicTargets.push([...targets]);
        return 0;
    };
    landAnalysis.normalizeFertilizerLandTypes = value => [...value];
    landAnalysis.formatFertilizerLandTypes = () => ['全部土地'];
    landAnalysis.filterLandIdsByTypes = targets => [...targets];
    landAnalysis.getLandTypeByLevel = () => 'normal';
    landAnalysis.getFastMatureLands = lands => (lands || []).map(land => Number(land.id));

    delete require.cache[plantingModulePath];
    const planting = require(plantingModulePath);
    t.after(() => {
        Object.assign(store, { getAutomation: originals.getAutomation });
        Object.assign(farmApi, {
            getAllLands: originals.getAllLands,
            fertilize: originals.fertilize,
            fertilizeOrganicLoop: originals.fertilizeOrganicLoop,
        });
        Object.assign(landAnalysis, {
            normalizeFertilizerLandTypes: originals.normalizeFertilizerLandTypes,
            formatFertilizerLandTypes: originals.formatFertilizerLandTypes,
            filterLandIdsByTypes: originals.filterLandIdsByTypes,
            getLandTypeByLevel: originals.getLandTypeByLevel,
            getFastMatureLands: originals.getFastMatureLands,
        });
        delete require.cache[plantingModulePath];
    });
    return { planting, calls };
}

test('smart fertilizer reuses its fresh land read when no land mutation occurs', async (t) => {
    const { planting, calls } = loadPlantingWithFertilizerStubs(t, {
        reads: [{ lands: [{ id: 11, level: 1 }] }],
    });

    await planting.runFertilizerByConfig([], { skipNormal: true });

    assert.equal(calls.reads, 1);
    assert.deepEqual(calls.organicTargets, [[11]]);
});

test('smart fertilizer refreshes lands after normal fertilizer changes state', async (t) => {
    const { planting, calls } = loadPlantingWithFertilizerStubs(t, {
        reads: [
            { lands: [{ id: 11, level: 1 }] },
            { lands: [{ id: 22, level: 1 }] },
        ],
        normalFertilized: 1,
    });

    await planting.runFertilizerByConfig([11]);

    assert.equal(calls.reads, 2);
    assert.deepEqual(calls.normalTargets, [[11]]);
    assert.deepEqual(calls.organicTargets, [[22]]);
});

test('smart fertilizer retries one fresh read when the decision read failed', async (t) => {
    const { planting, calls } = loadPlantingWithFertilizerStubs(t, {
        reads: [
            new Error('temporary failure'),
            { lands: [{ id: 33, level: 1 }] },
        ],
        landTypes: ['normal'],
    });

    await planting.runFertilizerByConfig([], { skipNormal: true });

    assert.equal(calls.reads, 2);
    assert.deepEqual(calls.organicTargets, [[33]]);
});
