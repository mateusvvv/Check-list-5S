import { categoryNames, defaultViaturas } from "./config.js";

export const state = {
    selectedViatura: "1",
    viaturas: [...defaultViaturas],
    surveyStatus: {},
    epiSurveyStatus: {},
    vehicleDamages: {},
    tabletDamages: {},
    vistoriaMode: {},
    vistoriasLocais: {},
    selectedVistorias: new Set(),
    vistoriasCache: [],
    configHistory: [],
    dadosTemporariosVistoria: null,
    selectedDamageType: "amassado",
    selectedTabletDamageType: "amassado"
};

export function ensureViaturaState(id) {
    id = String(id);
    if (!state.surveyStatus[id]) state.surveyStatus[id] = { ferramentas: false, epis: false, viaturas: false, tablets: false };
    if (!state.epiSurveyStatus[id]) state.epiSurveyStatus[id] = {};
    if (!state.vehicleDamages[id]) state.vehicleDamages[id] = [];
    if (!state.tabletDamages[id]) state.tabletDamages[id] = [];
    if (!state.vistoriaMode[id]) state.vistoriaMode[id] = "completa";
}

defaultViaturas.forEach(viatura => ensureViaturaState(viatura.id));

export function setViaturas(viaturas) {
    const defaultIds = new Set(defaultViaturas.map(viatura => String(viatura.id)));
    const normalized = Array.isArray(viaturas)
        ? viaturas
            .filter(viatura => defaultIds.has(String(viatura.id)))
            .map(viatura => {
        const id = String(viatura.id);
        const genericName = `Viatura ${id.padStart(2, "0")}`;
        const defaultName = defaultViaturas.find(item => item.id === id)?.nome || genericName;
        const savedName = viatura.nome || genericName;

        return {
            id,
            nome: savedName === genericName ? defaultName : savedName,
            ativa: viatura.ativa !== false
        };
    })
        : [];

    state.viaturas = defaultViaturas.map(defaultViatura => {
        const saved = normalized.find(viatura => viatura.id === defaultViatura.id);
        return saved || { ...defaultViatura };
    });

    state.viaturas.forEach(viatura => {
        if (!state.surveyStatus[viatura.id]) ensureViaturaState(viatura.id);
    });

    const selecionada = state.viaturas.find(viatura => viatura.id === state.selectedViatura && viatura.ativa);
    if (!selecionada) {
        state.selectedViatura = getActiveViaturas()[0]?.id || state.viaturas[0]?.id || "1";
    }
}

export function getActiveViaturas() {
    return state.viaturas.filter(viatura => viatura.ativa !== false);
}

export function getViaturaById(id) {
    return state.viaturas.find(viatura => viatura.id === String(id));
}

export function setSelectedViatura(id) {
    state.selectedViatura = String(id);
    if (!state.surveyStatus[state.selectedViatura]) ensureViaturaState(state.selectedViatura);
}

export function getCategoriasConcluidas(viaturaId = state.selectedViatura) {
    const status = state.surveyStatus[viaturaId] || {};
    return Object.keys(categoryNames).filter(category => status[category]);
}

export function isVistoriaParcial(viaturaId = state.selectedViatura) {
    return state.vistoriaMode[viaturaId] === "parcial";
}

export function todasEtapasConcluidas(viaturaId = state.selectedViatura) {
    const status = state.surveyStatus[viaturaId];
    return Boolean(status) && Object.keys(categoryNames).every(category => status[category]);
}

export function salvarVistoriaLocal(vistoria) {
    const viaturaId = String(vistoria.viaturaId);
    if (!state.vistoriasLocais[viaturaId]) state.vistoriasLocais[viaturaId] = {};
    if (vistoria.categoria === "epis") {
        if (!Array.isArray(state.vistoriasLocais[viaturaId].epis)) state.vistoriasLocais[viaturaId].epis = [];
        const pessoaKey = vistoria.epiResponsavelCpf || vistoria.epiResponsavelNome || "sem-responsavel";
        const index = state.vistoriasLocais[viaturaId].epis.findIndex(item =>
            (item.epiResponsavelCpf || item.epiResponsavelNome || "sem-responsavel") === pessoaKey
        );
        if (index >= 0) state.vistoriasLocais[viaturaId].epis[index] = vistoria;
        else state.vistoriasLocais[viaturaId].epis.push(vistoria);
        return;
    }
    state.vistoriasLocais[viaturaId][vistoria.categoria] = vistoria;
}

export function buscarVistoriasLocaisViatura(viaturaId, categorias, sortFn) {
    const porCategoria = state.vistoriasLocais[String(viaturaId)] || {};
    return sortFn(categorias.flatMap(category => {
        const vistoria = porCategoria[category];
        return Array.isArray(vistoria) ? vistoria : (vistoria ? [vistoria] : []);
    }));
}

export function buscarVistoriasLocaisHoje(categorias, sortFn, getInicioFimHoje, getDataEnvioDate) {
    const { inicio, fim } = getInicioFimHoje();
    const dados = [];
    Object.values(state.vistoriasLocais).forEach((porCategoria) => {
        categorias.forEach((category) => {
            const vistoria = porCategoria[category];
            const vistorias = Array.isArray(vistoria) ? vistoria : (vistoria ? [vistoria] : []);
            vistorias.forEach(item => {
                const dataEnvio = getDataEnvioDate(item);
                if (dataEnvio >= inicio && dataEnvio <= fim) dados.push(item);
            });
        });
    });
    return sortFn(dados);
}
