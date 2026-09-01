import type { Locale } from "./locale";

export type Dictionary = {
  toggles: {
    language: string;
    theme: string;
    themeNames: { system: string; light: string; dark: string };
  };
  nav: { writing: string };
  proofOfWork: string;
  performance: string;
  repoLinks: { site: string; source: string };
  workedAt: string;
  hero: { bookCall: string; messageOnX: string };
  contributions: {
    graphTitle: string;
    tooltipOne: string;
    tooltipOther: string;
    footerPrefix: string;
    months: string[];
    legend: { less: string; more: string };
  };
  meta: { fallbackDescription: string };
  experience: { showMore: string; showLess: string };
  education: string;
  elsewhere: string;
  globe: string;
  contact: { lead: string; cta: string };
  writing: {
    heading: string;
    empty: string;
    back: string;
    readMore: string;
    /** Contains a `{{minutes}}` placeholder — plain data, not a function, so
        the whole dictionary can still cross into Client Components as a prop. */
    readingTime: string;
  };
};

const pt: Dictionary = {
  toggles: {
    language: "Mudar idioma",
    theme: "Mudar tema",
    themeNames: { system: "Sistema", light: "Claro", dark: "Escuro" },
  },
  nav: { writing: "escrita" },
  proofOfWork: "provas de trabalho",
  performance: "desempenho",
  repoLinks: { site: "site", source: "código" },
  workedAt: "por onde já passei",
  hero: { bookCall: "agendar uma call", messageOnX: "mensagem no X" },
  contributions: {
    graphTitle: "Contribuições no GitHub",
    tooltipOne: "{{count}} contribuição em {{date}}",
    tooltipOther: "{{count}} contribuições em {{date}}",
    footerPrefix: "{{count}} contribuições no último ano no",
    months: [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ],
    legend: { less: "Menos", more: "Mais" },
  },
  meta: { fallbackDescription: "portfólio de desenvolvedor de {{name}}." },
  experience: { showMore: "ver mais", showLess: "ver menos" },
  education: "formação",
  elsewhere: "por aí",
  globe: "girando por aqui",
  contact: { lead: "bora trocar uma ideia?", cta: "manda um oi" },
  writing: {
    heading: "escrita",
    empty: "nada por aqui ainda — em breve.",
    back: "voltar",
    readMore: "ler mais",
    readingTime: "{{minutes}} min de leitura",
  },
};

const en: Dictionary = {
  toggles: {
    language: "Change language",
    theme: "Change theme",
    themeNames: { system: "System", light: "Light", dark: "Dark" },
  },
  nav: { writing: "writing" },
  proofOfWork: "proof of work",
  performance: "performance",
  repoLinks: { site: "site", source: "source" },
  workedAt: "places i worked at",
  hero: { bookCall: "Book a call", messageOnX: "Message on X" },
  contributions: {
    graphTitle: "GitHub Contributions",
    tooltipOne: "{{count}} contribution on {{date}}",
    tooltipOther: "{{count}} contributions on {{date}}",
    footerPrefix: "{{count}} contributions in last year on",
    months: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    legend: { less: "Less", more: "More" },
  },
  meta: { fallbackDescription: "{{name}}'s developer portfolio." },
  experience: { showMore: "show more", showLess: "show less" },
  education: "education",
  elsewhere: "elsewhere",
  globe: "spinning around here",
  contact: { lead: "wanna chat?", cta: "let's talk" },
  writing: {
    heading: "writing",
    empty: "nothing here yet — soon.",
    back: "back",
    readMore: "read more",
    readingTime: "{{minutes}} min read",
  },
};

const dictionaries: Record<Locale, Dictionary> = { pt, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
