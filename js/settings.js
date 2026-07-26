import { checklistData, checklistDataByViatura, categoryNames, cloneChecklistItems, cloneEmployeeEpis, defaultViaturaResponsaveis, defaultVistoriadores, defaultViaturas, employeeEpisByPerson, ensureChecklistForViatura, funcionariosExtras, getDefaultChecklistDataByViatura, getFuncionarioKeyFromFields, normalizeChecklistItem, normalizeEmployeeEpiItem, normalizeVistoriador, resolveChecklistItemData, setVistoriadores, viaturaResponsaveis, vistoriadores } from "./config.js";
import { db, firestoreDoc, getDoc, onSnapshot, serverTimestamp, setDoc } from "./firebase.js";
import { setViaturas, state } from "./state.js?v=2";

const SETTINGS_COLLECTION = "configuracoes";
const SETTINGS_DOC = "app";
let settingsUnsubscribe = null;

function getChecklistCategories() {
    return Object.keys(checklistData);
}

function getKnownViaturaIds() {
    return new Set([
        ...defaultViaturas.map(viatura => String(viatura.id)),
        ...state.viaturas.map(viatura => String(viatura.id))
    ]);
}

export function normalizeAllChecklistData(data = checklistData, viaturaId = "") {
    const normalized = {};
    getChecklistCategories().forEach(category => {
        normalized[category] = (data[category] || checklistData[category] || [])
            .map((item, index) => resolveChecklistItemData(category, item, viaturaId, index))
            .filter(item => item.nome);
    });
    return normalized;
}

function applyChecklistData(data) {
    const normalized = normalizeAllChecklistData(data);

    // Migração: Se a lista global de viaturas contiver itens antigos, força a atualização
    const itensViatura = normalized.viaturas?.map(i => i.nome) || [];
    if (itensViatura.includes("Pressão dos Pneus") || itensViatura.includes("Limpeza Interna")) {
        console.log("Detectada lista de viaturas antiga no banco. Sincronizando novos itens...");
        normalized.viaturas = cloneChecklistItems(checklistData.viaturas);
    }

    getChecklistCategories().forEach(category => {
        checklistData[category].splice(0, checklistData[category].length, ...normalized[category]);
    });
}

function applyChecklistDataByViatura(data = {}) {
    const knownIds = getKnownViaturaIds();
    Object.keys(checklistDataByViatura).forEach(viaturaId => delete checklistDataByViatura[viaturaId]);
    Object.entries(data).forEach(([viaturaId, porCategoria]) => {
        if (!knownIds.has(String(viaturaId))) return;
        const normalized = normalizeAllChecklistData(porCategoria, viaturaId);

        // Migração por viatura específica: se houver lista customizada antiga, remove para usar a nova global
        const itensViatura = normalized.viaturas?.map(i => i.nome) || [];
        if (itensViatura.includes("Pressão dos Pneus")) {
            delete normalized.viaturas; 
        }

        checklistDataByViatura[String(viaturaId)] = normalized;
    });
}

function applyEmployeeEpisByPerson(data = {}) {
    Object.entries(data).forEach(([key, items]) => {
        employeeEpisByPerson[key] = Array.isArray(items)
            ? items.map((item, index) => normalizeEmployeeEpiItem(item, index)).filter(item => item.nome)
            : [];
    });
}

function mergeResponsaveisWithDefaults(defaults = {}, saved = {}) {
    const savedAuxiliares = Array.isArray(saved?.auxiliares)
        ? saved.auxiliares.filter(auxiliar => auxiliar?.nome)
        : [];
    const defaultAuxiliares = Array.isArray(defaults?.auxiliares)
        ? defaults.auxiliares.filter(auxiliar => auxiliar?.nome)
        : [];
    const isEmptyResponsavel = (value) => {
        const normalized = String(value || "").trim().toLowerCase();
        return !normalized || normalized === "veículo sem técnico" || normalized === "veiculo sem tecnico";
    };
    const hasSavedTecnico = Object.prototype.hasOwnProperty.call(saved || {}, "tecnico");
    const hasSavedAuxiliar = Object.prototype.hasOwnProperty.call(saved || {}, "auxiliar");
    const tecnico = hasSavedTecnico
        ? saved?.tecnico
        : (isEmptyResponsavel(defaults?.tecnico) ? "" : defaults?.tecnico);
    const auxiliar = hasSavedAuxiliar
        ? saved?.auxiliar
        : (savedAuxiliares[0]?.nome || defaults?.auxiliar || defaultAuxiliares[0]?.nome || "");
    const auxiliarCpf = hasSavedAuxiliar
        ? saved?.auxiliarCpf
        : (savedAuxiliares[0]?.cpf || defaults?.auxiliarCpf || defaultAuxiliares[0]?.cpf || "");
    const auxiliares = hasSavedAuxiliar && !auxiliar
        ? []
        : (savedAuxiliares.length ? savedAuxiliares : defaultAuxiliares);

    return {
        tecnico: String(tecnico || ""),
        tecnicoCpf: String((hasSavedTecnico && !tecnico) ? "" : (saved?.tecnicoCpf || defaults?.tecnicoCpf || "")),
        auxiliar: String(auxiliar || ""),
        auxiliarCpf: String(auxiliarCpf || ""),
        auxiliares: auxiliares.map(auxiliar => ({ ...auxiliar }))
    };
}

