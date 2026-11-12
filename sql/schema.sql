-- =========================================================================
-- SCHEMA SUPABASE: BI FUNDO MUNICIPAL DE SAÚDE DE IMBITUBA (ÓRGÃO 25)
-- Rode este script no SQL Editor do Supabase (https://supabase.com/dashboard)
-- =========================================================================

-- 1. Tabela de Dotações Orçamentárias (209 Refs do Saldo Dotacao.csv)
CREATE TABLE IF NOT EXISTS dotacoes_orcamentarias (
    ref INTEGER PRIMARY KEY,
    acao TEXT NOT NULL,
    acao_num VARCHAR(20),
    modalidade TEXT NOT NULL,
    mod_cod VARCHAR(30),
    vinculo_cod VARCHAR(30) NOT NULL,
    vinculo_desc TEXT NOT NULL,
    orcado NUMERIC(14,2) DEFAULT 0,
    atualizado NUMERIC(14,2) DEFAULT 0,
    empenhado NUMERIC(14,2) DEFAULT 0,
    reservado NUMERIC(14,2) DEFAULT 0,
    saldo_empenho NUMERIC(14,2) DEFAULT 0,
    saldo_reserva NUMERIC(14,2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabela de Contratos Ativos e Fila da Tesouraria (Relatorio 3.json + Fiscais)
CREATE TABLE IF NOT EXISTS contratos_monitorados (
    id SERIAL PRIMARY KEY,
    num VARCHAR(60) NOT NULL,
    especie VARCHAR(60),
    fornecedor VARCHAR(180) NOT NULL,
    objeto TEXT,
    vig_fim VARCHAR(20),
    dias_vig INTEGER DEFAULT 0,
    refs INTEGER[] DEFAULT '{}',
    emp_aberto VARCHAR(80),
    saldo_liquidar NUMERIC(14,2) DEFAULT 0,
    ult_liq VARCHAR(20),
    ult_pag VARCHAR(20),
    categoria_status VARCHAR(40) DEFAULT 'COBRAR_FISCAL',
    diagnostico TEXT,
    fiscal_nome VARCHAR(100) DEFAULT 'Fiscal do Contrato',
    whats VARCHAR(25) DEFAULT '48999999999',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabela de Auditoria de Empenhos Parados (Empenhos Liquidar.csv +60 dias)
CREATE TABLE IF NOT EXISTS auditoria_empenhos_parados (
    emp VARCHAR(40) PRIMARY KEY,
    especie VARCHAR(40),
    ref INTEGER REFERENCES dotacoes_orcamentarias(ref) ON DELETE SET NULL,
    credor VARCHAR(180) NOT NULL,
    emissao VARCHAR(20),
    ult_liq VARCHAR(20),
    empenhado_total NUMERIC(14,2) DEFAULT 0,
    saldo NUMERIC(14,2) DEFAULT 0,
    dias INTEGER DEFAULT 0,
    acao TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS com política de leitura/escrita para o painel V1
ALTER TABLE dotacoes_orcamentarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_monitorados ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_empenhos_parados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso publico dotacoes" ON dotacoes_orcamentarias FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico contratos" ON contratos_monitorados FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico auditoria" ON auditoria_empenhos_parados FOR ALL USING (true) WITH CHECK (true);
