import { categoryNames, totalViaturas } from "./config.js";

export const state = {
    selectedViatura: "1",
    surveyStatus: {},
    vehicleDamages: {},
    tabletDamages: {},
    vistoriaMode: {},
    vistoriasLocais: {},
    selectedVistorias: new Set(),
    vistoriasCache: [],
    dadosTemporariosVistoria: null,
    selectedDamageType: "amassado",
    selectedTabletDamageType: "amassado"
};

for (let i = 1; i <= totalViaturas; i++) {
    const id = i.toString();
    state.surveyStatus[id] = { ferramentas: false, epis: false, viaturas: false, tablets: false };
    state.vehicleDamages[id] = [];
    state.tabletDamages[id] = [];
    state.vistoriaMode[id] = "completa";
}

export function setSelectedViatura(id) {
    state.selectedViatura = String(id);
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
    state.vistoriasLocais[viaturaId][vistoria.categoria] = vistoria;
}

export function buscarVistoriasLocaisViatura(viaturaId, categorias, sortFn) {
    const porCategoria = state.vistoriasLocais[String(viaturaId)] || {};
    return sortFn(categorias.map(category => porCategoria[category]).filter(Boolean));
}

export function buscarVistoriasLocaisHoje(categorias, sortFn, getInicioFimHoje, getDataEnvioDate) {
    const { inicio, fim } = getInicioFimHoje();
    const dados = [];
    Object.values(state.vistoriasLocais).forEach((porCategoria) => {
        categorias.forEach((category) => {
            const vistoria = porCategoria[category];
            const dataEnvio = getDataEnvioDate(vistoria);
            if (vistoria && dataEnvio >= inicio && dataEnvio <= fim) {
                dados.push(vistoria);
            }
        });
    });
    return sortFn(dados);
}
