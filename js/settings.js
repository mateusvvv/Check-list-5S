import { checklistData, checklistDataByViatura, categoryNames, cloneChecklistItems, cloneEmployeeEpis, defaultVistoriadores, defaultViaturas, employeeEpisByPerson, ensureChecklistForViatura, funcionariosExtras, getDefaultChecklistDataByViatura, getFuncionarioKeyFromFields, normalizeChecklistItem, normalizeEmployeeEpiItem, normalizeVistoriador, setVistoriadores, viaturaResponsaveis, vistoriadores } from "./config.js";
import { db, firestoreDoc, onSnapshot, serverTimestamp, setDoc } from "./firebase.js";
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
    const defaultIds = new Set(defaultViaturas.map(viatura => String(viatura.id)));
    Object.keys(checklistDataByViatura).forEach(viaturaId => delete checklistDataByViatura[viaturaId]);
    Object.entries(data).forEach(([viaturaId, porCategoria]) => {
        if (!defaultIds.has(String(viaturaId))) return;
        checklistDataByViatura[String(viaturaId)] = normalizeAllChecklistData(porCategoria);
    });
}

function applyEmployeeEpisByPerson(data = {}) {
    Object.entries(data).forEach(([key, items]) => {
        employeeEpisByPerson[key] = Array.isArray(items)
            ? items.map((item, index) => normalizeEmployeeEpiItem(item, index)).filter(item => item.nome)
            : [];
    });
}

function applyViaturaResponsaveis(data = {}) {
    const defaultIds = new Set(defaultViaturas.map(viatura => String(viatura.id)));
    Object.keys(viaturaResponsaveis).forEach(viaturaId => {
        if (!defaultIds.has(String(viaturaId))) delete viaturaResponsaveis[viaturaId];
    });
    Object.entries(data).forEach(([viaturaId, responsaveis]) => {
        if (!defaultIds.has(String(viaturaId))) return;
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

    const viatura09 = viaturaResponsaveis["9"];
    if (viatura09) {
        const nomesAntigos = [
            "JOSENILDO VINICIUS ALVES LOPES SILVA",
            "MIKE RYAN LIMA CRUZ"
        ];
        if (nomesAntigos.includes(viatura09.tecnico)) {
            viatura09.tecnico = "Veículo sem Técnico";
            viatura09.tecnicoCpf = "";
        }
        if (nomesAntigos.includes(viatura09.auxiliar)) {
            viatura09.auxiliar = "";
            viatura09.auxiliarCpf = "";
        }
    }
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
    const defaultExtras = new Map(funcionariosExtras
        .filter(funcionario => funcionario.finalizado)
        .map(funcionario => [getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf), cloneFuncionarioExtra(funcionario)]));
    const normalized = Array.isArray(data)
        ? data.map((funcionario, index) => normalizeFuncionarioExtra(funcionario, index)).filter(funcionario => funcionario.nome)
        : [];
    funcionariosExtras.splice(0, funcionariosExtras.length, ...normalized);
    ensureDefaultExtra(defaultExtras, "JOSE RANDSON SILVA", "125.442.764-36", { funcao: "Técnico", status: "Férias" });
    ensureDefaultExtra(defaultExtras, "JOSENILDO VINICIUS ALVES LOPES SILVA", "131.000.574-57", { funcao: "Auxiliar técnico", status: "Ativo" });
    ensureDefaultExtra(defaultExtras, "MIKE RYAN LIMA CRUZ", "159.056.184-88", { funcao: "Auxiliar técnico", status: "Ativo" });
    funcionariosExtras.forEach(funcionario => {
        employeeEpisByPerson[getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf)] = cloneEmployeeEpis(funcionario.epis || []);
    });
    syncFuncionariosExtrasViaturas();
}

function cloneFuncionarioExtra(funcionario) {
    return normalizeFuncionarioExtra({
        ...funcionario,
        epis: cloneEmployeeEpis(funcionario.epis || [])
    });
}

function ensureDefaultExtra(defaultExtras, nome, cpf, defaults = {}) {
    const key = getFuncionarioKeyFromFields(nome, cpf);
    const existingIndex = funcionariosExtras.findIndex(funcionario => getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf) === key);
    const template = defaultExtras.get(key) || {};
    const existing = existingIndex >= 0 ? funcionariosExtras[existingIndex] : {};
    const funcionario = normalizeFuncionarioExtra({
        ...template,
        ...existing,
        nome,
        cpf,
        funcao: defaults.funcao || existing.funcao || template.funcao || "Técnico",
        status: defaults.status || existing.status || template.status || "Ativo",
        finalizado: true,
        viaturaId: existing.viaturaId || template.viaturaId || "",
        epis: cloneEmployeeEpis((existing.epis?.length ? existing.epis : template.epis) || employeeEpisByPerson[key] || [])
    });

    if (existingIndex >= 0) {
        funcionariosExtras.splice(existingIndex, 1, funcionario);
    } else {
        funcionariosExtras.push({
            id: `funcionario-extra-${key.replace(/[^a-z0-9]+/gi, "-")}`,
            ...funcionario
        });
    }
}

