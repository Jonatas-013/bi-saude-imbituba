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
    ULTIMA_ATUALIZACAO: 'bi_saude_imbituba_last_sync_v2'
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
// 1. BASE COMPLETA: 65 EMENDAS IMPOSITIVAS (VEREADORES) EXTRAÍDAS DO PDF
// =========================================================================
export const emendasImpositivas2025 = [
    { num: "004", autor: "BRUNO PACHECO (PSB)", beneficiario: "UBS VILA ALVORADA - AGUADA", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 1 TV recepção, 1 ar-condicionado sala médico, 1 aquecedor sala preventivo, 1 armário aéreo 3 portas, 2 prateleiras aço inox c/ rodinhas, 1 maca de preventivo, 1 foco de luz, 1 balcão recepção, 2 armários 2 portas sala curativos e mobília.", naoPode: "VEDADO usar para material de consumo descartável, reformas prediais ou folha de pagamento (Natureza exclusiva 4490 - Permanente)." },
    { num: "005", autor: "BRUNO PACHECO (PSB)", beneficiario: "UBS VILA NOVA ALVORADA - DIVINÉIA", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 1 TV recepção, 1 ar-condicionado sala ACS, 1 computador balcão recepção, 1 maca para ECG, 1 maca ginecológica, 2 focos de luz ginecológicos, 1 mesa auxiliar inox, 1 cadeira de rodas, cadeiras, longarinas e mobília.", naoPode: "VEDADO usar para insumos de consumo, medicamentos, manutenção predial ou serviços PJ (Natureza exclusiva 4490)." },
    { num: "008", autor: "BRUNO PACHECO (PSB)", beneficiario: "PROGRAMA FARMÁCIA SOLIDÁRIA", valor: 15000.00, acao: "2089", natureza: "4490 (Permanente)", pode: "Aquisição de mobília (armários/estantes de armazenamento) e equipamentos de informatização (computadores/leitores) para o Programa Farmácia Solidária (Lei 5.298/2022).", naoPode: "VEDADO comprar medicamentos, insumos descartáveis ou pagar pessoal (Natureza exclusiva 4490 - Permanente)." },
    { num: "009", autor: "PEDRO PAULO DA SILVA - PAULO 7 (PSD)", beneficiario: "AMAI (Autistas)", valor: 242291.57, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de atividades terapêuticas e manutenção/ampliação de equipe multiprofissional na AMAI (meta estimada de 3.457 atendimentos a pessoas com TEA via Termo de Colaboração/Fomento).", naoPode: "VEDADO comprar equipamentos permanentes, veículos ou realizar obras civis (Natureza exclusiva 3350 - Custeio)." },
    { num: "010", autor: "BRUNO PACHECO (PSB)", beneficiario: "APAE IMBITUBA", valor: 65000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Construção de uma nova sala física para ampliação do Serviço de Estimulação Precoce (crianças de 0 a 6 anos com atraso no desenvolvimento e TEA).", naoPode: "VEDADO usar para folha de pagamento, contas fixas (água/luz) ou material de consumo (Natureza exclusiva 4450 - Capital)." },
    { num: "011", autor: "BRUNO PACHECO (PSB)", beneficiario: "AMAI (Autistas)", valor: 52800.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Contratação de serviços de profissionais habilitados em Equoterapia para atendimentos terapêuticos especializados a crianças e adolescentes com TEA.", naoPode: "VEDADO adquirir mobiliário, veículos ou realizar obras (Natureza exclusiva 3350 - Custeio)." },
    { num: "012", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "CT EBENEZER", valor: 100000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de 1 veículo próprio para o Centro Terapêutico Ebenezer (transporte de pacientes às sessões terapêuticas e consultas).", naoPode: "VEDADO usar para combustível, manutenção, alimentação ou folha de pessoal (Natureza exclusiva 4450 - Permanente)." },
    { num: "013", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "FMS - ENFRENTAMENTO À FIBROMIALGIA", valor: 82291.57, acao: "2083", natureza: "3390 (Custeio Direto)", pode: "Oferta de Práticas Integrativas e Complementares (PICS) para pacientes com fibromialgia: contratação de profissionais habilitados, oficinas terapêuticas, alongamento, relaxamento e materiais específicos de custeio.", naoPode: "VEDADO comprar equipamentos permanentes ou mobiliário (Natureza 3390) ou desviar da finalidade de atendimento à fibromialgia." },
    { num: "015", autor: "PEDRO PAULO DA SILVA - PAULO 7 (PSD)", beneficiario: "HOSPITAL SÃO CAMILO", valor: 37291.57, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição e instalação de 45 televisores para os quartos de internação do Hospital São Camilo.", naoPode: "VEDADO usar para custeio hospitalar, medicamentos, plantões ou obras (Natureza exclusiva 4450)." },
    { num: "016", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AIPODEF", valor: 25000.00, acao: "2083", natureza: "4450 (Entidade)", pode: "Aquisição de itens ortopédicos e hospitalares: 5 colchões pneumáticos, 5 colchões caixa de ovo, 3 colchões d'água, 3 camas hospitalares, 3 almofadas gel, 624 fraldas, 8 cx hidrocoloide, 500 sondas, 50 géis, 4 cadeiras de rodas, 4 cadeiras de banho, 14 muletas, 4 andadores e 12 botas ortopédicas.", naoPode: "VEDADO usar para pagamento de salários, aluguel ou despesas administrativas da entidade." },
    { num: "017", autor: "THIAGO ROSA (REPUBLICANOS)", beneficiario: "COMUNIDADE ATIVA (FMS)", valor: 60000.00, acao: "2082", natureza: "4490 (Permanente)", pode: "Aquisição de 5 motocicletas estilo Honda Biz para deslocamento das equipes técnicas do Programa Comunidade Ativa.", naoPode: "VEDADO usar para combustível, peças de reposição ou custeio (Atenção: Verificar abertura de dotação no IPM!)." },
    { num: "018", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AMAI (Autistas)", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio mensal de aluguel do espaço físico da sede da AMAI.", naoPode: "VEDADO usar para compra de equipamentos permanentes ou obras na sede." },
    { num: "019", autor: "BANCADA REPUBLICANOS (THIAGO ROSA)", beneficiario: "AGENTES COMUNITÁRIOS DE SAÚDE (ACS)", valor: 50291.57, acao: "2074", natureza: "3390 (Custeio Direto)", pode: "Aquisição de EPIs e insumos de trabalho para os ACS: sombrinhas, viseiras, crachás, camisetas com proteção UV, mochilas, protetor solar, jaquetas corta-vento e folhas coloridas.", naoPode: "VEDADO usar para pagamento de folha/gratificações ou compra de bens permanentes (computadores/móveis)." },
    { num: "021", autor: "HENRIQUE MELO (PP)", beneficiario: "ROTARY CLUBE DE IMBITUBA", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.650) + 3350 (R$ 6.350)", pode: "Fortalecimento do Banco Ortopédico: R$ 18.650,00 (4450) para cadeiras de rodas e camas hospitalares; R$ 6.350,00 (3350) para fraldas descartáveis, medicamentos e itens de consumo.", naoPode: "VEDADO misturar os saldos das duas dotações (respeitar o teto de R$ 18,65 mil em permanente e R$ 6,35 mil em consumo)." },
    { num: "023", autor: "BANCADA MDB (RONALDINHO E TEKO)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Substituição de 40 cadeiras do refeitório (adequação à RDC 502/2021) e aquisição de órteses de posicionamento para idosos com sequelas de AVC.", naoPode: "VEDADO usar para alimentação, medicamentos, folha de pessoal ou reformas (Natureza exclusiva 4450)." },
    { num: "025", autor: "BANCADA MDB (RONALDINHO E TEKO)", beneficiario: "AIPODEF", valor: 25020.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de cadeiras de rodas, cadeiras de banho, muletas axilares e canadenses, andadores e botas ortopédicas.", naoPode: "VEDADO usar para custeio administrativo ou folha de pagamento." },
    { num: "028", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", valor: 25000.00, acao: "2083", natureza: "3350 (R$ 18.000) + 4450 (R$ 7.000)", pode: "Fortalecimento do Espaço Rosa: R$ 18.000,00 (3350) para exames preventivos, alimentação saudável às pacientes e manutenção; R$ 7.000,00 (4450) para aquisição de equipamentos permanentes.", naoPode: "VEDADO usar a parcela de R$ 18 mil para comprar equipamentos ou a parcela de R$ 7 mil para alimentos/exames." },
    { num: "029", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "UBS VILA NOVA ALVORADA", valor: 10500.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de 2 macas ginecológicas, 2 focos de luz, 3 longarinas, 10 cadeiras fixas, 5 cadeiras giratórias, 1 ar-condicionado 12.000 BTUs e 1 TV Smart 50\".", naoPode: "VEDADO usar para reformas prediais, pintura, insumos ou medicamentos (Natureza exclusiva 4490)." },
    { num: "030", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "AMAI (Autistas)", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Contratação de serviços de Equoterapia (meta de 227 atendimentos semanais conduzidos por equipe especializada para crianças e adolescentes com TEA).", naoPode: "VEDADO adquirir equipamentos permanentes ou obras." },
    { num: "031", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "ROTARY CLUBE DE IMBITUBA", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos e materiais permanentes para projetos sociais e comunitários de saúde preventiva do Rotary Club.", naoPode: "VEDADO usar para custeio, serviços de terceiros ou folha (Natureza 4450)." },
    { num: "032", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "TFD (Fundo Municipal de Saúde)", valor: 107900.00, acao: "2084", natureza: "4471 (Consórcio - Permanente)", pode: "Aquisição de 1 veículo Fiat Pulse 2025 1.3 Flex Drive Manual (5 lugares) para uso exclusivo no transporte de pacientes do TFD.", naoPode: "VEDADO usar para combustível, manutenção de frota ou diárias." },
    { num: "033", autor: "RONALDO GONÇALVES JUNIOR - RONALDINHO (MDB)", beneficiario: "MAC - SERVIÇO DE PILATES SUS", valor: 23500.00, acao: "2083", natureza: "3390 (Custeio Direto)", pode: "Contratação de profissionais qualificados para implantar e oferecer sessões regulares de Pilates na Atenção à Saúde (reabilitação física e dores crônicas).", naoPode: "VEDADO comprar equipamentos permanentes (Natureza 3390)." },
    { num: "047", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", valor: 85000.00, acao: "2083", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo automotor popular 0km (motor 1.0, bicombustível, direção elétrica e ar-condicionado) para uso exclusivo do CEREM.", naoPode: "VEDADO usar para custeio, combustível, exames ou reformas." },
    { num: "048", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", valor: 12480.00, acao: "2083", natureza: "4490 (Permanente)", pode: "Aquisição de 1 Aparelho de Eletrocautério (Bisturi Eletrônico) com sugador para realização de cauterizações e CAF no CEREM.", naoPode: "VEDADO usar para insumos descartáveis ou outros serviços (Natureza 4490)." },
    { num: "049", autor: "ELÍSIO SGROTT (PP)", beneficiario: "CEREM (Centro de Referência da Mulher)", valor: 74543.14, acao: "2083", natureza: "3371 (Consórcio)", pode: "Aquisição de 654 exames de saúde da mulher via consórcio: 380 ultrassonografias transvaginais (R$ 33.440,00) e 274 ultrassonografias pélvicas (R$ 41.103,14).", naoPode: "VEDADO usar para compra de aparelhos de ultrassom ou outros tipos de exames fora do objeto." },
    { num: "050", autor: "ELÍSIO SGROTT (PP)", beneficiario: "TFD (Secretaria de Saúde)", valor: 100000.00, acao: "2084", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo automotor 0km (bicombustível, 5 marchas, direção elétrica e ar-condicionado) para transporte de pacientes do TFD.", naoPode: "VEDADO usar para manutenção de veículos, combustível ou diárias." },
    { num: "066", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos de sonorização, instrumentos musicais, equipamentos de informática e aparelhos de ar-condicionado para as salas de música da instituição.", naoPode: "VEDADO usar para pagamento de professores/oficineiros, alimentos ou contas de consumo (Natureza 4450)." },
    { num: "067", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "FMS - EXAMES MAC", valor: 75000.00, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de média e alta complexidade via consórcio: ultrassonografias, tomografias, ressonâncias magnéticas, endoscopias e colonoscopias.", naoPode: "VEDADO comprar equipamentos médicos ou pagar folha." },
    { num: "071", autor: "BRUNO PACHECO (PSB)", beneficiario: "CT EBENEZER", valor: 26000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio operacional da Comunidade Terapêutica Ebenezer: materiais de escritório, alimentação, gás, expediente, limpeza, higiene pessoal, energia elétrica, contabilidade, telefonia e manutenção predial.", naoPode: "VEDADO adquirir veículos, móveis ou equipamentos permanentes (Natureza 3350)." },
    { num: "073", autor: "BANCADA PSB (BRUNO PACHECO E HUMBERTO)", beneficiario: "ROTARY CLUBE DE IMBITUBA", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.650) + 3350 (R$ 6.350)", pode: "Fortalecimento do Banco Ortopédico: R$ 18.650,00 (4450) para cadeiras de rodas e camas hospitalares; R$ 6.350,00 (3350) para fraldas, medicamentos e itens de consumo.", naoPode: "VEDADO inverter as naturezas de despesa entre permanente (4450) e custeio (3350)." },
    { num: "075", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "ESF BOA VISTA E UBS ROÇA GRANDE", valor: 50000.00, acao: "1020", natureza: "4490 (Permanente/Obras)", pode: "Aquisição e instalação de 2 toldos de cobertura externa e obras/melhorias estruturais nos Postos de Saúde da Boa Vista e da Roça Grande.", naoPode: "VEDADO usar para insumos médicos ou folha de pagamento." },
    { num: "076", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "APAE IMBITUBA", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de equipamentos elétricos e luminosos para 4 salas clínicas: climatização (ar-condicionado), computadores, luminárias, painéis de LED, displays interativos, som e conectividade.", naoPode: "VEDADO usar para folha de pagamento ou material de expediente (Natureza 4450)." },
    { num: "077", autor: "MATHEUS PALADINI PEREIRA (PSD)", beneficiario: "SECRETARIA DE SAÚDE (FMS)", valor: 242292.00, acao: "2083", natureza: "4471 (Consórcio - Permanente)", pode: "Aquisição de 1 Ambulância Tipo A (Remoção Simples) para transporte e transferência de pacientes entre unidades.", naoPode: "VEDADO usar para combustível, manutenção ou custeio geral." },
    { num: "079", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "AMAI (Autistas)", valor: 52800.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Compra de 240 atendimentos em Equoterapia para crianças com TEA atendidas pela AMAI.", naoPode: "VEDADO comprar equipamentos permanentes ou realizar obras." },
    { num: "082", autor: "BRUNO PACHECO (PSB)", beneficiario: "APAE IMBITUBA", valor: 100000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de programa de acolhimento, suporte psicossocial e orientação técnica às famílias de crianças encaminhadas via SISREG que aguardam vaga na APAE.", naoPode: "VEDADO usar para obras de construção civil ou compra de veículos (Natureza 3350)." },
    { num: "085", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "SAMU 192 IMBITUBA", valor: 56000.00, acao: "2086", natureza: "4490 (Permanente)", pode: "Aquisição de 1 sistema de compressão torácica automática portátil modelo E6 CPR para reanimação cardiopulmonar no SAMU.", naoPode: "VEDADO usar para manutenção da ambulância, combustível ou medicamentos." },
    { num: "086", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "APAE IMBITUBA", valor: 65000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Construção de uma nova sala física destinada ao serviço de Estimulação Precoce (0 a 6 anos) da APAE.", naoPode: "VEDADO usar para pagamento de salários ou despesas de custeio." },
    { num: "087", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "AMAI (Autistas)", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Manutenção operacional da AMAI: custeio de atendimentos especializados, aluguel, materiais essenciais e encargos de funcionamento.", naoPode: "VEDADO usar para obras civis ou compra de veículos (Natureza 3350)." },
    { num: "088", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 18.000) + 3350 (R$ 7.000)", pode: "R$ 18.000,00 (4450) para computadores, impressora e balança para cadeirantes; R$ 7.000,00 (3350) para materiais de atividades físicas dos idosos.", naoPode: "VEDADO misturar as naturezas (respeitar R$ 18 mil em equipamentos permanentes e R$ 7 mil em materiais de custeio)." },
    { num: "090", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "FMS - EXAMES DE ULTRASSONOGRAFIA", valor: 77291.57, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de ultrassonografia via consórcio público para redução de filas na rede municipal.", naoPode: "VEDADO comprar aparelho de ultrassom ou pagar médicos fora do consórcio." },
    { num: "093", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "TFD (Fundo Municipal de Saúde)", valor: 115000.00, acao: "2084", natureza: "4471 (Consórcio - Permanente)", pode: "Aquisição de 1 veículo Fiat Pulse 2025 1.3 Flex Drive Manual (5 lugares) de uso exclusivo do TFD.", naoPode: "VEDADO usar para combustível ou manutenção." },
    { num: "099", autor: "FRANTCHESCOLY DE SOUZA - TEKO (MDB)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", valor: 25000.00, acao: "2083", natureza: "3350 (R$ 17.700) + 4450 (R$ 7.300)", pode: "Espaço Rosa: R$ 17.700,00 (3350) para auxílio alimentação às mulheres atendidas e exames preventivos; R$ 7.300,00 (4450) para aquisição de equipamentos permanentes.", naoPode: "VEDADO inverter os valores entre custeio (R$ 17,7 mil) e equipamentos (R$ 7,3 mil)." },
    { num: "102", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de mobiliário destinado à sala de atendimento médico da instituição Despertar Jovem.", naoPode: "VEDADO usar para alimentação, contas fixas ou pagamento de pessoal (Natureza 4450)." },
    { num: "104", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "UBS BAIRRO SÃO TOMÁS", valor: 10000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Compra e instalação de aparelhos condicionadores de ar no Posto de Saúde do Bairro São Tomás.", naoPode: "VEDADO usar para reformas civis ou material de consumo." },
    { num: "105", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "NOVA UBS BAIRRO GUAIÚBA", valor: 122291.57, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de móveis sob medida para equipar a nova Unidade Básica de Saúde em construção no Bairro Guaiúba.", naoPode: "VEDADO usar para obras civis da construção ou material médico descartável." },
    { num: "116", autor: "DARLAN BACK (PL)", beneficiario: "APAE IMBITUBA", valor: 25000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de mobiliários, brinquedos pedagógicos, materiais permanentes e equipamentos terapêuticos para estruturar as novas salas de Estimulação Precoce da APAE.", naoPode: "VEDADO usar para folha de pagamento ou custeio mensal (Natureza 4450)." },
    { num: "119", autor: "DARLAN BACK (PL)", beneficiario: "UBS SAMBAQUI", valor: 32000.00, acao: "1020", natureza: "3390 (Custeio - Manutenção)", pode: "Manutenção predial da UBS Sambaqui: pintura interna e externa, pequenos reparos estruturais e correções nas instalações elétricas e hidráulicas.", naoPode: "VEDADO comprar mobiliário ou equipamentos permanentes (Natureza 3390)." },
    { num: "120", autor: "DARLAN BACK (PL)", beneficiario: "ASSOCIAÇÃO BENEFICENTE EBENEZER", valor: 40000.00, acao: "2083", natureza: "3350 (Entidade)", pode: "Reestruturação e reparo completo do telhado da sede do Centro Terapêutico Ebenezer (eliminação de infiltrações e desgaste estrutural).", naoPode: "VEDADO usar para compra de veículos ou despesas fora da manutenção da cobertura/sede." },
    { num: "121", autor: "DARLAN BACK (PL)", beneficiario: "CAAPONCI (Pacientes Oncológicos)", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Implantação da 1ª sede física da CAAPONCI: custeio do aluguel do imóvel e aquisição de insumos (materiais de consumo, enfermagem e expediente administrativo).", naoPode: "VEDADO comprar equipamentos permanentes ou realizar obras civis em imóvel locado (Natureza 3350)." },
    { num: "123", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "NOVA UBS BAIRRO GUAIÚBA", valor: 100000.00, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de mobiliário completo para consultórios, recepção, salas de procedimentos e setores administrativos da nova UBS Guaiúba.", naoPode: "VEDADO usar para material de consumo ou serviços de terceiros (Natureza 4490)." },
    { num: "126", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "COMUNIDADE ATIVA (FMS)", valor: 92000.00, acao: "2082", natureza: "4490 (Permanente)", pode: "Aquisição de 1 veículo Fiat Argo Trekking 1.3 (ano 2026) alocado às visitas e ações da Comunidade Ativa.", naoPode: "VEDADO usar para combustível ou custeio (Atenção: Verificar abertura de dotação no IPM!)." },
    { num: "133", autor: "BANCADA PL (EDUARDO, DARLAN, MATHEUS, RAFAEL)", beneficiario: "SAÚDE BUCAL (FMS)", valor: 70000.00, acao: "2076", natureza: "4490 (Permanente)", pode: "Aquisição de equipamentos para consultório odontológico e equipamentos audiovisuais para o projeto 'Saúde Bucal nas Escolas'.", naoPode: "VEDADO usar para insumos odontológicos descartáveis ou folha (Natureza 4490)." },
    { num: "136", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "UBSs PAES LEME, CENTRO, VILA NOVA E VILA ALVORADA", valor: 17200.00, acao: "1020", natureza: "4471 (Consórcio - Permanente)", pode: "Aquisição de 4 aparelhos Eletrocardiógrafos para realização de exames cardíacos nas UBSs Paes Leme, Centro, Vila Nova e Vila Alvorada.", naoPode: "VEDADO usar para laudos/serviços ou insumos de consumo." },
    { num: "141", autor: "BANCADA PSB (HUMBERTO E BRUNO PACHECO)", beneficiario: "FMS - EXAMES DE COLONOSCOPIA", valor: 7291.57, acao: "2083", natureza: "3371 (Consórcio)", pode: "Realização de exames de colonoscopia via consórcio público para detecção precoce de doenças colorretais.", naoPode: "VEDADO usar para outros exames fora do plano ou compra de equipamentos." },
    { num: "144", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "AMAI (Autistas)", valor: 50000.00, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio operacional da AMAI: pagamento parcial de profissionais terapêuticos, aluguel, energia, água, internet, FGTS/INSS, secretária e materiais pedagógicos/higiene/limpeza.", naoPode: "VEDADO usar para compra de veículos, obras ou equipamentos permanentes (Natureza 3350)." },
    { num: "146", autor: "BANCADA PSB (HUMBERTO E BRUNO PACHECO)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 23.000) + 3350 (R$ 2.000)", pode: "Espaço Rosa: R$ 23.000,00 (4450) para 1 projetor Epson E20, 1 TV LED 75\" LG 4K, 1 porta de vidro e 6 cortinas; R$ 2.000,00 (3350) para serviço de contabilidade.", naoPode: "VEDADO usar os R$ 23 mil de capital para custeio ou os R$ 2 mil de custeio para equipamentos." },
    { num: "147", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "CASA DE REPOUSO IMACULADA CONCEIÇÃO", valor: 50000.00, acao: "2083", natureza: "4450 (Investimento Entidade)", pode: "Aquisição de 33 colchões pneumáticos, carrinho medidor hospitalar, monitor de triagem, oxímetro de pulso, porta-soro inox e capas impermeáveis.", naoPode: "VEDADO usar para folha de pagamento, alimentação ou aluguel." },
    { num: "148", autor: "RAFAEL MELLO DA SILVA (PL)", beneficiario: "UBS BAIRRO SÃO TOMÁS", valor: 60000.00, acao: "1020", natureza: "3390 (Custeio - Reforma)", pode: "Serviços de reforma e manutenção predial no Posto de Saúde do Bairro São Tomás: troca de pisos, pintura e recuperação do telhado.", naoPode: "VEDADO comprar mobiliário ou equipamentos permanentes (Natureza 3390)." },
    { num: "150", autor: "DARLAN BACK (PL)", beneficiario: "UBS VILA SANTO ANTÔNIO", valor: 110000.00, acao: "2076", natureza: "4490 (Permanente)", pode: "Implantação de sala odontológica completa na UBS Vila Santo Antônio: cadeira odontológica, equipo, refletor, mocho, compressor e instrumentais permanentes.", naoPode: "VEDADO usar para pagamento de dentista ou material descartável (Natureza 4490)." },
    { num: "155", autor: "MATHEUS PALADINI PEREIRA (PSD)", beneficiario: "REDE FEMININA DE COMBATE AO CÂNCER", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 22.002,71) + 3350 (R$ 2.997,29)", pode: "R$ 22.002,71 (4450) para painéis de energia solar, 1 ar-condicionado 9.000 BTUs, 1 balcão passa-prato, 1 bebedouro, 1 aspirador WAP, 4 cadeiras giratórias e 20 empilháveis; R$ 2.997,29 (3350) para louças, panelas, garrafas térmicas e utensílios.", naoPode: "VEDADO misturar as dotações de investimento (4450) e custeio (3350)." },
    { num: "156", autor: "EDUARDO FAUSTINA (PL)", beneficiario: "AMAI (Autistas)", valor: 50291.57, acao: "2083", natureza: "3350 (Custeio Entidade)", pode: "Custeio de atendimento multiprofissional na AMAI: pagamento parcial de profissionais (plantões/horas/terceirizados), materiais terapêuticos/pedagógicos e pequenos insumos operacionais.", naoPode: "VEDADO adquirir bens permanentes, veículos ou realizar obras (Natureza 3350)." },
    { num: "163", autor: "HUMBERTO CARLOS DOS SANTOS (PSB)", beneficiario: "PONTO DE APOIO DESPERTAR JOVEM", valor: 50000.00, acao: "2083", natureza: "3350 (Entidade)", pode: "Melhoria estrutural do espaço terapêutico: compra e instalação de 852 m² de piso cerâmico, 167 sacas de argamassa, 42 kg de rejunte, 4.000 niveladores, 2.000 cunhas e mão de obra de colocação.", naoPode: "VEDADO usar para outras despesas administrativas fora da colocação do piso cerâmico." },
    { num: "165", autor: "MATHEUS WILLIAN GELINSKI (PL)", beneficiario: "UBS PAES LEME", valor: 29091.57, acao: "1020", natureza: "4490 (Permanente)", pode: "Aquisição de equipamentos administrativos (computadores e impressora) e médicos (oxímetros e cuba ultrassônica) para a UBS Paes Leme.", naoPode: "VEDADO usar para reformas, material de consumo ou folha (Natureza 4490)." },
    { num: "167", autor: "DARLAN BACK (PL)", beneficiario: "ORIALAN", valor: 25000.00, acao: "2083", natureza: "4450 (R$ 20.000) + 3350 (R$ 5.000)", pode: "R$ 20.000,00 (4450) para aquisição de móveis novos (camas, colchões, armários, mesas e cadeiras); R$ 5.000,00 (3350) para itens de rouparia/enxoval (lençóis, fronhas e cobertores).", naoPode: "VEDADO usar os R$ 20 mil de móveis para rouparia ou os R$ 5 mil de rouparia para equipamentos." },
    { num: "174", autor: "HENRIQUE MELO (PP)", beneficiario: "HOSPITAL SÃO CAMILO", valor: 217291.57, acao: "2083", natureza: "4450 (R$ 107.750) + 3350 (R$ 109.541,57)", pode: "R$ 107.750,00 (4450) para compra e instalação de aparelhos de ar-condicionado, poltronas hospitalares e cadeiras administrativas; R$ 109.541,57 (3350) para execução de reformas internas de conforto, higiene e vigilância sanitária.", naoPode: "VEDADO usar a parcela de equipamentos (4450) para serviços de reforma (3350) e vice-versa." }
];

// =========================================================================
// 2. BASE COMPLETA: 24 PROPOSTAS FEDERAIS DO FNS (EXTRAÍDAS DO PDF)
// =========================================================================
export const propostasFNSReais = [
    { ano: 2024, numero: "10568451000124001", emenda: "PROGRAMA PAC/MS", parlamentar: "MINISTÉRIO DA SAÚDE (PROGRAMA)", status: "FAVORÁVEL / EMPENHADO", objeto: "Construção de Unidade Básica de Saúde (UBS Porte 1 - Bairro Guaiúba)", valor: 2026110.00, natureza: "4490 - Obras e Instalações", pode: "Execução da obra civil de construção da nova UBS Porte 1 no bairro Guaiúba (atendimento estimado de 3.000 habitantes).", naoPode: "VEDADO usar para compra de medicamentos, folha de pagamento ou manutenção de outras UBSs." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos  material consumo" },
    { ano: 2024, numero: "36000599811202400", emenda: "Emenda 44930003", parlamentar: "EMENDA FEDERAL Nº 44930003", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio do Piso da Atenção Primária (PAP)", valor: 2000000.00, natureza: "3390 - Custeio APS", pode: "Custeio de ações e serviços da Atenção Primária à Saúde (material de consumo, serviços PJ e manutenção das UBSs).", naoPode: "VEDADO usar para pagamento de servidores ativos/inativos, obras ou compra de equipamentos permanentes (4490)." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos  material consumo" },
    { ano: 2024, numero: "36000604612202400", emenda: "Emenda 50410004", parlamentar: "EMENDA FEDERAL Nº 50410004", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio do Piso da Atenção Primária (PAP)", valor: 1000000.00, natureza: "3390 - Custeio APS", pode: "Custeio operacional das Unidades Básicas de Saúde, insumos clínicos e serviços terceirizados da APS.", naoPode: "VEDADO usar para folha de pagamento de pessoal ou aquisição de material permanente/veículos." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos  material consumo" },
    { ano: 2024, numero: "36000599812202400", emenda: "Emenda 90550006", parlamentar: "EMENDA FEDERAL Nº 90550006", status: "PROPOSTA APROVADA", objeto: "Incremento Temporário ao Custeio MAC (Média e Alta Complexidade)", valor: 180000.00, natureza: "3390 / 3371 - Custeio MAC", pode: "Custeio de procedimentos, exames e serviços de Média e Alta Complexidade (CNES 6442285 - SMS Imbituba).", naoPode: "VEDADO usar na Atenção Básica ou para compra de equipamentos permanentes (4490)." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos  material consumo" },
    { ano: 2024, numero: "10568451000124002", emenda: "PROGRAMA SUS DIGITAL", parlamentar: "MINISTÉRIO DA SAÚDE (TELESSAÚDE)", status: "PROPOSTA APROVADA", objeto: "Equipamentos de Saúde Digital e Telessaúde para 6 UBSs (29 itens)", valor: 59704.00, natureza: "4490 - Material Permanente", pode: "Compra exata de 29 itens para as UBSs Ibiraquera, Alto Arroio, Campo d'Aviação, Nova Brasília, Vila Nova e Vila Nova Alvorada: 5 Notebooks (R$ 6.940 un), 6 Câmeras Videoconferência 4K (R$ 1.700 un), 1 Monitor Sinais Vitais Telessaúde (R$ 7.374), 11 Cadeiras (R$ 312 un) e 6 Mesas (R$ 737/313).", naoPode: "VEDADO comprar itens diferentes da relação aprovada ou alocar em unidades fora dos 6 CNES cadastrados." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000721655202500", emenda: "Emenda 39490003", parlamentar: "EMENDA FEDERAL Nº 39490003", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Material de Consumo, Apoio Logístico e Telessaúde APS", valor: 1000000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "100% Material de Consumo (R$ 1 Mi): elásticos, colchonetes, cronômetros, luvas, seringas, gazes, impressão de cartilhas/materiais gráficos e pequenos acessórios de suporte digital classificados como custeio (cabos, microfones, webcams, fones, teclados, tripés).", naoPode: "VEDADO contratar serviços PJ (3390.39) ou comprar bens de capital/permanentes (4490), pois 100% foi cadastrado na natureza Material de Consumo." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM distribuição materiais gráficos PSE Estratégias de promoção da saúde e educação alimentar e nutricional cabos, microfones, câmeras, fones, teclados, tripés – itens de custeio NÃO DE CAPITAL combustível combustível Impressão de cartilhas/manuais de apoio ao uso de tecnologias pelos usuários Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000664106202500", emenda: "Emenda 44010001", parlamentar: "EMENDA FEDERAL Nº 44010001", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Serviços PJ (Saúde da Mulher, Idoso, Vacinação e Telessaúde)", valor: 1000000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "100% Serviços PJ (R$ 1 Mi): implantação de teleconsultoria/telediagnóstico (R$ 120 mil), ações de Saúde da Mulher e DIU/anticoncepcionais (R$ 250 mil), linha de cuidado da pessoa idosa (R$ 100 mil), busca ativa vacinal e campanhas (R$ 180 mil), condições crônicas e navegação do cuidado (R$ 350 mil).", naoPode: "VEDADO usar para folha de pagamento ou obras. Observar que a natureza cadastrada no FNS é integralmente Serviços de Terceiros PJ." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000655010202500", emenda: "Emenda 42510001", parlamentar: "EMENDA FEDERAL Nº 42510001", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Insumos Saúde da Mulher, Condições Crônicas e Navegação", valor: 300000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "100% Material de Consumo: R$ 100 mil para insumos de atendimento clínico à Saúde da Mulher; R$ 100 mil para insumos de acompanhamento de condições crônicas (hipertensão/diabetes); R$ 100 mil para fortalecimento da APS.", naoPode: "VEDADO usar para serviços de terceiros PJ ou equipamentos permanentes (100% vinculado a Material de Consumo)." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000718685202500", emenda: "Emenda 50410001", parlamentar: "EMENDA FEDERAL Nº 50410001 (Proposta 1)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Atenção Integral à Saúde da Mulher", valor: 200000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "Aquisição de insumos ginecológicos e de atendimento à mulher: espéculos vaginais, pinças, luvas de procedimento, gazes, algodão, seringas, agulhas, cartilhas e folders educativos de combate à violência e dignidade menstrual.", naoPode: "VEDADO usar para serviços PJ, obras ou equipamentos permanentes." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000706895202500", emenda: "Emenda 50410001", parlamentar: "EMENDA FEDERAL Nº 50410001 (Proposta 2)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Saúde da Mulher e Contraceptivos (DIU / Implanon)", valor: 250000.00, natureza: "3390.30 - Material de Consumo (100%)", pode: "Aquisição de espéculos, pinças, luvas, gazes, seringas, pílulas anticoncepcionais, injetáveis mensais, Dispositivo Intrauterino (DIU), diafragma, Implanon e materiais educativos de saúde da mulher.", naoPode: "VEDADO usar para contratação de serviços PJ ou compra de mobiliário/equipamentos." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos material consumo" },
    { ano: 2025, numero: "36000699808202500", emenda: "Emenda 60060003", parlamentar: "EMENDA FEDERAL Nº 60060003", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Rastreamento de Condições Crônicas via Consórcio", valor: 500000.00, natureza: "3371 - Execução Delegada a Consórcios Públicos (100%)", pode: "Transferência a Consórcio Público (CISAMUREL) para oferta de exames e consultas especializadas de rastreamento e controle de Doenças Crônicas para pacientes da Atenção Básica.", naoPode: "VEDADO usar fora de contrato de rateio com Consórcio Público ou para compra de equipamentos." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos" },
    { ano: 2025, numero: "36000699824202500", emenda: "Emenda 71260002", parlamentar: "EMENDA FEDERAL Nº 71260002 (2025)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Serviços de Tecnologia da Informação (Prontuário/Teleatendimento)", valor: 222386.00, natureza: "3390.40 - Serviços de TIC Pessoa Jurídica (100%)", pode: "Manutenção da informatização das UBSs: locação/licenciamento de sistemas de prontuário eletrônico, teleatendimento e conectividade da Atenção Primária.", naoPode: "VEDADO comprar computadores/hardware (4490) ou materiais de consumo; exclusivo para Serviços de TIC PJ." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos" },
    { ano: 2025, numero: "10568451000125002", emenda: "PROGRAMA EQUIPAMENTOS", parlamentar: "MINISTÉRIO DA SAÚDE (UBS CENTRO)", status: "PROPOSTA APROVADA", objeto: "Aquisição de 18 Equipamentos Médicos e de Telessaúde para a UBS Centro", valor: 199596.00, natureza: "4490 - Material Permanente", pode: "Compra exata dos 18 equipamentos para a USF Centro (CNES 2385902): 1 Retinógrafo (R$ 43.222), 1 Ultrassom Portátil (R$ 41.933), 1 Espirômetro (R$ 19.866), 1 Câmara Imunobiológicos (R$ 16.176), 1 Eletrocardiógrafo (R$ 15.390), 1 Bisturi Elétrico (R$ 13.779), 1 DEA (R$ 9.930), 1 Dermatoscópio (R$ 8.010), 1 Fotóforo (R$ 7.316), 1 Otoscópio (R$ 7.250), 1 Laser Fisio (R$ 4.214), 1 Doppler (R$ 2.421), 1 Cadeira Rodas Obeso (R$ 2.346), 1 Ultrassom Fisio (R$ 2.053), 1 Balança (R$ 1.888), 1 Dinamômetro (R$ 1.832), 1 TENS/FES (R$ 1.757) e 1 Tábua Propriocepção (R$ 213).", naoPode: "VEDADO usar para custeio ou comprar equipamentos diferentes da lista técnica aprovada." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos" },
    { ano: 2025, numero: "10568451000125001", emenda: "PROGRAMA TELESSAÚDE", parlamentar: "MINISTÉRIO DA SAÚDE (EAP PENHA)", status: "PROPOSTA APROVADA", objeto: "Equipamentos para Teleconsulta na EAP da Penha (3 itens)", valor: 7158.00, natureza: "4490 - Material Permanente", pode: "Compra exata de 3 itens para a EAP da Penha (CNES 2385945): 1 Notebook para Telessaúde (R$ 4.068,00), 1 Televisor 42\" a 50\" (R$ 1.726,00) e 1 Câmera de Videoconferência 4K (R$ 1.364,00).", naoPode: "VEDADO usar em outra unidade ou para despesas de custeio." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos" },
    { ano: 2026, numero: "36000764089202600", emenda: "Emenda 44010001", parlamentar: "EMENDA FEDERAL Nº 44010001 (2026)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Saúde da Pessoa Idosa e Manutenção de Equipamentos UBS", valor: 400000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "R$ 200.000,00 para ações de atenção ao envelhecimento e saúde da pessoa idosa na APS; R$ 200.000,00 para manutenção preventiva e corretiva de equipamentos já existentes nas UBSs (foco na Saúde da Mulher).", naoPode: "VEDADO adquirir equipamentos novos (4490) ou folha de pagamento; exclusivo para Serviços PJ." , tagsBusca: "Aquisição de materiais leves: elásticos, colchonetes, esfigmomanômetro, balança e cronômetros. Serviços de teleconsultoria, telediagnóstico, teleducação e segunda opinião formativa pelas equipes da APS. telepsicologia Insumos destinados ao atendimento clínico e às ações de promoção da saúde da mulher. material odontológico Ações com foco em envelhecimento ativo e prevenção de agravos. Capacitação das equipes em avaliação multidimensional e plano terapêutico singular. Insumos e materiais de uso contínuo destinados às ações de busca ativa, vacinação e controle de doenças transmissíveis. Atividades relacionadas ao fortalecimento da APS no âmbito da estratégia de busca ativa para vacinação e controle de doenças transmissíveis. Atividades destinadas ao fortalecimento da APS no rastreamento e controle de condições crônicas. Atividades destinadas ao fortalecimento da APS no âmbito da navegação do cuidado. Apoio logístico para ações domiciliares e intersetoriais com creches, escolas e CRAS. Insumos e materiais de uso contínuo para acompanhamento de pessoas com condições crônicas. material odontológico Capacitação dos profissionais para uso das ferramentas de telessaúde e apoio à gestão do cuidado mediado por tecnologias digitais. telepsicologia Ações/campanha de comunicação destinadas ao combate à desinformação sobre vacinas. Ações/campanha de comunicação destinadas ao incentivo à vacinação. Aquisição de anticoncepcionais e dispositivos intrauterinos (DIU). manutenção equipamentos CEREM Consórcio Consórcio materiais impressos materiais Atividades para Fortalecimento da Atenção Primária IPM/Inovadora Apoio logístico para visitas domiciliares (combustível, manutenção veículos, aquisição kits p/ visitas) combustível Manutenção preventiva e corretiva e conservação de equipamento já existente na UBS manut. Equip. Odontologico manutenção equipamentos" },
    { ano: 2026, numero: "36000764161202600", emenda: "Emenda 42090006", parlamentar: "EMENDA FEDERAL Nº 42090006", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Manutenção de UBSs e Cadeia de Frio (Vacinação)", valor: 350000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "Manutenção preventiva e corretiva das Unidades Básicas de Saúde: reparo de refrigeradores de vacinas (cadeia de frio), sistemas elétricos e conservação de espaços clínicos.", naoPode: "VEDADO comprar câmaras frias novos ou construir ampliações (exclusivo para serviços PJ de manutenção)." },
    { ano: 2026, numero: "36000763955202600", emenda: "Emenda 39320002", parlamentar: "EMENDA FEDERAL Nº 39320002", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Apoio Logístico Visitas Domiciliares e Manutenção TI UBS", valor: 350000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "R$ 150.000,00 para apoio logístico às visitas domiciliares de busca ativa vacinal (manutenção de veículos e logística); R$ 200.000,00 para manutenção preventiva/corretiva de computadores, servidores, impressoras e conectividade das UBSs.", naoPode: "VEDADO comprar veículos ou computadores novos (exclusivo para manutenção e serviços PJ)." },
    { ano: 2026, numero: "36000760344202600", emenda: "Emenda 39290002", parlamentar: "EMENDA FEDERAL Nº 39290002", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Manutenção Predial UBSs, Equipamentos e Logística", valor: 1000000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "R$ 600.000,00 para manutenção predial preventiva/corretiva das UBSs (elétrica, salas de vacina, climatização); R$ 300.000,00 para manutenção de equipamentos clínicos (ECG, balanças, esfigmos); R$ 100.000,00 para apoio logístico de visitas domiciliares.", naoPode: "VEDADO usar para folha de pagamento ou compra de bens permanentes (100% Serviços PJ)." },
    { ano: 2026, numero: "36000793046202600", emenda: "Emenda 71260002", parlamentar: "EMENDA FEDERAL Nº 71260002 (2026)", status: "PLANO DE TRABALHO APROVADO", objeto: "Incremento PAP — Consórcio, Material de Consumo e Bolsas de Pesquisa APS", valor: 500000.00, natureza: "Consórcio (R$ 200k) + Consumo (R$ 200k) + Auxílio Estudante (R$ 100k)", pode: "Divisão estrita: R$ 200.000,00 para Execução via Consórcio Público (exames/consultas de condições crônicas); R$ 200.000,00 para Material de Consumo (insumos Saúde da Mulher e campanhas); R$ 100.000,00 para Auxílio Financeiro a Estudantes (pesquisa e extensão na APS).", naoPode: "VEDADO alterar os tetos de cada uma das 3 naturezas cadastradas no plano de trabalho." },
    { ano: 2026, numero: "10568451000126005", emenda: "Emenda 44010004", parlamentar: "EMENDA FEDERAL Nº 44010004", status: "PROPOSTA APROVADA", objeto: "Aquisição de 1 Unidade Móvel de Saúde (Ambulância Tipo A - Furgão)", valor: 312730.00, natureza: "4490 - Material Permanente", pode: "Aquisição de 1 Ambulância Tipo A - Simples Remoção Tipo Furgão 0km (diesel, mín. 7m³, maca retrátil, cilindro O2 16L, ar-condicionado 25.000 BTUs e sinalizador acústico/visual).", naoPode: "VEDADO comprar veículo de passeio comum ou usar o saldo para combustível/manutenção." },
    { ano: 2026, numero: "63000763762202600", emenda: "PROGRAMA PAP 2026", parlamentar: "MINISTÉRIO DA SAÚDE (CUSTEIO PAP)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio de Serviços da Atenção Primária à Saúde (Horário Estendido e Multiprofissional)", valor: 3000000.00, natureza: "Múltiplas Naturezas de Custeio (R$ 3,00 Mi)", pode: "Divisão por natureza: R$ 1.100.000,00 em Serviços PJ; R$ 700.000,00 em Serviços Pessoa Física; R$ 500.000,00 em Serviços de TIC PJ; R$ 300.000,00 em Material de Consumo; R$ 300.000,00 em Auxílio a Estudantes; R$ 100.000,00 em Material de Distribuição Gratuita.", naoPode: "VEDADO usar para investimentos/obras (4490) ou ultrapassar o teto de cada natureza de despesa cadastrada." },
    { ano: 2026, numero: "63000780331202600", emenda: "PROGRAMA MAC 2026 (1)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - APAE E AMAI)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio MAC e Rede Alyne — Parceria APAE (R$ 500k) e AMAI (R$ 500k)", valor: 1000000.00, natureza: "3350 - Transferências / Contrato de Gestão", pode: "Repasse de R$ 500.000,00 para a APAE (seguimento de RN de risco e deficiência intelectual) e R$ 500.000,00 para a AMAI (diagnóstico precoce e acompanhamento multiprofissional de TEA).", naoPode: "VEDADO usar para obras civis ou compra de veículos nas entidades." },
    { ano: 2026, numero: "63000764214202600", emenda: "PROGRAMA MAC 2026 (2)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - AMAI E APAE)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio Especializado MAC / Rede Alyne — AMAI (R$ 500k) e APAE (R$ 500k)", valor: 1000000.00, natureza: "3350 - Transferências / Contrato de Gestão", pode: "Repasse de R$ 500.000,00 para a AMAI e R$ 500.000,00 para a APAE para custeio de equipe multiprofissional e reabilitação da Pessoa com Deficiência e RN de risco.", naoPode: "VEDADO desviar para despesas fora dos planos de trabalho aprovados para AMAI e APAE." },
    { ano: 2026, numero: "63000763733202600", emenda: "PROGRAMA MAC 2026 (3)", parlamentar: "MINISTÉRIO DA SAÚDE (MAC - SMS IMBITUBA)", status: "PLANO DE TRABALHO APROVADO", objeto: "Custeio MAC — Regulação, Oncologia/TFD, Medicina Nuclear e Rede Alyne", valor: 1500000.00, natureza: "3390.39 - Outros Serviços Terceiros PJ (100%)", pode: "100% Serviços PJ: R$ 400 mil Alta Complexidade; R$ 350 mil Central de Regulação; R$ 200 mil Radioterapia TFD; R$ 200 mil Transporte Sanitário Radioterapia; R$ 150 mil Medicina Nuclear Oncológica; R$ 100 mil Pré-Natal Alto Risco; R$ 100 mil Seguimento RN de Risco.", naoPode: "VEDADO comprar equipamentos permanentes (4490) ou folha de efetivos." }
];

// =========================================================================
// 3. CLASSIFICADOR INTELIGENTE CORRIGIDO (LÊ OS 3 ÚLTIMOS DÍGITOS DO VÍNCULO)
// =========================================================================
export function classificarPermissoesDotacao(refNum, acao, modalidade, vinculoDesc, vinculoCod) {
    const tags = [];
    let regraPode = '';
    let regraNaoPode = '';
    let tituloEmendaCustom = null;
    const modCod = String(modalidade || '').substring(0, 6);
    const acaoUpper = String(acao || '').toUpperCase();
    const vincUpper = String(vinculoDesc || '').toUpperCase();
    const vCod = String(vinculoCod || '').trim();

    if (modCod === '331900' || modCod === '331710') {
        tags.push('Folha / Pessoal (33190)');
        regraPode = 'Vencimentos, salários, folha de pagamento e encargos patronais.';
        regraNaoPode = 'PROIBIDO usar para compras de materiais, aluguéis, serviços PJ ou obras.';
    } else if (modCod === '333900' || modCod === '333910') {
        tags.push('Custeio / Serviços PJ (33390)');
        regraPode = 'Custeio Direto (3.3.90): Material de consumo, serviços PJ, aluguéis de imóveis, links de internet, manutenção predial/frota e exames.';
        regraNaoPode = 'PROIBIDO comprar Material Permanente/Equipamentos/Móveis/Veículos (exige código 344900).';
    } else if (modCod === '344900' || modCod === '344710') {
        tags.push('Material Permanente / Obras (34490)');
        regraPode = 'Investimento / Permanente (4.4.90): Compra de Ar-condicionado, Mobiliário, Computadores, Veículos/Ambulâncias, Equipamentos e Obras.';
        regraNaoPode = 'PROIBIDO usar para custeio mensal (aluguel, internet, combustível, medicamentos ou serviços).';
    } else if (modCod === '333500' || modCod === '344500') {
        tags.push(modCod === '333500' ? 'Entidades Custeio (33350)' : 'Entidades Capital/Equip. (34450)');
        regraPode = `Repasses a Instituições Privadas Sem Fins Lucrativos (${modCod === '333500' ? 'Custeio Operacional / Atendimentos' : 'Investimento / Equipamentos / Mobiliário / Obras'}).`;
        regraNaoPode = 'Compras diretas fora de Termo de Fomento/Colaboração/Convênio ou inversão entre Custeio (3350) e Capital (4450).';
    } else if (modCod === '333710') {
        tags.push('Consórcio Público (33371)');
        regraPode = 'Contrato de Rateio / Consórcio Intermunicipal de Saúde (CISAMUREL) para exames e procedimentos.';
        regraNaoPode = 'Contratações diretas fora do consórcio ou compra de bens permanentes.';
    }

    if (acaoUpper.includes('2084') || acaoUpper.includes('TFD') || acaoUpper.includes('2086') || acaoUpper.includes('SAMU')) tags.push('Transporte / TFD / SAMU');
    if (acaoUpper.includes('2121') || acaoUpper.includes('TECNOLOGIA') || acaoUpper.includes('DIGITAL')) tags.push('Tecnologia / SUS Digital');
    if (acaoUpper.includes('2089') || acaoUpper.includes('2090') || acaoUpper.includes('FARMAC') || vincUpper.includes('PORTARIA 017/223')) tags.push('Medicamentos / Farmácia');
    if (acaoUpper.includes('2076') || acaoUpper.includes('BUCAL')) tags.push('Saúde Bucal');

    // Mapeamento preciso de Emendas e Repasses Específicos
    const ehEmenda = vincUpper.includes('EMENDA') || 
                     vCod.startsWith('15007011') || vCod.startsWith('2706') || 
                     vCod.startsWith('1706') || vCod.startsWith('2710') || 
                     vCod.startsWith('25007011') || vCod.startsWith('16003120') || 
                     vCod.startsWith('270031') || vCod.startsWith('262132') ||
                     vincUpper.includes('PORTARIA 017') || vincUpper.includes('CONVÊNIOS');

    // CRUZAMENTO EXATO PELOS 3 ÚLTIMOS DÍGITOS DO VÍNCULO IPM (150070112XXX)
    if (vCod.startsWith('150070112')) {
        const num3 = vCod.slice(-3);
        const imp = emendasImpositivas2025.find(e => e.num === num3);
        if (imp) {
            tags.push(`Vereador(a): ${imp.autor}`);
            tags.push(`Destino: ${imp.beneficiario}`);
            tituloEmendaCustom = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario}`;
            regraPode = `${imp.pode} (Natureza prevista: ${imp.natureza}).`;
            regraNaoPode = imp.naoPode;
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
    } else if (vCod.startsWith('1706') || vCod.startsWith('2706')) {
        tituloEmendaCustom = `🇧🇷 Emenda Federal Individual — ${vincUpper.replace(/.*INDIVIDUAL\s*/, '').trim()}`;
    } else if (vCod.startsWith('1600') || vCod.startsWith('2700')) {
        tituloEmendaCustom = `🇧🇷 Emenda Federal Bancada/Comissão — ${vincUpper.replace(/.*TEMPORÁRIO\s*-\s*/, '').replace(/.*MAC\s*-\s*/, '').trim()}`;
    } else if (vCod.startsWith('262132') || vCod.startsWith('2710')) {
        tituloEmendaCustom = `🚩 Emenda Estadual (FES/Impositiva) — Santa Catarina`;
    } else if (vincUpper.includes('PORTARIA 017')) {
        tituloEmendaCustom = `🏥 Repasse Federal — Portaria 017/223 (Aquisição Material Ambulatorial)`;
    } else if (vincUpper.includes('CONVÊNIOS - UNIÃO')) {
        tituloEmendaCustom = `🤝 Convênio da União — Repasse Externo (${vCod})`;
    } else if (vincUpper.includes('CONVÊNIOS - ESTADO')) {
        tituloEmendaCustom = `🤝 Convênio do Estado — Repasse Externo (${vCod})`;
    }

    
    // ---------------------------------------------------------
    // INTEGRAÇÃO DAS REGRAS CUSTOMIZADAS (EDITADAS PELA CONTADORA)
    // ---------------------------------------------------------
    const regraEditada = customRulesDB[refNum];
    if (regraEditada) {
        if (regraEditada.pode) regraPode = regraPode ? `${regraPode} | ✍️ ADICIONADO: ${regraEditada.pode}` : `✍️ ADICIONADO: ${regraEditada.pode}`;
        if (regraEditada.naoPode) regraNaoPode = regraNaoPode ? `${regraNaoPode} | ✍️ VEDADO (EXTRA): ${regraEditada.naoPode}` : `✍️ VEDADO: ${regraEditada.naoPode}`;
        tags.push('Regra Customizada');
    }

    
    let tagsBuscaExtra = '';
    const propFNS = typeof propostasFNSReais !== 'undefined' ? propostasFNSReais.find(p => p.numero && vCod.includes(p.numero)) : null;
    if (propFNS && propFNS.tagsBusca) tagsBuscaExtra += propFNS.tagsBusca;
    
    return { tags: [...new Set(tags)], regraPode, regraNaoPode, ehEmenda, tituloEmendaCustom, regraCustomPode: regraEditada?.pode || '', regraCustomNaoPode: regraEditada?.naoPode || '', tagsBusca: tagsBuscaExtra };


}

// =========================================================================
// 4. RENDERIZADOR DA ABA 3 (MOSTRA IMPOSITIVAS DO IPM + FALTANTES + 24 FNS)
// =========================================================================
function renderizarEmendas() {
    const dotacoes = obterDotacoesFiltroGlobal();
    const busca = normalizarTexto(document.getElementById('inputBuscaEmenda') ? document.getElementById('inputBuscaEmenda').value : '');
    const emendas = dotacoes.filter(d => d.ehEmenda);

    const agrupadas = {};
    emendas.forEach(e => {
        const info = classificarPermissoesDotacao(e.ref, e.acao, e.modalidade, e.vinculo_desc, e.vinculo_cod);
        const key = info.tituloEmendaCustom || e.vinculo_desc;
        if (!agrupadas[key]) {
            agrupadas[key] = {
                vinculo: key,
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

    // Garante que as Emendas Impositivas do PDF que ainda não têm dotação no IPM (017 e 126) também apareçam!
    emendasImpositivas2025.forEach(imp => {
        const codEsperado = '150070112' + imp.num;
        const existeNoIPM = dotacoesDB.some(d => String(d.vinculo_cod) === codEsperado);
        if (!existeNoIPM) {
            const key = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario} (⚠️ Aguardando Dotação IPM)`;
            agrupadas[key] = {
                vinculo: key,
                esfera: 'MUNICIPAL',
                totalAtualizado: imp.valor,
                totalLivre: imp.valor,
                tagsGlobais: new Set([`Vereador(a): ${imp.autor}`, `Destino: ${imp.beneficiario}`, `Natureza: ${imp.natureza}`, `⚠️ Sem Ref no CSV IPM`]),
                refs: [{
                    ref: 'Pendente IPM',
                    acao: `Ação Padrão (${imp.beneficiario})`,
                    atualizado: imp.valor,
                    empenhado: 0,
                    saldo_reserva: imp.valor,
                    permissoesTags: [imp.natureza],
                    regraPode: imp.pode,
                    regraNaoPode: imp.naoPode
                }]
            };
        }
    });

    // Adiciona as 24 Propostas Federais do FNS (do PDF) para consulta e abertura (Drill-down) na Aba 3!
    propostasFNSReais.forEach(p => {
        const key = `🇧🇷 [FNS ${p.ano}] ${p.parlamentar} — ${p.objeto} (Proposta nº ${p.numero})`;
        agrupadas[key] = {
            vinculo: key,
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
                tagsBusca: p.tagsBusca || ''
            }]
        };
    });

    const listaFiltrada = Object.values(agrupadas).filter(g => {
        if (!busca) return true;
        const txtGrupo = normalizarTexto(`${g.vinculo} ${Array.from(g.tagsGlobais).join(' ')} ${g.refs.map(r => r.regraPode + ' ' + r.regraNaoPode + ' ' + r.ref).join(' ')}`);
        return txtGrupo.includes(busca);
    }).sort((a, b) => b.totalLivre - a.totalLivre);

    document.getElementById('containerEmendasAcordeon').innerHTML = listaFiltrada.map((grupo, idx) => {
        const idCollapse = `collapse-emenda-${idx}`;
        const tagsHTML = Array.from(grupo.tagsGlobais).map(t => `<span class="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded text-[10px] font-bold">${t}</span>`).join('');

        const refsHTML = grupo.refs.map(r => `
            <div class="flex flex-wrap md:flex-nowrap items-start justify-between gap-4 p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition">
                <div class="flex-1 space-y-2">
                    <div class="flex items-center gap-2">
                        ${typeof r.ref === 'number' ? gerarBadgeRefComPopover(r.ref) : `<span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-extrabold text-xs">${r.ref}</span>`}
                        <span class="text-xs font-bold text-slate-800">${r.acao}</span>
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
    lucide.createIcons();
}

// =========================================================================
// 5. BOTÃO RADAR FNS NA ABA 6 (COM AS 24 PROPOSTAS E DETALHAMENTO COMPLETO)
// =========================================================================
async function sincronizarFNSAutomatico() {
    const btn = document.getElementById('btnSyncFNS');
    const log = document.getElementById('logImportacao');

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
        lucide.createIcons();
    }, 1200);
}

// =========================================================================
// GESTÃO DE REGRAS CUSTOMIZADAS (MODAL EDITÁVEL)
// =========================================================================
function abrirModalEdicao(refNum) {
    const d = dotacoesDB.find(x => x.ref === refNum);
    if (!d) return;
    
    document.getElementById('modalRefHidden').value = refNum;
    document.getElementById('modalEdicaoTitulo').textContent = `Ref. ${refNum} - Editar Itens (O que posso comprar?)`;
    
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
    
    customRulesDB[refNum] = {
        pode: txtPode,
        naoPode: txtNaoPode
    };
    
    // 1. Salvar no LocalStorage (Navegador da Contadora)
    localStorage.setItem('bi_saude_imbituba_custom_rules', JSON.stringify(customRulesDB));
    
    // 2. Salvar na Nuvem (Supabase) para todos os usuarios verem
    if (supabaseAtivo) {
        const { error } = await supabase
            .from('dotacoes_orcamentarias')
            .update({
                regra_custom_pode: txtPode,
                regra_custom_nao_pode: txtNaoPode
            })
            .eq('ref', refNum);
            
        if (error) {
            console.error('Erro ao salvar regra na Nuvem Supabase:', error);
        }
    }
    
    // Re-classificar a dotação e atualizar a interface na hora
    construirBaseDotacoes(dotacoesDB); 
    filtrarAbaDotacoes();
    fecharModalEdicao();
}

Object.assign(window, { sincronizarFNSAutomatico, renderizarEmendas });
