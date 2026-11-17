// =========================================================================
// CONFIGURAÇÃO DO SUPABASE E UTILITÁRIOS GLOBAIS
// Conectado ao projeto oficial: vrfgixtqlllbyevxaijn (FMS Imbituba)
// =========================================================================

export const SUPABASE_URL = 'https://vrfgixtqlllbyevxaijn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_M4TMykwu4n1ggug0kuSeOg_DZPtg3wv';

export const supabaseAtivo = (
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('SUA_PROJECT_ID') &&
    window.supabase
);

export const supabase = supabaseAtivo
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export const formatarBRL = (v) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const normalizarTexto = (str) =>
    (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Escapa texto antes de entrar em innerHTML (evita XSS vindo de CSV/Supabase/regras editadas)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Dias corridos desde uma data dd/mm/aaaa (0 se a data for inválida)
export function diasDesde(dataBR) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(dataBR || ''));
    if (!m) return 0;
    const ms = Date.now() - new Date(+m[3], +m[2] - 1, +m[1]).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
}

export const debounce = (fn, ms = 180) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

export function brToFloat(val) {
    if (!val) return 0;
    const s = String(val).trim();
    const neg = s.startsWith('(') && s.endsWith(')');
    const limpo = s.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.').trim();
    const num = parseFloat(limpo) || 0;
    return neg ? -num : num;
}
