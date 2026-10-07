import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TimeoutError, throwError } from 'rxjs';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';
import { SyncPageComponent } from './sync.page';

const SYNC_RESPOSTA = {
  ok: true,
  ano: 2022,
  uf: 'SP',
  candidatosProcessados: 10,
  registrosCassacaoProcessados: 2,
  fontes: { candidatosZip: 'https://tse/cand.zip', cassacaoZip: 'https://tse/cass.zip' },
};

describe('SyncPageComponent', () => {
  let fixture: ComponentFixture<SyncPageComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyncPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SyncPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('envia o token digitado como header x-sync-token', () => {
    fixture.componentInstance.token = 'segredo-123';
    fixture.componentInstance.enviar();

    const req = httpMock.expectOne(
      (r) => r.url === '/api/sync' && r.headers.get('x-sync-token') === 'segredo-123',
    );
    expect(req.request.method).toBe('POST');
    req.flush(SYNC_RESPOSTA);

    expect(fixture.componentInstance.result()?.candidatosProcessados).toBe(10);
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('não envia header quando o token está em branco', () => {
    fixture.componentInstance.enviar();

    const req = httpMock.expectOne((r) => r.url === '/api/sync');
    expect(req.request.headers.has('x-sync-token')).toBeFalse();
    req.flush(SYNC_RESPOSTA);
  });

  it('cancela a importação nacional quando o usuário recusa a confirmação', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    fixture.componentInstance.uf = 'BRASIL';
    fixture.componentInstance.enviar();

    httpMock.expectNone((r) => r.url === '/api/sync');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('traduz 401 em mensagem clara sobre o token', () => {
    fixture.componentInstance.token = 'errado';
    fixture.componentInstance.enviar();

    httpMock
      .expectOne((r) => r.url === '/api/sync')
      .flush({ error: 'Token de sincronização ausente ou inválido.' }, { status: 401, statusText: 'Unauthorized' });

    expect(fixture.componentInstance.error()).toMatch(/token/i);
  });

  it('avisa quando a importação excede o tempo de espera', () => {
    // O operador timeout do rxjs emite TimeoutError antes de chegar ao HTTP;
    // simulamos pelo próprio serviço para exercitar o ramo da mensagem.
    const api = TestBed.inject(EleicaoApiService);
    spyOn(api, 'syncTse').and.returnValue(throwError(() => new TimeoutError()));

    fixture.componentInstance.enviar();

    expect(fixture.componentInstance.error()).toContain('5 minutos');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });
});
