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
    selectedTabletDamageType: "amassado",
    selectedNotebookDamageType: "amassado",
    notebookDamages: {},
    assinaturas: null,
    fotosEvidencia: {}
};

export function ensureViaturaState(id) {
    id = String(id);
    if (!state.surveyStatus[id]) state.surveyStatus[id] = { ferramentas: false, epis: false, viaturas: false, tablets: false, notebooks: false };
    if (!state.epiSurveyStatus[id]) state.epiSurveyStatus[id] = {};
    if (!state.vehicleDamages[id]) state.vehicleDamages[id] = [];
    if (!state.tabletDamages[id]) state.tabletDamages[id] = [];
    if (!state.notebookDamages[id]) state.notebookDamages[id] = [];
    if (!state.vistoriaMode[id]) state.vistoriaMode[id] = "completa";
}

defaultViaturas.forEach(viatura => ensureViaturaState(viatura.id));

export function setViaturas(viaturas) {
    // Garante que temos um array de dados vindos do Firebase
    const savedData = Array.isArray(viaturas) ? viaturas : Object.values(viaturas || {});

    const finalViaturasMap = new Map();

    // 1. Adiciona todas as viaturas do Firebase, priorizando o estado 'ativa'
    savedData.forEach(v => {
        if (v && v.id) {
            finalViaturasMap.set(String(v.id), {
                id: String(v.id),
                nome: v.nome,
                ativa: v.ativa === false ? false : true // Explicitamente verifica se é false
            });
        }
    });
        
    // 2. Adiciona viaturas padrão que não vieram do Firebase (garantindo que todas as viaturas existam)
    defaultViaturas.forEach(dv => {
        if (!finalViaturasMap.has(String(dv.id))) {
            finalViaturasMap.set(String(dv.id), { ...dv, ativa: true }); // Padrão é ativa
        }
    });

    state.viaturas = Array.from(finalViaturasMap.values()).sort((a, b) => Number(a.id) - Number(b.id));

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
    // Vistoria de Notebook e Manuais são independentes e não obrigatórias para o status geral da viatura
    const obrigatorias = ["ferramentas", "epis", "viaturas", "tablets"];
    return Boolean(status) && obrigatorias.every(category => status[category]);
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
            vistorias.forEach(v => {
                const data = getDataEnvioDate(v);
                if (data >= inicio && data <= fim) {
                    dados.push(v);
                }
            });
        });
    });
    return sortFn(dados);
}