// ═══════════════════════════════════════════════════════════════════════
// js/db.js — Camada de dados PAZ 5.0 com Supabase
// Substitui completamente o localStorage / window.storage
// ⚠️ Substitua SUPABASE_URL e SUPABASE_ANON_KEY pelos valores reais
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'SUPABASE_URL';
const SUPABASE_ANON = 'SUPABASE_ANON';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// ─── Sessão e perfil atual ─────────────────────────────────────────────
export let currentUser    = null;
export let currentProfile = null;

export async function inicializarSessao() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  currentUser = session.user;

  const { data: perfil, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error || !perfil) return null;

  currentProfile = perfil;
  return { user: currentUser, perfil };
}

// ─── Verificar autenticação e redirecionar se necessário ──────────────
export async function protegerPagina(rolesPermitidos = ['analista', 'supervisor', 'admin']) {
  const sessao = await inicializarSessao();

  if (!sessao) {
    window.location.replace('/login.html');
    return null;
  }

  if (sessao.perfil.status !== 'ativo') {
    await sb.auth.signOut();
    window.location.replace('/login.html?erro=conta_suspensa');
    return null;
  }

  if (!rolesPermitidos.includes(sessao.perfil.role)) {
    window.location.replace('/login.html?erro=sem_permissao');
    return null;
  }

  // Atualizar último login
  await sb.rpc('update_last_login', { uid: currentUser.id }).catch(() => {});

  return sessao;
}

// ─── Logout ───────────────────────────────────────────────────────────
export async function logout() {
  await registrarLog('LOGOUT', 'Usuário encerrou a sessão').catch(() => {});
  await sb.auth.signOut();
  window.location.replace('/login.html');
}

// ═══════════════════════════════════════════════════════════════════════
// MOTORISTAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Carrega motoristas do usuário logado (analista vê só os seus;
 * admin/supervisor vê todos via RLS).
 */
