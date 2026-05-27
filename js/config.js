export const checklistData = {
    ferramentas: [
        "Controle de Portão do Estacionamento",
        "Adaptador ethernet TIPO C DELL",
        "Tablet Active 3 Samsung + capa + bolsa",
        "Telefone Gôndola com fio Intelbras TC20 Preto",
        "Power Meter ORIENTEK TPN-35",
        "Optical Power Meter G10",
        "Bolsa para KIT de CONECTOR FAST",
        "Caneta Laser",
        "Clivador de Alta Precisão Aua-S2",
        "Alicate Decapador 3 Furos Cfs-2",
        "Alicate Flat",
        "Estilete Profissional",
        "Multímetro/Teste de Cabo",
        "Pincel Retrátil para Detalhamento",
        "Caneta para Limpeza de Conectores SC",
        "Bolsa para Ferramentas CG460",
        "Alicate de Bico",
        "Alicate de Corte",
        "Alicate de Crimpar",
        "Alicate Universal",
        "Broca de 06mm Concreto Curta",
        "Broca de 08mm Concreto Curta",
        "Broca de 06mm de ferro",
        "Broca de 10mm Concreto Longa",
        "Chave de fenda 1/4 x 4\"",
        "Chave Philips 3/16 x 4\"",
        "Chave de boca 10/11\"",
        "Martelo Nº 20",
        "Ponteira Estrela PH2",
        "Furadeira Elétrica Bosch impacto 850W",
        "Arco de Serra F.G",
        "Baú Madeira Ferramentas (Caixote)",
        "Passa Fio Alma de Aço 15M",
        "Extensão 15 metros cabo PP",
        "Escada 6 Metros",
        "Cinta (catraca) da Escada /6m",
        "Carrinho dobrável para bobina DROP",
        "Escada tesoura cogumelo RF-5",
        "Carretel recolhedor com fita de sinalização",
        "Cone Sinalização Flexível 75cm Laranja e Branco",
        "Garrafa Térmica 5L Cor Azul",
        "Pasta"
    ],
    epis: [
        "Capacete de Segurança Branco",
        "Talabart de Posicionamento",
        "Cinturão de Segurança TAM02",
        "Mosquetão Trava Quedas",
        "Botina de Segurança Nº 41",
        "Luvas Flex Cut",
        "Caneta Detecção de Tensão CAT II 100V Fepro-DT90",
        "Óculos de Segurança",
        "Bolsa EPI CG 445",
        "Pochete Carbografite"
    ],
    viaturas: [
        "Nível de Óleo",
        "Reservatório do líquido de arrefecimento",
        "Pressão dos Pneus",
        "Luzes de Sinalização",
        "Limpeza Interna",
        "Estepe",
        "Macaco",
        "Triângulo"
    ],
    tablets: [
        "Tela",
        "Carcaça",
        "Câmera",
        "Botões físicos",
        "Entrada de carregador",
        "Caneta",
        "Capa de proteção",
        "Carregador",
        "Funcionamento do toque",
        "Aplicativos de trabalho"
    ]
};

export const checklistDataByViatura = {};

export const checklistItemDefaults = {
    ferramentas: {
        "Controle de Portão do Estacionamento": { quantidade: 1, valor: 60 },
        "Tablet Active 3 Samsung + capa + bolsa": { quantidade: 1, valor: 3500 },
        "Telefone Gôndola com fio Intelbras TC20 Preto": { quantidade: 1, valor: 70 },
        "Optical Power Meter G10": { quantidade: 2, valor: 250, observacao: "04/04/2024" },
        "Bolsa para KIT de CONECTOR FAST": { quantidade: 2, valor: 60 },
        "Caneta Laser": { quantidade: 2, valor: 180, observacao: "01/02/2025" },
        "Clivador de Alta Precisão Aua-S2": { quantidade: 2, valor: 600, observacao: "04/04/2024" },
        "Alicate Decapador 3 Furos Cfs-2": { quantidade: 2, valor: 140, observacao: "25/03/2026" },
        "Alicate Flat": { quantidade: 2, valor: 140, observacao: "NOVO 10/04/2026" },
        "Estilete Profissional": { quantidade: 1, valor: 15 },
        "Multímetro/Teste de Cabo": { quantidade: 1, valor: 180, observacao: "01/11/2025" },
        "Pincel Retrátil para Detalhamento": { quantidade: 1, valor: 20 },
        "Caneta para Limpeza de Conectores SC": { quantidade: 2, valor: 120, observacao: "01/11/2025" },
        "Bolsa para Ferramentas CG460": { quantidade: 1, valor: 120 },
        "Alicate de Bico": { quantidade: 1, valor: 31 },
        "Alicate de Corte": { quantidade: 2, valor: 35 },
        "Alicate de Crimpar": { quantidade: 1, valor: 39 },
        "Alicate Universal": { quantidade: 1, valor: 15 },
        "Broca de 06mm Concreto Curta": { quantidade: 1, valor: 7.80 },
        "Broca de 08mm Concreto Curta": { quantidade: 1, valor: 8 },
        "Broca de 06mm de ferro": { quantidade: 1, valor: 6 },
        "Broca de 10mm Concreto Longa": { quantidade: 1, valor: 12.50 },
        "Chave de fenda 1/4 x 4\"": { quantidade: 1, valor: 5 },
        "Chave Philips 3/16 x 4\"": { quantidade: 1, valor: 22, observacao: "NOVA" },
        "Chave de boca 10/11\"": { quantidade: 1, valor: 10 },
        "Martelo Nº 20": { quantidade: 1, valor: 19.50 },
        "Ponteira Estrela PH2": { quantidade: 1, valor: 2.50 },
        "Furadeira Elétrica Bosch impacto 850W": { quantidade: 1, valor: 700 },
        "Arco de Serra F.G": { quantidade: 1, valor: 10.50 },
        "Baú Madeira Ferramentas (Caixote)": { quantidade: 1, valor: 240 },
        "Passa Fio Alma de Aço 15M": { quantidade: 1, valor: 22 },
        "Extensão 15 metros cabo PP": { quantidade: 1, valor: 35 },
        "Escada 6 Metros": { quantidade: 1, valor: 800 },
        "Cinta (catraca) da Escada /6m": { quantidade: 1, valor: 36, observacao: "18/03/2025" },
        "Carrinho dobrável para bobina DROP": { quantidade: 1, valor: 400 },
        "Escada tesoura cogumelo RF-5": { quantidade: 1, valor: 700 },
        "Carretel recolhedor com fita de sinalização": { quantidade: 1, valor: 280 },
        "Cone Sinalização Flexível 75cm Laranja e Branco": { quantidade: 4, valor: 80 },
        "Garrafa Térmica 5L Cor Azul": { quantidade: 1, valor: 40 }
    }
};

