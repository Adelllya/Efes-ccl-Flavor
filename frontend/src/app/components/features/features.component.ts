import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './features.component.html',
  styleUrl: './features.component.css'
})
export class FeaturesComponent {
  features = [
    {
      icon: '🧬',
      title: 'Flavor DNA',
      text: 'A personal flavor profile, like Spotify Wrapped. "You are 70% citrus."'
    },
    {
      icon: '🍖',
      title: 'Kazakh cuisine + Beer',
      text: 'Beshbarmak → Karagandinskoe Dark. Shashlik → Efes Pilsener. Truly local.'
    },
    {
      icon: '📱',
      title: 'Label scan',
      text: 'Point your camera → instant flavor pyramid + a food pairing.'
    }
  ];

  comparison = [
    { name: 'Untappd', desc: '"8 years, 4/5 ratings"', side: 'left' },
    { name: 'Flavor Tree', desc: '"I know this beer"', side: 'right' }
  ];
}
