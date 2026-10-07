import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, timer } from 'rxjs';
import * as L from 'leaflet';
import { finalize, switchMap } from 'rxjs/operators';
import { BRAZIL_UFS } from '../../core/constants/brazil-ufs';
import type { AssistantAnswerResponse, CrossingCandidate, CrossingIndicator, CrossingParty, CrossingPoint, CrossingResultResponse, CrossingCatalogResponse, CrossingCandidatesResponse, MunicipalMapResponse } from '../../core/models/candidate.models';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';

interface AnalysisPoint extends CrossingPoint {
  indicador: number;
  x: number;
}

interface AnalysisStats {
  n: number;
  r: number;
  r2: number;
  slope: number;
  intercept: number;
  p: number;
}

interface PlotPoint extends AnalysisPoint {
  cx: number;
  cy: number;
}

interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface FactorAnalysis {
  key: string;
  indicator: CrossingIndicator;
  n: number;
  stats: AnalysisStats | null;
}

const INDICATOR_OPTIONS = [
  { key: 'populacao', name: 'População residente', group: 'Demografia' },
  { key: 'densidade', name: 'Densidade demográfica', group: 'Demografia' },
  { key: 'idadeMediana', name: 'Idade mediana', group: 'Demografia' },
  { key: 'indiceEnvelhecimento', name: 'Índice de envelhecimento', group: 'Demografia' },
  { key: 'razaoSexo', name: 'Razão de sexo', group: 'Demografia' },
  { key: 'percentualUrbano', name: 'População em área urbana', group: 'Demografia' },
  { key: 'pib', name: 'PIB municipal', group: 'Economia' },
  { key: 'pibPerCapita', name: 'PIB per capita (calculado)', group: 'Economia' },
  { key: 'alfabetizacao', name: 'Taxa de alfabetização (15 anos ou mais)', group: 'Educação' },
  { key: 'superiorCompleto', name: 'Superior completo (18 anos ou mais)', group: 'Educação' },
  { key: 'aguaRede', name: 'Domicílios com abastecimento pela rede geral', group: 'Infraestrutura' },
  { key: 'esgotamentoAdequado', name: 'Domicílios com rede/fossa ligada à rede', group: 'Infraestrutura' },
  { key: 'coletaLixo', name: 'Domicílios com lixo coletado', group: 'Infraestrutura' },
];

