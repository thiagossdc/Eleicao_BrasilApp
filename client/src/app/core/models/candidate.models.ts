/** Resposta paginada da API de candidatos */
export interface CandidateListResponse {
  items: CandidateListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CandidateListItem {
  id: number;
  anoEleicao: number;
  uf: string;
  sqCandidato: string;
  nome: string;
  nomeUrna: string | null;
  cargo: string | null;
  partido: string | null;
  nomePartido: string | null;
  situacao: string | null;
  eleicao: string | null;
  temCassacao: number | boolean;
}

export interface CassacaoItem {
  nrProcesso: string | null;
  tipoMotivo: string | null;
  motivo: string | null;
}

export interface CandidateDetailResponse {
  candidate: CandidateListItem;
  cassacoes: CassacaoItem[];
}

export interface DatasetStats {
  totalCandidatos: number;
  totalRegistrosCassacao: number;
}

export interface SyncResponse {
  ok: boolean;
  ano: number;
  uf: string;
  candidatosProcessados: number;
  registrosCassacaoProcessados: number;
  fontes: {
    candidatosZip: string;
    cassacaoZip: string;
  };
}

export interface CrossingCandidate {
  cargo: string;
  turno: number;
  sqCandidato: string;
  nome: string;
  partido: string;
  votos: number;
}

export interface CrossingParty {
  sigla: string;
  cargo: string;
  turno: number;
  candidatos: number;
  votos: number;
}

export interface CrossingCatalogResponse {
  ano: number;
  uf: string;
  cargos: string[];
  turnos: number[];
  partidos: CrossingParty[];
  fontes: { tse: string; ibge: string };
}

export interface CrossingCandidatesResponse {
  items: CrossingCandidate[];
  total: number;
  limit: number;
}

export interface CrossingPoint {
  codigoIbge: string;
  municipio: string;
  uf: string;
  votos: number;
  totalVotosNominais: number;
  percentualVotos: number;
  indicador?: number;
  indicadores?: Record<string, number>;
}

export interface CrossingIndicator {
  nome: string;
  grupo: string;
  variavel: string;
  periodo: string;
  unidade: string;
  agregado: number | string;
  nota?: string;
}

export interface CrossingResultResponse {
  ano: number;
  uf: string;
  cargo: string;
  turno: number;
  alvo: {
    tipo: 'candidato' | 'partido';
    nome: string;
    partido?: string;
  };
  indicador: CrossingIndicator;
  indicadores?: Record<string, CrossingIndicator>;
  pontos: CrossingPoint[];
  cobertura: {
    municipiosComCorrespondencia: number;
    municipiosComDados: number;
    municipiosComDadosPorIndicador?: Record<string, number>;
    municipiosSemCorrespondencia: number;
    municipiosDoAlvo: number;
  };
  fontes: { tse: string; ibge: string };
}

export interface MunicipalMapResponse {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { codarea: string };
    geometry: GeoJSON.Geometry;
  }[];
}

export interface AssistantStatusResponse {
  enabled: boolean;
  model: string;
}

export interface AssistantAnswerResponse {
  inScope: boolean;
  answer: string;
}