export async function carregarMotoristas(filtros = {}) {
  let query = sb
    .from('motoristas')
    .select(`
      *,
      orientacoes(id, tipo_registro, nota, data_contato, motivo)
    `)
    .order('indice_wf', { ascending: false });

  if (filtros.mes_ano) query = query.eq('mes_ano', filtros.mes_ano);
  if (filtros.cliente) query = query.ilike('cliente', `%${filtros.cliente}%`);
  if (filtros.status)  query = query.eq('status', filtros.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Importa array de motoristas (da planilha) para o banco.
 * Evita duplicatas pelo CPF ou nome + mes_ano.
 */
export async function importarMotoristas(linhas) {
  if (!currentUser) throw new Error('Não autenticado');
  if (!linhas.length) return 0;

  // Buscar motoristas existentes deste usuário para deduplicação
  const { data: existentes } = await sb
    .from('motoristas')
    .select('id, cpf, nome, mes_ano')
    .eq('user_id', currentUser.id);

  const inserir = [];
  const atualizar = [];

  for (const l of linhas) {
    const nomeLower = (l.nome || '').trim().toLowerCase();
    const cpfLimpo  = (l.cpf || '').replace(/\D/g, '');

    const existente = existentes?.find(e =>
      (cpfLimpo && e.cpf?.replace(/\D/g,'') === cpfLimpo) ||
      (e.nome?.toLowerCase() === nomeLower && e.mes_ano === l.mes_ano)
    );

    const registro = {
      user_id:    currentUser.id,
      mes_ano:    l.mes_ano    || '',
      cliente:    l.cliente    || '',
      nome:       l.nome.trim(),
      cpf:        l.cpf        || '',
      contato:    l.contato    || '',
      tipo:       l.tipo       || '',
      viagens:    parseFloat(l.viagens)  || 0,
      wf:         parseFloat(l.wf)       || 0,
      wf_mes:     parseFloat(l.wf_mes)   || 0,
      indice_wf:  parseFloat(l.indice)   || 0,
    };

    if (existente) {
      atualizar.push({ id: existente.id, ...registro });
    } else {
      inserir.push(registro);
    }
  }

  let count = 0;

  if (inserir.length) {
    // Inserir em lotes de 200
    for (let i = 0; i < inserir.length; i += 200) {
      const { error } = await sb.from('motoristas').insert(inserir.slice(i, i + 200));
      if (error) throw error;
      count += Math.min(200, inserir.length - i);
    }
  }

  if (atualizar.length) {
    for (const m of atualizar) {
      const { id, ...campos } = m;
      await sb.from('motoristas').update(campos).eq('id', id);
      count++;
    }
  }

  return count;
}

/**
 * Exclui um motorista e todas suas orientações/tentativas.
 */
export async function excluirMotorista(motoristaId) {
  const { error } = await sb.from('motoristas').delete().eq('id', motoristaId);
  if (error) throw error;
  await registrarLog('DELETE_MOTORISTA', `Motorista ${motoristaId} excluído`);
}

/**
 * Limpa TODOS os motoristas do usuário logado (equivale ao "limpar tudo").
 */
export async function limparTodosMotoristas() {
  const { error } = await sb
    .from('motoristas')
    .delete()
    .eq('user_id', currentUser.id);
  if (error) throw error;
  await registrarLog('CLEAR_ALL', 'Todos os motoristas e registros excluídos');
}

// ═══════════════════════════════════════════════════════════════════════
// ORIENTAÇÕES E TENTATIVAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Salva uma orientação ou tentativa de contato.
 * O user_id é setado automaticamente — não pode ser forjado via RLS.
 */
export async function salvarRegistro(motoristaId, dados) {
  if (!currentUser) throw new Error('Não autenticado');

  const tipo = dados.isTentativa ? 'tentativa' : 'orientacao';

  const registro = {
    user_id:        currentUser.id,
    motorista_id:   motoristaId || null,
    motorista_nome: dados.nome        || '',
    motorista_cpf:  dados.cpf         || '',
    cliente:        dados.cliente     || '',
    motivo:         dados.motivo      || '',
    nota:           dados.nota        || null,
    descricao:      dados.descricao   || '',
    data_contato:   dados.data        || new Date().toISOString().split('T')[0],
    hora_contato:   dados.hora        || null,
    lembrete_dt:    dados.lembDt      || null,
    lembrete_hr:    dados.lembHr      || null,
    tipo_registro:  tipo
  };

  const { data, error } = await sb.from('orientacoes').insert(registro).select().single();
  if (error) throw error;

  // Atualizar status do motorista
  if (motoristaId) {
    await sb.from('motoristas')
      .update({ status: tipo === 'orientacao' ? 'orientado' : 'tentativa' })
      .eq('id', motoristaId);
  }

  return data;
}

/**
 * Carrega orientações do usuário logado com filtros opcionais.
 */
export async function carregarOrientacoes(filtros = {}) {
  let query = sb
    .from('orientacoes')
    .select('*')
    .eq('tipo_registro', 'orientacao')
    .order('data_contato', { ascending: false });

  if (filtros.mes_inicio) query = query.gte('data_contato', filtros.mes_inicio);
  if (filtros.mes_fim)    query = query.lte('data_contato', filtros.mes_fim);
  if (filtros.nota)       query = query.eq('nota', filtros.nota);
  if (filtros.user_id)    query = query.eq('user_id', filtros.user_id); // admin only

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Carrega tentativas do usuário logado.
 */
export async function carregarTentativas(filtros = {}) {
  let query = sb
    .from('orientacoes')
    .select('*')
    .eq('tipo_registro', 'tentativa')
    .order('data_contato', { ascending: false });

  if (filtros.mes_inicio) query = query.gte('data_contato', filtros.mes_inicio);
  if (filtros.mes_fim)    query = query.lte('data_contato', filtros.mes_fim);
  if (filtros.motivo)     query = query.eq('motivo', filtros.motivo);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Carrega todos os registros (orientações + tentativas) de um motorista.
 */
export async function carregarRegistrosMotorista(motoristaId) {
  const { data, error } = await sb
    .from('orientacoes')
    .select('*')
    .eq('motorista_id', motoristaId)
    .order('data_contato', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Exclui uma orientação/tentativa pelo ID.
 */
export async function excluirRegistro(registroId) {
  const { error } = await sb.from('orientacoes').delete().eq('id', registroId);
  if (error) throw error;
}

/**
 * "Devolve" um motorista (remove a orientação e volta status para pendente).
 */
export async function retornarMotorista(registroId, motoristaId) {
  await excluirRegistro(registroId);

  if (motoristaId) {
    // Verificar se ainda tem outros registros
    const { data: restantes } = await sb
      .from('orientacoes')
      .select('id, tipo_registro')
      .eq('motorista_id', motoristaId);

    const novoStatus = restantes?.length
      ? (restantes.some(r => r.tipo_registro === 'tentativa') ? 'tentativa' : 'orientado')
      : 'pendente';

    await sb.from('motoristas').update({ status: novoStatus }).eq('id', motoristaId);
  }
}

/**
 * Atualiza campos editáveis de uma orientação.
 */
export async function atualizarRegistro(registroId, campos) {
  const { error } = await sb.from('orientacoes').update(campos).eq('id', registroId);
  if (error) throw error;
}

/**
 * Edita campos de um motorista (CPF, contato, tipo, etc.)
 */
export async function atualizarMotorista(motoristaId, campos) {
  const { error } = await sb.from('motoristas').update(campos).eq('id', motoristaId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD — métricas individuais (analista)
// ═══════════════════════════════════════════════════════════════════════

export async function carregarMetricasDashboard(filtros = {}) {
  const [resOri, resTent, resMots] = await Promise.all([
    sb.from('orientacoes').select('nota, data_contato, motivo').eq('tipo_registro', 'orientacao'),
    sb.from('orientacoes').select('motivo, data_contato').eq('tipo_registro', 'tentativa'),
    sb.from('motoristas').select('id, nome, indice_wf, cliente, status')
  ]);

  if (resOri.error) throw resOri.error;

  let oris  = resOri.data  || [];
  let tents = resTent.data || [];
  let mots  = resMots.data || [];

  // Filtrar por mês se informado
  if (filtros.mes_inicio && filtros.mes_fim) {
    oris  = oris.filter(o  => o.data_contato >= filtros.mes_inicio && o.data_contato <= filtros.mes_fim);
    tents = tents.filter(t => t.data_contato >= filtros.mes_inicio && t.data_contato <= filtros.mes_fim);
  }

  const total    = oris.length;
  const notaA    = oris.filter(o => o.nota === 'A').length;
  const notaB    = oris.filter(o => o.nota === 'B').length;
  const notaC    = oris.filter(o => o.nota === 'C').length;
  const pendentes = mots.filter(m => m.status === 'pendente').length;

  // Reincidentes: motoristas com mais de 1 orientação
  const porMotorista = {};
  oris.forEach(o => {
    porMotorista[o.motorista_nome] = (porMotorista[o.motorista_nome] || 0) + 1;
  });
  const reincidentes = Object.values(porMotorista).filter(c => c > 1).length;

  // Tipos de contato (para gráfico)
  const tiposContato = {};
  oris.forEach(o => {
    tiposContato[o.motivo] = (tiposContato[o.motivo] || 0) + 1;
  });

  // Top motoristas por índice WF (pendentes)
  const top10 = [...mots]
    .filter(m => m.status === 'pendente')
    .sort((a, b) => b.indice_wf - a.indice_wf)
    .slice(0, 10);

  return {
    total, notaA, notaB, notaC, pendentes, reincidentes,
    tiposContato, top10,
    totalTentativas: tents.length
  };
}

// ═══════════════════════════════════════════════════════════════════════
// MESES disponíveis (para filtros)
// ═══════════════════════════════════════════════════════════════════════

export async function carregarMesesDisponiveis() {
  const { data, error } = await sb
    .from('motoristas')
    .select('mes_ano')
    .neq('mes_ano', '')
    .order('mes_ano', { ascending: false });

  if (error) throw error;

  const set = new Set((data || []).map(r => r.mes_ano).filter(Boolean));
  return [...set];
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTAÇÃO CSV
// ═══════════════════════════════════════════════════════════════════════

export async function exportarCSV(filtros = {}) {
  let query = sb
    .from('orientacoes')
    .select('*, motoristas(nome, cpf, cliente, tipo, contato, indice_wf)')
    .eq('tipo_registro', 'orientacao')
    .order('data_contato', { ascending: false });

  if (filtros.mes_inicio) query = query.gte('data_contato', filtros.mes_inicio);
  if (filtros.mes_fim)    query = query.lte('data_contato', filtros.mes_fim);

  const { data, error } = await query;
  if (error) throw error;

  const linhas = [
    ['Analista', 'Cliente', 'Motorista', 'CPF', 'Contato', 'Motivo', 'Data', 'Hora', 'Nota', 'Descrição']
  ];

  for (const r of (data || [])) {
    linhas.push([
      currentProfile?.nome || '',
      r.cliente || r.motoristas?.cliente || '',
      r.motorista_nome,
      r.motorista_cpf || r.motoristas?.cpf || '',
      r.motoristas?.contato || '',
      r.motivo,
      r.data_contato,
      r.hora_contato || '',
      r.nota || '',
      (r.descricao || '').replace(/\n/g, ' ')
    ]);
  }

  const csv = linhas.map(l =>
    l.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')
  ).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `paz5_orientacoes_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════
// LEMBRETES (tentativas com lembrete_dt)
// ═══════════════════════════════════════════════════════════════════════

export async function carregarLembretes() {
  const hoje = new Date().toISOString().split('T')[0];

  const { data, error } = await sb
    .from('orientacoes')
    .select('*, motoristas(nome, cliente, contato)')
    .eq('tipo_registro', 'tentativa')
    .not('lembrete_dt', 'is', null)
    .lte('lembrete_dt', hoje)
    .order('lembrete_dt');

  if (error) throw error;
  return data || [];
}

export async function limparLembrete(registroId) {
  await sb.from('orientacoes')
    .update({ lembrete_dt: null, lembrete_hr: null })
    .eq('id', registroId);
}

// ═══════════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════════

export async function registrarLog(acao, descricao, extras = {}) {
  try {
    await sb.from('logs').insert({
      acao,
      descricao,
      tabela:      extras.tabela      || null,
      registro_id: extras.registro_id || null,
      dados_antes: extras.antes       || null,
      dados_depois:extras.depois      || null,
      user_agent:  navigator.userAgent.substring(0, 200)
    });
  } catch (e) {
    console.warn('[PAZ5] Falha ao registrar log:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TROCAR SENHA (painel do analista)
// ═══════════════════════════════════════════════════════════════════════

export async function trocarSenha(novaSenha) {
  const { error } = await sb.auth.updateUser({ password: novaSenha });
  if (error) throw error;
  await registrarLog('CHANGE_PASSWORD', 'Usuário alterou a própria senha');
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN: Gestão de Usuários
// ═══════════════════════════════════════════════════════════════════════

export async function listarUsuariosAdmin() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function atualizarPerfilAdmin(userId, campos) {
  const { data: antes } = await sb.from('profiles').select('*').eq('id', userId).single();

  const { error } = await sb.from('profiles').update(campos).eq('id', userId);
  if (error) throw error;

  await registrarLog('UPDATE_USER', `Perfil ${userId} atualizado`, {
    tabela: 'profiles',
    registro_id: userId,
    antes,
    depois: campos
  });
}

export async function bloquearUsuario(userId) {
  await atualizarPerfilAdmin(userId, { status: 'bloqueado' });
  await registrarLog('BLOCK_USER', `Usuário ${userId} bloqueado`);
}

export async function desbloquearUsuario(userId) {
  await atualizarPerfilAdmin(userId, { status: 'ativo' });
  await registrarLog('UNBLOCK_USER', `Usuário ${userId} desbloqueado`);
}

export async function listarLogsAdmin(filtros = {}) {
  let query = sb
    .from('logs')
    .select('*, profiles(nome, email)')
    .order('created_at', { ascending: false })
    .limit(filtros.limite || 300);

  if (filtros.user_id) query = query.eq('user_id', filtros.user_id);
  if (filtros.acao)    query = query.eq('acao', filtros.acao);
  if (filtros.inicio)  query = query.gte('created_at', filtros.inicio);
  if (filtros.fim)     query = query.lte('created_at', filtros.fim);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function carregarDashboardAdmin() {
  const [resUsers, resOris, resTents] = await Promise.all([
    sb.from('profiles').select('id, nome, role, status, ultimo_login, email'),
    sb.from('orientacoes').select('user_id, nota, data_contato, motorista_nome').eq('tipo_registro', 'orientacao'),
    sb.from('orientacoes').select('user_id, data_contato').eq('tipo_registro', 'tentativa')
  ]);

  const usuarios = resUsers.data || [];
  const oris     = resOris.data  || [];
  const tents    = resTents.data || [];

  // Ranking por analista
  const contaPorUser = {};
  oris.forEach(o => {
    contaPorUser[o.user_id] = (contaPorUser[o.user_id] || 0) + 1;
  });

  const ranking = usuarios
    .filter(u => u.role === 'analista')
    .map(u => ({
      ...u,
      total_orientacoes: contaPorUser[u.id] || 0,
      total_tentativas:  tents.filter(t => t.user_id === u.id).length
    }))
    .sort((a, b) => b.total_orientacoes - a.total_orientacoes);

  // Orientações por dia (últimos 30 dias)
  const porDia = {};
  oris.forEach(o => {
    if (o.data_contato) porDia[o.data_contato] = (porDia[o.data_contato] || 0) + 1;
  });

  return {
    totalUsuarios:     usuarios.filter(u => u.role === 'analista').length,
    totalOrientacoes:  oris.length,
    totalTentativas:   tents.length,
    notaA:             oris.filter(o => o.nota === 'A').length,
    notaB:             oris.filter(o => o.nota === 'B').length,
    notaC:             oris.filter(o => o.nota === 'C').length,
    ranking,
    porDia,
    usuarios
  };
}

export async function carregarDadosAnalista(userId) {
  const [resMots, resOris, resTents, resPerfil] = await Promise.all([
    sb.from('motoristas').select('*').eq('user_id', userId),
    sb.from('orientacoes').select('*').eq('user_id', userId).eq('tipo_registro', 'orientacao').order('data_contato', { ascending: false }),
    sb.from('orientacoes').select('*').eq('user_id', userId).eq('tipo_registro', 'tentativa').order('data_contato', { ascending: false }),
    sb.from('profiles').select('*').eq('id', userId).single()
  ]);

  return {
    motoristas:   resMots.data  || [],
    orientacoes:  resOris.data  || [],
    tentativas:   resTents.data || [],
    perfil:       resPerfil.data
  };
}