@Component({
  selector: 'app-cruzamento-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cruzamento.page.html',
  styleUrl: './cruzamento.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CruzamentoPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(EleicaoApiService);
  @ViewChild('municipalMap') private mapElement?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private mapLayer?: L.GeoJSON;
  private mapUf = '';
  private mapRequest?: Subscription;
  private catalogRequest?: Subscription;
  private candidateRequest?: Subscription;
  private crossingRequest?: Subscription;
  private catalogLoadId = 0;
  private candidateLoadId = 0;
  private crossingLoadId = 0;
  private readonly catalogCache = new Map<string, { expiresAt: number; value: CrossingCatalogResponse }>();
  private readonly candidateCache = new Map<string, { expiresAt: number; value: CrossingCandidatesResponse }>();
  private readonly resultCache = new Map<string, { expiresAt: number; value: CrossingResultResponse }>();

  readonly anos = [2026, 2024, 2022, 2020, 2018, 2016];
  readonly ufs = ['BRASIL', ...BRAZIL_UFS];
  readonly indicadores = INDICATOR_OPTIONS;
  readonly gruposIndicadores = [...new Set(INDICATOR_OPTIONS.map((option) => option.group))].map((name) => ({
    name,
    items: INDICATOR_OPTIONS.filter((option) => option.group === name),
  }));
  readonly parties = signal<CrossingParty[]>([]);
  readonly candidateOptions = signal<CrossingCandidate[]>([]);
  readonly partyOptions = signal<CrossingParty[]>([]);
  readonly availableCandidateCount = signal(0);
  readonly cargos = signal<string[]>([]);
  readonly turnos = signal<number[]>([]);
  readonly result = signal<CrossingResultResponse | null>(null);
  readonly loadingCatalog = signal(false);
  readonly loadingResult = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasLoadedCatalog = signal(false);
  readonly logScale = signal(false);
  readonly analyzedPoints = computed(() => {
    const result = this.result();
    if (!result) return [];
    return result.pontos.flatMap((point) => {
      const value = point.indicador;
      if (value == null || (this.logScale() && value <= 0)) return [];
      return [{ ...point, indicador: value, x: this.logScale() ? Math.log10(value) : value }];
    });
  });
  readonly sortedIndicators = computed(() =>
    this.analyzedPoints().map((point) => point.indicador).sort((left, right) => left - right),
  );
  readonly stats = computed(() => calculateStats(this.analyzedPoints()));
  readonly plotPoints = computed(() => createPlot(this.analyzedPoints(), this.stats()));
  readonly quintiles = computed(() => createQuintiles(this.analyzedPoints()));
  readonly barChartPlan = computed<BarChartPlan>(() => createBarChart(this.analyzedPoints()));

  barChartColor(index: number): string {
    return BAR_CHART_PALETTE[Math.min(BAR_CHART_PALETTE.length - 1, index % BAR_CHART_PALETTE.length)];
  }

  readonly quintileSummary = computed(() => {
    const groups = this.quintiles();
    if (!groups.length) return '';
    const highest = groups.reduce((best, group) => group.mean > best.mean ? group : best);
    const lowest = groups.reduce((best, group) => group.mean < best.mean ? group : best);
    const difference = highest.mean - lowest.mean;
    const describe = (group: typeof highest) =>
      `${group.label.toLocaleLowerCase('pt-BR')}${group.position ? ` (${group.position.toLocaleLowerCase('pt-BR')})` : ''}`;
    return highest === lowest || difference === 0
      ? `A média de votos foi semelhante nas cinco faixas, em torno de ${highest.mean.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%.`
      : `A maior média foi na ${describe(highest)} (${highest.mean.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%); a menor, na ${describe(lowest)} (${lowest.mean.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%). A diferença entre as médias foi de ${difference.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} pontos percentuais.`;
  });
  readonly factorAnalyses = computed<FactorAnalysis[]>(() => {
    const data = this.result();
    if (!data?.indicadores) return [];
    return Object.entries(data.indicadores).map(([key, indicator]) => {
      const points = data.pontos.flatMap((point) => {
        const value = point.indicadores?.[key];
        return value == null ? [] : [{ ...point, indicador: value, x: value }];
      });
      return { key, indicator, n: points.length, stats: calculateStats(points) };
    }).sort((left, right) =>
      Number(Boolean(right.stats)) - Number(Boolean(left.stats)) ||
      Math.abs(right.stats?.r ?? 0) - Math.abs(left.stats?.r ?? 0),
    );
  });
  readonly mapData = signal<MunicipalMapResponse | null>(null);
  readonly mapLoading = signal(false);
  readonly mapError = signal<string | null>(null);
  readonly activeView = signal<'overview' | 'scatter' | 'map' | 'patterns'>('map');
  readonly maxQuintileVote = computed(() => Math.max(Number.EPSILON, ...this.quintiles().map((group) => group.mean)));
  readonly assistantEnabled = signal(false);
  readonly assistantStatusLoaded = signal(false);
  readonly assistantStatusError = signal<string | null>(null);
  readonly assistantMessages = signal<AssistantMessage[]>([]);
  readonly assistantLoading = signal(false);
  readonly assistantError = signal<string | null>(null);
  readonly loadingCandidates = signal(false);
  assistantQuestion = '';

  ano = 2022;
  uf = 'BRASIL';
  cargo = '';
  turno: number | null = null;
  candidato = '';
  partido = 'TODOS';
  modoAnalise: 'candidato' | 'partido' = 'candidato';
  candidatoFiltro = '';
  indicador = 'populacao';

  ngOnInit(): void {
    this.carregarCatalogo();
    // Mapa neutro/vazio imediato, sem depender de candidato/cargo.
    this.carregarMalha();
    this.api.getAssistantStatus().subscribe({
      next: (status) => {
        this.assistantEnabled.set(status.enabled);
        this.assistantStatusError.set(null);
        this.assistantStatusLoaded.set(true);
      },
      error: () => {
        this.assistantStatusError.set('Não foi possível verificar a disponibilidade do assistente.');
        this.assistantStatusLoaded.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    this.catalogRequest?.unsubscribe();
    this.candidateRequest?.unsubscribe();
    this.crossingRequest?.unsubscribe();
    this.mapRequest?.unsubscribe();
    this.map?.remove();
    this.map = undefined;
  }

  partidosDisponiveis(): CrossingParty[] {
    return this.parties().filter((party) => party.cargo === this.cargo && party.turno === this.turno);
  }

  mudarModoAnalise(): void {
    this.candidatoFiltro = '';
    this.candidateRequest?.unsubscribe();
    this.candidateLoadId += 1;
    this.loadingCandidates.set(false);
    this.partido = this.modoAnalise === 'partido' ? '' : 'TODOS';
    this.candidato = '';
    this.result.set(null);
    this.atualizarOpcoesSelecao();
    // Modo partido sem seleção mantém mapa vazio; demais fluxos aguardam escolha explícita.
    if (this.modoAnalise === 'partido' && this.partido) this.carregarCruzamento();
    else if (this.activeView() === 'map') this.renderMap();
  }

  mudarPartido(): void {
    this.candidatoFiltro = '';
    this.atualizarOpcoesSelecao();
    this.candidato = '';
    this.result.set(null);
    if (this.modoAnalise === 'partido') {
      // No modo partido já dispara com seleção válida; sem partido mantém mapa vazio.
      this.carregarCruzamento();
      if (!this.partido && this.activeView() === 'map') this.renderMap();
      return;
    }
    if (this.activeView() === 'map') this.renderMap();
  }

  mudarCandidato(): void {
    this.carregarCruzamento();
  }

  filtrarCandidatos(): void {
    this.result.set(null);
    this.carregarOpcoesCandidatos(true);
  }

  carregarCatalogo(): void {
    this.catalogRequest?.unsubscribe();
    this.candidateRequest?.unsubscribe();
    this.crossingRequest?.unsubscribe();
    const requestId = ++this.catalogLoadId;
    const cacheKey = `${this.ano}|${this.uf}`;
    this.loadingCatalog.set(true);
    this.loadingResult.set(false);
    this.hasLoadedCatalog.set(false);
    this.result.set(null);
    this.error.set(null);
    const cachedCatalog = this.catalogCache.get(cacheKey);
    if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
      this.aplicarCatalogo(cachedCatalog.value);
      this.loadingCatalog.set(false);
      return;
    }
    this.candidateOptions.set([]);
    this.partyOptions.set([]);
    this.cargos.set([]);
    this.turnos.set([]);
    this.cargo = '';
    this.turno = null;
    this.candidato = '';
    this.partido = 'TODOS';
    this.candidatoFiltro = '';

    this.catalogRequest = this.api
      .getCrossingCatalog(this.ano, this.uf)
      .pipe(finalize(() => {
        if (requestId === this.catalogLoadId) this.loadingCatalog.set(false);
      }))
      .subscribe({
        next: (catalog) => {
          if (requestId !== this.catalogLoadId) return;
          this.catalogCache.set(cacheKey, { value: catalog, expiresAt: Date.now() + 5 * 60 * 1000 });
          if (this.catalogCache.size > 3) {
            this.catalogCache.delete(this.catalogCache.keys().next().value!);
          }
          this.aplicarCatalogo(catalog);
        },
        error: (error) => {
          if (requestId !== this.catalogLoadId) return;
          this.error.set(error?.error?.error ?? 'Não foi possível carregar os dados oficiais do TSE.');
        },
      });
  }

  private aplicarCatalogo(catalog: CrossingCatalogResponse): void {
    this.parties.set(catalog.partidos);
    this.cargos.set(catalog.cargos);
    this.turnos.set(catalog.turnos);
    // Por default nada é pré-selecionado: título genérico, sem candidato/partido/cargo.
    this.cargo = '';
    this.turno = null;
    this.partido = this.modoAnalise === 'partido' ? '' : 'TODOS';
    this.candidato = '';
    this.hasLoadedCatalog.set(true);
    this.atualizarOpcoesSelecao();
    this.candidateOptions.set([]);
    this.availableCandidateCount.set(0);
    this.result.set(null);
    // Mapa neutro/vazio por default (sem candidato/cargo), mas sempre visível.
    this.carregarMalha();
  }

  filtrosMudaram(): void {
    this.result.set(null);
    this.candidatoFiltro = '';
    this.candidateRequest?.unsubscribe();
    this.candidateLoadId += 1;
    this.loadingCandidates.set(false);
    this.candidato = '';
    this.atualizarOpcoesSelecao();
    // Mesmo vazio, a malha reage à UF/abrangência; o overlay só aparece com análise.
    if (!this.mapData() || this.mapUf !== this.uf) this.carregarMalha();
    else if (this.activeView() === 'map') this.renderMap();
  }

  carregarCruzamento(): void {
    this.crossingRequest?.unsubscribe();
    const requestId = ++this.crossingLoadId;
    if (!this.cargo || this.turno == null ||
        (this.modoAnalise === 'candidato' && !this.candidato) ||
        (this.modoAnalise === 'partido' && !this.partido)) {
      this.result.set(null);
      this.loadingResult.set(false);
      return;
    }
    const target = this.modoAnalise === 'partido' ? this.partido : this.candidato;
    const cacheKey = [
      this.ano, this.uf, this.cargo, this.turno, this.modoAnalise, target, this.indicador,
    ].join('|');
    const cached = this.resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.result.set(this.aplicarIndicador(cached.value, this.indicador));
      this.loadingResult.set(false);
      if (this.activeView() === 'map') {
        if (this.mapData() && this.mapUf === this.uf) this.renderMap();
        else this.carregarMalha();
      }
      return;
    }
    this.error.set(null);
    this.result.set(null);
    this.loadingResult.set(true);

    const params = {
        ano: this.ano,
        uf: this.uf,
        cargo: this.cargo,
        turno: this.turno,
        indicador: this.indicador,
      };
    const request = this.modoAnalise === 'partido'
      ? this.api.getPartyCrossingResults({ ...params, partido: this.partido })
      : this.api.getCrossingResults({ ...params, candidato: this.candidato });
    this.crossingRequest = request
      .pipe(finalize(() => {
        if (requestId === this.crossingLoadId) this.loadingResult.set(false);
      }))
      .subscribe({
        next: (result) => {
          if (requestId !== this.crossingLoadId) return;
          this.resultCache.set(cacheKey, { value: result, expiresAt: Date.now() + 5 * 60 * 1000 });
          if (this.resultCache.size > 8) {
            this.resultCache.delete(this.resultCache.keys().next().value!);
          }
          this.result.set(this.aplicarIndicador(result, this.indicador));
          if (this.activeView() === 'map') {
            if (this.mapData() && this.mapUf === this.uf) this.renderMap();
            else this.carregarMalha();
          }
        },
        error: (error) => {
          if (requestId !== this.crossingLoadId) return;
          this.error.set(error?.error?.error ?? 'Não foi possível cruzar os dados do TSE e do IBGE.');
        },
      });
  }

  nomeIndicador(): string {
    return this.result()?.indicadores?.[this.indicador]?.nome ??
      INDICATOR_OPTIONS.find((option) => option.key === this.indicador)?.name ??
      'Indicador';
  }

  resumoRelacao(): string {
    const summary = this.stats();
    if (!summary) return 'Ainda não há dados suficientes para comparar este fator.';
    if (Math.abs(summary.r) < 0.1) {
      return 'Neste recorte, a relação linear entre o fator e o percentual de votos está próxima de zero.';
    }
    return summary.r > 0
      ? 'Neste recorte, valores maiores do fator tendem a acompanhar percentuais de votos maiores.'
      : 'Neste recorte, valores maiores do fator tendem a acompanhar percentuais de votos menores.';
  }

  selecionarFator(key: string): void {
    this.indicador = key;
    this.selecionarIndicador();
    this.activeView.set('scatter');
  }

  selecionarIndicador(): void {
    const data = this.result();
    if (!data) {
      this.carregarCruzamento();
      return;
    }
    this.result.set(this.aplicarIndicador(data, this.indicador));
    if (this.activeView() === 'map') this.renderMap();
  }

  private aplicarIndicador(data: CrossingResultResponse, key: string): CrossingResultResponse {
    const metadata = data.indicadores?.[key];
    if (!metadata) return data;
    return {
      ...data,
      indicador: metadata,
      pontos: data.pontos.map((point) => ({
        ...point,
        indicador: point.indicadores?.[key],
      })),
      cobertura: {
        ...data.cobertura,
        municipiosComDados: data.cobertura.municipiosComDadosPorIndicador?.[key] ??
          data.pontos.filter((point) => point.indicadores?.[key] != null).length,
      },
    };
  }

  nomeAbrangencia(): string {
    return this.uf === 'BRASIL' ? 'Brasil inteiro' : this.uf;
  }

  tituloAnalise(): string {
    const data = this.result();
    if (data?.alvo?.nome) {
      const abrang = data.uf === 'BRASIL' ? 'Brasil' : data.uf;
      const alvo = data.alvo.tipo === 'partido' ? `Partido ${data.alvo.nome}` : data.alvo.nome;
      const sigla = data.alvo.tipo === 'candidato' && data.alvo.partido ? ` · ${data.alvo.partido}` : '';
      return `${alvo}${sigla} · ${data.cargo} ${data.ano} · ${abrang}`;
    }
    // Default neutro: nunca expor candidato/cargo/partido sem filtragem explícita.
    return 'Eleições no Brasil';
  }

  perguntarAssistente(): void {
    const question = this.assistantQuestion.trim();
    if (!question || this.assistantLoading()) return;
    this.assistantQuestion = '';
    this.assistantError.set(null);
    this.assistantMessages.update((messages) => [...messages, { role: 'user', text: question }]);
    this.assistantLoading.set(true);

    const data = this.result();
    const stats = this.stats();
    const context = {
      ano: data?.ano ?? this.ano,
      uf: data?.uf ?? this.uf,
      cargo: data?.cargo ?? this.cargo,
      candidato: data?.alvo.tipo === 'candidato' ? data.alvo.nome : null,
      partido: data?.alvo.tipo === 'partido' ? data.alvo.nome : data?.alvo.partido ?? null,
      indicador: data?.indicador.nome ?? this.nomeIndicador(),
      periodo: data?.indicador.periodo ?? null,
      municipios: data?.pontos.length ?? null,
      n: stats?.n ?? null,
      correlacao: stats?.r ?? null,
      r2: stats?.r2 ?? null,
      pValor: stats?.p ?? null,
      escala: this.logScale() ? 'log10' : 'linear',
      municipiosComDados: data?.cobertura.municipiosComDados ?? null,
      municipiosDoAlvo: data?.cobertura.municipiosDoAlvo ?? null,
      comparacaoDeFatores: this.factorAnalyses().map(({ indicator, stats: factorStats, n }) =>
        `${indicator.nome}: r=${factorStats?.r.toFixed(3) ?? 'indisponível'}, n=${n}`,
      ).join('; '),
    };

    this.api.askCrossingAssistant(question, context).pipe(finalize(() => this.assistantLoading.set(false))).subscribe({
      next: (result: AssistantAnswerResponse) => {
        this.assistantMessages.update((messages) => [...messages, { role: 'assistant', text: result.answer }]);
      },
      error: (error) => this.assistantError.set(error?.error?.error ?? 'Não foi possível obter uma resposta agora.'),
    });
  }

  selecionarVisualizacao(view: 'overview' | 'scatter' | 'map' | 'patterns'): void {
    this.activeView.set(view);
    if (view !== 'map') return;
    if (!this.mapData() || this.mapUf !== this.uf) this.carregarMalha();
    else {
      this.renderMap();
      requestAnimationFrame(() => requestAnimationFrame(() => this.map?.invalidateSize()));
    }
  }

  corIndicador(value: number | undefined): string {
    if (value == null) return '#424957';
    const values = this.sortedIndicators();
    if (!values.length) return '#424957';
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] < value) low = middle + 1;
      else high = middle;
    }
    const percentile = low / Math.max(1, values.length - 1);
    const palette = ['#e6f0f8', '#bed5e6', '#87afcc', '#4e86aa', '#1e5273'];
    return palette[Math.min(palette.length - 1, Math.floor(percentile * palette.length))];
  }

  corFaixaLegenda(index: number): string {
    const values = this.sortedIndicators();
    if (!values.length) return '#424957';
    return this.corIndicador(values[Math.min(values.length - 1, Math.floor((index * values.length) / 5))]);
  }

  faixaLegenda(index: number): string {
    const values = this.sortedIndicators();
    if (!values.length) return 'Sem dados';
    const start = Math.floor((index * values.length) / 5);
    const end = Math.min(values.length - 1, Math.floor(((index + 1) * values.length) / 5) - 1);
    if (end < start) return 'Sem dados';
    return `${values[start].toPrecision(3)}–${values[end].toPrecision(3)}`;
  }

  private atualizarOpcoesSelecao(): void {
    this.partyOptions.set(this.partidosDisponiveis());
  }

  private carregarOpcoesCandidatos(debounce = false): void {
    this.candidateRequest?.unsubscribe();
    this.crossingRequest?.unsubscribe();
    this.crossingLoadId += 1;
    this.loadingResult.set(false);
    const requestId = ++this.candidateLoadId;
    this.error.set(null);
    const busca = this.candidatoFiltro.trim();
    const cargo = this.cargo;
    const turno = this.turno;
    if (!cargo || turno == null) {
      this.candidateOptions.set([]);
      this.availableCandidateCount.set(0);
      this.candidato = '';
      this.loadingCandidates.set(false);
      return;
    }
    const params = {
      ano: this.ano,
      uf: this.uf,
      cargo,
      turno,
      partido: this.partido === 'TODOS' ? undefined : this.partido,
      busca: busca || undefined,
    };

    const cacheKey = [
      params.ano, params.uf, params.cargo, params.turno, params.partido ?? '', busca,
    ].join('|');
    const cached = this.candidateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.aplicarOpcoesCandidatos(cached.value);
      return;
    }

    this.loadingCandidates.set(true);
    const request = debounce
      ? timer(220).pipe(switchMap(() => this.api.getCrossingCandidates(params)))
      : this.api.getCrossingCandidates(params);
    this.candidateRequest = request
      .pipe(finalize(() => {
        if (requestId === this.candidateLoadId) this.loadingCandidates.set(false);
      }))
      .subscribe({
        next: (response) => {
          if (requestId !== this.candidateLoadId) return;
          this.candidateCache.set(cacheKey, { value: response, expiresAt: Date.now() + 5 * 60 * 1000 });
          if (this.candidateCache.size > 12) {
            this.candidateCache.delete(this.candidateCache.keys().next().value!);
          }
          this.aplicarOpcoesCandidatos(response);
        },
        error: (error) => {
          if (requestId !== this.candidateLoadId) return;
          this.candidateOptions.set([]);
          this.availableCandidateCount.set(0);
          this.error.set(error?.error?.error ?? 'Não foi possível buscar candidatos para este filtro.');
        },
      });
  }

  private aplicarOpcoesCandidatos(response: CrossingCandidatesResponse): void {
    this.candidateOptions.set(response.items);
    this.availableCandidateCount.set(response.total);
    // Sem pré-seleção: o usuário escolhe explicitamente; mantém seleção válida se ainda existir.
    const selectedIsAvailable = this.candidato
      ? response.items.some((candidate) => candidate.sqCandidato === this.candidato)
      : false;
    if (!selectedIsAvailable) {
      this.candidato = '';
      this.result.set(null);
      if (this.activeView() === 'map') this.renderMap();
      return;
    }
    this.carregarCruzamento();
  }

  private carregarMalha(): void {
    const uf = this.uf;
    this.mapRequest?.unsubscribe();
    this.mapLoading.set(true);
    this.mapError.set(null);
    this.mapRequest = this.api
      .getMunicipalMap(uf)
      .pipe(finalize(() => this.mapLoading.set(false)))
      .subscribe({
        next: (featureCollection) => {
          this.mapData.set(featureCollection);
          this.mapUf = uf;
          requestAnimationFrame(() => this.renderMap());
        },
        error: (error) => this.mapError.set(error?.error?.error ?? 'Não foi possível carregar a malha municipal do IBGE.'),
      });
  }

  private renderMap(): void {
    const element = this.mapElement?.nativeElement;
    const featureCollection = this.mapData();
    if (!element || !featureCollection) return;
    const result = this.result();

    // O painel do mapa vive fora do *ngIf(result) para existir vazio por default.
    // Quando o resultado é trocado (novo candidato/UF), o Angular pode recriar a div.
    // Reutilizar a instância antiga do Leaflet a liga ao elemento destacado,
    // então o mapa "some". Recria quando o container mudou.
    if (this.map && this.map.getContainer() !== element) {
      this.map.remove();
      this.map = undefined;
      this.mapLayer = undefined;
    }

    if (!this.map) {
      this.map = L.map(element, { scrollWheelZoom: false, zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
    }
    this.mapLayer?.remove();
    const pointByCode = new Map((result?.pontos ?? []).map((point) => [point.codigoIbge, point]));
    const indicadorUnidade = result?.indicador.unidade ?? '';
    this.mapLayer = L.geoJSON(featureCollection as GeoJSON.GeoJsonObject, {
      style: (feature) => {
        const code = String(feature?.properties?.['codarea'] ?? '');
        const point = pointByCode.get(code);
        return {
          color: '#f4f5f7',
          weight: 0.45,
          fillColor: this.corIndicador(point?.indicador),
          fillOpacity: point ? 0.82 : 0.18,
        };
      },
      onEachFeature: (feature, layer) => {
        const code = String(feature.properties?.['codarea'] ?? '');
        const point = pointByCode.get(code);
        const description = point && result
          ? `${point.municipio}: ${point.indicador?.toLocaleString('pt-BR') ?? 'sem dados'} ${indicadorUnidade}; ${point.percentualVotos.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% dos votos`
          : 'Selecione filtros para ver os valores por município';
        const content = document.createElement('div');
        content.textContent = description;
        layer.bindTooltip(content);
        layer.bindPopup(description);
      },
    }).addTo(this.map);
    const bounds = this.mapLayer.getBounds();
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [8, 8] });
    requestAnimationFrame(() => this.map?.invalidateSize());
  }
}

