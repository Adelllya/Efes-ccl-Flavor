import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent {
  team = [
    { name: 'Yeraly', role: 'Co-founder', initials: 'YA' },
    { name: 'Adelia', role: 'Co-founder', initials: 'AA' },
  ];
}
