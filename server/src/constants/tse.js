/** URLs oficiais CDN TSE (dados abertos). */
export const TSE_CDN = {
  consultaCandidatos: 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand',
  motivoCassacao: 'https://cdn.tse.jus.br/estatistica/sead/odsele/motivo_cassacao',
  votacaoCandidatoMunicipio: 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona',
};

export const TSE_ELECTION_YEAR = {
  min: 1994,
  max: 2030,
};

/** Nomes das colunas nos CSV do TSE (evita strings mágicas espalhadas). */
export const TSE_CSV = {
  candidato: {
    ANO_ELEICAO: 'ANO_ELEICAO',
    SG_UF: 'SG_UF',
    SQ_CANDIDATO: 'SQ_CANDIDATO',
    NM_CANDIDATO: 'NM_CANDIDATO',
    NM_URNA_CANDIDATO: 'NM_URNA_CANDIDATO',
    NR_CPF_CANDIDATO: 'NR_CPF_CANDIDATO',
    DS_CARGO: 'DS_CARGO',
    SG_PARTIDO: 'SG_PARTIDO',
    NM_PARTIDO: 'NM_PARTIDO',
    DS_SITUACAO_CANDIDATURA: 'DS_SITUACAO_CANDIDATURA',
    DS_ELEICAO: 'DS_ELEICAO',
  },
  cassacao: {
    ANO_ELEICAO: 'ANO_ELEICAO',
    SG_UF: 'SG_UF',
    SQ_CANDIDATO: 'SQ_CANDIDATO',
    NR_PROCESSO: 'NR_PROCESSO',
    DS_TP_MOTIVO: 'DS_TP_MOTIVO',
    DS_MOTIVO: 'DS_MOTIVO',
  },
};

export function candidatoCsvEntryName(ano, ufToken) {
  const u = ufToken.toUpperCase();
  if (u === 'BR' || u === 'BRASIL') return `consulta_cand_${ano}_BRASIL.csv`;
  return `consulta_cand_${ano}_${u}.csv`;
}

export function cassacaoCsvEntryName(ano, ufToken) {
  const u = ufToken.toUpperCase();
  if (u === 'BR' || u === 'BRASIL') return `motivo_cassacao_${ano}_BRASIL.csv`;
  return `motivo_cassacao_${ano}_${u}.csv`;
}

export function zipUrlConsultaCandidatos(ano) {
  return `${TSE_CDN.consultaCandidatos}/consulta_cand_${ano}.zip`;
}

export function zipUrlMotivoCassacao(ano) {
  return `${TSE_CDN.motivoCassacao}/motivo_cassacao_${ano}.zip`;
}

export function votingCsvEntryName(ano, uf) {
  return `votacao_candidato_munzona_${ano}_${uf.toUpperCase()}.csv`;
}

export function zipUrlVotingCandidates(ano) {
  return `${TSE_CDN.votacaoCandidatoMunicipio}/votacao_candidato_munzona_${ano}.zip`;
}
