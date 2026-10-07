import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConsultaPageComponent } from './consulta.page';

/** Stub da rota: devolve os query params desejados sem depender do Router. */
function routeComParams(params: Record<string, string>): unknown {
  return { snapshot: { queryParamMap: convertToParamMap(params) } };
}

describe('ConsultaPageComponent', () => {
  let fixture: ComponentFixture<ConsultaPageComponent>;
  let httpMock: HttpTestingController;

  async function setup(params: Record<string, string> = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ConsultaPageComponent],
      providers: [
        // Rota componentless (sem componente) só é válida com `children`.
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: routeComParams(params) },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConsultaPageComponent);
    fixture.detectChanges();

    // Inicial: resumo da base + opções dos filtros.
    httpMock.expectOne('/api/stats').flush({
      totalCandidatos: 100,
      totalRegistrosCassacao: 10,
    });
    httpMock.expectOne('/api/candidates/options').flush({ cargos: [], partidos: [] });
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('restaura os filtros da URL e busca automaticamente', async () => {
    await setup({ q: 'silva', uf: 'SP', ano: '2022' });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/candidates' && r.params.get('q') === 'silva',
    );
    expect(req.request.params.get('uf')).toBe('SP');
    expect(req.request.params.get('ano')).toBe('2022');
    req.flush({ items: [], total: 0, limit: 50, offset: 0 });

    expect(fixture.componentInstance.hasSearched()).toBeTrue();
    expect(fixture.componentInstance.filtroNome).toBe('silva');
  });

  it('sem filtros na URL não busca nada até a ação do usuário', async () => {
    await setup();
    httpMock.expectNone((r) => r.url === '/api/candidates');

    fixture.componentInstance.buscar();
    const req = httpMock.expectOne((r) => r.url === '/api/candidates');
    req.flush({ items: [], total: 0, limit: 50, offset: 0 });
    expect(fixture.componentInstance.hasSearched()).toBeTrue();
  });

  it('mostra o resumo de paginação com o total devolvido pela API', async () => {
    await setup();
    fixture.componentInstance.buscar();

    httpMock
      .expectOne((r) => r.url === '/api/candidates')
      .flush({ items: [], total: 120, limit: 50, offset: 0 });

    expect(fixture.componentInstance.total()).toBe(120);
    expect(fixture.componentInstance.resumoPaginacao()).toBe('Exibindo 1–50 de 120 resultado(s)');
  });

  it('agrupa alterações rápidas de filtro numa única busca (debounce 300 ms)', async () => {
    await setup();

    fixture.componentInstance.agendarBusca();
    fixture.componentInstance.agendarBusca();
    fixture.componentInstance.agendarBusca();
    await new Promise((resolve) => setTimeout(resolve, 350));

    const reqs = httpMock.match((r) => r.url === '/api/candidates');
    expect(reqs.length).toBe(1);
    reqs[0].flush({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('expõe a mensagem da API quando a busca falha', async () => {
    await setup();
    fixture.componentInstance.buscar();

    httpMock
      .expectOne((r) => r.url === '/api/candidates')
      .flush({ error: 'UF inválida.' }, { status: 400, statusText: 'Bad Request' });

    expect(fixture.componentInstance.error()).toBe('UF inválida.');
    expect(fixture.componentInstance.items()).toEqual([]);
  });
});
