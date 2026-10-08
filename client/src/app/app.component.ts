import { Component, ElementRef, HostListener, Injector, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Marca que o usuário já viu o aviso de boas-vindas do tutorial. */
const TUTORIAL_INTRO_KEY = 'eleicao-limpa:tutorial-intro-v1';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  readonly showTutorialIntro = signal(false);

  private readonly introDialog = viewChild<ElementRef<HTMLDivElement>>('introDialog');
  private introWasOpen = false;
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    this.showTutorialIntro.set(!this.hasSeenTutorialIntro());

    // Acessibilidade: ao abrir, o foco entra no dialog; ao fechar, volta para
    // onde estava. afterNextRender garante que o elemento já exista no DOM.
    effect(() => {
      const open = this.showTutorialIntro();
      if (open === this.introWasOpen) return;
      this.introWasOpen = open;
      afterNextRender(
        () => (open ? this.enterDialog() : this.leaveDialog()),
        { injector: this.injector },
      );
    });
  }

  /** Marca (texto + bandeira): volta à tela inicial sempre do zero, mesmo já estando nela. */
  voltarAoInicio(event: Event): void {
    event.preventDefault();
    this.closeTutorialIntro();
    const rotaAtual = this.router.url.split('?')[0].split('#')[0];
    if (rotaAtual === '/' || rotaAtual === '/cruzamento' || rotaAtual === '') {
      // Já na tela inicial: o Router reutilizaria o componente (ngOnInit não roda
      // de novo), então o reload garante filtros, resultado e URL limpos.
      window.location.assign('/');
      return;
    }
    // Vindo de outra página (/consulta, /sync, /tutorial): navegação SPA recria
    // a página de cruzamento do zero, já sem query params.
    void this.router.navigate(['/']);
  }

  closeTutorialIntro(): void {
    if (!this.showTutorialIntro()) {
      return;
    }
    this.rememberTutorialIntro();
    this.showTutorialIntro.set(false);
  }

  goToTutorial(): void {
    this.rememberTutorialIntro();
    this.showTutorialIntro.set(false);
    this.router.navigate(['/tutorial']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeTutorialIntro();
  }

  /** Mantém a navegação por Tab presa dentro do dialog enquanto ele estiver aberto. */
  @HostListener('document:keydown.tab', ['$event'])
  onTab(event: KeyboardEvent): void {
    if (!this.showTutorialIntro()) return;
    const dialog = this.introDialog()?.nativeElement;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && dialog.contains(active);

    if (event.shiftKey) {
      if (!inside || active === dialog || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private enterDialog(): void {
    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.introDialog()?.nativeElement.focus();
  }

  private leaveDialog(): void {
    const alvo = this.previouslyFocused;
    this.previouslyFocused = null;
    if (alvo && document.contains(alvo)) {
      alvo.focus();
    }
  }

  private hasSeenTutorialIntro(): boolean {
    try {
      return localStorage.getItem(TUTORIAL_INTRO_KEY) === '1';
    } catch {
      // localStorage indisponível (modo privado): não insiste no aviso.
      return true;
    }
  }

  private rememberTutorialIntro(): void {
    try {
      localStorage.setItem(TUTORIAL_INTRO_KEY, '1');
    } catch {
      // Sem persistência possível; o aviso pode reaparecer na próxima sessão.
    }
  }
}
