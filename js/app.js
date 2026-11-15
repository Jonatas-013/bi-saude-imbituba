// =========================================================================
// MOTOR DE APLICAÇÃO, PERSISTÊNCIA EM BANCO DE DADOS E REGRAS DE NEGÓCIO
// Hierarquia de Carregamento ao abrir o sistema:
//   1º Banco de Dados Nuvem (Supabase) -> Se configurado em js/config.js
//   2º Banco Local do Navegador (LocalStorage) -> Salva na hora ao subir CSV
//   3º Arquivo Base da Pasta (js/dados_iniciais.js) -> Fallback inicial
// =========================================================================

import { supabase, supabaseAtivo, formatarBRL, normalizarTexto, brToFloat } from './config.js';
import { rawDotacoesReais, auditoriaParadosIniciais, contratosCruzadosIniciais } from './dados_iniciais.js';

const STORAGE_KEYS = {
    DOTACOES: 'bi_saude_imbituba_dotacoes_v2',
    AUDITORIA: 'bi_saude_imbituba_auditoria_v2',
    CONTRATOS: 'bi_saude_imbituba_contratos_v2',
    ULTIMA_ATUALIZACAO: 'bi_saude_imbituba_last_sync_v2',
    CUSTOM_RULES: 'bi_saude_imbituba_custom_rules'
};

let dotacoesDB = [];
let auditoriaParadosDB = [];
let contratosCruzadosDB = [];
let customRulesDB = {};

let chartEvolucaoInstance = null;
let chartFontesInstance = null;
let chartBlocosInstance = null;
let tagPermissaoAtiva = 'TODOS';
let filtroSituacaoContratoAtivo = 'TODOS';

