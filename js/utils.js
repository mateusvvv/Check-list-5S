import { categoryNames } from "./config.js";

export function getDataEnvioDate(vistoria) {
    if (!vistoria) return new Date(0);
    if (vistoria.dataEnvio && typeof vistoria.dataEnvio.toDate === "function") {
        return vistoria.dataEnvio.toDate();
    }
    if (vistoria.dataEnvioLocal) {
        return new Date(vistoria.dataEnvioLocal);
    }

    const date = new Date(vistoria.dataEnvio || vistoria.dataVistoria || 0);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function sortVistoriasPorCategoria(vistorias = []) {
    const order = Object.keys(categoryNames);
    return vistorias.sort((a, b) => {
        const viaturaDiff = Number(a.viaturaId || 0) - Number(b.viaturaId || 0);
        if (viaturaDiff !== 0) return viaturaDiff;

        const categoryDiff = order.indexOf(a.categoria) - order.indexOf(b.categoria);
        if (categoryDiff !== 0) return categoryDiff;

        if (a.categoria === "epis" && b.categoria === "epis") {
            const isAuxA = String(a.epiResponsavelTipo || "").toLowerCase().includes("auxiliar");
            const isAuxB = String(b.epiResponsavelTipo || "").toLowerCase().includes("auxiliar");
            if (isAuxA !== isAuxB) return isAuxA ? 1 : -1;
        }

        return getDataEnvioDate(b).getTime() - getDataEnvioDate(a).getTime();
    });
}

export function getInicioFimData(dateValue = new Date()) {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return getInicioFimHoje();
    }

    const inicio = new Date(date);
    inicio.setHours(0, 0, 0, 0);

    const fim = new Date(date);
    fim.setHours(23, 59, 59, 999);

    return { inicio, fim };
}

export function getInicioFimHoje() {
    return getInicioFimData(new Date());
}
