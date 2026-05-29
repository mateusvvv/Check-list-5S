import { checklistData, checklistDataByViatura, categoryNames, cloneChecklistItems, cloneEmployeeEpis, defaultViaturas, employeeEpisByPerson, ensureChecklistForViatura, funcionariosExtras, getDefaultChecklistDataByViatura, getFuncionarioKeyFromFields, normalizeChecklistItem, normalizeEmployeeEpiItem, viaturaResponsaveis } from "./config.js";
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

function applyEmployeeEpisByPerson(data = {}) {
    Object.keys(employeeEpisByPerson).forEach(key => delete employeeEpisByPerson[key]);
    Object.entries(data).forEach(([key, items]) => {
        employeeEpisByPerson[key] = Array.isArray(items)
            ? items.map((item, index) => normalizeEmployeeEpiItem(item, index)).filter(item => item.nome)
            : [];
    });
}

function applyViaturaResponsaveis(data = {}) {
    Object.entries(data).forEach(([viaturaId, responsaveis]) => {
        if (!viaturaResponsaveis[String(viaturaId)]) {
            viaturaResponsaveis[String(viaturaId)] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
        }
        viaturaResponsaveis[String(viaturaId)] = {
            tecnico: String(responsaveis?.tecnico || ""),
            tecnicoCpf: String(responsaveis?.tecnicoCpf || ""),
            auxiliar: String(responsaveis?.auxiliar || ""),
            auxiliarCpf: String(responsaveis?.auxiliarCpf || "")
        };
    });
}

function normalizeFuncionarioExtra(funcionario = {}, index = 0) {
    return {
        id: String(funcionario.id || `funcionario-extra-${Date.now()}-${index}`),
        nome: String(funcionario.nome || "").trim(),
        cpf: String(funcionario.cpf || "").trim(),
        funcao: String(funcionario.funcao || "Técnico").trim() || "Técnico",
        status: String(funcionario.status || "Ativo").trim() || "Ativo",
        finalizado: Boolean(funcionario.finalizado),
        viaturaId: String(funcionario.viaturaId || ""),
        epis: Array.isArray(funcionario.epis)
            ? funcionario.epis.map((item, itemIndex) => normalizeEmployeeEpiItem(item, itemIndex)).filter(item => item.nome)
            : []
    };
}

function applyFuncionariosExtras(data = funcionariosExtras) {
    const normalized = Array.isArray(data)
        ? data.map((funcionario, index) => normalizeFuncionarioExtra(funcionario, index)).filter(funcionario => funcionario.nome)
        : [];
    funcionariosExtras.splice(0, funcionariosExtras.length, ...normalized);
    funcionariosExtras.forEach(funcionario => {
        employeeEpisByPerson[getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf)] = cloneEmployeeEpis(funcionario.epis || []);
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
            applyViaturaResponsaveis(data.viaturaResponsaveis || viaturaResponsaveis);
            applyChecklistDataByViatura(data.checklistDataByViatura || {});
            if (data.employeeEpisByPerson) applyEmployeeEpisByPerson(data.employeeEpisByPerson);
            applyFuncionariosExtras(data.funcionariosExtras || funcionariosExtras);
            applyDefaultVehicleInventories();
            applyConfigHistory(data.configHistory || []);
            ensureChecklistForAllViaturas();
            return;
        }

        applyChecklistData(checklistData);
        setViaturas(defaultViaturas);
        applyConfigHistory([]);
        applyFuncionariosExtras(funcionariosExtras);
        applyDefaultVehicleInventories();
        ensureChecklistForAllViaturas();
        await salvarConfiguracoes();
    } catch (error) {
        console.warn("Não foi possível carregar configurações remotas. Usando configuração local.", error);
        applyChecklistData(checklistData);
        setViaturas(defaultViaturas);
        applyConfigHistory([]);
        applyFuncionariosExtras(funcionariosExtras);
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
        employeeEpisByPerson: Object.fromEntries(
            Object.entries(employeeEpisByPerson).map(([key, items]) => [key, cloneEmployeeEpis(items)])
        ),
        funcionariosExtras: funcionariosExtras.map((funcionario, index) => normalizeFuncionarioExtra(funcionario, index)),
        viaturaResponsaveis: Object.fromEntries(
            Object.entries(viaturaResponsaveis).map(([viaturaId, responsaveis]) => [
                viaturaId,
                { ...responsaveis }
            ])
        ),
        viaturas: state.viaturas,
        configHistory: state.configHistory.slice(0, 200),
        atualizadoEm: serverTimestamp()
    }, { merge: true });
}
