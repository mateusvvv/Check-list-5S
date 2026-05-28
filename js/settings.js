import { checklistData, checklistDataByViatura, categoryNames, cloneChecklistItems, defaultViaturas, ensureChecklistForViatura, getDefaultChecklistDataByViatura, normalizeChecklistItem } from "./config.js";
import { db, firestoreDoc, getDoc, serverTimestamp, setDoc } from "./firebase.js";
import { setViaturas, state } from "./state.js";

const SETTINGS_COLLECTION = "configuracoes";
const SETTINGS_DOC = "app";

export function normalizeAllChecklistData(data = checklistData) {
    const normalized = {};
    Object.keys(categoryNames).forEach(category => {
        normalized[category] = (data[category] || checklistData[category] || [])
            .map((item, index) => normalizeChecklistItem(item, index))
            .filter(item => item.nome);
    });
    return normalized;
}

function applyChecklistData(data) {
    const normalized = normalizeAllChecklistData(data);
    Object.keys(categoryNames).forEach(category => {
        checklistData[category].splice(0, checklistData[category].length, ...normalized[category]);
    });
}

function applyChecklistDataByViatura(data = {}) {
    Object.keys(checklistDataByViatura).forEach(viaturaId => delete checklistDataByViatura[viaturaId]);
    Object.entries(data).forEach(([viaturaId, porCategoria]) => {
        checklistDataByViatura[String(viaturaId)] = normalizeAllChecklistData(porCategoria);
    });
}

function ensureChecklistForAllViaturas() {
    state.viaturas.forEach(viatura => ensureChecklistForViatura(viatura.id));
}

function applyDefaultVehicleInventories() {
    Object.entries(getDefaultChecklistDataByViatura()).forEach(([viaturaId, porCategoria]) => {
        if (!checklistDataByViatura[viaturaId]) checklistDataByViatura[viaturaId] = {};
        Object.entries(porCategoria).forEach(([category, items]) => {
            checklistDataByViatura[viaturaId][category] = items.map((item, index) => normalizeChecklistItem(item, index));
        });
    });
}

function applyConfigHistory(history = []) {
    state.configHistory = Array.isArray(history)
        ? history
            .filter(item => item && item.tipo && item.descricao)
            .map(item => ({
                id: String(item.id || `hist-${Date.now()}`),
                tipo: String(item.tipo || ""),
                descricao: String(item.descricao || ""),
                vistoriador: String(item.vistoriador || "Não identificado"),
                email: String(item.email || ""),
                data: String(item.data || new Date().toISOString())
            }))
        : [];
}

export async function carregarConfiguracoes() {
    try {
        const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
            const data = snapshot.data();
            applyChecklistData(data.checklistData || checklistData);
            setViaturas(data.viaturas || defaultViaturas);
            applyChecklistDataByViatura(data.checklistDataByViatura || {});
            applyDefaultVehicleInventories();
            applyConfigHistory(data.configHistory || []);
            ensureChecklistForAllViaturas();
            return;
        }

        applyChecklistData(checklistData);
        setViaturas(defaultViaturas);
        applyConfigHistory([]);
        applyDefaultVehicleInventories();
        ensureChecklistForAllViaturas();
        await salvarConfiguracoes();
    } catch (error) {
        console.warn("Não foi possível carregar configurações remotas. Usando configuração local.", error);
        applyChecklistData(checklistData);
        setViaturas(defaultViaturas);
        applyConfigHistory([]);
        applyDefaultVehicleInventories();
        ensureChecklistForAllViaturas();
    }
}

export async function salvarConfiguracoes() {
    const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    await setDoc(ref, {
        checklistData: normalizeAllChecklistData(checklistData),
        checklistDataByViatura: Object.fromEntries(
            Object.entries(checklistDataByViatura).map(([viaturaId, porCategoria]) => [
                viaturaId,
                Object.fromEntries(
                    Object.keys(categoryNames).map(category => [
                        category,
                        cloneChecklistItems(porCategoria[category] || checklistData[category])
                    ])
                )
            ])
        ),
        viaturas: state.viaturas,
        configHistory: state.configHistory.slice(0, 200),
        atualizadoEm: serverTimestamp()
    }, { merge: true });
}
