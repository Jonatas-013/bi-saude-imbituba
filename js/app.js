// =========================================================================
// MOTOR DE APLICACAO, PERSISTENCIA EM BANCO DE DADOS E REGRAS DE NEGOCIO
// Hierarquia de Carregamento ao abrir o sistema:
//   1o Banco de Dados Nuvem (Supabase) -> Se configurado em js/config.js
//   2o Banco Local do Navegador (LocalStorage) -> Salva na hora ao subir CSV
//   3o Arquivo Base da Pasta (js/dados_iniciais.js) -> Fallback inicial
// =========================================================================

import { supabase, supabaseAtivo, formatarBRL, normalizarTexto, brToFloat, esc, diasDesde, debounce } from './config.js';
import { rawDotacoesReais, auditoriaParadosIniciais, contratosCruzadosIniciais } from './dados_iniciais.js';
import { emendasImpositivas2025, regrasPlanilhaPorRef, propostasFNSReais } from './dados_emendas.js';

// Saldo a liquidar menor ou igual a isto = empenho que não prende mais dinheiro
const SALDO_ZERO = 0.005;

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

let chartEmendasBIInstance = null;
let chartCategoriasBIInstance = null;
let chartFontesInstance = null;
let chartBlocosInstance = null;

let modoDetalheEmendasBI = false;
let mostrarTodasCategoriasBI = false;
let tagPermissaoAtiva = 'TODOS';
let filtroSituacaoContratoAtivo = 'TODOS';

// =========================================================================
// 4. CLASSIFICADOR INTELIGENTE DE DOTACOES (RESPEITA RIGOROSAMENTE A NATUREZA)
// =========================================================================
export function classificarPermissoesDotacao(refNum, acao, modalidade, vinculoDesc, vinculoCod) {
    const tags = [];
    let regraPode = '';
    let regraNaoPode = '';
    let tituloEmendaCustom = null;
    let tagsBuscaExtra = '';

    const modCod = String(modalidade ? modalidade : '').substring(0, 6);
    const acaoUpper = String(acao ? acao : '').toUpperCase();
    const vincUpper = String(vinculoDesc ? vinculoDesc : '').toUpperCase();
    const vCod = String(vinculoCod ? vinculoCod : '').trim();

    const ehFolha = (modCod === '331900' || modCod === '331710');
    const ehCusteioDireto = (modCod === '333900' || modCod === '333910');
    const ehPermanenteDireto = (modCod === '344900' || modCod === '344710');
    const ehEntidadeCusteio = (modCod === '333500');
    const ehEntidadeCapital = (modCod === '344500');
    const ehConsorcio = (modCod === '333710');

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

    if (regrasPlanilhaPorRef[refNum]) {
        const rp = regrasPlanilhaPorRef[refNum];
        tags.push(rp.parlamentar);
        tituloEmendaCustom = `🇧🇷 ${rp.parlamentar} (Ref. ${refNum})`;
        regraPode = rp.pode;
        regraNaoPode = rp.naoPode;
        tagsBuscaExtra = ` ${rp.parlamentar} ${rp.pode} `;
    }

    if (vCod.startsWith('150070112')) {
        const num3 = vCod.slice(-3);
        const imp = emendasImpositivas2025.find(e => e.num === num3);
        if (imp) {
            tags.push(`Vereador(a): ${imp.autor}`);
            tags.push(`Destino: ${imp.beneficiario}`);
            if (imp.pd) tags.push(imp.pd);
            tituloEmendaCustom = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario}`;
            const podeEspecifico = (ehEntidadeCusteio && imp.pode3350) ? imp.pode3350 : ((ehEntidadeCapital && imp.pode4450) ? imp.pode4450 : imp.pode);
            regraPode = `${podeEspecifico} (Natureza: ${imp.natureza}).`;
            regraNaoPode = imp.naoPode;
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

    const regraEditada = customRulesDB[refNum];
    if (regraEditada) {
        if (regraEditada.pode) {
            const txt = `✍️ ADICIONADO PELA CONTABILIDADE: ${esc(regraEditada.pode)}`;
            regraPode = regraPode ? `${regraPode} | ${txt}` : txt;
            tagsBuscaExtra += ` ${regraEditada.pode} `;
        }
        if (regraEditada.naoPode) {
            const txt = `✍️ VEDADO (CONTABILIDADE): ${esc(regraEditada.naoPode)}`;
            regraNaoPode = regraNaoPode ? `${regraNaoPode} | ${txt}` : txt;
        }
        tags.push('✍️ Editado pela Contabilidade');
    }

    return {
        tags: [...new Set(tags)],
        regraPode,
        regraNaoPode,
        ehEmenda,
        tituloEmendaCustom,
        regraCustomPode: (regraEditada && regraEditada.pode) ? regraEditada.pode : '',
        regraCustomNaoPode: (regraEditada && regraEditada.naoPode) ? regraEditada.naoPode : '',
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
// 5. MOTOR DE PERSISTENCIA: CARREGA DO SUPABASE OU LOCALSTORAGE AO ABRIR
// =========================================================================
async function inicializarBancoDeDados() {
    let origemDados = 'Pasta Local (dados_iniciais.js)';
    let dotacoesCarregadas = null;
    let auditoriaCarregada = null;
    let contratosCarregados = null;

    const cacheRules = localStorage.getItem(STORAGE_KEYS.CUSTOM_RULES);
    if (cacheRules) {
        try { customRulesDB = JSON.parse(cacheRules); } catch (e) { customRulesDB = {}; }
        if (!customRulesDB) customRulesDB = {};
    }

    if (supabaseAtivo) {
        try {
            // As duas consultas em paralelo (carrega mais rápido)
            const [{ data: dSupa, error: errD }, { data: aSupa, error: errA }] = await Promise.all([
                supabase.from('dotacoes_orcamentarias').select('*').order('ref', { ascending: true }),
                supabase.from('auditoria_empenhos_parados').select('*').order('saldo', { ascending: false })
            ]);
            let cargaInicial = false;
            if (!errD && dSupa && dSupa.length > 0) {
                dotacoesCarregadas = dSupa.map(d => {
                    if (d.regra_custom_pode || d.regra_custom_nao_pode) {
                        customRulesDB[d.ref] = {
                            pode: d.regra_custom_pode ? d.regra_custom_pode : '',
                            naoPode: d.regra_custom_nao_pode ? d.regra_custom_nao_pode : ''
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
                cargaInicial = true;
                await supabase.from('dotacoes_orcamentarias').upsert(rawDotacoesReais, { onConflict: 'ref' });
                await supabase.from('auditoria_empenhos_parados').upsert(auditoriaParaSupabase(auditoriaParadosIniciais), { onConflict: 'emp' });
                origemDados = '☁️ Nuvem Supabase (Carga Inicial Automática Concluída!)';
            }
            // Tabela vazia na nuvem = "limpei tudo", não "nunca carreguei" (exceto na carga inicial acima)
            if (!errA && Array.isArray(aSupa) && !cargaInicial) {
                auditoriaCarregada = aSupa.map(a => ({
                    emp: a.emp,
                    especie: a.especie,
                    ref: a.ref == null ? null : Number(a.ref),
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
                const dataSync = localStorage.getItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO);
                origemDados = `💾 Banco do Navegador (Atualizado em ${dataSync ? dataSync : 'Recente'})`;
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

    construirBaseDotacoes(dotacoesCarregadas ? dotacoesCarregadas : rawDotacoesReais);
    auditoriaParadosDB = auditoriaCarregada ? auditoriaCarregada : [...auditoriaParadosIniciais];
    contratosCruzadosDB = contratosCarregados ? contratosCarregados : [...contratosCruzadosIniciais];

    const badgeTopo = document.getElementById('badgeStatusTopo');
    if (badgeTopo) badgeTopo.textContent = origemDados;

    popularFiltrosGlobais();
    renderizarTudo();
}

function baixarArquivoDadosIniciaisAtualizado() {
    const dotacoesLimpa = dotacoesDB.map(d => ({
        ref: d.ref,
        acao: d.acao,
        acao_num: d.acao_num ? d.acao_num : String(d.acao).split(' - ')[0],
        modalidade: d.modalidade,
        mod_cod: d.mod_cod ? d.mod_cod : String(d.modalidade).split(' - ')[0],
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
    const nomeVinculo = d.tituloEmendaCustom ? d.tituloEmendaCustom : d.vinculo_desc;
    return `
        <span class="ref-badge px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 font-extrabold text-xs transition">
            Ref. ${d.ref} <i data-lucide="info" class="w-3 h-3"></i>
            <span class="ref-popover">
                <span class="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Dotação Ref. ${d.ref} • ${d.ehEmenda ? 'Emenda Parlamentar' : 'Orçamento Regular'}</span>
                <span class="block font-bold text-xs text-white mb-1">${d.acao}</span>
                <span class="block text-[11px] text-slate-300 mb-2"><strong>Vínculo:</strong> ${nomeVinculo}</span>
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
        selBloco.innerHTML += acoesUnicas.map(a => `<option value="${esc(a)}" class="bg-slate-900">${esc(a)}</option>`).join('');
    }

    const selDot = document.getElementById('filtroDotacaoGlobal');
    if (selDot) {
        const ordenadasRef = [...dotacoesDB].sort((a, b) => a.ref - b.ref);
        selDot.innerHTML = `<option value="TODAS" class="bg-slate-900">Todas as Refs (${dotacoesDB.length})</option>` +
            ordenadasRef.map(d => {
                const labelVinc = (d.tituloEmendaCustom ? d.tituloEmendaCustom : d.vinculo_desc).slice(0, 38);
                return `<option value="${d.ref}" class="bg-slate-900">Ref. ${d.ref} • ${esc(labelVinc)} (${formatarBRL(d.saldo_reserva)})</option>`;
            }).join('');
    }

    popularFiltroAuditoria();
}

