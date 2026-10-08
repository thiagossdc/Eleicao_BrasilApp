import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import * as L from 'leaflet';
import { finalize, switchMap } from 'rxjs/operators';
import { BRAZIL_UFS } from '../../core/constants/brazil-ufs';
import { ELEICAO_ANOS } from '../../core/constants/eleicao-years';
import type { AssistantAnswerResponse, CrossingCandidate, CrossingIndicator, CrossingParty, CrossingPoint, CrossingResultResponse, CrossingCatalogResponse, CrossingCandidatesResponse, MunicipalMapResponse } from '../../core/models/candidate.models';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';
import { partidoColor, partidoRampa, partidoTextoSobre } from '../../core/constants/colors';

/** Seleções vindas da URL compartilhada, aplicadas quando o catálogo chegar. */
interface RestauracaoUrl {
  cargo?: string;
  turno?: number;
  partido?: string;
  candidato?: string;
}

/** Ponto municipal já com o valor do indicador e a escala (x) usada no cálculo. */
export interface AnalysisPoint extends CrossingPoint {
  indicador: number;
  x: number;
}

interface AnalysisStats {
  n: number;
  media: number;
  mediana: number;
  desvioPadrao: number;
  variancia: number;
  coeficienteVariacao: number;
  minimo: number;
  maximo: number;
  q1: number;
  q3: number;
  amplitude: number;
  /** Intervalo interquartil (Q3 − Q1): metade central dos municípios. */
  iqr: number;
  /** Municípios fora de [Q1 − 1,5·IQR, Q3 + 1,5·IQR] no % de votos. */
  outliers: number;
  r: number;
  r2: number;
  /** Correlação de postos (monotônica, robusta a outliers e a escala). */
  spearman: number | null;
  /** IC 95% de r via transformada z de Fisher (aproximação, n > 3). */
  rLower: number | null;
  rUpper: number | null;
  /** Classificação didática da força: desprezível/fraca/moderada/forte/muito forte. */
  forca: string;
  slope: number;
  intercept: number;
  /** Erro-padrão residual (RMSE) da reta ajustada, em p.p. */
  rmse: number;
  p: number;
  skewness: number;
  kurtosis: number;
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
  private readonly api: EleicaoApiService = inject(EleicaoApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild('municipalMap') private mapElement?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private mapLayer?: L.GeoJSON;
  private mapUf = '';
  /** UF já enquadrada no viewport; serve para reenquadrar ao trocar de estado. */
  private mapFittedUf = '';
  /** Enquadramento adiado porque o painel do mapa estava oculto na hora. */
  private mapFitPending = false;
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

  readonly anos: readonly number[] = ELEICAO_ANOS;
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
  /** Marcadores de carregamento do catálogo, usados nos placeholders das seleções. */
  readonly carregandoCargos = computed(() => this.loadingCatalog());
  readonly carregandoTurnos = computed(() => this.loadingCatalog());
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
    const rampa = this.rampaPartido();
    return rampa[Math.min(rampa.length - 1, index % rampa.length)];
  }

  /** Sigla que colore a análise: partido direto ou partido do candidato. */
  readonly siglaColorida = computed(() => {
    const data = this.result();
    if (this.modoAnalise === 'partido') return data?.alvo.nome ?? this.partido ?? null;
    return data?.alvo.partido ?? null;
  });



  /** Rampa claro → cor do partido p/ mapa, dispersão e barras por faixa. */
  readonly rampaPartido = computed(() => partidoRampa(this.siglaColorida(), 5));

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

  /**
   * Espelho do candidato selecionado (nome/partido/votos), mantido mesmo quando
   * o filtro de busca o tira da lista: assim o <select> continua exibindo quem
   * está analisado em vez de voltar ao placeholder vazio.
   */
  private candidatoSnapshot: CrossingCandidate | null = null;

  /** Estado lido da URL compartilhada, aplicado quando o catálogo responder. */
  private restauracaoUrl: RestauracaoUrl | null = null;

