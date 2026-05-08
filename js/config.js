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
        { type: "section", title: "Escada" },
        "Fita da escada",
        "Sapata da escada",
        "Catraca da escada",
        "Corpo da escada",
        { type: "section", title: "Interior" },
        "Bancos",
        "Para-sol esquerdo e direito",
        "Retrovisor interno",
        "Cintos de segurança",
        "Tapetes",
        "Manual do proprietário",
        "Documento (CRLV)",
        { type: "section", title: "Instrumentos" },
        "Instrumentos do painel",
        "Acendedor de cigarros",
        "Volante",
        "Pedais",
        "Alavanca de freio de mão",
        "Alavanca de marchas",
        { type: "section", title: "Motor" },
        "Fluído de freio",
        "Líquido de arrefecimento",
        "Óleo lubrificante do motor",
        "Bateria",
        { type: "section", title: "Porta malas" },
        "Estepe",
        "Macaco",
        "Chave de rodas",
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

export const totalViaturas = 9;
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
