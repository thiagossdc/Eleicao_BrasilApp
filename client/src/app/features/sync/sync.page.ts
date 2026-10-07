import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TimeoutError, finalize, timeout } from 'rxjs';
import { BRAZIL_UFS } from '../../core/constants/brazil-ufs';
import { ELEICAO_ANOS } from '../../core/constants/eleicao-years';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';

/** Tempo máximo que a interface aguarda a importação antes de avisar o usuário. */
const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-sync-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sync.page.html',
  styleUrl: './sync.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncPageComponent {
  private readonly api = inject(EleicaoApiService);

  readonly ufs = [...BRAZIL_UFS];
  /** Mesmo catálogo das demais telas: o que aparece no cruzamento é sincronizável. */
  readonly anos: readonly number[] = ELEICAO_ANOS;

  ano = 2022;
  uf = 'SP';
  /** Token opcional enviado como `x-sync-token` quando a API exige SYNC_TOKEN. */
  token = '';

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<{
    candidatosProcessados: number;
    registrosCassacaoProcessados: number;
    fontes: { candidatosZip: string; cassacaoZip: string };
  } | null>(null);

  /** Pacote nacional: avisa antes de disparar um download muito maior. */
  get isBrasil(): boolean {
    return this.uf === 'BRASIL';
  }

  enviar(): void {
    if (this.isBrasil && !window.confirm(
      'O arquivo nacional (BRASIL) é muito grande e a importação pode demorar vários minutos. Continuar?',
    )) {
      return;
    }

    this.error.set(null);
    this.result.set(null);
    this.loading.set(true);

    this.api
      .syncTse({ ano: this.ano, uf: this.uf }, this.token)
      .pipe(timeout(SYNC_TIMEOUT_MS), finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.result.set({
            candidatosProcessados: res.candidatosProcessados,
            registrosCassacaoProcessados: res.registrosCassacaoProcessados,
            fontes: res.fontes,
          });
        },
        error: (err) => {
          if (err instanceof TimeoutError) {
            this.error.set(
              'A importação excedeu o tempo de espera (5 minutos). Tente uma UF menor ou verifique a API.',
            );
            return;
          }
          if (err?.status === 401) {
            this.error.set(
              'A API recusou o token de sincronização. Confira o valor de SYNC_TOKEN configurado no servidor.',
            );
            return;
          }
          if (err?.status === 429) {
            this.error.set(err?.error?.error ?? 'Limite de sincronizações atingido: aguarde 15 minutos.');
            return;
          }
          this.error.set(err?.error?.error ?? 'Falha na sincronização.');
        },
      });
  }
}
