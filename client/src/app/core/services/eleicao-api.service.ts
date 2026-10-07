import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CandidateDetailResponse,
  CandidateListResponse,
  AssistantAnswerResponse,
  AssistantStatusResponse,
  CrossingCatalogResponse,
  CrossingCandidatesResponse,
  CrossingResultResponse,
  DatasetStats,
  MunicipalMapResponse,
  SyncResponse,
} from '../models/candidate.models';

export interface CandidateSearchParams {
  q?: string;
  uf?: string;
  ano?: number;
  onlyRisk?: boolean;
  cargo?: string;
  partido?: string;
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class EleicaoApiService {
  private readonly http = inject(HttpClient);
  /** Em dev o proxy encaminha /api para o Node; em prod configure o mesmo host ou URL absoluta. */
  private readonly apiPrefix = '/api';

  getStats(): Observable<DatasetStats> {
    return this.http.get<DatasetStats>(`${this.apiPrefix}/stats`);
  }

  searchCandidates(params: CandidateSearchParams): Observable<CandidateListResponse> {
    let httpParams = new HttpParams();
    if (params.q?.trim()) httpParams = httpParams.set('q', params.q.trim());
    if (params.uf?.trim()) httpParams = httpParams.set('uf', params.uf.trim().toUpperCase());
    if (params.ano != null) httpParams = httpParams.set('ano', String(params.ano));
    if (params.cargo) httpParams = httpParams.set('cargo', params.cargo);
    if (params.partido) httpParams = httpParams.set('partido', params.partido);
    if (params.onlyRisk) httpParams = httpParams.set('onlyRisk', 'true');
    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<CandidateListResponse>(`${this.apiPrefix}/candidates`, { params: httpParams });
  }

  getCandidateFilters(): Observable<{
    cargos: string[];
    partidos: { sigla: string; nome: string }[];
  }> {
    return this.http.get<{
      cargos: string[];
      partidos: { sigla: string; nome: string }[];
    }>(`${this.apiPrefix}/candidates/options`);
  }

  getCandidateDetail(sqCandidato: string, uf: string, ano: number): Observable<CandidateDetailResponse> {
    const params = new HttpParams().set('uf', uf).set('ano', String(ano));
    return this.http.get<CandidateDetailResponse>(`${this.apiPrefix}/candidates/${sqCandidato}`, { params });
  }

  /**
   * Dispara a importação oficial do TSE. Quando a API está protegida por
   * `SYNC_TOKEN`, o valor digitado na tela viaja como header `x-sync-token`.
   */
  syncTse(body: { ano: number; uf: string }, token?: string): Observable<SyncResponse> {
    const trimmed = token?.trim();
    const headers = trimmed ? new HttpHeaders().set('x-sync-token', trimmed) : undefined;
    return this.http.post<SyncResponse>(`${this.apiPrefix}/sync`, body, headers ? { headers } : undefined);
  }

  getCrossingCatalog(ano: number, uf: string): Observable<CrossingCatalogResponse> {
    const params = new HttpParams().set('ano', String(ano)).set('uf', uf);
    return this.http.get<CrossingCatalogResponse>(`${this.apiPrefix}/crossings/options`, { params });
  }

  getCrossingCandidates(params: {
    ano: number;
    uf: string;
    cargo: string;
    turno: number;
    partido?: string;
    busca?: string;
  }): Observable<CrossingCandidatesResponse> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) httpParams = httpParams.set(key, String(value));
    }
    return this.http.get<CrossingCandidatesResponse>(`${this.apiPrefix}/crossings/candidates`, { params: httpParams });
  }

  getCrossingResults(params: {
    ano: number;
    uf: string;
    cargo: string;
    turno: number;
    candidato: string;
    indicador: string;
  }): Observable<CrossingResultResponse> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      // Ignora vazios em vez de enviar "null"/"undefined" para a API.
      if (value == null || value === '') continue;
      httpParams = httpParams.set(key, String(value));
    }
    return this.http.get<CrossingResultResponse>(`${this.apiPrefix}/crossings`, { params: httpParams });
  }

  getPartyCrossingResults(params: {
    ano: number;
    uf: string;
    cargo: string;
    turno: number;
    partido: string;
    indicador: string;
  }): Observable<CrossingResultResponse> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      // Ignora vazios em vez de enviar "null"/"undefined" para a API.
      if (value == null || value === '') continue;
      httpParams = httpParams.set(key, String(value));
    }
    return this.http.get<CrossingResultResponse>(`${this.apiPrefix}/crossings/party`, { params: httpParams });
  }

  getMunicipalMap(uf: string): Observable<MunicipalMapResponse> {
    return this.http.get<MunicipalMapResponse>(`${this.apiPrefix}/crossings/map/${uf}`);
  }

  getAssistantStatus(): Observable<AssistantStatusResponse> {
    return this.http.get<AssistantStatusResponse>(`${this.apiPrefix}/assistant/status`);
  }

  askCrossingAssistant(
    question: string,
    context: Record<string, string | number | null>,
  ): Observable<AssistantAnswerResponse> {
    return this.http.post<AssistantAnswerResponse>(`${this.apiPrefix}/assistant`, { question, context });
  }
}