// Dropdown da Aba 5 (separado para poder atualizar após limpeza sem resetar os filtros globais)
function popularFiltroAuditoria() {
    const selAud = document.getElementById('filtroRefAuditoriaSelect');
    if (!selAud) return;
    const valorAtual = selAud.value;

    const porRef = new Map();
    auditoriaParadosDB.forEach(r => {
        const g = porRef.get(r.ref) || { qtd: 0, soma: 0 };
        g.qtd++; g.soma += r.saldo;
        porRef.set(r.ref, g);
    });
    const dotPorRef = new Map(dotacoesDB.map(d => [d.ref, d]));

    const opcoes = [...porRef.keys()].sort((a, b) => (a ?? 0) - (b ?? 0)).map(rNum => {
        const { qtd, soma } = porRef.get(rNum);
        const dot = dotPorRef.get(rNum);
        const desc = dot ? (dot.tituloEmendaCustom ? dot.tituloEmendaCustom : dot.vinculo_desc).slice(0, 34) : 'Sem Ref. no IPM';
        return `<option value="${rNum ?? ''}">Ref. ${rNum ?? '—'} (${qtd} emp. = ${formatarBRL(soma)}) • ${esc(desc)}</option>`;
    });
    selAud.innerHTML = `<option value="">📋 Mostrar Todas as Dotações Auditadas (${auditoriaParadosDB.length} empenhos)</option>` + opcoes.join('');
    if ([...selAud.options].some(o => o.value === valorAtual)) selAud.value = valorAtual;
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
// 6. ABA 1: NOVOS GRAFICOS ESTRATEGICOS (EMENDAS + CATEGORIAS + FONTES + FUNIL)
// =========================================================================
function atualizarKPIsTopo(dotacoes) {
    const somaAtualizado = dotacoes.reduce((a, b) => a + b.atualizado, 0);
    const somaEmp = dotacoes.reduce((a, b) => a + b.empenhado, 0);
    const somaEmendasLivres = dotacoes.filter(d => d.ehEmenda).reduce((a, b) => a + b.saldo_reserva, 0);
    const somaParados = auditoriaParadosDB.reduce((a, b) => a + b.saldo, 0);

    const qtdEmendas = dotacoes.filter(d => d.ehEmenda && d.saldo_reserva > 100).length;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    set('kpiOrcadoAtual', formatarBRL(somaAtualizado));
    set('kpiSubOrcado', `Empenhado: <strong>${formatarBRL(somaEmp)}</strong> (Clique p/ abrir)`);
    set('kpiEmendasLivres', formatarBRL(somaEmendasLivres));
    set('kpiEmendasQtd', `<strong>${qtdEmendas} Refs de Emendas</strong> com saldo livre p/ reserva`);
    set('kpiParadosTopo', formatarBRL(somaParados));
    set('kpiParadosQtd', `<strong>${auditoriaParadosDB.length} empenhos travados</strong> p/ estornar ou cobrar NF`);

    // Faixa do topo (antes era texto fixo e ficava desatualizado após cada importação)
    set('topoOrcado', formatarBRL(dotacoesDB.reduce((a, b) => a + b.atualizado, 0)));
    set('topoEmpenhado', formatarBRL(dotacoesDB.reduce((a, b) => a + b.empenhado, 0)));
    set('topoLivre', formatarBRL(dotacoesDB.reduce((a, b) => a + b.saldo_reserva, 0)));
}

// Textos da Aba 5 que antes eram fixos ("109 empenhos", "R$ 854.939,42")
function atualizarTitulosAuditoria() {
    const total = auditoriaParadosDB.reduce((a, b) => a + b.saldo, 0);
    const el = document.getElementById('tituloAuditoria');
    if (el) el.textContent = `Auditoria dos ${auditoriaParadosDB.length} Empenhos Parados (${formatarBRL(total)} Bloqueados)`;
}

// GRAFICO 1: EMENDAS PARLAMENTARES (ESFERAS VS. DETALHAMENTO POR AUTOR)
function alternarVisaoGraficoEmendas() {
    modoDetalheEmendasBI = !modoDetalheEmendasBI;
    const btn = document.getElementById('btnAlternarVisaoEmendasBI');
    if (btn) {
        btn.innerHTML = modoDetalheEmendasBI
            ? `<i data-lucide="minimize-2" class="w-3.5 h-3.5 text-amber-400"></i> Voltar p/ Resumo por Esfera (Vereadores / Estado / União)`
            : `<i data-lucide="maximize-2" class="w-3.5 h-3.5 text-amber-400"></i> Ver Todas por Parlamentar / Autor`;
    }
    renderizarGraficoEmendasBI();
    if (window.lucide) lucide.createIcons();
}

function renderizarGraficoEmendasBI() {
    const canvas = document.getElementById('chartEmendasBI');
    const wrapper = document.getElementById('wrapperGraficoEmendas');
    const kpisBox = document.getElementById('kpisResumoEmendasGrafico');
    if (!canvas || !wrapper) return;

    const dotacoes = obterDotacoesFiltroGlobal();
    const emendasAtivas = dotacoes.filter(d => d.ehEmenda);

    const esferas = {
        '🏛️ Vereadores (Impositivas Municipais)': { totalAtivo: 0, empenhado: 0, livre: 0, bloqueado: 0 },
        '🚩 Estado SC (Emendas Estaduais / FES)': { totalAtivo: 0, empenhado: 0, livre: 0, bloqueado: 0 },
        '🇧🇷 União (Deputados Federais / MS)': { totalAtivo: 0, empenhado: 0, livre: 0, bloqueado: 0 }
    };

    const porAutor = {};
    function somarAutor(nome, ativo, emp, liv, bloq) {
        if (!porAutor[nome]) porAutor[nome] = { totalAtivo: 0, empenhado: 0, livre: 0, bloqueado: 0 };
        porAutor[nome].totalAtivo += ativo;
        porAutor[nome].empenhado += emp;
        porAutor[nome].livre += liv;
        porAutor[nome].bloqueado += bloq;
    }

    emendasAtivas.forEach(d => {
        const vCod = String(d.vinculo_cod);
        let chaveEsfera = '🇧🇷 União (Deputados Federais / MS)';
        let nomeAutor = d.tituloEmendaCustom ? d.tituloEmendaCustom : d.vinculo_desc;

        if (vCod.startsWith('15007011') || vCod.startsWith('2500')) {
            chaveEsfera = '🏛️ Vereadores (Impositivas Municipais)';
            if (vCod.startsWith('150070112')) {
                const num3 = vCod.slice(-3);
                const imp = emendasImpositivas2025.find(x => x.num === num3);
                if (imp) nomeAutor = `Ver. ${imp.autor}`;
            } else if (vCod === '250070114501') nomeAutor = 'Ver. Michell Nunes (2024)';
            else if (vCod === '250070114502') nomeAutor = 'Bancada PP (2024)';
            else if (vCod === '250070114503') nomeAutor = 'Bancada PSDB (2024)';
            else if (vCod === '250070114504') nomeAutor = 'Ver. Jesiel Antulino (2025)';
            else nomeAutor = 'Emendas Municipais Consolidadas';
        } else if (vCod.startsWith('2621') || vCod.startsWith('1621') || vCod.startsWith('2710') || vCod.startsWith('1701')) {
            chaveEsfera = '🚩 Estado SC (Emendas Estaduais / FES)';
            nomeAutor = vCod.includes('1368') ? 'Portaria 017/223 (Estado)' : 'Emendas Estaduais SC';
        } else {
            if (regrasPlanilhaPorRef[d.ref]) {
                nomeAutor = regrasPlanilhaPorRef[d.ref].parlamentar.split('(')[0].trim();
            } else {
                nomeAutor = d.vinculo_desc.replace(/^\d+\s*-\s*/, '').replace('SUS União - Emenda Incremento Temporário - ', '').trim();
            }
        }

        esferas[chaveEsfera].totalAtivo += d.atualizado;
        esferas[chaveEsfera].empenhado += d.empenhado;
        esferas[chaveEsfera].livre += d.saldo_reserva;
        somarAutor(nomeAutor, d.atualizado, d.empenhado, d.saldo_reserva, 0);
    });

    emendasImpositivas2025.forEach(imp => {
        const codEsperado = '150070112' + imp.num;
        const existeNoIPM = dotacoesDB.some(d => String(d.vinculo_cod) === codEsperado);
        if (!existeNoIPM) {
            esferas['🏛️ Vereadores (Impositivas Municipais)'].bloqueado += imp.valor;
            somarAutor(`Ver. ${imp.autor}`, 0, 0, 0, imp.valor);
        }
    });

    propostasFNSReais.forEach(p => {
        if (!p.jaNoIPM) {
            esferas['🇧🇷 União (Deputados Federais / MS)'].bloqueado += p.valor;
            somarAutor(`[FNS] ${p.parlamentar.slice(0, 28)}`, 0, 0, 0, p.valor);
        }
    });

    const totAtivoGlobal = Object.values(esferas).reduce((a, b) => a + b.totalAtivo, 0);
    const totEmpGlobal = Object.values(esferas).reduce((a, b) => a + b.empenhado, 0);
    const totLivreGlobal = Object.values(esferas).reduce((a, b) => a + b.livre, 0);
    const totBloqGlobal = Object.values(esferas).reduce((a, b) => a + b.bloqueado, 0);

    if (kpisBox) {
        kpisBox.innerHTML = `
            <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                <span class="text-[10px] font-bold uppercase text-slate-500 block">Total Emendas Ativas (No IPM)</span>
                <strong class="text-base font-extrabold text-slate-900">${formatarBRL(totAtivoGlobal)}</strong>
            </div>
            <div class="bg-blue-50/70 border border-blue-200 p-3 rounded-xl">
                <span class="text-[10px] font-bold uppercase text-blue-800 block">Total Já Empenhado</span>
                <strong class="text-base font-extrabold text-blue-900">${formatarBRL(totEmpGlobal)}</strong>
            </div>
            <div class="bg-emerald-50/70 border border-emerald-200 p-3 rounded-xl">
                <span class="text-[10px] font-bold uppercase text-emerald-800 block">Saldo Livre das Emendas</span>
                <strong class="text-base font-extrabold text-emerald-700">${formatarBRL(totLivreGlobal)}</strong>
            </div>
            <div class="bg-slate-100 border border-slate-300 p-3 rounded-xl">
                <span class="text-[10px] font-bold uppercase text-slate-600 block">⏳ A Entrar / Em Liberação (FNS + Pendentes)</span>
                <strong class="text-base font-extrabold text-slate-600">${formatarBRL(totBloqGlobal)}</strong>
            </div>
        `;
    }

    if (chartEmendasBIInstance) chartEmendasBIInstance.destroy();
    const ctx = canvas.getContext('2d');

    let labels = [];
    let dataAtivo = [];
    let dataEmp = [];
    let dataLivre = [];
    let dataBloq = [];

    if (!modoDetalheEmendasBI) {
        wrapper.style.height = '280px';
        labels = Object.keys(esferas);
        dataAtivo = labels.map(k => esferas[k].totalAtivo);
        dataEmp = labels.map(k => esferas[k].empenhado);
        dataLivre = labels.map(k => esferas[k].livre);
        dataBloq = labels.map(k => esferas[k].bloqueado);
    } else {
        const listaAutores = Object.entries(porAutor)
            .sort((a, b) => (b[1].totalAtivo + b[1].bloqueado) - (a[1].totalAtivo + a[1].bloqueado));
        wrapper.style.height = Math.max(380, listaAutores.length * 36) + 'px';
        labels = listaAutores.map(x => x[0]);
        dataAtivo = listaAutores.map(x => x[1].totalAtivo);
        dataEmp = listaAutores.map(x => x[1].empenhado);
        dataLivre = listaAutores.map(x => x[1].livre);
        dataBloq = listaAutores.map(x => x[1].bloqueado);
    }

    const scalesConfig = modoDetalheEmendasBI
        ? {
            x: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (Number(v) / 1000).toFixed(0) + 'k' } },
            y: { ticks: { autoSkip: false } }
          }
        : {
            x: { ticks: { autoSkip: false } },
            y: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (Number(v) / 1000000).toFixed(1) + ' Mi' } }
          };

    chartEmendasBIInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Total Ativo no IPM (R$)', data: dataAtivo, backgroundColor: '#0f172a', borderRadius: 4 },
                { label: 'Total Empenhado (R$)', data: dataEmp, backgroundColor: '#2563eb', borderRadius: 4 },
                { label: 'Saldo Livre Disponível (R$)', data: dataLivre, backgroundColor: '#10b981', borderRadius: 4 },
                { label: '⏳ A Entrar / Em Liberação (Bloqueado)', data: dataBloq, backgroundColor: '#94a3b8', borderRadius: 4 }
            ]
        },
        options: {
            indexAxis: modoDetalheEmendasBI ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatarBRL(c.raw)}` } }
            },
            scales: scalesConfig
        }
    });
}

// GRAFICO 2: ORCAMENTO POR CATEGORIA PRATICA (COMBUSTIVEL, MEDICAMENTOS, PERMANENTE, ETC.)
function alternarExpansaoCategoriasBI() {
    mostrarTodasCategoriasBI = !mostrarTodasCategoriasBI;
    const btn = document.getElementById('btnExpandirCategoriasBI');
    if (btn) {
        btn.innerHTML = mostrarTodasCategoriasBI
            ? `<i data-lucide="list-minus" class="w-3.5 h-3.5"></i> Mostrar Apenas Top 5 Categorias`
            : `<i data-lucide="list-plus" class="w-3.5 h-3.5"></i> Mostrar Todas as Categorias`;
    }
    renderizarGraficoCategoriasBI();
    if (window.lucide) lucide.createIcons();
}

function renderizarGraficoCategoriasBI() {
    const canvas = document.getElementById('chartCategoriasBI');
    const wrapper = document.getElementById('wrapperGraficoCategorias');
    if (!canvas || !wrapper) return;

    const dotacoes = obterDotacoesFiltroGlobal();
    const elFiltroFolha = document.getElementById('selectFiltroCategoriaBI');
    const incluirFolha = elFiltroFolha ? elFiltroFolha.value === 'COM_FOLHA' : false;

    const definicaoCategorias = [
        {
            nome: '⛽ Combustível, Frota, TFD & SAMU',
            termoBuscaAba2: 'combustivel',
            filtro: (d) => {
                const txt = normalizarTexto(`${d.acao} ${d.regraPode} ${d.tagsBusca}`);
                return d.acao.includes('2084') || d.acao.includes('2086') || txt.includes('combustivel') || txt.includes('frota') || txt.includes('ambulancia');
            }
        },
        {
            nome: '💊 Medicamentos & Insumos (Gaze/Seringa)',
            termoBuscaAba2: 'gaze',
            filtro: (d) => {
                const mod = String(d.modalidade).substring(0, 6);
                return (d.acao.includes('2089') || d.acao.includes('2090') || String(d.vinculo_desc).includes('017/223') || [512, 514, 518, 545].includes(d.ref)) && mod === '333900';
            }
        },
        {
            nome: '❄️ Material Permanente, Móveis & Veículos',
            termoBuscaAba2: 'cadeira',
            filtro: (d) => {
                const mod = String(d.modalidade).substring(0, 6);
                return mod === '344900' || mod === '344710' || mod === '344500';
            }
        },
        {
            nome: '🤝 Exames & Consórcio CISAMUREL',
            termoBuscaAba2: 'consorcio',
            filtro: (d) => String(d.modalidade).startsWith('333710')
        },
        {
            nome: '🏥 Hospital São Camilo, APAE, AMAI & Entidades',
            termoBuscaAba2: 'entidade',
            filtro: (d) => String(d.modalidade).startsWith('333500') || String(d.modalidade).startsWith('344500')
        },
        {
            nome: '🛠️ Reforma, Obras & Manutenção de UBSs',
            termoBuscaAba2: 'manutencao',
            filtro: (d) => d.acao.includes('1020') || [535, 537, 538, 620, 621].includes(d.ref)
        },
        {
            nome: '💻 Tecnologia, Sistemas & SUS Digital',
            termoBuscaAba2: 'tecnologia',
            filtro: (d) => d.acao.includes('2121') || [83, 510, 515, 520, 779].includes(d.ref)
        },
        {
            nome: '🦷 Saúde Bucal & Consultórios Odontológicos',
            termoBuscaAba2: 'odonto',
            filtro: (d) => d.acao.includes('2076') || [514, 535, 761, 762].includes(d.ref)
        },
        {
            nome: '🏢 Custeio Geral APS / MAC & Aluguéis',
            termoBuscaAba2: 'aluguel',
            filtro: (d) => String(d.modalidade).startsWith('333900') && (d.acao.includes('2075') || d.acao.includes('2080') || d.acao.includes('2083'))
        }
    ];

    if (incluirFolha) {
        definicaoCategorias.unshift({
            nome: '👥 Folha de Pagamento & Encargos (RH)',
            termoBuscaAba2: 'folha',
            filtro: (d) => String(d.modalidade).startsWith('331900') || String(d.modalidade).startsWith('331710')
        });
    }

    const resultadosCat = definicaoCategorias.map(cat => {
        const refsMatch = dotacoes.filter(cat.filtro);
        return {
            nome: cat.nome,
            termoBuscaAba2: cat.termoBuscaAba2,
            qtdRefs: refsMatch.length,
            orcado: refsMatch.reduce((a, b) => a + b.atualizado, 0),
            empenhado: refsMatch.reduce((a, b) => a + b.empenhado, 0),
            livre: refsMatch.reduce((a, b) => a + b.saldo_reserva, 0)
        };
    }).sort((a, b) => b.livre - a.livre);

    const exibidas = mostrarTodasCategoriasBI ? resultadosCat : resultadosCat.slice(0, 5);
    wrapper.style.height = mostrarTodasCategoriasBI ? '430px' : '280px';

    if (chartCategoriasBIInstance) chartCategoriasBIInstance.destroy();
    const ctx = canvas.getContext('2d');

    chartCategoriasBIInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: exibidas.map(c => `${c.nome} (${c.qtdRefs} Refs)`),
            datasets: [
                { label: 'Total das Dotações (Atualizado)', data: exibidas.map(c => c.orcado), backgroundColor: '#0f172a', borderRadius: 4 },
                { label: 'Total Empenhado', data: exibidas.map(c => c.empenhado), backgroundColor: '#f59e0b', borderRadius: 4 },
                { label: 'Saldo Disponível p/ Comprar', data: exibidas.map(c => c.livre), backgroundColor: '#10b981', borderRadius: 4 }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements && elements.length > 0) {
                    const idx = elements[0].index;
                    const catClicada = exibidas[idx];
                    if (catClicada) {
                        trocarAba('aba-dotacoes', document.getElementById('btn-aba-dotacoes'));
                        const inp = document.getElementById('inputBuscaNecessidade');
                        if (inp) inp.value = catClicada.termoBuscaAba2;
                        filtrarAbaDotacoes();
                    }
                }
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatarBRL(c.raw)} (Clique p/ abrir as dotações)` } }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: (v) => 'R$ ' + (Number(v) / 1000000).toFixed(1) + ' Mi' }
                },
                y: {
                    ticks: { autoSkip: false }
                }
            }
        }
    });
}

