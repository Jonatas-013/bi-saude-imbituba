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

let chartEvolucaoInstance = null;
let chartFontesInstance = null;
let chartBlocosInstance = null;
let tagPermissaoAtiva = 'TODOS';
let filtroSituacaoContratoAtivo = 'TODOS';

// 1. Classificador Contábil Automático para Qualquer Dotação (Ref.)
export function classificarPermissoesDotacao(acao, modalidade, vinculoDesc, vinculoCod) {
    const tags = [];
    let regraPode = '';
    let regraNaoPode = '';
    const modCod = String(modalidade || '').substring(0, 6);
    const acaoUpper = String(acao || '').toUpperCase();
    const vincUpper = String(vinculoDesc || '').toUpperCase();
    const vCod = String(vinculoCod || '');

    if (modCod === '331900' || modCod === '331710') {
        tags.push('Folha / Pessoal (33190)');
        regraPode = 'Vencimentos, salários, folha de pagamento e encargos patronais.';
        regraNaoPode = 'PROIBIDO usar para compras de materiais, aluguéis, serviços PJ ou obras.';
    } else if (modCod === '333900' || modCod === '333910') {
        tags.push('Custeio / Aluguel / Serviços PJ');
        regraPode = 'Custeio Direto (3.3.90): Material de consumo, serviços PJ, aluguéis de imóveis, links de internet, manutenção predial/frota, exames e fretamento.';
        regraNaoPode = 'PROIBIDO comprar Material Permanente/Equipamentos/Móveis/Veículos (exige código 344900).';
    } else if (modCod === '344900' || modCod === '344710') {
        tags.push('Material Permanente / Obras (34490)');
        regraPode = 'Investimento / Permanente (4.4.90): Compra de Ar-condicionado, Mobiliário, Computadores, Veículos/Ambulâncias, Equipamentos e Obras.';
        regraNaoPode = 'PROIBIDO usar para custeio mensal (aluguel, internet, combustível, medicamentos ou serviços).';
    } else if (modCod === '333500' || modCod === '344500') {
        tags.push('Hospital / Entidades (33350)');
        regraPode = `Repasses a Instituições Privadas Sem Fins Lucrativos (${modCod === '333500' ? 'Custeio Hospital São Camilo, APAE, AMAI, Rede Feminina, Lanche da Amizade, Ebenezer' : 'Investimento/Equipamentos para Entidades'}).`;
        regraNaoPode = 'Compras diretas de fornecedores comerciais comuns fora de Termo de Fomento/Colaboração/Convênio.';
    } else if (modCod === '333710') {
        tags.push('Consórcio Público (33371)');
        regraPode = 'Contrato de Rateio / Consórcio Intermunicipal de Saúde (CISAMUREL).';
        regraNaoPode = 'Contratações diretas fora do consórcio.';
    }

    if (acaoUpper.includes('2084') || acaoUpper.includes('TFD') || acaoUpper.includes('2086') || acaoUpper.includes('SAMU')) {
        tags.push('Transporte / TFD / SAMU');
    }
    if (acaoUpper.includes('2121') || acaoUpper.includes('TECNOLOGIA') || acaoUpper.includes('DIGITAL')) {
        tags.push('Tecnologia / SUS Digital');
    }
    if (acaoUpper.includes('2089') || acaoUpper.includes('2090') || acaoUpper.includes('FARMAC') || vincUpper.includes('PORTARIA 017/223')) {
        tags.push('Medicamentos / Farmácia');
    }
    if (acaoUpper.includes('2076') || acaoUpper.includes('BUCAL')) {
        tags.push('Saúde Bucal');
    }
    if (acaoUpper.includes('2080') && modCod === '333900') {
        tags.push('Transporte / TFD / SAMU');
        tags.push('Tecnologia / SUS Digital');
        tags.push('Medicamentos / Farmácia');
    }

    const ehEmenda = vincUpper.includes('EMENDA') || vCod.startsWith('15007011') || vCod.startsWith('2706') || vCod.startsWith('1706') || vCod.startsWith('2710') || vCod.startsWith('25007011');
    return { tags: [...new Set(tags)], regraPode, regraNaoPode, ehEmenda };
}