function applyViaturaResponsaveis(data = {}) {
    const knownIds = getKnownViaturaIds();
    const baseViaturas = state.viaturas.length ? state.viaturas : defaultViaturas;
    const source = Object.fromEntries(baseViaturas.map(viatura => {
        const viaturaId = String(viatura.id);
        const hasSavedResponsaveis = Object.prototype.hasOwnProperty.call(data, viaturaId);
        return [
            viaturaId,
            hasSavedResponsaveis
                ? (data[viaturaId] || {})
                : mergeResponsaveisWithDefaults(defaultViaturaResponsaveis[viaturaId], {})
        ];
    }));

    Object.keys(viaturaResponsaveis).forEach(viaturaId => {
        if (!knownIds.has(String(viaturaId))) delete viaturaResponsaveis[viaturaId];
    });
    Object.entries(source).forEach(([viaturaId, responsaveis]) => {
        if (!knownIds.has(String(viaturaId))) return;
        if (!viaturaResponsaveis[String(viaturaId)]) {
            viaturaResponsaveis[String(viaturaId)] = { tecnico: "", tecnicoCpf: "", auxiliar: "", auxiliarCpf: "" };
        }
        const hasExplicitAuxiliar = Object.prototype.hasOwnProperty.call(responsaveis || {}, "auxiliar");
        const auxiliaresArr = hasExplicitAuxiliar && !responsaveis?.auxiliar
            ? []
            : (Array.isArray(responsaveis?.auxiliares) && responsaveis.auxiliares.length > 0
                ? responsaveis.auxiliares.map(a => ({...a}))
                : (responsaveis?.auxiliar ? [{nome: responsaveis.auxiliar, cpf: responsaveis.auxiliarCpf}] : []));

        viaturaResponsaveis[String(viaturaId)] = {
            tecnico: String(responsaveis?.tecnico || ""),
            tecnicoCpf: String(responsaveis?.tecnicoCpf || ""),
            auxiliar: String(hasExplicitAuxiliar ? (responsaveis?.auxiliar || "") : (auxiliaresArr[0]?.nome || "")),
            auxiliarCpf: String(hasExplicitAuxiliar ? (responsaveis?.auxiliarCpf || "") : (auxiliaresArr[0]?.cpf || "")),
            auxiliares: auxiliaresArr
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
    ensureDefaultExtra(defaultExtras, "SIDNEY MANOEL DO NASCIMENTO", "099.077.164-48", { funcao: "Técnico", status: "Férias" });
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

        if (Array.isArray(responsaveis.auxiliares)) {
            responsaveis.auxiliares = responsaveis.auxiliares.filter(auxiliar =>
                getFuncionarioKeyFromFields(auxiliar.nome, auxiliar.cpf) !== key
            );
            const first = responsaveis.auxiliares[0];
            if (!responsaveis.auxiliar && first) {
                responsaveis.auxiliar = first.nome || "";
                responsaveis.auxiliarCpf = first.cpf || "";
            }
        }
    });
}

function syncFuncionariosExtrasViaturas() {
    const knownIds = getKnownViaturaIds();

    funcionariosExtras
        .filter(funcionario => funcionario.finalizado && funcionario.viaturaId && knownIds.has(String(funcionario.viaturaId)))
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
            const destinoFoiEsvaziado = Object.prototype.hasOwnProperty.call(destino, fields.campoNome) && !String(destinoNome || "").trim();
            if (destinoFoiEsvaziado) return;
            const destinoLivre = !destinoNome || destinoNome === "Veículo sem Técnico" || destinoKey === key;
            if (!destinoLivre) return;

            clearFuncionarioResponsavel(key);
            destino[fields.campoNome] = funcionario.nome;
            destino[fields.campoCpf] = funcionario.cpf;

            if (fields.campoNome === "auxiliar") {
                if (!Array.isArray(destino.auxiliares)) destino.auxiliares = [];
                const existe = destino.auxiliares.some(auxiliar =>
                    getFuncionarioKeyFromFields(auxiliar.nome, auxiliar.cpf) === key
                );
                if (!existe) destino.auxiliares.push({ nome: funcionario.nome, cpf: funcionario.cpf });
            }
        });
}

