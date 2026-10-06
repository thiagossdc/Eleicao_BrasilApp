import { Component, HostListener, inject, signal } from '@angular/core';
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

  readonly showTutorialIntro = signal(false);

  constructor() {
    this.showTutorialIntro.set(!this.hasSeenTutorialIntro());
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