// GRAFICOS 3 E 4: FONTES DE RECURSO E FUNIL FINANCEIRO GLOBAL
function renderizarGraficos(dotacoes) {
    const cFontes = document.getElementById('chartFontes');
    const cBlocos = document.getElementById('chartBlocos');
    if (!cFontes || !cBlocos) return;

    const ctxFontes = cFontes.getContext('2d');
    const ctxBlocos = cBlocos.getContext('2d');
    if (chartFontesInstance) chartFontesInstance.destroy();
    if (chartBlocosInstance) chartBlocosInstance.destroy();

    const fontesMacro = {
        'Impostos Próprios (15% Município)': { emp: 0, res: 0, livre: 0 },
        'SUS União (Repasses Fundo a Fundo)': { emp: 0, res: 0, livre: 0 },
        'SUS Estado SC (Cofinanciamento)': { emp: 0, res: 0, livre: 0 },
        'Emendas Parlamentares (Ver./Dep.)': { emp: 0, res: 0, livre: 0 }
    };

    dotacoes.forEach(d => {
        const vCod = String(d.vinculo_cod);
        let k = 'SUS União (Repasses Fundo a Fundo)';
        if (d.ehEmenda) {
            k = 'Emendas Parlamentares (Ver./Dep.)';
        } else if (vCod.startsWith('1500') || vCod.startsWith('1501') || vCod.startsWith('2500')) {
            k = 'Impostos Próprios (15% Município)';
        } else if (vCod.startsWith('1621') || vCod.startsWith('2621')) {
            k = 'SUS Estado SC (Cofinanciamento)';
        }
        fontesMacro[k].emp += d.empenhado;
        fontesMacro[k].res += d.reservado;
        fontesMacro[k].livre += d.saldo_reserva;
    });

    const labels = Object.keys(fontesMacro);

    chartFontesInstance = new Chart(ctxFontes, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Empenhado', data: labels.map(k => fontesMacro[k].emp), backgroundColor: '#0f172a', borderRadius: 4 },
                { label: 'Reservado', data: labels.map(k => fontesMacro[k].res), backgroundColor: '#f59e0b', borderRadius: 4 },
                { label: 'Saldo Livre Real', data: labels.map(k => fontesMacro[k].livre), backgroundColor: '#10b981', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatarBRL(c.raw)}` } }
            },
            scales: { y: { ticks: { callback: (v) => 'R$ ' + (Number(v) / 1000000).toFixed(1) + 'M' } } }
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

// =========================================================================
// 7. ABA 2: ONDE POSSO GASTAR? (COM DRILL-DOWN SEMPRE FECHADO POR PADRAO)
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
    const elBusca = document.getElementById('inputBuscaNecessidade');
    const rawTermo = elBusca ? elBusca.value.trim() : '';
    const termo = normalizarTexto(rawTermo).replace(/\bgase\b/g, 'gaze');
    const elSaldo = document.getElementById('selectApenasComSaldo');
    const modoSaldo = elSaldo ? elSaldo.value : 'COM_SALDO';
    const elOrd2 = document.getElementById('selectOrdenacaoAba2');
    const ordenacao = elOrd2 ? elOrd2.value : 'SALDO_DESC';
    const boxResumo = document.getElementById('resumoBuscaNecessidade');

    let filtradas = base.filter(d => {
        const matchTag = tagPermissaoAtiva === 'TODOS' || d.permissoesTags.some(t => t.includes(tagPermissaoAtiva) || tagPermissaoAtiva.includes(t));
        const titCustom = d.tituloEmendaCustom ? d.tituloEmendaCustom : '';
        const tExtra = d.tagsBusca ? d.tagsBusca : '';
        const texto = normalizarTexto(`Ref ${d.ref} ${d.acao} ${d.vinculo_desc} ${titCustom} ${d.regraPode} ${tExtra} ${d.permissoesTags.join(' ')}`).replace(/\bgase\b/g, 'gaze');
        const matchTermo = !termo || texto.includes(termo);
        const matchSaldo = modoSaldo === 'TODAS' || d.saldo_reserva > 100;
        return matchTag && matchTermo && matchSaldo;
    });

    if (ordenacao === 'ALFABETICA') {
        filtradas.sort((a, b) => {
            const nomeA = a.tituloEmendaCustom ? a.tituloEmendaCustom : a.acao;
            const nomeB = b.tituloEmendaCustom ? b.tituloEmendaCustom : b.acao;
            return nomeA.localeCompare(nomeB, 'pt-BR');
        });
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
        const tituloCard = d.tituloEmendaCustom ? d.tituloEmendaCustom : d.acao;

        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3 print-shadow-none">
                <div class="p-5 border-l-4 ${d.saldo_reserva > 1000 ? 'border-emerald-500' : 'border-rose-400'}">
                    <div class="flex flex-wrap justify-between items-start gap-4">
                        <div class="flex-1 space-y-1.5 cursor-pointer" onclick="document.getElementById('${idCollapse}').classList.toggle('hidden')">
                            <div class="flex flex-wrap items-center gap-2">
                                ${gerarBadgeRefComPopover(d.ref)}
                                <span class="text-sm font-extrabold text-slate-900">${tituloCard}</span>
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

// =========================================================================
// 8. ABA 3: RENDERIZADOR DE EMENDAS PARLAMENTARES
// =========================================================================
function renderizarEmendas() {
    const dotacoes = obterDotacoesFiltroGlobal();
    const elBuscaEm = document.getElementById('inputBuscaEmenda');
    const rawBusca = elBuscaEm ? elBuscaEm.value : '';
    const busca = normalizarTexto(rawBusca).replace(/\bgase\b/g, 'gaze');
    const elEsf = document.getElementById('selectFiltroEsferaEmenda');
    const filtroEsfera = elEsf ? elEsf.value : 'TODAS';
    const elOrdEm = document.getElementById('selectOrdenacaoEmendas');
    const ordenacao = elOrdEm ? elOrdEm.value : 'SALDO_DESC';

    const emendas = dotacoes.filter(d => d.ehEmenda);
    const agrupadas = {};

    emendas.forEach(e => {
        // dotacoesDB já traz tudo classificado (construirBaseDotacoes) — não precisa reclassificar
        const key = e.tituloEmendaCustom ? e.tituloEmendaCustom : e.vinculo_desc;
        if (!agrupadas[key]) {
            agrupadas[key] = {
                vinculo: key,
                numOrdem: e.ref,
                esfera: String(e.vinculo_cod).startsWith('15007011') || String(e.vinculo_cod).startsWith('2500') ? 'MUNICIPAL' : 'FEDERAL_ESTADUAL',
                emProcessoLiberacao: false,
                refs: [],
                totalAtualizado: 0,
                totalLivre: 0,
                tagsGlobais: new Set()
            };
        }
        agrupadas[key].refs.push({ ...e, emProcessoLiberacao: false, tagsBusca: e.tagsBusca || '' });
        agrupadas[key].totalAtualizado += e.atualizado;
        agrupadas[key].totalLivre += e.saldo_reserva;
        e.permissoesTags.forEach(t => agrupadas[key].tagsGlobais.add(t));
    });

    emendasImpositivas2025.forEach(imp => {
        const codEsperado = '150070112' + imp.num;
        const existeNoIPM = dotacoesDB.some(d => String(d.vinculo_cod) === codEsperado);
        if (!existeNoIPM) {
            const key = `🏛️ Emenda Impositiva nº ${imp.num} — ${imp.autor} ➔ ${imp.beneficiario}`;
            const numInt = parseInt(imp.num, 10);
            agrupadas[key] = {
                vinculo: key,
                numOrdem: isNaN(numInt) ? 999 : numInt,
                esfera: 'MUNICIPAL',
                emProcessoLiberacao: true,
                totalAtualizado: imp.valor,
                totalLivre: 0,
                tagsGlobais: new Set([`Vereador(a): ${imp.autor}`, `Destino: ${imp.beneficiario}`, `Natureza: ${imp.natureza}`, `⏳ Em processo de liberação`]),
                refs: [{
                    ref: 'Sem Dotação IPM',
                    emProcessoLiberacao: true,
                    acao: `Ação ${imp.acao} (${imp.beneficiario})`,
                    atualizado: imp.valor,
                    empenhado: 0,
                    saldo_reserva: 0,
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
            emProcessoLiberacao: true,
            totalAtualizado: p.valor,
            totalLivre: 0,
            tagsGlobais: new Set([`Ano: ${p.ano}`, p.emenda, p.status, p.natureza, `⏳ Em processo de liberação`]),
            refs: [{
                ref: `FNS ${p.ano}`,
                emProcessoLiberacao: true,
                acao: `${p.objeto} • Natureza: ${p.natureza}`,
                atualizado: p.valor,
                empenhado: 0,
                saldo_reserva: 0,
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
        const detalhesRefs = g.refs.map(r => {
            const rp = r.regraPode ? r.regraPode : '';
            const tb = r.tagsBusca ? r.tagsBusca : '';
            return `${rp} ${r.ref} ${tb}`;
        }).join(' ');
        const txtGrupo = normalizarTexto(`${g.vinculo} ${Array.from(g.tagsGlobais).join(' ')} ${detalhesRefs}`).replace(/\bgase\b/g, 'gaze');
        return txtGrupo.includes(busca);
    });

    if (ordenacao === 'ALFABETICA') {
        listaFiltrada.sort((a, b) => a.vinculo.localeCompare(b.vinculo, 'pt-BR'));
    } else if (ordenacao === 'NUMERICA') {
        listaFiltrada.sort((a, b) => {
            const ordA = a.numOrdem ? a.numOrdem : 999;
            const ordB = b.numOrdem ? b.numOrdem : 999;
            return ordA - ordB;
        });
    } else {
        listaFiltrada.sort((a, b) => {
            if (a.emProcessoLiberacao !== b.emProcessoLiberacao) {
                return a.emProcessoLiberacao ? 1 : -1;
            }
            const valB = b.emProcessoLiberacao ? b.totalAtualizado : b.totalLivre;
            const valA = a.emProcessoLiberacao ? a.totalAtualizado : a.totalLivre;
            return valB - valA;
        });
    }

    const container = document.getElementById('containerEmendasAcordeon');
    if (!container) return;

    container.innerHTML = listaFiltrada.map((grupo, idx) => {
        const idCollapse = `collapse-emenda-${idx}`;
        const pendente = grupo.emProcessoLiberacao === true;

        const tagsHTML = Array.from(grupo.tagsGlobais).map(t =>
            `<span class="px-2 py-0.5 ${pendente ? 'bg-slate-200/80 border-slate-300 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-700'} border rounded text-[10px] font-bold">${t}</span>`
        ).join('');

        const blocoValorHeader = pendente
            ? `<div class="text-right">
                   <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-slate-200 text-slate-600 border border-slate-300 uppercase tracking-wide">
                       ⏳ Em processo de liberação
                   </span>
                   <span class="text-xs font-bold text-slate-400 line-through block mt-1">
                       Valor previsto: ${formatarBRL(grupo.totalAtualizado)}
                   </span>
               </div>`
            : `<div class="text-right">
                   <span class="text-xs text-slate-500 block">Valor Global: ${formatarBRL(grupo.totalAtualizado)}</span>
                   <span class="text-sm font-extrabold text-amber-600 block">Saldo Livre: ${formatarBRL(grupo.totalLivre)}</span>
               </div>`;

        const refsHTML = grupo.refs.map(r => {
            const refPendente = r.emProcessoLiberacao === true;
            const boxDireitoRef = refPendente
                ? `<div class="text-right bg-slate-100 border border-slate-300 p-2.5 rounded-lg min-w-[190px] opacity-80">
                       <span class="text-[10px] font-extrabold uppercase text-slate-600 bg-slate-200 px-2 py-0.5 rounded block">⏳ Em processo de liberação</span>
                       <span class="text-xs font-bold text-slate-400 line-through mt-1.5 block">${formatarBRL(r.atualizado)}</span>
                       <span class="text-[10px] text-slate-400 block mt-0.5">Aguardando dotação/repasse</span>
                   </div>`
                : `<div class="text-right bg-white border border-slate-200 p-2.5 rounded-lg min-w-[175px]">
                       <span class="text-[11px] text-slate-500 block">Atualizado: ${formatarBRL(r.atualizado)}</span>
                       <span class="text-[11px] text-slate-500 block">Empenhado: ${formatarBRL(r.empenhado)}</span>
                       <span class="text-xs font-extrabold text-emerald-600 mt-1 block border-t border-slate-100 pt-1">Livre: ${formatarBRL(r.saldo_reserva)}</span>
                   </div>`;

            return `
                <div class="flex flex-wrap md:flex-nowrap items-start justify-between gap-4 p-4 border-b border-slate-100 last:border-0 ${refPendente ? 'bg-slate-50/70' : 'hover:bg-slate-50'} transition">
                    <div class="flex-1 space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                            ${typeof r.ref === 'number' ? gerarBadgeRefComPopover(r.ref) : `<span class="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-600 font-extrabold text-xs">${r.ref}</span>`}
                            <span class="text-xs font-bold ${refPendente ? 'text-slate-600' : 'text-slate-800'}">${r.acao}</span>
                            ${typeof r.ref === 'number' ? `<button onclick="abrirModalEdicao(${r.ref})" class="ml-auto px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-bold flex items-center gap-1 no-print"><i data-lucide="edit-3" class="w-3 h-3"></i> Editar Itens</button>` : ''}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                            <div class="bg-emerald-50/80 border border-emerald-200 p-2.5 rounded-lg text-xs">
                                <strong class="text-emerald-900 block mb-1">✅ O QUE PODE COMPRAR / PAGAR (JUSTIFICATIVA E OBJETO):</strong>
                                <span class="text-emerald-800 leading-relaxed">${r.regraPode}</span>
                            </div>
                            <div class="bg-rose-50/80 border border-rose-200 p-2.5 rounded-lg text-xs">
                                <strong class="text-rose-900 block mb-1">🚫 O QUE NÃO PODE COMPRAR (VEDAÇÃO):</strong>
                                <span class="text-rose-800 leading-relaxed">${r.regraNaoPode}</span>
                            </div>
                        </div>
                    </div>
                    ${boxDireitoRef}
                </div>
            `;
        }).join('');

        return `
            <div class="border ${pendente ? 'border-slate-300 bg-slate-100/70 opacity-85' : 'border-slate-200 bg-white'} rounded-xl overflow-hidden mb-3 shadow-sm">
                <button onclick="document.getElementById('${idCollapse}').classList.toggle('hidden')" class="w-full text-left px-5 py-4 ${pendente ? 'bg-slate-100 hover:bg-slate-200/70' : 'bg-slate-50 hover:bg-slate-100'} flex flex-wrap items-center justify-between gap-4 transition">
                    <div class="flex-1">
                        <h4 class="font-extrabold ${pendente ? 'text-slate-500' : 'text-slate-900'} text-sm">${grupo.vinculo}</h4>
                        <div class="flex flex-wrap gap-1.5 mt-2">${tagsHTML}</div>
                    </div>
                    ${blocoValorHeader}
                    <i data-lucide="chevron-down" class="w-5 h-5 text-slate-400"></i>
                </button>
                <div id="${idCollapse}" class="hidden bg-white border-t border-slate-200">
                    <div class="p-2 ${pendente ? 'bg-slate-600' : 'bg-slate-900'} text-white text-[11px] font-bold uppercase text-center tracking-wider">
                        Detalhamento Completo do Plano de Trabalho (O que Pode e Não Pode Comprar)
                    </div>
                    ${refsHTML}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 9. ABA 4: CONTRATOS E FILA DA TESOURARIA
// =========================================================================
function filtrarContratos(modo) {
    filtroSituacaoContratoAtivo = modo;
    renderizarFixos();
}

function renderizarFixos() {
    const tbody = document.getElementById('tabelaFixosBody');
    if (!tbody) return;

    const elBuscaC = document.getElementById('inputBuscaContratos');
    const busca = normalizarTexto(elBuscaC ? elBuscaC.value : '');
    const elOrdC = document.getElementById('selectOrdenacaoContratos');
    const ordenacao = elOrdC ? elOrdC.value : 'VALOR_DESC';

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
// 10. ABA 5: AUDITORIA DE EMPENHOS PARADOS
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

    const elInpAud = document.getElementById('inputBuscaRefAuditoria');
    const rawInput = elInpAud ? elInpAud.value.trim() : '';
    const apenasDigitos = /^\d+$/.test(rawInput);
    const termoTexto = normalizarTexto(rawInput);
    const elOrdAud = document.getElementById('selectOrdenacaoAuditoria');
    const ordenacao = elOrdAud ? elOrdAud.value : 'VALOR_DESC';

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

    atualizarTitulosAuditoria();
    atualizarBotaoLimpeza();

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-500 font-semibold">${
            rawInput ? `Nenhum empenho encontrado para "${esc(rawInput)}". Clique em "Ver Todas".` : 'Nenhum empenho parado na auditoria. ✅'
        }</td></tr>`;
        return;
    }

    tbody.innerHTML = filtrados.map(r => {
        const valorEmp = r.empenhadoTotal ? r.empenhadoTotal : r.saldo;
        const semSaldo = r.saldo <= SALDO_ZERO;
        return `
            <tr class="hover:bg-slate-50 ${semSaldo ? 'bg-slate-50 opacity-70' : ''}">
                <td class="py-3 px-3 whitespace-nowrap">
                    <div class="font-extrabold text-slate-900">Emp. ${esc(r.emp)}</div>
                    <span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${esc(r.especie)}</span>
                </td>
                <td class="py-3 px-3 whitespace-nowrap">
                    ${r.ref == null ? '<span class="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-extrabold text-xs">Sem Ref.</span>' : gerarBadgeRefComPopover(r.ref)}
                </td>
                <td class="py-3 px-3 font-bold text-slate-800">${esc(r.credor)}</td>
                <td class="py-3 px-3 text-slate-600 text-[11px] whitespace-nowrap">
                    <div>Emissão: <strong>${esc(r.emissao)}</strong></div>
                    <div>Últ. Liq: <strong class="${r.ultLiq === 'Nunca liq.' ? 'text-rose-600' : 'text-amber-700'}">${esc(r.ultLiq)}</strong> (${r.dias}d)</div>
                </td>
                <td class="py-3 px-3 text-right font-semibold text-slate-600 whitespace-nowrap">${formatarBRL(valorEmp)}</td>
                <td class="py-3 px-3 text-right font-extrabold ${semSaldo ? 'text-slate-400' : 'text-rose-600'} text-sm whitespace-nowrap">${formatarBRL(r.saldo)}</td>
                <td class="py-3 px-3 text-slate-700 font-medium">
                    <span class="inline-block px-2.5 py-1 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 font-semibold">${esc(r.acao)}</span>
                </td>
                <td class="py-3 px-3 text-right no-print">
                    <button data-remover-emp="${esc(r.emp)}" title="Remover este empenho da lista" class="px-2 py-1 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-300 hover:border-rose-300 rounded-lg text-[11px] font-bold transition">✕ Remover</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ---- Limpeza de empenhos que não prendem mais saldo -----------------------
// Remove do navegador (LocalStorage) e da nuvem (Supabase). Não altera o IPM:
// se o empenho ainda estiver aberto no IPM, ele volta na próxima importação do CSV.
function limiteLimpeza() {
    const el = document.getElementById('inputLimiteLimpeza');
    const v = el ? parseFloat(String(el.value).replace(',', '.')) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
}

function empenhosParaLimpar() {
    const lim = limiteLimpeza() + SALDO_ZERO;
    return auditoriaParadosDB.filter(r => r.saldo <= lim);
}

function atualizarBotaoLimpeza() {
    const btn = document.getElementById('btnLimparSemSaldo');
    if (!btn) return;
    const n = empenhosParaLimpar().length;
    btn.disabled = n === 0;
    btn.classList.toggle('opacity-50', n === 0);
    btn.classList.toggle('cursor-not-allowed', n === 0);
    btn.textContent = `🧹 Limpar ${n} empenho${n === 1 ? '' : 's'} sem saldo`;
}

function mostrarStatusLimpeza(html) {
    const el = document.getElementById('statusLimpezaAuditoria');
    if (el) el.innerHTML = html;
}

async function removerEmpenhosAuditoria(lista) {
    const emps = new Set(lista.map(r => r.emp));
    auditoriaParadosDB = auditoriaParadosDB.filter(r => !emps.has(r.emp));
    localStorage.setItem(STORAGE_KEYS.AUDITORIA, JSON.stringify(auditoriaParadosDB));

    let nuvemOk = true;
    if (supabaseAtivo) {
        const chaves = [...emps];
        for (let i = 0; i < chaves.length; i += 50) {
            const { error } = await supabase.from('auditoria_empenhos_parados').delete().in('emp', chaves.slice(i, i + 50));
            if (error) { nuvemOk = false; console.warn('Erro ao apagar no Supabase:', error); }
        }
    }

    popularFiltroAuditoria();
    atualizarKPIsTopo(obterDotacoesFiltroGlobal());
    try { renderizarGraficos(obterDotacoesFiltroGlobal()); } catch (e) { console.error(e); }
    renderizarAuditoria();
    return nuvemOk;
}

async function limparEmpenhosSemSaldo() {
    const lista = empenhosParaLimpar();
    if (lista.length === 0) return;
    const soma = lista.reduce((a, b) => a + b.saldo, 0);
    const lim = limiteLimpeza();
    const criterio = lim > 0 ? `saldo a liquidar de até ${formatarBRL(lim)}` : 'saldo a liquidar zerado';
    if (!confirm(`Remover ${lista.length} empenho(s) com ${criterio} (soma ${formatarBRL(soma)}) da Auditoria?\n\nIsso não altera o IPM. Se algum ainda estiver aberto lá, volta na próxima importação do CSV.`)) return;

    const ok = await removerEmpenhosAuditoria(lista);
    mostrarStatusLimpeza(ok
        ? `✅ ${lista.length} empenho(s) removido(s) (tela, navegador e nuvem).`
        : `⚠️ ${lista.length} removido(s) da tela e do navegador, mas a nuvem (Supabase) recusou a exclusão — veja o console (F12).`);
}

async function removerEmpenhoUnico(emp) {
    const r = auditoriaParadosDB.find(x => x.emp === emp);
    if (!r) return;
    const aviso = r.saldo > SALDO_ZERO
        ? `\n\n⚠️ Este empenho AINDA tem ${formatarBRL(r.saldo)} a liquidar. Remover só esconde da lista; o valor continua preso no IPM até ser estornado/liquidado.`
        : '';
    if (!confirm(`Remover o Emp. ${r.emp} (${r.credor}) da Auditoria?${aviso}`)) return;
    const ok = await removerEmpenhosAuditoria([r]);
    mostrarStatusLimpeza(ok ? `✅ Emp. ${esc(r.emp)} removido.` : `⚠️ Emp. ${esc(r.emp)} removido localmente; a nuvem recusou a exclusão (veja o console).`);
}

// Grava o CSV na nuvem E apaga o que não está mais nele. Antes só fazia upsert, então
// empenhos já liquidados/estornados ficavam na nuvem e reapareciam a cada abertura.
async function sincronizarAuditoriaNuvem(lista) {
    const T = 'auditoria_empenhos_parados';
    const up = await supabase.from(T).upsert(auditoriaParaSupabase(lista), { onConflict: 'emp' });
    if (up.error) return { erro: up.error, obsoletos: 0 };

    const ex = await supabase.from(T).select('emp');
    if (ex.error) return { erro: ex.error, obsoletos: 0 };

    const manter = new Set(lista.map(a => a.emp));
    const velhos = ex.data.map(x => x.emp).filter(e => !manter.has(e));
    for (let i = 0; i < velhos.length; i += 50) {
        const del = await supabase.from(T).delete().in('emp', velhos.slice(i, i + 50));
        if (del.error) return { erro: del.error, obsoletos: i };
    }
    return { erro: null, obsoletos: velhos.length };
}

// Formato das linhas da tabela auditoria_empenhos_parados no Supabase
function auditoriaParaSupabase(lista) {
    return lista.map(a => ({
        emp: a.emp, especie: a.especie, ref: a.ref ? a.ref : null, credor: a.credor,
        emissao: a.emissao, ult_liq: a.ultLiq, empenhado_total: a.empenhadoTotal,
        saldo: a.saldo, dias: a.dias, acao: a.acao
    }));
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
                msgSupa = error
                    ? `⚠️ Supabase recusou (${esc(error.message)}) — salvo só no navegador`
                    : 'Salvo no Banco de Dados Nuvem (Supabase) e no Navegador';
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
        let ignoradosSemSaldo = 0;
        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].split(';').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length >= 9 && cols[0] && !cols[0].startsWith('Total')) {
                const empTot = brToFloat(cols[6]);
                const liqTot = brToFloat(cols[7]);
                const saldoLiq = brToFloat(cols[8]);
                // Empenho sem saldo a liquidar não prende dinheiro: nem entra na Auditoria
                if (saldoLiq <= SALDO_ZERO) { ignoradosSemSaldo++; continue; }
                const partesDot = cols[2].split('.');
                const acaoNum = partesDot[5] ? partesDot[5] : '';
                const modCod = partesDot[6] ? partesDot[6] : '';
                const vincCod = cols[3];
                const dotMatch = dotacoesDB.find(d => d.acao.startsWith(acaoNum) && d.modalidade.startsWith(modCod) && d.vinculo_cod === vincCod);
                // Sem correspondência = null (antes usava o nº da ação como "Ref", o que quebrava a chave estrangeira no Supabase)
                const refNum = dotMatch ? dotMatch.ref : null;
                const refTxt = refNum == null ? 'sem Ref.' : `Ref. ${refNum}`;

                novos.push({
                    emp: cols[0],
                    especie: cols[1],
                    ref: refNum,
                    credor: cols[5],
                    emissao: cols[4],
                    ultLiq: liqTot === 0 ? 'Nunca liq.' : 'Parcial',
                    empenhadoTotal: empTot,
                    saldo: saldoLiq,
                    dias: diasDesde(cols[4]), // dias desde a emissão (o CSV não traz a data da última liquidação)
                    acao: liqTot === 0
                        ? `🚨 Nunca teve liquidação (R$ 0,00 liquidado de ${formatarBRL(empTot)}). Cobrar entrega/NF ou estornar para liberar ${formatarBRL(saldoLiq)} (${refTxt})!`
                        : `⏳ Liquidado parcialmente (${formatarBRL(liqTot)}). Restam ${formatarBRL(saldoLiq)} presos (${refTxt}).`
                });
            }
        }
        const logEl = document.getElementById('logImportacao');
        if (novos.length === 0) {
            logEl.innerHTML += `<div class="text-amber-300">[AVISO] Empenhos Liquidar.csv: nenhum empenho com saldo a liquidar encontrado (${ignoradosSemSaldo} sem saldo ignorados). Arquivo não aplicado — confira se é o relatório certo.</div>`;
            return;
        }
        {
            const agora = new Date().toLocaleString('pt-BR');
            auditoriaParadosDB = novos.sort((a, b) => b.saldo - a.saldo);
            localStorage.setItem(STORAGE_KEYS.AUDITORIA, JSON.stringify(auditoriaParadosDB));
            localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);

            let msgSupa = 'Salvo no navegador (LocalStorage)';
            if (supabaseAtivo) {
                const r = await sincronizarAuditoriaNuvem(auditoriaParadosDB);
                msgSupa = r.erro
                    ? `⚠️ Supabase recusou (${esc(r.erro.message)}) — salvo só no navegador`
                    : `Salvo no Supabase e no Navegador${r.obsoletos ? ` (${r.obsoletos} empenhos antigos apagados da nuvem)` : ''}`;
            }

            popularFiltrosGlobais();
            renderizarTudo();
            document.getElementById('badgeStatusTopo').textContent = `💾 Atualizado em ${agora}`;
            logEl.innerHTML += `<div>[OK - ${agora}] Empenhos Liquidar.csv (${novos.length} com saldo, ${ignoradosSemSaldo} sem saldo ignorados) -> ${msgSupa}!</div>`;
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
                            <th class="py-2.5 px-3 text-right">Situação / Valor</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700/50">
                        ${propostasFNSReais.map(p => `
                            <tr class="hover:bg-slate-700/30 transition">
                                <td class="py-3 px-3 font-bold text-slate-300 whitespace-nowrap">${p.ano}<div class="text-[10px] text-slate-400 font-mono">${p.numero}</div></td>
                                <td class="py-3 px-3 font-bold text-slate-300 whitespace-nowrap">${p.emenda}<div class="text-[10px] text-slate-400">${p.natureza}</div></td>
                                <td class="py-3 px-3 text-slate-200">
                                    <div class="font-bold">${p.objeto}</div>
                                    <div class="text-[11px] text-emerald-300 mt-0.5"><strong>✅ Pode:</strong> ${p.pode}</div>
                                    <div class="text-[11px] text-rose-300 mt-0.5"><strong>🚫 Vedado:</strong> ${p.naoPode}</div>
                                </td>
                                <td class="py-3 px-3 text-right whitespace-nowrap">
                                    <span class="inline-block px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px] font-bold uppercase">⏳ Em processo de liberação</span>
                                    <div class="text-xs font-bold text-slate-400 line-through mt-1">${formatarBRL(p.valor)}</div>
                                </td>
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
// 12. MODAL DE EDICAO DE REGRAS PELA CONTADORA (LOCALSTORAGE + SUPABASE)
// =========================================================================
function abrirModalEdicao(refNum) {
    const d = dotacoesDB.find(x => x.ref === refNum);
    if (!d) return;

    const titModal = d.tituloEmendaCustom ? d.tituloEmendaCustom : d.vinculo_desc;
    document.getElementById('modalRefHidden').value = refNum;
    document.getElementById('modalEdicaoTitulo').textContent = `Ref. ${refNum} — Editar Itens Permitidos (${titModal})`;
    document.getElementById('modalInputPode').value = d.regraCustomPode ? d.regraCustomPode : '';
    document.getElementById('modalInputNaoPode').value = d.regraCustomNaoPode ? d.regraCustomNaoPode : '';
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
        // supabase-js não lança exceção em erro: ele devolve { error }. Antes isso era ignorado
        // (e as colunas regra_custom_* nem existiam no schema.sql, então nada era salvo na nuvem).
        const { error } = await supabase
            .from('dotacoes_orcamentarias')
            .update({ regra_custom_pode: txtPode, regra_custom_nao_pode: txtNaoPode })
            .eq('ref', refNum);
        if (error) {
            console.warn('Regra customizada NÃO foi salva na nuvem:', error);
            alert('A regra foi salva só neste navegador. A nuvem recusou: ' + error.message + '\n\nRode o arquivo schema.sql (migração) no Supabase.');
        }
    }

    construirBaseDotacoes(dotacoesDB);
    renderizarTudo();
    fecharModalEdicao();
}

// =========================================================================
// 13. EXPORTACAO PDF / CSV E INICIALIZACAO GLOBAL
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
    if (!tabela) { alert('Para exportar os cards e gráficos desta aba, utilize o botão Relatório PDF.'); return; }
    // ignora colunas de botões (.no-print: WhatsApp, Remover) e escapa aspas do CSV
    const csv = Array.from(tabela.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th:not(.no-print), td:not(.no-print)'))
            .map(td => `"${td.innerText.replace(/\n/g, ' ').replace(/"/g, '""').trim()}"`).join(';')
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `FMS_Imbituba_${abaAtiva.id}.csv`;
    a.click();
}

