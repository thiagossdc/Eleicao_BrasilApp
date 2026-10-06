import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { BRAZIL_UFS } from '../../core/constants/brazil-ufs';
import { EleicaoApiService } from '../../core/services/eleicao-api.service';

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
  readonly anos = [2026, 2024, 2022, 2020, 2018];

  ano = 2022;
  uf = 'SP';

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<{
    candidatosProcessados: number;
    registrosCassacaoProcessados: number;
    fontes: { candidatosZip: string; cassacaoZip: string };
  } | null>(null);

  enviar(): void {
    this.error.set(null);
    this.result.set(null);
    this.loading.set(true);

    this.api
      .syncTse({ ano: this.ano, uf: this.uf })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.result.set({
            candidatosProcessados: res.candidatosProcessados,
            registrosCassacaoProcessados: res.registrosCassacaoProcessados,
            fontes: res.fontes,
          });
        },
        error: (err) => {
          this.error.set(err?.error?.error ?? 'Falha na sincronização.');
        },
      });
  }
}
