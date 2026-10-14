import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-business-model',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './business-model.component.html',
  styleUrl: './business-model.component.css'
})
export class BusinessModelComponent {
  streams = [
    { icon: '📊', name: 'B2B Data', model: 'Flavor analytics for R&D', target: 'Efes' },
    { icon: '🎓', name: 'B2B Education', model: 'HoReCa staff training', target: 'Bars, restaurants' },
    { icon: '📢', name: 'Promoted', model: 'Native brand recommendations', target: 'Efes KZ brands' },
    { icon: '💎', name: 'Freemium', model: 'Free + Premium AI sommelier', target: 'Consumers' },
  ];

  stats = [
    { value: '690M L', label: 'of beer sold in Kazakhstan in 2025' },
    { value: '15+', label: 'Efes KZ brands' },
    { value: '∞', label: 'scale: coffee, wine, Türkiye' },
  ];
}
