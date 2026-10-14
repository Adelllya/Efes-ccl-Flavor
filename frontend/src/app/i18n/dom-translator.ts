/**
 * Перевод интерфейса прямо в DOM: шаблоны остаются английскими, а MutationObserver переписывает
 * nodeValue текстовых узлов и атрибуты placeholder / aria-label / title / alt по словарю.
 *
 * Как это уживается с Angular: Angular сравнивает новое значение привязки со своим прошлым значением,
 * а не с DOM, поэтому наш nodeValue он не трогает, пока данные не поменялись. Когда поменялись, он
 * пишет новый английский текст, срабатывает characterData, и мы переводим снова.
 *
 * Не трогаем: поля ввода, textarea, contenteditable, script/style и всё внутри [data-no-i18n]
 * (тексты сообщений чата, панель персонала).
 */

export interface Pattern {
  re: RegExp;
  out: string | ((m: RegExpMatchArray, tr: (s: string) => string) => string);
}

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
const SKIP_SELECTOR = '[data-no-i18n],script,style,textarea,input,[contenteditable=""],[contenteditable="true"]';
const LATIN = /[A-Za-z]/;

interface Rec { src: string; out: string }

export class DomTranslator {
  private readonly exact = new Map<string, string>();
  /** Шаблоны с {0}: по литеральному началу, чтобы не гонять все регулярки на каждом узле. */
  private readonly byPrefix = new Map<string, Pattern[]>();
  private readonly loose: Pattern[] = [];
  private readonly texts = new WeakMap<Text, Rec>();
  private readonly attrs = new WeakMap<Element, Map<string, Rec>>();
  private observer?: MutationObserver;

  constructor(dicts: Record<string, string>[], patterns: Pattern[] = []) {
    for (const dict of dicts) {
      for (const [k, v] of Object.entries(dict)) {
        if (!v) continue;
        const key = norm(k);
        if (/\{\d+\}/.test(key)) this.addPattern(compileTemplate(key, v), key);
        else this.exact.set(key, v);
      }
    }
    for (const p of patterns) this.loose.push(p);
  }

  private addPattern(p: Pattern, key: string) {
    const prefix = key.split(/\{\d+\}/)[0].slice(0, 3);
    if (prefix.length < 3) { this.loose.push(p); return; }
    const list = this.byPrefix.get(prefix);
    if (list) list.push(p); else this.byPrefix.set(prefix, [p]);
  }

  /** Перевод одной строки целиком; null, если перевода нет. */
  translate(raw: string): string | null {
    const core = norm(raw);
    if (!core || !LATIN.test(core)) return null;
    const hit = this.exact.get(core);
    if (hit !== undefined) return hit;
    const tr = (s: string) => this.exact.get(norm(s)) ?? s;
    const tryList = (list: Pattern[] | undefined) => {
      if (!list) return null;
      for (const p of list) {
        const m = core.match(p.re);
        if (m) return typeof p.out === 'string' ? fill(p.out, m, tr) : p.out(m, tr);
      }
      return null;
    };
    const viaPattern = tryList(this.byPrefix.get(core.slice(0, 3))) ?? tryList(this.loose);
    if (viaPattern !== null) return viaPattern;
    // Подписи из нескольких частей: «Czech Lager · 4% · Complement», «· close to your taste»
    if (core.includes('·')) {
      const parts = core.split(/(\s*·\s*)/);
      let changed = false;
      const out = parts.map(p => {
        if (/^\s*·\s*$/.test(p) || !p) return p;
        const t = this.exact.get(p) ?? (p !== core ? this.translateSimple(p) : null);
        if (t !== null && t !== undefined && t !== p) { changed = true; return t; }
        return p;
      }).join('');
      if (changed) return out;
    }
    return null;
  }

  /** Перевод части составной подписи: словарь и шаблоны, без повторного деления по «·». */
  private translateSimple(s: string): string | null {
    const hit = this.exact.get(s);
    if (hit !== undefined) return hit;
    const tr = (x: string) => this.exact.get(norm(x)) ?? x;
    for (const list of [this.byPrefix.get(s.slice(0, 3)), this.loose]) {
      for (const p of list ?? []) {
        const m = s.match(p.re);
        if (m) return typeof p.out === 'string' ? fill(p.out, m, tr) : p.out(m, tr);
      }
    }
    return null;
  }