  ngOnInit(): void {
    this.restaurarEstadoDaUrl();
    this.carregarCatalogo();
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

  /**
   * Restaura o estado da URL (?ano=&uf=&cargo=&turno=&partido=&candidato=&...)
   * para que análises possam ser compartilhadas. Valores inválidos caem nos
   * padrões; cargo/turno/partido/candidato são aplicados em aplicarCatalogo,
   * pois dependem do catálogo do TSE.
   */
  private restaurarEstadoDaUrl(): void {
    const params = this.route.snapshot.queryParamMap;

    const ano = Number(params.get('ano'));
    if (params.get('ano') && this.anos.includes(ano)) this.ano = ano;

    const uf = (params.get('uf') ?? '').toUpperCase();
    if (uf && this.ufs.includes(uf)) this.uf = uf;

    const indicador = params.get('indicador');
    if (indicador && this.indicadores.some((option) => option.key === indicador)) {
      this.indicador = indicador;
    }

    const modo = params.get('modo');
    if (modo === 'partido' || modo === 'candidato') this.modoAnalise = modo;

    const vis = params.get('vis');
    if (vis === 'overview' || vis === 'scatter' || vis === 'map' || vis === 'patterns') {
      this.activeView.set(vis);
    }

    this.logScale.set(params.get('escala') === 'log');

    const turnoStr = params.get('turno');
    const turno = turnoStr ? Number(turnoStr) : NaN;
    this.restauracaoUrl = {
      cargo: params.get('cargo') ?? undefined,
      turno: Number.isInteger(turno) ? turno : undefined,
      partido: params.get('partido') ?? undefined,
      candidato: params.get('candidato') ?? undefined,
    };
  }

  /** Mantém a URL em espelho com o estado atual (replaceUrl: sem poluir o histórico). */
  private persistirUrl(): void {
    const candidato = this.modoAnalise === 'candidato' && this.candidato ? this.candidato : null;
    const partido = this.partido && this.partido !== 'TODOS' ? this.partido : null;

    void this.router.navigate([], {
      replaceUrl: true,
      queryParams: {
        ano: this.ano,
        uf: this.uf,
        cargo: this.cargo || null,
        turno: this.turno ?? null,
        modo: this.modoAnalise,
        partido: this.modoAnalise === 'partido' ? partido : null,
        candidato,
        indicador: this.indicador,
        vis: this.activeView(),
        escala: this.logScale() ? 'log' : null,
      },
    });
  }

  partidosDisponiveis(): CrossingParty[] {
    return this.parties().filter((party) =>
      (!this.cargo || party.cargo === this.cargo) &&
      (this.turno == null || party.turno === this.turno) &&
      party.sigla,
    );
  }

  mudarModoAnalise(): void {
    this.candidatoFiltro = '';
    this.candidateRequest?.unsubscribe();
    this.candidateLoadId += 1;
    this.loadingCandidates.set(false);
    this.partido = this.modoAnalise === 'partido' ? '' : 'TODOS';
    this.candidato = '';
    this.candidatoSnapshot = null;
    this.candidateOptions.set([]);
    this.availableCandidateCount.set(0);
    this.result.set(null);
    // Completa cargo/turno com o padrão do catálogo para não travar a troca de modo.
    if (!this.cargo || !this.cargos().includes(this.cargo)) this.cargo = this.cargos()[0] ?? '';
    if (this.turno == null || !this.turnos().includes(this.turno)) this.turno = this.turnos()[0] ?? null;
    this.atualizarOpcoesSelecao();
    if (this.modoAnalise === 'candidato' && this.cargo && this.turno != null) {
      this.carregarOpcoesCandidatos();
    } else {
      this.carregarCruzamento();
    }
    this.persistirUrl();
  }

  mudarPartido(): void {
    this.candidatoFiltro = '';
    this.candidato = '';
    this.candidatoSnapshot = null;
    this.result.set(null);
    // A sigla já foi atualizada pelo ngModel: espelha na URL antes dos retornos.
    this.persistirUrl();
    // Não refiltra partyOptions aqui: o select já reflete o catálogo; refiltrar esvaziaria
    // a lista no modo partido quando cargo/turno ainda estão vazios.
    // No modo candidato, trocar o partido recarrega a lista (sem travar quem já estava escolhido).
    if (this.modoAnalise === 'candidato' && this.cargo && this.turno != null) {
      this.carregarOpcoesCandidatos();
      return;
    }
    if (this.modoAnalise === 'partido') {
      this.carregarCruzamento();
      return;
    }
    if (this.activeView() === 'map') this.renderMap();
  }

  mudarCandidato(): void {
    // Registra quem foi escolhido (para o select não sumir se o filtro mudar).
    const escolhido = this.candidateOptions().find((c) => c.sqCandidato === this.candidato);
    if (escolhido) this.candidatoSnapshot = escolhido;
    this.carregarCruzamento();
    this.persistirUrl();
  }

  /** Aplica o candidato clicado no chip da lista de espera (ou na lista principal). */
  selecionarCandidato(sqCandidato: string): void {
    this.candidato = sqCandidato;
    this.mudarCandidato();
  }

  /** Escala do gráfico (linear/log) — também fica na URL para compartilhar. */
  mudarEscala(escalaLog: boolean): void {
    this.logScale.set(escalaLog);
    this.persistirUrl();
  }

  filtrarCandidatos(): void {
    // Não limpa o resultado atual: digitar no filtro só atualiza a lista de
    // opções; a análise em tela permanece até o usuário trocar de candidato.
    this.carregarOpcoesCandidatos(true);
  }

  carregarCatalogo(): void {
    this.catalogRequest?.unsubscribe();
    this.candidateRequest?.unsubscribe();
    this.crossingRequest?.unsubscribe();
    // Foco imediato no estado/abrangência escolhido, sem esperar (nem depender) do catálogo do TSE.
    this.carregarMalha();
    this.persistirUrl();
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
    this.candidatoSnapshot = null;
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
    const restaurado = this.restauracaoUrl;
    this.restauracaoUrl = null;

    // Sem travas: pré-seleciona o primeiro cargo/turno do catálogo — mas o que
    // veio na URL compartilhada vale, quando ainda existe neste catálogo.
    this.cargo =
      restaurado?.cargo && catalog.cargos.includes(restaurado.cargo)
        ? restaurado.cargo
        : catalog.cargos[0] ?? '';
    this.turno =
      restaurado?.turno != null && catalog.turnos.includes(restaurado.turno)
        ? restaurado.turno
        : catalog.turnos[0] ?? null;
    const partidoRestaurado =
      restaurado?.partido &&
      catalog.partidos.some(
        (party) =>
          party.sigla === restaurado.partido &&
          party.cargo === this.cargo &&
          party.turno === this.turno,
      )
        ? restaurado.partido
        : undefined;
    this.partido = this.modoAnalise === 'partido' ? (partidoRestaurado ?? '') : 'TODOS';
    // O candidato da URL é validado contra a lista ao chegar (aplicarOpcoesCandidatos).
    this.candidato = this.modoAnalise === 'candidato' ? (restaurado?.candidato ?? '') : '';
    this.candidatoSnapshot = null;
    this.hasLoadedCatalog.set(true);
    this.atualizarOpcoesSelecao();
    this.candidateOptions.set([]);
    this.availableCandidateCount.set(0);
    this.result.set(null);
    if (this.modoAnalise === 'candidato' && this.cargo && this.turno != null) {
      this.carregarOpcoesCandidatos();
    } else if (this.modoAnalise === 'partido' && this.partido) {
      // Análise por partido vinda de link compartilhado: carrega direto.
      this.carregarCruzamento();
    }
    this.persistirUrl();
  }

  filtrosMudaram(): void {
    this.result.set(null);
    this.candidatoFiltro = '';
    this.candidateRequest?.unsubscribe();
    this.candidateLoadId += 1;
    this.loadingCandidates.set(false);
    // Sem trava: completa com o primeiro cargo/turno do catálogo quando a seleção ficou vazia.
    if (!this.cargo || !this.cargos().includes(this.cargo)) this.cargo = this.cargos()[0] ?? '';
    if (this.turno == null || !this.turnos().includes(this.turno)) this.turno = this.turnos()[0] ?? null;
    this.atualizarOpcoesSelecao();
    // Se o partido selecionado não existe neste cargo/turno, reseta sem esvaziar a lista.
    if (this.modoAnalise === 'partido' && this.partido &&
        !this.partyOptions().some((p) => p.sigla === this.partido)) {
      this.partido = '';
    }
    if (this.modoAnalise === 'candidato') {
      // Cargo/turno mudaram: o sqCandidato anterior pertence a outra lista e
      // não deve sobreviver (senão a análise ficaria com alvo de outro cargo).
      this.candidato = '';
      this.candidatoSnapshot = null;
      this.carregarOpcoesCandidatos();
    } else {
      this.candidateOptions.set([]);
      this.availableCandidateCount.set(0);
      this.carregarCruzamento();
    }
    // Mesmo vazio, a malha reage à UF/abrangência; o overlay só aparece com análise.
    if (!this.mapData() || this.mapUf !== this.uf) this.carregarMalha();
    else if (this.activeView() === 'map') this.renderMap();
    this.persistirUrl();
  }

  carregarCruzamento(): void {
    this.crossingRequest?.unsubscribe();
    const requestId = ++this.crossingLoadId;
    // Sem preencher candidato por default: a lista só se aplica quando o usuário seleciona.
    if (!this.cargo || !this.cargos().includes(this.cargo)) this.cargo = this.cargos()[0] ?? '';
    if (this.turno == null || !this.turnos().includes(this.turno)) this.turno = this.turnos()[0] ?? null;
    const target = this.modoAnalise === 'partido' ? this.partido : this.candidato;
    if (!this.cargo || this.turno == null || !target) {
      this.result.set(null);
      this.loadingResult.set(false);
      return;
    }
    // Reflete na URL o alvo efetivamente usado (inclusive o pré-selecionado).
    this.persistirUrl();
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
          this.espelharCandidatoAnalisado(result);
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
    const nome = this.nomeIndicador().toLowerCase();
    const direcao = summary.r > 0 ? 'maiores' : 'menores';
    const forca = summary.forca;
    const base = Math.abs(summary.r) < 0.1
      ? `neste recorte, ${nome} quase não acompanha o percentual de votos (associação ${forca}).`
      : `neste recorte, valores maiores de ${nome} tendem a acompanhar percentuais ${direcao} de votos (associação ${forca}, r ${formatR(summary.r)}).`;
    const robustez = summary.spearman == null
      ? ''
      : Math.abs(summary.spearman - summary.r) > 0.15
        ? ' A diferença entre Pearson e Spearman sugere que poucos municípios atípicos ou a escala do indicador pesam no resultado — vale olhar o gráfico.'
        : ' Pearson e Spearman concordam, então o padrão não depende só de poucos municípios atípicos.';
    return `Leitura simples: ${base}${robustez} É uma associação entre municípios, não uma explicação do voto de cada pessoa.`;
  }

  /** Frase-guia da dispersão: força, direção e incerteza em linguagem simples. */
  readonly resumoDispersao = computed(() => {
    const summary = this.stats();
    if (!summary) return '';
    const ic = summary.rLower != null && summary.rUpper != null
      ? ` (margem aproximada de ${formatR(summary.rLower)} a ${formatR(summary.rUpper)}).`
      : '.';
    return `Associação ${summary.forca} ${summary.r >= 0 ? 'positiva' : 'negativa'}${ic} Cada ponto é um município; a reta mostra a tendência geral.`;
  });

  /** Resumo em linguagem simples: o que os números dizem, sem jargão. */
  readonly resumoPlano = computed(() => {
    const summary = this.stats();
    if (!summary) return '';
    const alvo = this.result()?.alvo.nome ?? 'o alvo';
    const indicador = this.nomeIndicador().toLowerCase();
    const direcao = summary.r >= 0 ? 'sobe junto' : 'cai quando o outro sobe';
    return `Em ${summary.n} municípios, ${indicador} e o voto em ${alvo} ${direcao} com força ${summary.forca} (r ${formatR(summary.r)}). A metade central votou entre ${fmtPct(summary.q1)} e ${fmtPct(summary.q3)}; ${summary.outliers === 0 ? 'nenhum município destoou do padrão' : summary.outliers + ' ' + (summary.outliers === 1 ? 'município destoou' : 'municípios destoaram') + ' do padrão'}. É associação entre municípios, não causa nem voto individual.`;
  });

  /** Cor oficial da sigla para a borda do selo (contorno, sem chapado). */
  partidoCor(sigla: string | null | undefined): string {
    return sigla ? partidoColor(sigla).primary : 'transparent';
  }

  /** Texto do selo em contorno: variante escura da sigla, legível sobre fundo claro. */
  partidoContorno(sigla: string | null | undefined): string {
    return sigla ? partidoColor(sigla).dark : 'var(--color-text)';
  }

  /** Texto legível sobre a cor do partido (contraste automático, uso em fundos chapados). */
  partidoTexto(sigla: string | null | undefined): string {
    return sigla ? partidoTextoSobre(sigla) : 'var(--color-text)';
  }

  /** Rótulo simples da assimetria: para onde pende a cauda. */
  rotuloAssimetria(valor: number): string {
    if (!Number.isFinite(valor)) return 'indefinida';
    if (valor > 0.5) return 'cauda à direita (poucos municípios bem acima)';
    if (valor < -0.5) return 'cauda à esquerda (poucos municípios bem abaixo)';
    return 'aprox. simétrica';
  }

  /** Rótulo simples da curtose: pico e caudas vs. distribuição normal. */
  rotuloCurtose(valor: number): string {
    if (!Number.isFinite(valor)) return 'indefinida';
    if (valor > 0.5) return 'pico alto e caudas pesadas';
    if (valor < -0.5) return 'achatada, sem pico marcado';
    return 'próxima do normal';
  }

  selecionarFator(key: string): void {
    this.indicador = key;
    this.selecionarIndicador();
    this.activeView.set('scatter');
  }

  selecionarIndicador(): void {
    const data = this.result();
    this.persistirUrl();
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
    this.persistirUrl();
    if (view !== 'map') return;
    if (!this.mapData() || this.mapUf !== this.uf) {
      this.carregarMalha();
      return;
    }
    // Espera o Angular tornar o painel visível para enquadrar o estado e medir o container.
    requestAnimationFrame(() => {
      this.renderMap();
      requestAnimationFrame(() => this.map?.invalidateSize());
    });
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
    // Rampa claro → cor do partido quando há sigla; senão, rampa neutra azul.
    const palette = this.siglaColorida() ? this.rampaPartido() : NEUTRAL_RAMP;
    return palette[Math.min(palette.length - 1, Math.floor(percentile * palette.length))];
  }

  /** Cor de um ponto da dispersão: usa a mesma rampa do mapa (posição do indicador). */
  corPontoDispersao(value: number | undefined): string {
    return this.corIndicador(value);
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
    return `${this.formatarFaixaLegenda(values[start])}–${this.formatarFaixaLegenda(values[end])}`;
  }

  /**
   * Escreve o valor por extenso, com separadores do pt-BR (ex.: 1.230.000),
   * sem notação científica (`1.23e+7`) e sem sufixos abreviados.
   */
  private formatarFaixaLegenda(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('pt-BR', { maximumSignificantDigits: 3 });
  }

  private atualizarOpcoesSelecao(): void {
    this.partyOptions.set(this.partidosDisponiveis());
  }

  /** Primeiros 3 candidatos por votação, para facilitar o preenchimento sem digitação. */
  topCandidates(): CrossingCandidate[] {
    // Espelho do alvo analisado (votos 0) não deve aparecer como sugestão.
    return this.candidateOptions().filter((candidate) => candidate.votos > 0).slice(0, 3);
  }

  private carregarOpcoesCandidatos(debounce = false): void {
    this.candidateRequest?.unsubscribe();
    this.crossingRequest?.unsubscribe();
    this.crossingLoadId += 1;
    this.loadingResult.set(false);
    const requestId = ++this.candidateLoadId;
    this.error.set(null);
    const busca = this.candidatoFiltro.trim();
    // Redundante com os demais fluxos, mas garante padrão mesmo por caminho indireto.
    if (!this.cargo || !this.cargos().includes(this.cargo)) this.cargo = this.cargos()[0] ?? '';
    if (this.turno == null || !this.turnos().includes(this.turno)) this.turno = this.turnos()[0] ?? null;
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
    const items = [...response.items];
    // Alvo analisado fora da lista visível (busca estreita ou fora dos 100 mais):
    // injeta o espelho no topo para o select seguir exibindo quem está em análise.
    if (
      this.candidato &&
      this.candidatoSnapshot?.sqCandidato === this.candidato &&
      !items.some((candidate) => candidate.sqCandidato === this.candidato)
    ) {
      items.unshift(this.candidatoSnapshot);
    }
    this.candidateOptions.set(items);
    // `total` é o universo no servidor; com items.length o aviso
    // "Exibindo os 100 mais…" nunca era atingido.
    this.availableCandidateCount.set(response.total);
    // Sem travas: o candidato só muda quando o usuário seleciona; o mapa não vaza
    // um alvo por default.
    if (this.candidato) {
      this.carregarCruzamento();
      return;
    }
    this.result.set(null);
    if (this.activeView() === 'map') this.renderMap();
  }

  /**
   * Garante que o <select> de candidato exiba o alvo recém-analisado, mesmo
   * quando ele não veio da lista (deep-link `?candidato=<sq>`): preenche o
   * espelho com o nome/partido confirmados pela própria resposta do cruzamento.
   */
  private espelharCandidatoAnalisado(result: CrossingResultResponse): void {
    if (this.modoAnalise !== 'candidato' || result.alvo.tipo !== 'candidato' || !this.candidato) {
      return;
    }
    const conhecido = this.candidatoSnapshot?.sqCandidato === this.candidato;
    const snapshot: CrossingCandidate = {
      cargo: result.cargo,
      turno: result.turno,
      sqCandidato: this.candidato,
      nome: result.alvo.nome,
      partido: result.alvo.partido ?? '',
      // Votos só existem quando o candidato veio da lista; 0 esconde o sufixo.
      votos: conhecido ? this.candidatoSnapshot!.votos : 0,
    };
    this.candidatoSnapshot = snapshot;
    if (!this.candidateOptions().some((candidate) => candidate.sqCandidato === snapshot.sqCandidato)) {
      this.candidateOptions.update((options) => [snapshot, ...options]);
    }
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
        next: (featureCollection: MunicipalMapResponse) => {
          this.mapData.set(featureCollection);
          this.mapUf = uf;
          requestAnimationFrame(() => this.renderMap());
        },
        error: (error: { error?: { error?: string } }) => this.mapError.set(error?.error?.error ?? 'Não foi possível carregar a malha municipal do IBGE.'),
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

    let recreated = false;
    if (!this.map) {
      this.map = L.map(element, { scrollWheelZoom: false, zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
      recreated = true;
    }
    this.mapLayer?.remove();
    const pointByCode = new Map((result?.pontos ?? []).map((point) => [point.codigoIbge, point]));
    const indicadorUnidade = result?.indicador.unidade ?? '';
    this.mapLayer = L.geoJSON(featureCollection as GeoJSON.GeoJsonObject, {
      style: (feature) => {
        const code = String(feature?.properties?.['codarea'] ?? '');
        const point = pointByCode.get(code);
        // Partido direto ou partido do candidato: a rampa do mapa segue a sigla.
        const sigla = this.siglaColorida();
        const estiloPartido = sigla ? partidoColor(sigla) : null;
        // Intensidade pelo % de votos (0–100): quanto maior a votação, mais cheia a cor.
        const rampa = sigla ? partidoRampa(sigla, 5) : null;
        const passo = point ? Math.min(4, Math.floor((point.percentualVotos / 100) * 5)) : -1;
        const fillColor = estiloPartido && rampa && point
          ? rampa[passo]
          : this.corIndicador(point?.indicador);
        return {
          color: '#f4f5f7',
          weight: 0.45,
          fillColor,
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
    // Enquadra no estado/abrangência atual: ao trocar de UF, ao recriar o mapa ou quando
    // o fit anterior foi adiado (painel oculto). Não reenquadra a cada troca de indicador
    // para preservar o zoom/pan feitos pelo usuário.
    const needsFit = recreated || this.mapFittedUf !== this.mapUf || this.mapFitPending;
    const hidden = element.offsetParent === null || element.clientHeight === 0;
    if (bounds.isValid() && needsFit) {
      if (hidden) {
        this.mapFitPending = true;
      } else {
        this.map.fitBounds(bounds, { padding: [8, 8] });
        this.mapFittedUf = this.mapUf;
        this.mapFitPending = false;
      }
    }
    requestAnimationFrame(() => this.map?.invalidateSize());
  }
}

/** Exportada para testes: é a base de r, R² e p-valor exibidos na tela. */
export function calculateStats(points: AnalysisPoint[]): AnalysisStats | null {
  if (points.length < 3) return null;
  const n = points.length;
  const votos = points.map((point) => point.percentualVotos);
  const sortedVotos = [...votos].sort((a, b) => a - b);
  const quantile = (p: number): number => {
    const index = p * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedVotos[lower];
    const weight = index - lower;
    return sortedVotos[lower] * (1 - weight) + sortedVotos[upper] * weight;
  };
  const min = sortedVotos[0];
  const max = sortedVotos[n - 1];
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const mediana = quantile(0.5);
  const mean = votos.reduce((sum, value) => sum + value, 0) / n;
  const meanY = mean;
  const squaredDiffs = votos.map((value) => (value - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / (n - 1);
  const desvioPadrao = Math.sqrt(variance);
  const coeficienteVariacao = mean !== 0 ? (desvioPadrao / Math.abs(mean)) * 100 : NaN;
  const amplitude = max - min;
  const iqr = q3 - q1;
  // Regra de Tukey (1,5 × IQR) sobre o % de votos: conta municípios atípicos.
  const cercaInferior = q1 - 1.5 * iqr;
  const cercaSuperior = q3 + 1.5 * iqr;
  const outliers = votos.filter((value) => value < cercaInferior || value > cercaSuperior).length;

  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.percentualVotos - meanY;
    sumXX += dx * dx;
    sumYY += dy * dy;
    sumXY += dx * dy;
  }

  let skewNum = 0;
  let kurtNum = 0;
  for (const point of points) {
    const dy = point.percentualVotos - meanY;
    skewNum += Math.pow(dy / desvioPadrao, 3);
    kurtNum += Math.pow(dy / desvioPadrao, 4);
  }
  const skewness = n * skewNum / ((n - 1) * (n - 2));
  const kurtosis = (n * (n + 1) * kurtNum) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));

  if (!sumXX || !sumYY) return null;
  const r = sumXY / Math.sqrt(sumXX * sumYY);
  const degreesOfFreedom = n - 2;
  const tSquared = (r * r * degreesOfFreedom) / Math.max(Number.EPSILON, 1 - r * r);
  const p = r === 1 || r === -1 ? 0 : regularizedBeta(degreesOfFreedom / (degreesOfFreedom + tSquared), degreesOfFreedom / 2, 0.5);
  const slope = sumXY / sumXX;
  const intercept = meanY - slope * meanX;
  // Spearman = Pearson sobre os postos (médios em empates): capta relação
  // monotônica mesmo quando a escala do indicador é não-linear (ex.: log).
  const spearman = correcaoPostos(points.map((point) => point.x), points.map((point) => point.percentualVotos));
  // IC 95% de r via z de Fisher: z ± 1,96/√(n−3), depois tanh de volta.
  let rLower: number | null = null;
  let rUpper: number | null = null;
  const absR = Math.min(1, Math.abs(r));
  if (n > 3 && absR < 1) {
    const z = 0.5 * Math.log((1 + r) / Math.max(Number.EPSILON, 1 - r));
    const erro = 1.96 / Math.sqrt(n - 3);
    rLower = Math.tanh(z - erro);
    rUpper = Math.tanh(z + erro);
  }
  const forca = classificaForca(r);
  // RMSE da reta: dispersão típica dos municípios em torno da tendência.
  const rmse = Math.sqrt(
    points.reduce((sum, point) => sum + (point.percentualVotos - (intercept + slope * point.x)) ** 2, 0) / n,
  );
  return {
    n,
    media: mean,
    mediana,
    desvioPadrao,
    variancia: variance,
    coeficienteVariacao,
    minimo: min,
    maximo: max,
    q1,
    q3,
    amplitude,
    iqr,
    outliers,
    r,
    r2: r * r,
    spearman,
    rLower,
    rUpper,
    forca,
    slope,
    intercept,
    rmse,
    p,
    skewness,
    kurtosis,
  };
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

/** Exportada para testes: agrupa os municípios em cinco faixas do indicador. */
export function createQuintiles(points: AnalysisPoint[]): { label: string; position: string; range: string; count: number; mean: number }[] {
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
  /** Geometria da área de plotagem: o template vincula eixos/grades a estes valores. */
  plot: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  /** Posições de rótulos derivadas da geometria (evita números mágicos no HTML). */
  labels: { yAxisX: number; xAxisY: number };
}

const BAR_CHART_SVG = { width: 720, height: 400 } as const;
// Margens com respiro: esquerda p/ rótulos do eixo Y, topo p/ valores das barras,
// base p/ "Faixa N". Sem título interno no SVG (o <h2> do painel já titula).
const BAR_CHART_PADDING = { left: 56, right: 16, top: 36, bottom: 48 } as const;

/** Rampa neutra (azul) quando não há sigla para colorir a análise. */
const NEUTRAL_RAMP = ['#e6f0f8', '#bed5e6', '#87afcc', '#4e86aa', '#1e5273'] as const;

/** Exportada para testes: monta o gráfico de média por faixa do indicador. */
export function createBarChart(points: AnalysisPoint[]): BarChartPlan {
  const emptyPlot = {
    left: BAR_CHART_PADDING.left,
    right: BAR_CHART_SVG.width - BAR_CHART_PADDING.right,
    top: BAR_CHART_PADDING.top,
    bottom: BAR_CHART_SVG.height - BAR_CHART_PADDING.bottom,
    width: BAR_CHART_SVG.width - BAR_CHART_PADDING.left - BAR_CHART_PADDING.right,
    height: BAR_CHART_SVG.height - BAR_CHART_PADDING.top - BAR_CHART_PADDING.bottom,
  };
  const emptyLabels = { yAxisX: BAR_CHART_PADDING.left - 8, xAxisY: BAR_CHART_SVG.height - 10 };
  const groups = createQuintiles(points);
  if (!groups.length) {
    return { bars: [], yMax: 1, gridlines: [], overallMeanValue: 0, overallMeanY: 0, xLabels: [], plot: emptyPlot, labels: emptyLabels };
  }

  // Teto "bonito" do eixo Y com ~15% de respiro: rótulos de valor nunca colidem
  // com o topo nem com o título, qualquer que seja a ordem de grandeza.
  const rawMax = Math.max(1, ...groups.map((group) => group.mean));
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const normalized = rawMax / magnitude;
  const niceCeil = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const yMax = niceCeil * 1.15;
  const overallMean =
    points.reduce((sum, point) => sum + point.percentualVotos, 0) / points.length;
  const xLabels = groups.map((group) => group.label);

  const plotLeft = BAR_CHART_PADDING.left;
  const plotRight = BAR_CHART_SVG.width - BAR_CHART_PADDING.right;
  const plotTop = BAR_CHART_PADDING.top;
  const plotBottom = BAR_CHART_SVG.height - BAR_CHART_PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const groupWidth = plotWidth / groups.length;
  // Largura com mínimo e máximo: legível no desktop, sem estourar no mobile.
  const barWidth = Math.min(groupWidth * 0.62, Math.max(28, groupWidth * 0.48));

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

  return {
    bars,
    yMax,
    gridlines,
    overallMeanValue: overallMean,
    overallMeanY,
    xLabels,
    plot: { left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom, width: plotWidth, height: plotHeight },
    labels: { yAxisX: plotLeft - 8, xAxisY: BAR_CHART_SVG.height - 10 },
  };
}

/** Classificação didática da força da associação linear (|r|). */
export function classificaForca(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.1) return 'desprezível';
  if (abs < 0.3) return 'fraca';
  if (abs < 0.5) return 'moderada';
  if (abs < 0.7) return 'forte';
  return 'muito forte';
}

/** Postos médios (empates dividem a posição): base do Spearman. */
function postosMedios(values: number[]): number[] {
  const ordem = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < ordem.length) {
    let j = i;
    while (j + 1 < ordem.length && ordem[j + 1].value === ordem[i].value) j++;
    const medio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[ordem[k].index] = medio;
    i = j + 1;
  }
  return ranks;
}

/** Spearman (Pearson sobre postos); null quando algum lado é constante. */
export function correcaoPostos(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = postosMedios(xs);
  const ry = postosMedios(ys);
  const n = xs.length;
  const mediaX = rx.reduce((s, v) => s + v, 0) / n;
  const mediaY = ry.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mediaX;
    const dy = ry[i] - mediaY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function formatIndicator(value: number): string {
  return value.toLocaleString('pt-BR', { maximumSignificantDigits: 4 });
}

/** Formata correlações com sinal e 2 casas (ex.: +0,42). */
function formatR(value: number): string {
  const sinal = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sinal}${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function logGamma(value: number): number {
  const coefficients = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = value;
  let temp = value + 5.5;
  temp -= (value + 0.5) * Math.log(temp);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) series += coefficient / ++x;
  return -temp + Math.log(2.5066282746310007 * series / value);
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

/** Percentual com 2 casas em pt-BR (resumo simples). */
function fmtPct(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}