function calculateStats(points: AnalysisPoint[]): AnalysisStats | null {
  if (points.length < 3) return null;
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.percentualVotos, 0) / n;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.percentualVotos - meanY;
    sumXX += dx * dx;
    sumYY += dy * dy;
    sumXY += dx * dy;
  }
  if (!sumXX || !sumYY) return null;
  const r = sumXY / Math.sqrt(sumXX * sumYY);
  const degreesOfFreedom = n - 2;
  const tSquared = (r * r * degreesOfFreedom) / Math.max(Number.EPSILON, 1 - r * r);
  const p = r === 1 || r === -1 ? 0 : regularizedBeta(degreesOfFreedom / (degreesOfFreedom + tSquared), degreesOfFreedom / 2, 0.5);
  const slope = sumXY / sumXX;
  return { n, r, r2: r * r, slope, intercept: meanY - slope * meanX, p };
}

function createPlot(points: AnalysisPoint[], stats: AnalysisStats | null): { dots: PlotPoint[]; line: { x1: number; y1: number; x2: number; y2: number } | null } {
  if (!points.length) return { dots: [], line: null };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(1, ...points.map((point) => point.percentualVotos));
  const px = (x: number) => 58 + ((x - minX) / (maxX - minX || 1)) * 630;
  const py = (y: number) => 292 - (y / maxY) * 250;
  const dots = points.map((point) => ({ ...point, cx: px(point.x), cy: py(point.percentualVotos) }));
  const line = stats
    ? {
        x1: px(minX),
        y1: py(stats.intercept + stats.slope * minX),
        x2: px(maxX),
        y2: py(stats.intercept + stats.slope * maxX),
      }
    : null;
  return { dots, line };
}

