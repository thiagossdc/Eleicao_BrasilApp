import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';
import { BRAZIL_UFS } from '../../core/constants/brazil-ufs';
import { ELEICAO_ANOS } from '../../core/constants/eleicao-years';
import type { CandidateListItem, DatasetStats } from '../../core/models/candidate.models';
import { partidoColor, partidoTextoSobre } from '../../core/constants/colors';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';

/** Traduz os códigos de situação do TSE para texto compreensível na tela. */
const SITUACOES_TSE: Record<string, string> = {
  APTO: 'APTO — pode concorrer',
  INAPTO: 'INAPTO — não pode concorrer',
  '#NE': '#NE — não eleito(a) nesta eleição',
};

@Component({
  selector: 'app-consulta-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './consulta.page.html',
  styleUrl: './consulta.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsultaPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(EleicaoApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Dispara buscas automáticas agrupadas enquanto o usuário ajusta os filtros. */
  private readonly filtroAlterado = new Subject<void>();
  // Debounce agrupa teclas/alterações seguidas; sem distinctUntilChanged porque
  // o payload void faria o RxJS descartar toda emissão após a primeira.
  private readonly filtroSubscription = this.filtroAlterado
    .pipe(debounceTime(300))
    .subscribe(() => this.buscar());

  readonly ufs = BRAZIL_UFS;
  /** Mesmo catálogo das demais telas: o que se sincroniza é o que se consulta. */
  readonly anosEleicao: readonly number[] = ELEICAO_ANOS;

  /** Linhas por página; a paginação existe porque a API devolve no máximo 100. */
  readonly pageSize = 50;

  filtroNome = '';
  filtroUf = '';
  filtroAno: number | null = 2022;
  apenasRisco = false;

  filtroCargo = '';
  filtroPartido = '';

  readonly cargos = signal<string[]>([]);
  readonly partidos = signal<{ sigla: string; nome: string }[]>([]);

  readonly stats = signal<Pick<DatasetStats, 'totalCandidatos' | 'totalRegistrosCassacao'> | null>(null);
  readonly statsLoading = signal(true);
  readonly statsError = signal<string | null>(null);
  readonly items = signal<CandidateListItem[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<CandidateListItem | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly cassacoes = signal<
    { nrProcesso: string | null; tipoMotivo: string | null; motivo: string | null }[]
  >([]);
  readonly hasSearched = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));

  /** "Exibindo 1–50 de 3.655 resultado(s)" — deixa claro que há mais páginas. */
  readonly resumoPaginacao = computed(() => {
    const total = this.total();
    if (!total) return '0 resultados';
    const inicio = this.pagina() * this.pageSize + 1;
    const fim = Math.min(total, (this.pagina() + 1) * this.pageSize);
    return `Exibindo ${inicio}–${fim} de ${total} resultado(s)`;
  });

  ngOnInit(): void {
    const veioDaUrl = this.restaurarEstadoDaUrl();

    this.api.getStats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.statsError.set(null);
        this.statsLoading.set(false);
      },
      error: () => {
        this.statsError.set('Não foi possível carregar o resumo da base. Tente atualizar a página.');
        this.statsLoading.set(false);
      },
    });

    this.api.getCandidateFilters().subscribe({
      next: (filters) => {
        this.cargos.set(filters.cargos ?? []);
        this.partidos.set(filters.partidos ?? []);
      },
      error: () => {
        // O filtro continua funcional mesmo se as opções não carregarem.
      },
    });

    // Link compartilhado já abre com os resultados carregados.
    if (veioDaUrl) this.buscar();
  }

  ngOnDestroy(): void {
    this.filtroSubscription.unsubscribe();
  }

  /**
   * Restaura os filtros da URL (?q=&uf=&ano=&cargo=&partido=&risk=1).
   * @returns true quando a URL trazia ao menos um filtro (merece busca inicial).
   */
  private restaurarEstadoDaUrl(): boolean {
    const params = this.route.snapshot.queryParamMap;

    const q = params.get('q');
    if (q) this.filtroNome = q;

    const uf = (params.get('uf') ?? '').toUpperCase();
    if (uf) this.filtroUf = uf;

    const anoRaw = params.get('ano');
    const ano = Number(anoRaw);
    if (anoRaw && this.anosEleicao.includes(ano)) this.filtroAno = ano;

    const cargo = params.get('cargo');
    if (cargo) this.filtroCargo = cargo;

    const partido = params.get('partido');
    if (partido) this.filtroPartido = partido;

    this.apenasRisco = params.get('risk') === '1';

    return Boolean(q || uf || anoRaw || cargo || partido || this.apenasRisco);
  }

  /** Mantém a URL em espelho com os filtros (replaceUrl: sem poluir o histórico). */
  private persistirUrl(): void {
    void this.router.navigate([], {
      replaceUrl: true,
      queryParams: {
        q: this.filtroNome.trim() || null,
        uf: this.filtroUf || null,
        ano: this.filtroAno,
        cargo: this.filtroCargo || null,
        partido: this.filtroPartido || null,
        risk: this.apenasRisco ? '1' : null,
      },
    });
  }

  /** Chamado a cada alteração de filtro (com debounce agrupado de 300 ms). */
  agendarBusca(): void {
    this.filtroAlterado.next();
  }


  /** Busca pela ação explícita do usuário (botão, Enter ou checkbox). */
  buscar(): void {
    this.pagina.set(0);
    this.persistirUrl();
    this.executarBusca();
  }

  irParaPagina(pagina: number): void {
    const alvo = Math.min(Math.max(pagina, 0), this.totalPages() - 1);
    if (alvo === this.pagina()) return;
    this.pagina.set(alvo);
    this.selected.set(null);
    this.cassacoes.set([]);
    this.executarBusca();
  }

  private executarBusca(): void {
    this.hasSearched.set(true);
    this.error.set(null);
    this.selected.set(null);
    this.cassacoes.set([]);
    this.loading.set(true);

    this.api
      .searchCandidates({
        q: this.filtroNome || undefined,
        uf: this.filtroUf || undefined,
        cargo: this.filtroCargo || undefined,
        partido: this.filtroPartido || undefined,
        ano: this.filtroAno ?? undefined,
        onlyRisk: this.apenasRisco,
        limit: this.pageSize,
        offset: this.pagina() * this.pageSize,
      })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.total.set(res.total);
        },
        error: (err) => {
          this.items.set([]);
          this.total.set(0);
          this.error.set(err?.error?.error ?? 'Não foi possível carregar os candidatos.');
        },
      });
  }

  selecionar(row: CandidateListItem): void {
    this.selected.set(row);
    this.detailError.set(null);
    this.detailLoading.set(true);
    this.cassacoes.set([]);

    this.api
      .getCandidateDetail(row.sqCandidato, row.uf, row.anoEleicao)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (d) => {
          this.selected.set(d.candidate);
          this.cassacoes.set(d.cassacoes);
        },
        error: (err) => {
          this.detailError.set(err?.error?.error ?? 'Detalhe indisponível.');
        },
      });
  }

  fecharDetalhe(): void {
    this.selected.set(null);
    this.cassacoes.set([]);
    this.detailError.set(null);
  }

  /** Cor oficial da sigla para a borda do selo (contorno, sem chapado). */
  partidoCor(sigla: string | null | undefined): string {
    return sigla ? partidoColor(sigla).primary : 'transparent';
  }

  /** Texto do selo em contorno: variante escura da sigla, legível sobre fundo claro. */
  partidoContorno(sigla: string | null | undefined): string {
    return sigla ? partidoColor(sigla).dark : 'var(--color-text)';
  }

  /** Cor do texto sobre a célula do partido (contraste automático). */
  partidoTexto(sigla: string | null | undefined): string {
    return sigla ? partidoTextoSobre(sigla) : 'var(--color-text)';
  }

  temAlerta(row: CandidateListItem): boolean {
    return Boolean(row.temCassacao) || this.situacaoSugereCassacao(row.situacao);
  }

  /** Legenda humana para os códigos de situação do TSE (mantém o código original). */
  situacaoLegenda(situacao: string | null | undefined): string {
    if (!situacao) return '—';
    const chave = situacao.trim().toUpperCase();
    return SITUACOES_TSE[chave] ?? situacao;
  }

  private situacaoSugereCassacao(situacao: string | null | undefined): boolean {
    if (!situacao) return false;
    return situacao.toUpperCase().includes('CASS');
  }
}