// =========================================================================
// 1. BASE COMPLETA: 65 EMENDAS IMPOSITIVAS (VEREADORES) EXTRAÍDAS DO PDF + PLANILHA
// =========================================================================
export const emendasImpositivas2025 = [
    { num: "004", autor: "BRUNO PACHECO (PSB)", beneficiario: "UBS VILA ALVORADA - AGUADA", pd: "PD 12828/2026", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 1 TV recepção, 1 ar-condicionado sala médico, 1 aquecedor sala preventivo, 1 armário aéreo 3 portas, 2 prateleiras aço inox c/ rodinhas, 1 maca de preventivo, 1 foco de luz, 1 balcão recepção, 2 armários 2 portas sala curativos e mobília (cadeiras).", naoPode: "VEDADO usar para material de consumo descartável, reformas prediais ou folha de pagamento (Natureza exclusiva 4490 - Permanente)." },
    { num: "005", autor: "BRUNO PACHECO (PSB)", beneficiario: "UBS VILA NOVA ALVORADA - DIVINÉIA", pd: "PD 12835/2026", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 1 TV recepção, 1 ar-condicionado sala ACS, 1 computador balcão recepção, 1 maca para ECG, 1 maca ginecológica, 2 focos de luz ginecológicos, 1 mesa auxiliar inox, 1 cadeira de rodas, cadeiras, longarinas e mobília.", naoPode: "VEDADO usar para insumos de consumo, medicamentos, manutenção predial ou serviços PJ (Natureza exclusiva 4490)." },
    { num: "008", autor: "BRUNO PACHECO (PSB)", beneficiario: "PROGRAMA FARMÁCIA SOLIDÁRIA", pd: "PD 12885/2026", valor: 15000.00, acao: "2089", natureza: "4490 (Permanente)", pode: "Aquisição de mobília (armários/estantes/cadeiras/mesas) e equipamentos de informatização (computadores/leitores) para o Programa Farmácia Solidária (Lei 5.298/2022).", naoPode: "VEDADO comprar medicamentos, insumos descartáveis ou pagar pessoal (Natureza exclusiva 4490 - Permanente)." },
    { num: "009", autor: "PEDRO PAULO DA SILVA - PAULO 7 (PSD)", beneficiario: "AMAI (Autistas)", pd: "Termo Colaboração", valor: 242291.57, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de atividades terapêuticas e manutenção/ampliação de equipe multiprofissional na AMAI (meta estimada de 3.457 atendimentos a pessoas com TEA via Termo de Colaboração/Fomento).", naoPode: "VEDADO comprar equipamentos permanentes, móveis, veículos ou realizar obras civis (Natureza exclusiva 3350 - Custeio)." },
    { num: "010", autor: "BRUNO PACHECO (PSB)", beneficiario: "APAE IMBITUBA", pd: "MROSC Capital", valor: 65000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Construção de uma nova sala física para ampliação do Serviço de Estimulação Precoce (crianças de 0 a 6 anos com atraso no desenvolvimento e TEA).", naoPode: "VEDADO usar para folha de pagamento, contas fixas (água/luz) ou material de consumo (Natureza exclusiva 4450 - Capital)." },
    { num: "011", autor: "BRUNO PACHECO (PSB)", beneficiario: "AMAI (Autistas)", pd: "MROSC Custeio", valor: 52800.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Contratação de serviços de profissionais habilitados em Equoterapia para atendimentos terapêuticos especializados a crianças e adolescentes com TEA.", naoPode: "VEDADO adquirir mobiliário, veículos ou realizar obras (Natureza exclusiva 3350 - Custeio)." },
    { num: "012", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "CT EBENEZER", pd: "MROSC Veículo", valor: 100000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de 1 veículo próprio para o Centro Terapêutico Ebenezer (transporte de pacientes às sessões terapêuticas e consultas).", naoPode: "VEDADO usar para combustível, manutenção, alimentação ou folha de pessoal (Natureza exclusiva 4450 - Permanente)." },
    { num: "013", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "FMS - ENFRENTAMENTO À FIBROMIALGIA", pd: "Execução Direta", valor: 82291.57, acao: "2083", natureza: "3390 (Custeio Direto)", pode: "Oferta de Práticas Integrativas e Complementares (PICS) para pacientes com fibromialgia: contratação de profissionais habilitados, oficinas terapêuticas, alongamento, relaxamento e materiais específicos de custeio.", naoPode: "VEDADO comprar equipamentos permanentes ou mobiliário (Natureza 3390) ou desviar da finalidade de atendimento à fibromialgia." },
    { num: "015", autor: "PEDRO PAULO DA SILVA - PAULO 7 (PSD)", beneficiario: "HOSPITAL SÃO CAMILO", pd: "MROSC Hospital", valor: 37291.57, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição e instalação de 45 televisores para os quartos de internação do Hospital São Camilo.", naoPode: "VEDADO usar para custeio hospitalar, medicamentos, plantões ou obras (Natureza exclusiva 4450)." },
    { num: "016", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AIPODEF", pd: "MROSC AIPODEF", valor: 25000.00, acao: "2083", natureza: "4450 (Entidade)", pode: "Aquisição de itens ortopédicos e hospitalares: 5 colchões pneumáticos, 5 colchões caixa de ovo, 3 colchões d'água, 3 camas hospitalares, 3 almofadas gel, 624 fraldas, 8 cx hidrocoloide, 500 sondas, 50 géis, 4 cadeiras de rodas, 4 cadeiras de banho, 14 muletas, 4 andadores e 12 botas ortopédicas.", naoPode: "VEDADO usar para pagamento de salários, aluguel ou despesas administrativas da entidade." },
    { num: "017", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "COMUNIDADE ATIVA (FMS)", pd: "Verificar Dotação", valor: 60000.00, acao: "2082", natureza: "4490 (Permanente)", pode: "Aquisição de 5 motocicletas estilo Honda Biz para deslocamento das equipes técnicas do Programa Comunidade Ativa.", naoPode: "VEDADO usar para combustível, peças de reposição ou custeio (Atenção: Verificar abertura de dotação no IPM!)." },
    { num: "018", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AMAI (Autistas)", pd: "MROSC Aluguel", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio mensal de aluguel do espaço físico da sede da AMAI.", naoPode: "VEDADO usar para compra de equipamentos permanentes ou obras na sede." },
    { num: "019", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AGENTES COMUNITÁRIOS DE SAÚDE (ACS)", pd: "Execução Direta", valor: 50291.57, acao: "2074", natureza: "3390 (Custeio Direto)", pode: "Aquisição de EPIs e insumos de trabalho para os ACS: sombrinhas, viseiras, crachás, camisetas com proteção UV, mochilas, protetor solar, jaquetas corta-vento e folhas coloridas.", naoPode: "VEDADO usar para pagamento de folha/gratificações ou compra de bens permanentes (computadores/móveis/cadeiras)." },
    { num: "021", autor: "HENRIQUE MELO (PP)", beneficiario: "ROTARY CLUBE DE IMBITUBA", pd: "MROSC Rotary", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.650) + 3350 (R$ 6.350)", pode: "Fortalecimento do Banco Ortopédico: R$ 18.650,00 (Ref. 731 - 4450) para cadeiras de rodas e camas hospitalares; R$ 6.350,00 (Ref. 708 - 3350) para fraldas descartáveis, medicamentos e itens de consumo.", pode3350: "Parcela de Custeio (Ref. 708 - 3350 = R$ 6.350,00): Exclusivo para aquisição de fraldas descartáveis, medicamentos e itens de consumo do Banco Ortopédico.", pode4450: "Parcela de Capital (Ref. 731 - 4450 = R$ 18.650,00): Exclusivo para aquisição de cadeiras de rodas e camas hospitalares.", naoPode: "VEDADO misturar os saldos das duas dotações (respeitar o teto de R$ 18,65 mil em permanente e R$ 6,35 mil em consumo)." },
    { num: "023", autor: "BANCADA MDB (RONALDINHO E TEKO)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", pd: "MROSC ILPI", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Substituição de 40 cadeiras do refeitório (adequação à RDC 502/2021) e aquisição de órteses de posicionamento para idosos com sequelas de AVC.", naoPode: "VEDADO usar para alimentação, medicamentos, folha de pessoal ou reformas (Natureza exclusiva 4450)." },
    { num: "025", autor: "BANCADA MDB (RONALDINHO E TEKO)", beneficiario: "AIPODEF", pd: "MROSC AIPODEF", valor: 25020.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de cadeiras de rodas, cadeiras de banho, muletas axilares e canadenses, andadores e botas ortopédicas.", naoPode: "VEDADO usar para custeio administrativo ou folha de pagamento." },
    { num: "028", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", pd: "MROSC Rede Fem.", valor: 25000.00, acao: "2083", natureza: "3350 (R$ 18.000) + 4450 (R$ 7.000)", pode: "Fortalecimento do Espaço Rosa: R$ 18.000,00 (Ref. 709 - 3350) para exames preventivos, alimentação saudável às pacientes e manutenção; R$ 7.000,00 (Ref. 734 - 4450) para aquisição de equipamentos permanentes.", pode3350: "Parcela de Custeio (Ref. 709 - 3350 = R$ 18.000,00): Exames preventivos, alimentação saudável às pacientes e manutenção da sede.", pode4450: "Parcela de Capital (Ref. 734 - 4450 = R$ 7.000,00): Aquisição de equipamentos e materiais permanentes para o Espaço Rosa.", naoPode: "VEDADO usar a parcela de R$ 18 mil para comprar equipamentos ou a parcela de R$ 7 mil para alimentos/exames." },
    { num: "029", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "UBS VILA NOVA ALVORADA", pd: "Execução Direta", valor: 10500.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 2 macas ginecológicas, 2 focos de luz, 3 longarinas, 10 cadeiras fixas, 5 cadeiras giratórias, 1 ar-condicionado 12.000 BTUs e 1 TV Smart 50\".", naoPode: "VEDADO usar para reformas prediais, pintura, insumos ou medicamentos (Natureza exclusiva 4490)." },
    { num: "030", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "AMAI (Autistas)", pd: "MROSC Equoterapia", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Contratação de serviços de Equoterapia (meta de 227 atendimentos semanais conduzidos por equipe especializada para crianças e adolescentes com TEA).", naoPode: "VEDADO adquirir equipamentos permanentes, móveis ou obras." },
    { num: "031", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "ROTARY CLUBE DE IMBITUBA", pd: "MROSC Rotary", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos e materiais permanentes para projetos sociais e comunitários de saúde preventiva do Rotary Club.", naoPode: "VEDADO usar para custeio, serviços de terceiros ou folha (Natureza 4450)." },
    { num: "032", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "TFD (Fundo Municipal de Saúde)", pd: "Aquisição Veículo", valor: 107900.00, acao: "2084", natureza: "4471 / 4490 (Permanente)", pode: "Aquisição de 1 veículo Fiat Pulse 2025 1.3 Flex Drive Manual (5 lugares) para uso exclusivo no transporte de pacientes do TFD.", naoPode: "VEDADO usar para combustível, manutenção de frota ou diárias." },
    { num: "033", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "MAC - SERVIÇO DE PILATES SUS", pd: "Execução Direta", valor: 23500.00, acao: "2083", natureza: "3390 (Custeio Direto)", pode: "Contratação de profissionais qualificados para implantar e oferecer sessões regulares de Pilates na Atenção à Saúde (reabilitação física e dores crônicas).", naoPode: "VEDADO comprar equipamentos permanentes ou mobiliário (Natureza 3390)." },
    { num: "047", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", pd: "Aquisição Veículo", valor: 85000.00, acao: "2083", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo automotor popular 0km (motor 1.0, bicombustível, direção elétrica e ar-condicionado) para uso exclusivo do CEREM.", naoPode: "VEDADO usar para custeio, combustível, exames ou reformas." },
    { num: "048", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", pd: "Equipamento CEREM", valor: 12480.00, acao: "2083", natureza: "4490 (Permanente)", pode: "Aquisição de 1 Aparelho de Eletrocautério (Bisturi Eletrônico) com sugador para realização de cauterizações e CAF no CEREM.", naoPode: "VEDADO usar para insumos descartáveis ou outros serviços (Natureza 4490)." },
    { num: "049", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", pd: "CISAMUREL Exames", valor: 74543.14, acao: "2083", natureza: "3371 (Consórcio)", pode: "Aquisição de 654 exames de saúde da mulher via consórcio: 380 ultrassonografias transvaginais (R$ 33.440,00) e 274 ultrassonografias pélvicas (R$ 41.103,14).", naoPode: "VEDADO usar para compra de aparelhos de ultrassom ou outros tipos de exames fora do objeto." },
    { num: "050", autor: "ELÍSIO SGROTT (PP)", beneficiario: "TFD (Secretaria de Saúde)", pd: "Aquisição Veículo", valor: 100000.00, acao: "2084", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo automotor 0km (bicombustível, 5 marchas, direção elétrica e ar-condicionado) para transporte de pacientes do TFD.", naoPode: "VEDADO usar para manutenção de veículos, combustível ou diárias." },
    { num: "066", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", pd: "MROSC Despertar", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos de sonorização, instrumentos musicais, equipamentos de informática e aparelhos de ar-condicionado para as salas de música da instituição.", naoPode: "VEDADO usar para pagamento de professores/oficineiros, alimentos ou contas de consumo (Natureza 4450)." },
    { num: "067", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "FMS - EXAMES MAC", pd: "CISAMUREL Exames", valor: 75000.00, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de média e alta complexidade via consórcio: ultrassonografias, tomografias, ressonâncias magnéticas, endoscopias e colonoscopias.", naoPode: "VEDADO comprar equipamentos médicos ou pagar folha." },
    { num: "071", autor: "BRUNO PACHECO (PSB)", beneficiario: "CT EBENEZER", pd: "MROSC Ebenezer", valor: 26000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio operacional da Comunidade Terapêutica Ebenezer: materiais de escritório, alimentação, gás, expediente, limpeza, higiene pessoal, energia elétrica, contabilidade, telefonia e manutenção predial.", naoPode: "VEDADO adquirir veículos, móveis ou equipamentos permanentes (Natureza 3350)." },
    { num: "073", autor: "BANCADA PSB (BRUNO PACHECO E HUMBERTO)", beneficiario: "ROTARY CLUBE DE IMBITUBA", pd: "MROSC Rotary", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.650) + 3350 (R$ 6.350)", pode: "Fortalecimento do Banco Ortopédico: R$ 18.650,00 (Ref. 737 - 4450) para cadeiras de rodas e camas hospitalares; R$ 6.350,00 (Ref. 712 - 3350) para fraldas, medicamentos e itens de consumo.", pode3350: "Parcela de Custeio (Ref. 712 - 3350 = R$ 6.350,00): Aquisição de fraldas, medicamentos e itens de consumo do Banco Ortopédico.", pode4450: "Parcela de Capital (Ref. 737 - 4450 = R$ 18.650,00): Aquisição de cadeiras de rodas e camas hospitalares.", naoPode: "VEDADO inverter as naturezas de despesa entre permanente (4450) e custeio (3350)." },
    { num: "075", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "ESF BOA VISTA E UBS ROÇA GRANDE", pd: "Manutenção UBS", valor: 50000.00, acao: "1020", natureza: "4490 (Permanente/Obras)", pode: "Aquisição e instalação de 2 toldos de cobertura externa e obras/melhorias estruturais nos Postos de Saúde da Boa Vista e da Roça Grande.", naoPode: "VEDADO usar para insumos médicos ou folha de pagamento." },
    { num: "076", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "APAE IMBITUBA", pd: "MROSC APAE", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos elétricos e luminosos para 4 salas clínicas: climatização (ar-condicionado), computadores, luminárias, painéis de LED, displays interativos, som e conectividade.", naoPode: "VEDADO usar para folha de pagamento ou material de expediente (Natureza 4450)." },
    { num: "077", autor: "MATHEUS PALADINI PEREIRA (PSD)", beneficiario: "SECRETARIA DE SAÚDE (FMS)", pd: "Ambulância Tipo A", valor: 242292.00, acao: "2083", natureza: "4471 / 4490 (Permanente)", pode: "Aquisição de 1 Ambulância Tipo A (Remoção Simples) para transporte e transferência de pacientes entre unidades.", naoPode: "VEDADO usar para combustível, manutenção ou custeio geral." },
    { num: "079", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "AMAI (Autistas)", pd: "MROSC Equoterapia", valor: 52800.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Compra de 240 atendimentos em Equoterapia para crianças com TEA atendidas pela AMAI.", naoPode: "VEDADO comprar equipamentos permanentes ou realizar obras." },
    { num: "082", autor: "BRUNO PACHECO (PSB)", beneficiario: "APAE IMBITUBA", pd: "MROSC Acolhimento", valor: 100000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de programa de acolhimento, suporte psicossocial e orientação técnica às famílias de crianças encaminhadas via SISREG que aguardam vaga na APAE.", naoPode: "VEDADO usar para obras de construção civil ou compra de veículos (Natureza 3350)." },
    { num: "085", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "SAMU 192 IMBITUBA", pd: "Equipamento SAMU", valor: 56000.00, acao: "2086", natureza: "4490 (Permanente)", pode: "Aquisição de 1 sistema de compressão torácica automática portátil modelo E6 CPR para reanimação cardiopulmonar no SAMU.", naoPode: "VEDADO usar para manutenção da ambulância, combustível ou medicamentos." },
    { num: "086", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "APAE IMBITUBA", pd: "MROSC Sala APAE", valor: 65000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Construção de uma nova sala física destinada ao serviço de Estimulação Precoce (0 a 6 anos) da APAE.", naoPode: "VEDADO usar para pagamento de salários ou despesas de custeio." },
    { num: "087", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "AMAI (Autistas)", pd: "MROSC Manutenção", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Manutenção operacional da AMAI: custeio de atendimentos especializados, aluguel, materiais essenciais e encargos de funcionamento.", naoPode: "VEDADO usar para obras civis ou compra de veículos (Natureza 3350)." },
    { num: "088", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", pd: "MROSC ILPI", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.000) + 3350 (R$ 7.000)", pode: "R$ 18.000,00 (Ref. 740 - 4450) para computadores, impressora e balança para cadeirantes; R$ 7.000,00 (Ref. 716 - 3350) para materiais de atividades físicas dos idosos.", pode3350: "Parcela de Custeio (Ref. 716 - 3350 = R$ 7.000,00): Materiais de consumo para atividades físicas e recreativas dos idosos.", pode4450: "Parcela de Capital (Ref. 740 - 4450 = R$ 18.000,00): Aquisição de computadores, impressora e balança para cadeirantes.", naoPode: "VEDADO misturar as naturezas (respeitar R$ 18 mil em equipamentos permanentes e R$ 7 mil em materiais de custeio)." },
    { num: "090", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "FMS - EXAMES DE ULTRASSONOGRAFIA", pd: "CISAMUREL Exames", valor: 77291.57, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de ultrassonografia via consórcio público para redução de filas na rede municipal.", naoPode: "VEDADO comprar aparelho de ultrassom ou pagar médicos fora do consórcio." },
    { num: "093", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "TFD (Fundo Municipal de Saúde)", pd: "Aquisição Veículo", valor: 115000.00, acao: "2084", natureza: "4471 / 4490 (Permanente)", pode: "Aquisição de 1 veículo Fiat Pulse 2025 1.3 Flex Drive Manual (5 lugares) de uso exclusivo do TFD.", naoPode: "VEDADO usar para combustível ou manutenção." },
    { num: "099", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", pd: "MROSC Rede Fem.", valor: 25000.00, acao: "2083", natureza: "3350 (R$ 17.700) + 4450 (R$ 7.300)", pode: "Espaço Rosa: R$ 17.700,00 (Ref. 717 - 3350) para auxílio alimentação às mulheres atendidas e exames preventivos; R$ 7.300,00 (Ref. 741 - 4450) para aquisição de equipamentos permanentes.", pode3350: "Parcela de Custeio (Ref. 717 - 3350 = R$ 17.700,00): Auxílio alimentação às mulheres atendidas e realização de exames preventivos.", pode4450: "Parcela de Capital (Ref. 741 - 4450 = R$ 7.300,00): Aquisição de equipamentos permanentes para o Espaço Rosa.", naoPode: "VEDADO inverter os valores entre custeio (R$ 17,7 mil) e equipamentos (R$ 7,3 mil)." },
    { num: "102", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", pd: "MROSC Mobiliário", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de mobiliário (mesas, cadeiras, armários) destinado à sala de atendimento médico da instituição Despertar Jovem.", naoPode: "VEDADO usar para alimentação, contas fixas ou pagamento de pessoal (Natureza 4450)." },
    { num: "104", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "UBS BAIRRO SÃO TOMÁS", pd: "Climatização UBS", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Compra e instalação de aparelhos condicionadores de ar no Posto de Saúde do Bairro São Tomás.", naoPode: "VEDADO usar para reformas civis ou material de consumo." },
    { num: "105", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "NOVA UBS BAIRRO GUAIÚBA", pd: "Móveis Sob Medida", valor: 122291.57, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de móveis sob medida (armários, bancadas, mobiliário) para equipar a nova Unidade Básica de Saúde em construção no Bairro Guaiúba.", naoPode: "VEDADO usar para obras civis da construção ou material médico descartável." },
    { num: "116", autor: "DARLAN BACK (PL)", beneficiario: "APAE IMBITUBA", pd: "MROSC Equip. APAE", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de mobiliários (mesas, cadeiras, armários), brinquedos pedagógicos, materiais permanentes e equipamentos terapêuticos para estruturar as novas salas de Estimulação Precoce da APAE.", naoPode: "VEDADO usar para folha de pagamento ou custeio mensal (Natureza 4450)." },
    { num: "119", autor: "DARLAN BACK (PL)", beneficiario: "UBS SAMBAQUI", pd: "Manutenção Predial", valor: 32000.00, acao: "1020", natureza: "3390 (Custeio - Manutenção)", pode: "Manutenção predial da UBS Sambaqui: pintura interna e externa, pequenos reparos estruturais e correções nas instalações elétricas e hidráulicas.", naoPode: "VEDADO comprar mobiliário, cadeiras ou equipamentos permanentes (Natureza 3390)." },
    { num: "120", autor: "DARLAN BACK (PL)", beneficiario: "ASSOCIAÇÃO BENEFICENTE EBENEZER", pd: "MROSC Telhado", valor: 40000.00, acao: "2083", natureza: "3350 (Entidade)", pode: "Reestruturação e reparo completo do telhado da sede do Centro Terapêutico Ebenezer (eliminação de infiltrações e desgaste estrutural).", naoPode: "VEDADO usar para compra de veículos ou despesas fora da manutenção da cobertura/sede." },
    { num: "121", autor: "DARLAN BACK (PL)", beneficiario: "CAAPONCI (Pacientes Oncológicos)", pd: "MROSC CAAPONCI", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Implantação da 1ª sede física da CAAPONCI: custeio do aluguel do imóvel e aquisição de insumos (materiais de consumo, gaze, gase, luvas, enfermagem e expediente administrativo).", naoPode: "VEDADO comprar equipamentos permanentes, móveis ou realizar obras civis em imóvel locado (Natureza 3350)." },
    { num: "123", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "NOVA UBS BAIRRO GUAIÚBA", pd: "Mobiliário Guaiúba", valor: 100000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de mobiliário completo (cadeiras, mesas, armários, longarinas) para consultórios, recepção, salas de procedimentos e setores administrativos da nova UBS Guaiúba.", naoPode: "VEDADO usar para material de consumo ou serviços de terceiros (Natureza 4490)." },
    { num: "126", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "COMUNIDADE ATIVA (FMS)", pd: "Verificar Dotação", valor: 92000.00, acao: "2082", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo Fiat Argo Trekking 1.3 (ano 2026) alocado às visitas e ações da Comunidade Ativa.", naoPode: "VEDADO usar para combustível ou custeio (Atenção: Verificar abertura de dotação no IPM!)." },
    { num: "133", autor: "BANCADA PL (EDUARDO, DARLAN, MATHEUS, RAFAEL)", beneficiario: "SAÚDE BUCAL (FMS)", pd: "Odonto + Escolas", valor: 70000.00, acao: "2076", natureza: "4490 (Permanente)", pode: "Aquisição de equipamentos para consultório odontológico (cadeira odontológica, equipo, compressor) e equipamentos audiovisuais para o projeto 'Saúde Bucal nas Escolas'.", naoPode: "VEDADO usar para insumos odontológicos descartáveis ou folha (Natureza 4490)." },
    { num: "136", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "UBSs PAES LEME, CENTRO, VILA NOVA E VILA ALVORADA", pd: "4 Aparelhos ECG", valor: 17200.00, acao: "1020", natureza: "4471 / 4490 (Permanente)", pode: "Aquisição de 4 aparelhos Eletrocardiógrafos para realização de exames cardíacos nas UBSs Paes Leme, Centro, Vila Nova e Vila Alvorada.", naoPode: "VEDADO usar para laudos/serviços ou insumos de consumo." },
    { num: "141", autor: "BANCADA PSB (HUMBERTO E BRUNO PACHECO)", beneficiario: "FMS - EXAMES DE COLONOSCOPIA", pd: "CISAMUREL Exames", valor: 7291.57, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de colonoscopia via consórcio público para detecção precoce de doenças colorretais.", naoPode: "VEDADO usar para outros exames fora do plano ou compra de equipamentos." },
    { num: "144", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "AMAI (Autistas)", pd: "MROSC Custeio", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio operacional da AMAI: pagamento parcial de profissionais terapêuticos, aluguel, energia, água, internet, FGTS/INSS, secretária e materiais pedagógicos/higiene/limpeza.", naoPode: "VEDADO usar para compra de veículos, obras, móveis ou equipamentos permanentes (Natureza 3350)." },
    { num: "146", autor: "BANCADA PSB (HUMBERTO E BRUNO PACHECO)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", pd: "MROSC Rede Fem.", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 23.000) + 3350 (R$ 2.000)", pode: "Espaço Rosa: R$ 23.000,00 (Ref. 744 - 4450) para 1 projetor Epson E20, 1 TV LED 75\" LG 4K, 1 porta de vidro e 6 cortinas; R$ 2.000,00 (Ref. 721 - 3350) para serviço de contabilidade.", pode3350: "Parcela de Custeio (Ref. 721 - 3350 = R$ 2.000,00): Exclusivo para serviço de contabilidade de suporte administrativo.", pode4450: "Parcela de Capital (Ref. 744 - 4450 = R$ 23.000,00): 1 projetor multimídia Epson E20, 1 TV LED 75\" LG 4K, 1 porta de vidro e 6 cortinas.", naoPode: "VEDADO usar os R$ 23 mil de capital para custeio ou os R$ 2 mil de custeio para equipamentos." },
    { num: "147", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", pd: "MROSC ILPI", valor: 50000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de 33 colchões pneumáticos, carrinho medidor hospitalar, monitor de triagem, oxímetro de pulso, porta-soro inox e capas impermeáveis.", naoPode: "VEDADO usar para folha de pagamento, alimentação ou aluguel." },
    { num: "148", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "UBS BAIRRO SÃO TOMÁS", pd: "Reforma São Tomás", valor: 60000.00, acao: "1020", natureza: "3390 (Custeio - Reforma)", pode: "Serviços de reforma e manutenção predial no Posto de Saúde do Bairro São Tomás: troca de pisos, pintura e recuperação do telhado.", naoPode: "VEDADO comprar mobiliário, cadeiras ou equipamentos permanentes (Natureza 3390)." },
    { num: "150", autor: "DARLAN BACK (PL)", beneficiario: "UBS VILA SANTO ANTÔNIO", pd: "Consultório Odonto", valor: 110000.00, acao: "2076", natureza: "4490 (Permanente)", pode: "Implantação de sala odontológica completa na UBS Vila Santo Antônio: cadeira odontológica, equipo, refletor, mocho, compressor e instrumentais permanentes.", naoPode: "VEDADO usar para pagamento de dentista ou material descartável (Natureza 4490)." },
    { num: "155", autor: "MATHEUS PALADINI PEREIRA (PSD)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", pd: "MROSC Energia Solar", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 22.002,71) + 3350 (R$ 2.997,29)", pode: "R$ 22.002,71 (Ref. 746 - 4450) para painéis de energia solar, 1 ar-condicionado 9.000 BTUs, 1 balcão passa-prato, 1 bebedouro, 1 aspirador WAP, 4 cadeiras giratórias e 20 cadeiras empilháveis; R$ 2.997,29 (Ref. 722 - 3350) para louças, panelas, garrafas térmicas e utensílios.", pode3350: "Parcela de Custeio (Ref. 722 - 3350 = R$ 2.997,29): 30 pratos, 30 xícaras, talheres, 30 copos, 2 panelas, 2 leiteiras, 3 garrafas térmicas e 3 bandejas.", pode4450: "Parcela de Capital (Ref. 746 - 4450 = R$ 22.002,71): Painéis de energia solar, 1 ar-condicionado 9.000 BTUs, 1 balcão passa-prato, 1 bebedouro, 1 aspirador WAP, 4 cadeiras giratórias de secretária e 20 cadeiras empilháveis.", naoPode: "VEDADO misturar as dotações de investimento (4450) e custeio (3350)." },
    { num: "156", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "AMAI (Autistas)", pd: "MROSC Multiprof.", valor: 50291.57, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de atendimento multiprofissional na AMAI: pagamento parcial de profissionais (plantões/horas/terceirizados), materiais terapêuticos/pedagógicos e pequenos insumos operacionais.", naoPode: "VEDADO adquirir bens permanentes, móveis, veículos ou realizar obras (Natureza 3350)." },
    { num: "163", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", pd: "MROSC Piso Cerâmico", valor: 50000.00, acao: "2083", natureza: "3350 (Entidade)", pode: "Melhoria estrutural do espaço terapêutico: compra e instalação de 852 m² de piso cerâmico, 167 sacas de argamassa, 42 kg de rejunte, 4.000 niveladores, 2.000 cunhas e mão de obra de colocação.", naoPode: "VEDADO usar para outras despesas administrativas fora da colocação do piso cerâmico." },
    { num: "165", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "UBS PAES LEME", pd: "Equip. Paes Leme", valor: 29091.57, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de equipamentos administrativos (computadores e impressora) e médicos (oxímetros e cuba ultrassônica) para a UBS Paes Leme.", naoPode: "VEDADO usar para reformas, material de consumo ou folha (Natureza 4490)." },
    { num: "167", autor: "DARLAN BACK (PL)", beneficiario: "ORIALAN", pd: "MROSC Orialan", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 20.000) + 3350 (R$ 5.000)", pode: "R$ 20.000,00 (Ref. 747 - 4450) para aquisição de móveis novos (camas, colchões, armários, mesas e cadeiras); R$ 5.000,00 (Ref. 725 - 3350) para itens de rouparia/enxoval (lençóis, fronhas e cobertores).", pode3350: "Parcela de Custeio (Ref. 725 - 3350 = R$ 5.000,00): Aquisição exclusiva de itens de rouparia e enxoval (lençóis, fronhas e cobertores).", pode4450: "Parcela de Capital (Ref. 747 - 4450 = R$ 20.000,00): Aquisição de móveis novos (camas, colchões, armários, mesas e cadeiras).", naoPode: "VEDADO usar os R$ 20 mil de móveis para rouparia ou os R$ 5 mil de rouparia para equipamentos." },
    { num: "174", autor: "HENRIQUE MELO (PP)", beneficiario: "HOSPITAL SÃO CAMILO", pd: "MROSC São Camilo", valor: 217291.57, acao: "2083", natureza: "4450 (R$ 107.750) + 3350 (R$ 109.541,57)", pode: "R$ 107.750,00 (Ref. 748 - 4450) para compra e instalação de aparelhos de ar-condicionado, poltronas hospitalares e cadeiras administrativas; R$ 109.541,57 (Ref. 726 - 3350) para execução de reformas internas de conforto, higiene e vigilância sanitária.", pode3350: "Parcela de Custeio/Reforma (Ref. 726 - 3350 = R$ 109.541,57): Execução de reformas internas de conforto, higiene e normas de vigilância sanitária.", pode4450: "Parcela de Capital/Equipamentos (Ref. 748 - 4450 = R$ 107.750,00): Aquisição de aparelhos de ar-condicionado, poltronas hospitalares e cadeiras administrativas.", naoPode: "VEDADO usar a parcela de equipamentos (4450) para serviços de reforma (3350) e vice-versa." }
];

// =========================================================================
// 2. MAPEAMENTO ESPECÍFICO POR REF (EXTRAÍDO DE Emendas_Parlamentares_Aplicação.xlsx)
// =========================================================================
export const regrasPlanilhaPorRef = {
    510: {
        parlamentar: "Bancada Obrigatória (Emenda 71260002)",
        pode: "Navegação do Cuidado / Fortalecimento da Atenção Primária: Sistemas de TI, prontuário eletrônico e suporte tecnológico (IPM / Inovadora Sistemas). Valor: R$ 222.386,00.",
        naoPode: "VEDADO usar para compra de veículos, mobiliário/cadeiras, obras civis ou folha de pagamento."
    },
    511: {
        parlamentar: "Deputado Beto Martins (Incremento Temporário APS)",
        pode: "Custeio de ações da Atenção Primária: insumos ambulatoriais (gaze, gase, seringas, agulhas, luvas, esparadrapo, curativos) e serviços de apoio à APS.",
        naoPode: "VEDADO adquirir equipamentos permanentes/móveis/cadeiras (4490) ou pagar folha."
    },
    512: {
        parlamentar: "Comissão de Saúde (Emenda 50410001 - CEREM)",
        pode: "Exclusivo CEREM (Saúde da Mulher - R$ 250.000,00): Material de consumo clínico e ginecológico (espéculos vaginais, pinças, luvas de procedimento, gaze, gase, algodão, seringas, agulhas, anticoncepcionais, DIU, Implanon, cartilhas e folders educativos).",
        naoPode: "VEDADO usar para equipamentos permanentes/móveis (4490), obras ou folha de pagamento."
    },
    513: {
        parlamentar: "Deputado Gilson Marques (Emenda 90550006 - MAC)",
        pode: "Custeio MAC (Média e Alta Complexidade - R$ 180.000,00): Custeio operacional, insumos de média complexidade e combustível/apoio logístico vinculado aos serviços MAC.",
        naoPode: "VEDADO comprar veículos novos, móveis ou equipamentos permanentes (4490)."
    },
    514: {
        parlamentar: "Deputada Julia Zanatta (Emenda 44010001 - Parte 1)",
        pode: "Plano de Trabalho Aprovado: 1) Materiais leves p/ práticas corporais (elásticos, colchonetes, esfigmomanômetro, balança, cronômetros - R$ 50k); 2) Insumos clínicos Saúde da Mulher e Material Odontológico de consumo, gaze, gase, luvas, seringas, resinas, anestésicos (R$ 200k); 3) Insumos de busca ativa vacinal e condições crônicas (R$ 100k); 4) Anticoncepcionais e DIU (R$ 50k).",
        naoPode: "VEDADO comprar equipamentos permanentes de capital, cadeiras ou mobiliário (4490) ou pagar pessoal."
    },
    515: {
        parlamentar: "Deputada Julia Zanatta (Emenda 44010001 - Telessaúde)",
        pode: "Apoio Digital à Qualificação do Cuidado na APS (R$ 120.000,00): Implantação e qualificação de serviços de Telessaúde, Teleconsultoria, Telediagnóstico, Teleducação e Telepsicologia.",
        naoPode: "VEDADO comprar mobiliário, cadeiras ou realizar obras."
    },
    516: {
        parlamentar: "Deputada Julia Zanatta (Emenda 44010001 - Serviços APS)",
        pode: "Fortalecimento da Atenção Primária (R$ 590.783,43): Ações de envelhecimento ativo e saúde do idoso (R$ 100k), busca ativa vacinal e campanhas de comunicação (R$ 130k), rastreamento de condições crônicas (R$ 100k), navegação do cuidado (R$ 100k) e apoio logístico domiciliar/CRAS/escolas (R$ 50k) + insumos clínicos.",
        naoPode: "VEDADO usar para folha de pagamento, compra de móveis/cadeiras ou obras civis."
    },
    518: {
        parlamentar: "Deputado Daniel Freitas (Emenda 39490003 - Navegação e Logística)",
        pode: "Navegação do Cuidado e Apoio Logístico APS (R$ 414.463,79): Combustível e apoio logístico para transporte intermunicipal de pacientes acompanhados pela APS (R$ 200k), atividades de fortalecimento da APS e insumos clínicos (luvas, seringas, gaze, gase, algodão, curativos - R$ 200k).",
        naoPode: "VEDADO adquirir veículos, móveis/cadeiras ou bens permanentes de capital (4490)."
    },
    519: {
        parlamentar: "Deputado Daniel Freitas (Emenda 39490003 - PSE e Educação)",
        pode: "Ambientes Saudáveis e Educação em Saúde (R$ 300.000,00): 1) Ações educativas em escolas (PSE), feiras, praças e UBS com distribuição de materiais gráficos (R$ 100k); 2) Capacitação dos profissionais da APS em promoção da saúde e educação alimentar/nutricional (R$ 200k).",
        naoPode: "VEDADO usar para equipamentos permanentes, móveis ou despesas fora de educação/promoção nutricional."
    },
    520: {
        parlamentar: "Deputado Daniel Freitas (Emenda 39490003 - Suporte Digital)",
        pode: "Apoio Digital na APS (R$ 300.000,00): 1) Aquisição de pequenos acessórios de suporte de TI classificados como CUSTEIO e não capital: cabos, microfones, webcams/câmeras, fones, teclados, mouses, tripés (R$ 200k); 2) Impressão de cartilhas e manuais de apoio ao uso de tecnologias por idosos (R$ 100k).",
        naoPode: "VEDADO comprar computadores/notebooks ou móveis permanentes (que exigem natureza 4490 de capital)."
    },
    534: {
        parlamentar: "Deputada Caroline de Toni (Emenda 39320002 - Busca Ativa)",
        pode: "Estratégia de Busca Ativa p/ Vacinação (R$ 150.000,00): Apoio logístico para visitas domiciliares — Combustível, manutenção de veículos da APS e aquisição de kits para visitas domiciliares.",
        naoPode: "VEDADO comprar veículos novos, móveis ou equipamentos permanentes."
    },
    535: {
        parlamentar: "Deputada Caroline de Toni (Emenda 39320002 - Manutenção Equip.)",
        pode: "Qualificação do Cuidado na APS (R$ 200.000,00): Manutenção preventiva e corretiva e conservação de equipamentos já existentes nas UBSs (incluindo manutenção de Equipamento Odontológico e de informática).",
        naoPode: "VEDADO adquirir equipamentos ou móveis novos (exclusivo para manutenção e conservação)."
    },
    536: {
        parlamentar: "Deputada Julia Zanatta (Emenda 44010001 - 2026 Idoso)",
        pode: "Apoio a Políticas de Atenção ao Envelhecimento e Saúde da Pessoa Idosa (R$ 200.000,00): Atividades e serviços PJ para fortalecimento do cuidado multidimensional ao idoso na APS.",
        naoPode: "VEDADO usar para obras ou compra de equipamentos/móveis permanentes."
    },
    537: {
        parlamentar: "Deputada Julia Zanatta (Emenda 44010001 - 2026 Mulher/CEREM)",
        pode: "Atenção Integral à Saúde da Mulher (R$ 200.000,00): Manutenção preventiva e corretiva e conservação de equipamentos já existentes nas UBSs e manutenção de equipamentos do CEREM.",
        naoPode: "VEDADO comprar equipamentos ou móveis novos de capital (4490)."
    },
    538: {
        parlamentar: "Deputado Jorge Goetten (Emenda 42090006 - Manutenção UBS)",
        pode: "Busca Ativa Vacinal e Controle de Doenças Transmissíveis (R$ 350.000,00): Manutenção predial das Unidades Básicas de Saúde e manutenção preventiva/corretiva de equipamentos (refrigeradores de vacina, rede elétrica e climatização).",
        naoPode: "VEDADO usar para folha de pagamento ou compra de bens permanentes/mobiliário."
    },
    545: {
        parlamentar: "Bancada Obrigatória (Emenda 71260002 - Saúde da Mulher)",
        pode: "Atenção Integral à Saúde da Mulher (R$ 100.000,00): Aquisição de materiais e insumos clínicos para atendimento ginecológico/pré-natal (gaze, gase, seringas, luvas, espéculos, testes rápidos) e ações de promoção da saúde.",
        naoPode: "VEDADO usar para obras ou equipamentos/móveis permanentes."
    },
    546: {
        parlamentar: "Bancada Obrigatória (Emenda 71260002 - Prevenção e Pesquisa)",
        pode: "Rastreamento de Condições Crônicas (R$ 200.000,00): 1) Campanhas educativas e materiais impressos de prevenção de condições crônicas (R$ 100k); 2) Fomento à pesquisa e extensão no âmbito da APS / Auxílio a estudantes (R$ 100k).",
        naoPode: "VEDADO desviar os tetos de R$ 100k de material de consumo e R$ 100k de auxílio estudante."
    },
    778: {
        parlamentar: "Bancada Obrigatória (Emenda 71260002 - Consórcio Crônicas)",
        pode: "Rastreamento e Controle de Condições Crônicas via Consórcio (R$ 100.000,00): Transferência ao Consórcio CISAMUREL para exames e consultas especializadas da Atenção Primária.",
        naoPode: "VEDADO usar fora do contrato de rateio do Consórcio Público."
    },
    779: {
        parlamentar: "Bancada Obrigatória (Emenda 71260002 - Consórcio Navegação)",
        pode: "Instrumentos de Navegação do Cuidado via Consórcio (R$ 100.000,00): Execução delegada ao Consórcio Público para fortalecimento e regulação da Atenção Primária.",
        naoPode: "VEDADO usar para contratações diretas fora do Consórcio."
    }
};

// =========================================================================
// 3. BASE COMPLETA: 24 PROPOSTAS FEDERAIS DO FNS (EXTRAÍDAS DO PDF)
// =========================================================================
export const propostasFNSReais = [
    { ano: 2024, numero: "10568451000124001", emenda: "PROGRAMA PAC/MS", parlamentar: "MINISTÉRIO DA SAÚDE (PROGRAMA)", status: "FAVORÁVEL / EMPENHADO", objeto: "Construção de Unidade Básica de Saúde (UBS Porte 1 - Bairro Guaiúba)", valor: 2026110.00, natureza: "4490 - Obras e Instalações", pode: "Execução da obra civil de construção da nova UBS Porte 1 no bairro Guaiúba (atendimento estimado de 3.000 habitantes).", naoPode: "VEDADO usar para compra de medicamentos, folha de pagamento ou manutenção de outras UBSs." },
    { ano: 2024, numero: "36000599811202400", emenda: "Emenda 44930003", parlamentar: "EMENDA FEDERAL Nº 44930003", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio do Piso da Atenção Primária (PAP)", valor: 2000000.00, natureza: "3390 - Custeio APS", pode: "Custeio de ações e serviços da Atenção Primária à Saúde (material de consumo, gaze, gase, seringas, serviços PJ e manutenção das UBSs).", naoPode: "VEDADO usar para pagamento de servidores ativos/inativos, obras ou compra de equipamentos permanentes (4490)." },
    { ano: 2024, numero: "36000604612202400", emenda: "Emenda 50410004", parlamentar: "EMENDA FEDERAL Nº 50410004", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio do Piso da Atenção Primária (PAP)", valor: 1000000.00, natureza: "3390 - Custeio APS", pode: "Custeio operacional das Unidades Básicas de Saúde, insumos clínicos (gaze, gase, luvas, seringas) e serviços terceirizados da APS.", naoPode: "VEDADO usar para folha de pagamento de pessoal ou aquisição de material permanente/veículos." },
    { ano: 2024, numero: "36000599812202400", emenda: "Emenda 90550006", parlamentar: "EMENDA FEDERAL Nº 90550006 (Gilson Marques - Ref. 513)", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio MAC (Média e Alta Complexidade)", valor: 180000.00, natureza: "3390 / 3371 - Custeio MAC", pode: "Custeio de procedimentos, exames, insumos e combustível/logística de Média e Alta Complexidade (CNES 6442285 - SMS Imbituba).", naoPode: "VEDADO usar na Atenção Básica ou para compra de equipamentos permanentes (4490)." },
    { ano: 2024, numero: "10568451000124002", emenda: "PROGRAMA SUS DIGITAL", parlamentar: "MINISTÉRIO DA SAÚDE (TELESSAÚDE)", status: "PROPOSTA APROVADA", objeto: "Equipamentos de Saúde Digital e Telessaúde para 6 UBSs (29 itens)", valor: 59704.00, natureza: "4490 - Material Permanente", pode: "Compra exata de 29 itens para as UBSs Ibiraquera, Alto Arroio, Campo d'Aviação, Nova Brasília, Vila Nova e Vila Nova Alvorada: 5 Notebooks (R$ 6.940 un), 6 Câmeras Videoconferência 4K (R$ 1.700 un), 1 Monitor Sinais Vitais Telessaúde (R$ 7.374), 11 Cadeiras (R$ 312 un) e 6 Mesas (R$ 737/313).", naoPode: "VEDADO comprar itens diferentes da relação aprovada ou alocar em unidades fora dos 6 CNES cadastrados." },
    { ano: 2025, numero: "36000721655202500", emenda: "Emenda 39490003", parlamentar: "DEPUTADO DANIEL FREITAS (Emenda 39490003 - Refs. 518, 519, 520)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Material de Consumo, Apoio Logístico e Telessaúde APS", valor: 1000000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "100% Material de Consumo (R$ 1 Mi): elásticos, colchonetes, cronômetros, luvas, seringas, gazes, gase, impressão de cartilhas/materiais gráficos (PSE), combustível p/ transporte de pacientes da APS e pequenos acessórios de suporte digital classificados como custeio (cabos, microfones, webcams, fones, teclados, tripés).", naoPode: "VEDADO comprar bens de capital/permanentes (4490), pois 100% foi cadastrado na natureza Material de Consumo." },
    { ano: 2025, numero: "36000664106202500", emenda: "Emenda 44010001", parlamentar: "DEPUTADA JULIA ZANATTA (Emenda 44010001 - Refs. 514, 515, 516)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Saúde da Mulher, Odontológico, Idoso, Vacinação e Telessaúde", valor: 1000000.00, natureza: "3390 - Custeio APS (Consumo e Serviços PJ)", pode: "Implantação de telessaúde/telepsicologia (R$ 120 mil - Ref 515); Insumos Saúde da Mulher e Material Odontológico (R$ 200 mil - Ref 514); Materiais leves elásticos, colchonetes, esfigmomanômetro, balança (R$ 50 mil - Ref 514); DIU/anticoncepcionais (R$ 50 mil); Linha de cuidado da pessoa idosa (R$ 100 mil); Busca ativa vacinal e campanhas (R$ 180 mil); Condições crônicas e navegação do cuidado (R$ 300 mil - Ref 516).", naoPode: "VEDADO usar para folha de pagamento, obras ou compra de veículos." },
    { ano: 2025, numero: "36000655010202500", emenda: "Emenda 42510001", parlamentar: "EMENDA FEDERAL Nº 42510001", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Insumos Saúde da Mulher, Condições Crônicas e Navegação", valor: 300000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "100% Material de Consumo: R$ 100 mil para insumos de atendimento clínico à Saúde da Mulher (gaze, gase, seringa, luva); R$ 100 mil para insumos de acompanhamento de condições crônicas (tiras de glicemia, lancetas); R$ 100 mil para fortalecimento da APS.", naoPode: "VEDADO usar para serviços de terceiros PJ ou equipamentos permanentes (100% vinculado a Material de Consumo)." },
    { ano: 2025, numero: "36000718685202500", emenda: "Emenda 50410001", parlamentar: "COMISSÃO DE SAÚDE (Emenda 50410001 - Proposta 1)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Atenção Integral à Saúde da Mulher", valor: 200000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "Aquisição de insumos ginecológicos e de atendimento à mulher: espéculos vaginais, pinças, luvas de procedimento, gazes, gase, algodão, seringas, agulhas, cartilhas e folders educativos de combate à violência e dignidade menstrual.", naoPode: "VEDADO usar para serviços PJ, obras ou equipamentos permanentes." },
    { ano: 2025, numero: "36000706895202500", emenda: "Emenda 50410001", parlamentar: "COMISSÃO DE SAÚDE (Emenda 50410001 - Proposta 2 - Ref. 512 CEREM)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Saúde da Mulher e Contraceptivos (CEREM)", valor: 250000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "Aquisição de espéculos, pinças, luvas, gazes, gase, algodão, seringas, agulhas, pílulas anticoncepcionais, injetáveis mensais, Dispositivo Intrauterino (DIU), diafragma, Implanon e materiais educativos de saúde da mulher no CEREM.", naoPode: "VEDADO usar para contratação de serviços PJ ou compra de mobiliário/equipamentos." },
    { ano: 2025, numero: "36000699808202500", emenda: "Emenda 60060003", parlamentar: "COMISSÃO DE ASSUNTOS SOCIAIS (Emenda 60060003 - Ref. 777)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Rastreamento de Condições Crônicas via Consórcio", valor: 500000.00, natureza: "3371 - Execução Delegada a Consórcios Públicos (100%)", pode: "Transferência a Consórcio Público (CISAMUREL) para oferta de exames e consultas especializadas de rastreamento e controle de Doenças Crônicas para pacientes da Atenção Básica.", naoPode: "VEDADO usar fora de contrato de rateio com Consórcio Público ou para compra de equipamentos." },
    { ano: 2025, numero: "36000699824202500", emenda: "Emenda 71260002", parlamentar: "BANCADA OBRIGATÓRIA SC (Emenda 71260002 - Ref. 510)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Serviços de Tecnologia da Informação (IPM/Inovadora)", valor: 222386.00, natureza: "3390.40 - Serviços de TIC Pessoa Jurídica (100%)", pode: "Manutenção da informatização das UBSs: locação/licenciamento de sistemas de prontuário eletrônico (IPM / Inovadora), teleatendimento e conectividade da Atenção Primária.", naoPode: "VEDADO comprar computadores/hardware (4490) ou materiais de consumo; exclusivo para Serviços de TIC PJ." },
    { ano: 2025, numero: "10568451000125002", emenda: "PROGRAMA EQUIPAMENTOS", parlamentar: "MINISTÉRIO DA SAÚDE (UBS CENTRO)", status: "PROPOSTA APROVADA", objeto: "Aquisição de 18 Equipamentos Médicos e de Telessaúde para a UBS Centro", valor: 199596.00, natureza: "4490 - Material Permanente", pode: "Compra exata dos 18 equipamentos para a USF Centro (CNES 2385902): 1 Retinógrafo (R$ 43.222), 1 Ultrassom Portátil (R$ 41.933), 1 Espirômetro (R$ 19.866), 1 Câmara Imunobiológicos (R$ 16.176), 1 Eletrocardiógrafo (R$ 15.390), 1 Bisturi Elétrico (R$ 13.779), 1 DEA (R$ 9.930), 1 Dermatoscópio (R$ 8.010), 1 Fotóforo (R$ 7.316), 1 Otoscópio (R$ 7.250), 1 Laser Fisio (R$ 4.214), 1 Doppler (R$ 2.421), 1 Cadeira Rodas Obeso (R$ 2.346), 1 Ultrassom Fisio (R$ 2.053), 1 Balança (R$ 1.888), 1 Dinamômetro (R$ 1.832), 1 TENS/FES (R$ 1.757) e 1 Tábua Propriocepção (R$ 213).", naoPode: "VEDADO usar para custeio ou comprar equipamentos diferentes da lista técnica aprovada." },
    { ano: 2025, numero: "10568451000125001", emenda: "PROGRAMA TELESSAÚDE", parlamentar: "MINISTÉRIO DA SAÚDE (EAP PENHA)", status: "PROPOSTA APROVADA", objeto: "Equipamentos para Teleconsulta na EAP da Penha (3 itens)", valor: 7158.00, natureza: "4490 - Material Permanente", pode: "Compra exata de 3 itens para a EAP da Penha (CNES 2385945): 1 Notebook para Telessaúde (R$ 4.068,00), 1 Televisor 42\" a 50\" (R$ 1.726,00) e 1 Câmera de Videoconferência 4K (R$ 1.364,00).", naoPode: "VEDADO usar em outra unidade ou para despesas de custeio." },
    { ano: 2026, numero: "36000764089202600", emenda: "Emenda 44010001", parlamentar: "DEPUTADA JULIA ZANATTA (Emenda 44010001 - Refs. 536 e 537)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Saúde da Pessoa Idosa e Manutenção Equipamentos CEREM/UBS", valor: 400000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "R$ 200.000,00 (Ref 536) para ações de atenção ao envelhecimento e saúde da pessoa idosa na APS; R$ 200.000,00 (Ref 537) para manutenção preventiva e corretiva de equipamentos nas UBSs e no CEREM.", naoPode: "VEDADO adquirir equipamentos novos (4490) ou folha de pagamento; exclusivo para Serviços PJ." },
    { ano: 2026, numero: "36000764161202600", emenda: "Emenda 42090006", parlamentar: "DEPUTADO JORGE GOETTEN (Emenda 42090006 - Ref. 538)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Manutenção de UBSs e Equipamentos (Vacinação)", valor: 350000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "Manutenção preventiva e corretiva das Unidades Básicas de Saúde: manutenção de equipamentos, reparo de refrigeradores de vacinas (cadeia de frio), sistemas elétricos e conservação de espaços clínicos.", naoPode: "VEDADO comprar câmaras frias novas ou construir ampliações (exclusivo para serviços PJ de manutenção)." },
    { ano: 2026, numero: "36000763955202600", emenda: "Emenda 39320002", parlamentar: "DEPUTADA CAROLINE DE TONI (Emenda 39320002 - Refs. 534 e 535)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Combustível Visitas Domiciliares e Manut. Equip. Odontológico", valor: 350000.00, natureza: "3390 - Custeio APS", pode: "R$ 150.000,00 (Ref 534) para combustível, manutenção de veículos e kits de visitas domiciliares; R$ 200.000,00 (Ref 535) para manutenção preventiva/corretiva de equipamentos de UBS (foco em manutenção de equipamento odontológico e TI).", naoPode: "VEDADO comprar veículos ou equipamentos novos." },
    { ano: 2026, numero: "36000760344202600", emenda: "Emenda 39290002", parlamentar: "EMENDA FEDERAL Nº 39290002", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Manutenção Predial UBSs, Equipamentos e Logística", valor: 1000000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "R$ 600.000,00 para manutenção predial preventiva/corretiva das UBSs (elétrica, salas de vacina, climatização); R$ 300.000,00 para manutenção de equipamentos clínicos (ECG, balanças, esfigmos); R$ 100.000,00 para apoio logístico de visitas domiciliares.", naoPode: "VEDADO usar para folha de pagamento ou compra de bens permanentes (100% Serviços PJ)." },
    { ano: 2026, numero: "36000793046202600", emenda: "Emenda 71260002", parlamentar: "BANCADA OBRIGATÓRIA SC (Emenda 71260002 - Refs. 545, 546, 778, 779)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Consórcio, Insumos Mulher, Impressos e Pesquisa APS", valor: 500000.00, natureza: "Consórcio (R$ 200k) + Consumo (R$ 200k) + Auxílio Estudante (R$ 100k)", pode: "Divisão estrita: R$ 200.000,00 (Refs 778 e 779) para Consórcio Público; R$ 100.000,00 (Ref 545) para materiais/insumos Saúde da Mulher (gaze, gase, seringa, luva); R$ 100.000,00 (Ref 546) para materiais impressos educativos; R$ 100.000,00 (Ref 546) para Auxílio Financeiro a Estudantes.", naoPode: "VEDADO alterar os tetos de cada uma das naturezas cadastradas no plano de trabalho." },
    { ano: 2026, numero: "10568451000126005", emenda: "Emenda 44010004", parlamentar: "EMENDA FEDERAL Nº 44010004", status: "PROPOSTA APROVADA", objeto: "Aquisição de 1 Unidade Móvel de Saúde (Ambulância Tipo A - Furgão)", valor: 312730.00, natureza: "4490 - Material Permanente", pode: "Aquisição de 1 Ambulância Tipo A - Simples Remoção Tipo Furgão 0km (diesel, mín. 7m³, maca retrátil, cilindro O2 16L, ar-condicionado 25.000 BTUs e sinalizador acústico/visual).", naoPode: "VEDADO comprar veículo de passeio comum ou usar o saldo para combustível/manutenção." },
    { ano: 2026, numero: "63000763762202600", emenda: "PROGRAMA PAP 2026", parlamentar: "MINISTÉRIO DA SAÚDE (CUSTEIO PAP)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio de Serviços da Atenção Primária à Saúde (Horário Estendido e Multiprofissional)", valor: 3000000.00, natureza: "Múltiplas Naturezas de Custeio (R$ 3,00 Mi)", pode: "Divisão por natureza: R$ 1.100.000,00 em Serviços PJ; R$ 700.000,00 em Serviços Pessoa Física; R$ 500.000,00 em Serviços de TIC PJ; R$ 300.000,00 em Material de Consumo (gaze, gase, seringas, insumos); R$ 300.000,00 em Auxílio a Estudantes; R$ 100.000,00 em Material de Distribuição Gratuita.", naoPode: "VEDADO usar para investimentos/obras (4490) ou ultrapassar o teto de cada natureza de despesa cadastrada." },
    { ano: 2026, numero: "63000780331202600", emenda: "PROGRAMA MAC 2026 (1)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - APAE E AMAI)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio MAC e Rede Alyne — Parceria APAE (R$ 500k) e AMAI (R$ 500k)", valor: 1000000.00, natureza: "3350 - Transferências / Contrato de Gestão", pode: "Repasse de R$ 500.000,00 para a APAE (seguimento de RN de risco e deficiência intelectual) e R$ 500.000,00 para a AMAI (diagnóstico precoce e acompanhamento multiprofissional de TEA).", naoPode: "VEDADO usar para obras civis ou compra de veículos nas entidades." },
    { ano: 2026, numero: "63000764214202600", emenda: "PROGRAMA MAC 2026 (2)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - AMAI E APAE)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio Especializado MAC / Rede Alyne — AMAI (R$ 500k) e APAE (R$ 500k)", valor: 1000000.00, natureza: "3350 - Transferências / Contrato de Gestão", pode: "Repasse de R$ 500.000,00 para a AMAI e R$ 500.000,00 para a APAE para custeio de equipe multiprofissional e reabilitação da Pessoa com Deficiência e RN de risco.", naoPode: "VEDADO desviar para despesas fora dos planos de trabalho aprovados para AMAI e APAE." },
    { ano: 2026, numero: "63000763733202600", emenda: "PROGRAMA MAC 2026 (3)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - SMS IMBITUBA)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio MAC — Regulação, Oncologia/TFD, Medicina Nuclear e Rede Alyne", valor: 1500000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "100% Serviços PJ: R$ 400 mil Alta Complexidade; R$ 350 mil Central de Regulação; R$ 200 mil Radioterapia TFD; R$ 200 mil Transporte Sanitário Radioterapia; R$ 150 mil Medicina Nuclear Oncológica; R$ 100 mil Pré-Natal Alto Risco; R$ 100 mil Seguimento RN de Risco.", naoPode: "VEDADO comprar equipamentos permanentes (4490) ou folha de efetivos." }
];

// =========================================================================
// 4. CLASSIFICADOR INTELIGENTE DE DOTAÇÕES (RESPEITA RIGOROSAMENTE A NATUREZA)
// =========================================================================
export function classificarPermissoesDotacao(refNum, acao, modalidade, vinculoDesc, vinculoCod) {
    const tags = [];
    let regraPode = '';
    let regraNaoPode = '';
    let tituloEmendaCustom = null;
    let tagsBuscaExtra = '';

    const modCod = String(modalidade || '').substring(0, 6);
    const acaoUpper = String(acao || '').toUpperCase();
    const vincUpper = String(vinculoDesc || '').toUpperCase();
    const vCod = String(vinculoCod || '').trim();

    const ehFolha = (modCod === '331900' || modCod === '331710');
    const ehCusteioDireto = (modCod === '333900' || modCod === '333910');
    const ehPermanenteDireto = (modCod === '344900' || modCod === '344710');
    const ehEntidadeCusteio = (modCod === '333500');
    const ehEntidadeCapital = (modCod === '344500');
    const ehConsorcio = (modCod === '333710');

    // 1. Classificação estrita por Natureza da Despesa
    if (ehFolha) {
        tags.push('Folha / Pessoal (33190)');
        regraPode = 'Exclusivo para Folha de Pagamento (3.1.90 / 3.1.71): Vencimentos, salários, 13º salário, férias e encargos patronais de servidores.';
        regraNaoPode = 'PROIBIDO usar para compras de materiais de consumo, medicamentos, cadeiras/mobiliário, equipamentos, aluguéis, serviços PJ ou obras.';
        tagsBuscaExtra += ' folha pagamento salario vencimento servidor rh pessoal encargo inss fgts ';
    } else if (ehCusteioDireto) {
        tags.push('Custeio / Serviços PJ (33390)');
        tags.push('Custeio / Aluguel / Serviços PJ');
        regraPode = 'Custeio Direto (3.3.90): Material de consumo ambulatorial/hospitalar (gaze, gase, compressa, seringa, agulha, luva, algodão, álcool, esparadrapo, atadura, curativo, sonda, máscara, avental, teste rápido), serviços PJ, aluguéis de imóveis, internet, manutenção predial/frota, combustível e exames.';
        regraNaoPode = 'PROIBIDO comprar Material Permanente, Equipamentos, Móveis, Cadeiras, Computadores, Ar-condicionado ou Veículos (exigem código 344900) e proibido pagar folha.';
        tagsBuscaExtra += ' gaze gase compressa seringa agulha luva algodao alcool esparadrapo atadura curativo sonda mascara avental papel lencol descartavel lanceta tira glicemia material ambulatorial enfermagem consumo limpeza expediente aluguel manutencao servico pj ';
    } else if (ehPermanenteDireto) {
        tags.push('Material Permanente / Obras (34490)');
        regraPode = 'Investimento / Permanente (4.4.90): Compra de Mobiliário (cadeiras, poltronas, longarinas, mesas, armários), Ar-condicionado, Computadores, Notebooks, Impressoras, TVs, Veículos/Ambulâncias, Equipamentos Médicos/Odontológicos (maca, cadeira de rodas, cadeira odontológica, oxímetro, autoclave, ultrassom, bisturi, DEA) e Obras.';
        regraNaoPode = 'PROIBIDO usar para custeio mensal (aluguel, internet, combustível, gaze, seringas, medicamentos ou serviços de terceiros) ou folha.';
        tagsBuscaExtra += ' cadeira poltrona longarina mesa armario mobiliario movel ar-condicionado computador notebook impressora tv veiculo carro ambulancia maca cadeira de rodas oximetro foco luz eletrocardiografo equipamento permanente obra ';
    } else if (ehEntidadeCusteio) {
        tags.push('Hospital / Entidades (33350)');
        tags.push('Entidades Custeio (33350)');
        regraPode = 'Repasse de Custeio a Instituições Privadas Sem Fins Lucrativos (3.3.50): Custeio operacional, atendimentos terapêuticos, plantões, exames, alimentação, rouparia e manutenção (Hospital São Camilo, APAE, AMAI, Rede Feminina, Orialan, Ebenezer, Despertar Jovem, Rotary).';
        regraNaoPode = 'PROIBIDO comprar equipamentos permanentes, móveis, cadeiras ou veículos (que exigem natureza 344500) e proibido compras diretas fora de Termo de Colaboração/Fomento.';
        tagsBuscaExtra += ' entidade mrosc convenio termo fomento colaboracao hospital sao camilo apae amai rede feminina ebenezer despertar jovem orialan rotary custeio ';
    } else if (ehEntidadeCapital) {
        tags.push('Hospital / Entidades (33350)');
        tags.push('Entidades Capital/Equip. (34450)');
        regraPode = 'Repasse de Investimento/Capital a Instituições Sem Fins Lucrativos (4.4.50): Aquisição de equipamentos permanentes, mobiliário, cadeiras, camas hospitalares, cadeiras de rodas, veículos ou obras/ampliação de salas para entidades parceiras.';
        regraNaoPode = 'PROIBIDO usar para custeio operacional mensal (folha da entidade, água, luz, aluguel ou insumos descartáveis, que exigem natureza 333500).';
        tagsBuscaExtra += ' entidade mrosc investimento equipamento permanente mobiliario cadeira cama hospitalar cadeira de rodas obra construcao sala ';
    } else if (ehConsorcio) {
        tags.push('Consórcio Público (33371)');
        regraPode = 'Contrato de Rateio / Consórcio Intermunicipal de Saúde (CISAMUREL - 3.3.71): Consultas médicas especializadas, exames de média e alta complexidade (ultrassonografia, tomografia, ressonância, colonoscopia, endoscopia) e procedimentos.';
        regraNaoPode = 'PROIBIDO usar para compras diretas fora do consórcio ou para adquirir móveis, cadeiras ou bens permanentes.';
        tagsBuscaExtra += ' cisamurel consorcio exame consulta ultrassom ultrassonografia tomografia ressonancia colonoscopia endoscopia ';
    }

    // 2. Tags e itens por Ação Orçamentária (SEMPRE respeitando a Natureza da Despesa!)
    if (acaoUpper.includes('2084') || acaoUpper.includes('TFD') || acaoUpper.includes('2086') || acaoUpper.includes('SAMU')) {
        tags.push('Transporte / TFD / SAMU');
        if (ehCusteioDireto) {
            tagsBuscaExtra += ' transporte tfd samu combustivel gasolina oleo diesel pneu peca manutencao frota passagem ajuda custo ';
        } else if (ehPermanenteDireto) {
            tagsBuscaExtra += ' transporte tfd samu compra veiculo carro ambulancia furgao equipamento samu ';
        }
    }
    if (acaoUpper.includes('2121') || acaoUpper.includes('TECNOLOGIA') || acaoUpper.includes('DIGITAL')) {
        tags.push('Tecnologia / SUS Digital');
        if (ehCusteioDireto) {
            tagsBuscaExtra += ' tecnologia sus digital telessaude telemedicina prontuario eletronico internet fibra locacao software sistema suporte ti ';
        } else if (ehPermanenteDireto) {
            tagsBuscaExtra += ' tecnologia sus digital computador notebook servidor impressora webcam monitor ';
        }
    }
    if (acaoUpper.includes('2089') || acaoUpper.includes('2090') || acaoUpper.includes('FARMAC') || vincUpper.includes('PORTARIA 017/223')) {
        tags.push('Medicamentos / Farmácia');
        if (ehCusteioDireto) {
            regraPode = 'Assistência Farmacêutica e Insumos Estratégicos (3.3.90): Aquisição de medicamentos da Farmácia Básica/Judicial (dipirona, paracetamol, amoxicilina, losartana, metformina, omeprazol, insulina, etc.) e insumos ambulatoriais/curativos (gaze, gase, seringa, agulha, esparadrapo, luvas, tiras de glicemia, lancetas, fraldas).';
            tagsBuscaExtra += ' medicamento remedio farmacia dipirona paracetamol ibuprofeno amoxicilina azitromicina losartana metformina omeprazol sinvastatina insulina fralda gaze gase seringa agulha lanceta tira glicemia ';
        }
    }
    if (acaoUpper.includes('2076') || acaoUpper.includes('BUCAL')) {
        tags.push('Saúde Bucal');
        if (ehCusteioDireto) {
            regraPode = 'Custeio de Saúde Bucal / CEO (3.3.90): Aquisição de insumos odontológicos de consumo (resina composta, anestésico, agulha gengival, luva, gaze, gase, máscara, sugador descartável, flúor, cimento odontológico, brocas) e manutenção de equipamentos odontológicos.';
            regraNaoPode = 'PROIBIDO comprar cadeira odontológica, compressor ou equipamentos permanentes nesta dotação de custeio (333900) — para equipamentos permanentes da Saúde Bucal, usar as Refs 761 ou 762 (código 344900).';
            tagsBuscaExtra += ' odonto odontologico dentista bucal ceo resina anestesico broca luva gaze gase mascara sugador fluor manutencao odontologica ';
        } else if (ehPermanenteDireto) {
            regraPode = 'Investimento / Permanente em Saúde Bucal (4.4.90): Aquisição de Cadeira Odontológica completa, equipo, refletor, mocho, compressor odontológico, autoclave, fotopolimerizador, raio-x odontológico e mobiliário de consultório.';
            tagsBuscaExtra += ' odonto odontologico dentista bucal cadeira odontologica equipo mocho compressor autoclave fotopolimerizador consultorio ';
        } else if (ehConsorcio) {
            regraPode = 'Saúde Bucal via Consórcio Público (3.3.71 - LRPD): Laboratório Regional de Próteses Dentárias e procedimentos odontológicos consorciados.';
            tagsBuscaExtra += ' odonto bucal protese dentaria lrpd consorcio ';
        }
    }
    if (acaoUpper.includes('2080') && ehCusteioDireto) {
        tags.push('Medicamentos / Farmácia');
        tags.push('Transporte / TFD / SAMU');
        tags.push('Tecnologia / SUS Digital');
    }

    const ehEmenda = vincUpper.includes('EMENDA') ||
                     vCod.startsWith('15007011') || vCod.startsWith('2706') ||
                     vCod.startsWith('1706') || vCod.startsWith('2710') ||
                     vCod.startsWith('25007011') || vCod.startsWith('16003120') ||
                     vCod.startsWith('270031') || vCod.startsWith('262132') ||
                     vincUpper.includes('PORTARIA 017') || vincUpper.includes('CONVÊNIOS');

    // 3. Regra específica da planilha Emendas_Parlamentares_Aplicação.xlsx (por número da Ref.)
    if (regrasPlanilhaPorRef[refNum]) {
        const rp = regrasPlanilhaPorRef[refNum];
        tags.push(rp.parlamentar);
        tituloEmendaCustom = `🇧🇷 ${rp.parlamentar} (Ref. ${refNum})`;
        regraPode = rp.pode;
        regraNaoPode = rp.naoPode;
        // Substitui as tags genéricas pela descrição exata da planilha da emenda federal
        tagsBuscaExtra = ` ${rp.parlamentar} ${rp.pode} `;
    }

    // 4. Cruzamento exato pelos 3 últimos dígitos do vínculo IPM (150070112XXX -> Emendas Impositivas)
    if (vCod.startsWith('150070112')) {
        const num3 = vCod.slice(-3);
        const imp = emendasImpositivas2025.find(e => e.num === num3);
        if (imp) {
            tags.push(`Vereador(a): ${imp.autor}`);
            tags.push(`Destino: ${imp.beneficiario}`);
            if (imp.pd) tags.push(imp.pd);
            tituloEmendaCustom = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario}`;
            // Se a emenda tem desdobramento 3350 vs 4450, usa o texto específico da modalidade daquela Ref!
            const podeEspecifico = (ehEntidadeCusteio && imp.pode3350) ? imp.pode3350 : ((ehEntidadeCapital && imp.pode4450) ? imp.pode4450 : imp.pode);
            regraPode = `${podeEspecifico} (Natureza: ${imp.natureza}).`;
            regraNaoPode = imp.naoPode;
            // Nas emendas impositivas, a busca olha apenas para os itens específicos do Plano de Trabalho daquela emenda!
            tagsBuscaExtra = ` ${imp.autor} ${imp.beneficiario} ${podeEspecifico} emenda ${imp.num} `;
        } else {
            tituloEmendaCustom = `🏛️ Emenda Impositiva nº ${num3} — Emenda Municipal (Saúde)`;
        }
    } else if (vCod === '150070111002') {
        tituloEmendaCustom = `🏛️ Emendas Municipais Anteriores (${vCod}) — Saldo Consolidado Saúde`;
    } else if (vCod === '250070114501') {
        tituloEmendaCustom = `🏛️ Emenda Municipal — Vereador Michell Nunes (2024)`;
    } else if (vCod === '250070114502') {
        tituloEmendaCustom = `🏛️ Emenda Municipal — Bancada PP (2024)`;
    } else if (vCod === '250070114503') {
        tituloEmendaCustom = `🏛️ Emenda Municipal — Bancada PSDB (2024)`;
    } else if (vCod === '250070114504') {
        tituloEmendaCustom = `🏛️ Emenda Municipal — Vereador Jesiel Antulino (2025)`;
    } else if (!tituloEmendaCustom && (vCod.startsWith('1706') || vCod.startsWith('2706'))) {
        tituloEmendaCustom = `🇧🇷 Emenda Federal Individual — ${vincUpper.replace(/.*INDIVIDUAL\s*/, '').trim()}`;
    } else if (!tituloEmendaCustom && (vCod.startsWith('1600') || vCod.startsWith('2700'))) {
        tituloEmendaCustom = `🇧🇷 Emenda Federal Bancada/Comissão — ${vincUpper.replace(/.*TEMPORÁRIO\s*-\s*/, '').replace(/.*MAC\s*-\s*/, '').trim()}`;
    } else if (vCod.startsWith('262132') || vCod.startsWith('2710')) {
        tituloEmendaCustom = `🚩 Emenda Estadual (FES/Impositiva) — Santa Catarina`;
    } else if (vincUpper.includes('PORTARIA 017')) {
        tituloEmendaCustom = `🏥 Repasse Estadual/Federal — Portaria 017/223 (Aquisição Material Ambulatorial)`;
        regraPode = 'Aquisição de Material Ambulatorial e Insumos Clínicos (Portaria 017/223): gaze, gase, compressas, seringas, agulhas, luvas de procedimento, esparadrapo, ataduras, álcool 70%, algodão, sondas, curativos e insumos de enfermagem.';
        regraNaoPode = 'PROIBIDO usar para compra de móveis, cadeiras ou equipamentos permanentes.';
        tagsBuscaExtra = ' portaria 017/223 material ambulatorial gaze gase compressa seringa agulha luva esparadrapo atadura alcool algodao sonda curativo ';
    } else if (vincUpper.includes('CONVÊNIOS - UNIÃO')) {
        tituloEmendaCustom = `🤝 Convênio da União — Repasse Externo (${vCod})`;
    } else if (vincUpper.includes('CONVÊNIOS - ESTADO')) {
        tituloEmendaCustom = `🤝 Convênio do Estado — Repasse Externo (${vCod})`;
    }

    // 5. Integração das Regras Customizadas (Editadas pela Contadora no Modal + Supabase)
    const regraEditada = customRulesDB[refNum];
    if (regraEditada) {
        if (regraEditada.pode) {
            regraPode = regraPode ? `${regraPode} | ✍️ ADICIONADO PELA CONTABILIDADE: ${regraEditada.pode}` : `✍️ ADICIONADO PELA CONTABILIDADE: ${regraEditada.pode}`;
            tagsBuscaExtra += ` ${regraEditada.pode} `;
        }
        if (regraEditada.naoPode) {
            regraNaoPode = regraNaoPode ? `${regraNaoPode} | ✍️ VEDADO (CONTABILIDADE): ${regraEditada.naoPode}` : `✍️ VEDADO (CONTABILIDADE): ${regraEditada.naoPode}`;
        }
        tags.push('✍️ Editado pela Contabilidade');
    }

    return {
        tags: [...new Set(tags)],
        regraPode,
        regraNaoPode,
        ehEmenda,
        tituloEmendaCustom,
        regraCustomPode: regraEditada?.pode || '',
        regraCustomNaoPode: regraEditada?.naoPode || '',
        tagsBusca: tagsBuscaExtra
    };
}

function construirBaseDotacoes(listaBruta) {
    dotacoesDB = listaBruta.map(r => {
        const info = classificarPermissoesDotacao(r.ref, r.acao, r.modalidade, r.vinculo_desc, r.vinculo_cod);
        return {
            ...r,
            permissoesTags: info.tags,
            regraPode: info.regraPode,
            regraNaoPode: info.regraNaoPode,
            ehEmenda: info.ehEmenda,
            tituloEmendaCustom: info.tituloEmendaCustom,
            regraCustomPode: info.regraCustomPode,
            regraCustomNaoPode: info.regraCustomNaoPode,
            tagsBusca: info.tagsBusca
        };
    });
}

// =========================================================================
// 5. MOTOR DE PERSISTÊNCIA: CARREGA DO SUPABASE OU LOCALSTORAGE AO ABRIR
// =========================================================================
async function inicializarBancoDeDados() {
    let origemDados = 'Pasta Local (dados_iniciais.js)';
    let dotacoesCarregadas = null;
    let auditoriaCarregada = null;
    let contratosCarregados = null;

    const cacheRules = localStorage.getItem(STORAGE_KEYS.CUSTOM_RULES);
    if (cacheRules) {
        try { customRulesDB = JSON.parse(cacheRules) || {}; } catch (e) { customRulesDB = {}; }
    }

    if (supabaseAtivo) {
        try {
            const { data: dSupa, error: errD } = await supabase.from('dotacoes_orcamentarias').select('*').order('ref', { ascending: true });
            const { data: aSupa, error: errA } = await supabase.from('auditoria_empenhos_parados').select('*').order('saldo', { ascending: false });
            if (!errD && dSupa && dSupa.length > 0) {
                dotacoesCarregadas = dSupa.map(d => {
                    if (d.regra_custom_pode || d.regra_custom_nao_pode) {
                        customRulesDB[d.ref] = {
                            pode: d.regra_custom_pode || '',
                            naoPode: d.regra_custom_nao_pode || ''
                        };
                    }
                    return {
                        ...d,
                        orcado: Number(d.orcado),
                        atualizado: Number(d.atualizado),
                        empenhado: Number(d.empenhado),
                        reservado: Number(d.reservado),
                        saldo_empenho: Number(d.saldo_empenho),
                        saldo_reserva: Number(d.saldo_reserva)
                    };
                });
                localStorage.setItem(STORAGE_KEYS.CUSTOM_RULES, JSON.stringify(customRulesDB));
                origemDados = `☁️ Nuvem Supabase (${dSupa.length} Refs Ativas)`;
            } else if (!errD && dSupa && dSupa.length === 0) {
                await supabase.from('dotacoes_orcamentarias').upsert(rawDotacoesReais, { onConflict: 'ref' });
                const payloadAud = auditoriaParadosIniciais.map(a => ({
                    emp: a.emp, especie: a.especie, ref: a.ref || null, credor: a.credor,
                    emissao: a.emissao, ult_liq: a.ultLiq, empenhado_total: a.empenhadoTotal,
                    saldo: a.saldo, dias: a.dias, acao: a.acao
                }));
                await supabase.from('auditoria_empenhos_parados').upsert(payloadAud, { onConflict: 'emp' });
                origemDados = '☁️ Nuvem Supabase (Carga Inicial Automática Concluída!)';
            }
            if (!errA && aSupa && aSupa.length > 0) {
                auditoriaCarregada = aSupa.map(a => ({
                    emp: a.emp,
                    especie: a.especie,
                    ref: Number(a.ref),
                    credor: a.credor,
                    emissao: a.emissao,
                    ultLiq: a.ult_liq,
                    empenhadoTotal: Number(a.empenhado_total),
                    saldo: Number(a.saldo),
                    dias: Number(a.dias),
                    acao: a.acao
                }));
            }
        } catch (err) {
            console.warn('Erro ao ler Supabase, usando cache local:', err);
        }
    }

    if (!dotacoesCarregadas) {
        const cacheDot = localStorage.getItem(STORAGE_KEYS.DOTACOES);
        if (cacheDot) {
            try {
                dotacoesCarregadas = JSON.parse(cacheDot);
                const dataSync = localStorage.getItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO) || 'Recente';
                origemDados = `💾 Banco do Navegador (Atualizado em ${dataSync})`;
            } catch (e) {}
        }
    }
    if (!auditoriaCarregada) {
        const cacheAud = localStorage.getItem(STORAGE_KEYS.AUDITORIA);
        if (cacheAud) {
            try { auditoriaCarregada = JSON.parse(cacheAud); } catch (e) {}
        }
    }
    const cacheCont = localStorage.getItem(STORAGE_KEYS.CONTRATOS);
    if (cacheCont) {
        try { contratosCarregados = JSON.parse(cacheCont); } catch (e) {}
    }

    construirBaseDotacoes(dotacoesCarregadas || rawDotacoesReais);
    auditoriaParadosDB = auditoriaCarregada || [...auditoriaParadosIniciais];
    contratosCruzadosDB = contratosCarregados || [...contratosCruzadosIniciais];

    const badgeTopo = document.getElementById('badgeStatusTopo');
    if (badgeTopo) badgeTopo.textContent = origemDados;

    popularFiltrosGlobais();
    renderizarTudo();
}

function baixarArquivoDadosIniciaisAtualizado() {
    const dotacoesLimpa = dotacoesDB.map(d => ({
        ref: d.ref,
        acao: d.acao,
        acao_num: d.acao_num || String(d.acao).split(' - ')[0],
        modalidade: d.modalidade,
        mod_cod: d.mod_cod || String(d.modalidade).split(' - ')[0],
        vinculo_cod: d.vinculo_cod,
        vinculo_desc: d.vinculo_desc,
        orcado: d.orcado,
        atualizado: d.atualizado,
        empenhado: d.empenhado,
        reservado: d.reservado,
        saldo_empenho: d.saldo_empenho,
        saldo_reserva: d.saldo_reserva
    }));

    const conteudoJS = `// =========================================================================
// BASE DE DADOS ATUALIZADA E EXPORTADA PELO SISTEMA EM ${new Date().toLocaleString('pt-BR')}
// Substitua este arquivo dentro da pasta /js/dados_iniciais.js no seu GitHub
// =========================================================================

export const rawDotacoesReais = ${JSON.stringify(dotacoesLimpa, null, 2)};

export const auditoriaParadosIniciais = ${JSON.stringify(auditoriaParadosDB, null, 2)};

export const contratosCruzadosIniciais = ${JSON.stringify(contratosCruzadosDB, null, 2)};
`;

    const blob = new Blob([conteudoJS], { type: 'application/javascript;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dados_iniciais.js';
    a.click();
}

function limparCacheNavegadorVoltarOriginal() {
    if (!confirm('Deseja limpar os uploads salvos no navegador e voltar para a base padrão do arquivo dados_iniciais.js?')) return;
    localStorage.removeItem(STORAGE_KEYS.DOTACOES);
    localStorage.removeItem(STORAGE_KEYS.AUDITORIA);
    localStorage.removeItem(STORAGE_KEYS.CONTRATOS);
    localStorage.removeItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO);
    location.reload();
}

function gerarBadgeRefComPopover(numRef) {
    const d = dotacoesDB.find(x => String(x.ref) === String(numRef));
    if (!d) {
        return `<span class="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-extrabold text-xs">Ref. ${numRef}</span>`;
    }
    return `
        <span class="ref-badge px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 font-extrabold text-xs transition">
            Ref. ${d.ref} <i data-lucide="info" class="w-3 h-3"></i>
            <span class="ref-popover">
                <span class="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Dotação Ref. ${d.ref} • ${d.ehEmenda ? 'Emenda Parlamentar' : 'Orçamento Regular'}</span>
                <span class="block font-bold text-xs text-white mb-1">${d.acao}</span>
                <span class="block text-[11px] text-slate-300 mb-2"><strong>Vínculo:</strong> ${d.tituloEmendaCustom || d.vinculo_desc}</span>
                <span class="block text-[11px] text-emerald-300 bg-slate-800 p-1.5 rounded border border-slate-700 mb-1.5"><strong>✅ Pode pagar:</strong> ${d.regraPode}</span>
                <span class="flex justify-between text-[11px] pt-1 border-t border-slate-700 text-slate-300">
                    <span>Empenhado: ${formatarBRL(d.empenhado)}</span>
                    <strong class="text-emerald-400">Livre: ${formatarBRL(d.saldo_reserva)}</strong>
                </span>
            </span>
        </span>
    `;
}

function popularFiltrosGlobais() {
    const selBloco = document.getElementById('filtroBlocoGlobal');
    if (selBloco) {
        const acoesUnicas = [...new Set(dotacoesDB.map(d => d.acao))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        selBloco.innerHTML = `<option value="TODOS" class="bg-slate-900">Todas as Ações (${acoesUnicas.length})</option>`;
        acoesUnicas.forEach(a => selBloco.innerHTML += `<option value="${a}" class="bg-slate-900">${a}</option>`);
    }

    const selDot = document.getElementById('filtroDotacaoGlobal');
    if (selDot) {
        const ordenadasRef = [...dotacoesDB].sort((a, b) => a.ref - b.ref);
        selDot.innerHTML = `<option value="TODAS" class="bg-slate-900">Todas as Refs (${dotacoesDB.length})</option>`;
        ordenadasRef.forEach(d => selDot.innerHTML += `<option value="${d.ref}" class="bg-slate-900">Ref. ${d.ref} • ${(d.tituloEmendaCustom || d.vinculo_desc).slice(0, 38)} (${formatarBRL(d.saldo_reserva)})</option>`);
    }

    const selAud = document.getElementById('filtroRefAuditoriaSelect');
    if (selAud) {
        const refsEmAuditoria = [...new Set(auditoriaParadosDB.map(r => r.ref))].sort((a, b) => a - b);
        selAud.innerHTML = `<option value="">📋 Mostrar Todas as Dotações Auditadas (${auditoriaParadosDB.length} empenhos)</option>`;
        refsEmAuditoria.forEach(rNum => {
            const dot = dotacoesDB.find(d => d.ref === rNum);
            const qtd = auditoriaParadosDB.filter(x => x.ref === rNum).length;
            const soma = auditoriaParadosDB.filter(x => x.ref === rNum).reduce((a, b) => a + b.saldo, 0);
            const desc = dot ? (dot.tituloEmendaCustom || dot.vinculo_desc).slice(0, 34) : 'Dotação FMS';
            selAud.innerHTML += `<option value="${rNum}">Ref. ${rNum} (${qtd} emp. = ${formatarBRL(soma)}) • ${desc}</option>`;
        });
    }
}

function obterDotacoesFiltroGlobal() {
    const elBloco = document.getElementById('filtroBlocoGlobal');
    const elDot = document.getElementById('filtroDotacaoGlobal');
    const acaoSel = elBloco ? elBloco.value : 'TODOS';
    const refSel = elDot ? elDot.value : 'TODAS';
    return dotacoesDB.filter(d => (acaoSel === 'TODOS' || d.acao === acaoSel) && (refSel === 'TODAS' || String(d.ref) === String(refSel)));
}

function trocarAba(idAba, btnEl) {
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(idAba);
    if (target) target.classList.add('active');
    if (btnEl) btnEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.lucide) lucide.createIcons();
}

function drillDownOrcamento() {
    trocarAba('aba-dotacoes', document.getElementById('btn-aba-dotacoes'));
    const sel = document.getElementById('selectApenasComSaldo');
    if (sel) sel.value = 'TODAS';
    filtrarAbaDotacoes();
}
function drillDownTesouraria() {
    trocarAba('aba-fixos', document.getElementById('btn-aba-fixos'));
    filtrarContratos('NA_TESOURARIA');
}
function drillDownAuditoria() {
    trocarAba('aba-auditoria', document.getElementById('btn-aba-auditoria'));
    limparFiltroAuditoria();
}
function drillDownEmendas() {
    trocarAba('aba-emendas', document.getElementById('btn-aba-emendas'));
    renderizarEmendas();
}

// =========================================================================
// 6. ABA 1: VISÃO EXECUTIVA, GRÁFICOS E QUADRO SINTÉTICO
// =========================================================================
function atualizarGraficoMensal() {
    const canvas = document.getElementById('chartEvolucaoMensal');
    if (!canvas) return;
    const fator = parseFloat(document.getElementById('selectSimulacaoMensal')?.value || '1.0');
    const ctx = canvas.getContext('2d');
    if (chartEvolucaoInstance) chartEvolucaoInstance.destroy();

    const mediaLiqMensal = 6058631.58;
    const projecaoMensal = Math.round(mediaLiqMensal * fator);

    const labels = ['Jan/26', 'Fev/26', 'Mar/26', 'Abr/26', 'Mai/26', 'Jun/26', 'Jul/26', 'Ago/26', 'Set/26', 'Out/26', 'Nov/26 (Proj)', 'Dez/26 (Proj)'];
    const empenhadoReal = [10934866, 9447111, 6334337, 4630203, 6397729, 7359855, 4864197, 4539911, 5683784, 6327951, Math.round(projecaoMensal * 0.95), Math.round(projecaoMensal * 1.05)];
    const liquidadoReal = [5002210, 5572517, 6193390, 5498045, 6348585, 7287801, 6710780, 5252001, 6589527, 6131455, projecaoMensal, projecaoMensal];
    const pagoBrutoReal = [4176888, 6651247, 6298820, 7626624, 7243805, 8053208, 4985498, 4927758, 10043975, 6611607, Math.round(projecaoMensal * 0.98), Math.round(projecaoMensal * 1.10)];

    chartEvolucaoInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'line', label: 'Liquidado Mensal + Simulação (R$)', data: liquidadoReal, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.15)', borderWidth: 3, tension: 0.3, fill: true },
                { type: 'bar', label: 'Empenhado no Mês (R$)', data: empenhadoReal, backgroundColor: '#0f172a', borderRadius: 4 },
                { type: 'bar', label: 'Pago Bruto no Mês (R$)', data: pagoBrutoReal, backgroundColor: '#3b82f6', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatarBRL(c.raw)}` } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (v / 1000000).toFixed(1) + ' Mi' } }
            }
        }
    });
}

function renderizarGraficos(dotacoes) {
    const cFontes = document.getElementById('chartFontes');
    const cBlocos = document.getElementById('chartBlocos');
    if (!cFontes || !cBlocos) return;

    const ctxFontes = cFontes.getContext('2d');
    const ctxBlocos = cBlocos.getContext('2d');
    if (chartFontesInstance) chartFontesInstance.destroy();
    if (chartBlocosInstance) chartBlocosInstance.destroy();

    const porAcao = {};
    dotacoes.forEach(d => {
        const k = d.acao.slice(0, 26);
        if (!porAcao[k]) porAcao[k] = { emp: 0, res: 0, livre: 0 };
        porAcao[k].emp += d.empenhado;
        porAcao[k].res += d.reservado;
        porAcao[k].livre += d.saldo_reserva;
    });
    const labels = Object.keys(porAcao).slice(0, 6);

    chartFontesInstance = new Chart(ctxFontes, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Empenhado', data: labels.map(k => porAcao[k].emp), backgroundColor: '#0f172a', borderRadius: 4 },
                { label: 'Reservado', data: labels.map(k => porAcao[k].res), backgroundColor: '#f59e0b', borderRadius: 4 },
                { label: 'Livre Real', data: labels.map(k => porAcao[k].livre), backgroundColor: '#10b981', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatarBRL(c.raw)}` } }
            },
            scales: { y: { ticks: { callback: (v) => 'R$ ' + (v / 1000000).toFixed(1) + 'M' } } }
        }
    });

    const somaLivreTotal = dotacoes.reduce((a, b) => a + b.saldo_reserva, 0);
    const somaReservadoTotal = dotacoes.reduce((a, b) => a + b.reservado, 0);
    const somaParados = auditoriaParadosDB.reduce((a, b) => a + b.saldo, 0);

    chartBlocosInstance = new Chart(ctxBlocos, {
        type: 'doughnut',
        data: {
            labels: [
                'Pago Líquido (R$ 59,86 Mi)',
                'Na Tesouraria / Retenções (R$ 1,45 Mi)',
                'Aberto a Liquidar Ativo (R$ 6,25 Mi)',
                `Empenhos Parados (${formatarBRL(somaParados)})`,
                `Reservado Licitação (${formatarBRL(somaReservadoTotal)})`,
                `Saldo Livre Real (${formatarBRL(somaLivreTotal)})`
            ],
            datasets: [{
                data: [59860654.50, 1455157.35, 6253277.98, somaParados, somaReservadoTotal, somaLivreTotal],
                backgroundColor: ['#0f172a', '#2563eb', '#6366f1', '#e11d48', '#f59e0b', '#10b981']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${formatarBRL(c.raw)}` } }
            }
        }
    });
}

function renderizarResumoExecutivo(dotacoes) {
    const tbody = document.getElementById('tabelaResumoExecutivo');
    if (!tbody) return;

    const ordenacao = document.getElementById('selectOrdenacaoAba1')?.value || 'NUMERICA';
    let lista = [...dotacoes];
    if (ordenacao === 'ALFABETICA') {
        lista.sort((a, b) => a.acao.localeCompare(b.acao, 'pt-BR'));
    } else if (ordenacao === 'SALDO_DESC') {
        lista.sort((a, b) => b.saldo_reserva - a.saldo_reserva);
    } else {
        lista.sort((a, b) => a.ref - b.ref);
    }

    const contEl = document.getElementById('contadorRefsTabela');
    if (contEl) contEl.textContent = `Exibindo ${lista.length} dotações (Refs)`;

    const somaAtualizado = dotacoes.reduce((a, b) => a + b.atualizado, 0);
    const somaEmp = dotacoes.reduce((a, b) => a + b.empenhado, 0);
    const somaEmendasLivres = dotacoes.filter(d => d.ehEmenda).reduce((a, b) => a + b.saldo_reserva, 0);
    const somaParados = auditoriaParadosDB.reduce((a, b) => a + b.saldo, 0);

    const kpiOrc = document.getElementById('kpiOrcadoAtual');
    const kpiSub = document.getElementById('kpiSubOrcado');
    const kpiEme = document.getElementById('kpiEmendasLivres');
    const kpiPar = document.getElementById('kpiParadosTopo');

    if (kpiOrc) kpiOrc.textContent = formatarBRL(somaAtualizado);
    if (kpiSub) kpiSub.innerHTML = `Empenhado: <strong>${formatarBRL(somaEmp)}</strong> (Clique p/ abrir)`;
    if (kpiEme) kpiEme.textContent = formatarBRL(somaEmendasLivres);
    if (kpiPar) kpiPar.textContent = formatarBRL(somaParados);

    tbody.innerHTML = lista.map(d => {
        const badges = d.permissoesTags.map(t => `<span class="inline-block bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 mb-0.5">${t}</span>`).join('');
        return `
            <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-3 whitespace-nowrap">${gerarBadgeRefComPopover(d.ref)}</td>
                <td class="py-2.5 px-3 font-medium text-slate-800 max-w-[210px] truncate" title="${d.acao}">${d.acao}</td>
                <td class="py-2.5 px-3 text-slate-600 max-w-[220px] truncate" title="${d.tituloEmendaCustom || d.vinculo_desc}">${d.tituloEmendaCustom || d.vinculo_desc}</td>
                <td class="py-2.5 px-3">${badges}</td>
                <td class="py-2.5 px-3 text-right font-medium">${formatarBRL(d.atualizado)}</td>
                <td class="py-2.5 px-3 text-right text-slate-600">${formatarBRL(d.empenhado)}</td>
                <td class="py-2.5 px-3 text-right text-amber-700 font-medium">${formatarBRL(d.reservado)}</td>
                <td class="py-2.5 px-3 text-right font-extrabold ${d.saldo_reserva <= 1000 ? 'text-rose-600' : 'text-emerald-600'}">${formatarBRL(d.saldo_reserva)}</td>
            </tr>
        `;
    }).join('');
}

// =========================================================================
// 7. ABA 2: ONDE POSSO GASTAR? (COM DRILL-DOWN SEMPRE FECHADO POR PADRÃO)
// =========================================================================
function selecionarChipPermissao(tag, btnEl) {
    tagPermissaoAtiva = tag;
    document.querySelectorAll('.chip-permissao').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    filtrarAbaDotacoes();
}

function limparBuscaPermissao() {
    const inp = document.getElementById('inputBuscaNecessidade');
    const sel = document.getElementById('selectApenasComSaldo');
    if (inp) inp.value = '';
    if (sel) sel.value = 'TODAS';
    selecionarChipPermissao('TODOS', document.querySelector('#containerChipsPermissao button'));
}

function filtrarAbaDotacoes() {
    const base = obterDotacoesFiltroGlobal();
    const rawTermo = document.getElementById('inputBuscaNecessidade')?.value.trim() || '';
    const termo = normalizarTexto(rawTermo).replace(/\bgase\b/g, 'gaze');
    const modoSaldo = document.getElementById('selectApenasComSaldo')?.value || 'COM_SALDO';
    const ordenacao = document.getElementById('selectOrdenacaoAba2')?.value || 'SALDO_DESC';
    const boxResumo = document.getElementById('resumoBuscaNecessidade');

    let filtradas = base.filter(d => {
        const matchTag = tagPermissaoAtiva === 'TODOS' || d.permissoesTags.some(t => t.includes(tagPermissaoAtiva) || tagPermissaoAtiva.includes(t));
        // Busca apenas no texto positivo (regraPode + tagsBusca + metadados da dotação), NUNCA no texto de vedação (regraNaoPode)!
        const texto = normalizarTexto(`Ref ${d.ref} ${d.acao} ${d.vinculo_desc} ${d.tituloEmendaCustom || ''} ${d.regraPode} ${d.tagsBusca || ''} ${d.permissoesTags.join(' ')}`).replace(/\bgase\b/g, 'gaze');
        const matchTermo = !termo || texto.includes(termo);
        const matchSaldo = modoSaldo === 'TODAS' || d.saldo_reserva > 100;
        return matchTag && matchTermo && matchSaldo;
    });

    if (ordenacao === 'ALFABETICA') {
        filtradas.sort((a, b) => (a.tituloEmendaCustom || a.acao).localeCompare(b.tituloEmendaCustom || b.acao, 'pt-BR'));
    } else if (ordenacao === 'NUMERICA') {
        filtradas.sort((a, b) => a.ref - b.ref);
    } else {
        filtradas.sort((a, b) => b.saldo_reserva - a.saldo_reserva);
    }

    const somaRealLivre = filtradas.reduce((acc, curr) => acc + curr.saldo_reserva, 0);

    if (boxResumo) {
        boxResumo.classList.remove('hidden');
        boxResumo.innerHTML = `
            <div>🔎 <strong>${filtradas.length} Dotações (Refs) compatíveis encontradas</strong> • Soma Livre Real p/ Reserva: <strong class="text-emerald-700 text-sm">${formatarBRL(somaRealLivre)}</strong></div>
            <div class="text-[11px] text-blue-700 font-semibold">💡 Clique em "Abrir Detalhes" na dotação desejada para ver o que pode comprar.</div>
        `;
    }

    const container = document.getElementById('listaCardsDotacoes');
    if (!container) return;

    container.innerHTML = filtradas.map(d => {
        const chips = d.permissoesTags.map(t => `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">✓ ${t}</span>`).join('');
        const idCollapse = `collapse-dotacao-${d.ref}`;

        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3 print-shadow-none">
                <div class="p-5 border-l-4 ${d.saldo_reserva > 1000 ? 'border-emerald-500' : 'border-rose-400'}">
                    <div class="flex flex-wrap justify-between items-start gap-4">
                        <div class="flex-1 space-y-1.5 cursor-pointer" onclick="document.getElementById('${idCollapse}').classList.toggle('hidden')">
                            <div class="flex flex-wrap items-center gap-2">
                                ${gerarBadgeRefComPopover(d.ref)}
                                <span class="text-sm font-extrabold text-slate-900">${d.tituloEmendaCustom || d.acao}</span>
                            </div>
                            <p class="text-xs font-semibold text-slate-600">Ação: ${d.acao} • Vínculo: ${d.vinculo_desc}</p>
                            <div class="flex flex-wrap gap-1.5 pt-1">${chips}</div>
                        </div>
                        <div class="text-right bg-slate-50 p-3 rounded-xl border border-slate-200 min-w-[190px]">
                            <span class="text-[11px] text-slate-500 block">Atualizado: ${formatarBRL(d.atualizado)}</span>
                            <span class="text-[11px] text-amber-700 font-semibold block">Reservado: ${formatarBRL(d.reservado)}</span>
                            <span class="text-base font-extrabold ${d.saldo_reserva <= 100 ? 'text-rose-600' : 'text-emerald-600'} mt-1 block border-t border-slate-200 pt-1">Livre: ${formatarBRL(d.saldo_reserva)}</span>
                        </div>
                    </div>

                    <div class="mt-4 flex flex-wrap gap-2 no-print">
                        <button onclick="document.getElementById('${idCollapse}').classList.toggle('hidden')" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                            <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-emerald-400"></i> Abrir Detalhes (O que pode / não pode comprar)
                        </button>
                        <button onclick="abrirModalEdicao(${d.ref})" class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Editar Itens / Adicionar Permissão (Contabilidade)
                        </button>
                    </div>
                </div>

                <div id="${idCollapse}" class="hidden bg-slate-50 border-t border-slate-200 p-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-lg">
                            <strong class="text-emerald-900 block mb-1 text-xs uppercase">✅ O QUE PODE COMPRAR / PAGAR NESTA DOTAÇÃO:</strong>
                            <span class="text-emerald-800 leading-relaxed font-medium block">${d.regraPode}</span>
                        </div>
                        <div class="bg-rose-50 border border-rose-200 p-3 rounded-lg">
                            <strong class="text-rose-900 block mb-1 text-xs uppercase">🚫 O QUE NÃO PODE COMPRAR (VEDAÇÃO):</strong>
                            <span class="text-rose-800 leading-relaxed font-medium block">${d.regraNaoPode}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function simularCompra() {}

// =========================================================================
// 8. ABA 3: RENDERIZADOR DE EMENDAS PARLAMENTARES (SEMPRE FECHADO POR PADRÃO)
// =========================================================================
function renderizarEmendas() {
    const dotacoes = obterDotacoesFiltroGlobal();
    const rawBusca = document.getElementById('inputBuscaEmenda')?.value || '';
    const busca = normalizarTexto(rawBusca).replace(/\bgase\b/g, 'gaze');
    const filtroEsfera = document.getElementById('selectFiltroEsferaEmenda')?.value || 'TODAS';
    const ordenacao = document.getElementById('selectOrdenacaoEmendas')?.value || 'SALDO_DESC';

    const emendas = dotacoes.filter(d => d.ehEmenda);
    const agrupadas = {};

    emendas.forEach(e => {
        const info = classificarPermissoesDotacao(e.ref, e.acao, e.modalidade, e.vinculo_desc, e.vinculo_cod);
        const key = info.tituloEmendaCustom || e.vinculo_desc;
        if (!agrupadas[key]) {
            agrupadas[key] = {
                vinculo: key,
                numOrdem: e.ref,
                esfera: String(e.vinculo_cod).startsWith('15007011') || String(e.vinculo_cod).startsWith('2500') ? 'MUNICIPAL' : 'FEDERAL_ESTADUAL',
                refs: [],
                totalAtualizado: 0,
                totalLivre: 0,
                tagsGlobais: new Set()
            };
        }
        agrupadas[key].refs.push({ ...e, regraPode: info.regraPode, regraNaoPode: info.regraNaoPode, permissoesTags: info.tags, tagsBusca: info.tagsBusca || '' });
        agrupadas[key].totalAtualizado += e.atualizado;
        agrupadas[key].totalLivre += e.saldo_reserva;
        info.tags.forEach(t => agrupadas[key].tagsGlobais.add(t));
    });

    emendasImpositivas2025.forEach(imp => {
        const codEsperado = '150070112' + imp.num;
        const existeNoIPM = dotacoesDB.some(d => String(d.vinculo_cod) === codEsperado);
        if (!existeNoIPM) {
            const key = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario} (⚠️ Aguardando Dotação IPM)`;
            agrupadas[key] = {
                vinculo: key,
                numOrdem: parseInt(imp.num, 10) || 999,
                esfera: 'MUNICIPAL',
                totalAtualizado: imp.valor,
                totalLivre: imp.valor,
                tagsGlobais: new Set([`Vereador(a): ${imp.autor}`, `Destino: ${imp.beneficiario}`, `Natureza: ${imp.natureza}`, `⚠️ Sem Ref no CSV IPM`]),
                refs: [{
                    ref: 'Pendente IPM',
                    acao: `Ação ${imp.acao} (${imp.beneficiario})`,
                    atualizado: imp.valor,
                    empenhado: 0,
                    saldo_reserva: imp.valor,
                    permissoesTags: [imp.natureza],
                    regraPode: imp.pode,
                    regraNaoPode: imp.naoPode,
                    tagsBusca: `${imp.autor} ${imp.beneficiario} ${imp.pode}`
                }]
            };
        }
    });

    propostasFNSReais.forEach((p, idxP) => {
        const key = `🇧🇷 [FNS ${p.ano}] ${p.parlamentar} — ${p.objeto} (Proposta nº ${p.numero})`;
        agrupadas[key] = {
            vinculo: key,
            numOrdem: 1000 + idxP,
            esfera: 'FNS_PDF',
            totalAtualizado: p.valor,
            totalLivre: p.valor,
            tagsGlobais: new Set([`Ano: ${p.ano}`, p.emenda, p.status, p.natureza]),
            refs: [{
                ref: `FNS ${p.ano}`,
                acao: `${p.objeto} • Natureza: ${p.natureza}`,
                atualizado: p.valor,
                empenhado: 0,
                saldo_reserva: p.valor,
                permissoesTags: [p.natureza, p.status],
                regraPode: p.pode,
                regraNaoPode: p.naoPode,
                tagsBusca: `${p.parlamentar} ${p.objeto} ${p.pode}`
            }]
        };
    });

    let listaFiltrada = Object.values(agrupadas).filter(g => {
        const matchEsfera = filtroEsfera === 'TODAS' || g.esfera === filtroEsfera;
        if (!matchEsfera) return false;
        if (!busca) return true;
        const txtGrupo = normalizarTexto(`${g.vinculo} ${Array.from(g.tagsGlobais).join(' ')} ${g.refs.map(r => (r.regraPode || '') + ' ' + r.ref + ' ' + (r.tagsBusca || '')).join(' ')}`).replace(/\bgase\b/g, 'gaze');
        return txtGrupo.includes(busca);
    });

    if (ordenacao === 'ALFABETICA') {
        listaFiltrada.sort((a, b) => a.vinculo.localeCompare(b.vinculo, 'pt-BR'));
    } else if (ordenacao === 'NUMERICA') {
        listaFiltrada.sort((a, b) => (a.numOrdem || 999) - (b.numOrdem || 999));
    } else {
        listaFiltrada.sort((a, b) => b.totalLivre - a.totalLivre);
    }

    const container = document.getElementById('containerEmendasAcordeon');
    if (!container) return;

    container.innerHTML = listaFiltrada.map((grupo, idx) => {
        const idCollapse = `collapse-emenda-${idx}`;
        const tagsHTML = Array.from(grupo.tagsGlobais).map(t => `<span class="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded text-[10px] font-bold">${t}</span>`).join('');

        const refsHTML = grupo.refs.map(r => `
            <div class="flex flex-wrap md:flex-nowrap items-start justify-between gap-4 p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition">
                <div class="flex-1 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                        ${typeof r.ref === 'number' ? gerarBadgeRefComPopover(r.ref) : `<span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-extrabold text-xs">${r.ref}</span>`}
                        <span class="text-xs font-bold text-slate-800">${r.acao}</span>
                        ${typeof r.ref === 'number' ? `<button onclick="abrirModalEdicao(${r.ref})" class="ml-auto px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-bold flex items-center gap-1 no-print"><i data-lucide="edit-3" class="w-3 h-3"></i> Editar Itens</button>` : ''}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                        <div class="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-xs">
                            <strong class="text-emerald-900 block mb-1">✅ O QUE PODE COMPRAR / PAGAR (JUSTIFICATIVA E OBJETO):</strong>
                            <span class="text-emerald-800 leading-relaxed">${r.regraPode}</span>
                        </div>
                        <div class="bg-rose-50 border border-rose-200 p-2.5 rounded-lg text-xs">
                            <strong class="text-rose-900 block mb-1">🚫 O QUE NÃO PODE COMPRAR (VEDAÇÃO):</strong>
                            <span class="text-rose-800 leading-relaxed">${r.regraNaoPode}</span>
                        </div>
                    </div>
                </div>
                <div class="text-right bg-white border border-slate-200 p-2.5 rounded-lg min-w-[175px]">
                    <span class="text-[11px] text-slate-500 block">Valor: ${formatarBRL(r.atualizado)}</span>
                    <span class="text-[11px] text-slate-500 block">Empenhado: ${formatarBRL(r.empenhado)}</span>
                    <span class="text-xs font-extrabold text-emerald-600 mt-1 block border-t border-slate-100 pt-1">Disponível: ${formatarBRL(r.saldo_reserva)}</span>
                </div>
            </div>
        `).join('');

        return `
            <div class="border border-slate-200 rounded-xl overflow-hidden mb-3 bg-white shadow-sm">
                <button onclick="document.getElementById('${idCollapse}').classList.toggle('hidden')" class="w-full text-left px-5 py-4 bg-slate-50 hover:bg-slate-100 flex flex-wrap items-center justify-between gap-4 transition">
                    <div class="flex-1">
                        <h4 class="font-extrabold text-slate-900 text-sm">${grupo.vinculo}</h4>
                        <div class="flex flex-wrap gap-1.5 mt-2">${tagsHTML}</div>
                    </div>
                    <div class="text-right">
                        <span class="text-xs text-slate-500 block">Valor Global: ${formatarBRL(grupo.totalAtualizado)}</span>
                        <span class="text-sm font-extrabold text-amber-600 block">Saldo / Valor: ${formatarBRL(grupo.totalLivre)}</span>
                    </div>
                    <i data-lucide="chevron-down" class="w-5 h-5 text-slate-400"></i>
                </button>
                <div id="${idCollapse}" class="hidden bg-white border-t border-slate-200">
                    <div class="p-2 bg-slate-900 text-white text-[11px] font-bold uppercase text-center tracking-wider">Detalhamento Completo do Plano de Trabalho (O que Pode e Não Pode Comprar)</div>
                    ${refsHTML}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 9. ABA 4: CONTRATOS E FILA DA TESOURARIA (COM BUSCA E ORDENAÇÃO PADRÃO)
// =========================================================================
function filtrarContratos(modo) {
    filtroSituacaoContratoAtivo = modo;
    renderizarFixos();
}

function renderizarFixos() {
    const tbody = document.getElementById('tabelaFixosBody');
    if (!tbody) return;

    const busca = normalizarTexto(document.getElementById('inputBuscaContratos')?.value || '');
    const ordenacao = document.getElementById('selectOrdenacaoContratos')?.value || 'VALOR_DESC';

    let filtrados = contratosCruzadosDB.filter(c => {
        const matchModo = filtroSituacaoContratoAtivo === 'TODOS'
            ? true
            : (filtroSituacaoContratoAtivo === 'VENCENDO' ? c.diasVig <= 45 : c.categoriaStatus === filtroSituacaoContratoAtivo);
        const matchBusca = !busca || normalizarTexto(`${c.num} ${c.fornecedor} ${c.objeto} ${c.diagnostico} ${c.refs.join(' ')}`).includes(busca);
        return matchModo && matchBusca;
    });

    if (ordenacao === 'ALFABETICA') {
        filtrados.sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, 'pt-BR'));
    } else if (ordenacao === 'VIGENCIA_ASC') {
        filtrados.sort((a, b) => a.diasVig - b.diasVig);
    } else {
        filtrados.sort((a, b) => b.saldoLiquidar - a.saldoLiquidar);
    }

    tbody.innerHTML = filtrados.map(c => {
        const msg = encodeURIComponent(`Olá! Passando pelo setor de Compras/Gestão da Saúde de Imbituba referente ao Contrato *${c.num}* (*${c.fornecedor}*). Verificamos que o *${c.empAberto}* (Ref. ${c.refs.join('/')}) consta com diagnóstico: *${c.diagnostico}*. Consegue verificar para seguirmos com o fluxo?`);
        const badgeCor = c.categoriaStatus === 'NA_TESOURARIA' ? 'bg-blue-100 text-blue-800 border-blue-300' : (c.categoriaStatus === 'VENCENDO' ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-amber-100 text-amber-800 border-amber-300');
        const refsHTML = c.refs.map(r => gerarBadgeRefComPopover(r)).join(' ');

        return `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-3">
                    <div class="font-extrabold text-slate-900">Nº ${c.num}</div>
                    <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold">${c.especie}</span>
                </td>
                <td class="py-3 px-3 max-w-[250px]">
                    <div class="font-bold text-slate-900">${c.fornecedor}</div>
                    <div class="text-slate-500 text-[11px] line-clamp-2">${c.objeto}</div>
                </td>
                <td class="py-3 px-3 whitespace-nowrap">
                    <div class="font-bold ${c.diasVig <= 45 ? 'text-rose-600' : 'text-slate-700'}">${c.vigFim}</div>
                    <span class="text-[10px] ${c.diasVig <= 45 ? 'bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded' : 'text-slate-400'}">${c.diasVig} dias</span>
                </td>
                <td class="py-3 px-3 whitespace-nowrap">
                    <div class="font-bold text-slate-800 mb-1">${c.empAberto}</div>
                    <div class="flex flex-wrap gap-1">${refsHTML}</div>
                </td>
                <td class="py-3 px-3 text-right font-extrabold text-slate-900 whitespace-nowrap">${formatarBRL(c.saldoLiquidar)}</td>
                <td class="py-3 px-3 whitespace-nowrap text-[11px]">
                    <div><span class="text-slate-400">Liq:</span> <strong class="text-slate-800">${c.ultLiq}</strong></div>
                    <div><span class="text-slate-400">Pag:</span> <span class="text-slate-600">${c.ultPag}</span></div>
                </td>
                <td class="py-3 px-3 max-w-[230px]">
                    <span class="inline-block px-2.5 py-1 rounded-lg border text-[11px] font-bold ${badgeCor}">${c.diagnostico}</span>
                </td>
                <td class="py-3 px-3 text-right no-print whitespace-nowrap">
                    <a href="https://wa.me/55${c.whats}?text=${msg}" target="_blank" class="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg font-semibold text-xs shadow-sm transition">
                        <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> WhatsApp
                    </a>
                </td>
            </tr>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 10. ABA 5: AUDITORIA DE EMPENHOS PARADOS (COM BUSCA E ORDENAÇÃO PADRÃO)
// =========================================================================
function sincronizarInputAuditoria(valorDigitado) {
    const sel = document.getElementById('filtroRefAuditoriaSelect');
    const limpo = valorDigitado.replace(/\D/g, '');
    if (sel) {
        if ([...sel.options].some(o => o.value === limpo)) {
            sel.value = limpo;
        } else {
            sel.value = '';
        }
    }
    renderizarAuditoria();
}

function selecionarDropdownAuditoria(valorSel) {
    const inp = document.getElementById('inputBuscaRefAuditoria');
    if (inp) inp.value = valorSel;
    renderizarAuditoria();
}

function limparFiltroAuditoria() {
    const inp = document.getElementById('inputBuscaRefAuditoria');
    const sel = document.getElementById('filtroRefAuditoriaSelect');
    if (inp) inp.value = '';
    if (sel) sel.value = '';
    renderizarAuditoria();
}

function renderizarAuditoria() {
    const tbody = document.getElementById('tabelaAuditoriaBody');
    if (!tbody) return;

    const rawInput = document.getElementById('inputBuscaRefAuditoria')?.value.trim() || '';
    const apenasDigitos = /^\d+$/.test(rawInput);
    const termoTexto = normalizarTexto(rawInput);
    const ordenacao = document.getElementById('selectOrdenacaoAuditoria')?.value || 'VALOR_DESC';

    let filtrados = auditoriaParadosDB.filter(r => {
        if (!rawInput) return true;
        if (apenasDigitos) return String(r.ref) === rawInput || String(r.emp).includes(rawInput);
        return normalizarTexto(`${r.credor} ${r.emp} Ref ${r.ref} ${r.acao}`).includes(termoTexto);
    });

    if (ordenacao === 'ALFABETICA') {
        filtrados.sort((a, b) => a.credor.localeCompare(b.credor, 'pt-BR'));
    } else if (ordenacao === 'NUMERICA') {
        filtrados.sort((a, b) => a.ref - b.ref);
    } else if (ordenacao === 'DIAS_DESC') {
        filtrados.sort((a, b) => b.dias - a.dias);
    } else {
        filtrados.sort((a, b) => b.saldo - a.saldo);
    }

    const somaPresa = filtrados.reduce((a, b) => a + b.saldo, 0);
    const qtdNunca = filtrados.filter(x => x.ultLiq === 'Nunca liq.').length;
    const qtdParcial = filtrados.filter(x => x.ultLiq !== 'Nunca liq.').length;

    const elVal = document.getElementById('kpiAuditoriaValor');
    const elSub = document.getElementById('kpiAuditoriaSubValor');
    const elNun = document.getElementById('kpiAuditoriaNunca');
    const elPar = document.getElementById('kpiAuditoriaParcial');

    if (elVal) elVal.textContent = formatarBRL(somaPresa);
    if (elSub) elSub.textContent = rawInput
        ? `Filtro ativo: "${rawInput}" (${filtrados.length} empenhos encontrados)`
        : `Exibindo todos os ${filtrados.length} empenhos auditados`;
    if (elNun) elNun.textContent = `${qtdNunca} empenho(s)`;
    if (elPar) elPar.textContent = `${qtdParcial} empenho(s)`;

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500 font-semibold">Nenhum empenho parado encontrado para "${rawInput}". Clique em "Ver Todas".</td></tr>`;
        return;
    }

    tbody.innerHTML = filtrados.map(r => `
        <tr class="hover:bg-slate-50">
            <td class="py-3 px-3 whitespace-nowrap">
                <div class="font-extrabold text-slate-900">Emp. ${r.emp}</div>
                <span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${r.especie}</span>
            </td>
            <td class="py-3 px-3 whitespace-nowrap">
                ${gerarBadgeRefComPopover(r.ref)}
            </td>
            <td class="py-3 px-3 font-bold text-slate-800">${r.credor}</td>
            <td class="py-3 px-3 text-slate-600 text-[11px] whitespace-nowrap">
                <div>Emissão: <strong>${r.emissao}</strong></div>
                <div>Últ. Liq: <strong class="${r.ultLiq === 'Nunca liq.' ? 'text-rose-600' : 'text-amber-700'}">${r.ultLiq}</strong> (${r.dias}d)</div>
            </td>
            <td class="py-3 px-3 text-right font-semibold text-slate-600 whitespace-nowrap">${formatarBRL(r.empenhadoTotal || r.saldo)}</td>
            <td class="py-3 px-3 text-right font-extrabold text-rose-600 text-sm whitespace-nowrap">${formatarBRL(r.saldo)}</td>
            <td class="py-3 px-3 text-slate-700 font-medium">
                <span class="inline-block px-2.5 py-1 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 font-semibold">${r.acao}</span>
            </td>
        </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 11. ABA 6: LEITORES SEMANAIS IPM + RADAR FNS
// =========================================================================
async function processarCSVSaldoDotacaoReal(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        const linhas = e.target.result.split(/\r?\n/);
        const novas = [];
        let acaoAtual = '', vincDescAtual = '';
        for (let l of linhas) {
            if (!l.trim()) continue;
            const cols = l.split(';').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols[0] === 'Resumo por Vínculo') break;
            if (cols[0].startsWith('Ação:')) acaoAtual = cols[0].replace('Ação:', '').trim();
            else if (cols[0].startsWith('Vínculo')) vincDescAtual = cols[0].replace(/^Vínculo\s*:\s*/, '').trim();
            else if (/^\d+$/.test(cols[0]) && cols.length >= 10) {
                const orc = brToFloat(cols[3]), atu = brToFloat(cols[4]);
                if (orc > 0 || atu > 0) {
                    novas.push({
                        ref: parseInt(cols[0], 10),
                        acao: acaoAtual,
                        acao_num: acaoAtual.split(' - ')[0].trim(),
                        modalidade: cols[1],
                        mod_cod: cols[1].split(' - ')[0].trim(),
                        vinculo_cod: cols[2],
                        vinculo_desc: vincDescAtual,
                        orcado: orc,
                        atualizado: atu,
                        empenhado: brToFloat(cols[6]),
                        reservado: brToFloat(cols[7]),
                        saldo_empenho: brToFloat(cols[8]),
                        saldo_reserva: brToFloat(cols[9])
                    });
                }
            }
        }
        if (novas.length > 0) {
            const agora = new Date().toLocaleString('pt-BR');
            localStorage.setItem(STORAGE_KEYS.DOTACOES, JSON.stringify(novas));
            localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);

            let msgSupa = 'Salvo no navegador (LocalStorage)';
            if (supabaseAtivo) {
                const { error } = await supabase.from('dotacoes_orcamentarias').upsert(novas, { onConflict: 'ref' });
                if (!error) msgSupa = 'Salvo no Banco de Dados Nuvem (Supabase) e no Navegador';
            }

            construirBaseDotacoes(novas);
            popularFiltrosGlobais();
            renderizarTudo();
            document.getElementById('badgeStatusTopo').textContent = `💾 Atualizado em ${agora}`;
            document.getElementById('logImportacao').innerHTML += `<div>[OK - ${agora}] Saldo Dotacao.csv carregado (${novas.length} Refs) -> ${msgSupa}!</div>`;
        }
    };
    reader.readAsText(input.files[0], 'ISO-8859-1');
}

async function processarCSVEmpenhosLiquidarReal(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        const linhas = e.target.result.split(/\r?\n/);
        const novos = [];
        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].split(';').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length >= 9 && cols[0] && !cols[0].startsWith('Total')) {
                const empTot = brToFloat(cols[6]);
                const liqTot = brToFloat(cols[7]);
                const saldoLiq = brToFloat(cols[8]);
                const partesDot = cols[2].split('.');
                const acaoNum = partesDot[5] || '';
                const modCod = partesDot[6] || '';
                const vincCod = cols[3];
                const dotMatch = dotacoesDB.find(d => d.acao.startsWith(acaoNum) && d.modalidade.startsWith(modCod) && d.vinculo_cod === vincCod);
                const refNum = dotMatch ? dotMatch.ref : parseInt(acaoNum || '0', 10);

                novos.push({
                    emp: cols[0],
                    especie: cols[1],
                    ref: refNum,
                    credor: cols[5],
                    emissao: cols[4],
                    ultLiq: liqTot === 0 ? 'Nunca liq.' : 'Parcial',
                    empenhadoTotal: empTot,
                    saldo: saldoLiq,
                    dias: 60,
                    acao: liqTot === 0
                        ? `🚨 Nunca teve liquidação (R$ 0,00 liquidado de ${formatarBRL(empTot)}). Cobrar entrega/NF ou estornar para liberar ${formatarBRL(saldoLiq)} na Ref. ${refNum}!`
                        : `⏳ Liquidado parcialmente (${formatarBRL(liqTot)}). Restam ${formatarBRL(saldoLiq)} presos na Ref. ${refNum}.`
                });
            }
        }
        if (novos.length > 0) {
            const agora = new Date().toLocaleString('pt-BR');
            auditoriaParadosDB = novos.sort((a, b) => b.saldo - a.saldo);
            localStorage.setItem(STORAGE_KEYS.AUDITORIA, JSON.stringify(auditoriaParadosDB));
            localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);

            let msgSupa = 'Salvo no navegador (LocalStorage)';
            if (supabaseAtivo) {
                const payloadSupa = auditoriaParadosDB.map(a => ({
                    emp: a.emp, especie: a.especie, ref: a.ref || null, credor: a.credor,
                    emissao: a.emissao, ult_liq: a.ultLiq, empenhado_total: a.empenhadoTotal,
                    saldo: a.saldo, dias: a.dias, acao: a.acao
                }));
                const { error } = await supabase.from('auditoria_empenhos_parados').upsert(payloadSupa, { onConflict: 'emp' });
                if (!error) msgSupa = 'Salvo no Supabase e no Navegador';
            }

            popularFiltrosGlobais();
            renderizarTudo();
            document.getElementById('badgeStatusTopo').textContent = `💾 Atualizado em ${agora}`;
            document.getElementById('logImportacao').innerHTML += `<div>[OK - ${agora}] Empenhos Liquidar.csv (${novos.length} empenhos) -> ${msgSupa}!</div>`;
        }
    };
    reader.readAsText(input.files[0], 'ISO-8859-1');
}

function processarJSONContratosReal(input) {
    if (!input.files || !input.files[0]) return;
    const agora = new Date().toLocaleString('pt-BR');
    localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);
    document.getElementById('logImportacao').innerHTML += `<div>[OK - ${agora}] Relatorio (3).json sincronizado e salvo!</div>`;
}

async function sincronizarFNSAutomatico() {
    const btn = document.getElementById('btnSyncFNS');
    const log = document.getElementById('logImportacao');
    if (!btn || !log) return;

    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Sincronizando 24 Propostas FNS + 65 Impositivas...`;
    btn.classList.add('opacity-70', 'cursor-not-allowed');

    setTimeout(() => {
        const somaFNS = propostasFNSReais.reduce((a, b) => a + b.valor, 0);
        let tabelaFNS = `<div class="mt-4 mb-4 bg-slate-800 border border-emerald-500/50 rounded-lg overflow-hidden shadow-lg">
            <div class="bg-emerald-900/50 px-4 py-3 border-b border-emerald-500/30 flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="satellite" class="w-5 h-5 text-emerald-400"></i>
                    <span class="font-extrabold text-emerald-400 text-sm">Radar FNS (24 Propostas = ${formatarBRL(somaFNS)}) + 65 Emendas Impositivas Mapeadas</span>
                </div>
            </div>
            <div class="overflow-x-auto max-h-[460px]">
                <table class="w-full text-left text-xs text-slate-300">
                    <thead class="bg-slate-900 text-slate-400 uppercase sticky top-0">
                        <tr>
                            <th class="py-2.5 px-3">Ano / Proposta</th>
                            <th class="py-2.5 px-3">Emenda / Origem</th>
                            <th class="py-2.5 px-3">Objeto & O Que Pode Comprar</th>
                            <th class="py-2.5 px-3 text-right">Valor (R$)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700/50">
                        ${propostasFNSReais.map(p => `
                            <tr class="hover:bg-slate-700/30 transition">
                                <td class="py-3 px-3 font-bold text-slate-200 whitespace-nowrap">${p.ano}<div class="text-[10px] text-slate-400 font-mono">${p.numero}</div></td>
                                <td class="py-3 px-3 font-bold text-amber-300 whitespace-nowrap">${p.emenda}<div class="text-[10px] text-emerald-400">${p.natureza}</div></td>
                                <td class="py-3 px-3 text-white">
                                    <div class="font-bold">${p.objeto}</div>
                                    <div class="text-[11px] text-emerald-300 mt-0.5"><strong>✅ Pode:</strong> ${p.pode}</div>
                                    <div class="text-[11px] text-rose-300 mt-0.5"><strong>🚫 Vedado:</strong> ${p.naoPode}</div>
                                </td>
                                <td class="py-3 px-3 text-right font-extrabold text-emerald-400 whitespace-nowrap">${formatarBRL(p.valor)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

        log.innerHTML = `<div class="text-emerald-300 font-bold mb-2">[FNS SYNC - ${new Date().toLocaleTimeString('pt-BR')}] 24 propostas federais e 65 emendas impositivas sincronizadas!</div>` + tabelaFNS + log.innerHTML;
        btn.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4"></i> Sincronizar Portal FNS (Governo Federal)`;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
        if (window.lucide) lucide.createIcons();
    }, 800);
}

// =========================================================================
// 12. MODAL DE EDIÇÃO DE REGRAS PELA CONTADORA (LOCALSTORAGE + SUPABASE)
// =========================================================================
function abrirModalEdicao(refNum) {
    const d = dotacoesDB.find(x => x.ref === refNum);
    if (!d) return;

    document.getElementById('modalRefHidden').value = refNum;
    document.getElementById('modalEdicaoTitulo').textContent = `Ref. ${refNum} — Editar Itens Permitidos (${d.tituloEmendaCustom || d.vinculo_desc})`;
    document.getElementById('modalInputPode').value = d.regraCustomPode || '';
    document.getElementById('modalInputNaoPode').value = d.regraCustomNaoPode || '';
    document.getElementById('modalEdicaoRegras').classList.remove('hidden');
}

function fecharModalEdicao() {
    document.getElementById('modalEdicaoRegras').classList.add('hidden');
}

async function salvarModalEdicao() {
    const refNum = parseInt(document.getElementById('modalRefHidden').value, 10);
    const txtPode = document.getElementById('modalInputPode').value.trim();
    const txtNaoPode = document.getElementById('modalInputNaoPode').value.trim();

    if (!customRulesDB) customRulesDB = {};
    customRulesDB[refNum] = { pode: txtPode, naoPode: txtNaoPode };

    localStorage.setItem(STORAGE_KEYS.CUSTOM_RULES, JSON.stringify(customRulesDB));

    if (supabaseAtivo) {
        try {
            await supabase
                .from('dotacoes_orcamentarias')
                .update({
                    regra_custom_pode: txtPode,
                    regra_custom_nao_pode: txtNaoPode
                })
                .eq('ref', refNum);
        } catch (err) {
            console.warn('Aviso ao gravar regra customizada no Supabase:', err);
        }
    }

    construirBaseDotacoes(dotacoesDB);
    renderizarTudo();
    fecharModalEdicao();
}

// =========================================================================
// 13. EXPORTAÇÃO PDF / CSV E INICIALIZAÇÃO GLOBAL
// =========================================================================
function gerarPDFRelatorio() {
    const cab = document.getElementById('cabecalhoPDF');
    document.getElementById('dataHoraPDF').textContent = new Date().toLocaleString('pt-BR');
    document.getElementById('blocoSelecionadoPDF').textContent = document.getElementById('filtroBlocoGlobal').value;
    cab.classList.remove('hidden');
    html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `BI_Saude_Imbituba_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }).from(document.getElementById('areaRelatorioPDF')).save().then(() => cab.classList.add('hidden'));
}

function exportarCSVTelaAtual() {
    const abaAtiva = document.querySelector('.tab-content.active');
    const tabela = abaAtiva ? abaAtiva.querySelector('table') : null;
    if (!tabela) { alert('Para exportar os cards visuais desta aba, utilize o botão Relatório PDF.'); return; }
    const csv = Array.from(tabela.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th, td')).map(td => `"${td.innerText.replace(/\n/g, ' ').trim()}"`).join(';')
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `FMS_Imbituba_${abaAtiva.id}.csv`;
    a.click();
}

function renderizarTudo() {
    const filtradas = obterDotacoesFiltroGlobal();
    atualizarGraficoMensal();
    renderizarGraficos(filtradas);
    renderizarResumoExecutivo(filtradas);
    filtrarAbaDotacoes();
    renderizarEmendas();
    renderizarFixos();
    renderizarAuditoria();
    if (window.lucide) lucide.createIcons();
}

Object.assign(window, {
    trocarAba,
    drillDownOrcamento,
    drillDownTesouraria,
    drillDownAuditoria,
    drillDownEmendas,
    atualizarGraficoMensal,
    selecionarChipPermissao,
    limparBuscaPermissao,
    filtrarAbaDotacoes,
    simularCompra,
    renderizarEmendas,
    filtrarContratos,
    renderizarFixos,
    sincronizarInputAuditoria,
    selecionarDropdownAuditoria,
    limparFiltroAuditoria,
    renderizarAuditoria,
    processarCSVSaldoDotacaoReal,
    processarCSVEmpenhosLiquidarReal,
    processarJSONContratosReal,
    baixarArquivoDadosIniciaisAtualizado,
    limparCacheNavegadorVoltarOriginal,
    gerarPDFRelatorio,
    exportarCSVTelaAtual,
    sincronizarFNSAutomatico,
    abrirModalEdicao,
    fecharModalEdicao,
    salvarModalEdicao,
    renderizarTudo
});

window.addEventListener('DOMContentLoaded', () => {
    inicializarBancoDeDados();
    const filtroBloco = document.getElementById('filtroBlocoGlobal');
    const filtroDotacao = document.getElementById('filtroDotacaoGlobal');
    if (filtroBloco) filtroBloco.addEventListener('change', renderizarTudo);
    if (filtroDotacao) filtroDotacao.addEventListener('change', renderizarTudo);
});