import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'ft-not-found', standalone: true, imports: [RouterLink],
  template: `<div class="center" style="padding: 80px 0"><div style="font-size:64px">🍺</div><h1>Тут пусто</h1><p class="muted mt8">Такой страницы нет — но пиво к блюду мы всё равно подберём.</p><a routerLink="/pair" class="btn btn-primary mt24">Подобрать пиво</a></div>`,
})
export class NotFoundPage {}