function getFuncionarioExtraResponsavelFields(funcionario) {
    const funcao = String(funcionario?.funcao || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const isAuxiliar = funcao.includes("auxiliar");

    return {
        campoNome: isAuxiliar ? "auxiliar" : "tecnico",
        campoCpf: isAuxiliar ? "auxiliarCpf" : "tecnicoCpf"
    };
}

function clearFuncionarioResponsavel(key) {
    Object.values(viaturaResponsaveis).forEach(responsaveis => {
        if (responsaveis.tecnico && getFuncionarioKeyFromFields(responsaveis.tecnico, responsaveis.tecnicoCpf) === key) {
            responsaveis.tecnico = "";
            responsaveis.tecnicoCpf = "";
        }

        if (responsaveis.auxiliar && getFuncionarioKeyFromFields(responsaveis.auxiliar, responsaveis.auxiliarCpf) === key) {
            responsaveis.auxiliar = "";
            responsaveis.auxiliarCpf = "";
        }
    });
}

function syncFuncionariosExtrasViaturas() {
    const defaultIds = new Set(defaultViaturas.map(viatura => String(viatura.id)));

    funcionariosExtras
        .filter(funcionario => funcionario.finalizado && funcionario.viaturaId && defaultIds.has(String(funcionario.viaturaId)))
        .forEach(funcionario => {
            const viaturaId = String(funcionario.viaturaId);
            const key = getFuncionarioKeyFromFields(funcionario.nome, funcionario.cpf);
            const fields = getFuncionarioExtraResponsavelFields(funcionario);

            if (!viaturaResponsaveis[viaturaId]) {
                viaturaResponsaveis[viaturaId] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
            }

            const destino = viaturaResponsaveis[viaturaId];
            const destinoNome = destino[fields.campoNome];
            const destinoKey = getFuncionarioKeyFromFields(destinoNome, destino[fields.campoCpf]);
            const destinoLivre = !destinoNome || destinoNome === "Veículo sem Técnico" || destinoKey === key;
            if (!destinoLivre) return;

            clearFuncionarioResponsavel(key);
            destino[fields.campoNome] = funcionario.nome;
            destino[fields.campoCpf] = funcionario.cpf;
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

function applyVistoriadores(data = []) {
    setVistoriadores(Array.isArray(data) && data.length ? data : defaultVistoriadores);
}

export async function carregarConfiguracoes() {
    try {
        const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
        
        // Usando onSnapshot para sincronização em tempo real das configurações
        onSnapshot(ref, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                applyChecklistData(data.checklistData || checklistData);
                setViaturas(data.viaturas || defaultViaturas);
                applyViaturaResponsaveis(data.viaturaResponsaveis || viaturaResponsaveis);
                applyChecklistDataByViatura(data.checklistDataByViatura || {});
                if (data.employeeEpisByPerson) applyEmployeeEpisByPerson(data.employeeEpisByPerson);
                applyFuncionariosExtras(data.funcionariosExtras || funcionariosExtras);
                applyVistoriadores(data.vistoriadores || defaultVistoriadores);
                applyDefaultVehicleInventories();
                applyConfigHistory(data.configHistory || []);
                ensureChecklistForAllViaturas();
                
                // Notifica a UI principal (script.js) para atualizar a tela
                window.refreshAppAfterConfigChange?.();
            }
        });
    } catch (error) {
        console.warn("Não foi possível carregar configurações remotas. Usando configuração local.", error);
    }
}

export async function salvarConfiguracoes() {
    const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    const defaultIds = new Set(defaultViaturas.map(viatura => String(viatura.id)));
    await setDoc(ref, {
        checklistData: normalizeAllChecklistData(checklistData),
        checklistDataByViatura: Object.fromEntries(
            Object.entries(checklistDataByViatura)
                .filter(([viaturaId]) => defaultIds.has(String(viaturaId)))
                .map(([viaturaId, porCategoria]) => [
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
        vistoriadores: vistoriadores.map((vistoriador, index) => normalizeVistoriador(vistoriador, index)),
        viaturaResponsaveis: Object.fromEntries(
            Object.entries(viaturaResponsaveis)
                .filter(([viaturaId]) => defaultIds.has(String(viaturaId)))
                .map(([viaturaId, responsaveis]) => [
                    viaturaId,
                    { ...responsaveis }
                ])
        ),
        viaturas: state.viaturas,
        configHistory: state.configHistory.slice(0, 200),
        atualizadoEm: serverTimestamp()
    }, { merge: true });
}