function ensureChecklistForAllViaturas() {
    state.viaturas.forEach(viatura => ensureChecklistForViatura(viatura.id));
}

function applyDefaultVehicleInventories() {
    Object.entries(getDefaultChecklistDataByViatura()).forEach(([viaturaId, porCategoria]) => {
        if (!checklistDataByViatura[viaturaId]) checklistDataByViatura[viaturaId] = {};
        Object.entries(porCategoria).forEach(([category, items]) => {
            const atuais = Array.isArray(checklistDataByViatura[viaturaId][category])
                ? checklistDataByViatura[viaturaId][category]
                : [];
            const porNomeAtual = new Map(
                atuais
                    .map((item, index) => resolveChecklistItemData(category, item, viaturaId, index))
                    .filter(item => item.nome)
                    .map(item => [item.nome, item])
            );
            const defaults = items
                .map((item, index) => resolveChecklistItemData(category, item, viaturaId, index))
                .filter(item => item.nome)
                .map(item => porNomeAtual.get(item.nome) || item);
            const defaultNames = new Set(defaults.map(item => item.nome));
            const adicionados = [...porNomeAtual.values()].filter(item => !defaultNames.has(item.nome));

            checklistDataByViatura[viaturaId][category] = [...defaults, ...adicionados];
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

function applySavedConfig(data = {}) {
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
    window.refreshAppAfterConfigChange?.();
}

function isRecoverableConfigError(error) {
    const message = String(error?.message || "");
    return error?.code === "permission-denied"
        || error?.code === "unavailable"
        || /Missing or insufficient permissions|offline|network/i.test(message);
}

function applyLocalConfigFallback(error) {
    console.warn("Usando configurações locais/padrão porque o Firestore não respondeu.", error);
    applySavedConfig({});
}

export async function carregarConfiguracoes() {
    const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);

    try {
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
            applySavedConfig(snapshot.data() || {});
        } else {
            applySavedConfig({});
            await salvarConfiguracoes().catch((error) => {
                if (!isRecoverableConfigError(error)) throw error;
                console.warn("Não foi possível criar o documento de configurações no Firestore.", error);
            });
        }
    } catch (error) {
        if (!isRecoverableConfigError(error)) {
            console.error("Não foi possível carregar configurações do Firestore.", error);
            throw error;
        }
        applyLocalConfigFallback(error);
        return;
    }

    if (!settingsUnsubscribe) {
        settingsUnsubscribe = onSnapshot(ref, (snapshot) => {
            if (snapshot.exists()) {
                applySavedConfig(snapshot.data() || {});
            }
        }, (error) => {
            console.error("Não foi possível sincronizar configurações remotas.", error);
        });
    }
}

function buildConfigPayload(atualizadoEm) {
    const knownIds = getKnownViaturaIds();

    return {
        checklistData: normalizeAllChecklistData(checklistData),
        checklistDataByViatura: Object.fromEntries(
            Object.entries(checklistDataByViatura)
                .filter(([viaturaId]) => knownIds.has(String(viaturaId)))
                .map(([viaturaId, porCategoria]) => [
                    viaturaId,
                    Object.fromEntries(
                        getChecklistCategories().map(category => [
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
                .filter(([viaturaId]) => knownIds.has(String(viaturaId)))
                .map(([viaturaId, responsaveis]) => [
                    viaturaId,
                    {
                        tecnico: responsaveis.tecnico || "",
                        tecnicoCpf: responsaveis.tecnicoCpf || "",
                        auxiliar: responsaveis.auxiliar || "",
                        auxiliarCpf: responsaveis.auxiliarCpf || "",
                        auxiliares: Array.isArray(responsaveis.auxiliares) ? responsaveis.auxiliares.map(a => ({ ...a })) : []
                    }
                ])
        ),
        viaturas: state.viaturas.map(viatura => ({ ...viatura })),
        configHistory: state.configHistory.slice(0, 200),
        atualizadoEm
    };
}

export async function salvarConfiguracoes() {
    const ref = firestoreDoc(db, SETTINGS_COLLECTION, SETTINGS_DOC);

    // Log de diagnóstico antes de tentar salvar
    try {
        console.info('[CONFIG SAVE] tentando salvar configurações — viaturas:', state.viaturas.length, 'funcionariosExtras:', funcionariosExtras.length, 'timestamp_local:', new Date().toISOString());
    } catch (e) {
        console.debug('Erro ao gerar log de save', e);
    }

    try {
        await setDoc(ref, buildConfigPayload(serverTimestamp()), { merge: true });
    } catch (error) {
        console.error('Falha ao salvar configurações no Firestore.', error);
        throw error;
    }
}