function createQuintiles(points: AnalysisPoint[]): { label: string; position: string; range: string; count: number; mean: number }[] {
  if (points.length < 5) return [];
  const sorted = [...points].sort((left, right) => left.x - right.x);
  return Array.from({ length: 5 }, (_, index) => {
    const group = sorted.slice(Math.floor((index * sorted.length) / 5), Math.floor(((index + 1) * sorted.length) / 5));
    if (!group.length) return null;
    return {
      label: `Faixa ${index + 1}`,
      position: index === 0 ? 'Menores valores' : index === 4 ? 'Maiores valores' : '',
      range: `${formatIndicator(group[0].indicador)} a ${formatIndicator(group[group.length - 1].indicador)}`,
      count: group.length,
      mean: group.reduce((sum, point) => sum + point.percentualVotos, 0) / group.length,
    };
  }).filter((group): group is NonNullable<typeof group> => group !== null);
}

interface BarChartDatum {
  label: string;
  position: string;
  range: string;
  count: number;
  mean: number;
  px: number;
  pw: number;
  ph: number;
  pTop: number;
}

interface BarChartPlan {
  bars: BarChartDatum[];
  yMax: number;
  gridlines: { value: number; y: number }[];
  overallMeanValue: number;
  overallMeanY: number;
  xLabels: string[];
}