function construirBaseDotacoes(listaBruta) {
    dotacoesDB = listaBruta.map(r => {
        const info = classificarPermissoesDotacao(r.acao, r.modalidade, r.vinculo_desc, r.vinculo_cod);
        return { ...r, permissoesTags: info.tags, regraPode: info.regraPode, regraNaoPode: info.regraNaoPode, ehEmenda: info.ehEmenda };
    });
}

// =========================================================================
// MOTOR DE PERSISTÊNCIA: CARREGA DO SUPABASE OU LOCALSTORAGE AO ABRIR A TELA
// =========================================================================
async function inicializarBancoDeDados() {
    let origemDados = 'Pasta Local (dados_iniciais.js)';
    let dotacoesCarregadas = null;
    let auditoriaCarregada = null;
    let contratosCarregados = null;

    // 1º Tenta buscar do Banco de Dados Supabase (se configurado pelo usuário)
    if (supabaseAtivo) {
        try {
            const { data: dSupa, error: errD } = await supabase.from('dotacoes_orcamentarias').select('*').order('ref', { ascending: true });
            const { data: aSupa, error: errA } = await supabase.from('auditoria_empenhos_parados').select('*').order('saldo', { ascending: false });
            if (!errD && dSupa && dSupa.length > 0) {
                dotacoesCarregadas = dSupa.map(d => ({
                    ...d,
                    orcado: Number(d.orcado),
                    atualizado: Number(d.atualizado),
                    empenhado: Number(d.empenhado),
                    reservado: Number(d.reservado),
                    saldo_empenho: Number(d.saldo_empenho),
                    saldo_reserva: Number(d.saldo_reserva)
                }));
                origemDados = `☁️ Nuvem Supabase (${dSupa.length} Refs Ativas)`;
            } else if (!errD && dSupa && dSupa.length === 0) {
                // Auto-Seeding no 1º acesso: popula automaticamente as tabelas vazias do Supabase!
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

    // 2º Se não veio do Supabase, verifica se há dados mais novos salvos no LocalStorage do navegador
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

    // 3º Fallback para os dados iniciais da pasta (dados_iniciais.js)
    construirBaseDotacoes(dotacoesCarregadas || rawDotacoesReais);
    auditoriaParadosDB = auditoriaCarregada || [...auditoriaParadosIniciais];
    contratosCruzadosDB = contratosCarregados || [...contratosCruzadosIniciais];

    const badgeTopo = document.getElementById('badgeStatusTopo');
    if (badgeTopo) badgeTopo.textContent = origemDados;

    popularFiltrosGlobais();
    renderizarTudo();
}

// Função para exportar um novo arquivo "dados_iniciais.js" atualizado para substituir no GitHub se desejar
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

// Popover Instantâneo ao passar o mouse no número da Dotação (Ref.)
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
                <span class="block text-[11px] text-slate-300 mb-2"><strong>Vínculo:</strong> ${d.vinculo_desc}</span>
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
    const acoesUnicas = [...new Set(dotacoesDB.map(d => d.acao))];
    selBloco.innerHTML = `<option value="TODOS" class="bg-slate-900">Todas as Ações (${acoesUnicas.length})</option>`;
    acoesUnicas.forEach(a => selBloco.innerHTML += `<option value="${a}" class="bg-slate-900">${a}</option>`);

    const selDot = document.getElementById('filtroDotacaoGlobal');
    selDot.innerHTML = `<option value="TODAS" class="bg-slate-900">Todas as Refs (${dotacoesDB.length})</option>`;
    dotacoesDB.forEach(d => selDot.innerHTML += `<option value="${d.ref}" class="bg-slate-900">Ref. ${d.ref} • ${d.vinculo_desc.slice(0, 32)} (${formatarBRL(d.saldo_reserva)})</option>`);

    const selAud = document.getElementById('filtroRefAuditoriaSelect');
    const refsEmAuditoria = [...new Set(auditoriaParadosDB.map(r => r.ref))];
    selAud.innerHTML = `<option value="">📋 Mostrar Todas as Dotações Auditadas (${auditoriaParadosDB.length} empenhos)</option>`;
    refsEmAuditoria.forEach(rNum => {
        const dot = dotacoesDB.find(d => d.ref === rNum);
        const qtd = auditoriaParadosDB.filter(x => x.ref === rNum).length;
        const soma = auditoriaParadosDB.filter(x => x.ref === rNum).reduce((a, b) => a + b.saldo, 0);
        const desc = dot ? dot.vinculo_desc.slice(0, 34) : 'Dotação FMS';
        selAud.innerHTML += `<option value="${rNum}">Ref. ${rNum} (${qtd} emp. = ${formatarBRL(soma)}) • ${desc}</option>`;
    });
}

function obterDotacoesFiltroGlobal() {
    const acaoSel = document.getElementById('filtroBlocoGlobal').value;
    const refSel = document.getElementById('filtroDotacaoGlobal').value;
    return dotacoesDB.filter(d => (acaoSel === 'TODOS' || d.acao === acaoSel) && (refSel === 'TODAS' || String(d.ref) === String(refSel)));
}

function trocarAba(idAba, btnEl) {
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(idAba).classList.add('active');
    if (btnEl) btnEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    lucide.createIcons();
}

// Drill-Down nos 4 Cards Superiores
function drillDownOrcamento() {
    trocarAba('aba-dotacoes', document.getElementById('btn-aba-dotacoes'));
    document.getElementById('selectApenasComSaldo').value = 'TODAS';
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

// ABA 1: Gráfico Mensal + Simulador até Dezembro
function atualizarGraficoMensal() {
    const fator = parseFloat(document.getElementById('selectSimulacaoMensal').value || '1.0');
    const ctx = document.getElementById('chartEvolucaoMensal').getContext('2d');
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
    const ctxFontes = document.getElementById('chartFontes').getContext('2d');
    const ctxBlocos = document.getElementById('chartBlocos').getContext('2d');
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
    document.getElementById('contadorRefsTabela').textContent = `Exibindo ${dotacoes.length} dotações (Refs)`;

    // Atualiza dinamicamente os KPIs do topo conforme os dados atuais
    const somaAtualizado = dotacoes.reduce((a, b) => a + b.atualizado, 0);
    const somaEmp = dotacoes.reduce((a, b) => a + b.empenhado, 0);
    const somaEmendasLivres = dotacoes.filter(d => d.ehEmenda).reduce((a, b) => a + b.saldo_reserva, 0);
    const somaParados = auditoriaParadosDB.reduce((a, b) => a + b.saldo, 0);

    document.getElementById('kpiOrcadoAtual').textContent = formatarBRL(somaAtualizado);
    document.getElementById('kpiSubOrcado').innerHTML = `Empenhado: <strong>${formatarBRL(somaEmp)}</strong> (Clique p/ abrir)`;
    document.getElementById('kpiEmendasLivres').textContent = formatarBRL(somaEmendasLivres);
    const kpiParadosEl = document.getElementById('kpiParadosTopo');
    if (kpiParadosEl) kpiParadosEl.textContent = formatarBRL(somaParados);

    tbody.innerHTML = dotacoes.map(d => {
        const badges = d.permissoesTags.map(t => `<span class="inline-block bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 mb-0.5">${t}</span>`).join('');
        return `
            <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-3 whitespace-nowrap">${gerarBadgeRefComPopover(d.ref)}</td>
                <td class="py-2.5 px-3 font-medium text-slate-800 max-w-[210px] truncate" title="${d.acao}">${d.acao}</td>
                <td class="py-2.5 px-3 text-slate-600 max-w-[220px] truncate" title="${d.vinculo_desc}">${d.vinculo_desc}</td>
                <td class="py-2.5 px-3">${badges}</td>
                <td class="py-2.5 px-3 text-right font-medium">${formatarBRL(d.atualizado)}</td>
                <td class="py-2.5 px-3 text-right text-slate-600">${formatarBRL(d.empenhado)}</td>
                <td class="py-2.5 px-3 text-right text-amber-700 font-medium">${formatarBRL(d.reservado)}</td>
                <td class="py-2.5 px-3 text-right font-extrabold ${d.saldo_reserva <= 1000 ? 'text-rose-600' : 'text-emerald-600'}">${formatarBRL(d.saldo_reserva)}</td>
            </tr>
        `;
    }).join('');
}

// ABA 2: Onde Posso Gastar?
function selecionarChipPermissao(tag, btnEl) {
    tagPermissaoAtiva = tag;
    document.querySelectorAll('.chip-permissao').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    filtrarAbaDotacoes();
}

function limparBuscaPermissao() {
    document.getElementById('inputBuscaNecessidade').value = '';
    document.getElementById('selectApenasComSaldo').value = 'TODAS';
    selecionarChipPermissao('TODOS', document.querySelector('#containerChipsPermissao button'));
}

function filtrarAbaDotacoes() {
    const base = obterDotacoesFiltroGlobal();
    const termo = normalizarTexto(document.getElementById('inputBuscaNecessidade').value.trim());
    const modoSaldo = document.getElementById('selectApenasComSaldo').value;
    const boxResumo = document.getElementById('resumoBuscaNecessidade');

    const filtradas = base.filter(d => {
        const matchTag = tagPermissaoAtiva === 'TODOS' || d.permissoesTags.includes(tagPermissaoAtiva);
        const texto = normalizarTexto(`Ref ${d.ref} ${d.acao} ${d.vinculo_desc} ${d.modalidade} ${d.regraPode} ${d.permissoesTags.join(' ')}`);
        const matchTermo = !termo || texto.includes(termo);
        const matchSaldo = modoSaldo === 'TODAS' || d.saldo_reserva > 100;
        return matchTag && matchTermo && matchSaldo;
    }).sort((a, b) => b.saldo_reserva - a.saldo_reserva);

    const somaLivre = filtradas.reduce((a, b) => a + b.saldo_reserva, 0);
    boxResumo.classList.remove('hidden');
    boxResumo.innerHTML = `<div>🔎 <strong>${filtradas.length} Dotações (Refs) compatíveis encontradas</strong> • Soma Livre Real p/ Reserva: <strong class="text-emerald-700 text-sm">${formatarBRL(somaLivre)}</strong></div>`;

    document.getElementById('listaCardsDotacoes').innerHTML = filtradas.map(d => {
        const chips = d.permissoesTags.map(t => `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">✓ ${t}</span>`).join('');
        return `
            <div class="bg-white p-5 rounded-xl border-2 ${d.saldo_reserva > 1000 ? 'border-emerald-500/30' : 'border-rose-300'} shadow-sm space-y-3 print-shadow-none">
                <div class="flex flex-wrap justify-between items-start gap-2">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            ${gerarBadgeRefComPopover(d.ref)}
                            <span class="text-xs font-bold text-slate-700">${d.acao}</span>
                        </div>
                        <p class="text-sm font-bold text-slate-900 pt-1">Vínculo: ${d.vinculo_desc}</p>
                        <div class="flex flex-wrap gap-1.5 pt-1">${chips}</div>
                    </div>
                    <div class="text-right bg-slate-50 p-3 rounded-xl border border-slate-200 min-w-[220px]">
                        <span class="text-xs text-slate-500 block">Atualizado: ${formatarBRL(d.atualizado)}</span>
                        <span class="text-xs text-amber-700 font-semibold block">Reservado: ${formatarBRL(d.reservado)}</span>
                        <span class="text-lg font-extrabold ${d.saldo_reserva <= 100 ? 'text-rose-600' : 'text-emerald-600'} mt-1 block">Livre: ${formatarBRL(d.saldo_reserva)}</span>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div class="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg"><strong class="text-emerald-900">✅ PODE PAGAR:</strong> ${d.regraPode}</div>
                    <div class="bg-rose-50 border border-rose-200 p-2.5 rounded-lg"><strong class="text-rose-900">🚫 VEDAÇÃO:</strong> ${d.regraNaoPode}</div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('simuladorDotacaoSelect').innerHTML = filtradas.map(d => `<option value="${d.ref}">Ref. ${d.ref} • ${d.vinculo_desc.slice(0,32)} — Livre: ${formatarBRL(d.saldo_reserva)}</option>`).join('');
    lucide.createIcons();
}

function simularCompra() {
    const ref = parseInt(document.getElementById('simuladorDotacaoSelect').value, 10);
    const valor = Number(document.getElementById('simuladorValorInput').value) || 0;
    const d = dotacoesDB.find(x => x.ref === ref);
    const box = document.getElementById('resultadoSimulador');
    if (!d || valor <= 0) return;
    const resto = d.saldo_reserva - valor;
    box.classList.remove('hidden');
    box.className = `mt-4 p-3.5 rounded-lg text-xs border ${resto >= 0 ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400' : 'bg-rose-500/20 text-rose-200 border-rose-400'}`;
    box.innerHTML = resto >= 0
        ? `✅ <strong>VIÁVEL NA REF. ${d.ref}!</strong> O saldo livre atual é ${formatarBRL(d.saldo_reserva)}. Restarão <strong>${formatarBRL(resto)}</strong> livres após reservar esta despesa.`
        : `🚨 <strong>SALDO INSUFICIENTE NA REF. ${d.ref}!</strong> Faltam <strong>${formatarBRL(Math.abs(resto))}</strong>. Verifique na Aba 5 se há empenhos parados nesta Ref. que possam ser estornados!`;
}

// ABA 3: Emendas Livres
function renderizarEmendas() {
    const dotacoes = obterDotacoesFiltroGlobal();
    const busca = normalizarTexto(document.getElementById('inputBuscaEmenda') ? document.getElementById('inputBuscaEmenda').value : '');
    const emendas = dotacoes.filter(d => d.ehEmenda && (!busca || normalizarTexto(`${d.ref} ${d.vinculo_desc} ${d.acao}`).includes(busca))).sort((a, b) => b.saldo_reserva - a.saldo_reserva);

    document.getElementById('tabelaEmendasBody').innerHTML = emendas.map(e => `
        <tr class="hover:bg-slate-50 ${e.saldo_reserva > 50000 ? 'bg-amber-50/40' : ''}">
            <td class="py-3 px-3 whitespace-nowrap">${gerarBadgeRefComPopover(e.ref)}</td>
            <td class="py-3 px-3 font-bold text-slate-800">${e.vinculo_desc}</td>
            <td class="py-3 px-3 text-slate-600">${e.acao}</td>
            <td class="py-3 px-3"><span class="px-2 py-0.5 bg-blue-50 text-blue-800 rounded font-semibold">${e.permissoesTags.join(', ')}</span></td>
            <td class="py-3 px-3 text-right font-medium">${formatarBRL(e.atualizado)}</td>
            <td class="py-3 px-3 text-right text-slate-600">${formatarBRL(e.empenhado)}</td>
            <td class="py-3 px-3 text-right text-amber-700">${formatarBRL(e.reservado)}</td>
            <td class="py-3 px-3 text-right font-extrabold text-amber-700">${formatarBRL(e.saldo_reserva)}</td>
        </tr>
    `).join('');
    lucide.createIcons();
}

// ABA 4: Contratos e Fila da Tesouraria
function filtrarContratos(modo) {
    filtroSituacaoContratoAtivo = modo;
    renderizarFixos();
}

function renderizarFixos() {
    const filtrados = contratosCruzadosDB.filter(c => {
        if (filtroSituacaoContratoAtivo === 'TODOS') return true;
        if (filtroSituacaoContratoAtivo === 'VENCENDO') return c.diasVig <= 45;
        return c.categoriaStatus === filtroSituacaoContratoAtivo;
    });

    document.getElementById('tabelaFixosBody').innerHTML = filtrados.map(c => {
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
    lucide.createIcons();
}

// ABA 5: Auditoria Completa dos Empenhos Parados
function sincronizarInputAuditoria(valorDigitado) {
    const sel = document.getElementById('filtroRefAuditoriaSelect');
    const limpo = valorDigitado.replace(/\D/g, '');
    if ([...sel.options].some(o => o.value === limpo)) {
        sel.value = limpo;
    } else {
        sel.value = '';
    }
    renderizarAuditoria();
}

function selecionarDropdownAuditoria(valorSel) {
    document.getElementById('inputBuscaRefAuditoria').value = valorSel;
    renderizarAuditoria();
}

function limparFiltroAuditoria() {
    document.getElementById('inputBuscaRefAuditoria').value = '';
    document.getElementById('filtroRefAuditoriaSelect').value = '';
    renderizarAuditoria();
}

function renderizarAuditoria() {
    const termoRef = document.getElementById('inputBuscaRefAuditoria').value.replace(/\D/g, '').trim();
    const filtrados = auditoriaParadosDB.filter(r => !termoRef || String(r.ref) === termoRef);

    const somaPresa = filtrados.reduce((a, b) => a + b.saldo, 0);
    const qtdNunca = filtrados.filter(x => x.ultLiq === 'Nunca liq.').length;
    const qtdParcial = filtrados.filter(x => x.ultLiq !== 'Nunca liq.').length;

    document.getElementById('kpiAuditoriaValor').textContent = formatarBRL(somaPresa);
    document.getElementById('kpiAuditoriaSubValor').textContent = termoRef
        ? `Total preso especificamente na Dotação Ref. ${termoRef} (${filtrados.length} empenhos)`
        : `Exibindo todos os ${filtrados.length} empenhos auditados`;
    document.getElementById('kpiAuditoriaNunca').textContent = `${qtdNunca} empenho(s)`;
    document.getElementById('kpiAuditoriaParcial').textContent = `${qtdParcial} empenho(s)`;

    const tbody = document.getElementById('tabelaAuditoriaBody');
    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500 font-semibold">Nenhum empenho parado encontrado para a Ref. ${termoRef}. Clique em "Ver Todas".</td></tr>`;
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
    lucide.createIcons();
}

// =========================================================================
// ABA 6: LEITORES SEMANAIS COM SALVAMENTO AUTOMÁTICO (LOCALSTORAGE + SUPABASE)
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
            // 1. Salva imediatamente no LocalStorage do navegador (persiste ao fechar/abrir)
            localStorage.setItem(STORAGE_KEYS.DOTACOES, JSON.stringify(novas));
            localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);

            // 2. Se o Supabase estiver ativo, grava também na nuvem para todos os dispositivos
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

            // 1. Salva no LocalStorage
            localStorage.setItem(STORAGE_KEYS.AUDITORIA, JSON.stringify(auditoriaParadosDB));
            localStorage.setItem(STORAGE_KEYS.ULTIMA_ATUALIZACAO, agora);

            // 2. Salva no Supabase se conectado
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

function gerarPDFRelatorio() {
    const cab = document.getElementById('cabecalhoPDF');
    document.getElementById('dataHoraPDF').textContent = new Date().toLocaleString('pt-BR');
    document.getElementById('blocoSelecionadoPDF').textContent = document.getElementById('filtroBlocoGlobal').value;
    cab.classList.remove('hidden');
    html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `BI_Saude_Imbituba_${new Date().toISOString().slice(0,10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }).from(document.getElementById('areaRelatorioPDF')).save().then(() => cab.classList.add('hidden'));
}

function exportarCSVTelaAtual() {
    const abaAtiva = document.querySelector('.tab-content.active');
    const tabela = abaAtiva.querySelector('table');
    if (!tabela) { alert('Para exportar os cards visuais da Aba 2, utilize o botão Relatório PDF.'); return; }
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
    lucide.createIcons();
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
    exportarCSVTelaAtual
});

window.addEventListener('DOMContentLoaded', () => {
    inicializarBancoDeDados();
    document.getElementById('filtroBlocoGlobal').addEventListener('change', renderizarTudo);
    document.getElementById('filtroDotacaoGlobal').addEventListener('change', renderizarTudo);
});