  /** Перевод с сохранением пробелов по краям (их Angular оставляет вокруг текста). */
  private translateKeepSpace(v: string): string | null {
    const tr = this.translate(v);
    if (tr === null) return null;
    const lead = v.match(/^\s*/)![0];
    const trail = v.match(/\s*$/)![0];
    return lead + tr + trail;
  }

  start(root: Node = document.body) {
    this.walk(root);
    this.observer = new MutationObserver(muts => this.onMutations(muts));
    this.observer.observe(root, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: [...ATTRS]
    });
    // Заголовок вкладки браузера (document.title) живёт в <head>
    const title = document.querySelector('title');
    if (title) {
      this.walk(title);
      this.observer.observe(title, { subtree: true, childList: true, characterData: true });
    }
  }

  /** Выключить и вернуть английские тексты. */
  stop(root: Node = document.body) {
    this.observer?.disconnect();
    this.observer = undefined;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n: Node | null = root; n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const rec = this.texts.get(n as Text);
        if (rec && n.nodeValue === rec.out) n.nodeValue = rec.src;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const map = this.attrs.get(n as Element);
        map?.forEach((rec, name) => {
          if ((n as Element).getAttribute(name) === rec.out) (n as Element).setAttribute(name, rec.src);
        });
      }
    }
  }

  private onMutations(muts: MutationRecord[]) {
    for (const m of muts) {
      if (m.type === 'characterData') {
        this.textNode(m.target as Text);
      } else if (m.type === 'attributes') {
        this.attr(m.target as Element, m.attributeName!);
      } else {
        m.addedNodes.forEach(n => this.walk(n));
      }
    }
  }

  private walk(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) { this.textNode(root as Text); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    if (skipped(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP_SELECTOR)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n: Node | null = el; n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) this.textNode(n as Text, true);
      else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) this.attr(n as Element, a, true);
    }
  }

  private textNode(node: Text, checked = false) {
    const v = node.nodeValue;
    if (!v || !LATIN.test(v)) return;
    const rec = this.texts.get(node);
    if (rec && v === rec.out) return; // наша же запись
    if (!checked && node.parentElement && skipped(node.parentElement)) return;
    const out = this.translateKeepSpace(v);
    this.texts.set(node, { src: v, out: out ?? v });
    if (out !== null && out !== v) node.nodeValue = out;
  }

  private attr(el: Element, name: string, checked = false) {
    const v = el.getAttribute(name);
    if (!v || !LATIN.test(v)) return;
    let map = this.attrs.get(el);
    const rec = map?.get(name);
    if (rec && v === rec.out) return;
    if (!checked && skipped(el)) return;
    const out = this.translate(v);
    if (!map) { map = new Map(); this.attrs.set(el, map); }
    map.set(name, { src: v, out: out ?? v });
    if (out !== null && out !== v) el.setAttribute(name, out);
  }
}

function skipped(el: Element): boolean {
  return !!el.closest(SKIP_SELECTOR);
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** «Level {0} of {1}» → /^Level (.+?) of (.+?)$/; номера групп по {n}. */
function compileTemplate(key: string, out: string): Pattern {
  const order: number[] = [];
  const src = key.split(/(\{\d+\})/).map(part => {
    const m = part.match(/^\{(\d+)\}$/);
    if (m) { order.push(+m[1]); return '(.+?)'; }
    return escapeRe(part);
  }).join('');
  const re = new RegExp('^' + src + '$');
  return {
    re,
    out: (m, tr) => out.replace(/\{(\d+)\}/g, (_, n) => {
      const idx = order.indexOf(+n);
      return idx >= 0 ? tr(m[idx + 1] ?? '') : '';
    })
  };
}

function fill(out: string, m: RegExpMatchArray, tr: (s: string) => string): string {
  return out.replace(/\$(\d)/g, (_, n) => tr(m[+n] ?? ''));
}