function renderizarTudo() {
    const filtradas = obterDotacoesFiltroGlobal();
    atualizarKPIsTopo(filtradas);
    try { renderizarGraficoEmendasBI(); } catch (e) { console.error('Erro Grafico Emendas:', e); }
    try { renderizarGraficoCategoriasBI(); } catch (e) { console.error('Erro Grafico Categorias:', e); }
    try { renderizarGraficos(filtradas); } catch (e) { console.error('Erro Graficos Fontes/Blocos:', e); }
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
    alternarVisaoGraficoEmendas,
    renderizarGraficoEmendasBI,
    alternarExpansaoCategoriasBI,
    renderizarGraficoCategoriasBI,
    selecionarChipPermissao,
    limparBuscaPermissao,
    filtrarAbaDotacoes,
    renderizarEmendas,
    filtrarContratos,
    renderizarFixos,
    sincronizarInputAuditoria,
    // versões com debounce para os campos de busca (evita re-renderizar a cada tecla)
    filtrarAbaDotacoesDeb: debounce(filtrarAbaDotacoes),
    renderizarEmendasDeb: debounce(renderizarEmendas),
    renderizarFixosDeb: debounce(renderizarFixos),
    sincronizarInputAuditoriaDeb: debounce(sincronizarInputAuditoria),
    atualizarBotaoLimpeza,
    limparEmpenhosSemSaldo,
    removerEmpenhoUnico,
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

    // Botões "✕ Remover" da Aba 5 (um único listener, em vez de onclick em cada linha)
    const tbodyAud = document.getElementById('tabelaAuditoriaBody');
    if (tbodyAud) tbodyAud.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-remover-emp]');
        if (b) removerEmpenhoUnico(b.dataset.removerEmp);
    });
});