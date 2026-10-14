import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-education',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './education.component.html',
  styleUrl: './education.component.css'
})
export class EducationComponent {
  levels = [
    { level: 1, color: '#22C55E', name: 'Novice', description: 'Basic tastes and how to taste beer properly' },
    { level: 2, color: '#3B82F6', name: 'Explorer', description: 'Aroma notes and beer styles (lager vs ale)' },
    { level: 3, color: '#8B5CF6', name: 'Connoisseur', description: 'Food pairings and how ingredients shape flavor' },
    { level: 4, color: '#F59E0B', name: 'Sommelier', description: 'Blind tasting + a digital Efes certificate' },
  ];

  features = ['XP', 'streaks', 'leaderboard', 'AI mentor', 'AR lessons'];
}