const BAR_CHART_PADDING = { left: 22, right: 22, top: 16, bottom: 40 } as const;

function createBarChart(points: AnalysisPoint[]): BarChartPlan {
  const groups = createQuintiles(points);
  if (!groups.length) {
    return { bars: [], yMax: 1, gridlines: [], overallMeanValue: 0, overallMeanY: 0, xLabels: [] };
  }

  const yMax = Math.max(1, ...groups.map((group) => group.mean));
  const overallMean =
    points.reduce((sum, point) => sum + point.percentualVotos, 0) / points.length;
  const xLabels = groups.map((group) => group.label);

  const plotLeft = BAR_CHART_PADDING.left;
  const plotRight = 720 - BAR_CHART_PADDING.right;
  const plotTop = BAR_CHART_PADDING.top;
  const plotBottom = 400 - BAR_CHART_PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const groupWidth = plotWidth / groups.length;
  const barWidth = Math.max(18, groupWidth * 0.48);

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: Math.round(fraction * yMax * 10) / 10,
    y: Math.round(plotTop + (1 - fraction) * plotHeight),
  }));

  const bars: BarChartDatum[] = groups.map((group, index) => {
    const x = plotLeft + index * groupWidth + (groupWidth - barWidth) / 2;
    const height = (group.mean / yMax) * plotHeight;
    const pTop = plotTop + plotHeight - height;
    return { ...group, px: x, pw: barWidth, ph: height, pTop };
  });

  const overallMeanY = plotTop + plotHeight - (overallMean / yMax) * plotHeight;

  return { bars, yMax, gridlines, overallMeanValue: overallMean, overallMeanY, xLabels };
}

const BAR_CHART_PALETTE = ['#9fc3e8', '#7fb0d8', '#5d92c8', '#3d77b2', '#1767a6'] as const;

function formatIndicator(value: number): string {
  return value.toLocaleString('pt-BR', { maximumSignificantDigits: 4 });
}

function logGamma(value: number): number {
  const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = value;
  let temp = value + 5.5;
  temp -= (value + 0.5) * Math.log(temp);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) series += coefficient / ++x;
  return -temp + Math.log(2.5066282746310005 * series / value);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let result = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let coefficient = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + coefficient * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + coefficient / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    result *= d * c;
    coefficient = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + coefficient * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + coefficient / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < 3e-7) break;
  }
  return result;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (factor * betaContinuedFraction(a, b, x)) / a
    : 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
}