export const totalViaturas = 9;
export const defaultViaturas = Array.from({ length: totalViaturas }, (_, index) => {
    const id = String(index + 1);
    return { id, nome: `Viatura ${formatTwoDigits(id)}`, ativa: true };
});
export const categoryNames = { ferramentas: "Ferramentas", epis: "EPIs", viaturas: "Viatura", tablets: "Tablet" };
export const vistoriadoresTablet = ["Matheus", "Italo"];

export const damageTypeNames = {
    amassado: "Amassado",
    arranhao: "Riscado",
    avariado: "Avariado",
    faltante: "Faltante",
    quebrado: "Quebrado",
    trincado: "Faltante",
    sem_caneta: "Faltante"
};

export const vehicleViewNames = {
    frente: "Frente",
    "lateral-esquerda": "Lateral esquerda",
    "lateral-direita": "Lateral direita",
    traseira: "Traseira",
    veiculo: "Mapa visual da viatura"
};

const vehicleMapConfig = {
    default: {
        src: "assets/strada-mapa.png",
        alt: "Vistas lateral, traseira e frontal da Fiat Strada"
    },
    mobi: {
        src: "assets/mobi-mapa.png",
        alt: "Vistas lateral, traseira e frontal do Fiat Mobi"
    }
};

export function getVehicleMapConfig(viaturaId) {
    return [7, 8].includes(Number(viaturaId)) ? vehicleMapConfig.mobi : vehicleMapConfig.default;
}

export function formatTwoDigits(value) {
    return String(value || "").padStart(2, "0");
}

export function getItemName(item) {
    return typeof item === "string" ? item : item?.nome || "";
}

export function getChecklistItemDefaults(category, itemName) {
    return checklistItemDefaults[category]?.[itemName] || { quantidade: 1, valor: 0, observacao: "" };
}

export function normalizeChecklistItem(item, index = 0) {
    if (typeof item === "string") {
        return {
            id: `item-${Date.now()}-${index}`,
            nome: item,
            ativo: true,
            substituicoes: []
        };
    }

    return {
        id: item.id || `item-${Date.now()}-${index}`,
        nome: item.nome || "",
        ativo: item.ativo !== false,
        substituicoes: Array.isArray(item.substituicoes) ? item.substituicoes : []
    };
}

export function cloneChecklistItems(items = []) {
    return items.map((item, index) => {
        const normalized = normalizeChecklistItem(item, index);
        return {
            ...normalized,
            substituicoes: normalized.substituicoes.map(substituicao => ({ ...substituicao }))
        };
    });
}

export function ensureChecklistForViatura(viaturaId) {
    const id = String(viaturaId || "");
    if (!id) return checklistData;

    if (!checklistDataByViatura[id]) checklistDataByViatura[id] = {};
    Object.keys(categoryNames).forEach(category => {
        if (!checklistDataByViatura[id][category]) {
            checklistDataByViatura[id][category] = cloneChecklistItems(checklistData[category]);
        }
    });
    return checklistDataByViatura[id];
}

export function getChecklistItems(category, viaturaId) {
    return ensureChecklistForViatura(viaturaId)[category] || [];
}
