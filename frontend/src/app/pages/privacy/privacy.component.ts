import { Component } from '@angular/core';

/**
 * /privacy: какие данные собирает сайт, зачем, где и сколько хранит, как их удалить.
 * Страница открыта без вопроса о возрасте. Текст правится здесь же, отдельного API нет.
 */
@Component({
  selector: 'app-privacy',
  standalone: true,
  template: `
    <article class="pv">
      <header class="mb-3xl">
        <h1 class="section-header">Privacy and terms</h1>
        <p class="text-muted">How Flavor Tree handles guest data and what you should know about alcohol. Last updated September 26, 2026.</p>
      </header>

      <section class="glass-panel pv-section">
        <h2>About the service</h2>
        <p>
          Flavor Tree helps you explore drink flavors and find the right drink for a dish.
          In venues it works as a digital menu: guests open it with the QR code on the table and can send an order to the staff.
          The service was built by the Flavor Tree project team for OneIdea Championship 2026 and is currently running as a pilot.
        </p>
        <p>
          This is an information guide. We do not sell alcohol or advertise it.
          Orders from the menu go to the venue staff, while payment, serving drinks and checking ID remain the venue's responsibility.
          Menu prices and availability are set by the venue; prices in the catalog are for reference only.
        </p>
      </section>

      <section class="glass-panel pv-section">
        <h2>What data we collect</h2>
        <ul class="pv-list">
          <li><strong>Account</strong>, if you sign up: your username, email and first name, if you provided one. Your password is stored only as a hash and cannot be read.</li>
          <li><strong>Anonymous session ID</strong>: a random string the site creates in your browser. It shows that several actions were taken by the same guest, but not who that guest is.</li>
          <li><strong>Activity in the menu and catalog</strong>: which pages and pairings you opened, what you added to your order, the table number from the QR code, and your answer to the age question.</li>
          <li><strong>Orders</strong>: items, total, table number and time, plus your name and comment if you entered them.</li>
          <li><strong>Pairing ratings</strong>: a rating from 1 to 5 and a comment, if you left one.</li>
          <li>
            <strong>Questions to the AI sommelier</strong>: the text of your questions in the chat. If an external language model
            (Claude by Anthropic) is connected to the service, your question is sent to it to get an answer. Please do not share your name, phone number or other personal details in the chat.
          </li>
        </ul>
        <p>
          We do not ask for your phone number or address, do not determine your location and do not use advertising trackers.
          The site's fonts are loaded from Google Fonts, so Google receives a technical request from your browser.
        </p>
        <p>
          In your browser, the site stores your sign-in, cart, table number, answer to the age question, session ID
          and chat history until you close the tab. All of this is deleted when you clear the site data in your browser settings.
        </p>
      </section>

      <section class="glass-panel pv-section">
        <h2>Why we collect it</h2>
        <ul class="pv-list">
          <li>To make the service work: signing in, sending orders to the staff, matching drinks and answering in the chat.</li>
          <li>
            For pilot statistics: how many guests opened the menu, how often they use pairing, how many orders included a suggested pairing,
            the average order value and how guests rate the pairings. The venue sees these figures in aggregate, and the team needs them to present the project.
          </li>
        </ul>
        <p>We do not sell data or share it with advertisers.</p>
      </section>

      <section class="glass-panel pv-section">
        <h2>Who can see it and where it is stored</h2>
        <p>
          Venue staff see orders and statistics for their own venue only. The project moderator sees orders from all pilot venues.
        </p>
        <p>
          The service's server and data are currently hosted by the cloud provider Vercel, outside Kazakhstan.
          For permanent operation after the pilot, the database must be moved to servers in Kazakhstan, as required by the Law of the Republic of Kazakhstan
          "On Personal Data and Their Protection".
        </p>
      </section>

      <section class="glass-panel pv-section">
        <h2>How long we keep it</h2>
        <p>
          Pilot data (menu activity, orders, ratings, chat questions) will be deleted after OneIdea Championship 2026 ends,
          or sooner if you ask. Your account is kept for as long as you need it and is deleted on request.
        </p>
      </section>

      <section class="glass-panel pv-section">
        <h2>How to delete your data or ask a question</h2>
        <p>
          The service does not yet have a dedicated email for requests. You can pass your request through the staff of the venue where you used the menu,
          or to the Flavor Tree team. To help us find your data, tell us the venue, table number and approximate time of your order.
        </p>
        <p>You can change the name and email in your account yourself in your profile.</p>
      </section>

      <section class="glass-panel pv-section pv-warning">
        <h2>Age and moderation</h2>
        <p>
          The service is intended for guests aged 21 and over: in Kazakhstan, alcohol may only be sold to people aged 21 and over.
          Venue staff may ask for ID and refuse to serve alcohol.
        </p>
        <p>
          <strong>Excessive alcohol consumption is harmful to your health.</strong>
          If you are driving, pregnant or under 21, choose non-alcoholic drinks: tea, lemonades, water.
        </p>
      </section>
    </article>
  `,
  styles: [`
    .pv { max-width: 820px; margin: 0 auto; }
    .pv-section { padding: var(--space-2xl) var(--space-3xl); margin-bottom: var(--space-xl); }
    .pv-section h2 { font-size: 1.25rem; margin-bottom: var(--space-md); }
    .pv-section p { color: var(--foam-dim); line-height: 1.6; margin: 0 0 var(--space-md); }
    .pv-section p:last-child { margin-bottom: 0; }
    .pv-list { list-style: none; margin: 0 0 var(--space-md); padding: 0; display: flex; flex-direction: column; gap: var(--space-md); }
    .pv-list li { position: relative; padding-left: 20px; color: var(--foam-dim); line-height: 1.55; }
    .pv-list li::before {
      content: '';
      position: absolute;
      left: 2px;
      top: 0.6em;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--beer-accent), var(--beer-mid));
    }
    .pv-list strong, .pv-section strong { color: var(--foam); }
    .pv-warning { border-color: rgba(180, 83, 9, 0.35); background: linear-gradient(135deg, rgba(255, 255, 255, 0.85), rgba(253, 243, 222, 0.85)); }

    @media (max-width: 640px) {
      .pv-section { padding: var(--space-xl); }
    }
  `]
})
export class PrivacyComponent {}
